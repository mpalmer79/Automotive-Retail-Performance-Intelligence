# `sql/` — the ARPI PostgreSQL database

This directory is the authoritative definition of the ARPI database: schemas,
raw landing tables, staging views, conformed dimensions, merge logic, audit
objects, reporting views, indexes, roles, grants and data-quality checks.

Everything here is **Implemented** and has been executed against PostgreSQL 16 — with
one precise exception stated plainly: the five fact tables in `04_facts/` **exist and are
constrained, and no fact row has ever been loaded into any of them.** Their generators
and load scripts land in later Phase 1 increments. See
[`04_facts/README.md`](04_facts/README.md).

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
| `02_staging/` | `staging` | Views that type, deduplicate, domain-filter and expose only the newest load batch, plus the rejected-row companion views and the non-throwing cast helpers |
| `03_dimensions/` | `warehouse` | Conformed dimensions and the idempotent merge scripts that load them |
| `04_facts/` | `warehouse` | The five fact tables. **DDL only: no row has ever been loaded** |
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
| 3 | `00_database/03_audit_tables.sql` | Creates the five `audit` tables and the `check_category` domain migration |
| 4 | `01_raw/00_raw_calendar_date_load.sql` | Creates `raw.calendar_date_load` + batch index |
| 5 | `01_raw/01_raw_dealership_load.sql` | Creates `raw.dealership_load` + batch index |
| 6 | `01_raw/02_raw_vehicle_model_load.sql` | Creates `raw.vehicle_model_load` + batch index |
| 7 | `01_raw/03_raw_vehicle_load.sql` | Creates `raw.vehicle_load` + batch index |
| 8 | `01_raw/04_raw_employee_load.sql` | Creates `raw.employee_load` + batch index |
| 9 | `01_raw/05_raw_customer_load.sql` | Creates `raw.customer_load` + batch index |
| 10 | `01_raw/06_raw_lead_source_load.sql` | Creates `raw.lead_source_load` + batch index |
| 11 | `01_raw/07_raw_marketing_campaign_load.sql` | Creates `raw.marketing_campaign_load` + batch index |
| 12 | `01_raw/08_raw_acquisition_event_load.sql` | Creates `raw.acquisition_event_load` + batch index |
| 13 | `01_raw/09_raw_sale_event_load.sql` | Creates `raw.sale_event_load` + batch index |
| 14 | `01_raw/10_raw_lead_load.sql` | Creates `raw.lead_load` + batch index |
| 15 | `01_raw/11_raw_appointment_load.sql` | Creates `raw.appointment_load` + batch index |
| 16 | `01_raw/12_raw_marketing_spend_load.sql` | Creates `raw.marketing_spend_load` + batch index |
| 17 | `02_staging/00_stg_calendar_date.sql` | Creates `staging.stg_calendar_date` |
| 18 | `02_staging/01_stg_dealership.sql` | Creates `staging.stg_dealership` |
| 19 | `02_staging/02_stg_cast_functions.sql` | Creates the non-throwing `staging.fn_try_*` cast helpers |
| 20 | `02_staging/03_stg_vehicle_model.sql` | Creates `staging.stg_vehicle_model_typed`, `staging.stg_vehicle_model`, `staging.stg_vehicle_model_rejected` |
| 21 | `02_staging/04_stg_vehicle.sql` | Creates `staging.stg_vehicle_typed`, `staging.stg_vehicle`, `staging.stg_vehicle_rejected` |
| 22 | `02_staging/05_stg_employee.sql` | Creates `staging.stg_employee_typed`, `staging.stg_employee`, `staging.stg_employee_rejected` |
| 23 | `02_staging/06_stg_customer.sql` | Creates `staging.stg_customer_typed`, `staging.stg_customer`, `staging.stg_customer_rejected` |
| 24 | `02_staging/07_stg_lead_source.sql` | Creates `staging.stg_lead_source_typed`, `staging.stg_lead_source`, `staging.stg_lead_source_rejected` |
| 25 | `02_staging/08_stg_marketing_campaign.sql` | Creates `staging.stg_marketing_campaign_typed`, `staging.stg_marketing_campaign`, `staging.stg_marketing_campaign_rejected` |
| 26 | `02_staging/09_stg_acquisition_event.sql` | Creates `staging.stg_acquisition_event_typed`, `staging.stg_acquisition_event`, `staging.stg_acquisition_event_rejected` |
| 27 | `02_staging/10_stg_sale_event.sql` | Creates `staging.stg_sale_event_typed`, `staging.stg_sale_event`, `staging.stg_sale_event_rejected` |
| 28 | `02_staging/11_stg_lead.sql` | Creates `staging.stg_lead_typed`, `staging.stg_lead`, `staging.stg_lead_rejected` |
| 29 | `02_staging/12_stg_appointment.sql` | Creates `staging.stg_appointment_typed`, `staging.stg_appointment`, `staging.stg_appointment_rejected` |
| 30 | `02_staging/13_stg_marketing_spend.sql` | Creates `staging.stg_marketing_spend_typed`, `staging.stg_marketing_spend`, `staging.stg_marketing_spend_rejected` |
| 31 | `03_dimensions/00_dim_date.sql` | Creates `warehouse.dim_date` |
| 32 | `03_dimensions/01_dim_dealership.sql` | Creates `warehouse.dim_dealership` + current-row unique index |
| 33 | `03_dimensions/02_dim_vehicle_model.sql` | Creates `warehouse.dim_vehicle_model` |
| 34 | `03_dimensions/03_dim_vehicle.sql` | Creates `warehouse.dim_vehicle` |
| 35 | `03_dimensions/04_dim_employee.sql` | Creates `warehouse.dim_employee` |
| 36 | `03_dimensions/05_dim_customer.sql` | Creates `warehouse.dim_customer` |
| 37 | `03_dimensions/06_dim_lead_source.sql` | Creates `warehouse.dim_lead_source` |
| 38 | `03_dimensions/07_dim_marketing_campaign.sql` | Creates `warehouse.dim_marketing_campaign` |
| 39 | `03_dimensions/10_dim_date_merge.sql` | **Runtime.** Upserts staging into `dim_date` |
| 40 | `03_dimensions/11_dim_dealership_merge.sql` | **Runtime.** SCD Type 2 merge into `dim_dealership` |
| 41 | `03_dimensions/12_dim_vehicle_model_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_vehicle_model` |
| 42 | `03_dimensions/13_dim_vehicle_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_vehicle` |
| 43 | `03_dimensions/14_dim_employee_merge.sql` | **Runtime.** SCD Type 2 merge into `warehouse.dim_employee` |
| 44 | `03_dimensions/15_dim_customer_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_customer` |
| 45 | `03_dimensions/16_dim_lead_source_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_lead_source` |
| 46 | `03_dimensions/17_dim_marketing_campaign_merge.sql` | **Runtime.** Type 1 merge into `warehouse.dim_marketing_campaign` |
| 47 | `04_facts/00_fact_vehicle_sale.sql` | Creates `warehouse.fact_vehicle_sale` (empty; no row loaded yet) |
| 48 | `04_facts/01_fact_vehicle_inventory_snapshot.sql` | Creates `warehouse.fact_vehicle_inventory_snapshot` (empty; no row loaded yet) |
| 49 | `04_facts/02_fact_lead.sql` | Creates `warehouse.fact_lead` (empty; no row loaded yet) |
| 50 | `04_facts/03_fact_appointment.sql` | Creates `warehouse.fact_appointment` (empty; no row loaded yet) |
| 51 | `04_facts/04_fact_marketing_spend.sql` | Creates `warehouse.fact_marketing_spend` (empty; no row loaded yet) |
| 52 | `05_reporting/00_reporting_scope.sql` | Documents which reporting views exist and which are deliberately absent |
| 53 | `05_reporting/01_vw_calendar.sql` | Creates `reporting.vw_calendar` |
| 54 | `05_reporting/02_vw_dealership.sql` | Creates `reporting.vw_dealership` |
| 55 | `05_reporting/03_vw_pipeline_run_summary.sql` | Creates `reporting.vw_pipeline_run_summary` |
| 56 | `05_reporting/04_vw_data_quality_summary.sql` | Creates `reporting.vw_data_quality_summary` |
| 57 | `06_indexes/00_indexes.sql` | Creates the Phase 0 justified secondary indexes |
| 58 | `06_indexes/01_phase1_indexes.sql` | Creates the Phase 1 justified secondary indexes |
| 59 | `07_security/00_roles.sql` | Creates `arpi_admin`, `arpi_loader`, `arpi_reporter` (NOLOGIN) |
| 60 | `07_security/01_grants.sql` | Moves ownership to `arpi_admin`; applies the grant model; asserts it object by object |
| 61 | `08_validation/00_validation_helpers.sql` | Result-shape template view + `audit.fn_record_validation_result` |
| 62 | `08_validation/01_dim_date_checks.sql` | Creates `audit.vw_dq_dim_date` (`DQ-DATE-001..005`) |
| 63 | `08_validation/02_dim_dealership_checks.sql` | Creates `audit.vw_dq_dim_dealership` (`DQ-DLR-001..005`) |
| 64 | `08_validation/03_referential_checks.sql` | Creates `audit.vw_dq_referential` (`DQ-REF-001..005`) |
| 65 | `08_validation/04_audit_checks.sql` | Creates `audit.vw_dq_audit` (`DQ-AUD-001..005`), `audit.vw_dq_all`, `audit.fn_record_all_dq_checks` |
| 66 | `07_security/01_grants.sql` **(again)** | Privilege-normalisation pass over the objects created in the validation step |

