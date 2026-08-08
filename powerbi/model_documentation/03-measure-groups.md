# Measure Groups — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

Every measure in the model as built, with the group it belongs to, its KPI identifier or the KPI it supports,
its display folder, its format string, its source table, its date basis, and the DAX shape actually used.

**Forty-nine measures: twenty-nine governed MVP KPI measures and twenty supporting measures.** They live on
six measure tables and nowhere else — no measure is defined on a source table. The measure groups are the
eleven named in [ARCHITECTURE.md §19.3](../../ARCHITECTURE.md): six are implemented as tables, one is
implemented as a curation register (§7), and four exist only as documented gaps (§9).

The DAX quoted here is the DAX in the TMDL, not a specification of what should be written. **None of it has
been evaluated.** Power BI Desktop has never opened this model, so every measure below is text that has never
returned a number. See [08-desktop-validation.md](08-desktop-validation.md) and
[09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md).

---

## 1. Structure, as built

| Measure table | TMDL file | Measures | KPI | Supporting | Group annotation |
|---|---|---:|---:|---:|---|
| `Sales Measures` | `tables/Sales Measures.tmdl` | 3 | 3 | 0 | `ARPI_MeasureGroup = Sales` |
| `Gross Measures` | `tables/Gross Measures.tmdl` | 6 | 6 | 0 | `ARPI_MeasureGroup = Gross` |
| `Inventory Measures` | `tables/Inventory Measures.tmdl` | 11 | 9 | 2 | `ARPI_MeasureGroup = Inventory` |
| `Lead Funnel Measures` | `tables/Lead Funnel Measures.tmdl` | 15 | 8 | 7 | `ARPI_MeasureGroup = Lead Funnel` |
| `Marketing Measures` | `tables/Marketing Measures.tmdl` | 3 | 3 | 0 | `ARPI_MeasureGroup = Marketing` |
| `Data Quality Measures` | `tables/Data Quality Measures.tmdl` | 11 | 0 | 11 | `ARPI_MeasureGroup = Data Quality` |
| **Total** | | **49** | **29** | **20** | |

Each measure table is a **single-row calculated table** — `partition ... = calculated`, `mode: import`,
`source = ROW("Placeholder", "")` — carrying one hidden `Placeholder` string column. A measure needs a table
to live on and a table needs a column; the placeholder exists for that reason only and is never exposed to a
report author. It holds no data and imports nothing from the database.

Every measure carries annotations that make its provenance queryable rather than merely readable:

| Annotation | On | Meaning |
|---|---|---|
| `ARPI_KpiId` | 29 measures | The governed KPI identifier from [KPI_CATALOG.md](../../KPI_CATALOG.md). |
| `ARPI_MeasureRole` | all 49 | `KPI` (29) or `Supporting` (20). |
| `ARPI_SupportsKpiId` | 9 supporting measures | The KPI this measure must be published beside. |
| `ARPI_SourceTable` | all 49 | The single table the measure reads. Every measure reads exactly one. |
| `ARPI_DateBasis` | 38 measures | The date column the measure is anchored on. Absent on the eleven data-quality measures, which are disconnected from the calendar. |
| `ARPI_TimeAggregation` | 8 measures | `SemiAdditiveLastDate`. See §4.1. |
| `ARPI_ValidGrain` | 4 measures | `MonthOrCoarser`. See §4.2 and §6. |
| `ARPI_UsesRelationship` | 1 measure | The inactive relationship the measure activates. See §5.1. |
| `ARPI_ExecutiveCard` | 11 measures | The Executive curation register. See §7. |

---

## 2. The five shapes every measure takes

| Shape | Count | Written as | Why |
|---|---:|---|---|
| **Additive** | 18 | `SUM(Table[column])`, usually `+ 0` | A count or a total of a pre-filtered numerator column. |
| **Ratio** | 21 | `DIVIDE(SUM(Table[num]), SUM(Table[den]))` | `DIVIDE` and not `/`, so a zero denominator returns `BLANK()`. |
| **Semi-additive** | 8 | `LASTNONBLANKVALUE(vw_calendar[calendar_date], <inner>)` in seven; `CALCULATE(<inner>, LASTNONBLANK(vw_calendar[calendar_date], COUNTROWS(...)))` in one | A stock, not a flow. Never summed across dates. The one exception is explained in §5.1. |
| **Order statistic** | 3 | `MEDIAN(Table[row_level_column])` | Recomputed from row level; the median of a group is not derivable from the medians of its subgroups. |
| **Filtered scalar** | 4 | `CALCULATE(...)` with a column predicate | The four data-quality measures that pick one run or one condition. |

The counts overlap and do not sum to forty-nine, because the semi-additive wrapper composes with whatever it
wraps: five of the eight wrap a sum or a median and appear only in the semi-additive row, while Average
Inventory Age, Aged Inventory Percentage and Dealer Days Supply wrap a `DIVIDE` and are counted as ratios
too. Median Response Time is likewise both an order statistic and a ratio. The distinct total is forty-nine.

Three rules apply regardless of shape.

* **`DIVIDE`, always.** [KPI_CATALOG.md](../../KPI_CATALOG.md) requires `BLANK()` on a zero denominator for
  every ratio in the catalogue. `$0` gross per unit in a month with no sales is a false statement, and an
  infinite cost per lead is worse. There are twenty-one `DIVIDE` calls in the model and no bare `/` used as
  a ratio. Two `/` operators do appear — `... / 60` in Average Response Time and Pipeline Duration — and both
  are unit conversions by a literal, not divisions by data.
