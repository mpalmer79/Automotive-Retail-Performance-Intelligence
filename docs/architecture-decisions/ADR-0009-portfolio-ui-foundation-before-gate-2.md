# ADR-0009: Portfolio UI Foundation Before Gate 2

## Status

**Accepted**

## Date

2026-07-30

## Deciders

Michael Palmer

## Context

[ARCHITECTURE.md §28](../../ARCHITECTURE.md) **Gate 2** states:

> No web case study begins until:
>
> - Core Power BI pages are complete.
> - SQL and Power BI totals reconcile.
> - Executive findings are drafted.

All three conditions are unmet, and [PHASE_2_BACKLOG.md §1.2](../requirements/PHASE_2_BACKLOG.md) records
the verdict as **CLOSED** with the evidence for each. `P2.4-05` — *Case study copy and launch materials* —
is the one backlog item Gate 2 gates directly.

Meanwhile the repository has a problem Gate 2 was never written to address. The analytical work is
substantial and largely finished: eight conformed dimensions, five facts at declared grain, twenty-eight
reporting views, twenty-nine governed KPIs each verified against an independent derivation, fifty-eight
reconciliations recorded per run, and a source-controlled Power BI semantic model in TMDL. **None of it is
reviewable by someone with limited time, no database, and no Power BI licence** — which
[ARCHITECTURE.md §27](../../ARCHITECTURE.md) Lifecycle Phase 8 identifies as the audience the packaging work
exists for. A reviewer's options today are to clone the repository and read 22,000 lines of Markdown, or to
take the README's word for it.

The tempting reading of Gate 2 is that it blocks *all* public-facing work until findings exist. That reading
would be wrong in a way worth naming, because it conflates four different things that the gate's own
conditions distinguish:

1. **The presentation layer** — a website, a design system, navigation, informational routes.
2. **The analytical case study** — findings, recommendations, an argument from results.
3. **The Power BI dashboard** — report pages and visuals over the semantic model.
4. **A second analytics application** — a duplicate query surface that recomputes the KPIs.

Gate 2's three conditions are all about **(2)**. Every one of them is a precondition for having something to
*conclude*: complete pages to read results from, reconciled totals to trust them, drafted findings to review.
None of them is a precondition for **(1)**. And **(3)** is gated separately, behind the real-engine validation
of the semantic model per [ADR-0008](ADR-0008-real-engine-validation-paths.md). **(4)** is prohibited outright
by [ARCHITECTURE.md §26.3](../../ARCHITECTURE.md) and appears in this record only because it is the failure
mode a website most easily drifts into.

The risk in building **(1)** now is not that it violates Gate 2. It is that a polished website makes it very
easy to *imply* **(2)**. A site with a hero, a metrics strip and a case-study link reads as a finished
analytical product whether or not it says so, and a reader who does not scroll will leave believing findings
exist. That risk is real, it is the reason this record exists, and it is addressed by controls rather than by
intention.

## Decision

**The portfolio UI foundation may be built and merged before Gate 2 opens. The public analytical case study
may not, and remains gated by Gate 2 exactly as written.**

The four categories in the Context are hereby defined as distinct, with separate permissions.

### 1. Portfolio UI foundation — PERMITTED before Gate 2

A presentation layer over content the repository already evidences. Specifically permitted:

- A design system: tokens, typography, colour, spacing, elevation, iconography, component library.
- A website application shell: layout, navigation, footer, metadata, error and loading states.
- Informational routes describing the project, its architecture and its data model.
- Architecture storytelling — how the pipeline is built, layer by layer.
- Data-model storytelling — dimensions, facts, declared grains, keys, history policy, privacy class.
- KPI-catalogue exploration — every governed **definition**, searchable and filterable.
- Governance and privacy storytelling.
- A project-status display derived from source-controlled evidence.
- Author and domain-experience content.
- A **locked** case-study route shell.
- A branch preview deployment.
- Accessibility and performance engineering.
- An original visual identity and a documented motion system.
- Search-engine metadata, a sitemap, a social preview image.
- Links to the repository and to its documentation.

### 2. Public analytical case study — PROHIBITED until Gate 2 records an OPEN verdict

Specifically prohibited, on the website and anywhere else public:

- Published analytical findings of any kind.
- Management recommendations.
- Power BI screenshots presented as complete work.
- A functioning duplicate dashboard.
- Fake, illustrative, placeholder or sample KPI **values**. The site displays definitions, never numbers
  produced by a measure.
