# Real-Engine Validation — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

> **A note on the filename.** This file is called `08-desktop-validation.md` because when it was written
> there was only one way to validate the model, and it ran on Power BI Desktop. There are now two, and this
> document covers both. The filename is **historical and deliberately unchanged**: it is linked from
> `ARCHITECTURE.md`, the Phase 2 backlog, ADR-0007, ADR-0008 and the sibling documents in this directory,
> and renaming it would break every one of those inbound links to fix a cosmetic mismatch. The document's
> subject is the gate, not the product that closes it.

> ## CURRENT STATUS: **PENDING ON BOTH ENGINES**
>
> **Desktop: pending. Fabric: pending.**
>
> **No Microsoft semantic-model engine has ever loaded this model.** It has not been refreshed, no measure
> has been evaluated, no total has been checked, and no format string has been rendered. The status is not
> "passing with caveats" and not "expected to pass". It is **PENDING**, and it stays PENDING until one of
> the two paths below is run in full and the result is recorded.

---

## 1. What real-engine validation is

Real-engine validation is the act of putting the committed TMDL in front of a **Microsoft semantic-model
engine**, refreshing it against a populated database, and observing what the engine does. It is `P2.1-09` in
[PHASE_2_BACKLOG.md](../../docs/requirements/PHASE_2_BACKLOG.md), and the two accepted ways of doing it are
fixed by
[ADR-0008](../../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md).

It is the only evidence that matters for a semantic model, and every other check in this repository is a
proxy for it. The reason is a hard boundary rather than a matter of thoroughness: **static analysis of a
model can only prove structural things.**

| A parser can confirm | A parser cannot confirm |
|---|---|
| A relationship names columns that exist on both tables | The engine accepts the relationship graph and finds no ambiguous path |
| Every measure lives on a measure table | Any measure parses as DAX in the engine's grammar |
| No `crossFilteringBehavior` is declared | Filter propagation behaves as the design assumes |
| Every partition names an object in `reporting` | The connection succeeds and the view exists |
| Every measure has a format string | The format string renders, or renders as intended |
| Twenty tables are declared | Twenty tables load, with the row counts expected |
| `LASTNONBLANKVALUE` appears in seven measures | A month selection returns a closing position rather than a sum |
| No credential appears in any file | — (this one is complete on its own) |

Everything in the right-hand column requires evaluation, and evaluation requires an engine.

**The static suite passes 9,452 assertions.** That number reads like thorough validation, and it is thorough
validation of the left-hand column. The gap between the two columns is not a gap of degree, and no quantity
of left-hand-column assertions crosses it.

---

## 2. The two accepted paths

ADR-0007 named Power BI Desktop as the only path. That coupled a governance gate to one operating system and
one desktop application, and the repository owner has no Windows machine, no Windows virtual machine and no
access to Power BI Desktop — so the gate was not merely unclosed, it was unreachable by the person who owns
the project. ADR-0008 fixes that by naming the **capability** rather than the product.

| | **Path A — Power BI Desktop** | **Path B — Microsoft Fabric Service** |
|---|---|---|
| **Engine** | Desktop's in-process tabular engine | The Fabric Service's semantic-model engine |
| **Runs on** | Windows, interactively | Any machine with a browser and a shell, including a Chromebook |
| **How the model gets there** | Desktop opens the `.pbip` directly | The committed `.SemanticModel/definition/` tree is posted through the Fabric semantic-model definition APIs |
| **Database** | A local PostgreSQL `reporting` schema | A **cloud** PostgreSQL `reporting` schema — the Service cannot reach `localhost` |
| **How DAX is evaluated** | A person runs `powerbi/validation/validation_queries.dax` in Desktop or DAX Studio | The same file is submitted through the Power BI Execute Queries REST API |
| **Credential lives in** | The Windows credential store | The Fabric workspace connection |
| **Procedure** | `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` | `docs/powerbi/FABRIC_SERVICE_HANDOFF.md` |
| **Evidence file** | `powerbi/validation/desktop_validation_results.json` | `powerbi/validation/fabric_validation_results.json` |
| **Schema** | `powerbi/validation/validation_results.schema.json` | `powerbi/validation/fabric_validation_results.schema.json` |
| **Deployment tooling** | `scripts/validate_powerbi_model.ps1`, run on Windows | `scripts/deploy_powerbi_fabric.py` and `scripts/validate_powerbi_fabric.py`, authenticating by delegated device code |
| **Backlog items** | None — nothing to build; it needs a machine | `P2.1-11` … `P2.1-14` |
| **Status** | **PENDING** | **PENDING** |

