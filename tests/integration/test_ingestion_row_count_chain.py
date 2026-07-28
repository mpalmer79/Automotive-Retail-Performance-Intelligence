"""The five-layer ingestion row-count chain, proved end to end against PostgreSQL.

This module is what closes ``DOC-23``. That backlog item is explicit about why a weaker
test would not: *"a staging count that is unconditionally equal to the raw count would
prove nothing."* So the fixture here is deliberately defective. Six rows land in ``raw``
and only two reach the warehouse:

===  ==================================  ================
Row  Defect                              Rejection code
===  ==================================  ================
1    duplicated by row 5                 ``REJ-KEY-001``
2    none                                accepted
3    ``model_year`` is not a number       ``REJ-TYPE-001``
4    ``body_style`` is not in its domain  ``REJ-DOMAIN-001``
5    none (supersedes row 1)              accepted
6    ``trim`` is empty                    ``REJ-NULL-001``
===  ==================================  ================

Every layer of the chain is then asserted against the database, and the chain identity
``raw = staging accepted + rejected + deduplicated`` is checked as an equation whose
terms were each measured separately. If staging silently passed everything through, if
the rejected view stopped classifying a defect, or if the loader stopped recording a
layer, one of these assertions fails.

The load runs through :func:`arpi.ingestion.loader.load_foundation` -- the real code path
the CLI uses -- not through hand-written SQL, so the COPY, the merge invocation, the
count collection, the redaction and the audit writes are all covered.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
import psycopg
import pytest
from pydantic import SecretStr
from tests.integration.conftest import (
    base_connection_kwargs,
    connection_password,
    run_init_sequence,
)

from arpi.audit.run import LAYER_SOURCE, AuditRecorder, PipelineRun
from arpi.config import ArpiConfig, load_config
from arpi.ingestion.loader import load_foundation
from arpi.ingestion.rejection import LINEAGE_PAYLOAD_KEY
from arpi.ingestion.spec import spec_for

pytestmark = pytest.mark.integration

REPO_ROOT = Path(__file__).resolve().parents[2]
REPO_CONFIG_DIR = REPO_ROOT / "config"
SQL_ROOT = REPO_ROOT / "sql"

ENTITY = "vehicle_model"

#: The declared column contract of the vehicle model entity, in contract order.
VEHICLE_MODEL_COLUMNS: tuple[str, ...] = (
    "vehicle_model_key",
    "vehicle_model_id",
    "model_year",
    "make",
    "model",
    "trim",
    "body_style",
    "vehicle_class",
    "fuel_type",
    "drivetrain",
    "transmission",
    "doors",
    "seating_capacity",
    "franchise_alignment",
    "is_current_model_line",
    "source_system",
)

#: Six deliberately imperfect source rows. See the module docstring for the defect table.
VEHICLE_MODEL_ROWS: tuple[tuple[str, ...], ...] = (
    # 1. Superseded later by row 5 -> REJ-KEY-001.
    (
        "1",
        "VMD-00001",
        "2024",
        "Chevrolet",
        "Equinox",
        "LT",
        "SUV",
        "Midsize",
        "Gasoline",
        "AWD",
        "Automatic",
        "5",
        "5",
        "Chevrolet",
        "true",
        "arpi_synthetic_generator",
    ),
    # 2. Clean.
    (
        "2",
        "VMD-00002",
        "2023",
        "Subaru",
        "Outback",
        "Premium",
        "Wagon",
        "Midsize",
        "Gasoline",
        "AWD",
        "CVT",
        "5",
        "5",
        "Subaru",
        "true",
        "arpi_synthetic_generator",
    ),
    # 3. model_year cannot be cast to smallint -> REJ-TYPE-001.
    (
        "3",
        "VMD-00003",
        "not-a-year",
        "Chevrolet",
        "Malibu",
        "LS",
        "Sedan",
        "Midsize",
        "Gasoline",
        "FWD",
        "Automatic",
        "4",
        "5",
        "Chevrolet",
        "true",
        "arpi_synthetic_generator",
    ),
    # 4. body_style is outside its enumerated domain -> REJ-DOMAIN-001.
    (
        "4",
        "VMD-00004",
        "2024",
        "Chevrolet",
        "Blazer",
        "RS",
        "Spaceship",
        "Midsize",
        "Gasoline",
        "AWD",
        "Automatic",
        "5",
        "5",
        "Chevrolet",
        "true",
        "arpi_synthetic_generator",
    ),
    # 5. Clean, and supersedes row 1 because its raw_record_id is higher.
    (
        "5",
        "VMD-00001",
        "2024",
        "Chevrolet",
        "Equinox",
        "LT",
        "SUV",
        "Midsize",
        "Gasoline",
        "AWD",
        "Automatic",
        "5",
        "5",
        "Chevrolet",
        "false",
        "arpi_synthetic_generator",
    ),
    # 6. trim is required and absent -> REJ-NULL-001.
    (
        "6",
        "VMD-00006",
        "2024",
        "Chevrolet",
        "Trax",
        "",
        "Crossover",
        "Compact",
        "Gasoline",
        "FWD",
        "Automatic",
        "5",
        "5",
        "Chevrolet",
        "true",
        "arpi_synthetic_generator",
    ),
)

EXPECTED_RAW = 6
EXPECTED_STAGING = 2
EXPECTED_REJECTED_INVALID = 3
EXPECTED_DEDUPLICATED = 1
EXPECTED_WAREHOUSE = 2


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def chain_database(maintenance_connection: Any) -> Iterator[str]:
    """A database used only by this module.

    These tests commit rows through the production load path, so they cannot share the
    session-scoped database with tests that assert on a clean warehouse.
    """
    database_name = f"arpi_chain_{uuid4().hex[:12]}"
    with maintenance_connection.cursor() as cursor:
        cursor.execute(f'CREATE DATABASE "{database_name}"')
    try:
        with psycopg.connect(dbname=database_name, **base_connection_kwargs()) as conn:
            run_init_sequence(conn)
        yield database_name
    finally:
        with maintenance_connection.cursor() as cursor:
            cursor.execute(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')


@pytest.fixture()
def chain_config(chain_database: str) -> ArpiConfig:
    """A test-profile configuration pointed at this module's throwaway database."""
    connection = base_connection_kwargs()
    config = load_config(profile="test", config_dir=REPO_CONFIG_DIR)
    password = connection_password()
    database_update: dict[str, Any] = {
        "enabled": True,
        "host": connection.get("host"),
        "port": connection.get("port", 5432),
        "name": chain_database,
        "user": connection.get("user"),
        "sslmode": connection.get("sslmode", config.database.sslmode),
    }
    if password is not None:
        database_update["password"] = SecretStr(password)
    return config.model_copy(
        update={"database": config.database.model_copy(update=database_update)}
    )


