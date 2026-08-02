-- =============================================================================
-- File:            sql/08_validation/12_recon_inventory_listing.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Reconcile the sanitized inventory listing lane from workbook to warehouse, in the uniform reconciliation result shape.
-- Execution order: Validation layer, after sql/08_validation/05_reconciliation_helpers.sql and after the listing warehouse objects exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW only; evaluating a view writes nothing.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by the final pass of sql/07_security/01_grants.sql.
-- Grain:           One row per reconciliation rule.
-- =============================================================================
--
-- WHY THIS IS NOT UNIONED INTO audit.vw_recon_all
-- -----------------------------------------------
-- audit.vw_recon_all is the PIPELINE's reconciliation set. The loader evaluates and
-- records every rule in it on every database run, arpi.constants.SQL_RECONCILIATION_IDS
-- publishes the set, tests/integration/test_reconciliations.py requires a corruption
-- case proving each critical rule can actually fail, and
-- scripts/verify_cloud_database.py asserts the exact per-run count.
--
-- The listing lane does not run on that cadence. Its source is a workbook a human
-- commits, so its reconciliations answer "did THIS import move every row through", and
-- the honest moment to evaluate them is at import time against the import's own audit
-- run -- which is what arpi.inventory.importer does. Folding them into vw_recon_all
-- would record eight 0 = 0 verdicts on every ordinary pipeline run and quietly turn
-- "58 reconciliations recorded, none failing" into a number that means something
-- different depending on whether a workbook happened to be loaded.
--
-- The shape is identical, so the same recorder, the same audit table and the same
-- reporting view carry the results. Only the trigger differs.
--
-- WHAT THESE ARE AND ARE NOT
-- --------------------------
-- Every rule here is TECHNICAL LOAD EVIDENCE. "Total advertised value reconciles"
-- means the number that reached the warehouse is the number the workbook carried. It
-- is not a finding about a dealership, it is not a valuation, and it is not a
-- statement that the figure means anything commercially. See LIMITATIONS.md.

CREATE OR REPLACE VIEW audit.vw_recon_inventory_listing AS
WITH staged AS (
    SELECT
        count(*)::numeric                                                  AS accepted_rows,
        count(DISTINCT synthetic_vehicle_id)::numeric                      AS distinct_vehicles,
        count(*) FILTER (WHERE pricing_status = 'Listed')::numeric         AS listed_rows,
        count(*) FILTER (WHERE pricing_status = 'Call for price')::numeric AS call_for_price_rows,
        count(*) FILTER (WHERE condition_type = 'New')::numeric            AS new_rows,
        count(*) FILTER (WHERE condition_type = 'Used')::numeric           AS used_rows,
        coalesce(sum(advertised_price), 0)::numeric                        AS advertised_total,
        count(DISTINCT dealership_id)::numeric                             AS distinct_dealerships,
        count(DISTINCT source_file_digest)::numeric                        AS distinct_digests
    FROM staging.stg_inventory_listing_snapshot
),
rejected AS (
    SELECT count(*)::numeric AS rejected_rows
    FROM staging.stg_inventory_listing_snapshot_rejected
),
landed AS (
    SELECT count(*)::numeric AS raw_rows
    FROM raw.inventory_listing_snapshot_load AS r
    WHERE r.load_batch_id = (
        SELECT x.load_batch_id
        FROM raw.inventory_listing_snapshot_load AS x
        GROUP BY x.load_batch_id
        ORDER BY max(x.ingested_at) DESC, max(x.raw_record_id) DESC
        LIMIT 1
    )
),
-- The warehouse side is restricted to the batches the current staging view offers, so
-- these rules compare like with like on an incremental import rather than comparing one
-- workbook against every workbook ever loaded.
loaded AS (
    SELECT
        count(*)::numeric                                                  AS fact_rows,
        count(DISTINCT f.observed_vehicle_key)::numeric                    AS distinct_vehicles,
        count(*) FILTER (WHERE f.pricing_status = 'Listed')::numeric       AS listed_rows,
        count(*) FILTER (WHERE f.pricing_status = 'Call for price')::numeric AS call_for_price_rows,
        count(*) FILTER (WHERE v.condition_type = 'New')::numeric          AS new_rows,
        count(*) FILTER (WHERE v.condition_type = 'Used')::numeric         AS used_rows,
        coalesce(sum(f.advertised_price), 0)::numeric                      AS advertised_total,
        count(DISTINCT f.dealership_key)::numeric                          AS distinct_dealerships,
        count(DISTINCT f.source_file_digest)::numeric                      AS distinct_digests
    FROM warehouse.fact_vehicle_listing_snapshot AS f
    JOIN warehouse.dim_observed_vehicle AS v
      ON v.observed_vehicle_key = f.observed_vehicle_key
    WHERE f.source_batch_id IN (
        SELECT DISTINCT s.source_batch_id FROM staging.stg_inventory_listing_snapshot AS s
    )
),
dimension AS (
    SELECT count(*)::numeric AS observed_vehicles
    FROM warehouse.dim_observed_vehicle AS d
    WHERE d.synthetic_vehicle_id IN (
        SELECT s.synthetic_vehicle_id FROM staging.stg_inventory_listing_snapshot AS s
    )
)

