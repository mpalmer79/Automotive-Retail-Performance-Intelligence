"""The Inventory Operations subcommands, factored out of :mod:`arpi.cli`.

``arpi.cli`` owns four Phase 0 commands and is the only module in ARPI that prints. This
module keeps that true: it builds the four Inventory Operations subparsers and implements
their handlers, and everything it emits goes through :func:`arpi.cli.emit`.

The four commands are one operator workflow:

======================================  =====================================================
``arpi sanitize-inventory``             private workbook in, governed artifact out
``arpi validate-inventory``             refuse a committed artifact that breaks the contract
``arpi load-inventory``                 artifact into PostgreSQL, reconciled
``arpi export-inventory-report``        warehouse into a dealership-ready Excel report
======================================  =====================================================

Every one of them supports ``--json`` for a machine-readable summary and ``--dry-run``
where a dry run is meaningful, exits non-zero on failure, and prints the intended
underscore-based output file name so an operator can check it before committing anything.

Redaction is the reason these handlers are thin. They print the summary objects the
library returns, and those objects carry counts, batch identifiers, digests and repository
paths -- never an original VIN, a source URL or a source row.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

from arpi.exceptions import ArpiError, DatabaseUnavailableError

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from arpi.config import ArpiConfig

__all__ = ["add_inventory_commands", "dispatch_inventory_command", "is_inventory_command"]

#: The subcommand names this module owns.
INVENTORY_COMMANDS: tuple[str, ...] = (
    "sanitize-inventory",
    "validate-inventory",
    "load-inventory",
    "export-inventory-report",
)


def _iso_date(value: str) -> date:
    """Parse an ISO date argument, refusing anything ambiguous."""
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"{value!r} is not an ISO date. Use YYYY-MM-DD, for example 2026-08-02."
        ) from None


def is_inventory_command(command: str) -> bool:
    """Return whether a subcommand belongs to this module."""
    return command in INVENTORY_COMMANDS


def add_inventory_commands(
    subparsers: argparse._SubParsersAction[argparse.ArgumentParser],
    common: argparse.ArgumentParser,
) -> None:
    """Register the four Inventory Operations subcommands.

    Args:
        subparsers: The top-level subparser action from :func:`arpi.cli.build_parser`.
        common: The parent parser carrying ``--profile``, ``--config-dir`` and
            ``--log-level``.
    """
    machine = argparse.ArgumentParser(add_help=False)
    machine.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Emit a machine-readable JSON summary instead of the human-readable one.",
    )

    sanitize = subparsers.add_parser(
        "sanitize-inventory",
        parents=[common, machine],
        help="Sanitize a private inventory workbook into a governed public-reference artifact.",
        description=(
            "Reads a PRIVATE workbook from outside the repository and writes a governed "
            "four-sheet artifact with original VINs replaced by deterministic ARPI "
            "identifiers, source URLs removed, and the approved underscore-based file "
            "name ARPI_<Store_Descriptor>_Inventory_Sanitized_<yyyy-mm-dd>.xlsx. The "
            "private input is never committed and is never printed."
        ),
    )
    sanitize.add_argument("--input", type=Path, required=True, help="Private source workbook.")
    sanitize.add_argument(
        "--dealership-id", required=True, help="Fictional store to assign, e.g. GSA-002."
    )
    sanitize.add_argument(
        "--captured-at", type=_iso_date, required=True, help="Snapshot date (YYYY-MM-DD)."
    )
    sanitize.add_argument(
        "--output",
        type=Path,
        default=None,
        help=(
            "Destination. Defaults to the governed path and the approved underscore-based "
            "file name derived from the store and the date."
        ),
    )
    sanitize.add_argument(
        "--sheet", default=None, help="Sheet of the private workbook to read (default: the first)."
    )
    sanitize.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing artifact. Refused by default.",
    )
    sanitize.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be produced, including the intended file name, and write nothing.",
    )

    validate = subparsers.add_parser(
        "validate-inventory",
        parents=[common, machine],
        help="Validate a committed sanitized workbook against the governed contract.",
        description=(
            "Refuses a workbook that carries an original VIN, a source URL, a real dealer "
            "identity, a wrong or missing classification, a duplicated grain, a broken "
            "pricing contract, an unknown store, a file name that disagrees with its own "
            "contents, or a duplicate artifact in the same snapshot directory."
        ),
    )
    validate.add_argument("--workbook", type=Path, required=True, help="Sanitized workbook.")
    validate.add_argument(
        "--dealership-id", default=None, help="Store the caller expects; a disagreement fails."
    )
    validate.add_argument(
        "--captured-at",
        type=_iso_date,
        default=None,
        help="Snapshot date the caller expects; a disagreement fails.",
    )

    load = subparsers.add_parser(
        "load-inventory",
        parents=[common, machine],
        help="Import a sanitized workbook into PostgreSQL and reconcile the load.",
        description=(
            "Validates, lands, stages, merges the observed vehicle dimension, loads the "
            "listing fact and evaluates every RECON-LISTING-* rule, all in one "
            "transaction. A rerun of the same workbook writes nothing. A DIFFERENT "
            "workbook for a capture batch already loaded is refused: historical snapshots "
            "are immutable."
        ),
    )
    load.add_argument("--workbook", type=Path, required=True, help="Sanitized workbook.")
    load.add_argument(
        "--dealership-id", default=None, help="Store the caller expects; a disagreement fails."
    )
    load.add_argument(
        "--captured-at",
        type=_iso_date,
        default=None,
        help="Snapshot date the caller expects; a disagreement fails.",
    )
    load.add_argument(
        "--sql-root", type=Path, default=Path("sql"), help="Directory holding the SQL folders."
    )
    load.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report what would be imported, without writing.",
    )

    export = subparsers.add_parser(
        "export-inventory-report",
        parents=[common, machine],
        help="Export the Excel operating report for one store and capture date.",
        description=(
            "Builds a dealership-ready workbook from the reporting views: README, Summary, "
            "Inventory, Model Summary, and Snapshot Changes when a prior capture exists. "
            "The output uses the approved underscore-based name "
            "ARPI_<Store_Descriptor>_Inventory_Report_<yyyy-mm-dd>.xlsx."
        ),
    )
    export.add_argument("--dealership-id", required=True, help="Store to report on.")
    export.add_argument(
        "--captured-at", type=_iso_date, required=True, help="Capture date to report as of."
    )
    export.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Destination. Defaults to artifacts/inventory/<approved name>.xlsx.",
    )
    export.add_argument(
        "--no-overwrite",
        dest="overwrite",
        action="store_false",
        default=True,
        help="Refuse to replace an existing report.",
    )


def dispatch_inventory_command(
    args: argparse.Namespace,
    config: ArpiConfig,
    *,
    emit: Any,
    emit_error: Any,
    exit_ok: int,
    exit_failure: int,
) -> int:
    """Run one Inventory Operations subcommand.

    Args:
        args: Parsed namespace.
        config: Resolved configuration, used for the database connection and the profile
            recorded on an import's audit run.
        emit: The CLI's stdout writer.
        emit_error: The CLI's stderr writer.
        exit_ok: Success exit code.
        exit_failure: Failure exit code.

    Returns:
        A process exit code.
    """
    handlers = {
        "sanitize-inventory": _command_sanitize,
        "validate-inventory": _command_validate,
        "load-inventory": _command_load,
        "export-inventory-report": _command_export,
    }
    return int(
        handlers[args.command](
            args, config, emit=emit, emit_error=emit_error, exit_ok=exit_ok, exit_failure=exit_failure
        )
    )


def _report(emit: Any, payload: Any, *, as_json: bool) -> None:
    """Print either the JSON summary or the human-readable one."""
    if as_json:
        emit(json.dumps(payload.as_dict(), indent=2, sort_keys=True))
    else:
        emit(payload.summary())


def _command_sanitize(  # noqa: PLR0913 - the handler signature is fixed by the dispatcher
    args: argparse.Namespace,
    config: ArpiConfig,  # noqa: ARG001 - the sanitizer needs no configuration
    *,
    emit: Any,
    emit_error: Any,
    exit_ok: int,
    exit_failure: int,
) -> int:
    """Sanitize a private workbook."""
    from arpi.inventory.sanitizer import sanitize_workbook

    try:
        summary = sanitize_workbook(
            input_path=args.input,
            dealership_id=args.dealership_id,
            captured_at=args.captured_at,
            output_path=args.output,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            sheet_name=args.sheet,
        )
    except ArpiError as error:
        emit_error(str(error))
        return exit_failure
    _report(emit, summary, as_json=args.as_json)
    return exit_ok


def _command_validate(  # noqa: PLR0913 - the handler signature is fixed by the dispatcher
    args: argparse.Namespace,
    config: ArpiConfig,  # noqa: ARG001 - the validator needs no configuration
    *,
    emit: Any,
    emit_error: Any,
    exit_ok: int,
    exit_failure: int,
) -> int:
    """Validate a committed sanitized workbook."""
    from arpi.inventory.validation import validate_workbook

    try:
        result = validate_workbook(
            args.workbook,
            expect_dealership=args.dealership_id,
            expect_captured_at=args.captured_at,
        )
    except ArpiError as error:
        emit_error(str(error))
        return exit_failure
    _report(emit, result, as_json=args.as_json)
    if not result.is_valid:
        emit_error(f"{len(result.findings)} workbook contract finding(s); the artifact is refused.")
        return exit_failure
    return exit_ok


def _command_load(  # noqa: PLR0913 - the handler signature is fixed by the dispatcher
    args: argparse.Namespace,
    config: ArpiConfig,
    *,
    emit: Any,
    emit_error: Any,
    exit_ok: int,
    exit_failure: int,
) -> int:
    """Import a sanitized workbook into PostgreSQL."""
    from arpi.ingestion.database import connect
    from arpi.inventory.importer import import_listing_workbook

    try:
        with connect(config) as connection:
            summary = import_listing_workbook(
                connection,
                args.workbook,
                sql_root=args.sql_root,
                expect_dealership=args.dealership_id,
                expect_captured_at=args.captured_at,
                profile=config.profile,
                dry_run=args.dry_run,
            )
            if args.dry_run:
                connection.rollback()
            else:
                connection.commit()
    except DatabaseUnavailableError as error:
        emit_error(str(error))
        return exit_failure
    except ArpiError as error:
        emit_error(str(error))
        return exit_failure
    _report(emit, summary, as_json=args.as_json)
    return exit_ok


def _command_export(  # noqa: PLR0913 - the handler signature is fixed by the dispatcher
    args: argparse.Namespace,
    config: ArpiConfig,
    *,
    emit: Any,
    emit_error: Any,
    exit_ok: int,
    exit_failure: int,
) -> int:
    """Export the Excel operating report."""
    from arpi.ingestion.database import connect
    from arpi.inventory.report import export_operating_report

    try:
        with connect(config) as connection:
            summary = export_operating_report(
                connection,
                dealership_id=args.dealership_id,
                captured_at=args.captured_at,
                output_path=args.output,
                overwrite=args.overwrite,
            )
    except DatabaseUnavailableError as error:
        emit_error(str(error))
        return exit_failure
    except ArpiError as error:
        emit_error(str(error))
        return exit_failure
    _report(emit, summary, as_json=args.as_json)
    return exit_ok
