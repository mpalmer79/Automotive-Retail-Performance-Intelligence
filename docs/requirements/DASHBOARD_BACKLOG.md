# Dashboard Backlog — ARPI Dealer Operations Command Center

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-08-06
**Conventions:** [README.md](README.md) · **Parent documents:**
[DASHBOARD_PROGRAM.md](DASHBOARD_PROGRAM.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md) ·
[ARCHITECTURE.md](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md)

> **No item carries an hour, day, week, or sprint estimate.** Complexity is `Small`, `Medium`, or
> `Large` only ([README.md §3.3](README.md)).

> **Identifier scheme.** Delivery increments are `DASH.0` … `DASH.13` (plus optional `DASH.O-*`
> items); backlog items are `DASH.<n>-NN`. The `DASH` family is deliberately disjoint from lifecycle
> phases and from the `P1.x` / `P2.x` increments so no identifier can be misread
> ([ADR-0003](../architecture-decisions/ADR-0003-delivery-increment-terminology.md)). Identifiers are
> **permanent**: never renumbered, never reused; a cancelled item keeps its ID and is marked
> `Out of scope`.

> **Sequencing is binding.** An increment does not begin until its dependencies are Done and its data
> contract is resolved. Every increment leaves the repository green — all CI checks passing, no
> half-promoted entity, no route shipped before the control that governs it. One increment per pull
> request; no thousand-line omnibus changes.

> **Source-to-target reservations.** `STM-016` `fact_sales_target` · `STM-017` `dim_finance_product`
> · `STM-018` `dim_lender` · `STM-019` `fact_finance_product_sale` · `STM-020`
> `fact_finance_product_adjustment` · `STM-021` `dim_finance_product_provider` (only if promoted) ·
> `STM-022` `fact_inventory_accounting_snapshot` · `STM-023` `dim_gl_account` · `STM-024`
> `fact_gl_control_balance` · `STM-025` `fact_trade_in` (optional). Reserved now; written by the
> owning increments.

---

## Increment index

| Increment | Title | Complexity | Status |
|---|---|---|---|
| `DASH.0` | Architecture and program contract | Large | **Implemented** — delivered by the change that introduces this document |
| `DASH.1` | Existing-KPI dashboard export foundation | Large | **Implemented** |
| `DASH.2` | Dashboard shell and Executive Overview | Large | **Implemented** |
| `DASH.3` | Sales, Gross, and Deal Explorer | Large | **Implemented** |
| `DASH.4` | Basic Deal Jacket | Large | **Implemented** |
| `DASH.5` | Targets and pace | Large | Planned |
| `DASH.6` | F&I model | Large | Planned |
| `DASH.7` | F&I dashboard and expanded Deal Jacket | Large | Planned |
| `DASH.8` | Inventory accounting and GL controls | Large | Planned |
| `DASH.9` | Accounting dashboard and inventory integration | Large | Planned |
| `DASH.10` | Leads and Marketing dashboard | Large | Planned |
| `DASH.11` | Employee performance | Medium | Planned |
| `DASH.12` | Management Action Center and change drivers | Large | Planned |
| `DASH.13` | Hardening and release | Large | Planned |
| `DASH.O-*` | Optional enhancements | — | Deferred |

`DASH.11` is Medium, not Large, by the audit: it adds no warehouse entity — one reporting view over
implemented facts, export slices, and one route reusing the shell, filters, and primitives that
`DASH.2`/`DASH.3` establish. Large is reserved for new-domain increments per
[README.md §3.3](README.md).

---

## `DASH.0` — Architecture and program contract

| Field | Value |
|---|---|
| **Purpose** | Resolve the architecture conflict on the record and produce a complete, executable program plan future sessions can implement one increment at a time. |
| **Dependencies** | None |
| **Estimated complexity** | Large |
| **Blocking gate** | None; ADR-0013 required by [ARCHITECTURE.md §35.2](../../ARCHITECTURE.md) ("Adding a second user interface") |
| **Architecture references** | §6, §18, §22, §26.3, §28, §35 |
| **Status** | **Implemented** — this change |

### `DASH.0-01` — Repository audit and ADR-0013

| Field | Value |
|---|---|
| Purpose | No silent violation of the standing architecture: the conflict between the §6 exclusion, ADR-0009's controls, and the authorized console is resolved by a decision record with rejected alternatives. |
| Dependencies | None |
| Complexity | Medium |
| Status | **Implemented** — this change |
| Architecture references | §6, §26.3, §28, §35.2 |
| Data-grain impact | None |
| Acceptance criteria | ADR-0013 exists with the required sections, the fifteen console conditions, the two-product boundary, nine rejected alternatives, the ADR-0009 supersession table, and the Gate 2 non-effect statement. The ADR index lists it. |
| Required tests | `python scripts/check_docs_links.py` clean; `python scripts/check_project_capabilities.py` clean (no prose claim contradicts evidence). |
| Documentation updates | `docs/architecture-decisions/README.md`; `ARCHITECTURE.md §6` qualifying note; `docs/index.md`. |
| Explicit non-goals | No implementation; no Gate 2 change; no TMDL change. |
| Completion evidence | `docs/architecture-decisions/ADR-0013-governed-web-operating-console.md` in this change. |

### `DASH.0-02` — Program document and backlog

As `DASH.0-01` (Medium, Implemented — this change). Acceptance: `DASHBOARD_PROGRAM.md` covers purpose
through non-goals per the program contract; this backlog defines every increment with the full field
set; `docs/requirements/README.md` indexes both. Evidence: both files in this change.

### `DASH.0-03` — Specification set

As `DASH.0-01` (Large, Implemented — this change). Acceptance: `docs/dashboard/` contains
`INFORMATION_ARCHITECTURE.md`, `DATA_CONTRACT.md`, `KPI_EXTENSION_PLAN.md`, `DEAL_JACKET_SPEC.md`,
`ACTION_ENGINE_SPEC.md`, `TEST_STRATEGY.md`, each specific enough that a future agent can name the
file, entity, grain, formula, validation, route, privacy boundary, Power BI consequence, blocker, and
completion proof for any piece of work. Evidence: the six files in this change.

### `DASH.0-04` — Diagrams and index updates

As `DASH.0-01` (Medium, Implemented — this change). Acceptance: seven Mermaid diagrams under
`docs/dashboard/diagrams/` following the `docs/diagrams/` conventions (Markdown + fenced Mermaid, no
binaries); `docs/index.md`, `docs/diagrams/README.md`, and `KPI_CATALOG.md §35` cross-reference the
program. Evidence: the diagram files and index diffs in this change.

---

## `DASH.1` — Existing-KPI dashboard export foundation

