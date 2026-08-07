# Test Strategy — ARPI Dealer Operations Command Center

**Status:** Planning contract; each layer lands with its owning increment and is named in that
increment's backlog item.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) · repository conventions
(`pyproject.toml` pytest config; `portfolio/vitest.config.ts`; `portfolio/playwright.config.ts`)

The standing rule inherited from the reconciliation register applies everywhere: **a check that has
never been seen to fail is not evidence.** Every reconciliation and every rendering guard gets a
deliberately corrupted fixture that proves it can fail.

---

## 1. Python (pytest, `tests/unit` + `tests/data_quality`)

- New generators (targets, F&I dims/facts, adjustments, accounting snapshot, GL balances): column
  contracts via `GeneratedDataset.schema_matches`, namespace-seeded determinism (double-generate,
  frame-equal), edge-case coverage per program §9 (negative front gross, zero back gross, cash,
  lease, multi-product deal, eligible-no-product deal, cancellation, chargeback, later-period
  adjustment, no-trade, allowance≠ACV, used-without-MSRP, write-down unit, controlled GL variance,
  deal without lead).
- Exact `Decimal` identities: `original_product_gross`, book-value identity, back-gross rollup —
  asserted to the cent through the shared `money()` helper; no float in any monetary path.
- Eligibility: every generated product row passes its `ELIG-*` rule; an injected ineligible row is
  rejected by `DQ-FPS-*`.
- Adjustment timing: adjustments strictly after sale; cap at original gross; distribution bounds.
- Prohibited patterns asserted absent: perfect correlations (spot-check tolerances), identical
  employee results, penetration above eligible count, negative product cost, PII columns (privacy
  tripwire over every new column tuple).
- Registry coverage: new `DQ-*` prefixes registered; `ensure_registry_coverage` picks up every new
  check; check-id pattern conformance.

## 2. SQL / PostgreSQL integration (pytest `-m integration`)

- Declared grain = enforced constraint for every new table (the `test_gate1_readiness.py` pattern
  extended); PK/UNIQUE/FK/CHECK presence by name; load counts; idempotent re-run safety.
- Migrations: checksummed, guarded, recorded (`test_migrations.py` extension for the
  `finance_reserve_gross`/`lender_key` migration and each additive assertion migration).
- Reconciliations: new `RECON-*` entries evaluated and persisted; each observed failing on a
  corrupted fixture; tolerance vocabulary stays exactly {0, 0.01}.
- KPI verification: every promoted KPI resolves to its owning view and equals an independent
  warehouse derivation; empty denominators return NULL (extends
  `tests/integration/test_kpi_verification.py`).
- Reporter role: `arpi_reporter` can read every new reporting view and still has no privilege on
  `raw`/`staging`/`warehouse`/`audit` (extends `test_security_roles.py`).
- Bridge views: components sum exactly to the total on every row.

## 3. Export generation (`tests/unit/test_export_dashboard_dataset.py` + integration)

Allowlist enforcement (a non-listed view is unreadable even if present); stable ordering;
byte-determinism (double export, byte-equal); manifest completeness (versions, hashes, row counts,
query hashes, run identity, reconciliation totals, privacy status); staleness refusal (failed run,
failing reconciliations, drifted schema); prohibited-column refusal; decimal string serialization;
file-size ceilings with measured values in failures; chunk indexes complete, no missing or duplicate
chunk keys, no duplicate natural identifiers.

### 3.1 As-built at `DASH.1`

**Delivered: 135 Python unit tests, 43 PostgreSQL integration tests, 96 TypeScript tests.**

`tests/unit/test_export_dashboard_dataset.py` runs without a database, against a double that answers
exactly the statements the exporter issues and raises on any statement it does not model — so a new
query cannot be silently unexercised. It covers: contract self-consistency (no surrogate key
exported, every business and sort key declared, every reconciliation total additive); allowlist
enforcement for all four prohibited schemas and for an unlisted `reporting` view; query hashing
(reindentation-stable, CRLF-stable, sensitive to a column or sort change, comment markers refused);
exact money across ten cases including zero, negative, cent precision and eight figures, with a
`float` refused outright and a third decimal place treated as schema drift rather than a rounding
opportunity; null semantics including the assertion that every ratio over a possibly-empty
denominator is declared nullable; enumerations; canonical serialisation; determinism over a double
export; dataset-version monotonicity; the whole manifest; the reporter-role entry and both of its
failure modes; refusal on a failed run, failing reconciliations and critical validation failures;
five schema-drift modes; both row identities; the privacy tripwire over twenty-one prohibited
spellings; the no-secrets scan over produced bytes; measured size ceilings; and seventeen distinct
check-mode failures.

