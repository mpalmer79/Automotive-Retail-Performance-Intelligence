# `sql/` — the ARPI PostgreSQL database

This directory is the authoritative definition of the ARPI database: schemas,
raw landing tables, staging views, conformed dimensions, merge logic, audit
objects, reporting views, indexes, roles, grants and data-quality checks.

Everything here is **Implemented** and has been executed against PostgreSQL 16. All eight
MVP dimensions and all five MVP facts are built, constrained and loaded; the reporting
layer above them is twenty-eight views, and the loader evaluates and records the
reconciliations in `audit.vw_recon_all` on every run.

**Two further lanes** also live in these directories, and neither is counted in the
numbers above. The sanitized public dealership listing snapshots of
[ADR-0011](../docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md)
add one fact, one non-conformed dimension, six reporting views and their own reconciliation
view; they load on a workbook cadence rather than on every pipeline run. The Dealer
Operations Command Center of
[ADR-0013](../docs/architecture-decisions/ADR-0013-governed-web-operating-console.md) adds
five reporting views and — from `DASH.5` — one fact, `warehouse.fact_sales_target`, which
is the monthly operating plan and loads on every run like the MVP facts. The semantic model
reads neither lane. §1.1 gives the arithmetic and §2.1 names the files.

- Target: **PostgreSQL 16** or later.
- Every script is **idempotent**: running the whole sequence twice produces the
  same database and no errors.
- Every script uses **fully schema-qualified** object names. Nothing relies on
  `search_path`.
- **No script contains a password, credential or connection string.** Login roles
  and their secrets are created out of band; see
  [`07_security/00_roles.sql`](07_security/00_roles.sql) and
  [`../docs/database-setup.md`](../docs/database-setup.md).
- The only destructive script is [`99_local_reset.sql`](99_local_reset.sql), and
  it refuses to run outside a development database.

---

## 1. Layers

| Directory | Schema | What it does |
|---|---|---|
| `00_database/` | all five | Creates the schemas, records the conventions, creates the `audit` tables |
| `01_raw/` | `raw` | Landing tables. Every business column is `text`; nothing is transformed |
| `02_staging/` | `staging` | Views that type, deduplicate, domain-filter and expose only the newest load batch, plus the rejected-row companion views and the non-throwing cast helpers |
| `03_dimensions/` | `warehouse` | Conformed dimensions and the idempotent merge scripts that load them, plus the four non-conformed dimensions: observed vehicle, finance product, lender and GL control account |
| `04_facts/` | `warehouse` | The five MVP fact tables and their load scripts, plus the listing fact, the three dashboard-program facts and the two accounting facts. Every fact is populated by the pipeline except the listing fact, which runs on a workbook cadence, and each grain is enforced by a UNIQUE constraint |
| `05_reporting/` | `reporting` | The business-facing views. The only schema Power BI may read |
| `06_indexes/` | `warehouse`, `audit` | Secondary indexes that a query which exists today actually needs |
| `07_security/` | cluster + all | The three group roles, the grant model, and an operator verification report |
| `08_validation/` | `audit` | SQL data-quality checks in a uniform result shape |
| `09_migrations/` | `warehouse`, `audit` | The migration ledger and each recorded, idempotent migration |

Data flows strictly one way:

```
CSV file  ->  raw  ->  staging  ->  warehouse  ->  reporting  ->  Power BI / Excel
                          audit records every step
```

### 1.1 What the counts count

Four lanes share these directories, and the headline numbers describe one of them.

| Number | What it counts | What it excludes |
|---|---|---|
| **5** facts | The MVP facts the pipeline loads from generated data | `fact_vehicle_listing_snapshot`, the three dashboard-program facts, and both accounting facts |
| **8** conformed dimensions | The dimensions the semantic model relates to | `dim_observed_vehicle`, `dim_finance_product`, `dim_lender`, `dim_gl_account` |
| **28** reporting views | The views the SQL baseline and the semantic model were measured against | the six `vw_vehicle_listing_*` views, the nine dashboard-program views and the three accounting views |
| **46** reporting views | Every view in `05_reporting/`, all four lanes | nothing |
| **8** component views in `audit.vw_recon_all` | Ingestion, gross, funnel, marketing, reporting, target, F&I and accounting — the set the loader evaluates on **every pipeline run** | `audit.vw_recon_inventory_listing`, which runs on a workbook cadence |

None of these is a judgement about importance. The listing lane is excluded from the MVP
counts because it is loaded on a different cadence from a different kind of source, and a
number that silently absorbed it would stop meaning what the semantic model bound to. The
dashboard-program lane is excluded for the same reason, and `DASH.5` made that separation
matter more rather than less: it was the first dashboard increment to add a fact table.
`DASH.8` adds two more facts and a dimension, so the tree now holds **eleven** fact DDL
scripts and **twelve** dimensions while the MVP baseline still describes five facts and
eight dimensions — five MVP facts, one listing fact, three dashboard-program facts and two
accounting facts. §2.1 records which files belong to each lane, and the declarations
`arpi.inventory.spec.INVENTORY_LANE_SQL_FILES`,
`arpi.dashboard.contract.DASHBOARD_LANE_SQL_FILES` and
`arpi.constants.ACCOUNTING_LANE_SQL_FILES` are what the tests read rather than a restated
list.

---

## 2. Authoritative execution order

Run these files in exactly this order. Every file states its own position in its
header block.

