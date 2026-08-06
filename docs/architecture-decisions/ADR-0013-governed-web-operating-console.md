# ADR-0013: Governed Web Operating Console

## Status

**Accepted**

## Date

2026-08-06

## Deciders

Michael Palmer

## Context

[ARCHITECTURE.md §6](../../ARCHITECTURE.md) lists among the project's non-goals:

> - A second complete dashboard in Tableau
> - A second complete dashboard in React or Next.js

[ARCHITECTURE.md §26.3](../../ARCHITECTURE.md) states that the website is statically prerendered with no
runtime data source, and [ADR-0009](ADR-0009-portfolio-ui-foundation-before-gate-2.md) enforces, through
its control **C5**, that **no KPI value appears anywhere on the site** and that the site has **no charting
library**. ADR-0009's Alternative C explicitly considered rendering KPI figures from the SQL baseline and
rejected it, for two reasons that were correct in their context: it would have made the *documentation
site* a second analytics application, and a page of dealership figures with no interaction model and no
provenance surface would have been read as results.

The project owner has now explicitly authorized a scope change: an interactive public operating console —
the **ARPI Dealer Operations Command Center** — that presents the governed KPIs of a fictional dealer
group the way a dealership operating report does, with drill-through to sanitized transaction detail, a
reconciliation surface, and a deterministic management-action queue. This is a deliberate product
decision, not drift: the analytical claim of this repository is stronger when a reviewer can *operate*
the numbers — filter them, trace them, reconcile them — rather than only read their definitions.

That authorization collides with three standing rules, and the collision must be resolved on the record
rather than silently:

1. The §6 non-goal excluding "a second complete dashboard in React or Next.js".
2. ADR-0009's controls C5 (no KPI value) and the §26.3 / ADR-0009 §4 statement that the site has no
   charting library and no runtime data source.
3. **Gate 2** ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)), which is **CLOSED**: no core Power BI report
   page exists, SQL-to-Power BI reconciliation has not run on a real engine, and no executive finding is
   drafted ([PHASE_2_BACKLOG.md §1.2](../requirements/PHASE_2_BACKLOG.md)).

The forces in play:

- **Power BI is the analytical product this project stakes its BI claim on.** The semantic model exists as
  TMDL — 26 tables, 42 relationships, 49 measures — but no engine has evaluated it, both
  [ADR-0008](ADR-0008-real-engine-validation-paths.md) validation paths are pending, and the report is a
  PBIR shell. A web console that recomputed the KPIs would compete with that deliverable, fork the
  semantic layer, and give KPI drift a second home.
- **The reporting schema already owns the reusable SQL.** All 29 governed KPIs are computable from
  `reporting` views and verified against independent warehouse derivations
  ([KPI_CATALOG.md §3](../../KPI_CATALOG.md)). Any web presentation that does not consume this layer would
  be inventing numbers.
- **The browser must never reach PostgreSQL.** [ARCHITECTURE.md §22](../../ARCHITECTURE.md) and
  [PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md) prohibit public query surfaces over the warehouse,
  and §26.3 records that the website holds no database credential. That boundary is not negotiable.
- **The misreading risk ADR-0009 named is real and permanent.** A polished console showing dealership
  figures will be read as a real dealership's results unless the synthetic disclosure is structural
  rather than decorative.

## Decision

**ARPI will have two presentation products with one shared calculation authority, and the web product is
admitted under fifteen binding conditions.**

### The two products

**1. Canonical analytical product — Microsoft Power BI.** Power BI remains the canonical semantic-model
and analytical-reporting product. It retains sole responsibility for:

- Semantic-model relationships
- Governed DAX
- Real-engine validation under ADR-0008
- The formal Power BI report pages (`P2.2`)
- Gate 2's conditions
- SQL-to-DAX reconciliation

Nothing in this record advances, waives, or substitutes for any of that.
**Gate 2 remains CLOSED until its existing conditions are actually met**, and no artifact delivered under
this record may be cited as evidence toward any of the three conditions.

**2. Public interactive operating console — the Next.js application.** The portfolio application may
contain an interactive public operating console, the **ARPI Dealer Operations Command Center**, under the
`/dashboard` route family, only while **all fifteen** of the following conditions hold:

