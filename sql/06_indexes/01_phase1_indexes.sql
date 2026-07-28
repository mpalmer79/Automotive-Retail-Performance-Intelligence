-- =============================================================================
-- File:            sql/06_indexes/01_phase1_indexes.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create the secondary indexes the Phase 1 dimensions and facts actually need, each tied to a named query pattern.
-- Execution order: 58 of 66 — after every Phase 1 table exists, before the grant pass.
-- Idempotency:     Fully idempotent. CREATE INDEX IF NOT EXISTS only.
-- Ownership:       Indexes follow their table, so ownership moves to arpi_admin with the table in sql/07_security/01_grants.sql.
-- Grain:           n/a (physical access structures)
-- =============================================================================
--
-- POLICY (unchanged from sql/06_indexes/00_indexes.sql)
-- ----------------------------------------------------
-- An index is created here only when a query pattern that is written down needs it.
-- Indexes are not free: they slow every write, they consume space, and a
-- speculative index is a claim about a workload nobody has run. Where an access
-- path is already served by a primary key or a unique constraint, the index is NOT
-- duplicated — it is listed under DELIBERATELY NOT CREATED with the constraint that
-- already serves it.
--
-- DELIBERATELY NOT CREATED
-- ------------------------
--   warehouse.fact_vehicle_inventory_snapshot (snapshot_date_key)
--       Already the LEADING column of uq_fact_vehicle_inventory_snapshot_grain,
--       which PostgreSQL implements as a unique btree on
--       (snapshot_date_key, dealership_key, vehicle_key). An as-of-date lookup and
--       an as-of-date + store lookup are both served by that index as a prefix
--       scan. A second index on snapshot_date_key alone would carry the same
--       entries again, slow every snapshot insert, and never be chosen by the
--       planner in preference to the one that also answers the store predicate.
--   warehouse.fact_marketing_spend (month_date_key)
--       Same reasoning: leading column of uq_fact_marketing_spend_grain.
--   warehouse.dim_vehicle_model (model_year, make, model, trim)
--       Already a UNIQUE constraint, therefore already a unique btree.
--   warehouse.dim_employee (employee_id) WHERE is_current
--       Already created alongside the table as
--       uix_dim_employee_current_employee_id, because it enforces a grain rule.
--   warehouse.fact_lead, warehouse.fact_appointment, warehouse.fact_marketing_spend
--       (every column except the grain constraints above)
--       These tables hold no rows, their generators are Phase 1.4/1.5 work, and no
--       query against them exists yet. Their indexes land in the change that loads
--       them, alongside the query patterns that justify each one. Indexing an
--       empty table for a query nobody has written is exactly the speculation this
--       policy exists to prevent.
--   Any index on a boolean flag (is_retail, is_current_model_line, is_shown, ...)
--       Two-valued columns. A sequential scan or a bitmap over an existing index is
--       faster than a btree that has to be maintained on every write.

-- -----------------------------------------------------------------------------
-- warehouse.dim_vehicle
-- -----------------------------------------------------------------------------
-- Query pattern: "inventory and sales by make/model/trim" joins dim_vehicle to
-- dim_vehicle_model on vehicle_model_key, and PostgreSQL must scan the child side
-- of fk_dim_vehicle_vehicle_model whenever a model row is deleted or its key is
-- updated. Without this index both are sequential scans of the whole vehicle
-- dimension.
CREATE INDEX IF NOT EXISTS ix_dim_vehicle_vehicle_model_key
    ON warehouse.dim_vehicle (vehicle_model_key);

COMMENT ON INDEX warehouse.ix_dim_vehicle_vehicle_model_key IS
    'Supports the dim_vehicle to dim_vehicle_model join used by every make/model/trim breakdown, and backs '
    'the foreign key fk_dim_vehicle_vehicle_model so its ON DELETE RESTRICT check is not a sequential scan.';

-- -----------------------------------------------------------------------------
-- warehouse.dim_employee
-- -----------------------------------------------------------------------------
-- Query pattern: the SCD Type 2 merge in
-- sql/03_dimensions/14_dim_employee_merge.sql builds each employee's version
-- timeline with window functions PARTITION BY employee_id ORDER BY effective_date,
-- and point-in-time joins ("who was the salesperson on 2025-08-14?") look up all
-- versions of one employee by natural key. The partial unique index on current rows
-- cannot serve either, because both must see expired versions.
CREATE INDEX IF NOT EXISTS ix_dim_employee_id_effective_date
    ON warehouse.dim_employee (employee_id, effective_date DESC);

COMMENT ON INDEX warehouse.ix_dim_employee_id_effective_date IS
    'Supports the version-timeline windows in sql/03_dimensions/14_dim_employee_merge.sql and point-in-time '
    'joins across all versions of an employee. The partial current-row unique index cannot serve these '
    'because they must see expired versions.';

-- -----------------------------------------------------------------------------
-- warehouse.fact_vehicle_sale
-- -----------------------------------------------------------------------------
-- Query pattern (docs/source-to-target/STM-008-fact-vehicle-sale.md section 9):
-- every sales report filters a date range and then groups by store — month to date
-- by store, last 90 days by store, this quarter versus last. The composite is
-- ordered date-first because the date predicate is always present and is the
-- selective one; a store-only query across all time is not a report anybody runs.
-- The leading column alone also serves the date-range-only variant.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_sale_sale_date_dealership
    ON warehouse.fact_vehicle_sale (sale_date_key, dealership_key);

COMMENT ON INDEX warehouse.ix_fact_vehicle_sale_sale_date_dealership IS
    'Supports the dominant sales access pattern: filter a sale-date range, then group by store. The leading '
    'column also serves date-range-only queries. Ordered date-first because the date predicate is always '
    'present and is the selective one.';

-- Query pattern: "the sale history of this vehicle", and the ON DELETE RESTRICT
-- check on fk_fact_vehicle_sale_vehicle, which scans the fact by vehicle_key.
CREATE INDEX IF NOT EXISTS ix_fact_vehicle_sale_vehicle_key
    ON warehouse.fact_vehicle_sale (vehicle_key);

COMMENT ON INDEX warehouse.ix_fact_vehicle_sale_vehicle_key IS
    'Supports per-vehicle sale lookup (joining a sale back to its inventory history) and backs the foreign '
    'key fk_fact_vehicle_sale_vehicle.';

-- -----------------------------------------------------------------------------
-- warehouse.fact_vehicle_inventory_snapshot
-- -----------------------------------------------------------------------------
-- Query pattern (docs/source-to-target/STM-009-fact-vehicle-inventory-snapshot.md
-- section 9): "how did this vehicle age, and what did its price do, day by day?"
-- walks one vehicle across consecutive snapshot dates. The grain unique index is
-- ordered (snapshot_date_key, dealership_key, vehicle_key), so it cannot answer a
-- vehicle-first question without scanning every date. This is the one snapshot
-- access path the grain constraint genuinely does not serve.
CREATE INDEX IF NOT EXISTS ix_fact_inventory_snapshot_vehicle_date
    ON warehouse.fact_vehicle_inventory_snapshot (vehicle_key, snapshot_date_key);

COMMENT ON INDEX warehouse.ix_fact_inventory_snapshot_vehicle_date IS
    'Supports the per-vehicle aging and markdown walk across consecutive snapshot dates, and backs the '
    'foreign key fk_fact_inventory_snapshot_vehicle. The grain unique index is date-first and cannot serve '
    'a vehicle-first scan; as-of-date lookups are served by that grain index and are deliberately not '
    'duplicated here.';
