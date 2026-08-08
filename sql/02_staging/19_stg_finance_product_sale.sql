-- =============================================================================
-- File:            sql/02_staging/19_stg_finance_product_sale.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.finance_product_sale_load batch, plus its rejected-row companion.
-- Execution order: After raw.finance_product_sale_load and the staging cast helpers, before anything reads staging.stg_finance_product_sale.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Grain:           staging.stg_finance_product_sale: one accepted row per product_sale_id in the most recent load batch.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- =============================================================================
--
-- THE ONE ARITHMETIC RULE STAGING ENFORCES HERE
-- ---------------------------------------------
--     original_product_gross = product_retail_price - product_dealer_cost
--
-- Exact to the cent, with no tolerance. It is enforced here as well as on the fact
-- because a row that reached the warehouse and violated it would abort the whole load on
-- a CHECK constraint, taking every other contract with it; rejecting it in staging
-- quarantines the one bad row and explains it. Both layers assert the same identity,
-- which is the point: staging says which row, the CHECK says it can never be stored.
--
-- WHAT STAGING DOES NOT DO. It does not evaluate eligibility. That predicate has one
-- authority -- config/reference/fi_product_eligibility.yaml -- and it needs the parent
-- deal's finance structure and the vehicle's condition, which is a cross-table question a
-- staging view over one landing table cannot answer honestly. DQ-FPS-011 asks it in
-- Python against the same authority, and RECON-FI-ELIGIBILITY asks it in SQL once every
-- table involved exists.
--
-- NO RATE, PAYMENT OR CREDIT COLUMN EXISTS. contract_term_months is the term of the
-- PRODUCT CONTRACT and is not a loan term.

