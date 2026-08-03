# STM-015 · `inventory_listing_snapshot`

**Lane** — sanitized public reference data
([ADR-0011](../architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md))
**Status** — Implemented
**Owner** — Michael Palmer
**Privacy classification** — `Sanitized public reference data`. **Not synthetic**, and not
confidential DMS data.

> A row proves that a vehicle listing was **visible** in a de-identified public source at a
> moment in time. It does not prove the vehicle was on the ground, that the dealership
> owned it, what it cost, or what it sold for.

---

## 1. The canonical source artifact

| Property | Value |
|---|---|
| File name | `ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx` |
| Repository path | `data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx` |
| Store | GSA-001 — Granite Chevrolet of Nashua |
| Capture date | 2026-08-02 |
| Rows | 199 |
| Sheets | README, Summary, Inventory, Model Summary |

Two further artifacts are committed on the same capture date and are documented in full in
[`data/reference/README.md`](../../data/reference/README.md) section 10:

| Store | Rows | What is unusual about it |
|---|---:|---|
| GSA-002 — Granite Subaru of Manchester | 24 | **A partial capture.** The source did not expose every listing through a reliably extractable path. Twenty-four is a count of what was visible, not of the store's inventory |
| GSA-003 — Granite Pre-Owned Center of Merrimack | 318 | **287 rows publish no price and no mileage.** Their `Pricing Status` is `Price not exposed`, which is why this lane's odometer column is optional and why that status exists |

The file name **intentionally uses underscores between filename words**; hyphens appear
only inside the ISO date. It is declared with its SHA-256 in
`config/reference/inventory_listing_contract.yaml`, stamped onto every warehouse row as
`source_file_name`, and enforced by `scripts/check_reference_data.py`. **A filename change
requires an explicit migration, not an informal rename.**

Every store has its own directory and only its own:

| Store | Directory | Artifact name |
|---|---|---|
| GSA-001 | `data/reference/inventory/gsa-001/<yyyy-mm-dd>/` | `ARPI_Granite_Chevrolet_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |
| GSA-002 | `data/reference/inventory/gsa-002/<yyyy-mm-dd>/` | `ARPI_Granite_Subaru_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |
| GSA-003 | `data/reference/inventory/gsa-003/<yyyy-mm-dd>/` | `ARPI_Granite_Pre_Owned_Center_Inventory_Sanitized_<yyyy-mm-dd>.xlsx` |

All three are committed. All three were uploaded into the `gsa-001` directory and were
moved to their own before the lane was declared complete; the `artifact-misfiled` rule
found them, including the Subaru workbook while it was the only Subaru file in the
repository.

---

## 2. Private workbook → sanitized artifact

Performed by `scripts/sanitize_inventory_workbook.py`. The private input **stays outside
the repository**.

| Private column | Sanitized column | Transformation |
|---|---|---|
| `VIN` | `Synthetic Vehicle ID`, `Synthetic VIN` | `SHA256(UTF8("ARPI\|GSA\|" + upper(trim(vin))))`; `VEH-` + first 12 hex, `ARPI` + first 13 hex. **One-way. No reverse mapping is produced or producible.** |
| `Source URL` | `Source Feed` | Removed. Replaced by `sanitized_public_inventory_reference`, which names the lane and never the origin |
| *(external dealer identity)* | `Dealership ID`, `Store Name` | Removed. Resolved from `arpi.generation.dealership.STORE_DEFINITIONS`, never inferred from the file name |
| *(street address)* | — | Removed. Geography stops at store name and market region |
| `Condition` | `Condition` | Title-cased, refused unless `New` or `Used` |
| `Year` | `Model Year` | Integer, governed range 1980–2100, at most 2 years beyond the capture year |
| `Make`, `Model`, `Trim` | same | Whitespace-normalised. Blank make or model is refused |
| `Vehicle` | `Vehicle Display` | Composed from year/make/model/trim when absent |
| `Mileage` | `Odometer Miles` | Integer, non-negative, **optional**. Blank means the listing published no mileage, which is not a zero reading. A present value that will not coerce is still refused |
| `Price` | `Advertised Price` | Numeric. **Dropped under any status that forbids a price**: the two columns disagreed and the status governs |
| `Price Status` | `Pricing Status` | Matched case-insensitively to `Listed`, `Call for price` or `Price not exposed`. The last two both mean no price, and are **not** collapsed: one records a displayed merchandising choice, the other records that the source published no price field |
| `Captured` | `Captured At` | Must equal the operator-supplied snapshot date. One workbook is one snapshot |
| — | `Source Record ID`, `Source Batch ID` | Deterministic: `GSA001-20260802-0001`, `GSA001-20260802-001` |
| — | `Inventory Unit Count` | Always `1` |
| — | `Data Classification` | `Sanitized public reference data`, on every row |

