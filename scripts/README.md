# Repository control scripts

Small, standard-library-only checks that guard repository hygiene. They are
deliberately **not** part of the `arpi` package: CI runs them without installing
anything, which keeps the `repository-checks` job to a few seconds and means a
broken package cannot hide a broken repository.

Every script here:

- is Python 3.11+, fully type-hinted, and imports only the standard library;
- exits `0` when clean and `1` on any violation;
- supports `--quiet` (findings and the summary line only);
- supports `--paths PATH...` to narrow the scan;
- resolves the repository root from its own location, so it can be run from any
  working directory.

---

## The scripts

### `check_naming.py`

Fails the build when a retired project identifier is used as a **current**
identity.

ADR-0001 retired the project's earlier working title and fixed the current
identity: the display name *Automotive Retail Performance Intelligence*, the
short identifier *ARPI*, the Python package `arpi`, the `ARPI_` configuration
prefix, and the database roles `arpi_admin`, `arpi_loader`, and `arpi_reporter`.
A renaming that is only half-applied is worse than no renaming at all, so this
check makes the decision enforceable rather than aspirational.

- **Fails on:** the retired display name, the retired repository slug, the
  retired compact name, the retired role names, the retired package path, and a
  general catch-all for the retired identifier. All case-insensitive.
- **Fails on:** the retired package directory existing on disk.
- **Warns on (does not fail):** `PostgreSQL` misspelled in Markdown.
- **Allowlist:** exactly three paths, each with a comment explaining why —
  ADR-0001 (the decision of record must quote what it retired), `docs/research.md`
  (preserved historical evidence), and the script itself (it contains every
  forbidden string as a pattern literal).
- **Extra flag:** `--self-test` runs internal assertions on the rule set. Use it
  after editing a pattern.

```bash
python scripts/check_naming.py
python scripts/check_naming.py --self-test
python scripts/check_naming.py --paths docs src --quiet
```

### `check_docs_links.py`

Validates **relative** Markdown links, image paths, and heading anchors.
Documentation is a deliverable in this project, so a dead cross-reference is a
build failure.

- Parses `[text](target)`, `![alt](target)`, and `[label]: target` definitions.
- Skips fenced code blocks and inline code spans, which contain examples.
- A target that resolves to a directory is accepted when the directory exists.
- `file.md#anchor` must resolve **both** parts: the file must exist, and the
  anchor must match a GitHub-slugified heading in that file (lowercase, strip
  punctuation, spaces to hyphens, duplicate headings get `-1`, `-2`, …).
  HTML `id=` / `name=` attributes count as anchors too.
- `http://`, `https://`, `mailto:`, and protocol-relative links are **not**
  fetched — CI has no reason to be online — but their count is reported.

```bash
python scripts/check_docs_links.py
python scripts/check_docs_links.py --paths docs README.md
```

### `check_secrets.py`

A **safety net, not a real secret scanner.** It exists to catch the handful of
mistakes that actually happen: committing a `.env`, pasting a live connection
string into a document, leaving a private key in the tree.

- Fails if any `.env*` file other than `.env.example` is tracked by git.
- Fails on high-signal patterns: connection URIs with an inline password, AWS
  access key IDs, private key blocks, GitHub personal access tokens, `sk-`
  prefixed API keys, JSON Web Tokens, and quoted credential assignments.
- Obvious placeholders are allowlisted (`changeme`, `<password>`,
  `***REDACTED***`, `example`, `placeholder`, and a short list of whole-value
  words such as `secret` and `postgres` that documentation uses when showing a
  URI shape).
- Suspected values are **redacted** in the report, so a finding never leaks the
  credential into a public CI log.

It is not entropy-based, it does not scan git history, and it does not
understand context. It complements, and does not replace, `.gitignore`, the
`detect-private-key` pre-commit hook, and GitHub secret scanning. See
[SECURITY.md](../SECURITY.md) for the full policy, including what to do when a
credential is committed by accident.

```bash
python scripts/check_secrets.py
python scripts/check_secrets.py --paths config docs
```

### `check_powerbi_model.py`

Validates the source-controlled Power BI Project under
`powerbi/ARPI_Performance_Intelligence/` against the specification in
`powerbi/model_documentation/`.

Gate 1 opened on 2026-07-29 and Power BI development is now authorised, which
means the semantic model is source code and needs the same treatment as the SQL:
a reviewable definition and a check that fails when the definition drifts from
what was agreed. TMDL makes that possible, because the model is text.