**The paths are of equal standing.** Neither is a fallback for the other, and **both are never required**: a
current PASSED result on one path closes `P2.1-09`. A project with a green Desktop result and no Fabric
result is fully validated, and so is the reverse.

The one thing Path A proves that Path B does not is the **save-and-review-the-diff** step: Desktop rewrites
the on-disk PBIP when it saves, and reviewing that diff is how a preview-format change is detected rather
than absorbed silently. Path B never writes to the repository's model files, so it cannot exercise that.
This is recorded as a difference in coverage, not as a reason to prefer one path.

---

## 3. The proof obligation, which is identical on both paths

Two paths are only acceptable if they prove the same thing. Otherwise the project has one gate and one
weaker thing that people reach for when the gate is inconvenient.

A run on **either** path completes `P2.1-09` only when it proves **all seven** of the following:

| # | Obligation | Tolerance |
|---:|---|---|
| 1 | **A Microsoft semantic-model engine accepted the TMDL definition**, with no model-load error and specifically no ambiguous-relationship error | Binary |
| 2 | **All twenty imported tables refreshed** | Binary. Nineteen of twenty is a failure |
| 3 | **Expected row counts are present**, against `powerbi/validation/sql_baseline.json` | **Zero** |
| 4 | **All forty-two relationships exist**, with the recorded 32 active / 10 inactive split | Binary |
| 5 | **All forty-nine measures exist** and every one evaluates without error | Binary |
| 6 | **DAX results match the governed SQL baseline in every filter context** | `validation.numeric_absolute_tolerance` |
| 7 | **The recorded evidence carries the current model-source hash** | Binary — see §5 |

Obligation 6 means *every* context in the baseline, not a sample and not the unfiltered total alone. A
measure can have a correct grand total and be wrong under every filter that matters; the method and the
twenty-one contexts are in [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md).

**A run that discharges six of the seven has not validated the model.** There is no partial credit and no
provisional pass, on either path.

---

## 4. The five states, reported per engine

A single boolean would be dishonest here, because "not validated" has several distinct meanings and they
call for different actions. The states are the same for both engines and are reported **separately for
each**, because Desktop PENDING and Fabric PASSED is a perfectly ordinary state of the world and a single
combined status could not express it.

| State | Meaning | What it says about the model | Action |
|---|---|---|---|
| **Static validation passed** | The TMDL parses and satisfies every structural expectation in `powerbi/validation/model_expectations.json`. | The model is well-formed text. Nothing more. | None. This is the CI baseline, not an achievement, and it is not per-engine — it is the same fact for both. |
| **PASSED** | The engine loaded, refreshed and evaluated the model, all seven obligations of §3 were discharged, and the recorded model-source hash matches the current one. | The model works, on that engine, against the profile and on the date recorded. | None. This is the only state in which the model may be described as validated. |
| **PENDING** | The result file exists with `overall_result: "pending"` and a null hash. That engine has never run. | Unknown. The model may fail to load. | Run `P2.1-09` on that path. **This is the current state of both engines.** |
| **STALE** | A result exists for that engine, but the model-source hash has changed since it was recorded. | The evidence describes a model that no longer exists. | Re-run the gate. Stale is treated as Pending for gating purposes, never as a weaker form of Passed. |
| **FAILED** | A validation was performed on that engine and a step did not pass. | Known broken, in a recorded way. | Fix the defect, then re-run. A failed result is **not** deleted; it is superseded. |

A sixth state, **MISSING**, is reported when there is no result file at all for an engine. It is
distinguished from PENDING deliberately: PENDING is a recorded statement that validation has not happened,
while MISSING means the record itself is absent, which is a different problem with a different fix.

PENDING exits zero so that it does not block a branch while `P2.1` is in flight; STALE, FAILED and MISSING
exit non-zero. The word PENDING appears in the output of every run, so nobody can mistake "not yet
validated" for "validated".

Four rules govern the states.

