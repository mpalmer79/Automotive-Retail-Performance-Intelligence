"""Optional psycopg handling, database probing and SQL discovery."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from arpi.config import ArpiConfig, load_config
from arpi.exceptions import DatabaseLoadError, DatabaseUnavailableError
from arpi.generation.base import GeneratedDataset
from arpi.ingestion import database
from arpi.ingestion.loader import (
    ENTITY_TABLES,
    MERGE_SQL_GLOB,
    RAW_METADATA_COLUMNS,
    discover_merge_sql,
    load_foundation,
    rows_for_copy,
)


@pytest.fixture
def db_config(repo_config_dir: Path) -> ArpiConfig:
    return load_config(
        profile="test",
        config_dir=repo_config_dir,
        env={
            "ARPI_DATABASE__ENABLED": "true",
            "ARPI_DATABASE__HOST": "127.0.0.1",
            "ARPI_DATABASE__PORT": "1",
            "ARPI_DATABASE__NAME": "arpi_absent",
            "ARPI_DATABASE__USER": "arpi_loader",
            "ARPI_DATABASE__PASSWORD": "s3cret",
            "ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS": "1",
        },
    )


def test_importing_arpi_does_not_require_psycopg() -> None:
    import arpi

    assert arpi.__version__ == "0.1.0"


def test_connection_kwargs_include_the_password(db_config: ArpiConfig) -> None:
    kwargs = database.connection_kwargs(db_config)
    assert kwargs["host"] == "127.0.0.1"
    assert kwargs["dbname"] == "arpi_absent"
    assert kwargs["connect_timeout"] == 1
    assert kwargs["password"] == "s3cret"


def test_connection_kwargs_omit_an_unset_password(test_config: ArpiConfig) -> None:
    assert "password" not in database.connection_kwargs(test_config)


def test_describe_target_contains_no_password(db_config: ArpiConfig) -> None:
    described = database.describe_target(db_config)
    assert described == "arpi_loader@127.0.0.1:1/arpi_absent"
    assert "s3cret" not in described


def test_require_psycopg_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(database, "PSYCOPG_AVAILABLE", False)
    with pytest.raises(DatabaseUnavailableError) as excinfo:
        database.require_psycopg()
    assert excinfo.value.reason == "psycopg_missing"
    assert "arpi[db]" in str(excinfo.value)


def test_require_psycopg_passes_when_available() -> None:
    database.require_psycopg()  # must not raise when the db extra is installed


def test_connect_refuses_a_disabled_database(test_config: ArpiConfig) -> None:
    with pytest.raises(DatabaseUnavailableError) as excinfo, database.connect(test_config):
        pass  # pragma: no cover - the context manager never opens
    assert excinfo.value.reason == "database_disabled"


def test_connect_reports_a_failed_connection(db_config: ArpiConfig) -> None:
    with pytest.raises(DatabaseUnavailableError) as excinfo, database.connect(db_config):
        pass  # pragma: no cover - the context manager never opens
    assert excinfo.value.reason == "connection_failed"
    assert "s3cret" not in str(excinfo.value)


def test_database_available_is_false_when_disabled(
    test_config: ArpiConfig, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("INFO", logger="arpi.ingestion.database"):
        assert database.database_available(test_config) is False
    assert "database.enabled is false" in caplog.text


def test_database_available_is_false_without_psycopg(
    db_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(database, "PSYCOPG_AVAILABLE", False)
    with caplog.at_level("INFO", logger="arpi.ingestion.database"):
        assert database.database_available(db_config) is False
    assert "psycopg is not installed" in caplog.text


def test_database_available_is_false_when_unreachable(
    db_config: ArpiConfig, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("INFO", logger="arpi.ingestion.database"):
        assert database.database_available(db_config) is False
    assert "s3cret" not in caplog.text


def test_discover_merge_sql_sorts_results(tmp_path: Path) -> None:
    directory = tmp_path / "03_dimensions"
    directory.mkdir()
    for name in ("20_dim_dealership_merge.sql", "10_dim_date_merge.sql", "readme.md"):
        (directory / name).write_text("-- sql", encoding="utf-8")
    assert [path.name for path in discover_merge_sql(tmp_path)] == [
        "10_dim_date_merge.sql",
        "20_dim_dealership_merge.sql",
    ]


def test_discover_merge_sql_reports_a_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(DatabaseLoadError) as excinfo:
        discover_merge_sql(tmp_path)
    assert excinfo.value.missing_paths == (tmp_path / "03_dimensions",)
    assert "03_dimensions" in str(excinfo.value)


def test_discover_merge_sql_reports_an_empty_directory(tmp_path: Path) -> None:
    (tmp_path / "03_dimensions").mkdir()
    with pytest.raises(DatabaseLoadError) as excinfo:
        discover_merge_sql(tmp_path)
    assert MERGE_SQL_GLOB in str(excinfo.value)
    assert "refused" in str(excinfo.value)


def test_rows_for_copy_appends_the_metadata_columns(
    dealership_dataset: GeneratedDataset,
) -> None:
    batch = uuid.UUID("11111111-2222-3333-4444-555555555555")
    rows = list(
        rows_for_copy(
            dealership_dataset.frame, load_batch_id=batch, source_file_name="dim_dealership.csv"
        )
    )
    assert len(rows) == 3
    assert len(rows[0]) == dealership_dataset.column_count + len(RAW_METADATA_COLUMNS)
    assert rows[0][-3:] == (str(batch), "dim_dealership.csv", 1)
    assert rows[2][-1] == 3
    assert all(isinstance(value, str) for value in rows[0][: dealership_dataset.column_count])


def test_rows_for_copy_renders_null_as_empty(dealership_dataset: GeneratedDataset) -> None:
    rows = list(
        rows_for_copy(
            dealership_dataset.frame,
            load_batch_id=uuid.uuid4(),
            source_file_name="dim_dealership.csv",
        )
    )
    franchise_index = dealership_dataset.actual_columns.index("franchise_brand")
    assert rows[2][franchise_index] == ""


def test_entity_tables_cover_both_dimensions() -> None:
    assert {"dim_date", "dim_dealership"} <= set(ENTITY_TABLES)
    assert ENTITY_TABLES["dim_date"] == ("calendar_date_load", "dim_date")
    assert ENTITY_TABLES["dim_dealership"] == ("dealership_load", "dim_dealership")


def test_entity_tables_is_a_projection_of_the_spec_registry() -> None:
    from arpi.ingestion.spec import ENTITY_SPECS

    expected = {
        spec.entity_name: (spec.raw_table, spec.warehouse_table)
        for spec in ENTITY_SPECS
        if spec.warehouse_table is not None
    }
    assert expected == ENTITY_TABLES


def test_every_registered_spec_is_internally_consistent() -> None:
    from arpi.ingestion.spec import ENTITY_SPECS, spec_for

    assert len({spec.entity_name for spec in ENTITY_SPECS}) == len(ENTITY_SPECS)
    for spec in ENTITY_SPECS:
        assert spec_for(spec.entity_name) is spec
        assert spec.natural_key
        assert spec.warehouse_match_key == spec.natural_key[0]
        assert spec.chain_reconciliation_id.startswith("RECON-INGEST-")
        assert spec.chain_reconciliation_id.endswith("-CHAIN")
        assert spec.warehouse_reconciliation_id.endswith("-WAREHOUSE")
        if spec.warehouse_table is None:
            assert spec.merge_script is None


def test_spec_for_names_the_registered_entities_when_it_fails() -> None:
    from arpi.ingestion.spec import spec_for

    with pytest.raises(DatabaseLoadError, match="dim_date") as excinfo:
        spec_for("not_an_entity")
    assert excinfo.value.entity == "not_an_entity"


def test_a_spec_must_declare_a_natural_key() -> None:
    from arpi.ingestion.spec import EntityIngestionSpec

    with pytest.raises(ValueError, match="natural_key"):
        EntityIngestionSpec(
            entity_name="broken",
            raw_table="broken_load",
            staging_view="stg_broken",
            warehouse_table=None,
            natural_key=(),
            merge_script=None,
        )


def test_load_foundation_rejects_an_unknown_entity(
    db_config: ArpiConfig, date_dataset: GeneratedDataset
) -> None:
    from arpi.audit.run import AuditRecorder, PipelineRun

    unknown = GeneratedDataset(
        "fact_vehicle_sale", date_dataset.frame, date_dataset.declared_columns, "x"
    )
    recorder = AuditRecorder(run=PipelineRun.start(db_config, pipeline_name="test"))
    with pytest.raises(DatabaseLoadError, match="fact_vehicle_sale"):
        load_foundation(db_config, [unknown], recorder)


def test_load_foundation_refuses_to_run_without_merge_sql(
    db_config: ArpiConfig, date_dataset: GeneratedDataset, tmp_path: Path
) -> None:
    from arpi.audit.run import AuditRecorder, PipelineRun

    recorder = AuditRecorder(run=PipelineRun.start(db_config, pipeline_name="test"))
    with pytest.raises(DatabaseLoadError, match="03_dimensions"):
        load_foundation(db_config, [date_dataset], recorder, sql_root=tmp_path)


class _StubError(Exception):
    """Stand-in for ``psycopg.Error``."""


class _StubCursor:
    def __init__(self, fail: bool) -> None:
        self.fail = fail
        self.statements: list[str] = []

    def __enter__(self) -> _StubCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, statement: str) -> None:
        if self.fail:
            raise _StubError("probe rejected")
        self.statements.append(statement)


class _StubConnection:
    def __init__(self, fail: bool) -> None:
        self.fail = fail
        self.closed = False

    def cursor(self) -> _StubCursor:
        return _StubCursor(self.fail)

    def close(self) -> None:
        self.closed = True


class _StubPsycopg:
    Error = _StubError

    def __init__(self, *, fail_probe: bool = False) -> None:
        self.fail_probe = fail_probe
        self.opened: list[_StubConnection] = []

    def connect(self, **kwargs: object) -> _StubConnection:
        connection = _StubConnection(self.fail_probe)
        self.opened.append(connection)
        return connection


def test_connect_yields_and_always_closes(
    db_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = _StubPsycopg()
    monkeypatch.setattr(database, "psycopg", stub)
    with database.connect(db_config) as connection:
        assert connection is stub.opened[0]
        assert connection.closed is False
    assert stub.opened[0].closed is True


def test_database_available_is_true_when_the_probe_succeeds(
    db_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(database, "psycopg", _StubPsycopg())
    with caplog.at_level("INFO", logger="arpi.ingestion.database"):
        assert database.database_available(db_config) is True
    assert "Database reachable" in caplog.text
    assert "s3cret" not in caplog.text


def test_database_available_is_false_when_the_probe_query_fails(
    db_config: ArpiConfig, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(database, "psycopg", _StubPsycopg(fail_probe=True))
    with caplog.at_level("INFO", logger="arpi.ingestion.database"):
        assert database.database_available(db_config) is False
    assert "probe query failed" in caplog.text


class _RecordingCopy:
    def __init__(self, sink: list[tuple[object, ...]]) -> None:
        self.sink = sink

    def __enter__(self) -> _RecordingCopy:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def write_row(self, row: tuple[object, ...]) -> None:
        self.sink.append(row)


class _RecordingCursor:
    def __init__(self, owner: _RecordingConnection) -> None:
        self.owner = owner

    def __enter__(self) -> _RecordingCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def copy(self, statement: object) -> _RecordingCopy:
        self.owner.copy_statements.append(statement)
        return _RecordingCopy(self.owner.copied_rows)

    def execute(self, statement: object, params: tuple[object, ...] | None = None) -> None:
        self.owner.executed.append((statement, params))

    def fetchone(self) -> tuple[object, ...]:
        return self.owner.responses.pop(0)


class _RecordingConnection:
    def __init__(self, responses: list[tuple[object, ...]]) -> None:
        self.responses = responses
        self.copy_statements: list[object] = []
        self.copied_rows: list[tuple[object, ...]] = []
        self.executed: list[tuple[object, tuple[object, ...] | None]] = []
        self.commits = 0
        self.closed = False

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        self.closed = True


class _RecordingPsycopg:
    Error = _StubError

    def __init__(self, connection: _RecordingConnection) -> None:
        self.connection = connection

    def connect(self, **kwargs: object) -> _RecordingConnection:
        return self.connection


def test_load_foundation_copies_merges_counts_and_audits(
    db_config: ArpiConfig,
    date_dataset: GeneratedDataset,
    dealership_dataset: GeneratedDataset,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from arpi.audit.run import AuditRecorder, PipelineRun

    sql_dir = tmp_path / "03_dimensions"
    sql_dir.mkdir()
    (sql_dir / "10_dim_date_merge.sql").write_text("-- merge date", encoding="utf-8")
    (sql_dir / "20_dim_dealership_merge.sql").write_text("-- merge dealership", encoding="utf-8")

    # Six scalar queries per entity, in the order _collect_layer_counts issues them:
    # raw, staging, distinct staging keys, deduplicated, warehouse, warehouse-matched.
    # The final response is the pipeline_run_id returned by the audit insert.
    connection = _RecordingConnection(
        [
            (59,),
            (59,),
            (59,),
            (59,),
            (59,),
            (59,),
            (3,),
            (3,),
            (3,),
            (3,),
            (3,),
            (3,),
            (1,),
        ]
    )
    monkeypatch.setattr(database, "psycopg", _RecordingPsycopg(connection))

    recorder = AuditRecorder(run=PipelineRun.start(db_config, pipeline_name="test"))
    result = load_foundation(
        db_config, [date_dataset, dealership_dataset], recorder, sql_root=tmp_path
    )

    assert result.raw_row_counts == {"dim_date": 59, "dim_dealership": 3}
    assert result.warehouse_row_counts == {"dim_date": 59, "dim_dealership": 3}
    assert all(counts.chain_balances for counts in result.layer_counts.values())
    assert result.rejected_records == ()
    assert [path.name for path in result.executed_sql] == [
        "10_dim_date_merge.sql",
        "20_dim_dealership_merge.sql",
    ]
    assert len(connection.copy_statements) == 2
    assert len(connection.copied_rows) == 62
    assert connection.commits == 4
    assert connection.closed is True

    # Every audit statement is parameterised: values travel outside the SQL text.
    audit_statements = [item for item in connection.executed if item[1] is not None]
    assert audit_statements
    assert all(isinstance(params, tuple) for _, params in audit_statements)

    # DOC-23: all four database-side layers are recorded, not just raw and warehouse.
    layers = {(row.entity_name, row.layer) for row in recorder.row_counts}
    assert layers == {
        ("dim_date", "raw"),
        ("dim_date", "staging"),
        ("dim_date", "rejected"),
        ("dim_date", "warehouse"),
        ("dim_dealership", "raw"),
        ("dim_dealership", "staging"),
        ("dim_dealership", "rejected"),
        ("dim_dealership", "warehouse"),
    }
    assert [item.reconciliation_id for item in recorder.reconciliation_results] == [
        "RECON-INGEST-DIM-DATE-CHAIN",
        "RECON-INGEST-DIM-DATE-WAREHOUSE",
        "RECON-DIM-DATE-ROWCOUNT",
        "RECON-INGEST-DIM-DEALERSHIP-CHAIN",
        "RECON-INGEST-DIM-DEALERSHIP-WAREHOUSE",
        "RECON-DIM-DEALERSHIP-ROWCOUNT",
    ]
    assert all(item.status == "passed" for item in recorder.reconciliation_results)


def test_load_foundation_reports_a_row_count_mismatch(
    db_config: ArpiConfig,
    date_dataset: GeneratedDataset,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from arpi.audit.run import AuditRecorder, PipelineRun

    sql_dir = tmp_path / "03_dimensions"
    sql_dir.mkdir()
    (sql_dir / "10_dim_date_merge.sql").write_text("-- merge", encoding="utf-8")

    # raw, staging, staging keys, deduplicated, warehouse, warehouse-matched, run id.
    # The warehouse holds one row fewer than the generator produced.
    connection = _RecordingConnection([(59,), (59,), (59,), (59,), (58,), (58,), (1,)])
    monkeypatch.setattr(database, "psycopg", _RecordingPsycopg(connection))

    recorder = AuditRecorder(run=PipelineRun.start(db_config, pipeline_name="test"))
    load_foundation(db_config, [date_dataset], recorder, sql_root=tmp_path)

    by_id = {item.reconciliation_id: item for item in recorder.reconciliation_results}
    # The raw-to-staging chain still balances: nothing was lost before the warehouse.
    assert by_id["RECON-INGEST-DIM-DATE-CHAIN"].status == "passed"
    # The staging-to-warehouse comparison is what fails, and it names the missing row.
    assert by_id["RECON-INGEST-DIM-DATE-WAREHOUSE"].status == "failed"
    assert by_id["RECON-INGEST-DIM-DATE-WAREHOUSE"].difference == pytest.approx(1.0)
    assert by_id["RECON-DIM-DATE-ROWCOUNT"].status == "failed"
    assert by_id["RECON-DIM-DATE-ROWCOUNT"].difference == pytest.approx(1.0)


# --------------------------------------------------------------------------------------
# The rejected-record path: nothing prohibited may ever be persisted
# --------------------------------------------------------------------------------------


def test_redact_payload_masks_a_prohibited_column() -> None:
    from arpi.constants import REDACTED_PLACEHOLDER
    from arpi.ingestion.rejection import redact_payload

    redacted = redact_payload(
        {
            "customer_id": "CUS-00000001",
            "customer_email": "someone@example.test",
            "home_phone_number": "555-0100",
            "age_band": "35-44",
            "county": "Hillsborough",
        }
    )

    # Keys survive so the shape of the offending row stays diagnosable.
    assert set(redacted) == {
        "customer_id",
        "customer_email",
        "home_phone_number",
        "age_band",
        "county",
    }
    assert redacted["customer_email"] == REDACTED_PLACEHOLDER
    assert redacted["home_phone_number"] == REDACTED_PLACEHOLDER
    # Values that are legitimately published are not destroyed.
    assert redacted["customer_id"] == "CUS-00000001"
    assert redacted["age_band"] == "35-44"
    assert redacted["county"] == "Hillsborough"


def test_the_fallback_redactor_fails_closed() -> None:
    """Without the privacy module every value is masked, never passed through."""
    from arpi.constants import REDACTED_PLACEHOLDER
    from arpi.ingestion.rejection import _fallback_redact_payload

    redacted = _fallback_redact_payload({"county": "Hillsborough", "email": "a@b.test"})
    assert redacted == {
        "county": REDACTED_PLACEHOLDER,
        "email": REDACTED_PLACEHOLDER,
    }


def test_build_rejected_payload_redacts_and_carries_lineage() -> None:
    import json

    from arpi.constants import REDACTED_PLACEHOLDER
    from arpi.ingestion.rejection import LINEAGE_PAYLOAD_KEY, build_rejected_payload

    document = build_rejected_payload(
        {
            "customer_id": "CUS-00000001",
            "customer_email": "someone@example.test",
            # Lineage columns of the raw table are stripped, not redacted: they are
            # re-emitted under the lineage key in a structured form.
            "raw_record_id": 17,
            "ingested_at": "2026-07-28T00:00:00+00:00",
        },
        rejection_category="completeness",
        source_row_number=6,
        load_batch_id="0f0e0d0c-0b0a-0908-0706-050403020100",
        source_file_name="dim_customer.csv",
    )
    payload = json.loads(document)

    assert payload["customer_id"] == "CUS-00000001"
    assert payload["customer_email"] == REDACTED_PLACEHOLDER
    assert "raw_record_id" not in payload
    assert "ingested_at" not in payload
    assert payload[LINEAGE_PAYLOAD_KEY] == {
        "rejection_category": "completeness",
        "source_row_number": 6,
        "load_batch_id": "0f0e0d0c-0b0a-0908-0706-050403020100",
        "source_file_name": "dim_customer.csv",
    }


def test_every_rejection_code_maps_to_a_canonical_category() -> None:
    from arpi.constants import CHECK_CATEGORIES
    from arpi.ingestion.rejection import REJECTION_CATEGORIES, category_for

    assert set(REJECTION_CATEGORIES.values()) <= CHECK_CATEGORIES
    for code in REJECTION_CATEGORIES:
        assert code.startswith("REJ-")
        assert category_for(code) in CHECK_CATEGORIES
    # An unknown code still yields a category the audit table can store.
    assert category_for("REJ-NOT-REGISTERED") in CHECK_CATEGORIES
