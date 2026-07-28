-- =============================================================================
-- File:            sql/03_dimensions/02_dim_vehicle_model.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Create warehouse.dim_vehicle_model, the conformed vehicle model dimension.
-- Execution order: 33 of 66 — after the dimensions it references, before sql/03_dimensions/12_dim_vehicle_model_merge.sql.
-- Idempotency:     Fully idempotent. CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT EXISTS and COMMENTs; existing rows are never touched.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Written by arpi_loader through the merge script.
-- Grain:           One row per vehicle model, identified by model_year + make + model + trim.
-- =============================================================================

--
-- Column contract: ARPI Phase 1 cross-agent contract section 6 — 16 columns,
-- exact names, exact order, exact types. Every enumerated domain in that section is
-- implemented here as a CHECK constraint rather than merely documented.

CREATE TABLE IF NOT EXISTS warehouse.dim_vehicle_model (
    vehicle_model_key      integer       NOT NULL,
    vehicle_model_id       varchar(16)   NOT NULL,
    model_year             smallint      NOT NULL,
    make                   varchar(40)   NOT NULL,
    model                  varchar(60)   NOT NULL,
    "trim"                 varchar(40)   NOT NULL,
    body_style             varchar(30)   NOT NULL,
    vehicle_class          varchar(30)   NOT NULL,
    fuel_type              varchar(20)   NOT NULL,
    drivetrain             varchar(10)   NOT NULL,
    transmission           varchar(20)   NOT NULL,
    doors                  smallint      NOT NULL,
    seating_capacity       smallint      NOT NULL,
    franchise_alignment    varchar(40)   NOT NULL,
    is_current_model_line  boolean       NOT NULL,
    source_system          varchar(40)   NOT NULL,

    -- Grain and identity -----------------------------------------------------
    CONSTRAINT pk_dim_vehicle_model
        PRIMARY KEY (vehicle_model_key),
    CONSTRAINT uq_dim_vehicle_model_vehicle_model_id
        UNIQUE (vehicle_model_id),
    CONSTRAINT uq_dim_vehicle_model_model_year_make_model_trim
        UNIQUE (model_year, make, model, trim),

    -- Domain constraints -----------------------------------------------------
    CONSTRAINT ck_dim_vehicle_model_key_positive
        CHECK (vehicle_model_key > 0),
    CONSTRAINT ck_dim_vehicle_model_model_year_range
        CHECK (model_year BETWEEN 1990 AND 2030),
    CONSTRAINT ck_dim_vehicle_model_body_style_domain
        CHECK (body_style IN ('Sedan', 'Coupe', 'Hatchback', 'Wagon', 'SUV', 'Crossover', 'Pickup', 'Van', 'Convertible')),
    CONSTRAINT ck_dim_vehicle_model_vehicle_class_domain
        CHECK (vehicle_class IN ('Compact', 'Midsize', 'Fullsize', 'Luxury', 'Sports', 'Truck', 'SUV', 'Van')),
    CONSTRAINT ck_dim_vehicle_model_fuel_type_domain
        CHECK (fuel_type IN ('Gasoline', 'Diesel', 'Hybrid', 'Plug-in Hybrid', 'Electric')),
    CONSTRAINT ck_dim_vehicle_model_drivetrain_domain
        CHECK (drivetrain IN ('FWD', 'RWD', 'AWD', '4WD')),
    CONSTRAINT ck_dim_vehicle_model_transmission_domain
        CHECK (transmission IN ('Automatic', 'Manual', 'CVT')),
    CONSTRAINT ck_dim_vehicle_model_doors_range
        CHECK (doors BETWEEN 2 AND 5),
    CONSTRAINT ck_dim_vehicle_model_seating_capacity_range
        CHECK (seating_capacity BETWEEN 2 AND 8),
    CONSTRAINT ck_dim_vehicle_model_franchise_alignment_domain
        CHECK (franchise_alignment IN ('Chevrolet', 'Subaru', 'Independent Used')),
    CONSTRAINT ck_dim_vehicle_model_vehicle_model_id_not_blank
        CHECK (btrim(vehicle_model_id) <> ''),
    CONSTRAINT ck_dim_vehicle_model_source_system_not_blank
        CHECK (btrim(source_system) <> '')
);

COMMENT ON TABLE warehouse.dim_vehicle_model IS
    'Grain: one row per vehicle model, identified by model_year + make + model + trim. Loaded exclusively by 
sql/03_dimensions/12_dim_vehicle_model_merge.sql from staging.stg_vehicle_model. Contains no personal data.';

COMMENT ON COLUMN warehouse.dim_vehicle_model.vehicle_model_key IS 'Primary key. Warehouse-assigned surrogate key. Assigned by the merge as max(vehicle_model_key) + row_number() ordered by vehicle_model_id; never taken from the source and never reused.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.vehicle_model_id IS 'Natural key, VMD-##### (contract section 5).';
COMMENT ON COLUMN warehouse.dim_vehicle_model.model_year IS 'Model year; 1990..2030.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.make IS 'Vehicle make, for example Chevrolet. Names a product, never a person.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.model IS 'Vehicle model line, for example Equinox.';
COMMENT ON COLUMN warehouse.dim_vehicle_model."trim" IS 'Trim level, for example LT.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.body_style IS 'Body style.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.vehicle_class IS 'Marketing size/class band.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.fuel_type IS 'Propulsion type.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.drivetrain IS 'Driven axles.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.transmission IS 'Transmission type.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.doors IS 'Door count; 2..5.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.seating_capacity IS 'Factory seating capacity; 2..8.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.franchise_alignment IS 'Which Granite State Auto Group franchise sells this model line.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.is_current_model_line IS 'Whether the model line is still in production.';
COMMENT ON COLUMN warehouse.dim_vehicle_model.source_system IS 'Originating system; constant arpi_synthetic_generator in Phase 1.';
