# Microsoft Fabric validation — handoff

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Delivery increment:** `P2.1` — Power BI semantic model
**Last reviewed:** 2026-07-29
**Parent documents:** [ADR-0008](../architecture-decisions/ADR-0008-real-engine-validation-paths.md) · [ADR-0007](../architecture-decisions/ADR-0007-power-bi-project-format.md) · [PHASE_2_BACKLOG.md](../requirements/PHASE_2_BACKLOG.md)

---

## 1. What this is, and why it exists

ARPI's semantic model is built, committed as TMDL, and statically validated by 9,452
assertions on every push. None of that proves it is **correct**. Only a Microsoft
semantic-model engine can load the TMDL, refresh it against real data, and return a number
that can be compared with the governed SQL. That is the gate on Lifecycle Phase 5, and it
is still open.

[ADR-0007](../architecture-decisions/ADR-0007-power-bi-project-format.md) made Power BI
Desktop the only way through it. Desktop is Windows-only, and this project's owner has no
Windows machine — so the gate as written was not merely unclosed, it was unreachable.
[ADR-0008](../architecture-decisions/ADR-0008-real-engine-validation-paths.md) fixes that
by accepting **two** engines with an identical proof obligation. This document is the
procedure for the second one, which needs nothing but a browser.

> **Everything here works from a Chromebook.** Sign-in is a device code you complete in
> any browser. There is no Windows step, no PowerShell, and no desktop application.

### What either engine has to prove

| # | Obligation |
|---|---|
| 1 | A Microsoft semantic-model engine accepted the TMDL definition |
| 2 | All twenty imported tables refreshed |
| 3 | Expected row counts are present |
| 4 | All forty-two relationships exist |
| 5 | All forty-nine measures exist |
| 6 | DAX results match the governed SQL baseline in every filter context |
| 7 | The recorded evidence matches the current model-source hash |

---

## 2. Before you start

| You need | Notes |
|---|---|
| A browser | Any device. This is the only hard requirement for sign-in. |
| A terminal with **Python 3.11+** | A Chromebook's Linux container is fine. So is any Linux or macOS machine. |
| **Git** | To check out the branch and commit the evidence. |
| A **Microsoft Fabric** workspace on a Fabric or Premium capacity | A Fabric **trial** is sufficient and is free for its duration. Section 3 covers it. |
| A **cloud PostgreSQL 16** database holding the ARPI `reporting` schema | Fabric cannot reach `localhost`. See [`docs/cloud-database-setup.md`](../cloud-database-setup.md). |

**Nothing here should be provisioned on a paid plan without a deliberate decision.** The
Fabric trial and a free-tier managed PostgreSQL are enough for the `development` profile at
roughly 55,000 fact rows. Section 9 covers teardown.

### On credentials

No script in this repository ever accepts a password as an argument, reads one from a file
in the tree, or prints one. Sign-in is an interactive device code; the access token lives
in `~/.arpi/fabric_token_cache.json` with mode 0600, **outside the repository**, and can be
disabled with `ARPI_FABRIC_NO_TOKEN_CACHE=1`. The database password is typed into the
Fabric portal once and stored by Fabric, not by us.

---

## 3. Create the Fabric workspace

1. Go to <https://app.fabric.microsoft.com> and sign in with a work or school account.
   A personal Microsoft account cannot hold a Fabric workspace.
2. If you have no capacity, start the **Fabric trial**: account manager (top right) →
   **Free trial**. It runs for 60 days.
3. **Workspaces** → **New workspace**. Name it something like `ARPI`.
4. Under **Advanced → License mode**, choose **Trial** (or your Fabric/Premium capacity).
   A Pro-only workspace cannot host a Fabric item and the deploy will fail with
   `UnsupportedCapacitySKU`.
5. Open the workspace and read the **workspace ID** out of the URL — it is the GUID after
   `/groups/`:

   ```
   https://app.fabric.microsoft.com/groups/<THIS-IS-THE-WORKSPACE-ID>/list
   ```

Keep that GUID. It is an identifier, not a secret, and it is safe to paste into a terminal.

---

## 4. Stand up the cloud database

Follow [`docs/cloud-database-setup.md`](../cloud-database-setup.md) end to end. It creates a
managed PostgreSQL 16 database, runs the ordered SQL sequence, loads the `development`
profile, and verifies that `arpi_reporter` can read `reporting` and nothing else.

