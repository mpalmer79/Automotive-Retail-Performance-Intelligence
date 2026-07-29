# Power BI Desktop validation — handoff

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Delivery increment:** `P2.1` — Power BI semantic model
**Backlog item:** `P2.1-09` — Power BI Desktop open, refresh, save and validate
**Last reviewed:** 2026-07-29
**Parent documents:** [ADR-0007](../architecture-decisions/ADR-0007-power-bi-project-format.md) · [PHASE_2_BACKLOG.md](../requirements/PHASE_2_BACKLOG.md)

---

## 1. Why this document exists, and why there is only one of them

Everything in the ARPI semantic model that a text file can prove has been proved. The
TMDL parses, the table inventory is exactly the twenty approved views, the forty-two
relationships are the register, every surrogate key is hidden, all twenty-nine governed
KPI measures exist with their formats and descriptions, no credential appears anywhere,
and the SQL side of every KPI has been evaluated across seventeen filter contexts and
committed as a baseline. `scripts/check_powerbi_model.py` enforces all of that on every
push.

**No static check can prove that the model opens, refreshes, and returns the same numbers
in DAX that the governed SQL returns.** That requires Power BI Desktop, which is a Windows
application that GitHub Actions cannot run and that the Linux environment this model was
built in does not have. So it is a manual gate, and this is the whole of it.

This is deliberately **one checkpoint**, not a sequence of small requests. Work through it
once, end to end. Expect it to take one sitting.

> **Everything below is Windows.** Every command is PowerShell. There is no Bash step and
> you should not need WSL.

---

## 2. Before you start

| You need | Notes |
|---|---|
| Windows 10 or 11 | Power BI Desktop is Windows-only |
| **Power BI Desktop**, recent build | The Microsoft Store build and the downloaded build both work |
| **PostgreSQL 16** | Local install, or a container you can reach on `localhost` |
| **Npgsql** | Power BI's PostgreSQL connector needs it. Desktop prompts and links to the installer the first time you connect; install it and restart Desktop |
| **Python 3.11+** on `PATH` | Used by the pipeline and by the validation script's hash step |
| **Git** | To check out the branch and commit the result |
| ~2 GB free disk | The `development` profile generates roughly 55,000 fact rows |

Open **PowerShell** (not the ISE) in a directory you are happy to clone into.

---

## 3. The procedure

### Step 1 — Check out the pull-request branch

```powershell
git clone https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence.git
Set-Location .\Automotive-Retail-Performance-Intelligence
git fetch origin claude/arpi-phase-5-semantic-model-yvwbsc
git checkout claude/arpi-phase-5-semantic-model-yvwbsc
```

If you already have the repository, `git fetch` and `git checkout` are enough.

Keep the clone path **short**. Windows limits a path to 260 characters by default, and PBIP
stores the model as nested folders and files; `C:\src\arpi` is a good choice and
`C:\Users\<you>\OneDrive\Documents\Projects\...` is not. Do not put the project inside a
OneDrive or SharePoint synced folder — Desktop cannot save a PBIP into one reliably.

### Step 2 — Create a fresh development database

Create the virtual environment and install ARPI:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e ".[db,dev]"
```

Create the database. Adjust `-U` if your superuser is not `postgres`; you will be prompted
for its password.

```powershell
$env:PGHOST     = 'localhost'
$env:PGPORT     = '5432'
$env:PGUSER     = 'postgres'
$env:PGDATABASE = 'arpi_dev'

createdb -U postgres arpi_dev
```

Run the ordered SQL initialisation sequence. This is the same 104-script sequence CI runs,
in the same order: `sql/00_database` through `sql/08_validation`, skipping the read-only
role report, then a second pass of the grants script so the validation objects end up
owned by `arpi_admin`.

```powershell
$scripts = Get-ChildItem -Path .\sql\0* -Filter *.sql -Recurse -File |
    Where-Object { $_.FullName -notlike '*07_security\02_role_verification.sql' } |
    Sort-Object { $_.FullName -replace '\\', '/' }

foreach ($script in $scripts) {
    Write-Host "-> $($script.FullName)"
    psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f $script.FullName
    if ($LASTEXITCODE -ne 0) { throw "failed: $($script.FullName)" }
}
psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f .\sql\07_security\01_grants.sql
```

Expect three notices confirming the privilege model: `arpi_reporter` holds no privilege on
the raw, staging, warehouse and audit objects, and read-only access to 28 reporting views.

### Step 3 — Run the ARPI development pipeline

```powershell
$env:ARPI_PROFILE            = 'development'
$env:ARPI_DATABASE__ENABLED  = 'true'
$env:ARPI_DATABASE__HOST     = 'localhost'
$env:ARPI_DATABASE__PORT     = '5432'
$env:ARPI_DATABASE__NAME     = 'arpi_dev'
$env:ARPI_DATABASE__USER     = 'postgres'
$env:ARPI_DATABASE__PASSWORD = Read-Host -Prompt 'PostgreSQL password for postgres' -AsSecureString |
    ForEach-Object { [System.Net.NetworkCredential]::new('', $_).Password }
