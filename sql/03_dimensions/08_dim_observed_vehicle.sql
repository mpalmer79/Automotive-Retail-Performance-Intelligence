-- =============================================================================
-- File:            sql/03_dimensions/08_dim_observed_vehicle.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_observed_vehicle, the physical-vehicle identity observed through a sanitized public listing source.
-- Execution order: Dimension layer, after warehouse.dim_dealership and before the listing fact that references it.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus guarded COMMENTs. Existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per sanitized physical vehicle identity observed through a public listing source.
-- =============================================================================
--
-- WHY THIS IS NOT warehouse.dim_vehicle
-- --------------------------------------
-- dim_vehicle is the conformed dimension for a vehicle ARPI's synthetic dealership
-- OWNS. Its contract carries acquisition source, acquisition date, exterior and
-- interior colour, inventory cost and disposition -- attributes that describe a unit
-- the store bought, reconditioned and holds. A public listing proves none of that.
-- It proves that a listing was visible.
--
-- Three options were considered and this is the third:
--
--   1. Load listings into dim_vehicle with the ownership attributes NULL. Rejected:
--      the columns are NOT NULL by contract, and relaxing them would let an
--      acquisition-cost report silently include vehicles nobody bought.
--   2. Load listings into dim_vehicle with the ownership attributes DEFAULTED.
--      Rejected for the same reason, more dangerously: a default is a number, and a
--      number gets summed.
--   3. A separate dimension carrying only what the source supports. Chosen. The
--      cost is that a listing cannot join to a sale, and that cost is the truth --
--      ARPI cannot connect them, and a model that appeared to would be lying.
--
-- WHY TYPE 1 AND NOT TYPE 2
-- -------------------------
-- ADR-0006 requires a written reason for every history treatment. This dimension is
-- TYPE 1: the row carries the vehicle's descriptive attributes as most recently
-- observed, plus the window over which it has been observed at all.
--
-- The reason is that the listing FACT already preserves observation history. Every
-- capture writes its own immutable fact row with that capture's mileage, price and
-- pricing status, so "what did this vehicle look like on 2 August" is answered by
-- the fact, not by a dimension version. Adding Type 2 versioning here would create a
-- second, parallel history of the same observations -- one that could disagree with
-- the fact and that no question needs. Type 2 is not free: it doubles the join
-- surface and makes every listing query choose a version.
--
-- If a future question genuinely needs attribute history independent of the fact --
-- a trim correction that must not restate past snapshots, for instance -- that is a
-- new decision with a new ADR, not a quiet ALTER.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No acquisition source, no acquisition date, no exterior or interior colour, no
-- MSRP, no inventory cost, no reconditioning cost, no ownership status, no sold
-- status, no customer linkage, no employee linkage. Every one of them would require
-- data this source does not have. The absence is the contract.
--
-- PRIVACY: contains no personal data of any kind, and no original vehicle
-- identifier. synthetic_vin is ARPI-prefixed and can never be a real VIN.

