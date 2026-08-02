#!/usr/bin/env python3
"""Fail when an implementation-status claim disagrees with the repository.

Six checks, run over every tracked text file:

  1. DECLARED vs DERIVED  -- a declared status the evidence refutes, such as an engine
     validation marked passed while its evidence file records no run, or a deployment
     asserted without an evidence record to support it.
  2. PROSE vs DERIVED     -- a documented claim the evidence refutes, such as "no
     semantic model exists" beside thirty TMDL files.
  3. WEBSITE vs REGISTER  -- the published counts and the derived counts must agree.
  4. REVIEW METADATA      -- the register's own review date and verified commit must be
     well-formed, because a stale limitations register is the failure it exists to prevent.
  5. DEPLOYMENT EVIDENCE  -- the evidence file must record identifiers and never a
     credential.
  6. FACT-LOADING CONTRACT -- capability that is declared must also be required. The five
     MVP facts are documented as loaded on every database run, so the loader may not
     treat their load scripts as optional, and the registry and the SQL tree must name
     the same set.

Every rule only ever tightens a claim toward the evidence. None can open a gate, mark a
validation passed, promote a phase, or turn a live website into a running database
because a file appeared.

Usage:
    python scripts/check_project_capabilities.py            # check
    python scripts/check_project_capabilities.py --json     # print the register

Standard library only, and no package import: `repository-checks` runs on a bare
interpreter with nothing installed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deployment_evidence import find_secret_fields
from project_capabilities import (
    REPO_ROOT,
    Contradiction,
    build_capabilities,
    check_declarations,
    check_fact_load_contract,
    check_review_metadata,
    check_website_agreement,
    derive_evidence,
    find_stale_claims,
    load_declared,
    load_review,
)

#: Extensions worth searching. A claim in a binary or a lockfile is not prose.
TEXT_SUFFIXES = frozenset({".md", ".py", ".sql", ".ts", ".tsx", ".json", ".yaml", ".yml", ".txt"})

#: Directories that hold generated output or third-party code.
SKIP_DIRECTORIES = ("node_modules/", ".next/", "data/", ".git/", "portfolio/src/generated/")


def tracked_text_files() -> list[Path]:
    """Every tracked text file, from git rather than a walk.

    Using git means an untracked scratch file cannot fail the build, and a deleted file
    cannot pass it.
    """
    try:
        listing = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
            text=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Not a git checkout: fall back to walking, which is slower but correct.
        return [
            path
            for path in sorted(REPO_ROOT.rglob("*"))
            if path.is_file()
            and path.suffix in TEXT_SUFFIXES
            and not any(part in path.as_posix() for part in SKIP_DIRECTORIES)
        ]

    files: list[Path] = []
    for name in listing.split("\0"):
        if not name or any(name.startswith(prefix) for prefix in SKIP_DIRECTORIES):
            continue
        path = REPO_ROOT / name
        if path.suffix in TEXT_SUFFIXES and path.is_file():
            files.append(path)
    return files


def _report(title: str, contradictions: list[Contradiction]) -> None:
    print(f"\n{title}: {len(contradictions)} contradiction(s)", file=sys.stderr)
    for contradiction in contradictions:
        print(contradiction.render(), file=sys.stderr)


def main() -> int:
    """Run every capability check.

    Returns:
        ``0`` when the repository, its declarations and its prose agree; ``1`` otherwise.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the combined capability register and exit without checking",
    )
    arguments = parser.parse_args()

    if arguments.json:
        print(json.dumps(build_capabilities(), indent=2))
        return 0

    evidence = derive_evidence()
    declared = load_declared()
    files = tracked_text_files()

    print("ARPI capability check")
    print(f"  files searched   : {len(files)}")
    print(f"  semantic tables  : {evidence.semantic_tables}")
    print(f"  DAX measures     : {evidence.measures}")
    print(f"  report pages     : {evidence.report_pages}")
    print(f"  audit layers     : {evidence.audit_layers_recorded}")
    print(f"  real engine run  : {evidence.any_engine_has_run}")
    print(f"  portfolio deployed : {evidence.deployment.portfolio_is_recorded}")
    print(f"  live verified      : {evidence.deployment.portfolio_is_live_verified}")
    print(f"  warehouse running  : {evidence.analytical_platform_is_running}")

    declaration_problems = check_declarations(declared, evidence)
    prose_problems = find_stale_claims(evidence, files)
    website_problems = check_website_agreement(evidence)
    review_problems = check_review_metadata(load_review())
    fact_load_problems = check_fact_load_contract(evidence)

    if declaration_problems:
        _report("Declared status contradicted by evidence", declaration_problems)
    if prose_problems:
        _report("Documented claims contradicted by evidence", prose_problems)
    if website_problems:
        _report("Website manifest disagrees with the register", website_problems)
    if review_problems:
        _report("Register review metadata is unusable", review_problems)
    if fact_load_problems:
        _report("Fact loading is declared but not required", fact_load_problems)

    secret_fields = find_secret_fields()
    if secret_fields:
        print(
            f"\nDeployment evidence carries {len(secret_fields)} field(s) that would hold a "
            "credential:",
            file=sys.stderr,
        )
        for finding in secret_fields:
            print(f"  {finding}", file=sys.stderr)

    total = (
        len(declaration_problems)
        + len(prose_problems)
        + len(website_problems)
        + len(review_problems)
        + len(fact_load_problems)
        + len(secret_fields)
    )
    if total:
        print(
            f"\nFAILED: {total} capability contradiction(s).\n"
            "Each names the claim and the evidence that refutes it. Correct the claim, or "
            "-- if the evidence is what changed -- update config/project_capabilities.json "
            "and regenerate the documentation blocks with "
            "`python scripts/generate_project_capabilities.py`.",
            file=sys.stderr,
        )
        return 1

    print("\nOK: declared status, documentation and the website agree with the repository.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
