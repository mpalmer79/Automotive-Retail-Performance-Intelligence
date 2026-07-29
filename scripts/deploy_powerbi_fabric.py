"""Deploy the committed ARPI TMDL semantic model to a Microsoft Fabric workspace.

WHAT THIS PROVES, AND WHAT IT DOES NOT
--------------------------------------
This script asks a real Microsoft semantic-model engine to accept the TMDL that
``scripts/check_powerbi_model.py`` has only ever parsed as text. That is the first of the
proof obligations ADR-0008 places on a real-engine validation, and it is not a formality:
static parsing cannot tell you that a ``formatString`` is well-formed, that a DAX
expression compiles, that a ``sortByColumn`` is single-valued per label, or that a
relationship the engine considers ambiguous will be rejected. A deploy failure here is a
genuine defect in the model, and it should be read as one rather than worked around.

It does **not** prove the model refreshes or that its numbers are right. That is
``scripts/validate_powerbi_fabric.py``.

WHAT IT DEPLOYS
---------------
Exactly the committed definition: ``.platform``, ``definition.pbism`` and everything under
``definition/``. Nothing is generated, rewritten or "fixed up" on the way, because a
deploy that silently repaired the source would validate something the repository does not
contain.

The report folder is **not** deployed. ARPI has no report pages and `P2.2` has not started.

ROUND TRIP
----------
After a successful deploy the definition is read back with ``getDefinition?format=TMDL``
and compared, file by file, with what was sent. Fabric normalises some things — it may
reorder parts, rewrite ``.platform`` with a service-assigned ``logicalId``, or add
metadata of its own — and those differences are documented and normalised away. Anything
else is reported as an unexplained semantic difference and fails the deploy, because a
service that quietly rewrote a measure would otherwise go unnoticed until a number was
wrong.

USAGE
-----
Create a new semantic model::

    python scripts/deploy_powerbi_fabric.py --workspace-id <guid>

Update the one you already created::

    python scripts/deploy_powerbi_fabric.py --workspace-id <guid> --item-id <guid>

See what would be sent, without signing in or calling anything::

    python scripts/deploy_powerbi_fabric.py --dry-run

Every setting can come from the environment instead: ``ARPI_FABRIC_WORKSPACE_ID``,
``ARPI_FABRIC_ITEM_ID``, ``ARPI_FABRIC_DISPLAY_NAME``, ``ARPI_FABRIC_TENANT_ID``,
``ARPI_FABRIC_CLIENT_ID``. No credential is ever an argument, an environment variable or a
file in this repository: sign-in is an interactive device code.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from arpi_fabric import (
    FABRIC_API,
    ApiError,
    add_common_arguments,
    client_from_args,
    definition_parts,
    log,
    resolve_setting,
    semantic_model_dir,
)

DEFAULT_DISPLAY_NAME = "ARPI_Performance_Intelligence"

#: HTTP statuses this script branches on.
HTTP_CREATED = 201
HTTP_ACCEPTED = 202

#: Definition parts whose content Fabric owns and is expected to rewrite. `.platform`
#: carries a service-assigned `logicalId` and the item's display name, neither of which the
#: repository controls once the item exists. Everything else must round-trip byte for byte.
SERVICE_OWNED_PARTS: frozenset[str] = frozenset({".platform"})

#: Keys inside `.platform` that the service legitimately sets. A difference confined to
#: these is normalised; a difference anywhere else in the file is reported.
SERVICE_OWNED_PLATFORM_KEYS: frozenset[str] = frozenset({"logicalId", "displayName", "description"})


def decode_part(part: dict[str, Any]) -> bytes:
    """Return the bytes of one definition part."""
    return base64.b64decode(part["payload"])


def normalise_platform(raw: bytes) -> dict[str, Any]:
    """Return `.platform` with the service-owned keys removed, for comparison."""
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"__unparseable__": True}
    config = parsed.get("config")
    if isinstance(config, dict):
        parsed["config"] = {k: v for k, v in config.items() if k not in SERVICE_OWNED_PLATFORM_KEYS}
    metadata = parsed.get("metadata")
    if isinstance(metadata, dict):
        parsed["metadata"] = {
            k: v for k, v in metadata.items() if k not in SERVICE_OWNED_PLATFORM_KEYS
        }
    return parsed


def compare_definitions(
    sent: list[dict[str, Any]], returned: list[dict[str, Any]]
) -> tuple[list[str], list[str]]:
    """Compare the sent and retrieved definitions.

    Returns ``(differences, normalised)``: differences fail the deploy, normalised ones are
    documented service behaviour and are reported for transparency only.
    """
    differences: list[str] = []
    normalised: list[str] = []

    sent_by_path = {p["path"]: decode_part(p) for p in sent}
    returned_by_path = {p["path"]: decode_part(p) for p in returned}

    for path in sorted(set(sent_by_path) - set(returned_by_path)):
        differences.append(f"{path}: sent, but the service did not return it")
    for path in sorted(set(returned_by_path) - set(sent_by_path)):
        # The service adds files of its own for some item types. Report, do not fail:
        # an extra service file is not the repository claiming something untrue.
        normalised.append(f"{path}: returned by the service but not present in the repository")

    for path in sorted(set(sent_by_path) & set(returned_by_path)):
        ours, theirs = sent_by_path[path], returned_by_path[path]
        if ours == theirs:
            continue
        if path in SERVICE_OWNED_PARTS:
            if normalise_platform(ours) == normalise_platform(theirs):
                normalised.append(f"{path}: differs only in service-assigned metadata")
            else:
                differences.append(f"{path}: differs beyond the service-assigned metadata")
            continue
        # Line-ending normalisation is documented Power BI behaviour: Desktop writes CRLF.
        if ours.replace(b"\r\n", b"\n") == theirs.replace(b"\r\n", b"\n"):
            normalised.append(f"{path}: differs only in line endings")
            continue
        differences.append(
            f"{path}: content changed ({len(ours)} bytes sent, {len(theirs)} returned)"
        )
    return differences, normalised


def create_semantic_model(
    client: Any, workspace_id: str, display_name: str, parts: list[dict[str, Any]]
) -> str:
    """Create a new semantic model and return its item ID."""
    url = f"{FABRIC_API}/workspaces/{workspace_id}/semanticModels"
    body = {
        "displayName": display_name,
        "description": (
            "ARPI governed semantic model. Import mode over the PostgreSQL reporting "
            "schema only. Deployed from source by scripts/deploy_powerbi_fabric.py."
        ),
        "definition": {"parts": parts},
    }
    status, headers, payload = client.request("POST", url, body=body)
    if status == HTTP_CREATED and isinstance(payload, dict):
        return str(payload["id"])
    result = client.poll_operation(headers, what="create semantic model")
    if isinstance(result, dict) and result.get("id"):
        return str(result["id"])
    # A create that succeeded without returning an item has to be resolved by name.
    _, _, listing = client.request("GET", url, expected=(200,))
    for item in (listing or {}).get("value", []):
        if item.get("displayName") == display_name:
            return str(item["id"])
    raise RuntimeError(
        "The semantic model was created but its ID could not be determined. "
        "Find it in the Fabric portal and pass --item-id next time."
    )


def update_semantic_model(
    client: Any, workspace_id: str, item_id: str, parts: list[dict[str, Any]]
) -> None:
    """Replace the definition of an existing semantic model."""
    url = (
        f"{FABRIC_API}/workspaces/{workspace_id}/semanticModels/{item_id}"
        "/updateDefinition?updateMetadata=True"
    )
    status, headers, _ = client.request(
        "POST", url, body={"definition": {"parts": parts}}, expected=(200, 202)
    )
    if status == HTTP_ACCEPTED:
        client.poll_operation(headers, what="update semantic model definition")


def get_definition(client: Any, workspace_id: str, item_id: str) -> list[dict[str, Any]]:
    """Retrieve the deployed definition in TMDL format."""
    url = (
        f"{FABRIC_API}/workspaces/{workspace_id}/semanticModels/{item_id}/getDefinition?format=TMDL"
    )
    status, headers, payload = client.request("POST", url, expected=(200, 202))
    if status == HTTP_ACCEPTED:
        payload = client.poll_operation(headers, what="get semantic model definition")
    parts = ((payload or {}).get("definition") or {}).get("parts")
    if not isinstance(parts, list):
        raise RuntimeError("The service returned no definition parts to compare against.")
    return parts


def report_source(parts: list[dict[str, Any]]) -> None:
    """Print what is about to be sent, before any network call happens."""
    source = semantic_model_dir()
    shown = source.relative_to(Path.cwd()) if source.is_relative_to(Path.cwd()) else source
    total = sum(len(base64.b64decode(part["payload"])) for part in parts)
    log("ARPI semantic model -> Microsoft Fabric")
    log(f"  source     : {shown}")
    log(f"  parts      : {len(parts)}")
    log(f"  total size : {total:,} bytes")


def report_dry_run(parts: list[dict[str, Any]]) -> None:
    """List every definition part without signing in or deploying anything."""
    log("")
    log("  Dry run. These parts would be sent:")
    for part in parts:
        size = len(base64.b64decode(part["payload"]))
        log(f"    {size:>8,} B  {part['path']}")
    log("")
    log("  No sign-in was performed and nothing was deployed.")


def report_success(workspace_id: str, item_id: str, returned_count: int) -> None:
    """Print the verified-deploy summary and the command that comes next."""
    log(f"    {returned_count} parts returned; every one matches the repository.")
    log("")
    log("  Deploy verified.")
    log("")
    log("  Next: bind a PostgreSQL connection and refresh, then run")
    log(f"    python scripts/validate_powerbi_fabric.py --workspace-id {workspace_id} \\")
    log(f"      --item-id {item_id}")
    log("  The procedure is docs/powerbi/FABRIC_SERVICE_HANDOFF.md.")


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser for this script."""
    parser = argparse.ArgumentParser(
        description=(
            "Deploy the committed ARPI TMDL semantic model to a Microsoft Fabric "
            "workspace, then read it back and prove the service stored what was sent."
        )
    )
    add_common_arguments(parser)
    parser.add_argument(
        "--item-id",
        default=None,
        help=(
            "Existing semantic model GUID to update. Omit to create a new one. "
            "Environment: ARPI_FABRIC_ITEM_ID."
        ),
    )
    parser.add_argument(
        "--display-name",
        default=None,
        help=(
            f"Display name for a newly created semantic model. Default "
            f"{DEFAULT_DISPLAY_NAME!r}. Environment: ARPI_FABRIC_DISPLAY_NAME."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List the definition parts that would be sent and exit. No sign-in, no calls.",
    )
    parser.add_argument(
        "--skip-round-trip",
        action="store_true",
        help=(
            "Skip reading the definition back. Not recommended: the round trip is what "
            "proves the service stored what the repository contains."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Deploy the semantic model and verify the service stored it faithfully."""
    args = build_parser().parse_args(argv)

    parts = definition_parts()
    if not parts:
        print(
            f"error: no semantic model definition found under {semantic_model_dir()}",
            file=sys.stderr,
        )
        return 2

    report_source(parts)

    if args.dry_run:
        report_dry_run(parts)
        return 0

    workspace_id = resolve_setting(
        args.workspace_id,
        "ARPI_FABRIC_WORKSPACE_ID",
        required=True,
        what="the Fabric workspace ID",
    )
    item_id = resolve_setting(args.item_id, "ARPI_FABRIC_ITEM_ID")
    display_name = (
        resolve_setting(args.display_name, "ARPI_FABRIC_DISPLAY_NAME") or DEFAULT_DISPLAY_NAME
    )

    client = client_from_args(args)
    log(f"  workspace  : {workspace_id}")

    try:
        return deploy(client, args, workspace_id, item_id, display_name, parts)
    except ApiError as error:
        print(f"\n{error}", file=sys.stderr)
        return 1
    except (RuntimeError, OSError) as error:
        print(f"\nerror: {error}", file=sys.stderr)
        return 1


def deploy(
    client: Any,
    args: argparse.Namespace,
    workspace_id: str,
    item_id: str | None,
    display_name: str,
    parts: list[dict[str, Any]],
) -> int:
    """Create or update the model, then prove the service stored what was sent."""
    if item_id:
        log(f"  action     : update {item_id}")
        update_semantic_model(client, workspace_id, item_id, parts)
    else:
        log(f"  action     : create {display_name!r}")
        item_id = create_semantic_model(client, workspace_id, display_name, parts)
    log("")
    log("  The engine ACCEPTED the TMDL definition.")
    log(f"  semantic model item ID: {item_id}")

    if args.skip_round_trip:
        log("")
        log("  Round trip skipped at your request; the deploy is unverified.")
        return 0

    log("")
    log("  Reading the definition back to prove it was stored faithfully ...")
    returned = get_definition(client, workspace_id, item_id)
    differences, normalised = compare_definitions(parts, returned)

    for note in normalised:
        log(f"    normalised: {note}")
    if differences:
        log("")
        log("  UNEXPLAINED DIFFERENCES between what was sent and what was stored:")
        for difference in differences:
            log(f"    {difference}")
        log("")
        log("  This is not a formatting quirk to wave through. Something rewrote the")
        log("  model. Investigate before treating any later validation as evidence.")
        return 1

    report_success(workspace_id, item_id, len(returned))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
