-- =============================================================================
-- File:            sql/02_staging/17_stg_finance_product.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.finance_product_load batch, plus its rejected-row companion.
-- Execution order: After raw.finance_product_load and the staging cast helpers, before anything reads staging.stg_finance_product.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; a view holds no rows of its own, so a rerun cannot duplicate data.
-- Grain:           staging.stg_finance_product: one accepted row per finance_product_id in the most recent load batch.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- =============================================================================
--
-- THREE VIEWS, ONE RULE SET -- the pattern staging.stg_marketing_spend establishes:
--   staging.stg_finance_product_typed     every row of the newest batch, cast and classified
--   staging.stg_finance_product           the accepted rows only (what the warehouse loads)
--   staging.stg_finance_product_rejected  the dropped rows, with a REJ-* code and a payload
--
-- WHAT STAGING OWNS FOR THIS ENTITY. It parses, validates the ten-category vocabulary and
-- the six governed ELIG-* rule identifiers, enforces the active-window ordering and the
-- is_active derivation, deduplicates deterministically and rejects what it cannot accept.
-- It DOES NOT define eligibility: config/reference/fi_product_eligibility.yaml is the one
-- authority, and a staging view that re-implemented the predicate would be a second one.
--
-- NEWEST-BATCH RULE. Identical to every other staging view: greatest max(ingested_at),
-- ties broken by greatest max(raw_record_id).