- Fake live data, or any implication that the site queries anything at run time.
- Any statement that Desktop or Fabric validation has passed while its evidence file says otherwise.
- Any claim that Lifecycle Phase 5 or delivery increment `P2.2` is complete.
- A public launch positioned as the final case study.
- Any result that requires a **Deferred** fact.
- Any conclusion about F&I penetration, service-to-sales, customer retention or target attainment. All four
  depend on Deferred facts, and all four are therefore unavailable regardless of Gate 2.

### 3. Power BI dashboard — unchanged, gated by real-engine validation

`P2.2` remains sequenced behind `P2.1-09` passing on one accepted [ADR-0008](ADR-0008-real-engine-validation-paths.md)
path. This ADR does not touch that, and the website does not substitute for it: rendering a chart in HTML
would not validate a DAX measure, and the site therefore renders none.

### 4. A second analytics application — remains prohibited, permanently

[ARCHITECTURE.md §26.3](../../ARCHITECTURE.md) is explicit that the case study must not become one.
The website therefore has **no API route, no database connection, no query interface, no embedded live
report, no server action, and no charting library**. Every number it displays is a count of repository
artefacts — tables, relationships, measures, scripts, reconciliations — resolved at build time from
source-controlled files. It computes no KPI, and it could not: the reporting schema is not reachable from it.

The distinction that keeps this honest: the site is a **rendering of the repository's own documentation**, not
a second implementation of its analytics. `README.md` states twenty-nine governed KPIs; so does the site, from
the same file. Neither computes one.

## Controls

Permission without enforcement would make this record a preference. Five controls implement it.

### C1 — A build-time gate on the case-study route, with five independent conditions

`portfolio/scripts/generate-project-manifest.ts` computes the case study's lock state. It unlocks only when
**all five** hold:

1. `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` is explicitly `true`.
2. `docs/requirements/GATE_2_READINESS.md` exists.
3. That document records a Gate 2 verdict of **OPEN**.
4. The required case-study content file exists in the repository.
5. At least one required report screenshot exists in the repository.

The environment flag is **necessary and never sufficient**. This asymmetry is the control's whole value: a
flag flipped in a deployment dashboard cannot conjure a written gate review, a findings document, or a
screenshot of a report page that has not been built. The flag can only ever withhold, never grant. Absence of
evidence closes the gate and never opens it.

The generator additionally **fails the build** if a Gate 2 readiness document records OPEN while any of the
gate's three conditions is unmet by repository evidence. A written verdict does not override the conditions it
evaluates.

### C2 — The manifest is the only source of a number or a status

No component may hardcode a project count or an implementation status. Every one comes from
`portfolio/src/generated/project-manifest.json`, which is generated from
`powerbi/validation/model_expectations.json`, `powerbi/validation/sql_baseline_metadata.json`, both engine
evidence files, the TMDL source, `KPI_CATALOG.md`, the readiness documents and the `sql/` tree — and which
records the source path for every value it emits.

The generator cross-checks the model's own register against the TMDL it describes and fails on any drift, so
a model edit that did not update its expectations file cannot be rendered.

### C3 — The build refuses to state that Phase 5 is complete while both engines are pending

An explicit assertion in the generator:

> Lifecycle Phase 5 is emitted as complete while both real-engine validation paths are pending. This is the
> single claim this project must never make.

Parallel assertions cover the case study unlocking with Gate 2 closed, the semantic model being described as
real-engine validated when no engine has passed, and Lifecycle Phase 6 remaining blocked once report pages
appear.

### C4 — The synthetic-data statement appears in the body of every primary route

Not in the footer only. It is rendered in the hero above the fold, in every page header, and again in the
footer, and an end-to-end test asserts its presence route by route.

### C5 — No KPI value anywhere on the site

There is no figure produced by any measure, real or illustrative, on any route. The KPI catalogue page states
this explicitly and gives the reason. A content-integrity test asserts that no route renders a value in a
KPI-value position.

## Consequences

### Positive

- The analytical work becomes reviewable by its intended audience without a clone, a database or a licence.
- The gate is demonstrated rather than described. A reader arrives at `/case-study`, finds it locked, and sees
  the three unmet conditions with the evidence for each — which is a stronger argument for the project's
  governance than any paragraph claiming to have some.
- The honest statuses are load-bearing rather than incidental. "Real-engine validation pending" appears in the
  hero, on the status page, in the architecture explorer, in the scrollytelling and in the footer.
