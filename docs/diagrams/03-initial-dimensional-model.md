# ARPI — Initial Dimensional Model

The warehouse and audit objects that **Automotive Retail Performance Intelligence (ARPI)** builds today,
followed by the fact constellation they are designed to support.

Phase 0 deliberately ships two conformed dimensions and no facts. Dimensions are the part of a star schema
that everything else depends on, and getting `dim_date` wrong is expensive to discover later. The facts
come in Phase 1, once their grains are approved.

---

## Implemented today

`warehouse.dim_date` and `warehouse.dim_dealership` exist with exactly the columns below, in exactly this
order, and are populated by the generator and verified by the test suite.

```mermaid
erDiagram
    dim_date {
        integer date_key PK "YYYYMMDD"
        date full_date UK "unique"
        smallint day_of_month "1 to 31"
        varchar day_name "Monday to Sunday, 9"
        smallint day_of_week "ISO 1=Monday to 7=Sunday"
        smallint day_of_year "1 to 366"
        smallint week_of_year "ISO week 1 to 53"
        smallint iso_year "ISO week-numbering year"
        smallint month_number "1 to 12"
        varchar month_name "January to December, 9"
        date month_start_date
        date month_end_date
        smallint quarter_number "1 to 4"
        varchar quarter_name "Q1 to Q4, 2"
        smallint calendar_year
        smallint fiscal_month "equals month_number"
        smallint fiscal_quarter "equals quarter_number"
        smallint fiscal_year "equals calendar_year"
        boolean is_weekend "Saturday or Sunday"
        boolean is_month_end
        boolean is_quarter_end
        boolean is_year_end
        boolean is_holiday "in the observed-holiday set"
        varchar holiday_name "nullable, 64"
        boolean is_closure_holiday "showroom closed"
        boolean is_selling_day "NOT is_closure_holiday"
    }

    dim_dealership {
        integer dealership_key PK "surrogate, ordinal by dealership_id"
        varchar dealership_id "natural key, GSA-001, 16"
        varchar store_name "120"
        varchar store_short_name "40"
        varchar store_type "Franchise New and Used or Independent Used"
        varchar franchise_brand "nullable, NULL for independent used, 40"
        varchar city "60"
        char state_code "NH, 2"
        varchar market_region "Southern New Hampshire, 60"
        date opened_date
        boolean is_active
        date effective_date "equals opened_date in Phase 0"
        date expiration_date "9999-12-31 for current rows"
        boolean is_current
        char attribute_hash "SHA-256 hex of tracked attributes, 64"
        varchar source_system "arpi_synthetic_generator, 40"
    }

    pipeline_run {
        bigserial pipeline_run_id PK
        uuid run_uuid UK "not null"
        text pipeline_name
        text profile_name "development, test or portfolio"
        text run_mode
        bigint random_seed
        text arpi_version
        timestamptz started_at
        timestamptz completed_at "nullable"
        text status "running, succeeded, failed or aborted"
        integer critical_failure_count "default 0"
        integer warning_count "default 0"
        text notes "nullable"
    }

    pipeline_run_row_count {
        bigint pipeline_run_id PK "FK"
        text entity_name PK
        text layer PK "source, raw, staging, warehouse or rejected"
        bigint row_count
        timestamptz recorded_at
    }

    validation_result {
        bigserial validation_result_id PK
        bigint pipeline_run_id FK
        text check_id "DQ-DATE-001 to DQ-GEN-002"
        text check_name
        text check_category
        text target_object
        text severity "critical, warning or info"
        text status "passed, failed or skipped"
        numeric observed_value "nullable"
        numeric expected_value "nullable"
        bigint failed_record_count "default 0"
        text message "nullable"
        timestamptz evaluated_at
    }

    reconciliation_result {
        bigserial reconciliation_result_id PK
        bigint pipeline_run_id FK
        text reconciliation_id
        text description
        text left_source
        numeric left_value
        text right_source
        numeric right_value
        numeric difference "generated, left minus right"
        numeric tolerance "default 0"
        text status "passed or failed"
        timestamptz evaluated_at
    }

    rejected_record {
        bigserial rejected_record_id PK
        bigint pipeline_run_id FK
        text source_entity
        text source_record_key "nullable"
        text rejection_code
        text rejection_reason
        jsonb record_payload "nullable"
        timestamptz rejected_at
    }

    pipeline_run ||--o{ pipeline_run_row_count : "records counts for"
    pipeline_run ||--o{ validation_result : "records checks for"
    pipeline_run ||--o{ reconciliation_result : "records reconciliations for"
    pipeline_run ||--o{ rejected_record : "records rejects for"
```