| Field | Value |
|---|---|
| **Purpose** | Stand up the governed two-stage export pipeline over the **29 implemented KPIs only**, so the console's data path exists and is tested before any route or any new fact. |
| **Dependencies** | `DASH.0` |
| **Estimated complexity** | Large |
| **Blocking gate** | None (no Deferred entity involved) |
| **Architecture references** | §10, §18, §22; ADR-0013 conditions 1–4, 8–10, 15 |
| **Status** | **Implemented** |

### `DASH.1-01` — Root exporter `scripts/export_dashboard_dataset.py`

| Field | Value |
|---|---|
| Purpose | One governed exit from PostgreSQL to the public data lane. |
| Dependencies | `DASH.0-03` (data contract) |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | §22.3 (roles), ADR-0013 Compliance |
| Data-grain impact | None (reads approved views at their declared grains) |
| Acceptance criteria | Connects only as `arpi_reporter`; reads only the `DATA_CONTRACT.md §3` allowlist; writes `data/dashboard/` datasets + `manifest.json` with dataset/schema versions, as-of date, seed, source commit, exporter version, pipeline-run id, per-dataset source view, query hash, row count, file hash, reconciliation totals, privacy-scan status; exact decimals serialized as strings; deterministic ordering; byte-stable on unchanged source; `--check` mode byte-compares; refuses prohibited columns via `arpi.validation.privacy`; fails on unexpected view schema; never writes a credential; committed `development`-profile export lands with the change. |
| Required tests | `tests/unit/test_export_dashboard_dataset.py` (allowlist, determinism, decimal serialization, prohibited-column refusal, manifest shape); `tests/integration/test_dashboard_export.py` (against the built database: row counts, reconciliation totals equal `reporting` totals, `arpi_reporter`-only access). |
| Documentation updates | `DATA_CONTRACT.md` marked to match as-built; `scripts/README.md`; `docs/index.md` if paths change. |
| Explicit non-goals | No new views; no portfolio consumption; no route. |
| Completion evidence | `scripts/export_dashboard_dataset.py` (CLI) over `src/arpi/dashboard/{contract,serialization,export}.py`; committed `development`-profile export in `data/dashboard/` (18 files, 7,660,811 B, 17 datasets, 18,148 rows); `tests/unit/test_export_dashboard_dataset.py` (135 tests) and `tests/integration/test_dashboard_export.py` (43 tests) green. |
| As-built notes | Connects through the repository configuration contract and `SET ROLE`s into `arpi_reporter` (a NOLOGIN group role), confirming the effective role before reading. Two existing dimension views were added to the allowlist — `vw_lead_source`, `vw_marketing_campaign` — because §4 forbids exporting a surrogate key and the funnel and marketing views are grained on `lead_source_key`/`campaign_key`; recorded in `DATA_CONTRACT.md §3` and §14. Ratios are exported **unrounded** with `display_precision` beside them rather than pre-rounded, because rounding at export would break reconciliation. The reconciliation block publishes numerator and denominator sums and **no quotient** (`DATA_CONTRACT.md §12`). The single-file size ceiling was raised from a provisional 2 MB to a measured 3 MB (`§10`). `pipeline_run.logical_run_key` is null: the reporting layer does not publish it and the exporter may not read `audit`. |

### `DASH.1-02` — Portfolio transformer `portfolio/scripts/generate-dashboard-data.ts`

| Field | Value |
|---|---|
| Purpose | Turn normalized root exports into typed, page-shaped, chunked payloads the routes can consume without recomputation. |
| Dependencies | `DASH.1-01` |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | ADR-0013 conditions 2–4, 15; existing generator conventions (`generate-inventory-data.ts`) |
| Data-grain impact | None |
| Acceptance criteria | Validates root schemas and manifest hashes; fails on staleness, duplicate natural ids, unresolved relationships; emits `portfolio/src/generated/dashboard/` per the `DATA_CONTRACT.md §8` layout with a client-safe manifest; generates TypeScript contracts; preaggregates page summaries; chunks deal/inventory detail by the contract's chunk keys; measures and records output sizes; `dashboard`/`dashboard:check` npm scripts added to `prebuild`, CI, and `Dockerfile.railway`; `railway.json` watch patterns extended to `data/dashboard/**`. |
| Required tests | `portfolio/tests/unit/dashboard-data.test.ts` (schema validation, chunk integrity, determinism, size recording, stale-input failure); CI check-mode step. |
| Documentation updates | `portfolio/docs/CONTENT_MODEL.md` (new generated lane); `DATA_CONTRACT.md` as-built notes. |
| Explicit non-goals | No route, no component. |
| Completion evidence | `portfolio/scripts/generate-dashboard-data.ts` + `portfolio/src/types/dashboard.ts`; `portfolio/src/generated/dashboard/` (103 files, 2,387,403 B); `dashboard`/`dashboard:check` in `prebuild`, `verify` and `Dockerfile.railway`; `railway.json` watch patterns extended to `data/dashboard/**`; `portfolio/tests/unit/dashboard-data.test.ts` (62 tests) green; regeneration byte-identical. |
| As-built notes | **Page-shaped payloads and the deal-grain family were not created, deliberately.** A page payload is a presentation decision owned by its route increment, and preaggregating KPI values in TypeScript would violate ADR-0013 condition 2; `DASH.2`/`DASH.10` build them with the pages that define what they contain. No deal-grain view exists in this increment's allowlist (`vw_deal_explorer` is `DASH.3-01`, `vw_deal_jacket` is `DASH.4-01`), so a `deal-index.json` here could only have been fabricated, and a fabricated empty dataset is not implementation. Chunking is instead exercised on the five date-grained datasets that warrant it — `inventory-health`, `inventory-aging`, `days-supply`, `lead-funnel`, `lead-response` — at store × month, 18 partitions each, every one inside the 256 KB ceiling. Generated dataset files are columnar (a re-encoding preserving every value exactly), which saved 5 MB against mirroring the export's row-object shape. Full rationale in `DATA_CONTRACT.md §14`. |

### `DASH.1-03` — Boundary and reconciliation guards

