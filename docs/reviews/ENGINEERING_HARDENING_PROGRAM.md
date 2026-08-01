# ARPI Engineering Hardening Program

Program ledger for the engineering-hardening work that follows the ARPI Experience
Redesign. This document records the starting state, the independent reproduction of every
reported finding, and the outcome of each remediation pull request.

The findings below come from an independent staff-level repository review. Every one of
them was reproduced (or refuted) against this repository before any remediation was
written. A finding is not accepted because the review asserted it, and it is not rejected
because CI is currently green.

---

## 1. Starting state

Recorded at the beginning of the program, from the merge commit of the redesign.

| Item | Value |
| --- | --- |
| Starting `main` SHA | `008b269af751b2cea09a9e62827b949ccaa95620` |
| Redesign merge SHA | `008b269` (merge of PR #14, `claude/arpi-experience-redesign-cxe493`) |
| Redesign implementation SHA | `3bb6b11` |
| Railway deployment SHA | Not verifiable from this environment (see §1.1) |
| Python tests (non-integration) | 2232 passed, 571 skipped |
| Python coverage | 97.07% (floor 85%) |
| PostgreSQL integration result | 615 passed against PostgreSQL 16.13 |
| Power BI static validation | Passing (structure checks only, no engine) |
| Real-engine evidence | Desktop `validated_at: null`; Fabric `validated_at: null` — both **pending** |
| Documentation-check result | Passing |
| Dependency resolution | `pip install -e ".[dev,db]"` against unpinned ranges — **no lock** |
| Python version | CI matrix 3.11 and 3.12; local reproduction on 3.11.15 |

### 1.1 Environment constraint on live verification

The execution environment's outbound network policy denies `arpi.up.railway.app`:

```
$ curl -sS -o /dev/null -w "%{http_code}\n" https://arpi.up.railway.app/status
curl: (56) CONNECT tunnel failed, response 403
```

The agent proxy reports `connect_rejected` / "gateway answered 403 to CONNECT (policy
denial)" for that host. Live-site verification, live security-header inspection, Railway
resource inspection, and Microsoft Fabric validation therefore **cannot be executed from
this environment**. They are not marked complete, and no evidence for them is fabricated.

### 1.2 Baseline reproduction commands

```
pip install -e ".[dev,db]"
python -m pytest -q -p no:randomly            # 2232 passed, 571 skipped, 97.07%
PGHOST=/tmp PGPORT=5433 PGUSER=postgres \
  python -m pytest tests/integration -q       # 615 passed
```

The integration baseline was produced against a local PostgreSQL 16.13 cluster created
for this program, not against any hosted database.

---

## 2. Finding register

| # | Finding | Verdict |
| --- | --- | --- |
| 1 | Pipeline execution history is collapsed by a deterministic run identifier | **CONFIRMED** |
| 2 | Invalid Type 2 employee data can crash a gating validator | **CONFIRMED (latent)** |
| 3 | Global logger state makes parts of the test suite order-dependent | **CONFIRMED** |
| 4 | Governing documentation and source docstrings contain stale claims | **CONFIRMED** |
| 5 | Python dependency resolution is not fully reproducible | **CONFIRMED** |
| 6 | Several modules contain too many responsibilities | **CONFIRMED** |
| 7 | PostgreSQL and Microsoft semantic-model runtime evidence remain incomplete | **PARTIALLY CONFIRMED** |
| 8 | Production security headers can be strengthened | **NOT VERIFIABLE HERE** |
| 9 | Database schema evolution remains prototype-oriented | **CONFIRMED** |

---

## 3. Finding 1 — execution history is collapsed

**Verdict: CONFIRMED. Severity: high. Blast radius: the entire audit layer.**

### Location

- `src/arpi/audit/run.py:41` — `build_run_uuid`
- `src/arpi/audit/run.py:118` — `PipelineRun.start`
- `src/arpi/ingestion/loader.py:782` — `_insert_audit_rows`
- `sql/00_database/03_audit_tables.sql:40` — `uq_pipeline_run_run_uuid`

### Expected behaviour

One `audit.pipeline_run` row per pipeline **execution attempt**. Two executions with
identical inputs are two attempts and must produce two rows. A failed attempt followed by
a successful retry must leave both visible.

### Actual behaviour

`build_run_uuid` returns a UUIDv5 over `(pipeline_name, profile, random_seed, start_date,
end_date)`. It is deterministic by design, and the loader writes it with:

```sql
ON CONFLICT (run_uuid) DO UPDATE SET
  completed_at = EXCLUDED.completed_at, status = EXCLUDED.status,
  critical_failure_count = ..., warning_count = ..., notes = ...
```

Consequences, each of which follows directly from that statement:

1. A second execution with the same inputs **reuses the first row**. There is one row
   where there were two attempts.
2. `started_at` is not in the `DO UPDATE SET` list, so it survives from attempt 1 while
   `completed_at` is overwritten by attempt 2. **`completed_at - started_at` is not the
   duration of any real execution** — it spans from the first attempt's start to the last
   attempt's finish.
3. `arpi_version` is likewise not updated. A row can therefore record a version that did
   **not** produce the state the row now describes.
4. `run_mode` is not updated, so a `cli` attempt overwritten by a `library` attempt keeps
   the stale mode.
5. A failed attempt followed by a successful one collapses to a single row with
   `status = 'succeeded'`. **The failure disappears from the audit trail.**
6. Child audit rows are deleted and reinserted (`loader.py:809-816`), so row counts,
   validation results and rejected records can no longer be attributed to the attempt
   that produced them.

The existing code documents this as intentional idempotency
(`src/arpi/audit/run.py:50-60`, `tests/integration/test_audit_rerun_idempotency.py`). The
review's point stands regardless: audit-row reuse is the wrong mechanism for warehouse
idempotency, and using it destroys history that the architecture claims to keep.
`ARCHITECTURE.md` §21.4 treats the audit layer as evidence; evidence that overwrites
itself is not evidence.

### Remediation

Separate **execution identity** from **logical-run identity**. Keep `run_uuid` as the
physical primary identifier of an attempt (now random per execution, preserving every
existing foreign key) and add `logical_run_key` carrying the deterministic fingerprint.
See `docs/architecture-decisions/ADR-0010-execution-identity-and-logical-run-key.md`.

Requires: additive forward migration, backfill, new index, loader change, documentation
updates, and replacement of the rerun-idempotency integration contract.

---

## 4. Finding 2 — Type 2 sentinel arithmetic crashes a gating validator

**Verdict: CONFIRMED, latent. Severity: high. Blast radius: the gating validation suite.**

### Location

`src/arpi/generation/employee.py:1334` — `_check_non_overlapping_versions` (`DQ-EMP-003`):

```python
one_day = pd.Timedelta(days=1)
...
if expirations[index - 1] + one_day != effectives[index]
```

### Why the named test currently passes

```
$ python -m pytest "tests/data_quality/test_employee_quality.py::\
test_the_gating_suite_fails_on_a_second_current_row" -q
1 passed
```

The review reported this test raising `OutOfBoundsDatetime`. On the currently resolved
dependency graph it passes. **That does not refute the finding — it demonstrates finding
5.** `pyproject.toml` declares `pandas>=2.2` with no upper bound and no lock, so the
resolved version is whatever the environment happens to pick.

### Direct reproduction of the defect

`pd.Timedelta` is nanosecond-based; the year-9999 sentinel is outside the nanosecond
range (max 2262-04-11). Adding one to the other is only safe if pandas preserves the
column's second resolution through the addition, and that behaviour changed between
major versions:

```
# pandas 2.2.3
tolist type: <class 'pandas._libs.tslibs.timestamps.Timestamp'> Timestamp('9999-12-31 00:00:00')
RAISED: OutOfBoundsDatetime Cannot cast 9999-12-31 00:00:00 to unit='ns' without overflow.

# pandas 3.0.5
result: 10000-01-01 00:00:00
```

Both runs used the same `datetime64[s]` column the generator actually produces. Under
`pandas==2.2.3` — a version the declared range explicitly admits — a second current row
carrying the sentinel makes `DQ-EMP-003` raise instead of returning a failed check. The
gating suite aborts on a `pandas` internal exception rather than reporting invalid data.

**This is the more serious form of the defect, not a weaker one:** the validator's
correctness depends on an unpinned transitive behaviour, so CI can go green on one
resolution and a developer can hit a crash on another.

### Remediation

Do not perform `pd.Timedelta` arithmetic against the sentinel. Compare using Python
`date`/`timedelta`, or compare the sentinel before arithmetic. Audit every other
generator and validator for the same pattern. Pin the dependency graph (finding 5) so the
behaviour is not resolution-dependent.

---

## 5. Finding 3 — global logger state leaks between tests

**Verdict: CONFIRMED. Severity: medium. Blast radius: the whole non-integration suite.**

### Location

- `src/arpi/logging_config.py:137` — `configure_logging` sets `logger.propagate = False`
  and `logger.setLevel(...)` on the process-global `arpi` logger.
