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
* It will not record a run against a *different* artefact as evidence about this one.
  The suite is read from this tree and the deployment serves whatever commit was last
  deployed; when ``--expect-commit`` says which commit this tree is and the deployment
  is running another, the run is reported and nothing is written. This cuts both ways:
  such a run cannot fail the tree either, because its assertions describe a build the
  deployment is not serving.
* It will not write a secret. The values it records are a URL, a commit SHA, a
  timestamp and a pass count.
* It will not let one environment's evidence overwrite another's. Added by the
  ``DASH.13`` closeout: schema 1 held a single portfolio-level ``verification``
  block, so recording production would have silently replaced staging's. Each
  record is now written inside the environment it is about.
* It will not infer that a deployment is production because its URL is public.
  A preview deployment has a public URL too -- ``arpi.up.railway.app`` is one, and
  is staging's. The role is supplied with ``--role`` and must AGREE with what the
  deployment actually tells crawlers; a disagreement is recorded as a failure
  rather than resolved in favour of either side.

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
    # The route the platform's health check probes. It was `/status` until `UX.1`
    # consolidated that route into `/technical?view=status`, so the binding names
    # the role rather than the path and survives the next move of it.
    "health_route": ("it is the health-check path",),
    # The eight permanent redirects are a property of the build. A deployment that
    # lost them would serve 404s to every link anybody has shared and would still
    # pass every other check here.
    "retired_urls": ("every retired URL still resolves on the deployment",),
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

#: The two roles a deployment may be recorded under, and what each one asserts about
#: the instructions it gives a crawler. `preview` is first so it is the fallback in
#: every ambiguous case: a deployment nobody labelled must not be counted as public.
ROLES = ("preview", "production")

#: Matches a `robots.txt` that disallows everything. A preview deployment must serve
#: one; a production deployment must not.
_DISALLOW_ALL = re.compile(r"^\s*Disallow:\s*/\s*$", re.IGNORECASE | re.MULTILINE)

#: Matches the `noindex` directive in a robots meta tag, however it is spaced.
_NOINDEX = re.compile(r"<meta[^>]+name=[\"']robots[\"'][^>]*noindex", re.IGNORECASE)

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
    for path in ("/technical", "/"):
        status, body = _get(f"{base_url}{path}")
        if status != HTTP_OK:
            continue
        match = _COMMIT_IN_FOOTER.search(body)
        if match:
            return match.group(1)
    return UNVERIFIED


#: The shortest abbreviation this script will compare. Below it the comparison is
#: not a commit identity, and two unrelated commits share a prefix often enough.
_MIN_ABBREVIATION = 7


def same_commit(deployed: str, expected: str) -> bool:
    """Whether the deployment is running the commit this tree is at.

    Compared by prefix in both directions, because the footer may carry an
    abbreviated SHA and an abbreviation is the same commit as the full hash it
    abbreviates. ``UNVERIFIED``, an empty value or an abbreviation shorter than
    seven characters answers ``False``: not knowing is not a match.
    """
    if not deployed or not expected or UNVERIFIED in (deployed, expected):
        return False
    left, right = deployed.strip().lower(), expected.strip().lower()
    shared = min(len(left), len(right))
    if shared < _MIN_ABBREVIATION:
        return False
    return left[:shared] == right[:shared]


def observed_indexing_role(base_url: str) -> str:
    """What the deployment tells crawlers, read off the deployment.

    Returns ``"preview"`` when ``robots.txt`` disallows everything AND the homepage
    carries ``noindex``, ``"production"`` when neither holds, ``"split-brain"`` when
    they disagree with each other, and ``UNVERIFIED`` when the host did not answer.

    ``split-brain`` is its own answer rather than a failure to classify. ``DASH.13``
    reproduced exactly that state -- a build made in one environment served in
    another -- and its defining property is that nothing errors: the deployment
    simply issues two contradictory instructions and no check notices. Naming it
    keeps it out of the two clean buckets it would otherwise fall into.
    """
    robots_status, robots_body = _get(f"{base_url}/robots.txt")
    home_status, home_body = _get(f"{base_url}/")
    if robots_status != HTTP_OK or home_status != HTTP_OK:
        return UNVERIFIED

    robots_blocks = bool(_DISALLOW_ALL.search(robots_body))
    page_noindexes = bool(_NOINDEX.search(home_body))
    if robots_blocks and page_noindexes:
        return "preview"
    if not robots_blocks and not page_noindexes:
        return "production"
    return "split-brain"


