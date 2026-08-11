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

- New generators (**targets — delivered, see §10.3**; **F&I dims/facts and adjustments — delivered by `DASH.6`**; accounting snapshot,
  GL balances): column
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
6. Back gross = reserve + **original** product gross + `other_fi_income` (exactly `0.00`) on every deal
   — **delivered by `DASH.6`** as `RECON-FI-001`, exact (tolerance `0`) and **per deal**, not on a group
   total. It is the **deal-date** basis deliberately: net product gross would make the identity fail
   every time a cancellation posted, because `back_end_gross` is never rewritten. The as-of side is
   reconciled separately by `RECON-FI-NET-GROSS`.
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

## 10.1 As-built: what `DASH.3` added

| Suite | File | What it proves |
|---|---|---|
| SQL integration | `tests/integration/test_dashboard_reporting_views.py` (52 tests) | Grain, documentation and reporter access on all three views; the trend view agrees with `vw_sales_summary` and `vw_gross_summary` on every store-day; the bridge reconciles **exactly**; the explorer is one row per sale with no fan-out and no prohibited column |
| Seeded defect | same file | Adding one cent to a single bridge component breaks the reconciliation. Without it an identity test that had become vacuous would look exactly like a passing one |
| TypeScript unit | `dashboard-sales-gross.test.tsx` (27) | Every rendered figure reconciles to the export manifest's own published totals, character for character; a rate is recomputed rather than averaged, asserted by showing the two differ; the condition split adds back to the retail total |
| TypeScript unit | `dashboard-deals.test.tsx` (29) | Every deal is visited exactly once across all pages **under every sort key and direction** — the assertion that catches a non-total order; search determinism; parameter parsing; the privacy boundary, checked against the shipped chunk rather than the view model |
| Component | `dashboard-visuals.test.tsx` (15) | Every value a bar encodes is also text; the data table is in the document while the disclosure is closed; direction is a glyph and a sign, never colour alone; the primitives ship no client JavaScript |
| End to end | `dashboard-sales-gross.spec.ts` (27) | The figures reach the screen; the bridge's copy stays non-causal in the rendered document; charts keep their data without JavaScript; a filter the route cannot apply says so |
| End to end | `dashboard-deals.spec.ts` (35) | Sorting and paging are real links that work with scripting disabled; browser history is the undo stack; exactly one responsive representation is in the accessibility tree; every row links to a Deal Jacket that resolves (through `DASH.3` this assertion was its opposite — that no row linked to a route that did not exist yet — and `DASH.4` re-aims it in the diff that makes the destination real) |

Two assertions were deliberately made narrower than first written, and the reason is recorded in
both files. A page-wide scan for causal words flagged "because the export publishes both", ordinary
prose about the data model, so the check is scoped to the bridge section. A page-wide scan for
customer fields flagged the synthetic lead source "Customer Referral", so the check became
structural: no column NAMES a customer attribute, and no cell holds a value shaped like an email,
a telephone number or a street address. Both are stronger than what they replaced; a check that
cries wolf teaches the next reader to silence it.

## 10.2 As-built: what `DASH.4` added

| Suite | File | What it proves |
|---|---|---|
| SQL integration | `tests/integration/test_deal_jacket_reporting_view.py` (34) | One row per finalized sale across **seven** joins, with the two that could widen the grain — the linked lead and the linked appointment — asserted directly rather than assumed; both arithmetic identities on every deal; `finance_structure` is exactly its documented derivation and its published basis agrees; no prohibited column, no `*_name` column but the two that name a thing, every staff code a synthetic `EMP-` identifier, every synthetic VIN in its ADR-0005 shape |
| Seeded defect | same file | Two: a one-cent mutation of the front gross, and of the total gross. Each must break the identity the file asserts. An identity test that had become vacuous — zero rows, or a value compared with itself — looks exactly like a passing one |
| Seeded defect | same file | Folding trade variance into the front-gross formula must break the identity on every deal that has one. If it did not, publishing the variance separately would be decorative rather than load-bearing |
| TypeScript unit | `dashboard-deal-jacket.test.tsx` (43) | Both identities recomputed on all 650 deals from the components the page displays; the seven deal shapes of `DEAL_JACKET_SPEC.md §19`, each selected by predicate over the population so a shape that stops existing fails loudly; malformed and unknown ids resolve to nothing; the four absence words are distinct and a real zero survives as a zero; a value-level privacy scan over every string in every jacket |
| Corrupted fixture | same file | The view model is rebuilt against a partition whose first deal is one cent off. The verification must report the failure in words with both figures, the checklist must raise it for review, and the page must still show the figures as exported. Without this, a `verify()` that returned `true` unconditionally would pass every other test in the file |
| End to end | `dashboard-deal-jacket.spec.ts` (31) | The route 200s for a deal and 404s for both an unknown and a malformed id; the disclosure is above the money; the money keeps formula order at 390px and 1440px; the page is complete with scripting disabled; nothing on it is a control that acts on the deal; the **paper recap** carries the transaction and drops the navigation, asserted under `media: 'print'` |
| Boundary | `dashboard-boundaries.test.ts` (+2) | `jacket-chunks.ts` has exactly one importer, and neither the Deal Explorer nor the Executive Overview reaches it; every `data-arpi-print` attribute sits on a lowercase intrinsic element |

**Two of these tests caught real defects rather than confirming intent**, which is the only reason
worth writing them:

- The print assertions failed on the first run. `data-arpi-print="omit"` had been passed to the
  `<Section>` primitive, which takes a declared prop list and does not spread the rest, so the
  attribute compiled, rendered nothing, and the paper recap printed its navigation. The fix moved it
  to a plain element and added the boundary test above, so the next one fails at build time instead
  of in a browser.
- The navigation assertion failed too. `DASHBOARD_NAV` carried a `matches` entry of
  `'/dashboard/deals/'` intending to cover the Jacket, but `matches` is an exact-membership test and
  no path is ever equal to that string — the comment described behaviour the code did not have.
  `NavItem` now has an explicit `matchPrefixes`, each required to end in `/` so it cannot become the
  blanket prefix rule `matches` exists to avoid.