- **Reads:** the `.pbip`, both `.platform` files, `definition.pbism`,
  `definition.pbir`, and every `.tmdl` file, with a purpose-built light parser.
  It does **not** implement TMDL; it reads the structure it needs.
- **Fails on:** an unexpected table; a partition reading anything other than the
  `reporting` schema; a `_key` column left visible; a missing sort-by pairing; a
  missing, duplicated or misnamed relationship; a bidirectional or many-to-many
  relationship; more or fewer than one marked date table; a missing KPI measure;
  a format string outside the approved set; a ratio that divides with `/` instead
  of `DIVIDE`; a PII-shaped column name; anything resembling a credential; a
  committed `.pbix`; report visual content; local Power BI machine state.
- **Never launches Power BI Desktop.** It cannot: Desktop is a Windows
  application. What it proves is what a text file can prove.

```bash
python scripts/check_powerbi_model.py
```

### `check_desktop_validation_freshness.py`

Reports whether the Power BI Desktop validation evidence still describes the
model that is actually committed.

It hashes every file in the semantic model definition and compares that hash
with the one recorded in `powerbi/validation/desktop_validation_results.json`.
Evidence for a model that has since been edited is not evidence, and the point
of this check is that it says so instead of staying green.

- **Statuses:** `PASSED`, `PENDING`, `STALE`, `FAILED`, `MISSING`. `PENDING`
  exits `0` because it is the expected state while `P2.1` is in flight — but it
  is never rendered as a pass. `STALE`, `FAILED` and `MISSING` exit non-zero.
- **Extra flag:** `--print-hash` prints only the hash, which is how
  `validate_powerbi_model.ps1` records the same value CI will recompute. One
  implementation, so the two cannot disagree.

```bash
python scripts/check_desktop_validation_freshness.py
python scripts/check_desktop_validation_freshness.py --print-hash
```

### `check_reference_data.py`

Guards the one lane of committed data that is **not** synthetic: the sanitized
public dealership listing snapshots of
[ADR-0011](../docs/architecture-decisions/ADR-0011-sanitized-public-inventory-reference-data.md).

Everything that makes that lane safe is a property of the **committed file**,
not of the code that produced it. A sanitizer that behaves perfectly is no
evidence about a workbook somebody added by hand, so this check reads the files
themselves.

| Rule | What fails |
|---|---|
| `undeclared-artifact` | A workbook under `data/reference/` that the contract does not declare |
| `missing-artifact` | A declared artifact that is not in the repository |
| `canonical-filename` | A name that does not match the approved pattern — underscores between filename words, hyphens only inside the ISO date |
| `artifact-digest` | Content that does not match the declared SHA-256 |
| `duplicate-artifact` | The same workbook committed under a second path |
| `artifact-misfiled` | A workbook under another store's directory — caught even when it is the only file there |
| `sample-is-synthetic-only` | A non-synthetic file appearing under `data/sample/` |
| `artifact-url` | A source URL inside a committed workbook |
| `artifact-real-vin` | A value inside a committed workbook that could be a real VIN |
| `artifact-classification` | A workbook that does not carry its classification on every row |
| `artifact-unreadable` | A workbook the checker cannot open, which is never treated as a pass |
| `reference-data-is-not-synthetic` | A **document** describing this lane as synthetic |
| `removed-is-not-sold` | A document reading a removed listing as a sale |
| `days-observed-is-not-days-in-stock` | A document reading days observed online as days in stock |

The last three are prose rules, and they are the ones most likely to fire. The
code has no way to claim a listing was sold; a sentence does. Each is written so
that the correct statement of the boundary — "a removed listing is **not** a
sale" — is not itself caught.

Reading a workbook without openpyxl is the reason this file is longer than the
others: an `.xlsx` is a ZIP of XML, and `zipfile` plus the shared-strings table
is enough to walk every cell. That keeps the check in the `repository-checks`
job, which installs nothing.

```bash
python scripts/check_reference_data.py
python scripts/check_reference_data.py --quiet
```

---

## The inventory lane operator scripts

These four are **not** CI checks. They are run by an operator against a workbook
or a database, and they are the only way data enters the sanitized public
reference lane. Unlike everything above, they need the `arpi` package installed.

