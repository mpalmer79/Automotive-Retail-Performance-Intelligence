# Reporting View to KPI Map — ARPI

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

The two-way map between the twenty-eight views in the `reporting` schema and the twenty-nine KPI
identifiers in [KPI_CATALOG.md](../../KPI_CATALOG.md), extended to record which **model measure** now owns
each KPI's DAX side.

Both directions matter. A KPI with no view is not computable and blocks Gate 1. A view that owns no KPI is
not automatically wrong — several exist to make a measure *readable* rather than to compute one — but an
undeclared one is a maintenance liability, so every such view is listed with its reason.

The view-to-KPI mapping is held machine-readably in `arpi.constants.KPI_VIEW_OWNERSHIP` and asserted by
`tests/integration/test_kpi_verification.py` and `tests/integration/test_gate1_readiness.py`, so this
document and the code cannot silently disagree. The measure column is held in the TMDL as an `ARPI_KpiId`
annotation on each measure, so the same is true of the DAX side.

---

## 1. KPI → reporting view → model measure

**Governed owner** is the view named in `KPI_CATALOG.md`'s *SQL ownership* field: the object a SQL or Excel
consumer reads, and the left-hand side of the KPI's reconciliation. **Semantic-model source** is the
row-grain view the model binds to instead, because a ratio or an order statistic recomputes under any filter
context there and cannot in an aggregate. **Model measure** is the DAX measure that owns the KPI in the
built model, defined in [03-measure-groups.md](03-measure-groups.md).

Every measure named below exists in the TMDL and carries the KPI identifier as an annotation. **None has
been evaluated**; see [08-desktop-validation.md](08-desktop-validation.md).