* **`+ 0` where zero is a meaningful answer.** Fifteen measures end `+ 0`, which turns an empty
  filter context from `BLANK()` into `0`. "No cars sold" and "no leads received" are facts that belong on a
  trend line; a gap there would read as missing data. Ratios do the opposite, deliberately: an *undefined*
  rate must be a gap.
* **One table per measure.** Every measure reads columns from exactly one table, named in its
  `ARPI_SourceTable` annotation. That is what keeps all forty-two relationships single-direction. Measures
  that reference other *measures* — the three per-unit gross measures and Days to Sale (Mean) — still read
  columns from one table only.

---

## 3. Sales measures

Source table `vw_vehicle_sales`. Date basis `sale_date_key`, the active calendar relationship. Three
measures, all KPI, all in display folder `Volume`, all formatted `#,0`.

| KPI | Measure | Shape | DAX as built | Notes |
|---|---|---|---|---|
| `KPI-SLS-001` | Retail Units Sold | Additive | `SUM ( 'vw_vehicle_sales'[retail_unit_count] ) + 0` | Retail and lease deliveries. Wholesale disposals and dealer trades are never counted. The denominator of every per-retail-unit gross measure. **Executive card.** |
| `KPI-SLS-002` | New Units Sold | Additive | `SUM ( 'vw_vehicle_sales'[new_unit_count] ) + 0` | The split is taken from the vehicle's condition, not from `sale_type` — a lease is a retail sale type that `sale_type` alone would strand outside both halves. Structurally `0` for the independent used store, which is correct rather than missing. |
| `KPI-SLS-003` | Used Units Sold | Additive | `SUM ( 'vw_vehicle_sales'[used_unit_count] ) + 0` | A certified unit is a **used** unit. |

**Identity to preserve:** `New Units Sold + Used Units Sold = Retail Units Sold` in every filter context. It
holds because all three read pre-filtered numerator columns on the same rows of the same table. Reconciled
per store-day by `RECON-UNITS-001`, and re-tested under filter context by
[09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md).

---

## 4. Gross measures

Source table `vw_vehicle_sales`. Date basis `sale_date_key`. Six measures, all KPI, all formatted
`$#,0;($#,0);-`.

| KPI | Measure | Folder | Shape | DAX as built |
|---|---|---|---|---|
| `KPI-GRS-001` | Front-End Gross | Totals | Additive | `SUM ( 'vw_vehicle_sales'[retail_front_end_gross] )` |
| `KPI-GRS-002` | Back-End Gross | Totals | Additive | `SUM ( 'vw_vehicle_sales'[retail_back_end_gross] )` |
| `KPI-GRS-003` | Total Gross | Totals | Additive | `SUM ( 'vw_vehicle_sales'[retail_total_gross] )` — **Executive card** |
| `KPI-GRS-004` | Front Gross per Retail Unit | Per retail unit | Ratio | `DIVIDE ( [Front-End Gross], [Retail Units Sold] )` |
| `KPI-GRS-005` | Back Gross per Retail Unit | Per retail unit | Ratio | `DIVIDE ( [Back-End Gross], [Retail Units Sold] )` |
| `KPI-GRS-006` | Total Gross per Retail Unit | Per retail unit | Ratio | `DIVIDE ( [Total Gross], [Retail Units Sold] )` — **Executive card** |

The three totals do **not** carry `+ 0`. A gross figure of `$0` in a period with no deliveries would be a
statement about profit; the blank is the honest rendering. The three per-unit measures are `BLANK()` when no
retail unit was delivered, for the same reason.

**Identity to preserve:** `Total Gross per Retail Unit = Front Gross per Retail Unit + Back Gross per Retail
Unit`, exactly, in every filter context, because all three divide by the same measure. A divergence means the
filter contexts have come apart, and it is the cheapest available signal that something is wrong.

**Modelling boundary to state on any new-vehicle gross visual:** manufacturer incentives, holdback and
floorplan credits are excluded from front gross, so ARPI new-vehicle front gross is systematically
understated relative to how a real store reports it. That boundary is written into the descriptions on
`Front-End Gross` and on the `Gross Measures` table itself, so it travels with the field rather than living
only here.

**Negative values are legitimate and must stay visible.** The format string renders a negative as `($1,234)`
in parentheses, which is a signal independent of colour; see [06-format-strings.md](06-format-strings.md).

---

## 5. Inventory measures

Eleven measures — nine KPI and two supporting — across four source tables.