| Field | Value |
|---|---|
| Purpose | The ADR-0013 controls exist as failing tests before the first route ships. |
| Dependencies | `DASH.1-01`, `DASH.1-02` |
| Complexity | Medium |
| Status | **Implemented** |
| Architecture references | ADR-0013 Compliance |
| Data-grain impact | None |
| Acceptance criteria | A portfolio unit test fails if any file under `portfolio/src` references `raw.`, `staging.`, `warehouse.`, or `audit.`; a cross-layer test asserts export totals equal reporting-view totals for every exported dataset (development profile fixture); the client-safe manifest excludes connection detail by schema. |
| Required tests | `portfolio/tests/unit/dashboard-boundaries.test.ts`; `tests/integration/test_dashboard_export.py::test_export_totals_match_reporting`. |
| Documentation updates | `TEST_STRATEGY.md` as-built notes. |
| Explicit non-goals | UI assertions (arrive with `DASH.2`). |
| Completion evidence | `portfolio/tests/unit/dashboard-boundaries.test.ts` (34 tests) and `tests/integration/test_dashboard_export.py::test_export_totals_match_reporting`. The seeded defect was exercised: a one-cent mutation to one `front_end_gross` value is caught by the file hash, by reconciliation after the hash is restamped, and by comparison against the database (`TestSeededDefect`, three tests). Eighteen further corrupted-export cases are each driven through the real portfolio generator and each observed failing. |
| As-built notes | The `portfolio/src` schema-reference rule is enforced over the whole tree except three named prose files — `lib/content.ts`, `content/architecture.ts`, `app/ui-lab/page.tsx` — which exist to *describe* the warehouse: `/data-model` names `warehouse.fact_vehicle_sale` because that is the table it documents. Each exempted file is separately asserted to construct no query, import no client and carry no connection string, and the **literal** substring rule is applied with no exemption to the dashboard lane's own files. Reasoning recorded in `TEST_STRATEGY.md §3.2`. |

---

## `DASH.2` — Dashboard shell and Executive Overview

| Field | Value |
|---|---|
| **Purpose** | The console exists: `/dashboard` renders the executive surface from existing KPIs, inside the site's design system, with the governed filter contract and the trust panel. |
| **Dependencies** | `DASH.1` |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | ADR-0013 conditions 11–14; `INFORMATION_ARCHITECTURE.md` |
| **Status** | **Implemented** |
| **Inherited from `DASH.1`** | The page-shaped payloads `DATA_CONTRACT.md §8` originally listed (`executive-summary.json`, `store-scoreboard.json`, `sales-gross.json`, `inventory-health.json`) were deliberately not created by `DASH.1`, because a page payload is a presentation decision owned by its route and preaggregating KPI values in TypeScript would violate ADR-0013 condition 2. `DASH.2-03` builds the executive payload from the exported datasets that already exist, and `DASH.2-04` adds the trust panel that merges the real ADR-0008 Power BI state — the export lane carries no Power BI field, by design. |

### `DASH.2-01` — Shell, navigation, and disclosure

| Field | Value |
|---|---|
| Purpose | One new primary-nav destination and an internal dashboard navigation that keeps the public header small. |
| Dependencies | `DASH.1` |
| Complexity | Medium |
| Status | **Implemented** |
| Architecture references | `INFORMATION_ARCHITECTURE.md §2–3`; `lib/site.ts` route registry conventions |
| Data-grain impact | None |
| Acceptance criteria | `Dashboard` added to `PRIMARY_NAV` (seventh item, within `MAX_PRIMARY_NAV_ITEMS`); dashboard routes registered in `ROUTES` and mirrored in `tests/e2e/routes.ts`; internal `DashboardNav` follows the `PlatformNav` pattern (`aria-current`, no tablist); breadcrumbs per IA §5; `TrustLine` scope `dashboard` renders in the body of every dashboard route with the synthetic statement and the real Power BI validation state; mobile nav has no horizontal overflow at 320px. |
| Required tests | `tests/unit/site.test.ts` updates; `tests/e2e/navigation.spec.ts` updates; disclosure assertions in `tests/e2e/content-integrity.spec.ts` extended to dashboard routes. |
| Documentation updates | `portfolio/docs/CONTENT_MODEL.md` §12; `INFORMATION_ARCHITECTURE.md` as-built. |
| Explicit non-goals | No page content beyond the shell. |
| Completion evidence | Routes render; nav/e2e suites green. |
| As-built notes | **One console route exists, not ten.** `Dashboard` is the seventh `PRIMARY_NAV` item, exactly at `MAX_PRIMARY_NAV_ITEMS`, and `ROUTES.dashboard` is mirrored in `tests/e2e/routes.ts`. `DashboardNav` follows `PlatformNav` (a `<nav aria-label="Dashboard">` of links with `aria-current`, explicitly not a tablist) and carries **only implemented destinations** — one today. The other nine IA §1 routes are rendered on the page as *text*, each beside the increment that delivers it (`PLANNED_DASHBOARD_SECTIONS` in `lib/site.ts`), because a navigation item that goes nowhere is worse than a one-item bar; `dashboard.spec.ts` asserts each of the nine answers 404 and that no anchor on the page points at one. The IA's `<details>` mobile presentation for `DashboardNav` was **not** built: with one destination it would be a disclosure a reader opens to find the page they are on, and the wrapping row cannot overflow at 320px at this length. It arrives with the increment that makes the list long enough to need it (IA §2 as-built). `PageHeader` gained `dashboardNav` and a `crumbLabel`, and `TrustLine` gained a `dashboard` scope carrying the clause "Exported SQL figures, not a Power BI result." |

### `DASH.2-02` — Global URL filter contract

| Field | Value |
|---|---|
| Purpose | One filter grammar for every dashboard page, in the URL, safe against garbage. |
| Dependencies | `DASH.2-01` |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | `INFORMATION_ARCHITECTURE.md §6` |
| Data-grain impact | None (filters select, never redefine) |
| Acceptance criteria | Typed parser/serializer for the IA §6 parameter set (date range, comparison, store, condition/sale-type scope, department, employee, lead source, campaign, make, model, condition, finance structure, product category); a copied URL reproduces the view; unknown/invalid values fall back safely with a visible notice; native controls; active filters visible as text; reset control; selected and comparison periods always visible; page-specific extensions declared per route; filters never alter KPI definitions; back/forward stable. |
| Required tests | `portfolio/tests/unit/dashboard-filters.test.ts` (parse/serialize round-trip, invalid input, defaults); `portfolio/tests/e2e/dashboard-filters.spec.ts` (deep link, back button, reset, mobile overflow). |
| Documentation updates | IA §6 as-built. |
| Explicit non-goals | No saved views, no server persistence. |
| Completion evidence | Named suites green; deep-link e2e passes at all eight tested widths. |
| As-built notes | All thirteen IA §6 parameters parse, validate, serialize and round-trip; canonical order is `FILTER_KEYS` order and a store list is sorted, so two equivalent states produce byte-identical query strings. **Route support is declared rather than implied**: `EXECUTIVE_OVERVIEW_SUPPORT` marks `period`/`compare`/`store` `applied`, `condition`/`source` `partial` with a note naming the measure family each scopes, and the remaining eight `not-applicable` with the reason (no such attribute in the export, or the domain arrives with `DASH.6`). A partial filter is applied only to datasets whose manifest column list carries the attribute — the first version applied `condition` everywhere and silently zeroed the gross card, which is the worst of the three available behaviours. The control surface offers presets only: a custom range and a multi-store list are part of the URL contract and are documented with copyable examples in a disclosure beside the bar, because a two-input range composed into one parameter cannot be expressed by a native GET form without scripting. `Certified` parses (IA §6 vocabulary) but is not offered as a control, because the warehouse models New and Used only. Filters push history entries, so Back and Forward are the undo stack; the widths tested are 320/375/**390**/768/1024/1280/1440/1920 from a dashboard-local list, since `DASH.13-01` owns adding 390 to the shared matrix. |

