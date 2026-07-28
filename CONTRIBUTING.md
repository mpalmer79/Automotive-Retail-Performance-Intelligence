# Contributing

Automotive Retail Performance Intelligence (ARPI) is a public portfolio
repository. It is maintained by one person, and it is meant to be *readable* —
by a hiring manager, by a reviewer who has never opened Power BI, and by whoever
picks it up next. Contributions and issues are welcome; the conventions below
exist so the repository stays reviewable rather than merely functional.

**Before anything else, three rules that are never negotiable:**

1. **No real data.** Every row in this repository is synthetic.
2. **No PII.** No names, addresses, phone numbers, emails, or real VINs — not
   even fake-looking ones in a comment.
3. **No secrets.** Credentials live in environment variables and an untracked
   `.env`. The only committed environment file is `.env.example`.

---

## 1. Setting up

Requires Python 3.11 or 3.12 and, for the database layer, PostgreSQL 16.

```bash
git clone https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence.git
cd Automotive-Retail-Performance-Intelligence

python3.11 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install --upgrade pip
pip install -e ".[dev,db]"
```

Copy the environment template and fill in your local values:

```bash
cp .env.example .env
```

`.env` is gitignored. Never remove that entry, and never commit a file that
contains a real password.

PostgreSQL setup — roles, schemas, and the ordered SQL sequence — is documented
in [docs/database-setup.md](docs/database-setup.md).

### Optional: pre-commit

Not required, but it turns a five-minute round trip through CI into a two-second
failure at commit time:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files     # first run, to see the current state
```

The hooks mirror CI. **CI is authoritative** — if the two disagree, CI is right
and `.pre-commit-config.yaml` is the thing to fix.

---

## 2. Branches and commits

### Branch naming

```
<type>/<short-kebab-description>
```

`type` is one of `feature`, `fix`, `docs`, `data`, `sql`, `test`, `chore`,
`refactor`. Keep the description under about five words.

```
feature/dim-vehicle-generator
fix/selling-day-ratio-rounding
docs/kpi-catalog-gross-definitions
sql/reporting-view-pipeline-summary
```

Never commit directly to `main`.

### Commit messages

Imperative mood, concise subject line (aim for 72 characters or fewer, no
trailing period), then a blank line, then a body that explains **why**. The diff
already says what changed.

```
Add ISO week columns to the date dimension

