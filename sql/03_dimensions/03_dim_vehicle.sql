-- =============================================================================
-- File:            sql/03_dimensions/03_dim_vehicle.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_vehicle, the conformed vehicle dimension.
-- Execution order: 34 of 66 — after the dimensions it references, before sql/03_dimensions/13_dim_vehicle_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per unique physical vehicle.
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 12 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.
--
-- Business rule (contract section 6): condition_type = 'New' implies
-- acquisition_source = 'Manufacturer Allocation', odometer_band = 'New' and
-- odometer_reading <= 50. Enforced by ck_dim_vehicle_new_condition_rule.
-- The companion rule "Manufacturer Allocation must not occur at GSA-003" is a
-- cross-object rule between a vehicle and the store that acquired it. It is NOT
-- expressible as a single-table CHECK here because dim_vehicle carries no
-- dealership column; it is enforced against acquisition_event / the inventory
-- fact and is registered as a DQ-VEH-* check owned by Agent C.

CREATE TABLE IF NOT EXISTS warehouse.dim_vehicle (
    vehicle_key         integer       NOT NULL,
    vehicle_id          varchar(16)   NOT NULL,
    synthetic_vin       char(17)      NOT NULL,
    vehicle_model_key   integer       NOT NULL,
    vehicle_model_id    varchar(16)   NOT NULL,
    condition_type      varchar(12)   NOT NULL,
    exterior_color      varchar(30)   NOT NULL,
    interior_color      varchar(30)   NOT NULL,
    odometer_reading    integer       NOT NULL,
    odometer_band       varchar(20)   NOT NULL,
    acquisition_source  varchar(40)   NOT NULL,
    source_system       varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_vehicle
        PRIMARY KEY (vehicle_key),
    CONSTRAINT uq_dim_vehicle_vehicle_id
        UNIQUE (vehicle_id),
    CONSTRAINT uq_dim_vehicle_synthetic_vin
        UNIQUE (synthetic_vin),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_vehicle_key_positive
        CHECK (vehicle_key > 0),
    CONSTRAINT ck_dim_vehicle_condition_type_domain
        CHECK (condition_type IN ('New', 'Used', 'Certified')),
    CONSTRAINT ck_dim_vehicle_odometer_reading_nonnegative
        CHECK (odometer_reading >= 0),
    CONSTRAINT ck_dim_vehicle_odometer_band_domain
        CHECK (odometer_band IN ('New', 'Under 10k', '10k-30k', '30k-60k', '60k-100k', 'Over 100k')),
    CONSTRAINT ck_dim_vehicle_acquisition_source_domain
        CHECK (acquisition_source IN ('Customer Trade', 'Auction', 'Off-street Purchase', 'Lease Return', 'Dealer Trade', 'Manufacturer Allocation')),
    CONSTRAINT ck_dim_vehicle_vehicle_id_not_blank
        CHECK (btrim(vehicle_id) <> ''),
    CONSTRAINT ck_dim_vehicle_source_system_not_blank
        CHECK (btrim(source_system) <> ''),

    -- Business-rule constraints ----------------------------------------------
    CONSTRAINT ck_dim_vehicle_new_condition_rule
        CHECK (condition_type <> 'New' OR (acquisition_source = 'Manufacturer Allocation' AND odometer_band = 'New' AND odometer_reading <= 50))
);

-- Referential integrity: a vehicle must be an instance of a model that exists.
-- The merge resolves vehicle_model_key by joining dim_vehicle_model on
-- vehicle_model_id, so this constraint can never be satisfied by accident.
ALTER TABLE warehouse.dim_vehicle
    DROP CONSTRAINT IF EXISTS fk_dim_vehicle_vehicle_model;
ALTER TABLE warehouse.dim_vehicle
    ADD CONSTRAINT fk_dim_vehicle_vehicle_model
        FOREIGN KEY (vehicle_model_key)
        REFERENCES warehouse.dim_vehicle_model (vehicle_model_key)
        ON DELETE RESTRICT;

COMMENT ON TABLE warehouse.dim_vehicle IS
    'Grain: one row per unique physical vehicle. Loaded exclusively by 
sql/03_dimensions/13_dim_vehicle_merge.sql from staging.stg_vehicle. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_vehicle.vehicle_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(vehicle_key) + row_number() ordered by vehicle_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_vehicle.vehicle_id IS 'Natural key, VEH-####### (contract section 5).';
COMMENT ON COLUMN warehouse.dim_vehicle.synthetic_vin IS '17-character synthetic vehicle identifier with the ARPI prefix. Deliberately NOT a valid VIN and never resolvable to a real vehicle or owner.';
COMMENT ON COLUMN warehouse.dim_vehicle.vehicle_model_key IS 'Foreign key to warehouse.dim_vehicle_model. Resolved by the merge from vehicle_model_id; the generator''s own value is lineage only and is not used.';
COMMENT ON COLUMN warehouse.dim_vehicle.vehicle_model_id IS 'Model this vehicle is an instance of; resolved to a surrogate key by the merge.';
COMMENT ON COLUMN warehouse.dim_vehicle.condition_type IS 'New | Used | Certified.';
COMMENT ON COLUMN warehouse.dim_vehicle.exterior_color IS 'Exterior colour label.';
COMMENT ON COLUMN warehouse.dim_vehicle.interior_color IS 'Interior colour label.';
COMMENT ON COLUMN warehouse.dim_vehicle.odometer_reading IS 'Odometer reading in miles; never negative.';
COMMENT ON COLUMN warehouse.dim_vehicle.odometer_band IS 'Banded odometer reading used for reporting.';
COMMENT ON COLUMN warehouse.dim_vehicle.acquisition_source IS 'How the store came to own the vehicle.';
COMMENT ON COLUMN warehouse.dim_vehicle.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
