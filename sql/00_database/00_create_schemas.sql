-- =============================================================================
-- File:            sql/00_database/00_create_schemas.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the five ARPI layer schemas and document each layer's responsibility.
-- Execution order: 1 of 25 — the first script of the initialisation sequence; nothing else may run before it.
-- Idempotency:     Fully idempotent. CREATE SCHEMA IF NOT EXISTS plus COMMENT ON SCHEMA; rerunning changes nothing.
-- Ownership:       Objects are created by the bootstrap superuser and reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           n/a (schema-level DDL)
-- =============================================================================

-- Layer model per ARCHITECTURE.md section 10.1 / 10.2 and the ARPI cross-agent
-- contract section 10. Data flows strictly left to right:
--
--     source CSV -> raw -> staging -> warehouse -> reporting
--                          (audit records every step)
--
-- No layer is permitted to skip a stage, and Power BI / Excel connect to the
-- reporting layer only.

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA raw IS
    'ARPI raw layer. Unmodified imported source records. Every business column is text so that '
    'ingestion never fails on a bad value; load metadata (load_batch_id, source_file_name, '
    'source_row_number, ingested_at) provides lineage. No business transformations. '
    'Never served to Power BI or Excel, and explicitly revoked from arpi_reporter.';

COMMENT ON SCHEMA staging IS
    'ARPI staging layer. Typed, normalised and deduplicated projections of the raw layer, '
    'implemented as views so that a rerun never leaves stale physical rows behind. Each staging '
    'object exposes exactly one load batch (the most recent) and casts text to the warehouse types.';

COMMENT ON SCHEMA warehouse IS
    'ARPI warehouse layer. Conformed dimensions and (from Phase 1.2 onward) fact tables at an '
    'explicitly documented grain. Integer surrogate keys, declared referential integrity, '
    'Type 2 history where the dimension requires it. Loaded only through the merge scripts in '
    'sql/03_dimensions.';

COMMENT ON SCHEMA reporting IS
    'ARPI reporting layer. Stable, documented, business-friendly views. This is the only schema '
    'that Power BI, Excel and the arpi_reporter role may read. It exists so that consumer tools '
    'never touch raw or operational structures and so that renames in warehouse do not break reports.';

COMMENT ON SCHEMA audit IS
    'ARPI audit layer. Pipeline-run metadata, per-layer row counts, validation results, '
    'reconciliation results and rejected records. Provides the run history required by '
    'ARCHITECTURE.md section 21.4 and the data-quality check views used by operators.';