> **The Phase 0 file headers still say "of 25".** Files created in Phase 0 carry the
> position they held when the sequence had 25 steps. Only the files this increment
> touched were renumbered to "of 66". **This table is the authority**; a stale header is
> a documentation lag, not a second ordering, and
> `tests/integration/conftest.py::init_sequence_files` derives the real order from the
> file names, not from the headers.

### Files deliberately **not** in the sequence

| File | Why |
|---|---|
| `07_security/02_role_verification.sql` | Read-only operator report. Run on demand. Harmless if it does run |
| `99_local_reset.sql` | **Destroys all data.** Never part of initialisation. Lives at the `sql/` root so the `sql/0*/` glob cannot pick it up |

### Why the last step repeats the grants script

`ALTER DEFAULT PRIVILEGES` only covers objects created *after* it is set, and
ownership is assigned to `arpi_admin` at step 60. The validation views and
functions created in steps 61–65 would otherwise be owned by the bootstrap role.
`01_grants.sql` is idempotent, so re-running it costs nothing and leaves every
object owned by `arpi_admin` with the correct grants. Step 66 is verified by
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

# The sequence is 66 steps. Rather than paste all 66, run them in sorted order --
# the numeric prefixes are designed so that sorted order IS the correct order.
# Section 3.2 does exactly that; section 2 above lists every step explicitly.
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

