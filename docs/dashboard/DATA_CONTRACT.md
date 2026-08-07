# Dashboard Data Contract — ARPI Dealer Operations Command Center

**Status:** Planning contract for `DASH.1`; becomes as-built with that increment.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md) ·
[DATA_DICTIONARY.md](../../DATA_DICTIONARY.md)

The console never opens a database connection. Everything it displays flows through this contract:
PostgreSQL `reporting` views → root export (`scripts/export_dashboard_dataset.py`, running as
`arpi_reporter`) → committed `data/dashboard/` artifacts → portfolio transform
(`portfolio/scripts/generate-dashboard-data.ts`) → `portfolio/src/generated/dashboard/` → routes.

---

## 1. Principles

1. **Allowlist, not discovery.** The exporter names every view it may read. A view not listed here is
   unreadable, even though `arpi_reporter` could technically select it.
2. **SQL owns arithmetic.** Exports carry computed values; the transformer reshapes and the UI
   formats. Neither recomputes a KPI.
3. **Exact money.** PostgreSQL `numeric(12,2)` values are serialized as **JSON strings**
   (`"1234.50"`), never floats. TypeScript parses them with the shared exact-decimal display helpers;
   no float enters a displayed gross identity.
4. **Deterministic bytes.** Same source data → identical bytes: stable ordering (declared sort keys
   per dataset), fixed key order, no timestamps besides the manifest's declared fields, LF endings.
   `--check` mode is a byte comparison, exactly like the existing portfolio generators.
5. **Fail closed.** Unexpected column, missing view, prohibited name, schema drift, row-count
   mismatch against the recorded pipeline run — the export fails; it never emits a best effort.

## 2. Profiles and scale tiers

| Tier | Profile | Where | Purpose |
|---|---|---|---|
| Committed default | `development` (seed 20250701, 2025-07-01 → 2025-12-31) | `data/dashboard/` in git | Reviewable, diffable, small (~650 deals, ~46k snapshot rows source-side); the same profile the SQL baseline uses |
| Deployment refresh | `portfolio` (24 months) | Generated during a deliberate refresh, committed the same way | Only when the full-scale dataset is regenerated on purpose; sizes re-measured against §10 limits before commit |

The manifest records which profile produced the artifacts; the console renders it. Mixing tiers in
one commit is a check failure.

## 3. Approved source views (initial allowlist, `DASH.1`)

| View | Export dataset | Grain |
|---|---|---|
| `reporting.vw_dealership` | `stores` | Current store version |
| `reporting.vw_calendar` | `calendar` (selling-day fields only, reporting window) | Calendar date |
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
| `reporting.vw_reconciliation_status` | `reconciliation-status` | Reconciliation × run |
| `reporting.vw_pipeline_run_summary` | `pipeline-run` | Run |

Later increments extend the allowlist with their views (`vw_vehicle_sales`-derived
`vw_deal_explorer`/`vw_deal_jacket` at `DASH.3`/`DASH.4`; targets at `DASH.5`; F&I at
`DASH.6`/`DASH.7`; accounting at `DASH.8`; employees at `DASH.11`; actions at `DASH.12`). Each
extension lands as a diff to this table in the same PR as the exporter change.

**Never exported:** any `raw`/`staging`/`warehouse`/`audit` object (the exporter cannot see them);
`vw_customer` (even banded); `vw_employee` beyond synthetic id, role, store, and active window;
the listing-lane views (different data lane, different disclosure — ADR-0011 data stays on the
existing inventory surfaces).

## 4. Column rules

For every dataset the contract (checked in code by both stages) declares: column list and order,
JSON type, nullability, and enumeration where applicable. Cross-cutting rules:

- **Required columns** are non-null in every row; the exporter fails on a violation rather than
  emitting null.
- **Nullable fields** are explicitly listed; `null` means "not applicable or not observed", never
  zero. The UI renders "Not applicable" / "No data", never `0`, for null.
- **Enumerations** are closed sets carried in the manifest (e.g. `sale_type`: New Retail, Used
  Retail, Certified Retail, Lease, Wholesale, Dealer Trade; `condition_group`: New, Used; age
  buckets; adjustment types; action severities). An out-of-set value fails the export.
- **Identifiers** are business codes (`sale_id` `SLE-########`, `dealership_id` `GSA-00#`,
  employee ids `EMP-#####`), never warehouse surrogate keys. Surrogates stop at the export boundary.
- **Currency**: string-serialized exact decimals, two places, sign preserved.
- **Percentages/ratios**: pre-rounded per the KPI's documented precision, plus numerator and
  denominator columns whenever the KPI defines them, so the UI can always show both sides.

## 5. Privacy classification and public eligibility

Every dataset column carries a classification in the contract file: `non-personal` (the only class
eligible for export) — with the prohibited-name tripwire (`arpi.validation.privacy`) run over every
header at export time as a belt-and-braces check. No customer-level dataset exists at all: customers
appear only as pre-aggregated counts inside funnel views. Employee columns are limited to synthetic
id, role, store, and the measures the employee page defines, subject to the minimum-sample rule.

## 6. Date semantics

The export distinguishes, and the console labels, the repository's date bases: **sale date**,
**delivery date**, **snapshot date**, **as-of date**, **balance date** (`DASH.8`), **adjustment
date** (`DASH.6`), plus the manifest's **generated** and **pipeline-run** timestamps. Every dataset
declares its basis; every KPI rendering inherits the label from
[`KPI_EXTENSION_PLAN.md`](KPI_EXTENSION_PLAN.md) / KPI_CATALOG.md. Period filters resolve against
`vw_calendar`'s selling-day fields, exported once.

