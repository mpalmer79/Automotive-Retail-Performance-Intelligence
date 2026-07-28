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

> **Status reality check.** Twenty-one objects are Implemented. **No fact table exists yet.** Every entity
> whose name begins with `fact_` is Planned or Deferred. Consequently no KPI is computed anywhere in this
> repository today — see [KPI_CATALOG.md](KPI_CATALOG.md).

> **Scope of this index.** It lists every database object ARPI creates, including the six `audit.vw_dq_*`
> helper views in `sql/08_validation/`. Those views are internal query helpers over the audit schema, not
> part of the reporting boundary — `arpi_reporter` reads validation outcomes through
> `reporting.vw_data_quality_summary`. They are listed anyway, because an index that claims to be complete
> and is not is worse than one that admits its boundary (documentation backlog `DOC-22`).

| Entity | Layer | Grain | Status |
|---|---|---|---|
| `warehouse.dim_date` | Warehouse | One row per calendar date | **Implemented** |
| `warehouse.dim_dealership` | Warehouse | One row per dealership store version (SCD2) | **Implemented** |
| `warehouse.dim_employee` | Warehouse | One row per employee role-assignment version (SCD2) | Planned (Phase 1.1) |
| `warehouse.dim_customer` | Warehouse | One row per synthetic customer | Planned (Phase 1.2) |
| `warehouse.dim_vehicle` | Warehouse | One row per unique physical vehicle | Planned (Phase 1.1) |
| `warehouse.dim_vehicle_model` | Warehouse | One row per model-year / make / model / trim combination | Planned (Phase 1.1) |
| `warehouse.dim_lead_source` | Warehouse | One row per normalized lead source | Planned (Phase 1.4) |
| `warehouse.dim_marketing_campaign` | Warehouse | One row per campaign | Planned (Phase 1.5) |
| `warehouse.fact_vehicle_sale` | Warehouse | One row per finalized vehicle transaction | Planned (Phase 1.2) |
| `warehouse.fact_vehicle_inventory_snapshot` | Warehouse | One row per vehicle per dealership per daily snapshot date while active in inventory | Planned (Phase 1.2) |
| `warehouse.fact_lead` | Warehouse | One row per unique CRM lead | Planned (Phase 1.4) |
| `warehouse.fact_appointment` | Warehouse | One row per scheduled appointment | Planned (Phase 1.4) |
| `warehouse.fact_marketing_spend` | Warehouse | One row per dealership, campaign, and calendar month | Planned (Phase 1.5) |
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
| `warehouse.dim_finance_product` | Warehouse | One row per finance product definition | Deferred |
| `warehouse.dim_lender` | Warehouse | One row per synthetic lender | Deferred |
| `warehouse.dim_sale_type` | Warehouse | One row per sale classification | Deferred |
| `warehouse.dim_inventory_source` | Warehouse | One row per acquisition source | Deferred |
| `warehouse.dim_geography` | Warehouse | One row per approved geographic market grouping | Deferred |
| `warehouse.fact_lead_activity` | Warehouse | One row per CRM activity event | Deferred |
| `warehouse.fact_inventory_price_history` | Warehouse | One row per vehicle price-change event | Deferred |
| `warehouse.fact_finance_product_sale` | Warehouse | One row per finance product sold on a finalized transaction | Deferred |
| `warehouse.fact_service_visit` | Warehouse | One row per closed repair-order visit | Deferred |
| `warehouse.fact_sales_target` | Warehouse | One row per dealership, employee or department, KPI, and calendar month | Deferred |

**Counts:** 21 Implemented · 11 Planned · 10 Deferred.

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
| **Purpose** | Conformed store dimension for the fictional **Granite State Auto Group**. Every fact in the model is sliceable by store, and this dimension carries the store attributes (type, franchise brand, market) that drive nearly all comparative analysis. |
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
| 3 | `GSA-003` | Granite Used Auto Center of Merrimack | Granite Used Auto | Independent Used | *(null)* | Merrimack | NH | Southern New Hampshire | 2017-03-13 |

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
| **Declared grain** | **One row per employee role-assignment version (SCD Type 2).** A single person who moves store or changes role produces multiple rows. |
| **Primary key** | `employee_key` |
| **Natural / source key** | `employee_id` (`EMP-#####`) |
| **Foreign keys** | `dealership_key` → `warehouse.dim_dealership` |
| **Implementation status** | **Planned (Phase 1.1)** |

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

### 8.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.2)** |

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

### 9.3 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.1)** |

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

### 10.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.1)** |

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

### 11.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.4)** |

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

### 12.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.5)** |

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

