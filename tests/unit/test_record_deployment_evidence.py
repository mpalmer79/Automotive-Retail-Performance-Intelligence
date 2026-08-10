"""The evidence recorder writes what a run observed, and nothing else.

The failure this guards against is not a crash. It is a recorder that, given a
mostly-green run, rounds up: marks a check verified because its neighbours passed,
keeps a stale timestamp when the probe failed, or falls back to the local commit
when the deployment did not report one. Each of those turns an honest `UNVERIFIED`
into a fabricated observation, which is worse than the gap it replaces.
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

from record_deployment_evidence import (  # noqa: E402  (path set above)
    _COMMIT_IN_FOOTER,
    REQUIRED_CHECKS,
    UNVERIFIED,
    check_results,
    read_playwright_report,
    same_commit,
)


def _report(*specs: tuple[str, str], group: str = "deployed") -> dict[str, Any]:
    """A Playwright JSON report carrying the given (title, status) pairs."""
    return {
        "suites": [
            {
                "title": group,
                "specs": [
                    {"title": title, "tests": [{"status": status}]} for title, status in specs
                ],
                "suites": [],
            }
        ]
    }


def _write(tmp_path: Path, document: dict[str, Any]) -> Path:
    path = tmp_path / "remote-report.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


# --------------------------------------------------------------------------------------
# Reading the report
# --------------------------------------------------------------------------------------


def test_outcomes_are_counted_by_kind(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        _report(
            ("a", "expected"),
            ("b", "unexpected"),
            ("c", "skipped"),
            ("d", "flaky"),
        ),
    )
    summary = read_playwright_report(path)
    assert (summary["passed"], summary["failed"], summary["skipped"], summary["flaky"]) == (
        1,
        1,
        1,
        1,
    )


def test_a_skipped_test_is_not_a_passing_one(tmp_path: Path) -> None:
    """The suite skips itself when no base URL is set. That must never read as proof."""
    path = _write(
        tmp_path, _report(("the response headers survive the platform router", "skipped"))
    )
    assert check_results(read_playwright_report(path))["security_headers"] == UNVERIFIED


def test_a_failing_test_is_not_a_passing_one(tmp_path: Path) -> None:
    path = _write(tmp_path, _report(("no console error on any route", "unexpected")))
    assert check_results(read_playwright_report(path))["no_console_error"] == UNVERIFIED


def test_a_flaky_test_counts_as_passing_and_is_reported_as_flaky(tmp_path: Path) -> None:
    """It passed on retry, so the assertion held; the flake stays visible beside it."""
    path = _write(tmp_path, _report(("mobile navigation opens, links, and closes", "flaky")))
    summary = read_playwright_report(path)
    assert summary["flaky"] == 1
    assert check_results(summary)["mobile_navigation"].startswith("passed")


def test_nested_suites_are_searched(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        {
            "suites": [
                {
                    "title": "outer",
                    "specs": [],
                    "suites": [
                        {
                            "title": "security",
                            "specs": [
                                {
                                    "title": "the response headers survive the platform router",
                                    "tests": [{"status": "expected"}],
                                }
                            ],
                            "suites": [],
                        }
                    ],
                }
            ]
        },
    )
    assert check_results(read_playwright_report(path))["security_headers"].startswith("passed")


def test_a_missing_report_verifies_nothing(tmp_path: Path) -> None:
    """No report is not a silent pass."""
    summary = read_playwright_report(tmp_path / "absent.json")
    assert summary["passed"] == 0
    assert set(check_results(summary).values()) == {UNVERIFIED}


def test_an_unreadable_report_verifies_nothing(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text("{ not json", encoding="utf-8")
    assert set(check_results(read_playwright_report(path)).values()) == {UNVERIFIED}


# --------------------------------------------------------------------------------------
# Each check stands on its own test
# --------------------------------------------------------------------------------------


def test_a_check_does_not_inherit_its_neighbours_verdict(tmp_path: Path) -> None:
    """The rounding-up failure, stated directly.

    Eleven of twelve checks passing must leave the twelfth UNVERIFIED. An overall
    green run is not evidence that a particular assertion ran.
    """
    passing = [
        (needles[0], "expected")
        for name, needles in REQUIRED_CHECKS.items()
        if name != "security_headers"
    ]
    resolved = check_results(read_playwright_report(_write(tmp_path, _report(*passing))))
    assert resolved["security_headers"] == UNVERIFIED
    assert all(
        value.startswith("passed") for name, value in resolved.items() if name != "security_headers"
    )


@pytest.mark.parametrize("name", sorted(REQUIRED_CHECKS))
def test_every_required_check_resolves_from_a_real_test_title(name: str, tmp_path: Path) -> None:
    """Each binding must match something the suite can actually emit.

    A needle that matches no title would leave its check permanently UNVERIFIED and
    look like a deployment problem rather than a typo in this file.
    """
    needle = REQUIRED_CHECKS[name][0]
    resolved = check_results(
        read_playwright_report(_write(tmp_path, _report((needle, "expected"))))
    )
    assert resolved[name].startswith("passed")


def test_the_bindings_match_the_committed_remote_suite() -> None:
    """The stronger version: the titles exist in the suite as written.

    This is what stops a rename of a test from silently retiring a check.
    """
    suite = (REPO_ROOT / "portfolio" / "tests" / "remote" / "deployed-site.spec.ts").read_text(
        encoding="utf-8"
    )
    missing = [
        name
        for name, needles in REQUIRED_CHECKS.items()
        if not any(needle in suite for needle in needles)
    ]
    assert missing == [], (
        f"no test in the remote suite matches {missing}. Either the test was renamed or "
        "the binding is wrong; a check that can never resolve is worse than no check."
    )


# --------------------------------------------------------------------------------------
# The deployed commit is read off the deployment
# --------------------------------------------------------------------------------------


def test_the_commit_is_extracted_from_the_served_footer() -> None:
    html = (
        '<a href="https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence'
        '/commit/b90e3244a9b0db2f9ee1ccfc9f6d85e93959e806">b90e3244</a>'
    )
    match = _COMMIT_IN_FOOTER.search(html)
    assert match is not None
    assert match.group(1) == "b90e3244a9b0db2f9ee1ccfc9f6d85e93959e806"


def test_markup_without_a_commit_link_yields_no_match() -> None:
    """Which is what keeps the recorder from falling back to the local checkout.

    The local commit is what this tree is at, not what the deployment is running.
    """
    assert _COMMIT_IN_FOOTER.search("<a href='https://github.com/owner/repo'>repo</a>") is None


# --------------------------------------------------------------------------------------
# The workflow that runs it
# --------------------------------------------------------------------------------------


# --------------------------------------------------------------------------------------
# The run has to be about the artefact the deployment is serving
# --------------------------------------------------------------------------------------

FULL = "b90e3244a9b0db2f9ee1ccfc9f6d85e93959e806"


def test_a_full_hash_matches_itself() -> None:
    assert same_commit(FULL, FULL) is True


def test_an_abbreviation_is_the_commit_it_abbreviates() -> None:
    """The footer may carry a short SHA. That is the same commit, not another one."""
    assert same_commit(FULL[:8], FULL) is True
    assert same_commit(FULL, FULL[:8]) is True


def test_a_different_commit_does_not_match() -> None:
    assert same_commit("f5a1eac61ef1e358473151bd32ad4418e818c22c", FULL) is False


def test_not_knowing_is_not_a_match() -> None:
    """UNVERIFIED and an absent value both answer no.

    A missing comparison must never resolve to "same commit", because that is the
    answer that lets a run be recorded as evidence about a tree it never touched.
    """
    assert same_commit(UNVERIFIED, FULL) is False
    assert same_commit(FULL, UNVERIFIED) is False
    assert same_commit("", FULL) is False
    assert same_commit(FULL, "") is False


def test_an_abbreviation_too_short_to_identify_a_commit_does_not_match() -> None:
    """Six characters is not an identity; unrelated commits collide there."""
    assert same_commit(FULL[:6], FULL) is False


def test_the_comparison_is_case_insensitive_and_ignores_surrounding_space() -> None:
    assert same_commit(f"  {FULL.upper()}  ", FULL) is True


def test_the_workflow_names_the_commit_the_suite_was_read_from() -> None:
    """Without it the recorder compares nothing and a pull request cannot pass.

    The deployment serves whatever was last deployed, so on a pull request it is
    never this branch. A branch that changes the routes the remote suite targets
    would otherwise have the deployed build's behaviour recorded as its own failure.
    """
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify-deployment.yml").read_text(
        encoding="utf-8"
    )
    assert "--expect-commit" in workflow
    assert "github.event.pull_request.head.sha" in workflow


def test_the_verification_workflow_uses_no_secret() -> None:
    """It reads a public website. A credential here would be unexplainable."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify-deployment.yml").read_text(
        encoding="utf-8"
    )
    assert "secrets." not in workflow
    assert "RAILWAY_API_TOKEN" not in workflow


def test_the_verification_workflow_can_be_run_by_hand() -> None:
    workflow = (REPO_ROOT / ".github" / "workflows" / "verify-deployment.yml").read_text(
        encoding="utf-8"
    )
    assert "workflow_dispatch:" in workflow


def test_the_offline_workflows_never_reach_the_deployment() -> None:
    """CI has no reason to be online, and this change must not have made it so."""
    for name in ("ci.yml", "frontend.yml"):
        workflow = (REPO_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
        assert "ARPI_REMOTE_BASE_URL" not in workflow, (
            f"{name} would reach the live deployment. The remote suite belongs to "
            "verify-deployment.yml, so an ordinary build cannot depend on a platform "
            "nobody in this repository controls."
        )