### `DASH.2-03` — Executive Overview page

| Field | Value |
|---|---|
| Purpose | The highest-value operating answers on one screen from existing data: context header, primary KPI row (retail units, total gross, total PVR, lead-to-sale, median age, aged %, back PVR — reconciliation variance card arrives with `DASH.9`), store scoreboard respecting operating-model differences, inventory risk summary, funnel summary, placeholder-free actions area deferred to `DASH.12`. |
| Dependencies | `DASH.2-01`, `DASH.2-02` |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | `DASHBOARD_PROGRAM.md §7`; KPI_CATALOG.md (existing 29) |
| Data-grain impact | None |
| Acceptance criteria | Every card shows current value, prior-period difference, unit, drill-through, and a "How is this calculated?" disclosure resolving to the governed KPI id; scoreboard never penalizes the pre-owned store for absent new-vehicle metrics (cells render "Not applicable"); all values equal the exported values exactly; no decorative sparkline without a data-table alternative; empty and stale states per IA §8. |
| Required tests | `portfolio/tests/unit/dashboard-executive.test.tsx` (values match fixture export, N/A semantics); `portfolio/tests/e2e/dashboard.spec.ts` (renders, drill-throughs, disclosure, axe via the a11y sweep). |
| Documentation updates | IA and program as-built notes. |
| Explicit non-goals | No targets/pace (DASH.5), no bridge (DASH.3 logic arrives with its page), no actions (DASH.12). |
| Completion evidence | Route live in CI e2e with cross-checked totals. |
| As-built notes | **No generated page payload was created.** `DATA_CONTRACT.md` §8 originally listed `executive-summary.json`; a deterministic server-side selector layer replaces it, because a precomputed payload would be a second place a KPI value is written and the measured cost of computing on the server is an array pass over data the process already holds. `lib/dashboard/selectors.ts` declares every permitted aggregation **as data** — dataset, columns, basis, governed KPI id, and the manifest reconciliation key the selector must reproduce exactly — and `dashboard-executive.test.tsx` walks the registry and compares each against the committed manifest character for character. **Two KPIs decline at group scope, deliberately.** Median inventory age (KPI-INV-004) and median response time (KPI-FUN-008) are order statistics; the catalogue states outright that a group median is not derivable from subgroup medians, and the export publishes them at store × snapshot × condition group and at store × source × day respectively. Both cards render `Not derivable at this scope`, name the filter that resolves them, and **do** resolve when the URL narrows to the published grain — which the e2e suite exercises in both directions. The inventory section shows every governed median it has, at that grain, as the "available valid scope". The scoreboard therefore carries **average** response time (KPI-FUN-007, a ratio of two additive columns and exact at any scope) where the plan listed the median, with a column note explaining the substitution; the median is on the page in the funnel section. `New units` was added as a scoreboard column because it is where the structural-absence rule actually bites: the independent store renders `Not applicable`, never `0`. |

### `DASH.2-04` — Trust panel and measured baseline

| Field | Value |
|---|---|
| Purpose | The console states its own evidence: SQL reconciliation state, export dataset version/date, privacy-scan status, and Power BI validation state (pending/stale/passed from the evidence files) — and the performance baseline is measured before budgets are set. |
| Dependencies | `DASH.2-03` |
| Complexity | Medium |
| Status | **Implemented** |
| Architecture references | ADR-0013 conditions 5–6; ADR-0008 freshness states |
| Data-grain impact | None |
| Acceptance criteria | Trust panel renders manifest-derived states only; a Power BI "validated" claim is impossible while evidence files say pending (unit-tested); `report-bundle.ts` route list extended to the dashboard routes; measured route JS / HTML / payload sizes recorded in `portfolio/docs/PERFORMANCE.md` as the dashboard baseline. |
| Required tests | `portfolio/tests/unit/dashboard-trust.test.ts`; bundle report run recorded in the PR. |
| Documentation updates | PERFORMANCE.md baseline table. |
| Explicit non-goals | No budget enforcement yet (budgets set from these measurements in `DASH.13`). |
| Completion evidence | Panel renders the current real states; baseline table committed. |
| As-built notes | Two lanes with two sources and no path between them. The export lane reads `src/generated/dashboard/manifest.json`; the Power BI lane reads the ADR-0008 evidence through the project manifest, which `generate-project-manifest.ts` builds from `powerbi/validation/*_validation_results.json` and nothing else. `powerBiTrust()` takes the evidence as an argument and derives `validated` from it, so `dashboard-trust.test.ts` drives it with pending, stale, failed and passed **fixtures** and asserts the claim in each case — no real evidence file is touched. The suite also asserts structurally that the dashboard manifest carries no Power BI key, that nothing assigns `validated` a literal, and that the panel renders `state.claim` rather than a sentence of its own. `report-bundle.ts` gained `/dashboard` and a filtered `/dashboard?…` entry, because this is the first route whose output depends on its query string and one measurement would describe one filter state. |

---

## `DASH.3` — Sales, Gross, and Deal Explorer

| Field | Value |
|---|---|
| **Purpose** | The GSM surface: trends, mix, gross decomposition, and a governed deal index over the existing sale fact. |
| **Dependencies** | `DASH.2` |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | §12 (sale fact), §18; `KPI_EXTENSION_PLAN.md` (bridge is deterministic, not causal) |
| **Status** | **Implemented** |

### `DASH.3-01` — Reporting views for trend, bridge, and deal index

| Field | Value |
|---|---|
| Purpose | SQL owns the arithmetic: `vw_sales_gross_trend` (store × day), `vw_gross_change_bridge` (store × period pair × component; volume, front-PVR, back-PVR effects with documented sequential order and an exact-reconciliation guarantee), `vw_deal_explorer` (deal-grain projection of `vw_vehicle_sales` limited to exportable columns). |
| Dependencies | `DASH.2` |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | §18.2 (view ownership); reporting-view plan §15 of the program |
| Data-grain impact | New views; no fact change |
| Acceptance criteria | Each view documents grain, date basis, null behaviour, and export eligibility in `COMMENT`s; bridge components sum exactly to the period delta on every store row (integration-tested); views readable by `arpi_reporter`; sequence files follow `sql/05_reporting/` numbering. |
| Required tests | `tests/integration/test_dashboard_reporting_views.py` (grain, bridge reconciliation, NULL-denominator behaviour, reporter access). |
| Documentation updates | Reporting-scope doc; `DATA_CONTRACT.md` dataset registry. |
| Explicit non-goals | No mix-effect component until its order is documented (may land as a follow-up inside this increment or be recorded Deferred). |
| Completion evidence | Views + tests green on the built database. |

