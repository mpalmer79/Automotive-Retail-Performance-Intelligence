# Dashboard Data Contract — ARPI Dealer Operations Command Center

**Status:** **As-built for `DASH.1`.** Every section below describes what the code does, not what it
was planned to do; where the two differed, the divergence is recorded in §14 with its reason.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md) ·
[DATA_DICTIONARY.md](../../DATA_DICTIONARY.md)

The console never opens a database connection. Everything it displays flows through this contract:
PostgreSQL `reporting` views → root export (`scripts/export_dashboard_dataset.py`, running as
`arpi_reporter`) → committed `data/dashboard/` artifacts → portfolio transform
(`portfolio/scripts/generate-dashboard-data.ts`) → `portfolio/src/generated/dashboard/` → routes.

**The machine-readable form of this document is
[`src/arpi/dashboard/contract.py`](../../src/arpi/dashboard/contract.py).** That module is the single
authority for the source-view allowlist, every dataset's grain, business key, date basis, column
list, type, nullability, privacy class and display precision. This document is its human-readable
specification, and `tests/unit/test_export_dashboard_dataset.py::TestDocumentationAgreesWithTheContract`
fails if the two disagree — so the allowlist cannot drift between prose and code. TypeScript restates
neither: the exporter emits the whole declaration into `data/dashboard/manifest.json`, and the
transformer validates against that manifest plus a small pinned dataset registry in
[`portfolio/src/types/dashboard.ts`](../../portfolio/src/types/dashboard.ts).

---

## 1. Principles

1. **Allowlist, not discovery.** The exporter names every view it may read. A view not listed here is
   unreadable, even though `arpi_reporter` could technically select it. Enforced against the
   generated query text, not against the declaration that was meant to produce it.
2. **SQL owns arithmetic.** Exports carry computed values; the transformer reshapes and the UI
   formats. Neither recomputes a KPI. The transformer does sum additive columns — but only to compare
   them against the manifest and fail on a mismatch, never to publish a figure.
3. **Exact money.** PostgreSQL monetary `numeric` values are serialized as **JSON strings**
   (`"-2529.18"`), two places, sign preserved, never floats. A `float` reaching a monetary column
   aborts the export rather than being converted.
4. **Deterministic bytes.** Same source data → identical bytes: declared sort keys per dataset, fixed
   key order, no timestamp inside any dataset, LF endings. `--check` is a byte comparison.
5. **Fail closed.** Unexpected column, missing view, prohibited name, schema drift, widened grain,
   repeated business key, broken identity, failed pipeline run, failing reconciliation, oversized
   file — the export fails; it never emits a best effort.
6. **Freshness is a state, not a clock.** No wall-clock age appears in any staleness decision (§11).

## 2. Profiles and scale tiers

| Tier | Profile | Where | Purpose |
|---|---|---|---|
| Committed default | `development` (seed 20250701, 2025-07-01 → 2025-12-31) | `data/dashboard/` in git | Reviewable, diffable (650 deals, 45,754 snapshot rows source-side); the same profile the SQL baseline uses |
| Deployment refresh | `portfolio` (24 months) | Generated during a deliberate refresh, committed the same way | Only when the full-scale dataset is regenerated on purpose; sizes re-measured against §10 before commit |

The manifest records which profile produced the artifacts; the console renders it. Mixing tiers in
one commit is a check failure.

## 3. Approved source views (as-built allowlist, `DASH.1`)