### 13.2 Business rules (planned)

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

# Part C — Planned facts

> **No fact table exists in this repository today.** Everything in Part C is Planned. Grains below are
> binding and are taken directly from [ARCHITECTURE.md §12](ARCHITECTURE.md).

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
| **Foreign keys** | `sale_date_key`, `delivery_date_key` → `dim_date`; `dealership_key`; `vehicle_key`; `customer_key` (nullable for wholesale); `salesperson_key`, `desk_manager_key`, `finance_manager_key` → `dim_employee`; `lead_source_key`; `sale_type_key` → `dim_sale_type` *(Deferred — denormalized to a `sale_type` text column in the MVP)*; `lender_key` → `dim_lender` *(Deferred)* |
| **Implementation status** | **Planned (Phase 1.2)** |

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
| `back_end_gross` | numeric(12,2) | no | May be negative | Net finance reserve plus net F&I product gross. In the MVP this is generated directly; once `fact_finance_product_sale` exists it must reconcile to the product detail. | Generated. | Non-personal |
| `total_gross` | numeric(12,2) | no | May be negative | `front_end_gross + back_end_gross`. Stored, not recomputed at query time, and reconciled by `RECON-GROSS-001`. | Derived. | Non-personal |
| `discount_from_msrp` | numeric(12,2) | yes | — | `msrp − sale_price`. NULL where `msrp` is NULL. | Derived. | Non-personal |
| `discount_from_original_asking` | numeric(12,2) | no | — | `original_asking_price − sale_price`. | Derived. | Non-personal |
| `days_in_inventory_at_sale` | integer | no | ≥ 0 | Calendar days between acquisition and sale. The days-to-sale measure source. | Derived. | Non-personal |
| `finance_amount` | numeric(12,2) | yes | ≥ 0 | Amount financed. NULL for cash deals. **No APR, term, or payment is modelled** — see [PRIVACY_AND_ETHICS.md](PRIVACY_AND_ETHICS.md). | Generated. | Non-personal |
| `cash_down_payment` | numeric(12,2) | yes | ≥ 0 | Cash down. NULL where not applicable. | Generated. | Non-personal |
| `trade_allowance` | numeric(12,2) | yes | ≥ 0 | Allowance credited for a trade. NULL where there is no trade. | Generated. | Non-personal |
| `trade_actual_cash_value` | numeric(12,2) | yes | ≥ 0 | Appraised value of the trade. NULL where there is no trade. | Generated. | Non-personal |
| `sale_type` | text | no | `New Retail`, `Used Retail`, `Certified Retail`, `Lease`, `Wholesale`, `Dealer Trade` | Transaction classification. Denormalized text in the MVP; becomes an FK when `dim_sale_type` is built. | Generated. | Non-personal |
| `is_retail` | boolean | no | `true` / `false` | True for retail and lease deliveries; false for wholesale and dealer trades. **This is the single flag that defines every "retail unit" denominator in [KPI_CATALOG.md](KPI_CATALOG.md).** | Derived from `sale_type`. | Non-personal |

### 14.2 Business rules (planned)

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
| **Primary key** | Composite `(snapshot_date_key, dealership_key, vehicle_key)` |
| **Natural / source key** | Composite of snapshot date and `vehicle_id` |
| **Foreign keys** | `snapshot_date_key` → `dim_date`; `dealership_key`; `vehicle_key`; `vehicle_model_key`; `inventory_source_key` → `dim_inventory_source` *(Deferred — denormalized in the MVP)* |
| **Implementation status** | **Planned (Phase 1.2)** |

### 15.1 Measures

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `inventory_unit_count` | integer | no | `1` | Additive unit counter for the snapshot date. | Constant 1. | Non-personal |
| `current_asking_price` | numeric(12,2) | no | ≥ 0 | Advertised price on the snapshot date. | Generated. | Non-personal |
| `original_asking_price` | numeric(12,2) | no | ≥ 0 | First advertised price. | Generated. | Non-personal |
| `msrp` | numeric(12,2) | yes | ≥ 0 | MSRP. NULL for used units without one. | Generated. | Non-personal |
| `acquisition_cost` | numeric(12,2) | no | ≥ 0 | Cost to acquire. | Generated. | Non-personal |
| `reconditioning_cost` | numeric(12,2) | no | ≥ 0 | Reconditioning spend to date. | Generated. | Non-personal |
| `inventory_investment` | numeric(12,2) | no | ≥ 0 | `acquisition_cost + reconditioning_cost`. Capital tied up in the unit on the snapshot date. | Derived. | Non-personal |
| `days_in_stock` | integer | no | ≥ 0 | Calendar days between acquisition date and snapshot date. **Non-negative by rule** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). | Derived. | Non-personal |
| `market_price_estimate` | numeric(12,2) | yes | ≥ 0 | Synthetic market price reference. **Not a real market valuation** and must never be presented as one. | Generated. | Non-personal |
| `price_to_market_ratio` | numeric(8,4) | yes | > 0 | `current_asking_price / market_price_estimate`. NULL where the estimate is NULL. | Derived. | Non-personal |
| `markdown_count_to_date` | integer | no | ≥ 0 | Number of price reductions so far. | Derived. | Non-personal |
| `lead_count_to_date` | integer | no | ≥ 0 | Leads received on this unit so far. | Derived. | Non-personal |
| `appointment_count_to_date` | integer | no | ≥ 0 | Appointments booked on this unit so far. | Derived. | Non-personal |

