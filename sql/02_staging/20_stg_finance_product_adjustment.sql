-- =============================================================================
-- File:            sql/02_staging/20_stg_finance_product_adjustment.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Typed, domain-filtered and deduplicated view over the newest raw.finance_product_adjustment_load batch, plus its rejected-row companion.
-- Execution order: After raw.finance_product_adjustment_load and the staging cast helpers, before anything reads staging.stg_finance_product_adjustment.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only.
-- Grain:           staging.stg_finance_product_adjustment: one accepted row per adjustment_id in the most recent load batch.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- =============================================================================
--
-- THE SIGN CONVENTION, ENFORCED HERE ROW BY ROW
-- ---------------------------------------------
--     net_product_gross_as_of = original_product_gross
--                             - SUM(adjustment_amount WHERE adjustment_date <= as_of)
--
-- A POSITIVE amount REDUCES retained gross; a NEGATIVE one restores it. Cancellation and
-- Chargeback must therefore be positive and Reinstatement negative, and a row that
-- breaks that is rejected rather than stored: a mixed convention does not make the as-of
-- identity wrong, it makes it AMBIGUOUS, which is worse because nothing fails.
--
-- REASON CATEGORIES ARE CHECKED AGAINST THE TYPE, not merely against the vocabulary. A
-- 'Repossession' is a governed reason -- for a Chargeback. Recording it against a
-- Reinstatement would be a governed word in a nonsensical place.
--
-- WHAT STAGING CANNOT ENFORCE, AND WHO DOES. The cumulative cap, the reinstatement's
-- need for a prior reduction, and 'no adjustment predates its contract' are all
-- properties of a SEQUENCE across two tables. A view over one landing table cannot see
-- them. DQ-FPA-004, DQ-FPA-007 and DQ-FPA-008 own them in Python, and
-- RECON-FI-ADJUSTMENT-CAP and RECON-FI-ADJUSTMENT-SEQUENCE own them in SQL once every
-- table exists.