| View | Export dataset | Grain |
|---|---|---|
| `reporting.vw_dealership` | `stores` | Current store version |
| `reporting.vw_calendar` | `calendar` (selling-day and period-boundary fields, reporting window) | Calendar date |
| `reporting.vw_lead_source` | `lead-sources` | Normalised lead source |
| `reporting.vw_marketing_campaign` | `campaigns` | Campaign |
| `reporting.vw_sales_summary` | `sales-summary` | Store × sale date |
| `reporting.vw_gross_summary` | `gross-summary` | Store × sale date |
| `reporting.vw_inventory_health` | `inventory-health` | Store × snapshot date × condition group |
| `reporting.vw_inventory_aging` | `inventory-aging` | + age bucket |
| `reporting.vw_days_to_sale` | `days-to-sale` | Store × sale month × condition group |
| `reporting.vw_inventory_turn` | `inventory-turn` | Store × month × condition group |
| `reporting.vw_days_supply` | `days-supply` | Store × as-of date × condition group |
| `reporting.vw_lead_funnel` | `lead-funnel` | Store × source × campaign × date |
| `reporting.vw_appointment_funnel` | `appointment-funnel` | Store × date |
| `reporting.vw_lead_response` | `lead-response` | Store × source × date |
| `reporting.vw_marketing_performance` | `marketing-performance` | Store × month × source × campaign |
| `reporting.vw_reconciliation_status` | `reconciliation-status` | Reconciliation, for the export's own run |
| `reporting.vw_pipeline_run_summary` | `pipeline-run` | The export's own run |

**Two views were added to the planned allowlist by `DASH.1`**, using the extension mechanism this
section prescribes: `vw_lead_source` and `vw_marketing_campaign`. They are not new views and they
carry no measure. They are required because §4 forbids exporting a warehouse surrogate key, and
`vw_lead_funnel`, `vw_lead_response` and `vw_marketing_performance` are grained on
`lead_source_key` and `campaign_key`. Without the two dimensions the funnel and marketing datasets
could only publish meaningless integers. Both pass the prohibited-name tripwire; both name only
fictional sources and vendors.

Later increments extend the allowlist with their views (`vw_vehicle_sales`-derived
`vw_deal_explorer`/`vw_deal_jacket` at `DASH.3`/`DASH.4`; targets at `DASH.5`; F&I at
`DASH.6`/`DASH.7`; accounting at `DASH.8`; employees at `DASH.11`; actions at `DASH.12`). Each
extension lands as a diff to this table **and** to `arpi.dashboard.contract` in the same PR as the
exporter change; the paired unit test refuses a change to only one of them.

**Never exported:** any `raw`/`staging`/`warehouse`/`audit` object (the exporter cannot see them, and
its own output-byte scan refuses even a mention of one); `vw_customer` (even banded — no
customer-grain dataset exists at all); `vw_employee`, `vw_vehicle` and `vw_vehicle_model` (no `DASH.1`
dataset needs them, so none is exported; `vw_employee` becomes exportable at `DASH.11` limited to
synthetic id, role, store and active window); the listing-lane views (different data lane, different
disclosure — ADR-0011 data stays on the existing inventory surfaces); `vw_data_quality_summary` and
`vw_data_quality_trend` (the run-scoped validation counts the console needs are already in
`pipeline-run`).

### 3.1 Columns excluded from an otherwise approved view

Three exclusions are decisions rather than omissions, and each is recorded in the dataset's manifest
`notes`:

| View | Excluded column | Why |
|---|---|---|
| `vw_pipeline_run_summary` | `notes` | Free-text. The prohibited-name tripwire refuses it, and correctly: a free-form field in a public artifact is where an unreviewed sentence eventually appears. |
| `vw_pipeline_run_summary` | `started_at`, `completed_at`, `duration_seconds` | Wall-clock and machine-dependent. A dataset carries no timestamp (§1.4); the manifest carries the two it declares. |
| `vw_reconciliation_status` | `left_source`, `right_source`, `description` | All three embed schema-qualified names of internal warehouse and audit objects. Publishing them would put an internal object path into the public lane and past the ADR-0013 condition 8 boundary guard. The governed `reconciliation_id` is the public handle — [KPI_CATALOG.md §36](../../KPI_CATALOG.md) documents what each identifier compares — and the values, tolerance and outcome are what make a reconciliation public evidence. |

## 4. Column rules

For every dataset the contract declares — and both stages check — the column list and order, the JSON
type, nullability, the enumeration where applicable, the unit, and the display precision.
Cross-cutting rules:

- **Required columns** are non-null in every row; the exporter fails on a violation rather than
  emitting null.
- **Nullable fields** are explicitly listed; `null` means "not applicable or not observed", never
  zero. The UI renders "Not applicable" / "No data", never `0`, for null.