`src/arpi/ingestion/loader.py` does the following on every
`arpi run-foundation --load-database`:

1. Resolves an `EntityIngestionSpec` for every generated entity from
   `src/arpi/ingestion/spec.py`. Adding an entity is adding a spec; there is no
   per-entity branch anywhere in the loader.
2. `COPY`s each entity's frame into its `raw.<entity>_load` table with a fresh
   `load_batch_id`.
3. **Globs `sql/03_dimensions/*_merge.sql`, sorts by file name, and executes each
   file's entire text through `psycopg`'s `cursor.execute()`.**
4. Measures the five-layer row-count chain for every entity, reading
   `raw.<entity>_load`, `staging.stg_<entity>` and `staging.stg_<entity>_rejected`
   independently.
5. Reads `staging.stg_<entity>_rejected`, passes every payload through
   `arpi.validation.privacy.redact_payload`, and writes the result to
   `audit.rejected_record`.
6. Records the row counts, the reconciliations and the validation results in `audit`.
7. Commits.

That runtime contract constrains every merge file:

- **Plain SQL only.** No `psql` meta-commands — no `\i`, `\set`, `\c`, `\gexec`,
  `\copy`. (No file under `sql/0*/` uses one, so the whole tree is safe either
  way.)
- **No `BEGIN`/`COMMIT`.** The loader owns the transaction.
- **Statements separated by semicolons.** `psycopg` sends a parameterless
  `execute()` through the simple query protocol, which permits multiple
  statements; they execute strictly in order.
- **Safe on an empty database.** Every merge reads a staging view, so with no raw
  rows it affects zero rows. That is why they also sit inside the ordinary
  initialisation sequence, at steps 39–46.
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
| Phase 1 Type 1 merges | Rerun with unchanged source writes **zero** rows | `ON CONFLICT (<natural key>) DO UPDATE ... WHERE <row> IS DISTINCT FROM <row>`; new surrogate keys are consumed only by rows the dimension has never seen |
| `dim_employee` merge | Rerun with unchanged source writes **zero** rows | Same `attribute_hash` change detection as `dim_dealership`; a proposed version whose hash matches its predecessor on the combined timeline is a no-op |
| Staging cast helpers | Rerun redefines identically | `CREATE OR REPLACE FUNCTION` |
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

