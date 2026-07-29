# Power Query Parameters and the Credential Boundary — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

The model's two parameters, the M expression every partition uses, and where the boundary that actually
protects the non-`reporting` schemas sits — which is not in this file, and not in the model at all.

The parameters are declared in
`ARPI_Performance_Intelligence.SemanticModel/definition/expressions.tmdl`. That file is nineteen lines long
and contains nothing but the two parameters and their descriptions.

---

## 1. The two parameters

| Parameter | Type | Required | Committed default | What it must be set to |
|---|---|---|---|---|
| `ArpiServer` | Text | Yes | `localhost:5432` | The PostgreSQL host, optionally with a port. `localhost:5432` for a local instance; `hostname:port` otherwise. |
| `ArpiDatabase` | Text | Yes | `arpi_dev` | The database name holding the ARPI `reporting` schema. `arpi_dev` for the `development` profile. |

```
expression ArpiServer = "localhost:5432" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
expression ArpiDatabase = "arpi_dev" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
```

**Both values are non-secret**, and both are committed to source deliberately. `localhost` is not an address
anyone can reach, and `arpi_dev` is not a credential. Committing them means the project opens with working
defaults on a developer machine and a reviewer can see exactly what the model connects to — which is the
point of parameterising rather than the cost of it.

**These two are the only parameters in the model.** Nothing else in the model identifies an environment: no
hostname, no IP address, no port, no database name appears in any table file. A change of environment is two
values in *Transform data → Manage parameters* and nothing else.

---

## 2. The M shape every partition uses

All twenty imported tables use the same four-line M expression, differing only in the view name.

```m
let
    Source = PostgreSQL.Database(ArpiServer, ArpiDatabase),
    Data = Source{[Schema = "reporting", Item = "vw_calendar"]}[Data]
in
    Data
```

Four properties of that shape are load-bearing.

* **The server and database come from the parameters, never from a literal.** Every partition's first line
  is `PostgreSQL.Database(ArpiServer, ArpiDatabase)`, identically. Grepping the twenty table files for a
  hostname finds nothing, which is what makes `scripts/check_secrets.py` able to enforce a rule rather than
  guess at one.
* **The schema is `reporting`, hardcoded, in all twenty.** `Schema = "reporting"` is a literal on purpose: it
  is not something an environment should vary. A text check over the TMDL for `raw`, `staging`, `warehouse`
  or `audit` finds no match, and that check is meaningful precisely because the schema is a literal.
* **No query folding is defeated.** The expression selects a view and returns it. There is no filter, no
  transformation, no added column and no type change in Power Query, so the whole query folds to a single
  `SELECT * FROM reporting.vw_x` against the database.
* **There is no navigation by index.** `Source{[Schema=..., Item=...]}` selects by name. Positional
  navigation breaks silently when the source adds an object.

The six measure tables use a different shape and touch the database not at all:

```
partition 'Sales Measures' = calculated
    mode: import
    source = ROW("Placeholder", "")
```

**Storage mode is Import for every table.** No table is DirectQuery or Dual, and there is no incremental
refresh policy: the model imports in full. The volumes do not justify partitioning, and an incremental
policy that has never refreshed would be a claim rather than a feature.

---

## 3. What is stored where

This is the whole of it, stated as three lists.

### 3.1 In source control — nothing secret

| Stored in the repository | Sensitive? |
|---|---|
| `ArpiServer` default, `localhost:5432` | No. A loopback address. |
| `ArpiDatabase` default, `arpi_dev` | No. A database name. |
| `Schema = "reporting"` in twenty partitions | No. |
| The name of the connecting role, `arpi_reporter`, in descriptions and documentation | No. A username without a password is not a credential, and naming it is what makes the privilege boundary reviewable. |

**No credential of any kind appears anywhere under `powerbi/`:** no password, no token, no connection string
with embedded authentication, no `.pq` credential cache, no OAuth artefact. `scripts/check_secrets.py` runs
over the directory in CI, and the parameterisation is what makes that check enforceable — with a hardcoded
connection there would be a legitimate-looking hostname in source and the check could not distinguish it from
a leak.

