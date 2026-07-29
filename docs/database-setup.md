# ARPI database setup

How to stand up a local PostgreSQL database for **Automotive Retail Performance
Intelligence (ARPI)**, initialise the schema, load the synthetic Phase 0 data, and
verify that it worked.

**The database is entirely optional.** The Phase 0 slice generates its CSVs,
validates them and writes its manifest without any database at all. Set one up when
you want to see the warehouse, the SCD Type 2 merge, the reporting views or the role
model actually working.

- **Status: Implemented.** Everything on this page has been executed against
  PostgreSQL 16.13 on Linux.
- **No password appears anywhere in this repository**, and none should ever be
  added. Credentials live in your shell or your secret manager.
- The authoritative execution order is [`../sql/README.md`](../sql/README.md). This
  page is the walkthrough around it.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install and start PostgreSQL 16](#2-install-and-start-postgresql-16)
3. [Create the `arpi_dev` database](#3-create-the-arpidev-database)
4. [Run the initialisation sequence](#4-run-the-initialisation-sequence)
5. [Create a login user and grant it a role](#5-create-a-login-user-and-grant-it-a-role)
6. [Point ARPI at the database](#6-point-arpi-at-the-database)
7. [Load the data](#7-load-the-data)
8. [Verify](#8-verify)
9. [Run the data-quality checks](#9-run-the-data-quality-checks)
10. [Run the integration tests](#10-run-the-integration-tests)
11. [Reset a local database](#11-reset-a-local-database)
12. [Supabase and managed PostgreSQL](#12-supabase-and-managed-postgresql)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| PostgreSQL server | **16 or later** | 15 will probably work; only 16 is tested |
| `psql` client | matching the server | Ships with the server packages |
| Python | **3.11 or later** | Already required by ARPI |
| `psycopg` | 3.1 or later | Optional ARPI extra: `pip install -e '.[db]'` |
| Shell access | — | You need to be able to become the OS `postgres` user, or otherwise hold a superuser role |

Clone the repository and create the virtual environment first:

```bash
git clone https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence.git
cd Automotive-Retail-Performance-Intelligence
python3 -m venv .venv
.venv/bin/pip install -e '.[db,dev]'
```

---

## 2. Install and start PostgreSQL 16

### Linux — Debian and Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-client-16

sudo systemctl enable --now postgresql
sudo systemctl status postgresql --no-pager
```

If your distribution does not carry 16, add the PGDG repository:

```bash
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update && sudo apt-get install -y postgresql-16
```

Inside a container with no `systemd`:

```bash
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c 'SELECT version()'
```

### Linux — Fedora and RHEL

```bash
sudo dnf install -y postgresql16-server postgresql16
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable --now postgresql-16
```

### macOS — Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16

# Put the versioned binaries on PATH (zsh shown):
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
exec zsh
psql --version
```

Homebrew creates a database and a superuser role named after your macOS account,
so `psql postgres` works immediately with no `sudo`.

### macOS — Postgres.app

Download from <https://postgresapp.com>, choose the PostgreSQL 16 server, click
**Initialize**, then add the CLI tools to your `PATH`:

```bash
sudo mkdir -p /etc/paths.d
echo /Applications/Postgres.app/Contents/Versions/latest/bin \
    | sudo tee /etc/paths.d/postgresapp
```

### Confirm the server is up

```bash
# Linux (peer authentication as the postgres OS user):
sudo -u postgres psql -c 'SELECT version()'

# macOS (Homebrew or Postgres.app):
psql postgres -c 'SELECT version()'
```

---

## 3. Create the `arpi_dev` database

The name matters: `sql/99_local_reset.sql` refuses to run against a database whose
name does not start with `arpi_`.

```bash
# Linux
sudo -u postgres createdb arpi_dev

# macOS
createdb arpi_dev
```

From here on, the examples assume you can reach that database. Set the standard
libpq variables once and every `psql` invocation picks them up:

```bash
export PGDATABASE=arpi_dev
# export PGHOST=localhost      # only if you are not using the local socket
# export PGUSER=postgres       # only if your OS user is not a superuser role
```

On Linux you will usually need `sudo -u postgres psql ...` instead, because the
default `pg_hba.conf` uses peer authentication. Both forms are shown below where it
matters.

---

## 4. Run the initialisation sequence

Twenty-five ordered steps, all idempotent. Run from the repository root.

```bash
cd /path/to/Automotive-Retail-Performance-Intelligence

set -e
for f in $(ls -1 sql/0*/*.sql | grep -v '07_security/02_role_verification' | sort); do
    echo "==> $f"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d arpi_dev -f "$f"
done
echo "==> sql/07_security/01_grants.sql (privilege normalisation)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d arpi_dev -f sql/07_security/01_grants.sql
```

On macOS, drop the `sudo -u postgres` prefix and the `-d arpi_dev` if `PGDATABASE`
is exported.

Expected output on a clean database: a `==>` line per file, three
`NOTICE: Created role ...` lines, one
`NOTICE: ARPI privilege model verified ...` line, and **no errors**.

**Run it a second time.** It is designed for that. The second run prints a series of
`NOTICE: ... already exists, skipping` lines and still no errors. If a rerun errors,
something is wrong; do not work around it.

`sql/README.md` section 2 lists every file explicitly if you would rather paste
twenty-five separate commands than a loop.

### What just happened

| Layer | Objects |
|---|---|
| `raw` | `calendar_date_load`, `dealership_load` |
| `staging` | `stg_calendar_date`, `stg_dealership` (views) |
| `warehouse` | `dim_date`, `dim_dealership` |
| `reporting` | `vw_calendar`, `vw_dealership`, `vw_pipeline_run_summary`, `vw_data_quality_summary` |
| `audit` | `pipeline_run`, `pipeline_run_row_count`, `validation_result`, `reconciliation_result`, `rejected_record`, and the `vw_dq_*` check views |
| roles | `arpi_admin`, `arpi_loader`, `arpi_reporter` — all `NOLOGIN` |

No table holds any data yet.

---

## 5. Create a login user and grant it a role

The three ARPI roles are `NOLOGIN` **group** roles. They hold privileges; they
cannot open a connection. You create a login role and grant it membership.

> **Never put a password in this repository, in `config/*.yaml`, in a script, in a
> commit message or in a screenshot.** Every command below either prompts for the
> password interactively or reads it from your environment.

### Option A — `createuser --pwprompt` (recommended)

```bash
# Linux
sudo -u postgres createuser --pwprompt --no-createdb --no-createrole --no-superuser arpi_app
sudo -u postgres psql -d arpi_dev -c 'GRANT arpi_loader TO arpi_app'

# macOS
createuser --pwprompt --no-createdb --no-createrole --no-superuser arpi_app
psql -d arpi_dev -c 'GRANT arpi_loader TO arpi_app'
```

`--pwprompt` reads the password from the terminal without echoing it and without
putting it in your shell history.

### Option B — `\password` inside psql

```bash
sudo -u postgres psql -d arpi_dev
```

```sql
CREATE ROLE arpi_app LOGIN;
\password arpi_app
-- psql prompts twice, hashes the value client-side and sends only the hash.
GRANT arpi_loader TO arpi_app;
\q
```

### A read-only user for Power BI or Excel

```bash
sudo -u postgres createuser --pwprompt --no-createdb --no-createrole --no-superuser arpi_bi
sudo -u postgres psql -d arpi_dev -c 'GRANT arpi_reporter TO arpi_bi'
```

`arpi_bi` can read the twenty-eight reporting views and **nothing else** — not `raw`, not
`staging`, not `warehouse`, not `audit`. That is the point of the role model, and
`tests/integration/test_security_roles.py` proves it rather than assuming it.

### Supplying the password at connection time

```bash
# Interactive: psql prompts, nothing is stored.
psql -h localhost -U arpi_app -d arpi_dev -W

# Scripted: read it from your secret manager into the environment for one command.
PGPASSWORD="$(security find-generic-password -s arpi_dev -w)" \
    psql -h localhost -U arpi_app -d arpi_dev -c 'SELECT 1'

# Or use a ~/.pgpass file, which must be chmod 600 and is never inside the repo.
printf 'localhost:5432:arpi_dev:arpi_app:<password>\n' >> ~/.pgpass
chmod 600 ~/.pgpass
```

### If you connect over TCP on Linux

The Debian and Ubuntu default `pg_hba.conf` allows `local` connections by peer
authentication only. To let `arpi_app` connect over TCP with a password, confirm
these lines exist in `/etc/postgresql/16/main/pg_hba.conf`:

```
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
```

then `sudo systemctl reload postgresql`.

---

## 6. Point ARPI at the database

ARPI reads configuration from `config/<profile>.yaml`, overridden by environment
variables prefixed `ARPI_` with `__` for nesting. Copy the template and edit your
own copy; `.env` is gitignored, `.env.example` is not.

```bash
cp .env.example .env
```

The variables that matter here, all documented in
[`../.env.example`](../.env.example):

| Variable | Example | Meaning |
|---|---|---|
| `ARPI_DATABASE__ENABLED` | `true` | Must be `true` or the load step is skipped |
| `ARPI_DATABASE__HOST` | `localhost` | Server host |
| `ARPI_DATABASE__PORT` | `5432` | Server port |
| `ARPI_DATABASE__NAME` | `arpi_dev` | Database name |
| `ARPI_DATABASE__USER` | `arpi_app` | **Login** role, not the group role |
| `ARPI_DATABASE__SSLMODE` | `prefer` | `require` or stricter for anything remote |
| `ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS` | `10` | Connection timeout |
| `ARPI_DATABASE__PASSWORD` | *(never committed)* | The only secret ARPI reads |

```bash
export ARPI_DATABASE__ENABLED=true
export ARPI_DATABASE__HOST=localhost
export ARPI_DATABASE__PORT=5432
export ARPI_DATABASE__NAME=arpi_dev
export ARPI_DATABASE__USER=arpi_app
export ARPI_DATABASE__SSLMODE=prefer

# Read the secret from somewhere that is not this repository:
read -rs -p 'ARPI database password: ' ARPI_DATABASE__PASSWORD
export ARPI_DATABASE__PASSWORD
echo
```

Notes:

- `ARPI_DATABASE__PASSWORD` is the only supported secret; `PGPASSWORD` is accepted
  as a fallback. Putting a `password` key in `config/*.yaml` is a hard error.
- ARPI holds it as a `SecretStr` and redacts it as `***REDACTED***` in every
  `repr`, `str` and log line.
- When `ARPI_DATABASE__ENABLED=true`, host, name and user must all be set or
  configuration fails with a message naming the missing keys.

---

## 7. Load the data

```bash
.venv/bin/arpi run-foundation --profile development --load-database
```

That command:

1. generates `dim_date` and `dim_dealership` deterministically from the profile's
   seed and reporting window;
2. validates them and writes `data/raw/development/` plus the manifest;
3. opens a transaction and `COPY`s both CSVs into `raw.calendar_date_load` and
   `raw.dealership_load` under a fresh `load_batch_id`;
4. globs `sql/03_dimensions/*_merge.sql`, sorts by file name, and executes each file
   — the Type 1 upsert into `dim_date`, then the SCD Type 2 merge into
   `dim_dealership`;
5. records row counts and validation results in `audit`;
6. commits.

**Run it twice.** The second run writes zero warehouse rows: the `dim_date` upsert
only fires where an attribute actually differs, and the dealership merge only acts
when `attribute_hash` changes. That is the idempotency guarantee, and it is what
`tests/integration/test_dimension_merges.py` asserts.

To generate without touching the database, use `--no-load-database` or leave
`ARPI_DATABASE__ENABLED=false`.

---

## 8. Verify

```bash
psql -d arpi_dev
```

```sql
-- Five schemas
\dn

-- Eight dimension tables and five fact tables
\dt warehouse.*

-- Exactly twenty-eight reporting views
\dv reporting.*

-- Row counts
SELECT count(*) AS dim_date_rows FROM warehouse.dim_date;
SELECT count(*) AS dealership_versions FROM warehouse.dim_dealership;
SELECT count(*) AS current_stores FROM warehouse.dim_dealership WHERE is_current;

-- The calendar, business-side
SELECT date_key, calendar_date, day_name, month_year_label, is_selling_day, holiday_name
FROM reporting.vw_calendar
ORDER BY date_key
LIMIT 10;

-- The three Granite State Auto Group stores
SELECT dealership_code, store_short_name, brand_label, location_label, opened_date
FROM reporting.vw_dealership
ORDER BY dealership_code;

-- The last few pipeline runs
SELECT pipeline_run_id, profile_name, run_status, started_at, duration_seconds,
       warehouse_row_count, validation_failed_count, reconciliation_status
FROM reporting.vw_pipeline_run_summary
ORDER BY started_at DESC
LIMIT 5;

-- Current data-quality state
SELECT check_id, check_status, failed_record_count, message
FROM reporting.vw_data_quality_summary
WHERE is_latest_run_for_check
ORDER BY check_id;
```

For the `development` profile (2025-07-01 to 2025-12-31) expect **184** rows in
`warehouse.dim_date` and **3** current stores.

### Verify the security model

```bash
psql -d arpi_dev -P pager=off -f sql/07_security/02_role_verification.sql
```

Every `assessment` column must read `ok`. The rows that matter most are section 3:
`arpi_reporter` must show `false` against both raw tables.

Prove it interactively without needing a second login:

```sql
SET ROLE arpi_reporter;
SELECT count(*) FROM reporting.vw_dealership;   -- works
SELECT count(*) FROM raw.dealership_load;       -- ERROR: permission denied for schema raw
RESET ROLE;
```

---

## 9. Run the data-quality checks

The SQL checks live in `audit` and share their identifiers with the Python
validation framework, so `DQ-DATE-001` means the same rule in both.

```sql
-- Everything, in one place
SELECT check_id, status, observed_value, expected_value, failed_record_count, message
FROM audit.vw_dq_all
ORDER BY check_id;

-- Only the problems
SELECT check_id, severity, message
FROM audit.vw_dq_all
WHERE status = 'failed'
ORDER BY severity, check_id;
```

| View | Covers |
|---|---|
| `audit.vw_dq_dim_date` | `DQ-DATE-001..005` |
| `audit.vw_dq_dim_dealership` | `DQ-DLR-001..005` |
| `audit.vw_dq_referential` | `DQ-REF-001..005` |
| `audit.vw_dq_audit` | `DQ-AUD-001..005` |
| `audit.vw_dq_all` | all twenty |

`status` is `passed`, `failed` or **`skipped`**. A check over an empty table reports
`skipped`, never `passed` — there is no evidence to claim.

Persist the results against a run:

```sql
SELECT audit.fn_record_all_dq_checks(
    (SELECT max(pipeline_run_id) FROM audit.pipeline_run)
);
```

---

## 10. Run the integration tests

```bash
.venv/bin/pytest -m integration -v
```

The tests create their own throwaway database (`arpi_it_<random>`), run the whole
initialisation sequence into it **twice**, assert schemas, grains, CHECK
constraints, foreign keys, merge idempotency, the SCD Type 2 path and the role
restrictions, then drop the database. They **skip cleanly** when no server is
reachable, so an environment without PostgreSQL still gets a green suite.

They read the same `ARPI_DATABASE__*` and `PG*` variables as everything else, and
fall back to the local socket as your own OS user. Creating and dropping a database
requires a role with `CREATEDB`.

`pytest` is configured with coverage thresholds for the full suite, so an
integration-only run reports low coverage. Add `--no-cov` when you are running the
integration tests on their own:

```bash
.venv/bin/pytest -m integration -v --no-cov
```

---

## 11. Reset a local database

```bash
psql -v ON_ERROR_STOP=1 -d arpi_dev -f sql/99_local_reset.sql
```

> ### Read this before running it
>
> **This destroys every ARPI schema and every row in them — including the complete
> audit history of every pipeline run ever recorded in that database. There is no
> undo, no backup and no confirmation prompt.**

Guard rails:

- The script refuses to run unless the current database name starts with `arpi_`
  and does not contain `prod`. Run it against `postgres`, `analytics` or
  `arpi_prod` and it raises an exception and changes nothing.
- It does **not** drop the database itself.
- It does **not** drop `arpi_admin`, `arpi_loader` or `arpi_reporter`. Roles are
  cluster-wide, and dropping them could break another database on the same server.
- It is **not** part of the initialisation sequence and must never be added to it.
  It lives at the `sql/` root precisely so the `sql/0*/` glob cannot pick it up.

Rebuild afterwards by re-running [section 4](#4-run-the-initialisation-sequence).

To start completely fresh instead:

```bash
sudo -u postgres dropdb --if-exists arpi_dev
sudo -u postgres createdb arpi_dev
```

---

## 12. Supabase and managed PostgreSQL

**Status: Planned. Optional for everything on this page; required for one thing.**

**This page is the LOCAL walkthrough.** Its cloud sibling is
[`cloud-database-setup.md`](cloud-database-setup.md), which is the authoritative
procedure for a managed PostgreSQL 16 instance and supersedes the sketch below.
Read that one if a hosted database is what you actually want.

Everything else in ARPI still runs entirely on a local PostgreSQL server, and the
database itself is optional: the generator, the tests, the reporting layer and CI
all work without a hosted instance, and **none is provisioned today.** Do not read
this section as a description of a running deployment. There is none.

What changed, and why this is no longer Deferred: ADR-0008 accepts Microsoft Fabric
as a real-engine validation path for the semantic model, and a cloud service cannot
reach `localhost`. Validating the model that way needs a database Fabric can see.
That is the one thing a hosted instance is now required for.

The constraints below are the summary; `cloud-database-setup.md` works through all
of them with commands. What has to be true:

- **Superuser.** Managed platforms do not give you one. Step 19 of the sequence
  reassigns object ownership to `arpi_admin`, which requires either a superuser or
  a role that is a member of `arpi_admin`. On Supabase the `postgres` role can be
  granted `arpi_admin` and the sequence then works; on other platforms check the
  equivalent.
- **TLS.** Set `ARPI_DATABASE__SSLMODE=require` at minimum, and `verify-full` with
  a pinned CA where the provider publishes one. `prefer` is acceptable on a Unix
  socket and nowhere else.
- **Credentials.** The connection string a provider hands you contains a password.
  It goes in your secret manager or your local `.env`, never in `config/*.yaml`,
  never in a commit, never in a screenshot.
- **Cost and data residency.** The data is 100% synthetic and describes a fictional
  dealer group, so there is no privacy exposure — but a free tier that pauses or
  expires will still make a report look broken.
- **`sql/99_local_reset.sql` must never be pointed at it.** Name the database so
  the guard rejects it (anything not matching `arpi_%`, or containing `prod`).

Until all of that is deliberately decided, local PostgreSQL is the supported
configuration and the only one that has been tested.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `could not connect to server: No such file or directory` | The server is not running | `sudo systemctl start postgresql`, or `brew services start postgresql@16`, or `sudo pg_ctlcluster 16 main start` |
| `FATAL: Peer authentication failed for user "postgres"` | Linux `pg_hba.conf` uses peer auth and your OS user is not `postgres` | Prefix commands with `sudo -u postgres`, or create a superuser role named after your OS user |
| `FATAL: role "<you>" does not exist` | No PostgreSQL role matches your OS user | `sudo -u postgres createuser -s "$(whoami)"` |
| `FATAL: database "arpi_dev" does not exist` | Step 3 was skipped | `createdb arpi_dev` |
| `psql: command not found` on macOS | Homebrew's versioned bin directory is not on `PATH` | `export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"` |
| `ERROR: permission denied for schema raw` while running as `arpi_reporter` | **Working as designed.** The reporter is confined to `reporting` | Use `arpi_loader` for pipeline work |
| `ERROR: permission denied for schema warehouse` from Power BI | Power BI is bound to a warehouse table instead of a reporting view | Repoint the model at `reporting.vw_*` |
| `ERROR: must be owner of schema raw` during `01_grants.sql` | Not running as a superuser or as a member of `arpi_admin` | Re-run the sequence as the `postgres` superuser |
| `ERROR: cannot change owner of sequence ... is linked to table` | An old copy of `01_grants.sql` | Update; the current script skips column-owned sequences, which follow their table automatically |
| `REFUSING TO RESET DATABASE "..."` | The reset guard did its job | Only reset a database whose name starts with `arpi_` and lacks `prod` |
| Second run of the init sequence errors | A file has lost its idempotency guard | Compare against `sql/README.md` section 5; every script must be `IF NOT EXISTS` / `OR REPLACE` / guarded |
| `arpi run-foundation --load-database` skips the load silently | `ARPI_DATABASE__ENABLED` is not `true` | `export ARPI_DATABASE__ENABLED=true` |
| Configuration error naming missing database keys | `ENABLED=true` with host, name or user unset | Set all three |
| `FATAL: password authentication failed for user "arpi_app"` | Wrong or unset password, or `pg_hba.conf` is not using `scram-sha-256` for host connections | Reset with `\password arpi_app`; check `pg_hba.conf`; confirm `ARPI_DATABASE__PASSWORD` is exported |
| `ERROR: relation "warehouse.dim_date" does not exist` | The init sequence has not been run against this database | Run [section 4](#4-run-the-initialisation-sequence) |
| `dim_date` is empty after a load | The generator ran but the load step did not | Check `reporting.vw_pipeline_run_summary` for the run's status and row counts |
| A second load duplicated warehouse rows | Should be impossible | Run `SELECT * FROM audit.vw_dq_all WHERE status = 'failed'` and open an issue with the output |
| Every data-quality check says `skipped` | The target tables are empty | Load data first; `skipped` is correct and deliberate for an empty table |
| `pytest -m integration` reports everything skipped | No reachable server | Start PostgreSQL, or set `ARPI_DATABASE__*` / `PG*` |
| `pytest -m integration` fails on coverage | Coverage thresholds apply to the full suite | Add `--no-cov` for an integration-only run |
| `permission denied to create database` during the tests | The test role lacks `CREATEDB` | `sudo -u postgres psql -c 'ALTER ROLE "<you>" CREATEDB'` |

### Still stuck?

Collect this and open an issue:

```bash
psql -d arpi_dev -c 'SELECT version()'
psql -d arpi_dev -c '\dn'
psql -d arpi_dev -c 'SELECT check_id, status, message FROM audit.vw_dq_all ORDER BY check_id'
psql -d arpi_dev -P pager=off -f sql/07_security/02_role_verification.sql
```

**Redact nothing except credentials — and there should not be any in that output.**

---

## See also

- [`../sql/README.md`](../sql/README.md) — authoritative execution order, idempotency guarantees, ownership model
- [`../sql/04_facts/README.md`](../sql/04_facts/README.md) — why there are no fact tables yet
- [`../.env.example`](../.env.example) — every ARPI environment variable
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — sections 10, 11, 14, 17, 21 and 22