`tests/integration/test_dashboard_export.py` adds what a double cannot: every allowlisted view
exists, declares its grain in a `COMMENT`, and is unique at the grain the contract claims (checked on
the *source* surrogate columns via `arpi.dashboard.contract.source_grain_columns`, so a duplicate is
attributed to the view rather than to the exporter); `arpi_reporter` can run every generated query
and holds no privilege on any object in `raw`, `staging`, `warehouse` or `audit` (swept over
`pg_class`, with a guard test proving the sweep is looking at real objects, plus one deny-path read
per schema); **every exported cell equals the value the view produced**; the group totals equal
independent SQL derivations from the row-grain fact views; empty denominators stay null through the
chain; and a one-cent mutation is caught three ways — by the file hash, by reconciliation after the
hash is restamped, and by comparison against the database.

`tests/integration/test_dashboard_export.py::test_export_totals_match_reporting` exists at module
level, under exactly the node id `DASH.1-03` names.

### 3.2 A guard drawn where the risk is, not where the words were

`DASH.1-03` asks for a portfolio test that fails if any file under `portfolio/src` references
`raw.`, `staging.`, `warehouse.` or `audit.`. Taken literally that criterion cannot be satisfied by
this repository and never could have been: `/data-model` and `/kpis` exist to explain the data model,
and `src/lib/content.ts` names `warehouse.fact_vehicle_sale` because that is the table it is
describing. `src/content/architecture.ts` names `ARPI_DATABASE__` and `PGPASSWORD` in the sentence
explaining where configuration comes from. A guard that fired on those files would be removed within
a week, which is worse than one drawn correctly.

As built, `portfolio/tests/unit/dashboard-boundaries.test.ts`:

- enforces the schema rule over the whole tree except three named prose files, matching a
  schema-qualified ARPI object (`warehouse.fact_vehicle_sale`) rather than ordinary member access on
  a variable called `raw` (`raw.trim()` is not a query, and a guard that says it is teaches people to
  ignore it);
- separately asserts each exempted file constructs no query, imports no client and carries no
  connection string;
- applies the **literal** substring rule, with no exemption, to the dashboard lane's own files;
- asserts no credential value is assigned or read anywhere, including in the exempted files;
- asserts no database dependency is declared, so a connection is impossible rather than merely
  absent;
- asserts no `/dashboard` route, no dashboard component directory, no navigation entry and no API
  route exists;
- asserts nothing in `src` imports the generated dashboard data yet — matching an import statement
  rather than a mention, so the test does not fire on its own documentation — and that if anything
  ever does, it is not a client module;
- asserts no `any` type, and no type assertion onto external JSON, in the dashboard contract;
- scans every generated file for connection detail, internal schema references, absolute paths,
  email addresses, URLs, VIN-shaped tokens and prohibited field names. A bare `5432` is deliberately
  **not** on that list: it is an ordinary inventory investment figure, and a privacy guard that fails
  on correct data is a privacy guard somebody deletes.

`portfolio/tests/unit/dashboard-data.test.ts` covers the committed artefacts and the failure modes:
schema and contract version, hashes, row counts, closed file set, exact currency shape on every
monetary column, the front + back = total identity on every gross row, order statistics as numbers,
reconciliation re-derived by exact `bigint` arithmetic over the committed rows, the columnar
re-encoding preserving every value, chunk integrity and size, and eighteen corrupted-export cases
each driven through the real generator in a sandbox and each observed failing.

## 4. TypeScript unit (vitest, `portfolio/tests/unit/`)

