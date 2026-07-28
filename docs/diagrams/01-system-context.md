# ARPI — System Context

**Automotive Retail Performance Intelligence (ARPI)** in one view: where data comes from, what the
platform does to it, and who consumes the result.

This is the widest view of the system. It shows every component the project will eventually have, with
implemented and planned components visually distinguished so the diagram never overstates what exists.

---

## Diagram

```mermaid
flowchart TB
    subgraph inputs["Inputs"]
        CFG["Configuration profile<br/>development · test · portfolio<br/>seed, date range, scale"]
        RULES["Synthetic business rules<br/>distributions and correlations"]
        VPIC["Approved public vehicle data<br/>NHTSA vPIC (planned)"]
        MKT["Public market context<br/>aggregate only (planned)"]
    end

    subgraph platform["ARPI platform"]
        GEN["Python generator<br/>seeded and deterministic"]
        VALID["Validation framework<br/>12 Phase 0 checks"]
        FILES["CSV output + generation manifest<br/>SHA-256 content digests"]
        LOADER["PostgreSQL loader<br/>optional, psycopg 3"]
        CLI["arpi CLI<br/>check-config · generate · run-foundation"]
    end

    subgraph db["PostgreSQL database"]
        RAW["raw<br/>text landing tables"]
        STG["staging<br/>typed views"]
        WH["warehouse<br/>dim_date · dim_dealership"]
        WHF["warehouse facts<br/>sales · inventory · leads (planned)"]
        REP["reporting<br/>4 Phase 0 views"]
        REPF["reporting<br/>domain views (planned)"]
        AUDIT["audit<br/>runs · validations · reconciliations · rejects"]
    end

    subgraph consumers["Consumers"]
        PBI["Power BI semantic model (planned)"]
        RPTS["Power BI report pages (planned)"]
        XL["Excel operating report (planned)"]
        MEMO["Executive findings memo (planned)"]
        CASE["Static portfolio case study (planned)"]
    end

    CFG --> CLI
    CLI --> GEN
    RULES --> GEN
    VPIC -.-> GEN
    MKT -.-> GEN

    GEN --> VALID
    VALID --> FILES
    FILES --> LOADER
    LOADER --> RAW
    RAW --> STG
    STG --> WH
    WH --> REP
    WH -.-> WHF
    WHF -.-> REPF

    VALID --> AUDIT
    LOADER --> AUDIT
    CLI --> AUDIT

    REP -.-> PBI
    REPF -.-> PBI
    PBI -.-> RPTS
    REP -.-> XL
    RPTS -.-> MEMO
    RPTS -.-> CASE
    MEMO -.-> CASE

    classDef implemented fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0b1b3a
    classDef planned fill:#f4f4f5,stroke:#a1a1aa,stroke-width:1px,color:#3f3f46,stroke-dasharray: 5 3
    classDef store fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#052e16

    class CFG,RULES,GEN,VALID,FILES,LOADER,CLI implemented
    class RAW,STG,WH,REP,AUDIT store
    class VPIC,MKT,WHF,REPF,PBI,RPTS,XL,MEMO,CASE planned
```

---

## Legend

| Appearance | Meaning |
|---|---|
| **Blue, solid border** | Implemented process or artifact — exists and runs today |
| **Green, solid border** | Implemented database object — schema exists with content |
| **Grey, dashed border, label marked `(planned)`** | Planned — does not exist yet |
| **Solid arrow** | Data flow that runs today |
| **Dashed arrow** | Planned data flow |

Every node whose label ends in `(planned)` is drawn grey and dashed, and every edge touching one is
dashed. The two encodings agree, so the diagram is readable without colour.

---

## What the diagram says

**The platform runs without a database.** Configuration, generation, validation, and the CSV plus manifest
output are a complete, useful path on their own. The PostgreSQL loader is optional and disabled by default
(`database.enabled: false`). A reviewer can produce and validate the full dataset with no database, no
credentials, and no accounts.

**Validation happens before the load, not after it.** The validation framework runs against in-memory
frames. Bad data never reaches `raw`, and the CLI exits non-zero on a critical failure rather than loading
and reporting afterwards.

**The audit schema is written from three places.** The CLI opens and closes the pipeline run, the
validation framework records check outcomes, and the loader records row counts per layer. Audit is not a
log file — it is queryable history in the database.

**Power BI never touches `raw`, `staging`, or `warehouse`.** The only sanctioned consumption surface is the
`reporting` schema, and the `arpi_reporter` role has read access to nothing else. That constraint is
enforced in `sql/07_security/`, not merely stated here.

**The right-hand column is entirely planned.** No semantic model, no report page, no workbook, no memo, and
no case study exists. Four reporting views exist today — calendar, dealership, pipeline run summary, and
data quality summary — and nothing consumes them yet.

---

## Related

- [`02-phase-0-data-flow.md`](02-phase-0-data-flow.md) — the implemented path in detail, with exit codes
- [`03-initial-dimensional-model.md`](03-initial-dimensional-model.md) — the warehouse and audit objects
- [`04-repository-component-map.md`](04-repository-component-map.md) — which directory owns which artifact
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §§9–11 — layer responsibilities and the dimensional model

*All data is synthetic. Granite State Auto Group is fictional.*
