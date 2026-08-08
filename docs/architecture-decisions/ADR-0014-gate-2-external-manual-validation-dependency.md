# ADR-0014: Gate 2 as an External Manual Validation Dependency

## Status

**Accepted**

## Date

2026-08-08

## Deciders

Michael Palmer

## Context

[ADR-0008](ADR-0008-real-engine-validation-paths.md) settled what real-engine validation *is*: either
Power BI Desktop or the Microsoft Fabric Service, an identical seven-part proof obligation, evidence pinned
to the model source hash, and static parsing never sufficient on its own. That record is correct and is not
being revisited. What it did not settle is what the rest of the project does **while** the obligation goes
unmet.

Both paths need something the project does not have. Desktop needs Windows. Fabric needs a tenant, a
workspace and a cloud PostgreSQL database. Neither is a defect in the model, neither is discoverable by any
check in this repository, and neither is going to be resolved by another increment of engineering work. The
dependency is external, manual, and deliberately deferred.

The repository handled that honestly, and the honesty machinery works: two evidence files that record
`pending` with a hash, five states in
[`scripts/check_real_engine_validation.py`](../../scripts/check_real_engine_validation.py), a capability
checker that fails when prose overstates what exists, and a documented refusal to call static parsing
validation. None of that is in question here.

What is in question is **repetition**. By `DASH.8` the pending status was being restated in design
discussions, implementation logs, review notes and progress summaries for increments that touch no TMDL, no
DAX and no Power BI artifact at all. That has three costs, and the third is the serious one:

* **It buries the increment.** A summary whose most prominent sentence is about a gate the increment did not
  approach is a summary that has to be read twice to find out what happened.
* **It spends review attention on a settled fact.** The status has not changed since PR #8 and will not
  change until a person opens Desktop or stands up a workspace.
* **It devalues the warning.** A caution repeated where it does not apply is trained to be skipped, and the
  places it *does* apply — an increment that changes a measure, a test that catches a semantic-model
  regression — are exactly the places where being skipped is dangerous. Honesty machinery that has become
  wallpaper has stopped being honesty machinery.

Meanwhile, `DASH.9` through `DASH.13` are accounting, console, documentation and release work over the
`reporting` schema and the versioned exports. Not one of them needs a number from a Microsoft engine.
Sequencing them behind a dependency they do not have would be false sequencing.

There is also something the project *can* build and had not. Between "the TMDL parses" and "an engine
returned a number" sits a large class of defects — a measure reading the wrong column, a ratio with the
wrong denominator, a funnel measure on the wrong date basis, a lost `USERELATIONSHIP`, a semi-additive
measure quietly made additive — that a second implementation of the model's declared semantics catches
without any engine at all. Not building that, on the grounds that only a real engine counts, leaves those
defects to be found by the engine run that has not happened.

## Decision

**Gate 2 real-engine validation is reclassified as an EXTERNAL MANUAL VALIDATION DEPENDENCY. It does not
block delivery increments `DASH.9` through `DASH.13` unless the increment directly requires a result from a
real Microsoft semantic-model engine. Its status in the repository stays exactly as truthful as it is now,
and a simulated validation layer is built and maintained as a development proxy that may never be described
as the real thing.**

Six parts, each binding.

### 1. The dependency is external and manual, not a work item

Gate 2 is not a task on the DASH board and must not be scheduled as one. It is satisfied by a person, on a
machine this project does not own, running one of the two ADR-0008 paths. Nothing that can be typed in this
repository advances it. The evidence files, the freshness checks and the gate script stay exactly as they
are; this record changes none of them.

The truthful state is preserved and stays machine-read, never asserted in prose:

| Fact | State |
|---|---|
| Gate 2 real-engine validation | **PENDING** — the gate is CLOSED |
| Power BI Desktop validation | **PENDING** |
| Microsoft Fabric validation | **PENDING** |

### 2. What "directly requires a real engine result" means

An increment is blocked by Gate 2 only when it cannot be completed without a number that only a Microsoft
semantic-model engine can produce. In practice that is a short list: recording a passing engine result,
turning on `--require-pass`, publishing a report page whose correctness depends on evaluated DAX, closing
Lifecycle Phase 5, and any claim that the model has been validated. Everything else — including every
increment that *changes* the model — proceeds, because changing a model that has never been evaluated does
not require it to have been evaluated first.