| KPI / role | Measure | Folder | Source table | Date basis | Format | Shape |
|---|---|---|---|---|---|---|
| `KPI-INV-001` | Active Inventory Count | Stock | `vw_inventory_snapshots` | `snapshot_date_key` | `#,0` | **Semi-additive** sum |
| `KPI-INV-002` | Inventory Investment | Stock | `vw_inventory_snapshots` | `snapshot_date_key` | `$#,0;($#,0);-` | **Semi-additive** sum |
| `KPI-INV-003` | Average Inventory Age | Age | `vw_inventory_snapshots` | `snapshot_date_key` | `0.0 "days"` | **Semi-additive** ratio |
| `KPI-INV-004` | Median Inventory Age | Age | `vw_inventory_snapshots` | `snapshot_date_key` | `0 "days"` | **Semi-additive** median |
| `KPI-INV-005` | Aged Inventory Count | Age | `vw_inventory_snapshots` | `snapshot_date_key` | `#,0` | **Semi-additive** sum |
| `KPI-INV-006` | Aged Inventory Percentage | Age | `vw_inventory_snapshots` | `snapshot_date_key` | `0.0%` | **Semi-additive** ratio |
| Supporting → `KPI-INV-005` | Aged Inventory Investment | Age | `vw_inventory_snapshots` | `snapshot_date_key` | `$#,0;($#,0);-` | **Semi-additive** sum |
| `KPI-INV-007` | Days to Sale (Median) | Velocity | `vw_vehicle_sales` | `sale_date_key` | `0 "days"` | Order statistic |
| Supporting → `KPI-INV-007` | Days to Sale (Mean) | Velocity | `vw_vehicle_sales` | `sale_date_key` | `0.0 "days"` | Ratio |
| `KPI-INV-008` | Inventory Turn | Velocity | `vw_inventory_turn` | `month_date_key` | `0.00` | Ratio |
| `KPI-INV-009` | Dealer Days Supply | Velocity | `vw_days_supply` | `as_of_date_key` | `0 "days"` | **Semi-additive** ratio, anchored with `LASTNONBLANK` |

### 5.1 Semi-additivity, stated as a rule and implemented as one

`vw_inventory_snapshots` holds one row per vehicle per store per **day**. Inventory count, inventory
investment, aged count and every ratio over them are **stocks, not flows**: additive across store, model and
vehicle, and **not additive across dates**. A plain `SUM` over a month is wrong by roughly a factor of thirty
and looks entirely plausible — 45,754 unit-days reported as 45,754 cars in stock.

**Eight measures are therefore anchored on the last date in the current filter context**, rather than summed
across dates. Selecting a month returns the **closing position** of that month, not the sum of its daily
positions. Each of the eight carries `annotation ARPI_TimeAggregation = SemiAdditiveLastDate`, so the set is
queryable rather than a matter of reading DAX.

Seven of the eight use `LASTNONBLANKVALUE`:

```dax
Active Inventory Count =
LASTNONBLANKVALUE (
    'vw_calendar'[calendar_date],
    SUM ( 'vw_inventory_snapshots'[inventory_unit_count] )
)
```

The seven: Active Inventory Count, Inventory Investment, Average Inventory Age, Median Inventory Age, Aged
Inventory Count, Aged Inventory Percentage and Aged Inventory Investment.

**The eighth, Dealer Days Supply, uses `LASTNONBLANK` over `COUNTROWS` instead**, and the difference is real
rather than stylistic:

```dax
Dealer Days Supply =
CALCULATE (
    DIVIDE (
        SUM ( 'vw_days_supply'[active_inventory_units] ),
        SUM ( 'vw_days_supply'[average_daily_retail_sales] )
    ),
    LASTNONBLANK ( 'vw_calendar'[calendar_date], COUNTROWS ( 'vw_days_supply' ) )
)
```

`LASTNONBLANKVALUE` anchors on the last date at which the **expression** is non-blank. For the other seven
that is identical to "the last date that has a row", because their inner expression is a sum or a median
that is non-blank whenever a row exists. **For days supply the two are not the same.** The ratio is
legitimately blank on a day whose trailing 30-day window contains no retail sale — a zero selling pace, which
is a real operational state and not missing data. `LASTNONBLANKVALUE` would treat that blank as "no answer
here yet" and walk backwards to an earlier day, presenting a **stale days supply as if it were current**, on
exactly the days when the number matters most.

`LASTNONBLANK ( 'vw_calendar'[calendar_date], COUNTROWS ( 'vw_days_supply' ) )` anchors on the last date that
**has a row**, and lets the ratio be blank there if that is the truth. A blank is the honest answer on a day
with no trailing sales; a plausible number carried over from last week is not.

This is the kind of distinction that costs nothing to get right at authoring time and is close to
undetectable once it is wrong, because the wrong version produces a reasonable-looking number on every row.

Two consequences a report author has to know. **Closing position, not average position** — a store that ran
at 300 units all month and sold down to 250 on the 31st reports 250. And **every inventory visual must still
state its time-aggregation rule in words**, because "300" and "250" are both defensible answers to "how much
inventory did we have in October" and the visual is what says which one it gave.

`Days to Sale (Median)` and `Days to Sale (Mean)` are **not** semi-additive: days-to-sale is a property of a
completed transaction, which is a flow. Additive date behaviour is correct there.

### 5.2 The two medians and the mean beside one of them

```dax
Median Inventory Age =
LASTNONBLANKVALUE (
    'vw_calendar'[calendar_date],
    MEDIAN ( 'vw_inventory_snapshots'[days_in_stock] )
)

Days to Sale (Median) = MEDIAN ( 'vw_vehicle_sales'[retail_days_in_inventory] )
```

Both compute `MEDIAN` over a **row-level column**, never over a pre-aggregated value, because the median of a
group is not derivable from the medians of its subgroups. That is why
[01-table-inventory.md](01-table-inventory.md) keeps `days_in_stock` and `retail_days_in_inventory` visible
at row level, and why the pre-aggregated `vw_inventory_health` and `vw_days_to_sale` views are not imported.

`retail_days_in_inventory` is NULL on non-retail rows, so wholesale and dealer-trade rows are **excluded from
the order statistic** rather than pulling it towards zero. `MEDIAN` ignores blanks; that is the mechanism, and
it is why the column is nullable rather than zero-filled in the reporting layer.