* **Pending and Stale are not Passed.** `P2.2` is blocked by both, identically, on both engines.
* **One current PASSED result closes the gate.** Requiring both engines would turn an alternative into an
  additional requirement and make the gate harder to reach than it was before ADR-0008, which is the
  opposite of what that record decided. `main` requires **at least one** current PASSED result, and neither
  engine passing on its own must ever fail CI. That policy is implemented as a `--require-pass` mode on
  `scripts/check_real_engine_validation.py` and is **deliberately not enabled yet**: enforcing it while both
  engines are PENDING would break `main` for a condition nobody can currently clear, which teaches people to
  route around a check rather than satisfy it. It is enabled in the same change that lands the first passing
  result.
* **A failed result is recorded, not discarded.** A validation history in which only successes survive is a
  history that proves nothing. A refresh that loads nineteen of twenty tables is a failure, recorded as one
  — there is no partial credit.
* **Static validation never promotes to a passed real-engine result.** No accumulation of structural checks
  reaches the other column of §1's table.

**CI reads evidence; it does not produce it.** CI must never attempt to launch Power BI Desktop — a hosted
Windows runner changes the operating system without changing the answer, because it still has no Desktop
installation and no licence — and must never contact a Fabric workspace, because a CI job holding a Fabric
credential would move the credential boundary into a place no reviewer can inspect. CI output says *"static
model checks passed"* and never *"the model is valid"*. The distinction is not pedantry: the first is a
statement about text, and the second would be a statement about behaviour nobody has seen.

---

## 5. The model-source-hash freshness mechanism

**Evidence with no freshness rule is evidence about a file that no longer exists.**

A validation result is a statement about a specific model at a specific moment. Change one measure and the
statement is no longer about the model in the repository — but the recorded result still sits there looking
like a pass, and nothing about it announces that it has expired.

The mechanism: a **SHA-256 hash is computed over the semantic-model definition files** — `database.tmdl`,
`model.tmdl`, `expressions.tmdl`, `relationships.tmdl`, every file under `definition/tables/`, plus
`definition.pbism` — taken in sorted relative-path order, with each path and each file length mixed in so
that renaming or splitting a file changes the hash. It is recorded as `model_source_hash` alongside **every**
validation result, on either engine. On every run, the freshness check recomputes the hash over the current
files and compares; `--print-hash` emits the current value for recording.

| Comparison | Reported as |
|---|---|
| Current hash equals the hash recorded for that engine | That engine's result stands |
| Current hash differs from the hash recorded for that engine | **STALE** — the gate must be run again |
| No result recorded for that engine | **PENDING** |

Four properties worth stating:

* **The hash covers the model, not the repository.** A change to this document does not stale a result,
  because this document is not the model. A change to one measure does, because it is. The `.pbip` file and
  the two `.platform` files are excluded for the same reason: they do not affect what a refresh does.
* **The hash is engine-independent, so a model change stales both engines at once.** It describes what was
  validated, not who validated it. A Desktop PASSED and a Fabric PASSED recorded against the same model go
  stale together, in the same run, which is correct: the thing that changed is the thing they both attested
  to.
* **It cannot distinguish a trivial change from a substantive one**, and deliberately does not try. A
  whitespace change and a rewritten measure both stale the evidence. Re-running the gate is cheaper than
  building a rule for which edits are safe, and any such rule would eventually be wrong in the direction
  that matters.
* **The report shell is excluded.** The `.Report` folder has no bearing on whether the semantic model loads
  and refreshes, and including it would stale the model's evidence every time a page changed in `P2.2`.

---

## 6. The contract of the evidence files

Each result is recorded as **structured data, not prose**, and validated against a JSON Schema (draft-07,
`additionalProperties: false`). A hand-recorded result that omits a field is caught by the schema rather
than discovered later by a reader who assumed the field was implied.

| Engine | Evidence file | Schema |
|---|---|---|
| Power BI Desktop | `powerbi/validation/desktop_validation_results.json` | `powerbi/validation/validation_results.schema.json` |
| Microsoft Fabric Service | `powerbi/validation/fabric_validation_results.json` | `powerbi/validation/fabric_validation_results.schema.json` |

### 6.1 The Desktop result

Four fields are **required**; the rest are nullable and are null while the state is PENDING.

