# ARPI cloud database setup

How to stand up a **managed PostgreSQL 16** database for **Automotive Retail
Performance Intelligence (ARPI)**, build the `reporting` schema in it, load the
`development` profile, and prove it is a faithful copy — so that a **cloud**
semantic-model engine such as Microsoft Fabric can read it.

This is the cloud sibling of [`database-setup.md`](database-setup.md). That page
builds a database on the machine in front of you. A cloud service cannot reach
that machine, which is the entire reason this page exists.

- **Status: Planned.** No hosted instance exists, none is provisioned, and
  nothing in ARPI — not the generator, not the tests, not CI — depends on one.
  This page is the procedure for when somebody deliberately decides to create
  one.
- **There is now an automated route, and it is preferred.**
  [`../deployment/railway/README.md`](../deployment/railway/README.md) performs
  every step of this page on Railway — the ordered SQL sequence, the three-role
  security model, the two login roles, the deterministic load, the verification
  and the reporter-boundary proof — from a one-time job that reaches the database
  over Railway's private network using reference variables, so no credential
  leaves the platform. It has not been run: it needs one API token and a cost
  approval. This page remains the authority for **any other provider**, and
  sections 4 onward are provider-neutral. Read it if you are not using Railway,
  or if you want to know what the automation does. [`../SECURITY.md`](../SECURITY.md) still holds: CI carries no secrets and
  never contacts a hosted database.
