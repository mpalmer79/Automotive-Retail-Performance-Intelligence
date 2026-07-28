-- =============================================================================
-- File:            sql/00_database/03_audit_tables.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the audit-layer tables that record pipeline runs, row counts, validation results, reconciliations and rejected records.
-- Execution order: 3 of 25 — after the schemas exist and before any layer that writes audit rows.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS, plus one guarded DO block that migrates retired check_category spellings and adds the category CHECK constraint only when it is absent. Rerunning changes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader.
-- Grain:           One grain per table; each table declares it in its COMMENT ON TABLE.
-- =============================================================================
--
-- These tables live in the audit schema and implement the cross-agent contract
-- section 9 exactly. They are created early (in 00_database) because every other
-- layer may reference a pipeline run, and because the reporting views in
-- sql/05_reporting and the data-quality views in sql/08_validation depend on them.
--
-- Deletion policy: audit history is evidence. Child tables use ON DELETE RESTRICT
-- so that a pipeline run cannot be silently erased along with its findings. Purge
-- an unwanted run by deleting children explicitly, or reset the whole local
-- database with sql/99_local_reset.sql.

-- -----------------------------------------------------------------------------
-- audit.pipeline_run
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.pipeline_run (
    pipeline_run_id         bigserial       NOT NULL,
    run_uuid                uuid            NOT NULL,
    pipeline_name           text            NOT NULL,
    profile_name            text            NOT NULL,
    run_mode                text            NOT NULL,
    random_seed             bigint          NOT NULL,
    arpi_version            text            NOT NULL,
    started_at              timestamptz     NOT NULL,
    completed_at            timestamptz     NULL,
    status                  text            NOT NULL,
    critical_failure_count  integer         NOT NULL DEFAULT 0,
    warning_count           integer         NOT NULL DEFAULT 0,
    notes                   text            NULL,
    CONSTRAINT pk_pipeline_run
        PRIMARY KEY (pipeline_run_id),
    CONSTRAINT uq_pipeline_run_run_uuid
        UNIQUE (run_uuid),
    CONSTRAINT ck_pipeline_run_status
        CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
    CONSTRAINT ck_pipeline_run_counts_nonnegative
        CHECK (critical_failure_count >= 0 AND warning_count >= 0),
    CONSTRAINT ck_pipeline_run_completion_not_before_start
        CHECK (completed_at IS NULL OR completed_at >= started_at)
);

COMMENT ON TABLE audit.pipeline_run IS
    'Grain: one row per ARPI pipeline execution. Root of the audit layer; every other audit table '
    'references it. A run is inserted with status = running and updated to succeeded/failed/aborted.';
COMMENT ON COLUMN audit.pipeline_run.pipeline_run_id IS 'Surrogate key. Referenced by every child audit table.';
COMMENT ON COLUMN audit.pipeline_run.run_uuid IS 'Externally generated UUID for the run; unique, used to correlate logs with database rows.';
COMMENT ON COLUMN audit.pipeline_run.pipeline_name IS 'Logical pipeline that executed, for example run-foundation.';
COMMENT ON COLUMN audit.pipeline_run.profile_name IS 'ARPI configuration profile: development, test or portfolio.';
COMMENT ON COLUMN audit.pipeline_run.run_mode IS 'How the run was invoked, for example cli, ci or manual.';
COMMENT ON COLUMN audit.pipeline_run.random_seed IS 'Seed used by the synthetic generators; required for reproducibility.';
COMMENT ON COLUMN audit.pipeline_run.arpi_version IS 'Version of the arpi distribution that produced the run.';
COMMENT ON COLUMN audit.pipeline_run.started_at IS 'UTC instant the run began (timestamptz).';
COMMENT ON COLUMN audit.pipeline_run.completed_at IS 'UTC instant the run finished; NULL while still running.';
COMMENT ON COLUMN audit.pipeline_run.status IS 'running | succeeded | failed | aborted. Enforced by ck_pipeline_run_status.';
COMMENT ON COLUMN audit.pipeline_run.critical_failure_count IS 'Number of critical validation failures recorded for the run.';
COMMENT ON COLUMN audit.pipeline_run.warning_count IS 'Number of warning-severity validation findings recorded for the run.';
COMMENT ON COLUMN audit.pipeline_run.notes IS 'Free-text operator note; never used for control flow.';

