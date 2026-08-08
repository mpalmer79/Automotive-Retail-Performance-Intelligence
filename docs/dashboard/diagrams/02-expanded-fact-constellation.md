# Dashboard Diagram 02 — Expanded fact constellation

The warehouse star after the program's promotions. Solid nodes exist today; dashed-context nodes are
promoted by the named increments. Grains are the binding declarations from
[`DASHBOARD_PROGRAM.md §9`](../../requirements/DASHBOARD_PROGRAM.md).

```mermaid
erDiagram
    dim_date ||--o{ fact_vehicle_sale : "sale/delivery date"
    dim_dealership ||--o{ fact_vehicle_sale : ""
    dim_vehicle ||--o{ fact_vehicle_sale : ""
    dim_customer ||--o{ fact_vehicle_sale : "nullable (wholesale)"
    dim_employee ||--o{ fact_vehicle_sale : "salesperson / desk / F&I"
    dim_lead_source ||--o{ fact_vehicle_sale : ""
    dim_lender ||--o{ fact_vehicle_sale : "DASH.6 (nullable)"

    fact_vehicle_sale ||--o{ fact_finance_product_sale : "DASH.6: one row per product sold"
    dim_finance_product ||--o{ fact_finance_product_sale : "DASH.6"
    dim_employee ||--o{ fact_finance_product_sale : "finance manager"
    fact_finance_product_sale ||--o{ fact_finance_product_adjustment : "DASH.6: one row per adjustment event"

    dim_date ||--o{ fact_sales_target : "DASH.5 (built): target month"
    dim_dealership ||--o{ fact_sales_target : "DASH.5 (built)"
    dim_employee ||--o{ fact_sales_target : "DASH.5 (built): Employee scope, nullable, unpopulated"

    dim_date ||--o{ fact_vehicle_inventory_snapshot : "daily"
    dim_dealership ||--o{ fact_vehicle_inventory_snapshot : ""
    dim_vehicle ||--o{ fact_vehicle_inventory_snapshot : ""

    dim_date ||--o{ fact_inventory_accounting_snapshot : "DASH.8: accounting snapshot date"
    dim_vehicle ||--o{ fact_inventory_accounting_snapshot : "DASH.8"
    dim_gl_account ||--o{ fact_gl_control_balance : "DASH.8"
    dim_date ||--o{ fact_gl_control_balance : "DASH.8: balance date"
    dim_dealership ||--o{ fact_gl_control_balance : "DASH.8"

    dim_date ||--o{ fact_lead : "created date"
    dim_lead_source ||--o{ fact_lead : ""
    fact_lead ||--o{ fact_appointment : ""
    dim_date ||--o{ fact_marketing_spend : "month"
```

**Grain register (new entities).** `fact_sales_target` — **built by `DASH.5`**; grain as built is
dealership × target month × targeted KPI × target scope (scope type + scope id), one column wider than
the "optional scope" this diagram planned, because a nullable scope column cannot enforce a grain in
PostgreSQL. The `dim_employee` edge exists physically and carries no row: `DASH.5` generates no
employee-scope target.
`fact_finance_product_sale`: one row per finance product sold on a finalized transaction.
`fact_finance_product_adjustment`: one row per cancellation/chargeback/reinstatement/adjustment
event. `fact_inventory_accounting_snapshot`: vehicle × dealership × accounting snapshot date while
carried. `fact_gl_control_balance`: dealership × GL control account × balance date. The optional
`fact_trade_in` (`DASH.O-1`) is deliberately absent from this diagram until scheduled.