Power BI week-over-week visuals need an ISO week-numbering year alongside
the calendar year, otherwise the first days of January roll into the wrong
week bucket. Adds iso_year and week_of_year to warehouse.dim_date and to
the generator, with a data-quality check that they agree with full_date.
```

One logical change per commit. If the body needs the word "and" three times,
it is probably two commits.

---

## 3. Definition of done

A change is done when **all** of the following are true.

- [ ] Every local verification command in §4 passes.
- [ ] Coverage did not drop. New code is tested, not just written.
- [ ] Documentation that describes the changed thing has been updated in the
      same commit — data dictionary, KPI catalog, architecture, README.
- [ ] No new claim is made about something that does not exist. Status labels
      are **Implemented**, **Planned**, **Deferred**, or **Out of scope**, and
      they are accurate.
- [ ] No real data, no PII, no secrets.
- [ ] If the change is architecturally material, an ADR exists (§6).

The project-level definition of done is
[ARCHITECTURE.md §33](ARCHITECTURE.md#33-definition-of-done). This section is
the per-change version of it.

---

## 4. Local verification

Run these, in this order, before opening a pull request. They are exactly what
CI runs.

```bash
ruff format --check .
ruff check .
mypy src tests
pytest -m "not integration" --cov=arpi --cov-report=term-missing --cov-report=xml
python scripts/check_naming.py
python scripts/check_docs_links.py
python scripts/check_secrets.py
```

With a local PostgreSQL instance available, also run the database-backed tests:

```bash
pytest -m integration
```

To fix formatting and the auto-fixable lint findings rather than just report
them:

```bash
ruff format .
ruff check --fix .
```

The repository-control scripts are documented in
[scripts/README.md](scripts/README.md).

---

## 5. Scope and architecture boundaries

**This is a business intelligence and analytics project, not a web
application.** The data model, the SQL, the KPI definitions, and the
documentation are the product. Tooling exists to serve them.

Before proposing a feature, read
[ARCHITECTURE.md §6 Non-Goals](ARCHITECTURE.md#6-non-goals). It lists what this
project deliberately does not do. A pull request that adds an excluded feature
will be declined regardless of how well it is written, because the cost is not
the code — it is the analytical work it displaces.

[ARCHITECTURE.md §28 Scope Gates](ARCHITECTURE.md#28-scope-gates) defines what
must be finished before certain work is allowed to start. The gates exist to
prevent overengineering:

- **Gate 1** — no Power BI development until fact grains are approved,
  dimensions are documented, and KPI formulas are documented.
- **Gate 2** — no web case study until core Power BI pages are complete, SQL and
  Power BI totals reconcile, and executive findings are drafted.
- **Gate 3** — no API, AI, forecasting, or anomaly feature until the strong
  portfolio version is complete, the feature answers a documented business
  question, and it adds hiring evidence not already demonstrated.
- **Gate 4** — no new data domain unless a stakeholder question requires it and
  its grain, KPI ownership, and testing requirements are defined.

If your change is behind a gate that is not yet open, open an issue instead of a
pull request.

### File ownership

Configuration for Python tooling lives in **`pyproject.toml` and nowhere else**.
There is no `setup.cfg`, `.flake8`, `mypy.ini`, `pytest.ini`, `.coveragerc`, or
`requirements.txt`, and adding one will be declined. Ruff is the only linter and
the only formatter.

---

## 6. When an ADR is required

Material decisions are recorded in `docs/architecture-decisions/` as
`ADR-NNNN-kebab-title.md`, with Status, Context, Decision, Alternatives
considered, Consequences, and Date. See
[ARCHITECTURE.md §35](ARCHITECTURE.md#35-architecture-decision-records).

An ADR is **required** for any of the following
([§35.2](ARCHITECTURE.md#352-decisions-that-require-an-adr)):

- Replacing PostgreSQL
- Changing the Power BI connection mode
- Adding a new fact table
- Changing a fact-table grain
- Adding a second user interface
- Adding machine learning
- Adding an API layer
- Using real or restricted data
- Changing the synthetic VIN policy
- Changing the deployment model

Changing the project identity requires a **superseding** ADR; ADR-0001 is the
naming decision of record, and `scripts/check_naming.py` enforces it.

Write the ADR first, in its own pull request, and land it before the
implementation.

---

## 7. Adding a new KPI

A KPI that exists in DAX but not in the catalog is an undocumented business
rule. Order matters:

1. **Define it in [KPI_CATALOG.md](KPI_CATALOG.md) first.** The entry must state
   the numerator, the denominator, the grain, the filter context, the owning
   layer (SQL or DAX — see
   [ARCHITECTURE.md §18](ARCHITECTURE.md#18-kpi-catalog-and-calculation-ownership)),
   the null and divide-by-zero behaviour, and how it is validated.
2. **Confirm every input column exists** in
   [DATA_DICTIONARY.md](DATA_DICTIONARY.md). If it does not, you are adding an
   entity, not a KPI — go to §8.
3. **Implement it** in SQL or DAX, in the layer the catalog names.
4. **Test it.** A KPI needs at least one test that pins the expected value for a
   known slice of the synthetic data.
5. **Reconcile it.** If the KPI appears in both SQL and Power BI, the totals must
   match, and the reconciliation must be recorded.

No numerator and denominator in the catalog means no SQL and no DAX.

## 8. Adding a new entity

1. **Document it in [DATA_DICTIONARY.md](DATA_DICTIONARY.md)** — every column,
   type, nullability, and meaning.
2. **State the grain explicitly**, in one sentence: "one row per ___". A table
   whose grain cannot be written in one sentence is two tables.
3. **Write the source-to-target mapping** under `docs/source-to-target/` before
   any DDL: where each column comes from, and what transforms it.
4. **Decide the SCD behaviour** for a dimension, and say so.
5. **Then** write the DDL, the generator, and the tests.
6. **Add data-quality checks** with `check_id` values that follow the existing
   `DQ-<ENTITY>-NNN` convention.

## 9. Adding a SQL script

SQL lives under `sql/`, in numbered directories that execute in lexical order:

```
sql/00_database/     schemas, conventions, audit tables
sql/01_raw/          raw landing tables
sql/02_staging/      staging views
sql/03_dimensions/   dimension tables
sql/04_facts/        fact tables
sql/05_reporting/    reporting views
sql/06_indexes/      indexes
sql/07_security/     roles and grants
sql/08_validation/   data-quality queries
```

Rules:

- **Numbering.** Files are `NN_snake_case_name.sql`. Pick the next free number
  in the directory; leave gaps rather than renumbering existing files, because
  renumbering rewrites everyone's execution order.
- **Header block.** Every script opens with a comment stating its purpose, the
  objects it creates or alters, its dependencies (which earlier scripts must
  have run), and whether it is idempotent.
- **Idempotency is mandatory.** The whole sequence must be safe to re-run
  against an already-initialised database: `CREATE SCHEMA IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, guarded `DO $$ ... $$`
  blocks for roles and grants. A script that fails on the second run is a bug.
