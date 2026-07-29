# Measure Groups — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

Every MVP KPI mapped to the measure group it belongs to, with the additive columns its measure reads and
the DAX shape it must take. The measure groups are the eleven named in
[ARCHITECTURE.md §19.3](../../ARCHITECTURE.md); five of them belong to Deferred domains and carry no MVP
measure yet, and are listed at the end so the gap is visible rather than absent.

> **No DAX exists yet.** `powerbi/measures/` is empty on purpose. This document specifies each measure;
> writing it is development work and waits for Gate 1 to open. The shapes below are the specification, not
> a transcript of code that exists.

---

## 1. The four shapes every measure takes

| Shape | When | Written as |
|---|---|---|
| **Additive** | The measure is a sum of one column | `SUM(Table[column])` |
| **Ratio** | The measure divides one additive column by another | `DIVIDE(SUM(Table[num]), SUM(Table[den]))` — `DIVIDE` and not `/`, so a zero denominator returns `BLANK()` |
| **Semi-additive** | The measure is a stock, not a flow | `CALCULATE(SUM(...), LASTNONBLANKVALUE(vw_calendar[calendar_date], ...))` or an explicit daily average, and the visual states which |
| **Order statistic** | The measure is a median or percentile | `MEDIAN(Table[row_level_column])` over the row-grain fact, never over an aggregate |

Two rules apply to every measure regardless of shape:

* **`DIVIDE`, always.** `KPI_CATALOG.md` requires `BLANK()` on a zero denominator for every ratio in the
  catalogue. `$0` gross per unit in a month with no sales is a false statement, and an infinite cost per
  lead is worse. `tests/integration/test_kpi_verification.py` asserts the SQL side of this rule on all
  twenty ratio columns; `DIVIDE` is how the DAX side matches it.
* **Numerator and denominator come from the same table.** Every one of them is already a column on the
  fact. That is what keeps every relationship in this model single-direction.

---

## 2. Sales measures

Source table: `vw_vehicle_sales`. Date basis: `sale_date_key` (active relationship).

| KPI | Measure | Shape | Reads | Notes |
|---|---|---|---|---|
| `KPI-SLS-001` | Retail Units Sold | Additive | `retail_unit_count` | Returns `0`, not `BLANK()`, in an empty context — "no cars sold" is a meaningful answer that must appear on a trend line. |
| `KPI-SLS-002` | New Units Sold | Additive | `new_unit_count` | Includes leases of new vehicles. Structurally `0` for the independent used store, which is correct rather than missing. |
| `KPI-SLS-003` | Used Units Sold | Additive | `used_unit_count` | Includes certified pre-owned and leases of used vehicles. |

**Identity to preserve:** `KPI-SLS-002 + KPI-SLS-003 = KPI-SLS-001` in every filter context. It holds
because the split is taken from the vehicle's condition, not from `sale_type` — a lease is a retail sale
type that `sale_type` alone leaves outside both halves. Reconciled per store-day by `RECON-UNITS-001`.

---

## 3. Gross measures

Source table: `vw_vehicle_sales`. Date basis: `sale_date_key`.

| KPI | Measure | Shape | Reads | Notes |
|---|---|---|---|---|
| `KPI-GRS-001` | Front-End Gross | Additive | `retail_front_end_gross` | Negative values are legitimate and must stay visible, distinguished by more than colour alone. |
| `KPI-GRS-002` | Back-End Gross | Additive | `retail_back_end_gross` | A cash deal with no products contributes `0`, not `BLANK()`. |
| `KPI-GRS-003` | Total Gross | Additive | `retail_total_gross` | Reconciled to the cent at row level by `RECON-GROSS-001`. |
| `KPI-GRS-004` | Front Gross per Retail Unit | Ratio | `retail_front_end_gross` ÷ `retail_unit_count` | |
| `KPI-GRS-005` | Back Gross per Retail Unit | Ratio | `retail_back_end_gross` ÷ `retail_unit_count` | The denominator includes cash deals, which cannot generate finance reserve. |
| `KPI-GRS-006` | Total Gross per Retail Unit | Ratio | `retail_total_gross` ÷ `retail_unit_count` | |

