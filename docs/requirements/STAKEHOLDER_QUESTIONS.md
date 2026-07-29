# Stakeholder Questions — ARPI

**Project:** Automotive Retail Performance Intelligence (ARPI)
**Owner:** Michael Palmer
**Version:** 1.0
**Last reviewed:** 2026-07-29
**Conventions:** [README.md](README.md) · **Parent documents:** [ARCHITECTURE.md](../../ARCHITECTURE.md) · [KPI_CATALOG.md](../../KPI_CATALOG.md) · [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) · [LIMITATIONS.md](../../LIMITATIONS.md)

---

## 1. Purpose

This is the traceability matrix Gate 4 is checked against.

[ARCHITECTURE.md §28](../../ARCHITECTURE.md) permits a new data domain only when a stakeholder question
requires it, and [KPI_CATALOG.md §37](../../KPI_CATALOG.md) requires every KPI to trace to at least one such
question. Until this document existed, neither rule could be checked: the personas were named in
`docs/research.md` §11.3 and the questions were listed in §11.4, but nothing recorded which question each
KPI answered or which object answered it. This document is that record, and
`tests/integration/test_stakeholder_question_traceability.py` is what stops it drifting from the code.

It is also, deliberately, a record of what the platform **cannot** answer. Four of the thirty-five questions
below are marked `Deferred`, with the fact each is blocked by. A traceability matrix that lists only what
works is a marketing document.

---

## 2. How to read a row

| Field | Meaning |
|---|---|
| **Persona** | Who asks. Every persona in `docs/research.md` §11.3 appears at least once. |
| **Business question** | The question in the stakeholder's own words, not a metric name. |
| **Required dimensions** / **Required facts** | The warehouse entities an answer needs. |
| **KPI IDs** | Identifiers from [KPI_CATALOG.md](../../KPI_CATALOG.md), or an explicit `None` with the reason. |
| **Reporting view** | The `reporting` object that owns the answer, or an explicit statement that none does. |
| **Intended future report page** | The page from [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) the answer will live on. **No page exists yet**; Gate 1 gates their construction. |
| **Decision enabled** | What a manager does differently because of the answer. A question that changes no decision does not belong here. |
| **Interpretation caution** | How the answer can mislead. Every row has one, because every measure can. |
| **Implementation status** | One of `Implemented`, `Planned`, `Deferred`, `Out of scope`. A question whose KPIs are not all computable is not `Implemented`. |

---

## 3. Coverage summary

| Check | Result |
|---|---|
| Questions recorded | 35 |
| Personas covered | 12 of 12 from `docs/research.md` §11.3 |
| Questions the MVP can answer today | 31 |
| Questions the MVP cannot answer, recorded with the blocking fact | 4 |
| KPIs traced to at least one question | **29 of 29** — no unattributed KPI |
| Reporting views supporting at least one question | **28 of 28** — no orphan view |

### 3.1 Reconciling the two persona lists

`docs/research.md` §11.3 names twelve personas across primary and secondary users. The root
[`README.md`](../../README.md) persona table names nine, and states in prose that regional operations,
fixed-operations and new-car managers are secondary audiences. The two lists therefore agree on membership
and differ only in presentation: the README table is the nine the platform serves most directly, and the
research document is the full set. Every one of the twelve appears below. No persona appears in one source
and not the other, so there is no discrepancy to reconcile beyond this note.

The README spells two of them with a slash — *Internet / BDC director*, *Data / BI analyst* — where the
research document uses *or*. This document follows the research document's spelling, because that is the
list the acceptance criteria bind to.

---

## 4. The questions

### SQ-01 — Dealer principal

