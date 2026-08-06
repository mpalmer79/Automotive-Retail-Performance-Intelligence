# Dashboard Diagram 04 — Route and drill-through flow

The console's navigation surface: one public-header entry, an internal nav, and the drill-through
paths that keep every aggregate one link away from its detail.

```mermaid
flowchart LR
    HEADER["Public header<br/>+ one item: Dashboard"] --> CC["/dashboard<br/>Command center"]

    subgraph nav["DashboardNav (internal)"]
        CC --- SG["/dashboard/sales-gross"]
        CC --- DE["/dashboard/deals"]
        CC --- INV["/dashboard/inventory"]
        CC --- FI["/dashboard/fi"]
        CC --- LM["/dashboard/leads-marketing"]
        CC --- EMP["/dashboard/employees"]
        CC --- ACC["/dashboard/accounting"]
        CC --- ACT["/dashboard/actions"]
    end

    CC -- "KPI card drill-through<br/>(carries period/store filters)" --> SG
    CC -- "scoreboard row → store filter" --> SG
    CC -- "funnel summary" --> LM
    CC -- "inventory risk" --> INV
    CC -- "top actions" --> ACT

    SG -- "deal table row" --> DJ["/dashboard/deals/[saleId]<br/>Deal Jacket"]
    DE -- "index row" --> DJ
    FI -- "manager row → manager filter" --> FI
    FI -- "deal-product detail" --> DJ
    INV -- "unit row → unit detail panel" --> INV
    ACC -- "deal exception" --> DJ
    ACC -- "stock exception" --> INV
    ACT -- "rule drill-through target" --> DJ
    ACT --> INV
    ACT --> FI
    ACT --> LM
    EMP -- "deal drill-through" --> DE
    DJ -- "lineage drawer → KPI ids" --> KPIS["/kpis catalogue"]
```

**Rules.** Every drill-through is a plain link with filter state in the URL, so back/forward and
copied links reproduce views. The Deal Jacket is reachable from five surfaces and always renders the
same record for the same `saleId` regardless of entry path.