### `DASH.3-01` as-built notes

**Three views, and one of them is shaped by an arithmetic problem.** `vw_sales_gross_trend` sits
beside `vw_sales_summary` and `vw_gross_summary` at the same store-day grain rather than replacing
them; the integration suite asserts it agrees with both on every row. Its condition and sale-type
breakdowns are additive COLUMNS that are zero on excluded rows, never extra rows, so the declared
grain and the actual grain cannot diverge.

`vw_gross_change_bridge` publishes **exact numerators over a shared denominator and never divides**.
Computing three dollar effects from rounded per-unit rates and then asserting they sum to the period
delta asserts something that is not quite true, and the residual lands wherever the rounding fell.
Publishing `(U1-U0)*TG0`, `U0*FG1-U1*FG0` and `U0*BG1-U1*BG0` over `U0` makes the sum identically
`U0*(TG1-TG0)` in exact numeric — the reconciliation holds to the last digit, not to the cent. The
console divides for display and shows the rounding residual (at most a cent or two) rather than
absorbing it into a component. Non-comparable months are emitted with `is_comparable = false`, a
reason, NULL components and a populated `total_gross_change`, because the period change is well
defined even when its decomposition is not.

**Two findings changed the plan, both from reading the physical SQL rather than the documentation:**

- `warehouse.fact_vehicle_sale.lead_source_key` exists and the generator never populates it — it is
  NULL on all 650 transactions. Reading it would have reported "no source recorded" on every deal in
  the console. Attribution is therefore resolved through `fact_lead.sale_key` (at most one lead per
  sale, asserted), and `is_lead_attributed` distinguishes genuine walk-in business from missing
  data. An integration test asserts the column is still empty, so if the generator ever starts
  filling it the rationale is re-examined rather than two sources silently disagreeing.
- **No stock number and no acquisition date exist in the model.** `dim_vehicle` publishes
  `vehicle_id` and a synthetic VIN, and nothing else identifies a unit. `vehicle_code` is therefore
  published as itself and is never captioned "stock number"; the Deal Jacket will render acquisition
  date as not modelled.

The three views are held in a new `DASHBOARD_PROGRAM_VIEWS` register, separate from
`MVP_REPORTING_VIEWS`, for the same reason the listing lane is: `sql_baseline_metadata.json` records
the surface the Power BI semantic model was measured against, and a `DASH.*` view is not part of it.
The reporting schema now holds 37 views in three declared lanes; **no Power BI evidence changed.**

### `DASH.3-02` — Visualization primitives

| Field | Value |
|---|---|
| Purpose | The chart decision is made from evidence, not habit: documented chart-type needs vs the existing hand-built primitives (`BarChart`, `StackedMixBar`), bundle impact, accessibility, server-rendering, and no-JS fallback — then the needed primitives (trend line, pace/bullet bar, bridge/waterfall, funnel, distribution strip) are built as server-rendered SVG with data-table alternatives, **or** a library is adopted with the evaluation recorded. |
| Dependencies | `DASH.2` |
| Complexity | Large |
| Status | **Implemented** |
| Architecture references | Program §16; DESIGN_SYSTEM.md register |
| Data-grain impact | None |
| Acceptance criteria | Written evaluation in the PR; every primitive has an accessible name, text summary, direct labels where practical, keyboard path for any interaction, data-table alternative, reduced-motion behaviour, and no color-only meaning; no raw hex/shadow/radius/duration outside tokens; measured bundle delta recorded. |
| Required tests | `portfolio/tests/unit/dashboard-visuals.test.tsx`; axe + reduced-motion e2e coverage on a fixture page. |
| Documentation updates | DESIGN_SYSTEM.md component inventory. |
| Explicit non-goals | No speedometer/racing metaphors; no chart where a table communicates better. |
| Completion evidence | Primitives in use on `DASH.3-03` with green a11y sweep. |

### `DASH.3-03` — `/dashboard/sales-gross`

Large; **Implemented**. Performance block (units by type, gross, PVRs), trends (daily/weekly/monthly, vs
comparison), mix (new/used, store, sale type, source), gross analysis (front/back contribution,
discount vs asking, negative-gross counts, distribution with median and mean paired per
KPI_CATALOG.md §5), and the volume/rate bridge rendered with its documented order and exact totals.
Acceptance: every figure equals the export; bridge language is non-causal ("the bridge attributes…");
axe clean; filters apply. Tests: `dashboard-sales-gross` unit + e2e. Non-goals: target overlays
(`DASH.5`). Evidence: route green in CI.

### `DASH.3-04` — `/dashboard/deals` index

Large; **Implemented**. Chunked deal index (per `DATA_CONTRACT.md` chunking) with search (id, stock, model),
sort, filters, pagination; desktop table ↔ mobile cards with exactly one representation in the
accessibility tree (the established 1280px pattern); columns per program §7; every row links to the
Deal Jacket; compact index fields never duplicate the full jacket payload. Tests: unit (chunk
loading, search determinism) + e2e (URL state, pagination, responsive). Non-goals: jacket itself.
Evidence: index handles the full development-profile deal set in CI.

---

## `DASH.4` — Basic Deal Jacket

| Field | Value |
|---|---|
| **Purpose** | The sanitized transaction record: `/dashboard/deals/[saleId]` over existing sale-fact fields, with formula verification, lineage, print, and honest N/A states. |
| **Dependencies** | `DASH.3` |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | `DEAL_JACKET_SPEC.md` (the route contract in full, plus §20 as-built) |
| **Status** | **Implemented** |

### `DASH.4-01` — `vw_deal_jacket`, per-deal export chunks, and the rendering decision

Large; **Implemented.** `reporting.vw_deal_jacket` publishes one row per finalized transaction —
650 rows against 650 fact rows across seven joins — carrying the cost components behind the front
gross in the order `KPI-GRS-001` states them, the trade context published *separately* from that
formula, the finance amounts, the four staff roles as synthetic identifiers, the lead's paper trail,
and three supporting facts the page's checklist needs. It publishes **no** verification flag,
deliberately: the console recomputes both identities, and a verification that reads a flag verifies
nothing.

`finance_structure` is derived in SQL (`Lease` → `Cash` when nothing was financed → `Retail
Finance`) and published beside `finance_structure_basis`, so a reader can see what the label was
decided from rather than being asked to trust it.

