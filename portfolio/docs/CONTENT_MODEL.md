# ARPI content model

How the website knows what is true, and why it cannot say anything else.

---

> **Experience redesign, version 2.** This document describes the site as it
> stands after the redesign recorded in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md`.

**One disclosure per route, not seven.** The previous build stated its trust
position seven separate times on the home page alone. Every one was true;
together they made a finished warehouse, a governed KPI catalogue and a
source-controlled semantic model read as an apology (finding A-04).

`TrustLine` is now the single shape that disclosure takes. It carries the
synthetic-data statement, the fictional dealer group, and the real-engine
validation state - and that last clause is DERIVED from the manifest rather than
authored, so the sentence cannot outlive the fact and cannot be made to say
"validated" early by editing a string.

The full explanation was not removed, only relocated: `/status` and `/kpis` both
carry it at length, and `tests/e2e/content-integrity.spec.ts` asserts it is still
there. Reducing repetition must not reduce what the site actually says.

**New content rules, enforced in the browser.** The hero carries exactly two
calls to action and no status badge; the headline, both actions and the trust
line reach the first 390x844 screen; the differentiator is above the fold on a
desktop; the proof section shows exactly four figures; no route repeats the
disclosure more than twice; no public copy contains an em dash; the Operating
View shows no value in any domain.

## 1. The problem this solves

A portfolio site is the easiest place in a project to tell a small lie. Not a deliberate
one — a drifting one. A count that was right in March. A "pending" that quietly became
"validated" because the author meant to validate it. A screenshot that outlived the thing
it showed. A phase marked complete because it felt complete.

ARPI's central claim is that its numbers are governed. A website that made a single
unbacked claim about the project would refute the claim it exists to support.

So the site is built so that **no number and no status can be authored by hand.**

---

## 2. The architecture

```
repository evidence files
        │
        │  scripts/generate-project-manifest.ts
        ▼
src/generated/project-manifest.json      ← the only source of counts and statuses
        │
        │  src/lib/manifest.ts  (typed accessors)
        ▼
