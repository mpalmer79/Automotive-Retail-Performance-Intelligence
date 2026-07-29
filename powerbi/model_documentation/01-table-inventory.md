# Table Inventory — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

Every table the model imports, with the grain it carries, the role it plays, and the TMDL file that defines
it. **This is an as-built record.** The model exists at
[`powerbi/ARPI_Performance_Intelligence/`](../ARPI_Performance_Intelligence/); every table below is declared
in `ARPI_Performance_Intelligence.SemanticModel/definition/tables/` and referenced from `model.tmdl`.

Row counts are from the `development` profile (2025-07-01 … 2025-12-31, three stores) and are given so a
reviewer can sanity-check an import; the `test` profile is smaller and the `portfolio` profile larger. **No
import has been performed.** The row counts are the database's, observed in SQL; Power BI Desktop has never
refreshed this model, so no table in it has ever held a row. See
[08-desktop-validation.md](08-desktop-validation.md).

Column counts are the model's, not the view's, and include the hidden calculated sort-order columns
described in §6. `Cols` counts every column on the table; `Hidden` counts those with `isHidden`.

The model holds **twenty-six** tables: the twenty below, plus six measure tables that hold no imported data
and are documented in [03-measure-groups.md](03-measure-groups.md).

---

## 1. Dimension tables

Eight tables, one per MVP dimension. Each relates one-to-many into the facts, in a single direction. All
eight carry `ARPI_TableRole = Dimension`.

| Table | TMDL file | Grain | Rows | Cols | Hidden | Key column (hidden) | Preferred label | Notes |
|---|---|---|---:|---:|---:|---|---|---|
| `vw_calendar` | `tables/vw_calendar.tmdl` | One row per calendar date | 184 | 30 | 2 | `date_key` | `month_year_label` | **Marked as the date table** (`dataCategory: Time`, `calendar_date` carries `isKey`). Contiguous, one row per date, covers every fact date key. |
| `vw_dealership` | `tables/vw_dealership.tmdl` | One row per store, current SCD2 version only | 3 | 16 | 1 | `dealership_key` | `store_short_name` | Type 2 plumbing is deliberately not exposed; a report cannot double-count a store. |
| `vw_employee` | `tables/vw_employee.tmdl` | One row per employee, current SCD2 version only | 30 | 14 | 3 | `employee_key` | `employee_label` | Minimised: no name, contact detail, pay plan or termination date. Tenure is a band. Carries `dealership_code` and `store_short_name` on every row, which is why the store relationship is not needed — see [02-relationship-plan.md §3.2](02-relationship-plan.md). |
| `vw_customer` | `tables/vw_customer.tmdl` | One row per customer | 2,500 | 15 | 2 | `customer_key` | `customer_code` | Age is a band, geography is county and market area. No name, address, postal code or contact detail exists anywhere in ARPI. |
| `vw_vehicle` | `tables/vw_vehicle.tmdl` | One row per physical vehicle | 900 | 15 | 3 | `vehicle_key` | `synthetic_vin` | `condition_group` is the governed new/used split; a certified unit is **used**. |
| `vw_vehicle_model` | `tables/vw_vehicle_model.tmdl` | One row per model line (year × make × model × trim) | 120 | 19 | 1 | `vehicle_model_key` | `model_label` | The only snowflake in the model: relates to `vw_vehicle`, not directly to the sale fact. |
| `vw_lead_source` | `tables/vw_lead_source.tmdl` | One row per normalised lead source | 19 | 11 | 1 | `lead_source_key` | `lead_source_name` | `is_cost_attributable` carries the rule that marketing cost measures are undefined for organic and internal sources. |
| `vw_marketing_campaign` | `tables/vw_marketing_campaign.tmdl` | One row per campaign | 24 | 15 | 2 | `campaign_key` | `campaign_name` | Every campaign and vendor name is fictional. `lead_source_key` is hidden here too; it is a relationship column, not an attribute. |

---

## 2. Fact tables

Five tables, one per MVP fact, each preserving its warehouse fact's grain exactly — no aggregation, no
filtering, no row lost. That is asserted per table by
`tests/integration/test_reporting_layer_completeness.py` and reconciled on every pipeline run by
`RECON-REPORT-*-ROWS`. All five carry `ARPI_TableRole = Fact`.

