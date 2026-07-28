# ADR-0002: Phase 0 Technology Baseline

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

`ARCHITECTURE.md` fixes the large decisions: PostgreSQL, Python, a dimensional warehouse, Power BI as the
analytical interface. It deliberately does not settle the smaller engineering choices, because those are
implementation concerns.

Phase 0 builds the foundation slice — configuration, logging, the date and dealership generators, the
validation framework, the CSV and manifest writer, the optional PostgreSQL load, audit recording, the CLI,
the SQL schemas, the tests, and CI. Building that slice forced a set of choices that are individually
small but collectively determine how every later phase is written. Several of them are non-obvious, and a
reviewer is entitled to ask why the less common option was taken.

This ADR records those choices so they are decisions with reasons rather than accidents of whoever typed
first. It does not restate anything already settled in `ARCHITECTURE.md`.

## Decision

The Phase 0 technology baseline is as follows. Each row is binding for the duration of Phase 0 and
changes only through a superseding ADR.

### 1. Python `>=3.11`

**Decision.** `requires-python = ">=3.11"`. Development and CI run on Python 3.11.

**Rationale.** 3.11 is the oldest release that gives the whole standard-library surface this project
actually uses without back-compatibility shims — `tomllib`, `datetime.UTC`, `Self`, and `StrEnum` — and it
avoids conditional imports in a codebase whose point is clarity.

**Consequence.** The project will not run on 3.10 or earlier. That excludes some older managed
environments, which is acceptable for a portfolio project where the reader controls the interpreter.

### 2. `src/` layout

**Decision.** The package lives at `src/arpi/`, not `arpi/` at the repository root.

**Rationale.** With a `src/` layout the package cannot be imported accidentally from the working
directory, so the test suite necessarily exercises the installed distribution. Import errors and missing
package data surface locally instead of at install time.

**Consequence.** The package must be installed — `pip install -e ".[dev,db]"` — before tests will run.
There is no "just run it from the checkout" path, and contributor instructions must say so.

### 3. Ruff as the single lint and format tool

**Decision.** `ruff check` and `ruff format` are the only lint and format tools. Black, isort, and flake8
are explicitly rejected.

**Rationale.** Ruff covers all three roles in one dependency with one configuration block, and it is fast
enough that the pre-commit hook and the CI job feel identical. Three separate tools means three
configuration surfaces, three version-pin problems, and a standing risk that the formatter and the linter
disagree about import ordering.

**Consequence.** The project depends on a single tool for a large amount of quality enforcement, and it
inherits Ruff's opinions where they differ in edge cases from Black. Any rule Ruff does not implement is
simply not enforced.

### 4. mypy for static typing

**Decision.** mypy runs over both `src` and `tests` in a strict-leaning configuration.

**Rationale.** The Phase 0 code is mostly data-shaping, where the expensive mistakes are wrong types and
wrong nullability rather than wrong control flow. Static typing catches those before a test has to.
Checking `tests` as well prevents the test suite from becoming an untyped escape hatch.

**Consequence.** Third-party libraries without stubs need explicit handling, which is why `types-PyYAML`
and `pandas-stubs` are development dependencies. Typing the tests costs real authoring time.

### 5. pytest and pytest-cov, with an `integration` marker

**Decision.** Tests run under pytest with coverage measured on `src/arpi` and `fail_under = 85`. Markers
are `integration` (requires PostgreSQL), `data_quality` (runs the generators, needs no database), and
`slow`. The default developer and CI run is `pytest -m "not integration"`; the database tests run only in
a separate, optional PostgreSQL job.

**Rationale.** The single most important property of this repository is that a reviewer can clone it and
get a green test run with no database, no credentials, and no accounts. Marking the database-dependent
tests and excluding them by name — rather than burying the exclusion in `addopts` — makes that split
visible in the command itself, so nobody is surprised by which tests they just ran.

**Consequence.** Two test commands must be documented and maintained instead of one, and the integration
tests get less routine exercise than the unit tests, so they can rot quietly if the optional job is
ignored.

### 6. pydantic-settings for typed `ARPI_`-prefixed configuration

**Decision.** Configuration is a pydantic-settings model. Values resolve with the precedence
environment variable → YAML profile file → model default. The environment prefix is `ARPI_` and the nested
delimiter is `__`, for example `ARPI_LOGGING__LEVEL` and `ARPI_DATABASE__HOST`.

**Rationale.** Configuration is the first thing that breaks in a data pipeline, and it breaks late — a
mistyped date or a string where an integer belongs surfaces halfway through a run. Validating and coercing
the whole configuration at startup turns those into immediate, named errors. The typed model also makes
`arpi check-config` a genuinely useful command rather than a YAML pretty-printer.

**Consequence.** Adding a configuration key means editing the model and all three profile YAML files, not
just one file. The framework is also load-bearing: a pydantic major version change is a migration.

**Related rule.** `database.password` never appears in YAML. It is read only from
`ARPI_DATABASE__PASSWORD` (with `PGPASSWORD` as a fallback), and the configuration object's `__repr__`,
`__str__`, and log output render it as `***REDACTED***`.

