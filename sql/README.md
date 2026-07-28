# `sql/` — the ARPI PostgreSQL database

This directory is the authoritative definition of the ARPI database: schemas,
raw landing tables, staging views, conformed dimensions, merge logic, audit
objects, reporting views, indexes, roles, grants and data-quality checks.

Everything here is **Implemented** and has been executed against PostgreSQL 16.
No fact table exists yet — see [`04_facts/README.md`](04_facts/README.md).

- Target: **PostgreSQL 16** or later.
- Every script is **idempotent**: running the whole sequence twice produces the
  same database and no errors.
- Every script uses **fully schema-qualified** object names. Nothing relies on
  `search_path`.
- **No script contains a password, credential or connection string.** Login roles
  and their secrets are created out of band; see
  [`07_security/00_roles.sql`](07_security/00_roles.sql) and
  [`../docs/database-setup.md`](../docs/database-setup.md).
- The only destructive script is [`99_local_reset.sql`](99_local_reset.sql), and
  it refuses to run outside a development database.

---

## 1. Layers

| Directory | Schema | What it does |
|---|---|---|
| `00_database/` | all five | Creates the schemas, records the conventions, creates the `audit` tables |
| `01_raw/` | `raw` | Landing tables. Every business column is `text`; nothing is transformed |
| `02_staging/` | `staging` | Views that type, deduplicate and expose only the newest load batch |
| `03_dimensions/` | `warehouse` | Conformed dimensions and the idempotent merge scripts that load them |
| `04_facts/` | `warehouse` | **Empty.** Facts land in Phase 1.2 |
| `05_reporting/` | `reporting` | The four business-facing views. The only schema Power BI may read |
| `06_indexes/` | `warehouse`, `audit` | Secondary indexes that a query which exists today actually needs |
| `07_security/` | cluster + all | The three group roles, the grant model, and an operator verification report |
| `08_validation/` | `audit` | SQL data-quality checks in a uniform result shape |

Data flows strictly one way:

```
CSV file  ->  raw  ->  staging  ->  warehouse  ->  reporting  ->  Power BI / Excel
                          audit records every step
```

---

## 2. Authoritative execution order

Run these files in exactly this order. Every file states its own position in its
header block.

| # | File | What it does |
|--:|---|---|
| 1 | `00_database/00_create_schemas.sql` | Creates `raw`, `staging`, `warehouse`, `reporting`, `audit` with layer comments |
| 2 | `00_database/02_conventions.sql` | Records naming, timezone and SCD conventions; comments the database |
| 3 | `00_database/03_audit_tables.sql` | Creates the five `audit` tables |
| 4 | `01_raw/00_raw_calendar_date_load.sql` | Creates `raw.calendar_date_load` + batch index |
| 5 | `01_raw/01_raw_dealership_load.sql` | Creates `raw.dealership_load` + batch index |
| 6 | `02_staging/00_stg_calendar_date.sql` | Creates `staging.stg_calendar_date` |
| 7 | `02_staging/01_stg_dealership.sql` | Creates `staging.stg_dealership` |
| 8 | `03_dimensions/00_dim_date.sql` | Creates `warehouse.dim_date` |
| 9 | `03_dimensions/01_dim_dealership.sql` | Creates `warehouse.dim_dealership` + current-row unique index |
| 10 | `03_dimensions/10_dim_date_merge.sql` | **Runtime.** Upserts staging into `dim_date` |
| 11 | `03_dimensions/11_dim_dealership_merge.sql` | **Runtime.** SCD Type 2 merge into `dim_dealership` |
| 12 | `05_reporting/00_reporting_scope.sql` | Documents which reporting views exist and which are deliberately absent |
| 13 | `05_reporting/01_vw_calendar.sql` | Creates `reporting.vw_calendar` |
| 14 | `05_reporting/02_vw_dealership.sql` | Creates `reporting.vw_dealership` |
| 15 | `05_reporting/03_vw_pipeline_run_summary.sql` | Creates `reporting.vw_pipeline_run_summary` |
| 16 | `05_reporting/04_vw_data_quality_summary.sql` | Creates `reporting.vw_data_quality_summary` |
| 17 | `06_indexes/00_indexes.sql` | Creates the justified secondary indexes |
| 18 | `07_security/00_roles.sql` | Creates `arpi_admin`, `arpi_loader`, `arpi_reporter` (NOLOGIN) |
| 19 | `07_security/01_grants.sql` | Moves ownership to `arpi_admin`; applies the grant model |
| 20 | `08_validation/00_validation_helpers.sql` | Result-shape template view + `audit.fn_record_validation_result` |
| 21 | `08_validation/01_dim_date_checks.sql` | Creates `audit.vw_dq_dim_date` (`DQ-DATE-001..005`) |
| 22 | `08_validation/02_dim_dealership_checks.sql` | Creates `audit.vw_dq_dim_dealership` (`DQ-DLR-001..005`) |
| 23 | `08_validation/03_referential_checks.sql` | Creates `audit.vw_dq_referential` (`DQ-REF-001..005`) |
| 24 | `08_validation/04_audit_checks.sql` | Creates `audit.vw_dq_audit` (`DQ-AUD-001..005`), `audit.vw_dq_all`, `audit.fn_record_all_dq_checks` |
| 25 | `07_security/01_grants.sql` **(again)** | Privilege-normalisation pass over the objects created in steps 20–24 |

