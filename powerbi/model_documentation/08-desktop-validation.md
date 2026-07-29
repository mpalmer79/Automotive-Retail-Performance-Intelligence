# Power BI Desktop Validation — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

> ## CURRENT STATUS: **PENDING**
>
> **Power BI Desktop has never opened this model.** It has not been refreshed, no measure has been
> evaluated, no total has been checked, and no format string has been rendered. The status is not "passing
> with caveats" and not "expected to pass". It is **PENDING**, and it stays PENDING until a person performs
> the procedure on a Windows machine and records the result.

---

## 1. What Desktop validation is

Desktop validation is the act of opening the PBIP project in Power BI Desktop with a real tabular engine
behind it, refreshing it against a populated database, and observing what the engine does. It is
`P2.1-09` in [PHASE_2_BACKLOG.md](../../docs/requirements/PHASE_2_BACKLOG.md).

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

---

## 2. Why it cannot run in CI

Power BI Desktop is a **Windows desktop application** requiring a licence and an interactive installation.
The environment that authored this model is Ubuntu 24.04 with no Windows layer, no Desktop, and no Analysis
Services instance. Nothing in it can open a PBIP, refresh a model, or evaluate a DAX expression.

A hosted Windows CI runner does not solve this. It changes the operating system without changing the answer:
it still has no Power BI Desktop installation and no licence. A job that claimed to have validated a Power BI
model without a tabular engine would be asserting something it did not observe, which is the specific
failure this project's validation framework exists to prevent.

**CI therefore runs static checks only, and never attempts to launch Desktop.** Its output says *"static
model checks passed"* and never *"the model is valid"*. The distinction is not pedantry: the first is a
statement about text, and the second would be a statement about behaviour nobody has seen.

`scripts/validate_powerbi_model.ps1` exists for the Windows side of this and is deliberately not invoked by
CI. `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` is the procedure a human follows.

---

## 3. The five states CI distinguishes

A single boolean would be dishonest here, because "not validated" has several distinct meanings and they
call for different actions. Two scripts report between them: `scripts/check_powerbi_model.py` asserts the
static structure, and `scripts/check_desktop_validation_freshness.py` reads
`powerbi/validation/desktop_validation_results.json` and reports the Desktop state.

| State | Meaning | What it says about the model | Action |
|---|---|---|---|
| **Static validation passed** | The TMDL parses and satisfies every structural expectation in `powerbi/validation/model_expectations.json`. | The model is well-formed text. Nothing more. | None. This is the CI baseline, not an achievement. |
| **Desktop PASSED** | A person opened, refreshed and saved the model, every measure evaluated, and the recorded model-source hash matches the current one. | The model works, against the profile and on the date recorded. | None. This is the only state in which the model may be described as validated. |
| **PENDING** | The result file exists with `overall_result: "pending"` and a null hash. Desktop has never run. | Unknown. The model may fail to load. | Perform `P2.1-09`. **This is the current state.** |
| **STALE** | A Desktop result exists, but the model-source hash has changed since it was recorded. | The evidence describes a model that no longer exists. | Perform `P2.1-09` again. Stale is treated as Pending for gating purposes, never as a weaker form of Passed. |
| **FAILED** | A Desktop validation was performed and a step did not pass. | Known broken, in a recorded way. | Fix the defect, then re-run. A failed result is **not** deleted; it is superseded. |

A sixth state, **MISSING**, is reported when there is no result file at all. It is distinguished from
PENDING deliberately: PENDING is a recorded statement that validation has not happened, while MISSING means
the record itself is absent, which is a different problem with a different fix.

PENDING exits zero so that it does not block a branch while `P2.1` is in flight; STALE, FAILED and MISSING
exit non-zero. The word PENDING appears in the output of every run, so nobody can mistake "not yet
validated" for "validated".

Three rules govern the states.

* **Pending and Stale are not Passed.** `P2.2` is blocked by both, identically.
* **A failed result is recorded, not discarded.** A validation history in which only successes survive is a
  history that proves nothing. A refresh that loads nineteen of twenty tables is a failure, recorded as one —
  there is no partial credit.
* **Static validation never promotes to Desktop passed.** No accumulation of structural checks reaches the
  other column of §1's table.

---

## 4. The model-source-hash freshness mechanism

**Evidence with no freshness rule is evidence about a file that no longer exists.**

