# Column Visibility Policy — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

The hidden and visible policy as implemented, class by class, with the reason for each. This is an as-built
record: every count below is taken from the committed TMDL under
[`powerbi/ARPI_Performance_Intelligence/`](../ARPI_Performance_Intelligence/).

**408 columns across 26 tables. 109 are hidden; 299 are visible.**

A hidden column is not a removed column. It participates in relationships, it is readable by DAX, and it is
visible to anyone who opens the TMDL. Hiding governs one thing only: whether a report author meets it in the
field list and can drag it onto a visual. That is the failure this policy exists to prevent — not a security
boundary, which is the database's job (see [07-power-query-parameters.md](07-power-query-parameters.md)).

---

## 1. The rule, stated once

**A column is hidden when putting it on a visual would produce a wrong number, a meaningless axis, or a
second version of a number the model already answers.** A column is visible when a report author could
reasonably want it and cannot be misled by it.

Applied, that yields six hidden classes and everything else visible.

| Class | Hidden | Reason in one line |
|---|---:|---|
| Surrogate and relationship keys | 60 | A key is for a join. On an axis it is a meaningless integer; as a filter it silently drops the blank row. |
| Pre-filtered numerator columns | 28 | They exist to be summed by one named measure. Loose, they invite a second, unnamed one. |
| Materialised ratio columns | 7 | Valid at the source view's own grain only. The model's measure recomputes them. |
| Sort-order helper columns | 8 | Ordering machinery. The label they order is the thing to show. |
| Measure-table placeholders | 6 | A table needs a column. This one carries no information at all. |
| **Total** | **109** | |

Counts are per-column-per-table: `dealership_key` appears on ten tables and is counted ten times, because it
is hidden ten times.

---

## 2. Surrogate and relationship keys — 60 hidden columns

Every `*_key` column in the model is hidden, on the dimension that owns it and on every fact that references
it. There is no exception.

| Key | Hidden on | Count |
|---|---|---:|
| `date_key` | `vw_calendar` | 1 |
| `dealership_key` | `vw_dealership`, `vw_employee`, `vw_vehicle_sales`, `vw_inventory_snapshots`, `vw_leads`, `vw_appointments`, `vw_marketing_spend`, `vw_inventory_turn`, `vw_days_supply`, `vw_marketing_performance` | 10 |
| `employee_key` | `vw_employee` | 1 |
| `customer_key` | `vw_customer`, `vw_vehicle_sales`, `vw_leads`, `vw_appointments` | 4 |
| `vehicle_key` | `vw_vehicle`, `vw_vehicle_sales`, `vw_inventory_snapshots` | 3 |
| `vehicle_model_key` | `vw_vehicle_model`, `vw_vehicle`, `vw_vehicle_sales`, `vw_inventory_snapshots`, `vw_leads`, `vw_appointments` | 6 |
| `lead_source_key` | `vw_lead_source`, `vw_marketing_campaign`, `vw_leads`, `vw_vehicle_sales`, `vw_marketing_spend`, `vw_marketing_performance` | 6 |
| `campaign_key` | `vw_marketing_campaign`, `vw_leads`, `vw_marketing_spend`, `vw_marketing_performance` | 4 |
| Employee role keys — `salesperson_key` (×2), `desk_manager_key`, `finance_manager_key`, `assigned_employee_key`, `bdc_employee_key` | `vw_vehicle_sales`, `vw_leads`, `vw_appointments` | 6 |
| Fact surrogate keys — `sale_key`, `lead_key`, `appointment_key`, `inventory_snapshot_key`, `marketing_spend_key` | Their facts, plus the three fact-to-fact reference columns | 8 |
| Date role keys — `sale_date_key`, `delivery_date_key`, `snapshot_date_key`, `lead_created_date_key`, `created_date_key`, `scheduled_date_key`, `show_date_key`, `month_date_key` (×3), `as_of_date_key` | Their facts and analytical tables | 11 |

Three reasons, each of which has produced a real defect in a real model:

* **A key on an axis is a meaningless integer.** `dealership_key = 2` is not a store name, and a chart with
  1, 2, 3 on the axis is a chart nobody can read.