-- -----------------------------------------------------------------------------
-- audit.pipeline_run_row_count
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.pipeline_run_row_count (
    pipeline_run_id  bigint       NOT NULL,
    entity_name      text         NOT NULL,
    layer            text         NOT NULL,
    row_count        bigint       NOT NULL,
    recorded_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_pipeline_run_row_count
        PRIMARY KEY (pipeline_run_id, entity_name, layer),
    CONSTRAINT fk_pipeline_run_row_count_pipeline_run
        FOREIGN KEY (pipeline_run_id) REFERENCES audit.pipeline_run (pipeline_run_id)
        ON DELETE RESTRICT,
    CONSTRAINT ck_pipeline_run_row_count_layer
        CHECK (layer IN ('source', 'raw', 'staging', 'warehouse', 'rejected')),
    CONSTRAINT ck_pipeline_run_row_count_nonnegative
        CHECK (row_count >= 0)
);

COMMENT ON TABLE audit.pipeline_run_row_count IS
    'Grain: one row per (pipeline_run_id, entity_name, layer). Row counts observed at each layer boundary, '
    'used for the source-to-warehouse reconciliation required by ARCHITECTURE.md section 21.4.';
COMMENT ON COLUMN audit.pipeline_run_row_count.pipeline_run_id IS 'Run this count belongs to.';
COMMENT ON COLUMN audit.pipeline_run_row_count.entity_name IS 'Logical entity counted, for example dim_date or dim_dealership.';
COMMENT ON COLUMN audit.pipeline_run_row_count.layer IS 'source | raw | staging | warehouse | rejected. Enforced by ck_pipeline_run_row_count_layer.';
COMMENT ON COLUMN audit.pipeline_run_row_count.row_count IS 'Number of rows observed for the entity at that layer.';
COMMENT ON COLUMN audit.pipeline_run_row_count.recorded_at IS 'UTC instant the count was taken.';

-- -----------------------------------------------------------------------------
-- audit.validation_result
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.validation_result (
    validation_result_id  bigserial    NOT NULL,
    pipeline_run_id       bigint       NOT NULL,
    check_id              text         NOT NULL,
    check_name            text         NOT NULL,
    check_category        text         NOT NULL,
    target_object         text         NOT NULL,
    severity              text         NOT NULL,
    status                text         NOT NULL,
    observed_value        numeric      NULL,
    expected_value        numeric      NULL,
    failed_record_count   bigint       NOT NULL DEFAULT 0,
    message               text         NULL,
    evaluated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_validation_result
        PRIMARY KEY (validation_result_id),
    CONSTRAINT fk_validation_result_pipeline_run
        FOREIGN KEY (pipeline_run_id) REFERENCES audit.pipeline_run (pipeline_run_id)
        ON DELETE RESTRICT,
    CONSTRAINT ck_validation_result_severity
        CHECK (severity IN ('critical', 'warning', 'info')),
    CONSTRAINT ck_validation_result_status
        CHECK (status IN ('passed', 'failed', 'skipped')),
    CONSTRAINT ck_validation_result_failed_count_nonnegative
        CHECK (failed_record_count >= 0)
);

COMMENT ON TABLE audit.validation_result IS
    'Grain: one row per data-quality check evaluation within a pipeline run. Check identifiers are shared '
    'verbatim between the Python validation framework and the SQL check views in sql/08_validation '
    '(DQ-DATE-001..005, DQ-DLR-001..005, DQ-GEN-001..002, DQ-REF-*, DQ-AUD-*).';
COMMENT ON COLUMN audit.validation_result.validation_result_id IS 'Surrogate key.';
COMMENT ON COLUMN audit.validation_result.pipeline_run_id IS 'Run during which the check was evaluated.';
COMMENT ON COLUMN audit.validation_result.check_id IS 'Stable check identifier, for example DQ-DATE-001.';
COMMENT ON COLUMN audit.validation_result.check_name IS 'Human-readable name of the check.';
COMMENT ON COLUMN audit.validation_result.check_category IS
    'One of exactly seven canonical categories: structural, completeness, uniqueness, referential, '
    'business_rule, privacy, reproducibility. Enforced by ck_validation_result_check_category and '
    'defined once in src/arpi/constants.py (CHECK_CATEGORIES). reconciliation is deliberately not a '
    'category: reconciliations live in audit.reconciliation_result.';