@pytest.fixture()
def observer(chain_database: str) -> Iterator[Any]:
    """Non-transactional connection used to observe what the loader committed."""
    with psycopg.connect(dbname=chain_database, **base_connection_kwargs()) as conn:
        yield conn


@pytest.fixture(autouse=True)
def clean_state(observer: Any) -> Iterator[None]:
    """Remove everything this module writes, before and after each test."""
    _truncate(observer)
    yield
    _truncate(observer)


def _truncate(connection: Any) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "TRUNCATE raw.vehicle_model_load, warehouse.dim_vehicle_model, "
            "audit.pipeline_run RESTART IDENTITY CASCADE"
        )
    connection.commit()


@pytest.fixture()
def defective_dataset() -> Any:
    """The six-row fixture as a :class:`~arpi.generation.base.GeneratedDataset`."""
    from arpi.generation.base import GeneratedDataset

    frame = pd.DataFrame(list(VEHICLE_MODEL_ROWS), columns=list(VEHICLE_MODEL_COLUMNS))
    return GeneratedDataset(
        entity_name=ENTITY,
        frame=frame,
        declared_columns=VEHICLE_MODEL_COLUMNS,
        namespace=ENTITY,
    )


@pytest.fixture()
def loaded(chain_config: ArpiConfig, defective_dataset: Any) -> Any:
    """Run the real loader over the defective fixture and return its result."""
    run = PipelineRun.start(chain_config, pipeline_name="phase1_ingestion_chain")
    recorder = AuditRecorder(run=run)
    # pipeline.py records the source layer before the database step; mirrored here so the
    # persisted chain has all five layers rather than the four the loader itself writes.
    recorder.record_row_count(ENTITY, LAYER_SOURCE, defective_dataset.row_count)
    run.finish("succeeded", notes="row-count chain fixture")
    result = load_foundation(chain_config, [defective_dataset], recorder, sql_root=SQL_ROOT)
    return result, recorder