### 15.2 Business rules (planned)

- **Exactly one record per vehicle, store, and date** — grain uniqueness is a critical failure if violated
  ([ARCHITECTURE.md §17.4](ARCHITECTURE.md), §21.2).
- Snapshot generation stops after sale, wholesale disposal, or transfer.
- Historical snapshots are immutable.
- `days_in_stock` is non-negative and increases by exactly 1 per day for a continuously held unit.
- Older inventory is more likely to receive markdowns, and generally shows lower expected front-end gross —
  required relationships ([ARCHITECTURE.md §15.3](ARCHITECTURE.md)).

### 15.3 PII classification

`Non-personal` throughout.

### 15.4 History policy

**Periodic snapshot, insert-only and immutable.** This is the largest planned table: at portfolio scale
[ARCHITECTURE.md §8.5](ARCHITECTURE.md) anticipates 500,000 to 1,500,000 rows.

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
| **Implementation status** | **Planned (Phase 1.4)** |

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

### 16.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.4)** |

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

### 17.2 Business rules (planned)

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
| **Implementation status** | **Planned (Phase 1.5)** |

### 18.1 Measures

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `spend_amount` | numeric(12,2) | no | ≥ 0 | Marketing spend for the month. **Non-negative by rule** ([ARCHITECTURE.md §21.2](ARCHITECTURE.md)). | Generated. | Non-personal |
| `impressions` | bigint | yes | ≥ 0 | Impressions delivered. NULL where the channel does not report impressions. | Generated. | Non-personal |
| `clicks` | bigint | yes | ≥ 0 | Clicks. NULL where not applicable. | Generated. | Non-personal |
| `calls` | integer | yes | ≥ 0 | Inbound calls attributed by the vendor. NULL where not applicable. | Generated. | Non-personal |
| `form_submissions` | integer | yes | ≥ 0 | Form submissions attributed by the vendor. NULL where not applicable. | Generated. | Non-personal |
| `vendor_reported_leads` | integer | yes | ≥ 0 | Leads the vendor claims. **Deliberately allowed to differ from the CRM lead count** — that discrepancy is itself an analytical finding, and reconciling the two is a documented objective, not a defect. | Generated. | Non-personal |

### 18.2 Business rules (planned)

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
| **Declared grain** | **One row per pipeline execution.** |
| **Primary key** | `pipeline_run_id` (`bigserial`) |
| **Natural / source key** | `run_uuid` (unique) |
| **Foreign keys** | None (parent) |
| **Implementation status** | **Implemented** |

### 19.1 Columns

| Column | Type | Null | Allowed values / domain | Description | Synthetic generation source | PII class |
|---|---|---|---|---|---|---|
| `pipeline_run_id` | `bigserial` PK | no | ≥ 1 | Database-assigned run identifier. | Database sequence. | Non-personal |
| `run_uuid` | `uuid` UNIQUE | no | UUID | Application-assigned run identifier. Lets the Python side reference a run before the database row is visible, and makes runs correlatable across logs. | Generated at run start. | Non-personal |
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
- `run_uuid` is unique.
- A run with `critical_failure_count > 0` must not end with `status = 'succeeded'`.

### 19.3 PII classification / history policy

