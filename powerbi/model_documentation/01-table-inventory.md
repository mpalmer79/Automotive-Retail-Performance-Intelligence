# Table Inventory — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

Every table the model imports, with the grain it carries and the role it plays. Row counts are from the
`development` profile (2025-07-01 … 2025-12-31, three stores) and are given so a reviewer can sanity-check
an import; the `test` profile is smaller and the `portfolio` profile larger.

Nothing in this table is aspirational: every object listed is a view in the `reporting` schema today, and
`tests/integration/test_reporting_layer_completeness.py` asserts the schema contains exactly these views
and no others.

---

## 1. Dimension tables

Eight tables, one per MVP dimension. Each relates one-to-many into the facts, in a single direction.

| Table | Grain | Rows | Key column (hidden) | Preferred label | Notes |
|---|---|---:|---|---|---|
| `vw_calendar` | One row per calendar date | 184 | `date_key` | `month_year_label` | **Marked as the date table.** Contiguous, one row per date, covers every fact date key. |
| `vw_dealership` | One row per store, current SCD2 version only | 3 | `dealership_key` | `store_short_name` | Type 2 plumbing is deliberately not exposed; a report cannot double-count a store. |
| `vw_employee` | One row per employee, current SCD2 version only | 30 | `employee_key` | `employee_label` | Minimised: no name, contact detail, pay plan or termination date. Tenure is a band. |
| `vw_customer` | One row per customer | 2,500 | `customer_key` | `customer_code` | Age is a band, geography is county and market area. No name, address, postal code or contact detail exists anywhere in ARPI. |
| `vw_vehicle` | One row per physical vehicle | 900 | `vehicle_key` | `synthetic_vin` | `condition_group` is the governed new/used split; a certified unit is **used**. |
| `vw_vehicle_model` | One row per model line (year × make × model × trim) | 120 | `vehicle_model_key` | `model_label` | The only snowflake in the model: relates to `vw_vehicle`, not directly to the sale fact. |
| `vw_lead_source` | One row per normalised lead source | 19 | `lead_source_key` | `lead_source_name` | `is_cost_attributable` carries the rule that marketing cost measures are undefined for organic and internal sources. |
| `vw_marketing_campaign` | One row per campaign | 24 | `campaign_key` | `campaign_name` | Every campaign and vendor name is fictional. |

---

## 2. Fact tables

Five tables, one per MVP fact, each preserving its warehouse fact's grain exactly — no aggregation, no
filtering, no row lost. That is asserted per table by
`tests/integration/test_reporting_layer_completeness.py` and reconciled on every pipeline run by
`RECON-REPORT-*-ROWS`.

| Table | Grain | Rows | Cols | Date roles | Notes |
|---|---|---:|---:|---|---|
| `vw_vehicle_sales` | One row per finalized vehicle transaction | 650 | 43 | `sale_date_key` (active), `delivery_date_key` | Publishes pre-filtered retail numerators so no measure has to re-apply `is_retail`. |
| `vw_inventory_snapshots` | One row per vehicle per store per daily snapshot date | 45,754 | 21 | `snapshot_date_key` | **Semi-additive.** Row-level `days_in_stock` is exposed because `KPI-INV-004` is a median. |
| `vw_leads` | One row per CRM lead, duplicates included | 6,000 | 31 | `lead_created_date_key` | Duplicates are excluded by column, not by filter, so the excluded population stays visible. Row-level `first_response_seconds` is exposed for `KPI-FUN-008`. |
| `vw_appointments` | One row per scheduled appointment | 2,111 | 28 | `created_date_key`, `scheduled_date_key` (active), `show_date_key` | A grain shift from `vw_leads`: one lead can produce several appointments. |
| `vw_marketing_spend` | One row per store × campaign × calendar month | 212 | 13 | `month_date_key` | Month grain is the structural floor under every cost-per measure. |

### 2.1 The two fact-to-fact relationships

`vw_leads.sale_key` and `vw_appointments.sale_key` resolve to `vw_vehicle_sales.sale_key`, and
`vw_appointments.lead_key` resolves to `vw_leads.lead_key`. These are legitimate — they are how a funnel
outcome is traced to the deal it produced — and they are single-direction, many-to-one, and **inactive** in
the model. Activating them would let a sale filter the funnel, which is not what any funnel KPI means: a
lead counts in the period it arrived, whatever happened later.

---

## 3. Analytical tables

Thirteen governed aggregates. **A semantic model should import the fact tables above, not these.** They
exist because a row-grain fact recomputes a ratio or an order statistic under any filter context while an
aggregate cannot, and because SQL, Excel and reconciliation consumers need one governed answer per KPI that
does not depend on a DAX engine.