Filter parsing/serialization round-trips; invalid-filter fallback with notice flag; currency,
percentage, and date formatting against the exact-decimal contract; period and comparison
resolution; driver-narrative templates (wording, non-causal, reconciliation of displayed parts);
KPI display contracts (id, unit, definition link present); empty/NA state selection; deal
calculation re-verification helpers; manifest status derivation (stale, reconciliation-failed,
Power BI pending vs passed); dashboard data generator (schema validation, chunk integrity,
determinism, size report); boundary guard (no `raw.`/`staging.`/`warehouse.`/`audit.` reference in
`portfolio/src`).

## 5. React component tests (vitest + testing-library)

Accessible names and labels on cards, tables, filters, and charts' table alternatives; correct
values from fixture exports (equality, not snapshots, for numbers); filter-change wiring;
drill-through hrefs; KPI definition disclosure content; Deal Jacket sections incl. every
not-applicable state; responsive alternate presentation (single accessibility-tree representation);
reconciliation status chips; action evidence rendering and threshold disclosure.

## 6. End-to-end (Playwright, production build, extending `tests/e2e/`)

- Every dashboard route in `routes.ts` (mirrored list), with expected `h1`.
- Deep links with filters; browser back/forward; reset; copied-URL equivalence.
- Mobile navigation (drawer + internal nav) without horizontal overflow.
- Viewport matrix: **320, 375, 390, 768, 1024, 1280, 1440, 1920** (390 added to the shared
  `VIEWPORTS` list in `DASH.13-01`).
- 200% zoom reflow; no horizontal page scrollability (the established `scrollTo` probe).
- Keyboard-only journey: filter → scoreboard → deal index → Deal Jacket → lineage drawer.
- Reduced motion: end states rendered, values never withheld.
- No-JavaScript: full content, degraded filter forms, table alternatives (extends the existing
  no-JS describe).
- Accessibility scan: axe (`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`) on every dashboard route
  at 375 and 1440 — **no suppressed rules**; failures block.
- Responsive deal tables: exactly one representation exposed.
- Deal Jacket print mode (emulated media) include/exclude assertions.
- Failure states: invalid deal id → 404; missing dataset → build refuses (asserted in the generator
  test, not e2e); stale dataset → warning banner (fixture-forced); empty filter result → EmptyState;
  reconciliation-failure fixture → banner on every route.
- Synthetic disclosure on every route body; Power BI pending disclosure in the trust panel while the
  evidence files say pending.

### 6.1 As-built at `DASH.2`

The console suites are `portfolio/tests/e2e/dashboard.spec.ts` (81 assertions with
`dashboard-filters.spec.ts`) and the three unit suites named in the backlog. Three things differ from
the plan above and each is a scope decision rather than a shortfall:

- **The viewport matrix is dashboard-local.** 320/375/**390**/768/1024/1280/1440/1920 live in
  `DASHBOARD_VIEWPORTS` in `tests/e2e/routes.ts`. `DASH.13-01` still owns adding 390 to the shared
  `VIEWPORTS` list, which would change the runtime of every existing responsive test; the console
  needs the width now, because its scoreboard decides between presentations between 375 and 430.
- **The axe sweep covers the console through the existing route sweep**, which iterates
  `routes.ts` and therefore picked up `/dashboard` when it was mirrored there. No suppressed rules.
- **Two ADR-0009 C5 assertions are scoped rather than weakened.** ADR-0013 supersedes ADR-0009 §4 "for
  the `/dashboard` route family only", so the "no gross figure" and "no currency figure" rules in
  `content-integrity.spec.ts` name `/dashboard` in an explicit exemption list. The documentation
  routes keep C5 unchanged, and the console gets a stronger rule in its place: every figure it renders
  must reconcile to the export exactly, proved selector by selector in
  `dashboard-executive.test.tsx`.

## 7. Cross-layer reconciliation (the chain that makes the console honest)

Asserted at the narrowest layer that can observe each equality:

1. UI executive totals = generated page payload totals (component tests). **Live at `DASH.2`:**
   there is no generated page payload, so the link is proved one step earlier and more strictly —
   `dashboard-executive.test.tsx` evaluates every selector that declares a `reconciliationKey` over the
   whole reporting window at group scope and compares the result to the manifest's published figure
   **character for character**, dividing the published numerator by the published denominator for a
   ratio rather than reading a quotient the export deliberately does not publish.