| # | File | What it does |
|--:|---|---|
| 1 | `00_database/00_create_schemas.sql` | Creates `raw`, `staging`, `warehouse`, `reporting`, `audit` with layer comments |
| 2 | `00_database/02_conventions.sql` | Records naming, timezone and SCD conventions; comments the database |
| 3 | `00_database/03_audit_tables.sql` | Creates the five `audit` tables and the `check_category` domain migration |
| 4 | `01_raw/00_raw_calendar_date_load.sql` | Creates `raw.calendar_date_load` + batch index |
| 5 | `01_raw/01_raw_dealership_load.sql` | Creates `raw.dealership_load` + batch index |
| 6 | `01_raw/02_raw_vehicle_model_load.sql` | Creates `raw.vehicle_model_load` + batch index |
| 7 | `01_raw/03_raw_vehicle_load.sql` | Creates `raw.vehicle_load` + batch index |
| 8 | `01_raw/04_raw_employee_load.sql` | Creates `raw.employee_load` + batch index |
| 9 | `01_raw/05_raw_customer_load.sql` | Creates `raw.customer_load` + batch index |
| 10 | `01_raw/06_raw_lead_source_load.sql` | Creates `raw.lead_source_load` + batch index |
| 11 | `01_raw/07_raw_marketing_campaign_load.sql` | Creates `raw.marketing_campaign_load` + batch index |
| 12 | `01_raw/08_raw_acquisition_event_load.sql` | Creates `raw.acquisition_event_load` + batch index |
| 13 | `01_raw/09_raw_sale_event_load.sql` | Creates `raw.sale_event_load` + batch index |
| 14 | `01_raw/10_raw_lead_load.sql` | Creates `raw.lead_load` + batch index |
| 15 | `01_raw/11_raw_appointment_load.sql` | Creates `raw.appointment_load` + batch index |
| 16 | `01_raw/12_raw_marketing_spend_load.sql` | Creates `raw.marketing_spend_load` + batch index |
| 17 | `01_raw/13_raw_inventory_snapshot_load.sql` | Creates `raw.inventory_snapshot_load` + batch index |
| 18 | `01_raw/14_raw_inventory_listing_snapshot_load.sql` | **Listing lane.** Creates `raw.inventory_listing_snapshot_load` + batch index. No original VIN column and no source-URL column exists to land |
| 19 | `01_raw/15_raw_sales_target_load.sql` | **Dashboard program lane.** Creates `raw.sales_target_load` + batch index — the monthly operating plan, landed like every other entity |
| 20–23 | `01_raw/16_raw_finance_product_load.sql` … `19_raw_finance_product_adjustment_load.sql` | **Dashboard program lane (`DASH.6`).** The four F&I landing tables: the product catalogue, the fictional lender catalogue, the product-contract fact and the post-sale adjustment fact, each in natural-key form with every business column untyped `text` |
| 24–26 | `01_raw/20_raw_inventory_accounting_load.sql` … `22_raw_gl_control_balance_load.sql` | **Accounting control lane (`DASH.8`).** The three inventory-accounting landing tables: the stock schedule, the selected control-account catalogue and the control balances, each in natural-key form with every business column untyped `text` |
| 27 | `02_staging/00_stg_calendar_date.sql` | Creates `staging.stg_calendar_date` |
| 28 | `02_staging/01_stg_dealership.sql` | Creates `staging.stg_dealership` |
| 29 | `02_staging/02_stg_cast_functions.sql` | Creates the non-throwing `staging.fn_try_*` cast helpers |
| 30 | `02_staging/03_stg_vehicle_model.sql` | Creates `staging.stg_vehicle_model_typed`, `staging.stg_vehicle_model`, `staging.stg_vehicle_model_rejected` |
| 31 | `02_staging/04_stg_vehicle.sql` | Creates `staging.stg_vehicle_typed`, `staging.stg_vehicle`, `staging.stg_vehicle_rejected` |
| 32 | `02_staging/05_stg_employee.sql` | Creates `staging.stg_employee_typed`, `staging.stg_employee`, `staging.stg_employee_rejected` |
| 33 | `02_staging/06_stg_customer.sql` | Creates `staging.stg_customer_typed`, `staging.stg_customer`, `staging.stg_customer_rejected` |
| 34 | `02_staging/07_stg_lead_source.sql` | Creates `staging.stg_lead_source_typed`, `staging.stg_lead_source`, `staging.stg_lead_source_rejected` |
| 35 | `02_staging/08_stg_marketing_campaign.sql` | Creates `staging.stg_marketing_campaign_typed`, `staging.stg_marketing_campaign`, `staging.stg_marketing_campaign_rejected` |
| 36 | `02_staging/09_stg_acquisition_event.sql` | Creates `staging.stg_acquisition_event_typed`, `staging.stg_acquisition_event`, `staging.stg_acquisition_event_rejected` |
| 37 | `02_staging/10_stg_sale_event.sql` | Creates `staging.stg_sale_event_typed`, `staging.stg_sale_event`, `staging.stg_sale_event_rejected` |
| 38 | `02_staging/11_stg_lead.sql` | Creates `staging.stg_lead_typed`, `staging.stg_lead`, `staging.stg_lead_rejected` |
| 39 | `02_staging/12_stg_appointment.sql` | Creates `staging.stg_appointment_typed`, `staging.stg_appointment`, `staging.stg_appointment_rejected` |
| 40 | `02_staging/13_stg_marketing_spend.sql` | Creates `staging.stg_marketing_spend_typed`, `staging.stg_marketing_spend`, `staging.stg_marketing_spend_rejected` |
| 41 | `02_staging/14_stg_inventory_snapshot.sql` | Creates `staging.stg_inventory_snapshot_typed`, `staging.stg_inventory_snapshot`, `staging.stg_inventory_snapshot_rejected` |
| 42 | `02_staging/15_stg_inventory_listing_snapshot.sql` | **Listing lane.** Creates `staging.stg_inventory_listing_snapshot_typed`, `staging.stg_inventory_listing_snapshot`, `staging.stg_inventory_listing_snapshot_rejected`, plus `staging.fn_dealership_exists` and `staging.fn_dealership_named` — plpgsql because a view resolves its tables at creation time and staging is built before dimensions |
| 43 | `02_staging/16_stg_sales_target.sql` | **Dashboard program lane.** Creates `staging.stg_sales_target_typed`, `staging.stg_sales_target`, `staging.stg_sales_target_rejected`. Enforces the one scope rule a CHECK cannot express: a Store-scope target must name its own store |
| 44–47 | `02_staging/17_stg_finance_product.sql` … `20_stg_finance_product_adjustment.sql` | **Dashboard program lane (`DASH.6`).** The four F&I staging view sets. `19_stg_finance_product_sale.sql` enforces the product price identity `gross = price − cost` as a `REJ-DOMAIN-001` rejection as well as on the fact as a `CHECK`, so a violating row is quarantined rather than aborting the load; `20_stg_finance_product_adjustment.sql` enforces the sign convention per adjustment type and that a reason category belongs to its own type |
| 48–50 | `02_staging/21_stg_inventory_accounting.sql` … `23_stg_gl_control_balance.sql` | **Accounting control lane (`DASH.8`).** The three accounting staging view sets. `21` enforces the book-value identity as a `REJ-RULE-001` rejection as well as on the fact as a `CHECK`, so a violating line is quarantined rather than aborting the load; `23` enforces the month-end rule that makes matched-date comparability structural |
| 51 | `03_dimensions/00_dim_date.sql` | Creates `warehouse.dim_date` |
| 52 | `03_dimensions/01_dim_dealership.sql` | Creates `warehouse.dim_dealership` + current-row unique index |
| 53 | `03_dimensions/02_dim_vehicle_model.sql` | Creates `warehouse.dim_vehicle_model` |
| 54 | `03_dimensions/03_dim_vehicle.sql` | Creates `warehouse.dim_vehicle` |
| 55 | `03_dimensions/04_dim_employee.sql` | Creates `warehouse.dim_employee` |
| 56 | `03_dimensions/05_dim_customer.sql` | Creates `warehouse.dim_customer` |
| 57 | `03_dimensions/06_dim_lead_source.sql` | Creates `warehouse.dim_lead_source` |
| 58 | `03_dimensions/07_dim_marketing_campaign.sql` | Creates `warehouse.dim_marketing_campaign` |
| 59 | `03_dimensions/08_dim_observed_vehicle.sql` | **Listing lane.** Creates `warehouse.dim_observed_vehicle` — a **ninth** dimension that is deliberately not conformed and not one of the eight. A listing proves observation, not ownership, so it carries none of `dim_vehicle`'s acquisition, cost, colour or disposition attributes |
| 60 | `03_dimensions/10_dim_date_merge.sql` | **Runtime.** Upserts staging into `dim_date` |
| 61 | `03_dimensions/11_dim_dealership_merge.sql` | **Runtime.** SCD Type 2 merge into `dim_dealership` |
| 62 | `03_dimensions/12_dim_vehicle_model_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_vehicle_model` |
| 63 | `03_dimensions/13_dim_vehicle_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_vehicle` |
| 64 | `03_dimensions/14_dim_employee_merge.sql` | **Runtime.** SCD Type 2 merge into `warehouse.dim_employee` |
| 65 | `03_dimensions/15_dim_customer_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_customer` |
| 66 | `03_dimensions/16_dim_lead_source_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_lead_source` |
| 67 | `03_dimensions/17_dim_marketing_campaign_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_marketing_campaign` |
| 68 | `03_dimensions/18_dim_observed_vehicle_load.sql` | **Listing lane. Workbook cadence, not runtime.** Type 1 merge into `warehouse.dim_observed_vehicle`. Named `_load` rather than `_merge` **on purpose**: the pipeline discovers dimension work with a `*_merge.sql` glob, and a listing dimension swept into an ordinary generated-data run would look for a workbook nobody supplied |
| 69 | `03_dimensions/19_dim_finance_product.sql` | **Dashboard program lane (`DASH.6`).** Creates `warehouse.dim_finance_product` — a **tenth** dimension, deliberately not one of the eight conformed. Ten governed categories as ROW VALUES, provider as an ATTRIBUTE (`DASH.6-01`), SCD Type 1, and no price, cost or rate of any kind |
| 70 | `03_dimensions/20_dim_lender.sql` | **Dashboard program lane (`DASH.6`).** Creates `warehouse.dim_lender` — an **eleventh** dimension. An analytical classification of FICTIONAL institutions: no APR, buy rate, sell rate, spread, payment, term, approval, stipulation or credit datum, and `program_tier` classifies the lender's program and never a customer |
| 71–72 | `03_dimensions/21_dim_finance_product_merge.sql` … `22_dim_lender_merge.sql` | **Dashboard program lane. Runtime.** Type 1 merges into the two F&I dimensions. Numbered 21 and 22 so they sort after every MVP merge and after the two DDL files that create the tables they write |
| 73 | `03_dimensions/23_fi_governed_functions.sql` | **Dashboard program lane (`DASH.6`).** Creates `warehouse.fn_finance_structure` (THE finance-structure derivation for SQL), `warehouse.fn_product_category_is_eligible` (the eligibility predicate, which READS `dim_finance_product` rather than restating the rule, and is `SECURITY DEFINER` so `arpi_reporter` needs no privilege on `warehouse`) and `warehouse.fn_minimum_sample_floor` |
| 74–75 | `03_dimensions/24_dim_gl_account.sql` … `25_dim_gl_account_merge.sql` | **Accounting control lane (`DASH.8`).** Creates `warehouse.dim_gl_account` — a **twelfth** dimension, deliberately not one of the eight conformed — and its Type 1 merge. A SELECTED control catalogue of three inventory accounts, never a chart of accounts: the category domain is closed by `CHECK` and `DQ-GLA-009` scans account names for general-ledger vocabulary |
| 76 | `04_facts/00_fact_vehicle_sale.sql` | Creates `warehouse.fact_vehicle_sale` |
| 77 | `04_facts/01_fact_vehicle_inventory_snapshot.sql` | Creates `warehouse.fact_vehicle_inventory_snapshot` |
| 78 | `04_facts/02_fact_lead.sql` | Creates `warehouse.fact_lead` |
| 79 | `04_facts/03_fact_appointment.sql` | Creates `warehouse.fact_appointment` |
| 80 | `04_facts/04_fact_marketing_spend.sql` | Creates `warehouse.fact_marketing_spend` |
| 81 | `04_facts/05_fact_vehicle_listing_snapshot.sql` | **Listing lane.** Creates `warehouse.fact_vehicle_listing_snapshot` — a **sixth** fact that is not one of the five MVP facts and is not read by the semantic model |
| 82 | `04_facts/06_fact_sales_target.sql` | **Dashboard program lane.** Creates `warehouse.fact_sales_target` — a **seventh** fact table, and the second that is not one of the five MVP facts and is not read by the semantic model. The monthly operating PLAN: store, department or employee scope × targeted KPI × month, with the grain enforced over five NOT NULL columns |
| 83 | `04_facts/07_fact_finance_product_sale.sql` | **Dashboard program lane (`DASH.6`).** Creates `warehouse.fact_finance_product_sale` — an **eighth** fact table. One row per product contract on a finalized deal, grain `(sale_key, finance_product_key)`, with `original_product_gross = price − cost` as a `CHECK` |
| 84 | `04_facts/08_fact_finance_product_adjustment.sql` | **Dashboard program lane (`DASH.6`).** Creates `warehouse.fact_finance_product_adjustment` — a **ninth** fact table. One row per post-sale EVENT on its own business date; the contract it acts on is never rewritten |
| 85–86 | `04_facts/09_fact_inventory_accounting_snapshot.sql` … `10_fact_gl_control_balance.sql` | **Accounting control lane (`DASH.8`).** Creates `warehouse.fact_inventory_accounting_snapshot` — a **tenth** fact, carrying the book-value identity as a `CHECK` so a violating line is unloadable — and `warehouse.fact_gl_control_balance`, an **eleventh** fact that deliberately carries **no** constraint requiring agreement with the subledger, because a variance is valid data |
| 87–91 | `04_facts/10_fact_vehicle_sale_load.sql` … `14_fact_marketing_spend_load.sql` | **Runtime.** The five MVP fact load scripts, one per fact above, each guarded by `ON CONFLICT ... DO UPDATE` |
| 92 | `04_facts/15_fact_vehicle_listing_snapshot_load.sql` | **Listing lane. Workbook cadence.** Insert-only: `ON CONFLICT DO NOTHING` with **no UPDATE path at all**, because a capture records what somebody observed at a moment that has passed and cannot be recomputed |
| 93 | `04_facts/16_fact_sales_target_load.sql` | **Dashboard program lane. Runtime.** Idempotent load of the operating plan, conflict-targeted on the declared grain. A later planning revision replaces the row rather than adding one: a plan is a current statement, not an event log |
| 94–95 | `04_facts/17_fact_finance_product_sale_load.sql` … `18_fact_finance_product_adjustment_load.sql` | **Dashboard program lane. Runtime.** 17 sorts after 10 so the sale fact is populated before a contract resolves `sale_key` against it, and 18 after 17 for the same reason: an adjustment resolves the contract it acts on |
| 96–97 | `04_facts/19_fact_inventory_accounting_snapshot_load.sql` … `20_fact_gl_control_balance_load.sql` | **Accounting control lane. Runtime.** Both loads CALCULATE NOTHING: `current_book_value` is carried through so the `CHECK` can fail on a generator defect rather than agreeing with a total the load just computed, and `net_balance` is loaded exactly as it arrives so the reconciliation surface can show a variance rather than only ever agreement |
| 98 | `05_reporting/00_reporting_scope.sql` | Documents which reporting views exist and which are deliberately absent |
| 99–102 | `05_reporting/01_vw_calendar.sql` … `04_vw_data_quality_summary.sql` | The four Phase 0 views: `vw_calendar`, `vw_dealership`, `vw_pipeline_run_summary`, `vw_data_quality_summary` |
| 103–108 | `05_reporting/05_vw_vehicle_model.sql` … `10_vw_marketing_campaign.sql` | The six remaining **dimension** views: `vw_vehicle_model`, `vw_vehicle`, `vw_employee`, `vw_customer`, `vw_lead_source`, `vw_marketing_campaign` |
| 109–113 | `05_reporting/11_vw_vehicle_sales.sql` … `15_vw_marketing_spend.sql` | The five **fact** views, each preserving its fact's grain exactly: `vw_vehicle_sales`, `vw_inventory_snapshots`, `vw_leads`, `vw_appointments`, `vw_marketing_spend` |
| 114–126 | `05_reporting/20_vw_sales_summary.sql` … `32_vw_reconciliation_status.sql` | The thirteen governed **analytical** views: sales, gross, inventory health, inventory aging, days to sale, inventory turn, days supply, lead funnel, appointment funnel, lead response, marketing performance, data-quality trend, reconciliation status |
| 127–132 | `05_reporting/33_vw_vehicle_listing_current.sql` … `38_vw_vehicle_listing_change.sql` | **Listing lane.** The six listing views: `vw_vehicle_listing_current`, `vw_vehicle_listing_summary`, `vw_vehicle_listing_model_mix`, `vw_vehicle_listing_price_completeness`, `vw_vehicle_listing_observation_span`, `vw_vehicle_listing_change`. Counted **apart from the twenty-eight**; see §1.1 |
| 133–137 | `05_reporting/40_vw_sales_gross_trend.sql` … `44_vw_target_attainment.sql` | **Dashboard program lane.** The three `DASH.3` views, one from `DASH.4` and one from `DASH.5`: `vw_sales_gross_trend` (store × sale date, volume and gross with their condition components as additive columns), `vw_gross_change_bridge` (store × month pair × component, published as exact numerators over a shared denominator so the reconciliation needs no division), `vw_deal_explorer` (one row per finalized transaction, public-safe and compact, for the index), `vw_deal_jacket` (the same grain, presentation-complete: the cost components behind the front gross, the trade context, the finance amounts, the people and the lead's paper trail, for the record view), `vw_target_attainment` (store × target scope × targeted KPI × month: the operating plan beside the month-to-date actual, with the selling-day arithmetic `KPI-TGT-001..010` are computed from, published as numerators and denominators so no consumer can average a percentage). Counted **apart from the twenty-eight**; see §1.1 |
| 138–141 | `05_reporting/45_vw_deal_product_detail.sql` … `48_vw_fi_adjustment_summary.sql` | **Dashboard program lane (`DASH.6`).** The four F&I views: `vw_deal_product_detail` (one row per contract, with deal-date and as-of gross side by side), `vw_fi_summary` (store × sale date × finance manager — the category is deliberately NOT in the grain, because the view carries reserve and retail units), `vw_fi_product_penetration` (adds the category, and carries NO reserve and NO retail-unit column for the same reason), `vw_fi_adjustment_summary` (the only F&I view on the ADJUSTMENT date). Counted **apart from the twenty-eight**; see §1.1 |
| 142–144 | `05_reporting/49_vw_inventory_accounting.sql` … `51_vw_accounting_exceptions.sql` | **Accounting control lane (`DASH.8`).** The three accounting views: `vw_inventory_accounting` (the stock schedule at the fact's own grain, with every book component published separately and floorplan principal carried as liability context), `vw_inventory_gl_reconciliation` (the matched-date FULL JOIN of both sides, with the signed variance and an explicit comparison state — a missing side is NULL, never zero), `vw_accounting_exceptions` (one row per exception over a closed code vocabulary). Counted **apart from the twenty-eight**; see §1.1 |
| 145 | `06_indexes/00_indexes.sql` | Creates the Phase 0 justified secondary indexes |
| 146 | `06_indexes/01_phase1_indexes.sql` | Creates the Phase 1 justified secondary indexes |
| 147 | `06_indexes/02_inventory_listing_indexes.sql` | **Listing lane.** Secondary indexes for the listing fact and its dimension |
| 148 | `06_indexes/03_fi_indexes.sql` | **Dashboard program lane.** Secondary indexes for the two F&I facts and for `fact_vehicle_sale.lender_key` |
| 149 | `06_indexes/04_accounting_indexes.sql` | **Accounting control lane.** Secondary indexes for the two accounting facts: the account-led grouping the reconciliation performs, and the vehicle partition `KPI-ACC-011` needs |
| 150 | `07_security/00_roles.sql` | Creates `arpi_admin`, `arpi_loader`, `arpi_reporter` (NOLOGIN) |
| 151 | `07_security/01_grants.sql` | Moves ownership to `arpi_admin`; applies the grant model; asserts it object by object |
| 152 | `08_validation/00_validation_helpers.sql` | Result-shape template view + `audit.fn_record_validation_result` |
| 153 | `08_validation/01_dim_date_checks.sql` | Creates `audit.vw_dq_dim_date` (`DQ-DATE-001..005`) |
| 154 | `08_validation/02_dim_dealership_checks.sql` | Creates `audit.vw_dq_dim_dealership` (`DQ-DLR-001..005`) |
| 155 | `08_validation/03_referential_checks.sql` | Creates `audit.vw_dq_referential` (`DQ-REF-001..005`) |
| 156 | `08_validation/04_audit_checks.sql` | Creates `audit.vw_dq_audit` (`DQ-AUD-001..005`), `audit.vw_dq_all`, `audit.fn_record_all_dq_checks` |
| 157 | `08_validation/05_reconciliation_helpers.sql` | Creates `audit.vw_recon_result_template`, the uniform reconciliation result shape |
| 158 | `08_validation/06_recon_ingestion.sql` | Creates `audit.vw_recon_ingestion` — the five facts' staging-to-warehouse counts, and snapshot continuity |
| 159 | `08_validation/07_recon_gross.sql` | Creates `audit.vw_recon_gross` — `RECON-GROSS-001`, `RECON-GROSS-002`, `RECON-UNITS-001`, `RECON-REPORT-SALES` |
| 160 | `08_validation/08_recon_funnel.sql` | Creates `audit.vw_recon_funnel` — `RECON-LEAD-001`, duplicates, funnel bounds, sold path, funnel chain |
| 161 | `08_validation/09_recon_marketing.sql` | Creates `audit.vw_recon_marketing` — spend, attributed leads, sales and gross, and the cost-attributability rule |
| 162 | `08_validation/10_recon_reporting.sql` | Creates `audit.vw_recon_reporting` — every reporting view reconciled to the fact it projects |
| 163 | `08_validation/11_recon_target.sql` | **Dashboard program lane.** Creates `audit.vw_recon_target` — the target chain, the declared grain, the department partition of the store gross plan, the store and month totals through reporting, and the fan-out guard on `reporting.vw_target_attainment`. Unioned into `audit.vw_recon_all`, which is why it is numbered before it |
| 164 | `08_validation/12_recon_inventory_listing.sql` | **Listing lane.** Creates `audit.vw_recon_inventory_listing` — `RECON-LISTING-001..010`. Deliberately **not** unioned into `audit.vw_recon_all`, which is the pipeline's per-run set with an asserted per-run count; this lane runs on a workbook cadence |
| 165 | `08_validation/13_recon_fi.sql` | **Dashboard program lane.** Creates `audit.vw_recon_fi` — `RECON-FI-001` and the rest of the F&I family: the two chains, both grains, the product price identity, that `total = front + back` is exactly as true after `DASH.6` as before it, the reserve-and-lender structure rule, the eligibility subset, the adjustment cap and sequence, as-of net gross, and the fan-out guard on all four F&I views. Unioned into `audit.vw_recon_all`, which is why it is numbered before it |
| 166 | `08_validation/15_recon_accounting.sql` | **Accounting control lane.** Creates `audit.vw_recon_accounting` — `RECON-ACC-BOOK-IDENTITY` and the rest of the family: the two chains, both grains, the negative-component guard, that pack is still outside the front-gross identity, that floorplan is outside the book identity while being materially non-zero, the population at matched dates, the per-account totals and the mapping behind them, the well-formedness of every GL comparison, and the fan-out guards on two views. Unioned into `audit.vw_recon_all`, which is why it is numbered before it |
| 167 | `08_validation/16_recon_all.sql` | Creates `audit.vw_recon_all` and `audit.fn_record_all_reconciliations`. Renumbered from 11 by `DASH.5`, from 13 by `DASH.6` and from 14 by `DASH.8`, so `audit.vw_recon_target`, `audit.vw_recon_fi` and `audit.vw_recon_accounting` all exist before this file unions them |
| 168–172 | `09_migrations/0000_migration_history.sql` … `0004_add_accounting_control_objects.sql` | The migration ledger and the four recorded migrations. Each is idempotent and records itself. `0003` is the second to contain DDL rather than only assertions: `CREATE TABLE IF NOT EXISTS` on a live table is a no-op, so `fact_vehicle_sale.finance_reserve_gross` and `lender_key` would never appear on a deployed database without it. `0004` creates nothing, because `DASH.8` changes no existing table — it asserts the whole accounting lane arrived, including the book-value identity and both declared grains, and dates the change in `audit.schema_migration` |
| 173 | `07_security/01_grants.sql` **(again)** | Privilege-normalisation pass over the objects created in the validation and migration steps |

The sequence is **173 files** in total; the table groups consecutive files of one kind
rather than listing all of them, and the grouped ranges are contiguous. The count and the
order are both derived from the directory by
`tests/integration/conftest.py::init_sequence_files`, and
`tests/unit/test_sql_readme_sequence.py` fails if this table and that function disagree —
so a script added without a row here does not quietly become undocumented.

### 2.1 Two lanes in one directory tree

Seventeen of the files above are marked **Accounting control lane**. They implement the
inventory accounting and GL control increment (`DASH.8`), they are declared once in
`arpi.constants.ACCOUNTING_LANE_SQL_FILES`, and they are excluded from the MVP counts for
exactly the reason the two lanes below are. Unlike either of them, this lane has **no
browser dataset and no console route at all**: it stops at the reporting layer, and
`src/arpi/dashboard/contract.py` is deliberately unchanged by it.

Fifteen of the files above are marked **Listing lane**. They implement the sanitized public
listing lane of [ADR-0011](../docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md)
and they are **not part of the MVP warehouse**, even though they live in the same
directories and run in the same sequence.

The distinction is load-bearing. "Five MVP facts", "eight conformed dimensions" and
"twenty-eight reporting views" were measured against a specific SQL baseline that the
semantic model binds to, and a sixth fact appearing in a glob would change every one of
those numbers without anyone deciding to. The lane is declared **once**, in
`arpi.inventory.spec.INVENTORY_LANE_SQL_FILES`, and the capability register, the portfolio
manifest generator and the content-integrity suite all read that declaration rather than
restating it.

The two lanes also run on different clocks. Every MVP script above marked **Runtime**
executes on every pipeline run against generated data. Every listing script marked
**workbook cadence** executes only when an operator imports a sanitized workbook, which is
why the listing dimension loader is named `_load.sql` and not `_merge.sql`.

> **File headers carry stale ordinals, and deliberately so.** A file created when the
> sequence had 25 steps says "of 25"; one created when it had 66 says "of 66". Renumbering
> every header on every addition would produce a diff that touches every file and proves
> nothing. **This table is the authority for ordering**, and
> `tests/integration/conftest.py::init_sequence_files` derives the real order from the
> file names rather than from any header. The reporting and reconciliation files added in
> this increment state their layer rather than an ordinal, which is the convention going
> forward.

### Files deliberately **not** in the sequence

| File | Why |
|---|---|
| `07_security/02_role_verification.sql` | Read-only operator report. Run on demand. Harmless if it does run |
| `99_local_reset.sql` | **Destroys all data.** Never part of initialisation. Lives at the `sql/` root so the `sql/0*/` glob cannot pick it up |

### Why the last step repeats the grants script

`ALTER DEFAULT PRIVILEGES` only covers objects created *after* it is set, and
ownership is assigned to `arpi_admin` by the first grants pass. The validation views and
functions created in the validation steps would otherwise be owned by the bootstrap role.
`01_grants.sql` is idempotent, so re-running it costs nothing and leaves every
object owned by `arpi_admin` with the correct grants. The final grants pass is verified by
`tests/integration/test_security_roles.py`.

### Why there is no `00_database/01_extensions.sql`

No PostgreSQL extension is needed. SHA-256 attribute hashes are computed in
Python, surrogate keys are plain integers, and there is no search or spatial
requirement. An empty extensions script would imply a dependency that does not
exist, so the file is absent rather than empty. The numbering gap is intentional.

---

## 3. Running it

### 3.1 As a loop

The sequence is 173 files, so pasting each one is not the readable option.
It does not need to be: the numeric directory and file prefixes are designed so
that plain sorted order **is** the correct order. Section 2 above lists every step
explicitly if you want to see them.

`sql/0*/` cannot match `sql/99_local_reset.sql`, which is why that file lives at
the `sql/` root.

```bash
cd /path/to/Automotive-Retail-Performance-Intelligence
export PGDATABASE=arpi_dev

set -e
for f in $(ls -1 sql/0*/*.sql | grep -v '07_security/02_role_verification' | sort); do
    echo "==> $f"
    psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "==> sql/07_security/01_grants.sql (privilege normalisation)"
psql -v ON_ERROR_STOP=1 -q -f sql/07_security/01_grants.sql
```

Run it a second time to confirm idempotency. The output is a series of
`NOTICE: ... already exists, skipping` lines and **no errors**.

### 3.2 Verifying

```bash
psql -d arpi_dev -c '\dn'                         # five schemas
psql -d arpi_dev -c '\dt warehouse.*'             # 8 dimensions + 7 facts (5 MVP + listing + target)
psql -d arpi_dev -c '\dv staging.*'               # 3 views per Phase 1 entity
psql -d arpi_dev -c '\dv reporting.*'             # 39 views: 28 MVP + 6 listing + 5 dashboard
psql -d arpi_dev -c 'SELECT count(*) FROM warehouse.dim_date'
psql -d arpi_dev -c 'SELECT * FROM audit.vw_dq_all ORDER BY check_id'
psql -d arpi_dev -P pager=off -f sql/07_security/02_role_verification.sql
```

Full walkthrough, including creating the database and a login user:
[`../docs/database-setup.md`](../docs/database-setup.md).

---

## 4. What the Python loader executes at runtime

`src/arpi/ingestion/loader.py` does the following on every
`arpi run-foundation --load-database`:

1. Resolves an `EntityIngestionSpec` for every generated entity from
   `src/arpi/ingestion/spec.py`. Adding an entity is adding a spec; there is no
   per-entity branch anywhere in the loader.
2. `COPY`s each entity's frame into its `raw.<entity>_load` table with a fresh
   `load_batch_id`.
3. **Globs `sql/03_dimensions/*_merge.sql`, sorts by file name, and executes each
   file's entire text through `psycopg`'s `cursor.execute()`.**
4. Measures the five-layer row-count chain for every entity, reading
   `raw.<entity>_load`, `staging.stg_<entity>` and `staging.stg_<entity>_rejected`
   independently.
5. Reads `staging.stg_<entity>_rejected`, passes every payload through
   `arpi.validation.privacy.redact_payload`, and writes the result to
   `audit.rejected_record`.
6. Records the row counts, the reconciliations and the validation results in `audit`.
7. Commits.

That runtime contract constrains every merge file:

- **Plain SQL only.** No `psql` meta-commands — no `\i`, `\set`, `\c`, `\gexec`,
  `\copy`. (No file under `sql/0*/` uses one, so the whole tree is safe either
  way.)
- **No `BEGIN`/`COMMIT`.** The loader owns the transaction.
- **Statements separated by semicolons.** `psycopg` sends a parameterless
  `execute()` through the simple query protocol, which permits multiple
  statements; they execute strictly in order.
- **Safe on an empty database.** Every merge reads a staging view, so with no raw
  rows it affects zero rows. That is why they also sit inside the ordinary
  initialisation sequence, at steps 39–46.
- **File name matters.** A new dimension merge must be named `NN_<name>_merge.sql`
  to be picked up, and its number determines when it runs relative to the others.

---

## 5. Idempotency guarantees

| Script class | Guarantee | Mechanism |
|---|---|---|
| Schema creation | Rerun changes nothing | `CREATE SCHEMA IF NOT EXISTS` |
| Table DDL | Rerun changes nothing; existing rows untouched | `CREATE TABLE IF NOT EXISTS` |
| Views | Rerun redefines identically | `CREATE OR REPLACE VIEW` |
| Functions | Rerun redefines identically | `CREATE OR REPLACE FUNCTION` |
| Indexes | Rerun changes nothing | `CREATE INDEX IF NOT EXISTS` |
| Roles | Rerun changes nothing; existing roles and memberships preserved | `DO` block guarded on `pg_roles` |
| Grants and ownership | Declarative; rerun converges to the same state | `GRANT`/`REVOKE`/`ALTER ... OWNER` |
| `dim_date` merge | Rerun with unchanged source writes **zero** rows | `ON CONFLICT (date_key) DO UPDATE ... WHERE <row> IS DISTINCT FROM <row>` |
| `dim_dealership` merge | Rerun with unchanged source writes **zero** rows | Change detection on `attribute_hash`; nothing expires and nothing inserts when the hash matches |
| Phase 1 Type 1 merges | Rerun with unchanged source writes **zero** rows | `ON CONFLICT (<natural key>) DO UPDATE ... WHERE <row> IS DISTINCT FROM <row>`; new surrogate keys are consumed only by rows the dimension has never seen |
| `dim_employee` merge | Rerun with unchanged source writes **zero** rows | Same `attribute_hash` change detection as `dim_dealership`; a proposed version whose hash matches its predecessor on the combined timeline is a no-op |
| Staging cast helpers | Rerun redefines identically | `CREATE OR REPLACE FUNCTION` |
| Validation views | Read-only; evaluating them writes nothing | Plain `SELECT`s |

Two things are deliberately **not** idempotent, because they must not be:

- `audit.fn_record_validation_result` and `audit.fn_record_all_dq_checks` append a
  new result row each time they are called. Audit history accumulates; that is the
  point.
- `99_local_reset.sql` destroys data every time it runs.

### Deterministic surrogate keys

`dealership_key` is assigned by the merge as
`max(dealership_key) + row_number() OVER (ORDER BY dealership_id, effective_date)`,
not from a sequence. On a first load this yields `1, 2, 3` in `dealership_id`
order, matching the canonical store table, and rebuilding from the same CSVs
reproduces identical keys. A sequence would drift after any rolled-back load,
because sequences are non-transactional. The reasoning is recorded in the header
of `03_dimensions/11_dim_dealership_merge.sql`.

### Deterministic surrogate keys for the Phase 1 dimensions

Every Phase 1 merge assigns keys the same way and for the same reasons:
`(SELECT coalesce(max(<key>), 0) FROM warehouse.<table>) + row_number() OVER (ORDER BY <natural key>)`,
applied **only to rows the dimension has never seen**. Rows already present keep the key
they were given, so a key is never reused, never reassigned, and a first load into an
empty dimension yields `1..N` in natural-key order with no gaps. The generator's own key
column is deliberately ignored — staging exposes it as `source_<key>`, lineage only,
because a Type 2 change creates a version the source has no key for.

---

## 5A. The ingestion row-count chain

`staging` is not a pass-through. Four things drop a row, and each is reported rather
than hidden:

| Code | Category | What it means |
|---|---|---|
| `REJ-TYPE-001` | `structural` | A value is present but cannot be represented in its governed type |
| `REJ-NULL-001` | `completeness` | A required value is absent |
| `REJ-DOMAIN-001` | `business_rule` | A value is outside its enumerated domain or numeric range |
| `REJ-KEY-001` | `uniqueness` | A duplicate natural key within one load batch; the highest `raw_record_id` survives |

`REJ-PARSE-001`, `REJ-SCHEMA-001`, `REJ-REF-001` and `REJ-RULE-001` complete the
vocabulary. The full register lives in
[`../docs/source-to-target/README.md`](../docs/source-to-target/README.md) section 4 and
in `src/arpi/ingestion/rejection.py`, which maps each code to one of the seven canonical
validation categories. There is deliberately **one** vocabulary: no `REJ-CAST-*` beside
`REJ-TYPE-*`, no `REJ-DUPKEY-*` beside `REJ-KEY-*`.

Each entity therefore has three staging views, derived from one another so the accepted
set and the rejected set cannot drift apart:

```
staging.stg_<entity>_typed      every row of the newest batch, cast and classified
staging.stg_<entity>            the accepted rows      (rejection_code IS NULL, rank 1)
staging.stg_<entity>_rejected   the dropped rows       (coded, categorised, with payload)
```

Every row of the newest batch appears in exactly one of the latter two, which is what
makes this identity a real assertion rather than an arithmetic tautology:

```
raw = staging_accepted + rejected_invalid + deduplicated
distinct natural keys in staging = those same keys present in the warehouse
```

`src/arpi/ingestion/loader.py` measures each term with its own query and records both
identities as `RECON-INGEST-<ENTITY>-CHAIN` and `RECON-INGEST-<ENTITY>-WAREHOUSE` on
every run, alongside `source`, `raw`, `staging`, `warehouse` and `rejected` row counts in
`audit.pipeline_run_row_count`. This closes `DOC-23`, and
`tests/integration/test_ingestion_row_count_chain.py` is the evidence: it loads six rows
containing one unparseable value, one out-of-domain value, one missing required value and
one duplicate key, then asserts every layer's count and that the chain balances.

**Rejected payloads are redacted before they are persisted.** A quarantined row is stored
*with its values* so the defect can be reproduced, and that is precisely the moment a
prohibited value would be written into a table nobody thinks of as holding data. Every
payload passes through `arpi.validation.privacy.redact_payload` unconditionally — not per
entity, not when the caller remembers. A rejected customer row cannot write an e-mail
address into `audit.rejected_record` even if one somehow appeared in the source.

`audit.rejected_record` has no `rejection_category` or `source_row_number` column. Both
are required by the ingestion contract, so both are carried inside the JSON payload under
the reserved `_lineage` key, and the category is additionally a machine-readable prefix on
`rejection_reason`. Promoting them to real columns is a change to a table owned elsewhere
and is recorded as a follow-up rather than made unilaterally.

---

## 6. Object ownership assumptions

- The initialisation sequence is run by a **superuser**, or by a role that is a
  member of `arpi_admin`. Reassigning ownership requires it.
- After the first grants pass (and again after the final one) **every** schema, table, view, sequence
  and function in the five ARPI schemas is owned by **`arpi_admin`**.
- That ownership is the security mechanism, not a tidiness preference. A
  PostgreSQL view runs with its owner's privileges, so `arpi_reporter` can read
  `reporting.vw_calendar` while holding no privilege whatsoever on
  `warehouse.dim_date` — and none on `raw`.
- `arpi_loader` reads and writes `raw`, `staging`, `warehouse` and `audit`. It
  cannot create objects and has no privileges on `reporting`.
- `arpi_reporter` has `USAGE` on `reporting` and `SELECT` on its views. Nothing
  else. `01_grants.sql` explicitly `REVOKE`s the raw layer from it and then
  asserts the result, raising an exception rather than shipping a hole.
- All three are `NOLOGIN` group roles. Humans and services connect as separate
  login roles granted membership. **No password appears anywhere in this
  repository.**

---

## 7. Data-quality checks

```sql
SELECT check_id, status, failed_record_count, message
FROM audit.vw_dq_all
ORDER BY check_id;
```

| View | Checks |
|---|---|
| `audit.vw_dq_dim_date` | `DQ-DATE-001..005` |
| `audit.vw_dq_dim_dealership` | `DQ-DLR-001..005` |
| `audit.vw_dq_referential` | `DQ-REF-001..005` |
| `audit.vw_dq_audit` | `DQ-AUD-001..005` |
| `audit.vw_dq_all` | all of the above |
| `audit.vw_dq_result_template` | executable specification of the shared result shape |

All return the same ten columns: `check_id`, `check_name`, `check_category`,
`target_object`, `severity`, `status`, `observed_value`, `expected_value`,
`failed_record_count`, `message`. `status` is `passed`, `failed` or **`skipped`** —
a check over an empty table reports `skipped`, never `passed`, because there is no
evidence to claim.

`DQ-DATE-*` and `DQ-DLR-*` identifiers are shared verbatim with the Python
validation framework, so one rule has one identity in both implementations.

Persist the results against a run:

```sql
SELECT audit.fn_record_all_dq_checks(<pipeline_run_id>);
```

---

## 8. Resetting a local database

```bash
psql -v ON_ERROR_STOP=1 -d arpi_dev -f sql/99_local_reset.sql
```

**This destroys every ARPI schema and every row in them, including the whole audit
history. There is no undo and no confirmation prompt.** It refuses to run unless
the database name starts with `arpi_` and does not contain `prod`. It does not
drop the database and does not drop the cluster-wide roles. Rebuild by running the
sequence in section 2 again.

---

## 9. Tests

```bash
.venv/bin/pytest -m integration -v
```

`tests/integration/` creates a throwaway database, runs this entire sequence into
it twice, and asserts the schemas, the grains, the CHECK constraints, the foreign
keys, the merge idempotency, the SCD Type 2 path, the five-layer ingestion row-count
chain and the role restrictions — including that `arpi_reporter` genuinely cannot read
`raw.dealership_load`. The tests skip cleanly when no PostgreSQL server is reachable.

`tests/integration/test_ingestion_row_count_chain.py` is the one that closes `DOC-23`.
It drives the real `load_foundation` path over a deliberately defective six-row fixture
and asserts each layer's count, the chain identity, the four rejection codes, and that
every persisted payload is the redactor's output.
