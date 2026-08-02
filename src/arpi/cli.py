"""Command-line interface for ARPI.

Exit codes:

===== ===============================================================
Code  Meaning
===== ===============================================================
0     success
1     an ARPI failure, including a critical data-quality failure
2     the configuration is invalid or the profile does not exist
===== ===============================================================

Only this module writes to stdout. Library code logs to stderr and returns values.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from arpi.config import ArpiConfig, load_config
from arpi.constants import (
    ARPI_VERSION,
    PROJECT_NAME,
    SHORT_NAME,
    SUPPORTED_PROFILES,
    SYNTHETIC_DATA_NOTICE,
)
from arpi.exceptions import ArpiError, ConfigurationError
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.writer import write_outputs
from arpi.ingestion.database import database_available
from arpi.inventory.cli import (
    add_inventory_commands,
    dispatch_inventory_command,
    is_inventory_command,
)
from arpi.logging_config import configure_logging
from arpi.pipeline import run_foundation
from arpi.utilities.paths import resolve_output_dir
from arpi.validation.datasets import validate_foundation_datasets

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_CONFIG_ERROR = 2


def emit(message: str = "") -> None:
    """Write a line of user-facing output to stdout.

    This is the only place in ARPI that prints; everything else logs to stderr.

    Args:
        message: Text to print.
    """
    print(message)


def emit_error(message: str) -> None:
    """Write a user-facing error to stderr without a traceback.

    Args:
        message: Text to print.
    """
    print(f"{SHORT_NAME} error: {message}", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level argument parser.

    Returns:
        A parser exposing the ``version``, ``check-config``, ``generate`` and
        ``run-foundation`` subcommands, plus the four Inventory Operations subcommands
        registered by :func:`arpi.inventory.cli.add_inventory_commands`.
    """
    parser = argparse.ArgumentParser(
        prog="arpi",
        description=f"{PROJECT_NAME} ({SHORT_NAME}) -- synthetic automotive retail analytics.",
        epilog=SYNTHETIC_DATA_NOTICE,
    )
    parser.add_argument("--version", action="version", version=f"{SHORT_NAME} {ARPI_VERSION}")
    subparsers = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--profile",
        choices=SUPPORTED_PROFILES,
        default=None,
        help="Configuration profile (default: $ARPI_PROFILE, else development).",
    )
    common.add_argument(
        "--config-dir",
        type=Path,
        default=None,
        help="Directory containing <profile>.yaml (default: ./config).",
    )
    common.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default=None,
        help="Override logging.level for this invocation.",
    )

    subparsers.add_parser("version", parents=[common], help="Print the ARPI version.")
    subparsers.add_parser(
        "check-config",
        parents=[common],
        help="Print the resolved configuration (redacted) and probe the database.",
    )

    generate = subparsers.add_parser(
        "generate",
        parents=[common],
        help="Generate and validate the foundation dimensions, then write CSVs.",
    )
    generate.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for the raw CSVs (default: <paths.raw_output_dir>/<profile>).",
    )

    foundation = subparsers.add_parser(
        "run-foundation",
        parents=[common],
        help="Run the full Phase 0 slice, including the optional PostgreSQL load.",
    )
    load_group = foundation.add_mutually_exclusive_group()
    load_group.add_argument(
        "--load-database",
        dest="load_database",
        action="store_true",
        default=None,
        help="Force the PostgreSQL load step on.",
    )
    load_group.add_argument(
        "--no-load-database",
        dest="load_database",
        action="store_false",
        default=None,
        help="Force the PostgreSQL load step off.",
    )
    foundation.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for the raw CSVs (default: <paths.raw_output_dir>/<profile>).",
    )

    # The Inventory Operations lane registers its own four subcommands. They live in
    # arpi.inventory.cli rather than here because they are a separate data lane with its
    # own governance (ADR-0011), and because this module would otherwise grow a second
    # personality. They still print through emit()/emit_error() below, so the rule that
    # only arpi.cli writes to stdout is unchanged.
    add_inventory_commands(subparsers, common)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI.

    Args:
        argv: Argument list, excluding the program name. Defaults to ``sys.argv[1:]``.

    Returns:
        A process exit code.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return _dispatch(args)
    except ConfigurationError as error:
        emit_error(str(error))
        return EXIT_CONFIG_ERROR
    except ArpiError as error:
        emit_error(str(error))
        return EXIT_FAILURE