2. Generated payload totals = root export totals (generator unit tests). **Live at `DASH.1`:**
   `dashboard-data.test.ts` re-derives every manifest total by exact `bigint` summation over the
   committed rows, and asserts the columnar re-encoding preserved every value.
3. Root export totals = reporting-view totals (Python integration). **Live at `DASH.1`:**
   `test_export_totals_match_reporting`, plus per-cell equality across every dataset.
4. Reporting-view totals = independent warehouse derivations (existing KPI verification).
   **Already live**, and `DASH.1` adds a second independent path: the gross, unit, funnel,
   appointment and marketing totals are re-derived from the row-grain fact views
   (`vw_vehicle_sales`, `vw_leads`, `vw_appointments`, `vw_marketing_spend`) rather than from the
   aggregates the export read, so agreement is evidence rather than tautology.
5. Front gross and total gross reconcile on every exported deal (export test + jacket check).
6. Back gross = reserve + net product gross + 0.00 on every deal (`DASH.6`+).
7. Product net gross = original − adjustments on every contract.
8. Inventory subledger = Σ book value per store/account/date; displayed GL variance = control −
   subledger (`DASH.8`+).
9. KPI filters preserve documented denominators (fixture: filtered penetration keeps eligible-deal
   denominator scope).

## 8. Bundle, payload, and performance

`report-bundle.ts` extended to all dashboard routes; measured baselines recorded in `DASH.2-04`;
budget assertions added in `DASH.13-02` **from measurements, not invented numbers** — initial
regression guards: no dashboard route's compressed route-alone JS may exceed the recorded baseline
by more than a documented allowance, `/dashboard` ships zero deal-level records (asserted by
payload inspection), chunk-size ceilings from the data contract. Build duration and standalone
runtime contents tracked via the existing `railway-config.test.ts` pattern (no tests/docs/scripts in
the image; chunk files traced when server-read).

## 9. Data staleness, privacy, security

Staleness: covered in §3/§6. Privacy: export-header tripwire tests; a grep-based guard that no
export or generated file contains a prohibited column name; no customer-grain dataset exists
(schema-level assertion). Security: `scripts/check_secrets.py` unchanged over the new artifacts;
no connection detail in any generated file (asserted); frontend boundary guard (§4); CSP-relevant
headers unchanged (existing header tests).

## 10. Visual integrity

Design-system conformance rides the existing enforcement: token tests (no raw values), banned
vocabulary, disclosure-label rules, status-badge accessible names — all automatically cover the new
routes because they operate on source and on every registered route. `DASH.13-01` adds the
dashboard routes to the adversarial screenshot sweep (`review:screenshots`), reviewed by a person
per the established VISUAL_REVIEW.md process; no committed baseline images.

## 11. Power BI alignment

**`DASH.2` changed no TMDL, no `powerbi/` file and no validation evidence either.** The trust panel it
adds derives its state from `powerbi/validation/*_validation_results.json` through the project
manifest; `dashboard-trust.test.ts` drives that derivation with pending, stale, failed and passed
**fixtures**, reads the committed evidence files to assert both accepted paths still say `pending`,
and asserts structurally that the dashboard export manifest carries no Power BI key and that nothing
assigns the derived `validated` flag a literal.

**`DASH.1` changed no TMDL, no `powerbi/` file and no validation evidence.** The client-safe manifest
carries no Power BI field at all, so the export lane cannot become a second place a "validated" claim
is written; the trust panel that merges the real ADR-0008 state is `DASH.2-04`'s. Both real-engine
validation paths remain pending and Gate 2 remains CLOSED.

No TMDL change in this program's increments ships without: `scripts/check_powerbi_model.py` green
against updated `model_documentation`; the source-hash staleness consequence stated in the PR; and
`check_real_engine_validation.py` still truthful. A test asserts the console's trust panel derives
Power BI state only from `powerbi/validation/*.json` (never a hardcoded "validated"). SQL-to-DAX
reconciliation extensions (new measures ↔ new baseline contexts) are specified in the future
Power BI increment, not silently assumed by this program.