| Field | Value |
|---|---|
| **Persona** | Dealer principal |
| **Business question** | *Are total gross and gross per retail unit improving across the group?* |
| **Required dimensions** | `dim_date`, `dim_dealership` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-GRS-003`, `KPI-GRS-006`, `KPI-SLS-001` |
| **Reporting view** | `reporting.vw_gross_summary`, `reporting.vw_sales_summary`, `reporting.vw_calendar`, `reporting.vw_dealership` |
| **Intended future report page** | 1. Executive Overview |
| **Decision enabled** | Whether to intervene at group level at all, and in which direction: a volume problem and a margin problem need opposite responses. |
| **Interpretation caution** | Total gross conceals the trade-off between front and back. A flat total with a collapsing front offset by rising F&I is a materially different and usually less durable business, so `KPI-GRS-001` and `KPI-GRS-002` must be on the same visual. ARPI publishes no benchmark for what good looks like. |
| **Implementation status** | **Implemented** |


### SQ-02 — Dealer principal

| Field | Value |
|---|---|
| **Persona** | Dealer principal |
| **Business question** | *How much capital is tied up in stock, and how much of it is in units past the aging threshold?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-INV-002`, `KPI-INV-005`, `KPI-INV-006` |
| **Reporting view** | `reporting.vw_inventory_health`, `reporting.vw_inventory_snapshots` |
| **Intended future report page** | 1. Executive Overview / 3. Inventory Health |
| **Decision enabled** | Whether to release capital by wholesaling aged units, and how much is genuinely at stake in doing so. |
| **Interpretation caution** | This is cost invested, not market value and not floor-plan exposure: ARPI models no floor-plan interest, holding cost or carrying cost, so "what aged inventory is costing us per day" is **not supportable from this data**. The aged percentage can also improve for a bad reason -- wholesaling aged units removes them from the numerator while the group takes a loss. The 60-day threshold is a project default, not an industry benchmark. |
| **Implementation status** | **Implemented** |


### SQ-03 — Dealer principal

| Field | Value |
|---|---|
| **Persona** | Dealer principal |
| **Business question** | *Which marketing channels return more gross profit than they cost?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source`, `dim_marketing_campaign` |
| **Required facts** | `fact_marketing_spend`, `fact_lead`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-MKT-003` |
| **Reporting view** | `reporting.vw_marketing_performance` |
| **Intended future report page** | 1. Executive Overview / 6. Marketing Performance |
| **Decision enabled** | Where to move marketing budget between channels. |
| **Interpretation caution** | A contribution measure, not a profit measure: no personnel, facility or floor-plan cost is netted out. Attribution is single-source and first-touch, and cohort immaturity makes the current month always look worst. Gross-based return is primary; a revenue-based figure would be inflated by roughly an order of magnitude because dealership revenue includes the cost of the vehicle. |
| **Implementation status** | **Implemented** |


### SQ-04 — General manager

