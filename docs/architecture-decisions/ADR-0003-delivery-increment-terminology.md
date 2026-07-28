# ADR-0003: Delivery Increment Terminology

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

ARPI arrived at Phase 1 carrying two numbering schemes that both used the word "phase".

`ARCHITECTURE.md` §27 numbers eight **lifecycle phases** — 1 Product Definition, 2 Data Model,
3 Synthetic Data Generator, 4 PostgreSQL Warehouse, 5 Power BI Semantic Model, 6 Dashboard Development,
7 Findings and Recommendations, 8 Portfolio Packaging. These describe a *kind* of work. They are the
conventional stages of a data product and they overlap freely: the data model keeps growing while the
warehouse is being built.

The delivery documents — `docs/requirements/PHASE_1_BACKLOG.md`, `docs/requirements/README.md`, and the
`P<major>.<minor>-<NN>` identifiers that run through the backlog, the dependency graph, `DATA_DICTIONARY.md`,
`KPI_CATALOG.md`, `LIMITATIONS.md`, and the SQL directory READMEs — use a different scheme: `Phase 0`,
then `Phase 1.1` through `Phase 1.5`. These describe a *unit* of work: a shippable slice with its own
backlog, acceptance criteria, and exit evidence.

The collision is not cosmetic. "Phase 1" named two entirely different bodies of work depending on which
document a reader had open: architecture Phase 1 is Product Definition, which finished before any code was
written, while the Phase 1 backlog is the entire MVP warehouse build. A reader who took the phrase from one
document into the other would draw exactly the wrong conclusion about what was done and what was not. The
ambiguity was registered as `DOC-05` in `docs/requirements/DOCUMENTATION_BACKLOG.md` and marked **High**,
which in that register means "a contradiction a careful reviewer will find".

`docs/requirements/README.md` §3.6 explained the mapping, but it was the only place the mapping existed, and
it lived in the delivery documentation rather than in the architecture the delivery documentation defers to.
A reader arriving through `ARCHITECTURE.md` had no way to know the other scheme existed.

The decision had to be made now rather than later. Every increment adds identifiers, cross-references, test
names, and dependency edges. The cost of settling the terminology grows with each one.

## Decision

**The two schemes are formally distinguished by name, both are retained, and no existing identifier is
renumbered.**

1. The eight numbered phases in `ARCHITECTURE.md` §27 are **lifecycle phases**. Their headings are spelled
   `Lifecycle Phase N: Title`, so the word survives being quoted out of context.

2. `Phase 0` and `P1.1` … `P1.5` are **delivery increments**. Any identifier of the form
   `P<major>.<minor>` is a delivery increment; any identifier of the form `P<major>.<minor>-<NN>` is a
   backlog item inside one. Neither is ever a lifecycle phase.

3. `ARCHITECTURE.md` §27.1 is the **authoritative definition**. It carries the terminology table, the
   lifecycle-phase → delivery-increment mapping, and the delivery-increment → lifecycle-phase mapping.
   `docs/requirements/README.md` §3.6 states the rule and defers to it, rather than being the only place the
   mapping exists.

4. A delivery increment **advances** one or more lifecycle phases; it does not complete them. Lifecycle
   Phase 3 is not finished when `P1.1` ships, because `P1.4` and `P1.5` still generate entities.

5. `Phase 0` keeps its historical name. It is the baseline delivery increment. There is no lifecycle
   Phase 0, so the name is unambiguous even though it does not carry the `P` prefix.

6. Backlog section headings read `Delivery Increment P1.1 — …`, not `Phase 1.1 — …`. The same applies to
   the subgraph labels in the dependency graph and to the backlog summary table.

## Why the existing identifiers were preserved rather than renumbered

The obvious alternative was to rename the delivery phases outright — `Increment 1.1`, or `I1.1-04` instead
of `P1.2-04`. That was rejected for four reasons.