- Lifecycle Phase 8 begins on the part of the packaging that does not depend on findings, so the remaining
  items are smaller when the gate opens.

### Negative

- A polished site invites the inference that the analysis is finished. Mitigated by C3, C4 and C5, and by
  putting the pending validation in the hero rather than in a footnote — but the risk is not zero and it is
  the reason this record exists.
- Frontend surface area is added to a repository whose competence claim is analytical. Confined to
  `portfolio/`, isolated from the Python and PostgreSQL runtime, and covered by its own CI job so it cannot
  destabilise the existing checks.
- The locked case-study route will need to be replaced with real content later. Accepted: the alternative was
  no route, and a 404 at `/case-study` communicates nothing about why.
- Some website content restates repository documentation, so a change to a governing document can leave the
  site stale. Mitigated by generating every count and status rather than writing it, and by extracting the KPI
  and data-model content into files the build cross-checks against their sources.

### Neutral

- `P2.4` remains incomplete and Lifecycle Phase 8 remains **in progress**. This website is one item within
  `P2.4`, not the whole of it: the screenshots, the model diagram, the generated DAX measure catalogue, the
  Excel operating report, the walkthrough video and the case-study copy are all outstanding, and most cannot
  start until the report layer exists.
- Gate 2's wording is unchanged. This record interprets its scope; it does not amend its conditions.

## Alternatives considered

### A. Wait for Gate 2 before building any website

Rejected. It reads Gate 2 as gating presentation when its conditions are all about conclusions, and it leaves
the analytical work unreviewable for as long as the real-engine validation is blocked on provisioning outside
the repository. It also concentrates all packaging work into one late increment, which is where packaging
quality goes to die.

### B. Build the website and write a provisional case study, labelled as draft

Rejected, and the most dangerous option considered. A draft finding is still a finding: it gets read, quoted
and remembered without its qualifier. Gate 2's condition is that findings are *drafted* — meaning drafted
internally under `docs/findings/`, reviewed, and then published — not that a public page carries a disclaimer.

### C. Build the website and render the KPIs from the SQL baseline

Rejected. `powerbi/validation/sql_baseline.json` holds real computed figures across twenty-one filter
contexts, so this was technically available and superficially attractive. It fails on two counts. It would
make the site a second analytics application in the exact sense §26.3 prohibits — a query surface over the
same KPIs, competing with the Power BI deliverable. And a page of dealership figures for a fictional group
would be read as results no matter how it was captioned, which is the misreading this project's entire
governance apparatus exists to prevent.

### D. Publish a single static page instead of a site

Rejected. It solves the reviewability problem poorly — the architecture, the data model and the KPI catalogue
each need real interaction to be explorable — and it demonstrates nothing about frontend competence, which is
part of what the packaging increment is for.

## Compliance

This record is enforced by:

- `portfolio/scripts/generate-project-manifest.ts` — C1, C2, C3.
- `portfolio/tests/unit/content-integrity.test.ts` — C2, C5.
- `portfolio/tests/e2e/content-integrity.spec.ts` — C4.
- `portfolio/tests/e2e/case-study-gate.spec.ts` — C1.
- `.github/workflows/frontend.yml` — runs all of the above on every push.
- `scripts/check_powerbi_model.py` — unchanged, and still fails the build if report visual content appears
  before `P2.2` formally starts.

## References

- [ARCHITECTURE.md §26.3](../../ARCHITECTURE.md) — public case study, and the prohibition on a second application
- [ARCHITECTURE.md §27](../../ARCHITECTURE.md) — Lifecycle Phase 8, portfolio packaging
- [ARCHITECTURE.md §28](../../ARCHITECTURE.md) — Gate 2
- [ADR-0003](ADR-0003-delivery-increment-terminology.md) — lifecycle phases versus delivery increments
- [ADR-0007](ADR-0007-power-bi-project-format.md) — the semantic model's storage format and validation boundary
- [ADR-0008](ADR-0008-real-engine-validation-paths.md) — the two accepted real-engine validation paths
- [`docs/requirements/PHASE_2_BACKLOG.md`](../requirements/PHASE_2_BACKLOG.md) — Gate 2 status, and `P2.4-06`
- [`docs/requirements/GATE_1_READINESS.md`](../requirements/GATE_1_READINESS.md) — the form a gate verdict takes
- [`portfolio/README.md`](../../portfolio/README.md) — the website's own documentation