`DASH.9`–`DASH.13` are not on that list. They proceed.

### 3. When Gate 2 is mentioned, and when it is not

Mention it in five situations, and otherwise do not:

1. The increment changes TMDL, DAX, semantic-model relationships, or a Power BI artifact.
2. A test detects a semantic-model-related regression.
3. The final increment or the release audit needs the status.
4. Someone asks.
5. A document's subject *is* validation status — the evidence files, `08-desktop-validation.md`,
   `09-sql-to-dax-reconciliation.md`, `LIMITATIONS.md`, `FINAL_RELEASE_AUDIT.md`, and this record.

For ordinary `DASH.9`+ implementation work, one line at the end of the report is the whole disclosure:

> Power BI real-engine validation remains externally pending; this increment does not change that state.

That line is not optional and it is not a formality. It is the complete disclosure for an increment that did
not approach the gate, and it replaces — rather than accompanies — the paragraph that used to be written.

**This is a rule about repetition, not about candour.** Nothing here permits a document to say the model is
validated, to imply an engine has run, to omit the status where a reader would be misled without it, or to
soften what the evidence files say. The prohibition on overstating remains absolute; what is prohibited now
is restating.

### 4. A simulated semantic-model validation layer is built and maintained

The layer is
[`scripts/simulate_semantic_model.py`](../../scripts/simulate_semantic_model.py), a DAX-subset evaluator in
[`scripts/dax_simulation.py`](../../scripts/dax_simulation.py), an independently written SQL-side reference
in [`scripts/simulated_sql_truth.py`](../../scripts/simulated_sql_truth.py), a hand-built fact source, and a
committed result artifact. It checks TMDL structure, table and relationship definitions, measure metadata,
expected KPI outputs against the governed SQL definitions, numerator and denominator behaviour, filter-context
assumptions, blank and null behaviour, zero-denominator behaviour, aggregation and semi-additive behaviour,
and the algebraic identities the measure graph implies — the last of those against the real governed numbers
in `powerbi/validation/sql_baseline.json`. The method is documented in
[`powerbi/model_documentation/10-simulated-semantic-model-validation.md`](../../powerbi/model_documentation/10-simulated-semantic-model-validation.md).

Two implementations of the same governed definitions, compared. That is what makes it worth having: a single
implementation checked against itself proves nothing.

### 5. What the layer is called, and what it may never be called

Every artifact it produces carries the label:

```text
SIMULATED SEMANTIC-MODEL VALIDATION
```

It may never be labelled **Power BI validated**, **Desktop validated**, **Fabric validated**, or **Gate 2
passed**, and no document may attach those claims to it.
[`scripts/check_simulation_labels.py`](../../scripts/check_simulation_labels.py) fails the build when one
does, and also fails when the simulated artifact records an engine state that the real evidence files do not
support. A denial — "this is not a Power BI validation" — is always permitted, because saying what a thing is
not is the point.

### 6. Passing the simulation is sufficient to continue, and never sufficient to close

A green simulation lets engineering proceed with justified confidence. It does not close Gate 2, does not
complete Lifecycle Phase 5, does not satisfy any part of the ADR-0008 proof obligation, and does not permit
`--require-pass` to be turned on. When a real engine finally runs and disagrees with the simulation, the
engine is right and the simulation has a bug.

## Alternatives considered

**Keep restating the status in every increment.** The status quo, and the reason this record exists. It is
maximally cautious sentence by sentence and counterproductive in aggregate: the warning is diluted precisely
where it matters by being repeated where it does not. Rejected because a caution that has been trained to be
skipped is worse than one issued deliberately.

**Stop mentioning it at all until the release audit.** Clean, and wrong. An increment that changes a measure
must say that the change is unevaluated, and a test that catches a semantic-model regression must say what
would have caught it earlier. Rejected because it converts a repetition problem into an omission problem.

**Mark the semantic model `Deferred` and remove it from the active surface.** This would end the question by
withdrawing the artifact. Rejected: the model exists, is statically validated, is the canonical analytical
product per ADR-0013, and is nearly the whole of Phase 2. Withdrawing it to avoid discussing its validation
state would be a larger distortion than the one being fixed.

