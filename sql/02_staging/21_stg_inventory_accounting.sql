-- =============================================================================
-- File:            sql/02_staging/21_stg_inventory_accounting.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Type, validate and deduplicate raw.inventory_accounting_load into staging.stg_inventory_accounting, quarantining every row it does not accept.
-- Execution order: After sql/01_raw/20_raw_inventory_accounting_load.sql and the staging cast helpers.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; no data is written.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           One row per inventory_accounting_id, from the most recent load batch, after type, completeness and domain rejection.
-- =============================================================================
--
-- Mapping document: docs/source-to-target/STM-022-fact-inventory-accounting-snapshot.md.
-- Delivery increment: DASH.8 (docs/requirements/DASHBOARD_BACKLOG.md).
--
-- WHAT THIS ENTITY IS. The stock-level accounting schedule -- one carried unit's book
-- position at one month-end. A focused inventory control schedule, never a general ledger.
--
-- THE BOOK-VALUE IDENTITY IS NOT CHECKED HERE, AND THAT IS DELIBERATE. Staging prepares
-- data: it casts, it rejects what cannot be represented, and it deduplicates. The identity
--
--     current_book_value = acquisition_cost + capitalized_transportation
--                        + capitalized_reconditioning + capitalized_accessories
--                        + other_capitalized_costs - write_down_amount
--
-- is a structural invariant of the fact, so it is enforced by a CHECK constraint on
-- warehouse.fact_inventory_accounting_snapshot where a violation cannot be loaded at all,
-- rather than by a staging rule that would let a broken row become a quarantined one.
--
-- What staging DOES reject is a row whose components are individually impossible: a
-- negative cost, a negative write-down, a negative principal, a control category outside
-- the governed set, or an accounting date before the unit was acquired.
--
-- NEWEST-BATCH RULE. Identical to every other staging view: greatest max(ingested_at),
-- ties broken by greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_inventory_accounting_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.inventory_accounting_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.inventory_accounting_id), '')    AS src_inventory_accounting_id,
        nullif(btrim(r.dealership_id), '')              AS src_dealership_id,
        nullif(btrim(r.vehicle_id), '')                 AS src_vehicle_id,
        nullif(btrim(r.accounting_date), '')            AS src_accounting_date,
        nullif(btrim(r.acquisition_date), '')           AS src_acquisition_date,
        nullif(btrim(r.control_account_category), '')   AS src_control_account_category,
        nullif(btrim(r.acquisition_cost), '')           AS src_acquisition_cost,
        nullif(btrim(r.capitalized_transportation), '') AS src_capitalized_transportation,
        nullif(btrim(r.capitalized_reconditioning), '') AS src_capitalized_reconditioning,
        nullif(btrim(r.capitalized_accessories), '')    AS src_capitalized_accessories,
        nullif(btrim(r.other_capitalized_costs), '')    AS src_other_capitalized_costs,
        nullif(btrim(r.write_down_amount), '')          AS src_write_down_amount,
        nullif(btrim(r.current_book_value), '')         AS src_current_book_value,
        nullif(btrim(r.floorplan_principal), '')        AS src_floorplan_principal,
        nullif(btrim(r.days_in_stock), '')              AS src_days_in_stock,
        nullif(btrim(r.source_system), '')              AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.inventory_accounting_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_inventory_accounting_id) <= 16 THEN t.src_inventory_accounting_id::varchar(16) END AS inventory_accounting_id,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_vehicle_id) <= 16 THEN t.src_vehicle_id::varchar(16) END AS vehicle_id,
        staging.fn_try_date(t.src_accounting_date) AS accounting_date,
        staging.fn_try_date(t.src_acquisition_date) AS acquisition_date,
        CASE WHEN length(t.src_control_account_category) <= 40 THEN t.src_control_account_category::varchar(40) END AS control_account_category,
        staging.fn_try_money(t.src_acquisition_cost) AS acquisition_cost,
        staging.fn_try_money(t.src_capitalized_transportation) AS capitalized_transportation,
        staging.fn_try_money(t.src_capitalized_reconditioning) AS capitalized_reconditioning,
        staging.fn_try_money(t.src_capitalized_accessories) AS capitalized_accessories,
        staging.fn_try_money(t.src_other_capitalized_costs) AS other_capitalized_costs,
        staging.fn_try_money(t.src_write_down_amount) AS write_down_amount,
        staging.fn_try_money(t.src_current_book_value) AS current_book_value,
        staging.fn_try_money(t.src_floorplan_principal) AS floorplan_principal,
        staging.fn_try_integer(t.src_days_in_stock) AS days_in_stock,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_inventory_accounting_id,
        t.src_dealership_id,
        t.src_vehicle_id,
        t.src_accounting_date,
        t.src_acquisition_date,
        t.src_control_account_category,
        t.src_acquisition_cost,
        t.src_capitalized_transportation,
        t.src_capitalized_reconditioning,
        t.src_capitalized_accessories,
        t.src_other_capitalized_costs,
        t.src_write_down_amount,
        t.src_current_book_value,
        t.src_floorplan_principal,
        t.src_days_in_stock,
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
            CASE WHEN c.src_inventory_accounting_id IS NOT NULL AND c.inventory_accounting_id IS NULL THEN 'inventory_accounting_id' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_vehicle_id IS NOT NULL AND c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.src_accounting_date IS NOT NULL AND c.accounting_date IS NULL THEN 'accounting_date' END,
            CASE WHEN c.src_acquisition_date IS NOT NULL AND c.acquisition_date IS NULL THEN 'acquisition_date' END,
            CASE WHEN c.src_control_account_category IS NOT NULL AND c.control_account_category IS NULL THEN 'control_account_category' END,
            CASE WHEN c.src_acquisition_cost IS NOT NULL AND c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.src_capitalized_transportation IS NOT NULL AND c.capitalized_transportation IS NULL THEN 'capitalized_transportation' END,
            CASE WHEN c.src_capitalized_reconditioning IS NOT NULL AND c.capitalized_reconditioning IS NULL THEN 'capitalized_reconditioning' END,
            CASE WHEN c.src_capitalized_accessories IS NOT NULL AND c.capitalized_accessories IS NULL THEN 'capitalized_accessories' END,
            CASE WHEN c.src_other_capitalized_costs IS NOT NULL AND c.other_capitalized_costs IS NULL THEN 'other_capitalized_costs' END,
            CASE WHEN c.src_write_down_amount IS NOT NULL AND c.write_down_amount IS NULL THEN 'write_down_amount' END,
            CASE WHEN c.src_current_book_value IS NOT NULL AND c.current_book_value IS NULL THEN 'current_book_value' END,
            CASE WHEN c.src_floorplan_principal IS NOT NULL AND c.floorplan_principal IS NULL THEN 'floorplan_principal' END,
            CASE WHEN c.src_days_in_stock IS NOT NULL AND c.days_in_stock IS NULL THEN 'days_in_stock' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.inventory_accounting_id IS NULL THEN 'inventory_accounting_id' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.accounting_date IS NULL THEN 'accounting_date' END,
            CASE WHEN c.acquisition_date IS NULL THEN 'acquisition_date' END,
            CASE WHEN c.control_account_category IS NULL THEN 'control_account_category' END,
            CASE WHEN c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.capitalized_transportation IS NULL THEN 'capitalized_transportation' END,
            CASE WHEN c.capitalized_reconditioning IS NULL THEN 'capitalized_reconditioning' END,
            CASE WHEN c.capitalized_accessories IS NULL THEN 'capitalized_accessories' END,
            CASE WHEN c.other_capitalized_costs IS NULL THEN 'other_capitalized_costs' END,
            CASE WHEN c.write_down_amount IS NULL THEN 'write_down_amount' END,
            CASE WHEN c.current_book_value IS NULL THEN 'current_book_value' END,
            CASE WHEN c.floorplan_principal IS NULL THEN 'floorplan_principal' END,
            CASE WHEN c.days_in_stock IS NULL THEN 'days_in_stock' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or outside the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.control_account_category IS NOT NULL
                  AND c.control_account_category NOT IN ('New Vehicle Inventory', 'Used Vehicle Inventory', 'Certified Vehicle Inventory')
                 THEN 'control_account_category' END,
            CASE WHEN c.acquisition_cost IS NOT NULL AND c.acquisition_cost < 0 THEN 'acquisition_cost' END,
            CASE WHEN c.capitalized_transportation IS NOT NULL AND c.capitalized_transportation < 0 THEN 'capitalized_transportation' END,
            CASE WHEN c.capitalized_reconditioning IS NOT NULL AND c.capitalized_reconditioning < 0 THEN 'capitalized_reconditioning' END,
            CASE WHEN c.capitalized_accessories IS NOT NULL AND c.capitalized_accessories < 0 THEN 'capitalized_accessories' END,
            CASE WHEN c.other_capitalized_costs IS NOT NULL AND c.other_capitalized_costs < 0 THEN 'other_capitalized_costs' END,
            CASE WHEN c.write_down_amount IS NOT NULL AND c.write_down_amount < 0 THEN 'write_down_amount' END,
            CASE WHEN c.current_book_value IS NOT NULL AND c.current_book_value < 0 THEN 'current_book_value' END,
            CASE WHEN c.floorplan_principal IS NOT NULL AND c.floorplan_principal < 0 THEN 'floorplan_principal' END,
            CASE WHEN c.days_in_stock IS NOT NULL AND c.days_in_stock < 0 THEN 'days_in_stock' END,
            -- A unit booked before it entered stock would make the posting lag negative.
            CASE WHEN c.acquisition_date IS NOT NULL AND c.accounting_date IS NOT NULL
                  AND c.acquisition_date > c.accounting_date
                 THEN 'acquisition_date' END
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
    c.inventory_accounting_id,
    c.dealership_id,
    c.vehicle_id,
    c.accounting_date,
    c.acquisition_date,
    c.control_account_category,
    c.acquisition_cost,
    c.capitalized_transportation,
    c.capitalized_reconditioning,
    c.capitalized_accessories,
    c.other_capitalized_costs,
    c.write_down_amount,
    c.current_book_value,
    c.floorplan_principal,
    c.days_in_stock,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified even when
    -- the cast that would have typed it is what failed.
    c.src_inventory_accounting_id,
    c.raw_record_id,
    c.load_batch_id,
    c.source_file_name,
    c.source_row_number,
    c.ingested_at,
    c.record_payload,
    c.rejection_code,
    c.rejection_category,
    c.rejection_reason,
    row_number() OVER (
        PARTITION BY c.inventory_accounting_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_inventory_accounting_typed IS
    'Grain: one row per row of the most recent raw.inventory_accounting_load batch. Internal: every business column is
cast with a non-throwing expression and the row is classified as accepted (rejection_code IS NULL and
natural_key_rank = 1) or rejected. staging.stg_inventory_accounting and staging.stg_inventory_accounting_rejected are the two
halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_inventory_accounting AS
SELECT DISTINCT ON (v.inventory_accounting_id)
    v.inventory_accounting_id,
    v.dealership_id,
    v.vehicle_id,
    v.accounting_date,
    v.acquisition_date,
    v.control_account_category,
    v.acquisition_cost,
    v.capitalized_transportation,
    v.capitalized_reconditioning,
    v.capitalized_accessories,
    v.other_capitalized_costs,
    v.write_down_amount,
    v.current_book_value,
    v.floorplan_principal,
    v.days_in_stock,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_inventory_accounting_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.inventory_accounting_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_inventory_accounting IS
    'Grain: one row per inventory_accounting_id, restricted to the most recent
raw.inventory_accounting_load batch and to rows that satisfy every type, completeness and domain rule.
Duplicates are resolved by keeping the highest raw_record_id; the losers are reported by
staging.stg_inventory_accounting_rejected under REJ-KEY-001. This view is the only input the warehouse
fact load reads. It carries the stock-level accounting schedule and computes no balance, variance or
reconciliation: those belong to the reporting layer.';

COMMENT ON COLUMN staging.stg_inventory_accounting.inventory_accounting_id IS 'Natural key, IAS-########.';
COMMENT ON COLUMN staging.stg_inventory_accounting.dealership_id IS 'Store carrying the unit.';
COMMENT ON COLUMN staging.stg_inventory_accounting.vehicle_id IS 'The carried unit.';
COMMENT ON COLUMN staging.stg_inventory_accounting.accounting_date IS 'Month-end the position is stated as at. Part of the declared grain.';
COMMENT ON COLUMN staging.stg_inventory_accounting.acquisition_date IS 'Date the store took the unit into stock. With accounting_date this is the only supportable posting-lag pair in the model.';
COMMENT ON COLUMN staging.stg_inventory_accounting.control_account_category IS 'New, Used or Certified Vehicle Inventory. One unit resolves to exactly one.';
COMMENT ON COLUMN staging.stg_inventory_accounting.acquisition_cost IS 'What the store paid. The acquisition event's own figure, to the cent.';
COMMENT ON COLUMN staging.stg_inventory_accounting.capitalized_transportation IS 'Inbound freight capitalized into the unit. Zero where the unit was driven in.';
COMMENT ON COLUMN staging.stg_inventory_accounting.capitalized_reconditioning IS 'Reconditioning capitalized into the unit.';
COMMENT ON COLUMN staging.stg_inventory_accounting.capitalized_accessories IS 'Accessories fitted and capitalized.';
COMMENT ON COLUMN staging.stg_inventory_accounting.other_capitalized_costs IS 'Other capitalized cost; the certification inspection on a certified unit.';
COMMENT ON COLUMN staging.stg_inventory_accounting.write_down_amount IS 'Cumulative synthetic accounting write-down as at this date. Never a market-value estimate.';
COMMENT ON COLUMN staging.stg_inventory_accounting.current_book_value IS 'The carrying value. Equals its declared components exactly, enforced by CHECK on the fact.';
COMMENT ON COLUMN staging.stg_inventory_accounting.floorplan_principal IS 'Principal owed against the unit. A LIABILITY POSITION: never added to, subtracted from or netted against book value. 0.00 is an owned, unfloored unit.';
COMMENT ON COLUMN staging.stg_inventory_accounting.days_in_stock IS 'Accounting date less acquisition date.';
COMMENT ON COLUMN staging.stg_inventory_accounting.source_system IS 'Originating system; constant SYNTHETIC-DMS-ACCOUNTING.';
COMMENT ON COLUMN staging.stg_inventory_accounting.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_inventory_accounting.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_inventory_accounting.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_inventory_accounting.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_inventory_accounting.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_inventory_accounting_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'inventory_accounting_snapshot'::text AS source_entity,
    coalesce(v.src_inventory_accounting_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (inventory_accounting_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_inventory_accounting_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_inventory_accounting_rejected IS
    'Grain: one row per row of the most recent raw.inventory_accounting_load batch that staging.stg_inventory_accounting did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows
are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_inventory_accounting_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