| Field | Value |
|---|---|
| **Persona** | General manager |
| **Business question** | *Which store explains this period's change in units and gross?* |
| **Required dimensions** | `dim_date`, `dim_dealership` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-GRS-003` |
| **Reporting view** | `reporting.vw_sales_summary`, `reporting.vw_gross_summary`, `reporting.vw_dealership` |
| **Intended future report page** | 1. Executive Overview / 2. Sales and Gross |
| **Decision enabled** | Which store to visit, and what to ask about when you get there. |
| **Interpretation caution** | Three stores is a small comparison set, and one of them is an independent used store with structurally zero new-vehicle volume. That zero is correct, not missing data, and a store ranking that does not say so is misleading. |
| **Implementation status** | **Implemented** |


### SQ-05 — General manager

| Field | Value |
|---|---|
| **Persona** | General manager |
| **Business question** | *Is the inventory on my lot turning at an acceptable rate, and how long would it last at the current selling pace?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_inventory_snapshot`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-INV-008`, `KPI-INV-009` |
| **Reporting view** | `reporting.vw_inventory_turn`, `reporting.vw_days_supply` |
| **Intended future report page** | 3. Inventory Health |
| **Decision enabled** | Whether to slow or accelerate acquisition. |
| **Interpretation caution** | **Neither figure is comparable to one from another system.** Turn and days-supply methods vary across vendors; ARPI's seven method choices are published on the view and must be quoted with any figure. Days supply is extremely sensitive to the trailing window and to seasonality, and is `NULL` -- not infinite -- when the window contains no sales. ARPI publishes no target for either. |
| **Implementation status** | **Implemented** |


### SQ-06 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *How do new and used volumes compare, and is the mix moving?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_vehicle_model` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-SLS-002`, `KPI-SLS-003` |
| **Reporting view** | `reporting.vw_sales_summary`, `reporting.vw_vehicle`, `reporting.vw_vehicle_model` |
| **Intended future report page** | 2. Sales and Gross |
| **Decision enabled** | Where to focus desk attention and acquisition spend. |
| **Interpretation caution** | **Certified pre-owned units are used units** and are counted in `KPI-SLS-003`, never in `KPI-SLS-002`. Any report showing "used" and "certified" separately must say whether the used figure includes certified, because both conventions exist in the industry and mixing them silently double-counts. New-vehicle gross also excludes manufacturer incentives, so new-versus-used gross comparisons are not like-for-like. |
| **Implementation status** | **Implemented** |


### SQ-07 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Is discounting eroding front-end gross?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle_model` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-GRS-001`, `KPI-GRS-004` |
| **Reporting view** | `reporting.vw_gross_summary`, `reporting.vw_vehicle_sales` |
| **Intended future report page** | 2. Sales and Gross |
| **Decision enabled** | Whether to tighten desking policy, and on which model lines. |
| **Interpretation caution** | A rising per-unit gross with falling volume is not automatically good: it often means the store stopped chasing marginal deals, which can be correct or can be lost market share. Negative-front deals are real outcomes and must stay visible rather than being averaged away. |
| **Implementation status** | **Implemented** |


### SQ-08 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Which salespeople balance volume against gross retention?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee`, `dim_lead_source` |
| **Required facts** | `fact_vehicle_sale`, `fact_lead` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-GRS-006` |
| **Reporting view** | `reporting.vw_vehicle_sales`, `reporting.vw_employee`, `reporting.vw_lead_funnel` |
| **Intended future report page** | 5. Employee Performance |
| **Decision enabled** | Where to direct coaching, and who to learn from. |
| **Interpretation caution** | **Volume alone must never be used to rank employees**, and gross per unit alone is still not sufficient. [ARCHITECTURE.md §23](../../ARCHITECTURE.md) requires contextual metrics -- lead volume received, lead-source mix, store traffic, tenure, new-versus-used mix, inventory availability, manager involvement -- because ranking on gross per unit alone penalises whoever was handed the harder inventory. Every one of those is available from the reporting layer and must be on the page. |
| **Implementation status** | **Implemented** |


### SQ-09 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Of the customers who physically arrived, how many bought?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee` |
| **Required facts** | `fact_appointment`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-FUN-005` |
| **Reporting view** | `reporting.vw_appointment_funnel`, `reporting.vw_appointments` |
| **Intended future report page** | 4. Lead Funnel / 5. Employee Performance |
| **Decision enabled** | Whether the showroom or the BDC is the constraint. |
| **Interpretation caution** | Attributed to the **visit** date, not the sale date, so a customer who visits on the last day of a month and buys three days later still counts in the visit's period -- late-period conversion therefore appears to improve as data matures, and period-to-date figures must be labelled incomplete. Walk-in traffic without an appointment is not in this measure at all. |
| **Implementation status** | **Implemented** |


### SQ-10 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *What does the typical unit on my lot look like, and how bad is the tail?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-INV-003`, `KPI-INV-004` |
| **Reporting view** | `reporting.vw_inventory_health`, `reporting.vw_inventory_aging`, `reporting.vw_inventory_snapshots` |
| **Intended future report page** | 3. Inventory Health |
| **Decision enabled** | Which specific units need a pricing or disposal decision this week. |
| **Interpretation caution** | The **median is the headline** and the mean is the companion: inventory age is right-skewed, so a handful of 200-day units drags the mean above what any typical unit resembles. The gap between them is itself the diagnostic. The median is deliberately blind to the tail, which is why the age distribution must be on the same page. |
| **Implementation status** | **Implemented** |


### SQ-11 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *How many units am I carrying, and how are they distributed across age buckets?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-INV-001`, `KPI-INV-005`, `KPI-INV-006` |
| **Reporting view** | `reporting.vw_inventory_health`, `reporting.vw_inventory_aging` |
| **Intended future report page** | 3. Inventory Health |
| **Decision enabled** | Whether the aging problem is broad or concentrated -- twelve units over 120 days is a different problem from forty units at 65 days, and both can produce the same median. |
| **Interpretation caution** | **Semi-additive.** Summing a daily unit count over a month yields unit-days, not units, and is wrong by roughly a factor of thirty while looking entirely plausible. Every visual must state its time-aggregation rule. A date with no snapshot rows is missing data, not an empty lot, and the two must stay distinguishable. |
| **Implementation status** | **Implemented** |


### SQ-12 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *How long did the units that actually sold take to sell?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-INV-007` |
| **Reporting view** | `reporting.vw_days_to_sale`, `reporting.vw_vehicle_sales` |
| **Intended future report page** | 3. Inventory Health |
| **Decision enabled** | Whether acquisition and pricing decisions are producing units that move. |
| **Interpretation caution** | **Survivorship bias dominates.** This describes only units that sold: a lot full of 300-day units that never sell can show an excellent days-to-sale figure, because those units never enter the population. Always read with `KPI-INV-004`, the age of what is still there. Retail only -- wholesale timing reflects a disposal decision, not retail demand. |
| **Implementation status** | **Implemented** |