| Field | Required | Why it exists |
|---|---|---|
| `schema` | **Yes** | `arpi.desktop_validation_results/1`. Fixes the contract version, so a later shape is a new version rather than a silent reinterpretation. |
| `validated_at` | **Yes** | UTC ISO-8601 instant. Null when it has never run. An undated result cannot be reasoned about. |
| `model_source_hash` | **Yes** | The SHA-256 of §5, at the time of validation. Without it, freshness cannot be computed at all. Null when it has never run. |
| `overall_result` | **Yes** | `passed`, `failed` or `pending` — an enum, not free text, so "mostly passed" cannot enter the record. `pending` is not a pass and CI must never render it as one. |
| `power_bi_desktop_version` | No | PBIP, TMDL and PBIR are preview surfaces. A result is only meaningful for the Desktop build that produced it, and a later build may change the on-disk shape. |
| `compatibility_level` | No | The tabular compatibility level the running model reported. The committed `database.tmdl` declares 1567. |
| `refresh_result` | No | `succeeded`, `failed` or `not attempted`. |
| `table_count`, `imported_table_count`, `measure_table_count` | No | 26, 20 and 6 as built. Compared against `powerbi/validation/model_expectations.json`. |
| `relationship_count`, `active_relationship_count`, `inactive_relationship_count` | No | 42, 32 and 10 as built — obligation 4 of §3. |
| `measure_count` | No | 49 as built — obligation 5 of §3. |
| `row_counts` | No | Rows loaded per imported table, compared against the expectations file **at tolerance zero**. |
| `passed_checks`, `failed_checks` | No | Check identifiers, for example `sql-to-dax:store-GSA-001:KPI-GRS-006`. This is where the [ARCHITECTURE.md §25.4](../../ARCHITECTURE.md) list is walked item by item — relationship direction, role-playing date logic, filter behaviour, totals and subtotals, time intelligence, drill-through context, formatting, and SQL-to-DAX reconciliation. Target attainment is recorded not applicable, Deferred fact, which is a recorded outcome rather than a silent omission. |
| `sql_to_dax_differences` | No | Every measure whose DAX value differed from the SQL baseline beyond tolerance, with context, both values, the difference and the tolerance applied. **Empty is the only acceptable state for a passed result.** |
| `notes` | No | Prose, for the things structure cannot carry. |

The schema also carries an **operator** field, because a gate with no named person who performed it is
unattributable and `P2.1-09` asks for the operator to be recorded. It is optional and nullable — the
placeholder records `null` — and `scripts/validate_powerbi_model.ps1` takes an `-Operator` parameter that
writes it. It is deliberately **free text the operator chooses**, a GitHub handle being the usual answer: an
email address, a machine name or a domain account would all be personal data this repository has no reason
to hold, and none of them is needed to know who to ask.

**The committed Desktop file today is a placeholder**: `overall_result` is `pending`, `validated_at` and
`model_source_hash` are null, both check arrays are empty, and its `notes` field states plainly that Desktop
has never opened the project.

### 6.2 The Fabric result

`powerbi/validation/fabric_validation_results.json` records the same evidence for the other engine, against
`powerbi/validation/fabric_validation_results.schema.json`. The required four are the same in meaning:
a schema identifier, `validated_at`, `model_source_hash`, and an `overall_result` enum in which `pending` is
not a pass. The counts, row counts, check arrays and `sql_to_dax_differences` carry the same obligations,
because §3 is the same list.

What differs is engine identification. Where the Desktop result records a Desktop product version, the
Fabric result records `engine`, the workspace and semantic-model **item GUIDs**, and a
`retrieved_definition_hash` — the SHA-256 of the definition read back from the Service after deployment,
which is how "the engine received the committed TMDL and not something adjacent to it" becomes a recorded
fact rather than an assumption.

**The workspace and item GUIDs are identifiers, not secrets, and are deliberately recorded.** A result that
did not say where it ran could not be re-run or disputed. The credential boundary is drawn elsewhere and is
absolute: **no token, refresh token, client secret, database password, endpoint or credential-bearing
connection string appears in the evidence file**, in a log, or in an error message — the same distinction
`powerbi/validation/sql_baseline_metadata.json` already draws by recording the data it was taken from and
not the machine it was taken on.

**The Fabric file is also a placeholder recording `pending`.** Nothing has been deployed to a workspace.