### 7. Standard-library `argparse` instead of click or typer

**Decision.** The `arpi` CLI is built on `argparse`. Click and typer are rejected.

**Rationale.** The CLI has a handful of subcommands and one shared `--profile` option. `argparse` handles
that in the standard library, with no runtime dependency, no decorator indirection, and nothing for a
reviewer to learn before reading the entry point. Adding a CLI framework here would be dependency weight
purchased with no capability.

**Consequence.** More boilerplate per subcommand than a decorator-based framework, and no free shell
completion or rich help formatting. If the command surface grows substantially, this is the decision to
revisit first.

### 8. PostgreSQL run locally for development; Supabase deferred

**Decision.** Development and the optional CI database job run against a locally installed PostgreSQL
instance. Managed hosting on Supabase, which `ARCHITECTURE.md` §26.1 names as the eventual preference,
is deferred.

**Rationale.** Phase 0 produces two dimensions, some audit tables, and four reporting views. Nothing in
that needs to be reachable over the internet, and a hosted database would introduce credentials, a
network dependency, and a monthly resource into a phase whose deliverable is reproducibility. Local
PostgreSQL is also what keeps the "no account required" property real. Supabase becomes worth its cost
when there is a Power BI model that needs a shared endpoint.

**Consequence.** No hosted environment exists to point a reviewer at, and the eventual move to managed
hosting will have to prove that the SQL, the roles, and the TLS settings work there. Keeping every schema
object in ordered, re-runnable `sql/` scripts is what makes that move cheap, so that discipline is not
optional.

### 9. Fiscal calendar aligned to the calendar year

**Decision.** In `warehouse.dim_date`, `fiscal_month` equals `month_number`, `fiscal_quarter` equals
`quarter_number`, and `fiscal_year` equals `calendar_year`.

**Rationale.** Fiscal calendars vary by dealer group, and no real group's calendar applies to a fictional
one. Aligning to the calendar year makes every fiscal figure independently checkable by a reader, while
the fiscal columns still exist — so a future group with an offset fiscal year is a change to one
generator function, not a schema migration.

**Consequence.** The model does not currently demonstrate offset-fiscal-calendar handling, which is a
skill a reviewer might otherwise look for. The columns are honest but presently redundant, and both
`DATA_DICTIONARY.md` and `KPI_CATALOG.md` must say so plainly so the redundancy never reads as a bug.

### 10. Deterministic holiday and selling-day rule

**Decision.** Holidays are computed in-process from documented rules with no external holiday library.
Twelve holidays are recognised. Five are closure holidays — New Year's Day, Easter Sunday, Independence
Day, Thanksgiving Day, and Christmas Day — and `is_selling_day = NOT is_closure_holiday`. Easter uses the
anonymous Gregorian computus. Weekends are selling days, because New Hampshire permits Sunday vehicle
sales. When two holidays share a date, `holiday_name` takes the first match in the documented table order
and `is_closure_holiday` is the logical OR of all matches.

**Rationale.** The date dimension must be byte-identical on every machine and in every year, forever. A
third-party holiday package makes the output depend on that package's release history, which would break
the reproducibility guarantee that the rest of Phase 0 is built on. Every rule here is a closed-form
computation over the calendar year, so the generator is a pure function of the date range and the seed.

**Consequence.** The holiday set is maintained by hand, it models one region's observance rather than a
general calendar, and adding a holiday means editing code and updating `DATA_GENERATION.md`. The
"weekends are selling days" rule is regionally correct but will look wrong to anyone assuming a
blue-law market, so it is stated explicitly in `DATA_GENERATION.md`.

## Consequences

### Positive

- A reviewer can clone the repository, create a virtual environment, install, and get a passing test run
  and a full synthetic dataset without a database, an account, or a credential.
- The runtime dependency surface is four packages, and the entire tool configuration lives in one file.
- Generator output is deterministic, so a regenerated dataset produces an empty diff and any real change
  is visible.
- Every non-obvious choice above is now answerable in one sentence during a technical conversation, which
  is itself part of what this project is meant to demonstrate.

### Negative

- The baseline is opinionated and rejects several widely used tools; a contributor accustomed to
  black-plus-isort-plus-flake8 has to adjust.
- Deferring managed hosting means there is nothing live to demonstrate, only scripts that provably run
  locally.
- The calendar-aligned fiscal year and the hand-maintained holiday set are simplifications that must be
  disclosed in the documentation rather than defended as features.
- Several of these decisions are cheap now and expensive later — particularly the CLI framework choice and
  the fiscal calendar — so they need revisiting at Phase 1 rather than being treated as settled forever.

## Relationship to other records

- **ADR-0001** fixes the project identity from which `arpi`, `ARPI_`, and the `arpi_*` role names derive.
- `ARCHITECTURE.md` §26.1 records the long-term deployment preference that decision 8 defers.
- `DATA_GENERATION.md` documents the holiday rule and the selling-day definition for a reader who is not
  reading source code.
- `docs/database-setup.md` covers the optional local PostgreSQL path referenced in decision 8.
