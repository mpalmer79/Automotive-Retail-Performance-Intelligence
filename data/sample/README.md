# Sample data — 100% SYNTHETIC

> ## ⚠️ EVERY ROW IN THIS DIRECTORY IS MACHINE GENERATED
>
> **Granite State Auto Group is fictional.** It does not exist. Neither do
> Granite Chevrolet of Nashua, Granite Subaru of Manchester, nor Granite Used Auto Center
> of Merrimack. The `GSA-###` identifiers, the store names, the opening dates and the
> market region are all invented for this portfolio project.
>
> **No real person, customer, employee, dealership, vendor or transaction is represented
> anywhere in these files.** ARPI generates no personal data at all: there are no names,
> addresses, phone numbers, email addresses, government identifiers, credit scores or
> compensation figures in any dataset, and a data-quality check (`DQ-DLR-004`) fails the
> pipeline if a column name ever suggests otherwise.
>
> Do not present anything in this directory as a real business result.

## What is here

| File | Rows | Columns | Description |
|---|---:|---:|---|
| `dim_date.csv` | 184 | 26 | Calendar dimension, one row per date from 2025-07-01 to 2025-12-31 |
| `dim_dealership.csv` | 3 | 16 | Current SCD Type 2 version of each fictional store |
| `generation_manifest.json` | — | — | Provenance record, including a SHA-256 digest of each CSV |

These are a committed, row-capped extract. The full, uncapped output is written to
`data/raw/<profile>/`, which is gitignored.

## How it was produced

| Setting | Value |
|---|---|
| Profile | `development` (`config/development.yaml`) |
| `random_seed` | `20250701` |
| Reporting window | `2025-07-01` .. `2025-12-31`, inclusive |
| Sample row cap | `generation.sample_row_limit = 400` |
| ARPI version | `0.1.0` |

The row cap applies per entity. `dim_date` has 184 rows, which is under the cap, so it is
written in full here; a longer window would be truncated to the first 400 rows.
`dim_dealership` is **never** truncated — the dealer group has exactly three stores, and a
partial store list would be misleading.

### Regeneration

From the repository root:

```bash
arpi generate --profile development
```

or, without installing the console script:

```bash
python -m arpi generate --profile development
```

That command writes the uncapped CSVs to `data/raw/development/` and refreshes the capped
copies in this directory.

## Determinism

Regenerating with the same profile produces **byte-identical** files. The manifest
deliberately records no wall-clock timestamp (`"timestamp_policy": "omitted for
deterministic output"`), so a `git diff` on this directory only ever shows a real change to
the data.

You can verify the committed files against the manifest yourself:

```bash
sha256sum data/sample/dim_date.csv data/sample/dim_dealership.csv
```

Each digest must match the matching `content_digest` in `generation_manifest.json`. The
automated test `tests/data_quality/test_determinism_and_manifest.py::test_committed_sample_files_are_current`
enforces this on every CI run.

## File format

UTF-8, LF line endings, one header row, `,` delimiter with minimal quoting, ISO-8601
(`YYYY-MM-DD`) dates, lowercase `true`/`false` booleans, and an empty field for NULL. The
open-ended SCD Type 2 sentinel `expiration_date` is `9999-12-31`.
