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

The five Python checks run in the `repository-checks` job of
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), on every push to any
branch, on every pull request, and on manual dispatch. That job installs
nothing beyond a Python interpreter.

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
python scripts/check_powerbi_model.py
python scripts/check_desktop_validation_freshness.py
```

Or all five, stopping at the first failure:

```bash
python scripts/check_naming.py \
  && python scripts/check_docs_links.py \
  && python scripts/check_secrets.py \
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
