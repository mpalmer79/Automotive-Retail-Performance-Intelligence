# ARPI configuration

This directory holds the three configuration profiles. Every key is validated against a
typed [pydantic](https://docs.pydantic.dev/) model in `src/arpi/config.py`; unknown keys
are rejected rather than silently ignored.

## Profiles

| File | Profile | Reporting window | Seed | Sample outputs | Log level |
|---|---|---|---|---|---|
| `development.yaml` | `development` | 2025-07-01 .. 2025-12-31 | `20250701` | yes | `INFO` |
| `test.yaml` | `test` | 2025-01-01 .. 2025-02-28 | `424242` | no | `WARNING` |
| `portfolio.yaml` | `portfolio` | 2024-01-01 .. 2025-12-31 | `20240101` | no | `INFO` |

`development` is the everyday profile and the one that regenerates the committed files
in `data/sample/`. `test` is deliberately tiny and never writes sample outputs, so the
test suite can never dirty a committed file. `portfolio` is the full two-year dataset.

## Selecting a profile

The profile is resolved in this order, first match wins:

1. the `--profile` command-line flag (or the `profile=` argument to `load_config`)
2. the `ARPI_PROFILE` environment variable
3. `development`

```bash
arpi check-config --profile portfolio     # explicit flag
ARPI_PROFILE=test arpi check-config       # environment variable
arpi check-config                         # falls back to development
```

Asking for a profile with no YAML file raises `ProfileNotFoundError`, which lists the
profiles that *do* exist. Pointing `--config-dir` at a directory that does not exist
raises `ConfigurationError` naming the path that was searched.

By default ARPI looks for `./config`, then for the `config/` directory next to an
editable source checkout of the package.

## Environment overrides

Every key can be overridden from the environment. The rules are:

* prefix every variable with `ARPI_`
* separate nesting levels with a double underscore `__`
* values are parsed and type-checked exactly as if they had come from YAML

Precedence is **environment variable > YAML profile file > model default**.

| Config key | Environment variable | Example value |
|---|---|---|
| `profile` | `ARPI_PROFILE` | `portfolio` |
| `random_seed` | `ARPI_RANDOM_SEED` | `20250701` |
| `reporting.start_date` | `ARPI_REPORTING__START_DATE` | `2025-07-01` |
| `reporting.end_date` | `ARPI_REPORTING__END_DATE` | `2025-12-31` |
| `logging.level` | `ARPI_LOGGING__LEVEL` | `DEBUG` |
| `logging.format` | `ARPI_LOGGING__FORMAT` | `json` |
| `database.enabled` | `ARPI_DATABASE__ENABLED` | `true` |
| `database.host` | `ARPI_DATABASE__HOST` | `localhost` |
| `database.port` | `ARPI_DATABASE__PORT` | `5432` |
| `database.name` | `ARPI_DATABASE__NAME` | `arpi` |
| `database.user` | `ARPI_DATABASE__USER` | `arpi_loader` |
| `database.sslmode` | `ARPI_DATABASE__SSLMODE` | `require` |
| `paths.raw_output_dir` | `ARPI_PATHS__RAW_OUTPUT_DIR` | `data/raw` |
| `features.enable_public_vehicle_enrichment` | `ARPI_FEATURES__ENABLE_PUBLIC_VEHICLE_ENRICHMENT` | `false` |

Concrete example -- point the `development` profile at a local database for one command:

```bash
ARPI_DATABASE__ENABLED=true \
ARPI_DATABASE__HOST=localhost \
ARPI_DATABASE__NAME=arpi \
ARPI_DATABASE__USER=arpi_loader \
ARPI_DATABASE__PASSWORD='...' \
arpi run-foundation --profile development --load-database
```

ARPI does **not** auto-load a `.env` file, on purpose: configuration resolution must be
reproducible and must not depend on a file that happens to be in the current directory.
Export the variables yourself, for example `set -a; source .env; set +a`.

## Password policy

`database.password` is **never** part of the YAML contract.

* It is read only from `ARPI_DATABASE__PASSWORD`, falling back to `PGPASSWORD`.
* If any YAML file in this directory contains a `password` key -- at any nesting depth --
  loading fails with a `ConfigurationError` telling you to use the environment variable.
* The value is held as a `SecretStr`. `repr()`, `str()` and `ArpiConfig.redacted_dict()`
  all render it as `***REDACTED***`, and the logging subsystem installs a redaction
  filter that scrubs the literal value, `password=...` assignments and
  `postgresql://user:secret@host` URIs out of every log line.

`.env` is gitignored; `.env.example` in the repository root documents every supported
variable with safe placeholder values.

---

## `reference/` — contracts, not profiles

`reference/` holds versioned data contracts rather than run configuration. Nothing in it
is a pydantic profile, nothing in it is selected by `ARPI_PROFILE`, and the generator
never reads it.

| File | What it governs |
|---|---|
| `reference/inventory_listing_contract.yaml` | The sanitized public dealership listing workbook: its sheets, its nineteen columns, its controlled vocabularies and governed ranges, its pricing rules, its identity algorithm, its file-naming patterns, its per-store directories, and the SHA-256 of every committed artifact |

**One declaration, five readers.** The sanitizer writes to it, the validator checks
against it, the importer derives its COPY column list from it, the exporter reads its
store descriptors, and `scripts/check_reference_data.py` enforces it in CI. A contract
restated in any of those five would be a second copy able to disagree with the first.

**Why YAML for the contract and JSON for the capability register.** This file is read by
the application, which has PyYAML. `config/project_capabilities.json` is read by the
`repository-checks` CI job, which installs nothing.

That split has one consequence worth knowing before editing this file: the CI checker
parses it with a hand-written line scanner, so **its regular expressions are
single-quoted**. In YAML a single-quoted scalar is literal, so PyYAML and the scanner
receive identical characters; a double-quoted `"\\d"` would not survive both.
`tests/unit/test_reference_data_check.py::test_the_two_parsers_agree_about_the_contract`
fails if they ever diverge.

The contract is described in full in
[`../data/reference/README.md`](../data/reference/README.md) and decided in
[ADR-0011](../docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md).

---

## `dashboard/action_rules.yaml` — the `DASH.12` review policy

The permanent register of management-action rules, and the display policy for the gross-change
bridge. It is **policy**, held apart from the data on purpose: SQL publishes what is true, and this
file says which of those truths deserve a manager's attention.

**It is an INPUT to published data.** Editing a review threshold changes
`data/dashboard/management-actions.json` even though no business fact moved, so
`scripts/export_dashboard_dataset.py --check` re-derives the whole queue from this file and the
committed datasets and fails on any difference. The export manifest records this file's SHA-256, so
a committed queue can always be traced to the ruleset that produced it.

**It contains no executable code.** Predicates are strings in a deliberately small grammar —
comparisons, `and`/`or`/`not`, `is null`, a column reference and a `@threshold` reference — parsed by
`arpi/dashboard/action_predicate.py`. There is no `eval`, no function call production, no attribute
access and no indexing, and an expression naming a column the rule's dataset does not export is
refused before any row is read.

**Three rules about thresholds, enforced by the loader:**

1. A threshold the warehouse already governs is **not restated**. `ACT-INV-001` does not say
   "60 days"; it reads the governed boolean and discloses the row's own `aged_threshold_days`.
2. A minimum-sample floor comes from `arpi.constants.MINIMUM_SAMPLE_ELIGIBLE_DEALS`, the same
   authority `fn_minimum_sample_floor` publishes. The file may only reference it, never restate it.
3. A threshold this file owns must be **labelled a project default**. The loader refuses one that is
   not, because nothing here is an industry benchmark, an OEM standard or a compliance requirement.

**A disabled rule is never deleted and never renumbered.** Eighteen of the thirty permanent
identifiers are switched off, each carrying the audited reason the project cannot evaluate it
honestly — the evidence is absent, it exists only at a different grain, or the condition is one an
earlier data-quality gate already prevents. "We looked and could not do this honestly" is a more
useful record than an absence.

The schema is specified in
[`../docs/dashboard/ACTION_ENGINE_SPEC.md`](../docs/dashboard/ACTION_ENGINE_SPEC.md) and the register
audit is in [`../docs/reviews/DASH-12-REVIEW.md`](../docs/reviews/DASH-12-REVIEW.md).