### SQ-13 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *Should I be buying more inventory right now?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle` |
| **Required facts** | `fact_vehicle_inventory_snapshot`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-INV-009`, `KPI-INV-008` |
| **Reporting view** | `reporting.vw_days_supply`, `reporting.vw_inventory_turn` |
| **Intended future report page** | 3. Inventory Health |
| **Decision enabled** | Whether to bid at auction this week. |
| **Interpretation caution** | Days supply is **extremely sensitive to the trailing window**: 30 days ending in a slow month makes a normal lot look overstocked. The window is a project default of 30 calendar days, published on every row so a finding can state it, and is not an industry benchmark. A zero selling pace makes the measure undefined, not infinite. |
| **Implementation status** | **Implemented** |


### SQ-14 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *How many valid leads did we receive, and from which sources?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead` |
| **KPI IDs** | `KPI-FUN-001` |
| **Reporting view** | `reporting.vw_lead_funnel`, `reporting.vw_leads`, `reporting.vw_lead_source` |
| **Intended future report page** | 4. Lead Funnel |
| **Decision enabled** | How to staff the BDC, and which source relationships to keep. |
| **Interpretation caution** | **Duplicates are excluded**, and the excluded count is published beside the figure rather than folded into it -- duplicates inflate volume and depress every conversion rate at once, making a source look both busy and bad. Vendor-reported lead counts will not match this and are not expected to. |
| **Implementation status** | **Implemented** |


### SQ-15 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *What share of our leads do we actually reach?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead` |
| **KPI IDs** | `KPI-FUN-002` |
| **Reporting view** | `reporting.vw_lead_funnel` |
| **Intended future report page** | 4. Lead Funnel |
| **Decision enabled** | Whether the constraint is reach or persuasion. A weak contact rate makes every downstream rate irrelevant. |
| **Interpretation caution** | **Right-censored.** Leads created in the last days of a period may not have been contacted yet, which depresses the current period. A period-to-date comparison against a complete prior period is misleading unless the same maturity window is applied to both. |
| **Implementation status** | **Implemented** |


### SQ-16 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *Of the leads we reach, what share book an appointment?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead` |
| **KPI IDs** | `KPI-FUN-003` |
| **Reporting view** | `reporting.vw_lead_funnel` |
| **Intended future report page** | 4. Lead Funnel |
| **Decision enabled** | Whether BDC scripting and appointment-setting practice need attention, separately from reach. |
| **Interpretation caution** | **The denominator is contacted leads, not all leads.** This rate cannot be read without the contact rate beside it: alone, it lets a store that reaches 20% of its leads look better than one that reaches 70%. |
| **Implementation status** | **Implemented** |


### SQ-17 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *Do the appointments we book actually show up?* |
| **Required dimensions** | `dim_date`, `dim_dealership` |
| **Required facts** | `fact_appointment` |
| **KPI IDs** | `KPI-FUN-004` |
| **Reporting view** | `reporting.vw_appointment_funnel`, `reporting.vw_appointments` |
| **Intended future report page** | 4. Lead Funnel |
| **Decision enabled** | Whether confirmation practice needs to change. |
| **Interpretation caution** | **The cancellation exclusion is the manipulable part.** Appointments cancelled in advance are excluded from the denominator because they never had the opportunity to show -- but a store that aggressively reclassifies no-shows as advance cancellations reports a flattering rate. The cancellation rate must be on the same visual. |
| **Implementation status** | **Implemented** |


### SQ-18 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *How quickly do we respond to a new lead?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead` |
| **KPI IDs** | `KPI-FUN-007`, `KPI-FUN-008` |
| **Reporting view** | `reporting.vw_lead_response`, `reporting.vw_leads` |
| **Intended future report page** | 4. Lead Funnel |
| **Decision enabled** | Whether to change staffing hours or auto-response configuration. |
| **Interpretation caution** | **Both measures are blind to ignored leads**, because leads never responded to are excluded from the denominator -- a store that ignores half its leads can report an excellent response time. The count of leads without follow-up must be shown alongside. The median is the headline; the banded distribution is more actionable than either statistic. ARPI states **no target response time**. |
| **Implementation status** | **Implemented** |


### SQ-19 — Internet or BDC director