CREATE OR REPLACE VIEW staging.stg_finance_product_sale_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.finance_product_sale_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.product_sale_id), '') AS src_product_sale_id,
        nullif(btrim(r.sale_id), '') AS src_sale_id,
        nullif(btrim(r.sale_date), '') AS src_sale_date,
        nullif(btrim(r.dealership_id), '') AS src_dealership_id,
        nullif(btrim(r.finance_manager_id), '') AS src_finance_manager_id,
        nullif(btrim(r.finance_product_id), '') AS src_finance_product_id,
        nullif(btrim(r.lender_id), '') AS src_lender_id,
        nullif(btrim(r.finance_structure), '') AS src_finance_structure,
        nullif(btrim(r.product_category), '') AS src_product_category,
        nullif(btrim(r.eligibility_rule_id), '') AS src_eligibility_rule_id,
        nullif(btrim(r.line_ordinal), '') AS src_line_ordinal,
        nullif(btrim(r.product_sale_count), '') AS src_product_sale_count,
        nullif(btrim(r.product_retail_price), '') AS src_product_retail_price,
        nullif(btrim(r.product_dealer_cost), '') AS src_product_dealer_cost,
        nullif(btrim(r.original_product_gross), '') AS src_original_product_gross,
        nullif(btrim(r.contract_term_months), '') AS src_contract_term_months,
        nullif(btrim(r.source_system), '') AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.finance_product_sale_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_product_sale_id) <= 16 THEN t.src_product_sale_id::varchar(16) END AS product_sale_id,
        CASE WHEN length(t.src_sale_id) <= 16 THEN t.src_sale_id::varchar(16) END AS sale_id,
        staging.fn_try_date(t.src_sale_date) AS sale_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_finance_manager_id) <= 16 THEN t.src_finance_manager_id::varchar(16) END AS finance_manager_id,
        CASE WHEN length(t.src_finance_product_id) <= 16 THEN t.src_finance_product_id::varchar(16) END AS finance_product_id,
        CASE WHEN length(t.src_lender_id) <= 16 THEN t.src_lender_id::varchar(16) END AS lender_id,
        CASE WHEN length(t.src_finance_structure) <= 20 THEN t.src_finance_structure::varchar(20) END AS finance_structure,
        CASE WHEN length(t.src_product_category) <= 40 THEN t.src_product_category::varchar(40) END AS product_category,
        CASE WHEN length(t.src_eligibility_rule_id) <= 16 THEN t.src_eligibility_rule_id::varchar(16) END AS eligibility_rule_id,
        staging.fn_try_smallint(t.src_line_ordinal) AS line_ordinal,
        staging.fn_try_smallint(t.src_product_sale_count) AS product_sale_count,
        staging.fn_try_money(t.src_product_retail_price) AS product_retail_price,
        staging.fn_try_money(t.src_product_dealer_cost) AS product_dealer_cost,
        staging.fn_try_money(t.src_original_product_gross) AS original_product_gross,
        staging.fn_try_smallint(t.src_contract_term_months) AS contract_term_months,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_product_sale_id,
        t.src_sale_id,
        t.src_sale_date,
        t.src_dealership_id,
        t.src_finance_manager_id,
        t.src_finance_product_id,
        t.src_lender_id,
        t.src_finance_structure,
        t.src_product_category,
        t.src_eligibility_rule_id,
        t.src_line_ordinal,
        t.src_product_sale_count,
        t.src_product_retail_price,
        t.src_product_dealer_cost,
        t.src_original_product_gross,
        t.src_contract_term_months,
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
            CASE WHEN c.src_product_sale_id IS NOT NULL AND c.product_sale_id IS NULL THEN 'product_sale_id' END,
            CASE WHEN c.src_sale_id IS NOT NULL AND c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.src_sale_date IS NOT NULL AND c.sale_date IS NULL THEN 'sale_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_finance_manager_id IS NOT NULL AND c.finance_manager_id IS NULL THEN 'finance_manager_id' END,
            CASE WHEN c.src_finance_product_id IS NOT NULL AND c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.src_lender_id IS NOT NULL AND c.lender_id IS NULL THEN 'lender_id' END,
            CASE WHEN c.src_finance_structure IS NOT NULL AND c.finance_structure IS NULL THEN 'finance_structure' END,
            CASE WHEN c.src_product_category IS NOT NULL AND c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.src_eligibility_rule_id IS NOT NULL AND c.eligibility_rule_id IS NULL THEN 'eligibility_rule_id' END,
            CASE WHEN c.src_line_ordinal IS NOT NULL AND c.line_ordinal IS NULL THEN 'line_ordinal' END,
            CASE WHEN c.src_product_sale_count IS NOT NULL AND c.product_sale_count IS NULL THEN 'product_sale_count' END,
            CASE WHEN c.src_product_retail_price IS NOT NULL AND c.product_retail_price IS NULL THEN 'product_retail_price' END,
            CASE WHEN c.src_product_dealer_cost IS NOT NULL AND c.product_dealer_cost IS NULL THEN 'product_dealer_cost' END,
            CASE WHEN c.src_original_product_gross IS NOT NULL AND c.original_product_gross IS NULL THEN 'original_product_gross' END,
            CASE WHEN c.src_contract_term_months IS NOT NULL AND c.contract_term_months IS NULL THEN 'contract_term_months' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. The columns listed as
        -- deliberately optional are absent BY DESIGN: finance_manager_id (the deal was written with nobody on the F&I desk), lender_id (NO LENDER EXISTS: the parent deal borrowed nothing).
        array_remove(ARRAY[
            CASE WHEN c.product_sale_id IS NULL THEN 'product_sale_id' END,
            CASE WHEN c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.sale_date IS NULL THEN 'sale_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.finance_structure IS NULL THEN 'finance_structure' END,
            CASE WHEN c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.eligibility_rule_id IS NULL THEN 'eligibility_rule_id' END,
            CASE WHEN c.line_ordinal IS NULL THEN 'line_ordinal' END,
            CASE WHEN c.product_sale_count IS NULL THEN 'product_sale_count' END,
            CASE WHEN c.product_retail_price IS NULL THEN 'product_retail_price' END,
            CASE WHEN c.product_dealer_cost IS NULL THEN 'product_dealer_cost' END,
            CASE WHEN c.original_product_gross IS NULL THEN 'original_product_gross' END,
            CASE WHEN c.contract_term_months IS NULL THEN 'contract_term_months' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain, the permitted range, or a governed rule.
        array_remove(ARRAY[
            CASE WHEN c.product_category IS NOT NULL
                  AND c.product_category NOT IN ('Vehicle Service Contract', 'GAP', 'Tire & Wheel', 'Prepaid Maintenance', 'Appearance Protection', 'Key Replacement', 'Theft or Security Product', 'Paintless Dent Protection', 'Lease Wear Protection', 'Other Aftermarket Product')
                 THEN 'product_category' END,
            CASE WHEN c.eligibility_rule_id IS NOT NULL
                  AND c.eligibility_rule_id NOT IN ('ELIG-VSC', 'ELIG-GAP', 'ELIG-TW', 'ELIG-PPM', 'ELIG-LWP', 'ELIG-OTH')
                 THEN 'eligibility_rule_id' END,
            -- The three RETAIL structures only. A wholesale or dealer-trade disposal has no
            -- consumer, so no product can be written on one.
            CASE WHEN c.finance_structure IS NOT NULL
                  AND c.finance_structure NOT IN ('Cash', 'Retail Finance', 'Lease')
                 THEN 'finance_structure' END,
            CASE WHEN c.product_sale_count IS NOT NULL AND c.product_sale_count <> 1
                 THEN 'product_sale_count' END,
            CASE WHEN c.line_ordinal IS NOT NULL AND c.line_ordinal < 1 THEN 'line_ordinal' END,
            CASE WHEN c.product_retail_price IS NOT NULL AND c.product_retail_price < 0
                 THEN 'product_retail_price' END,
            CASE WHEN c.product_dealer_cost IS NOT NULL AND c.product_dealer_cost < 0
                 THEN 'product_dealer_cost' END,
            -- THE PRODUCT PRICE IDENTITY, exact to the cent and with no tolerance.
            CASE WHEN c.product_retail_price IS NOT NULL AND c.product_dealer_cost IS NOT NULL
                  AND c.original_product_gross IS NOT NULL
                  AND c.original_product_gross <> c.product_retail_price - c.product_dealer_cost
                 THEN 'original_product_gross' END,
            -- The COVERAGE''s term, not a loan term.
            CASE WHEN c.contract_term_months IS NOT NULL
                  AND (c.contract_term_months < 12 OR c.contract_term_months > 120)
                 THEN 'contract_term_months' END,
            -- A cash deal borrowed nothing, so it can name no lender. The converse -- that a
            -- financed deal DOES name one -- spans two tables and is DQ-SLE-012''s.
            CASE WHEN c.finance_structure = 'Cash' AND c.lender_id IS NOT NULL
                 THEN 'lender_id' END
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
                THEN 'value outside its governed domain, range or rule: '
                     || array_to_string(f.domain_failures, ', ')
        END AS rejection_reason
    FROM flagged AS f
)
SELECT
    c.product_sale_id,
    c.sale_id,
    c.sale_date,
    c.dealership_id,
    c.finance_manager_id,
    c.finance_product_id,
    c.lender_id,
    c.finance_structure,
    c.product_category,
    c.eligibility_rule_id,
    c.line_ordinal,
    c.product_sale_count,
    c.product_retail_price,
    c.product_dealer_cost,
    c.original_product_gross,
    c.contract_term_months,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_product_sale_id,
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
        PARTITION BY c.product_sale_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_finance_product_sale_typed IS
    'Grain: one row per row of the most recent raw.finance_product_sale_load batch. Internal: every
business column is cast with a non-throwing expression and the row is classified as accepted or
rejected. The product price identity original_product_gross = product_retail_price -
product_dealer_cost is enforced HERE as a REJ-DOMAIN-001 rejection as well as on the fact as a
CHECK, so a violating row is quarantined and explained rather than aborting the whole load.';

CREATE OR REPLACE VIEW staging.stg_finance_product_sale AS
SELECT DISTINCT ON (v.product_sale_id)
    v.product_sale_id,
    v.sale_id,
    v.sale_date,
    v.dealership_id,
    v.finance_manager_id,
    v.finance_product_id,
    v.lender_id,
    v.finance_structure,
    v.product_category,
    v.eligibility_rule_id,
    v.line_ordinal,
    v.product_sale_count,
    v.product_retail_price,
    v.product_dealer_cost,
    v.original_product_gross,
    v.contract_term_months,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_finance_product_sale_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.product_sale_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_finance_product_sale IS
    'Grain: one row per product_sale_id, restricted to the most recent raw.finance_product_sale_load
batch and to rows that satisfy every type, completeness, domain and arithmetic rule. The only
input warehouse.fact_finance_product_sale is loaded from. DEAL-DATE BASIS: sale_date is the parent
deal''s date and is the only date this entity carries; a later cancellation or chargeback is a
separate event and never rewrites one of these rows. Prices are SYNTHETIC and are never market or
recommended prices.';

COMMENT ON COLUMN staging.stg_finance_product_sale.product_sale_id IS 'Natural key, FPS-########. The stable business identifier an adjustment references.';
COMMENT ON COLUMN staging.stg_finance_product_sale.sale_id IS 'The parent finalized transaction, SLE-########.';
COMMENT ON COLUMN staging.stg_finance_product_sale.sale_date IS 'The parent deal''s date. THE ONLY DATE THIS ENTITY CARRIES.';
COMMENT ON COLUMN staging.stg_finance_product_sale.dealership_id IS 'Selling store, carried from the parent deal.';
COMMENT ON COLUMN staging.stg_finance_product_sale.finance_manager_id IS 'The F&I manager credited on the parent deal. NULL means the deal was written with nobody on the desk -- a modelled state, not a missing value.';
COMMENT ON COLUMN staging.stg_finance_product_sale.finance_product_id IS 'The catalogued product, FP-###.';
COMMENT ON COLUMN staging.stg_finance_product_sale.lender_id IS 'The parent deal''s fictional lender. NULL means NO LENDER EXISTS, never ''lender unknown''.';
COMMENT ON COLUMN staging.stg_finance_product_sale.finance_structure IS 'Cash, Retail Finance or Lease, DERIVED from the parent deal''s sale type and financed amount. Never a disposal: no product can be written on one.';
COMMENT ON COLUMN staging.stg_finance_product_sale.product_category IS 'One of the ten governed categories, denormalised from the catalogue.';
COMMENT ON COLUMN staging.stg_finance_product_sale.eligibility_rule_id IS 'The ELIG-* rule the parent deal satisfied for this category.';
COMMENT ON COLUMN staging.stg_finance_product_sale.line_ordinal IS '1-based position within the deal, in catalogue-category order.';
COMMENT ON COLUMN staging.stg_finance_product_sale.product_sale_count IS 'Always 1. A column rather than a count(*), so a contract count cannot be inflated by a join fan-out.';
COMMENT ON COLUMN staging.stg_finance_product_sale.product_retail_price IS 'SYNTHETIC price charged, exact to the cent. Never a market or recommended price.';
COMMENT ON COLUMN staging.stg_finance_product_sale.product_dealer_cost IS 'SYNTHETIC cost to the store, exact to the cent.';
COMMENT ON COLUMN staging.stg_finance_product_sale.original_product_gross IS 'retail price minus dealer cost, exact. THE DEAL-DATE PRODUCTION FIGURE; later adjustments never change it.';
COMMENT ON COLUMN staging.stg_finance_product_sale.contract_term_months IS 'The PRODUCT CONTRACT''s term. NOT a finance loan term: ARPI models none.';
COMMENT ON COLUMN staging.stg_finance_product_sale.source_system IS 'Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN staging.stg_finance_product_sale.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_finance_product_sale.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product_sale.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_finance_product_sale.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_finance_product_sale.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_finance_product_sale_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'finance_product_sale'::text AS source_entity,
    coalesce(v.src_product_sale_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (product_sale_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_finance_product_sale_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_finance_product_sale_rejected IS
    'Grain: one row per row of the most recent raw.finance_product_sale_load batch that staging.stg_finance_product_sale did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected
rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_finance_product_sale_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
