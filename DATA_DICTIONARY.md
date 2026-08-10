# Data Dictionary — Automotive Retail Performance Intelligence (ARPI)

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-07-28
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) · [KPI_CATALOG.md](KPI_CATALOG.md) · [DATA_GENERATION.md](DATA_GENERATION.md) · [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md) · [LIMITATIONS.md](LIMITATIONS.md) · [docs/source-to-target/](docs/source-to-target/README.md)

---

## 1. Purpose

This document is the authoritative catalogue of every data entity in ARPI: what it means, what grain it
is stored at, which columns it carries, where each column's value comes from, and whether it exists yet.

It exists to satisfy three obligations:

1. **Modelling discipline.** [ARCHITECTURE.md §11.1](ARCHITECTURE.md) requires that every fact table have a
   declared grain and that every dimension state its history policy. This document is where those
   declarations live.
2. **Honesty about status.** ARPI is a portfolio project under construction. Every entity below carries an
   implementation status, and the statuses are accurate as of the review date. Nothing here should be read
   as a claim that an unbuilt table exists.
3. **Privacy accountability.** Every column carries a PII classification. Columns that are *prohibited*
   are documented as prohibited so that a reviewer can confirm the absence is deliberate, not accidental.
   See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md).

---

## 2. How to read this document

- **Section 4** is the summary index: every entity, its layer, its grain, and its status. Start there.
- **Sections 6 onward** give one detailed subsection per entity.
- Column tables use these headings:

  | Heading | Meaning |
  |---|---|
  | `Column` | Physical column name, exactly as it appears (or will appear) in PostgreSQL. |
  | `Type` | PostgreSQL type for implemented objects. For planned objects the type is indicative, not binding. |
  | `Null` | `no` = `NOT NULL`; `yes` = nullable, with the meaning of NULL stated in the description. |
  | `Allowed values / domain` | Enumerations, ranges, formats, and check constraints. |
  | `Description` | What the column means in dealership business terms. |
  | `Synthetic generation source` | How the generator produces the value. `Derived` means computed from another column with no randomness. |
  | `PII class` | See the PII taxonomy in section 3.3. |

- **Implemented** entities have exact, binding column contracts. **Planned** entities are documented at
  attribute level: names and types may change during implementation, but **the declared grain is binding**
  and changing it requires an architecture decision record ([ARCHITECTURE.md §35](ARCHITECTURE.md)).

---

## 3. Legends and conventions

### 3.1 Implementation status legend

Exactly four status values are used across ARPI documentation. No other value is permitted.

| Status | Meaning |
|---|---|
| **Implemented** | The object exists in code and/or SQL in this repository today and is exercised by tests. |
| **Planned** | Committed scope with a named phase. Designed and documented, not yet built. |
| **Deferred** | In the long-term architecture but explicitly out of the current roadmap. Unlocked only by a later release stage. |
| **Out of scope** | Deliberately excluded. Adding it would require an architecture decision record. |

### 3.2 Naming conventions

These conventions are binding for every schema, table, view, and column in ARPI.

| Rule | Convention | Example |
|---|---|---|
| Case | `snake_case` throughout. No camelCase, no spaces, no quoted mixed-case identifiers. | `front_end_gross` |
| Dimension tables | `dim_` prefix, singular noun | `warehouse.dim_dealership` |
| Fact tables | `fact_` prefix, singular noun describing the event or snapshot | `warehouse.fact_vehicle_sale` |
| Raw landing tables | `<entity>_load` suffix in schema `raw` | `raw.dealership_load` |
| Staging objects | `stg_` prefix in schema `staging` | `staging.stg_dealership` |
| Reporting objects | `vw_` prefix in schema `reporting` | `reporting.vw_dealership` |
| Surrogate keys | `_key` suffix, integer, warehouse-generated | `dealership_key` |
| Natural / source keys | `_id` suffix, carries the source-system identifier | `dealership_id` |
| Booleans | `is_` prefix (or `has_` where it reads better), never `flag` alone | `is_selling_day` |
| Dates (no time) | `_date` suffix, PostgreSQL `date` | `opened_date` |
| Timestamps | `_at` suffix, PostgreSQL `timestamptz` (UTC) | `ingested_at` |
| Date foreign keys | `_date_key` suffix, integer `YYYYMMDD` | `sale_date_key` |
| Counts | `_count` suffix | `failed_record_count` |
| Monetary amounts | `_amount`, `_price`, `_cost`, or `_gross` suffix; `numeric`, never `float` | `acquisition_cost` |

Additional rules:

- Surrogate `_key` columns are **never** exposed to report users; the reporting layer hides them
  ([ARCHITECTURE.md §19.2](ARCHITECTURE.md)).
- Source `_id` columns are always retained for lineage ([ARCHITECTURE.md §11.1 rule 5](ARCHITECTURE.md)).
- Money is stored as `numeric`, never floating point, so that gross reconciliation is exact.

### 3.3 PII classification taxonomy

| Class | Meaning |
|---|---|
| `Non-personal` | Business, calendar, vehicle, or operational attribute with no link to a person. |
| `Synthetic identifier` | A fabricated key (for example `GSA-001`, `CUS-00000123`) that identifies a synthetic record, not a person. |
| `Minimized personal attribute` | An attribute that *would* be personal at full precision but is generated only in banded or aggregated form (age band, county). Applies to synthetic people only. |
| `Prohibited` | Must never be generated, stored, loaded, or committed. Enforced by validation check `DQ-DLR-004` for the Phase 0 slice and by the register in [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). |

**No column anywhere in ARPI is classified as real personal data, because ARPI contains no real people.**
All operational data is synthetic.

### 3.4 Layers

| Layer | Schema | Role |
|---|---|---|
| Source | filesystem (`data/raw/`, `data/sample/`) | Generator output, CSV. |
| Raw | `raw` | Untyped landing tables, all business columns `text`. |
| Staging | `staging` | Typed, deduplicated views over raw. |
| Warehouse | `warehouse` | Conformed dimensions and facts. |
| Reporting | `reporting` | Stable, business-friendly views for Power BI and Excel. |
| Audit | `audit` | Pipeline runs, validation, reconciliation, rejected records. |

---

## 4. Entity index

> **Status reality check.** Every one of the 29 MVP KPIs in [KPI_CATALOG.md](KPI_CATALOG.md) is computable
> from `reporting`, asserted by `tests/integration/test_kpi_verification.py`, alongside the ten `KPI-TGT-*`
> and twenty-two `KPI-FNI-*` definitions the dashboard program owns. All eight MVP dimensions, all five MVP
> facts and the twenty-eight views of the MVP reporting layer are Implemented. **Six** entities remain
> **Deferred**; none of them is an MVP object, and the questions they block are recorded in
> [`docs/requirements/STAKEHOLDER_QUESTIONS.md`](docs/requirements/STAKEHOLDER_QUESTIONS.md) §6 rather than
> left absent.