1. It consumes **SQL-validated, versioned, synthetic data exports** produced by a governed export
   pipeline from the `reporting` schema.
2. It does **not** independently redefine KPI formulas.
3. Every displayed KPI resolves to a governed [KPI_CATALOG.md](../../KPI_CATALOG.md) definition or to an
   explicitly planned KPI in
   [`docs/dashboard/KPI_EXTENSION_PLAN.md`](../dashboard/KPI_EXTENSION_PLAN.md).
4. Every aggregate it displays can reconcile to an approved reporting view, and the reconciliation totals
   travel with the export.
5. It does **not** claim to validate Power BI.
6. It does **not** close Gate 2, and may not be cited as Gate 2 evidence.
7. It does **not** replace the Power BI report.
8. It does **not** query `raw`, `staging`, `warehouse`, or `audit` schemas — directly or transitively.
9. It exposes **no database credential**.
10. It requires **no browser connection to PostgreSQL**, and no runtime connection from the deployed site
    at all: the export runs at build/publish time as `arpi_reporter` against `reporting` only.
11. It does **not** present itself as a production DMS, CRM, accounting system, or F&I menu system.
12. It remains **visibly labeled as a synthetic, fictional demonstration** on every dashboard route, in
    the page body, per the ADR-0009 C4 pattern.
13. It reuses the **existing portfolio design system** — tokens, typography, spacing, radius, motion,
    focus treatment, status vocabulary, control primitives — with no second visual system.
14. It carries **measurable accessibility, performance, privacy, and integrity requirements**, specified
    in [`docs/dashboard/TEST_STRATEGY.md`](../dashboard/TEST_STRATEGY.md) and enforced in CI as the
    increments land.
15. It derives **all** public data from a reproducible export process — deterministic, manifest-carrying,
    hash-recorded — specified in [`docs/dashboard/DATA_CONTRACT.md`](../dashboard/DATA_CONTRACT.md).

### Why this is not "a second complete dashboard"

The §6 exclusion was written against a specific failure mode: a duplicate analytics implementation that
recomputes the KPIs, forks their definitions, and competes with the Power BI deliverable for analytical
authority. The operating console is structured so that it cannot become that:

- **Power BI is the canonical BI artifact.** The console's trust panel states Power BI's actual
  validation status and links to it; it never claims parity with, or substitution for, the report.
- **PostgreSQL reporting views own every reusable SQL calculation.** The console adds no calculation
  layer over the warehouse; new analytical needs become new governed reporting views first.
- **The web console is the public interactive demonstration layer.** It renders exported, reconciled
  figures; it is a consumer at the end of the lineage, not a peer engine beside it.
- **It consumes approved exports rather than creating a competing semantic layer.** The export files are
  the only data it can see, and the exporter reads only approved `reporting` views.
- **Shared KPI definitions and cross-layer reconciliation tests prevent drift.** UI totals must equal
  export totals, export totals must equal reporting-view totals, and reporting-view totals must equal
  independent warehouse derivations — the same discipline the 29 existing KPIs already carry.

What remains excluded, permanently: a web application that computes KPIs from its own formulas, an API
over warehouse tables, a browser database connection, or any presentation of the console as the
project's BI deliverable. The §6 exclusion continues to bar *that*; this record narrows its reading the
same way §6 already narrows the Fabric exclusion, and amends [ARCHITECTURE.md §6](../../ARCHITECTURE.md)
with a qualifying note to that effect.

### What this record supersedes, amends, and leaves alone

