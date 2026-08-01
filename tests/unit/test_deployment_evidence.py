"""The deployment evidence records identifiers, keeps three deployments apart, and guesses nothing.

Three properties are worth a build failure:

  1. **No credential may ever reach this file.** It is edited by hand, and a `DATABASE_URL`
     pasted in "just to make the check pass" is exactly the mistake to fail on.
  2. **UNVERIFIED is not false.** A fact this repository could not obtain must read as
     unobtained, never as a pass and never as a denial.
  3. **A live website is not a running warehouse.** The reader is one careless sentence
     away from that conclusion, so the two are separate records with separate evidence.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from deployment_evidence import (  # noqa: E402  (path set above)
    EVIDENCE_PATH,
    FORBIDDEN_KEY_FRAGMENTS,
    NOT_RUNNING,
    UNVERIFIED,
    find_secret_fields,
    read_deployment_evidence,
)

#: Every field the deployment evidence model is required to carry per environment.
REQUIRED_ENVIRONMENT_FIELDS = (
    "environment",
    "service_name",
    "public_url",
    "commit_sha",
    "deployed_at",
    "health_verified_at",
    "remote_smoke_test",
    "security_headers",
    "connects_to_database",
)


@pytest.fixture(scope="module")
def document() -> dict[str, Any]:
    loaded = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


# --------------------------------------------------------------------------------------
# The file on disk
# --------------------------------------------------------------------------------------


def test_the_evidence_file_exists_and_parses(document: dict[str, Any]) -> None:
    assert document["schema"] == "arpi.deployment_evidence/1"


def test_every_environment_carries_the_full_contract(document: dict[str, Any]) -> None:
    """A partially filled record invites a reader to assume the missing fields."""
    environments = document["portfolio"]["environments"]
    assert environments, "no portfolio environment is recorded"
    for entry in environments:
        missing = [field for field in REQUIRED_ENVIRONMENT_FIELDS if field not in entry]
        assert missing == [], f"{entry.get('environment')} omits {missing}"


def test_the_staging_deployment_is_recorded() -> None:
    record = read_deployment_evidence()
    staging = record.environment("staging")
    assert staging is not None
    assert staging.is_recorded, (
        "a deployment needs both a public URL and the service that answers it"
    )
    assert staging.public_url is not None and staging.public_url.startswith("https://")


def test_no_production_environment_is_claimed(document: dict[str, Any]) -> None:
    """Recording one would be a claim, and no production deployment has been approved."""
    assert document["portfolio"]["production_environment"] == "not-created"
    assert read_deployment_evidence().environment("production") is None


# --------------------------------------------------------------------------------------
# UNVERIFIED is a first-class value
# --------------------------------------------------------------------------------------


def test_live_fields_are_unverified_rather_than_guessed() -> None:
    """Neither CI nor the environments this project is built in may reach the host.

    Filling these in from belief would convert a recorded gap into a fabricated
    observation, which is the worse of the two failures by a wide margin.
    """
    staging = read_deployment_evidence().environment("staging")
    assert staging is not None
    assert staging.health_verified_at == UNVERIFIED
    assert staging.remote_smoke_test == UNVERIFIED
    assert staging.security_headers == UNVERIFIED


def test_a_recorded_deployment_is_not_a_verified_one() -> None:
    record = read_deployment_evidence()
    assert record.portfolio_is_recorded is True
    assert record.portfolio_is_live_verified is False


def test_unverified_does_not_count_as_running() -> None:
    """The point of the distinction: an unobtained fact never satisfies a condition."""
    assert UNVERIFIED in NOT_RUNNING


def test_a_missing_file_records_nothing_rather_than_raising(tmp_path: Path) -> None:
    record = read_deployment_evidence(tmp_path / "absent.json")
    assert record.exists is False
    assert record.portfolio_is_recorded is False


def test_malformed_json_records_nothing_rather_than_raising(tmp_path: Path) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")
    assert read_deployment_evidence(broken).portfolio_is_recorded is False


# --------------------------------------------------------------------------------------
# The website / warehouse boundary
# --------------------------------------------------------------------------------------


def test_the_analytical_platform_is_not_running() -> None:
    assert read_deployment_evidence().analytical.is_running is False


def test_a_deployed_website_does_not_make_the_platform_run() -> None:
    """Stated as a test because it is the inference this whole file exists to block."""
    record = read_deployment_evidence()
    assert record.portfolio_is_recorded and not record.analytical.is_running


def test_the_website_asserts_no_database_connection() -> None:
    assert read_deployment_evidence().portfolio_connects_to_database is False


def test_an_unasserted_database_connection_is_treated_as_present(tmp_path: Path) -> None:
    """Fail closed. Silence must never be readable as a guarantee.

    Only an explicit `false` clears the connection, so an environment added without the
    field fails the register rather than inheriting the boundary for free.
    """
    path = tmp_path / "evidence.json"
    path.write_text(
        json.dumps(
            {
                "portfolio": {
                    "environments": [
                        {"environment": "x", "service_name": "s", "public_url": "https://x.invalid"}
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    assert read_deployment_evidence(path).portfolio_connects_to_database is True


def test_a_partially_provisioned_platform_is_not_running(tmp_path: Path) -> None:
    """An instance with no schema is not a running analytical platform."""
    path = tmp_path / "evidence.json"
    path.write_text(
        json.dumps(
            {
                "analytical_platform": {
                    "postgresql_instance": "verified",
                    "schema_deployment": "declared",
                    "data_load": "declared",
                }
            }
        ),
        encoding="utf-8",
    )
    assert read_deployment_evidence(path).analytical.is_running is False


# --------------------------------------------------------------------------------------
# No secret may reach this file
# --------------------------------------------------------------------------------------


def test_the_committed_evidence_holds_no_secret_field() -> None:
    findings = find_secret_fields()
    assert findings == [], "\n".join(findings)


@pytest.mark.parametrize("fragment", FORBIDDEN_KEY_FRAGMENTS)
def test_a_credential_bearing_key_is_caught(fragment: str, tmp_path: Path) -> None:
    path = tmp_path / "evidence.json"
    path.write_text(json.dumps({"portfolio": {fragment: "anything"}}), encoding="utf-8")
    findings = find_secret_fields(path)
    assert findings, f"a key named {fragment!r} must be rejected"


def test_a_connection_string_in_a_value_is_caught(tmp_path: Path) -> None:
    """The key name is innocent; the value is not."""
    path = tmp_path / "evidence.json"
    path.write_text(
        json.dumps({"portfolio": {"note": "postgresql://user@host:5432/db"}}), encoding="utf-8"
    )
    assert find_secret_fields(path), "a connection string must be rejected whatever it is called"


def test_a_private_host_is_caught(tmp_path: Path) -> None:
    path = tmp_path / "evidence.json"
    path.write_text(
        json.dumps({"portfolio": {"host": "postgres.railway.internal"}}), encoding="utf-8"
    )
    assert find_secret_fields(path)


def test_a_public_url_and_a_service_name_are_not_secrets(tmp_path: Path) -> None:
    """Identifiers must pass, or the check would forbid the file's whole purpose."""
    path = tmp_path / "evidence.json"
    path.write_text(
        json.dumps(
            {
                "portfolio": {
                    "environments": [
                        {
                            "environment": "staging",
                            "service_name": "arpi-portfolio",
                            "public_url": "https://example.invalid",
                            "commit_sha": "b6032da",
                        }
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    assert find_secret_fields(path) == []