Do not continue until `python scripts/verify_cloud_database.py` passes. A model that
refreshes against a half-loaded database produces failures that mean nothing, and you will
spend the afternoon debugging the wrong layer.

You will finish that document holding:

- a host name and port,
- a database name,
- a login role granted `arpi_reporter`, and its password.

---

## 5. Deploy the semantic model

```bash
git clone https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence.git
cd Automotive-Retail-Performance-Intelligence
git fetch origin claude/arpi-fabric-semantic-validation
git checkout claude/arpi-fabric-semantic-validation
```

Look at what will be sent before sending it. This makes no network call and does not sign
you in:

```bash
python scripts/deploy_powerbi_fabric.py --dry-run
```

Then deploy:

```bash
export ARPI_FABRIC_WORKSPACE_ID=<workspace-guid>
python scripts/deploy_powerbi_fabric.py
```

The script prints a URL and a short code. Open the URL in any browser, enter the code, sign
in, and come back to the terminal.

**This step is the first real test the model has ever faced.** Static parsing cannot tell
you that a `formatString` is well-formed, that a DAX expression compiles, or that a
`sortByColumn` is single-valued per label. If the deploy fails, read the message: it is the
engine telling you about a genuine defect, and the right response is to fix the model, not
to work around the error.

On success it prints the **semantic model item ID**. Keep it:

```bash
export ARPI_FABRIC_ITEM_ID=<item-guid>
```

The script then reads the definition back with `getDefinition?format=TMDL` and compares it
with what was sent. Service-assigned metadata in `.platform` and line-ending differences
are normalised and reported; anything else fails the deploy, because a service that quietly
rewrote a measure would otherwise go unnoticed until a number was wrong.

---

## 6. Create the connection and bind it

Fabric needs its own credential for PostgreSQL. This is the one part that is easier in the
browser than through the API, and it is the only interactive configuration step.

1. In the Fabric portal: **Settings** (gear, top right) → **Manage connections and
   gateways** → **Connections** → **New**.
2. Choose **Cloud**.
3. Fill in:
   - **Connection name** — something like `ARPI reporting (PostgreSQL)`
   - **Connection type** — **PostgreSQL**
   - **Server** — your host, with the port: `host.example.com:5432`
   - **Database** — your database name
   - **Authentication method** — **Basic**
   - **Username** — the login role you granted `arpi_reporter`
   - **Password** — its password
   - **Privacy level** — **Organizational**
   - **Encrypted connection** — **Encrypted**. Your managed provider requires TLS and so
     should you.
4. **Create**, and let the test connection succeed. If it fails, the problem is the
   database or its firewall, not Fabric — go back to
   [`docs/cloud-database-setup.md`](../cloud-database-setup.md) §11.
5. Open the connection and copy its **connection ID** from the URL.

```bash
export ARPI_FABRIC_CONNECTION_ID=<connection-guid>
```

### Set the model's parameters

The model reads `ArpiServer` and `ArpiDatabase` as Power Query parameters, and the
committed defaults point at `localhost`. In the workspace, open the semantic model →
**Settings** → **Parameters**, and set:

| Parameter | Value |
|---|---|
| `ArpiServer` | `host.example.com:5432` |
| `ArpiDatabase` | your database name |

Neither is a secret. Under **Data source credentials**, map the source to the connection
you just created.

### One tenant setting, if you control the tenant

The DAX reconciliation uses the Power BI **Execute Queries** REST API, which is off by
default in some tenants. If you are a Fabric administrator:

**Admin portal** → **Tenant settings** → **Integration settings** →
**Dataset Execute Queries REST API** → **Enabled**.

If you are not an administrator, ask for it, or run the validation with `--skip-refresh`
after refreshing manually — but note that without Execute Queries the DAX side cannot be
read at all, and the gate cannot close. The script fails with
`PowerBINotAuthorizedException` and says so.

---

## 7. Refresh and validate

```bash
python scripts/validate_powerbi_fabric.py --operator '<your-github-handle>'
```

It binds the connection, triggers a full refresh, polls to completion, reads the deployed
model's own inventory through DAX `INFO` functions, counts every table's loaded rows, runs
all twenty-one generated filter-context queries, and compares every value with
`powerbi/validation/sql_baseline.json`.

Expect it to take several minutes: `vw_inventory_snapshots` is 45,754 rows and a trial
capacity is not fast.

`--operator` is optional but please pass it. The gate is a human's attestation, and an
unattributed attestation is worth less than an attributed one. Free text you choose — a
GitHub handle is the usual answer. Do **not** pass an email address, a machine name or a
domain account.

