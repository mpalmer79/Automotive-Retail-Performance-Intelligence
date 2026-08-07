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

## 7. Cross-layer reconciliation (the chain that makes the console honest)

Asserted at the narrowest layer that can observe each equality:

1. UI executive totals = generated page payload totals (component tests).
2. Generated payload totals = root export totals (generator unit tests).
3. Root export totals = reporting-view totals (Python integration).
4. Reporting-view totals = independent warehouse derivations (existing KPI verification).
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

No TMDL change in this program's increments ships without: `scripts/check_powerbi_model.py` green
against updated `model_documentation`; the source-hash staleness consequence stated in the PR; and
`check_real_engine_validation.py` still truthful. A test asserts the console's trust panel derives
Power BI state only from `powerbi/validation/*.json` (never a hardcoded "validated"). SQL-to-DAX
reconciliation extensions (new measures ↔ new baseline contexts) are specified in the future
Power BI increment, not silently assumed by this program.