| Script | What it does |
|---|---|
| `sanitize_inventory_workbook.py` | Reads a **private** dealership workbook from a path the operator supplies and writes the governed sanitized workbook. The input never enters the repository. Failures name a row, a column and a category with the offending value **redacted** |
| `validate_inventory_workbook.py` | Runs the 17 `DQ-LST-*` checks against a sanitized workbook, without a database |
| `import_inventory_snapshot.py` | Loads a sanitized workbook into PostgreSQL — raw, staging, `dim_observed_vehicle`, `fact_vehicle_listing_snapshot` — and records its own `audit.pipeline_run`, rejections and reconciliations. A workbook whose digest is already loaded does **no work at all** |
| `export_inventory_operating_report.py` | Exports the dealership-facing Excel operating report from the reporting views into `artifacts/inventory/`, which is gitignored |

Each is a thin wrapper over `arpi.inventory`; the same four operations are
available as `arpi inventory sanitize`, `validate`, `import` and `report`.

```bash
python scripts/validate_inventory_workbook.py \
  data/reference/inventory/gsa-001/2026-08-02/ARPI_Granite_Chevrolet_Inventory_Sanitized_2026-08-02.xlsx
```

---

## The generators and the Desktop validator

These two are **not** CI checks. They are run by hand, they need things CI does
not have, and they write artefacts that are then committed and checked.

### `generate_sql_baseline.py`

Evaluates the SQL side of all twenty-nine governed KPIs across twenty-one filter
contexts and writes `powerbi/validation/sql_baseline.json`, its metadata, the
matching DAX queries, and the model inventories the Desktop validator checks
against.

The contexts are the point. A measure can have a correct grand total and still
be wrong under filter context, so the baseline covers the unfiltered model, each
of the three stores, each of the six months, new versus used, one employee, one
lead source, one vehicle model, a context whose denominator is zero, a context
that exercises an inactive date relationship, and four combinations that apply
two or three filters at once. The combinations do the real work: a filter that
reaches a table by the wrong route usually agrees with every single-axis
expectation and diverges only where two of them intersect. The DAX queries are
generated from the **same** context definitions, so the two sides cannot drift
into describing different populations.

The script also models **filter propagation** rather than assuming it — a
condition-group filter reaches the sale and inventory facts through `vw_vehicle`
and reaches `vw_inventory_turn` not at all — because a baseline that applied
every filter to every table would disagree with a correct model.

Requires `psycopg` and a database built from `sql/` and loaded with the
`development` profile. Records no host, user name or password.

```bash
python scripts/generate_sql_baseline.py
```

### `validate_powerbi_model.ps1`

The manual Desktop gate. Windows and PowerShell only. Connects to a running
Power BI Desktop instance, reads the model's own metadata, runs the generated
DAX queries, compares every value with the SQL baseline, and writes
`powerbi/validation/desktop_validation_results.json`.

The procedure around it is `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md`. Nothing
in CI runs it, and nothing in CI ever may.

---

## When CI runs them

The Python checks run in the `repository-checks` job of
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every push to any
branch, on every pull request, and on manual dispatch. That job installs
nothing beyond a Python interpreter — which is why every check here imports only
the standard library, including the one that reads a spreadsheet.

The four inventory-lane operator scripts are **not** in that job and never will
be. Sanitization needs a private workbook that is not in the repository, and the
other three need a database; a CI job holding either would move a boundary that
exists precisely so no reviewer has to take it on trust.

`check_naming.py` and `check_secrets.py` also run as `local` hooks in
[`.pre-commit-config.yaml`](../.pre-commit-config.yaml) on every commit;
`check_docs_links.py` runs there when a Markdown file changes. Pre-commit is
optional — CI is authoritative.

## Running them locally

From anywhere in the repository:

```bash
python scripts/check_naming.py
python scripts/check_docs_links.py
python scripts/check_secrets.py
python scripts/check_reference_data.py
python scripts/check_powerbi_model.py
python scripts/check_desktop_validation_freshness.py
```

Or all of them, stopping at the first failure:

```bash
python scripts/check_naming.py \
  && python scripts/check_docs_links.py \
  && python scripts/check_secrets.py \
  && python scripts/check_reference_data.py \
  && python scripts/check_powerbi_model.py \
  && python scripts/check_desktop_validation_freshness.py
```

They are also linted and formatted like the rest of the project, because CI runs
`ruff format --check .` and `ruff check .` over the whole tree:

```bash
ruff format --check scripts/
ruff check scripts/
```

## Adding a new check

1. **Justify it.** A new check must prevent a real, recurring mistake. If a
   human would not reasonably make the error, do not automate against it.