| Field | Value |
|---|---|
| **Persona** | Internet or BDC director |
| **Business question** | *Which lead sources convert to delivered cars rather than only to activity?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-FUN-006` |
| **Reporting view** | `reporting.vw_lead_funnel`, `reporting.vw_lead_source` |
| **Intended future report page** | 4. Lead Funnel / 6. Marketing Performance |
| **Decision enabled** | Which source contracts to renew and which to end. |
| **Interpretation caution** | **Cohort maturity dominates.** Leads are attributed to their creation month, so the most recent months always look worst -- those leads have not finished converting. Comparing an immature month to a mature one is the single most common misreading of this metric. Attribution is single-source and first-touch. |
| **Implementation status** | **Implemented** |


### SQ-20 — Finance director

| Field | Value |
|---|---|
| **Persona** | Finance director |
| **Business question** | *How much finance and insurance gross are we earning per delivered unit?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-GRS-002`, `KPI-GRS-005` |
| **Reporting view** | `reporting.vw_gross_summary`, `reporting.vw_vehicle_sales`, `reporting.vw_employee` |
| **Intended future report page** | 2. Sales and Gross / 7. F&I Performance |
| **Decision enabled** | Where to focus finance-office coaching. |
| **Interpretation caution** | **The denominator includes cash deals**, which cannot generate finance reserve, so a store with an unusual cash mix shows a lower figure for reasons unrelated to finance-office skill. In the MVP, back-end gross is a **single generated number with no product-level detail behind it**: it cannot answer "which product drove this?", and any narrative about product mix is unsupported. |
| **Implementation status** | **Implemented** |


### SQ-21 — Finance director

| Field | Value |
|---|---|
| **Persona** | Finance director |
| **Business question** | *Which finance products have weak or inconsistent penetration, and what do cancellations cost us?* |
| **Required dimensions** | `dim_finance_product` (Deferred) |
| **Required facts** | `fact_finance_product_sale` (Deferred) |
| **KPI IDs** | None -- the F&I product KPIs are Deferred |
| **Reporting view** | None. **The MVP cannot answer this question.** |
| **Intended future report page** | 7. F&I Performance (blocked) |
| **Decision enabled** | None today. Recorded so the gap is visible rather than absent. |
| **Interpretation caution** | `warehouse.fact_finance_product_sale` is Deferred, so no product-level detail exists. `KPI-GRS-002` gives the total and nothing beneath it. Any product-mix narrative built on the MVP would be fabricated. |
| **Implementation status** | **Deferred** |


### SQ-22 — Marketing manager

| Field | Value |
|---|---|
| **Persona** | Marketing manager |
| **Business question** | *What are we paying to generate one opportunity, by campaign?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source`, `dim_marketing_campaign` |
| **Required facts** | `fact_marketing_spend`, `fact_lead` |
| **KPI IDs** | `KPI-MKT-001` |
| **Reporting view** | `reporting.vw_marketing_performance`, `reporting.vw_marketing_campaign`, `reporting.vw_marketing_spend` |
| **Intended future report page** | 6. Marketing Performance |
| **Decision enabled** | Which campaigns to scale and which to pause. |
| **Interpretation caution** | **Month is the finest valid grain** -- dividing a monthly spend figure by one day's leads produces a number that is meaningless and looks fine. The model makes a day-grain figure structurally impossible. Cost per lead says nothing about lead quality, and is **undefined, not zero**, for organic and internal sources: a walk-in has no cost per lead. |
| **Implementation status** | **Implemented** |


### SQ-23 — Marketing manager

| Field | Value |
|---|---|
| **Persona** | Marketing manager |
| **Business question** | *What are we paying to generate one delivered car?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source`, `dim_marketing_campaign` |
| **Required facts** | `fact_marketing_spend`, `fact_lead`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-MKT-002` |
| **Reporting view** | `reporting.vw_marketing_performance` |
| **Intended future report page** | 6. Marketing Performance |
| **Decision enabled** | Where to move budget once lead quality, not just lead volume, is accounted for. |
| **Interpretation caution** | **Cohort immaturity is severe here.** Leads created this month have not finished converting, so the current month's cost per sale always looks terrible and improves for weeks. Trend visuals must restrict to matured cohorts or label the tail. Spend with zero attributed sales returns `NULL`, never infinity, and must be reported as exactly that. |
| **Implementation status** | **Implemented** |


### SQ-24 — Marketing manager

| Field | Value |
|---|---|
| **Persona** | Marketing manager |
| **Business question** | *Do the lead counts our vendors bill us against match the leads that reached the CRM?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source`, `dim_marketing_campaign` |
| **Required facts** | `fact_marketing_spend`, `fact_lead` |
| **KPI IDs** | `KPI-FUN-001` |
| **Reporting view** | `reporting.vw_marketing_spend`, `reporting.vw_lead_funnel` |
| **Intended future report page** | 6. Marketing Performance |
| **Decision enabled** | Whether to challenge a vendor invoice, and on what evidence. |
| **Interpretation caution** | The two counts **will not match, and are not expected to**: vendors count differently and typically count duplicates. The discrepancy is an analytical finding to report, not a data-quality defect to hide, and `vendor_reported_leads` must never be substituted for `KPI-FUN-001`. |
| **Implementation status** | **Implemented** |