Two of them — `vw_data_quality_trend` and `vw_reconciliation_status` — *are* intended for the model, because
the Data Quality page has no fact table of its own.

| Table | Grain | Rows | KPIs owned | Import into the model? |
|---|---|---:|---|---|
| `vw_sales_summary` | Store × sale date | 357 | `KPI-SLS-001`…`003`, `KPI-INV-007` mean | No — use `vw_vehicle_sales` |
| `vw_gross_summary` | Store × sale date | 357 | `KPI-GRS-001`…`006` | No — use `vw_vehicle_sales` |
| `vw_inventory_health` | Store × snapshot date × condition group | 920 | `KPI-INV-001`…`006` | No — use `vw_inventory_snapshots` |
| `vw_inventory_aging` | Store × snapshot date × condition group × age bucket | 4,575 | `KPI-INV-004` support, aging distribution | No — use `vw_inventory_snapshots` |
| `vw_days_to_sale` | Store × sale month × condition group | 30 | `KPI-INV-007` | No — use `vw_vehicle_sales` |
| `vw_inventory_turn` | Store × month × condition group | 30 | `KPI-INV-008` | **Yes** — the two date bases cannot be aligned in DAX without a calculation group |
| `vw_days_supply` | Store × as-of date × condition group | 920 | `KPI-INV-009` | **Yes** — the trailing-window join is a SQL concern |
| `vw_lead_funnel` | Store × source × campaign × lead-creation date | 4,419 | `KPI-FUN-001`, `002`, `003`, `006` | No — use `vw_leads` |
| `vw_appointment_funnel` | Store × calendar date, carrying both date bases | 539 | `KPI-FUN-004`, `005` | No — use `vw_appointments` |
| `vw_lead_response` | Store × source × lead-creation date | 4,099 | `KPI-FUN-007`, `008` | No — use `vw_leads` |
| `vw_marketing_performance` | Store × month × source × campaign | 537 | `KPI-MKT-001`…`003` | **Yes** — the spend-to-outcome attribution is a full outer join, not a relationship |
| `vw_data_quality_trend` | Run × check category × severity | 9 | none | **Yes** — the Data Quality page |
| `vw_reconciliation_status` | Run × reconciliation identifier | 58 | none | **Yes** — the Data Quality page |

### 3.1 Why three analytical views are imported and ten are not

`vw_inventory_turn`, `vw_days_supply` and `vw_marketing_performance` each combine two facts across two
different date columns over one period window. Expressing that in DAX is possible but fragile — it is the
classic place a measure silently drifts, because nothing forces both sides to use the same window. Doing it
once in SQL, reconciled on every run, is the governed answer. The other ten are pre-aggregations of a single
fact and would only reduce what the model can do.

---

## 4. Operational tables

| Table | Grain | Rows | Purpose |
|---|---|---:|---|
| `vw_pipeline_run_summary` | One row per pipeline run | 1 | Run context for the Data Quality page: profile, seed, status, duration, row counts. |
| `vw_data_quality_summary` | One row per validation result | 114 | Individual check outcomes. `vw_data_quality_trend` is its cross-run companion. |

---

## 5. Visibility

| Column class | Hidden? | Reason |
|---|---|---|
| `*_key` on any table | **Hidden** | A surrogate key is for a relationship. A report author who groups by one gets a meaningless axis, and one who filters on one silently drops the blank row. |
| `*_code` business identifiers | Visible | The stable identifier a person quotes, e.g. `GSA-001`. |
| `source_system` | Visible | Present on every table so no reader mistakes synthetic data for real dealer data. Do not hide it. |
| `age_bucket_sort_order` | **Hidden** | A sort-by column, set as the sort order for `age_bucket`. |
| `year_month_number` | **Hidden** | A sort-by column, set as the sort order for `year_month_label`. |
| Pre-filtered numerators (`retail_unit_count`, `new_unit_count`, `valid_lead_count`, …) | **Hidden** | They exist to be summed by a measure, not to be dragged onto a visual. Exposing them invites a report author to sum `unit_count` and `retail_unit_count` on the same table. |
| Materialised ratios on analytical views (`contact_rate`, `show_rate`, `cost_per_lead`, …) | **Hidden** where the view is imported | Valid at the view's own grain only. The model's measure recomputes them, and two versions of one number visible at once is how a report starts disagreeing with itself. |
| Everything else | Visible | Descriptive attributes and additive measures. |
