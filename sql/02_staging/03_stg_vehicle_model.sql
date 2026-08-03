-- =============================================================================
-- File:            sql/02_staging/03_stg_vehicle_model.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.vehicle_model_load batch, plus its rejected-row companion.
-- Execution order: 20 of 66 — after raw.vehicle_model_load and the staging cast helpers, before anything reads staging.stg_vehicle_model.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_vehicle_model: one accepted row per vehicle_model_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_vehicle_model_typed     every row of the newest batch, cast and classified
--   staging.stg_vehicle_model           the accepted rows only (what the warehouse loads)
--   staging.stg_vehicle_model_rejected  the dropped rows, with a REJ-* code and a payload
--
-- The three are derived from one another, so the accepted set and the rejected set
-- cannot drift apart: every row of the newest batch appears in exactly one of them.
-- That is the identity the ingestion row-count chain reconciliation depends on
-- (RECON-INGEST-*-CHAIN in src/arpi/ingestion/loader.py).
--
-- STAGING GENUINELY DROPS ROWS
-- ----------------------------
-- A staging count that is unconditionally equal to the raw count proves nothing
-- (DOC-23). Four things drop a row here, and each is reported rather than hidden:
--   REJ-TYPE-001    a value is present but cannot be represented in its governed
--                   type (unparseable date, non-numeric money, over-length string)
--   REJ-NULL-001    a required value is absent
--   REJ-DOMAIN-001  a value is outside its enumerated domain or numeric range
--   REJ-KEY-001     a duplicate natural key; the highest raw_record_id survives
--
-- Every cast below is non-throwing: staging.fn_try_* returns NULL instead of
-- raising, and the string casts are length-guarded. A single malformed row
-- therefore quarantines itself rather than failing the whole load.
--
-- NEWEST-BATCH RULE
-- -----------------
-- Identical to staging.stg_calendar_date and staging.stg_dealership: greatest
-- max(ingested_at), ties broken by greatest max(raw_record_id).
--
-- DELIBERATE RENAME
-- -----------------
-- Generator-supplied surrogate keys are exposed as source_*_key. The warehouse
-- surrogate key is assigned by the merge and must never be taken from the source.