def _rows(connection: Any, statement: str, parameters: tuple[Any, ...] = ()) -> list[Any]:
    with connection.cursor() as cursor:
        cursor.execute(statement, parameters)
        return list(cursor.fetchall())


def _scalar(connection: Any, statement: str, parameters: tuple[Any, ...] = ()) -> Any:
    rows = _rows(connection, statement, parameters)
    return None if not rows else rows[0][0]


# --------------------------------------------------------------------------------------
# The chain itself
# --------------------------------------------------------------------------------------


def test_staging_drops_rows_that_raw_accepted(loaded: Any, observer: Any) -> None:
    """Raw holds every row; staging holds only the two that are usable.

    This is the assertion DOC-23 asks for first: staging is NOT unconditionally equal to
    raw. If this ever passes trivially -- because the counts became equal -- the whole
    chain test below is worthless, so it is asserted on its own.
    """
    raw_rows = _scalar(observer, "SELECT count(*) FROM raw.vehicle_model_load")
    staging_rows = _scalar(observer, "SELECT count(*) FROM staging.stg_vehicle_model")
    rejected_rows = _scalar(observer, "SELECT count(*) FROM staging.stg_vehicle_model_rejected")

    assert raw_rows == EXPECTED_RAW
    assert staging_rows == EXPECTED_STAGING
    assert rejected_rows == EXPECTED_RAW - EXPECTED_STAGING
    assert staging_rows < raw_rows, "staging must be able to drop a row, or it proves nothing"


def test_every_layer_of_the_chain_has_the_expected_count(loaded: Any) -> None:
    """Each of the five layers is measured, and each has the count the fixture implies."""
    result, _ = loaded
    counts = result.layer_counts[ENTITY]

    assert counts.raw == EXPECTED_RAW
    assert counts.staging == EXPECTED_STAGING
    assert counts.rejected_invalid == EXPECTED_REJECTED_INVALID
    assert counts.deduplicated == EXPECTED_DEDUPLICATED
    assert counts.rejected_total == EXPECTED_REJECTED_INVALID + EXPECTED_DEDUPLICATED
    assert counts.warehouse == EXPECTED_WAREHOUSE


def test_the_chain_identity_balances(loaded: Any) -> None:
    """``raw = staging accepted + rejected + deduplicated``, term by term.

    Each term came from a separate query, so this is an equation about the load rather
    than an arithmetic tautology.
    """
    result, _ = loaded
    counts = result.layer_counts[ENTITY]

    assert counts.raw == counts.staging + counts.rejected_invalid + counts.deduplicated
    assert counts.chain_balances


def test_accepted_staging_rows_all_reached_the_warehouse(loaded: Any) -> None:
    """``staging_accepted = warehouse_inserted_or_matched``: nothing was lost in the merge."""
    result, _ = loaded
    counts = result.layer_counts[ENTITY]

    assert counts.staging_keys == EXPECTED_STAGING
    assert counts.warehouse_matched == counts.staging_keys


def test_all_five_layers_are_persisted_for_the_run(loaded: Any, observer: Any) -> None:
    """``audit.pipeline_run_row_count`` records source, raw, staging, warehouse, rejected.

    Phase 0 recorded only three of the five, which is the gap DOC-23 registered.
    """
    persisted = dict(
        _rows(
            observer,
            "SELECT layer, row_count FROM audit.pipeline_run_row_count WHERE entity_name = %s",
            (ENTITY,),
        )
    )

    assert set(persisted) == {"source", "raw", "staging", "warehouse", "rejected"}
    assert persisted["source"] == EXPECTED_RAW
    assert persisted["raw"] == EXPECTED_RAW
    assert persisted["staging"] == EXPECTED_STAGING
    assert persisted["rejected"] == EXPECTED_REJECTED_INVALID + EXPECTED_DEDUPLICATED
    assert persisted["warehouse"] == EXPECTED_WAREHOUSE
    # The persisted numbers balance too, not only the in-memory ones.
    assert persisted["raw"] == persisted["staging"] + persisted["rejected"]


