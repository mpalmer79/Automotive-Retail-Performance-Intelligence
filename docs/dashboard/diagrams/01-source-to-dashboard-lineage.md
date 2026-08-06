# Dashboard Diagram 01 — Source-to-dashboard lineage

Where every number on the ARPI Dealer Operations Command Center comes from, and the boundaries it
crosses. Planned components are marked; nothing right of the `reporting` schema exists yet.

```mermaid
flowchart LR
    subgraph gen["Python generation (implemented + planned entities)"]
        G["Seeded generators<br/>Decimal money, namespace seeds"]
    end

    subgraph db["PostgreSQL"]
        RAW["raw"] --> STG["staging"] --> WH["warehouse<br/>dims + facts, grain-constrained"]
        WH --> REP["reporting<br/>views own all KPI arithmetic"]
        AUD["audit<br/>runs · validations · reconciliations"]
        WH -.-> AUD
    end

    G --> RAW

    subgraph consumers["Consumers"]
        PBI["Power BI semantic model<br/>canonical · TMDL · validation pending"]
        EXP["scripts/export_dashboard_dataset.py<br/>arpi_reporter · allowlist · manifest (planned)"]
    end

    REP --> PBI
    REP --> EXP
    EXP --> DATA["data/dashboard/<br/>versioned, committed exports (planned)"]
    DATA --> TS["portfolio/scripts/generate-dashboard-data.ts<br/>validate · transform · chunk (planned)"]
    TS --> GENJSON["portfolio/src/generated/dashboard/ (planned)"]
    GENJSON --> ROUTES["/dashboard routes<br/>server components + client islands (planned)"]

    classDef implemented fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef planned fill:#fef9c3,stroke:#a16207,color:#713f12
    class G,RAW,STG,WH,REP,AUD implemented
    class PBI implemented
    class EXP,DATA,TS,GENJSON,ROUTES planned
```

**Boundary notes.** The browser never crosses into the database: the only runtime data source for a
dashboard route is a build-packaged JSON artifact. `arpi_reporter` is the exporter's identity and can
read exactly the `reporting` schema. The audit schema informs the manifest (reconciliation status)
through `reporting.vw_reconciliation_status`, never directly.