### SQ-25 — Regional operations manager

| Field | Value |
|---|---|
| **Persona** | Regional operations manager |
| **Business question** | *Which stores are missing on volume despite receiving adequate lead volume?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_lead_source` |
| **Required facts** | `fact_lead`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-FUN-001`, `KPI-FUN-006` |
| **Reporting view** | `reporting.vw_sales_summary`, `reporting.vw_lead_funnel`, `reporting.vw_dealership` |
| **Intended future report page** | 1. Executive Overview / 4. Lead Funnel |
| **Decision enabled** | Whether a store's problem is demand or execution -- the two need different interventions. |
| **Interpretation caution** | Lead volume and conversion are on different date bases from delivered units: a lead counts in the month it arrived, a sale in the month it closed. Comparing the two within one month attributes this month's sales to this month's leads, which is not how the funnel works. Sources also differ in lead quality, so an unweighted lead count across stores with different source mixes is not a like-for-like comparison. |
| **Implementation status** | **Implemented** |


### SQ-26 — Data or BI analyst

| Field | Value |
|---|---|
| **Persona** | Data or BI analyst |
| **Business question** | *Can I trust these numbers -- did validation pass, did the reconciliations reconcile, and is quality improving or decaying?* |
| **Required dimensions** | None |
| **Required facts** | None -- audit metadata |
| **KPI IDs** | None. Data quality is a condition on every KPI rather than a KPI. |
| **Reporting view** | `reporting.vw_data_quality_trend`, `reporting.vw_data_quality_summary`, `reporting.vw_reconciliation_status`, `reporting.vw_pipeline_run_summary` |
| **Intended future report page** | 9. Data Quality and Definitions |
| **Decision enabled** | Whether any other page on the report may be read at all. |
| **Interpretation caution** | **A skipped check is not a passing check.** A 100% pass rate with forty skipped checks has proved far less than a 100% pass rate with none, which is why evaluation coverage is published beside the pass rate. One reconciliation, `RECON-FUNNEL-CHAIN`, is informational rather than critical because it multiplies rates across a grain shift; every other one failing invalidates the numbers built on it. |
| **Implementation status** | **Implemented** |


### SQ-27 — Data or BI analyst

| Field | Value |
|---|---|
| **Persona** | Data or BI analyst |
| **Business question** | *What is the grain, lineage and exact definition of every object I am about to report on?* |
| **Required dimensions** | All eight |
| **Required facts** | All five |
| **KPI IDs** | All 29 -- every definition is catalogued |
| **Reporting view** | Every view: each carries a `COMMENT ON VIEW` declaring its grain and a comment on every column. |
| **Intended future report page** | 9. Data Quality and Definitions |
| **Decision enabled** | Whether a number can be quoted to a manager without a caveat, and which caveat if not. |
| **Interpretation caution** | Documentation describes the model, not the world. Every definition here is ARPI's own; none is an industry standard, and **no benchmark, target or "good" value exists anywhere in the catalogue** because ARPI has no licensed source for one. |
| **Implementation status** | **Implemented** |


### SQ-28 — Sales manager