* **A key used as a filter silently drops the blank row.** Filtering `customer_key` to a set excludes the
  wholesale and dealer-trade rows whose key is NULL, changing the population without changing anything the
  reader can see.
* **A key is the model's plumbing.** The relationship expresses the join. A second, hand-built join by
  dragging keys onto a table is a filter path the model does not know about.

**Two `pipeline_run_id` columns are visible**, on `vw_pipeline_run_summary` and `vw_data_quality_trend`, and
that is deliberate. They are not surrogate keys of a relationship — the four operational tables participate
in none — they are the business identifier a reader of the Data Quality page quotes when reporting a run.

---

## 3. Pre-filtered numerator columns — 28 hidden columns

The reporting layer publishes each ratio's numerator and denominator as separate **additive integer
columns**, already filtered to the population the KPI means. `retail_unit_count` is `1` on a retail row and
`0` otherwise, so no measure has to re-apply `is_retail`. That design is what keeps every relationship
single-direction, and it is why hiding these columns matters more than it looks.

| Table | Hidden numerators |
|---|---|
| `vw_vehicle_sales` (9) | `retail_unit_count`, `new_unit_count`, `used_unit_count`, `wholesale_unit_count`, `dealer_trade_unit_count`, `retail_front_end_gross`, `retail_back_end_gross`, `retail_total_gross`, `retail_days_in_inventory_total` |
| `vw_leads` (10) | `valid_lead_count`, `duplicate_lead_count`, `contacted_lead_count`, `appointment_set_lead_count`, `appointment_shown_lead_count`, `sold_lead_count`, `response_seconds_total`, `responded_lead_count`, `unresponded_lead_count`, `first_response_minutes` |
| `vw_appointments` (7) | `eligible_appointment_count`, `cancelled_in_advance_count`, `shown_appointment_count`, `shown_and_sold_appointment_count`, `confirmed_appointment_count`, `test_drive_count`, `write_up_count` |
| `vw_inventory_snapshots` (2) | `aged_unit_count`, `aged_inventory_investment` |

`vw_leads.first_response_minutes` is in that list for a second reason as well as the first: it restates
`first_response_seconds` in a different unit. Two units of one fact in one field list is one too many, and
the model converts to minutes at the measure boundary instead, so the additive numerator stays in its source
unit and cannot be summed in the wrong one.

`vw_marketing_spend`, `vw_inventory_turn`, `vw_days_supply` and `vw_marketing_performance` have no hidden
numerators. Their additive columns — `spend_amount`, `annualized_retail_units`,
`average_daily_active_inventory`, `active_inventory_units`, `attributed_leads` and the rest — are visible,
because at those tables' grains they are meaningful figures in their own right and a report author reading a
marketing table legitimately wants to see spend. What is hidden there is the *ratio* over them; see §4.

The failure this prevents is specific. Visible, `unit_count` and `retail_unit_count` sit next to each other
in the field list with plausible names and different meanings, and nothing stops a report author from
summing one when they meant the other. The resulting number is off by exactly the wholesale volume: too
small to look wrong, large enough to change a conclusion. The measure that owns each numerator is named,
documented and reconciled; the loose column is none of those things.

**`inventory_unit_count` and `days_in_stock` are visible**, and that is the deliberate exception.
`KPI-INV-004` is a median, so the row-level population it is computed over has to be inspectable, and
`inventory_unit_count` is the denominator a report author legitimately needs when building a condition-split
table by hand. The same reasoning keeps `retail_days_in_inventory` and `first_response_seconds` visible: they
are the median populations behind `KPI-INV-007` and `KPI-FUN-008`. Their *pre-summed* companions —
`retail_days_in_inventory_total`, `response_seconds_total` — are hidden, because those exist only to be
divided by a count.

---

## 4. Materialised ratio columns — 7 hidden columns

Five reporting views publish a ratio as a column, because a SQL or Excel consumer needs one governed answer
per KPI without a DAX engine. Where the model imports such a view, the ratio column is imported and hidden.