`Days to Sale (Mean)` exists as a separate, separately-named supporting measure —
`DIVIDE(SUM(vw_vehicle_sales[retail_days_in_inventory_total]), [Retail Units Sold])` — because
[KPI_CATALOG.md](../../KPI_CATALOG.md) requires the median as the headline and the mean as an available
companion. They are named `(Median)` and `(Mean)` so the two can never be confused in a field list. **Never
publish a chart titled only "days to sale."**

`Average Inventory Age` is the mean companion to `Median Inventory Age` and is the wrong headline for a
right-skewed distribution. It must be published beside the median, never instead of it.

### 5.3 The two measures read from governed analytical tables

```dax
Inventory Turn =
DIVIDE (
    SUM ( 'vw_inventory_turn'[annualized_retail_units] ),
    SUM ( 'vw_inventory_turn'[average_daily_active_inventory] )
)
```

`KPI-INV-008`'s numerator is driven by `sale_date_key` and its denominator by `snapshot_date_key` — two
different columns on two different facts over one window. That is exactly where a hand-written DAX measure
silently drifts, because nothing forces both sides to use the same window. It is computed once in SQL and
reconciled on every run. **Valid at month grain or coarser** (`ARPI_ValidGrain = MonthOrCoarser`): the view
carries no finer key. Across several months the measure returns a volume-weighted blend of the monthly
figures rather than a single recomputation over the whole span, and an ARPI turn figure is not comparable to
one from another system unless that system uses the same method.

`Dealer Days Supply` reads `vw_days_supply` for the same reason and is additionally semi-additive, because
its numerator is a stock — anchored with `LASTNONBLANK` rather than `LASTNONBLANKVALUE`, for the reason in
§5.1. It is `BLANK()` at a zero selling pace — never infinity, never a large sentinel value, and never a
figure carried forward from an earlier date. The 30-day trailing window is an ARPI project default from
[ARCHITECTURE.md §18.2](../../ARCHITECTURE.md), it is **not** an industry benchmark, it is extremely
sensitive to seasonality, and it must be stated on any visual that shows the measure.

**Every aged-inventory finding must state the threshold in the same sentence.** 60 days is an ARPI project
default from the same section. For any other threshold, filter `days_in_stock` rather than using
`Aged Inventory Count`. `Aged Inventory Percentage` can also improve for a bad reason: wholesaling aged units
removes them from the numerator without a single retail sale, so read it beside wholesale volume.

---

## 6. Lead-funnel measures

Fifteen measures — eight KPI and seven supporting — across two source tables at two grains with two date
bases. That combination is the subtlety most likely to be got wrong in this model.

`vw_leads` is at **lead** grain and anchors on `lead_created_date_key`: a lead counts in the period it
*arrived*, whatever happened later. `vw_appointments` is at **appointment** grain — one lead can produce
several appointments — and its active date role is `scheduled_date_key`. Show-to-Sale Conversion is the one
exception and is evaluated on the show date.

| KPI / role | Measure | Folder | Source | Date basis | Format | DAX as built |
|---|---|---|---|---|---|---|
| `KPI-FUN-001` | Leads Received | Volume | `vw_leads` | `lead_created_date_key` | `#,0` | `SUM ( 'vw_leads'[valid_lead_count] ) + 0` |
| `KPI-FUN-002` | Contact Rate | Conversion | `vw_leads` | `lead_created_date_key` | `0.0%` | `DIVIDE ( SUM([contacted_lead_count]), SUM([valid_lead_count]) )` |
| `KPI-FUN-003` | Appointment-Set Rate | Conversion | `vw_leads` | `lead_created_date_key` | `0.0%` | `DIVIDE ( SUM([appointment_set_lead_count]), SUM([contacted_lead_count]) )` |
| `KPI-FUN-004` | Show Rate | Appointments | `vw_appointments` | `scheduled_date_key` | `0.0%` | `DIVIDE ( SUM([shown_appointment_count]), SUM([eligible_appointment_count]) )` |
| `KPI-FUN-005` | Show-to-Sale Conversion | Appointments | `vw_appointments` | `show_date_key` | `0.0%` | `CALCULATE ( DIVIDE(...), USERELATIONSHIP(...) )` — see §6.1. **Executive card.** |
| `KPI-FUN-006` | Lead-to-Sale Conversion | Conversion | `vw_leads` | `lead_created_date_key` | `0.0%` | `DIVIDE ( SUM([sold_lead_count]), SUM([valid_lead_count]) )` — **Executive card** |
| `KPI-FUN-007` | Average Response Time | Responsiveness | `vw_leads` | `lead_created_date_key` | `0.0 "min"` | `DIVIDE ( SUM([response_seconds_total]), SUM([responded_lead_count]) ) / 60` |
| `KPI-FUN-008` | Median Response Time | Responsiveness | `vw_leads` | `lead_created_date_key` | `0.0 "min"` | `DIVIDE ( MEDIAN('vw_leads'[first_response_seconds]), 60 )` |
| Supporting → `KPI-FUN-007` | Unresponded Leads | Responsiveness | `vw_leads` | `lead_created_date_key` | `#,0` | `SUM ( [unresponded_lead_count] ) + 0` |
| Supporting → `KPI-FUN-001` | Duplicate Leads | Volume | `vw_leads` | `lead_created_date_key` | `#,0` | `SUM ( [duplicate_lead_count] ) + 0` |
| Supporting → `KPI-FUN-006` | Sold Leads | Conversion | `vw_leads` | `lead_created_date_key` | `#,0` | `SUM ( [sold_lead_count] ) + 0` |
| Supporting → `KPI-FUN-004` | Eligible Appointments | Appointments | `vw_appointments` | `scheduled_date_key` | `#,0` | `SUM ( [eligible_appointment_count] ) + 0` |
| Supporting → `KPI-FUN-004` | Shown Appointments | Appointments | `vw_appointments` | `scheduled_date_key` | `#,0` | `SUM ( [shown_appointment_count] ) + 0` |
| Supporting → `KPI-FUN-004` | Advance Cancellations | Appointments | `vw_appointments` | `scheduled_date_key` | `#,0` | `SUM ( [cancelled_in_advance_count] ) + 0` |
| Supporting → `KPI-FUN-004` | Cancellation Rate | Appointments | `vw_appointments` | `scheduled_date_key` | `0.0%` | `DIVIDE ( SUM([cancelled_in_advance_count]), SUM([appointment_count]) )` |

