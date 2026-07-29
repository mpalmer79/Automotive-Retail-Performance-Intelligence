# `powerbi/measures/` — where the DAX actually lives

**Last reviewed:** 2026-07-29
**Parent:** [`powerbi/model_documentation/README.md`](../model_documentation/README.md)

---

## 1. This directory holds no DAX, and that is the decision

Before the semantic model existed, this directory was reserved for DAX measure definitions
kept as reviewable text — the plan being that a binary `.pbix` would hide the measures, so
a readable copy would live here.

That reasoning does not survive the format the model was actually built in. ADR-0007
selected **PBIP with the semantic model stored as TMDL**, and TMDL *is* reviewable text.
Every measure is already a diffable, commented, source-controlled definition at:

```
powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel/definition/tables/
    Sales Measures.tmdl
    Gross Measures.tmdl
    Inventory Measures.tmdl
    Lead Funnel Measures.tmdl
    Marketing Measures.tmdl
    Data Quality Measures.tmdl
```

Copying those forty-nine measures into `.dax` files here would create a **second copy of
every measure**, and a second copy is a second answer waiting to happen. The copy would be
the one a reviewer read and the TMDL would be the one Power BI executed, and the first time
someone edited a measure in Desktop and did not remember to update the mirror, this
directory would be quietly lying. There is no mechanism that would catch it, because the
mirror is not executable and nothing can test it.

**One definition, in the file the engine reads.** That is the rule this directory now
records.

## 2. What is here instead

Nothing but this file. The directory is kept because `ARCHITECTURE.md` §24 names it and
because removing a documented path is a bigger change than explaining it.

## 3. Where to look for what

| You want | Read |
|---|---|
| A measure's DAX | The measure tables under `.SemanticModel/definition/tables/` |
| Which KPI a measure implements | The `ARPI_KpiId` annotation on the measure, or [`../model_documentation/03-measure-groups.md`](../model_documentation/03-measure-groups.md) |
| A measure's format string | The `formatString` property, or [`../model_documentation/06-format-strings.md`](../model_documentation/06-format-strings.md) |
| The governed definition behind a KPI | [`../../KPI_CATALOG.md`](../../KPI_CATALOG.md) — the SQL side is the owner |
| The DAX used to *validate* the measures | [`../validation/validation_queries.dax`](../validation/validation_queries.dax) — generated, not hand-written |

## 4. If a future increment does need `.dax` files here

Generate them from the TMDL and have CI assert they are in sync, or do not create them.
An ungoverned copy is worse than no copy.