## 10.3 As-built: what `DASH.5` added

| Suite | File | What it proves |
|---|---|---|
| Generator unit | `tests/unit/test_sales_target_generation.py` (28) | Byte-identical output on the same seed; store and month differentiation; every value an exact `Decimal` at cent scale with no float anywhere; the scope vocabulary and the scope-to-metric rule; the department gross targets partitioning the store gross target to the cent; the stretch rule; stable ordering |
| **No-leakage guard** | same file | Two, and they are the reason the domain is credible. One walks the generator's import graph with `ast` — direct imports and one level transitive — and asserts no path reaches the sale generator or the sale fact. The other sets `sys.modules['arpi.generation.sale'] = None` and asserts the plan is unchanged. **A target derived from the month it targets makes every attainment ratio a tautology**, and a convention nobody tests is not a guarantee |
| SQL integration | `tests/integration/test_target_ingestion.py` (33) | The objects exist with `numeric(14,2)` money; the grain constraint is over the five columns it claims and every one is `NOT NULL`; the foreign keys resolve; the row-count chain holds from raw through staging to the fact; seven staging rejection cases each reject for their own stated reason; a duplicate natural key is refused; **reloading writes nothing and a revised plan replaces rather than appends**; `arpi_reporter` reads the view and nothing beneath it; the view does not fan out; a store-month with no plan still appears in the frame |
| KPI verification | `tests/integration/test_kpi_verification.py` (+22) | Every `KPI-TGT-001..010` recomputed from `fact_sales_target`, `fact_vehicle_sale` and `dim_date` independently of the view — never the view against itself. Store totals read store-scope rows only; the department split equals front and back gross; a missing plan is NULL and a zero target is NULL, neither is zero; selling days come from `dim_date` and the as-of date is not `current_date`; a completed month's projection equals its actual; zero elapsed selling days yields NULL pace, not a division |
| **Wrong-method guard** | same file | Group attainment computed as `SUM(numerator) / SUM(denominator)` is asserted to **differ** from `avg()` of the store percentages on the committed dataset. If the two ever agreed the test would be vacuous, so it asserts the disagreement rather than the result |
| **Subset alignment** | same file | One store's target is deleted inside a transaction. The group ratio must drop that store from **both** sides — an actual admitted into a numerator whose denominator excludes its target is the classic way a plan-attainment figure becomes quietly wrong |
| Seeded defect | same file | Two: one target moved by `$1.00`, and one selling day removed by setting `is_closure_holiday` (the calendar's `is_selling_day = NOT is_closure_holiday` rule makes any other mutation illegal). Each must break the assertion that claims to detect it |
| Reconciliation | `tests/integration/test_reconciliations.py` (+3 data, +7 view) | Three corruptions — a deleted fact row, a duplicated grain after dropping the constraint, and a department split moved by `$1.00` — each must be caught by the reconciliation that claims to catch it |
| Export | `tests/integration/test_dashboard_export.py` | The `target-attainment` dataset against the database, with the reconciliation **subsets** (scope and KPI filters) applied on both sides, so a total that is right only because it summed the wrong rows cannot pass |
| TypeScript unit | `portfolio/tests/unit/dashboard-targets.test.ts` (36) | Dataset shape and exact decimal strings; **no quotient is exported**, only numerators and denominators; the manifest reconciliation reproduced from the dataset; the group rule against the average-of-percentages result; every state — missing target, zero target, zero selling days, completed month; the comparability layer's three verdicts and seven causes; and source scans proving no hardcoded target, no "forecast" claim, and no verdict vocabulary in the components |
| End to end | `dashboard.spec.ts` (+13), `dashboard-sales-gross.spec.ts` (+9) | The target values render and change with the store and period filters; the exact phrase **"Selling-day pace projection"** appears wherever a projection does; the word *forecast* appears nowhere; the incomparable-filter state renders; the whole section survives with scripting disabled; axe-clean; no horizontal overflow from 320px to 1920px |
| Boundary | `dashboard-boundaries.test.ts` | `target-attainment.json` has exactly **one** importer; no component does exact arithmetic — the magnitude and direction of a projection-versus-target comparison are split in the view model, so the component only formats |

**One of these caught a real defect rather than confirming intent.** The first `PaceBar` build put the
comparison sentence together in JSX as `{value} projected` across two lines, and JSX drops the newline —
the page rendered `projectionequals`. It was invisible in unit tests, which read the element's text
content through a DOM that had already collapsed it, and visible immediately in the e2e text assertion.
The lesson is the general one: a string assembled in markup is not a string until something reads it the
way a person does.

## 10.4 As-built: what `DASH.7` added

| Suite | File | What it proves |
|---|---|---|
| Export contract | `tests/unit/test_export_dashboard_dataset.py` (+17, `TestFiContract`) | The four F&I datasets read only allowlisted reporting views; **no consumer-credit column exists anywhere in the whole contract** (fifteen tokens swept over every dataset, not only the F&I ones); penetration publishes two additive columns and **no quotient of any spelling**; the denominator is keyed by category and by governed rule; the adjustment dataset is on the adjustment basis and the production datasets are not; **no F&I dataset sorts by a performance measure**, because a default sort by a metric is a leaderboard whatever the header says; no rank or judgement column is declared; the minimum-sample floor travels as a column; the manager code is nullable, because `null` means nobody was on the desk; the back-gross identity is reconcilable **across two datasets** rather than against itself; the two penetration totals each name their subset; the Deal Jacket publishes the components and **deliberately publishes no verification flag** |
| View promotion boundary | `tests/integration/test_fi_reporting_views.py` | Re-aimed rather than deleted. Through `DASH.6` it asserted that **no** F&I view appeared in the export contract; it now asserts the exported set is **exactly those four**, in both directions, and that every declared column is one the view actually publishes — checked against `source_column`, not the exported name, so the deliberate `finance_manager_id` → `finance_manager_code` rename is not mistaken for an invention. It also asserts each dataset is a strict SUBSET: a promotion that exported every column would be a pass-through rather than a reviewed decision |
| TypeScript unit | `portfolio/tests/unit/dashboard-fi.test.tsx` (59) | Every headline figure reconciled against the manifest's own published totals, character for character; both sides of VSC and GAP penetration; the cross-dataset back-gross identity; **a different eligible denominator per category**, with the group figure asserted to DIFFER from the average of store penetrations; the distinct-deal rule visible in the data (a category with more contracts than attached deals); a store filter scoping numerator and denominator together; the three date bases kept apart; the minimum-sample floor read from the export; the manager order proved neutral; the percentage-point conversion performed once; empty states that empty both sides of a ratio rather than only the numerator |
| **Cache-key regression** | same file | The defect that produced it is in the file's own header. `decodeDataset` memoises by key, and eighteen partitions read under one key returned the first partition eighteen times — inflating numerator and denominator together, so VSC read 288/720 against a true 227/558 and rendered 40.0% instead of 40.7%. **Nothing on the page looked wrong.** Three assertions now pin it: every declared partition decodes, two partitions produce different row sets, and the partition row counts sum to the dataset row count |
| Deal Jacket | `portfolio/tests/unit/dashboard-deal-jacket.test.tsx` (43 → 59) | The itemization sums to the deal row's own rollup on all 650 deals — two datasets, one grain apart, neither derived from the other; every contract's net gross recomputed; `Cancelled` claimed only when nothing remains; every net inside `[0, original]`; a governed `ELIG-*` rule on every contract; **no product on a transaction with no consumer**, which is what makes the corrected `finance_structure` load-bearing; the back-gross identity recomputed from the DISPLAYED currency strings; and the panel driven with a broken section so the failure wording is reachable |
| End to end | `portfolio/tests/e2e/dashboard-fi.spec.ts` (36) | Complete HTML with scripting disabled, section by section; the methodology inside the document rather than behind a click; the disclosure above the money; both sides of every penetration as their own columns; the eligibility rule on every row; **no rank, benchmark, recommendation or rate field in the rendered text**; no control that pretends to act on a manager or a product; no horizontal page scroll from 320px to 1920px; every table named and every header cell scoped |
| **Negation-aware sweeps** | same file | The negative sweeps had to learn the difference between reporting a benchmark and denying one. A flat substring match flags "no figure here is an industry benchmark" and "ARPI models no APR, payment, buy rate, sell rate, rate spread, credit score or lending decision" — the disclosures written to prevent the very thing being checked — and the only way to make it pass would be to delete them. The sweep splits into sentences and flags only **affirmative** uses, and a paired test asserts the denials are present, because a page that simply never mentioned benchmarks would pass the negative and still leave 40.7% looking judged against something |

**Two real defects, each caught by the layer that could see it and by no other.**

The **penetration cache key** was caught by reconciling the selector's output against the export
manifest before any UI existed. No visual review would have found it: both sides of every ratio were
inflated by the same factor, so every percentage on the page was plausible and internally consistent.

The **double-converted percentage point** was caught by the browser suite reading what the page
actually said. The selector multiplied a proportion difference by 100 and the shared formatter
multiplied it again, so a three-and-a-half-point move rendered as `+350.9 percentage points`. Every
unit test passed: the penetration figures were correct, the reconciliation held, and only their
difference was wrong. It was visible in exactly one place — the rendered text — which is the argument
for the browser layer existing at all.

## 10.5 As-built: what `DASH.9` added

| Suite | File | What it proves |
|---|---|---|
| Export contract | `tests/unit/test_export_dashboard_dataset.py` | The four new datasets read only allowlisted reporting views; **no warehouse surrogate composite is exported** — an `entity_id` column carrying `20250930-1-2` was built, caught against the contract's own note and removed, and the drill-through rebuilt from business columns; `vehicle_id` is permitted on the unit-grain datasets only, under the `sale_id` precedent, while `vin`, `vehicle_key` and stock numbers stay prohibited; `known_limitations()` states nine substantive limitations asserted by substance rather than by pinned sentence, so the wording can improve without the guarantee weakening |
| Reconciliation | `sql/08_validation/14_recon_inventory_units.sql`, `tests/integration/test_reconciliations.py` | `RECON-INV-UNIT-RATIO` proves the two reporting views state the same `price_to_market_ratio` on every shared row, **comparing NULL as a value** — written with `<>` the null rows would compare to NULL, the filter would discard them, and the rule would silently stop checking the ~8% of units with no estimate, which is the branch most likely to be wrong. `RECON-INV-UNIT-GRAIN` proves the reportable-date narrowing neither duplicates nor drops a snapshot. Both critical, both falsifiable: the seeded corruptions are a ratio rounded to 2 places instead of 4 — the kind of edit that looks like tidying — and a `CROSS JOIN` fan-out |
| Documentation contract | `tests/unit/test_data_dictionary_columns.py` (6) | `DATA_DICTIONARY.md` section 15 is asserted against the fact's DDL **in both directions**, after it was found documenting three columns that had never existed and omitting three that did. Plus a guard test, because a parser that stops matching would otherwise compare two empty sets and pass — the failure mode §21.3 names, and the one the first version of this file's own regex walked into |
| TypeScript unit | `portfolio/tests/unit/dashboard-inventory.test.ts` (24), `dashboard-accounting.test.ts` (15) | Every seeded defect asserted to produce a **different** answer from the correct implementation: the 60-day threshold against the 120-day top bucket (5 aged units against a wrong 2); the population median against averaged subgroup medians; a null ratio sorted last in **both** directions rather than at an extreme; a total and stable comparator, so input order cannot leak into output; the missing side coalesced to zero; a period summed rather than resolved to its last comparison date |
| **Multi-store population** | `dashboard-inventory.test.ts` | The assertion that did not exist and would have caught the defect below: the population is the SUM of the store partitions, every store appears exactly once, and every unit has a distinct identity. Everything else in that file read ONE partition, which is why a bug about reading three was invisible to it |
| **Decode-cache guard** | `dashboard-inventory.test.ts`, `portfolio/src/lib/dashboard/data.ts` | `decodeDataset` now **throws** when one cache key is presented with two different files. Each generated file is a module-level object, so two partitions can never be the same reference; a silent wrong answer for the life of the process becomes a loud failure on the first render. Two tests: the collision throws, and the same file under the same key still memoises |
| End to end | `portfolio/tests/e2e/dashboard-inventory.spec.ts` (20), `dashboard-accounting.spec.ts` (18) | Complete HTML with scripting disabled, including the unit table and the drill-through panel; `?unit=` as a real URL — copyable, correct on reload and under Back and Forward, and recovering visibly from an identifier that names nothing; **no repricing vocabulary and no floorplan carrying-cost vocabulary in the rendered text**, and no general-ledger artefact on the accounting route; a missing side rendered as MISSING rather than as a zero balance; the variance direction in words; every exception drill-through resolving to a page that exists with **no surrogate composite in the href**; no horizontal page scroll at 320px or 1920px |
| **Shared negation-aware sweep** | `portfolio/tests/e2e/helpers.ts` | `affirmativeSentences` moves out of `dashboard-fi.spec.ts`, where `DASH.7` first needed it, into the shared helper — the accounting and inventory routes needed it independently and for the same reason, and a third copy was the alternative. Both new routes carry a **paired positive assertion** that the denial is present, so the sweep cannot be satisfied by silence |

**One defect reached `main`, and it is the same class `DASH.7` found.**

`DASH.7` caught a `decodeDataset` cache-key collision in the F&I lane before any UI existed, pinned it
with three assertions, and left a comment in `fi.ts` warning about it. `DASH.9` made the identical
mistake in `/dashboard/inventory` and shipped it: one memoisation key for three store partitions, so
the route rendered one store's 96 units three times and reported **288 active units** against a true
250, with every row labelled GSA-001 and a store filter for either other store returning nothing.

The lesson is not "read the comment". A comment cannot prevent a defect in a file that does not
contain it, and three assertions scoped to one dataset cannot prevent it in another. What changes the
outcome is the guard in `decodeDataset` itself, which makes the mistake impossible to make quietly —
and it fired on the unit suite's own helper the moment it was added, which is the guard working before
a human had to.

It was found by the end-to-end test that renders the table and counts what is in it. That is the
argument for the browser layer, made a second time and more expensively than the first.

## 10.6 As-built: what `DASH.10` added

Three test properties this program had not previously had to state, each forced by something the
leads and marketing surface does that no earlier route did.

**1. A contract's choice of denominator is now bound to the governed formula.**
KPI-FUN-003 shipped from `DASH.1` to `DASH.10` dividing by `leads_received` in
`src/arpi/dashboard/contract.py` and in `selectors.ts`, while `KPI_CATALOG.md` §26, the reporting
view and an integration test all said contacted leads. Every guard looked elsewhere: the KPI tests
check the VIEW, which was right; the export tests check that a total's sums match the exported
column, which they did — of the wrong column.
`test_export_reconciliation_totals_use_the_governed_denominator` closes that gap for every ratio
total at once by re-deriving each from the columns the contract declares and requiring it to equal
the rate its reporting view publishes. It is paired with a companion asserting the data
distinguishes the two candidate denominators, because a guard that cannot fail is not a guard.

**2. A seeded defect must be seeded where the defect would actually live.**
The first version of `test_a_seeded_fan_out_fails_the_rollup_rule` inserted an extra appointment
and PASSED — because both sides of that reconciliation read the same fact, so an extra row
increments both and the roll-up still agrees. A real fan-out is on the JOIN, so the test now
replaces the lead projection with one carrying a lead twice. The comment records the first version
and why it proved nothing; it is the clearest example in this repository of a corruption test that
looked convincing and tested nothing.

**3. An unexercised distinction is asserted with its cause, not skipped.**
The scheduled-date and show-date bases never separate in the committed data: `0` of `1,025` shown
appointments have a show date different from their scheduled date. Asserting they differ would fail
against correct code; asserting nothing would let a future collapse of the two columns pass. The
suite asserts the EQUALITY and states the generator fact that causes it, so a generator producing
late arrivals fails there — and a second test constructs the cross-month fixture the data cannot
provide and proves each basis lands in its own period.

The same rule covers the zero-second response: the development profile contains none, so
`test_a_zero_second_response_would_be_counted_as_responded` asserts the RULE and says in its
docstring that the case is absent rather than covered.

**Seeded defects added by `DASH.10`**, each observed failing before the guard was accepted:
averaging subgroup medians (2.4× the true median); a never-responded lead coalesced to zero
seconds; a source filter applied to a numerator only; a campaign filter applied to a marketing
numerator only; show rate over all scheduled rather than eligible appointments; the naive
`shown - sold` subtraction; averaging per-campaign cost ratios ($32.59 against $17.29); a repeated
business key on each of the three new datasets, including one whose key component is NULL; a
response band outside the governed vocabulary; a fractional lead count; two partitions decoded
under one cache key; a lead resolved twice through the appointment join; and a lead marked shown
without an appointment.

## 11. Power BI alignment


**`DASH.5` changed no TMDL, no `powerbi/` file and no validation evidence.** It recorded a new
**semantic-model gap** in `powerbi/model_documentation/` — the target fact and view exist in PostgreSQL
and no TMDL object binds them — and left Gate 2 CLOSED and both engine validations PENDING.
`scripts/check_powerbi_model.py`, `check_real_engine_validation.py` and the two freshness checks were
run and are unchanged.

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

## 10.7 As-built: what `DASH.11` added

Two model lanes and one browser lane, on the same contract as `DASH.10`: a guard is accepted only
after the defect it claims to catch has been observed failing.

| Lane | File | Covers |
|---|---|---|
| Model | `portfolio/tests/unit/dashboard-employees.test.ts` | 42 tests: sample discipline per denominator, ratio-of-sums, the four funnel denominators, the true median, the finance denominator, the non-ranking contract, store context, source mix, route mechanics |
| Export | `tests/unit/test_export_dashboard_dataset.py` | The exact `employees` allowlist by equality; personal/pay vocabulary and rank/score/target vocabulary on every dataset carrying an employee code |
| Database | `sql/08_validation/17_recon_employee_performance.sql` | 13 `RECON-EMP-*` rules, evaluated on every pipeline run |
| Browser | `portfolio/tests/e2e/dashboard-employees.spec.ts` | 43 tests: role addressability, the below-floor rendering, drill-through honesty, no-JavaScript on all four surfaces, axe on seven states, the eight-width responsive matrix |

**Seeded defects added by `DASH.11`**, each observed failing before the guard was accepted:

| Defect | Guard that caught it | Observed |
|---|---|---|
| Appointment-set rate divided by valid leads instead of contacted leads | "divides appointment-set leads by CONTACTED leads" | Rate moved 12.1 points |
| The comparison ordered by volume descending | "orders the comparison by store, role and code" | Order assertion failed |
| The never-responded bin coalesced to zero seconds | "excludes the never-responded bin rather than treating it as zero" | Median fell |

**Two guards had to learn the difference between an assertion and a disclaimer.** A raw source scan
for `leaderboard` and `difficulty` failed on the page's own visible copy — "a list sorted by gross is
a leaderboard whether or not it is labelled one", "availability and not difficulty" — which is the
contract being STATED rather than broken, and a guard that banned the word would push the page toward
explaining itself less. The full vocabulary is now checked against every string the model produces as
a LABEL, where a disclaimer cannot occur; the source scan keeps only the terms with no legitimate
disclaiming use, and reads comment-stripped source so a file may still document its own ban.

**Three tests refuse to pass vacuously.** The below-floor test asserts that BOTH a suppressed and an
eligible population exist and fails with a message saying the browser assertion has become vacuous if
either disappears. The ratio-of-sums test asserts the two implementations differ by more than $0.50 on
the committed data before asserting which one the model produced. The wholesale, certified, duplicate
and cancellation tests each assert the excluded population is non-empty first.

---

## `UX.1` — what the productization increment added to the strategy

`UX.1` changed no business logic, so it added no reconciliation rule and no
seeded defect. What it added is guards for three classes of claim the suite could
not previously fail.

### 1. The operating-copy boundary — `portfolio/tests/e2e/operating-copy.spec.ts`

**Why it is a browser test and not a source scan.** The rule is about what a
manager READS, and a source scan cannot separate four things that look identical
in a file: an identifier, a comment, a term inside a collapsed disclosure, and a
term above the KPI rail. Only the fourth is a violation. The guard therefore reads
`innerText` from `<main>` on a running build, which excludes `display:none`,
excludes `.sr-only`, and excludes the contents of a collapsed `<details>`.

**Both halves are asserted, and the second is what makes it honest.** A rule that
only checks the collapsed state can be satisfied by deleting the evidence. So the
same nine routes are checked again with every `<details>` open, and there the
dataset version and the real-engine validation state must be PRESENT. Together the
two halves say *not first, and not gone*.

**What is deliberately not restricted:** GL, DMS, CRM, KPI, PVR, F&I, subledger,
variance. These are dealership words. The restricted list is implementation
vocabulary — languages, frameworks, storage engines, file formats, build systems
and internal artifact names — and nothing else.

### 2. The geometry contract — `portfolio/tests/unit/ux1-visual-geometry.test.tsx`

`dashboard-visuals.test.tsx` asserts that nothing is available ONLY as a length:
every value a bar encodes is also text, the table is in the document, a null is a
gap with a stated reason. That is the accessibility contract and it is the more
important of the two.

This suite asserts the other half, which nothing checked before: **that the length
moves.** A test that finds a `<div class="bar">` passes just as happily against a
fixed decorative graphic. Each primitive is rendered twice against materially
different data and the emitted geometry is compared — different data must draw a
different shape, identical data must draw an identical one, and a flat series must
draw fewer distinct geometries than a varied one. A "not vacuous" case proves the
collector finds marks at all, so a refactor that stopped it reading geometry
cannot turn every comparison into two empty arrays.

### 3. Redirect, canonical and filter-continuity integrity — `navigation.spec.ts`

- Every one of the eight retired URLs answers a permanent redirect, lands on the
  right destination, and does not take the paths beneath it with it.
- **`/dashboard` carries its query string through the redirect.** The most
  load-bearing assertion in the file: every console link anybody has shared is a
  `/dashboard?…` URL, and a redirect that dropped the filters would silently
  resolve all of them to the default period while the page still looked correct.
- No two URLs claim the same canonical.
- No retired URL is in the sitemap.
- The rail carries `period` and `store` to every destination that declares them
  applicable, drops `source` where a route declares it not-applicable, survives a
  real navigation rather than only appearing in an href, emits no duplicate
  parameter, and produces the same links with scripting disabled.

### What did not change

The `DASH.11` fairness assertions, the export boundary guards, the exact-money
boundary, the reconciliation suites and the seeded defects are untouched. `UX.1`
updated route targets where a route moved and rewrote assertions where the thing
being asserted was genuinely replaced; it deleted no test because the information
architecture changed.

---

## `DASH.12` — the action engine

**The predicate grammar is tested as a security boundary.** The claim is negative — "there is no
interpreter to reach" — and a negative claim is worth what the attempts to falsify it are worth.
`tests/unit/test_action_predicate.py` drives 27 hostile expressions, each of which would do something
under `eval`: `__import__("os")`, `open(...)`, `lambda`, attribute access, subscripting, dict and
list literals, statement separators, arithmetic and bitwise operators, SQL, JavaScript arrow and
template syntax. Each must fail before any row is read.

**Every enabled rule has a firing fixture and a suppressing one**, derived rather than hand-written.
The firing row is a real exported row the rule matched; the suppressing row is that same row with
the predicate's fields set to NULL — which tests the property most likely to be got wrong, since a
unit with no market estimate must not satisfy a ratio comparison. Two rules are carved out and given
the inverse pair, derived from the predicate rather than listed by identifier: `ACT-FNI-006` and
`ACT-ACC-002` ask about ABSENCE, so a null is their answer rather than an unknown.

**The register audit's claims are asserted, not narrated.** "No posting timestamp exists" is tested
by proving `posting_lag_days` equals `days_in_stock` on every exported row. "The lead denominators
never reach the floor" is tested against the export. "This condition cannot survive into a valid
export" is tested by looking for it.

**Two enabled rules fire zero times**, and `TestHonestZeroes` records why rather than smoothing it:
both match real rows inside the reporting window and none inside the as-of scope, so the zero is a
fact about the period rather than about the rule.

**Determinism** is a double run, a run with every input list reversed, an assertion that no timestamp
enters the payload, and an assertion that the committed queue equals the re-derived one.

**The cross-language drill-through check** is not a regex over a string: the generator resolves every
destination against the console's route registry and the destination's own filter-support matrix, and
the E2E suite fetches a sample of them.

---

## `UX.2B` — the revenue and vehicle workspaces

Two files, and they answer two different questions.

### 1. Geometry that moves — `tests/unit/ux2b-revenue-workspaces.test.tsx`

`UX.2B` §57 states the rule: for each major visual, render at least two materially different data or
filter states and assert that a width, a length, a position or a composition CHANGES. A fixed pretty
chart must fail. Every assertion is written so a primitive which ignored its input — a full-width bar,
an evenly-stepped ladder, a fixed five-segment stack, a scatter with one radius — is caught by the
property that makes it decorative, rather than by a rendered string.

The states are real filter states the routes accept, resolved through `buildSalesGross`, `buildFi`,
`buildDealJacket` and `summarizeInventory` exactly as the pages resolve them. Nothing constructs a
fixture the console could not produce, and the four fixture deal identifiers are RESOLVED FROM THE
EXPORT by the property each test needs — two that differ, one whose product gross was adjusted after
the deal date, one carrying a trade — rather than typed as literals that stop describing anything the
day the dataset is regenerated.

Four assertions are worth naming because they catch a specific way a chart lies:

- **Each measure is scaled to its own maximum.** A common scale across units, dollars and dollars per
  unit draws retail units as a hairline beside total gross. Each group therefore carries at least one
  full-width bar, and a shared scale is excluded by asserting that not all of them do.
- **No penetration bar reaches 100%.** Every bar runs from zero to full eligibility rather than to the
  largest category, and no category in the fixture reaches full attachment — so a maximum-scaled chart
  would draw exactly one full bar and the assertion fails.
- **The capital track differs from the unit track.** If the age stack's second track simply repeated
  the first, it would be decoration, and the eleven-per-cent-of-units, twenty-six-per-cent-of-the-money
  finding the two tracks exist for would be invisible.
- **The scatter draws more than three distinct mark sizes.** A fixed-radius plot collapses to one.

### 2. Seeded defects — same file, second half

`UX.2B` §58 lists ten. Each perturbs the INPUT a component is given, exactly as a mistaken selector
would, and asserts the rendering differs — which is the only formulation that proves the assertion
could have caught it. A test that checks only the correct rendering proves that the correct rendering
is correct, and nothing about whether an error would be noticed.

| Seeded defect | What fails |
|---|---|
| A bridge step's sign is reversed | The printed component set differs, and the sign is text rather than colour |
| An empty age bucket is dropped before rendering | The ramp is keyed on exported bucket ORDER; the drawn marks are asserted identical whether the caller prunes or not |
| Certified escapes Used | The condition split is asserted to have exactly two rows, and `condition=Certified` is asserted not to change the Used gross |
| Penetration counts contracts | Every category's `penetration.numerator` is asserted to BE the attached-deal count, and a category where contracts genuinely exceed attached deals is found in the window so the first assertion is a constraint rather than a tautology |
| Category denominators are averaged | The set of eligible denominators is asserted to hold more than one distinct value |
| The back-gross bar is drawn from net product gross | An adjusted deal is found where original and retained differ, and the identity is asserted to hold on the original |
| The scatter mixes snapshots between its axes | The plotted rows are asserted to span exactly one snapshot date, and the mark count changes with the store |
| The market estimate is rendered as a real market value | The rendered text must contain "synthetic" and must not contain market value, book value, auction, KBB, Black Book or NADA |
| Trade variance is folded into the front gross | The ladder's lines are asserted not to contain it, the rendering is asserted not to print it, and the identity is asserted to still hold without it |
| Adjustment-period amounts are presented as deal-date production | The rendered text must carry "Adjustment-period basis" and "not deal-date production" |

### 3. Geometry a reader can see — `tests/e2e/ux2b-workspaces.spec.ts`

The per-route suites ask whether the figures are the exported figures. This one asks whether the
manager who opened the route can SEE them, and every assertion is an element offset against a stated
viewport rather than a judgement.

- **The first-viewport contracts (`UX.2B` §49)**, one per route, at 1440 × 900, read off
  `data-visual-region` and `data-deal-figure` offsets. Sales & Gross is additionally re-checked under
  three filter states, because a layout that meets its contract only on the default query meets it by
  coincidence.
- **Mobile priority (§50)** at 390 × 844: the lead rail figures are asserted to be the right three, in
  the right order, and no route's methodology region may sit above its first visual region.
- **The responsive matrix (§61)**: 320, 375, 390, 768, 1024, 1280, 1440 and 1920 on all five routes,
  asserting no horizontal overflow, with the same one-pixel tolerance every responsive suite in this
  repository carries and for the same reason.
- **One representation in the accessibility tree**: the Deal Explorer's table and its cards are
  asserted never to be visible together, at 390, 1024 and 1440.
- **Without JavaScript (§52)**: every rail figure, both jacket economics, the age bands, the unit
  table, the structure mix and every `ELIG-*` denominator are asserted present with scripting
  disabled, and the measure switch is asserted to be three real radios in the document.
- **Drill-through (§46, §47)**: each generated href is asserted to carry what the destination can act
  on, NOT to carry what it cannot — the Deal Explorer's search term is asserted absent from the
  Sales & Gross link — and each destination is then FETCHED, because an href that resolves to a 404 is
  a false drill-through and a string assertion cannot tell.
- **Keyboard reach (§30, §51)**: the measure switch is walked with arrow keys; the scatter is asserted
  focusable, `role="img"`, and carrying its plotted count and both axes in its accessible name.

### What did not change

No existing assertion was weakened, and every edited one is recorded here rather than left in the
diff. Eight were edited across five suites, and each falls into one of four kinds:

**A locator that now resolves to two elements.** `UX.2B` added a second table to the Deal Explorer
(the attribution disclosure) and to Inventory (the age stack's data table), so `main table tbody` and
`main tbody tr` stopped being unambiguous. Both suites scope to the table they always meant, by its
accessible name. The Deal Explorer's contact-shaped-value scan went the OTHER way and now reads every
table on the route, because a disclosure is exactly where a contact detail would leak unnoticed.

**Content that moved into a disclosure.** The F&I penetration columns and the adjustment event table
are now inside their figures' own table disclosures. The assertions were split: the visible half reads
`innerText` and asserts the stronger property `UX.2B` created — both sides of every ratio are printed
beside the bar as "37 of 92", which the two columns never were — and the second half reads
`textContent` and asserts the columns are still in the document.

**Copy that changed with the layout.** Four region titles and three sentences. In each case the
assertion follows the CLAIM rather than the words: "targets and pace" became "plan and pace"; the
nine `How is this calculated?` summary lines became one disclosure, so the test counts the nine
catalogue ENTRIES inside it instead of counting summary lines; and the manager-sample assertion moved
from `/minimum/i` to the more specific "Below 10 retail units a ratio is withheld".

**A latent race that started firing.** `dashboard-deals.spec.ts` › *pagination* › *moves forward and
back through real links* waited for the forward navigation and not for the backward one, so the final
read could land on page two's document and fail with the position sentence it had just asserted. The
race has always been in the test; it started firing under `UX.2B` for a reason that is about timing
rather than correctness — the route carries a population summary now, `mainText` scrolls the whole
document to settle it, and the previous-page link is that much further down, so the click lands later
and the read lands closer to the navigation. The fix is one `waitForURL` before the read. It was
caught by the full-suite run rather than by the file on its own, which is exactly the load condition
that made it fire: the test passes six times out of six in isolation.

The `DASH.11` fairness assertions, the export boundary guards, the exact-money boundary, the
reconciliation suites and every seeded defect from earlier increments are untouched.

---

## `UX.2B.1` — the refinement suite, and the six tests a contract change moved

`tests/unit/ux2b1-refinement.test.tsx` adds **9** tests covering the shared-primitive defects an
audit of a parallel `UX.2B` implementation surfaced, plus the disclosure the inventory unit table
now uses.

It is nine rather than eleven because the audit found four defects and only three of them are
this branch's to fix. The fourth — `BridgeChart` drawing its anchors as 0.5 % slivers — reached
`main` independently through `#63`, which was opened from the parallel branch and merged while
this work was in review, and it brought its own assertions in `dashboard-visuals.test.tsx`: each
anchor above the floor, the closing anchor taller than the opening one, both steps shorter than
either. The two tests here that restated those were removed rather than kept for the count. What
remains is what that suite does not cover — the **inversion**, which is the property a chart
ignoring its input would fail, and the **label**, which is a different defect. They are written the way the rest of this repository's geometry
tests are written: each asserts the property that made the defect a defect — an anchor that
occupies no share of the plot, a trend with no horizontal reference, a scroll region a keyboard
cannot reach, a module that is not the layout reference for its own contents — rather than the
class name that happens to encode today's fix.

**Four of them were proved to fail against the unfixed code.** Both `visuals.tsx` defects were
re-seeded exactly as they stood before either fix (`upper`/`lower` taken from the bar's own base
and top; `axisLabels` defaulted off) and the suite was re-run: **four failed, five passed**, and
the file was restored. That is the §58 standard applied to a fix rather than to a feature. It was
six before the two duplicated anchor tests were removed; the anchor contract is still verified,
by `dashboard-visuals.test.tsx`, which is where `#63` put it.

**Six existing e2e tests changed, all for one reason.** The inventory unit table moved into a
`<details>`, which is an intentional product-contract change, and a closed disclosure is not in
the accessibility tree — so `getByRole('table')` cannot resolve its rows until it is opened. An
`openUnits` helper opens it, and the search test reopens it after the form navigation because a
fresh page is correctly closed again.

Two of the six were made **stronger** rather than merely adjusted, and they are the two that
matter:

- *the page works without JavaScript › renders the summary, the buckets and the unit table* now
  asserts a real unit identifier is present in the served markup **while the disclosure is still
  closed**. That is the assertion that separates collapsing from removing, and it is the one a
  shorter page would otherwise be hiding. It then opens the native `<details>` with scripting
  disabled, which is the other half of the claim.
- *labels the market estimate synthetic everywhere it appears* now asserts both caveats are in
  the page with nothing opened — proving the disclosure did not take the caveat with it — before
  checking that the column header still carries the qualifier for a reader who opens the table.

No test was deleted and no assertion was weakened.

---

## `UX.2C` — the demand, people and control workspaces

`tests/unit/ux2c-workspaces.test.tsx` adds **38** tests and
`tests/e2e/ux2c-workspaces.spec.ts` **26**, in the same two halves `UX.2B` established.

### 1. Geometry that moves — `UX.2C` §55

Each new visual is rendered in two materially different states and its geometry compared. The
assertion is on the set of rendered CSS widths, so a primitive that ignored its input — a
full-width bar, a fixed composition, two identical balance bars — fails on the property that makes
it decorative rather than on a rendered string.

Covered: the lead-grain funnel (and that it narrows monotonically, because every stage is a subset
of the first), the appointment progression, the response distribution, the stage-loss partition,
the source matrix, the balance comparison, the comparison-state population, the employee family
rail and the action queue's four facet partitions.

**Two of them assert a property a "geometry changed" test would miss.**

- *the balance comparison scales both balances against one shared maximum*. Scaling each bar to
  its own maximum draws two identical full-width bars whatever the variance is — a chart whose
  geometry never moves while passing a change test, because the two states differ elsewhere. The
  assertion is that the larger side pins at 100% and the smaller does not.
- *the source matrix draws no bar at all for a rate that does not exist*. A rate with no
  denominator is not a rate of zero, and the failure mode is a zero-length bar rather than a
  missing one. The assertion counts one FEWER bar after an absence is injected, which a width
  comparison would have passed.

**The helper has its own self-test**, for the reason §58 gives: a geometry assertion that returns
an empty set for everything passes for the wrong reason, so the width reader is shown a tree with
no geometry and required to find none, and a tree with one known width and required to read it.

### 2. Semantics that hold — `UX.2C` §56

The denominators, the grains, the absence states, the ordering contract and the facet semantics
the increment could plausibly have broken while rearranging the pages that carry them. Several
perturb the INPUT exactly as a mistaken selector would.

The two worth naming:

- **the employee ordering contract.** The rendered `data-employee` sequence is asserted equal to
  the view's, the view's equal to store|role|code ascending, AND **not** equal to descending
  volume — which on the real export it is not, so the assertion can fail. A later refactor that
  reached for `.sort((a, b) => b.volume - a.volume)` because it "reads better" fails here rather
  than merges.
- **the action queue's facet semantics.** Selecting `severity=high` must narrow `shown` without
  changing `total` or any domain count, because the counts are counts of the whole queue and a
  cross-filtered count answers a question nobody asked.

### 3. Three bans that had to be written as contracts, not word lists

A substring ban is the obvious way to assert an absence and it is wrong three times here, in a way
worth recording because the failure is silent in the other direction — a ban that fires on correct
copy teaches the next person to delete the test rather than the defect.

- **`age` is inside `average` and `manager`**, and `rank` inside `franchise`. The employee privacy
  guard uses word boundaries.
- **`leaderboard` is on the employees page**, in the sentence that refuses to be one: *"a list
  sorted by a measure is a leaderboard whether or not it is labelled one."* The guard asserts that
  exact sentence rather than banning the word, because deleting the sentence would remove the
  statement that makes the ordering rule legible.
- **`completed`, `assigned` and `workflow state` are on the actions page**, in the sentence saying
  the queue holds none of them. The no-task-manager guard bans the CONTROLS instead — no
  `assignee`, no `due date`, no `snooze`, no `mark as done` — and asserts the rendered tree
  contains **zero** `button`, `input` or checkbox elements, which is the property that actually
  distinguishes a review queue from a task list.

### 4. Geometry a reader can see — `tests/e2e/ux2c-workspaces.spec.ts`

- **The first-viewport contracts (§5)**, one per route at 1440 × 900, read off
  `data-visual-region` offsets, and held under a filter on Leads and under every role on
  Employees.
- **The phone contract (§52)** at 390 × 844: `UX.2C` names TWO screens, and the assertion is that
  the primary state and the first analytical figure are both inside 1,688 px.
- **Height ceilings (§54)** set well above the measured after-figures. They exist to catch a
  regression toward the baseline shape, not to freeze a layout — §54 says the goal is analytical
  density rather than minimum pixels.
- **The responsive matrix (§51)** at eight widths, plus an assertion that no money value or
  identifier wraps mid-token at 320 px.
- **No-JavaScript (§50)** per route, including that the Actions facets and the employee role
  switch still navigate, because they are links.
- **Tab-order ceilings (§49)**, and an assertion that no drawn mark is focusable on any of the
  four routes. The `UX.2B` scatter review is the reason: direct drill-through is useful and
  hundreds of sequential focus stops is still a regression.

### 5. PR #55's definition-list guard, repointed rather than retired

`tests/unit/dashboard-definition-lists.test.tsx` was written against three
`/dashboard/leads-marketing` sections. `UX.2C` rebuilt that route and those components no longer
render anywhere: the figures that replaced them carry their qualifiers as bar labels rather than
as definition lists, so there is no `<dl>` left on the route to guard.

**A guard pointed at a component nothing renders is a test that passes because it is checking
nothing**, which is the failure mode this file was created to prevent in the first place. It now
checks the lists `UX.2C` does ship — the employees route's unassigned-activity block, and **every
one of the exported action cards individually** rather than one chosen example, because the card's
shape varies with the evidence it carries. The rule, the fault detector and its own self-test are
unchanged, and each subject still asserts `toBeGreaterThan(0)` on the `<dl>` count so the same
erosion cannot happen again.

### 6. Existing tests that changed, and why

Thirty e2e assertions across the four per-route suites were reading copy the rebuild replaced.
**None was deleted and none was weakened**; each was repointed at the same contract in its new
form, and several were made stronger:

- *shows the cancellation rate on the same block as the show rate* now also asserts
  `Eligible to show` and `removed from the show-rate denominator` — the exclusion is drawn as a
  bar rather than asserted in a sentence, so the test checks the geometry's labels.
- *keeps the wide marketing table inside its own scroll container* now opens the disclosure the
  table moved into — the reader's actual path to it — and asserts the region carries `tabindex="0"`
  before checking that it scrolls.
- *states which date owns which row* now reads through `mainTextContent`, which reaches inside a
  closed `<details>`. That is the point: the period-ownership matrix is still in the served markup,
  in reading order and findable by a browser text search, and the assertion proves it.

**One defect was found by these tests rather than by eye.** The employee context chip rendered its
label and value as two flex children with a gap, so `textContent` read `Sample9 of 10 retail units`
as one token — invisible to a sighted reader and wrong for a screen reader. The separator is a
character now.