### 6.1 The one `USERELATIONSHIP` in the model

```dax
Show-to-Sale Conversion =
CALCULATE (
    DIVIDE (
        SUM ( 'vw_appointments'[shown_and_sold_appointment_count] ),
        SUM ( 'vw_appointments'[shown_appointment_count] )
    ),
    USERELATIONSHIP ( 'vw_calendar'[date_key], 'vw_appointments'[show_date_key] )
)
```

`USERELATIONSHIP` switches the calendar from `scheduled_date_key` onto `show_date_key` for the duration of
this evaluation, so the visit and its outcome fall in the same period. Evaluated on the scheduled date, the
numerator and denominator would sit in different months whenever an appointment was booked in one month and
kept in the next, and the resulting percentage would be arithmetic rather than meaning.

The measure carries `annotation ARPI_UsesRelationship = cal_to_appointments_show_date`, so the dependency is
discoverable without reading DAX. **Any visual using it must be labelled show-date-based.** It is also why
`Shown Appointments` — the scheduled-basis count — can legitimately differ from this measure's denominator
for the same month, which looks like a bug and is not.

### 6.2 Four measures that must never be published alone

The supporting measures exist for this reason. Each is the control on a KPI whose definition excludes a
population, and publishing the KPI without it is how a genuinely bad number is made to look good.

| Measure | Must be shown with | Because |
|---|---|---|
| `KPI-FUN-003` Appointment-Set Rate | `KPI-FUN-002` Contact Rate | Its denominator is **contacted** leads, not all leads. Alone, a store that reaches 20 per cent of its leads can look better than one that reaches 70 per cent. |
| `KPI-FUN-004` Show Rate | Cancellation Rate | Advance cancellations are excluded from the denominator, which is the manipulable part: reclassifying no-shows as cancellations flatters the rate. Cancellation Rate divides by **all** appointments scheduled, cancellations included, so it is the control on that exclusion. |
| `KPI-FUN-007` / `KPI-FUN-008` Response time | Unresponded Leads | Both **exclude leads that were never responded to** — the mean by its denominator, the median because `first_response_seconds` is NULL there. A store that ignores half its leads can report an excellent response time. |
| `KPI-FUN-006` Lead-to-Sale Conversion | A cohort-maturity label | Leads are attributed to their **creation** date, so the most recent months always look worst: their leads have had less time to convert. |

`Duplicate Leads` serves the same purpose for `KPI-FUN-001`: the duplicate exclusion is a governed column
rather than a hidden filter, so the excluded population stays countable rather than merely asserted.

**Recommended primary visual for responsiveness:** the banded distribution over `response_time_band` — under
5 minutes, 5–15, 15–60, over 60, ordered by the hidden sort column described in
[01-table-inventory.md §6](01-table-inventory.md) — with `Median Response Time` as the summary card. ARPI
publishes **no target response time**, because it holds no benchmark data.

Both response-time measures convert seconds to minutes **at the final measure boundary only**, so the
additive numerator stays in its source unit and cannot be summed in the wrong one.

---

## 7. Marketing measures

Source table `vw_marketing_performance`, imported pre-computed at store × month × lead source × campaign,
because the spend-to-outcome join is a full outer join rather than a relationship. Three measures, all KPI,
all `ARPI_ValidGrain = MonthOrCoarser`.

| KPI | Measure | Folder | Format | DAX as built |
|---|---|---|---|---|
| `KPI-MKT-001` | Cost per Lead | Cost | `$#,0;($#,0);-` | `IF ( ISBLANK ( Spend ), BLANK(), DIVIDE ( Spend, AttributedLeads ) )` |
| `KPI-MKT-002` | Cost per Sale | Cost | `$#,0;($#,0);-` | `IF ( ISBLANK ( Spend ), BLANK(), DIVIDE ( Spend, AttributedUnits ) )` |
| `KPI-MKT-003` | Gross Return on Advertising Spend | Return | `0.0"x"` | `IF ( ISBLANK ( Spend ), BLANK(), DIVIDE ( AttributedGross, Spend ) )` — **Executive card** |

### 7.1 The `ISBLANK` guard, and why `DIVIDE` alone is not enough