## 7. Manifest

`data/dashboard/manifest.json`, schema `arpi.dashboard_export/1`:

```jsonc
{
  "schema": "arpi.dashboard_export/1",
  "dataset_version": "<monotonic integer>",
  "generated_at": "<ISO-8601 UTC>",
  "as_of_date": "<max fact date in the export>",
  "profile": "development",
  "random_seed": 20250701,
  "source_commit": "<git sha>",
  "exporter_version": "<arpi version>",
  "pipeline_run": { "run_uuid": "...", "logical_run_key": "...", "status": "succeeded" },
  "datasets": [
    {
      "name": "gross-summary",
      "source_view": "reporting.vw_gross_summary",
      "query_sha256": "<hash of the exact SQL text>",
      "row_count": 0,
      "file": "gross-summary.json",
      "file_sha256": "...",
      "columns": [ { "name": "...", "type": "...", "nullable": false, "class": "non-personal" } ]
    }
  ],
  "reconciliation": {
    "status": "passed",
    "totals": {
      "retail_units": "…", "front_end_gross": "…", "back_end_gross": "…", "total_gross": "…",
      "leads_received": 0, "active_inventory_latest": 0
    }
  },
  "privacy_scan": { "status": "passed", "prohibited_hits": 0 },
  "validation": { "critical_failures": 0, "warnings": 0 },
  "stale": false,
  "limitations": [ "Synthetic data for a fictional dealer group.", "…" ]
}
```

The portfolio transformer re-emits a **client-safe manifest** (no source commit paths beyond the
sha, no host detail — there is none to begin with) that the trust panel renders: dataset version,
as-of date, profile, reconciliation status, privacy-scan status, Power BI validation state (merged
from the existing evidence files), and staleness.

## 8. Generated portfolio layout (evaluated in `DASH.1`, finalized as-built)

```text
portfolio/src/generated/dashboard/
  manifest.json              # client-safe manifest
  executive-summary.json     # /dashboard payload
  store-scoreboard.json
  sales-gross.json
  inventory-health.json
  fi-summary.json            # DASH.7
  leads-marketing.json
  employee-performance.json  # DASH.11
  accounting-integrity.json  # DASH.9
  management-actions.json    # DASH.12
  deal-index.json            # compact search fields only
  deal-chunks/<store>/<yyyy-mm>.json
  inventory-chunks/<store>/<yyyy-mm>.json
```

The final placement must respect what the audit established about packaging: `next.config.ts` pins
`outputFileTracingRoot` to `portfolio/`, `.next/standalone` receives only traced files, and module-
scope JSON imports enter client bundles when imported from client components (the inventory explorer
does this deliberately for 541 records; the deal set may not). Therefore:

- **Page summary payloads** may be imported by server components at module scope.
- **Deal and inventory chunks are server-only**: read by server components (or the `DASH.4-01`
  static-generation step), never imported from a `'use client'` module — enforced by a boundary
  test. If server runtime reads are chosen over static imports, the chunk directory must be included
  in file tracing (verified by the existing `railway-config.test.ts` pattern).
- Client islands receive pre-filtered props, following the established `product-preview.ts` pattern.

## 9. Chunking

- Chunk keys are stable business dimensions: store (`GSA-00#`) × calendar month, per record family.
- `deal-index.json` carries only: `sale_id`, sale date, store, year/make/model/trim, sale type,
  condition group, synthetic staff ids, sale price, front/back/total gross, days in inventory, lead
  source, chunk pointer. It must stay a strict subset of the jacket payload.
- The Deal Jacket route loads exactly one deal's data (its chunk, or its prerendered page — the
  `DASH.4-01` measured decision).
- No route ships all deals or all inventory records in its initial bundle. The `/dashboard` payload
  contains zero deal-level records.

## 10. File-size constraints

Measured, recorded in the export manifest and the transformer's size report, and reviewed against
these initial ceilings (project defaults, revisited with `DASH.13` budgets):

| Artifact | Ceiling |
|---|---|
| Any single committed export file | 2 MB |
| Any single generated chunk | 256 KB |
| `deal-index.json` | 512 KB (development profile) |
| Total committed `data/dashboard/` | 20 MB |
| Any page's initial data payload | measured in `DASH.2-04`, budgeted in `DASH.13` |

Exceeding a ceiling fails `--check` with the measured number in the message.

## 11. Staleness detection

Stale is a **state, not a guess**: the transformer fails when the root manifest's
`source_commit` no longer matches the committed export tree hash recorded at generation, when the
manifest's `dataset_version` is behind the contract's current version, or when a dataset file hash
disagrees with the manifest. The trust panel renders `stale: true` (which CI never lets merge) as a
visible warning state in development. The exporter refuses to run against a database whose recorded
pipeline run failed or whose reconciliations report failures — a failing warehouse cannot produce a
"passing" export.

## 12. Reconciliation totals

The manifest's reconciliation block carries group-level totals computed by the exporter directly
from the allowlisted views. The transformer recomputes each page summary's totals and fails on
mismatch; the UI test suite asserts rendered executive totals equal the manifest totals. This is the
cross-layer chain: **UI = generated payload = root export = reporting views = warehouse derivation**
(the last equality is the existing `test_kpi_verification.py` guarantee).

## 13. Versioning

`dataset_version` increments on every regeneration that changes bytes; `schema` bumps
(`arpi.dashboard_export/2`, …) when a dataset's shape changes, with the transformer refusing an
unknown major. Contract changes land in the same PR as the code that implements them, per the
repository's contract-tier rule.