def test_the_chain_reconciliation_is_recorded_and_passes(loaded: Any, observer: Any) -> None:
    """A ``RECON-INGEST-*-CHAIN`` result exists for the entity and reports ``passed``."""
    entity_spec = spec_for(ENTITY)
    assert entity_spec.chain_reconciliation_id == "RECON-INGEST-VEHICLE-MODEL-CHAIN"

    rows = _rows(
        observer,
        "SELECT reconciliation_id, left_value, right_value, difference, status "
        "FROM audit.reconciliation_result WHERE reconciliation_id = %s",
        (entity_spec.chain_reconciliation_id,),
    )
    assert len(rows) == 1
    _, left_value, right_value, difference, status = rows[0]
    assert int(left_value) == EXPECTED_RAW
    assert int(right_value) == EXPECTED_RAW
    assert int(difference) == 0
    assert status == "passed"


def test_the_warehouse_reconciliation_is_recorded_and_passes(loaded: Any, observer: Any) -> None:
    """A ``RECON-INGEST-*-WAREHOUSE`` result proves every accepted key was loaded."""
    entity_spec = spec_for(ENTITY)
    rows = _rows(
        observer,
        "SELECT left_value, right_value, status FROM audit.reconciliation_result "
        "WHERE reconciliation_id = %s",
        (entity_spec.warehouse_reconciliation_id,),
    )
    assert len(rows) == 1
    left_value, right_value, status = rows[0]
    assert int(left_value) == EXPECTED_STAGING
    assert int(right_value) == EXPECTED_STAGING
    assert status == "passed"


# --------------------------------------------------------------------------------------
# The rejected-record path
# --------------------------------------------------------------------------------------


def test_every_dropped_row_is_quarantined_with_its_code(loaded: Any, observer: Any) -> None:
    """Four rows were dropped and four rows are in ``audit.rejected_record``, each coded."""
    rows = _rows(
        observer,
        "SELECT rejection_code, source_record_key, rejection_reason "
        "FROM audit.rejected_record WHERE source_entity = %s ORDER BY rejected_record_id",
        (ENTITY,),
    )
    assert len(rows) == EXPECTED_REJECTED_INVALID + EXPECTED_DEDUPLICATED

    codes = {code for code, _, _ in rows}
    assert codes == {"REJ-KEY-001", "REJ-TYPE-001", "REJ-DOMAIN-001", "REJ-NULL-001"}

    by_code = {code: (key, reason) for code, key, reason in rows}
    assert by_code["REJ-KEY-001"][0] == "VMD-00001"
    assert by_code["REJ-TYPE-001"][0] == "VMD-00003"
    assert by_code["REJ-DOMAIN-001"][0] == "VMD-00004"
    assert by_code["REJ-NULL-001"][0] == "VMD-00006"

    # The offending column is named, so the defect is diagnosable from the audit row.
    assert "model_year" in by_code["REJ-TYPE-001"][1]
    assert "body_style" in by_code["REJ-DOMAIN-001"][1]
    assert "trim" in by_code["REJ-NULL-001"][1]


def test_each_rejection_carries_its_canonical_category(loaded: Any, observer: Any) -> None:
    """The rejection reason and payload both name the canonical validation category.

    ``audit.rejected_record`` has no ``rejection_category`` column, so the category is
    carried as a machine-readable prefix on the reason and inside the payload's lineage
    object. Both must agree.
    """
    rows = _rows(
        observer,
        "SELECT rejection_code, rejection_reason, record_payload "
        "FROM audit.rejected_record WHERE source_entity = %s",
        (ENTITY,),
    )
    expected = {
        "REJ-TYPE-001": "structural",
        "REJ-NULL-001": "completeness",
        "REJ-DOMAIN-001": "business_rule",
        "REJ-KEY-001": "uniqueness",
    }
    for code, reason, payload in rows:
        category = expected[code]
        assert reason.startswith(f"[{category}] ")
        assert payload[LINEAGE_PAYLOAD_KEY]["rejection_category"] == category