CREATE TABLE IF NOT EXISTS warehouse.dim_observed_vehicle (
    observed_vehicle_key    integer        NOT NULL,
    synthetic_vehicle_id    varchar(24)    NOT NULL,
    synthetic_vin           varchar(24)    NOT NULL,
    condition_type          varchar(8)     NOT NULL,
    model_year              smallint       NOT NULL,
    make                    varchar(40)    NOT NULL,
    model                   varchar(60)    NOT NULL,
    trim                    varchar(60)    NULL,
    vehicle_display         varchar(160)   NOT NULL,
    source_system           varchar(40)    NOT NULL,
    first_observed_at       date           NOT NULL,
    last_observed_at        date           NOT NULL,

    -- Identity ---------------------------------------------------------------
    CONSTRAINT pk_dim_observed_vehicle
        PRIMARY KEY (observed_vehicle_key),
    -- THE declared grain, enforced: one row per observed physical vehicle.
    CONSTRAINT uq_dim_observed_vehicle_synthetic_vehicle_id
        UNIQUE (synthetic_vehicle_id),
    -- The synthetic VIN is derived from the same digest, so a collision here would
    -- mean two vehicles share an identity. DQ-LST-004 asserts it in the source; this
    -- makes the database refuse it regardless of what the source claimed.
    CONSTRAINT uq_dim_observed_vehicle_synthetic_vin
        UNIQUE (synthetic_vin),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_observed_vehicle_key_positive
        CHECK (observed_vehicle_key > 0),
    CONSTRAINT ck_dim_observed_vehicle_condition_domain
        CHECK (condition_type IN ('New', 'Used')),
    CONSTRAINT ck_dim_observed_vehicle_model_year_range
        CHECK (model_year BETWEEN 1980 AND 2100),
    CONSTRAINT ck_dim_observed_vehicle_make_not_blank
        CHECK (btrim(make) <> ''),
    CONSTRAINT ck_dim_observed_vehicle_model_not_blank
        CHECK (btrim(model) <> ''),
    -- The ARPI prefix is what makes a real VIN impossible: I is not a permitted VIN
    -- character, so nothing stored here can pass a real VIN validation.
    CONSTRAINT ck_dim_observed_vehicle_synthetic_vin_prefix
        CHECK (synthetic_vin LIKE 'ARPI%'),
    CONSTRAINT ck_dim_observed_vehicle_synthetic_vehicle_id_prefix
        CHECK (synthetic_vehicle_id LIKE 'VEH-%'),
    CONSTRAINT ck_dim_observed_vehicle_source_system_not_blank
        CHECK (btrim(source_system) <> ''),
    -- An observation window that ends before it starts is a load defect.
    CONSTRAINT ck_dim_observed_vehicle_observation_window
        CHECK (last_observed_at >= first_observed_at)
);

COMMENT ON TABLE warehouse.dim_observed_vehicle IS
    'Grain: one row per sanitized physical vehicle identity observed through a public listing source.
SEPARATE FROM warehouse.dim_vehicle on purpose: this source proves that a listing was visible, not that the
dealership owned, acquired or held the vehicle, so it carries none of dim_vehicle''s acquisition, cost,
colour or disposition attributes. TYPE 1 -- the listing fact already preserves observation history, so a
second parallel history here would answer no question and could disagree with the fact. Sanitized public
reference data, NOT synthetic and NOT confidential DMS data.';

COMMENT ON COLUMN warehouse.dim_observed_vehicle.observed_vehicle_key IS 'Primary key. Warehouse-assigned surrogate key, stable for the life of the synthetic_vehicle_id.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.synthetic_vehicle_id IS 'Business key. Group-stable ARPI identity derived from the original vehicle identifier by SHA-256 over the group namespace. The same physical vehicle receives the same value at every store and on every capture, so a cross-store appearance is DETECTABLE. It is not thereby EXPLAINED: ARPI holds no dealer-trade event and must not infer one.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.synthetic_vin IS 'ARPI-prefixed synthetic VIN, seventeen characters. Can never be a real VIN because the prefix contains I. No original VIN is recoverable from it.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.condition_type IS 'New or Used, as most recently advertised.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.model_year IS 'Model year, as most recently advertised.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.make IS 'Make, as most recently advertised. Not restricted to the store''s franchise brand: a franchise store legitimately lists used units of other makes.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.model IS 'Model, as most recently advertised.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.trim IS 'Trim, as most recently advertised. NULL means the listing carried none.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.vehicle_display IS 'Year/make/model/trim as one advertised string, kept so a report reproduces the listing''s own wording.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.source_system IS 'Originating system; constant arpi_sanitized_public_reference for this lane.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.first_observed_at IS 'Earliest capture date on which this vehicle appeared in any listing snapshot. NOT an acquisition date and NOT a date the vehicle arrived on the lot.';
COMMENT ON COLUMN warehouse.dim_observed_vehicle.last_observed_at IS 'Latest capture date on which this vehicle appeared. NOT a sale date and NOT a disposition date. A vehicle that stops appearing was REMOVED FROM LISTING, which is not the same as sold.';