**Schema qualification.** Entity names are unqualified above because Mermaid entity identifiers cannot
contain a dot. The real object names are:

| Diagram entity | Real object |
|---|---|
| `dim_date` | `warehouse.dim_date` |
| `dim_dealership` | `warehouse.dim_dealership` |
| `pipeline_run` | `audit.pipeline_run` |
| `pipeline_run_row_count` | `audit.pipeline_run_row_count` |
| `validation_result` | `audit.validation_result` |
| `reconciliation_result` | `audit.reconciliation_result` |
| `rejected_record` | `audit.rejected_record` |

**Grains.** `warehouse.dim_date` is one row per calendar date. `warehouse.dim_dealership` is one row per
store *version* — a Type 2 dimension, though in Phase 0 exactly one current version exists per store.
`(dealership_id, effective_date)` is unique, and a partial unique index enforces one current row per
`dealership_id`.

**Why the dimensions do not join to each other.** They are conformed dimensions. They will be joined
through facts, not to one another. A star schema with dimension-to-dimension relationships is a snowflake
by accident, and the model avoids that deliberately.

**Why `attribute_hash` exists.** It is the SHA-256 of the Type 2 tracked attributes (columns 3 through 11,
joined with `|`, UTF-8). Comparing hashes is how a future load will detect that a store's attributes
changed and a new version row is required, without diffing eleven columns by hand.

---

## Planned fact constellation

None of the fact tables below exist. They are shown so the dimensions can be read in context — a date
dimension with 26 columns only makes sense once you can see what will slice by it.

Every planned entity carries an explicit `planned` marker as its first attribute. Nothing in this section
is implemented.

```mermaid
erDiagram
    dim_date {
        integer date_key PK "IMPLEMENTED"
    }

    dim_dealership {
        integer dealership_key PK "IMPLEMENTED"
    }

    dim_vehicle {
        text status "PLANNED - Phase 1.1"
        integer vehicle_key PK "not yet implemented"
    }

    dim_employee {
        text status "PLANNED - Phase 1.1"
        integer employee_key PK "not yet implemented"
    }

    dim_customer {
        text status "PLANNED - Phase 1.1"
        integer customer_key PK "not yet implemented"
    }

    dim_lead_source {
        text status "PLANNED - Phase 1.1"
        integer lead_source_key PK "not yet implemented"
    }

    dim_marketing_campaign {
        text status "PLANNED - Phase 1.1"
        integer campaign_key PK "not yet implemented"
    }

    fact_vehicle_sale {
        text status "PLANNED - Phase 1.2"
        integer sale_date_key FK "grain: one finalized transaction"
        integer dealership_key FK "not yet implemented"
        integer vehicle_key FK "not yet implemented"
        integer customer_key FK "not yet implemented"
        integer salesperson_key FK "not yet implemented"
        numeric front_end_gross "not yet implemented"
        numeric back_end_gross "not yet implemented"
        integer unit_count "not yet implemented"
    }

    fact_vehicle_inventory_snapshot {
        text status "PLANNED - Phase 1.2"
        integer snapshot_date_key FK "grain: vehicle x store x day"
        integer dealership_key FK "not yet implemented"
        integer vehicle_key FK "not yet implemented"
        integer days_in_stock "not yet implemented"
        numeric current_asking_price "not yet implemented"
    }

    fact_lead {
        text status "PLANNED - Phase 1.3"
        integer lead_created_date_key FK "grain: one CRM lead"
        integer dealership_key FK "not yet implemented"
        integer lead_source_key FK "not yet implemented"
        integer first_response_seconds "not yet implemented"
        boolean sold_flag "not yet implemented"
    }

    fact_appointment {
        text status "PLANNED - Phase 1.3"
        integer scheduled_date_key FK "grain: one scheduled appointment"
        integer dealership_key FK "not yet implemented"
        boolean showed_flag "not yet implemented"
    }

    fact_marketing_spend {
        text status "PLANNED - Phase 1.4"
        integer month_date_key FK "grain: store x campaign x month"
        integer dealership_key FK "not yet implemented"
        integer campaign_key FK "not yet implemented"
        numeric spend_amount "not yet implemented"
    }

    dim_date ||--o{ fact_vehicle_sale : "planned"
    dim_date ||--o{ fact_vehicle_inventory_snapshot : "planned"
    dim_date ||--o{ fact_lead : "planned"
    dim_date ||--o{ fact_appointment : "planned"
    dim_date ||--o{ fact_marketing_spend : "planned"

    dim_dealership ||--o{ fact_vehicle_sale : "planned"
    dim_dealership ||--o{ fact_vehicle_inventory_snapshot : "planned"
    dim_dealership ||--o{ fact_lead : "planned"
    dim_dealership ||--o{ fact_appointment : "planned"
    dim_dealership ||--o{ fact_marketing_spend : "planned"

    dim_vehicle ||--o{ fact_vehicle_sale : "planned"
    dim_vehicle ||--o{ fact_vehicle_inventory_snapshot : "planned"
    dim_employee ||--o{ fact_vehicle_sale : "planned"
    dim_customer ||--o{ fact_vehicle_sale : "planned"
    dim_lead_source ||--o{ fact_lead : "planned"
    dim_lead_source ||--o{ fact_marketing_spend : "planned"
    dim_marketing_campaign ||--o{ fact_marketing_spend : "planned"
    fact_lead ||--o{ fact_appointment : "planned"
```

