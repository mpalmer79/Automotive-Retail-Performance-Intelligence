-- =============================================================================
-- File:            sql/04_facts/05_fact_vehicle_listing_snapshot.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.fact_vehicle_listing_snapshot, the observed public listing periodic-snapshot fact.
-- Execution order: Fact layer, after warehouse.dim_observed_vehicle and every other dimension it references, before its indexes and grants.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded ALTER TABLE for the foreign keys and COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the listing importer.
-- Grain:           One observed vehicle listing per dealership per captured_at value.
-- =============================================================================
--
-- WHAT A ROW MEANS, AND WHAT ITS ABSENCE MEANS
-- --------------------------------------------
--   * A row means ONE VEHICLE LISTING WAS VISIBLE at that store in the public
--     source on that capture date. It does NOT mean the vehicle was physically on
--     the ground, that the dealership owned it, what it cost, or what it sold for.
--   * The ABSENCE of a row on a later capture date means REMOVED FROM LISTING. It
--     does not mean sold. A listing can disappear because the vehicle sold, because
--     it was traded to another store, because it was wholesaled, because the feed
--     suppressed it, or because of an error -- and nothing in this data can tell
--     those apart. Any report that renders a removal as a sale is wrong, and
--     reporting.vw_vehicle_listing_change is written so it cannot.
--
-- THIS IS NOT warehouse.fact_vehicle_inventory_snapshot
-- ------------------------------------------------------
-- That fact is OWNED inventory and carries acquisition cost, reconditioning cost,
-- inventory investment, days in stock and markdown counts. This one carries an
-- advertised price and an odometer reading, because that is all a public listing
-- supports. The two must never be unioned: the first answers "what capital is on the
-- ground", the second answers "what was advertised". A measure named the same in
-- both would be two different quantities.
--
-- WHAT advertised_price IS NOT
-- ----------------------------
-- Not transaction price. Not acquisition cost. Not inventory investment. Not MSRP.
-- Not gross. It is the number the listing displayed on the capture date.
--
-- THE GRAIN IS THE CONSTRAINT
-- ---------------------------
-- uq_fact_vehicle_listing_snapshot_grain is not a performance index that happens to
-- be unique. It IS the declared grain: one observed vehicle per store per capture
-- date. A second row for one vehicle on one capture would double the observed unit
-- count and the advertised total, so the grain is enforced by the database rather
-- than by the importer's good intentions -- and it is what makes a rerun of the same
-- workbook provably idempotent (DQ-LST-015).
--
-- HISTORICAL SNAPSHOTS ARE IMMUTABLE
-- ----------------------------------
-- A capture is a record of what was observed at a moment. It is never restated. The
-- load script inserts rows the fact has not seen and updates NOTHING: a corrected
-- workbook for a batch already loaded is REFUSED by the importer and handled through
-- the documented supersession procedure in data/reference/README.md section 8,
-- rather than silently rewriting history.
--
-- SEMI-ADDITIVE AND NON-ADDITIVE MEASURES
-- ---------------------------------------
--   Semi-additive (additive across vehicle, store, make and model; NEVER across
--   capture dates): inventory_unit_count, advertised_price. Summing advertised_price
--   over thirty captures reports thirty times the value that was ever advertised.
--   Non-additive: odometer_miles. Average it or take the latest; a sum of odometer
--   readings is meaningless.
--
-- PRIVACY: contains no personal data of any kind, no original vehicle identifier and
-- no source URL.