**Rejection behaviour** — the whole workbook is refused if any row fails. Messages name a
row number, a column and a validation category, and **never the offending value**.

---

## 3. Sanitized artifact → `raw.inventory_listing_snapshot_load`

**Grain** — one row per Inventory-sheet data row within one load batch.
**Lineage** — `load_batch_id`, `source_file_name` (exact), `source_file_digest` (SHA-256),
`source_row_number`, `ingested_at`.

Every business column lands as `text`; typing happens in staging, so one malformed value
quarantines itself rather than failing the load. There is **no original VIN column and no
source URL column**, and the COPY column list is derived from the contract, so a change to
the sanitized shape cannot silently misalign it.

**Idempotency** — the importer checks the file digest **before landing a single row**. A
rerun of the same workbook does no work at all.

---

## 4. Raw → `staging.stg_inventory_listing_snapshot`

**Grain / natural key** — `(dealership_id, captured_at, synthetic_vehicle_id)`.
**Newest-batch rule** — greatest `max(ingested_at)`, ties broken by `max(raw_record_id)`.

| Rule | Code | Category |
|---|---|---|
| Value not representable in its governed type | `REJ-TYPE-001` | structural |
| Required value absent | `REJ-NULL-001` | completeness |
| Outside a domain, range, the classification, or the pricing contract | `REJ-DOMAIN-001` | business_rule |
| Store does not resolve, or its name disagrees with the registry **on the capture date** | `REJ-REF-001` | referential |
| Duplicate natural key; highest `raw_record_id` survives | `REJ-KEY-001` | uniqueness |

The registry checks go through `staging.fn_dealership_exists` and
`staging.fn_dealership_named` rather than referencing `warehouse.dim_dealership` directly:
a view resolves its tables at creation time, and staging is built before dimensions.

Rejected rows keep a **redacted** payload, written to `audit.rejected_record` through
`arpi.validation.privacy.redact_payload`.

---

## 5. Staging → `warehouse.dim_observed_vehicle`

**Grain** — one row per observed physical vehicle. **Business key** —
`synthetic_vehicle_id`. **History** — Type 1, and the reason is recorded: the listing fact
already preserves observation history.

The observation window **only ever widens** — `least()` on `first_observed_at`, `greatest()`
on `last_observed_at` — because narrowing one would be forgetting an observation that
actually happened. Descriptive attributes follow the **latest** capture; earlier fact rows
are left exactly as they were.

---

## 6. Staging → `warehouse.fact_vehicle_listing_snapshot`

**Grain** — one observed vehicle listing per dealership per `captured_at`, enforced by
`uq_fact_vehicle_listing_snapshot_grain`.

| Join | Cardinality | On failure |
|---|---|---|
| `warehouse.dim_date` on `full_date = captured_at` | Required | The import **extends the calendar** for the dates its own fact needs. A capture date has no reason to fall inside a synthetic dataset's reporting window, and `dim_date` is conformed |
| `warehouse.dim_dealership` on `dealership_id`, **as at the capture date** | Required | Rejected upstream by `REJ-REF-001` |
| `warehouse.dim_observed_vehicle` on `synthetic_vehicle_id` | Required | Merged immediately before this load |

