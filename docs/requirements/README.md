# Requirements — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Last reviewed:** 2026-07-28
**Parent documents:** [ARCHITECTURE.md](../../ARCHITECTURE.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [LIMITATIONS.md](../../LIMITATIONS.md)

---

## 1. Purpose

This directory holds ARPI's forward-looking work: what will be built, in what order, and what "done" means
for each item. It is deliberately separate from the descriptive documents — [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md)
and [KPI_CATALOG.md](../../KPI_CATALOG.md) describe the *model*, while these documents describe the *work*.

`docs/research.md` §8.3 lists what documented requirements should include: stakeholder questions, KPI
definitions, report-refresh expectations, data-quality requirements, security assumptions, known
limitations, acceptance criteria, and explicit non-goals. Those are distributed across the repository;
this directory owns **acceptance criteria and sequencing**.

---

## 2. Index

| Document | Purpose |
|---|---|
| [PHASE_1_BACKLOG.md](PHASE_1_BACKLOG.md) | The Phase 1 work backlog, organised into sub-phases 1.1 through 1.5, with acceptance criteria, tests, and dependencies for every item. |
| [DOCUMENTATION_BACKLOG.md](DOCUMENTATION_BACKLOG.md) | An honest register of documentation gaps identified during Phase 0, with proposed resolutions and priorities. |

---

## 3. How requirements are tracked

### 3.1 Identifier scheme

```
P<major>.<minor>-<NN>
```

For example `P1.3-02` is the second item in Phase 1.3. Identifiers are **permanent**: a cancelled item
keeps its ID and is marked `Out of scope`, and numbers are never reused. This matters because commits,
tests, and pull requests reference them.

### 3.2 What every backlog item must carry

| Field | Rule |
|---|---|
| **ID** | Permanent, in the scheme above. |
| **Purpose** | Why the item exists, in business or architectural terms — not a restatement of the title. |
| **Dependencies** | Other item IDs, or `None`. An item cannot start before its dependencies are Done. |
| **Acceptance criteria** | A checkbox list. Each criterion must be **specific and testable** — someone other than the author must be able to verify it without asking a question. |
| **Tests required** | Named test files or test kinds. "Tested" is not an acceptance criterion; a named test is. |
| **Architecture references** | Section numbers in [ARCHITECTURE.md](../../ARCHITECTURE.md). An item with no architectural basis fails Gate 4. |
| **Estimated complexity** | Exactly one of `Small`, `Medium`, `Large`. |
| **Blocks Power BI Gate 1** | `Yes` or `No`. |

### 3.3 No time estimates

> **ARPI records complexity, never duration.** No backlog item states hours, days, weeks, or sprints.

Complexity bands mean:

| Band | Meaning |
|---|---|
| **Small** | One well-understood change in one area. No new architectural decision. |
| **Medium** | Several related changes, or one change spanning generation, SQL, and tests. Some design judgement required. |
| **Large** | A new domain, a new fact table, or a change that touches generation, ingestion, warehouse, validation, and reporting together. Usually carries a design decision that should be settled before work starts. |

### 3.4 Status vocabulary

The same four values used everywhere in ARPI: **Implemented**, **Planned**, **Deferred**,
**Out of scope**. A backlog item that is in progress is still `Planned` — ARPI does not claim partial
implementation, because a half-built table is indistinguishable from an absent one to a reviewer.

### 3.5 Scope gates

Work is gated by [ARCHITECTURE.md §28](../../ARCHITECTURE.md):

| Gate | Condition |
|---|---|
| **Gate 1** | No Power BI development begins until fact grains are approved, dimensions are documented, and KPI formulas are documented. |
| **Gate 2** | No web case study begins until core Power BI pages are complete, SQL and Power BI totals reconcile, and executive findings are drafted. |
| **Gate 3** | No API, AI, forecasting, or anomaly feature begins until the strong portfolio version is complete, the feature answers a documented business question, and it adds hiring evidence not already demonstrated. |
| **Gate 4** | No new data domain is added unless a stakeholder question requires it, the fact grain is defined, KPI ownership is defined, and testing requirements are defined. |

Gate 1 readiness is tracked at the top of [PHASE_1_BACKLOG.md](PHASE_1_BACKLOG.md).

### 3.6 Relationship to the architecture's phase numbering

[ARCHITECTURE.md §27](../../ARCHITECTURE.md) numbers eight *lifecycle* phases: Product Definition, Data
Model, Synthetic Data Generator, PostgreSQL Warehouse, Power BI Semantic Model, Dashboard Development,
Findings and Recommendations, and Portfolio Packaging.

The **Phase 0 / Phase 1.x** numbering used in this directory is a *delivery* numbering, not a replacement:

| Delivery phase | Corresponds to |
|---|---|
| **Phase 0** | A vertical slice through architecture Phases 2, 3, and 4 — data model, generator, and warehouse — for two dimensions only. |
| **Phase 1.1 – 1.5** | Completion of architecture Phases 3 and 4 for the MVP domains. |
| **After Gate 1** | Architecture Phases 5 and 6 — semantic model and dashboards. |

Both numbering schemes are in use, and neither is being retired. Where a document says "Phase 1.3" it means
delivery phase 1.3; where it says "Phase 4" it means the architecture's lifecycle phase. This is a known
documentation hazard and is registered in [DOCUMENTATION_BACKLOG.md](DOCUMENTATION_BACKLOG.md).

### 3.7 Build order

[ARCHITECTURE.md §34](../../ARCHITECTURE.md) declares the initial build order **binding unless revised
through an architecture decision record**. Phase 1.1 through 1.5 follow it: vehicle and employee dimensions
(step 6), inventory and sales source data (step 7), inventory and sales facts (step 8), sales and inventory
KPI validation (step 9), leads and appointments (steps 10 and 11), reporting views (step 12), then the
semantic model (step 13).