- `tests/unit/test_logging_config.py:25` — the local `_restore_root_logger` fixture
  removes handlers *before* each test and restores nothing afterwards.
- `tests/conftest.py` — no logger isolation at all.

### Reproduction

A probe test appended to the run reveals the leaked state:

```
# probe alone
PROBE handlers=[] level=0 propagate=True disabled=False

# after tests/unit/test_logging_config.py
PROBE handlers=[StreamHandler, LogCaptureHandler, LogCaptureHandler] level=30 propagate=False

# after tests/unit/test_cli.py
PROBE handlers=[StreamHandler, LogCaptureHandler, LogCaptureHandler] level=30 propagate=False
```

Three separate leaks: handlers **accumulate**, the level is raised from `NOTSET` to
`WARNING`, and propagation is disabled.

The user-visible consequence — `caplog` going blind — reproduces exactly as reported:

```python
def test_zz_caplog_sees_info_from_arpi(caplog):
    with caplog.at_level(logging.INFO):
        get_logger("arpi.probe").info("hello-from-probe")
    assert "hello-from-probe" in caplog.text
```

```
$ pytest tests/unit/test_zz_probe.py                       -> 1 passed
$ pytest tests/unit/test_cli.py tests/unit/test_zz_probe.py -> 1 failed, 25 passed
    AssertionError: assert 'hello-from-probe' in ''
```

Identical test, identical assertion; the only difference is what ran before it. The
existing `caplog` assertions in `tests/unit/test_ingestion.py` currently survive only
because they scope `at_level` to a specific child logger *and* because the leaked
`LogCaptureHandler` instances happen to sit on the `arpi` logger. That is a coincidence,
not isolation.

### Remediation

A session-wide autouse fixture in `tests/conftest.py` that snapshots and restores
`handlers`, `level`, `propagate`, `disabled` and `filters` for the root and `arpi`
loggers. Production logging behaviour is correct and must not change; the defect is
missing test isolation.

---

## 6. Finding 4 — stale implementation claims in governing documents

**Verdict: CONFIRMED. Severity: medium. Blast radius: public-facing project status.**

Repository evidence contradicting the claims:

| Evidence | Count |
| --- | --- |
| PBIP project files | `ARPI_Performance_Intelligence.pbip`, `definition.pbism`, `definition.pbir` |
| TMDL files | 30 |
| Fact-load SQL implementations | 5 (`sql/04_facts/10_*` … `14_*`) |
| Audit row-count layers recorded | 5 (DOC-23 resolved 2026-07-29) |
| Report pages | 0 |

Confirmed stale statements:

| File | Claim | Reality |
| --- | --- | --- |
| `LIMITATIONS.md:19` | "no semantic model exists" | 30 TMDL files + PBIP exist |
| `LIMITATIONS.md:236` | "No Power BI file, no semantic model, no DAX measure, no report page" | Only "no report page" is true |
| `docs/requirements/GATE_1_READINESS.md:128` | "**No DAX measure exists**" | 49 measures exist in TMDL |
| `docs/diagrams/01-system-context.md:121` | "No semantic model, no report page, no workbook" | Semantic model exists |
| `docs/source-to-target/STM-003-audit-metadata.md:116` | "only three are ever" written | All five layers are recorded |
| `docs/source-to-target/STM-004`, `STM-005` | "No SQL load exists yet … Planned" | Dimension merges exist |
| `src/arpi/generation/lead.py:455`, `lead_source.py:530` | "Planned and owned by another agent" | Stale docstring |

The distinction that must be preserved when correcting these: **source exists** is not
**runtime proven**. The semantic model source exists; no engine has executed it. Report
pages genuinely do not exist and must not be described as existing.

---

## 7. Finding 5 — dependency resolution is not reproducible

**Verdict: CONFIRMED. Severity: high (it masks finding 2). Blast radius: every environment.**

- No `uv.lock`, no `requirements*.txt`, no `pip-tools` output anywhere in the tree.
- `.github/workflows/ci.yml` installs with `pip install -e ".[dev,db]"` and caches on
  `pyproject.toml`, which pins nothing.
- `deployment/railway/Dockerfile.database-setup` provisions independently of any lock.
- Declared ranges are open-ended: `pandas>=2.2`, `pydantic>=2.7`, `ruff>=0.6`, `mypy>=1.10`.

The concrete harm is already demonstrated in §4: the same source resolves to pandas 2.2.3
(gating validator crashes) or pandas 3.0.5 (gating validator passes). CI is green on one
of those and would be red on the other, with no change to the repository.