components and routes
```

Three properties follow from that shape:

**The generator refuses to lie.** It asserts consistency between statuses and their
evidence before writing, and it exits non-zero with every problem listed rather than one
at a time.

**The build refuses a stale manifest.** `manifest:check` regenerates and byte-compares
against the committed file. It runs in `prebuild`, so `npm run build` cannot produce a
site whose manifest is out of date, and it runs as its own CI step so the failure is
legible.

**A change to evidence fails the pipeline.** The frontend workflow is path-filtered to
include `powerbi/validation/**`, the semantic model, `KPI_CATALOG.md`,
`docs/requirements/**` and `sql/**` — because a change to any of them can make the
committed manifest wrong. Editing an evidence file and not regenerating is a red build,
not a silently-wrong website.

There is no content management system, no fetch at request time, no revalidation window
and no editable copy of any number. There is one generated file, committed, reviewable in
a diff.

---

## 3. What the generator reads

| Evidence                                               | What is derived from it                                      |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `powerbi/validation/model_expectations.json`           | expected semantic-model shape, used as a cross-check         |
| `powerbi/validation/sql_baseline_metadata.json`        | data profile, reporting-view count, reconciliation count     |
| `powerbi/validation/desktop_validation_results.json`   | ADR-0008 path 1 — Power BI Desktop                           |
| `powerbi/validation/fabric_validation_results.json`    | ADR-0008 path 2 — Microsoft Fabric Service                   |
| `…SemanticModel/definition/relationships.tmdl`         | relationships **as built**: count, direction, cardinality    |
| `…SemanticModel/definition/tables/*.tmdl`              | tables, imported vs measure-only, measures                   |
| `…Report/definition/`                                  | report pages, visuals and bookmarks — currently zero of each |
| `docs/requirements/GATE_1_READINESS.md`                | the Gate 1 verdict and its three conditions                  |
| `docs/requirements/GATE_2_READINESS.md`                | the Gate 2 verdict — **this file does not exist yet**        |
| `docs/requirements/PHASE_2_BACKLOG.md`                 | delivery-increment statuses                                  |
| `KPI_CATALOG.md`                                       | the governed KPI count                                       |
| `sql/`                                                 | ordered script count, DDL object counts                      |
| `src/content/kpis.json`, `src/content/data-model.json` | cross-check only — never a source of truth                   |

**Counts are derived from the artefact, then cross-checked against the expectation.**
Relationship and measure counts come from parsing TMDL directly — the model as it actually
exists — and are then compared against `model_expectations.json`. A disagreement is a
failure, not a silent preference for one file. Reading only the expectations file would
mean the site described a model rather than the model.

---

## 4. What the generator refuses to do

Quoted from its own header, because these are the operative constraints:

- Emit a value it did not read from a file.
- Emit `complete` for a lifecycle phase whose exit criteria are unmet.
- Emit an unlocked case study without every piece of required evidence.
- Copy a credential.
- Emit a person-level value.

### 4.1 The assertion that matters most

```
Lifecycle Phase 5 is emitted as complete while both real-engine validation paths are
pending. This is the single claim this project must never make.
```

The semantic model is built. It has 26 tables, 42 single-direction relationships, 49 DAX
measures, a marked date table, and 117 statically-asserted model objects. It has also
**never been loaded by a Microsoft semantic-model engine.** No engine has refreshed it, no
engine has evaluated a measure, and the totals have never been compared against the SQL
baseline by anything other than a static parser.

That distinction is the whole difference between "this model is validated" and "this model
is written". ADR-0008 accepts two paths to real-engine validation — Power BI Desktop and
Microsoft Fabric Service — and both are `pending-external`, with the reason recorded in
each evidence file. The environment that built the model runs Ubuntu with no Windows, no
Power BI Desktop and no Analysis Services, and cannot reach the Fabric API at all.

So Lifecycle Phase 5 is `in-progress`, the site says so, and the generator will not build
if that ever silently changes.

### 4.2 Secret scanning

Before writing, the generator runs `assertNoSecrets()` over the serialised output against
five patterns. The manifest is generated from files that contain connection metadata and
validation output, and a generated-then-committed artefact is exactly the kind of file
that acquires a credential by accident. The repository's own `scripts/check_secrets.py`
then runs over the whole tree in CI as a second net.

### 4.3 Determinism

No clock and no random source. `generatedFromCommit` comes from git, or from the CI-provided
commit SHA. Object keys are written in a fixed order and arrays in a fixed order, so
`--check` is a byte comparison rather than a semantic diff.

`--check` tolerates exactly one difference: a `generatedFromCommit` that has moved on. That
field changes on every commit by construction, and treating it as drift would make the
check fail on every unrelated change.

---

## 5. The manifest shape

```
schema               'arpi.project_manifest/1'
generatedFromCommit  the commit the evidence was read at
dataProfile          'development'
project              name, author, group, repository, licence
counts               17 SourcedCounts (see below)
semanticModel        storage mode, source schema, relationship breakdown, both statuses
engines              the two ADR-0008 paths, each with status, note and evidence path
lifecyclePhases      8 phases: status, summary, statusReason, exitCriteria
increments           P2.1–P2.4: status, statusReason, lifecyclePhase, blockingGate
gates                Gate 1 and Gate 2: verdict, date, verdict path, conditions
evidence             the ledger rendered on the home page and /status
caseStudy            the five-condition gate (section 6)
dataset             row counts and the synthetic-data disclosure
```

### 5.1 Every count carries its own evidence

```ts
interface SourcedCount {
  value: number
  label: string
  detail: string
  sources: readonly { path: string; note?: string }[]
}
```

A count cannot exist in the manifest without at least one source path, and `<MetricCount>`
renders those paths as links into the repository. That is the difference between a number
on a portfolio site and a number a reader can check: **every count on this site is one
click from the file it came from.**

The seventeen counts, as currently generated: 3 dealerships, 8 dimensions, 5 facts, 28
reporting views, 29 governed KPIs, 42 semantic relationships, 49 DAX measures, 26 semantic
tables, 20 imported tables, 6 measure tables, 20 supporting measures, 58 reconciliations,
114 data-quality checks, 117 statically asserted model objects, 104 ordered SQL scripts.

Some of those `detail` strings do real work. `daxMeasures` reads _"Written and statically
validated. Never evaluated by an engine."_ The number is impressive; the caveat travels
with it, in the same component, from the same file.

### 5.2 Status is a closed vocabulary

Six levels, defined in `src/types/manifest.ts` and presented by `STATUS_PRESENTATION` in
`src/lib/manifest.ts`, which maps each to a label, an icon and a colour tone.

| Level              | Rendered label              |
| ------------------ | --------------------------- |
| `complete`         | Complete                    |
| `in-progress`      | In progress                 |
| `blocked`          | Blocked                     |
| `pending-external` | Pending external validation |
| `deferred`         | Deferred                    |
| `failed`           | Failed                      |

`pending-external` exists because the other five would all have been wrong for the
semantic model. It is not in progress — nobody is working on it, and no work in this
repository can advance it. It is not blocked by a decision. It is not complete, and it has
not failed. It is _waiting on an environment this project does not have_, which is a real
and distinct state and deserves its own word.

Mapping status to presentation in exactly one place is what makes the vocabulary closed. A
component cannot invent a seventh state, and nothing can render a status without also
rendering its label and icon — which is how the colour-is-never-alone rule in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) section 3.3 is enforced structurally rather than by
review.

---

## 6. The case-study gate

The public analytical case study is prohibited until Gate 2 opens. Enforcing that with a
feature flag alone would be enforcing it with a value one person can flip.

**Five conditions, all evaluated at build time, all required:**

| #   | Condition                                        | Now                         |
| --- | ------------------------------------------------ | --------------------------- |
| 1   | `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED === 'true'` | false                       |
| 2   | `docs/requirements/GATE_2_READINESS.md` exists   | false                       |
| 3   | The recorded Gate 2 verdict is `OPEN`            | false — verdict is `CLOSED` |
| 4   | The case-study content file exists               | false                       |
| 5   | Report screenshots exist                         | false                       |

The flag is **necessary and never sufficient.** Setting it to `true` today changes
nothing, because conditions 2 through 5 are statements about whether the analytical work
has been done, and they are read from the repository. The flag can only ever unlock a case
study that is already justified.

The route renders a `<LockedState>` listing the blocking reasons verbatim from the
manifest. As generated today:

1. The `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` build flag is not set to true.
2. `docs/requirements/GATE_2_READINESS.md` does not exist, so no Gate 2 review has been
   written.
3. The recorded Gate 2 verdict is CLOSED. Its three conditions are: complete report pages,
   reconciled SQL and Power BI totals, and drafted executive findings.
4. The case-study content file has not been written. No findings have been drawn.
5. No report screenshots exist, because no report page exists to screenshot.

That page is not an error state. It is the most honest page on the site: it names exactly
what is missing, links to the gate definition, and explains what would have to be true.

CI runs with the flag **off**, which is its real configuration. A pipeline that only ever
ran with the flag on would not be testing the gate.
`tests/unit/case-study-gate.test.ts` exercises all five conditions in isolation, and
`tests/e2e/case-study-gate.spec.ts` asserts the rendered route.

---

## 7. Gate verdict parsing

Gate verdicts are parsed out of the readiness markdown by `parseGateVerdict()`, anchored
on the phrase `Gate <n> verdict` with a 160-character window, because the verdict sits on
a line after its heading. Prose is a fragile interface, and the parse is deliberately
narrow rather than a loose keyword search: a search for the word `OPEN` anywhere in a
readiness document would match a sentence explaining what would make the gate open.

A missing readiness document is not an error. It means the review has not happened, which
for Gate 2 is the current and correct state, and it produces `verdict: 'CLOSED'` with a
null `recordedOn` and a null `verdictPath`.

---

## 8. Hand-authored content, and what it may not contain

Three files carry structured content no evidence file can produce.

| File                          | Contents                                                                                                            | Provenance                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/content/kpis.json`       | 29 governed + 5 deferred KPIs — formula, numerator, denominator, grain, date basis, null rule, source view, caution | extracted from `KPI_CATALOG.md`                 |
| `src/content/data-model.json` | 13 entities, 42 relationships — grain, keys, history policy, privacy class                                          | extracted from the data dictionary and the TMDL |
| `src/content/architecture.ts` | 14 nodes, 16 edges, with hand-placed diagram coordinates                                                            | authored; the topology matches the pipeline     |

These describe things rather than counting them, which is why they are transcribed rather
than parsed. But they are still checked:
`tests/unit/content-integrity.test.ts` asserts the KPI count matches the manifest's
`governedKpis`, the relationship count matches `semanticRelationships`, and the entity
count matches `dimensions + facts`. A transcription that drifts from the evidence fails
the unit suite.

Coordinates are hand-placed because an auto-layout of a 14-node pipeline produces a
diagram that is technically correct and reads like a circuit board. The topology is
derived; only the geometry is authored.

### 8.1 Content rules

**No analytical finding appears anywhere on the site.** None has been drawn. Nothing on
any route says a dealership underperforms, that a lead source converts better, or that
inventory ages faster at one store — because no report page exists and no analysis has
been run. The domain sections describe **management questions the platform is built to
answer**, phrased as questions, and every one of them is answerable _once report pages
exist_.

**No illustrative number is presented as a dealership result.** The counts are platform
facts — how many views, how many measures, how many reconciliations — never business
outcomes.

**No customer-level detail, real or fictional.** The generator emits no person-level
value, the warehouse contains none by construction (`tests/unit/test_privacy.py` at the
repository root enforces that), and no route displays a row.

**The synthetic-data disclosure appears on every primary route**, not only in the footer,
and `tests/e2e/content-integrity.spec.ts` asserts it route by route. It is also on the
social-preview card, which is the one surface a reader sees before the site loads.

**Banned vocabulary.** The words _revolutionary, cutting-edge, game-changing, seamless,
next-generation, unlocking insights, transforming the industry, leveraging data, robust
solution, powerful platform_ do not appear on the site, and a content-integrity test
asserts that. They are banned not for taste but because each one is a claim with no
referent — they are what copy says when it has nothing to say, and this site has something
to say.

---

## 9. Route metadata

Declared once in `src/lib/site.ts` as `ROUTES`, with `href`, `navLabel`, `title`,
`description`, `inPrimaryNav`, `indexable` and `priority`. Four consumers derive from it:
the primary navigation, `sitemap.ts`, the breadcrumb trail and the accessibility test
sweep. `tests/unit/site.test.ts` asserts they cannot drift.

Adding a route therefore adds it to all four. The failure this prevents is the ordinary
one: a new page that is live, linked and un-indexed because someone forgot the sitemap.

`/ui-lab` is the one route with `indexable: false`. It carries `X-Robots-Tag` on the route
itself rather than in `next.config.ts`, so the header travels with the route if the route
moves, and `robots.ts` disallows it on **every** environment including production. It is
an internal design reference, and it has no business in a search index.

---

## 10. Structured data

`structuredData()` in `src/lib/metadata.ts` emits one JSON-LD graph with exactly four
types: `WebSite`, `Person`, `SoftwareSourceCode`, `CreativeWork`.

What is deliberately absent, and why: no `Product`, no `Review`, no `AggregateRating`, no
`Organization` for a company that does not exist, no testimonial, no award. Every one of
those would be a fabricated machine-readable claim, and structured data is worse than
prose for that because it is consumed without a human reading it.

The `Person` entry claims what the author's own content supports and nothing more. No
completed degree is claimed. No certification badge appears anywhere on the site.

---

## 11. Adding to the site without breaking the contract

| You want to                    | Do this                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Change a count                 | Change the evidence file, then `npm run manifest`. Never edit the manifest.                          |
| Add a count                    | Add a `SourcedCount` to the generator with at least one source path.                                 |
| Change a status                | Change the evidence. The generator will refuse an unsupported status.                                |
| Add a route                    | Add it to `ROUTES`. Nav, sitemap, breadcrumbs and the a11y sweep follow.                             |
| Add a KPI                      | Add it to `KPI_CATALOG.md` first, then to `src/content/kpis.json`. The unit test asserts they agree. |
| Publish the case study         | Open Gate 2. All five conditions, in order. The flag is last, not first.                             |
| Add a colour, size or duration | Add it to `tokens.css`. Nothing else may introduce a raw value.                                      |
