"""The ARPI vertical slice: generate, validate, write, optionally load, audit.

This orchestrator is the whole implemented pipeline. It generates all fifteen entities
in :data:`GENERATION_ORDER` -- the eight conformed dimensions, the six pre-warehouse
source entities, and the dashboard program's operating-plan entity -- and hands them to
the ingestion loader.

WHAT REACHES WHERE
------------------
All fifteen generated entities reach ``raw`` and ``staging``. Eight of them are loaded
into the warehouse as dimensions, by the merge scripts under ``sql/03_dimensions/``. The
five MVP facts are then loaded by the fact-load scripts under ``sql/04_facts/``:
``fact_vehicle_sale``, ``fact_vehicle_inventory_snapshot``, ``fact_lead``,
``fact_appointment`` and ``fact_marketing_spend``. ``fact_sales_target`` is loaded by the
same mechanism and is deliberately counted separately: it is the dashboard program's
first fact (``DASH.5``), not a sixth MVP fact, and the MVP baseline the semantic model
was measured against still describes five. The fact scripts run after every dimension
merge, because a fact resolves its surrogate keys through the conformed dimensions and
would resolve nothing before they exist.

``acquisition_event`` is the one source entity with no fact of its own: an acquisition is
an attribute of the vehicle and a term of the sale, so it is consumed in staging.

THE DATABASE STEP IS OPTIONAL; THE SQL IT NEEDS IS NOT
------------------------------------------------------
PostgreSQL remains optional for a generation-only run. When it is unavailable, or was
never requested, the run is reported as *skipped, not failed*, together with the exact
reason, so the slice stays runnable on a laptop with nothing installed but Python.

Once a database load IS requested, the warehouse SQL it depends on is not optional. The
loader refuses to run when a required merge or fact-load script is absent, rather than
loading part of the warehouse and reporting success over it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from arpi.audit.run import (
    LAYER_SOURCE,
    STATUS_FAILED,
    STATUS_SUCCEEDED,
    AuditRecorder,
    PipelineRun,
)
from arpi.constants import (
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
    PIPELINE_NAME_FOUNDATION,
    SYNTHETIC_DATA_NOTICE,
)
from arpi.generation.acquisition import (
    ENTITY_ACQUISITION_EVENT,
    generate_acquisition_dataset,
    validate_acquisition_dataset,
)
from arpi.generation.appointment import (
    ENTITY_APPOINTMENT_EVENT,
    generate_appointment_dataset,
    validate_appointment_dataset,
)
from arpi.generation.calendar import generate_date_dataset
from arpi.generation.customer import (
    ENTITY_DIM_CUSTOMER,
    generate_customer_dataset,
    validate_customer_dataset,
)
from arpi.generation.dealership import generate_dealership_dataset
from arpi.generation.employee import (
    ENTITY_DIM_EMPLOYEE,
    generate_employee_dataset,
    validate_employee_dataset,
)
from arpi.generation.finance_product import (
    ENTITY_DIM_FINANCE_PRODUCT,
    generate_finance_product_dataset,
    validate_finance_product_dataset,
)
from arpi.generation.finance_product_adjustment import (
    ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
    generate_finance_product_adjustment_dataset,
    validate_finance_product_adjustment_dataset,
)
from arpi.generation.finance_product_sale import (
    ENTITY_FINANCE_PRODUCT_SALE,
    generate_finance_product_sale_dataset,
    validate_finance_product_sale_dataset,
)
from arpi.generation.lender import (
    ENTITY_DIM_LENDER,
    generate_lender_dataset,
    validate_lender_dataset,
)
from arpi.generation.inventory_snapshot import (
    ENTITY_INVENTORY_SNAPSHOT_EVENT,
    generate_inventory_snapshot_dataset,
    validate_inventory_snapshot_dataset,
)
from arpi.generation.lead import (
    ENTITY_LEAD_EVENT,
    generate_lead_dataset,
    validate_lead_dataset,
)
from arpi.generation.lead_source import (
    ENTITY_DIM_LEAD_SOURCE,
    generate_lead_source_dataset,
    validate_lead_source_dataset,
)
from arpi.generation.marketing import (
    ENTITY_DIM_MARKETING_CAMPAIGN,
    ENTITY_MARKETING_SPEND,
    generate_marketing_campaign_dataset,
    generate_marketing_spend_dataset,
    validate_marketing_campaign_dataset,
    validate_marketing_spend_dataset,
)
from arpi.generation.sale import (
    ENTITY_SALE_EVENT,
    generate_sale_dataset,
    validate_sale_dataset,
)
from arpi.generation.sales_target import (
    ENTITY_SALES_TARGET,
    generate_sales_target_dataset,
    validate_sales_target_dataset,
)
from arpi.generation.vehicle import (
    ENTITY_DIM_VEHICLE,
    generate_vehicle_dataset,
    validate_vehicle_dataset,
)
from arpi.generation.vehicle_model import (
    ENTITY_DIM_VEHICLE_MODEL,
    catalogued_models_for,
    generate_vehicle_model_dataset,
    validate_vehicle_model_dataset,
)
from arpi.generation.writer import WrittenEntity, write_outputs
from arpi.ingestion.database import database_available
from arpi.ingestion.loader import DEFAULT_SQL_ROOT, LoadResult, load_foundation
from arpi.logging_config import configure_logging, get_logger
from arpi.utilities.paths import resolve_output_dir
from arpi.validation.datasets import (
    ensure_registry_coverage,
    validate_date_dataset,
    validate_dealership_dataset,
    validate_generation,
)
from arpi.validation.results import ValidationReport

if TYPE_CHECKING:  # pragma: no cover - import cycle guard for type checking only
    from collections.abc import Sequence

    from arpi.config import ArpiConfig
    from arpi.generation.base import GeneratedDataset

_LOGGER = get_logger(__name__)

SKIP_REASON_NOT_REQUESTED = (
    "not requested (pass --load-database, or set database.enabled and rerun)"
)

#: Every entity the foundation run generates, in dependency order.
#:
#: Order is load-bearing, not cosmetic. ``dim_vehicle`` draws from the model catalogue
#: ``dim_vehicle_model`` publishes, ``acquisition_event`` needs the vehicle population,
#: and ``sale_event`` needs vehicles, acquisitions, employees and customers. The loader
#: copies the datasets into ``raw`` in this order too, so a reviewer reading the audit
#: trail sees the dependency chain in the order it was built.
GENERATION_ORDER: tuple[str, ...] = (
    ENTITY_DIM_DATE,
    ENTITY_DIM_DEALERSHIP,
    ENTITY_DIM_VEHICLE_MODEL,
    ENTITY_DIM_VEHICLE,
    ENTITY_DIM_EMPLOYEE,
    ENTITY_DIM_CUSTOMER,
    ENTITY_DIM_LEAD_SOURCE,
    ENTITY_DIM_MARKETING_CAMPAIGN,
    # The two DASH.6 dimensions. Both are fixed reference catalogues that draw nothing,
    # and both must exist before the product-sale fact resolves a product or a lender.
    ENTITY_DIM_FINANCE_PRODUCT,
    ENTITY_DIM_LENDER,
    ENTITY_ACQUISITION_EVENT,
    ENTITY_SALE_EVENT,
    ENTITY_INVENTORY_SNAPSHOT_EVENT,
    ENTITY_LEAD_EVENT,
    ENTITY_APPOINTMENT_EVENT,
    ENTITY_MARKETING_SPEND,
    ENTITY_SALES_TARGET,
    # The two DASH.6 facts, after the sale they decompose. The adjustment entity reads
    # the product-sale entity, so their order between themselves is load-bearing too.
    ENTITY_FINANCE_PRODUCT_SALE,
    ENTITY_FINANCE_PRODUCT_ADJUSTMENT,
)


@dataclass(frozen=True, slots=True)
class FoundationRunResult:
    """Everything the Phase 0 slice produced.

    Attributes:
        run: The audited pipeline run.
        report: Every data-quality result from this run.
        datasets: The generated datasets, in generation order.
        raw_files: Files written under the raw output directory.
        sample_files: Files written under the sample output directory.
        database_loaded: Whether rows actually reached PostgreSQL.
        database_skip_reason: Why the database step did not run, if it did not.
        load_result: Details of the database load, when one happened.
        recorder: The in-memory audit recorder.
    """

    run: PipelineRun
    report: ValidationReport
    datasets: tuple[GeneratedDataset, ...]
    raw_files: tuple[WrittenEntity, ...]
    sample_files: tuple[WrittenEntity, ...]
    database_loaded: bool
    database_skip_reason: str | None
    load_result: LoadResult | None
    recorder: AuditRecorder

    @property
    def succeeded(self) -> bool:
        """``True`` when no critical data-quality check failed."""
        return not self.report.has_critical_failure

    def summary(self) -> str:
        """Render a human-readable execution summary.

        Returns:
            A multi-line report suitable for printing to stdout or pasting into a PR.
        """
        lines = [
            "ARPI Phase 0 foundation run",
            "=" * 60,
            f"profile              : {self.run.profile_name}",
            f"random_seed          : {self.run.random_seed}",
            f"run_uuid             : {self.run.run_uuid}",
            f"arpi_version         : {self.run.arpi_version}",
            f"status               : {self.run.status}",
            "",
            "Generated entities",
            "-" * 60,
        ]
        lines.extend(
            f"  {dataset.entity_name:<18} {dataset.row_count:>6} rows x "
            f"{dataset.column_count} columns"
            for dataset in self.datasets
        )
        lines.extend(["", "Files written", "-" * 60])
        written = [*self.raw_files, *self.sample_files]
        if written:
            lines.extend(
                f"  {entity.path}  ({entity.row_count} rows"
                f"{', truncated sample' if entity.truncated else ''}, "
                f"sha256={entity.content_digest[:16]}...)"
                for entity in written
            )
        else:
            lines.append("  (none)")
        lines.extend(["", "Database load", "-" * 60])
        if self.database_loaded and self.load_result is not None:
            lines.append(f"  loaded    : yes (batch {self.load_result.load_batch_id})")
            lines.extend(
                f"  warehouse : {entity} = {count} row(s)"
                for entity, count in sorted(self.load_result.warehouse_row_counts.items())
            )
            lines.extend(f"  merge sql : {path}" for path in self.load_result.executed_sql)
        else:
            lines.append(f"  skipped   : {self.database_skip_reason}")
            lines.append("  (skipped is not a failure: the slice runs without PostgreSQL)")
        lines.extend(["", "Data quality", "-" * 60, self.report.summary_table()])
        if self.recorder.reconciliation_results:
            lines.extend(["", "Reconciliation", "-" * 60])
            lines.extend(
                f"  {item.reconciliation_id}: {item.left_value:g} vs "
                f"{item.right_value:g} -> {item.status}"
                for item in self.recorder.reconciliation_results
            )
        lines.extend(["", SYNTHETIC_DATA_NOTICE])
        return "\n".join(lines)


def run_foundation(
    config: ArpiConfig,
    *,
    load_database: bool | None = None,
    output_dir: Path | str | None = None,
    sql_root: Path = DEFAULT_SQL_ROOT,
    run_mode: str = "library",
) -> FoundationRunResult:
    """Run the Phase 0 vertical slice end to end.

    Args:
        config: Resolved configuration.
        load_database: Force the database step on or off. ``None`` means "load when
            ``database.enabled`` is true and PostgreSQL answers".
        output_dir: Override for the raw output directory. Relative paths resolve
            against the project root; escaping it is refused.
        sql_root: Directory containing the numbered SQL folders.
        run_mode: Recorded on the audit row, e.g. ``"cli"``.

    Returns:
        A :class:`FoundationRunResult`. Critical data-quality failures are *reported*,
        not raised: the caller decides the exit code.
    """
    configure_logging(config)
    _LOGGER.info("Resolved configuration: %s", config.redacted_dict())

    run = PipelineRun.start(config, pipeline_name=PIPELINE_NAME_FOUNDATION, run_mode=run_mode)
    recorder = AuditRecorder(run=run)
    _LOGGER.info("Starting %s (run_uuid=%s).", run.pipeline_name, run.run_uuid)

    datasets = generate_all_datasets(config)
    for dataset in datasets:
        recorder.record_row_count(dataset.entity_name, LAYER_SOURCE, dataset.row_count)
        _LOGGER.info("Generated %s: %s row(s).", dataset.entity_name, dataset.row_count)

    report = validate_all_datasets(datasets, config)
    recorder.record_validation(report)
    _LOGGER.info(
        "Data quality: %s passed, %s critical failure(s), %s warning(s).",
        len(report.passed),
        len(report.critical_failures),
        len(report.warnings),
    )

    raw_files, sample_files = _write_all(config, datasets, output_dir)

    # The run must reach its terminal status BEFORE the database step, because the
    # database step is what writes audit.pipeline_run. Finishing afterwards left every
    # persisted run stuck at status 'running' with a null completed_at, even for runs
    # that succeeded, which in turn made reporting.vw_pipeline_run_summary report a
    # null duration for completed work. The terminal status depends only on the
    # validation report, and whether the load will be attempted is decided separately,
    # so both are known at this point.
    skip_reason = _load_skip_reason(config, load_database=load_database)
    run.finish(
        STATUS_FAILED if report.has_critical_failure else STATUS_SUCCEEDED,
        notes=(
            "database load skipped: " + skip_reason
            if skip_reason is not None
            else "database load completed"
        ),
    )
    _LOGGER.info("Finished %s with status %s.", run.pipeline_name, run.status)

    loaded, load_result = _load_if_possible(
        config, datasets, recorder, skip_reason=skip_reason, sql_root=sql_root
    )

    return FoundationRunResult(
        run=run,
        report=recorder.report,
        datasets=datasets,
        raw_files=raw_files,
        sample_files=sample_files,
        database_loaded=loaded,
        database_skip_reason=skip_reason,
        load_result=load_result,
        recorder=recorder,
    )


def generate_all_datasets(config: ArpiConfig) -> tuple[GeneratedDataset, ...]:
    """Generate every entity of the slice, in :data:`GENERATION_ORDER`.

    Each generator is seeded from its own namespace, so the tuple is deterministic for a
    given ``random_seed`` and adding an entity cannot perturb one already here.

    Args:
        config: Resolved configuration.

    Returns:
        The generated datasets, in dependency order.
    """
    datasets = (
        generate_date_dataset(config),
        generate_dealership_dataset(config),
        generate_vehicle_model_dataset(config),
        generate_vehicle_dataset(config),
        generate_employee_dataset(config),
        generate_customer_dataset(config),
        generate_lead_source_dataset(config),
        generate_marketing_campaign_dataset(config),
        generate_finance_product_dataset(config),
        generate_lender_dataset(config),
        generate_acquisition_dataset(config),
        generate_sale_dataset(config),
        generate_inventory_snapshot_dataset(config),
        generate_lead_dataset(config),
        generate_appointment_dataset(config),
        generate_marketing_spend_dataset(config),
        generate_sales_target_dataset(config),
        generate_finance_product_sale_dataset(config),
        generate_finance_product_adjustment_dataset(config),
    )
    produced = tuple(dataset.entity_name for dataset in datasets)
    if produced != GENERATION_ORDER:
        # A generator that renamed its entity would otherwise be discovered much later,
        # as a missing ingestion spec or an empty warehouse table.
        raise AssertionError(
            f"Generated entities {produced} do not match GENERATION_ORDER "
            f"{GENERATION_ORDER}; a generator's declared entity_name changed."
        )
    return datasets


def validate_all_datasets(
    datasets: Sequence[GeneratedDataset], config: ArpiConfig
) -> ValidationReport:
    """Run every entity's data-quality suite plus the cross-entity generation checks.

    The per-entity suites live beside their generators; this function is only the
    dispatch. The result is reconciled against the check registry so that a registered
    check which could not be evaluated is recorded as ``skipped`` rather than being
    silently absent -- an absent check reads exactly like a passing one.

    Args:
        datasets: Every dataset this run produced, as returned by
            :func:`generate_all_datasets`.
        config: Resolved configuration.

    Returns:
        One combined report covering every entity in ``datasets``.
    """
    by_entity = {dataset.entity_name: dataset for dataset in datasets}
    report = ValidationReport.combine(
        validate_date_dataset(by_entity[ENTITY_DIM_DATE], config),
        validate_dealership_dataset(by_entity[ENTITY_DIM_DEALERSHIP], config),
        validate_vehicle_model_dataset(by_entity[ENTITY_DIM_VEHICLE_MODEL]),
        validate_vehicle_dataset(by_entity[ENTITY_DIM_VEHICLE], catalogued_models_for(config)),
        validate_employee_dataset(by_entity[ENTITY_DIM_EMPLOYEE], config),
        validate_customer_dataset(by_entity[ENTITY_DIM_CUSTOMER], config),
        validate_lead_source_dataset(by_entity[ENTITY_DIM_LEAD_SOURCE]),
        validate_marketing_campaign_dataset(by_entity[ENTITY_DIM_MARKETING_CAMPAIGN]),
        validate_finance_product_dataset(by_entity[ENTITY_DIM_FINANCE_PRODUCT]),
        validate_lender_dataset(by_entity[ENTITY_DIM_LENDER]),
        validate_acquisition_dataset(by_entity[ENTITY_ACQUISITION_EVENT], config),
        validate_sale_dataset(by_entity[ENTITY_SALE_EVENT], config),
        validate_inventory_snapshot_dataset(by_entity[ENTITY_INVENTORY_SNAPSHOT_EVENT], config),
        validate_lead_dataset(by_entity[ENTITY_LEAD_EVENT], config),
        validate_appointment_dataset(by_entity[ENTITY_APPOINTMENT_EVENT], config),
        validate_marketing_spend_dataset(by_entity[ENTITY_MARKETING_SPEND], config),
        validate_sales_target_dataset(by_entity[ENTITY_SALES_TARGET], config),
        validate_finance_product_sale_dataset(by_entity[ENTITY_FINANCE_PRODUCT_SALE], config),
        validate_finance_product_adjustment_dataset(
            by_entity[ENTITY_FINANCE_PRODUCT_ADJUSTMENT], config
        ),
        validate_generation(datasets, config),
    )
    return ensure_registry_coverage(report, entities=tuple(by_entity))


def _write_all(
    config: ArpiConfig,
    datasets: tuple[GeneratedDataset, ...],
    output_dir: Path | str | None,
) -> tuple[tuple[WrittenEntity, ...], tuple[WrittenEntity, ...]]:
    """Write the raw outputs and, when configured, the capped sample outputs."""
    raw_base = (
        output_dir if output_dir is not None else config.paths.raw_output_dir / config.profile
    )
    raw_dir = resolve_output_dir(raw_base, config)
    raw_files, raw_manifest = write_outputs(config, datasets, raw_dir)
    _LOGGER.info("Wrote raw outputs to %s (manifest %s).", raw_dir, raw_manifest.name)

    if not config.generation.write_sample_outputs:
        return raw_files, ()

    sample_dir = resolve_output_dir(config.paths.sample_output_dir, config)
    sample_files, sample_manifest = write_outputs(
        config, datasets, sample_dir, row_limit=config.generation.sample_row_limit
    )
    _LOGGER.info("Wrote sample outputs to %s (manifest %s).", sample_dir, sample_manifest.name)
    return raw_files, sample_files


def _load_skip_reason(config: ArpiConfig, *, load_database: bool | None) -> str | None:
    """Decide whether the database step will run.

    Args:
        config: The resolved configuration.
        load_database: An explicit override, or ``None`` to follow ``database.enabled``.

    Returns:
        ``None`` when the load should proceed, otherwise a human-readable reason the
        step is being skipped. Skipping is never a failure: the slice is designed to
        run without PostgreSQL.
    """
    wanted = config.database.enabled if load_database is None else load_database
    if not wanted:
        _LOGGER.info("Database load skipped: %s", SKIP_REASON_NOT_REQUESTED)
        return SKIP_REASON_NOT_REQUESTED

    if not database_available(config):
        reason = (
            "PostgreSQL is not reachable with the current configuration "
            f"(database.enabled={config.database.enabled}); see the INFO log above for "
            "the specific cause"
        )
        _LOGGER.warning("Database load skipped: %s", reason)
        return reason

    return None


def _load_if_possible(
    config: ArpiConfig,
    datasets: tuple[GeneratedDataset, ...],
    recorder: AuditRecorder,
    *,
    skip_reason: str | None,
    sql_root: Path,
) -> tuple[bool, LoadResult | None]:
    """Run the database step unless it was already decided to be skipped."""
    if skip_reason is not None:
        return False, None

    result = load_foundation(config, datasets, recorder, sql_root=sql_root)
    _LOGGER.info(
        "Database load complete: %s.",
        ", ".join(
            f"{entity}={count}" for entity, count in sorted(result.warehouse_row_counts.items())
        ),
    )
    return True, result
