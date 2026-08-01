# ADR-0010: Execution identity and logical-run key

- **Status:** Accepted
- **Date:** 2026-08-01
- **Supersedes:** the deterministic-`run_uuid` decision recorded in `src/arpi/audit/run.py`
- **Related:** ADR-0002 (Phase 0 technology baseline), `ARCHITECTURE.md` §17.3, §21.4

## Context

`audit.pipeline_run` is the root of the ARPI audit layer. Every row count, validation
result, reconciliation and rejected record hangs off it, and `ARCHITECTURE.md` §21.4
treats those rows as the evidence that a run did what it claims.

Phase 0 gave `run_uuid` a deterministic value: a UUIDv5 over `(pipeline_name, profile,
random_seed, start_date, end_date)`. The intent was idempotency — rerunning the same
pipeline should not accumulate duplicate audit rows. The loader implemented that with

```sql
INSERT INTO audit.pipeline_run (...) VALUES (...)
ON CONFLICT (run_uuid) DO UPDATE SET
  completed_at = EXCLUDED.completed_at, status = EXCLUDED.status,
  critical_failure_count = EXCLUDED.critical_failure_count,
  warning_count = EXCLUDED.warning_count, notes = EXCLUDED.notes
```

and by deleting and reinserting the run's child rows.

That design conflates two genuinely different things, and the conflation loses data:

1. **Two executions become one row.** Running the same pipeline twice leaves one
   `audit.pipeline_run` row. The audit layer cannot answer "how many times was this run?"
2. **Recorded duration belongs to no execution.** `started_at` is absent from the
   `DO UPDATE SET` list and survives from the first attempt, while `completed_at` is
   overwritten by the last. Their difference spans from one attempt's start to another
   attempt's finish.
3. **Recorded version can be stale.** `arpi_version` and `run_mode` are likewise not
   updated, so a row can name a version that did not produce the state it describes.
4. **Failures vanish.** A failed attempt followed by a successful retry collapses into a
   single `succeeded` row. The failure is unrecoverable from the audit trail.
5. **Child lineage is destroyed.** Row counts, validation results and rejected records are
   replaced, so they can no longer be attributed to the attempt that produced them.

An audit trail that overwrites itself is not an audit trail. Idempotency is a legitimate
requirement, but audit-row reuse is the wrong mechanism for it.

## Decision

Split the single identifier into two, with distinct and separately documented semantics.

### Execution identity — `run_uuid`

A **random UUIDv4 generated once at the start of every execution**.

- Unique for every execution attempt. Never reused.
- Generated at run start, before any work is done.
- Carries the start and completion timestamps of **one** attempt.
- Carries the `arpi_version`, `run_mode`, `profile_name` and `random_seed` of that attempt.
- Carries that attempt's success or failure.
- Is the value every child audit record references (indirectly, through the
  `pipeline_run_id` surrogate key).

### Logical-run identity — `logical_run_key`

A **deterministic UUIDv5 fingerprint of the inputs that define an equivalent run**, over
`(pipeline_name, profile, random_seed, start_date, end_date)` — exactly the payload the
old `run_uuid` used, under the fixed namespace that has always been used.

- Repeated equivalent executions share the same value.
- **Not unique** in `audit.pipeline_run`; it is deliberately many-to-one.
- Supports grouping and comparison ("show me every attempt at this run").
- Is not the primary key, is not the conflict target, and is never used to overwrite
  history.

### Why `run_uuid` is retained rather than renamed

The column is referenced by `uq_pipeline_run_run_uuid`, by operator runbooks that
correlate log lines with database rows, and by the reporting view
`vw_pipeline_run_summary`. Renaming it would force a breaking migration across every one
of those for a purely terminological gain. Retaining the physical name while correcting
its semantics is the lower-risk change, and it keeps every existing foreign key intact —
the child tables reference `pipeline_run_id`, which is unaffected.

The cost of retaining it is that the name no longer hints at determinism. This ADR, the
column comment, `DATA_DICTIONARY.md` and the audit-schema documentation all state
explicitly that `run_uuid` identifies **one execution attempt**.

### Application version is deliberately excluded from the logical key

`arpi_version` is **not** an input to `logical_run_key`. The logical key answers "were
these runs asked to do the same thing?", and upgrading ARPI does not change what the run
was asked to do. Including the version would fragment the key on every release and make
"compare this run before and after the upgrade" — the most valuable question the key
enables — impossible to express.

The version remains recorded per execution, so the comparison is available: same
`logical_run_key`, different `arpi_version`.

## Idempotency after this change

Warehouse idempotency does **not** depend on audit-row reuse and never should have. It is
carried by, and continues to be carried by:

- deterministic generated source data (same seed produces byte-identical output);
- natural and source keys on every entity;
- surrogate-key resolution in the dimension merges;
- `MERGE`/upsert behaviour in `sql/03_dimensions/1*_*_merge.sql`;
- attribute hashes that suppress no-op Type 2 versions;
- load batches in the raw layer;
- unique grain constraints on every dimension and fact.

Re-running a logical run therefore still produces no duplicate warehouse rows. What
changes is that the *audit layer* now records that it happened twice.

`audit.pipeline_run_row_count` keeps its `(pipeline_run_id, entity_name, layer)` primary
key. Because each execution now has its own `pipeline_run_id`, the row counts of two
attempts no longer collide, and the loader no longer needs to delete child rows before
inserting them. That deletion is removed.

## Consequences

**Positive**

- Execution history is preserved. Retries, failures and reruns are all visible.
- Durations, versions and run modes describe exactly one attempt.
- Child audit records keep correct lineage.
- Equivalent runs remain groupable, which is what the deterministic identifier was
  actually wanted for.

**Negative**

- `audit.pipeline_run` grows by one row per execution rather than converging. This is the
  intended behaviour of an audit table and is bounded by how often the pipeline is run.
- Historical rows written before this change may each represent several collapsed
  attempts. They are backfilled with a correct `logical_run_key` but their collapsed
  history **cannot be recovered**, and `LIMITATIONS.md` says so.
- Any query that assumed one row per `(pipeline, profile, seed, window)` must now
  aggregate or select the latest attempt. The reporting view is updated accordingly.

## Migration

Additive and forward-safe (`sql/09_migrations/0001_add_logical_run_key.sql`):

1. `ADD COLUMN logical_run_key uuid NULL`.
2. Backfill every existing row deterministically from its own stored inputs, reproducing
   the UUIDv5 the row's old `run_uuid` already held — so existing rows keep the identifier
   they have always had, now in the semantically correct column.
3. `SET NOT NULL`.
4. `CREATE INDEX ix_pipeline_run_logical_run_key`.
5. Leave the primary key, `uq_pipeline_run_run_uuid` and every child foreign key untouched.

No row is deleted or merged, and no execution attempt that was already collapsed is
invented.

## Alternatives rejected

**Keep the deterministic `run_uuid` and add an attempt counter.** Requires a composite
key, changes every child foreign key, and still cannot represent two attempts whose child
rows differ. Strictly more migration cost for strictly less fidelity.

**Rename `run_uuid` to `execution_uuid` and add `logical_run_key`.** Cleanest naming,
highest cost: a breaking change to the reporting view, the runbooks and the operator
correlation workflow, for no behavioural gain. Rejected on the cost/benefit, and the
program's compatibility guidance explicitly prefers retention.

**Keep collapsing, and record attempts in a new child table.** Two places to look for one
fact, and the parent row's `started_at`/`completed_at`/`arpi_version` would remain wrong.