| KPI | Name | Governed owner | Semantic-model source | Model measure | Group |
|---|---|---|---|---|---|
| `KPI-SLS-001` | Retail units sold | `vw_sales_summary` | `vw_vehicle_sales` | Retail Units Sold | Sales |
| `KPI-SLS-002` | New units sold | `vw_sales_summary` | `vw_vehicle_sales` | New Units Sold | Sales |
| `KPI-SLS-003` | Used units sold | `vw_sales_summary` | `vw_vehicle_sales` | Used Units Sold | Sales |
| `KPI-GRS-001` | Front-end gross | `vw_gross_summary` | `vw_vehicle_sales` | Front-End Gross | Gross |
| `KPI-GRS-002` | Back-end gross | `vw_gross_summary` | `vw_vehicle_sales` | Back-End Gross | Gross |
| `KPI-GRS-003` | Total gross | `vw_gross_summary` | `vw_vehicle_sales` | Total Gross | Gross |
| `KPI-GRS-004` | Front gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` | Front Gross per Retail Unit | Gross |
| `KPI-GRS-005` | Back gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` | Back Gross per Retail Unit | Gross |
| `KPI-GRS-006` | Total gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` | Total Gross per Retail Unit | Gross |
| `KPI-INV-001` | Active inventory count | `vw_inventory_health` | `vw_inventory_snapshots` | Active Inventory Count | Inventory |
| `KPI-INV-002` | Inventory investment | `vw_inventory_health` | `vw_inventory_snapshots` | Inventory Investment | Inventory |
| `KPI-INV-003` | Average inventory age | `vw_inventory_health` | `vw_inventory_snapshots` | Average Inventory Age | Inventory |
| `KPI-INV-004` | Median inventory age | `vw_inventory_health`, `vw_inventory_aging` | `vw_inventory_snapshots` (row-level `days_in_stock`) | Median Inventory Age | Inventory |
| `KPI-INV-005` | Aged inventory count | `vw_inventory_health` | `vw_inventory_snapshots` | Aged Inventory Count | Inventory |
| `KPI-INV-006` | Aged inventory percentage | `vw_inventory_health` | `vw_inventory_snapshots` | Aged Inventory Percentage | Inventory |
| `KPI-INV-007` | Days to sale | `vw_days_to_sale`, `vw_sales_summary` | `vw_vehicle_sales` (row-level `retail_days_in_inventory`) | Days to Sale (Median), with Days to Sale (Mean) beside it | Inventory |
| `KPI-INV-008` | Inventory turn | `vw_inventory_turn` | `vw_inventory_turn` (imported) | Inventory Turn | Inventory |
| `KPI-INV-009` | Dealer days supply | `vw_days_supply` | `vw_days_supply` (imported) | Dealer Days Supply | Inventory |
| `KPI-FUN-001` | Leads received | `vw_lead_funnel` | `vw_leads` | Leads Received | Lead Funnel |
| `KPI-FUN-002` | Contact rate | `vw_lead_funnel` | `vw_leads` | Contact Rate | Lead Funnel |
| `KPI-FUN-003` | Appointment-set rate | `vw_lead_funnel` | `vw_leads` | Appointment-Set Rate | Lead Funnel |
| `KPI-FUN-004` | Show rate | `vw_appointment_funnel` | `vw_appointments` | Show Rate | Lead Funnel |
| `KPI-FUN-005` | Show-to-sale conversion | `vw_appointment_funnel` | `vw_appointments` | Show-to-Sale Conversion | Lead Funnel |
| `KPI-FUN-006` | Lead-to-sale conversion | `vw_lead_funnel` | `vw_leads` | Lead-to-Sale Conversion | Lead Funnel |
| `KPI-FUN-007` | Average response time | `vw_lead_response` | `vw_leads` | Average Response Time | Lead Funnel |
| `KPI-FUN-008` | Median response time | `vw_lead_response` | `vw_leads` (row-level `first_response_seconds`) | Median Response Time | Lead Funnel |
| `KPI-MKT-001` | Marketing cost per lead | `vw_marketing_performance` | `vw_marketing_performance` (imported) | Cost per Lead | Marketing |
| `KPI-MKT-002` | Marketing cost per sale | `vw_marketing_performance` | `vw_marketing_performance` (imported) | Cost per Sale | Marketing |
| `KPI-MKT-003` | Gross return on advertising spend | `vw_marketing_performance` | `vw_marketing_performance` (imported) | Gross Return on Advertising Spend | Marketing |

**All 29 resolve on both sides.** None is unowned in SQL, and none is without a measure in the model.

### 1.1 Where the governed owner and the model measure read different objects

Twenty-one of the twenty-nine KPIs are computed in SQL from an aggregate and in DAX from the underlying
row-grain fact. That is deliberate, and it is the whole reason
[09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md) exists: the two sides must agree, and
nothing in the construction forces them to. Where the model imports the governed view directly — the five
KPIs sourced from `vw_inventory_turn`, `vw_days_supply` and `vw_marketing_performance` — the two sides read
the same numbers and the reconciliation is a much weaker test, because agreement is close to guaranteed.
That weakness should be stated when those five are reconciled, not discovered afterwards.

---

## 2. Reporting view → KPI

**In model?** records whether the view is imported into the semantic model as a table. Eighteen of the
twenty-eight are; the two remaining imported tables, `vw_pipeline_run_summary` and
`vw_data_quality_summary`, appear at the foot of the table, bringing the model's imported count to twenty.

| View | KPIs owned | In model? | Also required by |
|---|---|---|---|
| `vw_calendar` | — | **Yes** | Every KPI's date basis. The marked date table. |
| `vw_dealership` | — | **Yes** | Every KPI's store grain. |
| `vw_employee` | — | **Yes** | Employee analysis and the fairness context [ARCHITECTURE.md §23](../../ARCHITECTURE.md) requires. |
| `vw_customer` | — | **Yes** | Customer-mix slicing; repeat-purchase analysis when it unlocks. |
| `vw_vehicle` | — | **Yes** | `condition_group`, the governed new/used split behind `KPI-SLS-002`, `KPI-SLS-003` and every condition-split inventory measure. |
| `vw_vehicle_model` | — | **Yes** | Model and trim analysis. |
| `vw_lead_source` | — | **Yes** | `is_cost_attributable`, the rule that makes `KPI-MKT-001`…`003` undefined for organic sources. |
| `vw_marketing_campaign` | — | **Yes** | Campaign slicing for the marketing KPIs. |
| `vw_vehicle_sales` | `KPI-SLS-001`…`003`, `KPI-GRS-001`…`006`, `KPI-INV-007` | **Yes** | `KPI-INV-008` numerator, `KPI-INV-009` denominator, `KPI-MKT-002`/`003` attributed outcomes |
| `vw_inventory_snapshots` | `KPI-INV-001`…`006` | **Yes** | `KPI-INV-008` denominator, `KPI-INV-009` numerator |
| `vw_leads` | `KPI-FUN-001`, `002`, `003`, `006`, `007`, `008` | **Yes** | `KPI-MKT-001` denominator |
| `vw_appointments` | `KPI-FUN-004`, `005` | **Yes** | |
| `vw_marketing_spend` | — (spend is the input) | **Yes** | `KPI-MKT-001`/`002` numerator, `KPI-MKT-003` denominator |
| `vw_sales_summary` | `KPI-SLS-001`…`003`, `KPI-INV-007` mean | No | `RECON-UNITS-001`, `RECON-REPORT-SALES` |
| `vw_gross_summary` | `KPI-GRS-001`…`006` | No | `RECON-GROSS-002` |
| `vw_inventory_health` | `KPI-INV-001`…`006` | No | `RECON-INV-001` |
| `vw_inventory_aging` | `KPI-INV-004` support | No | `RECON-INV-001` |
| `vw_days_to_sale` | `KPI-INV-007` | No | `RECON-REPORT-DAYS-TO-SALE` |
| `vw_inventory_turn` | `KPI-INV-008` | **Yes** | |
| `vw_days_supply` | `KPI-INV-009` | **Yes** | |
| `vw_lead_funnel` | `KPI-FUN-001`, `002`, `003`, `006` | No | `RECON-LEAD-001`, `RECON-FUNNEL-BOUNDS`, `RECON-FUNNEL-CHAIN` |
| `vw_appointment_funnel` | `KPI-FUN-004`, `005` | No | `RECON-FUNNEL-CHAIN` |
| `vw_lead_response` | `KPI-FUN-007`, `008` | No | |
| `vw_marketing_performance` | `KPI-MKT-001`…`003` | **Yes** | `RECON-MKT-*` |
| `vw_data_quality_trend` | — | **Yes** | The Data Quality page. Registered as `DOC-18`. |
| `vw_reconciliation_status` | — | **Yes** | The Data Quality page, and the only route by which reconciliation evidence reaches a reader without a grant on `audit`. |
| `vw_pipeline_run_summary` | — | **Yes** | Run context on the Data Quality page. |
| `vw_data_quality_summary` | — | **Yes** | Individual check outcomes on the Data Quality page. |

### 2.1 Views that own no KPI

Twelve of the twenty-eight own no KPI. Every one has a stated reason, and none is a leftover:

* **Eight dimension views.** A dimension supplies grain and context. It owns no measure by definition. All
  eight are imported into the model.
* **`vw_marketing_spend`.** Spend is an input to three KPIs rather than a KPI itself. Publishing it as a
  fact view keeps the vendor-reported columns — impressions, clicks, `vendor_reported_leads` — available for
  the comparison that matters analytically: vendor lead counts deliberately differ from `KPI-FUN-001`, and
  that gap is a finding to report, not a discrepancy to reconcile away. It is imported into the model even
  though the three marketing measures read `vw_marketing_performance` instead, so the vendor-side columns
  are available beside them.
* **`vw_data_quality_trend`, `vw_data_quality_summary`, `vw_pipeline_run_summary`.** The Data Quality page
  answers "can these numbers be trusted?", which is not a business KPI but is a condition on every other
  page being read at all. The eleven data-quality measures in
  [03-measure-groups.md §9](03-measure-groups.md) read these three, and carry no KPI identifier for the same
  reason.
* **`vw_reconciliation_status`.** The same, for reconciliation evidence specifically. It is also the
  mechanism by which a reader sees the audit trail without any privilege on the `audit` schema.

### 2.2 The ten views the model does not import

Ten views are absent from the model, and their absence is the design rather than an omission: importing a
pre-aggregation alongside the fact it aggregates gives a report two answers to one question. They remain the
governed SQL answer, the left-hand side of every reconciliation, and the object an Excel consumer reads. See
[01-table-inventory.md §3](01-table-inventory.md).

---

## 3. Reporting view → future report page

Pages are those named in [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md). **No page has been built. No visual
has been built.** The `.Report` folder in the PBIP project is a shell: a `.platform` file and a
`definition.pbir` pointing at the semantic model, containing no page, no visual, no bookmark and no theme.
Report content is delivery increment `P2.2`, which is gated on the Desktop validation in `P2.1-09`, and that
gate is **PENDING**.

This section records which views each page **will** need, so the reporting layer can be checked for
completeness before any of them exists. It is a readiness statement, not a progress report.

| Page | Views required | Blocked? |
|---|---|---|
| 1. Executive Overview | `vw_sales_summary`, `vw_gross_summary`, `vw_inventory_health`, `vw_lead_funnel`, `vw_marketing_performance`, `vw_calendar`, `vw_dealership` | Target attainment component blocked by the **absent semantic-model binding**, not by the fact. `DASH.5` implemented `fact_sales_target` and `reporting.vw_target_attainment`; the view sits in the dashboard-program lane and no TMDL table reads it. |
| 2. Sales and Gross | `vw_vehicle_sales`, `vw_gross_summary`, `vw_sales_summary`, `vw_vehicle`, `vw_vehicle_model`, `vw_employee`, `vw_lead_source`, `vw_calendar`, `vw_dealership` | No |
| 3. Inventory Health | `vw_inventory_snapshots`, `vw_inventory_health`, `vw_inventory_aging`, `vw_days_to_sale`, `vw_inventory_turn`, `vw_days_supply`, `vw_vehicle`, `vw_vehicle_model` | No |
| 4. Lead Funnel | `vw_leads`, `vw_lead_funnel`, `vw_appointments`, `vw_appointment_funnel`, `vw_lead_response`, `vw_lead_source`, `vw_marketing_campaign` | No |
| 5. Employee Performance | `vw_vehicle_sales`, `vw_employee`, `vw_lead_funnel`, `vw_appointment_funnel`, `vw_inventory_health` | No — the fairness context [ARCHITECTURE.md §23](../../ARCHITECTURE.md) requires is available and asserted by `tests/integration/test_gate1_readiness.py` |
| 6. Marketing Performance | `vw_marketing_performance`, `vw_marketing_spend`, `vw_lead_source`, `vw_marketing_campaign`, `vw_lead_funnel` | No |
| 7. F&I Performance | `vw_vehicle_sales` (back-end gross only) | **Yes** — `fact_finance_product_sale` is Deferred, so no product-level detail exists and no product-mix narrative is supportable |
| 8. Customer and Service Opportunities | `vw_customer` | **Yes** — `fact_service_visit` is Deferred |
| 9. Data Quality and Definitions | `vw_data_quality_trend`, `vw_data_quality_summary`, `vw_reconciliation_status`, `vw_pipeline_run_summary` | No |

Seven of the nine pages are unblocked by the reporting layer. The two that are blocked are blocked by
Deferred **facts**, not by anything missing from `reporting`.

### 3.1 A page will read the model, not these views directly

The view names above are the readiness statement written before the model existed. A page built in `P2.2`
binds to the semantic model, so where a page needs a KPI it will use the measure in §1, and where it needs a
pre-aggregated view the model does not import — `vw_sales_summary`, `vw_lead_funnel`, `vw_inventory_health`
and the rest — it will use the row-grain fact the model does import instead, via the measure that owns the
KPI. This section is not rewritten to say so, because the view list is still the right completeness check on
the reporting layer, which is what it was written to be.