def _dispatch(args: argparse.Namespace) -> int:
    """Route a parsed namespace to its command implementation."""
    if args.command == "version":
        return _command_version()
    config = _load(args)
    if args.command == "check-config":
        return _command_check_config(config)
    if args.command == "generate":
        return _command_generate(config, args.output_dir)
    if is_inventory_command(args.command):
        return dispatch_inventory_command(
            args,
            config,
            emit=emit,
            emit_error=emit_error,
            exit_ok=EXIT_OK,
            exit_failure=EXIT_FAILURE,
        )
    return _command_run_foundation(config, args.load_database, args.output_dir)


def _load(args: argparse.Namespace) -> ArpiConfig:
    """Resolve configuration, applying the ``--log-level`` override if given."""
    config = load_config(profile=args.profile, config_dir=args.config_dir)
    if args.log_level:
        config = config.model_copy(
            update={"logging": config.logging.model_copy(update={"level": args.log_level})}
        )
    configure_logging(config)
    return config


def _command_version() -> int:
    """Print the project name and version."""
    emit(f"{PROJECT_NAME} ({SHORT_NAME}) {ARPI_VERSION}")
    return EXIT_OK


def _command_check_config(config: ArpiConfig) -> int:
    """Print the redacted configuration and report database reachability."""
    emit(f"Resolved configuration for profile {config.profile!r}:")
    emit(_render(config.redacted_dict()))
    emit("")
    reachable = database_available(config)
    emit(f"Database reachable : {'yes' if reachable else 'no'}")
    if not reachable:
        emit("  (the Phase 0 slice runs fine without PostgreSQL; the load step is skipped)")
    return EXIT_OK


def _command_generate(config: ArpiConfig, output_dir: Path | None) -> int:
    """Generate, validate and write the foundation dimensions."""
    date_dataset = generate_date_dataset(config)
    dealership_dataset = generate_dealership_dataset(config)
    datasets = (date_dataset, dealership_dataset)
    report = validate_foundation_datasets(date_dataset, dealership_dataset, config)

    raw_base = (
        output_dir if output_dir is not None else config.paths.raw_output_dir / config.profile
    )
    raw_dir = resolve_output_dir(raw_base, config)
    raw_files, raw_manifest = write_outputs(config, datasets, raw_dir)
    emit(f"Wrote {len(raw_files)} entity CSV(s) and {raw_manifest.name} to {raw_dir}")

    if config.generation.write_sample_outputs:
        sample_dir = resolve_output_dir(config.paths.sample_output_dir, config)
        sample_files, sample_manifest = write_outputs(
            config, datasets, sample_dir, row_limit=config.generation.sample_row_limit
        )
        emit(f"Wrote {len(sample_files)} sample CSV(s) and {sample_manifest.name} to {sample_dir}")

    emit("")
    emit(report.summary_table())
    if report.has_critical_failure:
        emit_error(f"{len(report.critical_failures)} critical data-quality check(s) failed.")
        return EXIT_FAILURE
    return EXIT_OK


def _command_run_foundation(
    config: ArpiConfig, load_database: bool | None, output_dir: Path | None
) -> int:
    """Run the full Phase 0 slice and print its execution summary."""
    result = run_foundation(
        config, load_database=load_database, output_dir=output_dir, run_mode="cli"
    )
    emit(result.summary())
    if result.report.has_critical_failure:
        emit_error(f"{len(result.report.critical_failures)} critical data-quality check(s) failed.")
        return EXIT_FAILURE
    return EXIT_OK


def _render(payload: dict[str, object], indent: int = 2) -> str:
    """Render a nested mapping as an indented block using YAML-style scalars."""
    lines: list[str] = []
    pad = " " * indent
    for key, value in payload.items():
        if isinstance(value, dict):
            lines.append(f"{pad}{key}:")
            lines.append(_render(value, indent + 2))
        else:
            lines.append(f"{pad}{key}: {_scalar(value)}")
    return "\n".join(lines)


def _scalar(value: object) -> str:
    """Render a scalar the same way the YAML profiles do."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)