| Standing rule | Effect of this record |
|---|---|
| ARCHITECTURE.md §6 — "A second complete dashboard in React or Next.js" is excluded | **Qualified, not removed.** A recomputing, definition-forking duplicate remains excluded. A governed console meeting the fifteen conditions is permitted. §6 gains a note recording the distinction. |
| ADR-0009 §4 / §26.3 — no charting library, no KPI value, no runtime data source | **Superseded in scope, for the `/dashboard` route family only.** The console may render KPI values from versioned exports and may add visualization capability under the evaluation rules of the dashboard program (bundle-measured, accessibility-proven, no automatic library adoption). The documentation routes (`/`, `/status`, `/kpis`, `/architecture`, `/data-model`, `/governance`, `/case-study`) keep ADR-0009's controls unchanged, including C5. |
| ADR-0009 C1 — case-study lock | **Untouched.** `/case-study` stays locked by Gate 2's evidence rules. The console is not the case study and must not link to it as if it were open. |
| ADR-0009 C4 — synthetic disclosure in the body of every primary route | **Extended** to every `/dashboard` route. |
| Gate 2 | **Unchanged and CLOSED.** The console publishes figures and deterministic rule outputs, never findings, recommendations, or conclusions. Executive findings remain gated. |
| ADR-0008 real-engine validation | **Untouched and still pending.** The console must not be described as validating the semantic model, and rendering a number in HTML proves nothing about a DAX measure. |
| Deferred-fact rule (ADR-0009 §2) | **Modified in one respect:** the dashboard program may *promote* Deferred entities (F&I, targets, and the new accounting entities) through Gate 4 with full grain, KPI, and testing definitions — that is what promotion is for. Displaying a result that requires a Deferred fact **before its promotion increment lands** remains prohibited. |

### The management-action and driver-analysis boundary

The console's Management Action Center and "Why did this change?" surfaces are deterministic,
threshold-parameterized rule outputs with documented formulas and evidence fields. They are **not**
executive findings, not analytical conclusions, and not causal claims, and every threshold is a labeled
**project default**, never an industry benchmark. Action language is limited to review verbs — review,
investigate, validate, reconcile, compare, confirm — and the console records no assignment, completion,
or resolution state, because it has no write-back and must not simulate one. If a future finding ever
draws on console-surfaced patterns, that finding is Gate 2 work and lives in `docs/findings/`.

## Alternatives considered

### A. Runtime browser access to PostgreSQL

Rejected. Violates [ARCHITECTURE.md §22](../../ARCHITECTURE.md) and §26.3, would expose or proxy a
credential, and turns a portfolio site into an attack surface against the only database the project has.
No presentation benefit justifies it.

### B. A public API over warehouse tables

Rejected. An API layer is excluded by §6 until Gate 3, would create a second query surface with its own
security, versioning, and abuse burden, and would invert the lineage: consumers should sit downstream of
the reporting contract, not beside the warehouse.

### C. Recreating all DAX in TypeScript

Rejected. Two implementations of 49+ measures cannot be kept honest; every divergence would be a silent
KPI fork. The console displays what SQL computed and exported; TypeScript formats, filters, and lays out,
but does not own KPI arithmetic beyond exact-decimal display composition governed by shared contracts.

### D. Embedding Power BI without reliable public licensing

Rejected. "Publish to web" and embedded licensing are unreliable for a public portfolio, would put the
canonical artifact behind a third party's licensing posture, and would still not demonstrate frontend
engineering. [ARCHITECTURE.md §26.2](../../ARCHITECTURE.md) already requires the project to remain
reviewable without Power BI Service access.

### E. Committing a binary dashboard artifact

Rejected. A `.pbix` or recorded binary is unreviewable in diff, goes stale silently, and contradicts
[ADR-0007](ADR-0007-power-bi-project-format.md)'s source-first storage decision.

### F. Adding a third-party generic dashboard template

Rejected. A template dashboard is the exact "generic SaaS analytics" failure the product definition
prohibits, would import a second visual system in violation of the design-system rules, and would
demonstrate assembly rather than judgment.

### G. Building the entire product as one large client component

Rejected. It would ship every dataset to every visitor, break the server-component performance posture
the portfolio already documents, and make no-JavaScript and accessibility guarantees unreachable.

### H. Treating static screenshots as sufficient interaction

Rejected. Screenshots cannot demonstrate filter contracts, drill-through, reconciliation surfaces, or
accessibility, and the project already has a documentation site; a second gallery of images adds no
operating evidence.

### I. Replacing Power BI with Next.js

Rejected outright. Power BI is the canonical BI artifact and the project's BI hiring evidence. The
console is a demonstration layer beside it, and condition 7 exists precisely so this alternative can
never happen by increments.

## Consequences

### Positive

- The analytical work becomes *operable* by a reviewer, not only readable: filters, drill-through to a
  sanitized Deal Jacket, reconciliation status, and KPI lineage on every number.
- The Deferred F&I, target, and new accounting domains get a concrete consumer, which forces their
  grains, eligibility rules, and reconciliation identities to be settled properly through Gate 4.