### Files deliberately **not** in the sequence

| File | Why |
|---|---|
| `07_security/02_role_verification.sql` | Read-only operator report. Run on demand. Harmless if it does run |
| `99_local_reset.sql` | **Destroys all data.** Never part of initialisation. Lives at the `sql/` root so the `sql/0*/` glob cannot pick it up |

### Why step 25 repeats step 19

`ALTER DEFAULT PRIVILEGES` only covers objects created *after* it is set, and
ownership is assigned to `arpi_admin` at step 19. The validation views and
functions created in steps 20–24 would otherwise be owned by the bootstrap role.
`01_grants.sql` is idempotent, so re-running it costs nothing and leaves every
object owned by `arpi_admin` with the correct grants. Step 25 is verified by
`tests/integration/test_security_roles.py`.

### Why there is no `00_database/01_extensions.sql`

No PostgreSQL extension is needed. SHA-256 attribute hashes are computed in
Python, surrogate keys are plain integers, and there is no search or spatial
requirement. An empty extensions script would imply a dependency that does not
exist, so the file is absent rather than empty. The numbering gap is intentional.

---

## 3. Running it

### 3.1 One-off, explicit and copy-pasteable

```bash
cd /path/to/Automotive-Retail-Performance-Intelligence
export PGDATABASE=arpi_dev            # never a production database

psql -v ON_ERROR_STOP=1 -f sql/00_database/00_create_schemas.sql
psql -v ON_ERROR_STOP=1 -f sql/00_database/02_conventions.sql
psql -v ON_ERROR_STOP=1 -f sql/00_database/03_audit_tables.sql
psql -v ON_ERROR_STOP=1 -f sql/01_raw/00_raw_calendar_date_load.sql
psql -v ON_ERROR_STOP=1 -f sql/01_raw/01_raw_dealership_load.sql
psql -v ON_ERROR_STOP=1 -f sql/02_staging/00_stg_calendar_date.sql
psql -v ON_ERROR_STOP=1 -f sql/02_staging/01_stg_dealership.sql
psql -v ON_ERROR_STOP=1 -f sql/03_dimensions/00_dim_date.sql
psql -v ON_ERROR_STOP=1 -f sql/03_dimensions/01_dim_dealership.sql
psql -v ON_ERROR_STOP=1 -f sql/03_dimensions/10_dim_date_merge.sql
psql -v ON_ERROR_STOP=1 -f sql/03_dimensions/11_dim_dealership_merge.sql
psql -v ON_ERROR_STOP=1 -f sql/05_reporting/00_reporting_scope.sql
psql -v ON_ERROR_STOP=1 -f sql/05_reporting/01_vw_calendar.sql
psql -v ON_ERROR_STOP=1 -f sql/05_reporting/02_vw_dealership.sql
psql -v ON_ERROR_STOP=1 -f sql/05_reporting/03_vw_pipeline_run_summary.sql
psql -v ON_ERROR_STOP=1 -f sql/05_reporting/04_vw_data_quality_summary.sql
psql -v ON_ERROR_STOP=1 -f sql/06_indexes/00_indexes.sql
psql -v ON_ERROR_STOP=1 -f sql/07_security/00_roles.sql
psql -v ON_ERROR_STOP=1 -f sql/07_security/01_grants.sql
psql -v ON_ERROR_STOP=1 -f sql/08_validation/00_validation_helpers.sql
psql -v ON_ERROR_STOP=1 -f sql/08_validation/01_dim_date_checks.sql
psql -v ON_ERROR_STOP=1 -f sql/08_validation/02_dim_dealership_checks.sql
psql -v ON_ERROR_STOP=1 -f sql/08_validation/03_referential_checks.sql
psql -v ON_ERROR_STOP=1 -f sql/08_validation/04_audit_checks.sql
psql -v ON_ERROR_STOP=1 -f sql/07_security/01_grants.sql   # step 25
```