| Table | Hidden ratio | The measure that recomputes it |
|---|---|---|
| `vw_inventory_turn` | `inventory_turn` | Inventory Turn (`KPI-INV-008`) |
| `vw_days_supply` | `days_supply` | Dealer Days Supply (`KPI-INV-009`) |
| `vw_marketing_performance` | `cost_per_lead` | Cost per Lead (`KPI-MKT-001`) |
| `vw_marketing_performance` | `cost_per_sale` | Cost per Sale (`KPI-MKT-002`) |
| `vw_marketing_performance` | `gross_return_on_ad_spend` | Gross Return on Advertising Spend (`KPI-MKT-003`) |
| `vw_data_quality_trend` | `pass_rate` | Pass Rate |
| `vw_data_quality_trend` | `evaluation_coverage` | Evaluation Coverage |

**A materialised ratio is valid at its own view's grain and at no other.** `vw_inventory_turn.inventory_turn`
is correct for one store in one month. Summed across three stores it is nonsense; averaged across three
stores it is a different, unweighted statistic that happens to look reasonable. The measure divides the
summed numerator by the summed denominator, which is the only aggregation that stays correct as the filter
context widens.

Two versions of one number visible at once is how a report starts disagreeing with itself, and the
disagreement surfaces on the day someone puts both on the same table.

---

## 5. Sort-order helper columns — 8 hidden columns

Seven calculated `*_sort_order` columns, plus `vw_calendar.year_month_number`, which the reporting layer
already publishes. Each is set as the `sortByColumn` of the label it orders, and each is hidden because the
ordinal is machinery: the label is the thing to show.

| Table | Sort-order column | Orders |
|---|---|---|
| `vw_inventory_snapshots` | `age_bucket_sort_order` | `age_bucket` |
| `vw_leads` | `response_time_band_sort_order` | `response_time_band` |
| `vw_customer` | `age_band_sort_order` | `age_band` |
| `vw_employee` | `tenure_band_sort_order` | `tenure_band` |
| `vw_vehicle` | `odometer_band_sort_order` | `odometer_band` |
| `vw_data_quality_trend` | `severity_sort_order` | `severity` |
| `vw_data_quality_summary` | `severity_sort_order` | `severity` |
| `vw_calendar` | `year_month_number` | `year_month_label`, `month_year_label` |

The seven calculated ones are the only calculated columns in the model. Why they exist in the model rather
than in the reporting SQL — a view is a contract that SQL, Excel and reconciliation consumers already depend
on — is [01-table-inventory.md §6.1](01-table-inventory.md).

`vw_calendar`'s other ordered labels — `day_name`, `month_name`, `quarter_name` — sort by `iso_day_of_week`,
`month_number` and `quarter_number`, which are meaningful in their own right and are therefore **visible**. A
sort-by column is only hidden when it has no purpose beyond sorting.

---

## 6. Measure-table placeholders — 6 hidden columns

Each of the six measure tables carries one hidden string column named `Placeholder`, sourced from a
single-row calculated partition, `ROW("Placeholder", "")`.

A measure group needs a table to live on, and a table needs at least one column. That is the entire reason.
The column holds one empty string, imports nothing, and is never exposed to a report author. It is
documented here so that a reviewer meeting six identically named columns in the TMDL knows they are
structural rather than an accident of copy-paste.

---

## 7. What stays visible, and why

299 columns are visible. Four classes are worth stating explicitly, because each is a place where a "hide it
to be safe" instinct would do damage.

### 7.1 `source_system` — visible on every table that carries it

**Do not hide `source_system`.** It is on every fact and dimension, and its description says the same thing
each time: *"Originating system. Present so no reader mistakes this for real transaction data."*

ARPI's data is synthetic. Every VIN, customer, campaign and vendor name in it is generated. `source_system`
is the column that says so, at row level, inside the model, where a reader who exports a table to Excel will
still see it. Hiding it would remove the one field that prevents a screenshot of ARPI output from being read
as a real dealer group's performance — which is the single most consequential misreading this project can
produce, and the one hardest to correct after the fact.

That obligation is stated at project level in [PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md) and
[LIMITATIONS.md](../../LIMITATIONS.md); this column is where the model implements it.