CREATE OR REPLACE VIEW staging.stg_finance_product_adjustment_typed AS
WITH latest_batch AS (
    SELECT r.load_batch_id
    FROM raw.finance_product_adjustment_load AS r
    GROUP BY r.load_batch_id
    ORDER BY max(r.ingested_at) DESC, max(r.raw_record_id) DESC
    LIMIT 1
),
trimmed AS (
    -- Empty string and whitespace mean 'absent'; the raw layer keeps both verbatim.
    SELECT
        nullif(btrim(r.adjustment_id), '') AS src_adjustment_id,
        nullif(btrim(r.product_sale_id), '') AS src_product_sale_id,
        nullif(btrim(r.sale_id), '') AS src_sale_id,
        nullif(btrim(r.adjustment_date), '') AS src_adjustment_date,
        nullif(btrim(r.dealership_id), '') AS src_dealership_id,
        nullif(btrim(r.finance_manager_id), '') AS src_finance_manager_id,
        nullif(btrim(r.finance_product_id), '') AS src_finance_product_id,
        nullif(btrim(r.product_category), '') AS src_product_category,
        nullif(btrim(r.adjustment_type), '') AS src_adjustment_type,
        nullif(btrim(r.adjustment_amount), '') AS src_adjustment_amount,
        nullif(btrim(r.adjustment_reason_category), '') AS src_adjustment_reason_category,
        nullif(btrim(r.sequence_ordinal), '') AS src_sequence_ordinal,
        nullif(btrim(r.source_system), '') AS src_source_system,
        r.raw_record_id,
        r.load_batch_id,
        r.source_file_name,
        r.source_row_number,
        r.ingested_at,
        to_jsonb(r.*) AS record_payload
    FROM raw.finance_product_adjustment_load AS r
    JOIN latest_batch AS b ON b.load_batch_id = r.load_batch_id
),
cast_attempt AS (
    SELECT
        CASE WHEN length(t.src_adjustment_id) <= 16 THEN t.src_adjustment_id::varchar(16) END AS adjustment_id,
        CASE WHEN length(t.src_product_sale_id) <= 16 THEN t.src_product_sale_id::varchar(16) END AS product_sale_id,
        CASE WHEN length(t.src_sale_id) <= 16 THEN t.src_sale_id::varchar(16) END AS sale_id,
        staging.fn_try_date(t.src_adjustment_date) AS adjustment_date,
        CASE WHEN length(t.src_dealership_id) <= 16 THEN t.src_dealership_id::varchar(16) END AS dealership_id,
        CASE WHEN length(t.src_finance_manager_id) <= 16 THEN t.src_finance_manager_id::varchar(16) END AS finance_manager_id,
        CASE WHEN length(t.src_finance_product_id) <= 16 THEN t.src_finance_product_id::varchar(16) END AS finance_product_id,
        CASE WHEN length(t.src_product_category) <= 40 THEN t.src_product_category::varchar(40) END AS product_category,
        CASE WHEN length(t.src_adjustment_type) <= 24 THEN t.src_adjustment_type::varchar(24) END AS adjustment_type,
        staging.fn_try_money(t.src_adjustment_amount) AS adjustment_amount,
        CASE WHEN length(t.src_adjustment_reason_category) <= 40 THEN t.src_adjustment_reason_category::varchar(40) END AS adjustment_reason_category,
        staging.fn_try_smallint(t.src_sequence_ordinal) AS sequence_ordinal,
        CASE WHEN length(t.src_source_system) <= 40 THEN t.src_source_system::varchar(40) END AS source_system,
        t.src_adjustment_id,
        t.src_product_sale_id,
        t.src_sale_id,
        t.src_adjustment_date,
        t.src_dealership_id,
        t.src_finance_manager_id,
        t.src_finance_product_id,
        t.src_product_category,
        t.src_adjustment_type,
        t.src_adjustment_amount,
        t.src_adjustment_reason_category,
        t.src_sequence_ordinal,
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
            CASE WHEN c.src_adjustment_id IS NOT NULL AND c.adjustment_id IS NULL THEN 'adjustment_id' END,
            CASE WHEN c.src_product_sale_id IS NOT NULL AND c.product_sale_id IS NULL THEN 'product_sale_id' END,
            CASE WHEN c.src_sale_id IS NOT NULL AND c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.src_adjustment_date IS NOT NULL AND c.adjustment_date IS NULL THEN 'adjustment_date' END,
            CASE WHEN c.src_dealership_id IS NOT NULL AND c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.src_finance_manager_id IS NOT NULL AND c.finance_manager_id IS NULL THEN 'finance_manager_id' END,
            CASE WHEN c.src_finance_product_id IS NOT NULL AND c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.src_product_category IS NOT NULL AND c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.src_adjustment_type IS NOT NULL AND c.adjustment_type IS NULL THEN 'adjustment_type' END,
            CASE WHEN c.src_adjustment_amount IS NOT NULL AND c.adjustment_amount IS NULL THEN 'adjustment_amount' END,
            CASE WHEN c.src_adjustment_reason_category IS NOT NULL AND c.adjustment_reason_category IS NULL THEN 'adjustment_reason_category' END,
            CASE WHEN c.src_sequence_ordinal IS NOT NULL AND c.sequence_ordinal IS NULL THEN 'sequence_ordinal' END,
            CASE WHEN c.src_source_system IS NOT NULL AND c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS cast_failures,
        -- Required by the column contract but absent. The columns listed as
        -- deliberately optional are absent BY DESIGN: finance_manager_id (the original deal was written with nobody on the F&I desk).
        array_remove(ARRAY[
            CASE WHEN c.adjustment_id IS NULL THEN 'adjustment_id' END,
            CASE WHEN c.product_sale_id IS NULL THEN 'product_sale_id' END,
            CASE WHEN c.sale_id IS NULL THEN 'sale_id' END,
            CASE WHEN c.adjustment_date IS NULL THEN 'adjustment_date' END,
            CASE WHEN c.dealership_id IS NULL THEN 'dealership_id' END,
            CASE WHEN c.finance_product_id IS NULL THEN 'finance_product_id' END,
            CASE WHEN c.product_category IS NULL THEN 'product_category' END,
            CASE WHEN c.adjustment_type IS NULL THEN 'adjustment_type' END,
            CASE WHEN c.adjustment_amount IS NULL THEN 'adjustment_amount' END,
            CASE WHEN c.adjustment_reason_category IS NULL THEN 'adjustment_reason_category' END,
            CASE WHEN c.sequence_ordinal IS NULL THEN 'sequence_ordinal' END,
            CASE WHEN c.source_system IS NULL THEN 'source_system' END
        ], NULL) AS missing_required,
        -- Outside the enumerated domain, the permitted range, or a governed rule.
        array_remove(ARRAY[
            CASE WHEN c.product_category IS NOT NULL
                  AND c.product_category NOT IN ('Vehicle Service Contract', 'GAP', 'Tire & Wheel', 'Prepaid Maintenance', 'Appearance Protection', 'Key Replacement', 'Theft or Security Product', 'Paintless Dent Protection', 'Lease Wear Protection', 'Other Aftermarket Product')
                 THEN 'product_category' END,
            CASE WHEN c.adjustment_type IS NOT NULL
                  AND c.adjustment_type NOT IN ('Cancellation', 'Chargeback', 'Reinstatement', 'Approved Adjustment')
                 THEN 'adjustment_type' END,
            -- The sign convention, per type. Approved Adjustment is legitimately signed and
            -- is checked only for being an event at all: a zero-amount adjustment is not one.
            CASE WHEN c.adjustment_type IN ('Cancellation', 'Chargeback')
                  AND c.adjustment_amount IS NOT NULL AND c.adjustment_amount <= 0
                 THEN 'adjustment_amount' END,
            CASE WHEN c.adjustment_type = 'Reinstatement'
                  AND c.adjustment_amount IS NOT NULL AND c.adjustment_amount >= 0
                 THEN 'adjustment_amount' END,
            CASE WHEN c.adjustment_type = 'Approved Adjustment'
                  AND c.adjustment_amount IS NOT NULL AND c.adjustment_amount = 0
                 THEN 'adjustment_amount' END,
            -- The reason must belong to its own type, not merely to the vocabulary.
            CASE WHEN c.adjustment_reason_category IS NOT NULL AND c.adjustment_type IS NOT NULL
                  AND NOT (
                        (c.adjustment_type = 'Cancellation'
                         AND c.adjustment_reason_category IN ('Customer Request', 'Vehicle Sold or Traded', 'Total Loss', 'Early Payoff'))
                     OR (c.adjustment_type = 'Chargeback'
                         AND c.adjustment_reason_category IN ('Early Payoff', 'Contract Cancelled', 'Repossession', 'Total Loss'))
                     OR (c.adjustment_type = 'Reinstatement'
                         AND c.adjustment_reason_category IN ('Cancellation Rescinded', 'Administrative Correction'))
                     OR (c.adjustment_type = 'Approved Adjustment'
                         AND c.adjustment_reason_category IN ('Administrative Correction', 'Pricing Correction', 'Remittance Correction'))
                  )
                 THEN 'adjustment_reason_category' END,
            CASE WHEN c.sequence_ordinal IS NOT NULL AND c.sequence_ordinal < 1
                 THEN 'sequence_ordinal' END
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
    c.adjustment_id,
    c.product_sale_id,
    c.sale_id,
    c.adjustment_date,
    c.dealership_id,
    c.finance_manager_id,
    c.finance_product_id,
    c.product_category,
    c.adjustment_type,
    c.adjustment_amount,
    c.adjustment_reason_category,
    c.sequence_ordinal,
    c.source_system,
    -- Untyped natural-key text, kept so a rejected row can still be identified
    -- even when the cast that would have typed it is what failed.
    c.src_adjustment_id,
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
        PARTITION BY c.adjustment_id, (c.rejection_code IS NULL)
        ORDER BY c.raw_record_id DESC
    ) AS natural_key_rank
FROM classified AS c;

COMMENT ON VIEW staging.stg_finance_product_adjustment_typed IS
    'Grain: one row per row of the most recent raw.finance_product_adjustment_load batch. Internal:
every business column is cast with a non-throwing expression and the row is classified as accepted
or rejected. The governed sign convention and the reason-belongs-to-its-type rule are enforced
here as REJ-DOMAIN-001 rejections; the cumulative cap and the reinstatement sequence rule are not,
because they are properties of a sequence across two tables that this view cannot see.';

CREATE OR REPLACE VIEW staging.stg_finance_product_adjustment AS
SELECT DISTINCT ON (v.adjustment_id)
    v.adjustment_id,
    v.product_sale_id,
    v.sale_id,
    v.adjustment_date,
    v.dealership_id,
    v.finance_manager_id,
    v.finance_product_id,
    v.product_category,
    v.adjustment_type,
    v.adjustment_amount,
    v.adjustment_reason_category,
    v.sequence_ordinal,
    v.source_system,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    v.raw_record_id,
    v.ingested_at
FROM staging.stg_finance_product_adjustment_typed AS v
WHERE v.rejection_code IS NULL
ORDER BY v.adjustment_id, v.raw_record_id DESC;

COMMENT ON VIEW staging.stg_finance_product_adjustment IS
    'Grain: one row per adjustment_id, restricted to the most recent
raw.finance_product_adjustment_load batch and to rows that satisfy every type, completeness and
domain rule. The only input warehouse.fact_finance_product_adjustment is loaded from.
ADJUSTMENT-DATE BASIS: every event carries its OWN business date and the contract it acts on is
never rewritten -- an August chargeback on a June contract belongs to August, and June keeps June''s
gross. Chargeback and cancellation timing is a SYNTHETIC configured distribution, never an observed
loss rate.';

COMMENT ON COLUMN staging.stg_finance_product_adjustment.adjustment_id IS 'Natural key, FPA-########.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.product_sale_id IS 'The contract this event acts on, FPS-########. An adjustment with no contract is a number with nothing to reduce.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.sale_id IS 'The contract''s parent deal, denormalised for store-and-period reads.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.adjustment_date IS 'THE EVENT''S OWN BUSINESS DATE. Never the deal date, and never restated into the original sale month.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.dealership_id IS 'The store, carried from the contract.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.finance_manager_id IS 'The manager credited on the ORIGINAL deal. NULL where none was. Attribution follows the contract, not whoever processed the cancellation, which is not modelled.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.finance_product_id IS 'The product, carried from the contract.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.product_category IS 'The governed category, carried from the contract.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.adjustment_type IS 'Cancellation, Chargeback, Reinstatement or Approved Adjustment.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.adjustment_amount IS 'SIGNED, exact to the cent. POSITIVE REDUCES retained gross; negative restores it.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.adjustment_reason_category IS 'A governed reason category belonging to this event''s type. Never free text: a free-text reason is where somebody eventually writes something about a customer.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.sequence_ordinal IS '1-based position within the contract''s own event sequence, ordered by date.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.source_system IS 'Originating system; constant arpi_synthetic_generator.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.load_batch_id IS 'Lineage: the load batch this row came from.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.source_row_number IS 'Lineage: one-based data-row number in the source file.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.raw_record_id IS 'Lineage: raw landing-table surrogate key; also the deduplication tie-breaker.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment.ingested_at IS 'Lineage: UTC instant the raw row was landed.';

CREATE OR REPLACE VIEW staging.stg_finance_product_adjustment_rejected AS
SELECT
    v.raw_record_id,
    v.load_batch_id,
    v.source_file_name,
    v.source_row_number,
    'finance_product_adjustment'::text AS source_entity,
    coalesce(v.src_adjustment_id, '?') AS source_record_key,
    coalesce(v.rejection_code, 'REJ-KEY-001') AS rejection_code,
    coalesce(v.rejection_category, 'uniqueness') AS rejection_category,
    coalesce(
        v.rejection_reason,
        'duplicate natural key (adjustment_id) within the load batch; the row with the '
        || 'highest raw_record_id was kept'
    ) AS rejection_reason,
    v.record_payload
FROM staging.stg_finance_product_adjustment_typed AS v
WHERE v.rejection_code IS NOT NULL
   OR v.natural_key_rank > 1;

COMMENT ON VIEW staging.stg_finance_product_adjustment_rejected IS
    'Grain: one row per row of the most recent raw.finance_product_adjustment_load batch that staging.stg_finance_product_adjustment did NOT
accept. Carries the REJ-* code, its canonical validation category and the untyped source payload,
which src/arpi/ingestion/rejection.py redacts before writing to audit.rejected_record. Rejected
rows are quarantined and explained, never silently discarded.';

COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.raw_record_id IS 'Lineage: raw landing-table surrogate key of the rejected row.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.load_batch_id IS 'Lineage: the load batch the rejected row came from.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.source_file_name IS 'Lineage: source file name.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.source_row_number IS 'Lineage: one-based data-row number in the source file; recorded on the audit row.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.source_entity IS 'Entity the rejected row belongs to; written to audit.rejected_record.source_entity.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.source_record_key IS 'Best-effort natural key of the rejected row, from the untyped source text.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.rejection_code IS 'Stable REJ-* code from the register in docs/source-to-target/README.md section 4.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.rejection_category IS 'Canonical validation category the rejection belongs to.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.rejection_reason IS 'Human-readable explanation naming the offending columns.';
COMMENT ON COLUMN staging.stg_finance_product_adjustment_rejected.record_payload IS 'The untyped source row as JSON. Redacted by arpi.validation.privacy.redact_payload before persistence.';