### The comparison that matters most

**Blank versus zero.** Two of the twenty-one contexts exist only to test it:

- `lead-source-LDS-001` is an organic lead source with 786 leads and no cost basis. All
  three marketing KPIs must be **blank**. A model without the `ISBLANK` guard returns `$0`,
  which is a false statement about a channel that simply has no cost.
- `zero-denominator` is a store-day with no retail sale. Every gross-per-unit ratio and
  Show Rate must be **blank**, not `$0`.

The script sets `includeNulls` on every Execute Queries call for exactly this reason.
Without it a correct blank arrives as a missing key, indistinguishable from a measure the
script forgot to ask for — so a missing key is treated as a hard failure rather than
silently as a blank.

**If it fails, do not adjust the numbers.** Report the failure on the pull request with the
contents of `powerbi/validation/fabric_validation_results.json`. A difference is a defect
in the model or in the baseline, and it needs diagnosing.

---

## 8. Commit the evidence

```bash
git add powerbi/validation/fabric_validation_results.json
git commit -m "Record Microsoft Fabric validation of the ARPI semantic model"
git push origin claude/arpi-fabric-semantic-validation
```

Check first that nothing else crept in:

```bash
git status --short
```

You should see only the evidence file. You should **not** see a token cache — it lives in
`~/.arpi/`, outside the repository, precisely so that `git add -A` cannot capture it.

CI then re-runs `scripts/check_fabric_validation_freshness.py`, which recomputes the model
source hash and compares it with the one recorded in the evidence. If they match and the
result is `passed`, the gate is closed and Lifecycle Phase 5 can be marked complete.

If you edit the TMDL afterwards, that hash stops matching and CI reports the evidence as
**stale** rather than as passed. That is intended: evidence for a model that no longer
exists is not evidence.

---

## 9. Cost and teardown

| Resource | While you need it | When you are finished |
|---|---|---|
| Fabric trial capacity | Free for 60 days | Let it lapse, or cancel it in the account manager |
| Fabric workspace | Free | Delete it, or keep it — an idle workspace costs nothing |
| Managed PostgreSQL | Free tier | See [`docs/cloud-database-setup.md`](../cloud-database-setup.md) §10 |
| Semantic model | Free | Deleting the workspace deletes it |

The evidence file stays in the repository after the resources are gone. That is the point:
the artefact of this exercise is the recorded proof, not the running service.

---

## 10. If something goes wrong

| Symptom | Cause and fix |
|---|---|
| `UnsupportedCapacitySKU` | The workspace is Pro-only. Assign a Fabric or trial capacity (§3 step 4). |
| `CapacityNotActive` | The trial capacity is paused. Resume it in workspace settings. |
| `InsufficientPrivileges` | The signed-in identity is not a Contributor or Admin on the workspace. |
| `WorkspaceNotFound` | Wrong GUID — it is the one after `/groups/` in the workspace URL. |
| `ItemDisplayNameAlreadyInUse` | The model already exists. Pass `--item-id` to update it instead. |
| `InvalidRequest` on deploy | Most likely a TMDL file the engine will not parse. Read the message; this is the defect class the whole exercise exists to catch. |
| `PowerBINotAuthorizedException` | Execute Queries is disabled in the tenant, or the identity lacks Build permission on the model (§6). |
| Refresh fails with a credential error | The connection is not bound, or its credentials are wrong. Re-check §6. |
| Refresh fails with a timeout | The database is unreachable from Fabric. Check the provider's network settings allow connections from outside. |
| A table refreshes to zero rows | The cloud database is not fully loaded. Re-run `scripts/verify_cloud_database.py`. |
| Row counts differ from expected | A profile other than `development`, or a different seed. The baseline is valid only against `development` at seed 20250701. |
| Many differences, all in one context | Check that context's filters first: a wrong store or month code produces exactly this pattern. |
| A single blank-versus-zero difference | A real defect. Report it; do not work around it. |
| Device-code sign-in times out | Run the command again. The code expires in about fifteen minutes. |

---

## 11. What this does not authorise

Closing this gate completes `P2.1` and Lifecycle Phase 5. It does **not** start `P2.2`.
Do not add a report, a page or a visual in the Fabric portal while you are there, however
tempting it is with a working model in front of you. Report design is a separate increment
with its own acceptance criteria, and mixing it in would make both unreviewable —
`scripts/check_powerbi_model.py` fails the build if report content appears in the
repository.