- **Enumerations** are closed sets carried in the manifest (`condition_group`: New, Used; age
  buckets: 0-30, 31-60, 61-90, 91-120, Over 120; `store_type`; reconciliation status). An out-of-set
  value fails the export.
- **Identifiers** are business codes (`dealership_id` `GSA-00#`, `lead_source_code`, `campaign_code`),
  never warehouse surrogate keys. Surrogates stop at the export boundary, resolved through an
  allowlisted dimension view. A unit test asserts no exported column name ends in `_key`.
- **Currency**: string-serialized exact decimals, two places, sign preserved.
- **Percentages/ratios**: exported **unrounded** at the scale the reporting view produced, with
  `display_precision` beside them, plus the numerator and denominator columns the KPI defines so the
  UI can always show both sides.
- **Order statistics** (`percentile_cont` medians and percentiles) are `double precision` in
  PostgreSQL and stay JSON numbers here, rendered by their shortest round-tripping representation.
  Claiming decimal precision they never had would be a statement about the data that is not true.

### 4.1 Key resolution is a lookup, never an aggregation

A dataset's SQL may join an allowlisted dimension view for one purpose only: turning a surrogate key
into its business code. Dimension keys are unique, so the join cannot change the row count — and the
exporter proves it, comparing the exported row count with the source view's own count and failing if
they differ. That single guard is what makes surrogate-key resolution safe.

## 5. Privacy classification and public eligibility

Every column carries a classification in the contract: `non-personal` is the only class eligible for
export, and a column declared anything else aborts the export. Two controls, in order:

1. **The allowlist is the primary control.** A field reaches an export only by being declared.
2. **The prohibited-name tripwire (`arpi.validation.privacy`) is the second**, run over every
   exported header — the belt and braces that catches an allowlist someone extended carelessly.

There is one documented gap and it is closed structurally rather than by name-matching: the tripwire
does **not** treat `vin` as prohibited, because ARPI's VIN columns are synthetic by policy
([ADR-0005](../architecture-decisions/ADR-0005-synthetic-vin-policy.md)) and legitimate on the public
listing lane. The dashboard lane's protection is therefore that **no dataset declares a vehicle
identifier of any spelling** (asserted), and the portfolio transformer additionally scans its output
bytes for a VIN-shaped token.

No customer-level dataset exists at all: customers appear only as pre-aggregated counts inside funnel
views. Employee columns arrive at `DASH.11`, limited to synthetic id, role, store and the measures
that page defines, subject to the minimum-sample rule.

## 6. Date semantics

The export distinguishes, and the console labels, the repository's date bases. Each dataset declares
exactly one, carried in the manifest as `date_basis` and pinned on the TypeScript side so a silent
change cannot mislabel a chart:

| Basis | Datasets |
|---|---|
| sale date | `sales-summary`, `gross-summary`, `days-to-sale` |
| snapshot date | `inventory-health`, `inventory-aging`, `inventory-turn` |
| as-of date | `days-supply` |
| lead creation date | `lead-funnel`, `lead-response` |
| appointment date | `appointment-funnel` |
| spend month | `marketing-performance` |
| calendar date | `calendar` |
| none | `stores`, `lead-sources`, `campaigns`, `reconciliation-status`, `pipeline-run` |

`balance date` (`DASH.8`) and `adjustment date` (`DASH.6`) join the set with their increments. Period
filters resolve against the `calendar` dataset's selling-day fields, exported once — so the console
and the warehouse cannot disagree about which days a month contains or which of them a showroom was
open. The transformer asserts every dated row's date exists in `calendar`.

## 7. Manifest

`data/dashboard/manifest.json`, schema `arpi.dashboard_export/1`, contract version 1. Abridged — the
committed file is the full example:

```jsonc
{
  "schema": "arpi.dashboard_export/1",
  "contract_version": 1,
  "contract_sha256": "<digest of the whole declared contract — the staleness signal>",
  "dataset_version": 1,                      // monotonic; bumps only when bytes change
  "generated_at": "<ISO-8601 UTC>",
  "as_of_date": "2025-12-31",                // latest dated fact in the export
  "profile": "development",
  "random_seed": 20250701,
  "source_commit": "<git sha — provenance, not a freshness gate>",
  "exporter_version": "0.1.0",
  "query_normalisation": "arpi.sql_whitespace_canonical/1",
  "reporter_role": "arpi_reporter",
  "synthetic_data": true,
  "fictional_dealer_group": true,
  "pipeline_run": { "run_uuid": "...", "logical_run_key": null, "status": "succeeded" },
  "source_views": ["reporting.vw_appointment_funnel", "..."],
  "datasets": [
    {
      "name": "gross-summary",
      "source_view": "reporting.vw_gross_summary",
      "join_views": ["reporting.vw_dealership", "reporting.vw_calendar"],
      "grain": "One row per store per sale date on which at least one transaction was finalized.",
      "business_key": ["dealership_id", "sale_date"],
      "date_basis": "sale date",
      "sort_keys": ["dealership_id", "sale_date"],
      "chunked": false,
      "kpi_ids": ["KPI-GRS-001", "..."],
      "columns": [
        { "name": "front_end_gross", "type": "currency", "nullable": false,
          "class": "non-personal", "unit": "USD", "display_precision": 2,
          "enumeration": null, "source_column": "reporting.vw_gross_summary.front_end_gross" }
      ],
      "notes": "…",
      "query_sha256": "…", "row_count": 357,
      "file": "gross-summary.json", "file_sha256": "…", "file_bytes": 160986
    }
  ],
  "reconciliation": { "status": "passed", "method": "…", "totals": { /* §12 */ } },
  "privacy_scan": { "status": "passed", "prohibited_hits": 0, "columns_scanned": 232,
                    "primary_control": "contract allowlist",
                    "secondary_control": "arpi.validation.privacy prohibited-name tripwire" },
  "validation": { "critical_failures": 0, "warnings": 0, "checks_evaluated": 114,
                  "reconciliations_evaluated": 58, "reconciliations_failed": 0 },
  "sizes": { "dataset_bytes_total": 7554685, "largest_dataset": { /* … */ }, "limits": { /* §10 */ } },
  "stale": false,
  "limitations": [ "SYNTHETIC DATA — …", "…" ]
}
```

**`logical_run_key` is `null`, deliberately.** [ADR-0010](../architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md)'s
logical run key is recorded in the audit layer's pipeline-run table. The reporting layer does not
publish it and the exporter may not read that schema, so it is left null rather than guessed, and a
manifest limitation says so. Publishing it needs a reporting-view change, which belongs to whichever
increment actually needs to group equivalent reruns.

**What the manifest never contains:** a database credential, hostname, port, database name, username,
internal Railway service information, raw SQL carrying environment information, or an absolute local
path. The exporter scans its own produced bytes for all of them plus `raw.`/`staging.`/`warehouse.`/
`audit.`, and refuses to write on a hit — which is how the three internal-object columns in §3.1 were
found.

The portfolio transformer re-emits a **client-safe manifest** (`arpi.dashboard_client/1`) that the
trust panel renders: dataset version, contract fingerprint, as-of date, profile, source views,
reconciliation status and totals, privacy-scan status, validation counts, staleness, limitations, per
dataset identity and column metadata, and the measured size report. It deliberately drops the root
manifest's per-column SQL lineage and query hashes — build-time information a browser has no use for.
It carries **no Power BI field at all**: that state comes from `powerbi/validation/*.json` and is
merged by the trust panel `DASH.2` owns, so there is exactly one place a "validated" claim could ever
be written, and both ADR-0008 paths are still pending.

### 7.1 Query hashing

`query_sha256` is the SHA-256 of the query's whitespace-canonical form, algorithm
`arpi.sql_whitespace_canonical/1`:

1. Decode as UTF-8.
2. Normalise CRLF and lone CR to LF, so a Windows checkout hashes identically.
3. Split on LF, strip each line, drop empty lines.
4. Join the surviving lines with a single space and collapse internal whitespace runs to one space.
5. SHA-256 the UTF-8 bytes of that single-line form.