`powerbi/validation/` also holds the SQL side of the comparison; see
[09-sql-to-dax-reconciliation.md §6](09-sql-to-dax-reconciliation.md).

---

## 7. What each gate requires, in outline

The full procedures are `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` and
`docs/powerbi/FABRIC_SERVICE_HANDOFF.md`, including what to do when a step fails. The outlines, so a reader
of this directory knows what is being waited on:

### 7.1 Path A — Power BI Desktop

1. **Open** `powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.pbip` in Power BI Desktop
   with the PBIP, TMDL and PBIR **preview features enabled**. A reader who has not enabled them meets a
   failure that looks like a corrupt project.
2. **No model-load error**, and specifically **no ambiguous-relationship error**. This is the engine's
   verdict on the correction in [02-relationship-plan.md §3.2.1](02-relationship-plan.md), where an active
   `vw_dealership` → `vw_employee` relationship was found to create a second filter path and was built
   inactive as a result. The static path argument there is an argument; this is the evidence.
3. **Set the parameters and supply credentials** as in
   [07-power-query-parameters.md §4](07-power-query-parameters.md). The credential is entered at the Desktop
   prompt and stored in the Windows credential store — **never in the project**.
4. **Full refresh** against a populated PostgreSQL `reporting` schema, connecting as `arpi_reporter`.
5. **All twenty tables load** with row counts matching `powerbi/validation/sql_baseline.json` at tolerance
   zero.
6. **Every measure evaluates without error**, and every reconciled measure matches the SQL baseline within
   the configured tolerance. The method is
   [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md).
7. **Walk the [ARCHITECTURE.md §25.4](../../ARCHITECTURE.md) list item by item**, recording each outcome.
8. **Save from Desktop and review the diff.** This step has no Path B equivalent.
9. **Record the result** in `powerbi/validation/desktop_validation_results.json` against the schema.

### 7.2 Path B — Microsoft Fabric Service

1. **Deploy** the committed `.SemanticModel/definition/` tree to a Fabric workspace through the
   semantic-model definition APIs, **transforming nothing**. The engine receives the repository's TMDL. A
   rejection here is the engine's verdict on the model source, and is recorded as a failure rather than
   retried until it works. The definition is then **read back** and compared file by file with what was
   sent; documented service normalisations are normalised away and any other difference fails the deploy,
   because a service that quietly rewrote a measure would otherwise go unnoticed until a number was wrong.
2. **Bind the source**: set the Server and Database parameters to the cloud PostgreSQL instance and attach
   the workspace connection holding the `arpi_reporter` credential. The repository holds the connection's
   name and nothing more.
3. **Full refresh**, polled to completion. Succeeded, failed and still-running are distinguished; a partial
   refresh is a failure.
4. **All twenty tables load** with row counts matching the baseline at tolerance zero.
5. **Execute `powerbi/validation/validation_queries.dax`** — the same committed file Path A runs by hand —
   through the **Power BI Execute Queries REST API**, with `includeNulls` set so that a blank is
   distinguishable from an omitted value.
6. **Compare** every result against `powerbi/validation/sql_baseline.json`, in every filter context.
7. **Walk the [ARCHITECTURE.md §25.4](../../ARCHITECTURE.md) list item by item**, recording each outcome.
8. **Record the result** in `powerbi/validation/fabric_validation_results.json` against
   `powerbi/validation/fabric_validation_results.schema.json`.

The person or script following either procedure is **performing a gate**, not carrying out a checklist. A
failed step is recorded rather than worked around. Path B being scriptable does not make it self-certifying:
a script that reports its own success is not evidence unless its output is structured, hash-pinned and
reviewable, which is why it records against a schema instead of printing a verdict.

---

## 8. What is in place, and what is not

The supporting artefacts exist for both paths. **What does not exist is anything for Path B's tooling to
talk to** — no cloud database, no Fabric tenant, no workspace, no connection — and, on either path, the run.
Every artefact below is machinery for producing or checking evidence. None of it is evidence.

