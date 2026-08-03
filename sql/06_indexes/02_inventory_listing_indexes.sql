-- =============================================================================
-- File:            sql/06_indexes/02_inventory_listing_indexes.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Secondary indexes for the sanitized inventory listing lane, one per query path that actually exists.
-- Execution order: Index layer, after warehouse.fact_vehicle_listing_snapshot and warehouse.dim_observed_vehicle exist.
-- Idempotency:     Fully idempotent. CREATE INDEX IF NOT EXISTS only.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql.
-- Grain:           Not applicable (indexes).
-- =============================================================================
--
-- SPECULATIVE INDEXING IS A COST, NOT A PRECAUTION
-- ------------------------------------------------
-- Every index here exists because a query in sql/05_reporting/ or in the importer's
-- reconciliations runs it today. An index for a query nobody has written slows every
-- insert and misleads the next reader into thinking a query pattern was considered.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
--   * No index on advertised_price. Nothing filters or joins on it; the reporting
--     views aggregate it, which is a scan either way.
--   * No index on pricing_status. It has two values across the whole table, so a
--     b-tree on it would be read past rather than used.
--   * No index on dim_observed_vehicle.make or .model. The dimension is small and
--     every reporting view reaches it through observed_vehicle_key.
--
-- ALREADY COVERED BY A CONSTRAINT
-- -------------------------------
--   uq_fact_vehicle_listing_snapshot_grain covers
--   (snapshot_date_key, dealership_key, observed_vehicle_key), which serves every
--   grain lookup and the leading-column filter on snapshot_date_key. It is not
--   repeated here.
--   uq_dim_observed_vehicle_synthetic_vehicle_id serves the merge's business-key
--   lookup. Also not repeated.

-- Every listing report filters a store and then a capture date, in that order:
-- "show me Granite Chevrolet on 2 August". The grain constraint leads with the date,
-- so it cannot serve a store-first predicate.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_listing_snapshot_dealership_captured
    ON warehouse.fact_vehicle_listing_snapshot (dealership_key, captured_at);

-- reporting.vw_vehicle_listing_current and vw_vehicle_listing_observation_span both
-- partition by vehicle and order by capture date, which is exactly this index.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_listing_snapshot_vehicle_captured
    ON warehouse.fact_vehicle_listing_snapshot (observed_vehicle_key, captured_at DESC);

-- The importer asks "has this exact file already been loaded?" before it lands a
-- single row, and the reconciliations count rows per batch afterwards.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_listing_snapshot_source_batch
    ON warehouse.fact_vehicle_listing_snapshot (source_batch_id);
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_listing_snapshot_source_file_digest
    ON warehouse.fact_vehicle_listing_snapshot (source_file_digest);

-- The observation-window widening in 18_dim_observed_vehicle_load.sql reads
-- last_observed_at for the vehicles in the batch, and the portfolio's freshness
-- statement reads the maximum across the dimension.
CREATE INDEX IF NOT EXISTS ix_dim_observed_vehicle_last_observed_at
    ON warehouse.dim_observed_vehicle (last_observed_at);