A Desktop validation result is a statement about a specific model at a specific moment. Change one measure
and the statement is no longer about the model in the repository — but the recorded result still sits there
looking like a pass, and nothing about it announces that it has expired.

The mechanism: a **SHA-256 hash is computed over the semantic-model definition files** — `database.tmdl`,
`model.tmdl`, `expressions.tmdl`, `relationships.tmdl`, every file under `definition/tables/`, plus
`definition.pbism` — taken in sorted relative-path order, with each path and each file length mixed in so
that renaming or splitting a file changes the hash. It is recorded as `model_source_hash` alongside each
Desktop validation result. On every run, `scripts/check_desktop_validation_freshness.py` recomputes the hash
over the current files and compares; `--print-hash` emits the current value for recording.

| Comparison | Reported as |
|---|---|
| Current hash equals recorded hash | The Desktop result stands |
| Current hash differs from recorded hash | **STALE** — the manual gate must be run again |
| No result recorded | **PENDING** |

Three properties worth stating:

* **The hash covers the model, not the repository.** A change to this document does not stale a Desktop
  result, because this document is not the model. A change to one measure does, because it is. The `.pbip`
  file and the two `.platform` files are excluded for the same reason: they do not affect what a refresh
  does.
* **It cannot distinguish a trivial change from a substantive one**, and deliberately does not try. A
  whitespace change and a rewritten measure both stale the evidence. Re-running the gate is cheaper than
  building a rule for which edits are safe, and any such rule would eventually be wrong in the direction that
  matters.
* **The report shell is excluded.** The `.Report` folder has no bearing on whether the semantic model loads
  and refreshes, and including it would stale the model's evidence every time a page changed in `P2.2`.

---

## 5. The contract of `powerbi/validation/desktop_validation_results.json`

The result is recorded as **structured data, not prose**, and validated against
`powerbi/validation/validation_results.schema.json` (JSON Schema draft-07, `additionalProperties: false`). A
hand-recorded result that omits a field is caught by the schema rather than discovered later by a reader who
assumed the field was implied.

Four fields are **required**; the rest are nullable and are null while the state is PENDING.

| Field | Required | Why it exists |
|---|---|---|
| `schema` | **Yes** | `arpi.desktop_validation_results/1`. Fixes the contract version, so a later shape is a new version rather than a silent reinterpretation. |
| `validated_at` | **Yes** | UTC ISO-8601 instant. Null when it has never run. An undated result cannot be reasoned about. |
| `model_source_hash` | **Yes** | The SHA-256 of §4, at the time of validation. Without it, freshness cannot be computed at all. Null when it has never run. |
| `overall_result` | **Yes** | `passed`, `failed` or `pending` — an enum, not free text, so "mostly passed" cannot enter the record. `pending` is not a pass and CI must never render it as one. |
| `power_bi_desktop_version` | No | PBIP, TMDL and PBIR are preview surfaces. A result is only meaningful for the Desktop build that produced it, and a later build may change the on-disk shape. |
| `compatibility_level` | No | The tabular compatibility level the running model reported. The committed `database.tmdl` declares 1567. |
| `refresh_result` | No | `succeeded`, `failed` or `not attempted`. |
| `table_count`, `imported_table_count`, `measure_table_count` | No | 26, 20 and 6 as built. Compared against `powerbi/validation/model_expectations.json`. |
| `relationship_count`, `active_relationship_count`, `inactive_relationship_count` | No | 42, 32 and 10 as built. |
| `measure_count` | No | 49 as built. |
| `row_counts` | No | Rows loaded per imported table, compared against the expectations file **at tolerance zero**. |
| `passed_checks`, `failed_checks` | No | Check identifiers, for example `sql-to-dax:store-GSA-001:KPI-GRS-006`. This is where the [ARCHITECTURE.md §25.4](../../ARCHITECTURE.md) list is walked item by item — relationship direction, role-playing date logic, filter behaviour, totals and subtotals, time intelligence, drill-through context, formatting, and SQL-to-DAX reconciliation. Target attainment is recorded not applicable, Deferred fact, which is a recorded outcome rather than a silent omission. |
| `sql_to_dax_differences` | No | Every measure whose DAX value differed from the SQL baseline beyond tolerance, with context, both values, the difference and the tolerance applied. **Empty is the only acceptable state for a passed result.** |
| `notes` | No | Prose, for the things structure cannot carry. |

