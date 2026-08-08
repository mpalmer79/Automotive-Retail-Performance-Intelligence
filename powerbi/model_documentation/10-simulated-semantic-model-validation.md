# Simulated Semantic-Model Validation — Method and Limits

**Last reviewed:** 2026-08-08
**Parent:** [README.md](README.md)
**Governing record:** [ADR-0014](../../docs/architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md)

---

## 0. The disclaimer, before anything else

**This is not a Power BI validation.** It is not a Power BI Desktop validation, not a Microsoft Fabric
validation, and not Gate 2 evidence. No Microsoft semantic-model engine is launched, contacted or consulted
at any point in producing it. Real-engine validation is an external manual dependency and remains
**externally pending** on both accepted paths — see
[08-desktop-validation.md](08-desktop-validation.md) and
[ADR-0008](../../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md).

Everything below describes a **development proxy**: a second implementation of the model's declared
semantics, run against a hand-built fact source, used to catch the class of defect that would otherwise wait
for an engine run that has not happened.

---

## 1. What it actually does

`python scripts/simulate_semantic_model.py` parses the committed TMDL, builds the relationship graph,
evaluates all forty-nine measures in eleven filter contexts, and compares every result against an
independently written implementation of the governed SQL definition of the same measure. It then checks the
identities the measure graph implies against the real governed numbers in
[`../validation/sql_baseline.json`](../validation/sql_baseline.json).

Three files do the work, and the separation between them is the point:

| File | Role |
|---|---|
| [`scripts/dax_simulation.py`](../../scripts/dax_simulation.py) | Reads the TMDL and evaluates a subset of DAX with real filter context: propagation from the one side to the many side, `CALCULATE` overwrite semantics, `USERELATIONSHIP`, `LASTNONBLANKVALUE`, `DIVIDE`'s blank-on-zero rule, and DAX's BLANK arithmetic |
| [`scripts/simulated_sql_truth.py`](../../scripts/simulated_sql_truth.py) | Computes the same measures straight from the rows, using the governed definition in [`KPI_CATALOG.md`](../../KPI_CATALOG.md) and **nothing from the TMDL** |
| [`scripts/simulate_semantic_model.py`](../../scripts/simulate_semantic_model.py) | Runs ten families of check, compares the two, and writes the artifact |

A single implementation checked against itself proves nothing. Two implementations of one set of governed
definitions, disagreeing, is a finding.

### The ten families

| # | Family | What a failure here means |
|---|---|---|
| 1 | Structure | Composed from [`check_powerbi_model.py`](../../scripts/check_powerbi_model.py), not repeated |
| 2 | Fact-source conformance | The fact source names a column or table the model does not have — usually a rename that has not propagated |
| 3 | Expression coverage | A measure uses DAX outside the simulated subset. Reported as **NOT SIMULATED**, never as a pass |
| 4 | Measure metadata | An annotation disagrees with the expression: wrong `ARPI_SourceTable`, a `ARPI_DateBasis` no relationship uses, a declared `ARPI_UsesRelationship` with no `USERELATIONSHIP` in the DAX, or the reverse |
| 5 | Reconciliation | The model's semantics and the governed SQL semantics return different numbers |
| 6 | Zero denominators | A ratio returned zero, or an error, where it must return BLANK |
| 7 | Blank and null | A `+ 0` measure returned BLANK, a gross total returned zero with no sale behind it, or a null column was read as zero |
| 8 | Aggregation | An additive measure does not add up across the store partition, or a semi-additive measure does — the specific regression of "simplifying" `LASTNONBLANKVALUE` into a `SUM` |
| 9 | Filter context | A condition filter reached the lead or appointment grain, which no relationship carries it to; or the show-date basis stopped differing from the scheduled-date basis |
| 10 | Baseline algebra | The governed SQL baseline does not satisfy an identity the measure graph implies — for example `KPI-GRS-004 ≠ KPI-GRS-001 / KPI-SLS-001` in some filter context |

Family 10 is the only one that reads real governed numbers. Those numbers are SQL results from the
development-profile database; the DAX side of that comparison does not exist and cannot until an engine runs.
What family 10 checks is that the **SQL side is internally consistent with the decomposition the measures
declare** — which is a real check, and is not reconciliation. The reconciliation method itself is
[09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md), and it remains unperformed.

---

## 2. The fact source