```dax
Cost per Lead =
VAR Spend = SUM ( 'vw_marketing_performance'[spend_amount] )
VAR AttributedLeads = SUM ( 'vw_marketing_performance'[attributed_leads] )
RETURN
    IF ( ISBLANK ( Spend ), BLANK (), DIVIDE ( Spend, AttributedLeads ) )
```

These are the only three measures in the model that test something before dividing, and the reason is
specific. **Organic, walk-in and internal lead sources have no spend row at all**, so `spend_amount` is NULL
for them. `DIVIDE` protects against a zero *denominator*; it does nothing about a blank *numerator*, which it
coerces to `0`. Without the guard, `Cost per Lead` for organic traffic would render as `$0` — a confident,
plausible, false statement that a channel with no cost basis costs nothing, sitting on the same visual as
paid channels that cost real money and inviting exactly the wrong conclusion.

With the guard the answer is `BLANK()`: **undefined, not zero.** `vw_lead_source.is_cost_attributable`
carries the same rule on the SQL side, and the two agree by construction rather than by coincidence.

Two other blank cases are deliberate and must be **reported rather than hidden**: spend that produced no
attributed leads, and spend that produced no attributed sales. Both are findings — money spent with nothing
to show — and `vw_marketing_performance` publishes `spend_with_no_attributed_leads` and
`spend_with_no_attributed_sales` so the case is countable.

### 7.2 Three rules the marketing page must carry

1. **Month is the finest valid grain, and the model cannot express a finer one.** Every spend row's date key
   is a month start, so filtering the calendar to any other date selects no spend at all. That is
   structural, not a convention, and it is asserted on the SQL side by
   `tests/integration/test_kpi_verification.py`.
2. **Gross return is the primary return measure; a revenue-based return is not published as a headline.**
   Dealership revenue includes the cost of the vehicle, so a revenue-based ROAS is inflated by roughly an
   order of magnitude. `attributed_revenue` is imported and visible for that comparison only, and must be
   labelled with the reason wherever it is used.
3. **Attribution is single-source and first-touch.** A customer who arrived through three channels is
   credited to one. Multi-touch attribution is out of scope, and any campaign comparison must say so.

---

## 8. The Executive curation register

The Executive Overview page **reuses** measures rather than defining new ones, and **there is no
`Executive Measures` table in the model.** Creating one would have required either duplicating measures under
new names — vanity measures, which two names for one number make a report disagree with itself — or shipping
an empty table, which a reviewer reads as unfinished work. Neither is acceptable, so the Executive group is
implemented as a **governed curation register**: an `ARPI_ExecutiveCard = true` annotation on the measures
that belong to it, plus this section.

### 8.1 A contradiction in this document, and how it was resolved

This document contradicted itself, and the implementation had to choose.

* **§7 as written** listed **eight** Executive cards: `KPI-SLS-001`, `KPI-GRS-003`, `KPI-GRS-006`,
  `KPI-INV-001`, `KPI-INV-006`, `aged_inventory_investment`, `KPI-FUN-006` and `KPI-MKT-003`.
* **§10 as written** marked **ten KPIs** as "also surfaced on Executive" — the same list minus the aged
  investment measure, plus `KPI-INV-002`, `KPI-INV-005` and `KPI-FUN-005`.

The two lists are not the same list, and no reading reconciles them. The resolution built into the model is
the **union**: eleven measures carry the annotation, and §7's eight are recorded as the **default cards**.
The distinction matters because the register serves two purposes — it says what an executive page is
*allowed* to show without a new curation decision, and it says what the page shows by default.

| Measure | KPI | Group | Default card (§7) | In register |
|---|---|---|---|---|
| Retail Units Sold | `KPI-SLS-001` | Sales | **Yes** | Yes |
| Total Gross | `KPI-GRS-003` | Gross | **Yes** | Yes |
| Total Gross per Retail Unit | `KPI-GRS-006` | Gross | **Yes** | Yes |
| Active Inventory Count | `KPI-INV-001` | Inventory | **Yes** | Yes |
| Aged Inventory Percentage | `KPI-INV-006` | Inventory | **Yes** | Yes |
| Aged Inventory Investment | supporting → `KPI-INV-005` | Inventory | **Yes** | Yes |
| Lead-to-Sale Conversion | `KPI-FUN-006` | Lead Funnel | **Yes** | Yes |
| Gross Return on Advertising Spend | `KPI-MKT-003` | Marketing | **Yes** | Yes |
| Inventory Investment | `KPI-INV-002` | Inventory | No — §10 only | Yes |
| Aged Inventory Count | `KPI-INV-005` | Inventory | No — §10 only | Yes |
| Show-to-Sale Conversion | `KPI-FUN-005` | Lead Funnel | No — §10 only | Yes |

**Eleven annotated measures; eight default cards.** The disagreement is recorded rather than papered over,
because the alternative was to pick one list silently and leave a future reader to discover that this
document had said something else.

**A caveat on the register's size.** `P2.1-06` in
[PHASE_2_BACKLOG.md](../../docs/requirements/PHASE_2_BACKLOG.md) and
[ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md) both state that the
annotation applies to *exactly eight* measures and that nine would be a defect. The model as committed has
**eleven**. This document describes the model, so eleven is what it records; the two governing documents
predate the union resolution and are, on this point, out of date with the artefact they govern. A static
check asserting eight would fail against the committed TMDL today.