---

## Legend

| Marker | Meaning |
|---|---|
| Attribute comment `IMPLEMENTED` | The entity exists in the database today |
| First attribute `status` with comment `PLANNED - Phase N.N` | The entity does not exist; the comment states the phase that will create it |
| Relationship label `planned` | The relationship does not exist; both sides or one side is unbuilt |
| `PK` | Primary key |
| `UK` | Unique constraint |
| `FK` | Foreign key |

The planned fact attributes above are illustrative of the intended shape only. They are **not** a column
contract. Column contracts are written into [`../../DATA_DICTIONARY.md`](../../DATA_DICTIONARY.md) when the
object is actually built, and never before.

---

## The twelve Phase 0 validation checks

These `check_id` values are shared between the Python validation framework and the SQL checks, and they
are written to `audit.validation_result` on every run.

| `check_id` | Checks that |
|---|---|
| `DQ-DATE-001` | `date_key` is unique |
| `DQ-DATE-002` | the date range is contiguous with no gaps |
| `DQ-DATE-003` | `date_key` matches `full_date` |
| `DQ-DATE-004` | no required field is null |
| `DQ-DATE-005` | the selling-day ratio falls within the configured tolerance |
| `DQ-DLR-001` | `dealership_key` is unique |
| `DQ-DLR-002` | `dealership_id` is unique among current rows |
| `DQ-DLR-003` | the store count matches the configuration |
| `DQ-DLR-004` | no prohibited PII column is present |
| `DQ-DLR-005` | `franchise_brand` is present for franchise stores |
| `DQ-GEN-001` | the declared schema matches the output schema |
| `DQ-GEN-002` | the determinism digest is recorded |

`DQ-DLR-004` is worth noting: it does not merely check that PII fields are empty, it checks that the
columns do not exist. A prohibited column cannot be accidentally populated if it was never created.

---

## Related

- [`02-phase-0-data-flow.md`](02-phase-0-data-flow.md) — how these objects get populated
- [`../../DATA_DICTIONARY.md`](../../DATA_DICTIONARY.md) — the authoritative column contract
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §§11–13 — dimensions, fact grains, and the full constellation
- [`../source-to-target/`](../source-to-target/) — field-level lineage

*All data is synthetic. Granite State Auto Group is fictional.*