def observed_canonical_origin(base_url: str) -> str:
    """The origin the deployment claims as canonical on its homepage."""
    status, body = _get(f"{base_url}/")
    if status != HTTP_OK:
        return UNVERIFIED
    match = re.search(
        r"<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"'](https?://[^\"'/]+)", body, re.IGNORECASE
    )
    return match.group(1) if match else UNVERIFIED


def resolve_role(target: dict[str, Any], supplied: str | None, base_url: str) -> str | None:
    """Decide which role this record is about, before anything is written.

    Returns the role, or ``None`` after printing why it could not be decided. The two
    refusals are deliberate and neither has a sensible default:

    * **Nobody said.** A role may never be inferred from the URL, because a preview
      deployment has a public URL too -- ``arpi.up.railway.app`` is one, and is
      staging's. Guessing from the shape of a hostname is exactly how a preview
      deployment comes to be filed as the public one.
    * **Two answers.** When the caller and the record disagree, one of them is wrong
      and this script does not get to decide which. Silently preferring either would
      make the disagreement invisible, and the disagreement is the finding.
    """
    declared = target.get("role")

    if declared is None and supplied is None:
        print(
            f"error: the record for {base_url!r} declares no role and --role was not "
            "given. A deployment's role is intent and is never inferred from its URL: "
            "a preview deployment has a public URL too. Re-run with --role preview or "
            "--role production.",
            file=sys.stderr,
        )
        return None

    if declared is not None and supplied is not None and declared != supplied:
        print(
            f"error: --role {supplied!r} contradicts the recorded role {declared!r} for "
            f"{base_url!r}. One of the two is wrong, and this script does not get to "
            "decide which: a run that silently overwrote the recorded role would be how "
            "a preview deployment comes to be filed as the public one.",
            file=sys.stderr,
        )
        return None

    return supplied or declared


def write_status(path: Path, *, admissible: bool, verified: bool) -> None:
    """Append two booleans, as ``key=value`` lines, to a file the caller names.

    The caller decides what the file is for; this script only states what it found.
    ``verify-deployment.yml`` points it at ``$GITHUB_OUTPUT`` so a later step can ask
    *was this run even about this tree* before treating a red suite as a verdict --
    which keeps the workflow from re-deriving the comparison and disagreeing with the
    recorder about it.

    Appended, not written, because the file may already hold a caller's own keys.
    """
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"admissible={'true' if admissible else 'false'}\n")
        handle.write(f"verified={'true' if verified else 'false'}\n")


