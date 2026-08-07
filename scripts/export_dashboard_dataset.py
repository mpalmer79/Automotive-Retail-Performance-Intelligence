#!/usr/bin/env python3
"""Export the governed dashboard datasets from the PostgreSQL ``reporting`` layer.

This is the single exit from the warehouse to the public operating console's data lane
(ADR-0013, delivery increment ``DASH.1``). The contract it obeys is
``docs/dashboard/DATA_CONTRACT.md``; the machine-readable form of that contract is
``arpi.dashboard.contract``, and this script adds no field, no filter and no arithmetic of
its own.

Usage
-----
    # Generate. Needs a loaded PostgreSQL warehouse.
    python scripts/export_dashboard_dataset.py

    # Verify the committed export. Needs nothing but the repository.
    python scripts/export_dashboard_dataset.py --check

    # Verify it still equals a fresh export of the same pipeline run.
    python scripts/export_dashboard_dataset.py --check --against-database

    # Report every measured artifact size, for the data contract's size table.
    python scripts/export_dashboard_dataset.py --check --sizes

Configuration
-------------
The connection comes from the repository's configuration contract: ``config/<profile>.yaml``
overridden by ``ARPI_`` environment variables with ``__`` as the nesting delimiter. A
password is never read from YAML; export ``ARPI_DATABASE__PASSWORD`` or ``PGPASSWORD``. See
``config/README.md``.

The exporter connects as the configured login role and immediately ``SET ROLE``s into
``arpi_reporter``, which is a NOLOGIN group role. The connecting role therefore needs
membership of ``arpi_reporter`` and nothing more.

What never reaches the output
-----------------------------
No host, port, database name, user, password, connection string, absolute local path, or
reference to the ``raw``, ``staging``, ``warehouse`` or ``audit`` schemas. The exporter
scans its own produced bytes for all of them and refuses to write on a hit.

Exit codes
----------
    0  the export was written, or the committed export is current
    1  a control failed: stale, drifted, prohibited, oversized, or unreconciled
    2  the configuration is unusable or PostgreSQL is unreachable
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from arpi.constants import SUPPORTED_PROFILES, SYNTHETIC_DATA_NOTICE  # noqa: E402
from arpi.dashboard import contract as spec  # noqa: E402
from arpi.dashboard.export import (  # noqa: E402
    DEFAULT_EXPORT_DIR,
    ExportError,
    ExportResult,
    check_export,
    generate_export,
)
from arpi.dashboard.serialization import ContractViolationError  # noqa: E402
from arpi.exceptions import ArpiError  # noqa: E402

if TYPE_CHECKING:
    from collections.abc import Sequence
    from contextlib import AbstractContextManager


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser.

    Returns:
        The parser. Flag style rather than subcommands, matching the repository's other
        generate/check tools (``scripts/check_reference_data.py``,
        ``portfolio/scripts/generate-inventory-data.ts``).
    """
    parser = argparse.ArgumentParser(
        prog="export_dashboard_dataset",
        description=__doc__.split("\n\n", 1)[0] if __doc__ else None,
        epilog=SYNTHETIC_DATA_NOTICE,
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the committed export instead of writing one. Needs no database.",
    )
    parser.add_argument(
        "--against-database",
        action="store_true",
        help=(
            "With --check, additionally re-export and byte-compare against the same pipeline "
            "run. Needs a database."
        ),
    )
    parser.add_argument(
        "--sizes",
        action="store_true",
        help="Print every artifact's measured size, for the data contract's size table.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=f"Export directory (default: {DEFAULT_EXPORT_DIR.as_posix()}).",
    )
    parser.add_argument(
        "--profile",
        choices=SUPPORTED_PROFILES,
        default=None,
        help="Configuration profile (default: $ARPI_PROFILE, else development).",
    )
    parser.add_argument(
        "--generated-at",
        default=None,
        help=(
            "Override the manifest's generation timestamp. Exists so a determinism test can "
            "produce two byte-identical exports; production leaves it unset."
        ),
    )
    return parser


def _connect(profile: str | None) -> AbstractContextManager[Any]:
    """Open a connection through the repository's approved configuration mechanism.

    Args:
        profile: Configuration profile, or ``None`` for the environment's default.

    Returns:
        A context manager yielding an open ``psycopg`` connection.

    Raises:
        DatabaseUnavailableError: If the database is disabled, ``psycopg`` is missing, or
            the connection fails.
    """
    # Imported here rather than at module scope ON PURPOSE. `--check` must run on a bare
    # standard-library interpreter, because that is what the `repository-checks` CI job
    # provides and because an offline freshness check that needs a dependency tree installed
    # is a check that stops running. `arpi.config` pulls in pydantic and
    # `arpi.ingestion.database` reaches for psycopg; neither is needed unless a connection is
    # actually being opened.
    from arpi.config import load_config  # noqa: PLC0415
    from arpi.ingestion.database import connect  # noqa: PLC0415

    config = load_config(profile=profile, config_dir=REPO_ROOT / "config")
    return connect(config)