**Identifiers are already declared permanent.** `docs/requirements/README.md` §3.1 states that identifiers
are permanent, that a cancelled item keeps its ID and is marked `Out of scope`, and that numbers are never
reused — "because commits, tests, and pull requests reference them". Renumbering would have been the first
act of the project to violate its own stated rule, in order to fix a documentation problem.

**The reference surface is large and partly outside the requirements directory.** The identifiers appear in
backlog dependency fields, in the Mermaid dependency graph, in the Gate 1 readiness checklist, in
`DATA_DICTIONARY.md` and `KPI_CATALOG.md` status notes, in `LIMITATIONS.md`, in the documentation backlog's
proposed resolutions, and in `sql/` directory READMEs. A rename is a repository-wide mechanical edit with no
way to verify completeness beyond grep, and a missed instance produces a dangling reference to an identifier
that no longer exists — strictly worse than the ambiguity it was meant to fix.

**The ambiguity is in the word, not the number.** Nobody is confused by `P1.2-04`. They were confused by the
prose heading "Phase 1.2" sitting next to a document that numbers a different Phase 1. Fixing the prose fixes
the problem; renumbering fixes the prose *and* breaks the references.

**Renumbering has a recurring cost.** Every future reader who finds an old commit message, an old branch
name, or an old review comment citing `P1.2-04` would need a translation table. Preserving identifiers means
the historical record stays directly readable.

Two identifiers do now sit out of numeric order in the document — `P1.1-06` precedes `P1.1-05`, and
`P1.2-06` precedes `P1.2-04` — because the customer dimension was promoted to first-class items after its
increment had already allocated numbers. This is the visible cost of the permanence rule, and it is accepted.
Each carries an explicit sequence note, and the dependency graph, not the number, is the build order.

## Alternatives considered

**Rename the delivery phases to "Increment 1.1" and renumber the item identifiers.** Cleanest end state,
and it was what `DOC-05` originally proposed as one of two options. Rejected for the four reasons above: it
violates the project's own permanence rule, it is a large unverifiable mechanical edit, it breaks the
historical record, and it fixes the number when the problem is the word.

**Renumber the lifecycle phases instead — call them Stages A–H.** Attractive because the lifecycle phases
have far fewer external references. Rejected because "phase" is the conventional term for what they are, in
every data-engineering and BI methodology a reviewer is likely to know. Inventing a private vocabulary for
the conventional thing, in order to keep a project-specific vocabulary for the unconventional thing, is the
wrong trade. It would also have broken `README.md`, `PRIVACY_AND_ETHICS.md`, `LIMITATIONS.md`, and
`docs/source-to-target/README.md`, all of which cite "§27 Phase N" and none of which the architecture
workstream owns.

**Leave it, and rely on `docs/requirements/README.md` §3.6.** This was the status quo. Rejected because the
explanation lived only in the delivery documentation, so a reader arriving through `ARCHITECTURE.md` never
saw it, and because `DOC-05` was rated High precisely on the grounds that a careful reviewer would find the
contradiction before finding the explanation.

**Drop one scheme entirely.** Retiring the lifecycle phases would remove the vocabulary the scope gates and
the Definition of Done are written in. Retiring the delivery increments would remove the only structure the
backlog has. Both schemes earn their place; they just needed different names.

## Consequences

### Positive

- "Phase 1" is no longer ambiguous. Every occurrence resolves to exactly one scheme by its spelling.
- The mapping is stated in the architecture, which is where a reader arriving cold will look, and the
  requirements directory defers to it rather than duplicating it.
- Every existing identifier, cross-reference, dependency edge, and historical mention remains valid. No
  commit message, branch name, or review comment was invalidated.
- The rule is mechanical enough to check: an identifier shaped `P<n>.<n>` is a delivery increment; a bare
  number under §27 is a lifecycle phase.
- New increments and new backlog items inherit the terminology without further decisions.

### Negative

- Two schemes still coexist. This ADR makes them unambiguous; it does not make them simple. A newcomer must
  still learn that ARPI has both.