### 3.2 The same thing as a loop

The numeric directory and file prefixes are designed so that plain sorted order is
the correct order. `sql/0*/` cannot match `sql/99_local_reset.sql`.

```bash
cd /path/to/Automotive-Retail-Performance-Intelligence
export PGDATABASE=arpi_dev

set -e
for f in $(ls -1 sql/0*/*.sql | grep -v '07_security/02_role_verification' | sort); do
    echo "==> $f"
    psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "==> sql/07_security/01_grants.sql (privilege normalisation)"
psql -v ON_ERROR_STOP=1 -q -f sql/07_security/01_grants.sql
```

Run it a second time to confirm idempotency. The output is a series of
`NOTICE: ... already exists, skipping` lines and **no errors**.

### 3.3 Verifying

```bash
psql -d arpi_dev -c '\dn'                         # five schemas
psql -d arpi_dev -c '\dt warehouse.*'             # dim_date, dim_dealership
psql -d arpi_dev -c '\dv reporting.*'             # exactly four views
psql -d arpi_dev -c 'SELECT count(*) FROM warehouse.dim_date'
psql -d arpi_dev -c 'SELECT * FROM audit.vw_dq_all ORDER BY check_id'
psql -d arpi_dev -P pager=off -f sql/07_security/02_role_verification.sql
```

Full walkthrough, including creating the database and a login user:
[`../docs/database-setup.md`](../docs/database-setup.md).

---

## 4. What the Python loader executes at runtime

`src/arpi/ingestion/loader.py` (Agent C) does the following on every
`arpi run-foundation --load-database`:

1. Opens one transaction.
2. `COPY`s `dim_date.csv` and `dim_dealership.csv` into `raw.calendar_date_load`
   and `raw.dealership_load` with a fresh `load_batch_id`.
3. **Globs `sql/03_dimensions/*_merge.sql`, sorts by file name, and executes each
   file's entire text through `psycopg`'s `cursor.execute()`.**
4. Records row counts and validation results in `audit`.
5. Commits.

That runtime contract constrains the two merge files, and only those two:

- **Plain SQL only.** No `psql` meta-commands — no `\i`, `\set`, `\c`, `\gexec`,
  `\copy`. (No file under `sql/0*/` uses one, so the whole tree is safe either
  way.)
- **No `BEGIN`/`COMMIT`.** The loader owns the transaction.
- **Statements separated by semicolons.** `psycopg` sends a parameterless
  `execute()` through the simple query protocol, which permits multiple
  statements; they execute strictly in order.
- **Safe on an empty database.** Both merges read staging views, so with no raw
  rows they affect zero rows. That is why they can also sit inside the ordinary
  initialisation sequence at steps 10 and 11.
- **File name matters.** A new dimension merge must be named `NN_<name>_merge.sql`
  to be picked up, and its number determines when it runs relative to the others.

---

## 5. Idempotency guarantees

| Script class | Guarantee | Mechanism |
|---|---|---|
| Schema creation | Rerun changes nothing | `CREATE SCHEMA IF NOT EXISTS` |
| Table DDL | Rerun changes nothing; existing rows untouched | `CREATE TABLE IF NOT EXISTS` |
| Views | Rerun redefines identically | `CREATE OR REPLACE VIEW` |
| Functions | Rerun redefines identically | `CREATE OR REPLACE FUNCTION` |
| Indexes | Rerun changes nothing | `CREATE INDEX IF NOT EXISTS` |
| Roles | Rerun changes nothing; existing roles and memberships preserved | `DO` block guarded on `pg_roles` |
| Grants and ownership | Declarative; rerun converges to the same state | `GRANT`/`REVOKE`/`ALTER ... OWNER` |
| `dim_date` merge | Rerun with unchanged source writes **zero** rows | `ON CONFLICT (date_key) DO UPDATE ... WHERE <row> IS DISTINCT FROM <row>` |
| `dim_dealership` merge | Rerun with unchanged source writes **zero** rows | Change detection on `attribute_hash`; nothing expires and nothing inserts when the hash matches |
| Validation views | Read-only; evaluating them writes nothing | Plain `SELECT`s |