**Identity to preserve:** `KPI-GRS-006 = KPI-GRS-004 + KPI-GRS-005`, because all three share one
denominator column. A failure means the filter contexts have diverged.

**Modelling boundary to state on any new-vehicle gross visual:** manufacturer incentives, holdback and
floorplan credits are excluded from front gross, so ARPI new-vehicle front gross is systematically
understated relative to how a real store reports it. That is a boundary, not a finding.

---

## 4. Inventory measures

Source tables: `vw_inventory_snapshots` (stock and age), `vw_vehicle_sales` (days to sale),
`vw_inventory_turn` and `vw_days_supply` (the two cross-fact measures).

| KPI | Measure | Shape | Reads | Notes |
|---|---|---|---|---|
| `KPI-INV-001` | Active Inventory Count | **Semi-additive** | `inventory_unit_count` | `LASTNONBLANKVALUE` over the date, or an explicit average of daily values. A naive `SUM` over a month is wrong by roughly a factor of thirty and looks plausible. |
| `KPI-INV-002` | Inventory Investment | **Semi-additive** | `inventory_investment` | Same rule. Cost invested, not market value and not floor-plan exposure. |
| `KPI-INV-003` | Average Inventory Age | Ratio | `days_in_stock` ÷ `inventory_unit_count` | The wrong headline for a right-skewed distribution. Publish beside `KPI-INV-004`. |
| `KPI-INV-004` | Median Inventory Age | **Order statistic** | `MEDIAN(vw_inventory_snapshots[days_in_stock])` | The headline age figure. Must be recomputed from row level; the median of a group is not derivable from the medians of its subgroups. |
| `KPI-INV-005` | Aged Inventory Count | Additive | `aged_unit_count` | At the 60-day default. For any other threshold, filter `days_in_stock` instead. |
| `KPI-INV-006` | Aged Inventory Percentage | Ratio | `aged_unit_count` ÷ `inventory_unit_count` | Can improve for a bad reason: wholesaling aged units removes them from the numerator. |
| `KPI-INV-007` | Days to Sale | **Order statistic** + Ratio | `MEDIAN(vw_vehicle_sales[retail_days_in_inventory])`; mean = `retail_days_in_inventory_total` ÷ `retail_unit_count` | Publish both, labelled. A chart titled only "days to sale" is not acceptable. |
| `KPI-INV-008` | Inventory Turn | Ratio | `vw_inventory_turn[annualized_retail_units]` ÷ `[average_daily_active_inventory]` | Imported pre-computed: the numerator and denominator use two different date columns over one window, which is where a DAX measure silently drifts. |
| `KPI-INV-009` | Dealer Days Supply | Ratio | `vw_days_supply[active_inventory_units]` ÷ `[average_daily_retail_sales]` | Imported pre-computed for the same reason. `BLANK()` at a zero selling pace — never `∞`, never `9999`. |

**Every inventory visual must state its time-aggregation rule.** Semi-additivity is the single most common
way these measures are misreported.

**Every aged-inventory finding must state the threshold in the same sentence.** 60 days is an ARPI project
default from [ARCHITECTURE.md §18.2](../../ARCHITECTURE.md), not an industry benchmark. So is the 30-day
days-supply window.

---

## 5. Lead-funnel measures

Source tables: `vw_leads` (lead grain) and `vw_appointments` (appointment grain). Date bases differ; see
[02-relationship-plan.md §5.1](02-relationship-plan.md).