$env:ARPI_DATABASE__SSLMODE  = 'disable'

.\.venv\Scripts\arpi run-foundation --profile development --load-database
```

It takes a few minutes. It must end with `114 passed, 0 critical failure(s)` and every
reconciliation `-> passed`.

Confirm the reporting layer holds what the baseline expects:

```powershell
psql -t -A -c "SELECT count(*) FROM reporting.vw_vehicle_sales"        # 650
psql -t -A -c "SELECT count(*) FROM reporting.vw_inventory_snapshots"  # 45754
psql -t -A -c "SELECT count(*) FROM reporting.vw_leads"                # 6000
```

If any of these differs, **stop**: the baseline in `powerbi/validation/sql_baseline.json`
was taken from the `development` profile at seed 20250701, and comparing a model loaded
from a different profile against it would produce failures that mean nothing.

### Step 4 — Create the read-only reporting login

The model connects as `arpi_reporter`. That role exists but has no login by default, which
is what stops the semantic model reaching `raw`, `staging`, `warehouse` or `audit`.

```powershell
psql -c "CREATE ROLE arpi_pbi LOGIN PASSWORD 'choose-a-local-password';"
psql -c "GRANT arpi_reporter TO arpi_pbi;"
```

Choose that password yourself and **do not** commit it, paste it into a file in the
repository, or type it into any document. It is a local development credential; Power BI
stores it in the Windows credential store and nowhere else.

### Step 5 — Enable the Power BI Desktop preview features

Open **Power BI Desktop**, then **File → Options and settings → Options → Preview features**
and tick:

- **Power BI Project (.pbip) save option**
- **Store semantic model using TMDL format**
- **Store reports using enhanced metadata format (PBIR)**

Then, still in **Options**, under **Current File → Data Load**, clear **Auto date/time**.
The model disables it explicitly (`__PBI_TimeIntelligenceEnabled = 0`) because `vw_calendar`
is the marked date table and a hidden auto-generated calendar per date column would give
two answers to "what is last month".

**Restart Power BI Desktop.** The preview features do not take effect until you do.

### Step 6 — Open the project

```powershell
Start-Process .\powerbi\ARPI_Performance_Intelligence\ARPI_Performance_Intelligence.pbip
```

The report folder in this branch is a **shell**: it contains `definition.pbir` and
`.platform` and no pages, because report authoring is `P2.2` and has not started. Power BI
Desktop generates the blank report definition itself on first save. That is expected.

**If Desktop opens the project, go to step 7.**

**If Desktop refuses to open it** — most likely because your build writes a different
report skeleton than this branch carries — use this fallback, which does not require you
to author anything:

1. In Power BI Desktop, **File → New**.
2. **File → Save as → Power BI project (.pbip)**, into
   `powerbi\ARPI_Performance_Intelligence\`, named exactly
   `ARPI_Performance_Intelligence`. Desktop now writes its own correct skeleton and
   overwrites the committed one.
3. Close Power BI Desktop.
4. Restore the committed semantic model over the empty one Desktop just wrote:

   ```powershell
   git checkout -- powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel
   ```

5. Reopen the `.pbip`. Desktop now loads its own report skeleton and the ARPI semantic
   model definition.

Either way, **do not add a visual to the report page.** A blank page that Desktop created
is fine and expected. Anything on it is `P2.2` work and will fail
`scripts/check_powerbi_model.py`.

### Step 7 — Set the parameters

**Home → Transform data → Edit parameters.**

| Parameter | Value |
|---|---|
| `ArpiServer` | `localhost:5432` |
| `ArpiDatabase` | `arpi_dev` |

Both are plain text and neither is a secret. If your PostgreSQL is on another port, put it
in `ArpiServer` as `host:port` — the parameter is deliberately shaped to carry one.

### Step 8 — Authenticate

On the first refresh Desktop asks for credentials for the PostgreSQL source.

- Choose **Database** (not Windows).
- User name: the login you created in step 4, for example `arpi_pbi`.
- Password: the one you chose.
- Privacy level: **Organizational** or **Private**; either is fine for a local database.

If Desktop offers **Encrypt connection**, clear it — the local database in step 2 has no
TLS configured. Do not change this for anything other than a local development database.

Nothing about this credential is written to the repository. If Desktop ever offers to
save a connection string into the project, decline.

### Step 9 — Refresh

**Home → Refresh.** All twenty tables load. On a laptop this takes a couple of minutes;
`vw_inventory_snapshots` is 45,754 rows and is the slow one.

If a table fails with a permission error, the login in step 4 is not a member of
`arpi_reporter`. If a table fails with "table not found", the SQL sequence in step 2 did
not complete.

### Step 10 — Confirm the table counts

In the **Model** view, confirm twenty-six tables: the twenty `vw_*` tables plus the six
measure tables. Spot-check three row counts in **Table** view against step 3.

Confirm in **Model** view that `vw_calendar` shows as the date table and that no
relationship line is bidirectional. The script in step 12 checks all of this properly;
this is the eyeball pass that catches a refresh that half-worked.

### Step 11 — Save

**File → Save.** Desktop writes the report definition, `diagramLayout.json`, and possibly
normalises `database.tmdl` and `model.tmdl` to exactly what its build emits. That
normalisation is expected and should be committed — Desktop's serialisation is the
authoritative one from this point on.

Do **not** save a `.pbix`. `P2.1` commits no binary.

### Step 12 — Run the validation script

Leave Power BI Desktop **open** with the model loaded. In PowerShell, from the repository
root:

```powershell
.\scripts\validate_powerbi_model.ps1
```

It finds the running Desktop instance, connects to its local Analysis Services endpoint,
reads the model's own metadata, runs all seventeen generated DAX queries, compares every
value against `powerbi/validation/sql_baseline.json`, and writes
`powerbi/validation/desktop_validation_results.json`.

If PowerShell blocks the script:

```powershell
Unblock-File .\scripts\validate_powerbi_model.ps1
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Step 13 — Confirm the result