| Table | TMDL file | Grain | Rows | Cols | Hidden | Date roles | Notes |
|---|---|---|---:|---:|---:|---|---|
| `vw_vehicle_sales` | `tables/vw_vehicle_sales.tmdl` | One row per finalized vehicle transaction | 650 | 43 | 20 | `sale_date_key` (active), `delivery_date_key` (inactive) | Publishes pre-filtered retail numerators so no measure has to re-apply `is_retail`. Row-level `retail_days_in_inventory` is visible because `KPI-INV-007` is a median. |
| `vw_inventory_snapshots` | `tables/vw_inventory_snapshots.tmdl` | One row per vehicle per store per daily snapshot date | 45,754 | 22 | 8 | `snapshot_date_key` (active) | **Semi-additive.** Row-level `days_in_stock` is visible because `KPI-INV-004` is a median. 22 columns: 21 from the view plus the hidden `age_bucket_sort_order`. |
| `vw_leads` | `tables/vw_leads.tmdl` | One row per CRM lead, duplicates included | 6,000 | 32 | 20 | `lead_created_date_key` (active) | Duplicates are excluded by column, not by filter, so the excluded population stays visible. Row-level `first_response_seconds` is visible for `KPI-FUN-008`. 32 columns: 31 from the view plus the hidden `response_time_band_sort_order`. |
| `vw_appointments` | `tables/vw_appointments.tmdl` | One row per scheduled appointment | 2,111 | 28 | 18 | `created_date_key` (inactive), `scheduled_date_key` (active), `show_date_key` (inactive) | A grain shift from `vw_leads`: one lead can produce several appointments. |
| `vw_marketing_spend` | `tables/vw_marketing_spend.tmdl` | One row per store × campaign × calendar month | 212 | 13 | 5 | `month_date_key` (active) | Month grain is the structural floor under every cost-per measure. |

### 2.1 The three fact-to-fact relationships

`vw_leads.sale_key` and `vw_appointments.sale_key` resolve to `vw_vehicle_sales.sale_key`, and
`vw_appointments.lead_key` resolves to `vw_leads.lead_key`. These are legitimate — they are how a funnel
outcome is traced to the deal it produced — and all three are single-direction, many-to-one, and **inactive**
in the model as built. Activating any would let a sale filter the funnel, which is not what any funnel KPI
means: a lead counts in the period it arrived, whatever happened later.

---

## 3. Analytical tables

Thirteen governed aggregates. **The model imports the fact tables above, not these**, except for the five
noted below. They exist because a row-grain fact recomputes a ratio or an order statistic under any filter
context while an aggregate cannot, and because SQL, Excel and reconciliation consumers need one governed
answer per KPI that does not depend on a DAX engine.

The **Imported** column is an as-built statement: it says what is in the model, not what was intended.
Ten of the thirteen are absent from the model, which is what `model.tmdl`'s `ref table` list shows.

| Table | Grain | Rows | KPIs owned | Imported? | TMDL file |
|---|---|---:|---|---|---|
| `vw_sales_summary` | Store × sale date | 357 | `KPI-SLS-001`…`003`, `KPI-INV-007` mean | No — use `vw_vehicle_sales` | — |
| `vw_gross_summary` | Store × sale date | 357 | `KPI-GRS-001`…`006` | No — use `vw_vehicle_sales` | — |
| `vw_inventory_health` | Store × snapshot date × condition group | 920 | `KPI-INV-001`…`006` | No — use `vw_inventory_snapshots` | — |
| `vw_inventory_aging` | Store × snapshot date × condition group × age bucket | 4,575 | `KPI-INV-004` support, aging distribution | No — use `vw_inventory_snapshots` | — |
| `vw_days_to_sale` | Store × sale month × condition group | 30 | `KPI-INV-007` | No — use `vw_vehicle_sales` | — |
| `vw_inventory_turn` | Store × month × condition group | 30 | `KPI-INV-008` | **Yes** | `tables/vw_inventory_turn.tmdl` |
| `vw_days_supply` | Store × as-of date × condition group | 920 | `KPI-INV-009` | **Yes** | `tables/vw_days_supply.tmdl` |
| `vw_lead_funnel` | Store × source × campaign × lead-creation date | 4,419 | `KPI-FUN-001`, `002`, `003`, `006` | No — use `vw_leads` | — |
| `vw_appointment_funnel` | Store × calendar date, carrying both date bases | 539 | `KPI-FUN-004`, `005` | No — use `vw_appointments` | — |
| `vw_lead_response` | Store × source × lead-creation date | 4,099 | `KPI-FUN-007`, `008` | No — use `vw_leads` | — |
| `vw_marketing_performance` | Store × month × source × campaign | 537 | `KPI-MKT-001`…`003` | **Yes** | `tables/vw_marketing_performance.tmdl` |
| `vw_data_quality_trend` | Run × check category × severity | 9 | none | **Yes** | `tables/vw_data_quality_trend.tmdl` |
| `vw_reconciliation_status` | Run × reconciliation identifier | 58 | none | **Yes** | `tables/vw_reconciliation_status.tmdl` |

