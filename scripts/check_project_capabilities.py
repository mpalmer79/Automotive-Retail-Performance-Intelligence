#!/usr/bin/env python3
"""Fail when an implementation-status claim disagrees with the repository.

Three checks, run over every tracked text file:

  1. DECLARED vs DERIVED  -- a declared status the evidence refutes, such as an engine
     validation marked passed while its evidence file records no run.
  2. PROSE vs DERIVED     -- a documented claim the evidence refutes, such as "no
     semantic model exists" beside thirty TMDL files.
  3. WEBSITE vs REGISTER  -- the published counts and the derived counts must agree.

Every rule only ever tightens a claim toward the evidence. None can open a gate, mark a
validation passed, or promote a phase because a file appeared.

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

from project_capabilities import (
    REPO_ROOT,
    Contradiction,
    build_capabilities,
    check_declarations,
    check_website_agreement,
    derive_evidence,
    find_stale_claims,
    load_declared,
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

    declaration_problems = check_declarations(declared, evidence)
    prose_problems = find_stale_claims(evidence, files)
    website_problems = check_website_agreement(evidence)

    if declaration_problems:
        _report("Declared status contradicted by evidence", declaration_problems)
    if prose_problems:
        _report("Documented claims contradicted by evidence", prose_problems)
    if website_problems:
        _report("Website manifest disagrees with the register", website_problems)

    total = len(declaration_problems) + len(prose_problems) + len(website_problems)
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