**Target attainment is absent from this register and must stay absent — for a reason that has changed.**
[ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) lists target attainment as an Executive Overview component.
It used to be absent because `warehouse.fact_sales_target` was Deferred and there was nothing to attain
against. **That is no longer true.** Dashboard increment `DASH.5` implemented the fact, the reporting view
`reporting.vw_target_attainment`, and the ten `KPI-TGT-*` KPIs
([KPI_CATALOG.md §39](../../KPI_CATALOG.md)).

The measures are still absent, and the reason is now a **semantic-model gap** rather than a missing fact:

- The fact and the view exist in PostgreSQL. **No TMDL table, relationship, measure or annotation binds
  them**, and `DASH.5` changed no TMDL file.
- `reporting.vw_target_attainment` is a **dashboard-program view**, deliberately held outside the 28-view
  MVP surface the semantic model binds to, so its existence moved no measured baseline.
- The ten target KPIs are **SQL and web KPIs**. They are not validated DAX measures, and nothing in this
  repository may describe them as such.
- Binding them later is real work: a `fact_sales_target` table, a relationship to the date dimension on the
  target month, a decision about the scope column's role in the model, and a Target Measures group. **Any
  such change requires renewed Microsoft-engine validation**; it cannot inherit the current evidence.
- **Gate 2 remains CLOSED**, and Desktop validation remains PENDING. Neither moved, in either direction,
  because of `DASH.5`.

The absence is recorded rather than filled with a placeholder, exactly as before.

**No page reads this register yet.** No Executive Overview page exists, and none may be claimed. `P2.2-02`
is the item that builds one, and it is gated on the Desktop validation in `P2.1-09`.

---

## 9. Data-quality measures

Eleven measures across three disconnected source tables. **None carries a KPI identifier**, because
[KPI_CATALOG.md](../../KPI_CATALOG.md) governs business measures and this group answers a different question:
*can these numbers be trusted?* That is not a business KPI, but it is a condition on every other page being
read at all. All eleven are annotated `ARPI_MeasureRole = Supporting` and none carries `ARPI_DateBasis`.

| Measure | Folder | Source | Format | Shape / DAX as built |
|---|---|---|---|---|
| Checks Passed | Checks | `vw_data_quality_trend` | `#,0` | `SUM ( [checks_passed] ) + 0` |
| Checks Failed | Checks | `vw_data_quality_trend` | `#,0` | `SUM ( [checks_failed] ) + 0` |
| Checks Skipped | Checks | `vw_data_quality_trend` | `#,0` | `SUM ( [checks_skipped] ) + 0` |
| Pass Rate | Checks | `vw_data_quality_trend` | `0.0%` | `DIVIDE ( SUM([checks_passed]), SUM([checks_evaluated]) )` |
| Evaluation Coverage | Checks | `vw_data_quality_trend` | `0.0%` | `DIVIDE ( SUM([checks_evaluated]), SUM([checks_recorded]) )` |
| Critical Reconciliations Failed | Reconciliation | `vw_reconciliation_status` | `#,0` | `CALCULATE ( COUNTROWS(...), [is_critical] = TRUE(), [is_passing] = FALSE() ) + 0` |
| Reconciliation Difference | Reconciliation | `vw_reconciliation_status` | `#,0.00` | `SUM ( [absolute_difference] )` |
| Last Successful Refresh | Pipeline run | `vw_pipeline_run_summary` | `yyyy-mm-dd hh:nn` | `CALCULATE ( MAX([completed_at]), [run_status] = "succeeded" )` |
| Pipeline Status | Pipeline run | `vw_pipeline_run_summary` | *(none — text)* | `SELECTEDVALUE([run_status])` for the latest `pipeline_run_id` |
| Pipeline Duration | Pipeline run | `vw_pipeline_run_summary` | `0.0 "min"` | `CALCULATE ( SUM([duration_seconds]), [pipeline_run_id] = LatestRun ) / 60` |
| Rejected Rows | Pipeline run | `vw_pipeline_run_summary` | `#,0` | `SUM ( [rejected_row_count] ) + 0` |

Four rules this group carries.

* **A skipped check is not a passing check.** `Pass Rate` divides by checks **evaluated**, not by checks
  recorded, and `Evaluation Coverage` must be published beside it. A 100 per cent pass rate over 10 per cent
  coverage proves very little, and a skipped check almost always means the target held no rows, so the check
  had nothing to assert against.
* **`Critical Reconciliations Failed` is the one number an executive page should surface if it is ever
  non-zero**, because a critical reconciliation breach means a figure elsewhere in the report cannot be
  relied on. It is not in the Executive register today; that is a page-design decision for `P2.2`, recorded
  here so it is a decision rather than an omission.
* **`Reconciliation Difference` is unit-free.** Some reconciliations compare row counts and others compare
  currency, so the summed absolute difference is a magnitude to sort by, not a total to read. Its format
  string carries no unit for that reason.
* **`Pipeline Status` is a text measure and has no format string**, deliberately. The status is a word.
  Encoding it as a colour or a symbol would put presentation logic inside the model, and no measure in this
  model encodes colour, emoji or a status symbol in its result. See
  [06-format-strings.md](06-format-strings.md).

`Last Successful Refresh` returns `BLANK()` when no run has ever succeeded, which is the honest answer rather
than the timestamp of a failed run. `Rejected Rows` being non-zero is not automatically a defect — ARPI
injects controlled defects on purpose — but it is always something to explain rather than ignore.

**These eleven measures ignore the report's date and store slicers**, because their source tables have no
relationship to anything. See [02-relationship-plan.md §8](02-relationship-plan.md).

