#!/usr/bin/env python3
"""Read the non-secret deployment evidence, and keep three deployments apart.

WHY THIS EXISTS
---------------
"ARPI is deployed" is not one claim. It is three, and they are independent:

    portfolio            a Next.js site of prerendered routes, no database connection
    analytical platform  PostgreSQL, the schema, the load, the roles, the migrations
    semantic model       an engine that has loaded, refreshed and evaluated the model

A live portfolio proves the first and nothing about the other two. The website holds no
credential, opens no connection and reads no `reporting` view -- so a green health check
on it is evidence that a static site is being served, not that a warehouse is running.
Collapsing the three is the specific error this module exists to make impossible: the
register can no longer record one deployment status, because there is no such thing.

The semantic-model deployment is deliberately NOT recorded here. Its evidence is
``powerbi/validation/desktop_validation_results.json`` and its Fabric counterpart, read by
``project_capabilities.py``. A second copy here could disagree with the first.

UNVERIFIED IS NOT FALSE
-----------------------
Every field requiring a request to the live site is ``UNVERIFIED``, because neither CI nor
the environments this project is built in may reach it. ``UNVERIFIED`` means *this
repository's automation did not obtain the fact*. It never means the fact is false, and it
is never rendered as a pass.

Standard library only, and no package import: `repository-checks` runs on a bare
interpreter with nothing installed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]

EVIDENCE_PATH = REPO_ROOT / "deployment" / "evidence" / "portfolio_deployment.json"

#: The value a field carries when this repository's automation could not obtain it.
UNVERIFIED = "UNVERIFIED"

#: Keys that would carry a credential if anyone ever added one. The evidence file records
#: identifiers -- a public URL, a service name, an environment, a commit -- and nothing a
#: reader could authenticate with. Checked rather than trusted, because the file is edited
#: by hand and a `DATABASE_URL` pasted in "just to make the check pass" is exactly the
#: mistake worth failing a build over.
FORBIDDEN_KEY_FRAGMENTS: tuple[str, ...] = (
    "token",
    "password",
    "passwd",
    "secret",
    "credential",
    "database_url",
    "connection_string",
    "private_host",
    "api_key",
    "apikey",
    "access_key",
)

#: Substrings that betray a credential in a *value* rather than a key name.
FORBIDDEN_VALUE_FRAGMENTS: tuple[str, ...] = (
    "postgres://",
    "postgresql://",
    "railway.internal",
)

#: Analytical-platform states that mean "nothing has been provisioned". Anything else is a
#: claim that something exists, and a claim needs evidence.
#:
#: ``declared`` is weaker than ``UNVERIFIED``: it means the resource is described in
#: source-controlled configuration and has never been created. ``UNVERIFIED`` means a
#: check exists and did not run. Both are short of running, which is all this set decides.
NOT_RUNNING: frozenset[str] = frozenset({"declared", "not-implemented", "not-started", UNVERIFIED})


@dataclass(frozen=True, slots=True)
class DeployedEnvironment:
    """One environment of one service, as the evidence file records it.

    Attributes:
        environment: Railway environment name, such as ``staging``.
        service_name: The service the deployment belongs to.
        public_url: The reachable URL, or ``None`` when none is recorded.
        health_path: The route the platform probes.
        commit_sha: The commit the running build was produced from, or ``UNVERIFIED``.
        deployed_at: When the deployment completed, or ``UNVERIFIED``.
        health_verified_at: When a health check last succeeded, or ``UNVERIFIED``.
        remote_smoke_test: Result of the remote suite, or ``UNVERIFIED``.
        security_headers: Result of the live header inspection, or ``UNVERIFIED``.
        connects_to_database: Whether this deployment holds a database connection.
        role: ``production`` or ``preview`` -- the deployment's declared role, supplied
            as intent by whoever recorded it. Never derived from the URL.
        indexing_role: What the deployment tells crawlers, as observed.
        canonical_role: Which origin the deployment claims as canonical, as observed.
    """

    environment: str
    service_name: str | None
    public_url: str | None
    health_path: str | None
    commit_sha: str
    deployed_at: str
    health_verified_at: str
    remote_smoke_test: str
    security_headers: str
    connects_to_database: bool
    role: str
    indexing_role: str
    canonical_role: str

    @property
    def is_production(self) -> bool:
        """Whether this environment is the public one.

        Read from the recorded ``role``, never inferred from the URL. A public URL is
        what a preview deployment has too, and ``arpi.up.railway.app`` looked exactly
        like a production origin for the whole time it was staging's.
        """
        return self.role == "production"

    @property
    def is_recorded(self) -> bool:
        """Whether a deployment is claimed at all.

        A URL and the service that answers it are the minimum. Without both there is a
        configuration, not a deployment, and the register must not say otherwise.
        """
        return bool(self.public_url) and bool(self.service_name)

    @property
    def is_live_verified(self) -> bool:
        """Whether this repository's own automation reached the deployment.

        Deliberately stricter than :attr:`is_recorded`. A recorded URL is a statement; a
        health verification timestamp is an observation, and only the second one may ever
        be rendered as proof that the site answers.
        """
        return self.is_recorded and self.health_verified_at != UNVERIFIED


@dataclass(frozen=True, slots=True)
class AnalyticalPlatformEvidence:
    """PostgreSQL and everything the warehouse needs in order to be *running*.

    Every field is independent of the portfolio deployment. The website being live moves
    none of them, which is the point of holding them in a separate record.
    """

    postgresql_instance: str
    schema_deployment: str
    data_load: str
    role_verification: str
    migration_verification: str
    backup_and_restore: str
    scheduled_execution: str
    provisioning_job_last_run: str
    verifier_last_run: str

    @property
    def is_running(self) -> bool:
        """Whether a database has been provisioned, its schema deployed and data loaded.

        All three, not any one: a provisioned instance with no schema is not a running
        analytical platform, and neither is a schema nothing was ever loaded into.
        """
        return not any(
            state in NOT_RUNNING
            for state in (self.postgresql_instance, self.schema_deployment, self.data_load)
        )


@dataclass(frozen=True, slots=True)
class DeploymentEvidence:
    """The whole evidence file, read rather than trusted."""

    exists: bool
    path: str
    environments: tuple[DeployedEnvironment, ...]
    production_environment: str
    analytical: AnalyticalPlatformEvidence

    @property
    def portfolio_is_recorded(self) -> bool:
        """Whether any portfolio environment records a deployment."""
        return any(environment.is_recorded for environment in self.environments)

    @property
    def portfolio_is_live_verified(self) -> bool:
        """Whether any portfolio environment was reached by this repository's automation."""
        return any(environment.is_live_verified for environment in self.environments)

    @property
    def portfolio_connects_to_database(self) -> bool:
        """Whether any portfolio deployment holds a database connection."""
        return any(environment.connects_to_database for environment in self.environments)

    def environment(self, name: str) -> DeployedEnvironment | None:
        """The named environment, or ``None`` when it is not recorded."""
        for candidate in self.environments:
            if candidate.environment == name:
                return candidate
        return None