### 3.2 In the Power BI credential store — the identity and its password

The connecting identity is **`arpi_reporter`**, and its password is supplied at the Power BI Desktop
credential prompt on first connection. Desktop stores it in the operating system's credential store on the
machine that refreshes the model, keyed by data source. It is never written into the project, never
committed, and never travels with the PBIP folder.

A person who clones this repository gets a model that cannot connect until they supply that credential
themselves. That is the intended behaviour.

For a future Power BI Service deployment the same credential would be registered against the workspace data
source rather than the desktop store. That deployment does not exist and requires its own ADR; see
[README.md §4](README.md).

### 3.3 In the database — the privilege boundary itself

**This is the part that actually protects anything.**

`arpi_reporter` holds `SELECT` on the `reporting` schema and **no privilege at all** on `raw`, `staging`,
`warehouse` or `audit`. If the model's M expressions were rewritten tomorrow to name `warehouse.fact_sale`,
the refresh would fail with a permission error. The model does not *choose* to read only `reporting`; it is
*unable* to read anything else.

That distinction is the whole design. Two mechanisms are frequently confused here:

| Mechanism | What it is | What it prevents |
|---|---|---|
| `Schema = "reporting"` in the M | A **statement of intent**, checkable by reading the file | An accidental reference to another schema being committed unnoticed |
| `arpi_reporter`'s grants | A **capability boundary**, enforced by PostgreSQL | Any read of another schema, however it was requested |

Only the second is a control. The first is documentation that happens to be executable, and treating it as
protection would be exactly the kind of claim this project's validation discipline exists to prevent. The
boundary is asserted independently of the model by
`tests/integration/test_reporter_role_end_to_end.py`, which connects as the role and confirms both what it
can read and what it cannot.

[ARCHITECTURE.md §22.2](../../ARCHITECTURE.md) is the requirement that Power BI must not access raw tables;
§22.3 defines the role. The model satisfies §22.2 by being unable to violate it.

---

## 4. Setting the parameters for a refresh

The values a Windows operator performing the Desktop validation in
[08-desktop-validation.md](08-desktop-validation.md) needs.

| Step | Value |
|---|---|
| 1. Open the project | `powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.pbip`, with the PBIP, TMDL and PBIR preview features enabled in Desktop |
| 2. `ArpiServer` | The host running the ARPI PostgreSQL instance, with port. `localhost:5432` if it is the same machine. |
| 3. `ArpiDatabase` | The database holding the `reporting` schema for the profile being refreshed — `arpi_dev` for `development`. |
| 4. Credentials | Database authentication, user `arpi_reporter`, password supplied at the prompt. **Not** Windows authentication. |
| 5. Privacy level | Organizational or Private. The source is a single database; no cross-source folding question arises. |

The full procedure, including what to do when a step fails, is `docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md`.

**If the parameter defaults are changed for a local run, the change is not committed.** They are the
committed default for a reason, and a commit that points the model at a personal machine is a commit that
points it at a machine nobody else has.

---

## 5. What has not been checked

**No connection has ever been made.** Power BI Desktop has never opened this project, so:

* the M expressions have never been executed and may fail on a syntax or a type the reader does not accept;
* `PostgreSQL.Database` requires the Npgsql provider on the client machine, and whether the operator's
  Desktop installation has it is unknown;
* whether all twenty views resolve by the names given, at the privilege level `arpi_reporter` holds, has been
  asserted in SQL by `tests/integration/test_reporter_role_end_to_end.py` but not through the Power BI
  connector;
* no data type inferred by the connector has been compared against the `dataType` declared in the TMDL. A
  PostgreSQL `numeric` arriving as something other than `decimal` would be discovered at first refresh.

See [08-desktop-validation.md](08-desktop-validation.md). Its status is **PENDING**.