`Non-personal` throughout. **Upsert on `run_uuid`**: the run is tracked in memory for the whole execution
and written once, at the end of the database load, already carrying its terminal `status` and
`completed_at`. Because `run_uuid` is derived deterministically from the run parameters, a rerun with the
same parameters updates that row in place rather than creating a second one. Distinct runs are never
purged, so prior run history is preserved ([ARCHITECTURE.md §17.3](ARCHITECTURE.md)).

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
  satisfied. This is a registered gap — see [LIMITATIONS.md §10.1](LIMITATIONS.md) and
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
| `DQ-VMD-*` | `dim_vehicle_model` | Planned (Phase 1.1) |
| `DQ-VEH-*` | `dim_vehicle` | Planned (Phase 1.1) |
| `DQ-EMP-*` | `dim_employee` | Planned (Phase 1.1) |
| `DQ-CUS-*` | `dim_customer` | Planned (Phase 1.2) |
| `DQ-ACQ-*` | `acquisition_event` (inventory acquisition source entity) | Planned (Phase 1.2) |
| `DQ-SLE-*` | `fact_vehicle_sale` | Planned (Phase 1.2) |
| `DQ-INV-*` | `fact_vehicle_inventory_snapshot` | Planned (Phase 1.2) |
| `DQ-LDS-*` | `dim_lead_source` | Planned (Phase 1.4) |
| `DQ-LED-*` | `fact_lead` | Planned (Phase 1.4) |
| `DQ-APT-*` | `fact_appointment` | Planned (Phase 1.4) |
| `DQ-CMP-*` | `dim_marketing_campaign` | Planned (Phase 1.5) |
| `DQ-MKT-*` | `fact_marketing_spend` | Planned (Phase 1.5) |
| `DQ-ING-*` | Ingestion and the row-count chain | Planned (Phase 1.2) |

Reserving a prefix is **not** a claim that any check in that family exists. Only the five
Implemented families have registered checks today; the rest are reserved names.

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

`Non-personal`. **Replace-on-rerun**: the loader issues
`DELETE FROM audit.reconciliation_result WHERE pipeline_run_id = %s` before re-inserting, so a rerun of the
same logical run describes its latest execution rather than accumulating duplicates. The `run_uuid` is
derived deterministically from the run parameters, so a rerun *is* the same logical run; other runs' rows
are never touched. See [STM-003 §8.1](docs/source-to-target/STM-003-audit-metadata.md).

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

> Everything below is **Deferred**: present in the target architecture, absent from the current roadmap.
> Each is unlocked only by the release stage named. Grains are stated now so that a future implementation
> starts from a decision rather than a debate. Adding any of these facts requires an ADR
> ([ARCHITECTURE.md §35](ARCHITECTURE.md)).

### 27.1 `warehouse.dim_finance_product`

**Grain: one row per finance product definition.** Describes the F&I products the group can sell — service
contract, GAP, maintenance plan, tire and wheel, appearance protection — with product category, eligible
deal types, a cancellation-sensitivity flag, and an active flag. **Unlocked by the strong portfolio release
(F&I product analysis, [ARCHITECTURE.md §31](ARCHITECTURE.md)).** Status: **Deferred**.

### 27.2 `warehouse.dim_lender`

**Grain: one row per synthetic lender.** Fictional lending institutions with a lender type and a broad
prime / near-prime / subprime category. Every lender is invented; **no real lender name, rate sheet, or
decision record may ever appear**. **Unlocked by the strong portfolio release (F&I product analysis).**
Status: **Deferred**.

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

### 27.8 `warehouse.fact_finance_product_sale`

**Grain: one row per finance product sold on a finalized vehicle transaction.** Product sale count, price,
cost, gross, canceled amount, chargeback amount, and net product gross, with eligible / canceled /
charged-back flags. Net product gross equals product gross minus cancellation and chargeback amounts.
Once this fact exists, `fact_vehicle_sale.back_end_gross` must reconcile to it — reconciliation
`RECON-FI-001` in [KPI_CATALOG.md](KPI_CATALOG.md). **Unlocked by the strong portfolio release.**
Status: **Deferred**.

### 27.9 `warehouse.fact_service_visit`

**Grain: one row per closed repair-order visit.** Customer-pay, warranty, and internal labour and parts;
repair estimate; declined-work amount; vehicle mileage; visit count; and flags for high repair estimate,
declined work, replacement opportunity, and sales conversion. Service-to-sales opportunity logic must be
presented as **decision support, not as a prediction of purchase intent** (`docs/research.md` §4.13).
**Unlocked by service-to-sales opportunities in the strong release.** Status: **Deferred**.

### 27.10 `warehouse.fact_sales_target`

**Grain: one row per dealership, employee or department, KPI, and calendar month.** Target value and
stretch target value. Exists so that goals are data, not hardcoded DAX constants
([ARCHITECTURE.md §12.10](ARCHITECTURE.md)). **Unlocked by target attainment in the strong release.**
Note that any target values will be *fictional operating goals for a fictional group*, never industry
benchmarks. Status: **Deferred**.

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