CREATE OR REPLACE VIEW staging.stg_vehicle_model_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.vehicle_model_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.vehicle_model_key), '')                                 AS src_source_vehicle_model_key,
        nullif(btrim(r.vehicle_model_id), '')                                  AS src_vehicle_model_id,
        nullif(btrim(r.model_year), '')                                        AS src_model_year,
        nullif(btrim(r.make), '')                                              AS src_make,
        nullif(btrim(r.model), '')                                             AS src_model,
        nullif(btrim(r."trim"), '')                                            AS src_trim,
        nullif(btrim(r.body_style), '')                                        AS src_body_style,
        nullif(btrim(r.vehicle_class), '')                                     AS src_vehicle_class,
        nullif(btrim(r.fuel_type), '')                                         AS src_fuel_type,
        nullif(btrim(r.drivetrain), '')                                        AS src_drivetrain,
        nullif(btrim(r.transmission), '')                                      AS src_transmission,
        nullif(btrim(r.doors), '')                                             AS src_doors,
        nullif(btrim(r.seating_capacity), '')                                  AS src_seating_capacity,
        nullif(btrim(r.franchise_alignment), '')                               AS src_franchise_alignment,
        nullif(btrim(r.is_current_model_line), '')                             AS src_is_current_model_line,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.vehicle_model_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_source_vehicle_model_key) AS source_vehicle_model_key,
        CASE WHEN length(t.src_vehicle_model_id) <= 16 THEN t.src_vehicle_model_id::varchar(16) END AS vehicle_model_id,
        staging.fn_try_smallint(t.src_model_year) AS model_year,
        CASE WHEN length(t.src_make) <= 40 THEN t.src_make::varchar(40) END AS make,
        CASE WHEN length(t.src_model) <= 60 THEN t.src_model::varchar(60) END AS model,
        CASE WHEN length(t.src_trim) <= 40 THEN t.src_trim::varchar(40) END AS "trim",
        CASE WHEN length(t.src_body_style) <= 30 THEN t.src_body_style::varchar(30) END AS body_style,
        CASE WHEN length(t.src_vehicle_class) <= 30 THEN t.src_vehicle_class::varchar(30) END AS vehicle_class,
        CASE WHEN length(t.src_fuel_type) <= 20 THEN t.src_fuel_type::varchar(20) END AS fuel_type,
        CASE WHEN length(t.src_drivetrain) <= 10 THEN t.src_drivetrain::varchar(10) END AS drivetrain,
        CASE WHEN length(t.src_transmission) <= 20 THEN t.src_transmission::varchar(20) END AS transmission,
        staging.fn_try_smallint(t.src_doors) AS doors,
        staging.fn_try_smallint(t.src_seating_capacity) AS seating_capacity,
        CASE WHEN length(t.src_franchise_alignment) <= 40 THEN t.src_franchise_alignment::varchar(40) END AS franchise_alignment,
        staging.fn_try_boolean(t.src_is_current_model_line) AS is_current_model_line,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_source_vehicle_model_key,
        t.src_vehicle_model_id,
        t.src_model_year,
        t.src_make,
        t.src_model,
        t.src_trim,
        t.src_body_style,
        t.src_vehicle_class,
        t.src_fuel_type,
        t.src_drivetrain,
        t.src_transmission,
        t.src_doors,
        t.src_seating_capacity,
        t.src_franchise_alignment,
        t.src_is_current_model_line,
        t.src_source_system,
        t.raw_record_id,
        t.load_batch_id,
        t.source_file_name,
        t.source_row_number,
        t.ingested_at,
        t.record_payload
    FROM trimmed AS t
),
flagged AS (
    SELECT
        c.*,
        -- Present in the source but not representable in the governed type.
        array_remove(ARRAY[
            CASE WHEN c.src_source_vehicle_model_key IS NOT NULL AND c.source_vehicle_model_key IS NULL THEN 'source_vehicle_model_key' END,
            CASE WHEN c.src_vehicle_model_id IS NOT NULL AND c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.src_model_year IS NOT NULL AND c.model_year IS NULL THEN 'model_year' END,
            CASE WHEN c.src_make IS NOT NULL AND c.make IS NULL THEN 'make' END,
            CASE WHEN c.src_model IS NOT NULL AND c.model IS NULL THEN 'model' END,
            CASE WHEN c.src_trim IS NOT NULL AND c."trim" IS NULL THEN 'trim' END,
            CASE WHEN c.src_body_style IS NOT NULL AND c.body_style IS NULL THEN 'body_style' END,
            CASE WHEN c.src_vehicle_class IS NOT NULL AND c.vehicle_class IS NULL THEN 'vehicle_class' END,
            CASE WHEN c.src_fuel_type IS NOT NULL AND c.fuel_type IS NULL THEN 'fuel_type' END,
            CASE WHEN c.src_drivetrain IS NOT NULL AND c.drivetrain IS NULL THEN 'drivetrain' END,
            CASE WHEN c.src_transmission IS NOT NULL AND c.transmission IS NULL THEN 'transmission' END,
            CASE WHEN c.src_doors IS NOT NULL AND c.doors IS NULL THEN 'doors' END,
            CASE WHEN c.src_seating_capacity IS NOT NULL AND c.seating_capacity IS NULL THEN 'seating_capacity' END,
            CASE WHEN c.src_franchise_alignment IS NOT NULL AND c.franchise_alignment IS NULL THEN 'franchise_alignment' END,
            CASE WHEN c.src_is_current_model_line IS NOT NULL AND c.is_current_model_line IS NULL THEN 'is_current_model_line' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.source_vehicle_model_key IS NULL THEN 'source_vehicle_model_key' END,
            CASE WHEN c.vehicle_model_id IS NULL THEN 'vehicle_model_id' END,
            CASE WHEN c.model_year IS NULL THEN 'model_year' END,
            CASE WHEN c.make IS NULL THEN 'make' END,
            CASE WHEN c.model IS NULL THEN 'model' END,
            CASE WHEN c."trim" IS NULL THEN 'trim' END,
            CASE WHEN c.body_style IS NULL THEN 'body_style' END,
            CASE WHEN c.vehicle_class IS NULL THEN 'vehicle_class' END,
            CASE WHEN c.fuel_type IS NULL THEN 'fuel_type' END,
            CASE WHEN c.drivetrain IS NULL THEN 'drivetrain' END,
            CASE WHEN c.transmission IS NULL THEN 'transmission' END,
            CASE WHEN c.doors IS NULL THEN 'doors' END,
            CASE WHEN c.seating_capacity IS NULL THEN 'seating_capacity' END,
            CASE WHEN c.franchise_alignment IS NULL THEN 'franchise_alignment' END,
            CASE WHEN c.is_current_model_line IS NULL THEN 'is_current_model_line' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.model_year IS NOT NULL AND (c.model_year < 1990 OR c.model_year > 2030) THEN 'model_year' END,
            CASE WHEN c.body_style IS NOT NULL AND c.body_style NOT IN ('Sedan', 'Coupe', 'Hatchback', 'Wagon', 'SUV', 'Crossover', 'Pickup', 'Van', 'Convertible') THEN 'body_style' END,
            CASE WHEN c.vehicle_class IS NOT NULL AND c.vehicle_class NOT IN ('Compact', 'Midsize', 'Fullsize', 'Luxury', 'Sports', 'Truck', 'SUV', 'Van') THEN 'vehicle_class' END,
            CASE WHEN c.fuel_type IS NOT NULL AND c.fuel_type NOT IN ('Gasoline', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric') THEN 'fuel_type' END,
            CASE WHEN c.drivetrain IS NOT NULL AND c.drivetrain NOT IN ('FWD', 'RWD', 'AWD', '4WD') THEN 'drivetrain' END,
            CASE WHEN c.transmission IS NOT NULL AND c.transmission NOT IN ('Automatic', 'Manual', 'CVT') THEN 'transmission' END,
            CASE WHEN c.doors IS NOT NULL AND (c.doors < 2 OR c.doors > 5) THEN 'doors' END,
            CASE WHEN c.seating_capacity IS NOT NULL AND (c.seating_capacity < 2 OR c.seating_capacity > 8) THEN 'seating_capacity' END,
            CASE WHEN c.franchise_alignment IS NOT NULL AND c.franchise_alignment NOT IN ('Chevrolet', 'Subaru', 'Independent Used') THEN 'franchise_alignment' END
        ], NULL) AS domain_failures
    FROM cast_attempt AS c
),
classified AS (
    SELECT
        f.*,
        CASE
            WHEN cardinality(f.cast_failures) > 0     THEN 'REJ-TYPE-001'
            WHEN cardinality(f.missing_required) > 0  THEN 'REJ-NULL-001'
            WHEN cardinality(f.domain_failures) > 0   THEN 'REJ-DOMAIN-001'
        END AS rejection_code,
        CASE
            WHEN cardinality(f.cast_failures) > 0     THEN 'structural'
            WHEN cardinality(f.missing_required) > 0  THEN 'completeness'
            WHEN cardinality(f.domain_failures) > 0   THEN 'business_rule'
        END AS rejection_category,
        CASE
            WHEN cardinality(f.cast_failures) > 0
                THEN 'value present but not representable in the governed type: '
                     || array_to_string(f.cast_failures, ', ')
            WHEN cardinality(f.missing_required) > 0
                THEN 'required value absent: ' || array_to_string(f.missing_required, ', ')
            WHEN cardinality(f.domain_failures) > 0
                THEN 'value outside its governed domain or range: '
                     || array_to_string(f.domain_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.source_vehicle_model_key,
    c.vehicle_model_id,
    c.model_year,
    c.make,
    c.model,
    c."trim",
    c.body_style,
    c.vehicle_class,
    c.fuel_type,
    c.drivetrain,
    c.transmission,
    c.doors,
    c.seating_capacity,
    c.franchise_alignment,
    c.is_current_model_line,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_vehicle_model_id,
    c.raw_record_id,
    c.load_batch_id,
    c.source_file_name,
    c.source_row_number,
    c.ingested_at,
    c.record_payload,
    c.rejection_code,
    c.rejection_category,
    c.rejection_reason,
    -- Rank within the natural key, computed separately for accepted and rejected
    -- rows so that a structurally invalid row can never displace a valid one.
    row_number() OVER (
        PARTITION BY c.vehicle_model_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_vehicle_model_typed IS
    'Grain: one row per row of the most recent raw.vehicle_model_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_vehicle_model and 
staging.stg_vehicle_model_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_vehicle_model AS
SELECT DISTINCT ON (v.vehicle_model_id)
    v.source_vehicle_model_key,
    v.vehicle_model_id,
    v.model_year,
    v.make,
    v.model,
    v."trim",
    v.body_style,
    v.vehicle_class,
    v.fuel_type,
    v.drivetrain,
    v.transmission,
    v.doors,
    v.seating_capacity,
    v.franchise_alignment,
    v.is_current_model_line,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_vehicle_model_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.vehicle_model_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_vehicle_model IS
    'Grain: one row per vehicle_model_id, restricted to the most recent raw.vehicle_model_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_vehicle_model_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_vehicle_model.source_vehicle_model_key IS 'Generator-assigned vehicle_model_key. Lineage only: the warehouse surrogate key is assigned by sql/03_dimensions/12_dim_vehicle_model_merge.sql, so staging exposes this as source_vehicle_model_key.';
COMMENT ON COLUMN staging.stg_vehicle_model.vehicle_model_id IS 'Natural key, VMD-##### (contract section 5).';
COMMENT ON COLUMN staging.stg_vehicle_model.model_year IS 'Model year; 1990..2030.';
COMMENT ON COLUMN staging.stg_vehicle_model.make IS 'Vehicle make, for example Chevrolet. Names a product, never a person.';
COMMENT ON COLUMN staging.stg_vehicle_model.model IS 'Vehicle model line, for example Equinox.';
COMMENT ON COLUMN staging.stg_vehicle_model."trim" IS 'Trim level, for example LT.';
COMMENT ON COLUMN staging.stg_vehicle_model.body_style IS 'Body style.';
COMMENT ON COLUMN staging.stg_vehicle_model.vehicle_class IS 'Marketing size/class band.';
COMMENT ON COLUMN staging.stg_vehicle_model.fuel_type IS 'Propulsion type.';
COMMENT ON COLUMN staging.stg_vehicle_model.drivetrain IS 'Driven axles.';
COMMENT ON COLUMN staging.stg_vehicle_model.transmission IS 'Transmission type.';
COMMENT ON COLUMN staging.stg_vehicle_model.doors IS 'Door count; 2..5.';
COMMENT ON COLUMN staging.stg_vehicle_model.seating_capacity IS 'Factory seating capacity; 2..8.';
COMMENT ON COLUMN staging.stg_vehicle_model.franchise_alignment IS 'Which Granite Auto Group franchise sells this model line.';
COMMENT ON COLUMN staging.stg_vehicle_model.is_current_model_line IS 'Whether the model line is still in production.';
COMMENT ON COLUMN staging.stg_vehicle_model.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_vehicle_model.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_vehicle_model.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_vehicle_model.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_vehicle_model.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_vehicle_model.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_vehicle_model_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'vehicle_model'::text AS source_entity,
    coalesce(v.src_vehicle_model_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (vehicle_model_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_vehicle_model_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_vehicle_model_rejected IS
    'Grain: one row per row of the most recent raw.vehicle_model_load batch that staging.stg_vehicle_model did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_vehicle_model_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_vehicle_model_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