### 3.1 Why three analytical views are imported and ten are not

`vw_inventory_turn`, `vw_days_supply` and `vw_marketing_performance` each combine two facts across two
different date columns over one period window. Expressing that in DAX is possible but fragile — it is the
classic place a measure silently drifts, because nothing forces both sides to use the same window. Doing it
once in SQL, reconciled on every run, is the governed answer. The other ten are pre-aggregations of a single
fact and would only reduce what the model can do.

The three imported analytical tables carry `ARPI_TableRole = Analytical` and are documented as such below.

| Table | Cols | Hidden | Role in the model |
|---|---:|---:|---|
| `vw_inventory_turn` | 10 | 3 | Sole source of `KPI-INV-008`. Valid at month grain or coarser: the view carries no finer key. |
| `vw_days_supply` | 8 | 3 | Sole source of `KPI-INV-009`. The trailing-30-day window is fixed in SQL. |
| `vw_marketing_performance` | 21 | 7 | Sole source of `KPI-MKT-001`…`003`. A full outer join of spend against attributed outcome, which is why `campaign_key` is nullable on it. |

### 3.2 A note on the two data-quality views

`vw_data_quality_trend` and `vw_reconciliation_status` appear in the table above because that is where the
specification listed them, but in the model they carry `ARPI_TableRole = **Operational**`, not `Analytical`,
alongside `vw_pipeline_run_summary` and `vw_data_quality_summary`. They describe pipeline runs, not business
events. The model treats all four the same way and §4 is the authoritative list.

---

## 4. Operational tables

Four tables, all carrying `ARPI_TableRole = Operational`, and all four **disconnected from the star**: none
of them has a relationship to any other table in the model. That is deliberate. They describe pipeline runs
rather than business events, and relating them to `vw_calendar` would let a business date filter silently
change what a quality figure means.

| Table | TMDL file | Grain | Rows | Cols | Hidden | Purpose |
|---|---|---|---:|---:|---:|---|
| `vw_data_quality_trend` | `tables/vw_data_quality_trend.tmdl` | Run × check category × severity | 9 | 18 | 3 | Pass rate, evaluation coverage and check counts across runs. Source of seven of the eleven data-quality measures. |
| `vw_reconciliation_status` | `tables/vw_reconciliation_status.tmdl` | Run × reconciliation identifier | 58 | 22 | 0 | Reconciliation evidence, and the only route by which it reaches a reader without a grant on `audit`. |
| `vw_pipeline_run_summary` | `tables/vw_pipeline_run_summary.tmdl` | One row per pipeline run | 1 | 28 | 0 | Run context: profile, seed, status, duration, row counts. |
| `vw_data_quality_summary` | `tables/vw_data_quality_summary.tmdl` | One row per validation result | 114 | 22 | 1 | Individual check outcomes. `vw_data_quality_trend` is its cross-run companion. |

---

## 5. Visibility

Summarised here; the complete as-built policy, including the reason for every class, is
[05-column-visibility.md](05-column-visibility.md).

| Column class | Hidden? | Reason |
|---|---|---|
| `*_key` on any table | **Hidden** | A surrogate key is for a relationship. A report author who groups by one gets a meaningless axis, and one who filters on one silently drops the blank row. |
| `*_code` business identifiers | Visible | The stable identifier a person quotes, e.g. `GSA-001`. |
| `source_system` | Visible | Present on every fact and dimension so no reader mistakes synthetic data for real dealer data. Do not hide it. |
| Sort-order helper columns (seven `*_sort_order` calculated columns, plus `year_month_number`) | **Hidden** | Ordering machinery, set as the sort-by column for the label they order. See §6. |
| Pre-filtered numerators (`retail_unit_count`, `new_unit_count`, `valid_lead_count`, …) | **Hidden** | They exist to be summed by a measure, not to be dragged onto a visual. Exposing them invites a report author to sum `unit_count` and `retail_unit_count` on the same table. |
| Materialised ratios on imported analytical views (`inventory_turn`, `days_supply`, `cost_per_lead`, `cost_per_sale`, `gross_return_on_ad_spend`, `pass_rate`, `evaluation_coverage`) | **Hidden** | Valid at the view's own grain only. The model's measure recomputes them, and two versions of one number visible at once is how a report starts disagreeing with itself. |
| Row-level median populations (`days_in_stock`, `retail_days_in_inventory`, `first_response_seconds`) | Visible | A median has to be recomputed from row level, and the population it is computed over should be inspectable. |
| Everything else | Visible | Descriptive attributes. |

