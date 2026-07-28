-- =============================================================================
-- File:            sql/02_staging/10_stg_sale_event.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.sale_event_load batch, plus its rejected-row companion.
-- Execution order: 27 of 66 — after raw.sale_event_load and the staging cast helpers, before anything reads staging.stg_sale_event.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           staging.stg_sale_event: one accepted row per sale_id in the most recent load batch.
-- =============================================================================

--
-- THREE VIEWS, ONE RULE SET
-- -------------------------
--   staging.stg_sale_event_typed     every row of the newest batch, cast and classified
--   staging.stg_sale_event           the accepted rows only (what the warehouse loads)
--   staging.stg_sale_event_rejected  the dropped rows, with a REJ-* code and a payload
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

CREATE OR REPLACE VIEW staging.stg_sale_event_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.sale_event_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.sale_id), '')                                           AS src_sale_id,
        nullif(btrim(r.sale_date), '')                                         AS src_sale_date,
        nullif(btrim(r.delivery_date), '')                                     AS src_delivery_date,
        nullif(btrim(r.dealership_id), '')                                     AS src_dealership_id,
        nullif(btrim(r.vehicle_id), '')                                        AS src_vehicle_id,
        nullif(btrim(r.customer_id), '')                                       AS src_customer_id,
        nullif(btrim(r.salesperson_id), '')                                    AS src_salesperson_id,
        nullif(btrim(r.desk_manager_id), '')                                   AS src_desk_manager_id,
        nullif(btrim(r.finance_manager_id), '')                                AS src_finance_manager_id,
        nullif(btrim(r.lead_source_id), '')                                    AS src_lead_source_id,
        nullif(btrim(r.sale_type), '')                                         AS src_sale_type,
        nullif(btrim(r.is_retail), '')                                         AS src_is_retail,
        nullif(btrim(r.unit_count), '')                                        AS src_unit_count,
        nullif(btrim(r.sale_price), '')                                        AS src_sale_price,
        nullif(btrim(r.msrp), '')                                              AS src_msrp,
        nullif(btrim(r.original_asking_price), '')                             AS src_original_asking_price,
        nullif(btrim(r.final_asking_price), '')                                AS src_final_asking_price,
        nullif(btrim(r.acquisition_cost), '')                                  AS src_acquisition_cost,
        nullif(btrim(r.reconditioning_cost), '')                               AS src_reconditioning_cost,
        nullif(btrim(r.pack_amount), '')                                       AS src_pack_amount,
        nullif(btrim(r.front_end_gross), '')                                   AS src_front_end_gross,
        nullif(btrim(r.back_end_gross), '')                                    AS src_back_end_gross,
        nullif(btrim(r.total_gross), '')                                       AS src_total_gross,
        nullif(btrim(r.trade_allowance), '')                                   AS src_trade_allowance,
        nullif(btrim(r.trade_acv), '')                                         AS src_trade_acv,
        nullif(btrim(r.cash_down), '')                                         AS src_cash_down,
        nullif(btrim(r.amount_financed), '')                                   AS src_amount_financed,
        nullif(btrim(r.days_in_inventory_at_sale), '')                         AS src_days_in_inventory_at_sale,
        nullif(btrim(r.source_system), '')                                     AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.sale_event_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_sale_id) <= 16 THEN t.src_sale_id::varchar(16) END AS sale_id,
        staging.fn_try_date(t.src_sale_date) AS sale_date,
        staging.fn_try_date(t.src_delivery_date) AS delivery_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_vehicle_id) <= 16 THEN t.src_vehicle_id::varchar(16) END AS vehicle_id,
        CASE WHEN length(t.src_customer_id) <= 16 THEN t.src_customer_id::varchar(16) END AS customer_id,
        CASE WHEN length(t.src_salesperson_id) <= 16 THEN t.src_salesperson_id::varchar(16) END AS salesperson_id,
        CASE WHEN length(t.src_desk_manager_id) <= 16 THEN t.src_desk_manager_id::varchar(16) END AS desk_manager_id,
        CASE WHEN length(t.src_finance_manager_id) <= 16 THEN t.src_finance_manager_id::varchar(16) END AS finance_manager_id,
        CASE WHEN length(t.src_lead_source_id) <= 16 THEN t.src_lead_source_id::varchar(16) END AS lead_source_id,
        CASE WHEN length(t.src_sale_type) <= 20 THEN t.src_sale_type::varchar(20) END AS sale_type,
        staging.fn_try_boolean(t.src_is_retail) AS is_retail,
        staging.fn_try_smallint(t.src_unit_count) AS unit_count,
        staging.fn_try_money(t.src_sale_price) AS sale_price,
        staging.fn_try_money(t.src_msrp) AS msrp,
        staging.fn_try_money(t.src_original_asking_price) AS original_asking_price,
        staging.fn_try_money(t.src_final_asking_price) AS final_asking_price,
        staging.fn_try_money(t.src_acquisition_cost) AS acquisition_cost,
        staging.fn_try_money(t.src_reconditioning_cost) AS reconditioning_cost,
        staging.fn_try_money(t.src_pack_amount) AS pack_amount,
        staging.fn_try_money(t.src_front_end_gross) AS front_end_gross,
        staging.fn_try_money(t.src_back_end_gross) AS back_end_gross,
        staging.fn_try_money(t.src_total_gross) AS total_gross,
        staging.fn_try_money(t.src_trade_allowance) AS trade_allowance,
        staging.fn_try_money(t.src_trade_acv) AS trade_acv,
        staging.fn_try_money(t.src_cash_down) AS cash_down,
        staging.fn_try_money(t.src_amount_financed) AS amount_financed,
        staging.fn_try_integer(t.src_days_in_inventory_at_sale) AS days_in_inventory_at_sale,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_sale_id,
        t.src_sale_date,
        t.src_delivery_date,
        t.src_dealership_id,
        t.src_vehicle_id,
        t.src_customer_id,
        t.src_salesperson_id,
        t.src_desk_manager_id,
        t.src_finance_manager_id,
        t.src_lead_source_id,
        t.src_sale_type,
        t.src_is_retail,
        t.src_unit_count,
        t.src_sale_price,
        t.src_msrp,
        t.src_original_asking_price,
        t.src_final_asking_price,
        t.src_acquisition_cost,
        t.src_reconditioning_cost,
        t.src_pack_amount,
        t.src_front_end_gross,
        t.src_back_end_gross,
        t.src_total_gross,
        t.src_trade_allowance,
        t.src_trade_acv,
        t.src_cash_down,
        t.src_amount_financed,
        t.src_days_in_inventory_at_sale,
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
            CASE WHEN c.src_sale_id IS NOT NULL AND c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.src_sale_date IS NOT NULL AND c.sale_date IS NULL THEN 'sale_date' END,
            CASE WHEN c.src_delivery_date IS NOT NULL AND c.delivery_date IS NULL THEN 'delivery_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_vehicle_id IS NOT NULL AND c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.src_customer_id IS NOT NULL AND c.customer_id IS NULL THEN 'customer_id' END,
            CASE WHEN c.src_salesperson_id IS NOT NULL AND c.salesperson_id IS NULL THEN 'salesperson_id' END,
            CASE WHEN c.src_desk_manager_id IS NOT NULL AND c.desk_manager_id IS NULL THEN 'desk_manager_id' END,
            CASE WHEN c.src_finance_manager_id IS NOT NULL AND c.finance_manager_id IS NULL THEN 'finance_manager_id' END,
            CASE WHEN c.src_lead_source_id IS NOT NULL AND c.lead_source_id IS NULL THEN 'lead_source_id' END,
            CASE WHEN c.src_sale_type IS NOT NULL AND c.sale_type IS NULL THEN 'sale_type' END,
            CASE WHEN c.src_is_retail IS NOT NULL AND c.is_retail IS NULL THEN 'is_retail' END,
            CASE WHEN c.src_unit_count IS NOT NULL AND c.unit_count IS NULL THEN 'unit_count' END,
            CASE WHEN c.src_sale_price IS NOT NULL AND c.sale_price IS NULL THEN 'sale_price' END,
            CASE WHEN c.src_msrp IS NOT NULL AND c.msrp IS NULL THEN 'msrp' END,
            CASE WHEN c.src_original_asking_price IS NOT NULL AND c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.src_final_asking_price IS NOT NULL AND c.final_asking_price IS NULL THEN 'final_asking_price' END,
            CASE WHEN c.src_acquisition_cost IS NOT NULL AND c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.src_reconditioning_cost IS NOT NULL AND c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.src_pack_amount IS NOT NULL AND c.pack_amount IS NULL THEN 'pack_amount' END,
            CASE WHEN c.src_front_end_gross IS NOT NULL AND c.front_end_gross IS NULL THEN 'front_end_gross' END,
            CASE WHEN c.src_back_end_gross IS NOT NULL AND c.back_end_gross IS NULL THEN 'back_end_gross' END,
            CASE WHEN c.src_total_gross IS NOT NULL AND c.total_gross IS NULL THEN 'total_gross' END,
            CASE WHEN c.src_trade_allowance IS NOT NULL AND c.trade_allowance IS NULL THEN 'trade_allowance' END,
            CASE WHEN c.src_trade_acv IS NOT NULL AND c.trade_acv IS NULL THEN 'trade_acv' END,
            CASE WHEN c.src_cash_down IS NOT NULL AND c.cash_down IS NULL THEN 'cash_down' END,
            CASE WHEN c.src_amount_financed IS NOT NULL AND c.amount_financed IS NULL THEN 'amount_financed' END,
            CASE WHEN c.src_days_in_inventory_at_sale IS NOT NULL AND c.days_in_inventory_at_sale IS NULL THEN 'days_in_inventory_at_sale' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent.
        array_remove(ARRAY[
            CASE WHEN c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.sale_date IS NULL THEN 'sale_date' END,
            CASE WHEN c.delivery_date IS NULL THEN 'delivery_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.vehicle_id IS NULL THEN 'vehicle_id' END,
            CASE WHEN c.sale_type IS NULL THEN 'sale_type' END,
            CASE WHEN c.is_retail IS NULL THEN 'is_retail' END,
            CASE WHEN c.unit_count IS NULL THEN 'unit_count' END,
            CASE WHEN c.sale_price IS NULL THEN 'sale_price' END,
            CASE WHEN c.original_asking_price IS NULL THEN 'original_asking_price' END,
            CASE WHEN c.final_asking_price IS NULL THEN 'final_asking_price' END,
            CASE WHEN c.acquisition_cost IS NULL THEN 'acquisition_cost' END,
            CASE WHEN c.reconditioning_cost IS NULL THEN 'reconditioning_cost' END,
            CASE WHEN c.pack_amount IS NULL THEN 'pack_amount' END,
            CASE WHEN c.front_end_gross IS NULL THEN 'front_end_gross' END,
            CASE WHEN c.back_end_gross IS NULL THEN 'back_end_gross' END,
            CASE WHEN c.total_gross IS NULL THEN 'total_gross' END,
            CASE WHEN c.trade_allowance IS NULL THEN 'trade_allowance' END,
            CASE WHEN c.trade_acv IS NULL THEN 'trade_acv' END,
            CASE WHEN c.cash_down IS NULL THEN 'cash_down' END,
            CASE WHEN c.amount_financed IS NULL THEN 'amount_financed' END,
            CASE WHEN c.days_in_inventory_at_sale IS NULL THEN 'days_in_inventory_at_sale' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain or the permitted numeric range.
        array_remove(ARRAY[
            CASE WHEN c.sale_type IS NOT NULL AND c.sale_type NOT IN ('New Retail', 'Used Retail', 'Certified Retail', 'Lease', 'Wholesale', 'Dealer Trade') THEN 'sale_type' END,
            CASE WHEN c.unit_count IS NOT NULL AND (c.unit_count < 1 OR c.unit_count > 1) THEN 'unit_count' END,
            CASE WHEN c.days_in_inventory_at_sale IS NOT NULL AND (c.days_in_inventory_at_sale < 0 OR c.days_in_inventory_at_sale > 3650) THEN 'days_in_inventory_at_sale' END
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
    c.sale_id,
    c.sale_date,
    c.delivery_date,
    c.dealership_id,
    c.vehicle_id,
    c.customer_id,
    c.salesperson_id,
    c.desk_manager_id,
    c.finance_manager_id,
    c.lead_source_id,
    c.sale_type,
    c.is_retail,
    c.unit_count,
    c.sale_price,
    c.msrp,
    c.original_asking_price,
    c.final_asking_price,
    c.acquisition_cost,
    c.reconditioning_cost,
    c.pack_amount,
    c.front_end_gross,
    c.back_end_gross,
    c.total_gross,
    c.trade_allowance,
    c.trade_acv,
    c.cash_down,
    c.amount_financed,
    c.days_in_inventory_at_sale,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_sale_id,
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
        PARTITION BY c.sale_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_sale_event_typed IS
    'Grain: one row per row of the most recent raw.sale_event_load batch. Internal: every business 
column is cast with a non-throwing expression and the row is classified as accepted 
(rejection_code IS NULL and natural_key_rank = 1) or rejected. staging.stg_sale_event and 
staging.stg_sale_event_rejected are the two halves of this view and together reproduce it exactly.';

CREATE OR REPLACE VIEW staging.stg_sale_event AS
SELECT DISTINCT ON (v.sale_id)
    v.sale_id,
    v.sale_date,
    v.delivery_date,
    v.dealership_id,
    v.vehicle_id,
    v.customer_id,
    v.salesperson_id,
    v.desk_manager_id,
    v.finance_manager_id,
    v.lead_source_id,
    v.sale_type,
    v.is_retail,
    v.unit_count,
    v.sale_price,
    v.msrp,
    v.original_asking_price,
    v.final_asking_price,
    v.acquisition_cost,
    v.reconditioning_cost,
    v.pack_amount,
    v.front_end_gross,
    v.back_end_gross,
    v.total_gross,
    v.trade_allowance,
    v.trade_acv,
    v.cash_down,
    v.amount_financed,
    v.days_in_inventory_at_sale,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_sale_event_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.sale_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_sale_event IS
    'Grain: one row per sale_id, restricted to the most recent raw.sale_event_load batch and to 
rows that satisfy every type, completeness and domain rule. Duplicates are resolved by keeping 
the highest raw_record_id; the losers are reported by staging.stg_sale_event_rejected under REJ-KEY-001. 
This view is the only input the warehouse merge reads.';

COMMENT ON COLUMN staging.stg_sale_event.sale_id IS 'Natural key, SLE-######## (contract section 5).';
COMMENT ON COLUMN staging.stg_sale_event.sale_date IS 'Date the deal was finalized.';
COMMENT ON COLUMN staging.stg_sale_event.delivery_date IS 'Date the vehicle was delivered; never before sale_date.';
COMMENT ON COLUMN staging.stg_sale_event.dealership_id IS 'Selling store.';
COMMENT ON COLUMN staging.stg_sale_event.vehicle_id IS 'Vehicle sold.';
COMMENT ON COLUMN staging.stg_sale_event.customer_id IS 'Buying customer; NULL only for non-retail deals (wholesale, dealer trade).';
COMMENT ON COLUMN staging.stg_sale_event.salesperson_id IS 'Selling salesperson; NULL when the deal had none.';
COMMENT ON COLUMN staging.stg_sale_event.desk_manager_id IS 'Desk manager who structured the deal; NULL when none.';
COMMENT ON COLUMN staging.stg_sale_event.finance_manager_id IS 'Finance manager who delivered the back end; NULL when none.';
COMMENT ON COLUMN staging.stg_sale_event.lead_source_id IS 'Attributed lead source; populated in P1.4.';
COMMENT ON COLUMN staging.stg_sale_event.sale_type IS 'Deal type; determines is_retail.';
COMMENT ON COLUMN staging.stg_sale_event.is_retail IS 'Derived from sale_type, never random.';
COMMENT ON COLUMN staging.stg_sale_event.unit_count IS 'Always exactly 1; the additive unit measure.';
COMMENT ON COLUMN staging.stg_sale_event.sale_price IS 'Selling price of the vehicle.';
COMMENT ON COLUMN staging.stg_sale_event.msrp IS 'Manufacturer suggested retail price; NULL when the vehicle has none.';
COMMENT ON COLUMN staging.stg_sale_event.original_asking_price IS 'First advertised asking price.';
COMMENT ON COLUMN staging.stg_sale_event.final_asking_price IS 'Advertised asking price at the time of sale.';
COMMENT ON COLUMN staging.stg_sale_event.acquisition_cost IS 'What the store paid for the vehicle.';
COMMENT ON COLUMN staging.stg_sale_event.reconditioning_cost IS 'Reconditioning spend on the vehicle.';
COMMENT ON COLUMN staging.stg_sale_event.pack_amount IS 'Internal pack withheld from front-end gross.';
COMMENT ON COLUMN staging.stg_sale_event.front_end_gross IS 'sale_price - acquisition_cost - reconditioning_cost - pack_amount.';
COMMENT ON COLUMN staging.stg_sale_event.back_end_gross IS 'Finance and insurance gross on the deal.';
COMMENT ON COLUMN staging.stg_sale_event.total_gross IS 'front_end_gross + back_end_gross.';
COMMENT ON COLUMN staging.stg_sale_event.trade_allowance IS 'Allowance credited to the customer for a trade-in.';
COMMENT ON COLUMN staging.stg_sale_event.trade_acv IS 'Actual cash value the store assigned to the trade-in.';
COMMENT ON COLUMN staging.stg_sale_event.cash_down IS 'Cash the customer put down.';
COMMENT ON COLUMN staging.stg_sale_event.amount_financed IS 'Amount financed on the deal.';
COMMENT ON COLUMN staging.stg_sale_event.days_in_inventory_at_sale IS 'Days the vehicle had been in stock when it sold.';
COMMENT ON COLUMN staging.stg_sale_event.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
COMMENT ON COLUMN staging.stg_sale_event.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_sale_event.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_sale_event.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_sale_event.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_sale_event.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_sale_event_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'sale_event'::text AS source_entity,
    coalesce(v.src_sale_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (sale_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_sale_event_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_sale_event_rejected IS
    'Grain: one row per row of the most recent raw.sale_event_load batch that staging.stg_sale_event did NOT accept. 
Carries the REJ-* code, its canonical validation category and the untyped source payload, which 
src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected rows are 
quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_sale_event_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.rejection_category IS 'Canonical validation category (contract section 2) the rejection belongs to.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_sale_event_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