- The word "phase" remains in the delivery vocabulary through `Phase 0`, the filename
  `PHASE_1_BACKLOG.md`, and the document title. Renaming the file would break every link to it, so the
  residual inconsistency is accepted and disclosed rather than removed.
- Two backlog items now appear out of numeric order in their sections, which looks like an error until the
  sequence note is read.
- Nothing mechanically enforces the terminology. `scripts/check_naming.py` enforces ADR-0001's retired
  identifiers by pattern; there is no equivalent pattern here, because "Phase 1.2" is not intrinsically
  wrong — it is only wrong as a heading. Enforcement is review discipline, which is weaker than the
  automation ADR-0001 enjoys, and this is stated plainly rather than assumed away.

## Enforcement expectation

Enforcement is by review, with three specific expectations:

1. **New headings** in the requirements directory use `Delivery Increment P1.x`. A heading of the bare form
   `Phase 1.x` is a defect.
2. **New prose** in any document that refers to delivery work refers to it by identifier — `P1.2-04`,
   `P1.3` — rather than by the phrase "Phase 1.2". The identifier is unambiguous on its own.
3. **New lifecycle-phase references** cite `ARCHITECTURE.md §27` and, where the number matters, spell it
   `Lifecycle Phase N`.

If the terminology drifts back — if bare `Phase 1.x` headings reappear in files the requirements workstream
owns — the correct response is to add a pattern check to `scripts/check_naming.py` restricted to
`docs/requirements/**` headings, not to renumber anything. That check is deliberately not written now,
because a check with no observed violations is speculation, and `DOC-05` is being closed on the basis of a
verified grep rather than on the basis of a future guarantee.

## Migration impact

The following changes were made when this decision was adopted. This list is the complete set.

| Area | Before | After |
|---|---|---|
| `ARCHITECTURE.md` §27 title | `Implementation Phases` | `Implementation Lifecycle Phases`, with an opening paragraph that names the distinction |
| `ARCHITECTURE.md` §27 headings | `### Phase 1: Product Definition` … `### Phase 8: Portfolio Packaging` | `### Lifecycle Phase 1: Product Definition` … `### Lifecycle Phase 8: Portfolio Packaging` |
| `ARCHITECTURE.md` §27 | No cross-reference to the delivery numbering | New §27.1 with the terminology table and both mapping directions |
| `ARCHITECTURE.md` §2 | Architecture version 1.1 | Architecture version 1.2 |
| `docs/requirements/PHASE_1_BACKLOG.md` §§2–6 headings | `## 2. Phase 1.1 — …` | `## 2. Delivery Increment P1.1 — …` |
| `docs/requirements/PHASE_1_BACKLOG.md` graph | Subgraph labels `Phase 1.1 — Source generation` | `Delivery Increment P1.1 — Source generation` |
| `docs/requirements/PHASE_1_BACKLOG.md` summary | Rows labelled `Phase 1.1` … `Phase 1.5` | Rows labelled `` `P1.1` `` … `` `P1.5` `` |
| `docs/requirements/README.md` §3.6 | Sole owner of the mapping, titled "Relationship to the architecture's phase numbering" | Titled "Lifecycle phases versus delivery increments", states the rule, defers to `ARCHITECTURE.md` §27.1 |
| Item identifiers | `P1.1-01` … `P1.5-04` | **Unchanged.** No identifier was renumbered, reused, or retired. |

No code, SQL, configuration, database object, or generated data file references either numbering scheme, so
the change is confined to documentation.

## Relationship to other records

- **ADR-0001** established that identifiers in this project are decided once and then enforced. This record
  applies the same discipline to the phase vocabulary, with the honest caveat that the enforcement here is
  review rather than automation.
- `ARCHITECTURE.md` §27.1 is the normative statement of this decision.
- `docs/requirements/README.md` §3.1 is the permanence rule that made renumbering the wrong answer.
- `DOC-05` in `docs/requirements/DOCUMENTATION_BACKLOG.md` is the gap this record closes.
