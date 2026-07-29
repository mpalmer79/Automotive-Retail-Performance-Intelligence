"""Shared Microsoft Fabric and Power BI REST client for the ARPI semantic model.

WHY THIS EXISTS
---------------
ARPI's semantic model is written in TMDL and validated statically on every push, but a
static check proves the model is *well-formed*, not that it is *correct*. Closing that gap
needs a real Microsoft semantic-model engine to load the model, refresh it, and return
numbers that can be compared with the governed SQL baseline. ADR-0008 accepts two engines
for that: Power BI Desktop, which needs Windows, and Microsoft Fabric, which needs only a
browser. This module is the client for the Fabric path.

Three scripts share it:

* ``scripts/deploy_powerbi_fabric.py``   creates or updates the semantic model
* ``scripts/validate_powerbi_fabric.py`` refreshes it and reconciles DAX against SQL
* ``scripts/check_fabric_validation_freshness.py`` reads the evidence it produces

WHAT IT WILL NOT DO
-------------------
It never writes a token, a refresh token, a client secret, a database password or a
credential-bearing connection string to standard output, to a log, or to any file inside
the repository. The token cache lives outside the repository, in ``~/.arpi/``, mode 0600,
and can be disabled entirely. :func:`redact` is applied to every error body before it is
shown, because Fabric occasionally echoes a request payload back in an error message and
a bound connection payload can carry a user name.

AUTHENTICATION
--------------
Delegated **device code** flow against Microsoft Entra ID: this prints a short code and a
URL, you complete sign-in in any browser on any device, and the script continues. That is
the whole reason the Fabric path works from a Chromebook. No client secret is involved and
no application password exists to leak.

Two API audiences are needed and they are different:

* ``https://api.fabric.microsoft.com`` for the item-definition APIs, and
* ``https://analysis.windows.net/powerbi/api`` for refresh and Execute Queries.

Signing in twice would be user-hostile, so the device-code flow requests ``offline_access``
once and the resulting refresh token is redeemed silently for the second audience. That is
ordinary OAuth 2.0 for a public client, not a trick.

API CONTRACT
------------
Endpoints, payload shapes and long-running-operation behaviour follow the published
Microsoft Fabric REST specification (``microsoft/fabric-rest-api-specs``), read at the
time of writing rather than recalled:

* ``POST   /v1/workspaces/{workspaceId}/semanticModels``                     (LRO)
* ``POST   /v1/workspaces/{workspaceId}/semanticModels/{id}/updateDefinition`` (LRO)
* ``POST   /v1/workspaces/{workspaceId}/semanticModels/{id}/getDefinition``  (LRO)
* ``POST   /v1/workspaces/{workspaceId}/semanticModels/{id}/bindConnection``
* ``GET    /v1/operations/{operationId}`` and ``/result``

Definition parts are ``{path, payload, payloadType}`` with ``payloadType`` of
``InlineBase64``. A long-running operation answers 202 with a ``Location`` header, an
``x-ms-operation-id`` and a ``Retry-After``; the result is fetched from the ``/result``
sub-resource once the operation succeeds.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

__all__ = [
    "FABRIC_RESOURCE",
    "POWERBI_RESOURCE",
    "ApiError",
    "FabricClient",
    "TokenSet",
    "acquire_token",
    "add_common_arguments",
    "connection_binding",
    "definition_parts",
    "get_connection",
    "log",
    "redact",
    "resolve_setting",
    "semantic_model_dir",
]

REPO_ROOT = Path(__file__).resolve().parents[1]

SEMANTIC_MODEL_DIR = (
    REPO_ROOT
    / "powerbi"
    / "ARPI_Performance_Intelligence"
    / "ARPI_Performance_Intelligence.SemanticModel"
)

#: HTTP statuses this client reasons about by name rather than by number.
HTTP_TOO_MANY_REQUESTS = 429
HTTP_SERVER_ERROR_FLOOR = 500
HTTP_SERVER_ERROR_CEILING = 600

#: Retry budgets. A rate limit is worth waiting out; a network error is usually transient
#: but not always, so it gets a shorter budget.
MAX_HTTP_ATTEMPTS = 5
MAX_NETWORK_ATTEMPTS = 3

#: Long-running-operation polling bounds, in seconds.
LRO_MIN_INTERVAL = 5
LRO_MAX_INTERVAL = 30
LRO_DEADLINE = 1800

#: How much of an unrecognised error body to show before it stops being useful.
ERROR_BODY_CHARACTERS = 600

#: A cached access-token entry is the pair (token, expiry).
TOKEN_CACHE_ENTRY_LENGTH = 2

FABRIC_RESOURCE = "https://api.fabric.microsoft.com"
POWERBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
FABRIC_API = "https://api.fabric.microsoft.com/v1"
POWERBI_API = "https://api.powerbi.com/v1.0/myorg"

#: Microsoft Azure PowerShell. A well-known FIRST-PARTY public client that supports the
#: device-code flow and the Power BI and Fabric audiences, pre-consented in most tenants.
#: It is a default, not a recommendation: registering your own single-tenant public client
#: and passing --client-id is better practice, and the handoff document explains how. No
#: secret is involved either way, because a public client has none.
DEFAULT_CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2"

#: Token cache location. Deliberately OUTSIDE the repository so that no `git add -A` can
#: ever capture it, and mode 0600 so it is not world-readable. Set
#: ARPI_FABRIC_NO_TOKEN_CACHE=1 to keep tokens in memory only.
TOKEN_CACHE_PATH = Path.home() / ".arpi" / "fabric_token_cache.json"

#: Substrings that mark a JSON key whose value must never be printed.
_SECRET_KEY_MARKERS = (
    "token",
    "password",
    "secret",
    "credential",
    "authorization",
    "connectionstring",
    "sas",
    "key",
)


def log(message: str = "") -> None:
    """Write one line of operator-facing output to stdout."""
    print(message, flush=True)


def redact(value: Any) -> Any:
    """Return *value* with anything that looks like a secret replaced.

    Applied to every error body and every echoed request before it reaches a terminal or
    an evidence file. Fabric error messages sometimes quote the request that produced
    them, and a bindConnection request carries a user name.
    """
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if any(marker in str(key).lower() for marker in _SECRET_KEY_MARKERS):
                redacted[key] = "<redacted>"
            else:
                redacted[key] = redact(item)
        return redacted
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and value.lower().startswith("bearer "):
        return "<redacted>"
    return value


class ApiError(RuntimeError):
    """An HTTP error from Fabric or Power BI, rendered so it can be acted on.

    Fabric returns a structured body with ``errorCode``, ``message`` and ``requestId``.
    The raw status alone is close to useless for diagnosis, and the request ID is what
    Microsoft support asks for, so all three are surfaced.
    """

    #: Error codes worth translating, because the API's own message does not say what to
    #: do about them.
    ADVICE: ClassVar[dict[str, str]] = {
        "InsufficientPrivileges": (
            "The signed-in identity is not a Contributor or Admin on this workspace. Add "
            "it in the Fabric portal under Workspace > Manage access."
        ),
        "WorkspaceNotFound": (
            "The workspace ID is wrong, or the signed-in identity cannot see it. The ID "
            "is the GUID in the workspace URL after /groups/."
        ),
        "ItemNotFound": (
            "The semantic model ID is wrong or the item was deleted. Omit --item-id to "
            "create a new model instead of updating one."
        ),
        "ItemDisplayNameAlreadyInUse": (
            "A semantic model with this display name already exists in the workspace. "
            "Pass --item-id to update it, or choose another --display-name."
        ),
        "UnsupportedCapacitySKU": (
            "The workspace is not on a Fabric or Premium capacity. A Fabric trial "
            "capacity is sufficient; assign one under Workspace settings > License info."
        ),
        "CapacityNotActive": (
            "The workspace capacity is paused. Resume it before deploying or refreshing."
        ),
        "PowerBINotAuthorizedException": (
            "The identity lacks Build permission on the semantic model, or the tenant "
            "has not enabled the Execute Queries REST API. Both are covered in "
            "docs/powerbi/FABRIC_SERVICE_HANDOFF.md."
        ),
        "DatasetExecuteQueriesUserError": (
            "The DAX query itself failed. The message above is the engine's own text; it "
            "is a defect in the model or the query, not in this script."
        ),
        "InvalidRequest": (
            "The request shape was rejected. If this is a deploy, the most likely cause "
            "is a TMDL file the engine will not parse -- which is exactly the class of "
            "defect this validation exists to catch. Read the message above carefully."
        ),
    }

    def __init__(
        self,
        status: int,
        url: str,
        body: Any,
        request_id: str | None = None,
    ) -> None:
        """Record the status, URL, redacted body and request ID of a failed call."""
        self.status = status
        self.url = url
        self.body = redact(body)
        self.request_id = request_id
        super().__init__(self._render())

    @property
    def error_code(self) -> str | None:
        """The Fabric ``errorCode`` when the body carried one."""
        if isinstance(self.body, dict):
            code = self.body.get("errorCode") or self.body.get("error", {})
            if isinstance(code, dict):
                code = code.get("code")
            if isinstance(code, str):
                return code
        return None

    def _render(self) -> str:
        lines = [f"HTTP {self.status} from {self.url}"]
        code = self.error_code
        if code:
            lines.append(f"  errorCode : {code}")
        message = None
        if isinstance(self.body, dict):
            message = self.body.get("message")
            if message is None and isinstance(self.body.get("error"), dict):
                message = self.body["error"].get("message")
        if message:
            lines.append(f"  message   : {message}")
        if self.request_id:
            lines.append(f"  requestId : {self.request_id}")
        if code and code in self.ADVICE:
            lines.append(f"  what to do: {self.ADVICE[code]}")
        if not code and not message:
            lines.append(f"  body      : {json.dumps(self.body)[:ERROR_BODY_CHARACTERS]}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------------------


@dataclass
class TokenSet:
    """Access tokens per resource, plus the refresh token that mints more of them."""

    refresh_token: str | None = None
    access_tokens: dict[str, tuple[str, float]] = field(default_factory=dict)

    def valid_access_token(self, resource: str) -> str | None:
        """Return a cached token for *resource* if one is still comfortably valid."""
        entry = self.access_tokens.get(resource)
        if entry is None:
            return None
        token, expires_at = entry
        # 120 seconds of headroom: a token that expires mid-refresh-poll is worse than
        # one fetched slightly early.
        return token if expires_at - 120 > time.time() else None

    def remember(self, resource: str, token: str, expires_in: int) -> None:
        """Cache *token* for *resource*."""
        self.access_tokens[resource] = (token, time.time() + float(expires_in))


def _cache_enabled() -> bool:
    return os.environ.get("ARPI_FABRIC_NO_TOKEN_CACHE", "").strip() not in {"1", "true", "yes"}


def _load_cache() -> TokenSet:
    if not _cache_enabled() or not TOKEN_CACHE_PATH.is_file():
        return TokenSet()
    try:
        raw = json.loads(TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return TokenSet()
    tokens = TokenSet(refresh_token=raw.get("refresh_token"))
    for resource, entry in (raw.get("access_tokens") or {}).items():
        if isinstance(entry, list) and len(entry) == TOKEN_CACHE_ENTRY_LENGTH:
            tokens.access_tokens[resource] = (str(entry[0]), float(entry[1]))
    return tokens


def _save_cache(tokens: TokenSet) -> None:
    if not _cache_enabled():
        return
    TOKEN_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "refresh_token": tokens.refresh_token,
        "access_tokens": {k: [v[0], v[1]] for k, v in tokens.access_tokens.items()},
    }
    # Create with restrictive permissions BEFORE writing, so the token is never briefly
    # world-readable on disk.
    descriptor = os.open(TOKEN_CACHE_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


def _post_form(url: str, form: dict[str, str]) -> dict[str, Any]:
    """POST a form-encoded body to Entra ID, retrying throttling and server errors.

    The device-code poll runs this every few seconds for up to fifteen minutes, so a
    single 429 or 503 must not end a sign-in the user has already completed in a browser.
    An ordinary 400 (``authorization_pending``) is NOT retried here -- the caller reads it
    and decides, because it is the normal state of a poll rather than a failure.
    """
    data = urllib.parse.urlencode(form).encode("ascii")
    attempt = 0
    while True:
        attempt += 1
        request = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"message": body[:ERROR_BODY_CHARACTERS]}
            retryable = error.code == HTTP_TOO_MANY_REQUESTS or (
                HTTP_SERVER_ERROR_FLOOR <= error.code < HTTP_SERVER_ERROR_CEILING
            )
            if retryable and attempt <= MAX_NETWORK_ATTEMPTS:
                headers = {k.lower(): v for k, v in error.headers.items()}
                time.sleep(int(headers.get("retry-after", 2**attempt)))
                continue
            raise ApiError(error.code, url, parsed) from error
        except urllib.error.URLError:
            if attempt <= MAX_NETWORK_ATTEMPTS:
                time.sleep(2**attempt)
                continue
            raise


def acquire_token(
    resource: str,
    *,
    tenant_id: str = "organizations",
    client_id: str = DEFAULT_CLIENT_ID,
    tokens: TokenSet | None = None,
) -> tuple[str, TokenSet]:
    """Return an access token for *resource*, signing in by device code if necessary.

    Order of preference, cheapest first: a cached access token for this exact resource, a
    silent redemption of the cached refresh token, and only then an interactive device-code
    sign-in. That is what makes running deploy and then validate a single sign-in rather
    than two.
    """
    tokens = tokens or _load_cache()

    cached = tokens.valid_access_token(resource)
    if cached:
        return cached, tokens

    authority = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0"
    scope = f"{resource}/.default offline_access"

    if tokens.refresh_token:
        try:
            payload = _post_form(
                f"{authority}/token",
                {
                    "client_id": client_id,
                    "grant_type": "refresh_token",
                    "refresh_token": tokens.refresh_token,
                    "scope": scope,
                },
            )
            tokens.refresh_token = payload.get("refresh_token") or tokens.refresh_token
            tokens.remember(resource, payload["access_token"], int(payload.get("expires_in", 3600)))
            _save_cache(tokens)
            return payload["access_token"], tokens
        except ApiError:
            # An expired or revoked refresh token is an ordinary outcome, not a failure.
            tokens.refresh_token = None

    started = _post_form(f"{authority}/devicecode", {"client_id": client_id, "scope": scope})
    log("")
    log("  Sign in to Microsoft Entra ID")
    log(f"    1. Open  {started['verification_uri']}")
    log(f"    2. Enter code  {started['user_code']}")
    log("    3. Sign in with the account that owns the Fabric workspace")
    log("")
    log("  Waiting for sign-in ...")

    interval = int(started.get("interval", 5))
    deadline = time.time() + int(started.get("expires_in", 900))
    while time.time() < deadline:
        time.sleep(interval)
        try:
            payload = _post_form(
                f"{authority}/token",
                {
                    "client_id": client_id,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": started["device_code"],
                },
            )
        except ApiError as error:
            code = ""
            if isinstance(error.body, dict):
                code = str(error.body.get("error", ""))
            if code == "authorization_pending":
                continue
            if code == "slow_down":
                interval += 5
                continue
            raise
        tokens.refresh_token = payload.get("refresh_token")
        tokens.remember(resource, payload["access_token"], int(payload.get("expires_in", 3600)))
        _save_cache(tokens)
        log("  Signed in.")
        return payload["access_token"], tokens

    raise RuntimeError("Device-code sign-in timed out. Run the command again.")


# ---------------------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------------------


class FabricClient:
    """Thin authenticated HTTP client for the Fabric and Power BI REST APIs."""

    def __init__(
        self,
        *,
        tenant_id: str = "organizations",
        client_id: str = DEFAULT_CLIENT_ID,
        timeout: int = 180,
    ) -> None:
        """Build a client bound to one tenant and one public client application."""
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.timeout = timeout
        self._tokens = _load_cache()

    def token(self, resource: str) -> str:
        """Return a valid access token for *resource*."""
        token, self._tokens = acquire_token(
            resource, tenant_id=self.tenant_id, client_id=self.client_id, tokens=self._tokens
        )
        return token

    def request(
        self,
        method: str,
        url: str,
        *,
        resource: str = FABRIC_RESOURCE,
        body: Any = None,
        expected: tuple[int, ...] = (200, 201, 202),
    ) -> tuple[int, dict[str, str], Any]:
        """Perform one authenticated request, retrying on 429 and 5xx.

        Returns ``(status, headers, parsed_body)``. Rate limiting is honoured by reading
        ``Retry-After`` rather than by guessing, because guessing is how a script gets an
        identity throttled harder.
        """
        data = None if body is None else json.dumps(body).encode("utf-8")
        attempt = 0
        while True:
            attempt += 1
            request = urllib.request.Request(url, data=data, method=method)
            request.add_header("Authorization", f"Bearer {self.token(resource)}")
            request.add_header("Accept", "application/json")
            if data is not None:
                request.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = response.read()
                    headers = {k.lower(): v for k, v in response.headers.items()}
                    parsed = json.loads(payload.decode("utf-8")) if payload.strip() else None
                    if response.status not in expected:
                        raise ApiError(response.status, url, parsed, headers.get("requestid"))
                    return response.status, headers, parsed
            except urllib.error.HTTPError as error:
                headers = {k.lower(): v for k, v in error.headers.items()}
                raw = error.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(raw) if raw.strip() else None
                except json.JSONDecodeError:
                    parsed = {"message": raw[:ERROR_BODY_CHARACTERS]}

                retryable = error.code == HTTP_TOO_MANY_REQUESTS or (
                    HTTP_SERVER_ERROR_FLOOR <= error.code < HTTP_SERVER_ERROR_CEILING
                )
                if retryable and attempt <= MAX_HTTP_ATTEMPTS:
                    wait = int(headers.get("retry-after", min(2**attempt, 60)))
                    log(
                        f"  HTTP {error.code}; retrying in {wait}s "
                        f"(attempt {attempt} of {MAX_HTTP_ATTEMPTS})"
                    )
                    time.sleep(wait)
                    continue
                raise ApiError(
                    error.code,
                    url,
                    parsed,
                    headers.get("requestid") or headers.get("x-ms-request-id"),
                ) from error
            except urllib.error.URLError as error:
                if attempt <= MAX_NETWORK_ATTEMPTS:
                    log(f"  network error ({error.reason}); retrying in {2**attempt}s")
                    time.sleep(2**attempt)
                    continue
                raise

    def poll_operation(self, headers: dict[str, str], *, what: str) -> Any:
        """Follow a Fabric long-running operation to completion and return its result.

        A 202 carries a ``Location`` and a ``Retry-After``. The operation is polled until
        it leaves ``Running``/``NotStarted``; a ``Failed`` operation raises with the
        engine's own error, which for a deploy is usually the most informative message
        this whole toolchain produces.
        """
        location = headers.get("location")
        operation_id = headers.get("x-ms-operation-id")
        if not location and operation_id:
            location = f"{FABRIC_API}/operations/{operation_id}"
        if not location:
            raise RuntimeError(f"{what}: the service accepted the request but returned no Location")

        wait = int(headers.get("retry-after", 5))
        deadline = time.time() + LRO_DEADLINE
        while time.time() < deadline:
            time.sleep(wait)
            _, _, state = self.request("GET", location, expected=(200, 202))
            status = (state or {}).get("status", "Unknown")
            if status in {"NotStarted", "Running", "Undefined"}:
                wait = min(max(wait, LRO_MIN_INTERVAL), LRO_MAX_INTERVAL)
                continue
            if status == "Succeeded":
                result_url = location.rstrip("/") + "/result"
                try:
                    _, _, result = self.request("GET", result_url, expected=(200,))
                    return result
                except ApiError as error:
                    # Not every operation exposes a result document; a create does not.
                    if error.status in (404, 400):
                        return None
                    raise
            raise RuntimeError(
                f"{what}: the operation finished as {status}.\n"
                f"  {json.dumps(redact((state or {}).get('error') or state))[:800]}"
            )
        raise RuntimeError(f"{what}: the operation did not finish within 30 minutes")


# ---------------------------------------------------------------------------------------
# The committed semantic model definition
# ---------------------------------------------------------------------------------------


def semantic_model_dir() -> Path:
    """Return the committed semantic model folder."""
    return SEMANTIC_MODEL_DIR


def definition_part_files() -> list[Path]:
    """Return every file that forms the deployable semantic model definition.

    That is ``.platform``, ``definition.pbism`` and everything under ``definition/``.
    Machine-specific state under ``.pbi/`` is excluded — it is gitignored, it is not part
    of the model, and uploading it would put one person's local settings into a shared
    workspace.
    """
    files: list[Path] = []
    for name in (".platform", "definition.pbism"):
        candidate = SEMANTIC_MODEL_DIR / name
        if candidate.is_file():
            files.append(candidate)
    definition = SEMANTIC_MODEL_DIR / "definition"
    if definition.is_dir():
        files.extend(sorted(p for p in definition.rglob("*") if p.is_file()))
    return files


def definition_parts() -> list[dict[str, str]]:
    """Return the committed definition as Fabric ``InlineBase64`` definition parts.

    Paths are POSIX and relative to the semantic model folder, which is the shape the
    item-definition API expects and the same shape ``getDefinition`` returns.
    """
    parts: list[dict[str, str]] = []
    for path in definition_part_files():
        relative = path.relative_to(SEMANTIC_MODEL_DIR).as_posix()
        payload = base64.b64encode(path.read_bytes()).decode("ascii")
        parts.append({"path": relative, "payload": payload, "payloadType": "InlineBase64"})
    return parts


# ---------------------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------------------


def resolve_setting(
    explicit: str | None,
    *env_names: str,
    required: bool = False,
    what: str = "setting",
) -> str | None:
    """Return *explicit* if given, else the first non-empty environment variable.

    Command argument beats environment, and neither is ever a file in the repository.
    """
    if explicit:
        return explicit
    for name in env_names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    if required:
        names = ", ".join(env_names)
        raise SystemExit(
            f"error: {what} is required. Pass it as an argument or set one of: {names}"
        )
    return None


def add_common_arguments(parser: Any) -> None:
    """Add the connection arguments every Fabric script shares."""
    parser.add_argument(
        "--workspace-id",
        default=None,
        help="Fabric workspace GUID. Environment: ARPI_FABRIC_WORKSPACE_ID.",
    )
    parser.add_argument(
        "--tenant-id",
        default=None,
        help=(
            "Entra ID tenant GUID or domain. Environment: ARPI_FABRIC_TENANT_ID. "
            "Omit for the 'organizations' endpoint, which is right for most accounts."
        ),
    )
    parser.add_argument(
        "--client-id",
        default=None,
        help=(
            "Public client application ID used for the device-code sign-in. "
            "Environment: ARPI_FABRIC_CLIENT_ID. Defaults to the Microsoft Azure "
            "PowerShell first-party client. No secret is involved."
        ),
    )


def client_from_args(args: Any) -> FabricClient:
    """Build a :class:`FabricClient` from parsed arguments and the environment."""
    return FabricClient(
        tenant_id=resolve_setting(args.tenant_id, "ARPI_FABRIC_TENANT_ID") or "organizations",
        client_id=resolve_setting(args.client_id, "ARPI_FABRIC_CLIENT_ID") or DEFAULT_CLIENT_ID,
    )


def get_connection(client: FabricClient, connection_id: str) -> dict[str, Any]:
    """Return the Fabric connection object for *connection_id*.

    ``bindConnection`` REQUIRES ``connectionBinding.connectionDetails`` -- the OpenAPI
    specification marks it required, and a request without it is rejected. Rather than
    guess the ``type`` and ``path`` strings for a PostgreSQL connection, this reads them
    from the connection the user already created and passes them straight back. Guessing
    would have produced a first-contact failure that looked like a Fabric bug.
    """
    _, _, payload = client.request(
        "GET", f"{FABRIC_API}/connections/{connection_id}", expected=(200,)
    )
    if not isinstance(payload, dict):
        raise RuntimeError(f"connection {connection_id} returned no object")
    return payload


def connection_binding(connection: dict[str, Any]) -> dict[str, Any]:
    """Build the ``connectionBinding`` payload from a retrieved connection.

    ``connectionDetails`` is required; ``id`` and ``connectivityType`` are echoed back
    when the service supplied them.
    """
    details = connection.get("connectionDetails")
    if not isinstance(details, dict) or not details.get("path"):
        raise RuntimeError(
            "the connection has no connectionDetails.path, so it cannot be bound. "
            "Re-create it in the Fabric portal and confirm its test connection succeeds."
        )
    binding: dict[str, Any] = {"connectionDetails": details}
    if connection.get("id"):
        binding["id"] = connection["id"]
    if connection.get("connectivityType"):
        binding["connectivityType"] = connection["connectivityType"]
    return binding


def fail(message: str) -> None:
    """Print an operator-facing error to stderr and exit non-zero."""
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)
