-- =============================================================================
-- File:            sql/05_reporting/05_vw_vehicle_model.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly vehicle-model view over warehouse.dim_vehicle_model for the semantic model.
-- Execution order: Reporting layer, after warehouse.dim_vehicle_model exists.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per vehicle model line (model year x make x model x trim).
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table. One-to-many into reporting.vw_vehicle (vehicle_model_key),
-- reporting.vw_leads and reporting.vw_appointments (vehicle_model_key), and
-- reporting.vw_inventory_snapshots (vehicle_model_key). Single direction, from
-- the dimension to the fact, in every case.
--
-- vehicle_model_key is the join column and should be hidden in the semantic model;
-- vehicle_model_code is the human-readable business identifier.
--
-- `trim` is a reserved word in some tools, so the reporting column is trim_level.
-- Privacy: contains no personal data of any kind; every name here labels a product.

CREATE OR REPLACE VIEW reporting.vw_vehicle_model AS
SELECT
    m.vehicle_model_key                                           AS vehicle_model_key,
    m.vehicle_model_id                                            AS vehicle_model_code,
    m.model_year                                                  AS model_year,
    m.make                                                        AS make,
    m.model                                                       AS model_name,
    m.trim                                                        AS trim_level,
    m.make || ' ' || m.model                                      AS make_model_label,
    m.model_year::text || ' ' || m.make || ' ' || m.model
        || ' ' || m.trim                                          AS model_label,
    m.body_style                                                  AS body_style,
    m.vehicle_class                                               AS vehicle_class,
    m.fuel_type                                                   AS fuel_type,
    (m.fuel_type IN ('Hybrid', 'Plug-in Hybrid', 'Electric'))     AS is_electrified,
    m.drivetrain                                                  AS drivetrain,
    m.transmission                                                AS transmission,
    m.doors                                                       AS doors,
    m.seating_capacity                                            AS seating_capacity,
    m.franchise_alignment                                         AS franchise_alignment,
    m.is_current_model_line                                       AS is_current_model_line,
    m.source_system                                               AS source_system
FROM warehouse.dim_vehicle_model AS m;

COMMENT ON VIEW reporting.vw_vehicle_model IS
    'Grain: one row per vehicle model line (model year x make x model x trim). Dimension table for the '
    'semantic model; relates one-to-many to vw_vehicle, vw_inventory_snapshots, vw_leads and '
    'vw_appointments on vehicle_model_key, single direction in every case. Hide vehicle_model_key in the '
    'model and label with model_label. Contains no personal data.';

COMMENT ON COLUMN reporting.vw_vehicle_model.vehicle_model_key IS 'Warehouse surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle_model.vehicle_model_code IS 'Stable business identifier of the model line.';
COMMENT ON COLUMN reporting.vw_vehicle_model.model_year IS 'Manufacturer model year.';
COMMENT ON COLUMN reporting.vw_vehicle_model.make IS 'Vehicle make.';
COMMENT ON COLUMN reporting.vw_vehicle_model.model_name IS 'Vehicle model label. Names a product, never a person.';
COMMENT ON COLUMN reporting.vw_vehicle_model.trim_level IS 'Trim level. Reporting name for the reserved warehouse column dim_vehicle_model.trim.';
COMMENT ON COLUMN reporting.vw_vehicle_model.make_model_label IS 'Readable make and model, for example Chevrolet Equinox.';
COMMENT ON COLUMN reporting.vw_vehicle_model.model_label IS 'Fully qualified readable model line. Preferred slicer label.';
COMMENT ON COLUMN reporting.vw_vehicle_model.body_style IS 'Body style.';
COMMENT ON COLUMN reporting.vw_vehicle_model.vehicle_class IS 'Vehicle class used for segment comparison.';
COMMENT ON COLUMN reporting.vw_vehicle_model.fuel_type IS 'Fuel type.';
COMMENT ON COLUMN reporting.vw_vehicle_model.is_electrified IS 'True for hybrid, plug-in hybrid and electric. Convenience flag so reports do not compare fuel_type strings.';
COMMENT ON COLUMN reporting.vw_vehicle_model.drivetrain IS 'Drivetrain layout.';
COMMENT ON COLUMN reporting.vw_vehicle_model.transmission IS 'Transmission type.';
COMMENT ON COLUMN reporting.vw_vehicle_model.doors IS 'Door count.';
COMMENT ON COLUMN reporting.vw_vehicle_model.seating_capacity IS 'Seating capacity.';
COMMENT ON COLUMN reporting.vw_vehicle_model.franchise_alignment IS 'Franchise the model line belongs to, or Independent Used.';
COMMENT ON COLUMN reporting.vw_vehicle_model.is_current_model_line IS 'True while the model line is still sold new.';
COMMENT ON COLUMN reporting.vw_vehicle_model.source_system IS 'Originating system. Present so no reader mistakes this for real manufacturer data.';
