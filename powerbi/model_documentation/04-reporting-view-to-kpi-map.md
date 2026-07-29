# Reporting View to KPI Map — ARPI

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

The two-way map between the twenty-eight views in the `reporting` schema and the twenty-nine KPI
identifiers in [KPI_CATALOG.md](../../KPI_CATALOG.md).

Both directions matter. A KPI with no view is not computable and blocks Gate 1. A view that owns no KPI is
not automatically wrong — several exist to make a measure *readable* rather than to compute one — but an
undeclared one is a maintenance liability, so every such view is listed with its reason.

The mapping is held machine-readably in `arpi.constants.KPI_VIEW_OWNERSHIP` and asserted by
`tests/integration/test_kpi_verification.py` and `tests/integration/test_gate1_readiness.py`, so this
document and the code cannot silently disagree.

---

## 1. KPI → reporting view

**Governed owner** is the view named in `KPI_CATALOG.md`'s *SQL ownership* field: the object a SQL or Excel
consumer reads, and the left-hand side of the KPI's reconciliation. **Semantic-model source** is the
row-grain view a Power BI model should bind to instead, because a ratio or an order statistic recomputes
under any filter context there and cannot in an aggregate.

| KPI | Name | Governed owner | Semantic-model source |
|---|---|---|---|
| `KPI-SLS-001` | Retail units sold | `vw_sales_summary` | `vw_vehicle_sales` |
| `KPI-SLS-002` | New units sold | `vw_sales_summary` | `vw_vehicle_sales` |
| `KPI-SLS-003` | Used units sold | `vw_sales_summary` | `vw_vehicle_sales` |
| `KPI-GRS-001` | Front-end gross | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-GRS-002` | Back-end gross | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-GRS-003` | Total gross | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-GRS-004` | Front gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-GRS-005` | Back gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-GRS-006` | Total gross per retail unit | `vw_gross_summary` | `vw_vehicle_sales` |
| `KPI-INV-001` | Active inventory count | `vw_inventory_health` | `vw_inventory_snapshots` |
| `KPI-INV-002` | Inventory investment | `vw_inventory_health` | `vw_inventory_snapshots` |
| `KPI-INV-003` | Average inventory age | `vw_inventory_health` | `vw_inventory_snapshots` |
| `KPI-INV-004` | Median inventory age | `vw_inventory_health`, `vw_inventory_aging` | `vw_inventory_snapshots` (row-level `days_in_stock`) |
| `KPI-INV-005` | Aged inventory count | `vw_inventory_health` | `vw_inventory_snapshots` |
| `KPI-INV-006` | Aged inventory percentage | `vw_inventory_health` | `vw_inventory_snapshots` |
| `KPI-INV-007` | Days to sale | `vw_days_to_sale`, `vw_sales_summary` | `vw_vehicle_sales` (row-level `retail_days_in_inventory`) |
| `KPI-INV-008` | Inventory turn | `vw_inventory_turn` | `vw_inventory_turn` (imported) |
| `KPI-INV-009` | Dealer days supply | `vw_days_supply` | `vw_days_supply` (imported) |
| `KPI-FUN-001` | Leads received | `vw_lead_funnel` | `vw_leads` |
| `KPI-FUN-002` | Contact rate | `vw_lead_funnel` | `vw_leads` |
| `KPI-FUN-003` | Appointment-set rate | `vw_lead_funnel` | `vw_leads` |
| `KPI-FUN-004` | Show rate | `vw_appointment_funnel` | `vw_appointments` |
| `KPI-FUN-005` | Show-to-sale conversion | `vw_appointment_funnel` | `vw_appointments` |
| `KPI-FUN-006` | Lead-to-sale conversion | `vw_lead_funnel` | `vw_leads` |
| `KPI-FUN-007` | Average response time | `vw_lead_response` | `vw_leads` |
| `KPI-FUN-008` | Median response time | `vw_lead_response` | `vw_leads` (row-level `first_response_seconds`) |
| `KPI-MKT-001` | Marketing cost per lead | `vw_marketing_performance` | `vw_marketing_performance` (imported) |
| `KPI-MKT-002` | Marketing cost per sale | `vw_marketing_performance` | `vw_marketing_performance` (imported) |
| `KPI-MKT-003` | Gross return on advertising spend | `vw_marketing_performance` | `vw_marketing_performance` (imported) |

All 29 resolve. None is unowned.

---

## 2. Reporting view → KPI

| View | KPIs owned | Also required by |
|---|---|---|
| `vw_calendar` | — | Every KPI's date basis. The marked date table. |
| `vw_dealership` | — | Every KPI's store grain. |
| `vw_employee` | — | Employee analysis and the fairness context [ARCHITECTURE.md §23](../../ARCHITECTURE.md) requires. |
| `vw_customer` | — | Customer-mix slicing; repeat-purchase analysis when it unlocks. |
| `vw_vehicle` | — | `condition_group`, the governed new/used split behind `KPI-SLS-002`, `KPI-SLS-003` and every condition-split inventory measure. |
| `vw_vehicle_model` | — | Model and trim analysis. |
| `vw_lead_source` | — | `is_cost_attributable`, the rule that makes `KPI-MKT-001`…`003` undefined for organic sources. |
| `vw_marketing_campaign` | — | Campaign slicing for the marketing KPIs. |
| `vw_vehicle_sales` | `KPI-SLS-001`…`003`, `KPI-GRS-001`…`006`, `KPI-INV-007` | `KPI-INV-008` numerator, `KPI-INV-009` denominator, `KPI-MKT-002`/`003` attributed outcomes |
| `vw_inventory_snapshots` | `KPI-INV-001`…`006` | `KPI-INV-008` denominator, `KPI-INV-009` numerator |
| `vw_leads` | `KPI-FUN-001`, `002`, `003`, `006`, `007`, `008` | `KPI-MKT-001` denominator |
| `vw_appointments` | `KPI-FUN-004`, `005` | |
| `vw_marketing_spend` | — (spend is the input) | `KPI-MKT-001`/`002` numerator, `KPI-MKT-003` denominator |
| `vw_sales_summary` | `KPI-SLS-001`…`003`, `KPI-INV-007` mean | `RECON-UNITS-001`, `RECON-REPORT-SALES` |
| `vw_gross_summary` | `KPI-GRS-001`…`006` | `RECON-GROSS-002` |
| `vw_inventory_health` | `KPI-INV-001`…`006` | `RECON-INV-001` |
| `vw_inventory_aging` | `KPI-INV-004` support | `RECON-INV-001` |
| `vw_days_to_sale` | `KPI-INV-007` | `RECON-REPORT-DAYS-TO-SALE` |
| `vw_inventory_turn` | `KPI-INV-008` | |
| `vw_days_supply` | `KPI-INV-009` | |
| `vw_lead_funnel` | `KPI-FUN-001`, `002`, `003`, `006` | `RECON-LEAD-001`, `RECON-FUNNEL-BOUNDS`, `RECON-FUNNEL-CHAIN` |
| `vw_appointment_funnel` | `KPI-FUN-004`, `005` | `RECON-FUNNEL-CHAIN` |
| `vw_lead_response` | `KPI-FUN-007`, `008` | |
| `vw_marketing_performance` | `KPI-MKT-001`…`003` | `RECON-MKT-*` |
| `vw_data_quality_trend` | — | The Data Quality page. Registered as `DOC-18`. |
| `vw_reconciliation_status` | — | The Data Quality page, and the only route by which reconciliation evidence reaches a reader without a grant on `audit`. |
| `vw_pipeline_run_summary` | — | Run context on the Data Quality page. |
| `vw_data_quality_summary` | — | Individual check outcomes on the Data Quality page. |

### 2.1 Views that own no KPI

Twelve of the twenty-eight own no KPI. Every one has a stated reason, and none is a leftover:

* **Eight dimension views.** A dimension supplies grain and context. It owns no measure by definition.
* **`vw_marketing_spend`.** Spend is an input to three KPIs rather than a KPI itself. Publishing it as a
  fact view keeps the vendor-reported columns — impressions, clicks, `vendor_reported_leads` — available for
  the comparison that matters analytically: vendor lead counts deliberately differ from `KPI-FUN-001`, and
  that gap is a finding to report, not a discrepancy to reconcile away.
* **`vw_data_quality_trend`, `vw_data_quality_summary`, `vw_pipeline_run_summary`.** The Data Quality page
  answers "can these numbers be trusted?", which is not a business KPI but is a condition on every other
  page being read at all.
* **`vw_reconciliation_status`.** The same, for reconciliation evidence specifically. It is also the
  mechanism by which a reader sees the audit trail without any privilege on the `audit` schema.

---

## 3. Reporting view → future report page

Pages are those named in [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md). **No page has been built**; this
records which views each page will need, so the reporting layer can be checked for completeness before any
of them exists.

| Page | Views required | Blocked? |
|---|---|---|
| 1. Executive Overview | `vw_sales_summary`, `vw_gross_summary`, `vw_inventory_health`, `vw_lead_funnel`, `vw_marketing_performance`, `vw_calendar`, `vw_dealership` | Target attainment component blocked by `fact_sales_target` (Deferred) |
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