Two things are deliberately **not** idempotent, because they must not be:

- `audit.fn_record_validation_result` and `audit.fn_record_all_dq_checks` append a
  new result row each time they are called. Audit history accumulates; that is the
  point.
- `99_local_reset.sql` destroys data every time it runs.

### Deterministic surrogate keys

`dealership_key` is assigned by the merge as
`max(dealership_key) + row_number() OVER (ORDER BY dealership_id, effective_date)`,
not from a sequence. On a first load this yields `1, 2, 3` in `dealership_id`
order, matching the canonical store table, and rebuilding from the same CSVs
reproduces identical keys. A sequence would drift after any rolled-back load,
because sequences are non-transactional. The reasoning is recorded in the header
of `03_dimensions/11_dim_dealership_merge.sql`.

---

## 6. Object ownership assumptions

- The initialisation sequence is run by a **superuser**, or by a role that is a
  member of `arpi_admin`. Reassigning ownership requires it.
- After step 19 (and again after step 25) **every** schema, table, view, sequence
  and function in the five ARPI schemas is owned by **`arpi_admin`**.
- That ownership is the security mechanism, not a tidiness preference. A
  PostgreSQL view runs with its owner's privileges, so `arpi_reporter` can read
  `reporting.vw_calendar` while holding no privilege whatsoever on
  `warehouse.dim_date` — and none on `raw`.
- `arpi_loader` reads and writes `raw`, `staging`, `warehouse` and `audit`. It
  cannot create objects and has no privileges on `reporting`.
- `arpi_reporter` has `USAGE` on `reporting` and `SELECT` on its views. Nothing
  else. `01_grants.sql` explicitly `REVOKE`s the raw layer from it and then
  asserts the result, raising an exception rather than shipping a hole.
- All three are `NOLOGIN` group roles. Humans and services connect as separate
  login roles granted membership. **No password appears anywhere in this
  repository.**

---

## 7. Data-quality checks

```sql
SELECT check_id, status, failed_record_count, message
FROM audit.vw_dq_all
ORDER BY check_id;
```

| View | Checks |
|---|---|
| `audit.vw_dq_dim_date` | `DQ-DATE-001..005` |
| `audit.vw_dq_dim_dealership` | `DQ-DLR-001..005` |
| `audit.vw_dq_referential` | `DQ-REF-001..005` |
| `audit.vw_dq_audit` | `DQ-AUD-001..005` |
| `audit.vw_dq_all` | all of the above |
| `audit.vw_dq_result_template` | executable specification of the shared result shape |

All return the same ten columns: `check_id`, `check_name`, `check_category`,
`target_object`, `severity`, `status`, `observed_value`, `expected_value`,
`failed_record_count`, `message`. `status` is `passed`, `failed` or **`skipped`** —
a check over an empty table reports `skipped`, never `passed`, because there is no
evidence to claim.

`DQ-DATE-*` and `DQ-DLR-*` identifiers are shared verbatim with the Python
validation framework, so one rule has one identity in both implementations.

Persist the results against a run:

```sql
SELECT audit.fn_record_all_dq_checks(<pipeline_run_id>);
```

---

## 8. Resetting a local database

```bash
psql -v ON_ERROR_STOP=1 -d arpi_dev -f sql/99_local_reset.sql
```

**This destroys every ARPI schema and every row in them, including the whole audit
history. There is no undo and no confirmation prompt.** It refuses to run unless
the database name starts with `arpi_` and does not contain `prod`. It does not
drop the database and does not drop the cluster-wide roles. Rebuild by running the
sequence in section 2 again.

---

## 9. Tests

```bash
.venv/bin/pytest -m integration -v
```

`tests/integration/` creates a throwaway database, runs this entire sequence into
it twice, and asserts the schemas, the grains, the CHECK constraints, the foreign
keys, the merge idempotency, the SCD Type 2 path and the role restrictions —
including that `arpi_reporter` genuinely cannot read `raw.dealership_load`. The
tests skip cleanly when no PostgreSQL server is reachable.