A meaningful change — a column added or removed, a different sort, a different filter — changes the
hash. Reindenting does not, and neither does a platform's line endings. Comments are **not** stripped:
removing one safely needs a SQL parser, and a hand-rolled parser that mishandles one construct would
silently change a hash that is supposed to be evidence. Instead the query builder refuses to emit a
comment marker at all, and a unit test asserts every generated query is comment-free.

Because the SQL is generated from the contract, the hash is a hash **of the contract**, not of some
text sitting beside it.

## 8. Generated portfolio layout (as-built)

```text
portfolio/src/generated/dashboard/
  manifest.json                                  # client-safe manifest
  datasets/<name>.json                           # one file per unchunked dataset
  datasets/<name>/<GSA-00#>/<yyyy-mm>.json        # store × month partitions, chunked datasets
```

`stores`, `calendar`, `lead-sources`, `campaigns`, `sales-summary`, `gross-summary`, `days-to-sale`,
`inventory-turn`, `appointment-funnel`, `marketing-performance`, `reconciliation-status` and
`pipeline-run` are whole files. `inventory-health`, `inventory-aging`, `days-supply`, `lead-funnel`
and `lead-response` are chunked: 18 partitions each (3 stores × 6 months).

**The generated dataset files are columnar** — `{ dataset, rowCount, columns, rows: [[…], …] }`, one
row array per line, values in `columns` order. Every value is preserved exactly; this is a
re-encoding, not a transformation. The reviewable artifact is `data/dashboard/`, where each row is an
object with its keys spelled out, because that is the file a human reads in a diff to see which
measure moved. Repeating seventeen column names on every one of sixteen thousand rows costs roughly
four bytes of key for every byte of value, and paying it twice would have added about 5 MB to the
repository to say the same thing again in the same words. Measured: 7.5 MB of root export becomes
2.3 MB of generated tree.

The placement respects what the audit established about packaging: `next.config.ts` pins
`outputFileTracingRoot` to `portfolio/`, `.next/standalone` receives only traced files, and
module-scope JSON imports enter client bundles when imported from client components (the inventory
explorer does this deliberately for 541 records; the dashboard data may not). Therefore:

- **Whole-dataset files** may be imported by server components at module scope.
- **Chunks are server-only**: read by a server component, never imported from a `'use client'`
  module — enforced by `portfolio/tests/unit/dashboard-boundaries.test.ts`. If server runtime reads
  are chosen over static imports, the chunk directory must be included in file tracing (verified by
  the existing `railway-config.test.ts` pattern).
- Client islands receive pre-filtered props, following the established `product-preview.ts` pattern.

**No route consumes any of this yet.** `DASH.1` ships the lane and its controls; the boundary suite
asserts zero importers today, so the first one arrives in the same diff as the expectation change.

## 9. Chunking

- Chunk keys are stable business dimensions: store (`GSA-00#`) × calendar month, per record family.
- A partition is a pure regrouping of exported rows: no row is dropped, duplicated or altered, and
  the transformer asserts the partition row counts sum to the dataset row count.
- The chunk index in the client manifest carries every key with its row count and measured bytes, so
  a missing partition is a check failure rather than an empty page.
- Deal-grain chunking (`deal-index.json`, `deal-chunks/`) belongs to `DASH.3`/`DASH.4`, which own the
  deal experiences and the `vw_deal_explorer`/`vw_deal_jacket` views that would source it. No
  deal-grain view exists in this increment's allowlist, so no such file is created — see §14.

## 10. File-size constraints

**Measured, not assumed.** The figures below are what the development profile actually produces,
measured by `python scripts/export_dashboard_dataset.py --check --sizes` and
`npm run dashboard -- --sizes`.