CREATE TABLE IF NOT EXISTS warehouse.fact_vehicle_listing_snapshot (
    vehicle_listing_snapshot_key  bigint         NOT NULL,
    snapshot_date_key             integer        NOT NULL,
    dealership_key                integer        NOT NULL,
    observed_vehicle_key          integer        NOT NULL,
    captured_at                   date           NOT NULL,
    odometer_miles                integer        NULL,
    advertised_price              numeric(12,2)  NULL,
    pricing_status                varchar(20)    NOT NULL,
    inventory_unit_count          smallint       NOT NULL,
    source_batch_id               varchar(40)    NOT NULL,
    source_file_name              text           NOT NULL,
    source_file_digest            char(64)       NOT NULL,
    source_system                 varchar(40)    NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_fact_vehicle_listing_snapshot
        PRIMARY KEY (vehicle_listing_snapshot_key),
    -- THE declared grain, enforced.
    CONSTRAINT uq_fact_vehicle_listing_snapshot_grain
        UNIQUE (snapshot_date_key, dealership_key, observed_vehicle_key),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_fact_vehicle_listing_snapshot_key_positive
        CHECK (vehicle_listing_snapshot_key > 0),
    -- NULL is permitted and means the listing published no mileage. It is not zero:
    -- zero is a reading, and a reading gets averaged.
    CONSTRAINT ck_fact_vehicle_listing_snapshot_odometer_nonnegative
        CHECK (odometer_miles IS NULL OR odometer_miles >= 0),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_price_nonnegative
        CHECK (advertised_price IS NULL OR advertised_price >= 0),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_pricing_status_domain
        CHECK (pricing_status IN ('Listed', 'Call for price', 'Price not exposed')),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_unit_count_is_one
        CHECK (inventory_unit_count = 1),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_source_batch_not_blank
        CHECK (btrim(source_batch_id) <> ''),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_source_file_not_blank
        CHECK (btrim(source_file_name) <> ''),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_digest_shape
        CHECK (source_file_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_fact_vehicle_listing_snapshot_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    -- The pricing contract, enforced rather than merely documented. A vehicle cannot
    -- be counted in both halves of a pricing-completeness percentage.
    -- Two statuses carry no price and they are NOT interchangeable. 'Call for price'
    -- means the listing displayed a call-for-price treatment: a choice was made and
    -- shown. 'Price not exposed' means the listing surface published no price field at
    -- all, and evidences no choice by anybody. Collapsing them would attribute a
    -- merchandising decision to a dealership on no evidence.
    CONSTRAINT ck_fact_vehicle_listing_snapshot_pricing_contract
        CHECK (
            (pricing_status = 'Listed' AND advertised_price IS NOT NULL)
         OR (pricing_status IN ('Call for price', 'Price not exposed')
             AND advertised_price IS NULL)
        )
);

DO $fk$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT *
        FROM (VALUES
            ('fk_fact_vehicle_listing_snapshot_date',       'snapshot_date_key',    'dim_date',             'date_key'),
            ('fk_fact_vehicle_listing_snapshot_dealership', 'dealership_key',       'dim_dealership',       'dealership_key'),
            ('fk_fact_vehicle_listing_snapshot_vehicle',    'observed_vehicle_key', 'dim_observed_vehicle', 'observed_vehicle_key')
        ) AS t(constraint_name, column_name, parent_table, parent_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint AS c
            JOIN pg_namespace AS n ON n.oid = c.connamespace
            WHERE n.nspname = 'warehouse' AND c.conname = v_fk.constraint_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE warehouse.fact_vehicle_listing_snapshot ADD CONSTRAINT %I '
                'FOREIGN KEY (%I) REFERENCES warehouse.%I (%I) ON DELETE RESTRICT',
                v_fk.constraint_name, v_fk.column_name, v_fk.parent_table, v_fk.parent_column);
        END IF;
    END LOOP;
END
$fk$;

COMMENT ON TABLE warehouse.fact_vehicle_listing_snapshot IS
    'Grain: one observed vehicle listing per dealership per captured_at value. Periodic snapshot fact over a
SANITIZED PUBLIC REFERENCE source. A row means a listing was VISIBLE; it does not mean the vehicle was on
the ground, owned, or sold. The ABSENCE of a row on a later capture means REMOVED FROM LISTING, which is not
sold. advertised_price is not transaction price, acquisition cost, inventory investment, MSRP or gross.
Historical snapshots are IMMUTABLE: the load inserts and never updates. inventory_unit_count and
advertised_price are SEMI-ADDITIVE -- never sum them across capture dates.';

COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.vehicle_listing_snapshot_key IS 'Primary key. Warehouse-assigned surrogate key, deterministic by (snapshot_date_key, dealership_key, observed_vehicle_key).';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.snapshot_date_key IS 'Foreign key to warehouse.dim_date: the date the listing was OBSERVED. Part of the declared grain. Not an acquisition date and not a sale date.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.dealership_key IS 'Foreign key to warehouse.dim_dealership: the store the listing was assigned to, as that store stood on the capture date. Part of the declared grain.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.observed_vehicle_key IS 'Foreign key to warehouse.dim_observed_vehicle: the observed physical vehicle. Part of the declared grain. NOT warehouse.dim_vehicle -- this source cannot prove ownership or acquisition.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.captured_at IS 'The capture date carried on the fact as well as resolved to a key, so a listing query needs no join to dim_date to filter one snapshot.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.odometer_miles IS 'Advertised odometer reading on the capture date. NULL means the listing published no mileage, which is a real state of a public listing surface and NOT a zero reading. NON-ADDITIVE: average it or take the latest, never sum it. Not a verified reading and not a title record.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.advertised_price IS 'The price the listing DISPLAYED on the capture date. NOT transaction price, acquisition cost, inventory investment, MSRP or gross. NULL exactly when pricing_status is Call for price or Price not exposed. SEMI-ADDITIVE: never sum across capture dates.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.pricing_status IS 'Listed, Call for price, or Price not exposed. Governs whether advertised_price may be present, enforced by ck_fact_vehicle_listing_snapshot_pricing_contract. Call for price and Price not exposed both mean no price reached the warehouse and are NOT interchangeable: the first records a displayed merchandising choice, the second records that the listing surface published no price field at all.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.inventory_unit_count IS 'Always 1. SEMI-ADDITIVE: sum across vehicles on ONE capture date to get observed listing units; summing across capture dates counts the same listing repeatedly.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.source_batch_id IS 'Capture-batch identifier. One committed workbook is one batch, and a batch is never reloaded with different contents.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.source_file_name IS 'The committed workbook file name, preserved EXACTLY -- underscores and capitalisation included, for example ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx.';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.source_file_digest IS 'SHA-256 of the workbook bytes. Lineage evidence tying every fact row to the exact file that produced it (DQ-LST-014).';
COMMENT ON COLUMN warehouse.fact_vehicle_listing_snapshot.source_system IS 'Originating system; constant arpi_sanitized_public_reference for this lane. Deliberately different from arpi_synthetic_generator so a query can always tell the two lanes apart.';