### Deterministic surrogate keys for the Phase 1 dimensions

Every Phase 1 merge assigns keys the same way and for the same reasons:
`(SELECT coalesce(max(<key>), 0) FROM warehouse.<table>) + row_number() OVER (ORDER BY <natural key>)`,
applied **only to rows the dimension has never seen**. Rows already present keep the key
they were given, so a key is never reused, never reassigned, and a first load into an
empty dimension yields `1..N` in natural-key order with no gaps. The generator's own key
column is deliberately ignored — staging exposes it as `source_<key>`, lineage only,
because a Type 2 change creates a version the source has no key for.

---

## 5A. The ingestion row-count chain

`staging` is not a pass-through. Four things drop a row, and each is reported rather
than hidden:

| Code | Category | What it means |
|---|---|---|
| `REJ-TYPE-001` | `structural` | A value is present but cannot be represented in its governed type |
| `REJ-NULL-001` | `completeness` | A required value is absent |
| `REJ-DOMAIN-001` | `business_rule` | A value is outside its enumerated domain or numeric range |
| `REJ-KEY-001` | `uniqueness` | A duplicate natural key within one load batch; the highest `raw_record_id` survives |

`REJ-PARSE-001`, `REJ-SCHEMA-001`, `REJ-REF-001` and `REJ-RULE-001` complete the
vocabulary. The full register lives in
[`../docs/source-to-target/README.md`](../docs/source-to-target/README.md) section 4 and
in `src/arpi/ingestion/rejection.py`, which maps each code to one of the seven canonical
validation categories. There is deliberately **one** vocabulary: no `REJ-CAST-*` beside
`REJ-TYPE-*`, no `REJ-DUPKEY-*` beside `REJ-KEY-*`.

Each entity therefore has three staging views, derived from one another so the accepted
set and the rejected set cannot drift apart:

```
staging.stg_<entity>_typed      every row of the newest batch, cast and classified
staging.stg_<entity>            the accepted rows      (rejection_code IS NULL, rank 1)
staging.stg_<entity>_rejected   the dropped rows       (coded, categorised, with payload)
```

Every row of the newest batch appears in exactly one of the latter two, which is what
makes this identity a real assertion rather than an arithmetic tautology:

```
raw = staging_accepted + rejected_invalid + deduplicated
distinct natural keys in staging = those same keys present in the warehouse
```

`src/arpi/ingestion/loader.py` measures each term with its own query and records both
identities as `RECON-INGEST-<ENTITY>-CHAIN` and `RECON-INGEST-<ENTITY>-WAREHOUSE` on
every run, alongside `source`, `raw`, `staging`, `warehouse` and `rejected` row counts in
`audit.pipeline_run_row_count`. This closes `DOC-23`, and
`tests/integration/test_ingestion_row_count_chain.py` is the evidence: it loads six rows
containing one unparseable value, one out-of-domain value, one missing required value and
one duplicate key, then asserts every layer's count and that the chain balances.

**Rejected payloads are redacted before they are persisted.** A quarantined row is stored
*with its values* so the defect can be reproduced, and that is precisely the moment a
prohibited value would be written into a table nobody thinks of as holding data. Every
payload passes through `arpi.validation.privacy.redact_payload` unconditionally — not per
entity, not when the caller remembers. A rejected customer row cannot write an e-mail
address into `audit.rejected_record` even if one somehow appeared in the source.

`audit.rejected_record` has no `rejection_category` or `source_row_number` column. Both
are required by the ingestion contract, so both are carried inside the JSON payload under
the reserved `_lineage` key, and the category is additionally a machine-readable prefix on
`rejection_reason`. Promoting them to real columns is a change to a table owned elsewhere
and is recorded as a follow-up rather than made unilaterally.

---

## 6. Object ownership assumptions

- The initialisation sequence is run by a **superuser**, or by a role that is a
  member of `arpi_admin`. Reassigning ownership requires it.
- After step 60 (and again after step 66) **every** schema, table, view, sequence
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