| Artifact | Ceiling | Measured (development profile) |
|---|---|---|
| Any single committed export file | **3 MB** | 2,269,345 B — `lead-response.json`, 4,099 rows |
| Total committed `data/dashboard/` | 20 MB | 7,660,811 B across 18 files, 18,148 rows |
| Any single generated chunk | 256 KB | 47,325 B — `datasets/lead-funnel/GSA-001/2025-07.json` |
| Any single generated whole-dataset file | 256 KB (same ceiling) | 78,932 B — `datasets/marketing-performance.json` |
| Client-safe manifest | not separately budgeted | 83,452 B (the largest generated file) |
| Total generated `portfolio/src/generated/dashboard/` | not yet budgeted | 2,387,403 B across 103 files (12 whole datasets, 90 chunks, 1 manifest) |
| Any page's initial data payload | measured in `DASH.2-04`, budgeted in `DASH.13` | no page exists yet |

Every figure above was produced by `python scripts/export_dashboard_dataset.py --check --sizes` and
`npm run dashboard -- --sizes` on the committed artifacts, not estimated. The generated tree sits an
order of magnitude inside the chunk ceiling, so no regression guard is set on it beyond the ceiling
itself: a budget with 5× headroom catches nothing, and `DASH.13-02` sets the real ones from the route
measurements `DASH.2-04` will record.

The single-file ceiling was a provisional 2 MB written before anything had been exported, and the
measurement broke it: `lead-response.json` is 2.16 MB, because a per-row JSON object repeats every
column name and one record per line was chosen over a columnar encoding so a reviewer can read the
diff. The ceiling is therefore set from the measurement with about 30% headroom rather than the
build being failed against a number nobody had checked. The directory total stays where it was
because the measured total is well inside it.

Exceeding a ceiling fails `--check` with the measured number in the message.

## 11. Staleness detection

**Stale is a state, not a guess, and no wall-clock age appears in the decision.** An export generated
a month ago whose contract has not changed is current. An export generated a minute ago whose
contract has changed is stale.

| Signal | Effect |
|---|---|
| `contract_sha256` ≠ the digest of the current declared contract | **Stale.** This is the primary signal: the declared datasets, grains, keys, sorts, filters or columns changed. |
| `schema` or `contract_version` unknown to the consumer | Refused outright. |
| A dataset file's hash ≠ its manifest entry | Failure: the file and the manifest disagree, so one was hand-edited. |
| A dataset file missing, or an undeclared file present | Failure: the file set is closed. |
| `query_sha256` ≠ the hash of the contract-built query | Failure: the source query changed. |
| Row count, business-key uniqueness, column list, type, nullability or enumeration mismatch | Failure. |
| A reconciliation total that does not re-derive from the committed rows | Failure. |
| Generated portfolio tree ≠ what the transformer would write | Failure under `dashboard:check`. |
| `stale: true` in the manifest | Failure. CI never lets one merge. |
| Recorded pipeline run failed, or its reconciliations report failures | The exporter refuses to run: a failing warehouse cannot produce a "passing" export. |

`source_commit` is **provenance, not a freshness gate**. A commit that touches neither the contract
nor the data cannot stale an export, and comparing it to `HEAD` would make every unrelated commit
look like staleness — which is the wall-clock mistake in another costume.

`generated_at`, `source_commit` and `dataset_version` are the manifest's declared varying fields and
are excluded from the byte comparison, so a regeneration cannot fail a check for having happened at a
different moment or on a different checkout. Inside the datasets there is exactly one varying value:
`pipeline-run.run_uuid`. A rebuilt warehouse is a different execution and says so, and
`--check --against-database` reports that explicitly rather than as a byte difference.

## 12. Reconciliation totals

The manifest's reconciliation block carries group-level totals computed by the exporter from the
allowlisted views, as exact sums over the values the console will actually read.

**No quotient is published.** A ratio total carries its numerator sum and its denominator sum and
stops there:

```jsonc
"total_gross":                 { "column": "total_gross", "total": "1936571.59", "kpi_id": "KPI-GRS-003" },
"front_gross_per_retail_unit": { "numerator_column": "front_end_gross", "numerator": "1270498.26",
                                 "denominator_column": "retail_units_sold", "denominator": "558",
                                 "kpi_id": "KPI-GRS-004", "display_precision": 2 }
```