- KPI governance gets a second enforcement point: the export pipeline fails when a displayed number
  cannot be traced to an approved view.
- The frontend competence claim strengthens without weakening the BI claim, because the boundary between
  them is written down and tested.

### Negative

- **The misreading risk increases.** A working console showing dealership figures will be read as real
  results by some viewers regardless of labeling. Mitigated by condition 12, the trust panel, and
  synthetic disclosure in every route body — but the risk is not zero, and this record accepts it.
- **Scope grows materially.** The program adds warehouse entities, generators, exports, routes, and
  tests across fourteen delivery increments. Sequencing discipline (one increment per pull request,
  every increment leaving the repository green) is the mitigation, and
  [`DASHBOARD_BACKLOG.md`](../requirements/DASHBOARD_BACKLOG.md) is the instrument.
- **Two presentation surfaces must now be kept from drifting.** The KPI catalog, the extension plan, and
  cross-layer reconciliation tests are the mitigation; drift between console and Power BI numbers is a
  build failure once both exist, not a footnote.
- **ADR-0009's crisp "no KPI value anywhere" rule becomes a scoped rule**, which is harder to police than
  an absolute one. The scope boundary (documentation routes versus `/dashboard`) is mechanical and
  testable, which is why it is drawn at the route family.

### Neutral

- Gate 2's wording, verdict, and evidence requirements are unchanged.
- The Power BI report remains unbuilt until `P2.1-09` passes on an accepted path; this record neither
  hastens nor delays it.
- The Excel operating report and the sanitized public listing lane are unaffected.

## Compliance

Enforcement is delivered incrementally by the dashboard program's own backlog items, and no console
route may ship before the control that governs it:

- **Export allowlist and prohibited-column scan** — the exporter reads only approved `reporting` views as
  `arpi_reporter`, rejects prohibited fields, and fails on schema drift
  ([`docs/dashboard/DATA_CONTRACT.md`](../dashboard/DATA_CONTRACT.md); delivered with `DASH.1`).
- **Manifest-first trust surface** — dataset version, source views, query hashes, row counts,
  reconciliation totals, and privacy-scan status travel with every export and render in the console's
  trust panel (`DASH.1`, `DASH.2`).
- **No-schema-reference test** — frontend source may not reference `raw`, `staging`, `warehouse`, or
  `audit` (`DASH.1`).
- **Synthetic disclosure test** — every `/dashboard` route renders the synthetic statement in the page
  body, asserted end-to-end (`DASH.2`).
- **Cross-layer reconciliation tests** — UI totals = export totals = reporting-view totals = warehouse
  derivations ([`docs/dashboard/TEST_STRATEGY.md`](../dashboard/TEST_STRATEGY.md); `DASH.1` onward).
- **Power BI status honesty** — the trust panel renders the real ADR-0008 validation state from the same
  evidence files `scripts/check_project_capabilities.py` already guards; a claim that the console
  validates Power BI is a build failure, not a review comment.
- **Existing guards continue to run** — `scripts/check_naming.py`, `scripts/check_secrets.py`,
  `scripts/check_docs_links.py`, `scripts/check_project_capabilities.py`, and the portfolio
  content-integrity suites remain binding over the new surface.

## References

- [ARCHITECTURE.md](../../ARCHITECTURE.md) §6 (non-goals), §18 (KPI ownership), §22 (security), §26.3
  (website deployment), §28 (scope gates), §35.2 (decisions requiring an ADR — "Adding a second user
  interface")
- [ADR-0007](ADR-0007-power-bi-project-format.md) — Power BI storage format
- [ADR-0008](ADR-0008-real-engine-validation-paths.md) — real-engine validation paths, both pending
- [ADR-0009](ADR-0009-portfolio-ui-foundation-before-gate-2.md) — the portfolio UI foundation and the
  controls this record scopes
- [`docs/requirements/DASHBOARD_PROGRAM.md`](../requirements/DASHBOARD_PROGRAM.md) — the program this
  record authorizes
- [`docs/requirements/DASHBOARD_BACKLOG.md`](../requirements/DASHBOARD_BACKLOG.md) — the delivery
  increments and their acceptance criteria
- [`docs/dashboard/`](../dashboard/) — the program's specification set