**Chunking is store × sale month, not per-deal.** The planned "per-deal chunk keyed by `sale_id`"
would have produced 650 files to serve one page each: 18 partitions of 443 kB total, largest 34 kB,
is an order of magnitude inside the ceiling and needs no index to keep in sync. The partitions live
in their own module (`jacket-chunks.ts`) so that 443 kB does not enter the server graph of
`/dashboard/deals`, which shows none of it.

**The rendering decision was measured.** 650 prerendered documents ≈ 120 MB of HTML in `.next` and
the deployment image, against 443 kB of statically packaged data server-rendered on demand. Server
rendering was chosen; both options satisfy ADR-0013, and both produce complete HTML without
JavaScript. Recorded in `DATA_CONTRACT.md §9`, `PERFORMANCE.md §9.4` and `DEAL_JACKET_SPEC.md §20.2`.

Evidence: 34 integration assertions in `tests/integration/test_deal_jacket_reporting_view.py`,
including **two seeded defects** — a one-cent mutation of the front gross and of the total gross —
that prove the identity assertions can fail rather than passing vacuously.

The reporting schema now holds **38 views in three declared lanes**; **no Power BI evidence
changed.**

### `DASH.4-02` — Deal Jacket route

Large; **Implemented.** Renders per `DEAL_JACKET_SPEC.md`, with §20.3 recording each divergence and
its reason. Three are worth naming here: the vehicle section publishes days-in-inventory rather than
an acquisition date and never captions `vehicle_code` a stock number, because the model contains
neither; the checklist omits the three checks that need the F&I model rather than showing them
green, because a check that cannot fail is not a check; and the lineage names its source view from
the export manifest rather than from a literal in the code, so the console still names no database
object of its own.

The deal id on `/dashboard/deals` became a link in this same diff — the only order in which shipping
an anchor to it is honest — and the e2e guard that asserted the *absence* of that link was re-aimed
to assert every row resolves.

Evidence: 43 unit assertions and 31 browser assertions, all green; axe-clean; complete without
JavaScript; the paper recap asserted under `media: 'print'`.

Originally specified as: header with persistent synthetic disclosure;
vehicle; front-gross calculation block exactly as ARPI computes it, with discounts and verification
state; trade section with variance and N/A semantics; finance amounts without rate mechanics;
aggregate back gross (labelled as aggregate until `DASH.7` itemizes it); total-gross identity;
staff roles as synthetic ids; lead/appointment timeline where linked, no content fields; accounting
checks; lineage drawer; two-column desktop, stacked mobile with calculation order preserved; print
stylesheet per spec §17. Tests: unit for every section incl. N/A states; e2e incl. invalid
`saleId`, print mode, mobile reflow, axe. Non-goals: itemized products (DASH.7), multi-trade
(DASH.O-1). Evidence: route green with spec test cases.

### `DASH.4-03` — Deal Jacket test cases

Medium; **Implemented.** Every §19 case has a test. The deal shapes are selected by PREDICATE over
the whole 650-deal population rather than by hard-coded id, so a case that stops existing in the
export fails loudly ("no deal in the export is a cash deal; the rendering rule for it is untestable")
instead of silently testing nothing.

The two cases that carry the most weight are the ones that had to be manufactured:

- **Corrupted fixture.** The unit suite rebuilds the view model against a partition table whose first
  deal has been mutated by one cent, and requires the failure to surface: the verification reports
  it in words with both figures, the checklist raises it for review, and the page still shows the
  figures as exported rather than hiding a broken deal. Without this, a `verify()` that returned
  `true` unconditionally would pass every other test in the file. The fixtures exist only in the test
  — nothing in `data/dashboard/` or `src/generated/` is touched.
- **Print mode.** Asserted in Playwright under `media: 'print'`, which is the only place the
  `@media print` block applies. It caught a real defect: `data-arpi-print="omit"` had been passed to
  the `<Section>` primitive, which takes a declared prop list and dropped it, so the paper recap was
  printing its navigation. A boundary test now fails the build if that attribute is placed on a
  component that would swallow it.

Evidence: each named case has a test that fails when its rendering rule breaks.

---

## `DASH.5` — Targets and pace

| Field | Value |
|---|---|
| **Purpose** | Promote `fact_sales_target` end-to-end and light up attainment and selling-day pace. |
| **Dependencies** | `DASH.2`; Gate 4 satisfied by the registered stakeholder question |
| **Estimated complexity** | Large |
| **Blocking gate** | Gate 4 (new domain) — satisfied within the increment |
| **Architecture references** | §12 (fact grains), §28 Gate 4; KPI_EXTENSION_PLAN §3 |
| **Status** | Planned |

### `DASH.5-01` — `fact_sales_target` end-to-end

Large; Planned. Generator (seeded per-store/per-month targets varying plausibly, employee-scope rows
where sample rules permit), raw/staging/warehouse SQL at the declared grain with a grain-enforcing
UNIQUE constraint, loader wiring, `DQ-TGT-*` checks registered, `RECON-*` rowcount/chain entries,
`STM-016`, DATA_DICTIONARY.md promotion from Part G, `dim_date` selling-day reuse. Data-grain
impact: **new fact table** (ADR not required beyond ADR-0013's program authorization? — no: adding a
fact table requires an ADR per §35.2; ADR-0013 records the program-level authorization and this
backlog is its schedule; the increment PR must cite ADR-0013 §Decision and the program §9.8 as the
recorded decision). Tests: unit (generator determinism, Decimal exactness, scope rules), integration
(grain, load counts, reconciliation). Evidence: all layers green.

### `DASH.5-02` — `vw_target_attainment` and KPI promotion

Medium; Planned. The view (store × KPI × month with MTD actuals, targets, selling-day arithmetic),
`KPI-TGT-001..010` moved into KPI_CATALOG.md with full fields, the stakeholder question registered,
`test_kpi_verification.py` extended so each new KPI checks against an independent warehouse
derivation and NULL-safe denominators. Evidence: catalogue diff + green verification suite.

### `DASH.5-03` — Console integration

Medium; Planned. Export slice, executive pace bars and scoreboard pace column, sales-gross target
overlays, "Selling-day pace projection" labelling everywhere a projection renders; no target
hardcoded in React. Tests: unit fixture assertions + e2e label checks. Evidence: routes green.

---

## `DASH.6` — F&I model

| Field | Value |
|---|---|
| **Purpose** | The F&I domain becomes real: product dimension, lender dimension, product-sale and adjustment facts, finance reserve, eligibility configuration — generation through reporting with exact identities. |
| **Dependencies** | `DASH.2` (consumer exists); independent of `DASH.3`–`DASH.5` |
| **Estimated complexity** | Large |
| **Blocking gate** | Gate 4 — satisfied within the increment (SQ-21 already records the blocked question) |
| **Architecture references** | §11–13, §28 Gate 4, §35.2; PRIVACY_AND_ETHICS §7; program §9.1–9.7 |
| **Status** | Planned |