[`../validation/simulated_fact_source.json`](../validation/simulated_fact_source.json) is a hand-built set of
rows across twelve tables — three stores, six calendar dates in two months, seven sales, six leads, five
appointments, nine inventory snapshots. It is **not dealership data, not the development database, and not a
sample of either**. Every row exists to make one behaviour falsifiable:

* a **wholesale sale** with null retail columns, so that "SUM skips nulls" is not the same as "SUM reads them
  as zero";
* a store whose **only lead was never contacted**, so that Appointment-Set Rate has a genuine zero
  denominator;
* a store with **attributed leads and no spend**, so that Cost per Lead's `ISBLANK(Spend)` guard is
  distinguishable from a zero-denominator BLANK;
* an appointment **scheduled on 30 November and shown on 1 December**, which is the only row in the fixture
  that tells the two appointment date bases apart. Delete the `USERELATIONSHIP` from Show-to-Sale Conversion
  and this row makes December BLANK;
* **two snapshot dates**, so that a semi-additive measure has something to be wrong about;
* a **sale with zero gross**, so that zero and BLANK stay distinguishable.

Rows are sparse: a row declares only the columns the simulation reads, and every other column is absent,
which the engine reads as BLANK. Declared columns are checked against the committed TMDL, so a renamed
column fails the run rather than being silently ignored.

---

## 3. What it cannot do

Read this section before quoting a number from the artifact.

* **It is not an engine.** The subset it implements is the DAX this model happens to use. It has no row
  context, no iterators, no context transition, no time intelligence, no calculation groups, and no query
  plan. A model that used any of those would be reported as NOT SIMULATED, not as passing.
* **It does not touch the production data.** Every reconciled number comes from eleven rows of arithmetic.
  Agreement on the fact source is not agreement on 650 sales.
* **It does not model the storage layer.** No refresh, no Power Query, no credential, no data-type coercion,
  no currency rounding, no format string, no performance, no memory.
* **It has no blank row and no referential-integrity semantics.** A dimension propagates a filter only when
  it is itself filtered, and a fact row whose key matches no dimension row behaves differently here than in a
  real engine.
* **It shares an author with the model.** The two implementations are independent code paths reading one set
  of governed definitions. A defect in the governed definition itself is invisible to both.
* **It cannot close anything.** Not Gate 2, not Lifecycle Phase 5, not any part of the ADR-0008 proof
  obligation. When a real engine finally runs and disagrees with this simulation, the engine is right.

---

## 4. Running it

```bash
python scripts/simulate_semantic_model.py           # run and rewrite the artifact
python scripts/simulate_semantic_model.py --check   # CI mode: fail if the artifact would change
python scripts/check_simulation_labels.py           # fail if anything calls this a real validation
```

The artifact is [`../validation/simulated_semantic_model_results.json`](../validation/simulated_semantic_model_results.json).
It is deterministic — no timestamp, no random input — so `--check` is a byte comparison, and a model change
that moves a number fails CI until the artifact is regenerated and reviewed.

Its first six fields exist to stop it being quoted as something it is not:

```json
{
  "validation_kind": "SIMULATED SEMANTIC-MODEL VALIDATION",
  "is_real_engine_result": false,
  "gate_2_real_engine_validation": "PENDING",
  "desktop_validation": "PENDING",
  "fabric_validation": "PENDING",
  "model_source_hash": "..."
}
```

The three status fields are **read from the real evidence files**, not written by hand. If a Desktop or
Fabric result ever lands, they change because the evidence changed, and
`scripts/check_simulation_labels.py` fails the build until the artifact is regenerated to match.

---

## 5. Labelling

The artifact carries `SIMULATED SEMANTIC-MODEL VALIDATION` and may never be described as **Power BI
validated**, **Desktop validated**, **Fabric validated**, or **Gate 2 passed**.
[`scripts/check_simulation_labels.py`](../../scripts/check_simulation_labels.py) enforces this over every
tracked text file: a line that names a simulated artifact and also makes one of those claims fails the
build. Denials are always allowed — this page is full of them, deliberately.

---

## 6. Related documents

- [08-desktop-validation.md](08-desktop-validation.md) — the real Desktop path and its five states
- [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md) — the real reconciliation method, unperformed
- [ADR-0008](../../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) — the two accepted real-engine paths
- [ADR-0014](../../docs/architecture-decisions/ADR-0014-gate-2-external-manual-validation-dependency.md) — why this layer exists and what it may be called
- [LIMITATIONS.md](../../LIMITATIONS.md) — the project-wide statement of what is not proven