- `scripts/verify_cloud_database.py`, the check in
  [section 8](#8-verify), **is** Implemented and has been executed against
  PostgreSQL 16.13.
- **No password, host name, project reference or connection string appears
  anywhere in this repository**, including on this page. Every value below is an
  obvious placeholder. Credentials live in your shell or your secret manager.
- The authoritative execution order is [`../sql/README.md`](../sql/README.md).
  This page is the walkthrough around it, for a remote database.

**Written for a Chromebook**: a browser and a Linux terminal. There is no Windows
step and no PowerShell on this page.

---

## Contents

1. [What this is for, and what it costs](#1-what-this-is-for-and-what-it-costs)
2. [Prerequisites](#2-prerequisites)
3. [Create the project and find the connection details](#3-create-the-project-and-find-the-connection-details)
4. [Set the environment variables](#4-set-the-environment-variables)
5. [Run the ordered SQL sequence](#5-run-the-ordered-sql-sequence)
6. [Create the login role for the semantic model](#6-create-the-login-role-for-the-semantic-model)
7. [Run the pipeline](#7-run-the-pipeline)
8. [Verify](#8-verify)
9. [Regenerate the SQL baseline, and decide whether you need to](#9-regenerate-the-sql-baseline-and-decide-whether-you-need-to)
10. [Cost, teardown and finishing up](#10-cost-teardown-and-finishing-up)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What this is for, and what it costs

### What it is for

The ARPI semantic model reads the `reporting` schema and nothing else. Power BI
Desktop can do that against `localhost` because Desktop runs on your machine. A
**cloud** semantic-model engine — Microsoft Fabric, or a Power BI Service dataset
refreshing without a gateway — cannot: it opens the connection from Microsoft's
network, and `localhost` there is not your laptop.

So the database has to be somewhere both of you can reach. That is the whole
requirement. Nothing about the SQL changes: the same 104-script sequence, the
same three roles, the same 28 reporting views, the same deterministic data.

### Read this before you provision anything

> **Nothing described here should be provisioned on a paid plan without a
> deliberate decision.** ARPI is a portfolio project with 100% synthetic data
> about a fictional dealer group. There is no business continuity requirement, no
> availability target, and nothing that a monthly bill would protect. A free tier
> is not a compromise here; it is the correct choice, and if the free tier is not
> enough for what you are attempting, the thing to re-examine is what you are
> attempting.

The `development` profile is small. Roughly **55,000 fact rows** in total, and
about 45,754 of those are the inventory-snapshot fact. Loaded, the whole database
including indexes and the audit history sits comfortably inside a few hundred
megabytes. Every free tier below has room for it several times over.

### The worked example, and the alternatives

| Provider | Free tier | What differs from the worked example |
|---|---|---|
| **Supabase** *(worked example below)* | Free project, PostgreSQL 15/16/17, ~500 MB database | The bootstrap role is a non-superuser `postgres` that holds `CREATEROLE`. Free projects **pause after a period of inactivity** and must be resumed from the dashboard. Offers both a direct connection and a transaction pooler on a different port |
| **Neon** | Free plan, PostgreSQL 16/17, ~500 MB per branch | Serverless: compute **scales to zero** and cold-starts on the next connection, so the first query after an idle period is slow rather than failed. Also non-superuser bootstrap. Database branching is a genuine convenience for throwaway rebuilds. Connections normally go through a pooler endpoint |
| **Railway** *(automated; see `deployment/railway/README.md`)* | **No free tier for a database.** Assume it costs money | PostgreSQL 18 on the platform's TLS-terminating image, with a persistent volume and a **TCP proxy** that is how Fabric reaches it. The bootstrap role is not a superuser but holds `CREATEROLE`. Every step of sections 5 to 8 is automated, and the two role passwords are generated by the platform rather than chosen by you |
| **Azure Database for PostgreSQL flexible server** | No permanent free tier; a limited introductory offer only | **Assume it costs money.** TLS is enforced by default and cannot be turned off, which is a plus. The bootstrap role is a member of `azure_pg_admin` and is not a superuser. Access is gated by firewall rules or a private endpoint, so you must explicitly allow the address the semantic-model service connects from |

Everything on this page is written so that only [section 3](#3-create-the-project-and-find-the-connection-details)
is provider-specific. Sections 4 onward are the same anywhere.

### What is the same everywhere

- **You will not get a superuser.** Every managed provider withholds it. Section
  5 explains exactly what that changes.
- **TLS is available and you must use it.** Section 4.
- **The connection details are a credential.** The host, the project reference
  and the password together are enough to reach the database. Treat all three as
  secret, not just the password.

---

## 2. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| A Chromebook with the **Linux development environment** enabled | — | Settings → Advanced → Developers → Linux. Everything below runs inside that container |
| `psql` client | **16 or later** | Client only. You are not installing a server |
| Python | **3.11 or later** | Already required by ARPI |
| `psycopg` | 3.1 or later | ARPI extra: `pip install -e '.[db]'` |
| `git` | any recent | To clone the repository |
| An account with a managed PostgreSQL provider | — | See [section 1](#1-what-this-is-for-and-what-it-costs) |
| Outbound TCP to the provider's port | — | Usually 5432 or 6543. Some school and corporate networks block both |

Install the client tools inside the Linux container:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg lsb-release git python3-venv
```

Debian's own `postgresql-client` may be older than 16. Add the PostgreSQL Global
Development Group repository to get a matching client:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y postgresql-client-16
psql --version
```

Then clone the repository and create the virtual environment:

```bash
git clone https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence.git
cd Automotive-Retail-Performance-Intelligence
python3 -m venv .venv
.venv/bin/pip install -e '.[db,dev]'
```

An older client than 16 will mostly work, but `psql` warns about the version
mismatch on every connection and some `\d` output is wrong. Install 16.

---

## 3. Create the project and find the connection details

Provider dashboards change often enough that step-by-step screenshots go stale
within months. What follows is what to look for, not where to click.

### Create the project

1. Sign in to the provider and create a **new project / instance / server**.
2. Choose **PostgreSQL 16** if you are offered a version. The `sql/` tree targets
   16; 17 will very probably work and has not been tested here, and 15 is not
   supported.
3. Choose the region nearest to you. Every `psql` command below is a network
   round trip and the 104-script sequence is 104 of them.
4. When the provider generates or asks you to choose a database password, **let
   it generate one** and store it in your password manager immediately. Do not
   type it into a document, a chat message, a commit, a screenshot, or this
   repository.
5. Confirm the plan you are on is the free one before you finish.

### Find the connection details

Look for a page called **Connect**, **Connection string**, **Connection
parameters**, **Database settings** or similar. You are after five values and one
setting:

| What you need | Typical label | Goes into |
|---|---|---|
| Host | `Host`, `Hostname`, `Server name`, `Endpoint` | `ARPI_DATABASE__HOST` |
| Port | `Port` | `ARPI_DATABASE__PORT` |
| Database name | `Database name`, `Database` | `ARPI_DATABASE__NAME` |
| User | `User`, `Username`, `Role` | `ARPI_DATABASE__USER` |
| Password | `Password` | `ARPI_DATABASE__PASSWORD` |
| TLS mode | `SSL`, `SSL enforcement`, `Require SSL` | `ARPI_DATABASE__SSLMODE` |

If the provider only shows you a single URI of the shape
`postgresql://<user>:<password>@<host>:<port>/<database>`, every one of the five
values is inside it. Take them out and use the variables; do not paste the URI
anywhere.

### Direct connection versus pooled connection

Most providers offer at least two endpoints, usually on different ports:

- a **direct** or **session** connection, and
- a **transaction pooler**, which multiplexes many clients onto few backends.

**Build and load through the direct connection.** The ordered SQL sequence sends
multi-statement scripts, `DO` blocks and `ALTER ... OWNER`; the loader runs the
whole ingest inside one transaction and executes the dimension merge scripts
through it. A transaction pooler can silently reassign the server connection
between statements, and session state — `search_path`, `SET ROLE`, advisory
locks — does not survive that.

A pooler is fine for the **read-only semantic model** in
[section 6](#6-create-the-login-role-for-the-semantic-model), which issues
independent `SELECT`s.

Some poolers also terminate TLS at the pooler rather than at the database. That
is still TLS on the wire, and `scripts/verify_cloud_database.py` will still see
an encrypted backend — but check that the endpoint you use is the TLS one, not a
plaintext sibling on an adjacent port.

### IPv4

Some free tiers are IPv6-only by default and charge for an IPv4 address. If your
network has no IPv6 the connection will fail before authentication, which looks
like a firewall problem and is not. Check the provider's IPv4/IPv6 notes before
concluding anything else is wrong.

---

## 4. Set the environment variables

ARPI reads configuration from `config/<profile>.yaml`, overridden by environment
variables prefixed `ARPI_` with `__` for nesting. The database password is the
only secret ARPI reads, and it is read **only** from the environment — putting a
`password` key in `config/*.yaml` is a hard error.

> **The password must never land in a file or in your shell history.** `read -s`
> reads it without echoing it and without it appearing as a command argument.
> Everything else on this page is non-secret enough to type normally — except the
> host, which is why it is prompted for as well.

```bash
cd ~/Automotive-Retail-Performance-Intelligence

# Non-secret, but specific to your project. Prompted rather than pasted so that
# nothing about your instance ends up in ~/.bash_history.
read -r  -p 'Database host: '     ARPI_DATABASE__HOST
read -r  -p 'Database port: '     ARPI_DATABASE__PORT
read -r  -p 'Database name: '     ARPI_DATABASE__NAME
read -r  -p 'Bootstrap user: '    ARPI_DATABASE__USER
read -rs -p 'Database password: ' ARPI_DATABASE__PASSWORD
echo

export ARPI_DATABASE__HOST ARPI_DATABASE__PORT ARPI_DATABASE__NAME
export ARPI_DATABASE__USER ARPI_DATABASE__PASSWORD
export ARPI_DATABASE__ENABLED=true
export ARPI_DATABASE__SSLMODE=require
export ARPI_DATABASE__CONNECT_TIMEOUT_SECONDS=15
```

`psql` uses the standard libpq variables rather than the ARPI ones, so mirror
them once. Nothing new is typed here:

```bash
export PGHOST="${ARPI_DATABASE__HOST}"
export PGPORT="${ARPI_DATABASE__PORT}"
export PGDATABASE="${ARPI_DATABASE__NAME}"
export PGUSER="${ARPI_DATABASE__USER}"
export PGPASSWORD="${ARPI_DATABASE__PASSWORD}"
export PGSSLMODE=require
```

Prove the connection works and that it is encrypted, before doing anything else:

```bash
psql -v ON_ERROR_STOP=1 -tAc \
  "SELECT current_setting('server_version'), ssl, version
   FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
```

You want a `16.x` version and `t` for `ssl`. If `ssl` is `f`, stop and fix that
first — everything else on this page assumes an encrypted session.

### Why `require` and not `verify-full`

`sslmode` values differ in what they check, and the difference is not cosmetic:

| Mode | Encrypts | Checks the server certificate chain | Checks the host name |
|---|---|---|---|
| `prefer` | only if the server offers it | no | no |
| `require` | yes | **no** | no |
| `verify-ca` | yes | yes | no |
| `verify-full` | yes | yes | yes |

`require` encrypts the traffic but authenticates nothing, so it defends against
passive eavesdropping and **not** against an active attacker who can redirect
your connection. `verify-full` is the mode that actually proves you are talking
to the database you think you are.

This walkthrough asks for `require` as the minimum and does not demand
`verify-full`, for one honest reason: `verify-full` needs the provider's CA
certificate downloaded to a known path and referenced by `sslrootcert`, and every
provider distributes and rotates that differently. Getting it wrong produces a
connection that fails for reasons that look like everything except certificate
verification, and the practical result is people setting `sslmode=disable` to
make the error go away. That trade is worse than the risk it avoids for a
database holding synthetic data about a fictional dealer group.

**If you are pointing anything real at a database, use `verify-full`:**

```bash
# Download the provider's CA bundle from their dashboard to a path outside the repo.
export PGSSLROOTCERT="$HOME/.postgresql/<provider>-ca.crt"
export PGSSLMODE=verify-full
export ARPI_DATABASE__SSLMODE=verify-full
```

`sslmode=disable` is never acceptable for a remote database, and
`scripts/verify_cloud_database.py` fails the run when the session turns out not
to be encrypted, whatever the configuration claimed.

### If you prefer a file

`.env` is gitignored and `.env.example` is the committed template; see
[`../.env.example`](../.env.example) for every variable. ARPI does **not**
auto-load `.env` — export it yourself with `set -a; source .env; set +a`. A file
is more convenient and strictly more exposed than a shell variable that dies with
the terminal. If you use one, `chmod 600 .env` and never copy it anywhere.

---

## 5. Run the ordered SQL sequence

This is the same 104-script sequence as the local walkthrough, in the same order,
and it produces the same database. Four things differ, and all four come from one
fact: **you are not a superuser.**

### What "not a superuser" changes

| Local | Cloud |
|---|---|
| You run as the `postgres` superuser | You run as a **bootstrap role** the provider gave you, which is not a superuser |
| `CREATE ROLE` always works | `CREATE ROLE` works only if the bootstrap role has `CREATEROLE` |
| `ALTER ... OWNER TO arpi_admin` always works | It works only if the bootstrap role **is a member of** `arpi_admin` |
| `REVOKE CREATE ON SCHEMA public FROM PUBLIC` always works | It works only if the bootstrap role owns `public`, or is a member of its owner |
| The second `01_grants.sql` pass is tidiness | The second pass is **load-bearing** |

**`CREATE ROLE`.** [`../sql/07_security/00_roles.sql`](../sql/07_security/00_roles.sql)
creates `arpi_admin`, `arpi_loader` and `arpi_reporter` as `NOLOGIN` group roles.
That needs `CREATEROLE`. Supabase, Neon and Azure all give the bootstrap role
`CREATEROLE`. If yours does not, **stop**: the three-role separation is the
security model, and a deployment without it is not this deployment. Check the
bootstrap role first:

```bash
psql -tAc "SELECT rolname, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user"
```

You want `f` for `rolsuper` — that is expected and fine — and `t` for
`rolcreaterole`.

**Ownership.** [`../sql/07_security/01_grants.sql`](../sql/07_security/01_grants.sql)
reassigns every schema, table, view, sequence and function in the five ARPI
schemas to `arpi_admin`. `ALTER ... OWNER TO` requires the current role to be a
member of the new owning role. On PostgreSQL 16 a non-superuser with `CREATEROLE`
is automatically granted membership in the roles it creates, with `ADMIN OPTION`,
so a bootstrap role that ran `00_roles.sql` itself already satisfies this. If the
roles were created by somebody else, or the provider behaves differently, grant it
explicitly before the grants pass:

```bash
psql -c "GRANT arpi_admin TO CURRENT_USER"
```

This ownership is not tidiness. A PostgreSQL view executes with its **owner's**
privileges, which is exactly why `arpi_reporter` can read
`reporting.vw_vehicle_sales` while holding no privilege at all on
`warehouse.fact_vehicle_sale`. Get ownership wrong and either the reporting views
stop working or the isolation quietly stops being real.

**The `public` schema.** `01_grants.sql` runs
`REVOKE CREATE ON SCHEMA public FROM PUBLIC`. Some providers own `public` with a
role you are not a member of, and that single statement fails. ARPI stores
nothing in `public`, so the revoke is defence in depth rather than a requirement;
see the troubleshooting table for how to handle it.

**Why the second pass matters more here.** `ALTER DEFAULT PRIVILEGES` only
affects objects created *after* it is set, and only for the role named in it.
`01_grants.sql` applies it both for `arpi_admin` and for `current_user`, which is
your bootstrap role — so the validation views and functions created in
`sql/08_validation/` are created by the bootstrap role, not by `arpi_admin`, and
end up owned by it. The final `01_grants.sql` pass is what moves them. Locally you
can get away with skipping it because a superuser can read everything anyway. Here
you cannot: skip it and `arpi_reporter` is missing `SELECT` on part of the
reporting layer, or holds privileges the model says it must not.

### Run it

```bash
cd ~/Automotive-Retail-Performance-Intelligence

set -e
for f in $(ls -1 sql/0*/*.sql | grep -v '07_security/02_role_verification' | sort); do
    echo "==> $f"
    psql -v ON_ERROR_STOP=1 -q --no-psqlrc -f "$f"
done
echo "==> sql/07_security/01_grants.sql (privilege normalisation)"
psql -v ON_ERROR_STOP=1 -q --no-psqlrc -f sql/07_security/01_grants.sql
```

Expect a `==>` line per file, three `NOTICE: Created role ...` lines, the
`NOTICE: ARPI privilege model verified ...` lines, and **no errors**. Over a
network this takes a few minutes rather than a few seconds; 104 files is 104
connections, and each one pays the TLS handshake. That is normal and not worth
optimising.

**Run it a second time.** It is designed for that. The second run prints
`NOTICE: ... already exists, skipping` and still no errors. A rerun that errors
means something is wrong; do not work around it.

Confirm what you built:

```bash
psql -c '\dn'                                        # five schemas
psql -tAc "SELECT count(*) FROM information_schema.views
           WHERE table_schema = 'reporting'"         # 28
psql -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'warehouse'"   # 13
psql -P pager=off -f sql/07_security/02_role_verification.sql
```

Every `assessment` column in the role report must read `ok`.

### Do not point the reset script at it

[`../sql/99_local_reset.sql`](../sql/99_local_reset.sql) destroys every ARPI
schema and the whole audit history, with no confirmation and no undo. It refuses
to run unless the database name starts with `arpi_` and does not contain `prod`.
Managed providers usually hand you a database called `postgres`, which the guard
already rejects — leave it that way. Do not rename a cloud database to something
starting with `arpi_` just to make the reset script work on it.

---

## 6. Create the login role for the semantic model

`arpi_reporter` is a `NOLOGIN` **group** role. It holds privileges; it cannot open
a connection. That is what stops the semantic model reaching `raw`, `staging`,
`warehouse` or `audit`, and it is the same arrangement as step 4 of
[`powerbi/POWER_BI_DESKTOP_HANDOFF.md`](powerbi/POWER_BI_DESKTOP_HANDOFF.md).

You create a **login** role and grant it membership. Do it interactively so the
password is never an argument to a command:

```bash
psql
```

```sql
CREATE ROLE arpi_fabric LOGIN INHERIT;
\password arpi_fabric
-- psql prompts twice, hashes the value client-side, and sends only the hash.
GRANT arpi_reporter TO arpi_fabric;
\q
```

`INHERIT` is the default and is what you want: the login role picks up
`arpi_reporter`'s privileges automatically, with no `SET ROLE` in the connection
string. Without it the semantic model would connect successfully and then find it
can read nothing.

Create a second login role for the pipeline in [section 7](#7-run-the-pipeline),
granted `arpi_loader` instead. Two logins, two roles, two blast radii:

```sql
CREATE ROLE arpi_pipeline LOGIN INHERIT;
\password arpi_pipeline
GRANT arpi_loader TO arpi_pipeline;
```

> Choose both passwords yourself, store them in your password manager, and **do
> not** commit them, paste them into a file inside the repository, or type them
> into any document. The semantic-model service stores its copy in its own
> credential store and nowhere else.

### Prove the isolation before you hand the credential over

```sql
SET ROLE arpi_reporter;
SELECT count(*) FROM reporting.vw_dealership;   -- works
SELECT count(*) FROM raw.dealership_load;       -- ERROR: permission denied for schema raw
SELECT count(*) FROM warehouse.dim_date;        -- ERROR: permission denied for schema warehouse
RESET ROLE;
```

Then do it again as the real login, because `SET ROLE` from a privileged session
is a weaker test than an actual connection. `-W` makes `psql` prompt, so nothing
sensitive is typed on the command line or stored in a variable:

```bash
PGUSER=arpi_fabric PGPASSWORD= psql -W -c 'SELECT count(*) FROM raw.dealership_load'
```

`ERROR: permission denied for schema raw` is the correct, expected outcome.
[Section 8](#8-verify) checks this mechanically over every object rather than the
two you thought to try.

---

## 7. Run the pipeline

Point ARPI at the pipeline login you created in section 6 — not at the bootstrap
role, and definitely not at the reporter. The three-role separation is only real
if it is used:

```bash
export ARPI_DATABASE__USER=arpi_pipeline
read -rs -p 'Password for arpi_pipeline: ' ARPI_DATABASE__PASSWORD
export ARPI_DATABASE__PASSWORD
echo

.venv/bin/arpi run-foundation --profile development --load-database
```

Use the **direct** connection here, not the transaction pooler
([section 3](#3-create-the-project-and-find-the-connection-details)): the loader
opens one transaction, `COPY`s fourteen entities into `raw`, executes the
dimension merge scripts, loads the five facts, records the row counts,
reconciliations and validation results in `audit`, and commits.

The profile is reproduced exactly as
[`../config/development.yaml`](../config/development.yaml) defines it — seed
**20250701**, reporting window **2025-07-01 to 2025-12-31**, **three** stores —
and it is deterministic, so it produces byte-identical data to the local run.

### What to expect

- Several minutes. `COPY` of roughly 55,000 fact rows over the internet is slower
  than over a socket, and the inventory-snapshot fact is most of it.
- **`114 passed, 0 critical failure(s)`** at the end of the validation summary.
- Every reconciliation reported as **passed** — 58 of them, none failing.
- No password anywhere in the log. ARPI holds it as a `SecretStr` and renders it
  as `***REDACTED***` in every `repr`, `str` and log line.

**Run it twice.** The second run writes zero warehouse rows: the Type 1 upserts
only fire where an attribute actually differs, and the Type 2 merges only act when
an `attribute_hash` changes. That idempotency is a property of the pipeline, not
of the local machine, and it must hold here too.

If the load is skipped silently, `ARPI_DATABASE__ENABLED` is not `true`.

---

## 8. Verify

Do not take the previous section's word for it. Run the check:

```bash
.venv/bin/python scripts/verify_cloud_database.py
```

Run it as the **bootstrap or admin login**, not as `arpi_fabric`. The check counts
rows in `warehouse` and reads `information_schema.table_privileges`, and
`arpi_reporter` is — correctly — not allowed to do either.

```
ARPI cloud database verification
  checks selected  : 9 of 9
  connection       : resolved from ARPI_DATABASE__* then PG*; never printed

  [ ok ] server-version         PostgreSQL 16.13
  [ ok ] tls                    TLSv1.3 / TLS_AES_256_GCM_SHA384
  [ ok ] schemas                5 of 5 present
  [ ok ] reporting-view-count   28 views
  [ ok ] warehouse-tables       13 of 13 populated
  [ ok ] reporting-row-counts   20 of 20 views exact
  [ ok ] reconciliations        58 recorded, 0 failing
  [ ok ] pipeline-run           development / seed 20250701 / succeeded
  [ ok ] reporter-isolation     confined to reporting; 28 view(s) readable

OK: 9 check(s) passed.
```

It exits `0` when everything passes, `1` on any finding, and `2` when it could not
run at all. What each check is actually asserting:

| Check | Asserts | Why it is not assumed |
|---|---|---|
| `server-version` | PostgreSQL 16 or later | A provider default of 15 or 14 is easy to accept by accident |
| `tls` | **this** connection is encrypted, per `pg_stat_ssl` | `sslmode=require` in a file proves nothing about the session that was opened |
| `schemas` | all five ARPI schemas exist | A sequence that stopped early leaves a plausible-looking partial database |
| `reporting-view-count` | exactly 28 views | Fewer means an incomplete build; more means something was created outside `sql/` |
| `warehouse-tables` | 8 dimensions and 5 facts exist **and hold rows** | A built-but-unloaded schema passes every structural check |
| `reporting-row-counts` | all twenty counts match **exactly** | The generator is deterministic; an inequality would accept a partial or duplicated load |
| `reconciliations` | 58 recorded, 0 failing | The loader records them; nothing else confirms they were recorded |
| `pipeline-run` | profile `development`, seed `20250701`, status `succeeded` | Right-looking counts from the wrong profile are the worst failure mode |
| `reporter-isolation` | `arpi_reporter` holds nothing in `raw`, `staging`, `warehouse`, `audit` | Ownership moved when the bootstrap role built the schema; the isolation must be re-proved here, not inherited from the local database |

The script **never prints a host name, a port, a user name, a database name or a
password**, including in its error output — a connection failure is reported by
exception type alone. Its output is safe to paste into an issue as it stands.

Useful variations:

```bash
.venv/bin/python scripts/verify_cloud_database.py --list-checks
.venv/bin/python scripts/verify_cloud_database.py --checks tls reporter-isolation
.venv/bin/python scripts/verify_cloud_database.py --quiet
```

A failure names the object and both numbers, for example:

```
reporting.vw_leads:reporting-row-counts: expected 6000 rows, found 5987. The
development profile is deterministic at seed 20250701, so this is a difference in
the load, not in the expectation.
```

Read that literally. The expectation is not the thing to change.

---

## 9. Regenerate the SQL baseline, and decide whether you need to

`powerbi/validation/sql_baseline.json` records the SQL side of all twenty-nine
governed KPIs across twenty-one filter contexts. It was generated by
[`../scripts/generate_sql_baseline.py`](../scripts/generate_sql_baseline.py)
against a local database loaded with the `development` profile.

### Is regeneration necessary?

**Strictly, no — and that is the interesting part.**

The baseline is a pure function of the data, and the data is a pure function of
the profile: seed 20250701, window 2025-07-01 to 2025-12-31, three stores. The
generator is deterministic, the merges are deterministic, and the surrogate keys
are assigned by `max(key) + row_number() OVER (ORDER BY <natural key>)` rather
than from a sequence precisely so that rebuilding from the same inputs reproduces
identical keys. Nothing in the SQL layer reads the clock, the host name or a
random source. A correctly loaded cloud database is therefore not merely
*similar* to the local one; it is the same database, and it must produce a
**byte-identical** baseline.

So regenerating adds no information about the KPIs. What it adds is a very strong
statement about the **load** — which is exactly what you cannot otherwise get.

### Regenerate anyway, and diff it

Section 8 checks twenty row counts. The baseline checks roughly eight hundred
computed values across twenty-one filter contexts, including semi-additive
inventory measures evaluated at the last snapshot date, ratio measures whose
denominator is zero, and a context that exercises an inactive date relationship.
If the cloud load dropped a fact row, duplicated a merge, or landed a numeric in
the wrong precision, a row count can still match and the baseline cannot.

Run the generator through a login that holds `arpi_reporter` — it reads only the
`reporting` schema — and then diff:

```bash
export ARPI_DATABASE__USER=arpi_fabric
read -rs -p 'Password for arpi_fabric: ' ARPI_DATABASE__PASSWORD
export ARPI_DATABASE__PASSWORD
echo

.venv/bin/python scripts/generate_sql_baseline.py
git diff --stat -- powerbi/validation/
git diff --exit-code -- powerbi/validation/sql_baseline.json && echo "IDENTICAL"
```

- **Empty diff.** The cloud load is faithful, value for value. Discard the
  regenerated files — they are identical, so there is nothing to commit.
- **Non-empty diff.** **The cloud load is wrong.** It is not that the baseline is
  stale, and it is not that "the cloud is a bit different". Read the diff: it
  names the context and the measure. Then re-run
  `scripts/verify_cloud_database.py`, check
  `reporting.vw_reconciliation_status` for a failing reconciliation, and rebuild.
  Do not commit a baseline regenerated from a cloud database that disagrees with
  the local one.

The only legitimate reason for the baseline to change is a change to the
`reporting` views, the generator, or the profile — in which case it changes
locally too, in the same commit as the change, and the cloud database is
irrelevant to the decision.

The metadata file records the profile, the seed, the date range, the row counts
and the commit. It records **no host, user name or password**, by design. That
property must survive a cloud regeneration; if a host name ever appears in
`sql_baseline_metadata.json`, that is a defect in the generator, not a detail to
edit out by hand.

---

## 10. Cost, teardown and finishing up

### While it exists

- **Check the plan, not the marketing.** Confirm in the billing page that the
  project is on the free plan and that no paid add-on (IPv4 address, extra
  storage, point-in-time recovery, a second compute) has been enabled.
- **Expect it to pause.** Free tiers suspend after a period of inactivity.
  A paused database makes a semantic-model refresh fail with an error that reads
  like a network fault. Resume it from the dashboard; nothing is lost.
- **Expect it to expire.** Some free tiers delete inactive projects outright.
  That is survivable here and only here: the data is synthetic and reproducible
  from this repository in two commands.
- **Do not add real data.** The moment anything non-synthetic goes in, every
  assumption on this page — free tier, `require` instead of `verify-full`, no
  backups, a public portfolio repository describing the schema — becomes wrong at
  once.

### Tearing it down

When the semantic model has been validated and you no longer need the instance:

1. **Remove the stored credential** from the cloud semantic-model service first,
   so nothing keeps trying to refresh against a database that is about to vanish.
2. **Delete the project or server** in the provider's dashboard. Dropping the
   ARPI schemas is not teardown — an empty project still counts against a free
   tier's project limit and can still be resumed.
3. **Rotate or delete the credentials** in your password manager, including the
   `arpi_fabric` and `arpi_pipeline` passwords. They were only ever for this
   instance.
4. **Clear your shell:**

   ```bash
   unset ARPI_DATABASE__HOST ARPI_DATABASE__PORT ARPI_DATABASE__NAME \
         ARPI_DATABASE__USER ARPI_DATABASE__PASSWORD ARPI_DATABASE__SSLMODE \
         PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE
   ```

   Then close the terminal. If you created a `.env`, delete it.
5. **Confirm the repository is clean.** Nothing about the instance should have
   reached it:

   ```bash
   git status --short
   python3 scripts/check_secrets.py
   ```

   A modified `powerbi/validation/` is the one thing to look for — see
   [section 9](#9-regenerate-the-sql-baseline-and-decide-whether-you-need-to).

Rebuilding later is [section 5](#5-run-the-ordered-sql-sequence) and
[section 7](#7-run-the-pipeline) again, and produces exactly the same database.
That is the point of determinism, and it is why deleting this instance costs
nothing.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `could not translate host name ... to address` | Host copied incorrectly, or the project is paused or deleted | Re-read the connection page; resume the project |
| Connection hangs, then times out | Outbound port blocked by your network, or the provider requires an allowlisted address | Try the alternative port the provider offers; add your address to the firewall/allow list |
| Connection fails before authentication and the provider is IPv6-only | Your network has no IPv6 | Use the provider's IPv4 option, or a network that has IPv6 |
| `FATAL: password authentication failed for user "..."` | Wrong password, or the wrong user for that endpoint — poolers sometimes require a qualified user name | Re-copy from the dashboard; check the pooler's documented user format |
| `SSL is not enabled on the server`, or `ssl` is `f` in `pg_stat_ssl` | Connected to a plaintext endpoint, or `sslmode` was lowered to make an error go away | Use the TLS endpoint and `PGSSLMODE=require`. Never `disable` for a remote database |
| `verify-full` fails with a certificate error | Missing or stale provider CA bundle | Download the current CA from the dashboard and set `PGSSLROOTCERT`; do **not** fall back to `disable` |
| `ERROR: permission denied to create role` | The bootstrap role lacks `CREATEROLE` | Check `rolcreaterole`. If the provider will not grant it, this deployment is not possible as specified — do not drop the role model to proceed |
| `ERROR: must be member of role "arpi_admin"` during `01_grants.sql` | The bootstrap role did not create the roles and was not granted membership | `psql -c "GRANT arpi_admin TO CURRENT_USER"`, then re-run `01_grants.sql` |
| `ERROR: must be owner of schema public` | The provider owns `public` with a role you are not a member of | ARPI stores nothing in `public`. Take ownership if the provider allows it, or run `01_grants.sql` as the owning role. Record the deviation; the rest of the model is unaffected |
| `ERROR: cannot change owner of sequence ... is linked to table` | An out-of-date `01_grants.sql` | Update; the current script skips column-owned sequences, which follow their table automatically |
| `SECURITY INVARIANT VIOLATED: arpi_reporter holds ...` | A grant was added out of band | Read the object it names, remove the grant, re-run `01_grants.sql` |
| Second run of the sequence errors | A file has lost its idempotency guard | Compare against [`../sql/README.md`](../sql/README.md) section 5 |
| The sequence is very slow | 104 files, 104 connections, each paying a TLS handshake over the internet | Expected. Choose a nearer region next time |
| `arpi run-foundation --load-database` skips the load silently | `ARPI_DATABASE__ENABLED` is not `true` | `export ARPI_DATABASE__ENABLED=true` |
| Configuration error naming missing database keys | `ENABLED=true` with host, name or user unset | Set all three |
| The load fails partway with a connection reset | Connected through a transaction pooler | Use the direct/session connection for the load |
| `ERROR: permission denied for schema warehouse` while loading | Connected as `arpi_fabric` (reporter) rather than `arpi_pipeline` (loader) | Set `ARPI_DATABASE__USER` to the loader login |
| `ERROR: permission denied for schema raw` from the semantic model | **Working as designed.** The reporter is confined to `reporting` | Repoint the model at `reporting.vw_*` |
| `verify_cloud_database.py` exits 2 with `psycopg is required` | The `db` extra is not installed | `.venv/bin/pip install -e '.[db]'` |
| `verify_cloud_database.py` exits 2 with `could not run the verification` | Unreachable, paused, or wrong credentials. The message names no host on purpose | Re-check section 4, then retry the `psql` probe there |
| `tls` check fails | The session is genuinely not encrypted | Fix it. Do not skip the check with `--checks` |
| `reporting-row-counts` finds fewer rows than expected | Partial load, or a different profile | Check `reporting.vw_pipeline_run_summary`, then rebuild and reload |
| `reporting-row-counts` finds more rows than expected | A fact was loaded twice, which the grain constraints should have prevented | Query `reporting.vw_reconciliation_status` for the failing reconciliation and open an issue with the output |
| `pipeline-run` reports a profile other than `development` | The instance was loaded from `test` or `portfolio` | Reload with `--profile development`. Every count on this page describes `development` only |
| `reporter-isolation` reports privileges on `warehouse` | The final `01_grants.sql` pass was skipped, or a grant was made by hand | Re-run `01_grants.sql`, then re-run the check |
| The semantic model connects but sees no tables | The login role was created without `INHERIT`, or was not granted `arpi_reporter` | `ALTER ROLE arpi_fabric INHERIT; GRANT arpi_reporter TO arpi_fabric;` |
| A refresh that worked yesterday fails today | The free-tier project paused or expired | Resume it, or rebuild with sections 5 and 7 |

### Still stuck?

Collect this and open an issue. None of it contains a credential, and the
verification script is written so that its output never can:

```bash
psql -tAc "SELECT current_setting('server_version')"
psql -c '\dn'
psql -tAc "SELECT count(*) FROM information_schema.views WHERE table_schema = 'reporting'"
psql -c "SELECT check_id, status, message FROM audit.vw_dq_all ORDER BY check_id"
psql -P pager=off -f sql/07_security/02_role_verification.sql
.venv/bin/python scripts/verify_cloud_database.py
```

**Before you paste anything, re-read it for a host name.** `psql` error messages
contain one; the ARPI scripts do not.

---

## See also

- [`database-setup.md`](database-setup.md) — the local walkthrough this page mirrors
- [`../sql/README.md`](../sql/README.md) — authoritative execution order, idempotency guarantees, ownership model
- [`../scripts/README.md`](../scripts/README.md) — every repository control script, including the verifier
- [`powerbi/POWER_BI_DESKTOP_HANDOFF.md`](powerbi/POWER_BI_DESKTOP_HANDOFF.md) — the Windows-only Desktop validation, whose step 4 this page's section 6 mirrors
- [`../SECURITY.md`](../SECURITY.md) — secret handling, the role model, and what to do if a credential is committed
- [`../.env.example`](../.env.example) — every ARPI environment variable
- [`../config/development.yaml`](../config/development.yaml) — the profile this page reproduces exactly

---

*All data referenced here is synthetic. Granite State Auto Group is fictional. See
[`../PRIVACY_AND_ETHICS.md`](../PRIVACY_AND_ETHICS.md).*