| KPI | Measure | Shape | Reads | Grain |
|---|---|---|---|---|
| `KPI-FUN-001` | Leads Received | Additive | `valid_lead_count` | Lead |
| `KPI-FUN-002` | Contact Rate | Ratio | `contacted_lead_count` ÷ `valid_lead_count` | Lead |
| `KPI-FUN-003` | Appointment-Set Rate | Ratio | `appointment_set_lead_count` ÷ `contacted_lead_count` | Lead |
| `KPI-FUN-004` | Show Rate | Ratio | `shown_appointment_count` ÷ `eligible_appointment_count` | **Appointment**, scheduled-date basis |
| `KPI-FUN-005` | Show-to-Sale Conversion | Ratio | `shown_and_sold_appointment_count` ÷ `shown_appointment_count` | **Appointment**, show-date basis via `USERELATIONSHIP` |
| `KPI-FUN-006` | Lead-to-Sale Conversion | Ratio | `sold_lead_count` ÷ `valid_lead_count` | Lead |
| `KPI-FUN-007` | Average Response Time | Ratio | `response_seconds_total` ÷ `responded_lead_count` ÷ 60 | Lead |
| `KPI-FUN-008` | Median Response Time | **Order statistic** | `MEDIAN(vw_leads[first_response_seconds])` ÷ 60 | Lead |

Four measures must never appear alone:

| Measure | Must be shown with | Because |
|---|---|---|
| `KPI-FUN-003` Appointment-set rate | `KPI-FUN-002` Contact rate | Its denominator is contacted leads. Alone, a store reaching 20% of its leads can look better than one reaching 70%. |
| `KPI-FUN-004` Show rate | Cancellation rate | The advance-cancellation exclusion is the manipulable part: reclassifying no-shows as cancellations flatters the rate. |
| `KPI-FUN-007` / `KPI-FUN-008` Response time | Leads without follow-up (`unresponded_lead_count`) | Both exclude never-responded leads, so a store that ignores half its leads can report an excellent response time. |
| `KPI-FUN-006` Lead-to-sale conversion | A cohort-maturity label | Leads are attributed to their creation date, so the most recent months always look worst. |

**Recommended primary visual for responsiveness:** the banded distribution (`response_time_band`: under 5
minutes, 5–15, 15–60, over 60), with the median as the summary card. ARPI publishes **no target response
time**, because it has no benchmark data.

---

## 6. Marketing measures

Source table: `vw_marketing_performance`, imported pre-computed at store × month × source × campaign.

| KPI | Measure | Shape | Reads | Notes |
|---|---|---|---|---|
| `KPI-MKT-001` | Cost per Lead | Ratio | `spend_amount` ÷ `attributed_leads` | `BLANK()` for organic and internal sources — undefined, not zero. `BLANK()` when spend produced no leads; report that as *spend with zero leads*. |
| `KPI-MKT-002` | Cost per Sale | Ratio | `spend_amount` ÷ `attributed_retail_units` | `BLANK()` when spend produced no attributed sale; report it as *spend with no attributed sales*. |
| `KPI-MKT-003` | Gross Return on Advertising Spend | Ratio | `attributed_total_gross` ÷ `spend_amount` | **The primary return measure.** `BLANK()` on zero spend, never `∞`. Format as a multiple (`3.4×`), never as a percentage. |

Three rules the marketing page must carry:

1. **Month is the finest valid grain**, and the model cannot express a finer one: every spend row's date key
   is a month start, so filtering the calendar to any other date selects no spend at all. That is
   structural, and asserted by `tests/integration/test_kpi_verification.py`.
2. **Gross return is primary; revenue return is not published as a headline.** Dealership revenue includes
   the cost of the vehicle, so a revenue-based ROAS is inflated by roughly an order of magnitude.
   `attributed_revenue` is available for that comparison only, and must be labelled with the reason.
3. **Attribution is single-source and first-touch.** A customer who arrived through three channels is
   credited to one. Multi-touch attribution is out of scope, and any campaign comparison must say so.

---

## 7. Executive measures

The Executive Overview page reuses measures rather than defining new ones. The group is a curated selection,
which is what makes it a group.

| Card | Measure | From |
|---|---|---|
| Retail units | `KPI-SLS-001` | Sales |
| Total gross | `KPI-GRS-003` | Gross |
| Total gross per retail unit | `KPI-GRS-006` | Gross |
| Active inventory | `KPI-INV-001` | Inventory |
| Aged inventory percentage | `KPI-INV-006` | Inventory |
| Inventory investment in aged units | `aged_inventory_investment` | Inventory |
| Lead-to-sale conversion | `KPI-FUN-006` | Lead funnel |
| Gross return on advertising spend | `KPI-MKT-003` | Marketing |