---

## 6. Ordered labels and the six hidden sort-order columns

Six columns in the reporting layer are **ordered labels published without an ordering column**. Sorted
alphabetically, which is what Power BI does by default, they read wrong: `Over 120` lands between `0-30` and
`31-60`, `Under 5 minutes` sorts after `15-60 minutes`, and `critical` sorts after `warning`. Every visual
built on them would be misleading in a way that looks like a design choice.

The model supplies the order with a **hidden DAX calculated column** per label, set as that label's
`sortByColumn`. Values outside the known set map to `99` and sort last, so an unexpected value is visible at
the end of the axis rather than silently placed in the middle.

| Table | Ordered label | Sort-order column | Order defined |
|---|---|---|---|
| `vw_inventory_snapshots` | `age_bucket` | `age_bucket_sort_order` | `0-30`, `31-60`, `61-90`, `91-120`, `Over 120` |
| `vw_leads` | `response_time_band` | `response_time_band_sort_order` | `Under 5 minutes`, `5-15 minutes`, `15-60 minutes`, `Over 60 minutes` |
| `vw_customer` | `age_band` | `age_band_sort_order` | `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+` |
| `vw_employee` | `tenure_band` | `tenure_band_sort_order` | `Under 1 Year`, `1-3 Years`, `3-5 Years`, `5-10 Years`, `Over 10 Years` |
| `vw_vehicle` | `odometer_band` | `odometer_band_sort_order` | `New`, `Under 10k`, `10k-30k`, `30k-60k`, `60k-100k`, `Over 100k` |
| `vw_data_quality_trend` | `severity` | `severity_sort_order` | `critical`, `warning`, `info` |
| `vw_data_quality_summary` | `severity` | `severity_sort_order` | `critical`, `warning`, `info` |

That is **seven calculated columns across six distinct labels** — `severity` is ordered on both data-quality
tables, and a calculated column belongs to one table, so the same `SWITCH` is written twice.

### 6.1 Why the reporting SQL was not changed instead

Adding the ordinal to the reporting views would be the better place for it, and
[ARCHITECTURE.md §19.2](../../ARCHITECTURE.md) says to avoid calculated columns where Power Query or SQL is
more appropriate. It was not done, for one reason: **a reporting view is a contract.** The SQL, Excel and
reconciliation consumers already read these views, `tests/integration/test_reporting_layer_completeness.py`
asserts their exact column sets, and every one is reconciled on each pipeline run. Changing a governed
contract to solve a Power BI presentation problem exports the cost of a display convenience to consumers who
gain nothing from it. Seven hidden columns inside the model is the cheaper and more contained answer, and
this section is the justification [ARCHITECTURE.md §19.2](../../ARCHITECTURE.md) requires for the departure.

`vw_calendar.year_month_number` is **not** a calculated column: the reporting layer already publishes it, and
the model simply hides it and sets it as the sort-by column for `year_month_label` and `month_year_label`.
Three further calendar labels — `day_name`, `month_name` and `quarter_name` — sort by `iso_day_of_week`,
`month_number` and `quarter_number`, ordinal columns the reporting layer already publishes. Where the
contract supplies the ordering column, no calculated column is created.

---

## 7. Where the descriptions in the model come from

Every table and column description in the TMDL — the `///` lines a report author sees as tooltips in the
field list — is taken from the `COMMENT ON VIEW` and `COMMENT ON COLUMN` text in `sql/05_reporting/`.

This is not a convention; it is the mechanism that stops the database and the model from carrying two
different explanations of the same column. `reporting.vw_inventory_snapshots.age_bucket` is commented in
`sql/05_reporting/12_vw_inventory_snapshots.sql` as *"Pre-computed age bucket: 0-30, 31-60, 61-90, 91-120 or
Over 120 days."* and that exact sentence is the column's description in `tables/vw_inventory_snapshots.tmdl`.
A reader who queries the view in `psql` and a reader who hovers the field in Power BI get the same answer,
and the one place to change it is the SQL.

Three consequences worth stating:

* **A description change starts in `sql/05_reporting/`.** Editing the TMDL alone creates the divergence this
  rule exists to prevent.
* **Columns the model adds have model-authored descriptions**, because the database has nothing to say about
  them. That is the seven sort-order columns of §6 and the six measure-table placeholder columns. Each says
  what it is and why it exists.
* **Measure descriptions are not derived from SQL** and cannot be. They come from
  [KPI_CATALOG.md](../../KPI_CATALOG.md) and state the KPI identifier, the interpretation caution and the
  modelling boundary that travel with the number. See [03-measure-groups.md](03-measure-groups.md).