---

## 8. Finding 6 — responsibility density

**Verdict: CONFIRMED.**

| Module | Lines |
| --- | --- |
| `scripts/check_powerbi_model.py` | 1993 |
| `src/arpi/generation/lead.py` | 1725 |
| `src/arpi/generation/sale.py` | 1717 |
| `src/arpi/generation/marketing.py` | 1689 |
| `src/arpi/generation/employee.py` | 1472 |
| `portfolio/scripts/generate-project-manifest.ts` | 1349 |

Line count alone does not justify decomposition. `src/arpi/generation/employee.py` is the
strongest candidate because it mixes at least six distinct responsibilities — column
contract, distributions, record construction, Type 2 history, derived calculations and
eight validators — and because its validator is where finding 2 lives, so the module is
already being changed under test.

---

## 9. Finding 7 — runtime validation status

**Verdict: PARTIALLY CONFIRMED.**

- PostgreSQL integration: **stronger than the review implies.** 615 integration tests pass
  against a real PostgreSQL 16.13 server, covering schema objects, constraints, merges,
  reconciliations, the reporter role and end-to-end pipeline runs.
- Real-engine (Desktop and Fabric) validation: **confirmed incomplete.** Both evidence
  files carry `validated_at: null` and `model_source_hash: null`. Nothing in the
  repository claims otherwise, so the gate controls are honest.
- Railway PostgreSQL provisioning and Fabric validation cannot be exercised from this
  environment (§1.1).

---

## 10. Finding 8 — production security headers

**Verdict: NOT VERIFIABLE FROM THIS ENVIRONMENT.**

The live site is unreachable (§1.1), so no live header set was inspected and no claim
about the deployed CSP is recorded here. Static inspection of the frontend configuration
is in scope; asserting what the deployed site returns is not.

---

## 11. Finding 9 — schema evolution is prototype-oriented

**Verdict: CONFIRMED.**

`sql/` contains ordered, idempotent `CREATE ... IF NOT EXISTS` scripts and a
`99_local_reset.sql`. There is no migration directory, no applied-migration tracking
table, no checksum of released migrations, and no upgrade path from a previously deployed
schema. Adding a column to `audit.pipeline_run` (finding 1) is exactly the change that
needs one, so the smallest safe forward-migration mechanism is introduced with it.

---

## 12. Pull-request sequence