**Target attainment is absent from this page** and must stay absent: `warehouse.fact_sales_target` is
Deferred, so there is nothing to attain against. [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) lists target
attainment as an Executive Overview component; that component is Deferred with the fact it depends on.

---

## 8. Data-quality measures

Source tables: `vw_data_quality_trend`, `vw_reconciliation_status`, `vw_pipeline_run_summary`.

| Measure | Shape | Reads | Notes |
|---|---|---|---|
| Checks Passed | Additive | `checks_passed` | |
| Checks Failed | Additive | `checks_failed` | |
| Checks Skipped | Additive | `checks_skipped` | **A skipped check is not a passing check.** Almost always means the target held no rows. |
| Pass Rate | Ratio | `checks_passed` ÷ `checks_evaluated` | Divides by *evaluated* checks, not recorded ones. |
| Evaluation Coverage | Ratio | `checks_evaluated` ÷ `checks_recorded` | Must be shown beside Pass Rate: a high pass rate at low coverage proves very little. |
| Critical Reconciliations Failing | Additive | `count` of `vw_reconciliation_status` where `is_critical` and not `is_passing` | The number an executive page should surface if it is ever non-zero. |
| Reconciliation Difference | Additive | `absolute_difference` | Sort descending to surface the worst offenders. |

---

## 9. Measure groups with no MVP measure

Listed so the gap is visible rather than absent. Each is blocked by a Deferred fact, and none may be created
as an empty group in the model.

| Group | Blocked by | Unlock |
|---|---|---|
| F&I measures | `warehouse.fact_finance_product_sale` (Deferred) | Product penetration and products per retail unit become computable. Until then `KPI-GRS-002` is a single generated number with no product detail behind it, and no narrative about product mix is supportable. |
| Customer-retention measures | Full purchase history across a longer window | Repeat-customer rate. |
| Service-to-sales measures | `warehouse.fact_service_visit` (Deferred) | Service-to-sales conversion, which must be presented as decision support and never as a guarantee of purchase intent. |
| Target-attainment measures | `warehouse.fact_sales_target` (Deferred) | Target attainment. Target values would be fictional operating goals for a fictional group, never industry benchmarks. |

---

## 10. KPI to measure group, in one table

| KPI | Group | Also surfaced on |
|---|---|---|
| `KPI-SLS-001` | Sales | Executive |
| `KPI-SLS-002` | Sales | |
| `KPI-SLS-003` | Sales | |
| `KPI-GRS-001` | Gross | |
| `KPI-GRS-002` | Gross | F&I, when unlocked |
| `KPI-GRS-003` | Gross | Executive |
| `KPI-GRS-004` | Gross | |
| `KPI-GRS-005` | Gross | F&I, when unlocked |
| `KPI-GRS-006` | Gross | Executive |
| `KPI-INV-001` | Inventory | Executive |
| `KPI-INV-002` | Inventory | Executive |
| `KPI-INV-003` | Inventory | |
| `KPI-INV-004` | Inventory | |
| `KPI-INV-005` | Inventory | Executive |
| `KPI-INV-006` | Inventory | Executive |
| `KPI-INV-007` | Inventory | |
| `KPI-INV-008` | Inventory | |
| `KPI-INV-009` | Inventory | |
| `KPI-FUN-001` | Lead funnel | |
| `KPI-FUN-002` | Lead funnel | |
| `KPI-FUN-003` | Lead funnel | |
| `KPI-FUN-004` | Lead funnel | |
| `KPI-FUN-005` | Lead funnel | Executive |
| `KPI-FUN-006` | Lead funnel | Executive, Marketing |
| `KPI-FUN-007` | Lead funnel | |
| `KPI-FUN-008` | Lead funnel | |
| `KPI-MKT-001` | Marketing | |
| `KPI-MKT-002` | Marketing | |
| `KPI-MKT-003` | Marketing | Executive |