> **The baseline did not move.** Three lanes have been implemented *beside* the MVP baseline, not inside it:
> the sanitized public inventory listing lane (ADR-0011, §40), the dashboard-program target lane (ADR-0013,
> [§41](#41-warehousefactsalestarget--implemented-contract-dash5)), and the dashboard-program **F&I lane**
> (ADR-0013, [§42](#42-warehousedimfinanceproduct--implemented-contract-dash6)–[§45](#45-warehousefactfinanceproductadjustment--implemented-contract-dash6)).
> The MVP baseline is still **eight MVP dimensions, five MVP facts, twenty-eight MVP reporting views and
> 29 MVP KPIs**; `warehouse.fact_sales_target` with its ten `KPI-TGT-*` definitions, and the four F&I objects
> with their twenty-two `KPI-FNI-*` definitions, belong to the dashboard program and are counted separately
> ([KPI_CATALOG.md §39, §40](KPI_CATALOG.md)).
>
> **DASH.6 explained an existing measure rather than redefining one.** `fact_vehicle_sale.back_end_gross`
> means exactly what it meant before; `KPI-GRS-002` is unchanged. What changed is that every cent of it is
> now attributable to a named component, and `RECON-FI-001` proves that per deal to the cent.

> **Scope of this index.** It lists every database object ARPI creates, including the six `audit.vw_dq_*`
> helper views in `sql/08_validation/`. Those views are internal query helpers over the audit schema, not
> part of the reporting boundary — `arpi_reporter` reads validation outcomes through
> `reporting.vw_data_quality_summary`. They are listed anyway, because an index that claims to be complete
> and is not is worse than one that admits its boundary (documentation backlog `DOC-22`).

| Entity | Layer | Grain | Status |
|---|---|---|---|
| `warehouse.dim_date` | Warehouse | One row per calendar date | **Implemented** |
| `warehouse.dim_dealership` | Warehouse | One row per dealership store version (SCD2) | **Implemented** |
| `warehouse.dim_employee` | Warehouse | One row per employee role-assignment version (SCD2) | **Implemented** |
| `warehouse.dim_customer` | Warehouse | One row per synthetic customer | **Implemented** |
| `warehouse.dim_vehicle` | Warehouse | One row per unique physical vehicle | **Implemented** |
| `warehouse.dim_vehicle_model` | Warehouse | One row per model-year / make / model / trim combination | **Implemented** |
| `warehouse.dim_lead_source` | Warehouse | One row per normalized lead source | **Implemented** |
| `warehouse.dim_marketing_campaign` | Warehouse | One row per campaign | **Implemented** |
| `warehouse.fact_vehicle_sale` | Warehouse | One row per finalized vehicle transaction | **Implemented** |
| `warehouse.fact_vehicle_inventory_snapshot` | Warehouse | One row per vehicle per dealership per daily snapshot date while active in inventory | **Implemented** |
| `warehouse.fact_lead` | Warehouse | One row per unique CRM lead | **Implemented** |
| `warehouse.fact_appointment` | Warehouse | One row per scheduled appointment | **Implemented** |
| `warehouse.fact_marketing_spend` | Warehouse | One row per dealership, campaign, and calendar month | **Implemented** |
| `warehouse.fact_sales_target` | Warehouse | One row per dealership, target month, targeted KPI, and target scope (scope type + scope id) | **Implemented** (dashboard program, not an MVP fact — [§41](#41-warehousefactsalestarget--implemented-contract-dash5)) |
| `warehouse.dim_finance_product` | Warehouse | One row per finance product definition | **Implemented** (dashboard program — [§42](#42-warehousedimfinanceproduct--implemented-contract-dash6)) |
| `warehouse.dim_lender` | Warehouse | One row per lender | **Implemented** (dashboard program — [§43](#43-warehousedimlender--implemented-contract-dash6)) |
| `warehouse.fact_finance_product_sale` | Warehouse | One row per finance product contract sold on a finalized vehicle transaction | **Implemented** (dashboard program, not a sixth MVP fact — [§44](#44-warehousefactfinanceproductsale--implemented-contract-dash6)) |
| `warehouse.fact_finance_product_adjustment` | Warehouse | One row per product adjustment event | **Implemented** (dashboard program, not a seventh MVP fact — [§45](#45-warehousefactfinanceproductadjustment--implemented-contract-dash6)) |
| `audit.pipeline_run` | Audit | One row per pipeline execution | **Implemented** |
| `audit.pipeline_run_row_count` | Audit | One row per run, entity, and layer | **Implemented** |
| `audit.validation_result` | Audit | One row per validation check evaluation per run | **Implemented** |
| `audit.reconciliation_result` | Audit | One row per reconciliation evaluation per run | **Implemented** |
| `audit.rejected_record` | Audit | One row per rejected source record per run | **Implemented** |
| `raw.calendar_date_load` | Raw | One row per source CSV row per load batch | **Implemented** |
| `raw.dealership_load` | Raw | One row per source CSV row per load batch | **Implemented** |
| `staging.stg_calendar_date` | Staging | One typed row per calendar date in the most recent load batch | **Implemented** |
| `staging.stg_dealership` | Staging | One typed row per dealership in the most recent load batch | **Implemented** |
| `reporting.vw_calendar` | Reporting | One row per calendar date | **Implemented** |
| `reporting.vw_dealership` | Reporting | One row per current dealership version | **Implemented** |
| `reporting.vw_pipeline_run_summary` | Reporting | One row per pipeline run | **Implemented** |
| `reporting.vw_data_quality_summary` | Reporting | One row per validation check per pipeline run | **Implemented** |
| `audit.vw_dq_result_template` | Audit | None — always zero rows; the executable specification of the uniform check-result shape | **Implemented** |
| `audit.vw_dq_dim_date` | Audit | One row per `DQ-DATE-*` check | **Implemented** |
| `audit.vw_dq_dim_dealership` | Audit | One row per `DQ-DLR-*` check | **Implemented** |
| `audit.vw_dq_referential` | Audit | One row per `DQ-REF-*` check | **Implemented** |
| `audit.vw_dq_audit` | Audit | One row per `DQ-AUD-*` check | **Implemented** |
| `audit.vw_dq_all` | Audit | One row per SQL data-quality check across all four check views | **Implemented** |
| `warehouse.dim_sale_type` | Warehouse | One row per sale classification | Deferred |
| `warehouse.dim_inventory_source` | Warehouse | One row per acquisition source | Deferred |
| `warehouse.dim_geography` | Warehouse | One row per approved geographic market grouping | Deferred |
| `warehouse.fact_lead_activity` | Warehouse | One row per CRM activity event | Deferred |
| `warehouse.fact_inventory_price_history` | Warehouse | One row per vehicle price-change event | Deferred |
| `warehouse.fact_service_visit` | Warehouse | One row per closed repair-order visit | Deferred |

**Counts:** 26 Implemented · 11 Planned · 6 Deferred.

**DASH.6 moved three objects out of Deferred and created one that was never deferred at all.**
`warehouse.dim_finance_product`, `warehouse.dim_lender` and `warehouse.fact_finance_product_sale` were
Deferred and are now Implemented; `warehouse.fact_finance_product_adjustment` is new, because the deferred-era
model had no way to record what happens to a contract after it is written and could not distinguish what the
F&I office **produced** from what the store **retained**.

**No MVP count changed.** The MVP baseline is still eight MVP dimensions, five MVP facts, twenty-eight MVP
reporting views and 29 MVP KPIs. The four F&I objects, the four `reporting.vw_fi_*`/`vw_deal_product_detail`
views and the twenty-two `KPI-FNI-*` definitions belong to the **dashboard program** and are counted
separately, exactly as `warehouse.fact_sales_target` and the ten `KPI-TGT-*` definitions are.

---

## 5. Cross-cutting rules

1. **Grain is a contract.** Once a fact grain is published here it may not change without an ADR
   ([ARCHITECTURE.md §35](ARCHITECTURE.md)).
2. **Facts never mix grains.** A measure that is additive at a different grain belongs in a different fact.
3. **Surrogate keys are deterministic.** Where a surrogate key is assigned in Phase 0 it is a stable ordinal
   over a deterministic sort, so that regenerating the dataset with the same seed reproduces the same keys.
4. **Referential integrity is enforced in the database**, not only in Python.
5. **Customer PII is not generated** ([ARCHITECTURE.md §11.1 rule 8](ARCHITECTURE.md)).
6. **`source_system`** is `arpi_synthetic_generator` on every warehouse row that carries lineage, so that a
   reviewer can never mistake ARPI data for real dealership data.

---

# Part A — Implemented entities

---

## 6. `warehouse.dim_date`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_date` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Conformed calendar dimension. Provides every date attribute used for period filtering, time intelligence, seasonality analysis, and selling-day normalization across every fact table. Marked as the Power BI date table when the semantic model is built. |
| **Declared grain** | **One row per calendar date.** Exactly one row exists for every date between `reporting.start_date` and `reporting.end_date` inclusive, with no gaps and no duplicates. |
| **Primary key** | `date_key` (integer, `YYYYMMDD`) |
| **Natural / source key** | `full_date` (unique). The dimension has no external source system; it is fully derived from configuration. |
| **Foreign keys** | None. `dim_date` is a leaf dimension referenced by facts, never referencing others. |
| **Implementation status** | **Implemented** |

### 6.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `date_key` | `integer` PK | no | `YYYYMMDD`, e.g. `20250704` | Integer surrogate key. Sorts chronologically, so it doubles as a period sort key. | Derived: `full_date` formatted `%Y%m%d`, cast to integer. | Non-personal |
| `full_date` | `date` UNIQUE | no | Any date in the configured reporting range | The calendar date itself. The only column a human should read as "the date". | Enumerated day by day from `reporting.start_date` to `reporting.end_date`. | Non-personal |
| `day_of_month` | `smallint` | no | 1–31 | Day number within the month. | Derived. | Non-personal |
| `day_name` | `varchar(9)` | no | `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday` | English day name. Fixed English lookup, deliberately locale-independent so output is byte-identical on any machine. | Derived from a hard-coded English list, not from the OS locale. | Non-personal |
| `day_of_week` | `smallint` | no | 1–7, ISO: 1 = Monday … 7 = Sunday | ISO day-of-week number. Used for weekend logic and day-of-week traffic analysis. | Derived (`isoweekday`). | Non-personal |
| `day_of_year` | `smallint` | no | 1–366 | Ordinal day within the calendar year. | Derived. | Non-personal |
| `week_of_year` | `smallint` | no | 1–53 | **ISO** week number. Pairs with `iso_year`, not with `calendar_year`. | Derived (`isocalendar()[1]`). | Non-personal |
| `iso_year` | `smallint` | no | Four-digit year | ISO week-numbering year. Differs from `calendar_year` for a few days at each year boundary; always use this column with `week_of_year`. | Derived (`isocalendar()[0]`). | Non-personal |
| `month_number` | `smallint` | no | 1–12 | Calendar month number. | Derived. | Non-personal |
| `month_name` | `varchar(9)` | no | `January` … `December` | English month name. Fixed English lookup, locale-independent. | Derived from a hard-coded English list. | Non-personal |
| `month_start_date` | `date` | no | First calendar day of the month | First day of the month containing `full_date`. Simplifies month-to-date logic in SQL. | Derived. | Non-personal |
| `month_end_date` | `date` | no | Last calendar day of the month | Last day of the month containing `full_date`. Correct for leap Februaries. | Derived. | Non-personal |
| `quarter_number` | `smallint` | no | 1–4 | Calendar quarter number. | Derived from `month_number`. | Non-personal |
| `quarter_name` | `varchar(2)` | no | `Q1`, `Q2`, `Q3`, `Q4` | Display label for the quarter. | Derived from `quarter_number`. | Non-personal |
| `calendar_year` | `smallint` | no | Four-digit year | Calendar year of `full_date`. | Derived. | Non-personal |
| `fiscal_month` | `smallint` | no | 1–12 | Fiscal month. **Equals `month_number`** — ARPI's fictional fiscal year is aligned to the calendar year. Retained as a distinct column so a future fiscal offset does not require schema change. | Derived: equal to `month_number`. | Non-personal |
| `fiscal_quarter` | `smallint` | no | 1–4 | Fiscal quarter. **Equals `quarter_number`.** | Derived: equal to `quarter_number`. | Non-personal |
| `fiscal_year` | `smallint` | no | Four-digit year | Fiscal year. **Equals `calendar_year`.** | Derived: equal to `calendar_year`. | Non-personal |
| `is_weekend` | `boolean` | no | `true` / `false` | True when `full_date` is a Saturday or a Sunday. **A weekend is a selling day** — see 6.2. | Derived: `day_of_week IN (6, 7)`. | Non-personal |
| `is_month_end` | `boolean` | no | `true` / `false` | True when `full_date = month_end_date`. Dealership reporting is heavily month-end driven. | Derived. | Non-personal |
| `is_quarter_end` | `boolean` | no | `true` / `false` | True when `full_date` is the last day of a calendar quarter. | Derived. | Non-personal |
| `is_year_end` | `boolean` | no | `true` / `false` | True when `full_date` is 31 December. | Derived. | Non-personal |
| `is_holiday` | `boolean` | no | `true` / `false` | True when `full_date` matches any rule in the observed-holiday table in 6.2. | Derived from the holiday rule set. | Non-personal |
| `holiday_name` | `varchar(64)` | yes | One of the twelve holiday names in 6.2 | Name of the observed holiday. **NULL when `is_holiday` is false** — NULL means "not a holiday", nothing else. | Derived from the holiday rule set. | Non-personal |
| `is_closure_holiday` | `boolean` | no | `true` / `false` | True when the showroom is closed for the day. A subset of `is_holiday`: some recognized holidays are trading days. | Derived from the `Closure?` column in 6.2. | Non-personal |
| `is_selling_day` | `boolean` | no | `true` / `false` | True when the showroom is open and retail delivery is possible. Defined as `NOT is_closure_holiday`. Used as the denominator for per-selling-day pace measures. | Derived: `NOT is_closure_holiday`. | Non-personal |

### 6.2 `is_selling_day` and holiday semantics

Holidays are computed deterministically per calendar year from arithmetic rules only. **No external
holiday library is used**, because a third-party holiday package could change its rule set between
versions and silently break byte-level reproducibility of the generated dataset.

| Holiday | Rule | Closure? |
|---|---|---|
| New Year's Day | January 1 | **yes** |
| Martin Luther King Jr. Day | 3rd Monday in January | no |
| Presidents Day | 3rd Monday in February | no |
| Easter Sunday | Anonymous Gregorian computus | **yes** |
| Memorial Day | last Monday in May | no |
| Juneteenth National Independence Day | June 19 | no |
| Independence Day | July 4 | **yes** |
| Labor Day | 1st Monday in September | no |
| Columbus Day | 2nd Monday in October | no |
| Veterans Day | November 11 | no |
| Thanksgiving Day | 4th Thursday in November | **yes** |
| Christmas Day | December 25 | **yes** |

Semantics:

- **`is_selling_day = NOT is_closure_holiday`.** It is *not* `NOT is_weekend`.
- **Weekends are selling days.** New Hampshire permits Sunday vehicle sales, so a Sunday in this model is
  an ordinary trading day. This is a deliberate modelling choice for the fictional Southern New Hampshire
  market and is repeated in [DATA_GENERATION.md](DATA_GENERATION.md). Analysts reusing this dimension for a
  state with Sunday blue laws must change the rule, not merely reinterpret the column.
- **Recognized ≠ closed.** Martin Luther King Jr. Day, Presidents Day, Memorial Day, Juneteenth, Labor Day,
  Columbus Day, and Veterans Day are flagged `is_holiday = true` but remain selling days. Several of these
  are among the highest-traffic retail automotive days of the year, which is precisely why the two flags
  are modelled separately.
- **No observance shifting.** A fixed-date holiday falling on a weekend is *not* moved to an adjacent
  weekday. The showroom-closure flag applies on the actual calendar date only.
- **Collision rule.** If two holidays fall on the same date, `holiday_name` takes the **first match in the
  table order above**, and `is_closure_holiday` is the **logical OR** of all matches. This makes the
  outcome order-independent for the closure flag and deterministic for the name.
- **Validation.** `DQ-DATE-005` asserts that the ratio of selling days to total days sits between
  `validation.min_selling_day_ratio` (0.80) and `validation.max_selling_day_ratio` (1.00). This is a
  sanity bound on the holiday logic, not a business benchmark.

### 6.3 Business rules

- `date_key` must equal `full_date` formatted as `YYYYMMDD` for every row (`DQ-DATE-003`).
- The date range must be contiguous: no missing days between minimum and maximum `full_date`
  (`DQ-DATE-002`).
- `date_key` must be unique (`DQ-DATE-001`).
- No required field may be NULL; `holiday_name` is the only nullable column (`DQ-DATE-004`).
- `is_holiday = false` implies `holiday_name IS NULL`.
- `is_closure_holiday = true` implies `is_holiday = true`.
- Row count equals the inclusive day count of the configured reporting window.

### 6.4 PII classification

Every column is `Non-personal`. A calendar dimension cannot contain personal data.

### 6.5 History policy

**Not applicable — the calendar is immutable.** Conventionally described as SCD Type 0: rows are inserted
once and never updated. Extending the reporting window appends rows; it never rewrites them.

---

## 7. `warehouse.dim_dealership`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_dealership` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Conformed store dimension for the fictional **Granite Auto Group**. Every fact in the model is sliceable by store, and this dimension carries the store attributes (type, franchise brand, market) that drive nearly all comparative analysis. |
| **Declared grain** | **One row per dealership store version (Slowly Changing Dimension Type 2).** In Phase 0 exactly one current version exists per store, so the table holds three rows. |
| **Primary key** | `dealership_key` (integer surrogate) |
| **Natural / source key** | `dealership_id` (for example `GSA-001`). Unique among current rows. |
| **Foreign keys** | None. `dim_dealership` is a leaf dimension. |
| **Implementation status** | **Implemented** |

### 7.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `dealership_key` | `integer` PK | no | 1..N | Surrogate key. Assigned as a **deterministic ordinal 1..N by `dealership_id`**, so the same store always receives the same key on regeneration. | Derived: rank of `dealership_id` in ascending sort order. | Non-personal |
| `dealership_id` | `varchar(16)` | no | `GSA-###` | Natural / source key. The synthetic store identifier used by the fictional group. | Fixed reference data (see 7.2). | Synthetic identifier |
| `store_name` | `varchar(120)` | no | Free text | Full legal-style store name as it would appear on a report header. | Fixed reference data. | Non-personal |
| `store_short_name` | `varchar(40)` | no | Free text | Abbreviated store name for chart axes, slicers, and narrow tables. | Fixed reference data. | Non-personal |
| `store_type` | `varchar(40)` | no | `Franchise New and Used` \| `Independent Used` | Business model of the store. Drives whether new-vehicle measures are meaningful for the store. | Fixed reference data. | Non-personal |
| `franchise_brand` | `varchar(40)` | yes | `Chevrolet` \| `Subaru` \| NULL | Franchise brand. **NULL means the store holds no franchise** (independent used operation) — it does not mean "unknown". | Fixed reference data. | Non-personal |
| `city` | `varchar(60)` | no | Free text | Municipality. City-level only; **no street address is generated** ([PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md)). | Fixed reference data. | Non-personal |
| `state_code` | `char(2)` | no | `NH` | Two-letter state code. All three fictional stores are in New Hampshire. | Fixed reference data. | Non-personal |
| `market_region` | `varchar(60)` | no | `Southern New Hampshire` | Analytical market grouping. The seed of the Deferred `dim_geography`. | Fixed reference data. | Non-personal |
| `opened_date` | `date` | no | Valid date | Date the fictional store opened. Bounds the plausible range of any historical fact for that store. | Fixed reference data. | Non-personal |
| `is_active` | `boolean` | no | `true` / `false` | Whether the store is currently trading. All three fictional stores are active. | Fixed reference data. | Non-personal |
| `effective_date` | `date` | no | Valid date | SCD2 version start date, inclusive. **Equals `opened_date` in Phase 0** because no attribute change has occurred yet. | Derived: `opened_date` for the initial version. | Non-personal |
| `expiration_date` | `date` | no | Valid date; `9999-12-31` for current rows | SCD2 version end date, inclusive. The high-date sentinel `9999-12-31` is used rather than NULL so that `BETWEEN` range joins work without NULL handling. | Derived. | Non-personal |
| `is_current` | `boolean` | no | `true` / `false` | True for the version in force today. Redundant with `expiration_date` by design: it makes the common "current stores only" filter a single index-friendly predicate. | Derived. | Non-personal |
| `attribute_hash` | `char(64)` | no | 64 lowercase hex characters | SHA-256 change-detection digest over the Type 2 tracked attributes. See 7.3. | Derived. | Non-personal |
| `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Constant lineage marker. Present on every row so that no reviewer can mistake this data for a real DMS extract. | Constant. | Non-personal |

**Uniqueness constraints**

- `(dealership_id, effective_date)` is unique — a store cannot have two versions starting on the same day.
- A **partial unique index** on `dealership_id WHERE is_current` — a store may have at most one current
  version at any time.

### 7.2 Reference data (authoritative)

These three stores are fixed reference data. The generator fails if `generation.store_count` does not equal
the number of defined stores.

| `dealership_key` | `dealership_id` | `store_name` | `store_short_name` | `store_type` | `franchise_brand` | `city` | `state_code` | `market_region` | `opened_date` |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `GSA-001` | Granite Chevrolet of Nashua | Granite Chevrolet | Franchise New and Used | Chevrolet | Nashua | NH | Southern New Hampshire | 2009-04-06 |
| 2 | `GSA-002` | Granite Subaru of Manchester | Granite Subaru | Franchise New and Used | Subaru | Manchester | NH | Southern New Hampshire | 2013-08-19 |
| 3 | `GSA-003` | Granite Pre-Owned Center of Merrimack | Granite Pre-Owned | Independent Used | *(null)* | Merrimack | NH | Southern New Hampshire | 2017-03-13 |

All three rows have `is_active = true`. **No street addresses, phone numbers, or email addresses exist for
these stores** — they are omitted deliberately, not merely unpopulated.

### 7.3 `attribute_hash` semantics (SCD2 change detection)

`attribute_hash` is the mechanism that decides whether an incoming source row represents a *new version* of
a store or an unchanged one. It is defined precisely so that the same input always produces the same hash
on any platform:

1. **Tracked attributes** are columns 3 through 11 of the column table above, in that exact order:
   `store_name`, `store_short_name`, `store_type`, `franchise_brand`, `city`, `state_code`,
   `market_region`, `opened_date`, `is_active`.
2. The attribute values are rendered as text and **joined with the pipe character `|`**.
3. The joined string is encoded as **UTF-8**.
4. `attribute_hash` is the **SHA-256** digest of those bytes, as 64 lowercase hexadecimal characters.

Columns deliberately **excluded** from the hash: `dealership_key` (surrogate, not a business attribute),
`dealership_id` (identity, not a tracked attribute), `effective_date`, `expiration_date`, `is_current`
(SCD bookkeeping — including them would make every row hash differently and defeat the purpose), and
`source_system` (constant).

**Load behaviour**

| Condition | Action |
|---|---|
| No current row exists for `dealership_id` | Insert a new row with `is_current = true`, `effective_date` = the store's `opened_date` (initial load) or the change date (later), `expiration_date = 9999-12-31`. |
| Current row exists and incoming `attribute_hash` **matches** | No change. Do not insert, do not update. This is what makes the load idempotent. |
| Current row exists and incoming `attribute_hash` **differs** | Expire the current row (set `expiration_date` to the day before the change, `is_current = false`) and insert a new current version. |

Because the hash is over business attributes only, rerunning the pipeline against unchanged source data
produces zero new rows — the idempotency guarantee in [ARCHITECTURE.md §17.3](ARCHITECTURE.md).

### 7.4 Business rules

- `dealership_key` is unique (`DQ-DLR-001`).
- `dealership_id` is unique among rows where `is_current = true` (`DQ-DLR-002`).
- The number of distinct current stores equals `generation.store_count` (`DQ-DLR-003`).
- No prohibited PII column may exist on the table (`DQ-DLR-004`) — this check inspects the *schema*, not
  just the data, so an accidentally added `email` column fails the run.
- `franchise_brand` must be non-NULL where `store_type = 'Franchise New and Used'` and NULL where
  `store_type = 'Independent Used'` (`DQ-DLR-005`).
- `effective_date <= expiration_date` for every row.
- Version ranges for a given `dealership_id` do not overlap.
- `is_current = true` if and only if `expiration_date = '9999-12-31'`.

### 7.5 PII classification

No personal data. `dealership_id` is a `Synthetic identifier`; every other column is `Non-personal`.
Store geography stops at city level. Contact details of any kind are prohibited.

### 7.6 History policy

**Slowly Changing Dimension Type 2**, per [ARCHITECTURE.md §14](ARCHITECTURE.md). Type 2 is required
because a store's franchise brand or type could change and historical facts must remain attached to the
attribute values in force at the time of the transaction. Type 2 rows carry `effective_date`,
`expiration_date`, and `is_current`, as §14 mandates.

---

# Part B — Planned dimensions

> Everything in Part B is **Planned**: designed and documented, not built. Column lists are attribute-level.
> Physical types are indicative. **Grains are binding.**

---

## 8. `warehouse.dim_employee`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_employee` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Describes the synthetic sales, BDC, desk-management, and finance staff whose activity is attributed in the sales and funnel facts. Supplies the *contextual* attributes (tenure, department, store) that [ARCHITECTURE.md §23](ARCHITECTURE.md) requires before any employee performance figure may be shown. |
| **Consumed by `DASH.11`** | `reporting.vw_employee_performance` and `reporting.vw_employee_lead_source_response` join the **fact-linked version key**, never `employee_id` resolved to its current row, so `job_role`, `department`, `tenure_band` and the assignment store on every employee-performance row are the values that were true AT THE EVENT. `reporting.vw_employee` — the current version only — is exported as the `employees` roster, limited by an exact allowlist to `employee_code`, `dealership_id`, `department`, `job_role`, `is_manager`, `tenure_band` and `is_active`. `hire_date` and `termination_date` are in the dimension and reach no view and no export. |
| **Declared grain** | **One row per employee role-assignment version (SCD Type 2).** A single person who moves store or changes role produces multiple rows. |
| **Primary key** | `employee_key` |
| **Natural / source key** | `employee_id` (`EMP-#####`) |
| **Foreign keys** | `dealership_key` → `warehouse.dim_dealership` |
| **Implementation status** | **Implemented** |

### 8.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `employee_key` | integer | no | 1..N | Surrogate key, one per role-assignment version. | Deterministic ordinal. | Non-personal |
| `employee_id` | text | no | `EMP-#####` | Synthetic employee identifier. Stable across versions of the same person. | Sequence within the employee generator. | Synthetic identifier |
| `dealership_key` | integer | no | FK | Store the employee is assigned to in this version. | Assigned by generator. | Non-personal |
| `department` | text | no | `New Sales`, `Used Sales`, `BDC`, `Finance`, `Sales Management` | Operating department. | Controlled distribution. | Non-personal |
| `job_role` | text | no | `Salesperson`, `BDC Representative`, `Sales Manager`, `Desk Manager`, `Finance Manager`, `General Manager` | Role held in this version. | Controlled distribution. | Non-personal |
| `hire_date` | date | no | Valid date on or after the store `opened_date` | Date of hire. | Generated. | Non-personal |
| `termination_date` | date | yes | Valid date ≥ `hire_date` | Termination date. NULL means still employed. | Generated. | Non-personal |
| `tenure_band` | text | no | `Under 1 year`, `1 to 3 years`, `3 to 5 years`, `Over 5 years` | Banded tenure. Banded rather than exact so that scorecards are contextualized without implying a precise personnel record. | Derived from `hire_date`. | Non-personal |
| `is_manager` | boolean | no | `true` / `false` | Whether the role carries management responsibility. | Derived from `job_role`. | Non-personal |
| `is_active` | boolean | no | `true` / `false` | Whether the employee is currently employed. | Derived. | Non-personal |
| `effective_date` | date | no | Valid date | SCD2 version start. | Derived. | Non-personal |
| `expiration_date` | date | no | `9999-12-31` for current | SCD2 version end. | Derived. | Non-personal |
| `is_current` | boolean | no | `true` / `false` | Current-version flag. | Derived. | Non-personal |
| `attribute_hash` | char(64) | no | hex | SHA-256 over tracked attributes; same construction as 7.3. | Derived. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |
| *Employee name* | — | — | — | **Prohibited by default.** [ARCHITECTURE.md §22.4](ARCHITECTURE.md) permits fictional names "if names are used at all". ARPI's decision is **not** to generate names: a synthetic identifier plus role and tenure is sufficient for every planned KPI, and fictional names invite confusion with real staff. | Not generated. | Prohibited |
| *Compensation, pay plan, commission* | — | — | — | **Prohibited.** Real employee compensation is on the prohibited-data list in `docs/research.md` §10.2, and synthetic compensation adds no analytical value to any planned KPI. | Not generated. | Prohibited |

### 8.2 Business rules

- `termination_date`, when present, is on or after `hire_date`.
- `hire_date` is on or after the assigned store's `opened_date`.
- A person (`employee_id`) has at most one current version.
- Employee counts per store are consistent with the scale settings in [DATA_GENERATION.md](DATA_GENERATION.md).

### 8.3 PII classification

`employee_id` is a `Synthetic identifier`. `tenure_band` is a `Minimized personal attribute` on a synthetic
person. Names, contact details, birth dates, and compensation are **Prohibited**.

### 8.4 History policy

**SCD Type 2** — required by [ARCHITECTURE.md §14](ARCHITECTURE.md) because employees may change stores or
roles and historical performance must stay attached to the correct assignment.

---

## 9. `warehouse.dim_customer`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_customer` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Represents the synthetic buying party on a sale, lead, or appointment. Deliberately thin: it exists to support repeat-purchase and cohort analysis, not to profile individuals. |
| **Declared grain** | **One row per synthetic customer.** |
| **Primary key** | `customer_key` |
| **Natural / source key** | `customer_id` (`CUS-########`) |
| **Foreign keys** | None in the MVP. A `geography_key` FK is Deferred with `dim_geography`. |
| **Implementation status** | **Implemented** |

### 9.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `customer_key` | integer | no | 1..N | Surrogate key. | Deterministic ordinal. | Non-personal |
| `customer_id` | text | no | `CUS-########` | Synthetic customer identifier. | Sequence within the customer generator. | Synthetic identifier |
| `household_key` | integer | yes | 1..N | Groups synthetic customers into a household. Present only to support household repeat-purchase analysis; NULL means single-person household. | Generated. | Synthetic identifier |
| `age_band` | text | no | `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+` | Banded age. **Full birth date is prohibited** — data minimization, `docs/research.md` §10.4. | Controlled distribution. | Minimized personal attribute |
| `county` | text | no | New Hampshire / Northern Massachusetts county names | Coarsest useful geography. **Street address is prohibited.** | Controlled distribution. | Minimized personal attribute |
| `state_code` | char(2) | no | `NH`, `MA` | State. | Derived from `county`. | Minimized personal attribute |
| `market_area` | text | no | Named market groupings | Analytical market grouping. | Derived from `county`. | Non-personal |
| `customer_type` | text | no | `Retail`, `Business`, `Wholesale Buyer` | Buying-party classification. Wholesale disposals may have no customer at all. | Controlled distribution. | Non-personal |
| `is_prior_customer` | boolean | no | `true` / `false` | Whether the synthetic customer had a purchase before the reporting window opened. Prevents repeat-rate measures from being artificially depressed at the start of the window. | Generated. | Non-personal |
| `is_service_customer` | boolean | no | `true` / `false` | Whether the synthetic customer has service history. Supports the Deferred service-to-sales domain. | Generated. | Non-personal |
| `first_interaction_date` | date | no | Valid date | Earliest date the synthetic customer appears in any fact. | Derived. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 9.2 Prohibited fields

The following are named as **Prohibited** in [ARCHITECTURE.md §11.2](ARCHITECTURE.md). They must never be
generated, stored, loaded, or committed, in this dimension or anywhere else:

| Prohibited field | Reason |
|---|---|
| **Name** | Directly identifying. A synthetic key serves every analytical purpose. |
| **Street address** | Directly identifying. County / market area is the finest geography ARPI stores. |
| **Email** | Directly identifying and a contact vector. |
| **Phone number** | Directly identifying and a contact vector. |
| **Full birth date** | Quasi-identifier; `age_band` is sufficient for cohort analysis. |
| **Social Security number** | Never appropriate in any portfolio dataset. |
| **Driver's-license number** | Government identifier; never appropriate. |
| **Bank information** | Financial account data; never appropriate. |

`docs/research.md` §10.2 additionally prohibits credit scores tied to identifiable people, credit-application
details, insurance information, and actual deal jackets. ARPI treats those as prohibited here too. Where a
credit dimension is ever required, only a broad synthetic tier is permissible
([ARCHITECTURE.md §22.4](ARCHITECTURE.md)) — and that is Deferred, not Planned.

### 9.3 Business rules

- `first_interaction_date` is on or before the earliest fact date referencing the customer.
- Every customer referenced by a retail sale exists in this dimension; wholesale transactions may carry no
  customer key ([ARCHITECTURE.md §12.1](ARCHITECTURE.md)).
- `age_band` distribution must not be uniform (prohibited synthetic pattern,
  [ARCHITECTURE.md §15.4](ARCHITECTURE.md)).

### 9.4 PII classification

`Minimized personal attribute` for `age_band`, `county`, `state_code`; `Synthetic identifier` for
`customer_id` and `household_key`; `Non-personal` elsewhere. **All persons are fabricated.**

### 9.5 History policy

**SCD Type 1.** Customer attributes are overwritten in place; ARPI does not need to report on the value an
age band held historically. If trade-cycle analysis later requires history, that is an ADR.

---

## 10. `warehouse.dim_vehicle`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_vehicle` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Describes an individual physical unit of inventory. Distinguished from `dim_vehicle_model`, which describes the configuration rather than the unit. Required by every inventory and sale measure. |
| **Declared grain** | **One row per unique physical vehicle.** |
| **Primary key** | `vehicle_key` |
| **Natural / source key** | `vehicle_id` (`VEH-#######`) and the synthetic VIN-like identifier |
| **Foreign keys** | `vehicle_model_key` → `warehouse.dim_vehicle_model` |
| **Implementation status** | **Implemented** |

### 10.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `vehicle_key` | integer | no | 1..N | Surrogate key. | Deterministic ordinal. | Non-personal |
| `vehicle_id` | text | no | `VEH-#######` | Synthetic vehicle identifier. | Sequence within the vehicle generator. | Synthetic identifier |
| `synthetic_vin` | text | no | 17 characters, structurally VIN-like, **never a real VIN** | Masked, fabricated VIN-like identifier. Exists to demonstrate VIN-keyed modelling without publishing a real VIN. See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). | Generated deterministically; not decoded from any real VIN. | Synthetic identifier |
| `vehicle_model_key` | integer | no | FK | Link to the model / trim configuration. | Assigned by generator. | Non-personal |
| `model_year` | smallint | no | Plausible model years | Model year of the unit. | Inherited from the model. | Non-personal |
| `make` | text | no | Make names | Manufacturer. | Inherited from the model. | Non-personal |
| `model` | text | no | Model names | Model. | Inherited from the model. | Non-personal |
| `trim` | text | yes | Trim names | Trim level. NULL means the source did not specify a trim. | Inherited from the model. | Non-personal |
| `body_style` | text | no | `Sedan`, `SUV`, `Truck`, `Hatchback`, `Wagon`, `Van`, `Coupe` | Body style. | Inherited from the model. | Non-personal |
| `fuel_type` | text | no | `Gasoline`, `Hybrid`, `Plug-in Hybrid`, `Electric`, `Diesel` | Fuel type. | Inherited from the model. | Non-personal |
| `drivetrain` | text | no | `FWD`, `RWD`, `AWD`, `4WD` | Drivetrain. AWD share is elevated for the New England market. | Inherited from the model. | Non-personal |
| `transmission` | text | no | `Automatic`, `Manual`, `CVT` | Transmission. | Controlled distribution. | Non-personal |
| `exterior_color` | text | no | Colour names | Exterior colour. Supports colour-concentration aging analysis (`docs/research.md` §4.7). | Controlled distribution. | Non-personal |
| `interior_color` | text | no | Colour names | Interior colour. | Controlled distribution. | Non-personal |
| `odometer_band` | text | no | `New`, `Under 10k`, `10k-30k`, `30k-60k`, `60k-100k`, `Over 100k` | Banded odometer reading at acquisition. Banded to keep the dimension stable while exact mileage stays in the facts. | Derived. | Non-personal |
| `vehicle_condition` | text | no | `New`, `Used`, `Certified` | New / used / certified status. Drives new-versus-used reporting. | Controlled distribution. | Non-personal |
| `vehicle_source` | text | no | `Customer Trade`, `Auction`, `Off-street Purchase`, `Lease Return`, `Dealer Trade`, `Manufacturer Allocation`, `Service-lane Acquisition` | Acquisition source. Denormalized here in the MVP; `dim_inventory_source` is Deferred. | Controlled distribution. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 10.2 Business rules

- `synthetic_vin` is unique across the dimension.
- `vehicle_condition = 'New'` implies `odometer_band = 'New'` and `vehicle_source` in
  `{Manufacturer Allocation, Dealer Trade}`.
- Certified units are Used units with a certification flag applied by the franchise; independent used
  stores cannot produce manufacturer-certified units.
- Vehicle aging behaviour must differ across models — identical aging behaviour across models is a
  prohibited synthetic pattern ([ARCHITECTURE.md §15.4](ARCHITECTURE.md)).

### 10.3 PII classification

`Non-personal` throughout, with `vehicle_id` and `synthetic_vin` classed as `Synthetic identifier`.
**No VIN in ARPI is real, and no VIN is ever linked to owner history.**

### 10.4 History policy

**SCD Type 1.** A physical vehicle's descriptive attributes do not change meaningfully during a dealership
holding period. Price and age change over time and live in the snapshot fact, per
[ARCHITECTURE.md §11.1 rule 6](ARCHITECTURE.md).

---

## 11. `warehouse.dim_vehicle_model`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_vehicle_model` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Configuration-level dimension. Allows model, trim, and class analysis independent of how many physical units exist, which is what makes days-supply and model-mix reporting coherent. |
| **Declared grain** | **One row per model-year, make, model, trim combination.** |
| **Primary key** | `vehicle_model_key` |
| **Natural / source key** | The natural composite `(model_year, make, model, trim)` |
| **Foreign keys** | None |
| **Implementation status** | **Implemented** |

### 11.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `vehicle_model_key` | integer | no | 1..N | Surrogate key. | Deterministic ordinal over the natural composite. | Non-personal |
| `model_year` | smallint | no | Plausible model years | Model year. | Reference catalogue. | Non-personal |
| `make` | text | no | Make names | Manufacturer. | Reference catalogue. | Non-personal |
| `model` | text | no | Model names | Model. | Reference catalogue. | Non-personal |
| `trim` | text | yes | Trim names | Trim. NULL where the catalogue does not distinguish trims. Part of the natural key, so NULL is treated as a distinct value. | Reference catalogue. | Non-personal |
| `body_style` | text | no | See `dim_vehicle` | Body style. | Reference catalogue. | Non-personal |
| `vehicle_class` | text | no | `Compact`, `Midsize`, `Full-size`, `Compact SUV`, `Midsize SUV`, `Full-size SUV`, `Light Truck` | Analytical size / class grouping. | Reference catalogue. | Non-personal |
| `fuel_type` | text | no | See `dim_vehicle` | Fuel type. | Reference catalogue, optionally enriched from NHTSA vPIC. | Non-personal |
| `drivetrain` | text | no | See `dim_vehicle` | Drivetrain. | Reference catalogue, optionally enriched from NHTSA vPIC. | Non-personal |
| `franchise_alignment` | text | yes | `Chevrolet`, `Subaru`, NULL | Which franchise store can sell this model as new. NULL means the model appears only as used inventory. | Derived from `make`. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 11.2 Business rules

- The natural composite `(model_year, make, model, trim)` is unique, with NULL `trim` treated as a distinct
  value.
- Every `dim_vehicle` row resolves to exactly one model row.
- Where NHTSA vPIC enrichment is enabled (`features.enable_public_vehicle_enrichment`, currently OFF), it
  may populate `body_style`, `fuel_type`, and `drivetrain` only. It may never populate a real VIN
  ([ARCHITECTURE.md §16.2](ARCHITECTURE.md)).

### 11.3 PII classification

`Non-personal` throughout.

### 11.4 History policy

**SCD Type 1.** Model catalogue corrections (standardized labels, corrected spellings) are exactly the
Type 1 examples given in [ARCHITECTURE.md §14](ARCHITECTURE.md).

---

## 12. `warehouse.dim_lead_source`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_lead_source` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Normalizes CRM lead origin into a governed set of sources so that funnel and marketing measures are comparable across stores. Raw CRM source strings are notoriously inconsistent; this dimension is where that is fixed once. |
| **Declared grain** | **One row per normalized lead source.** |
| **Primary key** | `lead_source_key` |
| **Natural / source key** | `lead_source_id` |
| **Foreign keys** | None |
| **Implementation status** | **Implemented** |

### 12.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `lead_source_key` | integer | no | 1..N | Surrogate key. | Deterministic ordinal. | Non-personal |
| `lead_source_id` | text | no | Slug | Natural key for the normalized source. | Reference data. | Non-personal |
| `source_name` | text | no | Free text | Display name, for example `Dealer Website`, `Third-Party Marketplace`, `Walk-in`, `Phone Up`, `Service Lane`. | Reference data. | Non-personal |
| `source_category` | text | no | `Owned Digital`, `Third Party`, `Paid Search`, `Paid Social`, `Traditional Media`, `Walk-in`, `Referral`, `Internal` | Analytical grouping used on the marketing page. | Reference data. | Non-personal |
| `is_paid` | boolean | no | `true` / `false` | Whether the source carries marketing cost. Determines whether cost-per-lead is even defined for the source. | Reference data. | Non-personal |
| `is_digital` | boolean | no | `true` / `false` | Digital versus traditional channel. | Reference data. | Non-personal |
| `is_third_party` | boolean | no | `true` / `false` | Whether the lead is supplied by an external marketplace. | Reference data. | Non-personal |
| `is_internal` | boolean | no | `true` / `false` | Whether the source is generated inside the store (walk-in, service lane, repeat customer). | Reference data. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 12.2 Business rules

- Sources differ in cost, volume, conversion, and gross — a required business relationship
  ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)).
- `is_internal = true` implies `is_paid = false`.
- Cost-per-lead and cost-per-sale are undefined (NULL, not zero) for sources where `is_paid = false`.

### 12.3 PII classification

`Non-personal` throughout.

### 12.4 History policy

**SCD Type 1.** Reclassification of a source is a correction, not a historical fact worth preserving.

---

## 13. `warehouse.dim_marketing_campaign`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_marketing_campaign` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | Describes marketing campaigns so that spend, leads, and resulting gross can be attributed to a named initiative rather than only to a channel. |
| **Declared grain** | **One row per campaign.** |
| **Primary key** | `campaign_key` |
| **Natural / source key** | `campaign_id` |
| **Foreign keys** | `lead_source_key` → `warehouse.dim_lead_source` (primary channel) |
| **Implementation status** | **Implemented** |

### 13.1 Attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `campaign_key` | integer | no | 1..N | Surrogate key. | Deterministic ordinal. | Non-personal |
| `campaign_id` | text | no | Slug | Natural key. | Generated. | Non-personal |
| `campaign_name` | text | no | Free text | Display name. | Generated. | Non-personal |
| `channel` | text | no | `Paid Search`, `Paid Social`, `Display`, `Third-Party Listings`, `Direct Mail`, `Radio`, `Television`, `Email` | Delivery channel. | Controlled distribution. | Non-personal |
| `vendor` | text | yes | Fictional vendor names | Media vendor. NULL where the campaign is run in-house. **All vendor names are fictional.** | Generated. | Non-personal |
| `start_date` | date | no | Valid date | Campaign start. | Generated. | Non-personal |
| `end_date` | date | yes | Valid date ≥ `start_date` | Campaign end. NULL means still running. | Generated. | Non-personal |
| `target_department` | text | no | `New Sales`, `Used Sales`, `Both` | Intended department. | Generated. | Non-personal |
| `target_vehicle_category` | text | yes | Vehicle class values | Intended vehicle category. NULL means untargeted. | Generated. | Non-personal |
| `source_system` | text | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 13.2 Business rules

- `end_date`, when present, is on or after `start_date`.
- **Campaigns may create leads outside their primary target segment** — an explicitly required business
  relationship ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)). Attribution logic must not assume perfect
  targeting.
- Marketing spend is non-negative ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)).

### 13.3 PII classification

`Non-personal` throughout.

### 13.4 History policy

**SCD Type 1 initially.** [ARCHITECTURE.md §14](ARCHITECTURE.md) lists campaign classification as a
*potential* Type 2 dimension; promoting it requires an ADR.

---

# Part C — Facts

> **All five MVP facts are built, constrained and populated.** Each grain below is binding, is taken
> directly from [ARCHITECTURE.md §12](ARCHITECTURE.md), and is **enforced by a UNIQUE or PRIMARY KEY
> constraint** on the table rather than only declared here —
> `tests/integration/test_gate1_readiness.py` asserts the constraint exists over exactly the grain columns
> and that the loaded data satisfies it. That enforcement is what "approved" means for Gate 1 condition 1.

---

## 14. `warehouse.fact_vehicle_sale`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.fact_vehicle_sale` |
| **Layer** | Warehouse (transaction fact) |
| **Purpose** | The central profit fact. One row per completed deal, carrying the gross components that drive nearly every executive measure in the project. |
| **Declared grain** | **One row per finalized vehicle transaction.** A transaction includes retail sales, leases, wholesale sales, and dealer trades. **Canceled transactions must not remain as finalized sales.** |
| **Primary key** | `vehicle_sale_key` |
| **Natural / source key** | `sale_id` |
| **Foreign keys** | `sale_date_key`, `delivery_date_key` → `dim_date`; `dealership_key`; `vehicle_key`; `customer_key` (nullable for wholesale); `salesperson_key`, `desk_manager_key`, `finance_manager_key` → `dim_employee`; `lead_source_key`; `sale_type_key` → `dim_sale_type` *(Deferred — denormalized to a `sale_type` text column in the MVP, and DASH.6 deliberately did not change that: see [§44.2](#442-why-saletype-was-not-changed-and-no-dimsaletype-was-created))*; `lender_key` → `dim_lender` **(Implemented by DASH.6, nullable — NULL means NO LENDER EXISTS, never "lender unknown")** |
| **Implementation status** | **Implemented** |

### 14.1 Measures and degenerate attributes

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `unit_count` | integer | no | `1` for finalized retail and wholesale sales | Additive unit counter. Kept explicit rather than using `COUNT(*)` so that unit measures survive any future grain change. | Constant 1. | Non-personal |
| `sale_price` | numeric(12,2) | no | ≥ 0 | Final selling price of the vehicle. | Generated. | Non-personal |
| `msrp` | numeric(12,2) | yes | ≥ 0 | Manufacturer's suggested retail price. NULL for used units without an MSRP. | Generated. | Non-personal |
| `original_asking_price` | numeric(12,2) | no | ≥ 0 | First advertised price. | Generated. | Non-personal |
| `final_asking_price` | numeric(12,2) | no | ≥ 0 | Advertised price at sale. | Generated. | Non-personal |
| `acquisition_cost` | numeric(12,2) | no | ≥ 0 | Cost to acquire the unit. | Generated. | Non-personal |
| `reconditioning_cost` | numeric(12,2) | no | ≥ 0 | Reconditioning spend. | Generated. | Non-personal |
| `pack_amount` | numeric(12,2) | no | ≥ 0 | Internal pack applied before front-end gross. | Generated. | Non-personal |
| `front_end_gross` | numeric(12,2) | no | May be negative | `sale_price − acquisition_cost − reconditioning_cost − pack_amount`. Negative values are legitimate and must remain visible ([ARCHITECTURE.md §19.6](ARCHITECTURE.md)). | Derived. | Non-personal |
| `back_end_gross` | numeric(12,2) | no | May be negative | Finance and insurance gross on the **deal-date** basis. **Its definition did not change in DASH.6 — it is now EXPLAINED rather than merely stated:** `finance_reserve_gross + SUM(original_product_gross)` over `warehouse.fact_finance_product_sale` equals this value **to the cent on every deal**, with `other_fi_income` exactly `0.00` and no balancing plug. `RECON-FI-001` proves it. **Never rewritten** when a later cancellation or chargeback posts — that is a separate event, and the difference between this and the as-of net figure is the point of the distinction. | Generated (drawn first; DASH.6 decomposes it without rebasing it). | Non-personal |
| `finance_reserve_gross` | numeric(12,2) | no | ≥ 0 | **Added by DASH.6.** The finance reserve component of `back_end_gross`, on the deal-date basis. **An amount, never a rate**: it is never divided by anything financed, and no rate, spread or markup is derivable from it. `0.00` on Cash (nothing financed to earn it on), on Lease (ARPI models no money factor, so there is no mechanic it could be attributed to — [STM-019 §6](docs/source-to-target/STM-019-fact-finance-product-sale.md)), and on the ~9% of financed deals written on a flat or no-reserve program. Enforced by `ck_fact_vehicle_sale_reserve_requires_financing` and `DQ-SLE-011`. | Generated (decomposition of `back_end_gross`). | Non-personal |
| `lender_key` | integer | yes | resolves to `dim_lender` | **Added by DASH.6.** The fictional institution behind a financed or leased deal. **NULL means NO LENDER EXISTS** — a Cash deal borrowed nothing and a Wholesale or Dealer Trade disposal has no consumer — and never "lender unknown". Assigned from the store, the derived finance structure and seeded randomness only; **no customer attribute participates**. Enforced by `ck_fact_vehicle_sale_lender_requires_funding` and `DQ-SLE-012`. | Generated. | Non-personal |
| `total_gross` | numeric(12,2) | no | May be negative | `front_end_gross + back_end_gross`. Stored, not recomputed at query time, and reconciled by `RECON-GROSS-001`. | Derived. | Non-personal |
| `discount_from_msrp` | numeric(12,2) | yes | — | `msrp − sale_price`. NULL where `msrp` is NULL. | Derived. | Non-personal |
| `discount_from_original_asking` | numeric(12,2) | no | — | `original_asking_price − sale_price`. | Derived. | Non-personal |
| `days_in_inventory_at_sale` | integer | no | ≥ 0 | Calendar days between acquisition and sale. The days-to-sale measure source. | Derived. | Non-personal |
| `finance_amount` | numeric(12,2) | yes | ≥ 0 | Amount financed. NULL for cash deals. **No APR, buy rate, sell rate, rate spread, money factor, term or payment is modelled**, and DASH.6 added none — see [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). It is one of the two inputs to the derived finance structure ([§44.2](#442-why-saletype-was-not-changed-and-no-dimsaletype-was-created)). | Generated. | Non-personal |
| `cash_down_payment` | numeric(12,2) | yes | ≥ 0 | Cash down. NULL where not applicable. | Generated. | Non-personal |
| `trade_allowance` | numeric(12,2) | yes | ≥ 0 | Allowance credited for a trade. NULL where there is no trade. | Generated. | Non-personal |
| `trade_actual_cash_value` | numeric(12,2) | yes | ≥ 0 | Appraised value of the trade. NULL where there is no trade. | Generated. | Non-personal |
| `sale_type` | text | no | `New Retail`, `Used Retail`, `Certified Retail`, `Lease`, `Wholesale`, `Dealer Trade` | Transaction classification. Denormalized text in the MVP; becomes an FK when `dim_sale_type` is built. **DASH.6 did not change it.** The F&I lane derives a separate three-value `finance_structure` from this column plus `finance_amount`, rather than widening or restating the sale type — [§44.2](#442-why-saletype-was-not-changed-and-no-dimsaletype-was-created). | Generated. | Non-personal |
| `is_retail` | boolean | no | `true` / `false` | True for retail and lease deliveries; false for wholesale and dealer trades. **This is the single flag that defines every "retail unit" denominator in [KPI_CATALOG.md](KPI_CATALOG.md).** | Derived from `sale_type`. | Non-personal |

### 14.2 Business rules

- `unit_count = 1` for finalized retail and wholesale sales.
- `total_gross = front_end_gross + back_end_gross` — enforced by validation, not assumed.
- Sale date cannot precede acquisition date.
- Wholesale transactions may have no customer key.
- Canceled deals are excluded before load; they never appear as finalized sales.
- Every finalized sale references a valid vehicle ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)).
- Sales cannot exist without inventory or vehicle records
  ([ARCHITECTURE.md §15.4](ARCHITECTURE.md)).

### 14.3 PII classification

`Non-personal`. `customer_key` and employee keys are synthetic surrogates.

### 14.4 History policy

**Insert-only transaction fact.** Historical rows are immutable. Corrections are made by reload of the
affected period, not by in-place update.

---

## 15. `warehouse.fact_vehicle_inventory_snapshot`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.fact_vehicle_inventory_snapshot` |
| **Layer** | Warehouse (periodic snapshot fact) |
| **Purpose** | Daily photograph of every unit in stock. This is what makes inventory age, aged-inventory percentage, days supply, and inventory investment answerable *as of any date* rather than only as of today. |
| **Declared grain** | **One row per vehicle per dealership per daily snapshot date while the vehicle is active in inventory.** |
| **Primary key** | `inventory_snapshot_key` — a warehouse-assigned surrogate, deterministic from `(snapshot_date_key, dealership_key, vehicle_key)`. The grain itself is enforced separately, by `uq_fact_vehicle_inventory_snapshot_grain` over those three columns. |
| **Natural / source key** | Composite of snapshot date and `vehicle_id` |
| **Foreign keys** | `snapshot_date_key` → `dim_date`; `dealership_key`; `vehicle_key`; `vehicle_model_key`; `inventory_source_key` → `dim_inventory_source` *(Deferred — denormalized in the MVP)* |
| **Implementation status** | **Implemented** |

### 15.1 Columns

Every column below is in
[`sql/04_facts/01_fact_vehicle_inventory_snapshot.sql`](sql/04_facts/01_fact_vehicle_inventory_snapshot.sql),
and every column in that file is below. **Three columns were listed here for several increments
that the table has never had** — `price_to_market_ratio`, `lead_count_to_date` and
`appointment_count_to_date` — and three it does have were missing: `inventory_snapshot_key`,
`age_bucket` and `source_system`. §15.5 records what happened and why the ratio in particular
does not belong on this table.

**Keys and identity**

| Column | Type | Null | Allowed values / domain | Description | PII class |
|---|---|---|---|---|---|
| `inventory_snapshot_key` | bigint | no | > 0 | Primary key. Warehouse-assigned surrogate, deterministic from the grain columns. | Non-personal |
| `snapshot_date_key` | integer | no | → `dim_date` | The date this photograph was taken. | Non-personal |
| `dealership_key` | integer | no | → `dim_dealership` | The store holding the unit. | Non-personal |
| `vehicle_key` | integer | no | → `dim_vehicle` | The unit. | Non-personal |
| `vehicle_model_key` | integer | no | → `dim_vehicle_model` | Year/make/model/trim of the unit. | Non-personal |

**Measures and attributes**

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `current_asking_price` | numeric(12,2) | no | ≥ 0 | Advertised price on the snapshot date. | Generated. | Non-personal |
| `original_asking_price` | numeric(12,2) | no | ≥ 0 | First advertised price. | Generated. | Non-personal |
| `msrp` | numeric(12,2) | yes | ≥ 0 | MSRP. NULL for used units without one. | Generated. | Non-personal |
| `acquisition_cost` | numeric(12,2) | no | ≥ 0 | Cost to acquire. | Generated. | Non-personal |
| `reconditioning_cost` | numeric(12,2) | no | ≥ 0 | Reconditioning spend to date. | Generated. | Non-personal |
| `inventory_investment` | numeric(12,2) | no | ≥ 0 | `acquisition_cost + reconditioning_cost`, enforced by `ck_..._investment_identity`. Capital tied up in the unit on the snapshot date. | Derived. | Non-personal |
| `market_price_estimate` | numeric(12,2) | yes | NULL, or **strictly > 0** | Synthetic market price reference, constant across a unit's snapshots and anchored to its first advertised price. **Not a real market valuation** — no auction result, guidebook, licensed benchmark or observed transaction is consulted anywhere in this project — and must never be presented as one. Zero is refused by `ck_..._market_estimate_positive` because this column is a denominator; NULL is the governed way to say "no estimate". | Generated (`inventory_market_price_estimate` namespace; absent for roughly 8% of units by design, so the NULL branch downstream is genuinely exercised). | Non-personal |
| `days_in_stock` | integer | no | ≥ 0 | Calendar days between acquisition date and snapshot date. **Non-negative by rule** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). | Derived. | Non-personal |
| `age_bucket` | varchar(16) | no | `0-30` \| `31-60` \| `61-90` \| `91-120` \| `Over 120` | Banded `days_in_stock`, **stored rather than derived per query** so that every aging report bands identically. Not the aged-inventory threshold: see §15.2. | Derived. | Non-personal |
| `markdown_count_to_date` | smallint | no | ≥ 0 | Number of price reductions so far. | Derived. | Non-personal |
| `inventory_unit_count` | smallint | no | `1` | Additive unit counter for the snapshot date. | Constant 1. | Non-personal |
| `source_system` | varchar(40) | no | non-blank | The originating system label carried through the pipeline. | Constant per lane. | Non-personal |

### 15.2 Business rules

- **Exactly one record per vehicle, store, and date** — grain uniqueness is a critical failure if violated
  ([ARCHITECTURE.md §17.4](ARCHITECTURE.md), §21.2).
- Snapshot generation stops after sale, wholesale disposal, or transfer.
- Historical snapshots are immutable.
- `days_in_stock` is non-negative and increases by exactly 1 per day for a continuously held unit.
- Older inventory is more likely to receive markdowns, and generally shows lower expected front-end gross —
  required relationships ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)).
- **`age_bucket` and the aged-inventory threshold are different rules.** The bucket bands a unit for
  reporting; the threshold — 60 days, a **project default and not an industry benchmark** — decides
  whether a unit counts as aged. A unit in `61-90` is aged, and so is one in `91-120`, and the top
  bucket boundary of 120 is not the threshold. Reading 120 as the threshold on this dataset reports
  aged stock at roughly a fifth of its true count.

### 15.3 PII classification

`Non-personal` throughout.

### 15.4 History policy

**Periodic snapshot, insert-only and immutable.** This is the largest planned table: at portfolio scale
[ARCHITECTURE.md §8.5](ARCHITECTURE.md) anticipates 500,000 to 1,500,000 rows.

### 15.5 What `price_to_market_ratio` is, and why it is not a column here

The ratio is real and is published — by
[`reporting.vw_inventory_snapshots`](sql/05_reporting/12_vw_inventory_snapshots.sql), which states the
rule, and by [`reporting.vw_inventory_units`](sql/05_reporting/52_vw_inventory_units.sql), which
**repeats the identical expression** for the console's unit grain. It is
`current_asking_price / market_price_estimate` to four decimals, and it is **NULL wherever the estimate
is NULL — never zero and never imputed**, because "we did not price this unit" and "this unit is
worthless" are different statements and only one of them is true.

Two copies, and the second one is deliberate rather than careless: the unit view reads the fact
directly, because it needs window functions over a narrowed set of dates that the snapshots view does
not publish, so it cannot select a column its source does not carry. Two statements of one rule is
nonetheless how two surfaces come to disagree about a measure with one name, so the equality is
**re-proved on every database run** by `RECON-INV-UNIT-RATIO`
([`sql/08_validation/14_recon_inventory_units.sql`](sql/08_validation/14_recon_inventory_units.sql))
rather than trusted. That rule compares NULL as a value: an absent estimate must produce an absent
ratio on both sides and a zero on neither.

It is derived in the reporting layer rather than stored because it is a ratio of two columns already on
the row, and a stored copy is a third place for it to be wrong. It appeared in this section as a
`numeric(8,4)` column for several increments regardless, which is exactly the failure mode
[CLAUDE.md §3](CLAUDE.md) exists to prevent: a documented column that no DDL ever created reads as
a fact about the schema, and a reader building against it would have found nothing there.

`lead_count_to_date` and `appointment_count_to_date` were the same kind of error and have no
implementation anywhere — no column, no view, no generator. They are **not deferred work**: counting
leads and appointments *to date* on a daily inventory snapshot would make every unit's row depend on
activity that arrives after the snapshot, which is the future-outcome leakage this fact's own header
forbids. Lead and appointment counts live on the lead fact, at the lead's own grain.

**Above 1.0** means a unit is advertised above its synthetic estimate and **below 1.0** beneath it. It
is a descriptive comparison against a generated reference. It is not evidence that a price is right or
wrong, and it must never drive a repricing recommendation — ARPI makes none.

---

## 16. `warehouse.fact_lead`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.fact_lead` |
| **Layer** | Warehouse (accumulating snapshot fact) |
| **Purpose** | One row per CRM opportunity, carrying the funnel milestone flags. This is the table the entire Lead Funnel page rests on. |
| **Declared grain** | **One row per unique CRM lead.** |
| **Primary key** | `lead_key` |
| **Natural / source key** | `lead_id` (`LEAD-#########`) |
| **Foreign keys** | `lead_created_date_key` → `dim_date`; `dealership_key`; `customer_key`; `vehicle_key` or `vehicle_model_key`; `lead_source_key`; `campaign_key`; `assigned_salesperson_key`, `assigned_bdc_employee_key` → `dim_employee` |
| **Implementation status** | **Implemented** |

### 16.1 Measures and flags

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `lead_count` | integer | no | `1` | Additive lead counter. | Constant 1. | Non-personal |
| `first_response_seconds` | integer | yes | ≥ 0 | Seconds between lead creation and first outbound response. **NULL means never responded to** — analytically different from zero, and the distinction matters for the "leads without follow-up" measure. | Generated. | Non-personal |
| `is_contacted` | boolean | no | `true` / `false` | Two-way contact established. | Generated. | Non-personal |
| `is_appointment_set` | boolean | no | `true` / `false` | An appointment was booked. | Generated. | Non-personal |
| `is_appointment_shown` | boolean | no | `true` / `false` | The customer showed. | Generated. | Non-personal |
| `is_sold` | boolean | no | `true` / `false` | Linked to a finalized retail sale. **May only be true when a valid transaction is linked.** | Derived. | Non-personal |
| `is_lost` | boolean | no | `true` / `false` | Closed without sale. | Generated. | Non-personal |
| `is_duplicate` | boolean | no | `true` / `false` | Duplicate of an earlier lead. **Duplicates are excluded from every funnel denominator.** | Generated. | Non-personal |
| `original_lead_id` | text | yes | `LEAD-#########` | The lead this row duplicates. NULL when not a duplicate. | Generated. | Synthetic identifier |
| `days_to_sale` | integer | yes | ≥ 0 | Days from lead creation to finalized sale. NULL when not sold. | Derived. | Non-personal |
| `vehicle_sale_key` | integer | yes | FK | Link to the resulting sale. NULL when not sold. | Derived. | Non-personal |

**No communication content is stored** — no message bodies, call recordings, transcripts, or notes.
Only response-time seconds ([ARCHITECTURE.md §22.4](ARCHITECTURE.md), `docs/research.md` §10.4).

### 16.2 Business rules

- First response cannot occur before lead creation.
- `is_sold = true` requires a resolvable `vehicle_sale_key`.
- `is_appointment_shown = true` implies `is_appointment_set = true`.
- `is_appointment_set = true` implies `is_contacted = true`.
- Response time influences contact probability; contact probability influences appointment probability;
  shown appointments convert at a higher rate than non-showroom leads
  ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)). These must be **influences, not deterministic rules** —
  perfect correlations are a prohibited synthetic pattern (§15.4).

### 16.3 PII classification

`Non-personal`, with `lead_id` and `original_lead_id` as `Synthetic identifier`.

### 16.4 History policy

**Accumulating snapshot.** Milestone flags on an open lead are updated in place as the lead progresses;
once the lead is closed the row is final.

---

## 17. `warehouse.fact_appointment`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.fact_appointment` |
| **Layer** | Warehouse (transaction fact) |
| **Purpose** | Isolates showroom appointment outcomes, which sit at a different grain from leads: one lead can generate several appointments. Show rate and show-to-sale conversion are computed here. |
| **Declared grain** | **One row per scheduled appointment.** |
| **Primary key** | `appointment_key` |
| **Natural / source key** | `appointment_id` |
| **Foreign keys** | `appointment_created_date_key`, `scheduled_date_key`, `show_date_key` → `dim_date`; `dealership_key`; `lead_key`; `customer_key`; `salesperson_key`, `bdc_employee_key` → `dim_employee`; `vehicle_key` or `vehicle_model_key` |
| **Implementation status** | **Implemented** |

### 17.1 Measures and flags

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `appointment_count` | integer | no | `1` | Additive appointment counter. | Constant 1. | Non-personal |
| `is_confirmed` | boolean | no | `true` / `false` | Appointment confirmed before the scheduled time. | Generated. | Non-personal |
| `is_shown` | boolean | no | `true` / `false` | Customer attended. | Generated. | Non-personal |
| `is_test_drive` | boolean | no | `true` / `false` | A test drive occurred. | Generated. | Non-personal |
| `is_write_up` | boolean | no | `true` / `false` | A deal was written up. | Generated. | Non-personal |
| `is_sold` | boolean | no | `true` / `false` | Linked to a finalized sale. | Derived. | Non-personal |
| `is_canceled_before_scheduled` | boolean | no | `true` / `false` | Canceled before the scheduled date. **Determines eligibility for the show-rate denominator** — see [KPI_CATALOG.md](KPI_CATALOG.md) `KPI-FUN-004`. | Generated. | Non-personal |
| `minutes_early_or_late` | integer | yes | Negative = early, positive = late | Punctuality relative to the scheduled time. NULL when the customer did not show. | Generated. | Non-personal |
| `vehicle_sale_key` | integer | yes | FK | Resulting sale. NULL when not sold. | Derived. | Non-personal |

### 17.2 Business rules

- Show date cannot precede appointment creation.
- Sold appointments must link to a finalized vehicle sale.
- `is_shown = true` implies `show_date_key` is populated and `is_canceled_before_scheduled = false`.
- `is_write_up = true` implies `is_shown = true`.
- Impossible appointment sequences are a prohibited synthetic pattern
  ([ARCHITECTURE.md §15.4](ARCHITECTURE.md)).

### 17.3 PII classification

`Non-personal` throughout.

### 17.4 History policy

**Insert-only transaction fact**, with outcome flags finalized once the scheduled date has passed.

---

## 18. `warehouse.fact_marketing_spend`

| Field | Value |
|---|---|
| **Entity name** | `warehouse.fact_marketing_spend` |
| **Layer** | Warehouse (periodic fact) |
| **Purpose** | Monthly marketing investment by store and campaign. The denominator for cost-per-lead and cost-per-sale, and the divisor for gross return on advertising spend. |
| **Declared grain** | **One row per dealership, campaign, and calendar month.** |
| **Primary key** | Composite `(month_date_key, dealership_key, campaign_key)` |
| **Natural / source key** | Composite of month, `dealership_id`, and `campaign_id` |
| **Foreign keys** | `month_date_key` → `dim_date`; `dealership_key`; `campaign_key`; `lead_source_key` |
| **Implementation status** | **Implemented** |

### 18.1 Measures

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `spend_amount` | numeric(12,2) | no | ≥ 0 | Marketing spend for the month. **Non-negative by rule** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). | Generated. | Non-personal |
| `impressions` | bigint | yes | ≥ 0 | Impressions delivered. NULL where the channel does not report impressions. | Generated. | Non-personal |
| `clicks` | bigint | yes | ≥ 0 | Clicks. NULL where not applicable. | Generated. | Non-personal |
| `calls` | integer | yes | ≥ 0 | Inbound calls attributed by the vendor. NULL where not applicable. | Generated. | Non-personal |
| `form_submissions` | integer | yes | ≥ 0 | Form submissions attributed by the vendor. NULL where not applicable. | Generated. | Non-personal |
| `vendor_reported_leads` | integer | yes | ≥ 0 | Leads the vendor claims. **Deliberately allowed to differ from the CRM lead count** — that discrepancy is itself an analytical finding, and reconciling the two is a documented objective, not a defect. | Generated. | Non-personal |

### 18.2 Business rules

- `month_date_key` always points at the **first day of the month** so that monthly rows join cleanly to
  `dim_date`.
- `spend_amount` is non-negative.
- Grain uniqueness on `(month_date_key, dealership_key, campaign_key)`.
- Marketing spend is monthly; lead and sale facts are daily. **Cost-per-lead must therefore be computed at
  month grain or coarser**, never at day grain. This is recorded as an interpretation caution in
  [KPI_CATALOG.md](KPI_CATALOG.md).

### 18.3 PII classification

`Non-personal` throughout.

### 18.4 History policy

**Insert-only periodic fact.** A restated month is handled by deleting and reloading that month.

---

# Part D — Implemented audit objects

> Column contracts in this part are exact and binding.

---

## 19. `audit.pipeline_run`

| Field | Value |
|---|---|
| **Entity name** | `audit.pipeline_run` |
| **Layer** | Audit |
| **Purpose** | The parent record for every pipeline execution. Every validation result, row count, reconciliation, and rejected record hangs off this table, so that any figure in the warehouse can be traced back to the run that produced it. |
| **Declared grain** | **One row per pipeline execution _attempt_.** Two executions with identical inputs are two attempts and produce two rows, sharing one `logical_run_key`. See [ADR-0010](docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md). |
| **Primary key** | `pipeline_run_id` (`bigserial`) |
| **Natural / source key** | `run_uuid` (unique) — execution identity |
| **Foreign keys** | None (parent) |
| **Implementation status** | **Implemented** |

### 19.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `pipeline_run_id` | `bigserial` PK | no | ≥ 1 | Database-assigned run identifier. | Database sequence. | Non-personal |
| `run_uuid` | `uuid` UNIQUE | no | UUIDv4 | **Execution identity.** Identifies **one execution attempt**, random and never reused. Lets the Python side reference a run before the database row is visible, and makes runs correlatable across logs. Two runs with identical inputs get *different* values — that is what keeps both attempts in the history. | Generated at run start (`build_execution_uuid`). | Non-personal |
| `logical_run_key` | `uuid` | no | UUIDv5 | **Logical-run identity.** A deterministic fingerprint of `(pipeline_name, profile_name, random_seed, reporting start, reporting end)`. Every execution asked to do the same thing shares it, so it is deliberately **not unique** here. Group by it to compare attempts. Never an upsert conflict target. `arpi_version` is deliberately excluded, so a run can be compared across an upgrade. | Derived at run start (`build_logical_run_key`). | Non-personal |
| `pipeline_name` | `text` | no | Free text | Which pipeline ran. | Supplied by the caller. | Non-personal |
| `profile_name` | `text` | no | `development` \| `test` \| `portfolio` | Configuration profile in force. | From configuration. | Non-personal |
| `run_mode` | `text` | no | Free text | Execution mode, for example a full rebuild or a validation-only run ([ARCHITECTURE.md §17.2](ARCHITECTURE.md)). | Supplied by the caller. | Non-personal |
| `random_seed` | `bigint` | no | Integer | The seed in force. **Recorded so that any run is exactly reproducible from its audit row.** | From configuration. | Non-personal |
| `arpi_version` | `text` | no | Semantic version | Package version that produced the run. | From the package metadata. | Non-personal |
| `started_at` | `timestamptz` | no | UTC timestamp | Run start. | Wall clock. | Non-personal |
| `completed_at` | `timestamptz` | yes | UTC timestamp | Run completion. **NULL means the run is still in flight or terminated abnormally.** | Wall clock. | Non-personal |
| `status` | `text` | no | `running` \| `succeeded` \| `failed` \| `aborted` (CHECK constrained) | Terminal or in-flight state. | Set by the pipeline. | Non-personal |
| `critical_failure_count` | `integer` | no | ≥ 0, default `0` | Number of critical validation failures. **Non-zero means the run must not be trusted.** | Counted. | Non-personal |
| `warning_count` | `integer` | no | ≥ 0, default `0` | Number of warnings. | Counted. | Non-personal |
| `notes` | `text` | yes | Free text | Operator notes. NULL when none. | Supplied by the caller. | Non-personal |

> **Note on timestamps.** `started_at` and `completed_at` are wall-clock values and are therefore the one
> place ARPI deliberately admits non-determinism. They are *audit* metadata, never inputs to a KPI, and they
> are excluded from `generation_manifest.json` precisely so that generated data stays byte-reproducible.
> See [DATA_GENERATION.md](DATA_GENERATION.md).

### 19.2 Business rules

- `completed_at >= started_at` when both are present.
- `status = 'running'` implies `completed_at IS NULL`.
- `run_uuid` is unique. It identifies one attempt.
- `logical_run_key` is **not** unique. A unique constraint on it would reintroduce the collapsed-history defect ADR-0010 corrects.
- A run with `critical_failure_count > 0` must not end with `status = 'succeeded'`.

### 19.3 PII classification / history policy

`Non-personal` throughout. **Insert-only**: the run is tracked in memory for the whole execution and
written once, at the end of the database load, already carrying its terminal `status` and `completed_at`.
Every execution inserts its own row. A rerun, a retry after a failure, and a rerun under a newer ARPI
version each add a row rather than overwriting one, so `completed_at - started_at`, `arpi_version` and
`run_mode` always describe exactly one attempt. Rows are never updated by a later attempt and never purged
([ARCHITECTURE.md §17.3](ARCHITECTURE.md), [ADR-0010](docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md)).

Warehouse idempotency does not depend on this table. It is carried by deterministic generated source data,
natural and source keys, surrogate-key resolution, the dimension merges, attribute hashes and unique grain
constraints — so a rerun still produces no duplicate warehouse row while the audit layer records that it
happened twice.

**Historical limitation.** Rows written before ADR-0010 may each represent several collapsed attempts. The
migration backfills their `logical_run_key` correctly, but the attempts that were overwritten cannot be
recovered and were not invented. See [LIMITATIONS.md](LIMITATIONS.md).

---

## 20. `audit.pipeline_run_row_count`

| Field | Value |
|---|---|
| **Entity name** | `audit.pipeline_run_row_count` |
| **Layer** | Audit |
| **Purpose** | Row counts per layer for every entity in a run. The table is designed to hold the full source → raw → staging → warehouse path plus rejects; **Phase 0 populates only `source`, `raw` and `warehouse`** (see §20.2). |
| **Declared grain** | **One row per pipeline run, entity, and layer.** |
| **Primary key** | Composite `(pipeline_run_id, entity_name, layer)` |
| **Natural / source key** | Same composite |
| **Foreign keys** | `pipeline_run_id` → `audit.pipeline_run` |
| **Implementation status** | **Implemented** |

### 20.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `pipeline_run_id` | `bigint` FK | no | Existing run | Owning run. | Set by the loader. | Non-personal |
| `entity_name` | `text` | no | Entity name, for example `dim_date` | Entity being counted. | Set by the loader. | Non-personal |
| `layer` | `text` | no | `source` \| `raw` \| `staging` \| `warehouse` \| `rejected` (CHECK constrained). Phase 0 writes only `source`, `raw`, `warehouse`. | Layer at which the count was taken. | Set by the pipeline (`source`) and the loader (`raw`, `warehouse`). | Non-personal |
| `row_count` | `bigint` | no | ≥ 0 | Rows observed. | Counted. | Non-personal |
| `recorded_at` | `timestamptz` | no | UTC timestamp | When the count was taken. | Wall clock. | Non-personal |

### 20.2 Business rules

- `row_count` is non-negative.
- **Phase 0 records three of the five layers.** `source` is recorded by `src/arpi/pipeline.py`; `raw` and
  `warehouse` are recorded by `src/arpi/ingestion/loader.py`. **No `staging` or `rejected` row count is
  recorded by any code path**, so [ARCHITECTURE.md §21.4](ARCHITECTURE.md), which requires both, is not yet
  satisfied. This is a registered gap — see [LIMITATIONS.md §9.1](LIMITATIONS.md) and
  [docs/requirements/DOCUMENTATION_BACKLOG.md](docs/requirements/DOCUMENTATION_BACKLOG.md).
- Because the `raw` and `warehouse` counts are written only by the database loader, a run that skips the
  optional database load records the `source` layer alone.
- For a clean run: `source = raw = warehouse`, and `rejected` would be `0` if it were recorded, because
  `validation.max_rejected_record_ratio` is `0.0` for the Phase 0 slice.
- This table supports the two implemented row-count reconciliations, `RECON-DIM-DATE-ROWCOUNT` and
  `RECON-DIM-DEALERSHIP-ROWCOUNT` (see [KPI_CATALOG.md §36](KPI_CATALOG.md)). Note that those
  reconciliations do not read this table: each compares the generator's in-memory row count with a live
  `count(*)` against the warehouse table. This table is the durable record of the same numbers.

### 20.3 PII classification / history policy

`Non-personal`. Written by upsert: a rerun of the same logical run replaces the counts for its
`(pipeline_run_id, entity_name, layer)` keys rather than appending duplicates.

---

## 21. `audit.validation_result`

| Field | Value |
|---|---|
| **Entity name** | `audit.validation_result` |
| **Layer** | Audit |
| **Purpose** | One row per data-quality check evaluation. Turns "the data is good" into an auditable, per-check, per-run record. Feeds `reporting.vw_data_quality_summary` and, later, the Power BI Data Quality page. |
| **Declared grain** | **One row per validation check evaluation per pipeline run.** |
| **Primary key** | `validation_result_id` (`bigserial`) |
| **Natural / source key** | `(pipeline_run_id, check_id, target_object)` |
| **Foreign keys** | `pipeline_run_id` → `audit.pipeline_run` |
| **Implementation status** | **Implemented** |

### 21.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `validation_result_id` | `bigserial` PK | no | ≥ 1 | Surrogate key. | Database sequence. | Non-personal |
| `pipeline_run_id` | `bigint` FK | no | Existing run | Owning run. | Set by the validator. | Non-personal |
| `check_id` | `text` | no | `DQ-*` identifiers (see 21.2) | Stable check identifier. **Shared between Python and SQL** so the same check has the same ID wherever it runs. | Constant per check. | Non-personal |
| `check_name` | `text` | no | Free text | Human-readable check name. | Constant per check. | Non-personal |
| `check_category` | `text` | no | `structural` \| `completeness` \| `uniqueness` \| `referential` \| `business_rule` \| `privacy` \| `reproducibility` (CHECK constrained — see 21.1.1) | Grouping for the data-quality summary. | Constant per check. | Non-personal |
| `target_object` | `text` | no | Entity or object name | What was checked. | Set by the validator. | Non-personal |
| `severity` | `text` | no | `critical` \| `warning` \| `info` (CHECK constrained) | **`critical` failures fail the run**; warnings do not. | Constant per check. | Non-personal |
| `status` | `text` | no | `passed` \| `failed` \| `skipped` (CHECK constrained) | Outcome. `skipped` is recorded explicitly so a silently absent check is distinguishable from a passing one. | Set by the validator. | Non-personal |
| `observed_value` | `numeric` | yes | — | What was measured. NULL for checks that are not numeric. | Measured. | Non-personal |
| `expected_value` | `numeric` | yes | — | What was expected. NULL for checks that are not numeric. | Constant or configured. | Non-personal |
| `failed_record_count` | `bigint` | no | ≥ 0, default `0` | How many records failed. | Counted. | Non-personal |
| `message` | `text` | yes | Free text | Explanatory message. NULL when none. | Set by the validator. | Non-personal |
| `evaluated_at` | `timestamptz` | no | UTC timestamp | When the check ran. | Wall clock. | Non-personal |

### 21.1.1 The canonical category vocabulary

**There are exactly seven categories, and there is one authority for them:**
`CHECK_CATEGORIES` in `src/arpi/constants.py`.

| Category | What it asserts | Example |
|---|---|---|
| `structural` | The shape of the data or of the catalogue: declared columns, their order, the presence of the constraints that enforce a grain. | `DQ-GEN-001`, `DQ-REF-004` |
| `completeness` | Nothing is missing: no NULL in a required column, no gap in a sequence. | `DQ-DATE-002`, `DQ-DATE-004`, `DQ-REF-003` |
| `uniqueness` | A key identifies one thing. | `DQ-DATE-001`, `DQ-DLR-001`, `DQ-DLR-002` |
| `referential` | A row resolves to the row it claims to belong to, and a declared grain holds. | `DQ-REF-001`, `DQ-AUD-001` |
| `business_rule` | A rule from the business domain rather than from the schema. | `DQ-DLR-005`, `DQ-DATE-005` |
| `privacy` | No prohibited personal-data column exists. See [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). | `DQ-DLR-004` |
| `reproducibility` | The output can be regenerated and the claim can be recomputed. | `DQ-GEN-002` |

**`reconciliation` is deliberately not a category.** A reconciliation compares two totals
and is a different kind of evidence; it lives in `audit.reconciliation_result` (§22).

**How this stays fixed.** The column carries the CHECK constraint
`ck_validation_result_check_category` over exactly these seven values, so a new spelling is
rejected on INSERT rather than quietly becoming an eighth vocabulary. `sql/08_validation/`
emits the same strings, and `src/arpi/validation/registry.py` records one per check. A test
reads the constraint definition out of `pg_constraint` and asserts it equals the Python set,
so the two cannot drift apart silently.

Earlier revisions used four incompatible vocabularies — the gap recorded as `DOC-24`. The
retired spellings and their replacements are:

| Retired spelling | Canonical category | Note |
|---|---|---|
| `schema` | `structural` | Except `DQ-DLR-004`, which becomes `privacy`: it is the privacy tripwire, and its Python implementation always said so. |
| `domain` | `business_rule` | Named only in a `COMMENT ON COLUMN`; nothing emitted it. |
| `determinism` | `reproducibility` | Documented in this file; nothing emitted it. |

`sql/00_database/03_audit_tables.sql` performs that rewrite idempotently before adding the
constraint, so an existing database is migrated by re-running the initialisation sequence and
no historical audit row is deleted. A row carrying an unmapped spelling is **not** guessed at:
the constraint fails loudly and names it.

### 21.2 Check register

**`src/arpi/validation/registry.py` is the canonical register.** Every `DQ-*` identifier the
platform can emit is declared there exactly once, whether it is evaluated in pandas, in SQL,
or in both, together with its category, severity, implementing layer, entity and the reason
it exists. The tables below are the human-readable rendering of that module; a test asserts
that every identifier emitted at runtime is registered, so the two cannot diverge.

#### 21.2.1 Family prefixes

A prefix is reserved before any check uses it, so that entities built in parallel cannot
collide on an ordinal. Identifiers match `^DQ-[A-Z]{3,4}-\d{3}$`.

| Prefix | Entity or area | Status |
|---|---|---|
| `DQ-DATE-*` | `dim_date` | **Implemented** |
| `DQ-DLR-*` | `dim_dealership` | **Implemented** |
| `DQ-GEN-*` | Cross-entity generation: schema conformance, determinism digest | **Implemented** |
| `DQ-REF-*` | Cross-object referential and grain integrity (SQL) | **Implemented** |
| `DQ-AUD-*` | Audit-layer integrity (SQL) | **Implemented** |
| `DQ-VMD-*` | `dim_vehicle_model` | **Implemented** |
| `DQ-VEH-*` | `dim_vehicle` | **Implemented** |
| `DQ-EMP-*` | `dim_employee` | **Implemented** |
| `DQ-CUS-*` | `dim_customer` | **Implemented** |
| `DQ-ACQ-*` | `acquisition_event` (inventory acquisition source entity) | **Implemented** |
| `DQ-SLE-*` | `fact_vehicle_sale` | **Implemented** |
| `DQ-INV-*` | `fact_vehicle_inventory_snapshot` | **Implemented** |
| `DQ-LDS-*` | `dim_lead_source` | **Implemented** |
| `DQ-LED-*` | `fact_lead` | **Implemented** |
| `DQ-APT-*` | `fact_appointment` | **Implemented** |
| `DQ-CMP-*` | `dim_marketing_campaign` | **Implemented** |
| `DQ-MKT-*` | `fact_marketing_spend` | **Implemented** |
| `DQ-ING-*` | Ingestion and the row-count chain | Reserved — the chain is covered by the `RECON-INGEST-*` reconciliations instead |

Reserving a prefix is **not** a claim that any check in that family exists. Fourteen families emit checks
on a `development` run today — 114 results in total, of which 0 are critical failures. `DQ-ING-*` remains a
reserved name: the ingestion row-count chain turned out to be reconciliation evidence rather than
data-quality evidence, and is covered by `RECON-INGEST-*` in `audit.reconciliation_result`. The two kinds
are deliberately kept apart, and `reconciliation` is not a check category.

#### 21.2.2 Registered checks

| `check_id` | Assertion | Category | Target | Severity | Layer |
|---|---|---|---|---|---|
| `DQ-DATE-001` | `date_key` is unique | `uniqueness` | `dim_date` | critical | both |
| `DQ-DATE-002` | The date range is contiguous — no missing days | `completeness` | `dim_date` | critical | both |
| `DQ-DATE-003` | `date_key` equals `full_date` formatted `YYYYMMDD` | `business_rule` | `dim_date` | critical | both |
| `DQ-DATE-004` | No required field is NULL | `completeness` | `dim_date` | critical | both |
| `DQ-DATE-005` | Selling-day ratio is within the configured tolerance | `business_rule` | `dim_date` | warning | both |
| `DQ-DLR-001` | `dealership_key` is unique | `uniqueness` | `dim_dealership` | critical | both |
| `DQ-DLR-002` | `dealership_id` is unique among current rows | `uniqueness` | `dim_dealership` | critical | both |
| `DQ-DLR-003` | Store count matches `generation.store_count` | `business_rule` | `dim_dealership` | critical | both |
| `DQ-DLR-004` | No prohibited PII column is present | `privacy` | `dim_dealership` | critical | both |
| `DQ-DLR-005` | `franchise_brand` is present for franchise stores | `business_rule` | `dim_dealership` | critical | both |
| `DQ-GEN-001` | The declared schema matches the output schema | `structural` | all generated entities | critical | Python |
| `DQ-GEN-002` | The determinism digest is recorded | `reproducibility` | all generated entities | **info** | Python |

**`DQ-GEN-002` is `info`, not a gate.** It records the SHA-256 digest of each entity's canonical CSV
rendering so a reviewer can recompute it; it does not compare that digest against a stored expectation,
because no such expectation exists in the repository. An `info` result never fails a run and never
contributes to `critical_failure_count`. The determinism *guarantee* is enforced elsewhere — by the seeded
generators, by the timestamp-free manifest, and by the test suite — not by this check. Treating it as a
gating control would overstate what it does.

**Ten of these twelve checks are shared between the Python and SQL layers.** `DQ-GEN-001` and `DQ-GEN-002`
are **Python-only, by design**: both inspect the generator's in-memory output — the declared-versus-actual
column list, and the digest of the CSV bytes before they are written — so there is nothing for SQL to
observe. They have no counterpart in `sql/08_validation/`. All ten `DQ-DATE-*` and `DQ-DLR-*` checks do
appear verbatim in both layers.

**SQL-only check families.** The SQL validation layer (`sql/08_validation/`) implements two further
families that have no Python counterpart, because they assert properties only the database can observe —
catalogue state and cross-table referential integrity. Until `DOC-21` was closed these appeared in no
shared register at all; they are now registered in `src/arpi/validation/registry.py` alongside every other
check, because a register that is incomplete stops being a register.

| `check_id` | Assertion | Category | Target | Severity | Layer |
|---|---|---|---|---|---|
| `DQ-REF-001` | `warehouse.dim_date` grain is unique on `full_date` | `referential` | `dim_date` | critical | SQL |
| `DQ-REF-002` | `warehouse.dim_dealership` grain is unique on `(dealership_id, effective_date)` | `referential` | `dim_dealership` | critical | SQL |
| `DQ-REF-003` | `warehouse.dim_date` has no gaps in its date sequence | `completeness` | `dim_date` | critical | SQL |
| `DQ-REF-004` | The constraints that enforce these grains are actually present in the catalogue | `structural` | `warehouse`, `audit` | critical | SQL |
| `DQ-REF-005` | Every store's SCD Type 2 timeline is contiguous and non-overlapping | `referential` | `dim_dealership` | critical | SQL |
| `DQ-AUD-001` | Every `audit.validation_result` resolves to an `audit.pipeline_run` | `referential` | `audit.validation_result` | critical | SQL |
| `DQ-AUD-002` | Every `audit.rejected_record` resolves to an `audit.pipeline_run` | `referential` | `audit.rejected_record` | critical | SQL |
| `DQ-AUD-003` | Every `audit.pipeline_run_row_count` resolves to an `audit.pipeline_run` | `referential` | `audit.pipeline_run_row_count` | critical | SQL |
| `DQ-AUD-004` | Every `audit.reconciliation_result` resolves to an `audit.pipeline_run` | `referential` | `audit.reconciliation_result` | critical | SQL |
| `DQ-AUD-005` | No run is internally inconsistent — finished before it started, or otherwise self-contradictory | `business_rule` | `audit.pipeline_run` | warning | SQL |

**`DQ-AUD-005` is `warning`, not `critical`.** This table previously said `critical`, which the SQL view
never emitted. A run that died without updating its own row is a defect worth reporting, but the data that
run produced may still be sound, so it does not gate.

**The `DQ-REF-003` / `DQ-DATE-002` overlap is deliberate**, and is now recorded as the `overlaps_with`
field on both definitions rather than left as folklore. `DQ-DATE-002` compares a row count against the
span of the reporting window, which detects **that** dates are missing. `DQ-REF-003` uses a window
function to find **where** they are missing and reports the first gap, so it can be fixed rather than
merely noticed. Two methods, two identifiers, one stated relationship.

These are exposed through the helper views `audit.vw_dq_dim_date`, `audit.vw_dq_dim_dealership`,
`audit.vw_dq_referential`, `audit.vw_dq_audit`, and `audit.vw_dq_all`, all shaped by
`audit.vw_dq_result_template`. All six appear in the entity index (§4). They are query helpers over the
audit schema, not part of the reporting boundary — `arpi_reporter` reads validation outcomes through
`reporting.vw_data_quality_summary`.

#### 21.2.3 Adding a check

A module that implements a new family registers its own checks; nobody edits the registry module.

```python
from arpi.validation.registry import CheckDefinition, CheckLayer, register_checks
```

`register_check(definition)` refuses a malformed identifier, an unreserved prefix, a non-canonical
category, an empty name, entity or description, a check that applies to nothing, and — importantly — a
second registration of an identifier that is already taken. Two entities built in parallel therefore
cannot silently collide on `DQ-INV-001`; the second one fails at import time. See the module docstring in
`src/arpi/validation/registry.py`.

### 21.3 Business rules

- `severity = 'critical'` and `status = 'failed'` must increment `audit.pipeline_run.critical_failure_count`.
- `status = 'passed'` implies `failed_record_count = 0`.
- `check_category` must be one of the seven canonical categories (§21.1.1), enforced by
  `ck_validation_result_check_category`.
- Every check in the register above must produce a row on every run, including `skipped` rows. A check that
  produces no row is itself a defect, because a silently absent check reads exactly like a passing one.
  This is no longer left to each suite to remember: `arpi.validation.datasets.ensure_registry_coverage`
  reconciles a run's report against `CHECK_REGISTRY` and fills any gap with an explicit `skipped` row that
  says why.

### 21.4 PII classification / history policy

`Non-personal`. **Replace-on-rerun**: the loader issues
`DELETE FROM audit.validation_result WHERE pipeline_run_id = %s` before re-inserting, so a rerun of the
same logical run describes its latest execution rather than accumulating duplicate check results. Other
runs' rows are never touched. See [STM-003 §8.1](docs/source-to-target/STM-003-audit-metadata.md).

---

## 22. `audit.reconciliation_result`

| Field | Value |
|---|---|
| **Entity name** | `audit.reconciliation_result` |
| **Layer** | Audit |
| **Purpose** | Records two-sided total comparisons — the evidence that numbers agree across layers and, later, across SQL and Power BI. |
| **Declared grain** | **One row per reconciliation evaluation per pipeline run.** |
| **Primary key** | `reconciliation_result_id` (`bigserial`) |
| **Natural / source key** | `(pipeline_run_id, reconciliation_id)` |
| **Foreign keys** | `pipeline_run_id` → `audit.pipeline_run` |
| **Implementation status** | **Implemented** |

### 22.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `reconciliation_result_id` | `bigserial` PK | no | ≥ 1 | Surrogate key. | Database sequence. | Non-personal |
| `pipeline_run_id` | `bigint` FK | no | Existing run | Owning run. | Set by the loader. | Non-personal |
| `reconciliation_id` | `text` | **yes** | `RECON-*` identifiers | Stable reconciliation identifier. Nullable in the DDL; always supplied by the loader. | Constant per reconciliation. | Non-personal |
| `description` | `text` | **yes** | Free text | What is being compared, in business terms. Nullable in the DDL; always supplied by the loader. | Constant per reconciliation. | Non-personal |
| `left_source` | `text` | **yes** | Object or query name, e.g. `generator:dim_date` | Left-hand side identity. Nullable in the DDL; always supplied by the loader. | Set by the loader. | Non-personal |
| `left_value` | `numeric` | **yes** | — | Left-hand total. Nullable in the DDL; a NULL would propagate into the generated `difference`, so the loader never omits it. | Measured. | Non-personal |
| `right_source` | `text` | **yes** | Object or query name, e.g. `warehouse.dim_date` | Right-hand side identity. Nullable in the DDL; always supplied by the loader. | Set by the loader. | Non-personal |
| `right_value` | `numeric` | **yes** | — | Right-hand total. Nullable in the DDL; a NULL would propagate into the generated `difference`, so the loader never omits it. | Measured. | Non-personal |
| `difference` | `numeric` **GENERATED ALWAYS AS (`left_value − right_value`) STORED** | yes | — | Signed difference. Database-generated so it can never drift from its inputs; NULL if either side is NULL. | Generated column. | Non-personal |
| `tolerance` | `numeric` | no | ≥ 0, default `0` | Permitted absolute difference. Zero for count reconciliations. | Configured. | Non-personal |
| `status` | `text` | **yes** | `passed` \| `failed` (CHECK constrained) | Outcome. There is no `warning` here: totals either reconcile within tolerance or they do not. Nullable in the DDL — a CHECK of the form `status IN (…)` is satisfied vacuously by NULL — but always supplied by the loader. | Set by the loader. | Non-personal |
| `evaluated_at` | `timestamptz` | **yes** | UTC timestamp, default `now()` | When the reconciliation ran. Nullable in the DDL, but the loader omits the column from its INSERT so the `now()` default always populates it. | Database default. | Non-personal |

> **Nullability here is looser than the values ever are.** Eight of these columns are nullable in
> `sql/00_database/03_audit_tables.sql` even though the loader supplies every one of them on every write.
> The DDL is the authority for what the database will accept; this table now matches it. The columns that
> *must* be trusted structurally — the primary key, the foreign key, and `tolerance` — are the ones that
> carry `NOT NULL`.

### 22.2 Business rules

- `status = 'passed'` if and only if `abs(difference) <= tolerance`.
- Monetary reconciliations use `validation.numeric_absolute_tolerance` (0.01) and
  `validation.numeric_relative_tolerance` (0.001).
- Count reconciliations use `tolerance = 0`.
- Both Phase 0 reconciliations — `RECON-DIM-DATE-ROWCOUNT` and `RECON-DIM-DEALERSHIP-ROWCOUNT` — are count
  reconciliations, so both run at `tolerance = 0` ([KPI_CATALOG.md §36](KPI_CATALOG.md)).

### 22.3 PII classification / history policy

`Non-personal`. **Insert-only, scoped to the attempt.** Every execution attempt owns a distinct
`pipeline_run_id`, so a rerun's reconciliation results are recorded alongside — never on top of — the
previous attempt's. `audit.fn_record_all_reconciliations` still deletes by `pipeline_run_id` before
inserting, which now guards only one case: the same function being called twice *within* a single
execution, which must restate its verdicts rather than double them. Rows belonging to any other run,
including an earlier attempt at the same logical run, are never touched.
See [STM-003 §8.1](docs/source-to-target/STM-003-audit-metadata.md).

---

## 23. `audit.rejected_record`

| Field | Value |
|---|---|
| **Entity name** | `audit.rejected_record` |
| **Layer** | Audit |
| **Purpose** | Quarantine for source records that failed structural validation. Nothing is silently discarded: a rejected record is preserved with its payload and a reason, so the rejection can be reviewed and the generator or mapping fixed. |
| **Declared grain** | **One row per rejected source record per pipeline run.** |
| **Primary key** | `rejected_record_id` (`bigserial`) |
| **Natural / source key** | `(pipeline_run_id, source_entity, source_record_key)` — `source_record_key` may be NULL when the record is too malformed to identify |
| **Foreign keys** | `pipeline_run_id` → `audit.pipeline_run` |
| **Implementation status** | **Implemented** |

### 23.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `rejected_record_id` | `bigserial` PK | no | ≥ 1 | Surrogate key. | Database sequence. | Non-personal |
| `pipeline_run_id` | `bigint` FK | no | Existing run | Owning run. | Set by the loader. | Non-personal |
| `source_entity` | `text` | no | Entity name | Which source entity the record came from. | Set by the loader. | Non-personal |
| `source_record_key` | `text` | yes | Natural key or row number | Identity of the rejected record. **NULL when the record is too malformed to identify** — the payload still preserves it. | Set by the loader. | Non-personal |
| `rejection_code` | `text` | no | `REJ-*` codes (see [docs/source-to-target/](docs/source-to-target/README.md)) | Machine-readable reason. | Set by the loader. | Non-personal |
| `rejection_reason` | `text` | **yes** | Free text | Human-readable reason. Nullable in the DDL; `rejection_code` beside it is `NOT NULL`, so a rejection is never wholly unexplained even without the prose. | Set by the loader. | Non-personal |
| `record_payload` | `jsonb` | yes | JSON object | The offending record as received. NULL where the payload cannot be serialized. **Because all source data is synthetic, storing the payload carries no privacy risk** — this would be a very different decision with real data. | Captured verbatim. | Non-personal |
| `rejected_at` | `timestamptz` | no | UTC timestamp | When the rejection occurred. | Wall clock. | Non-personal |

### 23.2 Business rules

- The rejected-record ratio must not exceed `validation.max_rejected_record_ratio` (0.0 for the Phase 0
  slice). **Any rejection at all fails a Phase 0 run**, because the Phase 0 source data is generated by
  ARPI itself and there is no legitimate reason for it to be malformed.
- Every rejection carries a code (`NOT NULL`) and, in practice, a reason (nullable in the DDL, always
  written by the loader).
- **This table is always empty in Phase 0.** The generators emit only contract-shaped rows, so no code path
  can produce a rejection. The table exists as a contract for the ingestion work in Phase 1.2.

### 23.3 PII classification / history policy

`Non-personal`. Insert-only, retained across runs. Unlike `audit.validation_result` and
`audit.reconciliation_result`, this table is **not** cleared on a rerun — nothing writes to it in Phase 0,
so there is nothing to replace.

---

# Part E — Implemented raw and staging objects

---

## 24. Raw layer (Phase 0 slice)

**Design principle.** Raw tables preserve source records without business transformation
([ARCHITECTURE.md §10.2](ARCHITECTURE.md)). **Every business column is `text`**, deliberately: a type
failure should surface as a validated, rejected record with a readable reason, not as a load crash with no
diagnostic. Raw tables never serve Power BI.

### 24.1 `raw.calendar_date_load`

| Field | Value |
|---|---|
| **Layer** | Raw |
| **Purpose** | Landing table for `dim_date.csv`. |
| **Declared grain** | **One row per source CSV row per load batch.** Reloading the same file appends a new batch; it does not replace the old one. |
| **Primary key** | `raw_record_id` |
| **Natural / source key** | `(load_batch_id, source_row_number)` |
| **Implementation status** | **Implemented** |

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `raw_record_id` | `bigserial` PK | no | ≥ 1 | Surrogate key. | Database sequence. | Non-personal |
| `load_batch_id` | `uuid` | no | UUID | Identifies the load batch. Load batches must have unique identifiers ([ARCHITECTURE.md §17.3](ARCHITECTURE.md)). | Generated per load. | Non-personal |
| `source_file_name` | `text` | no | File name | Which file the row came from. | Captured at load. | Non-personal |
| `source_row_number` | `integer` | no | ≥ 1 | 1-based row number within the file, excluding the header. | Captured at load. | Non-personal |
| `ingested_at` | `timestamptz` | no | UTC timestamp, default `now()` | When the row landed. | Database default. | Non-personal |
| *all 26 business columns from `warehouse.dim_date`* | `text` | yes | Uncast source text | Same names and order as section 6.1, all as `text`, all nullable at this layer. | From the CSV. | Non-personal |

### 24.2 `raw.dealership_load`

| Field | Value |
|---|---|
| **Layer** | Raw |
| **Purpose** | Landing table for `dim_dealership.csv`. |
| **Declared grain** | **One row per source CSV row per load batch.** |
| **Primary key** | `raw_record_id` |
| **Natural / source key** | `(load_batch_id, source_row_number)` |
| **Implementation status** | **Implemented** |

Structure is identical to 24.1, except that the business columns are the 16 columns of
`warehouse.dim_dealership` from section 7.1, in that order, all as `text`.

**Privacy note.** `DQ-DLR-004` inspects this table's *schema* as well as the warehouse table's. A
prohibited column cannot enter the warehouse through the raw layer unnoticed.

### 24.3 Raw-layer business rules

- Business columns are never constrained at the raw layer beyond being `text`.
- Raw tables are truncate-and-reload per batch in the Phase 0 slice; see
  [docs/source-to-target/](docs/source-to-target/README.md).
- No grant is issued to `arpi_reporter` on schema `raw`
  ([ARCHITECTURE.md §22.2](ARCHITECTURE.md)).

---

## 25. Staging layer (Phase 0 slice)

**Design principle.** Both staging objects are **views** (`CREATE OR REPLACE VIEW`), not tables. They cast
raw text to warehouse types and expose **only the most recent `load_batch_id`**. Making them views means
staging can never drift out of sync with raw, and there is no second copy of the data to keep consistent.

### 25.1 `staging.stg_calendar_date`

| Field | Value |
|---|---|
| **Layer** | Staging (view) |
| **Purpose** | Typed, current-batch projection of `raw.calendar_date_load`. |
| **Declared grain** | **One typed row per calendar date in the most recent load batch.** |
| **Primary key** | `date_key` (logical; a view carries no constraint) |
| **Natural / source key** | `full_date` |
| **Implementation status** | **Implemented** |

Columns: the 26 columns of section 6.1, cast to the exact warehouse types listed there, plus the lineage
columns `load_batch_id`, `source_file_name`, `source_row_number`, and `ingested_at`.

### 25.2 `staging.stg_dealership`

| Field | Value |
|---|---|
| **Layer** | Staging (view) |
| **Purpose** | Typed, current-batch projection of `raw.dealership_load`. |
| **Declared grain** | **One typed row per dealership in the most recent load batch.** |
| **Primary key** | `dealership_id` (logical) |
| **Natural / source key** | `dealership_id` |
| **Implementation status** | **Implemented** |

Columns: the 16 columns of section 7.1, cast to the exact warehouse types listed there, plus the same four
lineage columns.

### 25.3 Staging-layer business rules

- The "most recent batch" is the batch with the greatest `ingested_at`; ties are broken by
  `load_batch_id` so the result is deterministic.
- Structurally invalid records are rejected here, not in the warehouse
  ([ARCHITECTURE.md §10.2](ARCHITECTURE.md)).
- Staging deduplicates: if a natural key appears twice within a batch, one row survives and the other is
  written to `audit.rejected_record`.

---

# Part F — Implemented reporting views

---

## 26. Reporting layer (Phase 0 slice)

**Design principle.** The reporting layer is the only surface `arpi_reporter` — and therefore Power BI and
Excel — may read ([ARCHITECTURE.md §22.2](ARCHITECTURE.md)). Surrogate keys are retained for joins but are
marked as hidden in the future semantic model.

> **Only four reporting views exist.** There is no sales view, no inventory view, and no funnel view,
> because the underlying facts do not exist.

### 26.1 `reporting.vw_calendar`

| Field | Value |
|---|---|
| **Layer** | Reporting (view) |
| **Purpose** | Business-friendly calendar attributes for the future Power BI date table. |
| **Declared grain** | **One row per calendar date.** |
| **Source** | `warehouse.dim_date` |
| **Implementation status** | **Implemented** |

Exposes the date attributes of section 6.1 with business-friendly presentation. Consumers should read
`is_selling_day` from this view rather than recomputing weekend or holiday logic in DAX.

### 26.2 `reporting.vw_dealership`

| Field | Value |
|---|---|
| **Layer** | Reporting (view) |
| **Purpose** | Current store list for slicers and store comparison. |
| **Declared grain** | **One row per current dealership version** (`is_current = true`). |
| **Source** | `warehouse.dim_dealership` |
| **Implementation status** | **Implemented** |

Filters to current rows only. **SCD2 bookkeeping columns (`effective_date`, `expiration_date`,
`is_current`, `attribute_hash`) are not exposed** — a report user filtering on a hash column would be a
modelling failure. Historical versions remain available in the warehouse for anyone who needs them.

### 26.3 `reporting.vw_pipeline_run_summary`

| Field | Value |
|---|---|
| **Layer** | Reporting (view) |
| **Purpose** | One-line answer to "when did this data last load, and did it work?" — the backbone of the future Data Quality page. |
| **Declared grain** | **One row per pipeline run.** |
| **Source** | `audit.pipeline_run` joined to `audit.pipeline_run_row_count` |
| **Implementation status** | **Implemented** |

Exposes run identity, profile, seed, status, timings, critical-failure and warning counts, and per-layer
row-count totals.

### 26.4 `reporting.vw_data_quality_summary`

| Field | Value |
|---|---|
| **Layer** | Reporting (view) |
| **Purpose** | Validation outcomes per run, so that data quality is a published result rather than an assertion. |
| **Declared grain** | **One row per validation check per pipeline run.** |
| **Source** | `audit.validation_result` joined to `audit.pipeline_run` |
| **Implementation status** | **Implemented** |

Exposes `check_id`, `check_name`, `check_category`, `target_object`, `severity`, `status`,
`observed_value`, `expected_value`, `failed_record_count`, and run context.

---

# Part G — Deferred domains

> Everything below is **Deferred** — with four exceptions (§27.1, §27.2, §27.8 and §27.10) which have been
> **promoted** and now forward to their implemented contracts. Deferred means present in the target
> architecture, absent from the current roadmap. Each is unlocked only by the release stage named. Grains are
> stated now so that a future implementation starts from a decision rather than a debate. Adding any of these
> facts requires an ADR ([ARCHITECTURE.md §35](ARCHITECTURE.md)).
>
> **A promoted entry is a forwarding address, not a second definition.** Where a promoted entry and its
> implemented contract disagree, the implemented contract is correct. The deferred-era wording is preserved
> so that what was promised can be compared against what was built.

### 27.1 `warehouse.dim_finance_product` — **promoted**

**This entity is no longer Deferred.** It was implemented by dashboard increment **DASH.6** under
[ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md) to answer **SQ-21**, and
its binding contract is [§42](#42-warehousedimfinanceproduct--implemented-contract-dash6).

The deferred-era wording was: *"describes the F&I products the group can sell — service contract, GAP,
maintenance plan, tire and wheel, appearance protection — with product category, eligible deal types, a
cancellation-sensitivity flag, and an active flag."* All four clauses survived, and two acquired a discipline
the deferred wording did not state:

- **Survived** — product category, eligible deal types, cancellation sensitivity, active flag.
- **Sharpened** — "product category" is a **row value from a closed ten-value vocabulary, never a column**.
  There is no `vsc_gross` column anywhere in ARPI and there never will be.
- **Sharpened** — "eligible deal types" is **descriptive metadata derived from a single authority**,
  `config/reference/fi_product_eligibility.yaml`, not a second place the rule is stated. `DQ-FPD-006` proves
  the derived text cannot disagree with the configuration.
- **Added** — a `chargeback_sensitive` flag beside the cancellation one, because a store's income being
  charged back and a customer cancelling a contract are different events with different reasons.
- **Recorded (DASH.6-01)** — `provider_name` is an **attribute**, not a foreign key into a provider
  dimension. `warehouse.dim_finance_product_provider` and STM-021 remain Deferred; see
  [§42.6](#426-the-provider-decision-dash6-01). Status: **Implemented**.

### 27.2 `warehouse.dim_lender` — **promoted**

**This entity is no longer Deferred.** It was implemented by **DASH.6**; its binding contract is
[§43](#43-warehousedimlender--implemented-contract-dash6).

The deferred-era wording was: *"fictional lending institutions with a lender type and a broad prime /
near-prime / subprime category. Every lender is invented; no real lender name, rate sheet, or decision record
may ever appear."* Every clause survived, and the last one was strengthened rather than merely kept:

- **Survived** — invented institutions, a lender type (four governed categories), a program tier.
- **Sharpened** — the tier classifies the **LENDER'S PROGRAM, never a customer**. It is not a credit grade
  and is assigned to no person. The vocabulary is closed deliberately so that no value which *reads* like a
  credit grade — `A+`, `Tier 3` — can ever enter it.
- **Enforced rather than promised** — "no rate sheet or decision record" is now a **schema tripwire**.
  `DQ-LND-007` fails the run on an `apr`, `buy_rate`, `sell_rate`, `rate_spread`, `credit_score` or
  `adverse_action` column **even when it is empty**, because the defect is claiming to model a mechanic the
  platform does not have. Status: **Implemented**.

### 27.3 `warehouse.dim_sale_type`

**Grain: one row per sale classification.** Normalizes New Retail, Used Retail, Certified Retail, Lease,
Cash, Finance, Wholesale, and Dealer Trade into a governed dimension. Deferred rather than Planned because
the MVP carries `sale_type` as a denormalized text column on `fact_vehicle_sale`, which is sufficient for
the five MVP report pages. **Unlocked when F&I or lender analysis makes the deal-structure axis
load-bearing.** Status: **Deferred**.

### 27.4 `warehouse.dim_inventory_source`

**Grain: one row per acquisition source.** Customer Trade, Auction, Off-street Purchase, Lease Return,
Dealer Trade, Manufacturer Allocation, Service-lane Acquisition. Deferred for the same reason as
`dim_sale_type`: the MVP denormalizes `vehicle_source` onto `dim_vehicle`. **Unlocked by acquisition-source
profitability analysis in the strong release.** Status: **Deferred**.

### 27.5 `warehouse.dim_geography`

**Grain: one row per approved geographic market grouping.** County, state, market area, distance band, and
an urban / suburban / rural classification. Deferred because the MVP's three stores all sit in one market
region, so the dimension would have almost no analytical variance. **Unlocked when customer-retention
analysis in the strong release needs distance-band segmentation.** Geography stops at county or market area
in every case ([ARCHITECTURE.md §22.4](ARCHITECTURE.md)). Status: **Deferred**.

### 27.6 `warehouse.fact_lead_activity`

**Grain: one row per CRM activity event** — phone call, email, text, voicemail, appointment confirmation,
showroom visit, manager review, or lost-lead action. Carries activity count, duration seconds,
response-delay seconds, and a completed flag. **No message content is ever stored.** This is the highest-row-count
Deferred table (150,000 to 400,000 rows at portfolio scale) and it is deferred because follow-up-compliance
analysis is not part of the MVP. **Unlocked by the strong portfolio release.** Status: **Deferred**.

### 27.7 `warehouse.fact_inventory_price_history`

**Grain: one row per vehicle price-change event.** Previous price, new price, change amount, change
percentage, days since prior change, and days in stock at the change, with the approving manager. The daily
inventory snapshot already carries `markdown_count_to_date`, which covers the MVP's markdown questions;
this fact adds event-level timing analysis. **Unlocked by price-history analysis in the strong release
([ARCHITECTURE.md §31](ARCHITECTURE.md)).** Status: **Deferred**.

### 27.8 `warehouse.fact_finance_product_sale` — **promoted**

**This entity is no longer Deferred.** It was implemented by **DASH.6**; its binding contract is
[§44](#44-warehousefactfinanceproductsale--implemented-contract-dash6). The deferred-era promise that
`fact_vehicle_sale.back_end_gross` *"must reconcile to it — reconciliation `RECON-FI-001`"* is **kept**:
`RECON-FI-001` exists, runs on every database execution, and proves the identity **per deal, to the cent,
with tolerance `0`**.

The deferred-era grain survived unchanged. The **column model did not**, and the change is the single most
consequential design decision in the increment:

- **Changed — cancellation and chargeback are EVENTS, not columns.** The deferred wording put
  `canceled_amount`, `chargeback_amount`, `net_product_gross` and three flags on the contract row. Building
  it that way would have meant **rewriting the June contract when an August chargeback posted**, which moves
  production out of the month it happened in and destroys the distinction between what the F&I office
  *produced* and what the store *retained*. DASH.6 therefore split the domain in two: this fact holds the
  **deal-date** figures and is never rewritten, and
  [§45 `warehouse.fact_finance_product_adjustment`](#45-warehousefactfinanceproductadjustment--implemented-contract-dash6)
  holds the events with their own business dates. Net product gross is **computed as of a stated date**, not
  stored.
- **Changed — no `is_eligible` flag.** Eligibility is a property of the *deal and the category*, not of the
  contract that was written, and a flag on a sold contract could only ever read `true`. The governed
  `eligibility_rule_id` is stored instead, so a penetration figure can name its own denominator.
- **Survived** — product sale count, price, cost, gross; and the reconciliation obligation.

Status: **Implemented**.

### 27.9 `warehouse.fact_service_visit`

**Grain: one row per closed repair-order visit.** Customer-pay, warranty, and internal labour and parts;
repair estimate; declined-work amount; vehicle mileage; visit count; and flags for high repair estimate,
declined work, replacement opportunity, and sales conversion. Service-to-sales opportunity logic must be
presented as **decision support, not as a prediction of purchase intent** (`docs/research.md` §4.13).
**Unlocked by service-to-sales opportunities in the strong release.** Status: **Deferred**.

### 27.10 `warehouse.fact_sales_target` — **promoted**

**This entity is no longer Deferred.** It was implemented by dashboard increment **DASH.5** under
[ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md) to answer **SQ-31**, and its
binding contract is [§41](#41-warehousefactsalestarget--implemented-contract-dash5). This entry is kept
only so that the historical Deferred record has a forwarding address; **it is not a second definition and
must not be read as one.** Where the two disagree, §41 is correct.

For the record, the deferred-era wording was: *"one row per dealership, employee or department, KPI, and
calendar month; target value and stretch target value; exists so that goals are data, not hardcoded DAX
constants; any target values will be fictional operating goals for a fictional group, never industry
benchmarks."* Two of those clauses survived implementation unchanged and one did not:

- **Survived** — targets are data rather than constants, and they are **synthetic internal operating goals
  for the fictional Granite Auto Group, never industry benchmarks and never a recommendation.**
- **Changed** — the grain. The implemented grain is
  `(dealership_key, target_month_date_key, kpi_id, target_scope_type, target_scope_id)`. The deferred-era
  phrase "employee or department" was a scope *description*, not a key; it could not be enforced, because
  PostgreSQL treats NULLs as distinct and a nullable department or employee column would have let the same
  store-month-KPI target be inserted twice. §41.3 records how that was closed.

Everything else about the domain — the ten `KPI-TGT-*` definitions, the no-outcome-leakage rule, the
selling-day pace arithmetic — lives in [§41](#41-warehousefactsalestarget--implemented-contract-dash5),
[KPI_CATALOG.md §39](KPI_CATALOG.md) and
[STM-016](docs/source-to-target/STM-016-fact-sales-target.md). Status: **Implemented**.

---

## 28. Change control

- The **grain** of any entity in this document may only change through an ADR in
  `docs/architecture-decisions/` ([ARCHITECTURE.md §35](ARCHITECTURE.md)).
- Column contracts for **Implemented** objects are binding. A change requires updating this document, the
  relevant source-to-target mapping in [docs/source-to-target/](docs/source-to-target/README.md), the SQL
  DDL, and the generator, in the same change.
- Column lists for **Planned** objects are indicative and are expected to be refined during implementation.
- Promoting an entity from Deferred to Planned requires satisfying Gate 4
  ([ARCHITECTURE.md §28](ARCHITECTURE.md)): a stakeholder question requires it, the fact grain is defined,
  KPI ownership is defined, and testing requirements are defined.

---

## Phase 1 column contract — `warehouse.dim_vehicle_model`

> **This section supersedes the attribute-level entry in §11 for column-level purposes.** §11 remains as
> written; the exact, binding contract for the implemented source entity is here.

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_vehicle_model` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | The governed model vocabulary every physical vehicle resolves to. Without it, model and trim performance, days supply by model, and franchise-alignment analysis are ungroupable — and model and trim performance is a core analytical requirement (`docs/research.md` §4.7). |
| **Declared grain** | **One row per model year, make, model and trim combination.** |
| **Primary key** | `vehicle_model_key` (integer surrogate) |
| **Natural / source key** | `vehicle_model_id` (`VMD-#####`), unique. **Business natural key:** `(model_year, make, model, trim)`, unique. |
| **Foreign keys** | None. `dim_vehicle_model` is a leaf dimension. |
| **Referenced by** | `dim_vehicle`, `fact_vehicle_inventory_snapshot`, `fact_lead`, `fact_appointment` |
| **Reference data** | `config/reference/vehicle_model_catalogue.yaml` |
| **Generator** | `src/arpi/generation/vehicle_model.py` |
| **Source-to-target mapping** | [STM-004](docs/source-to-target/STM-004-dim-vehicle-model.md) |
| **Implementation status** | **Implemented** — source generation and the pandas data-quality suite. The SQL DDL, raw/staging objects and warehouse merge are **Planned**. |

### Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `vehicle_model_key` | `integer` PK | no | 1..N | Surrogate key. **Deterministic ordinal 1..N by `vehicle_model_id`**, so the same model always receives the same key on regeneration. | Derived: rank in sorted natural-key order. | Non-personal |
| `vehicle_model_id` | `varchar(16)` | no | `VMD-#####` | Natural / source key. Assigned deterministically over the **sorted natural key**. | Derived. | Synthetic identifier |
| `model_year` | `smallint` | no | 1990..2030 | Model year. **Natural-key position 1.** | Catalogue. | Non-personal |
| `make` | `varchar(40)` | no | Free text | Manufacturer name. **Natural-key position 2.** A commercial product name; not personal data. | Catalogue. | Non-personal |
| `model` | `varchar(60)` | no | Free text | Model line name. **Natural-key position 3.** | Catalogue. | Non-personal |
| `trim` | `varchar(40)` | no | Free text | Trim name. **Natural-key position 4.** **Never NULL** — a line with no distinguishing trim carries an explicit `Base`, so the grain constraint needs no NULL-distinctness rule. | Catalogue. | Non-personal |
| `body_style` | `varchar(30)` | no | `Sedan` \| `Coupe` \| `Hatchback` \| `Wagon` \| `SUV` \| `Crossover` \| `Pickup` \| `Van` \| `Convertible` | Body style. | Catalogue (model line). | Non-personal |
| `vehicle_class` | `varchar(30)` | no | `Compact` \| `Midsize` \| `Fullsize` \| `Luxury` \| `Sports` \| `Truck` \| `SUV` \| `Van` | Analytical size and segment class. | Catalogue (model line). | Non-personal |
| `fuel_type` | `varchar(20)` | no | `Gasoline` \| `Diesel` \| `Hybrid` \| `Plug-in Hybrid` \| `Electric` | Propulsion type. Held at **trim** level, so a hybrid trim of a petrol line is expressible. | Catalogue (trim). | Non-personal |
| `drivetrain` | `varchar(10)` | no | `FWD` \| `RWD` \| `AWD` \| `4WD` | Driven wheels. Held at **trim** level, so the AWD share is a property of the catalogue rather than of a rule. | Catalogue (trim). | Non-personal |
| `transmission` | `varchar(20)` | no | `Automatic` \| `Manual` \| `CVT` | Transmission type. | Catalogue (trim). | Non-personal |
| `doors` | `smallint` | no | 2..5 | Door count. Model-line value, overridable per trim. | Catalogue. | Non-personal |
| `seating_capacity` | `smallint` | no | 2..8 | Seat count. Model-line value, overridable per trim (a captain's-chair trim seats 7 where the line seats 8). | Catalogue. | Non-personal |
| `franchise_alignment` | `varchar(40)` | no | `Chevrolet` \| `Subaru` \| `Independent Used` | Which franchise, if any, may sell this model **new**. **Explicit and never NULL:** `Independent Used` states "carried as used inventory only", which is information; a NULL would be an absence of information. | Catalogue (model line). | Non-personal |
| `is_current_model_line` | `boolean` | no | `true` / `false` | Whether the line is still sold new as of model year 2026. Gates new-vehicle eligibility in `dim_vehicle`. A `false` line may not carry a model year after 2025. | Catalogue (model line). | Non-personal |
| `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Constant lineage marker, on every row, so no reviewer can mistake this for a manufacturer extract. | Constant. | Non-personal |

**Uniqueness constraints**

- `vehicle_model_id` is unique (`DQ-VMD-001`).
- `(model_year, make, model, trim)` is unique (`DQ-VMD-002`). **This is the grain constraint.**

### Reference data provenance

The catalogue in `config/reference/vehicle_model_catalogue.yaml` is a **representative synthetic subset**,
hand-authored for this project. It is **not** sourced from any manufacturer feed, dealer management system,
NHTSA vPIC extract, or other external source — **no network call is made at any point**, and
`features.enable_public_vehicle_enrichment` stays `false` and is never read by the generator. It is **not
complete** and **not current**: it does not enumerate every model line, trim, model year, or specification
a manufacturer has offered or offers today, and the specifications recorded are plausible rather than
verified. **Nothing in ARPI may present it as an authoritative product catalogue.**

Make, model and trim strings are factual commercial product names — product identifiers, not personal data
— and no row relates to any real vehicle, VIN, owner, or transaction.

### Scale and subset selection

| Profile | Rows |
|---|---:|
| `test` | 40 |
| `development` | 120 |
| `portfolio` | 240 |

The catalogue is deliberately larger than every target. The generator selects a **deterministic subset**,
stratified by `(franchise_alignment, era)` with a floor of 2 rows per non-empty stratum and the balance
allocated in proportion to spare capacity. Stratification is what guarantees that even the 40-row `test`
profile contains new-eligible franchise models, certified-eligible franchise models, and long-tail models.
**A catalogue smaller than the target is a hard failure** that names both counts. Full derivation:
[STM-004 §4.2](docs/source-to-target/STM-004-dim-vehicle-model.md).

### Business rules

- `vehicle_model_key` is the deterministic ordinal of `vehicle_model_id`, which is itself assigned over the
  sorted natural key. Regeneration is therefore key-stable.
- `vehicle_model_id` is unique (`DQ-VMD-001`); the natural key is unique (`DQ-VMD-002`).
- Column names, order and count match the 16-column contract (`DQ-VMD-003`).
- Every enumerated column draws from its declared domain (`DQ-VMD-004`).
- `franchise_alignment` agrees with `make`: a `Chevrolet` or `Subaru` alignment carries that make, and no
  `Independent Used` row carries a franchise make (`DQ-VMD-005`).
- No prohibited PII column may exist (`DQ-VMD-006`) — the check inspects the **schema**, so an empty
  prohibited column still fails the run.
- Every row carries `source_system = 'arpi_synthetic_generator'`.
- **Distributions are asserted as bands, never as exact figures.** AWD share 0.32–0.68 across the
  dimension; Subaru rows ≥ 0.80 **and strictly below 1.0**; no single drivetrain above 0.70; no single trim
  above 0.20; no single model year above 0.30 with at least 8 distinct years. The realised drivetrain and
  body-style shares are logged at INFO on every run.

### PII classification

**No personal data.** `vehicle_model_id` is a `Synthetic identifier`; every other column is `Non-personal`.
`make`, `model` and `trim` are commercial product names, explicitly allowed by the prohibited-field policy.
There is no owner, driver, or contact relationship anywhere on this entity.

### History policy

**Slowly Changing Dimension Type 1.** A model's body style, fuel type or drivetrain is a fact about the
product, not a state that changes over time; correcting a mis-specified trim should correct history rather
than fork it. There are no `effective_date`, `expiration_date` or `is_current` columns, and nothing is ever
deleted — `dim_vehicle` rows reference these keys.

---

## Phase 1 column contract — `warehouse.dim_vehicle`

> **This section supersedes the attribute-level entry in §10 for column-level purposes.** §10 remains as
> written; the exact, binding contract for the implemented source entity is here.

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_vehicle` |
| **Layer** | Warehouse (dimension) |
| **Purpose** | The population of physical units. Every inventory snapshot and every sale references one, which makes "a sale with no inventory or vehicle record" — a prohibited synthetic pattern ([ARCHITECTURE.md §15.4](ARCHITECTURE.md)) — structurally impossible rather than merely unlikely. |
| **Declared grain** | **One row per unique physical vehicle.** |
| **Primary key** | `vehicle_key` (integer surrogate) |
| **Natural / source key** | `vehicle_id` (`VEH-#######`), unique. `synthetic_vin` is a second unique business identifier. |
| **Foreign keys** | `vehicle_model_key` → `warehouse.dim_vehicle_model.vehicle_model_key` |
| **Referenced by** | `acquisition_event`, `fact_vehicle_inventory_snapshot`, `fact_vehicle_sale` |
| **Generator** | `src/arpi/generation/vehicle.py` |
| **Source-to-target mapping** | [STM-005](docs/source-to-target/STM-005-dim-vehicle.md) |
| **Implementation status** | **Implemented** — source generation and the pandas data-quality suite. The SQL DDL, raw/staging objects and warehouse merge are **Planned**. |

### Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `vehicle_key` | `integer` PK | no | 1..N | Surrogate key. **Deterministic ordinal 1..N by `vehicle_id`.** | Derived. | Non-personal |
| `vehicle_id` | `varchar(16)` | no | `VEH-#######` | Natural / source key, assigned by deterministic sequence. | Derived. | Synthetic identifier |
| `synthetic_vin` | `char(17)` | no | `ARPI` + 13 characters from `ABCDEFGHJKLMNPRSTUVWXYZ0123456789` | Synthetic vehicle identifier. **Deliberately not a valid VIN** — see the VIN policy below. | Drawn from a seeded generator, with deterministic collision redraw. | Synthetic identifier |
| `vehicle_model_key` | `integer` | no | Existing `dim_vehicle_model` key | Foreign key to the model dimension. | Drawn from the eligible model pool for the unit's store and condition. | Non-personal |
| `vehicle_model_id` | `varchar(16)` | no | `VMD-#####` | **Lineage column.** Carries the model's natural key alongside the surrogate so a vehicle can be traced to its model without a join. | Derived with `vehicle_model_key`. | Synthetic identifier |
| `condition_type` | `varchar(12)` | no | `New` \| `Used` \| `Certified` | Sale condition of the unit. | Drawn from the intended store's condition mix. | Non-personal |
| `exterior_color` | `varchar(30)` | no | Free text from a weighted palette | Exterior paint description. A generic plausible description, **not** a manufacturer colour code. | Weighted, non-uniform draw. | Non-personal |
| `interior_color` | `varchar(30)` | no | Free text from a weighted palette | Interior trim colour description. | Weighted, non-uniform draw. | Non-personal |
| `odometer_reading` | `integer` | no | ≥ 0 | Miles showing **when the unit entered inventory**. A sale-time reading is a different measure and lives on the sale. | Derived from condition and model-year age with residual variance. | Non-personal |
| `odometer_band` | `varchar(20)` | no | `New` \| `Under 10k` \| `10k-30k` \| `30k-60k` \| `60k-100k` \| `Over 100k` | Reporting band. **Derived from `odometer_reading`, never drawn.** Each boundary belongs to the band above it: 9,999 is `Under 10k`, 10,000 is `10k-30k`. A `New` unit always bands `New`. | Derived. | Non-personal |
| `acquisition_source` | `varchar(40)` | no | `Customer Trade` \| `Auction` \| `Off-street Purchase` \| `Lease Return` \| `Dealer Trade` \| `Manufacturer Allocation` | How the unit entered inventory. | Constant for `New`; weighted draw otherwise. | Non-personal |
| `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Constant lineage marker. | Constant. | Non-personal |

**Uniqueness and referential constraints**

- `vehicle_id` is unique (`DQ-VEH-001`); `synthetic_vin` is unique (`DQ-VEH-002`).
- `vehicle_model_key` is a foreign key to `dim_vehicle_model`; every `(vehicle_model_key,
  vehicle_model_id)` pair must resolve to one model row (`DQ-VEH-004`).

### Synthetic VIN policy

`synthetic_vin` is 17 characters: the literal prefix `ARPI` plus 13 characters drawn from
`ABCDEFGHJKLMNPRSTUVWXYZ0123456789`. The alphabet excludes `I`, `O` and `Q`, matching real VIN character
rules, while the `ARPI` prefix makes the value **deliberately not a valid VIN**: no real World Manufacturer
Identifier is `ARP`, and the ninth character is not a valid ISO 3779 check digit.

**No real VIN data is held, read, or derived from.** The generator makes no network call, holds no VIN
reference table, decodes nothing, and creates no owner relationship. Collisions are redrawn deterministically
from the same seeded generator, bounded at 64 attempts; the keyspace is 33¹³ ≈ 5.1 × 10¹⁹, so exhaustion
would indicate a defect rather than scarcity, and the error message says so. See
[PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md).

### Why there is no store column

Which store holds a unit is a property of the **acquisition event**, not of the vehicle: a unit can be
dealer-traded between stores, and a store column on the dimension would silently rewrite history for every
fact already attached to it. `dim_vehicle` therefore carries **no `dealership_id` and no `dealership_key`**.

The generator still needs a store to decide condition and model — a used-only store cannot be allocated a
new unit — so it makes that decision deterministically and publishes it through
`arpi.generation.vehicle.intended_store_assignments(config)`, which returns `vehicle_id → dealership_id`.
The acquisition generator consumes that mapping.

### Scale

| Profile | Rows |
|---|---:|
| `test` | 60 |
| `development` | 900 |
| `portfolio` | 9,000 |

**`portfolio` is never generated in CI or in routine tests.**

### Business rules

- **`condition_type = 'New'` ⇒ `acquisition_source = 'Manufacturer Allocation'`, `odometer_band = 'New'`
  and `odometer_reading <= 50`** (`DQ-VEH-005`).
- **`acquisition_source = 'Manufacturer Allocation'` occurs only on `New` units** (`DQ-VEH-005`).
- **`GSA-003`, the independent used store, never holds a `New` or `Certified` unit and never takes a
  manufacturer allocation.** It holds no franchise, so it cannot take factory allocation and cannot
  certify. This is enforced by construction — its condition mix never offers those values — not by a
  filter applied afterwards.
- **`Certified` units are used-derived and bounded:** the acquisition source is `Customer Trade`,
  `Lease Return`, `Auction` or `Dealer Trade`; the model is 1–8 model years old; the reading is 500–80,000
  miles; and the model's franchise alignment matches the certifying store.
- **`odometer_band` agrees with `odometer_reading` on every row**, at every boundary (`DQ-VEH-005`).
- New and certified units are always aligned to the store's own franchise brand. Used inventory follows
  each store's used-alignment mix, so a Chevrolet store's used lot is Chevrolet-heavy but carries other
  makes.
- Column names, order and count match the contract (`DQ-VEH-003`); every `synthetic_vin` is well formed
  (`DQ-VEH-007`); no prohibited PII column may exist (`DQ-VEH-006`).
- **Documented non-degeneracy thresholds:** no exterior colour above a 0.30 share (≥ 8 distinct), no
  interior colour above 0.45 (≥ 5 distinct), no condition above 0.70 (all three present), no acquisition
  source above 0.50 (all six present), no single model above 0.15, and each store within 0.07 of its
  declared share. The realised condition and store shares are logged at INFO on every run.

### PII classification

**No personal data, and no owner relationship of any kind.** `vehicle_id`, `synthetic_vin` and
`vehicle_model_id` are `Synthetic identifiers`; every other column is `Non-personal`. There is no owner,
driver, registration, licence-plate, title, lienholder, or contact column, and `DQ-VEH-006` inspects the
**schema** so that adding one fails the run before any value is written.

### History policy

**Slowly Changing Dimension Type 1.** A unit's model, VIN and colours never change. Its odometer does — but
the reading that matters analytically is the reading *at a point in time*, which belongs on the inventory
snapshot and on the sale. Versioning the dimension for odometer drift would produce one row per unit per
mile band for no analytical gain. `dim_vehicle` holds the acquisition-time state, Type 1 corrects it in
place, and nothing is ever deleted because facts reference these keys.
---

# Part H — Phase 1.1 implemented column contracts

> Appended by delivery increment. Each section here **supersedes the Planned attribute list** for the same
> entity in Part B: where Part B and Part H disagree, Part H is binding, because it is generated by code
> that a test asserts against. Part B is retained so the design history stays readable.

---

## 8A. `warehouse.dim_employee` — implemented contract (`P1.1-03`)

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_employee` |
| **Layer** | Warehouse (dimension) |
| **Declared grain** | **One row per employee role-assignment version (SCD Type 2).** |
| **Primary key** | `employee_key` |
| **Natural / source key** | `employee_id` (`EMP-#####`) |
| **Foreign keys** | `dealership_key` -> `warehouse.dim_dealership` (resolved from `dealership_id` at load) |
| **History policy** | **SCD Type 2**, expire-and-insert on `attribute_hash` change |
| **Generator** | `src/arpi/generation/employee.py` |
| **Source-to-target mapping** | [STM-006](docs/source-to-target/STM-006-dim-employee.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). Warehouse DDL and merge **Planned** (`P1.2-01`). |
| **Row counts** | 15 rows / 12 people (test) · 34 rows / 30 people (development) · 45 people (portfolio, never generated in CI) |

### 8A.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `employee_key` | `integer` | no | 1..N | Surrogate key, one per version. | Deterministic ordinal over `(employee_id, effective_date)`. | Non-personal |
| 2 | `employee_id` | `varchar(16)` | no | `EMP-#####` | Synthetic person identifier, stable across versions. | Sequence in store then staffing-plan order. | **Synthetic identifier** |
| 3 | `dealership_id` | `varchar(16)` | no | `GSA-00N` | Store held in this version. **Tracked (hash 1).** | Staffing plan. | Non-personal |
| 4 | `department` | `varchar(30)` | no | `Sales` \| `Finance` \| `BDC` \| `Management` \| `Service` | Operating department. **Tracked (hash 2).** | **Derived from `job_role`.** | Non-personal |
| 5 | `job_role` | `varchar(40)` | no | `Salesperson` \| `Sales Manager` \| `Desk Manager` \| `Finance Manager` \| `BDC Representative` \| `BDC Manager` \| `General Manager` \| `Service Advisor` | Role held in this version. **Tracked (hash 3).** | Staffing plan. | Non-personal |
| 6 | `hire_date` | `date` | no | On or after the store's `opened_date` | Date of hire; identical across versions. **Tracked (hash 4).** | Role-dependent tenure draw, clamped to the store's life. | **Minimised personal attribute** (on a fabricated person) |
| 7 | `termination_date` | `date` | **yes** | On or after `hire_date` | Date of departure. **`NULL` means still employed** — never "unknown". **Tracked (hash 5).** | Role-weighted churn selection. | **Minimised personal attribute** |
| 8 | `is_active` | `boolean` | no | `true` / `false` | Currently employed. **Tracked (hash 6).** | **Derived**: `termination_date IS NULL`. | Non-personal |
| 9 | `is_manager` | `boolean` | no | `true` / `false` | Role carries management responsibility. **Tracked (hash 7).** | **Derived from `job_role`.** | Non-personal |
| 10 | `tenure_band` | `varchar(20)` | no | `Under 1 Year` \| `1-3 Years` \| `3-5 Years` \| `5-10 Years` \| `Over 10 Years` | Banded tenure. Banded rather than exact so a scorecard can be contextualised without implying a precise personnel record. **Not tracked.** | **Derived from `hire_date`** relative to `reporting.end_date`. | **Minimised personal attribute** |
| 11 | `effective_date` | `date` | no | Valid date | SCD2 version start. | `hire_date`, or the change date. | Non-personal |
| 12 | `expiration_date` | `date` | no | `9999-12-31` for current | SCD2 version end. | Sentinel, or `next effective_date − 1 day`. | Non-personal |
| 13 | `is_current` | `boolean` | no | `true` / `false` | Latest-version flag. Exactly one per person. | Derived. | Non-personal |
| 14 | `attribute_hash` | `char(64)` | no | 64 lowercase hex | SHA-256 of columns 3–9, pipe-joined, UTF-8. Same construction as §7.3. | Derived; see [STM-006 §4.2](docs/source-to-target/STM-006-dim-employee.md). | Non-personal |
| 15 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 8A.2 Prohibited fields — never generated, stored, loaded or committed

| Prohibited field | Reason |
|---|---|
| **Employee name** (any form) | Directly identifying. [ARCHITECTURE.md §22.4](ARCHITECTURE.md) permits fictional names "if names are used at all"; ARPI's answer is that they are not. A synthetic id plus role and tenure answers every declared KPI, and fabricated names invite confusion with real staff. |
| **Email address, phone number, street address** | Directly identifying and contact vectors. No ARPI entity stores geography finer than city (stores) or county (customers). |
| **Salary, compensation, pay rate, wage, bonus** | Sensitive personnel data, on the prohibited list in `docs/research.md` §10.2, and it adds nothing to any planned KPI. |
| **Commission, pay plan** | As above. Pay-plan structure would also imply a payroll extract, which this is emphatically not. |
| **Date of birth, exact age** | Quasi-identifier. Not needed by any measure. |
| **Race, ethnicity, gender, religion, marital status, national origin, disability, veteran status, sexual orientation** | Protected characteristics. [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md) forbids any employee measure, ranking or scorecard from considering one, so the data does not exist to be considered. |
| **Notes, comments, memos, transcripts, call recordings** | Communication content. No ARPI entity stores any. |
| **Any latent performance parameter** (`volume_index`, `closing_rate_index`, `gross_retention_index`, `crm_discipline_index`, or any `skill_index` / `performance_index` / `latent_*` variant) | **Not a privacy rule — an honesty rule.** See §8A.3. |

`DQ-EMP-005` enforces all of the above against the **schema**, so an accidentally added column fails the
run even when it holds no values.

### 8A.3 Latent performance parameters: generation inputs, never management facts

[ARCHITECTURE.md §15.3](ARCHITECTURE.md) requires employees to differ in volume, closing rate and gross
retention — otherwise the sales fact is implausibly uniform, which is itself a prohibited synthetic
pattern. Those per-person parameters exist and are exposed to the sale generator by
`arpi.generation.employee.employee_performance_profiles()`.

**They are not columns of `dim_employee`, are never written to `data/sample/`, and must never reach a
reporting view.** Two binding reasons:

1. **A scorecard built from a latent "true skill" parameter is circular.** It reports back the number the
   generator used to fabricate the outcome, while presenting itself as a validated measurement of a
   person. The apparent precision would be entirely artificial.
2. **It would defeat the project's fairness rule.** [PRIVACY_AND_ETHICS.md §5](PRIVACY_AND_ETHICS.md)
   requires every employee metric to be shown alongside contextual metrics — lead volume received,
   lead-source mix, tenure, inventory availability — because raw output measures routing and opportunity
   as much as skill. A published "skill index" would supply exactly the uncontextualised ranking that rule
   exists to prevent, and would do so with a false claim to objectivity.

The parameters draw from a separate seeding namespace (`dim_employee_performance`), so tuning them cannot
move a single value in `dim_employee`, and reading them cannot change its content digest.

### 8A.4 Business rules

- `hire_date` is on or after the assigned store's `opened_date`.
- `termination_date`, where present, is on or after `hire_date`, and falls inside the reporting window.
- `is_active` equals `termination_date IS NULL`, always.
- `department` and `is_manager` are functions of `job_role`; `tenure_band` is a function of `hire_date`.
  None of the three is ever drawn independently.
- A person has **exactly one** row with `is_current = true`, and that row carries `expiration_date =
  9999-12-31` — **including a terminated person**. Employment status is carried by `is_active`, not by
  expiring the version, so historical facts always resolve.
- Version ranges per person are contiguous and non-overlapping: the previous version's `expiration_date`
  is exactly one day before the next version's `effective_date`.
- **At least three people have two versions**, at every profile, so the SCD2 expire-and-insert path is
  exercised by real generated data rather than only by unit tests.

### 8A.5 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-EMP-001` | `(employee_id, effective_date)` is unique | `uniqueness` | critical |
| `DQ-EMP-002` | Exactly one current row per employee, carrying the sentinel | `uniqueness` | critical |
| `DQ-EMP-003` | Version ranges are contiguous and non-overlapping | `business_rule` | critical |
| `DQ-EMP-004` | The declared 15-column contract matches, in order | `structural` | critical |
| `DQ-EMP-005` | **No prohibited PII, compensation or latent-parameter column exists** | `privacy` | critical |
| `DQ-EMP-006` | Hire, termination and version dates are correctly ordered | `business_rule` | critical |
| `DQ-EMP-007` | Headcount is within the configured bounds for the scale mode | `business_rule` | critical |
| `DQ-EMP-008` | Every `attribute_hash` recomputes from its own tracked attributes | `reproducibility` | critical |
| `DQ-EMP-009` | `department`, `job_role` and `tenure_band` are in domain | `business_rule` | critical |

---

## 9A. `warehouse.dim_customer` — implemented contract (`P1.1-06`)

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_customer` |
| **Layer** | Warehouse (dimension) |
| **Declared grain** | **One row per synthetic customer.** |
| **Primary key** | `customer_key` |
| **Natural / source key** | `customer_id` (`CUS-########`) |
| **Foreign keys** | None. A `geography_key` FK is Deferred with `dim_geography`. |
| **History policy** | **SCD Type 1**, upsert in place |
| **Generator** | `src/arpi/generation/customer.py` |
| **Source-to-target mapping** | [STM-007](docs/source-to-target/STM-007-dim-customer.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). Warehouse DDL and merge **Planned** (`P1.2-01`). |
| **Row counts** | 80 (test) · 2,500 (development) · 22,000 (portfolio, never generated in CI) |

### 9A.1 Column contract (exact names, exact order)

**Every column is `NOT NULL`.**

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `customer_key` | `integer` | no | 1..N | Surrogate key. | Deterministic ordinal over `customer_id`. | Non-personal |
| 2 | `customer_id` | `varchar(16)` | no | `CUS-########` | Synthetic customer identifier. Encodes nothing about any person and cannot be reversed into one. | Sequence within the customer generator. | **Synthetic identifier** |
| 3 | `household_id` | `varchar(16)` | no | `HH-########` | Household grouping for repeat-purchase analysis. A one-person household carries its own id rather than NULL, so the grouping is total. | Sequence; members inherit the household's geography. | **Synthetic identifier** |
| 4 | `age_band` | `varchar(20)` | no | `18-24` \| `25-34` \| `35-44` \| `45-54` \| `55-64` \| `65+` | Banded age. **A full birth date is prohibited** — data minimisation. | Weighted, deliberately non-uniform draw. | **Minimised personal attribute** |
| 5 | `county` | `varchar(40)` | no | `Hillsborough` \| `Rockingham` \| `Merrimack` \| `Strafford` \| `Middlesex` \| `Essex` | **The finest geography ARPI stores anywhere.** No street address, postal code or coordinate exists at any layer. | Weighted draw, once per household. | **Minimised personal attribute** |
| 6 | `state_code` | `char(2)` | no | `NH` \| `MA` | State. | **Derived from `county`.** | **Minimised personal attribute** |
| 7 | `market_area` | `varchar(40)` | no | `Southern New Hampshire` \| `Northern Massachusetts` | Coarse analytical market grouping. | **Derived from `county`.** | Non-personal |
| 8 | `customer_type` | `varchar(20)` | no | `Retail` \| `Business` | Buying-party classification. A wholesale disposal carries a **NULL** customer key rather than a customer of a special type. | Weighted draw, about 7% business. | Non-personal |
| 9 | `is_prior_customer` | `boolean` | no | `true` / `false` | Bought before the reporting window opened. Prevents repeat-rate measures from being artificially depressed on day one. | Age-band-dependent draw. | Non-personal |
| 10 | `is_service_customer` | `boolean` | no | `true` / `false` | Has service history. Supports the **Deferred** service-to-sales domain. | Draw conditioned on `is_prior_customer`. | Non-personal |
| 11 | `first_interaction_date` | `date` | no | `[reporting.start_date − 180 days, reporting.end_date]` | **Earliest date any fact may reference this customer.** | Uniform inside the permitted window; prior customers strictly before the window opens. | Non-personal |
| 12 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 9A.2 Prohibited fields — never generated, stored, loaded or committed

| Prohibited field | Reason |
|---|---|
| **Name** (any form) | Directly identifying. A synthetic key serves every analytical purpose. |
| **Street address, postal code, coordinates** | Directly identifying. County and market area are the finest geography ARPI stores. |
| **Email address** | Directly identifying and a contact vector. |
| **Phone number** | Directly identifying and a contact vector. |
| **Full birth date, exact age** | Quasi-identifier; `age_band` is sufficient for every cohort measure. |
| **Social Security number** | Never appropriate in any portfolio dataset. |
| **Driver's-licence number** | Government identifier; never appropriate. |
| **Bank account, routing number, payment card** | Financial account data; never appropriate. |
| **Exact credit score, credit application, credit-report field** | `docs/research.md` §10.2. Where a credit dimension is ever required, only a broad synthetic tier is permissible ([ARCHITECTURE.md §22.4](ARCHITECTURE.md)) — and that is **Deferred**. |
| **Insurance information, deal jackets, household income** | `docs/research.md` §10.2. |
| **Race, ethnicity, gender, religion, marital status, national origin, disability, veteran status, sexual orientation** | Protected characteristics. No ARPI measure may consider one, so the data does not exist to be considered. |
| **Notes, comments, memos, transcripts, call recordings, message bodies** | Communication content. No ARPI entity stores any. |

`DQ-CUS-003` enforces all of the above against the **schema**, so an accidentally added column fails the
run even when it holds no values.

### 9A.3 Business rules

- `state_code` and `market_area` follow from `county`; the triple is derived, never drawn separately, so
  an inconsistent geography is unrepresentable rather than merely invalid.
- Every member of a `household_id` shares one `county`, `state_code` and `market_area`. No household
  exceeds three members.
- `age_band` is **not** uniformly distributed — a flat distribution is a prohibited synthetic pattern
  ([ARCHITECTURE.md §15.4](ARCHITECTURE.md)).
- `first_interaction_date` is on or before the earliest fact date referencing the customer. This is
  guaranteed by construction: `arpi.generation.customer.select_customer_for_sale()` binary-searches a
  pool sorted by `first_interaction_date` and cannot return an ineligible customer.
- Where `is_prior_customer` is true, `first_interaction_date` is strictly before `reporting.start_date`.
- Every customer referenced by a retail sale exists here; wholesale transactions carry no customer key.

### 9A.4 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-CUS-001` | `customer_id` is unique | `uniqueness` | critical |
| `DQ-CUS-002` | The declared 12-column contract matches, in order | `structural` | critical |
| `DQ-CUS-003` | **No prohibited PII column exists** | `privacy` | critical |
| `DQ-CUS-004` | Geography is inside the trading area and internally consistent | `business_rule` | critical |
| `DQ-CUS-005` | `age_band` is in domain | `business_rule` | critical |
| `DQ-CUS-006` | Households share one geography | `business_rule` | critical |
| `DQ-CUS-007` | `first_interaction_date` is inside the permitted window | `business_rule` | critical |
| `DQ-CUS-008` | `customer_type` is in domain | `business_rule` | critical |

---

# Part I — Phase 1.4 and 1.5 implemented column contracts

> Appended by delivery increment, exactly as Part H was. Each section here **supersedes the Planned
> attribute list** for the same entity in Part B or Part C: where they disagree, this part is binding,
> because it is generated by code that a test asserts against. The Planned sections are retained so the
> design history stays readable.

---

## 12A. `warehouse.dim_lead_source` — implemented contract (`P1.4-01`)

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_lead_source` |
| **Layer** | Warehouse (dimension) |
| **Declared grain** | **One row per normalised lead source.** |
| **Primary key** | `lead_source_key` |
| **Natural / source key** | `lead_source_id` (`LDS-###`) |
| **Foreign keys** | None |
| **History policy** | **SCD Type 1**, upsert in place |
| **Generator** | `src/arpi/generation/lead_source.py` |
| **Source-to-target mapping** | [STM-010](docs/source-to-target/STM-010-dim-lead-source.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). The raw table, staging view, warehouse DDL and Type 1 merge exist in `sql/`; **no load has been run from this increment.** |
| **Row counts** | 19 at every scale — fixed reference data, independent of profile and of `random_seed`. |

### 12A.1 Column contract (exact names, exact order)

**Every column is `NOT NULL`.** The Planned list in §12 named the display column `source_name`; the
implemented contract calls it `lead_source_name`, which is the spelling the privacy allowlist and every
downstream object use.

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `lead_source_key` | `integer` | no | 1..N | Surrogate key. | Deterministic ordinal over `lead_source_id` ascending. | Non-personal |
| 2 | `lead_source_id` | `varchar(16)` | no | `LDS-###` | Natural key every lead, campaign and spend row resolves through. | Fixed reference data. | Non-personal |
| 3 | `lead_source_name` | `varchar(60)` | no | Generic invented channel labels | Display label. **Fictional and generic — no real lead vendor, marketplace or media company is named.** | Fixed reference data. | Non-personal |
| 4 | `source_category` | `varchar(30)` | no | `Owned Digital` \| `Third Party` \| `Paid Search` \| `Paid Social` \| `Traditional Media` \| `Walk-in` \| `Referral` \| `Internal` \| `Organic Web` | Analytical grouping used on the marketing page. All nine are represented. | Fixed reference data. | Non-personal |
| 5 | `is_paid` | `boolean` | no | `true` / `false` | Whether the source carries media cost. Determines whether cost-per-lead is defined for it at all. | Fixed reference data. | Non-personal |
| 6 | `is_digital` | `boolean` | no | `true` / `false` | Digital versus traditional or in-person channel. Follows from the category. | Fixed reference data. | Non-personal |
| 7 | `is_third_party` | `boolean` | no | `true` / `false` | Supplied by an external marketplace. True exactly for the `Third Party` category. | Fixed reference data. | Non-personal |
| 8 | `is_internal` | `boolean` | no | `true` / `false` | Generated inside the store — showroom floor, service drive, owner base. | Fixed reference data. | Non-personal |
| 9 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 12A.2 Latent behaviour — deliberately **not** columns

Each source carries four latents used only as generation inputs: `volume_weight`, `contact_rate`,
`close_rate` and `cost_per_lead` (a cent-quantized `Decimal`, exactly `0.00` where `is_paid` is false).
They are exposed to downstream generators through
`arpi.generation.lead_source.lead_source_behaviour(lead_source_id)` and
`lead_source_behaviours()`, and they never reach the dimension.

**Why not store them.** A close rate on a dimension row would be an assumption dressed as a measured
fact, and any report reading it would be reporting the generator's own inputs back to itself. Measured
conversion is computed downstream from `fact_lead`.

### 12A.3 Business rules

- **`is_internal = true` implies `is_paid = false`** — an internally generated opportunity has no media
  cost. Enforced by `DQ-LDS-005` and, once the DDL exists, by a database CHECK (**Planned**).
- `is_paid = true` implies `cost_per_lead > 0`; `is_paid = false` implies `cost_per_lead = 0.00`.
- `is_third_party = true` exactly when `source_category = 'Third Party'`.
- Cost-per-lead and cost-per-sale are undefined (NULL, not zero) for sources where `is_paid = false`.
- Sources differ materially in volume, contact rate, close rate and cost — [ARCHITECTURE.md §15.3](ARCHITECTURE.md)
  relationship 7. A flat set of rates would make every marketing comparison in the model vacuous.

### 12A.4 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-LDS-001` | `lead_source_id` is unique | `uniqueness` | critical |
| `DQ-LDS-002` | `lead_source_name` is unique | `uniqueness` | critical |
| `DQ-LDS-003` | The declared 9-column contract matches, in order | `structural` | critical |
| `DQ-LDS-004` | `source_category` is inside the nine-value enumeration | `business_rule` | critical |
| `DQ-LDS-005` | **`is_internal` implies not `is_paid`** | `business_rule` | critical |
| `DQ-LDS-006` | **No prohibited PII column exists** | `privacy` | critical |

---

## 13A. `warehouse.dim_marketing_campaign` — implemented contract (`P1.5-01`)

| Field | Value |
|---|---|
| **Entity name** | `warehouse.dim_marketing_campaign` |
| **Layer** | Warehouse (dimension) |
| **Declared grain** | **One row per campaign.** |
| **Primary key** | `campaign_key` |
| **Natural / source key** | `campaign_id` (`CMP-#####`) |
| **Foreign keys** | `lead_source_id` → `warehouse.dim_lead_source` (resolved to `lead_source_key` at load) |
| **History policy** | **SCD Type 1.** [ARCHITECTURE.md §14](ARCHITECTURE.md) lists campaign classification as a *potential* Type 2 dimension; promoting it requires an ADR. |
| **Generator** | `src/arpi/generation/marketing.py` |
| **Source-to-target mapping** | [STM-013](docs/source-to-target/STM-013-dim-marketing-campaign.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). The raw table, staging view, warehouse DDL and Type 1 merge exist in `sql/`; **no load has been run from this increment.** |
| **Row counts** | 8 (test) · 24 (development) · 60 (portfolio) |

### 13A.1 Column contract (exact names, exact order)

**`end_date` is the only nullable column.** The Planned list in §13 named the vendor column `vendor` and
allowed a NULL; the implemented contract calls it `vendor_name` and makes it `NOT NULL`, because an
in-house campaign has a named in-house owner rather than no vendor at all.

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `campaign_key` | `integer` | no | 1..N | Surrogate key. | Deterministic ordinal over `campaign_id`. | Non-personal |
| 2 | `campaign_id` | `varchar(16)` | no | `CMP-#####` | Natural key. | Sequence within the campaign generator. | Non-personal |
| 3 | `campaign_name` | `varchar(80)` | no | `<theme> <year> - <channel>` | Display label, e.g. `Summer Clearance 2025 - Paid Search`. **Fictional.** | Season-appropriate theme drawn for the campaign's start quarter. | Non-personal |
| 4 | `channel` | `varchar(30)` | no | `Paid Search` \| `Paid Social` \| `Third-Party Listings` \| `Direct Mail` \| `Radio` \| `Television` \| `Email` | Delivery channel. | **Derived from `lead_source_id`**, never drawn separately. | Non-personal |
| 5 | `vendor_name` | `varchar(60)` | no | Invented vendor labels | Media vendor, or `In-House Marketing Team`. **Every name is fictional; no real agency, marketplace, broadcaster or mail house is named.** | Drawn from the channel's vendor list. | Non-personal |
| 6 | `lead_source_id` | `varchar(16)` | no | `LDS-###`, restricted to **paid** sources | The governed source the campaign buys. | Weighted draw over the campaign-eligible sources. | Non-personal |
| 7 | `start_date` | `date` | no | Inside the reporting window | First active day. | Always-on campaigns start on the first day of the window; bursts start on the 1st, 8th or 15th of a month. | Non-personal |
| 8 | `end_date` | `date` | **yes** | `NULL` or ≥ `start_date` | Last active day. **NULL means the campaign was still running when the window closed.** | Burst duration of one to four months, or NULL where it would run past the window. | Non-personal |
| 9 | `target_department` | `varchar(30)` | no | `Sales` \| `Service` \| `Both` | Intended department. | Weighted draw; search and marketplace listings are never bought for the service drive. | Non-personal |
| 10 | `target_vehicle_category` | `varchar(30)` | no | `New` \| `Used` \| `Both` | Intended vehicle category. A service campaign records `Both` rather than a NULL the contract does not allow. | Weighted draw conditioned on the department. | Non-personal |
| 11 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 13A.2 Business rules

- `end_date IS NULL OR end_date >= start_date`. Enforced by `DQ-CMP-003`.
- Every `lead_source_id` resolves to a governed source, and only to a **paid** one: a campaign against an
  unpaid source would attach spend to a channel whose cost per lead is undefined by rule.
- `channel` follows from `lead_source_id`.
- The independent used store `GSA-003` never funds a campaign whose `target_vehicle_category` is `New`.
- **Campaigns may create leads outside their target segment** ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)
  relationship 16). Attribution logic must not assume perfect targeting. The dimension makes the
  targeting visible; producing the off-target leads themselves belongs to `fact_lead` and is **Planned**
  (`P1.4-02`).

### 13A.3 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-CMP-001` | `campaign_id` is unique | `uniqueness` | critical |
| `DQ-CMP-002` | The declared 11-column contract matches, in order | `structural` | critical |
| `DQ-CMP-003` | `end_date` is NULL or on or after `start_date` | `business_rule` | critical |
| `DQ-CMP-004` | `lead_source_id` resolves to a governed source | `referential` | critical |
| `DQ-CMP-005` | `channel`, `target_department` and `target_vehicle_category` are in domain | `business_rule` | critical |
| `DQ-CMP-006` | **No prohibited PII column exists** | `privacy` | critical |

---

## 18A. `warehouse.fact_marketing_spend` — implemented source contract (`P1.5-01`)

| Field | Value |
|---|---|
| **Entity name** | `marketing_spend_event` (source entity) → `warehouse.fact_marketing_spend` |
| **Layer** | Source entity feeding a periodic fact |
| **Declared grain** | **One row per dealership, campaign and calendar month.** |
| **Grain key** | `(month_date_key, dealership_id, campaign_id)` → `(month_date_key, dealership_key, campaign_key)` in the warehouse |
| **Natural / source key** | `marketing_spend_id` (`MKT-########`) |
| **Foreign keys** | `month_date_key` → `dim_date`; `dealership_id`; `campaign_id`; `lead_source_id` |
| **History policy** | **Insert-only periodic fact.** A restated month is handled by deleting and reloading that month. |
| **Generator** | `src/arpi/generation/marketing.py` |
| **Source-to-target mapping** | [STM-014](docs/source-to-target/STM-014-fact-marketing-spend.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). `warehouse.fact_marketing_spend` exists with its grain constraint; **the fact load script does not exist and no row has ever been loaded.** |
| **Row counts** | 16 (test) · 212 (development) · 1,691 (portfolio) — inside the 500–2,000 portfolio target. |

### 18A.1 Column contract (exact names, exact order)

**Every column is `NOT NULL`.** The Planned list in §18 allowed NULL delivery counts; the implemented
contract stores `0` instead, so additive measures need no NULL handling and a channel that genuinely
reports nothing is distinguishable only by being zero everywhere.

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `marketing_spend_id` | `varchar(16)` | no | `MKT-########` | Natural key of the source row. | Ordinal over the grain order. | Non-personal |
| 2 | `month_date_key` | `integer` | no | `YYYYMM01` | **Always the first day of the month**, so monthly rows join cleanly to `dim_date`. | Encoded from the month start. | Non-personal |
| 3 | `dealership_id` | `varchar(16)` | no | `GSA-00N` | Store funding the spend. | From the campaign's funding stores. | Non-personal |
| 4 | `campaign_id` | `varchar(16)` | no | `CMP-#####` | Campaign the spend belongs to. | From `dim_marketing_campaign`. | Non-personal |
| 5 | `lead_source_id` | `varchar(16)` | no | `LDS-###` | Source the campaign buys. Carried denormalised so the fact resolves `lead_source_key` without joining the campaign dimension at load. | From the campaign. | Non-personal |
| 6 | `spend_amount` | `numeric(12,2)` | no | ≥ 0 | Marketing spend for the month. **`Decimal`, quantized to cents, never negative** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). | Expected leads × the source's cost per lead × an independent efficiency draw. | Non-personal |
| 7 | `impressions` | `bigint` | no | ≥ 0 | Impressions delivered — for direct mail, pieces delivered. | Spend ÷ the channel's cost per thousand, with variance. | Non-personal |
| 8 | `clicks` | `bigint` | no | ≥ 0 | Clicks. **`0` on the offline channels**, which have no click to report. | Impressions × the channel's click-through rate. | Non-personal |
| 9 | `calls` | `integer` | no | ≥ 0 | Inbound calls the vendor attributes to the campaign. | Share of `vendor_reported_leads`. | Non-personal |
| 10 | `form_submissions` | `integer` | no | ≥ 0 | Form submissions the vendor attributes to the campaign. | Share of `vendor_reported_leads`. | Non-personal |
| 11 | `vendor_reported_leads` | `integer` | no | ≥ 0 | Leads the vendor claims. **Deliberately differs from the CRM count** — see §18A.2. | True lead count × 1.28, with a spread that keeps it strictly above 1.0. | Non-personal |
| 12 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 18A.2 The vendor-versus-CRM gap, and the assumption behind it

`vendor_reported_leads` is generated as a **documented inflation over the same true lead count the CRM
lead fact draws from**, never as an independent random number and never by subtracting one count from
another. The central factor is **1.28** — the vendor claims about 28% more leads than the CRM records —
with a per-row spread whose lower bound keeps the product above 1.0, so the over-reporting is systematic
rather than noise in both directions.

**The assumption, stated plainly.** A vendor counts submission events; a CRM counts unique contactable
shoppers. Duplicate submissions from one shopper, form fills with unusable contact details and very short
inbound calls are commonly billed as leads and are not leads in the CRM. A 20–35% gap is the range
`docs/research.md` §4.10 describes, and 1.28 sits in the middle of it. **This is a modelling assumption,
not a measurement, and it is not evidence about any real vendor.**

The bridge between the two entities is
`arpi.generation.marketing.campaign_month_demand(config)`, which publishes the true count per
campaign-month-store. The lead generator (`P1.4-02`, **Planned**) draws its campaign-attributed volume
from it, which is what makes the gap a reproducible property of the dataset rather than an accident.

`calls + form_submissions <= vendor_reported_leads` on every row: the remainder is chat, text and other
events the vendor counts as leads but reports under neither heading.

### 18A.3 Business rules

- `month_date_key` always points at the **first day of the month**. `DQ-MKT-003` fails the run otherwise.
- Grain uniqueness on `(month_date_key, dealership_id, campaign_id)`.
- Spend and every delivery count are non-negative.
- Only months inside a campaign's active window receive spend, prorated by the share of the month the
  campaign was running.
- Marketing spend is monthly; lead and sale facts are daily. **Cost-per-lead must therefore be computed at
  month grain or coarser**, never at day grain ([KPI_CATALOG.md](KPI_CATALOG.md)).

### 18A.4 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-MKT-001` | The grain `(month_date_key, dealership_id, campaign_id)` is unique | `uniqueness` | critical |
| `DQ-MKT-002` | The declared 12-column contract matches, in order | `structural` | critical |
| `DQ-MKT-003` | **`month_date_key` is the first day of its month** | `business_rule` | critical |
| `DQ-MKT-004` | No negative spend amount or delivery count | `business_rule` | critical |
| `DQ-MKT-005` | Campaign, dealership and lead source all resolve | `referential` | critical |
| `DQ-MKT-006` | `vendor_reported_leads` is non-negative | `business_rule` | critical |
| `DQ-MKT-007` | **No prohibited PII column exists** | `privacy` | critical |

---

# Part J — Phase 1.1 implemented source-entity contracts

Two entities in `P1.1` are **pre-warehouse source entities** rather than warehouse tables. They are what a
real dealer management system would export, and they are what the raw and staging layers ingest.
`acquisition_event` feeds [§15 `warehouse.fact_vehicle_inventory_snapshot`](#15-warehousefactvehicleinventorysnapshot);
`sale_event` is loaded as [§14 `warehouse.fact_vehicle_sale`](#14-warehousefactvehiclesale). Both are
implemented by `src/arpi/generation/` and both carry natural identifiers and real dates rather than
surrogate and date keys — the keys are assigned during the load, not by the generator.

Status: **Implemented** (`P1.1-04`, `P1.1-05`).

## 14A. `acquisition_event` — implemented source contract (`P1.1-04`)

Module: `src/arpi/generation/acquisition.py`. Seeding namespace: `acquisition_event`.

**Grain: exactly one acquisition event per physical vehicle.** Every `dim_vehicle` row has one, and no
vehicle has two. This is the origin of inventory age, days to sale and inventory investment — without it
none of the nine inventory KPIs can be computed, and a sale would have no cost basis.

### 14A.1 Column contract

| # | Column | Type | Null | Notes |
|---:|---|---|---|---|
| 1 | `acquisition_id` | `varchar(16)` | NN U | `ACQ-########`, assigned in `vehicle_id` order |
| 2 | `vehicle_id` | `varchar(16)` | NN U | `VEH-#######`; unique — this is the grain |
| 3 | `dealership_id` | `varchar(16)` | NN | The store that acquired the unit |
| 4 | `acquisition_date` | `date` | NN | May precede `reporting.start_date`; see §14A.2 |
| 5 | `acquisition_source` | `varchar(40)` | NN | Carried from `dim_vehicle`, so the two can never disagree |
| 6 | `acquisition_cost` | `numeric(12,2)` | NN | `Decimal`, `>= 0` |
| 7 | `reconditioning_cost` | `numeric(12,2)` | NN | `Decimal`, `>= 0` |
| 8 | `original_asking_price` | `numeric(12,2)` | NN | `Decimal`, `>= 0`; the **first** advertised price |
| 9 | `msrp` | `numeric(12,2)` | NULL | Populated for `New` units only; see §14A.3 |
| 10 | `initial_inventory_status` | `varchar(30)` | NN | `In Stock` \| `In Transit` \| `In Reconditioning` |
| 11 | `source_system` | `varchar(40)` | NN | `arpi_synthetic_generator` |

`msrp` is the only nullable column.

### 14A.2 The warm-up rule, stated exactly

An acquisition date is drawn from the inclusive range

```
[ reporting.start_date - 180 days , reporting.end_date ]
```

where 180 is `ACQUISITION_WARM_UP_DAYS` ([PHASE1_CONTRACT.md §8]). Nothing may fall outside it, and
`DQ-ACQ-005` plus the unit tests assert both ends.

**Why it exists.** Without a warm-up the warehouse starts empty: every unit would be zero days old on
day one, average inventory age would climb from nothing rather than from a standing position, and the
`61-90`, `91-120` and `Over 120` age buckets would be unreachable for the first four months of any
window. Day-one inventory age would be a fiction, and every ageing KPI computed over the first quarter
would be wrong in the same optimistic direction.

**How the volume is shaped.** The daily rate inside the reporting window is the baseline. A warm-up day
`k` days before the window opens is drawn at `exp(-k / 65)` of that rate (`WARM_UP_TAPER_DAYS`). A *flat*
warm-up rate would hand day one a uniform age profile in which most standing units are already older
than the average days-to-sale, so they would all clear in the first fortnight — an artefact of the
generator, not a business. The taper approximates the age profile of a store that was already trading.
At the `development` profile this puts **28.4%** of the fleet before the window, with a real but thin
tail of units over 120 days old on day one.

**What the warm-up is not.** It is a *generation* window, not a reporting window. `dim_date` covers the
reporting window only, so no fact is ever reported against a warm-up date. Consequently ARPI models **no
disposition before `reporting.start_date`**: a unit acquired during the warm-up is, by construction,
still in stock when the window opens. A sale on a date `dim_date` does not contain could not join the
calendar, so generating one would create an unreportable row rather than a more realistic dataset.

### 14A.3 Derivations and business rules

- `dealership_id` comes from `arpi.generation.vehicle.intended_store_assignments()`. The acquisition
  never invents a placement, so a vehicle and its acquisition can never disagree about which store holds
  it (`DQ-ACQ-005`).
- **`Manufacturer Allocation` never occurs at `GSA-003`.** The independent used store holds no
  franchise, so it cannot be allocated a factory unit. This is guaranteed upstream — the vehicle
  generator only ever issues `New` units, and therefore allocations, to the two franchise stores — and
  asserted here by `DQ-ACQ-006`.
- `msrp` is populated for `New` units only. A used or certified unit has no manufacturer sticker in
  ARPI: modelling the original window sticker of a pre-owned vehicle would be inventing a number nobody
  in the transaction ever saw.
- `initial_inventory_status` is **derived, never drawn**: a unit carrying at least $1,200 of
  reconditioning is `In Reconditioning`; a `New` unit needing no work is `In Transit`; everything else is
  `In Stock`. It therefore cannot contradict the reconditioning spend beside it.
- **All money is `decimal.Decimal`**, quantized to `0.01` with `ROUND_HALF_UP` at one governed boundary
  (`arpi.generation.acquisition.money`). Intermediate arithmetic keeps full `Decimal` precision. No
  monetary value is ever a float, and none is ever negative (`DQ-ACQ-004`).

### 14A.4 Realism commitments, and how each is asserted

| Commitment | Mechanism | Assertion |
|---|---|---|
| Cost relates to model year | Calendar depreciation at 85.5%/year | Correlation of `model_year` with used cost is in `(0.30, 0.99)` — a direction and a band, never a point value, and never 1.0 |
| Cost relates to vehicle class | Class-level base MSRP, model-year inflated | Correlation with class base MSRP in `(0.15, 0.95)` |
| Cost relates to condition | Separate new-invoice and used-market paths | New `msrp` present and cost strictly below it |
| Residual variance survives | Every share and mark-up is a triangular draw | Cost is not constant within a `(model_year, vehicle_class)` group |
| Used reconditioning ≫ new | New units get lot prep only (`$0–165`) | Used mean exceeds new mean by more than 5× — measured **$1,700.70** against **$86.08** at `development` |
| Volume is seasonal | 12 month weights, max/min 1.76 | In-window monthly counts are not flat (max/min > 1.12) |
| Volume has day-of-week structure | 7 weekday weights | Sunday is near-dormant; weekdays exceed weekend by more than 2× |
| Models age differently | `model_aging_propensity(make, model)` over an 8-rung ladder, times a condition factor | The fleet carries ≥ 8 distinct propensities |

`aging_propensity` is carried on the record rather than recomputed downstream, so the sale and
inventory-snapshot generators age a Silverado and an Outback differently by construction. Identical
vehicle-aging behaviour across models is a prohibited synthetic pattern
([ARCHITECTURE.md §15.4](ARCHITECTURE.md)).

### 14A.5 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-ACQ-001` | `acquisition_id` is unique | `uniqueness` | critical |
| `DQ-ACQ-002` | Exactly one acquisition exists per vehicle | `uniqueness` | critical |
| `DQ-ACQ-003` | The declared 11-column contract matches, in order | `structural` | critical |
| `DQ-ACQ-004` | No monetary column holds a negative value | `business_rule` | critical |
| `DQ-ACQ-005` | Every acquisition resolves to a known vehicle at its assigned store | `referential` | critical |
| `DQ-ACQ-006` | `GSA-003` books no `Manufacturer Allocation` | `business_rule` | critical |
| `DQ-ACQ-007` | **No prohibited PII column exists** | `privacy` | critical |

## 14B. `sale_event` — implemented source contract (`P1.1-05`)

Module: `src/arpi/generation/sale.py`. Seeding namespace: `sale_event`.

**Grain: one row per finalized vehicle transaction.** The columns mirror
[§14 `warehouse.fact_vehicle_sale`](#14-warehousefactvehiclesale) with every surrogate key replaced by
its natural identifier and every date key by a real date.

### 14B.1 Column contract

Order is significant — the raw loader maps positionally, and this entity has fourteen monetary columns
that would be silently interchangeable if the order drifted.

| # | Column | Type | Null | Notes |
|---:|---|---|---|---|
| 1 | `sale_id` | `varchar(16)` | NN U | `SLE-########`, assigned over `(sale_date, vehicle_id)` |
| 2 | `sale_date` | `date` | NN | Always inside the reporting window |
| 3 | `delivery_date` | `date` | NN | Never before `sale_date`; clamped to the window |
| 4 | `dealership_id` | `varchar(16)` | NN | Selling store |
| 5 | `vehicle_id` | `varchar(16)` | NN U | One unit sells at most once |
| 6 | `customer_id` | `varchar(16)` | NULL | NULL **only** when not `is_retail` |
| 7 | `salesperson_id` | `varchar(16)` | NULL | Never a Finance Manager |
| 8 | `desk_manager_id` | `varchar(16)` | NULL | Desk, Sales or General Manager |
| 9 | `finance_manager_id` | `varchar(16)` | NULL | Finance Manager; retail deals only |
| 10 | `lead_source_id` | `varchar(16)` | NULL | **Reserved for `P1.4`**; always NULL here — see §14B.2 |
| 11 | `sale_type` | `varchar(20)` | NN | `New Retail` \| `Used Retail` \| `Certified Retail` \| `Lease` \| `Wholesale` \| `Dealer Trade` |
| 12 | `is_retail` | `boolean` | NN | **Derived** from `sale_type`; see §14B.3 |
| 13 | `unit_count` | `smallint` | NN | Always `1` |
| 14 | `sale_price` | `numeric(12,2)` | NN | |
| 15 | `msrp` | `numeric(12,2)` | NULL | Carried from the acquisition; `New` units only |
| 16 | `original_asking_price` | `numeric(12,2)` | NN | Carried from the acquisition |
| 17 | `final_asking_price` | `numeric(12,2)` | NN | After age-driven markdowns; `<= original_asking_price` |
| 18 | `acquisition_cost` | `numeric(12,2)` | NN | Carried from the acquisition |
| 19 | `reconditioning_cost` | `numeric(12,2)` | NN | Carried from the acquisition |
| 20 | `pack_amount` | `numeric(12,2)` | NN | The store's dealer pack; a property of the store |
| 21 | `front_end_gross` | `numeric(12,2)` | NN | **May be negative** |
| 22 | `back_end_gross` | `numeric(12,2)` | NN | Zero on every non-retail transaction |
| 23 | `total_gross` | `numeric(12,2)` | NN | **May be negative** |
| 24 | `trade_allowance` | `numeric(12,2)` | NN | `0.00` when there is no trade |
| 25 | `trade_acv` | `numeric(12,2)` | NN | `0.00` when there is no trade |
| 26 | `cash_down` | `numeric(12,2)` | NN | `0.00` on non-retail |
| 27 | `amount_financed` | `numeric(12,2)` | NN | `0.00` on a cash deal and on non-retail. One of the two inputs to the derived finance structure |
| 28 | `finance_reserve_gross` | `numeric(12,2)` | NN | **Added by DASH.6.** `>= 0`. The reserve component of `back_end_gross`. `0.00` on Cash, on Lease and on flat/no-reserve financed deals. **An amount, never a rate** |
| 29 | `lender_id` | `varchar(16)` | NULL | **Added by DASH.6.** Resolves to `dim_lender`. **NULL means NO LENDER EXISTS**, never "lender unknown" |
| 30 | `days_in_inventory_at_sale` | `integer` | NN | `sale_date - acquisition_date`; `>= 0` |
| 31 | `source_system` | `varchar(40)` | NN | `arpi_synthetic_generator` |

`front_end_gross` and `total_gross` are the only columns permitted to be negative. That is deliberate:
suppressing a loss would be the fabrication, not the loss itself.

**DASH.6 added two columns and changed no value.** The contract went from 29 columns to 31. Every
pre-existing column keeps the value it had: a diff of the committed `data/sample/sale_event.csv` before and
after reports two added columns, no removed columns and **zero changed values**. That is the
decomposition-preserving strategy recorded in
[STM-019 §1.2](docs/source-to-target/STM-019-fact-finance-product-sale.md), and it is why the DASH.2–DASH.5
exports, target attainment figures and gross bridge all still hold the numbers they were reviewed against.
The two new columns are drawn from a **dedicated seeding namespace** (`fi_deal_finance`), which is what makes
that guarantee structural rather than lucky.

### 14B.2 What this entity deliberately excludes

**Cancelled deals never appear.** Roughly 4.5% of otherwise-complete deals are unwound before delivery,
which is a real and common event, and the generator models them. They are then **excluded from the
output entirely**. The fact is called `fact_vehicle_sale` and its grain is a *finalized* transaction, so
an unwound deal is not a sale with a flag — it is not a sale. The unit returns to inventory and remains
available to sell later. The cancellation is modelled rather than ignored because it is what makes the
measured sell-through lower than the survival draw alone would produce; it is not modelled as a column
because a cancelled row in a finalized-sale fact would be counted by every additive measure that reads
the fact.

**Manufacturer incentives are excluded, and this materially changes what front-end gross means.** ARPI
models no customer rebate, no dealer cash, no stair-step or volume bonus, no floor-plan credit, and no
holdback paid separately from invoice. `front_end_gross` is
`sale_price − acquisition_cost − reconditioning_cost − pack_amount` and nothing else. A real store's
reported new-vehicle front-end gross is frequently rescued by incentive money that arrives after the
deal, so **ARPI's new-vehicle front end is structurally more negative than a real store's would be**.
Comparisons against published industry gross benchmarks are therefore invalid. Comparisons *within* this
dataset — store against store, month against month, aged against fresh — remain valid, because every row
is struck on the same basis.

**Lead attribution is deferred.** `lead_source_id` is declared and always NULL. The lead, appointment
and campaign entities arrive in `P1.4`; attribution is theirs to make, and inventing it here would create
two sources of truth for one relationship. See §14B.6 for the supported link.

### 14B.3 Derivations and exact identities

- **`is_retail` is a total function of `sale_type`** — `is_retail_for_sale_type()` — and is never drawn.
  True for `New Retail`, `Used Retail`, `Certified Retail` and `Lease`; false for `Wholesale` and
  `Dealer Trade`. Drawn independently it would let wholesale units inflate retail units sold, which is
  the single most consequential overstatement available in dealership reporting. `DQ-SLE-006` asserts
  the derivation row by row.
- **Both gross identities are exact to the cent on every row**, by construction rather than by
  tolerance:
  - `front_end_gross = sale_price − acquisition_cost − reconditioning_cost − pack_amount`
  - `total_gross = front_end_gross + back_end_gross`

  Every operand is a `Decimal`. `DQ-SLE-004` recomputes both and compares exactly; a cent of drift means
  a float reached a monetary value.
- **A retail sale always names a customer; a wholesale or dealer-trade disposal names none.** Buyers come
  from `arpi.generation.customer.select_customer_for_sale()`, which can only return a customer whose
  `first_interaction_date` is on or before the sale date — so a sale can never precede the existence of
  its own buyer. No sale invents a customer identifier the customer entity does not contain
  (`DQ-SLE-005`).
- **Employees are resolved against the SCD Type 2 timeline on the sale date.** A participant must have
  been employed, at that store, in an eligible role, on that day. Salespeople are preferred for
  `salesperson_id`; where a store has no salesperson on staff that day the deal is credited to a sales
  or general manager, which is what happens on a small floor. **A Finance Manager is never eligible as
  the salesperson**: F&I income and vehicle gross are separately measured, and one person holding both
  sides of a deal would corrupt both. `DQ-SLE-008` asserts store, role and date together.
- **Employees genuinely differ.** Selection is weighted by the latent `volume_index × closing_rate_index`
  from `employee_performance_profiles()`, and the negotiated discount is divided by the salesperson's
  `gross_retention_index`, so a strong closer holds more gross without any outcome being deterministic.
  These latent parameters are **generation inputs and never columns** of anything — publishing one would
  turn a fabrication parameter into what looks like a measurement of a person
  ([PRIVACY_AND_ETHICS.md §5](PRIVACY_AND_ETHICS.md)).
- `sale_date` is drawn from a gamma-shaped time-on-lot hazard indexed by **days since acquisition**,
  multiplied by month and day-of-week weights. Indexing on age rather than on the window start is what
  makes a warm-up unit arrive already aged: its remaining hazard is on the declining tail, so it moves
  early in the window instead of behaving like a fresh unit.

### 14B.4 Realism commitments, and how each is asserted

Measured at the `development` profile (900 acquired units, 650 finalized sales), which is the scale the
data-quality suite asserts at. The `test` profile produces about thirty sales across two months — too
few for a correlation or a variance ratio to mean anything, so no distributional claim is made there.

| Commitment | Measured | Asserted as |
|---|---|---|
| Not every acquired unit sells | sell-through **0.7222** (`test`: 0.5167) | band `(0.55, 0.88)` at `development`; `(0.25, 0.80)` at `test` |
| Unsold units remain for the snapshot fact | 250 units still in stock | more than 50 remain |
| A sale never precedes its acquisition | zero violations | `DQ-SLE-003`, critical |
| A genuine negative front-end gross population exists | **24.5%** of deals | present, and a minority: band `[0.01, 0.45]` and `< 0.5` |
| …and it is not confined to one deal type | present in ≥ 3 deal types | ≥ 3 distinct `sale_type` values |
| Used gross varies more than new gross | variance ratio **5.26** | ratio `> 2.0` |
| Gross weakens as age at sale rises | correlation **−0.139** | band `(−0.70, −0.02)`, plus aged mean below fresh mean |
| Sales volume is seasonal | monthly max/min ≈ 1.5 | not flat: max/min `> 1.15` |
| Saturday is the floor's biggest day | Saturday highest, Sunday lowest | asserted both ways |
| `unit_count` is 1 | every row | `DQ-SLE-007`, critical |

Deal mix at `development`: `Used Retail` 42.8%, `New Retail` 23.5%, `Certified Retail` 11.2%, `Wholesale`
9.5%, `Lease` 8.3%, `Dealer Trade` 4.6%.

Where the negative gross comes from is itself modelled rather than sprinkled: wholesale disposals are
priced off inventory investment and straddle break-even, new deals are thin because incentives are
excluded (§14B.2), and any deal can be pushed negative by the dealer pack on a marked-down aged unit.

### 14B.5 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-SLE-001` | `sale_id` is unique | `uniqueness` | critical |
| `DQ-SLE-002` | The declared 29-column contract matches, in order | `structural` | critical |
| `DQ-SLE-003` | No sale precedes the acquisition of its own vehicle | `business_rule` | critical |
| `DQ-SLE-004` | Both gross identities hold exactly, to the cent | `business_rule` | critical |
| `DQ-SLE-005` | Retail carries a known customer; wholesale need not | `referential` | critical |
| `DQ-SLE-006` | `is_retail` is exactly the derivation of `sale_type` | `business_rule` | critical |
| `DQ-SLE-007` | `unit_count` is 1 on every row | `business_rule` | critical |
| `DQ-SLE-008` | Every employee held an eligible role at that store on that date | `referential` | critical |
| `DQ-SLE-009` | **No prohibited PII column exists** | `privacy` | critical |
| `DQ-SLE-010` | A negative-gross population is present and a minority | `business_rule` | warning |

`DQ-SLE-010` is a `warning` rather than a gate on purpose: the exact share is a modelling choice and a
band, not a rule, but its **absence** is a defect — unrealistically clean data is a prohibited synthetic
pattern.

### 14B.6 Helpers for downstream generators

```python
from arpi.generation.sale import SaleLink, sale_links, disposition_dates

def sale_links(config: ArpiConfig, catalogue_path: Path | None = None) -> tuple[SaleLink, ...]
# SaleLink: sale_id, sale_date, dealership_id, customer_id, vehicle_id,
#           vehicle_model_id, salesperson_id, is_retail   -- ordered by sale_id

def disposition_dates(config: ArpiConfig, catalogue_path: Path | None = None) -> dict[str, date]
# vehicle_id -> sale_date. A vehicle absent from the mapping never sold inside the
# window and is still in stock at the end of it.
```

`sale_links()` is the supported way for the `P1.4` attribution generators to mark a lead as sold: pick a
link whose `dealership_id` and `customer_id` match the lead and whose `sale_date` is on or after the
lead's creation date, then carry `sale_id` onto the lead. `disposition_dates()` is what the inventory
snapshot generator uses to stop snapshotting a unit.

### 18A.5 Known interface gap (recorded, not patched)

The source entity emits `month_date_key` as a `YYYYMM01` **integer**, as the Phase 1 cross-agent contract
instructs. `raw.marketing_spend_load` and `staging.stg_marketing_spend` expect a **`month_date` date
column** in that position instead. The two sides do not yet agree, so a load would fail on the column
list. It is recorded here rather than silently patched from one side: the contract is coordinator-owned,
and the reconciliation between the integer key and the date column has to be a deliberate decision.

---

## 16A. `warehouse.fact_lead` — implemented source contract (`P1.4-02`)

| Field | Value |
|---|---|
| **Entity name** | `lead_event` (source entity) → `warehouse.fact_lead` |
| **Layer** | Source entity feeding a transactional fact |
| **Declared grain** | **One row per unique CRM lead.** |
| **Grain key** | `lead_id` → `lead_key` in the warehouse |
| **Natural / source key** | `lead_id` (`LED-#########`) |
| **Foreign keys** | `lead_created_date` → `dim_date`; `dealership_id`; `customer_id`; `vehicle_model_id`; `lead_source_id`; `campaign_id`; `assigned_employee_id`; `sale_id` |
| **History policy** | **Insert-only transactional fact.** A restated lead is handled by deleting that `lead_id` and reinserting it. |
| **Generator** | `src/arpi/generation/lead.py` |
| **Source-to-target mapping** | [STM-011](docs/source-to-target/STM-011-fact-lead.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). Raw table, staging view, warehouse DDL and load **Planned**. |
| **Row counts** | 200 (test) · 6,000 (development) · 55,000 (portfolio, declared) — inside the 40,000–80,000 portfolio target. |

### 16A.1 Column contract (exact names, exact order)

The source entity mirrors `warehouse.fact_lead` with the surrogate key dropped and the remaining keys
carried as natural identifiers, exactly as `sale_event` mirrors `fact_vehicle_sale`. **Eight columns are
nullable, and every one of them is nullable for a modelled reason, never because a value was
unavailable.**

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `lead_id` | `varchar(20)` | no | `LED-#########` | Natural key; the grain. | Deterministic ordinal over arrival order. | Non-personal |
| 2 | `lead_created_date` | `date` | no | Inside the reporting window | Day the lead arrived. | Weighted draw over the window: month-of-year shape × day-of-week shape. | Non-personal |
| 3 | `dealership_id` | `varchar(16)` | no | `GSA-00N` | Store that received the lead. | Weighted draw over the store shares. | Non-personal |
| 4 | `customer_id` | `varchar(16)` | **yes** | `CUS-########` | The shopper. **NULL means an anonymous enquiry** — a real case, never a synthesised shopper. | From the linked sale where sold; otherwise drawn from the governed customer pool, constrained to customers who had already interacted. | Non-personal (governed dimension) |
| 5 | `vehicle_model_id` | `varchar(16)` | **yes** | `VMD-#####` | Model of interest. NULL where the shopper named none. | The model actually sold where sold; otherwise drawn from the store's alignment-weighted pool. | Non-personal |
| 6 | `lead_source_id` | `varchar(16)` | no | `LDS-###` | Governed source. All nineteen are represented. | Weighted draw on `volume_weight`. | Non-personal |
| 7 | `campaign_id` | `varchar(16)` | **yes** | `CMP-#####` | Campaign the lead is attributed to. NULL where the source is unpaid, nothing was running, or attribution failed. | Weighted draw over campaigns active that day for that source and store; 88% attachment. | Non-personal |
| 8 | `assigned_employee_id` | `varchar(16)` | **yes** | `EMP-#####` | Owner of the lead. **NULL means nobody owned it**, and an unowned lead is answered far less often and far later. | Resolved against the SCD Type 2 employee timeline on the arrival date; BDC first for digital sources, the floor for in-person ones. | Non-personal |
| 9 | `sale_id` | `varchar(16)` | **yes** | `SLE-########` | The finalized retail sale this lead produced. | Sale attribution; see §16A.2. | Non-personal |
| 10 | `lead_count` | `smallint` | no | `1` | Additive unit measure at this grain. | Constant. | Non-personal |
| 11 | `first_response_seconds` | `integer` | **yes** | `NULL` or ≥ 30 | Seconds to the first response. **NULL means nobody ever responded — never `0`.** See §16A.3. | Lognormal draw, median 1,500 s, sigma 1.35, adjusted by source, day of week and owner. | Non-personal |
| 12 | `is_contacted` | `boolean` | no | `true` / `false` | Two-way contact established. False on every never-responded lead. | Drawn; probability = source contact rate × response-time influence × owner discipline. | Non-personal |
| 13 | `is_appointment_set` | `boolean` | no | `true` / `false` | An appointment was booked. **Implies `is_contacted`.** | Drawn, conditioned on contact. | Non-personal |
| 14 | `is_appointment_shown` | `boolean` | no | `true` / `false` | The shopper showed. **Implies `is_appointment_set`.** Agrees row-for-row with `fact_appointment`. | Drawn, conditioned on the appointment. | Non-personal |
| 15 | `is_sold` | `boolean` | no | `true` / `false` | The lead produced a finalized retail sale. | **Derived** from the presence of `sale_id`, never drawn. | Non-personal |
| 16 | `is_duplicate` | `boolean` | no | `true` / `false` | The same shopper enquired again at the same store inside 60 days. **Excluded from every funnel numerator and denominator.** | Constructed; see §16A.4. | Non-personal |
| 17 | `original_lead_id` | `varchar(20)` | **yes** | `LED-#########` | The lead this one duplicates. Populated exactly when `is_duplicate`, and always an earlier **non-duplicate** lead. | The root of the shopper-and-store window. | Non-personal |
| 18 | `days_to_sale` | `integer` | **yes** | `NULL` or ≥ 0 | Days from arrival to the sale. NULL exactly when not sold. | Derived: `sale_date - lead_created_date`. | Non-personal |
| 19 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 16A.2 Sale attribution

`is_sold` is only ever set by attaching the lead to a **finalized retail sale that exists in the sale
generator's output**. Only retail sales carry a customer, so only retail sales are linkable from the
funnel — a wholesale unit went to the auction and no shopper ever sat at a desk for it.

**72%** of finalized retail sales are lead-attributed. Pretending it were 100% would make lead-to-sale
conversion look like a complete picture of the store, which it is not. Each eligible sale is offered to
the leads at its own store that arrived within 120 days before it, were contacted, and are not already
credited with a deal; the winner is drawn weighted by the source close rate, the owner's closing index,
and the funnel stage reached — `1.0` with no appointment, `1.7` with one set, **`4.2` with one shown**.
That weighting is what makes *appointment-shown leads convert at a higher rate* true in the data.

The sale supplies the lead's `customer_id` and `vehicle_model_id`, so a sold lead cannot disagree with
the deal it claims.

### 16A.3 NULL is not zero — the rule this entity exists to protect

A lead nobody responded to carries `first_response_seconds = NULL`. **It never carries `0`.**

Zero would mean the store answered instantaneously, the exact opposite of what happened. Averaging those
zeros in makes the stores that ignore leads look like the fastest in the group, and because the number
moves in the flattering direction, nobody investigates it. A genuine response is floored at 30 seconds,
because no human answers in zero.

The distribution is **right-skewed** by construction: at development scale the median is 1,714 seconds
against a mean of 4,707, a ratio of 2.75. Reporting the mean alone is therefore misleading here in the
same way it is in a real store, which is what makes the mean-versus-median governance rule in
[KPI_CATALOG.md](KPI_CATALOG.md) load-bearing rather than decorative.

**No `NOT NULL DEFAULT 0` may ever be placed on this column.** It would destroy the distinction
silently and irreversibly.

### 16A.4 Duplicates, and where the numerator and denominator are defined

`arpi.generation.lead.funnel_population(frame)` is the **one place** the exclusion rule lives. Every
funnel measure is: numerator = rows of that population whose stage flag is true; denominator = rows of
that population. **Duplicates are excluded from both.** In the denominator they understate every
conversion rate by counting one shopper twice as an opportunity; in the numerator they double-count one
opportunity's outcome. There is no measure for which including them is correct.

A duplicate is **constructed** — the generator deliberately reuses a shopper who enquired at the same
store inside the last 60 days — rather than discovered by waiting for two draws to collide, which would
make the duplicate share collapse at portfolio scale. Measured share: 0.085 (test), 0.077 (development).
A lead credited with a sale is never marked a duplicate.

### 16A.5 No communication content, at any layer

There is no `message_body`, `message`, `subject`, `transcript`, `recording`, `call_recording`, `note`,
`notes`, `comment`, `comments`, `chat_log` or `voicemail` column, and no free-text field of any kind.
`DQ-LED-007` inspects the **schema**, so a prohibited column fails the run even when it holds no values.
That is intended behaviour.

### 16A.6 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-LED-001` | `lead_id` is unique | `uniqueness` | critical |
| `DQ-LED-002` | The declared 19-column contract matches, in order | `structural` | critical |
| `DQ-LED-003` | **The funnel implication chain holds** | `business_rule` | critical |
| `DQ-LED-004` | **Never-responded leads carry NULL, never zero** | `completeness` | critical |
| `DQ-LED-005` | Every sold lead resolves to a finalized retail sale | `referential` | critical |
| `DQ-LED-006` | Duplicates carry a resolvable original lead reference | `business_rule` | critical |
| `DQ-LED-007` | **No prohibited PII or communication-content column exists** | `privacy` | critical |
| `DQ-LED-008` | The response-time distribution is right-skewed | `business_rule` | warning |

---

## 17A. `warehouse.fact_appointment` — implemented source contract (`P1.4-03`)

| Field | Value |
|---|---|
| **Entity name** | `appointment_event` (source entity) → `warehouse.fact_appointment` |
| **Layer** | Source entity feeding a transactional fact |
| **Declared grain** | **One row per scheduled appointment.** |
| **Grain key** | `appointment_id` → `appointment_key` in the warehouse |
| **Natural / source key** | `appointment_id` (`APT-########`) |
| **Foreign keys** | `created_date`, `scheduled_date`, `show_date` → `dim_date` (three role-playing keys); `dealership_id`; `lead_id`; `customer_id`; `salesperson_id`; `bdc_employee_id`; `vehicle_model_id`; `sale_id` |
| **History policy** | **Insert-only transactional fact.** Loaded after `fact_lead`, because `lead_key` is `NOT NULL`. |
| **Generator** | `src/arpi/generation/appointment.py` |
| **Source-to-target mapping** | [STM-012](docs/source-to-target/STM-012-fact-appointment.md) |
| **Implementation status** | **Implemented** (generator, contract, data-quality suite). Raw table, staging view, warehouse DDL and load **Planned**. |
| **Row counts** | 76 (test) · 2,111 (development) · ≈19,400 (portfolio, **projected** from development, inside the 10,000–25,000 target). |

### 17A.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | Derivation | **PII class** |
|---:|---|---|---|---|---|---|---|
| 1 | `appointment_id` | `varchar(20)` | no | `APT-########` | Natural key; the grain. | Deterministic ordinal over `(created_date, lead_id, sequence)`. | Non-personal |
| 2 | `created_date` | `date` | no | Inside the reporting window | Day the appointment was booked. Never before its lead arrived. | Lead arrival plus a weighted booking lag. | Non-personal |
| 3 | `scheduled_date` | `date` | no | ≥ `created_date` | Day it was booked for. **Role-playing date key.** | Creation plus a weighted lead time, clamped to the window and to the sale date where sold. | Non-personal |
| 4 | `show_date` | `date` | **yes** | `NULL` or `= scheduled_date` | Day the shopper arrived. **Role-playing date key.** NULL exactly when not shown. | Equals `scheduled_date` when shown. | Non-personal |
| 5 | `dealership_id` | `varchar(16)` | no | `GSA-00N` | Store. Always the lead's store. | Carried from the lead. | Non-personal |
| 6 | `lead_id` | `varchar(20)` | no | `LED-#########` | The opportunity behind the appointment. Never NULL. | The lead that set it. | Non-personal |
| 7 | `customer_id` | `varchar(16)` | **yes** | `CUS-########` | The shopper. NULL where the lead was anonymous. | Carried verbatim from the lead. | Non-personal |
| 8 | `salesperson_id` | `varchar(16)` | **yes** | `EMP-#####` | Salesperson expected to take it. NULL where the store had nobody eligible that day. | Resolved against the SCD Type 2 timeline on the **scheduled** date. | Non-personal |
| 9 | `bdc_employee_id` | `varchar(16)` | **yes** | `EMP-#####` | Business development representative who booked it. NULL is common: a store with no BDC books off the floor. | Resolved against the SCD Type 2 timeline on the **created** date. | Non-personal |
| 10 | `vehicle_model_id` | `varchar(16)` | **yes** | `VMD-#####` | Model of interest. | Carried verbatim from the lead. | Non-personal |
| 11 | `sale_id` | `varchar(16)` | **yes** | `SLE-########` | The finalized retail sale this visit produced. | The lead's sale, on the shown appointment only. | Non-personal |
| 12 | `appointment_count` | `smallint` | no | `1` | Additive unit measure at this grain. | Constant. | Non-personal |
| 13 | `is_confirmed` | `boolean` | no | `true` / `false` | Confirmed before the slot. Predicts attendance without determining it. | Drawn conditioned on the outcome: 0.84 shown, 0.52 broken. | Non-personal |
| 14 | `is_cancelled_in_advance` | `boolean` | no | `true` / `false` | **The shopper rang ahead.** Mutually exclusive with `is_shown`. | 45% of broken appointments. | Non-personal |
| 15 | `is_shown` | `boolean` | no | `true` / `false` | **The shopper arrived.** | The last appointment of a lead flagged `is_appointment_shown`. | Non-personal |
| 16 | `is_test_drive` | `boolean` | no | `true` / `false` | The visit included a test drive. Implies `is_shown`. | 63% of shown. | Non-personal |
| 17 | `is_write_up` | `boolean` | no | `true` / `false` | A deal was written. **Implies `is_shown`.** | 55% of shown; always true when sold. | Non-personal |
| 18 | `is_sold` | `boolean` | no | `true` / `false` | The visit produced a finalized retail sale. | **Derived** from the presence of `sale_id`. | Non-personal |
| 19 | `minutes_early_or_late` | `integer` | **yes** | `NULL` or `-45`..`120` | Minutes relative to the booked time; negative is early. **NULL when nobody showed — never `0`.** | `round(gauss(7, 16))`, clamped. | Non-personal |
| 20 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Constant. | Non-personal |

### 17A.2 An advance cancellation is not a no-show

The three outcomes are three different events, and they partition the population:

| Outcome | `is_cancelled_in_advance` | `is_shown` | The store's time |
|---|:--:|:--:|---|
| Advance cancellation | `true` | `false` | Returned — the slot could be rebooked |
| **No-show** | `false` | `false` | Held and lost |
| Shown | `false` | `true` | Used |

Conflating the first two understates broken appointments, and it lets the show rate be flattered by
choosing the denominator after the fact. At development scale the two denominators genuinely differ:
**0.486** against all appointments, **0.633** excluding advance cancellations. A reporting view must
therefore state which it means ([KPI_CATALOG.md](KPI_CATALOG.md) §27). `DQ-APT-004` fails the run on any
row claiming both.

Measured shares at development scale: shown 0.486, advance cancellation 0.233, **no-show 0.282**.

### 17A.3 One lead, several appointments

A lead that sets an appointment produces 1 (0.72), 2 (0.21) or 3 (0.07) of them. At development scale
that is **1.345 appointments per appointment-setting lead**, with 27% of those leads booking more than
once — so the grain difference against `fact_lead` is exercised rather than declared. The **last**
appointment carries the lead's outcome; the earlier ones are the broken bookings that a lead-grain-only
model would have hidden.

### 17A.4 NULL is not zero

`minutes_early_or_late` is NULL when nobody showed. **Zero is a real value meaning exactly on time**, and
encoding an absent arrival as zero would make every broken appointment the most punctual in the dataset.
`DQ-APT-007` enforces both directions. **No `NOT NULL DEFAULT 0` may ever be placed on this column.**

### 17A.5 Data-quality checks

| Check ID | Assertion | Category | Severity |
|---|---|---|---|
| `DQ-APT-001` | `appointment_id` is unique | `uniqueness` | critical |
| `DQ-APT-002` | The declared 20-column contract matches, in order | `structural` | critical |
| `DQ-APT-003` | **Date ordering**: nothing scheduled or shown before creation | `business_rule` | critical |
| `DQ-APT-004` | **Shown implies not cancelled in advance** | `business_rule` | critical |
| `DQ-APT-005` | A write-up implies a show | `business_rule` | critical |
| `DQ-APT-006` | Sold implies shown and links to a finalized retail sale | `referential` | critical |
| `DQ-APT-007` | **`minutes_early_or_late` is NULL when not shown** | `completeness` | critical |
| `DQ-APT-008` | **No prohibited PII or communication-content column exists** | `privacy` | critical |

---

## 40. The sanitized public inventory listing lane (ADR-0011)

Three objects, one lane. Everything here is **sanitized public reference data**: the
dealer and vehicle identifiers are synthetic, the listing attributes are a de-identified
public reference snapshot. The canonical committed artifact is
`ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx` at
`data/reference/inventory/gsa-001/2026-08-02/`.

### 40.1 `raw.inventory_listing_snapshot_load`

**Grain** — one row per Inventory-sheet data row of one sanitized workbook within one load
batch. Every business column is `text`; typing happens in staging.

There is **no original VIN column and no source URL column**, and there never may be. The
sanitizer removes both, the validator refuses a workbook carrying either (DQ-LST-005,
DQ-LST-006), and the importer cannot COPY a column this table does not declare.

Load metadata: `load_batch_id`, `source_file_name` (preserved exactly, underscores and
capitalisation included), `source_file_digest` (SHA-256, shape-checked), `source_row_number`,
`ingested_at`.

### 40.2 `staging.stg_inventory_listing_snapshot`

**Grain** — one accepted row per `(dealership_id, captured_at, synthetic_vehicle_id)` in
the newest load batch. Three views, one rule set, as every other ARPI entity: `_typed`,
the accepted view, and `_rejected`.

Rejections, in precedence order: `REJ-TYPE-001` (unrepresentable in the governed type),
`REJ-NULL-001` (required value absent), `REJ-DOMAIN-001` (outside a domain, a range, the
classification, or the pricing contract), `REJ-REF-001` (store does not resolve, or its
name disagrees with the registry on the capture date), `REJ-KEY-001` (duplicate grain).

### 40.3 `warehouse.dim_observed_vehicle`

**Grain** — one row per sanitized physical vehicle identity observed through a public
listing source. **Type 1**, and ADR-0006 requires the reason: the listing fact already
preserves observation history, so a second parallel history here would answer no question
and could disagree with the fact.

| Column | Type | Notes |
|---|---|---|
| `observed_vehicle_key` | `integer` | Primary key |
| `synthetic_vehicle_id` | `varchar(24)` | Business key. Group-stable: the same vehicle at any store |
| `synthetic_vin` | `varchar(24)` | `ARPI`-prefixed. `I` is not a VIN character, so it can never be a real VIN |
| `condition_type` | `varchar(16)` | `New` or `Used`, as advertised |
| `model_year`, `make`, `model`, `trim`, `vehicle_display` | | As most recently advertised |
| `source_system` | `varchar(40)` | `arpi_sanitized_public_reference` |
| `first_observed_at` | `date` | **Not** an acquisition date |
| `last_observed_at` | `date` | **Not** a sale date |

Deliberately absent: acquisition source and date, colour, MSRP, inventory cost,
reconditioning cost, ownership status, sold status, customer and employee linkage. Each
would require data this source does not have. **The absence is the contract.**

### 40.4 `warehouse.fact_vehicle_listing_snapshot`

**Grain** — one observed vehicle listing per dealership per `captured_at` value, enforced
by `uq_fact_vehicle_listing_snapshot_grain`.

| Column | Type | Additivity |
|---|---|---|
| `vehicle_listing_snapshot_key` | `bigint` | Primary key |
| `snapshot_date_key`, `dealership_key`, `observed_vehicle_key` | `integer` | The declared grain |
| `captured_at` | `date` | When the listing was **seen** |
| `odometer_miles` | `integer` NULL | **Non-additive.** NULL means the listing published no mileage, which is not a zero reading and must not be coalesced to one |
| `advertised_price` | `numeric(12,2)` | **Semi-additive.** NULL exactly when `pricing_status` is `Call for price` or `Price not exposed` |
| `pricing_status` | `varchar(20)` | `Listed`, `Call for price` or `Price not exposed`. The last two both mean `advertised_price` is NULL and are deliberately distinct: `Call for price` records a displayed merchandising choice, `Price not exposed` records that the listing surface published no price field at all |
| `inventory_unit_count` | `smallint` | Always 1. **Semi-additive** |
| `source_batch_id`, `source_file_name`, `source_file_digest`, `source_system` | | Lineage |

**What `advertised_price` is not:** transaction price, acquisition cost, inventory
investment, MSRP, or gross.

**What the absence of a row means:** the listing was **removed from listing** on that
capture. That is not *sold* — it can equally be a trade, a wholesale, a feed suppression
or an error, and this data cannot tell them apart.

Historical snapshots are **immutable**: the load inserts and never updates.

### 40.5 Reporting views

`vw_vehicle_listing_current`, `_summary`, `_model_mix`, `_price_completeness`,
`_observation_span`, `_change`. Held separate from `MVP_REPORTING_VIEWS` in
`arpi.constants`, because those 28 are what the SQL baseline measured and the semantic
model binds to.

`vw_vehicle_listing_change` emits six labels — New Listing, Still Listed, Removed From
Listing, Price Increase, Price Reduction, Price Unchanged — and **there is no sold label,
and there must never be one.**

`vw_vehicle_listing_observation_span.days_observed_online` is **not days in stock.** Days
in stock runs from acquisition and lives on `warehouse.fact_vehicle_inventory_snapshot`;
this lane never sees it.

---

## 41. `warehouse.fact_sales_target` — implemented contract (`DASH.5`)

The monthly operating **plan**. One lane, four objects: a raw landing table, a staging view set, this
fact, and one reporting view. Authorized by
[ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md) and delivery increment
**DASH.5**, to answer **SQ-31** ("Are we hitting our operating targets, by store and by department?").

| Field | Value |
|---|---|
| **Entity name** | `sales_target` (source entity) → `warehouse.fact_sales_target` |
| **Layer** | Warehouse fact (monthly plan / periodic snapshot of an intention) |
| **Declared grain** | **One row per dealership, per target month, per targeted KPI, per target scope (scope type + scope id).** |
| **Grain key** | `(dealership_key, target_month_date_key, kpi_id, target_scope_type, target_scope_id)` — `uq_fact_sales_target_grain`, five `NOT NULL` columns |
| **Natural / source key** | `sales_target_id` (`TGT-########`) |
| **Foreign keys** | `target_month_date_key` → `dim_date`; `dealership_key` → `dim_dealership`; `employee_key` → `dim_employee` (nullable) |
| **History policy** | **Revisable plan, not an event log.** The load is an idempotent upsert on the grain: reloading an unchanged plan writes nothing, and a revised plan replaces the value in place. There is no target-history fact and DASH.5 does not claim one. |
| **Generator** | `src/arpi/generation/sales_target.py` |
| **Source-to-target mapping** | [STM-016](docs/source-to-target/STM-016-fact-sales-target.md) |
| **Downstream** | `reporting.vw_target_attainment` → dashboard dataset `target-attainment` → the console's targets-and-pace sections |
| **KPI ownership** | `KPI-TGT-001` … `KPI-TGT-010` ([KPI_CATALOG.md §39](KPI_CATALOG.md)) |
| **Implementation status** | **Implemented** end to end: generator, raw, staging, fact, load script, reporting view, reconciliations, export, console. |
| **Row counts** | 24 (test) · 72 (development) · 288 (portfolio). Four rows per store-month × 3 stores × the profile's month count. |
| **Lane** | **Dashboard program.** Not an MVP fact, not in `MVP_REPORTING_VIEWS`, not bound by the Power BI semantic model. |

### 41.1 What this fact is, and what it is not

**It is the plan.** A row states what a store committed to produce in one calendar month, at one governed
scope, for one governed metric.

**Every value is a synthetic internal operating goal for the fictional Granite Auto Group.** It is not an
industry benchmark, not a manufacturer objective, not a market standard, not a real dealership's plan and
not a recommendation. No consumer of this fact may describe a value here as *good*, *average*, *standard*
or *recommended* — a rule the console enforces in code and the test suite asserts by scanning the source
for verdict vocabulary.

**It is not an outcome.** The generator that writes these rows may not read a realized sale, and does not:
its inputs are the store planning baselines, the governed calendar's selling days, a seasonality shape and
a seeded planning draw. Two tests hold that line — an AST walk over the generator's import graph asserting
no path reaches the sale generator or the sale fact, and a test that monkeypatches the sale generator to
`None` and asserts the plan is byte-identical. A plan derived from the month's realized sales would make
every attainment ratio a tautology.

### 41.2 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `sales_target_key` | `bigint` | no | > 0 | Surrogate primary key, deterministic over the grain order. | Non-personal |
| 2 | `target_month_date_key` | `integer` | no | `YYYYMM01` | **Always the first day of the target month**, so the plan and the actual agree on what a month is, and so the selling-day denominator resolves from `dim_date`. | Non-personal |
| 3 | `dealership_key` | `integer` | no | resolves to `dim_dealership` | The store the plan belongs to, resolved **as at the month start** through the SCD2 dimension. | Non-personal |
| 4 | `target_scope_type` | `varchar(12)` | no | `Store`, `Department`, `Employee` | Decides which actual is the comparable numerator, and whether the row is a store total or a refinement of one. | Non-personal |
| 5 | `target_scope_id` | `varchar(40)` | **no, on every scope type** | store `dealership_id`, department name, or employee synthetic id | The scope's own business identity. See §41.3 for why this may not be nullable. | Non-personal |
| 6 | `department_name` | `varchar(20)` | yes | `Sales`, `Finance` | Present **exactly** on `Department` scope, NULL everywhere else, and always equal to `target_scope_id`. | Non-personal |
| 7 | `employee_key` | `integer` | yes | resolves to `dim_employee` | Present **exactly** on `Employee` scope, NULL everywhere else. No employee-scope row is generated by DASH.5. | Non-personal |
| 8 | `kpi_id` | `varchar(16)` | no | `KPI-SLS-001`, `KPI-GRS-001`, `KPI-GRS-002`, `KPI-GRS-003` | **The metric being targeted.** Never a `KPI-TGT-*` identifier — see §41.4. | Non-personal |
| 9 | `target_value` | `numeric(14,2)` | no | ≥ 0 | The month's committed goal. A unit target is a whole number carried at cent scale (`45.00`); a gross target is USD to the cent. **Exact `numeric`, generated as `Decimal`, never a float.** | Non-personal |
| 10 | `stretch_target_value` | `numeric(14,2)` | no | ≥ `target_value` | The month's stretch goal. Governed data with **no DASH.5 console surface**: it is exported nowhere and is reserved for the management-planning surfaces later increments own. | Non-personal |
| 11 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker: what stops a reader mistaking a synthetic operating goal for a real dealership plan. | Non-personal |

**No customer or employee personal data exists on this fact.** An employee-scope row would carry a
surrogate key into `warehouse.dim_employee`, which holds a synthetic identifier and no name, no pay plan
and no contact detail.

### 41.3 The scope model, and the NULL problem it had to solve

| Scope | `target_scope_id` holds | `department_name` | `employee_key` | May target |
|---|---|---|---|---|
| `Store` | the store's own `dealership_id` | NULL | NULL | `KPI-SLS-001` (retail units), `KPI-GRS-003` (total gross) |
| `Department` | the department name | the same value | NULL | `Sales` → `KPI-GRS-001` (front-end gross); `Finance` → `KPI-GRS-002` (back-end gross) |
| `Employee` | the employee's synthetic id | NULL | the resolved key | `KPI-SLS-001` |

**Department and employee rows are refinements, never addends.** A store total reads `Store`-scope rows
only. Summing every row of a store-month would double-count the store's gross, which is why `KPI-TGT-001`
and `KPI-TGT-003` both filter on the scope.

**Retail units are store-scope only, by design.** A retail unit is delivered once. A Sales-department unit
target would reproduce the store target, and a Finance-department one would count the same car a second
time. F&I measures are computed *per* the sales department's unit count, not on a unit count of their own.

**Why `target_scope_id` is `NOT NULL` on every scope type.** The obvious modelling — a nullable
`department_name` and a nullable `employee_id`, NULL meaning "store scope" — cannot be enforced.
PostgreSQL treats NULLs as **distinct** inside a `UNIQUE` constraint, so a grain over nullable scope
columns would permit unlimited duplicate store-level targets for the same store, month and KPI, and the
constraint would look correct while enforcing nothing. Carrying the scope's own identity in one `NOT NULL`
column makes the grain constraint five `NOT NULL` columns wide and therefore real. `DQ-TGT-001` and an
integration test that attempts the duplicate insert both hold it.

**The rule a `CHECK` cannot express.** Exactly one scope rule spans two tables: a `Store`-scope row's
`target_scope_id` must equal *its own* store's `dealership_id`, and `dealership_id` lives in
`warehouse.dim_dealership`. A `CHECK` cannot read another table, and a trigger would be a hidden second
load path. That rule is enforced in `staging.stg_sales_target` as a `REJ-DOMAIN-001` rejection and
asserted by `DQ-TGT-006`. **Every other scope rule is a physical `CHECK`** (§41.5).

### 41.4 `kpi_id` names the metric being targeted, never the target KPI

A row planning the month's retail units carries `kpi_id = 'KPI-SLS-001'`. `KPI-TGT-001`
(*Retail unit target*) is the governed measure **computed from** such rows by
`reporting.vw_target_attainment`; storing it here would make the fact describe its own consumer, and would
mean the fact's KPI vocabulary changed every time a downstream view was added. The same holds for
`KPI-GRS-003` and `KPI-TGT-003`. `ck_fact_sales_target_kpi_domain` restricts the column to the four
metrics the domain targets, so a `KPI-TGT-*` value is physically unwritable.

### 41.5 Physical constraints

| Constraint | Rule |
|---|---|
| `pk_fact_sales_target` | `sales_target_key` is the primary key |
| `uq_fact_sales_target_grain` | **The declared grain**, over five `NOT NULL` columns |
| `ck_fact_sales_target_key_positive` | `sales_target_key > 0` |
| `ck_fact_sales_target_scope_type_domain` | `target_scope_type IN ('Store','Department','Employee')` |
| `ck_fact_sales_target_scope_id_not_blank` | A scope identity is not whitespace |
| `ck_fact_sales_target_kpi_domain` | `kpi_id` is one of the four targeted metrics |
| `ck_fact_sales_target_source_system_not_blank` | Lineage is always stated |
| `ck_fact_sales_target_month_key_is_first_of_month` | `target_month_date_key % 100 = 1` |
| `ck_fact_sales_target_value_nonnegative` | A negative goal is not a goal: it would invert every attainment ratio |
| `ck_fact_sales_target_stretch_not_below_target` | A stretch beneath the commitment is not a stretch. **Equality is permitted** — a one-unit target multiplied by the stretch factor rounds back to one unit, and refusing that would forbid a legitimate small-store plan |
| `ck_fact_sales_target_department_scope_coupling` | `department_name` is present **exactly** on `Department` scope |
| `ck_fact_sales_target_department_identity` | `department_name = target_scope_id` when present |
| `ck_fact_sales_target_employee_scope_coupling` | `employee_key` is present **exactly** on `Employee` scope |
| `ck_fact_sales_target_scope_metric` | **The anti-double-counting rule**: which metric each scope may target (§41.3) |
| `fk_fact_sales_target_month` / `_dealership` / `_employee` | Conformed-dimension foreign keys, `ON DELETE RESTRICT` |
| `ix_fact_sales_target_store_month` | Read path: `(dealership_key, target_month_date_key)` |

### 41.6 Zero, NULL and absence are three different statements

- **A row with `target_value = 0`** means *the plan for this scope-month is zero.* It is a plan.
- **The absence of a row** means **no target was set.** It is not a target of zero, and the reporting view
  publishes `is_target_present = false` with a NULL target rather than substituting one. A missing plan
  must never be read as a plan to sell nothing.
- **A NULL attainment ratio** means the denominator was not eligible — no target row, or a target of zero.
  `target_attainment_ratio` divides by `nullif(target_value, 0)` for exactly this reason: attainment
  against a zero target is undefined, not infinite and not 100%.

The reporting view's frame is the **union** of the governed applicable scope set and the target rows that
exist, so a store-month with no plan still appears, carrying `is_target_present = false`. A view that
inner-joined the fact would make an unplanned month invisible instead of visibly unplanned.

### 41.7 Business rules

- `target_month_date_key` is always the **first day of the month**.
- The grain is unique. Duplicates are a `critical` failure, not a warning.
- `stretch_target_value >= target_value` on every row.
- **The department gross targets partition the store gross target exactly**: for each store-month,
  `Sales` front-end gross target + `Finance` back-end gross target = the store's total-gross target, to the
  cent. `warehouse.fact_vehicle_sale` enforces the same identity on the actual side
  (`total_gross = front_end_gross + back_end_gross`), so the department actuals sum to the store actual with
  no overlap and no gap. `DQ-TGT-012` and `RECON-TGT-DEPT-SPLIT` both assert it, and a seeded
  ±$1.00 corruption proves the assertion is alive.
- **Group attainment is `SUM(numerator) / SUM(denominator)`**, never the average of the store percentages.
  A group figure computed as an average of ratios weights a small store equally with a large one and is
  simply a different number; the KPI verification suite asserts the two disagree on the committed dataset,
  so the correct rule cannot be silently replaced by the wrong one.
- **Selling days come from `warehouse.dim_date.is_selling_day` and from nowhere else** (ADR-0002). No
  JavaScript calendar, no DAX calendar, no wall-clock date.
- **Pace and projection never read `current_date`.** The as-of date is the governed dataset as-of — the
  maximum date across the sale, snapshot and lead bases — clamped to the month end. A dashboard that read
  the wall clock would silently change its own numbers on a day nobody published anything.

### 41.8 Data-quality checks

All fourteen are `critical` and evaluate in the Python layer, over the generated frame, before a row
reaches the database. The SQL layer's counterpart is not a duplicate check family but the physical
constraints in §41.5 and the reconciliations in §41.9.

| Check ID | Assertion | Category |
|---|---|---|
| `DQ-TGT-001` | The declared grain is unique | `uniqueness` |
| `DQ-TGT-002` | The declared 11-column contract matches, in order | `structural` |
| `DQ-TGT-003` | **Every `target_month_date_key` is the first day of its month** | `business_rule` |
| `DQ-TGT-004` | Every target month lies inside the reporting window | `business_rule` |
| `DQ-TGT-005` | Every scope type is in the governed vocabulary | `business_rule` |
| `DQ-TGT-006` | **The scope identity columns agree with the scope type** (the store-identity half of this is the staging rule of §41.3) | `business_rule` |
| `DQ-TGT-007` | The targeted metric is one the domain supports **for that scope** | `business_rule` |
| `DQ-TGT-008` | Every `dealership_id` names a governed store | `referential` |
| `DQ-TGT-009` | No target or stretch target is negative | `business_rule` |
| `DQ-TGT-010` | The stretch goal is never beneath the committed goal | `business_rule` |
| `DQ-TGT-011` | **Every value is a `Decimal` with at most two decimal places** — no float ever enters the lane | `structural` |
| `DQ-TGT-012` | **Department gross targets partition the store gross target** | `business_rule` |
| `DQ-TGT-013` | The lineage marker is the synthetic generator, on every row | `structural` |
| `DQ-TGT-014` | **No prohibited PII column exists** | `privacy` |

Two further guards are not DQ checks because they are properties of the *code*, not of the data:
the import-graph assertion and the sale-generator-removed assertion of §41.1.

### 41.9 Reconciliations

`audit.vw_recon_target` publishes ten `RECON-TGT-*` / `RECON-FACT-SALES-TARGET-*` reconciliations in the
project's uniform eight-column result shape, and joins `audit.vw_recon_all`. They cover the row-count chain
from raw through staging to the fact, the grain, the department partition, scope-metric legality, the
store-total-versus-refinement rule, the reporting view's agreement with the fact, and the selling-day
denominator's agreement with `dim_date`. Three of them are exercised by **seeded corruptions** in
`tests/integration/test_reconciliations.py` — a dropped grain constraint with a duplicate insert, a
department split moved by $1.00, and a deleted fact row — so the suite proves the reconciliations detect
what they claim to detect rather than merely returning `Passed`.

### 41.10 History, restatement and what this fact deliberately does not record

The load is an **idempotent upsert on the grain**. Reloading the same plan writes nothing; a revised plan
overwrites the value.

**There is therefore no record of what the target used to be.** That is a deliberate limitation, not an
oversight: a plan-revision history would need its own fact, its own grain (one row per revision), an
effective-dated read path, and a stakeholder question that requires it. None of those exists, and
inventing them to look thorough would add an unowned table to the warehouse. It is recorded in
[LIMITATIONS.md](LIMITATIONS.md) and in [STM-016](docs/source-to-target/STM-016-fact-sales-target.md) §13.

Also deliberately absent: any approval state, any author or approver identity, any target-change
notification, any target-editing path. The console **reads** targets and cannot write them.

---

## 42. `warehouse.dim_finance_product` — implemented contract (`DASH.6`)

The governed F&I **menu**. Authorized by
[ADR-0013](docs/architecture-decisions/ADR-0013-governed-web-operating-console.md) and delivery increment
**DASH.6**, to answer **SQ-21** ("What is our F&I performance, by product and by store?").

| Field | Value |
|---|---|
| **Entity name** | `finance_product` (source entity) → `warehouse.dim_finance_product` |
| **Layer** | Warehouse dimension (reference catalogue) |
| **Declared grain** | **One row per finance product definition.** |
| **Grain key** | `finance_product_key` (PK); `uq_dim_finance_product_finance_product_id`; `uq_dim_finance_product_product_name` |
| **Natural / source key** | `finance_product_id` (`FP-###`) |
| **Foreign keys** | None. A product row references nothing. |
| **History policy** | **SCD Type 1** ([ADR-0006](docs/architecture-decisions/ADR-0006-scd-type-selection-phase-1.md)). A corrected name or restated rule is a **correction**, applied retroactively. There is no `effective_date`, `expiration_date`, `is_current` or `attribute_hash`, and `DQ-FPD-010` asserts their absence. |
| **Generator** | `src/arpi/generation/finance_product.py` |
| **Source-to-target mapping** | [STM-017](docs/source-to-target/STM-017-dim-finance-product.md) |
| **Downstream** | `fact_finance_product_sale`, `fact_finance_product_adjustment`, `reporting.vw_deal_product_detail`, `reporting.vw_fi_product_penetration`, `reporting.vw_fi_adjustment_summary` |
| **KPI ownership** | Category dimension of `KPI-FNI-007` … `KPI-FNI-011`, `KPI-FNI-020`, `KPI-FNI-021` ([KPI_CATALOG.md §40](KPI_CATALOG.md)) |
| **Implementation status** | **Implemented** end to end: generator, raw, staging, dimension, merge, reporting views, data-quality suite. |
| **Row counts** | **19 on every profile.** The catalogue is declared, not sampled: it consumes no random variate, so it does not scale with the window, the store count or the seed. |
| **Lane** | **Dashboard program.** Not a ninth MVP dimension, not in `MVP_REPORTING_VIEWS`, not bound by the Power BI semantic model. |

### 42.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `finance_product_key` | `integer` | no | > 0 | Surrogate primary key, assigned by the merge as `max(existing) + row_number() OVER (ORDER BY finance_product_id)`. Never taken from the source, never reused. | Non-personal |
| 2 | `finance_product_id` | `varchar(16)` | no | `FP-###`, unique | Natural key. What every product contract resolves through. | Non-personal |
| 3 | `product_name` | `varchar(80)` | no | unique | **Fictional** product label such as `Granite Shield Powertrain Plus`. Names an invented product of an invented administrator — never a person, never a real F&I product or program. | Non-personal |
| 4 | `product_category` | `varchar(40)` | no | the ten governed categories | **A ROW VALUE, never a column.** See §42.5. | Non-personal |
| 5 | `provider_name` | `varchar(60)` | no | four declared administrators | **Fictional** administrator label. An **attribute by deliberate decision** — see §42.6. | Non-personal |
| 6 | `eligibility_rule_id` | `varchar(16)` | no | `ELIG-VSC`, `ELIG-GAP`, `ELIG-TW`, `ELIG-PPM`, `ELIG-LWP`, `ELIG-OTH` | **Stamped** from `config/reference/fi_product_eligibility.yaml`, the one eligibility authority. | Non-personal |
| 7 | `eligible_finance_structures` | `varchar(60)` | no | pipe-delimited subset of `Cash`, `Retail Finance`, `Lease` | **Derived** descriptive metadata, not an authority. `DQ-FPD-006` proves it cannot disagree with the configuration. | Non-personal |
| 8 | `eligible_vehicle_conditions` | `varchar(40)` | no | pipe-delimited subset of `New`, `Used`, `Certified` | Derived the same way. `ELIG-PPM` narrows to `Certified \| New`. | Non-personal |
| 9 | `default_contract_term_months` | `smallint` | no | `12`–`120` | **The PRODUCT CONTRACT's default coverage term. THIS IS NOT A FINANCE LOAN TERM** — ARPI models no loan term, no APR, no payment and no rate of any kind, and the two must never be conflated. | Non-personal |
| 10 | `cancellation_sensitive` | `boolean` | no | `true` / `false` | Whether the contract can be cancelled for a refund. **Behavioural, not descriptive**: no `Cancellation` event is generated against a product where this is `false`, and `DQ-FPA-011` asserts it. | Non-personal |
| 11 | `chargeback_sensitive` | `boolean` | no | `true` / `false` | Whether the store's income is charged back when the contract ends early. Behavioural in the same way. | Non-personal |
| 12 | `active_start_date` | `date` | no | — | First date the product was **offered**. An attribute of the product, **not** an SCD Type 2 effective date. | Non-personal |
| 13 | `active_end_date` | `date` | no | `>= active_start_date` | Last date offered, or the `9999-12-31` open-ended sentinel. | Non-personal |
| 14 | `is_active` | `boolean` | no | derived | `active_end_date = DATE '9999-12-31'`, enforced by `ck_dim_finance_product_is_active_derivation`. Never assigned independently: a flag that can contradict its own dates lets a withdrawn product back into a current menu. | Non-personal |
| 15 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | The lineage marker that stops an invented catalogue being read as a real dealership's F&I menu. | Non-personal |

### 42.2 What is deliberately absent

**No price, no cost, no rate, no commission, no remittance schedule, no reserve formula.** A price here
would be a **second authority** beside the price actually struck on the contract, and the day the two
disagreed nobody could say which one was the sale.

The generator's latent parameters — `gross_weight`, `dealer_cost_ratio`, `attach_affinity` — live in Python
beside the code that reads them and **are never columns**. The fifteen columns above are the whole of what
leaves the generator.

**No personal data of any kind.** A product row describes a product. `DQ-FPD-012` fails the run on a
prohibited column **even when it is empty**.

### 42.3 Every product and every administrator is fictional

No real F&I product, program, administrator, underwriter or vendor is named, and **none may be added**. The
catalogue attaches invented economics and invented cancellation behaviour to every row, and attaching those
to a real company's name would be a fabricated claim about that company.

`tests/unit/test_fi_privacy.py` asserts that no committed provider name collides with a real administrator a
reader would recognise. That is a **synthetic-catalogue contract test**, deliberately *not* a claim to detect
every real administrator in the world — no such check is possible, and pretending otherwise would be the
dishonest version.

### 42.4 Business rules

- `product_category` is one of the ten governed values (`ck_dim_finance_product_category_domain`), and
  **all ten are represented** by at least one product (`DQ-FPD-005`).
- `eligibility_rule_id` is the product's **own category's** governed rule — not any valid rule
  (`DQ-FPD-006`).
- `default_contract_term_months` is inside `[12, 120]`
  (`ck_dim_finance_product_contract_term_range`).
- `active_end_date >= active_start_date`, and `is_active` agrees with the sentinel.
- Two products may not share a name: the name is what a reader identifies a contract by, and two identical
  names make a category mix unreadable.

### 42.5 Categories are rows, never columns

`product_category` takes one of **ten** governed values, and there is no `vsc_gross`, `gap_gross` or
`tire_wheel_gross` column anywhere in ARPI.

A category-per-column model makes the eleventh category a **schema migration** instead of a catalogue row,
and it cannot answer "which categories exist?" without reading the schema. The ten:

`Vehicle Service Contract` · `GAP` · `Tire & Wheel` · `Prepaid Maintenance` · `Appearance Protection` ·
`Key Replacement` · `Theft or Security Product` · `Paintless Dent Protection` · `Lease Wear Protection` ·
`Other Aftermarket Product`

**"Extended warranty" is a permitted user-facing alias for `Vehicle Service Contract` and is never a stored
value.**

### 42.6 The provider decision (DASH.6-01)

`provider_name` is a **column here rather than a foreign key** into a
`warehouse.dim_finance_product_provider` that does not exist.

In this model a provider has **no behaviour independent of the product it administers**: cancellation and
chargeback sensitivity belong to the product, the provider mix *is* the product mix, and no fact needs a
provider key that `finance_product_key` does not already resolve. A dimension would add a join, a merge
script, an STM and a `DQ-*` family in exchange for an attribute lookup.

**The consequence, recorded honestly:** a provider-level rollup joins through the product rather than
directly, and a provider that administered zero products could not be represented. Neither costs anything at
this scale.

**Promoting the provider later requires no change to any fact**, because no fact carries a provider key
today. `warehouse.dim_finance_product_provider` and **STM-021 remain Deferred**.

### 42.7 Data-quality checks

`DQ-FPD-001` … `DQ-FPD-012`, all `critical`: uniqueness, the column contract, the category domain, the closed
provider set, ten-category coverage, eligibility-rule agreement with the configuration, the active window,
the contract-term range, the sensitivity flags, the **absence of Type 2 history columns**, `source_system`,
and the personal-data schema tripwire. Five of them re-run **post-load** against the warehouse table, so a
defect introduced by the merge itself cannot pass.

---

## 43. `warehouse.dim_lender` — implemented contract (`DASH.6`)

The fictional institutions behind financed and leased transactions.

| Field | Value |
|---|---|
| **Entity name** | `lender` (source entity) → `warehouse.dim_lender` |
| **Layer** | Warehouse dimension (reference catalogue) |
| **Declared grain** | **One row per lender.** |
| **Grain key** | `lender_key` (PK); `uq_dim_lender_lender_id`; `uq_dim_lender_lender_name` |
| **Natural / source key** | `lender_id` (`LND-###`) |
| **Foreign keys** | None. |
| **History policy** | **SCD Type 1.** A corrected institution name or restated category applies retroactively. See §43.4 for the recorded trade this implies for a tier change. |
| **Generator** | `src/arpi/generation/lender.py` |
| **Source-to-target mapping** | [STM-018](docs/source-to-target/STM-018-dim-lender.md) |
| **Downstream** | `fact_vehicle_sale.lender_key`, `fact_finance_product_sale.lender_key`, `reporting.vw_deal_product_detail` |
| **KPI ownership** | **None, deliberately.** Lender mix is a dimension of the detail view and is not promoted to a governed measure — see §43.5. |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | **10 on every profile.** Declared, not sampled. |
| **Lane** | **Dashboard program.** |

### 43.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `lender_key` | `integer` | no | > 0 | Surrogate primary key, `max(existing) + row_number() OVER (ORDER BY lender_id)`. | Non-personal |
| 2 | `lender_id` | `varchar(16)` | no | `LND-###`, unique | Natural key. | Non-personal |
| 3 | `lender_name` | `varchar(80)` | no | unique, from the declared fictional set | **Invented institution label.** Names a synthetic institution that does not exist — never a person and never a real financial institution. | Non-personal |
| 4 | `lender_category` | `varchar(40)` | no | `Captive`, `Bank`, `Credit Union`, `Independent Finance Company` | The institution type. All four are represented (`DQ-LND-008`). | Non-personal |
| 5 | `program_tier` | `varchar(20)` | no | `Prime`, `Near-prime`, `Subprime` | **Classifies the LENDER'S PROGRAM, never a customer.** Not a credit grade, assigned to no person. Closed deliberately — see §43.3. | Non-personal |
| 6 | `active_start_date` | `date` | no | — | First date the program was available. Not an SCD Type 2 effective date. | Non-personal |
| 7 | `active_end_date` | `date` | no | `>= active_start_date` | Last date available, or the `9999-12-31` sentinel. | Non-personal |
| 8 | `is_active` | `boolean` | no | derived | `active_end_date = DATE '9999-12-31'`, enforced by `ck_dim_lender_is_active_derivation`. | Non-personal |
| 9 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Non-personal |

### 43.2 ARPI is not a lending model

**No APR, buy rate, sell rate, rate spread, money factor, payment, loan term, loan-to-value, approval,
decline, stipulation, adverse-action reason, credit score, credit file, credit application, income or
debt-to-income figure exists in this dimension, in the facts that reference it, or anywhere in ARPI.**

ARPI approves nothing, declines nothing, tiers nobody, recommends no lender, optimizes no rate and prices
nothing. `DQ-LND-007` inspects the **schema** and fails the run even when such a column is empty, because the
defect is claiming to model a mechanic the platform does not have — not that a value is wrong. The same
promise is asserted against the committed DDL of every F&I SQL object by `tests/unit/test_fi_privacy.py`.

**No lender decision record exists and none will.** There is no application, no approval, no counter-offer,
no stipulation and no funding event. A store cannot ask "which lender approves more of my paper?" of this
model. That is the intended limit, not an omission to fill.

### 43.3 Why the tier vocabulary is closed

An open vocabulary would eventually admit a value that *reads* like a credit grade — `A+`, `Tier 3` — and a
reader would take it for one. `ck_dim_lender_program_tier_domain` makes that impossible rather than
discouraged.

### 43.4 How a deal acquires a lender, and what may never influence it

`assign_lender(rng, dealership_id=…, finance_structure=…)` is the **only** lender assignment in the
platform. Its **entire input set** is the selling store, the derived finance structure and seeded
randomness. **No customer attribute participates and none may**: a lender chosen from anything about a
person would be a credit decision wearing an analytics costume.

The one non-uniformity is a **captive franchise affinity** — a captive is weighted `3.2` at its own
franchise and `0.05` elsewhere. That is a property of the **store**, not of any customer, which is the whole
point: it gives lender mix a genuine store-to-store difference without any consumer attribute entering the
draw.

`NULL` on a fact means **no lender exists** — a Cash deal borrowed nothing, and a Wholesale or Dealer Trade
disposal has no consumer — and never "lender unknown".

**The Type 1 trade, recorded.** If an institution's program moved from `Near-prime` to `Prime`, the change
would apply retroactively across the whole history and a lender-mix-by-tier series would restate. That is
correct for a *correction* and wrong for a genuine *repositioning*. ARPI's catalogue is static, so the case
does not arise; promoting `dim_lender` to Type 2 later would require an ADR.

### 43.5 Why there is no lender KPI

Lender mix is available as a dimension of `reporting.vw_deal_product_detail` and is deliberately **not**
promoted to a governed measure. A "lender penetration" KPI would be one short step from a lender
recommendation, and ARPI recommends no lender.

### 43.6 Data-quality checks

`DQ-LND-001` … `DQ-LND-010`, all `critical`. `DQ-LND-002` closes the fictional-name set; `DQ-LND-007` is the
lending-mechanic schema tripwire; `DQ-LND-008` proves every governed category is represented. Six re-run
post-load.

---

## 44. `warehouse.fact_finance_product_sale` — implemented contract (`DASH.6`)

**What the back-end gross is actually made of.**

| Field | Value |
|---|---|
| **Entity name** | `finance_product_sale` (source entity) → `warehouse.fact_finance_product_sale` |
| **Layer** | Warehouse fact (transaction fact) |
| **Declared grain** | **One row per finance product contract sold on a finalized vehicle transaction** — one contract per product definition per deal. |
| **Grain key** | `(sale_key, finance_product_key)` — `uq_fact_finance_product_sale_grain` |
| **Natural / source key** | `product_sale_id` (`FPS-########`) |
| **Foreign keys** | `sale_key` → `fact_vehicle_sale`; `sale_date_key` → `dim_date`; `dealership_key` → `dim_dealership`; `finance_manager_key` → `dim_employee` (nullable); `finance_product_key` → `dim_finance_product`; `lender_key` → `dim_lender` (nullable) |
| **History policy** | **Never rewritten.** A cancellation or chargeback is an **event** in §45, not a restatement here. |
| **Generator** | `src/arpi/generation/finance_product_sale.py`, over the decomposition engine `src/arpi/generation/finance_deal.py` |
| **Source-to-target mapping** | [STM-019](docs/source-to-target/STM-019-fact-finance-product-sale.md) |
| **Downstream** | `fact_finance_product_adjustment`, `reporting.vw_deal_product_detail`, `reporting.vw_fi_summary`, `reporting.vw_fi_product_penetration` |
| **KPI ownership** | `KPI-FNI-001` … `KPI-FNI-011`, `KPI-FNI-019` … `KPI-FNI-022` ([KPI_CATALOG.md §40](KPI_CATALOG.md)) |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | 1,012 (development, over 650 sales). Scales with retail volume and the attachment model, not with a fixed multiple. |
| **Lane** | **Dashboard program. Not a sixth MVP fact.** |

### 44.1 The identity this fact exists to make true

For **every retail deal**, exactly:

```
back_end_gross  =  finance_reserve_gross
                 + SUM(original_product_gross) over this fact
                 + other_fi_income               (exactly 0.00; not a column anywhere)
```

**`RECON-FI-001` proves it per deal, to the cent, with tolerance `0`.** `DQ-FPS-014` proves the same identity
in Python over every generated deal before a row is written.

`fact_vehicle_sale.back_end_gross` was **not redefined**. `KPI-GRS-002` means exactly what it meant before.
What changed is that it is now **explained** rather than merely stated.

**The decomposition-preserving strategy, and its measured consequence.** Two strategies were available:
rebase `back_end_gross` from freshly drawn components, or keep the existing draw and explain it. The second
was chosen, because DASH.6 was asked for an explanation of an aggregate that already exists and a rebase
would have moved several hundred committed artifact values for no analytical gain. A diff of the committed
`data/sample/sale_event.csv` before and after reports **two added columns, no removed columns and zero
changed values**.

**The cost, stated plainly:** reserve and product amounts are *shares of a total drawn first*, so they are
decompositions rather than independent draws. What that does **not** cost is correctness — every component
obeys its own generation rule, every category has its own economics, and **no component is a plug**.
`other_fi_income` is exactly `0.00` and is not a column anywhere; the allocation reaches the cent by
**largest remainder** across real product lines, so no line is a disguised residual bucket.

**No circularity.** `finance_deal.py` does not import `sale.py`. The dependency runs one way and the engine
draws from a dedicated seeding namespace, which makes the guarantee structural rather than promised.

### 44.2 Why `sale_type` was not changed and no `dim_sale_type` was created

The F&I lane needs a three-value **finance structure** (`Cash`, `Retail Finance`, `Lease`).
`fact_vehicle_sale.sale_type` has six values on a different axis (new/used/certified/lease/wholesale/dealer
trade), and conflating the two would either widen `sale_type` — restating a column five MVP KPIs depend on —
or bury the retail/wholesale distinction.

The structure is therefore **derived, by one authority on each side**:
`arpi.generation.fi_eligibility.finance_structure_for` in Python and `warehouse.fn_finance_structure`
(`IMMUTABLE`) in SQL. `tests/integration/test_fi_reporting_views.py` proves them equal **over the whole
input cross product**.

| `sale_type` | `amount_financed` | Structure |
|---|---|---|
| `New Retail`, `Used Retail`, `Certified Retail` | `> 0.00` | `Retail Finance` |
| `New Retail`, `Used Retail`, `Certified Retail` | `0.00` | `Cash` |
| `Lease` | any | `Lease` — a lease is a lease however it was funded |
| `Wholesale`, `Dealer Trade` | any | *(non-retail: no consumer, so no product and no consumer lender may attach)* |

An unknown `sale_type` **raises** rather than defaulting to `Cash`: a silent default would put products on a
disposal and move it into three eligibility denominators. `warehouse.dim_sale_type` remains **Deferred**.

### 44.3 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `product_sale_key` | `bigint` | no | > 0 | Surrogate primary key. | Non-personal |
| 2 | `product_sale_id` | `varchar(16)` | no | `FPS-########`, unique | Natural key; the load's conflict target and what every adjustment resolves through. | Non-personal |
| 3 | `sale_key` | `bigint` | no | resolves to `fact_vehicle_sale` | The parent deal, **resolved against the FACT** rather than re-derived. Part of the grain. | Non-personal |
| 4 | `sale_date_key` | `integer` | no | resolves to `dim_date` | **The DEAL DATE.** Never rewritten by a later event. | Non-personal |
| 5 | `dealership_key` | `integer` | no | resolves to `dim_dealership` | The selling store as at the sale date (SCD2). Always the parent deal's. | Non-personal |
| 6 | `finance_manager_key` | `integer` | **yes** | resolves to `dim_employee` | The credited manager. **NULL means nobody was on the F&I desk** — a modelled state, not a missing value. | Non-personal |
| 7 | `finance_product_key` | `integer` | no | resolves to `dim_finance_product` | Part of the grain. | Non-personal |
| 8 | `lender_key` | `integer` | **yes** | resolves to `dim_lender` | The parent deal's own lender. **NULL means NO LENDER EXISTS.** `ck_fact_finance_product_sale_cash_has_no_lender` refuses a lender on a Cash contract. | Non-personal |
| 9 | `finance_structure` | `varchar(20)` | no | `Cash`, `Retail Finance`, `Lease` | Derived per §44.2. **The three retail structures only** — a disposal has no consumer, so no product can be written on one. | Non-personal |
| 10 | `eligibility_rule_id` | `varchar(16)` | no | the six `ELIG-*` rules | The governed rule the category owns. Stored so a penetration figure can name its own denominator without a second join. | Non-personal |
| 11 | `line_ordinal` | `smallint` | no | `>= 1` | 1-based position of the contract in the deal's basket, ordered by category. | Non-personal |
| 12 | `product_sale_count` | `smallint` | no | **always `1`** | The grain is one contract, so the additive contract measure is 1. Any other value means the grain was violated upstream. | Non-personal |
| 13 | `product_retail_price` | `numeric(12,2)` | no | `>= 0` | Exact `numeric`, generated as `Decimal`, never a float. | Non-personal |
| 14 | `product_dealer_cost` | `numeric(12,2)` | no | `>= 0` | The catalogue's declared cost ratio with a `(0.90, 1.10)` jitter. | Non-personal |
| 15 | `original_product_gross` | `numeric(12,2)` | no | **may be negative** | `= product_retail_price − product_dealer_cost`, exact to the cent (`ck_fact_finance_product_sale_gross_identity`). **The DEAL-DATE figure, never rewritten.** Deliberately unconstrained in sign: a product sold below cost is a real event, and suppressing it would be the fabrication. | Non-personal |
| 16 | `contract_term_months` | `smallint` | no | `12`–`120` | **The COVERAGE's term. Not a loan term — ARPI models none.** | Non-personal |
| 17 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Non-personal |

`product_category` is **not** a column: it is the product's, and storing it twice invites the two to
disagree. It is carried on the source CSV only, so a rejection payload is readable.

### 44.4 Why two contracts in one category on one deal are permitted

The grain forbids the **same product definition** twice on one deal — a customer does not buy the identical
contract twice, so a repeat is a duplicate rather than a second sale. Two **different** products inside one
category *are* permitted and are generated: a windscreen plan and a roadside plan are both
`Other Aftermarket Product`.

That is exactly why **every penetration measure counts DISTINCT DEALS rather than contract rows**. Forbidding
it would make "count the deal once" an identity on this dataset and the rule untestable.

### 44.5 What drives attachment, and what may never

Attachment probability varies with the store's operating model, the finance manager's synthetic skill index
(clamped to `[0.70, 1.30]`), the derived finance structure, the product category, the vehicle's condition
through eligibility, and seeded randomness.

It varies with **nothing about a customer**: no demographic, no protected characteristic, no credit datum, no
income, no age, no geography and no inferred willingness to buy. **There is no such attribute anywhere in the
inputs**, which is the strongest form the guarantee can take.

**Eligibility is not sales propensity.** It answers whether a product *could* have been written, never
whether a customer *should* buy it. Nothing here is a recommendation.

### 44.6 Business rules

- `product_sale_count = 1` on every row.
- `original_product_gross = product_retail_price − product_dealer_cost`, exact.
- Every contract satisfies its category's governed eligibility rule (`DQ-FPS-011`, `RECON-FI-ELIGIBILITY`) —
  re-asked of the **same evaluator** the generator used.
- Store, sale date, finance structure, credited manager and lender all match the parent deal
  (`DQ-FPS-004`, `-006`, `-007`).
- A `Cash` contract carries no lender.

### 44.7 Data-quality checks and reconciliations

`DQ-FPS-001` … `DQ-FPS-016`, all `critical`. `DQ-FPS-014` is the back-gross decomposition over every deal;
`DQ-FPS-016` is the personal-data schema tripwire.

Reconciliations: `RECON-FI-001` (the headline, per deal, tolerance `0`), `RECON-FI-DEAL-LEVEL`,
`RECON-FI-TOTAL-GROSS`, `RECON-FI-PRODUCT-IDENTITY`, `RECON-FI-PRODUCT-GRAIN`, `RECON-FI-STORE-TOTALS`,
`RECON-FI-PERIOD-TOTALS`, `RECON-FI-RESERVE-STRUCTURE`, `RECON-FI-ELIGIBILITY`,
`RECON-FACT-FINANCE-PRODUCT-SALE-WAREHOUSE` and the four `RECON-REPORT-FI-*-ROWS` rules. Each is exercised by
a **seeded corruption** in `tests/integration/test_reconciliations.py`, so the suite proves the rules detect
what they claim to detect rather than merely returning `Passed`.

### 44.8 Privacy

**No customer reference of any kind, and no free-text field.** An F&I contract is the richest source of
personal data in a real dealership; ARPI's carries none.

Employee attribution exists only as `finance_manager_key`. **No manager leaderboard, ranking, label or
best/worst designation exists anywhere in the model**, and the minimum-sample floor
(`warehouse.fn_minimum_sample_floor()`, project default **10** eligible deals, sourced from
`arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS`) governs every manager-grain read.

---

## 45. `warehouse.fact_finance_product_adjustment` — implemented contract (`DASH.6`)

**What happened to the contract afterwards.**

| Field | Value |
|---|---|
| **Entity name** | `finance_product_adjustment` (source entity) → `warehouse.fact_finance_product_adjustment` |
| **Layer** | Warehouse fact (event fact) |
| **Declared grain** | **One row per product adjustment event.** |
| **Grain key** | `adjustment_id` — `uq_fact_finance_product_adjustment_adjustment_id`; plus `uq_fact_finance_product_adjustment_sequence (product_sale_key, sequence_ordinal)` |
| **Natural / source key** | `adjustment_id` (`FPA-########`) |
| **Foreign keys** | `product_sale_key` → `fact_finance_product_sale`; `sale_key` → `fact_vehicle_sale`; `adjustment_date_key` → `dim_date`; `dealership_key` → `dim_dealership`; `finance_manager_key` → `dim_employee` (nullable); `finance_product_key` → `dim_finance_product` |
| **History policy** | **Insert-only event log in effect.** Nothing is ever deleted; an adjustment that was itself reversed is expressed by a **further event**. |
| **Generator** | `src/arpi/generation/finance_product_adjustment.py` |
| **Source-to-target mapping** | [STM-020](docs/source-to-target/STM-020-fact-finance-product-adjustment.md) |
| **Downstream** | `reporting.vw_fi_adjustment_summary`, `reporting.vw_deal_product_detail`, `reporting.vw_fi_summary` |
| **KPI ownership** | `KPI-FNI-004`, `KPI-FNI-012` … `KPI-FNI-018`, `KPI-FNI-022` ([KPI_CATALOG.md §40](KPI_CATALOG.md)) |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | 57 (development, over 1,012 contracts). See §45.6 for why this is structurally small and why that is a property rather than a defect. |
| **Lane** | **Dashboard program. Not a seventh MVP fact.** |

### 45.1 The original contract is never rewritten

**This is the whole design.** An adjustment is an **event with its own business date**; the
`fact_finance_product_sale` row it refers to keeps the gross it was written with, forever. A June contract
charged back in August stays a June contract with June's gross, and **August carries the chargeback**.

Restating the June row would be easier and would be wrong twice over. It would move production out of the
month it happened in, so every historical month would change whenever a later event posted. And it would
destroy the distinction between what the F&I office **produced** and what the store **retained** — the
distinction the whole domain exists to make.

### 45.2 Three date bases, never blended silently

| Basis | Meaning | KPIs |
|---|---|---|
| **Deal date** | What the F&I office produced, attributed to the day the deal was struck. Never rewritten. | `KPI-FNI-001`, `-002`, `-003`, `-005`, `-006`, `-007`…`-011`, `-019`, `-020` |
| **As-of** | What the store retained as at a stated as-of date. | `KPI-FNI-004`, `-022` |
| **Adjustment period** | Events grouped by **their own** business date. | `KPI-FNI-012`, `-013`, `-016`, `-017` |
| **Mixed, and disclosed** | An adjustment-period numerator over a sale-date denominator. A **period proxy**, never a cohort loss rate. | `KPI-FNI-014`, `-015`, `-018` |

Every reporting view publishes its date basis **as data**, not merely in a comment, and
`tests/integration/test_fi_reporting_views.py` asserts it — so a consumer renders the disclosure from the row
rather than from a sentence somebody remembered.

The governed as-of date is `max(sale date, snapshot date, lead-created date)` across the warehouse — **never
the wall clock** — so a rerun on a different day produces the same figure.

### 45.3 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `adjustment_key` | `bigint` | no | > 0 | Surrogate primary key. | Non-personal |
| 2 | `adjustment_id` | `varchar(16)` | no | `FPA-########`, unique | Natural key and the declared grain's identity; the load's conflict target. | Non-personal |
| 3 | `product_sale_key` | `bigint` | no | resolves to `fact_finance_product_sale` | The contract this event acts on. The join is **inner and unforgiving**: an orphaned adjustment is a number with nothing to reduce. | Non-personal |
| 4 | `sale_key` | `bigint` | no | resolves to `fact_vehicle_sale` | Taken **from the resolved contract**, so the event's deal cannot disagree with its contract's deal. | Non-personal |
| 5 | `adjustment_date_key` | `integer` | no | resolves to `dim_date` | **The EVENT'S OWN business date.** Never before the contract's sale date. | Non-personal |
| 6 | `dealership_key` | `integer` | no | resolves to `dim_dealership` | The store as at the event date (SCD2); the adjusted contract's own. | Non-personal |
| 7 | `finance_manager_key` | `integer` | **yes** | resolves to `dim_employee` | The contract's own credited manager. NULL means nobody was credited. | Non-personal |
| 8 | `finance_product_key` | `integer` | no | resolves to `dim_finance_product` | The contract's own product — the sensitivity flags that licensed this event live on it. | Non-personal |
| 9 | `adjustment_type` | `varchar(24)` | no | `Cancellation`, `Chargeback`, `Reinstatement`, `Approved Adjustment` | The governed event vocabulary. | Non-personal |
| 10 | `adjustment_amount` | `numeric(12,2)` | no | signed per type | **A positive amount REDUCES retained gross; a negative one RESTORES it.** See §45.4. | Non-personal |
| 11 | `adjustment_reason_category` | `varchar(40)` | no | governed, **and belonging to its own type** | Describes what happened to a **contract**, never to a person. `Repossession` is a governed reason — for a `Chargeback`; against a `Reinstatement` it would be a governed word in a nonsensical place, and `ck_fact_fi_adjustment_reason_belongs_to_type` refuses it. | Non-personal |
| 12 | `sequence_ordinal` | `smallint` | no | `>= 1` | 1-based position within the contract's ordered event sequence. Part of what makes "a reinstatement follows a reduction" checkable. | Non-personal |
| 13 | `source_system` | `varchar(40)` | no | `arpi_synthetic_generator` | Lineage marker. | Non-personal |

### 45.4 The sign convention and the cap

```
net_product_gross_as_of = original_product_gross
                        − SUM(adjustment_amount WHERE adjustment_date <= as_of_date)
```

| Type | Sign | Constraint |
|---|---|---|
| `Cancellation` | positive | `> 0` |
| `Chargeback` | positive | `> 0` |
| `Reinstatement` | negative | `< 0` |
| `Approved Adjustment` | either | `<> 0` — a zero-amount adjustment is not an adjustment |

**The cap: cumulative net reduction stays inside `[0, original_product_gross]` after *every* event in a
contract's sequence, not merely at the end.** An ordinary adjustment cannot take back more than was
produced, and a reinstatement cannot restore more than was taken — retained gross may never exceed the
original, and an "administrative correction" is not a governed exception to that.

Capped behaviour is the default **and the only behaviour this generator produces**. Enforced in the
generator, asserted by `DQ-FPA-007`, proved by `RECON-FI-ADJUSTMENT-CAP`, and exercised by a seeded
corruption.

Because of the cap, the as-of net figure **never goes negative and never exceeds the original**.

### 45.5 Why the conflict target is `adjustment_id`

`fact_sales_target` upserts on its grain because a plan is a **current statement** and a revision replaces
it. An adjustment is an **event** and history is the point, so the conflict target is the event's own
identity. It is deliberately **not** `(product_sale_key, adjustment_date)`: two genuine events on one
contract on one day would then collapse into one, which is a silent loss of an event rather than a
deduplication.

### 45.6 Window truncation is a property, not a defect

Event lags are drawn `(low, high, mode)` in days from the contract's sale date — cancellation `(8, 300, 40)`,
chargeback `(12, 280, 55)`, reinstatement `(5, 90, 20)`, approved adjustment `(3, 150, 25)`. The modes sit
early because a failure that is going to happen usually happens in the first months; the long right tails are
kept because a contract cancelled a year in is a real event.

**An event dated past the reporting window has no `dim_date` row to resolve and is not emitted.** The most
recent months of sales therefore carry structurally **fewer** adjustments than the earliest ones — exactly as
a real store's most recent cohort does, because those contracts have not had time to fail.

**Any comparison of adjustment volume between an early month and a late one is reading that truncation.**
`LIMITATIONS.md` records it, and `KPI-FNI-014`, `-015` and `-018` are labelled **period proxies, never cohort
loss rates**, for exactly this reason.

### 45.7 Privacy

**No customer reference of any kind, and no free-text field** — no `note`, `comment`, `reason_text` or
`description`. A free-text reason is where somebody eventually writes something about a customer.

A cancellation in a real dealership is accompanied by a refund cheque, a customer conversation and often a
repossession or total-loss narrative. **ARPI models none of them.** Data minimization applies: a field is not
created merely because it could exist in a real DMS.

A chargeback rate **is not a performance judgement** and no surface may present it as one. `DQ-FPA-013`
inspects the schema and fails the run even when a prohibited column is empty.

### 45.8 Data-quality checks and reconciliations

`DQ-FPA-001` … `DQ-FPA-013`, all `critical`, including the cumulative cap (`-007`), reinstatement integrity
(`-008`), reason-belongs-to-type (`-009`), context agreement with the contract (`-010`) and sensitivity-flag
compliance (`-011`).

Reconciliations: `RECON-FI-ADJUSTMENT-CAP`, `RECON-FI-ADJUSTMENT-SEQUENCE`, `RECON-FI-ADJUSTMENT-GRAIN`,
`RECON-FI-NET-GROSS`, `RECON-FACT-FINANCE-PRODUCT-ADJUSTMENT-WAREHOUSE` and
`RECON-REPORT-FI-ADJUSTMENT-ROWS`.

**`RECON-FI-001` is deliberately unaffected by this fact.** The deal-date identity reconciles the produced
side; `RECON-FI-NET-GROSS` reconciles the as-of side **separately, on its own basis**. Blending them would
turn an ordinary cancellation into a permanent failing check — precisely the mistake the three-date-basis
discipline exists to prevent.

---

## 46. `warehouse.dim_gl_account` — implemented contract (`DASH.8`)

The selected synthetic control-account catalogue. **Three rows, and the smallness is the design.**

| Field | Value |
|---|---|
| **Entity name** | `dim_gl_account` (source entity) → `warehouse.dim_gl_account` |
| **Layer** | Warehouse dimension (reference catalogue) |
| **Declared grain** | **One row per selected synthetic GL control account definition.** |
| **Grain key** | `gl_account_key` (PK); `uq_dim_gl_account_gl_account_id`; `uq_dim_gl_account_account_number` |
| **Natural / source key** | `gl_account_id` (`GLA-####`) |
| **Foreign keys** | None. |
| **History policy** | **SCD Type 1.** A corrected number, name or category describes what was always true, and no fact points at a historical version of an account definition. |
| **Generator** | `src/arpi/generation/gl_control.py` |
| **Source-to-target mapping** | [STM-023](docs/source-to-target/STM-023-dim-gl-account.md) |
| **Downstream** | `fact_inventory_accounting_snapshot.gl_account_key`, `fact_gl_control_balance.gl_account_key`, `reporting.vw_inventory_accounting`, `reporting.vw_inventory_gl_reconciliation` |
| **KPI ownership** | **None.** The catalogue supplies the grain that `KPI-ACC-002` and `KPI-ACC-003` are stated at; it owns no measure. |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | **3 on every profile.** Declared, not sampled. |
| **Lane** | **Accounting control (`DASH.8`).** Not one of the eight conformed dimensions. |

### 46.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `gl_account_key` | `integer` | no | > 0 | Surrogate primary key, `max(existing) + row_number() OVER (ORDER BY gl_account_id)`. | Non-personal |
| 2 | `gl_account_id` | `varchar(16)` | no | `GLA-####`, unique | Natural key. | Non-personal |
| 3 | `account_number` | `varchar(20)` | no | unique | **Invented** number in a conventional dealership inventory block. Never a real dealer group's. | Non-personal |
| 4 | `account_name` | `varchar(60)` | no | — | **Invented** account name. `DQ-GLA-009` scans it for general-ledger vocabulary. | Non-personal |
| 5 | `account_category` | `varchar(40)` | no | `New Vehicle Inventory`, `Used Vehicle Inventory`, `Certified Vehicle Inventory` | **The scope boundary, closed by `ck_dim_gl_account_category_domain`.** | Non-personal |
| 6 | `account_type` | `varchar(20)` | no | `Asset`, `Liability` | Every `DASH.8` account is an `Asset`. `Liability` is permitted so a later increment can add a floorplan control account without a domain migration. | Non-personal |
| 7 | `normal_balance` | `varchar(10)` | no | `Debit`, `Credit` | The account's natural side. What makes the sign of a balance unambiguous. | Non-personal |
| 8 | `inventory_control_flag` | `boolean` | no | derived | CHECK-coupled to `account_category` by `ck_dim_gl_account_control_flag_agrees`, so it cannot contradict the thing it summarises. | Non-personal |
| 9 | `active_start_date` | `date` | no | — | First date the account is active. A business date, never a wall clock. | Non-personal |
| 10 | `active_end_date` | `date` | **yes** | `>= active_start_date` | **NULL means still open, never "unknown".** | Non-personal |
| 11 | `source_system` | `varchar(40)` | no | `SYNTHETIC-DMS-GL` | Lineage marker. | Non-personal |

### 46.2 This is a control catalogue, not a chart of accounts

There is no Cash, Sales Revenue, Cost of Sales, Payroll, Parts, Service, Rent, Accounts Payable, Accounts
Receivable, Equity, Retained Earnings or Tax account, and none may be added. **ARPI is building a focused
inventory control schedule and its reconciliation; it is not building a general ledger.**

The boundary is physical rather than advisory: the category CHECK refuses an account outside the three
governed inventory categories, and `DQ-GLA-009` additionally scans account **names** for general-ledger
vocabulary, so a row that mislabelled itself past the CHECK still fails a run.

There is also no parent account, hierarchy level, roll-up node, statement classification, department or
cost-centre segment, budget amount, opening balance or closing balance. `DQ-GLA-002` holds the column
contract to exactly the declared list, so none of them can be added even empty.

### 46.3 Two recorded absences

**Floorplan Liability is deliberately absent.** `KPI-ACC-001` is an inventory **asset** subledger measure,
and putting a liability into the same reconciliation invites netting the two into a "net inventory" figure
that means nothing. No registered stakeholder question requires liability reconciliation. If a later
increment adds one it must reconcile against `SUM(floorplan_principal)`, never against `current_book_value`,
and must never enter `KPI-ACC-001`. See [STM-023 §5](docs/source-to-target/STM-023-dim-gl-account.md).

**There is no `Wholesale Inventory` category.** Nothing observable at a month-end distinguishes a unit held
for wholesale from one held for retail; only the eventual disposal would, and reading it would be
future-outcome leakage. See [STM-023 §6](docs/source-to-target/STM-023-dim-gl-account.md).

### 46.4 Certified is its own account, and that is not the sales rule

The sales domain groups Certified with Used. The accounting domain does not, because a certified unit
carries a capitalized certification cost the others do not. Two domains, two correct groupings; conflating
them would put a cost in the wrong control account.

### 46.5 Data-quality checks

`DQ-GLA-001` … `DQ-GLA-010`, all `critical`. `DQ-GLA-004` closes the category domain, `DQ-GLA-007` proves the
control flag cannot contradict its category, and `DQ-GLA-009` is the chart-of-accounts tripwire.

---

## 47. `warehouse.fact_inventory_accounting_snapshot` — implemented contract (`DASH.8`)

The controller's stock schedule: what each carried unit is worth on the books at one month-end.

| Field | Value |
|---|---|
| **Entity name** | `inventory_accounting_snapshot` (source entity) → `warehouse.fact_inventory_accounting_snapshot` |
| **Layer** | Warehouse fact (periodic snapshot) |
| **Declared grain** | **One row per vehicle, per dealership, per accounting date**, while the unit is carried. |
| **Grain key** | `inventory_accounting_key` (PK); `uq_fact_inventory_accounting_snapshot_grain` over `(accounting_date_key, dealership_key, vehicle_key)` — three NOT NULL columns, so PostgreSQL's NULL-distinctness rule cannot let a duplicate logical row through |
| **Natural / source key** | `inventory_accounting_id` (`IAS-########`), **staging only** |
| **Foreign keys** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_gl_account` |
| **History policy** | **Snapshot; never rewritten.** A write-down applies from its effective accounting date forward and earlier snapshots keep the value they were stated at. |
| **Generator** | `src/arpi/generation/inventory_accounting.py` |
| **Source-to-target mapping** | [STM-022](docs/source-to-target/STM-022-fact-inventory-accounting-snapshot.md) |
| **Downstream** | `reporting.vw_inventory_accounting`, `reporting.vw_inventory_gl_reconciliation`, `reporting.vw_accounting_exceptions` |
| **KPI ownership** | `KPI-ACC-001`, `KPI-ACC-003`, `KPI-ACC-004`, `KPI-ACC-010`, `KPI-ACC-011` |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | **1,501 over 6 month-ends** in the development profile. Measured on a fresh warehouse, not estimated. |
| **Lane** | **Accounting control (`DASH.8`).** Not one of the five MVP facts. |

### 47.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `inventory_accounting_key` | `bigint` | no | > 0 | Surrogate primary key, deterministic by the declared grain order. | Non-personal |
| 2 | `accounting_date_key` | `integer` | no | FK `dim_date` | The schedule date. **Always a month-end.** Part of the grain. | Non-personal |
| 3 | `dealership_key` | `integer` | no | FK `dim_dealership` | Store as it stood on the accounting date (SCD Type 2 resolution). Part of the grain. | Non-personal |
| 4 | `vehicle_key` | `integer` | no | FK `dim_vehicle` | The unit. Part of the grain. | Non-personal |
| 5 | `gl_account_key` | `integer` | no | FK `dim_gl_account` | The control account this line totals into, resolved from the category. | Non-personal |
| 6 | `control_account_category` | `varchar(40)` | no | the three governed categories | Derived from the unit's condition at acquisition, never from what it eventually sold as. | Non-personal |
| 7 | `acquisition_cost` | `numeric(14,2)` | no | `>= 0` | What the store paid. **Book component.** Additive at one date. | Non-personal |
| 8 | `capitalized_transportation` | `numeric(14,2)` | no | `>= 0` | Transport capitalized into carrying value. **Book component.** | Non-personal |
| 9 | `capitalized_reconditioning` | `numeric(14,2)` | no | `>= 0` | Reconditioning capitalized. **Book component.** | Non-personal |
| 10 | `capitalized_accessories` | `numeric(14,2)` | no | `>= 0` | Dealer-installed accessories. **Book component.** | Non-personal |
| 11 | `other_capitalized_costs` | `numeric(14,2)` | no | `0.00` or the certification cost | **Book component. Never a plug** — `DQ-IAS-019` constrains it to the values the governed rules produce. | Non-personal |
| 12 | `write_down_amount` | `numeric(14,2)` | no | `>= 0` | Age-driven carrying-value reduction. **Subtracted** in the identity. A negative value would be a write-**up**, which this model does not represent. | Non-personal |
| 13 | `current_book_value` | `numeric(14,2)` | no | `>= 0`, identity-enforced | **THE carrying amount.** `ck_fact_inventory_accounting_book_value_identity` re-derives it in the database. Semi-additive. | Non-personal |
| 14 | `floorplan_principal` | `numeric(14,2)` | no | `>= 0` | **A LIABILITY, carried as context.** Never in the identity, never netted. `0.00` means genuinely unfloored. | Non-personal |
| 15 | `days_in_stock` | `integer` | no | `>= 0` | `accounting_date − acquisition_date`. **Is** `KPI-ACC-011`'s posting lag. **Never additive** — an age, not a quantity. | Non-personal |
| 16 | `source_system` | `varchar(40)` | no | `SYNTHETIC-DMS-ACC` | Lineage marker. | Non-personal |

### 47.2 The book-value identity

```
current_book_value = acquisition_cost + capitalized_transportation + capitalized_reconditioning
                   + capitalized_accessories + other_capitalized_costs - write_down_amount
```

Exact equality, no tolerance. It is a **CHECK** rather than a staging rule because a violation must be
**unloadable** rather than merely quarantined, and `RECON-ACC-BOOK-IDENTITY` re-proves it over the loaded
rows so a constraint dropped from a deployed database fails a run.

**Pack is not in it.** Pack is a front-gross deduction at the point of sale and is not a capitalized cost.
There is no pack column here, and `RECON-ACC-PACK-EXCLUDED` re-proves the front-gross identity on every run
so an accounting increment cannot quietly change `KPI-GRS-001`.

**Floorplan principal is not in it either.** `DQ-IAS-014` asks the question the identity cannot: does any
component *carry* the advance? A floorplan balance capitalized into a component closes the identity just as
neatly as a correct one.

### 47.3 Semi-additivity

Additive across vehicles, stores and control categories **at one accounting date**; **never** additive across
dates. A period-ending balance is the **last** applicable date, not a sum.

### 47.4 There is no acquisition date key

`dim_date` spans the governed 184-day window, and roughly 28% of units entered stock during the warm-up
period before it opens — inventory has to exist on the first reporting day for the first month-end schedule
to mean anything. A NOT NULL key with a foreign key into the calendar would reject about a quarter of the
schedule. None of that is necessary, because `days_in_stock` **is** the interval. The acquisition date is
carried and validated in raw and staging, where `DQ-IAS-016` proves the derivation.

### 47.5 No future-outcome leakage

The category comes from the unit's condition, the write-down from days in stock at the accounting date, and
the floorplan principal from the unit's own funding. None consults the sale.

### 47.6 Data-quality checks

`DQ-IAS-001` … `DQ-IAS-019`, all `critical`, including the identity (`-011`), the floorplan exclusion
(`-014`), exact decimal precision (`-015`), the days-in-stock derivation (`-016`), the prohibited-column
schema scan (`-018`) and the not-a-plug rule (`-019`).

---

## 48. `warehouse.fact_gl_control_balance` — implemented contract (`DASH.8`)

The GL side of the inventory reconciliation.

| Field | Value |
|---|---|
| **Entity name** | `gl_control_balance` (source entity) → `warehouse.fact_gl_control_balance` |
| **Layer** | Warehouse fact (periodic snapshot, semi-additive) |
| **Declared grain** | **One row per dealership, per GL control account, per balance date.** |
| **Grain key** | `gl_control_balance_key` (PK); `uq_fact_gl_control_balance_grain` over `(balance_date_key, dealership_key, gl_account_key)` |
| **Natural / source key** | `gl_control_balance_id` (`GLB-########`), **staging only** |
| **Foreign keys** | `dim_date`, `dim_dealership`, `dim_gl_account` |
| **History policy** | **Snapshot; never rewritten.** |
| **Generator** | `src/arpi/generation/gl_control.py` |
| **Source-to-target mapping** | [STM-024](docs/source-to-target/STM-024-fact-gl-control-balance.md) |
| **Downstream** | `reporting.vw_inventory_gl_reconciliation`, `reporting.vw_accounting_exceptions` |
| **KPI ownership** | `KPI-ACC-002`, `KPI-ACC-003` |
| **Implementation status** | **Implemented** end to end. |
| **Row counts** | **42** in the development profile — 43 comparison rows result, because one balance has no schedule behind it. Measured, not estimated. |
| **Lane** | **Accounting control (`DASH.8`).** |

### 48.1 Column contract (exact names, exact order)

| # | Column | Type | Null | Allowed values / domain | Description | **PII class** |
|---:|---|---|---|---|---|---|
| 1 | `gl_control_balance_key` | `bigint` | no | > 0 | Surrogate primary key, deterministic by the declared grain order. | Non-personal |
| 2 | `balance_date_key` | `integer` | no | FK `dim_date` | The month-end the balance is stated as at. Part of the grain. **Comparable only with a schedule at the same date.** | Non-personal |
| 3 | `dealership_key` | `integer` | no | FK `dim_dealership` | Store as it stood on the balance date. Part of the grain. | Non-personal |
| 4 | `gl_account_key` | `integer` | no | FK `dim_gl_account` | The control account. Part of the grain. | Non-personal |
| 5 | `net_balance` | `numeric(16,2)` | no | — | The control-account balance. **May legitimately differ from the subledger**; that difference is `KPI-ACC-003`. Semi-additive. | Non-personal |
| 6 | `source_system` | `varchar(40)` | no | `SYNTHETIC-DMS-GL` | Lineage marker. | Non-personal |

### 48.2 One signed balance, and no agreement constraint

No `debit_balance`, no `credit_balance`, no journal reference, no posting batch. The governed question is
answered by one signed balance, and manufacturing journal-level detail would be inventing a general ledger a
column at a time.

There is deliberately **no constraint requiring agreement with the subledger**. A variance is structurally
valid data and the exception surface exists to show it.

### 48.3 What an exact reconciliation proves, and what it does not

**These balances are generated from the same subledger they are reconciled against**, plus a governed table
of deliberate variances, so the reconciliation surface can be seen working in both its states. An exact
reconciliation proves the reconciliation **arithmetic**. It does **not** prove that two independent
accounting systems agree, because there is only one source. Recorded in
[LIMITATIONS.md](LIMITATIONS.md) and repeated on every surface that publishes a variance.

### 48.4 The five planted scenarios

`ACC-SCN-001` … `ACC-SCN-005` produce all four comparison states: a positive variance, a negative variance,
an exact reconciliation on every other position, a withheld GL balance (`Missing GL balance`) and a balance
with no schedule behind it (`Missing subledger balance`). Each is expressed as a **month-end offset** rather
than a literal date, so every profile exercises every state — the `test` profile the integration suite runs
on is two months long and would otherwise reach none of them.

**These are synthetic demonstration conditions. They are not discovered business findings and no document
may describe them as such.**

### 48.5 Data-quality checks and reconciliations

`DQ-GLB-001` … `DQ-GLB-008`, all `critical`, including the account resolution (`-004`) and the month-end rule
(`-006`) that makes matched-date comparability structural.

Reconciliations: `RECON-FACT-GL-CONTROL-BALANCE-WAREHOUSE`, `RECON-GLB-GRAIN`, `RECON-REPORT-GL-RECON-ROWS`
and `RECON-ACC-GL-SUBLEDGER` — the last **deliberately not an equality**, and the second rule in the whole
register registered non-critical.