| Artefact | Present | Role |
|---|---|---|
| `powerbi/validation/model_expectations.json` | Yes | The structural facts the static checker asserts: 26 tables, 20 imported, 6 measure tables, 42 relationships (32 active, 10 inactive), 0 bidirectional, 0 many-to-many, `vw_calendar` marked on `calendar_date`, 49 measures (29 KPI, 20 supporting), and the expected row count per table. |
| `powerbi/validation/sql_baseline.json` | Yes | The SQL side of the reconciliation, across twenty-one filter contexts. Shared by both paths. |
| `powerbi/validation/sql_baseline_metadata.json` | Yes | Its provenance: profile `development`, seed, commit, date range, reconciliation status. It records **no host, user name or password**, on purpose. |
| `powerbi/validation/validation_queries.dax` | Yes | The DAX queries. Run by hand on Path A, submitted through the Execute Queries REST API on Path B. **One file, both paths** — a second copy would be a second answer waiting to happen. |
| `powerbi/validation/validation_results.schema.json` | Yes | The Desktop contract of §6.1. |
| `powerbi/validation/desktop_validation_results.json` | Yes | **A placeholder recording PENDING.** |
| `powerbi/validation/fabric_validation_results.schema.json` | Yes | The Fabric contract of §6.2. |
| `powerbi/validation/fabric_validation_results.json` | Yes | **A placeholder recording PENDING.** |
| `scripts/check_powerbi_model.py` | Yes | Static structural check, run in CI. 9,452 assertions about the left-hand column of §1. |
| `scripts/check_desktop_validation_freshness.py` | Yes | The Desktop side of the state machine of §4 and the hash of §5. |
| `scripts/check_fabric_validation_freshness.py` | Yes | The Fabric side of the same. |
| `scripts/check_real_engine_validation.py` | Yes | The gate itself: reads both engines' evidence and reports the combined verdict. Its `--require-pass` mode is not enabled yet — see §4. |
| `scripts/generate_sql_baseline.py` | Yes | Regenerates the baseline from a database. |
| `scripts/validate_powerbi_model.ps1` | Yes | The Windows-side script for Path A. **Not invoked by CI.** |
| `scripts/deploy_powerbi_fabric.py` | Yes | Sends the committed definition to a workspace and reads it back to prove the Service stored what the repository contains. |
| `scripts/validate_powerbi_fabric.py` | Yes | Refreshes the deployed model and runs the governed DAX through the Execute Queries REST API. |
| `scripts/verify_cloud_database.py` | Yes | Proves a cloud database is encrypted, correctly loaded, and correctly privilege-separated — against that database rather than by inference. |
| `tests/unit/test_powerbi_model_structure.py` | Yes | The static assertions under pytest. |
| `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` | Yes | The Path A procedure. |
| `docs/powerbi/FABRIC_SERVICE_HANDOFF.md` | Yes | The Path B procedure. |
| `docs/cloud-database-setup.md` | Yes | How to deploy the database Path B refreshes from. |
| A cloud PostgreSQL instance, a Fabric tenant, workspace and connection | **No** | Path B's dependencies, none of which live in this repository. `P2.1-11` and `P2.1-12`. |
| **A real-engine validation run, on either path** | **No** | **This is the gap.** |

Nothing in that list changes the status. Every one of those artefacts is machinery for producing or checking
evidence; none of them is evidence. The current state is PENDING on both engines because **nothing has run
on a semantic-model engine**, not because a run produced no result.

---

## 9. What must not be said until this gate passes

Until `P2.1-09` passes on one path and the result is recorded:

* **No document states that the semantic model is validated.**
* **No document states that a measure returns a correct value**, because none has returned any value.
* **No document states that the model refreshes**, loads, or opens.
* **No document presents the static assertion count as validation.** 9,452 assertions passing is a true
  statement that a reader can be misled by, which is the most durable kind of misleading there is.
* **[ARCHITECTURE.md §27](../../ARCHITECTURE.md) Lifecycle Phase 5 is not marked complete**, and delivery
  increment `P2.1`'s exit criteria are not met.
* **`P2.2` does not begin.** Authoring report pages over a model that has never been loaded would put
  page-level defects and model-level defects into the same change, and the first refresh failure would then
  be ambiguous. This is a hard sequencing rule, not a preference.

The largest caveat on this delivery increment is the plainest one:
[ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md) states it as *"the model
has never been opened by Power BI Desktop. Every claim made about it is structural. It may fail to load, fail
to refresh, or contain a measure that errors, and no check in this repository would currently know."*
[ADR-0008](../../docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md) adds a second way to
answer that, and answers none of it. Nothing in this directory softens either statement.