### `DASH.6-01` — Design decisions on the record

Medium; Planned. Records, in `DATA_CONTRACT.md` and DATA_DICTIONARY.md Part G updates: the provider
decision (attribute vs `dim_finance_product_provider`, justified by the analytical questions it
enables), the deal-structure mapping (program §9.7), lender classification vocabulary, and the
adjustment-type vocabulary (Cancellation, Chargeback, Reinstatement, Approved Adjustment). Evidence:
documented decisions with rationale; no code.

### `DASH.6-02` — `dim_finance_product`, `dim_lender`, eligibility config

Large; Planned. Generators (seeded catalogues; ten governed categories; fictional lenders across
Captive/Bank/Credit Union/Independent with Prime/Near-prime/Subprime tiers), SQL dims with SCD
policy recorded (Type 1 both, ADR-0006 pattern), `config/reference/fi_product_eligibility.yaml`
with `ELIG-*` rules, `DQ-FPD-*`/`DQ-LND-*` checks, `STM-017`/`STM-018`. Prohibited: any real lender
identity, any credit-file field (privacy tripwire extended with the new column vocabulary). Tests:
unit + integration per convention. Evidence: dims populated and validated.

### `DASH.6-03` — `fact_finance_product_sale` and finance reserve

Large; Planned. Sale generator extension: per-deal product baskets driven by eligibility, manager
skill indices, structure mix; reserve amounts on financed retail deals only (cash deals: reserve
impossible); `back_end_gross` becomes the derived sum `finance_reserve_gross + Σ original product
gross at deal date` so the existing stored column remains exact; migration `0003+` adds
`finance_reserve_gross` and `lender_key` FK with guarded, recorded, idempotent DDL per
`sql/09_migrations` rules; fact DDL with grain UNIQUE (one row per product per deal — key
`(sale_id, product_id, line_ordinal)` to allow duplicate products where realistic); identity CHECK
`original_product_gross = product_retail_price − product_dealer_cost`; `DQ-FPS-*` incl. eligibility
enforcement (ineligible row = critical failure); `STM-019`. Data-grain impact: new fact + two new
`fact_vehicle_sale` columns (no existing column redefined; both identities unchanged). Tests: unit
(Decimal identities, eligibility, edge cases: multi-product deal, eligible deal with no product,
missing-manager-on-allowed-transaction), integration (grain, FK, `RECON-FI-001` promoted and
passing, back-gross rollup). Evidence: 58+ reconciliations still green plus the new ones.

### `DASH.6-04` — `fact_finance_product_adjustment`

Large; Planned. Adjustment generator (post-sale timing distributions; chargebacks after sale, varied
lag; cancellation vs chargeback vs reinstatement mix; adjustment never exceeding original gross
except through an explicitly modelled and tested reason — default: capped), DDL with grain UNIQUE on
adjustment id, `DQ-FPA-*`, `STM-020`, `net_product_gross_as_of` defined in reporting, three date
bases documented. Tests: unit (timing, caps, determinism), integration (orphan prevention, as-of
arithmetic). Evidence: adjustment analytics reconcile.

### `DASH.6-05` — F&I reporting views and KPI promotion

Large; Planned. `vw_deal_product_detail`, `vw_fi_summary`, `vw_fi_product_penetration`,
`vw_fi_adjustment_summary`; `KPI-FNI-001..022` promoted into the catalogue; `RECON-FI-001` and the
new reconciliation entries in §36; stakeholder questions registered; `test_kpi_verification.py`
extended. Evidence: every FNI KPI verified against an independent derivation.

---

## `DASH.7` — F&I dashboard and expanded Deal Jacket

| Field | Value |
|---|---|
| **Purpose** | The F&I director's surface and the itemized jacket: penetrations with eligible denominators, reserve vs product mix, adjustments, manager comparison; jacket products itemized with back-gross reconciliation. |
| **Dependencies** | `DASH.4`, `DASH.6` |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | Program §7; KPI_EXTENSION_PLAN §4 |
| **Status** | Planned |

Items: `DASH.7-01` F&I export slices + `/dashboard/fi` (Large) — summary, penetration table always
showing contracts sold / eligible deals / penetration / prior period, mix table, adjustment analysis
distinguishing deal-date vs as-of vs adjustment-period, manager comparison with minimum-sample
states; `DASH.7-02` Deal Jacket F&I itemization + reconciliation panel (Medium) — one row per
product with original/cancellation/chargeback/net columns, totals tying to `back_end_gross`, contract
status; `DASH.7-03` e2e + unit coverage per TEST_STRATEGY (Medium). Non-goals: no product
recommendations, no menu simulation. Evidence: routes green; jacket reconciliation state renders
from data.

---

## `DASH.8` — Inventory accounting and GL controls

| Field | Value |
|---|---|
| **Purpose** | The controller's data: stock-level accounting snapshot, selected GL control accounts and balances, reconciliation and exception views, `KPI-ACC` promotion. |
| **Dependencies** | `DASH.2`; independent of F&I |
| **Estimated complexity** | Large |
| **Blocking gate** | Gate 4 — satisfied within the increment |
| **Architecture references** | Program §9.9–9.10; KPI_EXTENSION_PLAN §5 |
| **Status** | Planned |

Items: `DASH.8-01` `fact_inventory_accounting_snapshot` end-to-end (Large) — generator derives book
components consistently with acquisition/recon costs already generated, write-down scenarios,
book-value identity as generator rule + SQL CHECK, `DQ-IAS-*`, `STM-022`; pack excluded from book
value; floorplan principal as liability column never summed into book value. `DASH.8-02`
`dim_gl_account` + `fact_gl_control_balance` (Large) — selected synthetic control accounts,
balances that usually reconcile plus **controlled, documented variance scenarios**, `DQ-GLA-*`/
`DQ-GLB-*`, `STM-023`/`STM-024`. `DASH.8-03` `vw_inventory_accounting`,
`vw_inventory_gl_reconciliation`, `vw_accounting_exceptions`, `KPI-ACC-001..012` promotion,
reconciliation register entries, stakeholder question (Large). Non-goals: no full GL, no journal
entries, no posting workflow. Evidence: variance surface demonstrably alive on the planted scenarios;
all identities tested.

---

## `DASH.9` — Accounting dashboard and inventory integration

