-- =============================================================================
-- File:            sql/08_validation/02_dim_dealership_checks.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Implement data-quality checks DQ-DLR-001 through DQ-DLR-005 against warehouse.dim_dealership in SQL.
-- Execution order: 22 of 25 — after the dim_date checks.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW; evaluating the view has no side effects and writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per check (five rows), in the uniform shape defined by audit.vw_dq_result_template.
-- =============================================================================
--
-- Run it:     SELECT * FROM audit.vw_dq_dim_dealership ORDER BY check_id;
--
--   DQ-DLR-001  dealership_key is unique
--   DQ-DLR-002  dealership_id is unique among current rows
--   DQ-DLR-003  the current store count matches configuration
--   DQ-DLR-004  no prohibited personal-data column exists on the dimension
--   DQ-DLR-005  franchise stores name their brand, independents do not
--
-- DQ-DLR-004 is a schema check rather than a data check, so it is meaningful even
-- when the dimension is empty and is never skipped. It is the automated form of
-- the privacy promise in PRIVACY_AND_ETHICS.md: ARPI stores no street address, no
-- telephone number, no e-mail address, no personal name and no geography finer
-- than city. A future migration that adds such a column fails this check
-- immediately instead of quietly shipping.

CREATE OR REPLACE VIEW audit.vw_dq_dim_dealership AS
WITH base AS (
    SELECT
        count(*)                                                          AS row_count,
        count(DISTINCT d.dealership_key)                                  AS distinct_key_count,
        count(*) FILTER (WHERE d.is_current)                              AS current_row_count,
        count(DISTINCT d.dealership_id) FILTER (WHERE d.is_current)       AS distinct_current_id_count,
        count(*) FILTER (
            WHERE d.is_current
              AND (
                   (d.store_type = 'Independent Used' AND d.franchise_brand IS NOT NULL)
                OR (d.store_type <> 'Independent Used' AND d.franchise_brand IS NULL)
              )
        )                                                                 AS franchise_brand_violation_count
    FROM warehouse.dim_dealership AS d
),
prohibited_columns AS (
    -- Column-name patterns that would indicate personal or over-precise data.
    -- Matched case-insensitively against the physical column names of the
    -- dimension. `city`, `state_code` and `market_region` are permitted by design.
    SELECT
        count(*)                                       AS violation_count,
        coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '') AS violation_list
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'warehouse'
      AND c.table_name   = 'dim_dealership'
      AND (
              c.column_name ~* '(street|address|addr_line)'
           OR c.column_name ~* '(phone|telephone|mobile|fax)'
           OR c.column_name ~* '(email|e_mail)'
           OR c.column_name ~* '(ssn|social_security|tax_id|ein)'
           OR c.column_name ~* '(birth|dob)'
           OR c.column_name ~* '(first_name|last_name|full_name|contact_name|customer_name|owner_name)'
           OR c.column_name ~* '(latitude|longitude|geocode|lat_lon)'
           OR c.column_name ~* '(zip|postal|postcode)'
          )
),
config AS (
    -- generation.store_count is 3 in every ARPI profile: the fictional Granite
    -- State Auto Group has exactly three stores (cross-agent contract section 6).
    -- Literal here because SQL cannot read the YAML profile; the Python
    -- implementation reads the configured value and the two must change together.
    SELECT 3::numeric AS expected_store_count
)

-- DQ-DLR-001 --------------------------------------------------------------
SELECT
    'DQ-DLR-001'::text                                                        AS check_id,
    'dim_dealership dealership_key is unique'::text                           AS check_name,
    'uniqueness'::text                                                        AS check_category,
    'warehouse.dim_dealership'::text                                          AS target_object,
    'critical'::text                                                          AS severity,
    CASE
        WHEN b.row_count = 0 THEN 'skipped'
        WHEN b.row_count = b.distinct_key_count THEN 'passed'
        ELSE 'failed'
    END::text                                                                 AS status,
    b.distinct_key_count::numeric                                             AS observed_value,
    b.row_count::numeric                                                      AS expected_value,
    greatest(b.row_count - b.distinct_key_count, 0)::bigint                   AS failed_record_count,
    CASE
        WHEN b.row_count = 0 THEN 'warehouse.dim_dealership is empty; uniqueness not evaluated.'
        WHEN b.row_count = b.distinct_key_count
            THEN format('%s version rows, %s distinct dealership_key values.', b.row_count, b.distinct_key_count)
        ELSE format('%s duplicate dealership_key values across %s version rows.',
                    b.row_count - b.distinct_key_count, b.row_count)
    END::text                                                                 AS message
FROM base AS b

