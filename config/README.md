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