-- RECON-LISTING-RAW-CHAIN ----------------------------------------------------
SELECT
    'RECON-LISTING-RAW-CHAIN'::text AS reconciliation_id,
    format('Every landed workbook row is either accepted or rejected by staging '
           '(%s landed, %s accepted, %s rejected).',
           landed.raw_rows, staged.accepted_rows, rejected.rejected_rows)::text AS description,
    'raw.inventory_listing_snapshot_load'::text AS left_source,
    landed.raw_rows AS left_value,
    'staging.stg_inventory_listing_snapshot + _rejected'::text AS right_source,
    (staged.accepted_rows + rejected.rejected_rows) AS right_value,
    0::numeric AS tolerance,
    CASE WHEN landed.raw_rows = staged.accepted_rows + rejected.rejected_rows
         THEN 'passed' ELSE 'failed' END::text AS status
FROM landed, staged, rejected

UNION ALL

-- RECON-LISTING-FACT-WAREHOUSE -----------------------------------------------
SELECT
    'RECON-LISTING-FACT-WAREHOUSE'::text,
    format('Every (store, capture date, observed vehicle) accepted by staging reached '
           'warehouse.fact_vehicle_listing_snapshot (%s staged, %s loaded).',
           staged.accepted_rows, loaded.fact_rows)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.accepted_rows,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.fact_rows,
    0::numeric,
    CASE WHEN staged.accepted_rows = loaded.fact_rows THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-OBSERVED-VEHICLE ---------------------------------------------
SELECT
    'RECON-LISTING-OBSERVED-VEHICLE'::text,
    format('Every distinct synthetic vehicle accepted by staging exists in '
           'warehouse.dim_observed_vehicle (%s staged, %s in the dimension).',
           staged.distinct_vehicles, dimension.observed_vehicles)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.distinct_vehicles,
    'warehouse.dim_observed_vehicle'::text,
    dimension.observed_vehicles,
    0::numeric,
    CASE WHEN staged.distinct_vehicles = dimension.observed_vehicles
         THEN 'passed' ELSE 'failed' END::text
FROM staged, dimension

UNION ALL

-- RECON-LISTING-LISTED-PRICE-COUNT -------------------------------------------
SELECT
    'RECON-LISTING-LISTED-PRICE-COUNT'::text,
    format('The listed-price count survived the load (%s staged, %s loaded).',
           staged.listed_rows, loaded.listed_rows)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.listed_rows,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.listed_rows,
    0::numeric,
    CASE WHEN staged.listed_rows = loaded.listed_rows THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-CALL-FOR-PRICE-COUNT -----------------------------------------