| Field | Value |
|---|---|
| **Purpose** | `/dashboard/accounting` and the inventory page's accounting overlay: subledger vs GL, stock and deal exceptions, timing analysis, unit-level accounting position. |
| **Dependencies** | `DASH.8`; `DASH.3` (shell patterns); inventory route may land here if not earlier |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | Program §7; IA §4 |
| **Status** | Planned |

Items: `DASH.9-01` `/dashboard/inventory` (Large) — summary block (existing `KPI-INV-*`), governed
age buckets (0–30/31–60/61–90/91–120/120+; aged threshold labelled project default), unit analysis
with snapshot-derived markdown activity and `price_to_market_ratio` (synthetic estimate, labelled),
unit drill-through with accounting position where `DASH.8` data exists; `DASH.9-02`
`/dashboard/accounting` (Large) — inventory reconciliation, stock exceptions, deal reconciliation,
timing analysis with period-ownership statements; `DASH.9-03` executive reconciliation-variance card
+ trust-panel wiring (Small). Non-goals: floorplan cost analysis (not modelled), repricing actions.
Evidence: exception drill-throughs resolve; axe clean.

---

## `DASH.10` — Leads and Marketing dashboard

| Field | Value |
|---|---|
| **Purpose** | The BDC surface over implemented funnel and marketing facts: funnel with stage conversions, response-time distribution (median headline, mean context), lost-stage analysis, source and campaign efficiency including `KPI-MKT-001..003`. |
| **Dependencies** | `DASH.2` |
| **Estimated complexity** | Large |
| **Blocking gate** | None (existing facts only) |
| **Architecture references** | Program §7; KPI_CATALOG FUN/MKT families |
| **Status** | Planned |

Items: `DASH.10-01` export slices + `/dashboard/leads-marketing` (Large) — funnel counts and
conversions at each stage, response distribution with tail count, lost-stage analysis with
non-causal language, marketing table (spend, leads, sales, CPL, CPS, attributed gross, gross ROAS)
respecting the organic-source cost rule (`RECON-MKT-COST-RULE`); `DASH.10-02` tests per strategy
(Medium). Non-goals: clicks/impressions as primary value measures; attribution models beyond the
implemented lead-source linkage. Evidence: route green, totals reconcile.

---

## `DASH.11` — Employee performance

| Field | Value |
|---|---|
| **Purpose** | Role-aware, sample-disciplined employee views: salesperson, desk manager, finance manager, BDC. No leaderboard, no composite score. |
| **Dependencies** | `DASH.3` (deal drill-through), `DASH.7` for finance-manager F&I columns (that view section ships reduced until then if sequenced earlier) |
| **Estimated complexity** | **Medium** (no new warehouse entity; one view + export + route on established patterns) |
| **Blocking gate** | None |
| **Architecture references** | PRIVACY_AND_ETHICS §5–6; program §6 |
| **Status** | Planned |

Items: `DASH.11-01` `vw_employee_performance` (role × period measures per program §7, current
role-assignment version from the SCD2 timeline) + export slice (Medium); `DASH.11-02`
`/dashboard/employees` (Medium) — role tabs, minimum-sample disclosure, role-appropriate
denominators, store context, no protected attributes, no subjective scoring, no punitive language.
Tests: unit (sample rule, denominator selection), e2e (role views, axe). Evidence: a below-floor
employee renders the insufficient-sample state, asserted.

---

## `DASH.12` — Management Action Center and change drivers

| Field | Value |
|---|---|
| **Purpose** | Deterministic actions and the "Why did this change?" bridge, with evidence and drill-through, no write-back. |
| **Dependencies** | All surfaces it links into: `DASH.3`, `DASH.5`, `DASH.7`, `DASH.9`, `DASH.10` |
| **Estimated complexity** | Large |
| **Blocking gate** | None |
| **Architecture references** | `ACTION_ENGINE_SPEC.md`; program §13, §21 |
| **Status** | Planned |

Items: `DASH.12-01` `config/dashboard/action_rules.yaml` + export-time rule evaluation + action
dataset (Large) — rule schema per spec §2, initial rule set across inventory/sales/F&I/leads/
accounting families, suppression, dedup, expiration, severity logic, all thresholds project
defaults; `DASH.12-02` `/dashboard/actions` + executive top-actions block (Medium) — queue with
domain/severity/store/owner-role facets, evidence fields, explanation templates, drill-through,
threshold disclosure; `DASH.12-03` driver engine (Large) — documented sequential decomposition
(volume, front-PVR, back-PVR, then documented mix components), exact reconciliation, template
narratives with non-causal wording, suppression threshold for immaterial effects, unavailable state
for incomparable periods, and the same driver formulas registered for future Power BI ownership.
Tests per spec §10 and TEST_STRATEGY. Non-goals: persistence, assignment, resolution, notification.
Evidence: every rule has a fixture that fires it and a fixture that suppresses it; bridge totals
reconcile in tests.

---

## `DASH.13` — Hardening and release

| Field | Value |
|---|---|
| **Purpose** | Close the program honestly: sweeps, budgets from measurements, scans, docs, captures, deployment validation, and a gate assessment that invents nothing. |
| **Dependencies** | All non-optional increments |
| **Estimated complexity** | Large |
| **Blocking gate** | None; explicitly may not alter Gate 2 without genuine evidence |
| **Architecture references** | Program §21; ADR-0013 Consequences |
| **Status** | Planned |

Items: `DASH.13-01` accessibility and responsive sweep (Large) — full route × viewport matrix
(320/375/390/768/1024/1280/1440/1920 — 390 added to the tested set), 200% zoom, reduced motion,
no-JS, axe with no suppressed rules; `DASH.13-02` performance closure (Medium) — bundle report over
all dashboard routes, payload budgets set from the recorded baselines, regression assertions added,
original and social image sizes recorded; `DASH.13-03` release closure (Large) — privacy/secret
scans, documentation index updates, product captures (straight screenshots per the media-capture
rules), social card, live-deployment verification, README/status honesty pass, and a written gate
assessment: Gate 2 restated from evidence (expected: still CLOSED unless the Power BI conditions
were genuinely met elsewhere). Evidence: the verification transcript in the PR, all suites green.

---

## Optional enhancements (recorded, not scheduled)

| ID | Item | Status | Notes |
|---|---|---|---|
| `DASH.O-1` | `warehouse.fact_trade_in` (multi-trade deals) + jacket trade detail + `STM-025` | Deferred | Requires migration/compatibility plan for the existing deal-level trade columns before any move |
| `DASH.O-2` | `warehouse.fact_inventory_price_history` promotion (event-grain markdown history) | Deferred | Snapshot-derived markdown activity ships first; promote only if event grain answers a registered question the snapshots cannot |
| `DASH.O-3` | `warehouse.dim_finance_product_provider` as a dimension | Deferred | Decided inside `DASH.6-01`; listed here so a "no" leaves a permanent record |