UNION ALL

-- DQ-DLR-002 --------------------------------------------------------------
SELECT
    'DQ-DLR-002'::text,
    'dim_dealership dealership_id is unique among current rows'::text,
    'uniqueness'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE
        WHEN b.row_count = 0 THEN 'skipped'
        WHEN b.current_row_count = b.distinct_current_id_count THEN 'passed'
        ELSE 'failed'
    END::text,
    b.distinct_current_id_count::numeric,
    b.current_row_count::numeric,
    greatest(b.current_row_count - b.distinct_current_id_count, 0)::bigint,
    CASE
        WHEN b.row_count = 0 THEN 'warehouse.dim_dealership is empty; current-row uniqueness not evaluated.'
        WHEN b.current_row_count = b.distinct_current_id_count
            THEN format('%s current rows for %s distinct stores: exactly one live version each.',
                        b.current_row_count, b.distinct_current_id_count)
        ELSE format('SCD Type 2 grain violated: %s current rows for only %s distinct stores.',
                    b.current_row_count, b.distinct_current_id_count)
    END::text
FROM base AS b

UNION ALL

-- DQ-DLR-003 --------------------------------------------------------------
SELECT
    'DQ-DLR-003'::text,
    'dim_dealership current store count matches configuration'::text,
    'business_rule'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE
        WHEN b.row_count = 0 THEN 'skipped'
        WHEN b.current_row_count::numeric = c.expected_store_count THEN 'passed'
        ELSE 'failed'
    END::text,
    b.current_row_count::numeric,
    c.expected_store_count,
    abs(b.current_row_count::numeric - c.expected_store_count)::bigint,
    CASE
        WHEN b.row_count = 0 THEN 'warehouse.dim_dealership is empty; store count not evaluated.'
        WHEN b.current_row_count::numeric = c.expected_store_count
            THEN format('%s current stores, matching the configured generation.store_count of %s.',
                        b.current_row_count, c.expected_store_count)
        ELSE format('%s current stores but generation.store_count is %s. The generator must fail rather than '
                    'silently produce a different number of stores.',
                    b.current_row_count, c.expected_store_count)
    END::text
FROM base AS b
CROSS JOIN config AS c

UNION ALL

-- DQ-DLR-004 --------------------------------------------------------------
SELECT
    'DQ-DLR-004'::text,
    'dim_dealership has no prohibited personal-data columns'::text,
    'schema'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE WHEN p.violation_count = 0 THEN 'passed' ELSE 'failed' END::text,
    p.violation_count::numeric,
    0::numeric,
    p.violation_count::bigint,
    CASE
        WHEN p.violation_count = 0
            THEN 'No street address, telephone, e-mail, personal name, identifier or sub-city geography '
                 'column exists on warehouse.dim_dealership, as required by PRIVACY_AND_ETHICS.md.'
        ELSE format('Prohibited column(s) present on warehouse.dim_dealership: %s. ARPI must not store '
                    'personal data or geography finer than city.', p.violation_list)
    END::text
FROM prohibited_columns AS p

UNION ALL

-- DQ-DLR-005 --------------------------------------------------------------
SELECT
    'DQ-DLR-005'::text,
    'dim_dealership franchise brand present for franchise stores'::text,
    'business_rule'::text,
    'warehouse.dim_dealership'::text,
    'critical'::text,
    CASE
        WHEN b.row_count = 0 THEN 'skipped'
        WHEN b.franchise_brand_violation_count = 0 THEN 'passed'
        ELSE 'failed'
    END::text,
    b.franchise_brand_violation_count::numeric,
    0::numeric,
    b.franchise_brand_violation_count::bigint,
    CASE
        WHEN b.row_count = 0 THEN 'warehouse.dim_dealership is empty; franchise brand rule not evaluated.'
        WHEN b.franchise_brand_violation_count = 0
            THEN format('All %s current stores follow the rule: a franchise store names its brand, an '
                        'Independent Used store leaves it NULL.', b.current_row_count)
        ELSE format('%s current store(s) break the franchise brand rule: a franchise store with no brand, '
                    'or an Independent Used store that names one.', b.franchise_brand_violation_count)
    END::text
FROM base AS b;

COMMENT ON VIEW audit.vw_dq_dim_dealership IS
    'Grain: one row per check (DQ-DLR-001..005), in the uniform shape of audit.vw_dq_result_template. '
    'SQL implementation of the warehouse.dim_dealership data-quality rules; the check identifiers match '
    'the Python validation framework exactly. DQ-DLR-004 inspects the catalogue rather than the data and '
    'is therefore evaluated even when the dimension is empty; the other four return skipped.';