SELECT
    'RECON-LISTING-CALL-FOR-PRICE-COUNT'::text,
    format('The call-for-price count survived the load (%s staged, %s loaded).',
           staged.call_for_price_rows, loaded.call_for_price_rows)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.call_for_price_rows,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.call_for_price_rows,
    0::numeric,
    CASE WHEN staged.call_for_price_rows = loaded.call_for_price_rows
         THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-ADVERTISED-TOTAL ---------------------------------------------
-- TECHNICAL LOAD EVIDENCE ONLY. This says the number that reached the warehouse is
-- the number the workbook carried. It is not a valuation, not inventory investment,
-- and not a finding about any dealership. Tolerance is the project-wide currency
-- tolerance because two monetary sums are being compared to the cent.
SELECT
    'RECON-LISTING-ADVERTISED-TOTAL'::text,
    format('The total advertised value survived the load (%s staged, %s loaded). '
           'Technical load evidence, not a valuation.',
           staged.advertised_total, loaded.advertised_total)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.advertised_total,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.advertised_total,
    0.01::numeric,
    CASE WHEN abs(staged.advertised_total - loaded.advertised_total) <= 0.01
         THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-NEW-COUNT ----------------------------------------------------
-- New and Used are two rules rather than one. A single rule would have to encode two
-- numbers into one left_value to satisfy the uniform shape, and an encoded value is a
-- number a reader cannot check against the thing it claims to measure.
SELECT
    'RECON-LISTING-NEW-COUNT'::text,
    format('The New-condition count survived the load (%s staged, %s loaded).',
           staged.new_rows, loaded.new_rows)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.new_rows,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.new_rows,
    0::numeric,
    CASE WHEN staged.new_rows = loaded.new_rows THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-USED-COUNT ---------------------------------------------------
SELECT
    'RECON-LISTING-USED-COUNT'::text,
    format('The Used-condition count survived the load (%s staged, %s loaded).',
           staged.used_rows, loaded.used_rows)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.used_rows,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.used_rows,
    0::numeric,
    CASE WHEN staged.used_rows = loaded.used_rows THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-DEALERSHIP-COUNT ---------------------------------------------
SELECT
    'RECON-LISTING-DEALERSHIP-COUNT'::text,
    format('Every distinct store in staging resolved to a distinct store in the '
           'warehouse (%s staged, %s loaded).',
           staged.distinct_dealerships, loaded.distinct_dealerships)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.distinct_dealerships,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.distinct_dealerships,
    0::numeric,
    CASE WHEN staged.distinct_dealerships = loaded.distinct_dealerships
         THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded

UNION ALL

-- RECON-LISTING-SOURCE-FILE-DIGEST -------------------------------------------
-- DQ-LST-014 as a reconciliation: every fact row carries the digest of the file that
-- produced it, and the set of digests in the warehouse is the set staging offered.
SELECT
    'RECON-LISTING-SOURCE-FILE-DIGEST'::text,
    format('Every loaded row carries the digest of the workbook that produced it '
           '(%s distinct digests staged, %s loaded).',
           staged.distinct_digests, loaded.distinct_digests)::text,
    'staging.stg_inventory_listing_snapshot'::text,
    staged.distinct_digests,
    'warehouse.fact_vehicle_listing_snapshot'::text,
    loaded.distinct_digests,
    0::numeric,
    CASE WHEN staged.distinct_digests = loaded.distinct_digests
         THEN 'passed' ELSE 'failed' END::text
FROM staged, loaded;

COMMENT ON VIEW audit.vw_recon_inventory_listing IS
    'Grain: one row per sanitized-listing reconciliation rule, in the uniform shape of
audit.vw_recon_result_template. Deliberately NOT unioned into audit.vw_recon_all: that view is the
PIPELINE''s per-run set with a published identifier list and an asserted per-run count, and this lane runs
on a workbook cadence instead. arpi.inventory.importer evaluates and records these against the import''s own
audit run. Every rule here is TECHNICAL LOAD EVIDENCE -- "the total advertised value reconciles" means the
number that reached the warehouse is the number the workbook carried, not that the figure means anything
commercially.';