2. **Create `scripts/check_<thing>.py`.** Standard library only, fully
   type-hinted, module docstring stating what it enforces and *why*.
3. **Match the interface.** `--quiet`, `--paths PATH...`, exit `0` clean and `1`
   on findings, a report line of the form `path:line: message`, and a summary
   count. Reuse the `REPO_ROOT`, `SKIPPED_DIRECTORY_NAMES`, and binary-detection
   patterns from an existing script rather than inventing new ones.
4. **Give it an allowlist with reasons.** Any exception must be a module
   constant with a comment saying why that path is exempt. An unexplained
   allowlist entry is how a check quietly stops working.
5. **Make it self-checking.** Either add a `--self-test` flag with internal
   assertions (as `check_naming.py` does) or make the rule so simple that a
   reader can verify it by eye.
6. **Wire it up.** Add a step to the `repository-checks` job in
   `.github/workflows/ci.yml`, and a `local` hook in `.pre-commit-config.yaml`
   if it is fast enough to run at commit time.
7. **Document it here** and, if it changes contributor behaviour, in
   [CONTRIBUTING.md](../CONTRIBUTING.md).

A check that fails for a legitimate file is worse than no check, because people
learn to ignore it. Prefer a narrow rule with a documented allowlist over a
broad rule with a suppression comment.

---

## Verifying a cloud database

### `verify_cloud_database.py`

Proves that a **managed PostgreSQL 16** deployment of the ARPI `reporting`
schema is a faithful copy of the local one, so a cloud semantic-model engine can
be pointed at it. The procedure around it is
[`../docs/cloud-database-setup.md`](../docs/cloud-database-setup.md).

It never contacts a hosted database from CI, and it is run by hand at the end of
a cloud build. It is not, however, unexercised: the `database-setup-image` job in
`ci.yml` runs the whole provisioning image against Railway's own
`postgres-ssl` image twice and calls this script on the result, which is how the
per-run behaviour described below was discovered rather than assumed.

Nine named checks, each with its own failure message: the server is PostgreSQL
16 or later; **this connection is actually encrypted**, according to the server's
own `pg_stat_ssl` rather than according to a configuration file; all five schemas
exist; there are exactly 28 views in `reporting`; the eight dimensions and five
facts exist and hold rows; all twenty reporting row counts match the
`development` profile **exactly**; 58 reconciliations are recorded per run with
none failing; the run recorded profile `development` at seed `20250701`; and
`arpi_reporter` holds no privilege on any object in `raw`, `staging`,
`warehouse` or `audit` — checked object by object and privilege by privilege, and
listing every offender.

Every row count is an equality rather than a lower bound, because the generator
is deterministic: a correct cloud load reproduces the local numbers or it is not
a correct cloud load. The reporter isolation is re-proved against the cloud
database rather than inherited from the local one, because a managed provider's
non-superuser bootstrap role changes who owns what, and ownership is the
mechanism the isolation rests on.

**Sixteen of those twenty counts are grained on the warehouse and four are
grained on the pipeline run.** `vw_pipeline_run_summary`,
`vw_reconciliation_status`, `vw_data_quality_summary` and `vw_data_quality_trend`
read the append-only `audit` layer, so they grow by a fixed quantum every time
the loader runs — keeping the previous run is what an audit layer is *for*. They
are asserted as `quantum × runs on record`, read from `audit.pipeline_run`. That
is still an equality and still fails a run that recorded 57 of its 58
reconciliations; it just no longer fails a database for remembering that it was
loaded twice. Expecting fixed totals made both documented rerun procedures —
"safe to rerun", and the reporter-password rotation, whose second step is a
redeploy of the provisioning job — fail on a warehouse that was byte-identical.

It **never prints a host name, port, user name, database name or password**, in
normal output or in error output — a connection failure is reported by exception
type alone. The output is written to be safe to paste into an issue unedited.

Connection settings resolve from `ARPI_DATABASE__*` then `PG*`, the same way
`generate_sql_baseline.py` and the integration tests resolve them. Reads only;
it creates nothing and needs no superuser.

```bash
python scripts/verify_cloud_database.py
python scripts/verify_cloud_database.py --list-checks
python scripts/verify_cloud_database.py --checks tls reporter-isolation
python scripts/verify_cloud_database.py --quiet
```

Exit `0` when every selected check passes, `1` on any finding, and `2` when the
check could not be run at all — `psycopg` missing, or no connection.