COMMENT ON COLUMN audit.validation_result.target_object IS 'Fully qualified object the check was evaluated against.';
COMMENT ON COLUMN audit.validation_result.severity IS 'critical | warning | info. Critical failures fail the pipeline run.';
COMMENT ON COLUMN audit.validation_result.status IS 'passed | failed | skipped. skipped is used when the target object holds no rows.';
COMMENT ON COLUMN audit.validation_result.observed_value IS 'Numeric value actually observed; NULL when the check is not numeric.';
COMMENT ON COLUMN audit.validation_result.expected_value IS 'Numeric value expected or the boundary that was tested; NULL when not applicable.';
COMMENT ON COLUMN audit.validation_result.failed_record_count IS 'Number of records that violated the rule; 0 for a passing check.';
COMMENT ON COLUMN audit.validation_result.message IS 'Human-readable explanation shown to operators.';
COMMENT ON COLUMN audit.validation_result.evaluated_at IS 'UTC instant the check ran.';

-- -----------------------------------------------------------------------------
-- check_category domain: migration-safe constraint
-- -----------------------------------------------------------------------------
-- The table above is CREATE TABLE IF NOT EXISTS, so a constraint added to its body
-- would never reach a database created before this change: re-running the file is a
-- no-op once the table exists. Four incompatible category vocabularies had already
-- accumulated for exactly that reason (documentation backlog DOC-24), and describing
-- the domain in a COMMENT is what allowed the drift.
--
-- This block therefore does the work a migration would do, idempotently:
--   1. rewrite every pre-existing row that carries a retired spelling;
--   2. add the CHECK constraint only when it is not already present.
--
-- The rewrite must come first. ALTER TABLE ... ADD CONSTRAINT validates existing rows,
-- so historical audit evidence would otherwise make the constraint unaddable, and the
-- only ways out would be to delete evidence or to leave the domain unenforced.
--
-- Retired spelling -> canonical category (mirrors RETIRED_CHECK_CATEGORIES in
-- src/arpi/constants.py):
--     schema       -> structural       (but DQ-DLR-004 -> privacy: it is the privacy
--                                       tripwire, not a structural check)
--     domain       -> business_rule
--     determinism  -> reproducibility
--
-- A row carrying some other unknown spelling is deliberately NOT rewritten. The ADD
-- CONSTRAINT then fails loudly and names the row, which is the correct outcome: an
-- unrecognised category is a defect somebody must look at, not something to guess at.
DO $ck_validation_result_check_category$
BEGIN
    UPDATE audit.validation_result
       SET check_category = 'privacy'
     WHERE check_category = 'schema'
       AND check_id = 'DQ-DLR-004';

    UPDATE audit.validation_result
       SET check_category = 'structural'
     WHERE check_category = 'schema';

    UPDATE audit.validation_result
       SET check_category = 'business_rule'
     WHERE check_category = 'domain';

    UPDATE audit.validation_result
       SET check_category = 'reproducibility'
     WHERE check_category = 'determinism';

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname  = 'ck_validation_result_check_category'
          AND conrelid = 'audit.validation_result'::regclass
    ) THEN
        ALTER TABLE audit.validation_result
            ADD CONSTRAINT ck_validation_result_check_category
            CHECK (check_category IN (
                'structural',
                'completeness',
                'uniqueness',
                'referential',
                'business_rule',
                'privacy',
                'reproducibility'
            ));
    END IF;
END
$ck_validation_result_check_category$;

