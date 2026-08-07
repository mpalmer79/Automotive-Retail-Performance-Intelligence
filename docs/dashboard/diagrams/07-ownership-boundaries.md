# Dashboard Diagram 07 — SQL, Power BI, and web ownership boundaries

Who owns which calculation, per [ADR-0013](../../architecture-decisions/ADR-0013-governed-web-operating-console.md).
One arithmetic authority, two presentation products, no shared blur.

```mermaid
flowchart TB
    subgraph SQL["PostgreSQL reporting schema — calculation authority"]
        S1["KPI arithmetic (all families)"]
        S2["Eligibility joins (ELIG-*)"]
        S3["Reconciliation identities"]
        S4["Bridge decompositions"]
    end

    subgraph PBI["Power BI — canonical analytical product"]
        P1["Semantic model relationships"]
        P2["Governed DAX (measure groups)"]
        P3["Real-engine validation (ADR-0008, pending)"]
        P4["Formal report pages (P2.2, not started)"]
        P5["Gate 2 evidence"]
    end

    subgraph WEB["Web console — public interactive demonstration"]
        W1["Rendering, layout, formatting"]
        W2["URL filter state"]
        W3["Chunk loading and pagination"]
        W4["Template narratives (from exported components)"]
        W5["Trust panel (renders states, never creates them)"]
    end

    SQL -->|"import (20+ tables)"| PBI
    SQL -->|"versioned exports via arpi_reporter"| WEB

    KPIC["KPI_CATALOG.md + KPI_EXTENSION_PLAN.md<br/>one governed definition per KPI"] --> SQL
    KPIC --> PBI
    KPIC --> WEB

    WEB -. "never" .-> X1["Redefine a formula"]
    WEB -. "never" .-> X2["Query raw/staging/warehouse/audit"]
    WEB -. "never" .-> X3["Validate Power BI or close Gate 2"]
    PBI -. "unchanged by this program" .-> P3
```

**Drift control.** The same KPI id resolves to one formula in the catalogue; SQL computes it; the
export carries it with reconciliation totals; the web renders it; the future DAX measure is
reconciled against the same SQL baseline. A number that cannot complete that chain does not ship.