CREATE OR REPLACE VIEW staging.stg_finance_product_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.finance_product_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.finance_product_key), '') AS src_finance_product_key,
        nullif(btrim(r.finance_product_id), '') AS src_finance_product_id,
        nullif(btrim(r.product_name), '') AS src_product_name,
        nullif(btrim(r.product_category), '') AS src_product_category,
        nullif(btrim(r.provider_name), '') AS src_provider_name,
        nullif(btrim(r.eligibility_rule_id), '') AS src_eligibility_rule_id,
        nullif(btrim(r.eligible_finance_structures), '') AS src_eligible_finance_structures,
        nullif(btrim(r.eligible_vehicle_conditions), '') AS src_eligible_vehicle_conditions,
        nullif(btrim(r.default_contract_term_months), '') AS src_default_contract_term_months,
        nullif(btrim(r.cancellation_sensitive), '') AS src_cancellation_sensitive,
        nullif(btrim(r.chargeback_sensitive), '') AS src_chargeback_sensitive,
        nullif(btrim(r.active_start_date), '') AS src_active_start_date,
        nullif(btrim(r.active_end_date), '') AS src_active_end_date,
        nullif(btrim(r.is_active), '') AS src_is_active,
        nullif(btrim(r.source_system), '') AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.finance_product_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        staging.fn_try_integer(t.src_finance_product_key) AS finance_product_key,
        CASE WHEN length(t.src_finance_product_id) <= 16 THEN t.src_finance_product_id::varchar(16) END AS finance_product_id,
        CASE WHEN length(t.src_product_name) <= 80 THEN t.src_product_name::varchar(80) END AS product_name,
        CASE WHEN length(t.src_product_category) <= 40 THEN t.src_product_category::varchar(40) END AS product_category,
        CASE WHEN length(t.src_provider_name) <= 60 THEN t.src_provider_name::varchar(60) END AS provider_name,
        CASE WHEN length(t.src_eligibility_rule_id) <= 16 THEN t.src_eligibility_rule_id::varchar(16) END AS eligibility_rule_id,
        CASE WHEN length(t.src_eligible_finance_structures) <= 60 THEN t.src_eligible_finance_structures::varchar(60) END AS eligible_finance_structures,
        CASE WHEN length(t.src_eligible_vehicle_conditions) <= 40 THEN t.src_eligible_vehicle_conditions::varchar(40) END AS eligible_vehicle_conditions,
        staging.fn_try_integer(t.src_default_contract_term_months) AS default_contract_term_months,
        staging.fn_try_boolean(t.src_cancellation_sensitive) AS cancellation_sensitive,
        staging.fn_try_boolean(t.src_chargeback_sensitive) AS chargeback_sensitive,
        staging.fn_try_date(t.src_active_start_date) AS active_start_date,
        staging.fn_try_date(t.src_active_end_date) AS active_end_date,
        staging.fn_try_boolean(t.src_is_active) AS is_active,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_finance_product_key,
        t.src_finance_product_id,
        t.src_product_name,
        t.src_product_category,
        t.src_provider_name,
        t.src_eligibility_rule_id,
        t.src_eligible_finance_structures,
        t.src_eligible_vehicle_conditions,
        t.src_default_contract_term_months,
        t.src_cancellation_sensitive,
        t.src_chargeback_sensitive,
        t.src_active_start_date,
        t.src_active_end_date,
        t.src_is_active,
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
            CASE WHEN c.src_finance_product_key IS NOT NULL AND c.finance_product_key IS NULL THEN 'finance_product_key' END,
            CASE WHEN c.src_finance_product_id IS NOT NULL AND c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.src_product_name IS NOT NULL AND c.product_name IS NULL THEN 'product_name' END,
            CASE WHEN c.src_product_category IS NOT NULL AND c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.src_provider_name IS NOT NULL AND c.provider_name IS NULL THEN 'provider_name' END,
            CASE WHEN c.src_eligibility_rule_id IS NOT NULL AND c.eligibility_rule_id IS NULL THEN 'eligibility_rule_id' END,
            CASE WHEN c.src_eligible_finance_structures IS NOT NULL AND c.eligible_finance_structures IS NULL THEN 'eligible_finance_structures' END,
            CASE WHEN c.src_eligible_vehicle_conditions IS NOT NULL AND c.eligible_vehicle_conditions IS NULL THEN 'eligible_vehicle_conditions' END,
            CASE WHEN c.src_default_contract_term_months IS NOT NULL AND c.default_contract_term_months IS NULL THEN 'default_contract_term_months' END,
            CASE WHEN c.src_cancellation_sensitive IS NOT NULL AND c.cancellation_sensitive IS NULL THEN 'cancellation_sensitive' END,
            CASE WHEN c.src_chargeback_sensitive IS NOT NULL AND c.chargeback_sensitive IS NULL THEN 'chargeback_sensitive' END,
            CASE WHEN c.src_active_start_date IS NOT NULL AND c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.src_active_end_date IS NOT NULL AND c.active_end_date IS NULL THEN 'active_end_date' END,
            CASE WHEN c.src_is_active IS NOT NULL AND c.is_active IS NULL THEN 'is_active' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. The columns listed as
        -- deliberately optional are absent BY DESIGN: finance_product_key (lineage only; the warehouse assigns its own).
        array_remove(ARRAY[
            CASE WHEN c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.product_name IS NULL THEN 'product_name' END,
            CASE WHEN c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.provider_name IS NULL THEN 'provider_name' END,
            CASE WHEN c.eligibility_rule_id IS NULL THEN 'eligibility_rule_id' END,
            CASE WHEN c.eligible_finance_structures IS NULL THEN 'eligible_finance_structures' END,
            CASE WHEN c.eligible_vehicle_conditions IS NULL THEN 'eligible_vehicle_conditions' END,
            CASE WHEN c.default_contract_term_months IS NULL THEN 'default_contract_term_months' END,
            CASE WHEN c.cancellation_sensitive IS NULL THEN 'cancellation_sensitive' END,
            CASE WHEN c.chargeback_sensitive IS NULL THEN 'chargeback_sensitive' END,
            CASE WHEN c.active_start_date IS NULL THEN 'active_start_date' END,
            CASE WHEN c.active_end_date IS NULL THEN 'active_end_date' END,
            CASE WHEN c.is_active IS NULL THEN 'is_active' END,
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
            -- The PRODUCT CONTRACT's term, not a loan term: ARPI models none.
            CASE WHEN c.default_contract_term_months IS NOT NULL
                  AND (c.default_contract_term_months < 12 OR c.default_contract_term_months > 120)
                 THEN 'default_contract_term_months' END,
            CASE WHEN c.active_start_date IS NOT NULL AND c.active_end_date IS NOT NULL
                  AND c.active_end_date < c.active_start_date
                 THEN 'active_end_date' END,
            -- is_active is DERIVED from the sentinel end date and may not contradict it.
            CASE WHEN c.is_active IS NOT NULL AND c.active_end_date IS NOT NULL
                  AND c.is_active <> (c.active_end_date = DATE '9999-12-31')
                 THEN 'is_active' END
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
    c.finance_product_key,
    c.finance_product_id,
    c.product_name,
    c.product_category,
    c.provider_name,
    c.eligibility_rule_id,
    c.eligible_finance_structures,
    c.eligible_vehicle_conditions,
    c.default_contract_term_months,
    c.cancellation_sensitive,
    c.chargeback_sensitive,
    c.active_start_date,
    c.active_end_date,
    c.is_active,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_finance_product_id,
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
        PARTITION BY c.finance_product_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_finance_product_typed IS
    'Grain: one row per row of the most recent raw.finance_product_load batch. Internal: every business
column is cast with a non-throwing expression and the row is classified as accepted (rejection_code
IS NULL and natural_key_rank = 1) or rejected. staging.stg_finance_product and
staging.stg_finance_product_rejected are the two halves of this view and together reproduce it
exactly.';

CREATE OR REPLACE VIEW staging.stg_finance_product AS
SELECT DISTINCT ON (v.finance_product_id)
    v.finance_product_key,
    v.finance_product_id,
    v.product_name,
    v.product_category,
    v.provider_name,
    v.eligibility_rule_id,
    v.eligible_finance_structures,
    v.eligible_vehicle_conditions,
    v.default_contract_term_months,
    v.cancellation_sensitive,
    v.chargeback_sensitive,
    v.active_start_date,
    v.active_end_date,
    v.is_active,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_finance_product_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.finance_product_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_finance_product IS
    'Grain: one row per finance_product_id, restricted to the most recent raw.finance_product_load batch
and to rows that satisfy every type, completeness and domain rule. Duplicates are resolved by
keeping the highest raw_record_id; the losers are reported by staging.stg_finance_product_rejected
under REJ-KEY-001. This view is the only input warehouse.dim_finance_product is merged from. EVERY
PRODUCT AND ADMINISTRATOR IS FICTIONAL. Eligibility is NOT defined here:
config/reference/fi_product_eligibility.yaml is the one authority and eligibility_rule_id is
stamped from it.';

COMMENT ON COLUMN staging.stg_finance_product.finance_product_key IS 'Generator-assigned ordinal, lineage only. The merge assigns the warehouse surrogate key and ignores this.';
COMMENT ON COLUMN staging.stg_finance_product.finance_product_id IS 'Natural key, FP-###.';
COMMENT ON COLUMN staging.stg_finance_product.product_name IS 'Fictional product label. Names an INVENTED product, never a person and never a real F&I program.';
COMMENT ON COLUMN staging.stg_finance_product.product_category IS 'One of the ten governed categories. A ROW VALUE, never a column.';
COMMENT ON COLUMN staging.stg_finance_product.provider_name IS 'Fictional administrator label. An ATTRIBUTE of the product by deliberate decision (DASH.6-01).';
COMMENT ON COLUMN staging.stg_finance_product.eligibility_rule_id IS 'The ELIG-* rule the category owns, stamped from the governed configuration.';
COMMENT ON COLUMN staging.stg_finance_product.eligible_finance_structures IS 'Pipe-delimited descriptive metadata DERIVED from the governed rule. Never an authority for it.';
COMMENT ON COLUMN staging.stg_finance_product.eligible_vehicle_conditions IS 'Pipe-delimited descriptive metadata DERIVED from the governed rule.';
COMMENT ON COLUMN staging.stg_finance_product.default_contract_term_months IS 'The PRODUCT CONTRACT''s default term. NOT a finance loan term: ARPI models none.';
COMMENT ON COLUMN staging.stg_finance_product.cancellation_sensitive IS 'Whether the contract can be cancelled for a refund. Behavioural: the adjustment generator reads it.';
COMMENT ON COLUMN staging.stg_finance_product.chargeback_sensitive IS 'Whether the store''s income is charged back when the contract ends early. Behavioural.';
COMMENT ON COLUMN staging.stg_finance_product.active_start_date IS 'First date the product was offered. An attribute, not an SCD Type 2 effective date.';
COMMENT ON COLUMN staging.stg_finance_product.active_end_date IS 'Last date offered, or the 9999-12-31 open-ended sentinel.';
COMMENT ON COLUMN staging.stg_finance_product.is_active IS 'DERIVED from active_end_date; a row where the two disagree is rejected as REJ-DOMAIN-001.';
COMMENT ON COLUMN staging.stg_finance_product.source_system IS 'Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN staging.stg_finance_product.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_finance_product.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_finance_product.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_finance_product.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_finance_product_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'finance_product'::text AS source_entity,
    coalesce(v.src_finance_product_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (finance_product_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_finance_product_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_finance_product_rejected IS
    'Grain: one row per row of the most recent raw.finance_product_load batch that staging.stg_finance_product did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected
rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_finance_product_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_finance_product_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