### 7.2 Business identifiers

`dealership_code`, `customer_code`, `employee_label`, `synthetic_vin`, `campaign_name`,
`lead_source_name`, `model_label`, `pipeline_run_id` — the stable identifiers a person quotes. `GSA-001` is
what someone says out loud; `dealership_key = 2` is not. Every dimension keeps at least one visible label,
which is what makes hiding the key harmless.

### 7.3 Row-level median populations

`days_in_stock`, `retail_days_in_inventory` and `first_response_seconds` stay visible. Each is the population
an order statistic is computed over, and a median that cannot be interrogated is a median nobody should
trust. They are also the columns to filter on when the ARPI default thresholds do not suit — 60 days for aged
inventory, 30 days for days supply — which the measure descriptions explicitly direct a reader to do.

### 7.4 Descriptive attributes and vendor-reported figures

Everything else: dates, labels, bands, flags, prices, costs, and the vendor-reported marketing columns
(`impressions`, `clicks`, `vendor_reported_leads`, `attributed_revenue`). The vendor columns in particular
are visible on purpose. Vendor lead counts deliberately differ from `KPI-FUN-001`, and that gap is a finding
to report rather than a discrepancy to reconcile away; a hidden column cannot be compared to anything.

`attributed_revenue` is visible with a caveat that must travel with it: dealership revenue includes the cost
of the vehicle, so a revenue-based return is inflated by roughly an order of magnitude, and
[03-measure-groups.md §7](03-measure-groups.md) makes gross return the primary measure for that reason.

---

## 8. `summarizeBy: none` and `discourageImplicitMeasures`

Two settings that together change what a report author can do, and that are easy to miss in a diff.

**Every column in the model carries `summarizeBy: none`.** All 408 of them, including the integer numerators
and the currency columns. **The model carries `discourageImplicitMeasures` in `model.tmdl`.**

### 8.1 What that means for a report author

Dragging a numeric column onto a visual **produces no aggregation.** Not a sum, not a count — Power BI places
the column as a grouping field, and the visual shows one row per distinct value rather than a total.

That is the intended behaviour and it will feel like a broken model to anyone expecting Power BI's default.
It is not broken. **Every number in this report comes from a named measure**, and there are forty-nine of
them ([03-measure-groups.md](03-measure-groups.md)). If a number is wanted that no measure produces, the
answer is a new measure with a name, a description, a format string and a reconciliation — not an implicit
sum that appears on one visual, is named after a column, and agrees with nothing.

### 8.2 Why implicit measures are refused

An implicit measure is an aggregation with no definition. Three specific consequences make it unacceptable
here:

* **It bypasses semi-additivity.** `SUM(vw_inventory_snapshots[inventory_unit_count])` over a month returns
  unit-days — roughly thirty times the true inventory — and looks entirely plausible. The measure
  `Active Inventory Count` exists precisely to prevent that, and an implicit sum walks straight past it.
  This is the single most dangerous implicit aggregation available in this model.
* **It bypasses the blank-versus-zero rule.** An implicit average of a ratio column returns a number where
  the governed answer is `BLANK()`, so a month with no sales reports `$0` gross per unit instead of a gap.
* **It cannot be reconciled.** [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md) compares
  named measures against a SQL baseline. An implicit measure has no name to compare, so it is outside every
  check this project runs.

`discourageImplicitMeasures` is also a prerequisite for calculation groups, should one ever be added. None
is, and none is planned ([README.md §4](README.md)).

### 8.3 What this does not do

It does not prevent a report author from creating a report-level measure in Desktop, and nothing in the model
can. What it does is make the model's own measures the path of least resistance and make anything else a
deliberate act — which is the most a semantic model can honestly claim.

---

## 9. What has not been checked

**Power BI Desktop has never opened this model**, so no part of this policy has been observed in a field
list. Specifically unverified: that `summarizeBy: none` renders as described, that the sort-by columns order
their labels correctly, that no hidden column is unexpectedly required by a measure the engine resolves
differently, and that `discourageImplicitMeasures` behaves as documented in the installed Desktop version.
See [08-desktop-validation.md](08-desktop-validation.md).