---

## 10. Measure groups with no MVP measure

Four of the eleven groups in [ARCHITECTURE.md §19.3](../../ARCHITECTURE.md) have no MVP measure. Each is
listed so the gap is visible rather than absent.

**Each of these four is created as nothing at all in the model: no table, no empty table, no placeholder
measure, no hidden stub, no display folder standing in for one.** They exist in this section and nowhere
else. That is the point — an empty measure table looks like capability and is not, and a reviewer opening the
model would read it as unfinished work rather than as a documented boundary.

| Group | Blocked by | What unlocks |
|---|---|---|
| F&I measures | `warehouse.fact_finance_product_sale` (Deferred) | Product penetration and products per retail unit. Until then `KPI-GRS-002` is a single generated number with no product detail behind it, and **no narrative about product mix is supportable from it**. |
| Customer-retention measures | Full purchase history across a longer window | Repeat-customer rate. The `development` profile spans six months, which cannot evidence repeat purchase. |
| Service-to-sales measures | `warehouse.fact_service_visit` (Deferred) | Service-to-sales conversion, which must be presented as decision support and never as a guarantee of purchase intent. |
| Target-attainment measures | **No semantic-model binding** — the fact is no longer the blocker. `warehouse.fact_sales_target` and `reporting.vw_target_attainment` were implemented by `DASH.5`; what is missing is a TMDL table, a date relationship on the target month, and a Target Measures group. Any such change requires renewed Microsoft-engine validation. | Target attainment **in Power BI**. It is already answered on the web console. Target values are fictional operating goals for a fictional group, never industry benchmarks. |

The eleventh group, Executive, is the curation register of §8 and likewise has no table.

---

## 11. KPI to measure, in one table

The DAX side of every one of the twenty-nine MVP KPIs, with the measure that owns it.

| KPI | Measure | Group | Executive register |
|---|---|---|---|
| `KPI-SLS-001` | Retail Units Sold | Sales | **Default card** |
| `KPI-SLS-002` | New Units Sold | Sales | |
| `KPI-SLS-003` | Used Units Sold | Sales | |
| `KPI-GRS-001` | Front-End Gross | Gross | |
| `KPI-GRS-002` | Back-End Gross | Gross | F&I group, when unlocked |
| `KPI-GRS-003` | Total Gross | Gross | **Default card** |
| `KPI-GRS-004` | Front Gross per Retail Unit | Gross | |
| `KPI-GRS-005` | Back Gross per Retail Unit | Gross | F&I group, when unlocked |
| `KPI-GRS-006` | Total Gross per Retail Unit | Gross | **Default card** |
| `KPI-INV-001` | Active Inventory Count | Inventory | **Default card** |
| `KPI-INV-002` | Inventory Investment | Inventory | In register |
| `KPI-INV-003` | Average Inventory Age | Inventory | |
| `KPI-INV-004` | Median Inventory Age | Inventory | |
| `KPI-INV-005` | Aged Inventory Count | Inventory | In register |
| `KPI-INV-006` | Aged Inventory Percentage | Inventory | **Default card** |
| `KPI-INV-007` | Days to Sale (Median) | Inventory | |
| `KPI-INV-008` | Inventory Turn | Inventory | |
| `KPI-INV-009` | Dealer Days Supply | Inventory | |
| `KPI-FUN-001` | Leads Received | Lead Funnel | |
| `KPI-FUN-002` | Contact Rate | Lead Funnel | |
| `KPI-FUN-003` | Appointment-Set Rate | Lead Funnel | |
| `KPI-FUN-004` | Show Rate | Lead Funnel | |
| `KPI-FUN-005` | Show-to-Sale Conversion | Lead Funnel | In register |
| `KPI-FUN-006` | Lead-to-Sale Conversion | Lead Funnel | **Default card** |
| `KPI-FUN-007` | Average Response Time | Lead Funnel | |
| `KPI-FUN-008` | Median Response Time | Lead Funnel | |
| `KPI-MKT-001` | Cost per Lead | Marketing | |
| `KPI-MKT-002` | Cost per Sale | Marketing | |
| `KPI-MKT-003` | Gross Return on Advertising Spend | Marketing | **Default card** |

The twenty supporting measures own no KPI by definition. Nine of them name the KPI they support in an
`ARPI_SupportsKpiId` annotation; the eleven data-quality measures support no KPI at all, and support the
report as a whole instead.

---

## 12. What has not been checked

Stated here rather than left to be discovered.

* **No measure has been evaluated.** Every DAX expression above is text. It may fail to parse in the engine,
  reference a column the engine resolves differently, or return a wrong number under a filter context nobody
  has applied.
* **No total has been verified.** `New + Used = Retail` and `Front + Back = Total per unit` are identities
  the construction should guarantee. They have not been observed to hold.
* **The semi-additive behaviour has not been observed.** Semi-additivity is the most commonly misimplemented
  thing in this document, and the model's treatment of it is an argument until an engine agrees. That
  includes the `LASTNONBLANK`-versus-`LASTNONBLANKVALUE` distinction in §5.1, which is reasoning about how
  the engine resolves a blank, not a measurement of it.
* **No format string has been rendered.** A format string that Desktop rejects fails at render time, not at
  parse time. See [06-format-strings.md](06-format-strings.md).

The method for closing these gaps is [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md); the
gate that closes them is [08-desktop-validation.md](08-desktop-validation.md), and its status is **PENDING**.