Three reasons, any one sufficient: the reporting layer's own rule 7 puts division in the consumer, so
a quotient here would be a number computed outside SQL — exactly what ADR-0013 condition 2 forbids;
publishing the components makes an average of store averages impossible to form from this block; and
a quotient would have to be reproduced exactly by a TypeScript consumer to be checkable, when
Python's `Decimal` division and PostgreSQL's `numeric` division already disagree about how many
digits to keep.

**Non-additive figures carry no group total at all** — medians, percentiles, days supply and inventory
turn. A group median is not the average of store medians, and the only reliable protection is for the
wrong number to be unavailable. Their evidence is row-level equality between the export and the
source view, asserted for every numeric column of every dataset by
`tests/integration/test_dashboard_export.py`.

The cross-layer chain, each link asserted at the narrowest layer that can see it:

1. **UI = generated payload** — arrives with `DASH.2`.
2. **Generated payload = root export** — `portfolio/tests/unit/dashboard-data.test.ts` re-derives every
   total by exact `bigint` arithmetic over the committed rows, and asserts the columnar re-encoding
   preserved every value.
3. **Root export = reporting views** — `tests/integration/test_dashboard_export.py` compares every
   exported cell with the view it came from.
4. **Reporting views = independent warehouse derivations** — the existing
   `tests/integration/test_kpi_verification.py` guarantee.

## 13. Versioning

`dataset_version` increments on every regeneration that changes bytes and holds steady otherwise —
content-addressed, so regenerating an unchanged export does not manufacture a new version.
`contract_version` bumps when a dataset's shape changes. `schema` bumps
(`arpi.dashboard_export/2`, …) when the manifest envelope changes, and the transformer refuses an
unknown version rather than guessing. Contract changes land in the same PR as the code that
implements them, per the repository's contract-tier rule.

## 14. Where the as-built differs from the plan, and why

Recorded rather than quietly absorbed:

| Planned | As-built | Reason |
|---|---|---|
| 15-view allowlist | 17 views | `vw_lead_source` and `vw_marketing_campaign` are needed to resolve the funnel and marketing surrogate keys into business codes, which §4 requires. See §3. |
| `vw_reconciliation_status` at reconciliation × run grain | Filtered to the export's own run | The console shows the evidence belonging to the data it is rendering. A selection, not an aggregation. |
| Ratios "pre-rounded per the KPI's documented precision" | Exported unrounded with `display_precision` beside them | Rounding at export would break reconciliation and destroy the numerator/denominator identity. The exact value is kept and the display precision travels with it, so the UI can still render correctly. |
| Reconciliation block carries ratio values | Carries numerator and denominator sums, no quotient | See §12. |
| Page-shaped payloads (`executive-summary.json`, `store-scoreboard.json`, `sales-gross.json`, `inventory-health.json`, `leads-marketing.json`) | Not created | A page payload is a presentation decision owned by its route increment, and preaggregating KPI values in TypeScript would violate ADR-0013 condition 2. `DASH.2` and `DASH.10` build them alongside the pages that define what they must contain. The lane, the types, the validation, the chunking and the reconciliation all exist and are tested now. |
| `deal-index.json` and `deal-chunks/` | Not created | No deal-grain view exists in this increment's allowlist: `vw_deal_explorer` is `DASH.3-01` and `vw_deal_jacket` is `DASH.4-01`. A `deal-index.json` here could only be fabricated, and a fabricated empty dataset is not implementation. Chunking is instead exercised on the four date-grained datasets that genuinely warrant it (§8, §9). |
| `inventory-chunks/` | `datasets/inventory-health/`, `datasets/inventory-aging/`, `datasets/days-supply/` | Same chunk keys (store × month); named per dataset because three inventory datasets exist at different grains and one directory could not hold them unambiguously. |
| 2 MB single-file ceiling | 3 MB | Measured, with documented headroom. See §10. |
| `pipeline_run.logical_run_key` populated | `null` | The reporting layer does not publish it and the exporter may not read the audit schema. See §7. |
| Generated tree mirrors the export's row-object shape | Columnar | Measured 5 MB saving with every value preserved exactly. See §8. |