| Field | Value |
|---|---|
| **Persona** | Sales manager |
| **Business question** | *How many of my team's appointments showed, and how many of those turned into deals?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee` |
| **Required facts** | `fact_appointment`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-FUN-004`, `KPI-FUN-005` |
| **Reporting view** | `reporting.vw_appointments`, `reporting.vw_appointment_funnel`, `reporting.vw_employee` |
| **Intended future report page** | 5. Employee Performance |
| **Decision enabled** | Which of the team to pair on the next appointment, and what to coach. |
| **Interpretation caution** | The two rates use **different date bases** -- show rate on the scheduled date, show-to-sale on the show date -- so a visual carrying both must say which each uses. Both are computed over appointments, not leads: one lead can produce several appointments, so these denominators are not the lead denominators. |
| **Implementation status** | **Implemented** |


### SQ-29 — Fixed-operations manager

| Field | Value |
|---|---|
| **Persona** | Fixed-operations manager |
| **Business question** | *Which service customers represent credible vehicle-replacement opportunities?* |
| **Required dimensions** | `dim_customer`, `dim_vehicle` |
| **Required facts** | `fact_service_visit` (Deferred) |
| **KPI IDs** | None -- service-to-sales conversion is Deferred |
| **Reporting view** | None. **The MVP cannot answer this question.** |
| **Intended future report page** | 8. Customer and Service Opportunities (blocked) |
| **Decision enabled** | None today. Recorded so the gap is visible rather than absent. |
| **Interpretation caution** | `warehouse.fact_service_visit` is Deferred. When it is built, service-to-sales opportunity logic must be presented as **decision support, never as a guarantee of customer purchase intent**. |
| **Implementation status** | **Deferred** |


### SQ-30 — New-car manager

| Field | Value |
|---|---|
| **Persona** | New-car manager |
| **Business question** | *How is new-vehicle volume and gross tracking, and is new inventory turning?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_vehicle_model` |
| **Required facts** | `fact_vehicle_sale`, `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-SLS-002`, `KPI-GRS-001`, `KPI-GRS-004`, `KPI-INV-008` |
| **Reporting view** | `reporting.vw_sales_summary`, `reporting.vw_gross_summary`, `reporting.vw_inventory_turn`, `reporting.vw_vehicle` |
| **Intended future report page** | 2. Sales and Gross / 3. Inventory Health |
| **Decision enabled** | Whether to change allocation requests or new-vehicle pricing. |
| **Interpretation caution** | **New-vehicle front gross in ARPI is systematically understated**, because manufacturer incentives, holdback and floorplan credits are excluded from the model. That is a modelling boundary, not a finding, and no reader may be told ARPI front gross reflects real-world new-car profitability. New and used turn rates are not comparable and are never blended. |
| **Implementation status** | **Implemented** |


### SQ-31 — Dealer principal

| Field | Value |
|---|---|
| **Persona** | Dealer principal |
| **Business question** | *Are we hitting our operating targets, by store and by department?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee` |
| **Required facts** | `fact_sales_target` (Deferred) |
| **KPI IDs** | None -- target attainment is Deferred |
| **Reporting view** | None. **The MVP cannot answer this question.** |
| **Intended future report page** | 1. Executive Overview (component blocked) |
| **Decision enabled** | None today. Recorded because [ARCHITECTURE.md §19.4](../../ARCHITECTURE.md) lists target attainment as an Executive Overview component, and its absence would otherwise read as an oversight. |
| **Interpretation caution** | Target values would be **fictional operating goals for a fictional group**, never industry benchmarks. The component stays absent until the fact exists and the fiction is labelled. |
| **Implementation status** | **Deferred** |


### SQ-32 — General manager

| Field | Value |
|---|---|
| **Persona** | General manager |
| **Business question** | *Which customer cohorts come back, and how often?* |
| **Required dimensions** | `dim_customer`, `dim_date` |
| **Required facts** | `fact_vehicle_sale` with full history |
| **KPI IDs** | None -- repeat-customer rate is Deferred |
| **Reporting view** | None. **The MVP cannot answer this question.** |
| **Intended future report page** | 8. Customer and Service Opportunities (blocked) |
| **Decision enabled** | None today. |
| **Interpretation caution** | The MVP window is six months on the `development` profile, which is far shorter than a vehicle ownership cycle. `dim_customer.is_prior_customer` exists but describes a relationship that predates the generated window rather than one observable inside it. |
| **Implementation status** | **Deferred** |


### SQ-33 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *Which model lines sell quickly and which sit?* |
| **Required dimensions** | `dim_vehicle_model`, `dim_vehicle`, `dim_date`, `dim_dealership` |
| **Required facts** | `fact_vehicle_sale`, `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-SLS-003`, `KPI-INV-001`, `KPI-INV-007` |
| **Reporting view** | `reporting.vw_vehicle_model`, `reporting.vw_days_to_sale`, `reporting.vw_inventory_health`, `reporting.vw_sales_summary` |
| **Intended future report page** | 3. Inventory Health / 2. Sales and Gross |
| **Decision enabled** | What to buy next, and what to stop buying. |
| **Interpretation caution** | At `development` scale a single model line carries few units, so a days-to-sale figure per model is a small-sample statistic. Read the distribution, not the point estimate, and prefer `vehicle_class` or `body_style` groupings where the model-level count is thin. |
| **Implementation status** | **Implemented** |


### SQ-34 — Marketing manager

| Field | Value |
|---|---|
| **Persona** | Marketing manager |
| **Business question** | *Are campaigns generating leads outside the segment they target, and does that change their return?* |
| **Required dimensions** | `dim_marketing_campaign`, `dim_lead_source`, `dim_vehicle_model`, `dim_date` |
| **Required facts** | `fact_marketing_spend`, `fact_lead`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-MKT-003` |
| **Reporting view** | `reporting.vw_marketing_campaign`, `reporting.vw_marketing_performance` |
| **Intended future report page** | 6. Marketing Performance |
| **Decision enabled** | Whether a campaign's targeting is worth adjusting, or whether the off-target leads are the profitable ones. |
| **Interpretation caution** | Campaigns **do** generate leads outside their target segment; that is modelled deliberately, so attribution logic must not assume perfect targeting. `target_vehicle_category` states the campaign's intent, not its outcome, and comparing the two is the analysis rather than a data-quality problem. |
| **Implementation status** | **Implemented** |