def _report(result: ExportResult, *, show_sizes: bool) -> None:
    """Print the outcome of a run.

    Args:
        result: The export result.
        show_sizes: Whether to print the per-file size table.
    """
    manifest = result.manifest
    if manifest:
        run = manifest.get("pipeline_run", {})
        print(
            f"  profile {manifest.get('profile')}  seed {manifest.get('random_seed')}  "
            f"as of {manifest.get('as_of_date')}  dataset version "
            f"{manifest.get('dataset_version')}"
        )
        print(
            f"  pipeline run {run.get('run_uuid')} ({run.get('status')})  "
            f"contract {manifest.get('contract_sha256', '')[:12]}  "
            f"role {manifest.get('reporter_role')}"
        )

    if show_sizes:
        print("\n  artifact sizes (bytes)")
        for name, size in sorted(result.files.items(), key=lambda item: (-item[1], item[0])):
            rows = _row_count(manifest, name)
            suffix = f"  {rows} rows" if rows is not None else ""
            print(f"    {size:>9}  {name}{suffix}")
        print(f"    {result.total_bytes:>9}  TOTAL ({len(result.files)} files)")


def _row_count(manifest: dict[str, Any], file_name: str) -> int | None:
    """Return the row count the manifest records for a file, if it records one.

    Args:
        manifest: The manifest.
        file_name: The file name.

    Returns:
        The row count, or ``None`` for the manifest itself.
    """
    for entry in manifest.get("datasets", []):
        if isinstance(entry, dict) and entry.get("file") == file_name:
            count = entry.get("row_count")
            return count if isinstance(count, int) else None
    return None


def _fail(problems: Sequence[str], *, checking: bool) -> int:
    """Print every problem and return the failure exit code.

    Args:
        problems: The problems, in discovery order.
        checking: Whether the run was a check rather than a generation.

    Returns:
        The exit code, always 1.
    """
    heading = "dashboard export is NOT CURRENT" if checking else "dashboard export FAILED"
    print(f"\n{heading}\n", file=sys.stderr)
    for index, problem in enumerate(problems, start=1):
        print(f"  {index}. {problem}\n", file=sys.stderr)
    print(
        f"{len(problems)} problem(s). Nothing was written. Regenerate with\n"
        "  python scripts/export_dashboard_dataset.py\n"
        "against a loaded warehouse, and read the diff: it is telling you that a figure the "
        "console would display no longer matches its source.\n",
        file=sys.stderr,
    )
    return 1


def run(argv: Sequence[str] | None = None) -> int:
    """Generate or check the dashboard export.

    Args:
        argv: Arguments excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    args = build_parser().parse_args(argv)
    output_dir = (args.output_dir or (REPO_ROOT / DEFAULT_EXPORT_DIR)).resolve()

    if args.against_database and not args.check:
        print("--against-database is only meaningful with --check.", file=sys.stderr)
        return 2

    try:
        if args.check:
            return _run_check(args, output_dir)
        return _run_generate(args, output_dir)
    except (ContractViolationError, ExportError) as error:
        return _fail([error.message], checking=args.check)
    except ArpiError as error:
        print(f"\n{error.message}\n", file=sys.stderr)
        return 2


def _run_check(args: argparse.Namespace, output_dir: Path) -> int:
    """Verify the committed export.

    Args:
        args: Parsed arguments.
        output_dir: The export directory.

    Returns:
        A process exit code.
    """
    print(f"ARPI dashboard export check — {output_dir.relative_to(REPO_ROOT)}")
    if args.against_database:
        with _connect(args.profile) as connection:
            result = check_export(output_dir=output_dir, connection=connection)
    else:
        result = check_export(output_dir=output_dir)
    if result.problems:
        return _fail(result.problems, checking=True)
    _report(result, show_sizes=args.sizes)
    print(
        f"\ndashboard export: up to date. {len(spec.DATASETS)} datasets, "
        f"{result.total_bytes} bytes across {len(result.files)} files."
    )
    return 0


def _run_generate(args: argparse.Namespace, output_dir: Path) -> int:
    """Write the export.

    Args:
        args: Parsed arguments.
        output_dir: The export directory.

    Returns:
        A process exit code.
    """
    print(f"ARPI dashboard export — {output_dir.relative_to(REPO_ROOT)}")
    with _connect(args.profile) as connection:
        result = generate_export(
            connection,
            output_dir=output_dir,
            repo_root=REPO_ROOT,
            generated_at=args.generated_at,
        )
    if result.problems:
        return _fail(result.problems, checking=False)

    _report(result, show_sizes=args.sizes)
    removed = [name[1:] for name in result.wrote if name.startswith("-")]
    written = [name for name in result.wrote if not name.startswith("-")]
    print(f"\nwrote {len(written)} file(s) to {output_dir.relative_to(REPO_ROOT)}")
    for name in removed:
        print(f"  removed {name} (no longer declared by the contract)")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