def test_each_rejection_records_its_source_row_number(loaded: Any, observer: Any) -> None:
    """The source row number reaches the audit table through the payload lineage."""
    rows = _rows(
        observer,
        "SELECT rejection_code, record_payload FROM audit.rejected_record WHERE source_entity = %s",
        (ENTITY,),
    )
    row_numbers = {
        code: payload[LINEAGE_PAYLOAD_KEY]["source_row_number"] for code, payload in rows
    }
    assert row_numbers == {
        "REJ-KEY-001": 1,
        "REJ-TYPE-001": 3,
        "REJ-DOMAIN-001": 4,
        "REJ-NULL-001": 6,
    }
    for _, payload in rows:
        assert payload[LINEAGE_PAYLOAD_KEY]["source_file_name"] == "dim_vehicle_model.csv"
        assert payload[LINEAGE_PAYLOAD_KEY]["load_batch_id"]


def test_a_rejected_payload_never_carries_a_prohibited_value(loaded: Any, observer: Any) -> None:
    """Persisted payloads pass through the privacy redactor before they are written.

    The vehicle model entity has no prohibited column, so this asserts the property that
    must hold for every entity: the payload is the redactor's output. The redaction of an
    actually-prohibited key is asserted directly in ``tests/unit/test_ingestion.py``.
    """
    from arpi.ingestion.rejection import redact_payload

    payloads = [
        payload
        for (payload,) in _rows(
            observer,
            "SELECT record_payload FROM audit.rejected_record WHERE source_entity = %s",
            (ENTITY,),
        )
    ]
    assert payloads

    for payload in payloads:
        business = {key: value for key, value in payload.items() if key != LINEAGE_PAYLOAD_KEY}
        assert redact_payload(business) == business, (
            "a persisted payload must already be the redactor's output"
        )
        # Nothing that looks like a contact detail survived into the audit layer.
        serialised = json.dumps(business)
        assert "@" not in serialised


def test_rerunning_the_same_load_does_not_duplicate_the_audit_trail(
    chain_config: ArpiConfig, defective_dataset: Any, observer: Any
) -> None:
    """A second identical run replaces its own child rows rather than appending them."""

    def run_once() -> None:
        run = PipelineRun.start(chain_config, pipeline_name="phase1_ingestion_chain")
        recorder = AuditRecorder(run=run)
        recorder.record_row_count(ENTITY, LAYER_SOURCE, defective_dataset.row_count)
        run.finish("succeeded", notes="row-count chain fixture")
        load_foundation(chain_config, [defective_dataset], recorder, sql_root=SQL_ROOT)

    run_once()
    first = _scalar(
        observer,
        "SELECT count(*) FROM audit.rejected_record WHERE source_entity = %s",
        (ENTITY,),
    )
    run_once()
    second = _scalar(
        observer,
        "SELECT count(*) FROM audit.rejected_record WHERE source_entity = %s",
        (ENTITY,),
    )

    assert first == EXPECTED_REJECTED_INVALID + EXPECTED_DEDUPLICATED
    assert second == first, "a rerun must replace its rejected records, not accumulate them"
    # The second load lands a second raw batch, so raw grows while staging does not.
    assert _scalar(observer, "SELECT count(*) FROM raw.vehicle_model_load") == EXPECTED_RAW * 2
    assert _scalar(observer, "SELECT count(*) FROM staging.stg_vehicle_model") == EXPECTED_STAGING
    assert (
        _scalar(observer, "SELECT count(*) FROM warehouse.dim_vehicle_model") == EXPECTED_WAREHOUSE
    )


def test_the_surviving_duplicate_is_the_highest_raw_record_id(loaded: Any, observer: Any) -> None:
    """Deduplication keeps the last row for a natural key, deterministically."""
    is_current_model_line = _scalar(
        observer,
        "SELECT is_current_model_line FROM warehouse.dim_vehicle_model WHERE vehicle_model_id = %s",
        ("VMD-00001",),
    )
    # Row 5 sets the flag false; row 1 set it true. The later row must win.
    assert is_current_model_line is False