- **No DROP without a guard**, and never a `DROP` that could destroy data a
  reviewer has loaded.
- **No credentials, ever.** Not in a comment, not in a `\connect`, not in a
  `PASSWORD` clause with a real value.
- **Deterministic output.** No `now()`, `random()`, or `current_user` baked into
  data that is later compared for reproducibility.

Add the script to the integration tests if it creates an object that other code
depends on. The CI `integration` job runs the whole `sql/` tree in sorted order,
so a script that only works when run by hand will fail there.

---

## 10. Testing expectations

Test layout and markers:

| Location | Marker | Needs | Runs in CI |
|---|---|---|---|
| `tests/unit/` | none | nothing | `quality` job |
| `tests/data_quality/` | `data_quality` | runs the generators, no database | `quality` job |
| `tests/integration/` | `integration` | a live PostgreSQL instance | `integration` job |
| any | `slow` | noticeable wall-clock time | as marked |

What each kind of change needs:

- **Python logic** — unit tests covering the happy path, the boundary, and the
  documented failure mode. Determinism must be asserted: the same seed produces
  the same output.
- **Generator change** — a data-quality test asserting the declared schema
  matches the produced schema, plus whatever business rule motivated the change.
- **New or changed SQL object** — an integration test that the object exists,
  has the expected columns, and enforces its constraints. Re-running the script
  must remain safe.
- **New KPI** — a test pinning the expected value for a known slice.
- **Documentation-only change** — no new tests, but
  `python scripts/check_docs_links.py` must pass.
- **Bug fix** — a test that fails before the fix and passes after it. Add it in
  the same commit.

Coverage is measured on `src/arpi` with a floor configured in `pyproject.toml`.
Do not lower the floor to make a change pass.

The broader strategy is in
[ARCHITECTURE.md §25](ARCHITECTURE.md#25-testing-strategy) and
[§21](ARCHITECTURE.md#21-data-quality-strategy).

---

## 11. Pull requests

Open the pull request against `main`, fill in the template
(`.github/pull_request_template.md`), and keep it small enough to review in one
sitting. Draft pull requests are fine and encouraged for work in progress.

CI must be green. The three jobs are:

- **quality** — formatting, lint, types, unit and data-quality tests, coverage.
- **repository-checks** — naming, documentation links, secret safety net.
- **integration** — SQL sequence and database-backed tests against a PostgreSQL
  container. This job is separate so that a container hiccup is obviously
  distinguishable from a code failure.

---

## 12. Reporting a problem

- **Bug, question, or suggestion** — open a GitHub issue. Include what you
  expected, what happened, the command you ran, and your Python and PostgreSQL
  versions. A reproducible example beats a description.
- **Documentation error** — an issue is fine, a pull request is better; most
  documentation fixes are a one-line change.
- **Anything security-sensitive** — do **not** open a public issue. Follow
  [SECURITY.md](SECURITY.md).

This is a portfolio project maintained in spare time. Responses are best-effort,
and there is no service-level commitment.
