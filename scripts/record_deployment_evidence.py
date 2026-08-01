#!/usr/bin/env python3
"""Write deployment evidence from a run, never from a belief.

WHY THIS EXISTS
---------------
``deployment/evidence/portfolio_deployment.json`` carried ``UNVERIFIED`` in every
field that needs a request to the live site, because neither CI nor the environments
this project is developed in may reach the deployment host. ``UNVERIFIED`` is the
honest value for a fact nobody obtained -- but it is only honest while it is nobody's
job to obtain it, and leaving it forever would make the register a place where gaps
go to be forgotten.

This script closes those fields the only way they may be closed: by running against
the deployment and recording what came back. It is invoked by
``.github/workflows/verify-deployment.yml``, from GitHub-hosted infrastructure,
which can reach the host.

WHAT IT WILL NOT DO
-------------------
* It will not accept a human's assertion that the site is up. Every field it writes
  comes from a response or from the remote suite's own JSON report.
* It will not mark a check verified because the suite passed overall. Each required
  check is bound to the specific test title that proves it, and a check whose test
  did not run stays ``UNVERIFIED`` rather than inheriting the verdict of its
  neighbours.
* It will not write a field it could not obtain. A failed probe leaves ``UNVERIFIED``
  in place, so a partial run degrades to the truth rather than to a half-claim.
* It will not write a secret. The values it records are a URL, a commit SHA, a
  timestamp and a pass count.

Standard library only: this runs on a bare interpreter alongside the repository's
other checks.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_PATH = REPO_ROOT / "deployment" / "evidence" / "portfolio_deployment.json"

UNVERIFIED = "UNVERIFIED"

#: The only response this script treats as an answer. A redirect or a 5xx is not one.
HTTP_OK = 200

#: Each required check, bound to the remote-suite test title that proves it. A check
#: is recorded as passing only when its own test passed: an overall-green run is not
#: evidence that a particular assertion ran, because a skipped test is also not a
#: failure.
REQUIRED_CHECKS: dict[str, tuple[str, ...]] = {
    # Titled per route by the suite, so the needle is the static part of the
    # template and the match count is the number of routes that answered.
    "routes_reachable": ("returns 200 and renders its heading",),
    "status_route": ("/status is reachable",),
    "machine_readable_routes": ("the machine-readable routes are served",),
    "canonical_metadata": ("has a canonical URL on the deployed host",),
    "sitemap": ("the sitemap lists the deployed host and nothing else",),
    "case_study_locked": ("the case study is locked, and says why",),
    "security_headers": ("the response headers survive the platform router",),
    "no_localhost_url": ("NO route serves a localhost URL anywhere in its markup",),
    "no_database_connection": ("the website opens no database connection",),
    "no_console_error": ("no console error on any route",),
    "mobile_navigation": ("mobile navigation opens, links, and closes",),
    "reduced_motion": ("reduced motion is honoured",),
}

#: Reads the commit the deployed build was made from, off the deployment itself.
#: The footer links every page to the repository at the manifest's commit, so the
#: served HTML carries it and no local file has to be trusted for it.
_COMMIT_IN_FOOTER = re.compile(r"https://github\.com/[^\"'/]+/[^\"'/]+/commit/([0-9a-f]{7,40})")


def _get(url: str, timeout: int = 45) -> tuple[int, str]:
    """Fetch a URL. Returns the status and the body, or ``(0, "")`` on failure."""
    request = urllib.request.Request(url, headers={"User-Agent": "arpi-evidence/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, ""
    except (urllib.error.URLError, OSError, ValueError):
        return 0, ""


def deployed_commit(base_url: str) -> str:
    """The commit the deployed build was produced from, read off the deployment.

    Returns ``UNVERIFIED`` when the served HTML does not carry it, which is the
    correct answer rather than a reason to fall back to the local checkout: the
    local commit is what *this* tree is at, not what the deployment is running.
    """
    for path in ("/status", "/"):
        status, body = _get(f"{base_url}{path}")
        if status != HTTP_OK:
            continue
        match = _COMMIT_IN_FOOTER.search(body)
        if match:
            return match.group(1)
    return UNVERIFIED


def health_check(base_url: str, health_path: str) -> tuple[bool, bool, str]:
    """Probe the homepage and the platform's health route directly.

    Both are probed here rather than left to the suite, because they are the two
    facts the evidence file states in its own voice -- "this URL answers" -- and a
    fact asserted in the register's own voice should be obtained by the register.

    Returns:
        Whether the homepage answered, whether the health route answered, and the
        timestamp of the attempt.
    """
    homepage_status, _ = _get(f"{base_url}/")
    health_status, _ = _get(f"{base_url}{health_path}")
    stamp = dt.datetime.now(tz=dt.UTC).replace(microsecond=0).isoformat()
    return homepage_status == HTTP_OK, health_status == HTTP_OK, stamp


def read_playwright_report(path: Path) -> dict[str, Any]:
    """Summarise Playwright's JSON report.

    Returns:
        A mapping with the outcome counts and the set of titles that passed. A
        missing or unreadable report yields empty results, so nothing downstream can
        record a check as verified on the strength of a report that is not there.
    """
    if not path.is_file():
        return {"passed": 0, "failed": 0, "skipped": 0, "flaky": 0, "titles": set()}

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"passed": 0, "failed": 0, "skipped": 0, "flaky": 0, "titles": set()}

    passed_titles: set[str] = set()
    counts = {"passed": 0, "failed": 0, "skipped": 0, "flaky": 0}

    def walk(suite: dict[str, Any], trail: str) -> None:
        title = f"{trail} {suite.get('title', '')}".strip()
        for spec in suite.get("specs", []):
            spec_title = f"{title} {spec.get('title', '')}".strip()
            for test in spec.get("tests", []):
                # Playwright reports `status` as expected/unexpected/flaky/skipped.
                status = test.get("status", "")
                if status == "expected":
                    counts["passed"] += 1
                    passed_titles.add(spec_title)
                elif status == "flaky":
                    counts["flaky"] += 1
                    # A flaky test passed on retry. It is recorded as passing here
                    # because the assertion did hold, and the flake count is kept
                    # beside it so the reader can weigh that for themselves.
                    passed_titles.add(spec_title)
                elif status == "unexpected":
                    counts["failed"] += 1
                elif status == "skipped":
                    counts["skipped"] += 1
        for child in suite.get("suites", []):
            walk(child, title)

    for suite in document.get("suites", []):
        walk(suite, "")

    return {**counts, "titles": passed_titles}


def check_results(report: dict[str, Any]) -> dict[str, str]:
    """Resolve each required check against the titles that actually passed."""
    titles: set[str] = report["titles"]
    resolved: dict[str, str] = {}
    for name, needles in REQUIRED_CHECKS.items():
        matched = [title for title in titles if any(needle in title for needle in needles)]
        resolved[name] = f"passed ({len(matched)})" if matched else UNVERIFIED
    return resolved


def main() -> int:
    """Record what the run observed. Returns ``0`` on success, ``1`` on a bad run."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="the deployment's public URL")
    parser.add_argument(
        "--report",
        type=Path,
        default=REPO_ROOT / "portfolio" / "remote-report.json",
        help="Playwright's JSON report from the remote suite",
    )
    parser.add_argument("--run-url", default="", help="the workflow run that produced this")
    parser.add_argument("--dry-run", action="store_true", help="print the result without writing")
    arguments = parser.parse_args()

    base_url = arguments.base_url.rstrip("/")
    document = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))

    environments = document["portfolio"]["environments"]
    target = next((entry for entry in environments if entry.get("public_url") == base_url), None)
    if target is None:
        print(
            f"error: {EVIDENCE_PATH.name} records no environment with public_url "
            f"{base_url!r}. Evidence is written against a declared environment, never "
            "appended for an unknown one.",
            file=sys.stderr,
        )
        return 1

    report = read_playwright_report(arguments.report)
    homepage_ok, healthy, stamp = health_check(base_url, target.get("health_path") or "/")
    commit = deployed_commit(base_url)
    results = check_results(report)

    suite_ran = report["passed"] > 0
    suite_green = suite_ran and report["failed"] == 0
    every_check_passed = all(value != UNVERIFIED for value in results.values())

    # Each field closes on its own evidence. A green suite does not close the health
    # timestamp, and a healthy probe does not close the smoke result.
    if healthy:
        target["health_verified_at"] = stamp
    if commit != UNVERIFIED:
        target["commit_sha"] = commit
    if suite_ran:
        target["remote_smoke_test"] = (
            f"{report['passed']} passed, {report['failed']} failed, "
            f"{report['skipped']} skipped, {report['flaky']} flaky"
        )
    if results["security_headers"] != UNVERIFIED:
        target["security_headers"] = results["security_headers"]

    document["portfolio"]["verification"] = {
        "_comment": [
            "Written by scripts/record_deployment_evidence.py from a run of",
            "portfolio/tests/remote/deployed-site.spec.ts against the deployment.",
            "Each check names the assertion that proves it; a check whose test did not",
            "run reads UNVERIFIED rather than inheriting the suite's overall verdict.",
        ],
        "homepage_http_ok": homepage_ok,
        "verified_at": stamp,
        "workflow_run": arguments.run_url or UNVERIFIED,
        "suite_green": suite_green,
        "checks": results,
    }

    rendered = json.dumps(document, indent=2) + "\n"
    print("ARPI deployment evidence")
    print(f"  base URL          : {base_url}")
    print(f"  homepage          : {'200' if homepage_ok else 'NO ANSWER'}")
    print(
        f"  health route      : {target.get('health_path')} -> {'200' if healthy else 'NO ANSWER'}"
    )
    print(f"  deployed commit   : {commit}")
    print(f"  suite             : {target.get('remote_smoke_test')}")
    for name, value in results.items():
        print(f"    {name:26} {value}")

    if arguments.dry_run:
        print("\n(dry run: nothing written)")
    else:
        EVIDENCE_PATH.write_text(rendered, encoding="utf-8")
        print(f"\nwrote {EVIDENCE_PATH.relative_to(REPO_ROOT).as_posix()}")

    # The same verdict in both modes. A dry run that reported success while the
    # real one would fail would be the exact confusion this script exists to avoid.
    if not (homepage_ok and healthy and suite_green and every_check_passed):
        print(
            "\nFAILED: the deployment was not fully verified. The evidence file records "
            "exactly what was obtained; the fields that were not obtained still read "
            "UNVERIFIED and must not be filled in by hand.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
