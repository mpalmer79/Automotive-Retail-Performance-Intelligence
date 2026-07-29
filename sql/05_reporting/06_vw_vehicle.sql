-- =============================================================================
-- File:            sql/05_reporting/06_vw_vehicle.sql
-- Project:         Automotive Retail Performance Intelligence (ARPI)
-- Purpose:         Business-friendly vehicle view over warehouse.dim_vehicle for the semantic model.
-- Execution order: Reporting layer, after warehouse.dim_vehicle and warehouse.dim_vehicle_model exist.
-- Idempotency:     Fully idempotent. CREATE OR REPLACE VIEW.
-- Ownership:       Created by the bootstrap superuser, reassigned to arpi_admin by sql/07_security/01_grants.sql. Readable by arpi_reporter.
-- Grain:           One row per physical vehicle.
-- =============================================================================
--
-- SEMANTIC-MODEL ROLE
-- -------------------
-- Dimension table. One-to-many into reporting.vw_vehicle_sales and
-- reporting.vw_inventory_snapshots on vehicle_key, single direction.
--
-- vehicle_model_key is carried so the model dimension can filter vehicles, but the
-- semantic model should relate vw_vehicle_model to vw_vehicle rather than to the
-- facts twice; the facts also carry vehicle_model_key for the paths where no
-- physical vehicle exists (a lead expresses interest in a model, not a VIN).
--
-- condition_group is the two-way new/used split every sales and inventory KPI uses.
-- A certified pre-owned unit is a USED unit (KPI_CATALOG.md, KPI-SLS-003), and this
-- column is the single place that rule is expressed for reporting.
--
-- Privacy: synthetic_vin is a deliberately invalid, machine-generated identifier
-- (ADR-0005); it is not a real VIN and decodes to nothing. No owner, no
-- registration and no location data exists anywhere in this model.

CREATE OR REPLACE VIEW reporting.vw_vehicle AS
SELECT
    v.vehicle_key                                        AS vehicle_key,
    v.vehicle_id                                         AS vehicle_code,
    v.synthetic_vin                                      AS synthetic_vin,
    v.vehicle_model_key                                  AS vehicle_model_key,
    v.condition_type                                     AS condition_type,
    CASE WHEN v.condition_type = 'New' THEN 'New' ELSE 'Used' END  AS condition_group,
    (v.condition_type = 'New')                           AS is_new_vehicle,
    (v.condition_type = 'Certified')                     AS is_certified,
    v.exterior_color                                     AS exterior_color,
    v.interior_color                                     AS interior_color,
    v.odometer_reading                                   AS odometer_reading,
    v.odometer_band                                      AS odometer_band,
    v.acquisition_source                                 AS acquisition_source,
    v.source_system                                      AS source_system
FROM warehouse.dim_vehicle AS v;

COMMENT ON VIEW reporting.vw_vehicle IS
    'Grain: one row per physical vehicle. Dimension table for the semantic model; relates one-to-many to '
    'vw_vehicle_sales and vw_inventory_snapshots on vehicle_key, single direction. condition_group is the '
    'governed new/used split: a Certified unit is a USED unit, per KPI_CATALOG.md KPI-SLS-003. Hide '
    'vehicle_key and vehicle_model_key in the model. synthetic_vin is a deliberately invalid generated '
    'identifier (ADR-0005) and is not a real VIN. Contains no personal data.';

COMMENT ON COLUMN reporting.vw_vehicle.vehicle_key IS 'Warehouse surrogate key. Relationship column; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle.vehicle_code IS 'Stable business identifier of the vehicle.';
COMMENT ON COLUMN reporting.vw_vehicle.synthetic_vin IS 'Machine-generated 17-character identifier. Deliberately not a valid VIN (ADR-0005); decodes to nothing and identifies no real vehicle.';
COMMENT ON COLUMN reporting.vw_vehicle.vehicle_model_key IS 'Model-line surrogate key. Relationship column into vw_vehicle_model; hide in the semantic model.';
COMMENT ON COLUMN reporting.vw_vehicle.condition_type IS 'New, Used or Certified as recorded by the source system.';
COMMENT ON COLUMN reporting.vw_vehicle.condition_group IS 'Governed two-way split: New, or Used. Certified units are Used. Use this, not condition_type, for the new-versus-used comparison every sales and inventory KPI requires.';
COMMENT ON COLUMN reporting.vw_vehicle.is_new_vehicle IS 'True only for a new unit.';
COMMENT ON COLUMN reporting.vw_vehicle.is_certified IS 'True for a manufacturer-certified pre-owned unit, which is still a used unit.';
COMMENT ON COLUMN reporting.vw_vehicle.exterior_color IS 'Exterior colour label.';
COMMENT ON COLUMN reporting.vw_vehicle.interior_color IS 'Interior colour label.';
COMMENT ON COLUMN reporting.vw_vehicle.odometer_reading IS 'Odometer reading in miles at acquisition.';
COMMENT ON COLUMN reporting.vw_vehicle.odometer_band IS 'Banded odometer reading, the preferred slicer.';
COMMENT ON COLUMN reporting.vw_vehicle.acquisition_source IS 'How the vehicle entered inventory.';
COMMENT ON COLUMN reporting.vw_vehicle.source_system IS 'Originating system. Present so no reader mistakes this for real inventory data.';