**Record a simulated result in the real evidence files.** Never seriously considered as a design, considered
here only to state its rejection explicitly and permanently. Writing a simulated pass into
`desktop_validation_results.json` or `fabric_validation_results.json` would make every downstream check —
the freshness hash, the gate script, the capability checker, the console's trust panel — report a validation
that did not happen. The simulated layer therefore writes to its own file, with its own schema, its own
label, and three fields that restate the real engines' states as read from the real evidence.

**Do the real validation now instead.** The preferred outcome and not available: no Windows machine, and no
Fabric tenant, workspace or cloud database. This record does not replace that work, and deliberately keeps
`--require-pass` one line away from being switched on the day evidence lands.

**Build no simulation and wait for the engine.** Rejected. It leaves a catchable class of defect uncaught for
an unbounded period, and it treats "only an engine counts" — true about *validation* — as though it were also
true about *testing*, which it is not.

## Consequences

### Positive

* `DASH.9`–`DASH.13` proceed on their own merits, sequenced by their real dependencies.
* The Gate 2 warning regains its meaning by being issued where it applies.
* A class of semantic-model defect becomes catchable now, in CI, with no engine — every measure evaluated in
  every simulated filter context by two independent implementations, plus the measure graph's identities
  checked against the governed SQL baseline. The counts are recorded in the artifact rather than repeated
  here, so that they cannot go stale in prose.
* The disclosure rule is written down, so it is reviewable and can be argued with, rather than being an
  unstated habit that varies by session.
* The distinction between simulated and real validation is enforced mechanically rather than by care.

### Negative

* **A new artifact exists that can be misread as validation.** That is the whole risk of this decision. It is
  mitigated by the label, the three engine-state fields, the documentation, and a check that fails the build
  on the misreading — and mitigation is not elimination. A reader determined to skim will still skim.
* **The simulation can be wrong in the same direction as the model.** Both are written by the same hands from
  the same governed definitions. The independence is real but partial: two implementations, one author, one
  reading of `KPI_CATALOG.md`. It will not catch a defect that lives in the governed definition itself.
* **The fact source is eleven rows of arithmetic, not data.** It is designed to make behaviours falsifiable,
  not to be representative. Nothing about scale, performance, refresh, data types, currency rounding or
  format strings is exercised, and none of those can be.
* **Maintenance cost.** A measure added without a matching reference implementation will fail the run, which
  is the correct behaviour and is still work.
* **A judgement call sits at the boundary.** "Directly requires a real engine result" is defined in §2 but
  will occasionally need a decision. When it is genuinely unclear, the increment mentions the gate — the
  cost of one extra sentence is smaller than the cost of a missing one.

## Enforcement

| Mechanism | What it holds |
|---|---|
| [`scripts/check_simulation_labels.py`](../../scripts/check_simulation_labels.py) | The label, the `is_real_engine_result: false` field, no forbidden claim on any line naming a simulated artifact, and agreement with the real evidence files |
| [`scripts/simulate_semantic_model.py --check`](../../scripts/simulate_semantic_model.py) | The committed artifact is what the current model actually produces |
| [`scripts/check_real_engine_validation.py`](../../scripts/check_real_engine_validation.py) | Unchanged by this record. `STALE` and `FAILED` still block every branch |
| [`tests/unit/test_simulated_semantic_model.py`](../../tests/unit/test_simulated_semantic_model.py) | The simulation's checks have teeth: each is shown failing against a mutated model |
| [`CLAUDE.md`](../../CLAUDE.md) | The disclosure rule, written where the sessions doing the work will read it |

## Relationship to other records

* **ADR-0007** fixed the project format and first named Desktop validation as a manual gate. Unaffected.
* **ADR-0008** defines the two accepted paths and the proof obligation. **This record does not modify,
  narrow, or supersede any part of it.** It governs what happens elsewhere while ADR-0008's obligation is
  outstanding.
* **ADR-0009** built the portfolio UI foundation before Gate 2 under stated constraints. This record extends
  the same reasoning — proceed on what is proven, state what is not — to the remaining DASH increments.
* **ADR-0013** authorized the web operating console and left Gate 2 untouched. Still untouched.