### SQ-35 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Which customer cohorts and market areas produce our most profitable deals?* |
| **Required dimensions** | `dim_customer`, `dim_date`, `dim_dealership` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-GRS-006` |
| **Reporting view** | `reporting.vw_customer`, `reporting.vw_vehicle_sales`, `reporting.vw_gross_summary` |
| **Intended future report page** | 2. Sales and Gross |
| **Decision enabled** | Where to aim conquest marketing. |
| **Interpretation caution** | Geography is **county and market area only** -- no street address, postal code or coordinate exists anywhere in ARPI -- and age is a band. Cohort analysis at this resolution supports comparison, not targeting of individuals, and must never be presented as if it identified people. Small cohorts also produce unstable per-unit gross figures; publish the unit count beside the ratio. |
| **Implementation status** | **Implemented** |

---

## 5. Unattributed KPIs and orphan views

**None.** All 29 KPI identifiers in [KPI_CATALOG.md](../../KPI_CATALOG.md) are cited by at least one
question above, and all 28 views in the `reporting` schema support at least one. Both directions are
asserted by `tests/integration/test_stakeholder_question_traceability.py`, which reads
`arpi.constants.KPI_IDS` and `arpi.constants.REPORTING_VIEWS` and fails if either gains a member this
document does not cite.

Eight dimension views and four operational views own no KPI. They are cited here through the questions they
make answerable — a dimension supplies grain and context, and the data-quality views answer the question
that has to be settled before any other page is read. The reasoning is recorded per view in
[`powerbi/model_documentation/04-reporting-view-to-kpi-map.md` §2.1](../../powerbi/model_documentation/04-reporting-view-to-kpi-map.md).

---

## 6. Questions the MVP cannot answer

Four, listed above with full detail: `SQ-21` (F&I product penetration), `SQ-29` (service-to-sales
opportunities), `SQ-31` (target attainment), `SQ-32` (customer retention). Each is blocked by a **Deferred
fact**, not by a gap in the reporting layer:

| Question | Blocked by | Status in [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) |
|---|---|---|
| `SQ-21` | `warehouse.fact_finance_product_sale` | Deferred |
| `SQ-29` | `warehouse.fact_service_visit` | Deferred |
| `SQ-31` | `warehouse.fact_sales_target` | Deferred |
| `SQ-32` | Full purchase history beyond the generated window | Deferred |

Adding any of these domains requires Gate 4 ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)): a stakeholder
question must require it, the fact grain must be defined, KPI ownership must be defined, and testing
requirements must be defined. The first of those four conditions is now satisfied and recorded here, which
is the point of this document.

---

## 7. Change control

- A new question needs a new permanent `SQ-NN` identifier. Identifiers are never reused.
- A question whose KPIs become computable moves from `Deferred` to `Implemented` **in the same change** that
  makes them computable, never in advance.
- Every KPI added to [KPI_CATALOG.md](../../KPI_CATALOG.md) must be cited by a question here, or listed in
  §5 as explicitly unattributed. The traceability test enforces the choice rather than allowing silence.
- Every view added to the `reporting` schema must support a question here, for the same reason.