**The committed file today is a placeholder**: `overall_result` is `pending`, `validated_at` and
`model_source_hash` are null, both check arrays are empty, and its `notes` field states plainly that Desktop
has never opened the project.

The schema also carries an **operator** field, because a manual gate with no named person who performed it is
unattributable and `P2.1-09` asks for the operator to be recorded. It is optional and nullable — the
placeholder records `null` — and `scripts/validate_powerbi_model.ps1` takes an `-Operator` parameter that
writes it. It is deliberately **free text the operator chooses**, a GitHub handle being the usual answer: an
email address, a machine name or a domain account would all be personal data this repository has no reason to
hold, and none of them is needed to know who to ask.

`powerbi/validation/` also holds the SQL side of the comparison; see
[09-sql-to-dax-reconciliation.md §6](09-sql-to-dax-reconciliation.md).

---

## 6. What the gate requires, in outline

The full procedure, including what to do when a step fails, is `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md`.
The outline, so a reader of this directory knows what is being waited on:

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
8. **Save from Desktop and review the diff.**
9. **Record the result** in `powerbi/validation/desktop_validation_results.json` against the schema.

The person following that procedure is **performing a gate**, not carrying out a checklist. A failed step is
recorded rather than worked around.

---

## 7. What is in place, and what is not

The supporting artefacts exist. What has not happened is the run.

| Artefact | Present | Role |
|---|---|---|
| `powerbi/validation/model_expectations.json` | Yes | The structural facts the static checker asserts: 26 tables, 20 imported, 6 measure tables, 42 relationships (32 active, 10 inactive), 0 bidirectional, 0 many-to-many, `vw_calendar` marked on `calendar_date`, 49 measures (29 KPI, 20 supporting), and the expected row count per table. |
| `powerbi/validation/sql_baseline.json` | Yes | The SQL side of the reconciliation, across twenty-one filter contexts. |
| `powerbi/validation/sql_baseline_metadata.json` | Yes | Its provenance: profile `development`, seed, commit, date range, reconciliation status. It records **no host, user name or password**, on purpose. |
| `powerbi/validation/validation_queries.dax` | Yes | The DAX queries a human runs against the refreshed model. |
| `powerbi/validation/validation_results.schema.json` | Yes | The contract of §5. |
| `powerbi/validation/desktop_validation_results.json` | Yes | **A placeholder recording PENDING.** |
| `scripts/check_powerbi_model.py` | Yes | Static structural check, run in CI. |
| `scripts/check_desktop_validation_freshness.py` | Yes | The state machine of §3 and the hash of §4. |
| `scripts/generate_sql_baseline.py` | Yes | Regenerates the baseline from a database. |
| `scripts/validate_powerbi_model.ps1` | Yes | The Windows-side script. **Not invoked by CI.** |
| `tests/unit/test_powerbi_model_structure.py` | Yes | The static assertions under pytest. |
| `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md` | Yes | The manual procedure. |
| **A Desktop validation run** | **No** | **This is the gap.** |

Nothing in that list changes the status. Every one of those artefacts is machinery for producing or checking
evidence; none of them is evidence. The current state is PENDING because **nothing has run on a machine with
a tabular engine**, not because a run produced no result.

---

## 8. What must not be said until this gate passes

Until `P2.1-09` passes and the result is recorded:

* **No document states that the semantic model is validated.**
* **No document states that a measure returns a correct value**, because none has returned any value.
* **No document states that the model refreshes**, loads, or opens.
* **[ARCHITECTURE.md §27](../../ARCHITECTURE.md) Lifecycle Phase 5 is not marked complete**, and delivery
  increment `P2.1`'s exit criteria are not met.
* **`P2.2` does not begin.** Authoring report pages over a model that has never been opened would put
  page-level defects and model-level defects into the same change, and the first refresh failure would then
  be ambiguous. This is a hard sequencing rule, not a preference.

The largest caveat on this delivery increment is the plainest one:
[ADR-0007](../../docs/architecture-decisions/ADR-0007-power-bi-project-format.md) states it as *"the model
has never been opened by Power BI Desktop. Every claim made about it is structural. It may fail to load, fail
to refresh, or contain a measure that errors, and no check in this repository would currently know."* Nothing
in this directory softens that.
