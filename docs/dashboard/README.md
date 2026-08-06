# Dashboard documentation — ARPI Dealer Operations Command Center

The specification set for the governed web operating console authorized by
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md). These are
**planning contracts**: nothing they describe is implemented until the owning delivery increment in
[`DASHBOARD_BACKLOG.md`](../requirements/DASHBOARD_BACKLOG.md) lands and marks it so.

| Document | Owns |
|---|---|
| [`../requirements/DASHBOARD_PROGRAM.md`](../requirements/DASHBOARD_PROGRAM.md) | The master program: purpose, boundaries, personas, routes, data-model expansion, risks, release criteria, non-goals |
| [`../requirements/DASHBOARD_BACKLOG.md`](../requirements/DASHBOARD_BACKLOG.md) | The `DASH.0`–`DASH.13` delivery increments and permanent item identifiers |
| [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md) | Routes, navigation, breadcrumbs, the URL filter contract, drill-throughs, empty/error/freshness states, no-JS and deep-link behavior |
| [`DATA_CONTRACT.md`](DATA_CONTRACT.md) | The two-stage export pipeline: view allowlist, dataset grains and columns, manifest, versioning, chunking, staleness, size ceilings, privacy classification |
| [`KPI_EXTENSION_PLAN.md`](KPI_EXTENSION_PLAN.md) | The reserved `KPI-TGT` / `KPI-FNI` / `KPI-ACC` families and `DIAG-DEAL` diagnostics, field-complete, with eligibility rules and promotion protocol |
| [`DEAL_JACKET_SPEC.md`](DEAL_JACKET_SPEC.md) | The full sanitized Deal Jacket: sections, formulas, states, responsive and print behavior, test cases |
| [`ACTION_ENGINE_SPEC.md`](ACTION_ENGINE_SPEC.md) | The deterministic management-action engine and the "Why did this change?" driver bridge |
| [`TEST_STRATEGY.md`](TEST_STRATEGY.md) | Tests across Python, SQL, export, TypeScript, React, e2e, and the cross-layer reconciliation chain |
| [`diagrams/`](diagrams/) | Seven Mermaid diagrams: lineage, fact constellation, export pipeline, routes, Deal Jacket relationships, action generation, ownership boundaries |

**Read the boundary first.** Power BI remains the canonical analytical product; the console consumes
SQL-validated exports and never redefines a KPI, queries a non-`reporting` schema, or claims to
validate anything. Gate 2 is unchanged and CLOSED. All data is synthetic; Granite Auto Group is
fictional.