The script prints a summary and exits non-zero on any failure. What it checks:

- the table, relationship and measure inventories, read from the model rather than from
  the TMDL on disk;
- that no relationship is bidirectional and none is many-to-many;
- that every table refreshed to its expected non-zero row count;
- all twenty-nine KPI measures and nine supporting measures, in each of the seventeen
  filter contexts — unfiltered, each of the three stores, each of the six months, new
  versus used, one employee, one lead source, one vehicle model, a zero-denominator
  context, and a context that activates the inactive show-date relationship.

The comparison that matters most is the **blank-versus-zero** one. If a measure returns
`0` where the SQL returns null — a gross-per-unit figure in a month with no sales, or a
cost per lead for an organic source — that is a failure, and it is the specific defect this
whole exercise exists to catch.

**If it fails, do not fix the numbers by hand.** Report the failure on the pull request
with the contents of `desktop_validation_results.json`; the difference is a defect in the
model or in the baseline, and it needs diagnosing rather than patching.

### Step 14 — Commit

```powershell
git add powerbi/ARPI_Performance_Intelligence powerbi/validation/desktop_validation_results.json
git commit -m "Record Power BI Desktop validation of the ARPI semantic model"
git push origin claude/arpi-phase-5-semantic-model-yvwbsc
```

Before you commit, check that no machine-specific state crept in:

```powershell
git status --short
```

You should see the Desktop-generated report definition, possibly `diagramLayout.json` and
normalised TMDL, and the validation result. You should **not** see
`.pbi/localSettings.json` or `.pbi/cache.abf` — `.gitignore` excludes both, and
`scripts/check_powerbi_model.py` fails the build if either is ever committed.

### Step 15 — Resume

Say so on the pull request, or resume the Claude Code session. CI will re-run
`scripts/check_desktop_validation_freshness.py`, which recomputes the model source hash and
compares it with the one recorded in the evidence file. If they match and the result is
`passed`, the Desktop gate is closed and the pull request can be marked ready.

If you edit the TMDL after validating, that hash stops matching and CI reports the
evidence as **stale** rather than as passed. That is the intended behaviour: evidence for
a model that no longer exists is not evidence.

---

## 4. What this does not authorise

Closing this gate completes delivery increment `P2.1` and Lifecycle Phase 5. It does not
start `P2.2`. Do not add a visual, a page, a bookmark or a drill-through while you are in
Desktop, however tempting it is with a working model in front of you. Report design is a
separate increment with its own acceptance criteria, and mixing it into this change would
make both unreviewable.

---

## 5. If something goes wrong

| Symptom | Most likely cause |
|---|---|
| Desktop will not open the `.pbip` | Preview features not enabled, or Desktop not restarted after enabling them. Failing that, use the step 6 fallback. |
| "We couldn't find the Npgsql library" | Install Npgsql and restart Desktop. |
| Every table fails with a permission error | The login is not a member of `arpi_reporter` (step 4). |
| `vw_inventory_turn` loads 0 rows | The pipeline in step 3 did not complete; the view is empty rather than missing. |
| Row counts differ from the table above | A profile other than `development`, or a different seed. The baseline is only valid against `development` at seed 20250701. |
| `validate_powerbi_model.ps1` cannot find the model | Desktop is closed, or the model is still refreshing. Leave it open and idle. |
| The script cannot load ADOMD.NET | Install SQL Server Management Studio, or the standalone ADOMD.NET client. |
| Many SQL-to-DAX differences, all in one context | Check the filters on that context first: a wrong store or month code produces exactly this pattern. |
| A single blank-versus-zero difference | Real defect. Report it; do not work around it. |