def _string(source: dict[str, Any], key: str, default: str = UNVERIFIED) -> str:
    value = source.get(key, default)
    return value if isinstance(value, str) else default


def _optional_string(source: dict[str, Any], key: str) -> str | None:
    value = source.get(key)
    return value if isinstance(value, str) and value else None


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _environment(entry: dict[str, Any]) -> DeployedEnvironment:
    return DeployedEnvironment(
        environment=_string(entry, "environment", "unknown"),
        service_name=_optional_string(entry, "service_name"),
        public_url=_optional_string(entry, "public_url"),
        health_path=_optional_string(entry, "health_path"),
        commit_sha=_string(entry, "commit_sha"),
        deployed_at=_string(entry, "deployed_at"),
        health_verified_at=_string(entry, "health_verified_at"),
        remote_smoke_test=_string(entry, "remote_smoke_test"),
        security_headers=_string(entry, "security_headers"),
        # Absent means "not asserted", and an unasserted connection is treated as present
        # so that silence cannot be read as a guarantee. Only an explicit `false` clears it.
        connects_to_database=entry.get("connects_to_database", True) is not False,
        # Absent role reads as `preview`, which is the fail-closed direction: an
        # unlabelled deployment must not be counted as the public one.
        role=_string(entry, "role", "preview"),
        indexing_role=_string(entry, "indexing_role"),
        canonical_role=_string(entry, "canonical_role"),
    )


def read_deployment_evidence(path: Path = EVIDENCE_PATH) -> DeploymentEvidence:
    """Read the evidence file. A missing file records nothing rather than raising."""
    document = _read_json(path)
    portfolio = document.get("portfolio")
    portfolio = portfolio if isinstance(portfolio, dict) else {}
    analytical = document.get("analytical_platform")
    analytical = analytical if isinstance(analytical, dict) else {}

    raw_environments = portfolio.get("environments")
    entries = raw_environments if isinstance(raw_environments, list) else []

    try:
        relative = path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        relative = path.as_posix()

    return DeploymentEvidence(
        exists=path.is_file(),
        path=relative,
        environments=tuple(_environment(entry) for entry in entries if isinstance(entry, dict)),
        production_environment=_string(portfolio, "production_environment", "not-created"),
        analytical=AnalyticalPlatformEvidence(
            postgresql_instance=_string(analytical, "postgresql_instance", "declared"),
            schema_deployment=_string(analytical, "schema_deployment", "declared"),
            data_load=_string(analytical, "data_load", "declared"),
            role_verification=_string(analytical, "role_verification", "declared"),
            migration_verification=_string(analytical, "migration_verification", "declared"),
            backup_and_restore=_string(analytical, "backup_and_restore", "not-implemented"),
            scheduled_execution=_string(analytical, "scheduled_execution", "not-implemented"),
            provisioning_job_last_run=_string(analytical, "provisioning_job_last_run"),
            verifier_last_run=_string(analytical, "verifier_last_run"),
        ),
    )


def find_secret_fields(path: Path = EVIDENCE_PATH) -> list[str]:
    """Names and values in the evidence file that would carry a credential.

    Returns:
        A description of each finding, empty when the file records identifiers only.
    """
    findings: list[str] = []

    def walk(node: Any, trail: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                lowered = key.lower()
                for fragment in FORBIDDEN_KEY_FRAGMENTS:
                    if fragment in lowered:
                        findings.append(f"{trail}{key}: key name contains {fragment!r}")
                        break
                walk(value, f"{trail}{key}.")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{trail}{index}.")
        elif isinstance(node, str):
            lowered = node.lower()
            for fragment in FORBIDDEN_VALUE_FRAGMENTS:
                if fragment in lowered:
                    findings.append(f"{trail.rstrip('.')}: value contains {fragment!r}")
                    break

    walk(_read_json(path), "")
    return findings