-- -----------------------------------------------------------------------------
-- audit.reconciliation_result
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.reconciliation_result (
    reconciliation_result_id  bigserial    NOT NULL,
    pipeline_run_id           bigint       NOT NULL,
    reconciliation_id         text         NULL,
    description               text         NULL,
    left_source               text         NULL,
    left_value                numeric      NULL,
    right_source              text         NULL,
    right_value               numeric      NULL,
    difference                numeric      GENERATED ALWAYS AS (left_value - right_value) STORED,
    tolerance                 numeric      NOT NULL DEFAULT 0,
    status                    text         NULL,
    evaluated_at              timestamptz  NULL DEFAULT now(),
    CONSTRAINT pk_reconciliation_result
        PRIMARY KEY (reconciliation_result_id),
    CONSTRAINT fk_reconciliation_result_pipeline_run
        FOREIGN KEY (pipeline_run_id) REFERENCES audit.pipeline_run (pipeline_run_id)
        ON DELETE RESTRICT,
    CONSTRAINT ck_reconciliation_result_status
        CHECK (status IN ('passed', 'failed')),
    CONSTRAINT ck_reconciliation_result_tolerance_nonnegative
        CHECK (tolerance >= 0)
);

COMMENT ON TABLE audit.reconciliation_result IS
    'Grain: one row per reconciliation comparison within a pipeline run. Compares a left source total with a '
    'right source total; difference is generated and stored so it can be indexed and filtered.';
COMMENT ON COLUMN audit.reconciliation_result.reconciliation_result_id IS 'Surrogate key.';
COMMENT ON COLUMN audit.reconciliation_result.pipeline_run_id IS 'Run during which the reconciliation was evaluated.';
COMMENT ON COLUMN audit.reconciliation_result.reconciliation_id IS 'Stable reconciliation identifier.';
COMMENT ON COLUMN audit.reconciliation_result.description IS 'What the two sides represent, in business language.';
COMMENT ON COLUMN audit.reconciliation_result.left_source IS 'Name of the left-hand source, for example staging.stg_dealership.';
COMMENT ON COLUMN audit.reconciliation_result.left_value IS 'Total measured on the left-hand source.';
COMMENT ON COLUMN audit.reconciliation_result.right_source IS 'Name of the right-hand source, for example warehouse.dim_dealership.';
COMMENT ON COLUMN audit.reconciliation_result.right_value IS 'Total measured on the right-hand source.';
COMMENT ON COLUMN audit.reconciliation_result.difference IS 'Generated stored column: left_value - right_value.';
COMMENT ON COLUMN audit.reconciliation_result.tolerance IS 'Absolute tolerance permitted before the reconciliation is considered failed.';
COMMENT ON COLUMN audit.reconciliation_result.status IS 'passed | failed.';
COMMENT ON COLUMN audit.reconciliation_result.evaluated_at IS 'UTC instant the reconciliation ran.';

-- -----------------------------------------------------------------------------
-- audit.rejected_record
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.rejected_record (
    rejected_record_id  bigserial    NOT NULL,
    pipeline_run_id     bigint       NOT NULL,
    source_entity       text         NOT NULL,
    source_record_key   text         NULL,
    rejection_code      text         NOT NULL,
    rejection_reason    text         NULL,
    record_payload      jsonb        NULL,
    rejected_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_rejected_record
        PRIMARY KEY (rejected_record_id),
    CONSTRAINT fk_rejected_record_pipeline_run
        FOREIGN KEY (pipeline_run_id) REFERENCES audit.pipeline_run (pipeline_run_id)
        ON DELETE RESTRICT
);

COMMENT ON TABLE audit.rejected_record IS
    'Grain: one row per source record rejected during a pipeline run. Rejected rows never reach the warehouse; '
    'they are preserved here with their payload so the defect can be reproduced and explained.';
COMMENT ON COLUMN audit.rejected_record.rejected_record_id IS 'Surrogate key.';
COMMENT ON COLUMN audit.rejected_record.pipeline_run_id IS 'Run that rejected the record.';
COMMENT ON COLUMN audit.rejected_record.source_entity IS 'Entity the record came from, for example dim_dealership.';
COMMENT ON COLUMN audit.rejected_record.source_record_key IS 'Best available natural key for the rejected record; NULL when it could not be parsed.';
COMMENT ON COLUMN audit.rejected_record.rejection_code IS 'Stable machine-readable rejection code.';
COMMENT ON COLUMN audit.rejected_record.rejection_reason IS 'Human-readable explanation of the rejection.';
COMMENT ON COLUMN audit.rejected_record.record_payload IS 'The offending record as JSON. Synthetic data only; never contains personal data.';
COMMENT ON COLUMN audit.rejected_record.rejected_at IS 'UTC instant the record was rejected.';