def host_answered(homepage_ok: bool, healthy: bool, about_this_tree: bool) -> bool:
    """Whether the deployment answered, as distinct from whether it is this build.

    ``/`` exists in every build, so a homepage that does not answer is a fact about
    the host. The health path is not: it is declared by *this* tree and names a route
    of the build this tree produces, so probing it against a deployment running some
    other commit asks the deployed build for a route it may never have had. That is
    the same category error as reading the suite's results as a verdict, one level
    down, so the health probe only counts when the artefact matches.
    """
    if not homepage_ok:
        return False
    return healthy or not about_this_tree


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


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="the deployment's public URL")
    parser.add_argument(
        "--report",
        type=Path,
        default=REPO_ROOT / "portfolio" / "remote-report.json",
        help="Playwright's JSON report from the remote suite",
    )
    parser.add_argument("--run-url", default="", help="the workflow run that produced this")
    parser.add_argument(
        "--expect-commit",
        default="",
        help=(
            "the commit this tree is at. When the deployment is running a different "
            "one, the run is reported and nothing is written: the suite came from "
            "here and the deployment is serving something else. Omit to compare "
            "nothing, which is the behaviour of a run whose caller cannot say."
        ),
    )
    parser.add_argument(
        "--status-file",
        type=Path,
        default=None,
        help=(
            "append `admissible=` and `verified=` to this file, so a caller can act on "
            "what this run was about without re-deriving it"
        ),
    )
    parser.add_argument(
        "--role",
        choices=ROLES,
        default=None,
        help=(
            "the role the deployment is being recorded under. Required when the "
            "environment being recorded does not already declare one, because it may "
            "never be inferred: a preview deployment has a public URL too. When the "
            "record already declares a role, this must agree with it."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="print the result without writing")
    return parser.parse_args()


def _print_report(
    *,
    base_url: str,
    target: dict[str, Any],
    homepage_ok: bool,
    healthy: bool,
    about_this_tree: bool,
    commit: str,
    results: dict[str, str],
    observed: dict[str, str],
) -> None:
    """Everything the run found, so the job log is readable without the artefact."""
    # A health path that is not a route of the deployed build reads as an outage
    # unless the reason is printed beside it.
    note = "" if healthy or about_this_tree else "  (not a route of the deployed build)"
    role = observed["role"]
    indexing_role = observed["indexing_role"]
    disagreement = (
        "" if indexing_role in (UNVERIFIED, role) else f"  <- DISAGREES with role {role!r}"
    )
    print("ARPI deployment evidence")
    print(f"  base URL          : {base_url}")
    print(f"  environment       : {target.get('environment')}")
    print(f"  role (declared)   : {role}")
    print(f"  indexing (observed): {indexing_role}{disagreement}")
    print(f"  canonical (observed): {observed['canonical_role']}")
    print(f"  homepage          : {'200' if homepage_ok else 'NO ANSWER'}")
    print(f"  health route      : {target.get('health_path')} -> ", end="")
    print(f"{'200' if healthy else 'NO ANSWER'}{note}")
    print(f"  deployed commit   : {commit}")
    print(f"  suite             : {target.get('remote_smoke_test')}")
    for name, value in results.items():
        print(f"    {name:26} {value}")


def _apply_observations(
    target: dict[str, Any],
    *,
    observed: dict[str, str],
    stamp: str,
    commit: str,
    smoke: str,
    security_headers: str,
    verification: dict[str, Any],
) -> None:
    """Write what this run obtained into the environment's own record.

    EACH FIELD CLOSES ON ITS OWN EVIDENCE. A green suite does not close the health
    timestamp and a healthy probe does not close the smoke result, so every write
    here is guarded by the observation that earns it. An empty or ``UNVERIFIED``
    value leaves the existing one alone rather than replacing a fact with a gap.

    The verification block goes INSIDE the environment. Schema 1 kept one block at
    portfolio level, so recording a second environment replaced the first -- with no
    error, and with the surviving record silently describing the wrong deployment.
    Recording production must never cost the staging evidence.
    """
    target["role"] = observed["role"]
    if stamp:
        target["health_verified_at"] = stamp
    if commit != UNVERIFIED:
        target["commit_sha"] = commit
    if smoke:
        target["remote_smoke_test"] = smoke
    if security_headers != UNVERIFIED:
        target["security_headers"] = security_headers
    for key in ("indexing_role", "canonical_role"):
        if observed[key] != UNVERIFIED:
            target[key] = observed[key]
    target["verification"] = verification


def main() -> int:
    """Record what the run observed. Returns ``0`` on success, ``1`` on a bad run."""
    arguments = _parse_arguments()

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

    role = resolve_role(target, arguments.role, base_url)
    if role is None:
        return 1

    report = read_playwright_report(arguments.report)
    homepage_ok, healthy, stamp = health_check(base_url, target.get("health_path") or "/")
    commit = deployed_commit(base_url)
    results = check_results(report)

    # What the deployment actually tells crawlers, as distinct from what it was
    # recorded as. These are OBSERVATIONS and are written whatever they say.
    indexing_role = observed_indexing_role(base_url)
    canonical_role = observed_canonical_origin(base_url)

    # The role and the observation must agree. A disagreement is not resolved in
    # favour of either: it is the finding.
    policy_coherent = indexing_role in (UNVERIFIED, role)

    suite_ran = report["passed"] > 0
    suite_green = suite_ran and report["failed"] == 0
    every_check_passed = all(value != UNVERIFIED for value in results.values())

    # Whether the deployment is serving the artefact this suite describes. When the
    # caller names no commit nothing is compared and the run is treated as it always
    # was; that keeps a hand-run verification against a fresh deployment strict.
    expected = arguments.expect_commit.strip()
    about_this_tree = expected == "" or same_commit(commit, expected)

    _apply_observations(
        target,
        observed={
            "role": role,
            "indexing_role": indexing_role,
            "canonical_role": canonical_role,
        },
        stamp=stamp if healthy else "",
        commit=commit,
        smoke=(
            f"{report['passed']} passed, {report['failed']} failed, "
            f"{report['skipped']} skipped, {report['flaky']} flaky"
        )
        if suite_ran
        else "",
        security_headers=results["security_headers"],
        verification={
            "_comment": [
                "Written by scripts/record_deployment_evidence.py from a run of",
                "portfolio/tests/remote/deployed-site.spec.ts against THIS environment.",
                "Each check names the assertion that proves it; a check whose test did not",
                "run reads UNVERIFIED rather than inheriting the suite's overall verdict.",
            ],
            "homepage_http_ok": homepage_ok,
            "verified_at": stamp,
            "workflow_run": arguments.run_url or UNVERIFIED,
            "suite_green": suite_green,
            "policy_coherent": policy_coherent,
            "checks": results,
        },
    )

    rendered = json.dumps(document, indent=2) + "\n"
    _print_report(
        base_url=base_url,
        target=target,
        homepage_ok=homepage_ok,
        healthy=healthy,
        about_this_tree=about_this_tree,
        commit=commit,
        results=results,
        observed={
            "role": role,
            "indexing_role": indexing_role,
            "canonical_role": canonical_role,
        },
    )

    if arguments.dry_run:
        print("\n(dry run: nothing written)")
    elif not about_this_tree:
        print(f"\n(nothing written: the deployment is running {commit}, this tree is {expected})")
    else:
        EVIDENCE_PATH.write_text(rendered, encoding="utf-8")
        print(f"\nwrote {EVIDENCE_PATH.relative_to(REPO_ROOT).as_posix()}")

    answered = host_answered(homepage_ok, healthy, about_this_tree)
    if arguments.status_file is not None:
        write_status(
            arguments.status_file,
            admissible=about_this_tree,
            verified=(
                answered
                and about_this_tree
                and suite_green
                and every_check_passed
                and policy_coherent
            ),
        )

    return _verdict(
        answered=answered,
        about_this_tree=about_this_tree,
        policy_coherent=policy_coherent,
        suite_verified=suite_green and every_check_passed,
        commit=commit,
        expected=expected,
        role=role,
        indexing_role=indexing_role,
    )


def _verdict(
    *,
    answered: bool,
    about_this_tree: bool,
    policy_coherent: bool,
    suite_verified: bool,
    commit: str,
    expected: str,
    role: str,
    indexing_role: str,
) -> int:
    """Turn what was observed into an exit code, in the order the facts rank.

    Order matters and is not arbitrary. A host that did not answer makes every later
    question unanswerable; a run about a different commit makes the suite's verdict
    inapplicable in either direction; and the policy check comes before the suite
    because a deployment can pass every route assertion while telling crawlers the
    opposite of what it was released as.
    """
    # A deployment that does not answer is a failure whichever commit it is running.
    if not answered:
        print(
            "\nFAILED: the deployment did not answer. The evidence file records exactly "
            "what was obtained; the fields that were not obtained still read UNVERIFIED "
            "and must not be filled in by hand.",
            file=sys.stderr,
        )
        return 1

    # Beyond that, a run against a different commit proves nothing either way. Its
    # assertions were written for a build the deployment is not serving, so reading
    # them as a verdict on this tree would be wrong in whichever direction they fell.
    if not about_this_tree:
        print(
            f"\nNOT ADMISSIBLE for this tree: the deployment is running {commit} and the "
            f"suite was read from {expected}. The host answered, so this is not a "
            "deployment failure; the route-level results describe the deployed build "
            "and were not recorded against this one. Re-run once this commit is "
            "deployed to obtain evidence about it."
        )
        return 0

    # The deployment's own instructions to crawlers must match the role it is being
    # recorded under. This is the DASH.13 split-brain state and every other check
    # here passes straight through it, which is precisely why it needs naming.
    if not policy_coherent:
        print(
            f"\nFAILED: this deployment is recorded as {role!r} and is serving "
            f"{indexing_role!r}. "
            + (
                "robots.txt and the page metadata contradict each other, which is what a "
                "build made in one environment and served in another produces."
                if indexing_role == "split-brain"
                else "The recorded role and the served policy are different claims about "
                "the same deployment."
            ),
            file=sys.stderr,
        )
        return 1

    if not suite_verified:
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