| PR | Branch | Status |
| --- | --- | --- |
| 1 | `claude/arpi-execution-identity-hardening` | **Merged** (#16) |
| 2 | `claude/arpi-validator-and-test-hermeticity` | **Merged** (#18) |
| 3 | `claude/arpi-capability-register` | **Merged** (#20) |
| 4 | `claude/arpi-reproducible-python-builds` | **Merged** (#19) |
| 5 | `claude/arpi-production-hardening` | **Blocked** by §1.1 — the live site is unreachable, so no claim about the deployed CSP or headers can be verified |
| 6 | `claude/arpi-targeted-module-decomposition` | **Merged** (#22) |
| 7 | `claude/arpi-runtime-validation-completion` | **Blocked** by §1.1 — Railway and Fabric are unreachable |

PR 4 was taken before PR 3 because it closes the cause of finding 2 rather than a
symptom: the sentinel defect was invisible precisely because nothing recorded which
dependency resolution had been tested.

---

## 13. Execution log

Updated as each pull request lands.

| PR | Merge SHA | Main CI | Notes |
| --- | --- | --- | --- |
| — | — | — | Phase 0 complete; findings recorded above. |
| #16 | `c138313` | green | Execution identity split from logical-run identity. Integration 615 → 641. `sql/09_migrations` introduced, fresh and upgrade paths both tested. |
| #18 | `64c8085` | green | Sentinel arithmetic corrected; proven before/after under `pandas==2.2.3`. Logger isolation fixture; the Phase 0 reproduction now passes in every order. Two deterministic order-regression CI steps. |
| #19 | `e87f704` | green | `uv.lock`; CI and the Railway provisioning image install frozen. New `floor` job runs the suite at the declared minimums (2210 tests, pandas 2.2.0). New `database-setup-image` job caught a real defect on its first run: the image built and could not run. |
| #20 | `ccf555b` | green | Capability register. Ten stale claims found by the checker before correction, then corrected. Rules are semantic and only ever tighten; a test asserts none can open a gate. Generated blocks, website agreement, and both wired into CI. |
| #22 | `99e686c` | green | `employee.py` 1,532 lines → eight modules, largest 540, no circular imports. 59 characterisation assertions recorded pre-split; generated bytes unchanged. Remaining candidates recorded as debt. |

## 15. Closing state

Five pull requests merged. Final `main`: `99e686c`.

| Measure | Start | End |
| --- | --- | --- |
| Python tests (one process, with PostgreSQL) | 2232 passed, 571 skipped | **2948 passed, 0 skipped** |
| PostgreSQL integration tests | 615 | 641 |
| Coverage | 97.07% | 97.42% |
| CI jobs | 4 | 7 |
| Dependency resolution | unpinned ranges | `uv.lock`, installed frozen in CI and on Railway |
| Forward migrations | none | 2, checksum-enforced, fresh and upgrade paths tested |
| Stale documentation claims | 10 | 0, with a CI check that fails on the eleventh |

### What remains open, and why

**PR 5 (production security headers) and PR 7 (runtime validation completion) were not
attempted.** Both require reaching `https://arpi.up.railway.app`, Railway's managed
PostgreSQL, or Microsoft Fabric. This environment's network policy denies the host
(§1.1), so any claim about a deployed CSP, a live security header, a provisioned cloud
database or a real-engine validation would have been unverifiable. Writing one anyway
would have produced exactly the class of statement the capability register now rejects.

Nothing about the project's public status changed as a result. Both evidence files still
record `validated_at: null`, Gate 2 remains closed, Lifecycle Phase 5 remains
in-progress, and the case study remains locked -- all of which are accurate.

### Acceptance criteria not met

Stated plainly rather than counted as passed:

- **31-34 (production CSP, framing control, live headers, browser verification).** Not
  attempted; the live site is unreachable from here.
- **41-46 (Railway PostgreSQL verified, reporter isolation proven in the cloud, Fabric or
  Desktop validation, evidence hashes).** Not attempted, same reason. Reporter isolation
  *is* proven against a local PostgreSQL 16.13 by the integration suite; what is missing
  is the cloud instance.
- **37 (a tooling or frontend module decomposed).** Deliberately not taken. The strongest
  candidate, `scripts/check_powerbi_model.py`, has no tests at all, so decomposing it
  means writing a test suite first. Recorded in
  [`MODULE_DECOMPOSITION_DEBT.md`](MODULE_DECOMPOSITION_DEBT.md) rather than attempted
  without the safety net that made #22 defensible.

### Defects found by the work rather than by the review

Four, none of which were in the original findings:

1. **The Frontend workflow was already red on `main`** at the redesign merge, contradicting
   a stated starting assumption. Three unit assertions and thirteen browser tests still
   described the pre-redesign navigation. Fixed on `main` by PR #15 during this programme;
   verified afterwards at 375 frontend unit and 212 browser tests passing.
2. **The Railway provisioning image was built by no CI job.** Adding one (#19) caught a
   defect on its first run: a uv-created virtual environment contains no `pip`, so
   `pip install -e .` had been installing the console script into the system interpreter.
   The image built successfully and could not run.
3. **An index and a column `COMMENT` placed in the baseline DDL** would have aborted the
   deployment on the upgrade path, because that file is a no-op against an existing table.
   Caught by the upgrade test in #16, not by review.
4. **Two defects in my own test code**, caught by the characterisation suite in #22 before
   the refactor could hide anything: an assertion that reduced to a tautology, and a
   docstring claim that was false.

### Findings corrected after Phase 0

Three statements in this ledger were wrong when written and are corrected here rather
than edited away:

1. **"The Frontend workflow is green"** — one of §1's starting assumptions. It was not.
   The workflow was already failing on `main` at the redesign merge, in three unit
   assertions and thirteen browser tests. All were stale assertions describing the
   pre-redesign navigation, and all were fixed on `main` by PR #15 while this program was
   under way. Verified directly afterwards: frontend unit 375 passed, browser suite 212
   passed.

2. **A claim that `main` did not contain the ARPI work.** It did. The local
   `origin/main` remote-tracking ref was stale from clone time; `git ls-remote` showed the
   real ref all along. No work was affected, but the reasoning behind it was wrong for
   several steps.

3. **Two "full-suite failures" attributed to the code.** Both were self-inflicted: a
   `git checkout` ran against the working tree while a background suite was executing, so
   `sql/09_migrations/` disappeared mid-run. A clean run on the merged `main` gave
   2833 passed. Concurrent git operations and long test runs do not mix, and the lesson is
   recorded here rather than in a commit message nobody will read.