**Conflict policy — `ON CONFLICT DO NOTHING`, and there is no UPDATE path at all.** Every
other ARPI fact carries a guarded `DO UPDATE`, because its source is a deterministic
generator. This source is not regenerable: a capture records what somebody observed at a
moment that has passed. A corrected workbook for a loaded batch is **refused**, and handled
through the supersession procedure in `data/reference/README.md` section 8.

---

## 7. Fact → reporting views

| View | Grain |
|---|---|
| `vw_vehicle_listing_current` | One row per store per vehicle — the most recent capture |
| `vw_vehicle_listing_summary` | Store × capture date |
| `vw_vehicle_listing_model_mix` | Store × capture × condition × make × model × trim |
| `vw_vehicle_listing_price_completeness` | Store × capture × condition × make × model |
| `vw_vehicle_listing_observation_span` | Store × observed vehicle |
| `vw_vehicle_listing_change` | Store × capture × vehicle in either capture |

**Semi-additive** — `inventory_unit_count`, `advertised_price`, `total_advertised_value`.
Additive across vehicle, store, make and model; **never across capture dates**.
**Non-additive** — `odometer_miles`, every ratio, every order statistic, `days_observed_online`.

**Every price statistic excludes the listings that carry no price, and every view says how
many it excluded.** `listed_price_units` and `unpriced_units` sum to `observed_listing_units`
by construction — `unpriced_units` is defined as the complement of `Listed`, not as the sum
of the named unpriced statuses, so a future status cannot fall outside every bucket.
`call_for_price_units` and `price_not_exposed_units` sit beside it to say *why*, and are
never merged: one records a merchandising choice that was displayed, the other records that
the source published no price field at all. `average_odometer_miles` is likewise the mean of
the readings that exist, with `no_odometer_units` beside it.

`vw_vehicle_listing_change` emits **New Listing, Still Listed, Removed From Listing, Price
Increase, Price Reduction, Price Unchanged**. There is no *Sold* label, and there must
never be one.

---

## 8. Reporting views → the Excel operating report

Produced by `scripts/export_inventory_operating_report.py` into
`artifacts/inventory/ARPI_<Store_Descriptor>_Inventory_Report_<yyyy-mm-dd>.xlsx`.

| Sheet | Source |
|---|---|
| README | Provenance and a question-and-answer table of what the report can and cannot establish |
| Summary | Formulas over the Inventory sheet, beside `vw_vehicle_listing_summary`'s own figures |
| Inventory | `vw_vehicle_listing_current` |
| Model Summary | `vw_vehicle_listing_model_mix`, rolled up from trim to model |
| Snapshot Changes | `vw_vehicle_listing_change` — **only when a prior capture exists** |

Everything comes from the **warehouse**, never from the input workbook: a report assembled
from its own source would prove nothing about the load.

---

## 9. Proposed future reporting views → semantic model

**Not implemented, deliberately.** The current Power BI semantic model is awaiting
real-engine validation, and adding tables before that validation would change the
validation target.

The proposed extension — `vw_vehicle_listing_summary` and `vw_vehicle_listing_current` as
imported tables, `vw_calendar` and `vw_dealership` as the shared conformed dimensions, and
the 24 `KPI-LST-*` definitions as measures — is recorded in
[`../requirements/PHASE_2_BACKLOG.md`](../requirements/PHASE_2_BACKLOG.md). No TMDL table,
relationship or DAX measure was added by this increment, and the model source hash is
unchanged.

---

## 10. Data quality and reconciliation

**17 registered checks** — `DQ-LST-001` … `DQ-LST-017` in
`arpi.inventory.validation.LISTING_CHECKS`. Fourteen are answerable from the workbook
alone; three need a loaded warehouse.

**10 reconciliations** — `RECON-LISTING-*` in `audit.vw_recon_inventory_listing`, evaluated
and recorded against the import's own `audit.pipeline_run` row. Deliberately **not** part
of `audit.vw_recon_all`: that view is the pipeline's per-run set with an asserted per-run
count, and this lane runs on a workbook cadence.

Every reconciliation here is **technical load evidence**. "The total advertised value
reconciles" means the number that reached the warehouse is the number the workbook carried.
It is not a valuation and not a finding about any dealership.
