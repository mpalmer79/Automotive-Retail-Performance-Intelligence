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
| Questions recorded | 42 |
| Personas covered | 12 of 12 from `docs/research.md` §11.3 |
| Questions answerable today | 39 |
| Questions that cannot be answered, recorded with the blocking fact | 3 |
| MVP KPIs traced to at least one question | **29 of 29** — no unattributed KPI |
| Inventory Listings KPIs traced to at least one question | **24 of 24** — no unattributed KPI |
| Targets and pace KPIs traced to at least one question | **10 of 10** — all anchored by `SQ-31` |
| Reporting views supporting at least one question | **39 of 39** — no orphan view |

The recorded count was stated as 41 against 42 questions and the answerable count as 37; both were
one behind the document beneath them before this change, and are corrected here. The answerable count
then moved again, and the blocked count from 4 to 3, for one reason: `DASH.5`
promoted `warehouse.fact_sales_target` and **`SQ-31` became answerable** (§6). The three KPI registers
are counted on their own rows rather than summed, because `29 of 29` is the MVP baseline the semantic
model was measured against and folding two more families into it would restate history rather than
record a capability (§5).

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
| **Reporting view** | `reporting.vw_gross_summary`, `reporting.vw_sales_summary`, `reporting.vw_sales_gross_trend`, `reporting.vw_calendar`, `reporting.vw_dealership` |
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
| **Reporting view** | `reporting.vw_sales_summary`, `reporting.vw_sales_gross_trend`, `reporting.vw_vehicle`, `reporting.vw_vehicle_model` |
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
| **Reporting view** | `reporting.vw_gross_summary`, `reporting.vw_sales_gross_trend`, `reporting.vw_deal_explorer`, `reporting.vw_vehicle_sales` |
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
| **Reporting view** | `reporting.vw_inventory_health`, `reporting.vw_inventory_aging`, `reporting.vw_inventory_snapshots`, `reporting.vw_inventory_units` |
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
| **Interpretation caution** | **The denominator includes cash deals**, which cannot generate finance reserve, so a store with an unusual cash mix shows a lower figure for reasons unrelated to finance-office skill. `reporting.vw_fi_summary` now publishes `cash_deal_count` beside `retail_units`, so that caution is checkable from the data rather than only stated here. **`DASH.6` made back-end gross explainable beneath the aggregate**: `KPI-GRS-002` keeps its definition unchanged, and `RECON-FI-001` proves that every cent of it is `finance_reserve_gross + SUM(original_product_gross)`, with `other_fi_income` exactly `0.00`. A product-mix narrative is therefore now supported — but only on the basis it is computed on: deal-date gross and as-of net gross are different reads and are not comparable without stating both. |
| **Implementation status** | **Implemented** |


### SQ-21 — Finance director

| Field | Value |
|---|---|
| **Persona** | Finance director |
| **Business question** | *Which finance products have weak or inconsistent penetration, and what do cancellations cost us?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_employee`, `dim_vehicle`, `dim_finance_product`, `dim_lender` |
| **Required facts** | `fact_finance_product_sale`, `fact_finance_product_adjustment`, `fact_vehicle_sale` |
| **KPI IDs** | `KPI-FNI-001`, `KPI-FNI-002`, `KPI-FNI-003`, `KPI-FNI-004`, `KPI-FNI-005`, `KPI-FNI-006`, `KPI-FNI-007`, `KPI-FNI-008`, `KPI-FNI-009`, `KPI-FNI-010`, `KPI-FNI-011`, `KPI-FNI-012`, `KPI-FNI-013`, `KPI-FNI-014`, `KPI-FNI-015`, `KPI-FNI-016`, `KPI-FNI-017`, `KPI-FNI-018`, `KPI-FNI-019`, `KPI-FNI-020`, `KPI-FNI-021`, `KPI-FNI-022` |
| **Reporting view** | `reporting.vw_fi_product_penetration`, `reporting.vw_fi_adjustment_summary`, `reporting.vw_fi_summary`, `reporting.vw_deal_product_detail` |
| **Intended future report page** | 7. F&I Performance (`DASH.7` owns the surface; the data exists from `DASH.6`) |
| **Decision enabled** | Which products to renegotiate, retrain on, or stop offering; where cancellation and chargeback exposure actually sits, by store, manager and category. |
| **Interpretation caution** | **Penetration is meaningless without its denominator, and the denominator is the thing that is easy to get wrong.** Every penetration figure names its `ELIG-*` rule and publishes both sides as counts: GAP penetration is over **financed** retail deals, because a cash buyer has no loan for GAP to cover, and Prepaid Maintenance is over **New and Certified** deals only. Penetration counts **distinct deals**, never contract rows. **Three date bases, never blended**: deal-date gross, as-of net gross, and adjustment-period impact; `KPI-FNI-014`, `-015` and `-018` are explicitly **mixed-basis period proxies and not cohort loss rates**, because the contracts charged back in a month are mostly not the ones written in it. **Manager comparisons inherit store mix, structure mix and eligibility mix** and are subject to the minimum-sample rule; no manager is ranked or labelled by the model. **Every product, administrator and lender is fictional and every price, penetration and adjustment rate is a configured synthetic distribution** — none is an industry benchmark, and there is no "good" or "bad" penetration rate. The reporting window truncates the adjustment lag distribution, so the most recent months carry structurally fewer cancellations and chargebacks. **The pre-`DASH.6` warning still stands for anything built on the MVP alone**: before `warehouse.fact_finance_product_sale` existed, `KPI-GRS-002` gave the total and nothing beneath it, and any product-mix narrative over that period would have been fabricated. |
| **Implementation status** | **Implemented** (`DASH.6`) |


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
| **Required facts** | `warehouse.fact_sales_target` (Implemented, `DASH.5`), `warehouse.fact_vehicle_sale` |
| **KPI IDs** | `KPI-TGT-001`, `KPI-TGT-002`, `KPI-TGT-003`, `KPI-TGT-004`, `KPI-TGT-005`, `KPI-TGT-006`, `KPI-TGT-007`, `KPI-TGT-008`, `KPI-TGT-009`, `KPI-TGT-010` |
| **Reporting view** | `reporting.vw_target_attainment` |
| **Intended future report page** | 1. Executive Overview (targets and pace section) / 2. Sales and Gross |
| **Decision enabled** | Whether to change desk strategy, staffing or marketing spend with selling days still left in the month — and, at month end, whether the plan itself was set at the right level. The selling-day pace projection answers "are we going to make it" without pretending to be a forecast. |
| **Interpretation caution** | **Every target is a synthetic internal operating goal for the fictional Granite Auto Group.** It is not an industry benchmark, a manufacturer objective, a market standard or any real dealership's plan, and no reader may treat an attainment percentage here as evidence about real-world performance. The projected month-end figure is a **selling-day pace projection**: linear arithmetic over the governed selling-day calendar, never a forecast, a prediction, AI, machine learning or a probability — and it ignores within-month trading shape by construction, so an early-month figure moves more than a late-month one. On the committed `development` profile the dataset's as-of date is the last day of the last month in the window, so **every month is complete**: attainment is final, no selling days remain, and the projection equals the actual. The console says so rather than presenting a completed month as forward-looking. Department attainment is answered for GROSS only, by the exact front/back partition described below; retail units are store-scope, because a unit is delivered once and attributing it to two departments would count the same car twice. |
| **Implementation status** | **Implemented** (`DASH.5`) |

**How the question's two halves are answered, and where one of them stops.**

*The selling-day clock.* `KPI-TGT-005` (selling days elapsed) and `KPI-TGT-006` (selling days
remaining) come from `warehouse.dim_date.is_selling_day` and nothing else. `KPI-TGT-007` and
`KPI-TGT-008` divide the month-to-date actual by the elapsed days to give a run rate per selling
day, and `KPI-TGT-009` and `KPI-TGT-010` multiply that rate by the month's selling days to give the
**selling-day pace projection**. All six answer the second half of what a dealer principal actually
means by "are we hitting our targets": not only whether the month is behind, but whether there is
enough selling capacity left to catch up.

*By store.* `warehouse.fact_sales_target` carries a Store-scope plan row per store-month for
retail units (`KPI-SLS-001`) and total gross (`KPI-GRS-003`). `KPI-TGT-001` and `KPI-TGT-003`
are those plans; `KPI-TGT-002` and `KPI-TGT-004` divide the month-to-date actual by them, from
summed numerators and summed denominators over the same subset of stores rather than by
averaging store percentages.

*By department.* A department target needs a department **actual**, and the actual has to be
attributable without double counting. `warehouse.fact_vehicle_sale` enforces
`total_gross = front_end_gross + back_end_gross` as a CHECK constraint, so front and back are an
exact partition of the store's total gross: the **Sales** department owns the front end
(`KPI-GRS-001`) and the **Finance** department owns the back end (`KPI-GRS-002`), and the two
together are the store total with no overlap and no gap. That is also how a dealership plans —
total gross forecast = vehicle gross + F&I gross — so the model matches the operating reality
rather than the other way round. `DQ-TGT-012` and `RECON-TGT-DEPT-SPLIT` assert that the two
department plans sum to the store plan to the cent.

*Where it stops, stated rather than hand-waved.* Three of the five values of
`dim_employee.department` own no component of that identity. **BDC** is measured in the lead
funnel and produces no gross line of its own; **Management** is accountable for the store line
rather than a separate one; **Service** has no fact at all (`warehouse.fact_service_visit` is
Deferred, and `SQ-29` records that gap). A target for any of them would have a numerator that
does not exist, so none is permitted — the fact's `ck_fact_sales_target_scope_metric` constraint
refuses one. **Retail units are store-scope only** for the same class of reason: a retail unit
is delivered once, a Sales-department unit target would reproduce the store target, and a
Finance-department one would count the same car a second time. F&I measures are computed *per*
the sales department's unit count, never on a second unit count of their own.

*Employee scope* is part of the permanent vocabulary and is physically supported by the fact —
nullable `employee_key`, CHECK-coupled to the scope type, foreign key to `warehouse.dim_employee`
— and is deliberately **not populated** by `DASH.5`. No registered question requires
employee-scope targets, `DASH.11` owns the employee-performance surface, and Gate 4 forbids
adding data no question requires. No exported column identifies an employee.


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

### SQ-36 — General manager

| Field | Value |
|---|---|
| **Persona** | General manager |
| **Business question** | *What is actually visible to a shopper on our website today, and how much of it shows a price?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_observed_vehicle` |
| **Required facts** | `fact_vehicle_listing_snapshot` |
| **KPI IDs** | `KPI-LST-001`, `KPI-LST-002`, `KPI-LST-003`, `KPI-LST-004`, `KPI-LST-005`, `KPI-LST-006`, `KPI-LST-022`, `KPI-LST-023`, `KPI-LST-024` |
| **Reporting view** | `reporting.vw_vehicle_listing_summary`, `reporting.vw_vehicle_listing_current`, `reporting.vw_vehicle_listing_price_completeness` |
| **Intended future report page** | 8. Inventory Operations |
| **Decision enabled** | Where to direct merchandising effort: which vehicles a shopper cannot price without calling. |
| **Interpretation caution** | This is a **sanitized public listing snapshot** (ADR-0011), not DMS inventory. A row proves a listing was visible, not that the vehicle was on the ground or owned. Call-for-price is a legitimate merchandising choice for pre-order, fleet and in-transit units, so a low completeness figure is a prompt to look, not a defect. **A low figure can also mean the listing surface publishes no price field at all**, which is a different thing and is counted separately as `KPI-LST-023`; the answer to "how many vehicles are missing from the price statistics" is `KPI-LST-024`, and the answer to "why" is the split between the two. `KPI-LST-022` is published beside every figure because a stale capture must never be read as a current position. |
| **Implementation status** | **Implemented** |


### SQ-37 — Used-car manager

| Field | Value |
|---|---|
| **Persona** | Used-car manager |
| **Business question** | *What is our advertised price spread by model and trim, and where are we the outlier?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_observed_vehicle` |
| **Required facts** | `fact_vehicle_listing_snapshot` |
| **KPI IDs** | `KPI-LST-007`, `KPI-LST-008`, `KPI-LST-009`, `KPI-LST-010`, `KPI-LST-011`, `KPI-LST-012`, `KPI-LST-013` |
| **Reporting view** | `reporting.vw_vehicle_listing_model_mix`, `reporting.vw_vehicle_listing_summary` |
| **Intended future report page** | 8. Inventory Operations |
| **Decision enabled** | Which model and trim groups to re-shop against the market. |
| **Interpretation caution** | Advertised price is **not** transaction price, acquisition cost, inventory investment, MSRP or gross, so neither the store-level total (`KPI-LST-007`) nor any spread says anything about margin — this lane holds no cost of any kind. Call-for-price units are excluded from every price statistic, and the count of them is published beside each one. A group of one vehicle produces an "average" equal to that vehicle; read every statistic with its unit count. |
| **Implementation status** | **Implemented** |


### SQ-38 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *What changed on the website since the last capture — what appeared, what came off, and what got repriced?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_observed_vehicle` |
| **Required facts** | `fact_vehicle_listing_snapshot` |
| **KPI IDs** | `KPI-LST-014`, `KPI-LST-015`, `KPI-LST-016`, `KPI-LST-017`, `KPI-LST-018` |
| **Reporting view** | `reporting.vw_vehicle_listing_change` |
| **Intended future report page** | 8. Inventory Operations |
| **Decision enabled** | Whether merchandising activity is happening at the pace the store intends. |
| **Interpretation caution** | **A removed listing is not a sale.** It can reflect a sale, a trade, a wholesale, a feed suppression or an error, and this data cannot tell them apart — `reporting.vw_vehicle_listing_change` emits six labels and none of them is *Sold*. "New Listing" means newly **observed**, not newly acquired. Every count must be read with `days_between_snapshots`: eleven price reductions means something different over one day than over one quarter. On a store's first capture there is nothing to compare against, and the view says so rather than returning an empty result. |
| **Implementation status** | **Implemented** |


### SQ-39 — Regional operations manager

| Field | Value |
|---|---|
| **Persona** | Regional operations manager |
| **Business question** | *How long has each advertised vehicle been visible online, and which ones have been sitting there longest?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_observed_vehicle` |
| **Required facts** | `fact_vehicle_listing_snapshot` |
| **KPI IDs** | `KPI-LST-019`, `KPI-LST-020`, `KPI-LST-021` |
| **Reporting view** | `reporting.vw_vehicle_listing_observation_span` |
| **Intended future report page** | 8. Inventory Operations |
| **Decision enabled** | Which advertised units to review first for merchandising attention. |
| **Interpretation caution** | **Days observed online is not days in stock.** Days in stock runs from acquisition, is recorded by the DMS, and lives on `warehouse.fact_vehicle_inventory_snapshot`; this lane cannot produce it because it never sees an acquisition. The span is bounded below by the capture cadence — a vehicle seen once has a span of zero, meaning "seen once", not "listed for no time" — and above by when observation began. It must be read with `snapshot_count` and `observation_gap_days`, because a 30-day span built from two captures is not the evidence a 30-day span built from thirty captures is. |
| **Implementation status** | **Implemented** |



### SQ-40 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Total gross moved against last month: was that units, or was it what we earned per unit?* |
| **Required dimensions** | `dim_date`, `dim_dealership` |
| **Required facts** | `fact_vehicle_sale` |
| **KPI IDs** | `KPI-GRS-003`, `KPI-GRS-004`, `KPI-GRS-005`, `KPI-GRS-006` |
| **Reporting view** | `reporting.vw_gross_change_bridge`, `reporting.vw_sales_gross_trend` |
| **Intended future report page** | 2. Sales and Gross |
| **Decision enabled** | Which lever to pull. A volume shortfall and a rate shortfall need opposite responses, and a month that sold more units at a worse rate looks identical to a good month in the total alone. |
| **Interpretation caution** | **This is an attribution under a documented arithmetic order, not a cause.** The bridge assigns the change to volume, front PVR and back PVR by pricing the volume change at the comparison period's rate and then valuing each rate change at the current period's volume; a different order assigns different amounts for the same total, which is why the order is fixed and published. It does not know why volume or rate moved, and nothing derived from it may implicate a person, a department, an inventory position or a marketing spend. A month whose comparison period sold no retail units has **no baseline rate and therefore no decomposition** — the view returns the period change with the components withheld and a reason, rather than substituting a zero rate. No mix effect is published: it is a legitimate fourth term, but only once its place in the sequence is documented. |
| **Implementation status** | **Implemented** |


### SQ-41 — General sales manager

| Field | Value |
|---|---|
| **Persona** | General sales manager |
| **Business question** | *Which individual deals produced this result, and which of them lost money on the front?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_vehicle_model`, `dim_employee`, `dim_lead_source` |
| **Required facts** | `fact_vehicle_sale`, `fact_lead` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-GRS-001`, `KPI-GRS-002`, `KPI-GRS-003`, `KPI-INV-007` |
| **Reporting view** | `reporting.vw_deal_explorer` |
| **Intended future report page** | 2. Sales and Gross / 2a. Deal Explorer |
| **Decision enabled** | Which deals to review individually. An aggregate says a month was weak; only the deal list says whether that was three catastrophic transactions or forty ordinary ones, and those need entirely different responses. |
| **Interpretation caution** | **A negative front-end gross is a real dealership outcome, not a data defect**, and the index shows it with its sign rather than suppressing it: a store may knowingly take a loss on the front to hold a customer, move an aged unit or earn back-end. Wholesale disposals and dealer trades appear in the list and are labelled as not retail — they are real transactions, and judging them by retail measures is the error, not showing them. Lead attribution is resolved through the lead linked to the deal, so a deal with no linked lead is genuine walk-in or unattributed business rather than missing data, and the two are never collapsed. The index carries **no customer attribute of any kind** and no cost structure; the deal's cost components belong to the Deal Jacket. |
| **Implementation status** | **Implemented** |

### SQ-42 — Controller / general sales manager

| Field | Value |
|---|---|
| **Persona** | Controller, general sales manager, dealer principal |
| **Business question** | *This one deal shows a front gross of $994.83. Where exactly did that number come from, and can I check it?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_vehicle_model`, `dim_employee`, `dim_lead_source` |
| **Required facts** | `fact_vehicle_sale`, `fact_lead`, `fact_appointment`, `fact_vehicle_inventory_snapshot` |
| **KPI IDs** | `KPI-SLS-001`, `KPI-GRS-001`, `KPI-GRS-002`, `KPI-GRS-003`, `KPI-INV-007` |
| **Reporting view** | `reporting.vw_deal_jacket` |
| **Intended future report page** | 2b. Deal Jacket |
| **Decision enabled** | Whether to trust the aggregate. Every number above a deal is a sum of deals, and a manager who cannot open one transaction and see its arithmetic has to take the whole report on faith. This is the question that makes a reporting layer auditable rather than merely presentable: the jacket shows sale price less acquisition, reconditioning and pack, in that order, and the page recomputes the identity from those components rather than displaying the stored figure. |
| **Interpretation caution** | **"Verified to the cent" is a statement about internal consistency, not about reality.** It means the exported components recompute the exported gross exactly; the transaction is synthetic and did not happen. The front-end gross **excludes** manufacturer holdback, dealer cash, stair-step money, floorplan credits and unposted accounting adjustments, none of which is modelled, so it is understated by design in the same way new-vehicle gross is. **Trade variance is shown beside the calculation and is deliberately not inside it** — folding it in would change what `KPI-GRS-001` means. Back-end gross is **explained rather than aggregate**: since `DASH.6` the jacket resolves finance reserve and every product contract behind the deal, and `RECON-FI-001` proves reserve plus deal-date product gross accounts for the stored figure to the cent. What is still unsupportable is a **rate** statement: no APR, buy rate, sell rate, rate spread, money factor, term or payment exists anywhere in ARPI, by policy rather than by omission, and the lender is an assignment record with no credit decision behind it. Employees appear as synthetic identifiers with no name and no pay, and no judgement of an individual may be drawn from a single transaction. |
| **Implementation status** | **Implemented** |

### SQ-43 — Controller / office manager

| Field | Value |
|---|---|
| **Persona** | Controller, office manager, dealer principal |
| **Business question** | *Does the inventory on my stock schedule agree with what the general ledger says the inventory control account holds, and if not, where exactly does it differ?* |
| **Required dimensions** | `dim_date`, `dim_dealership`, `dim_vehicle`, `dim_gl_account` |
| **Required facts** | `fact_inventory_accounting_snapshot`, `fact_gl_control_balance`, `fact_vehicle_inventory_snapshot`, `fact_vehicle_sale`, `fact_finance_product_sale`, `fact_finance_product_adjustment` |
| **KPI IDs** | `KPI-ACC-001`, `KPI-ACC-002`, `KPI-ACC-003`, `KPI-ACC-004`, `KPI-ACC-005`, `KPI-ACC-006`, `KPI-ACC-007`, `KPI-ACC-008`, `KPI-ACC-009`, `KPI-ACC-010`, `KPI-ACC-011`, `KPI-ACC-012` |
| **Reporting view** | `reporting.vw_inventory_accounting`, `reporting.vw_inventory_gl_reconciliation`, `reporting.vw_accounting_exceptions` |
| **Intended future report page** | *(none — `DASH.8` is a database and reporting increment; no browser dataset is exported and no console route is added)* |
| **Decision enabled** | Whether the month can be closed, and where to look when it cannot. A controller who can see only a total variance knows something is wrong and nothing about what; the schedule totals to the control account by store and by account at a matched date, so a difference names the store, the account and the month before anybody opens a binder. The exception surface separates the two findings a controller must never conflate: a **reconciliation variance**, where two structurally valid balances disagree and somebody has to find out why, and a **data-quality exception**, where a rule the model asserts about itself does not hold. |
| **Interpretation caution** | **The GL control balances are generated from the same subledger they are reconciled against.** An exact reconciliation proves the reconciliation *arithmetic* is correct; it does **not** prove that two independent accounting systems agree, because there is only one source. **ARPI is building a focused inventory control schedule and its reconciliation. It is not building a general ledger** — there is no journal entry, no debit/credit pair, no posting batch, no trial balance, no period-close state and no financial statement anywhere in this project, and `KPI-ACC-002` is not a trial-balance figure. **A variance is not a defect**: both sides are valid data, `RECON-ACC-GL-SUBLEDGER` is registered non-critical for that reason, and the increment deliberately plants controlled variances so the surface can be seen working in both states. **A missing balance is NULL, never zero** — reporting an absent control balance as `0.00` would present a missing balance as a zeroed account. **Floorplan principal is a liability carried as context** and is never netted into book value; no net-inventory-position figure exists anywhere. **Pack is not a capitalized inventory cost** and `KPI-GRS-001` is unchanged. **`KPI-ACC-011` measures acquisition to first schedule appearance, not a journal posting delay** — ARPI holds no posting timestamp, and inventing one would manufacture an operational fact the synthetic data does not contain. Every account number and name is **invented**; no real dealer group's chart of accounts was consulted or approximated. |
| **Implementation status** | **Implemented** |

---

## 5. Unattributed KPIs and orphan views

**None.** All 29 MVP KPI identifiers, all 24 Inventory Listings KPI identifiers, all 10 Targets and
pace KPI identifiers, all 22 F&I KPI identifiers and all 12 inventory accounting KPI identifiers in
[KPI_CATALOG.md](../../KPI_CATALOG.md) are cited by at least one question above, and all 46 views in
the `reporting` schema support at least one. Both directions are asserted by
`tests/integration/test_stakeholder_question_traceability.py`, which reads
`arpi.constants.KPI_IDS`, `arpi.constants.INVENTORY_LISTING_KPI_IDS`,
`arpi.constants.TARGET_KPI_IDS`, `arpi.constants.FI_KPI_IDS`,
`arpi.constants.ACCOUNTING_KPI_IDS` and `arpi.constants.REPORTING_VIEWS` and fails if any of them
gains a member this document does not cite.

**The five KPI registers are counted separately and deliberately.** `29/29` is the MVP coverage
baseline the semantic model was measured against and it is unchanged. The Inventory Listings family,
the Targets and pace family, the F&I family and the inventory accounting family are governed,
documented and computed in SQL, and none is a semantic-model measure: folding any of them into the MVP
figure would restate a historical baseline rather than record a new capability. `SQ-31` is the only
question the Targets and pace family anchors, and it anchors all ten. `SQ-21` is the only question the
F&I family anchors, and it anchors all twenty-two; `SQ-20` is deepened by the same increment but keeps
`KPI-GRS-002` and `KPI-GRS-005` unchanged, because `DASH.6` explained back-end gross rather than
redefining it. `SQ-43` is the only question the inventory accounting family anchors, and it anchors all
twelve; `DASH.8` adds no browser dataset and no console route, so the family is computed in SQL and
read nowhere else.

Eight dimension views and four operational views own no KPI. They are cited here through the questions they
make answerable — a dimension supplies grain and context, and the data-quality views answer the question
that has to be settled before any other page is read. The reasoning is recorded per view in
[`powerbi/model_documentation/04-reporting-view-to-kpi-map.md` §2.1](../../powerbi/model_documentation/04-reporting-view-to-kpi-map.md).

---

## 6. Questions the MVP cannot answer

Two, listed above with full detail: `SQ-29` (service-to-sales opportunities) and `SQ-32` (customer
retention). Each is blocked by a **Deferred fact**, not by a gap in the reporting layer:

| Question | Blocked by | Status in [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) |
|---|---|---|
| `SQ-29` | `warehouse.fact_service_visit` | Deferred |
| `SQ-32` | Full purchase history beyond the generated window | Deferred |

**`SQ-21` was the third and is no longer blocked.** `DASH.6` promoted
`warehouse.dim_finance_product`, `warehouse.dim_lender`, `warehouse.fact_finance_product_sale` and
`warehouse.fact_finance_product_adjustment` from Deferred through the four Gate 4 conditions
([ARCHITECTURE.md §28](../../ARCHITECTURE.md)), and the evidence for each is recorded rather than
asserted. **The question predates the increment** and has been on this register, unanswerable, since
the MVP. **The grains are declared** in [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) and enforced
physically: `uq_fact_finance_product_sale_grain` over `(sale_key, finance_product_key)` and
`uq_fact_finance_product_adjustment_adjustment_id` over the event's own identifier. **KPI ownership**
is `KPI-FNI-001`…`KPI-FNI-022` in [KPI_CATALOG.md](../../KPI_CATALOG.md), each naming its governed SQL
owner among the four F&I reporting views. **The testing requirements** are the `DQ-FPD-*`, `DQ-LND-*`,
`DQ-FPS-*` and `DQ-FPA-*` families, the `RECON-FI-*` family — headed by `RECON-FI-001`, which proves
the deal-date back-gross identity to the cent on every deal — with a seeded corruption case per
critical rule, and an independent warehouse derivation per KPI in
`tests/integration/test_kpi_verification.py`. The promotion happened in the same change that made the
KPIs computable, which is what §7 requires.

**`SQ-43` is a new question, and `DASH.8` answered it in the same change that registered it.** The
four Gate 4 conditions ([ARCHITECTURE.md §28](../../ARCHITECTURE.md)) are met and the evidence is
recorded rather than asserted. **A registered stakeholder question requires the domain**: `SQ-43` above
asks whether the stock schedule agrees with the inventory control account, and no object in the
warehouse could answer it. **The grains are declared** in
[DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) and enforced physically:
`uq_fact_inventory_accounting_snapshot_grain` over `(accounting_date_key, dealership_key,
vehicle_key)` and `uq_fact_gl_control_balance_grain` over `(balance_date_key, dealership_key,
gl_account_key)`, each over three NOT NULL columns so PostgreSQL's NULL-distinctness rule cannot let a
duplicate logical row through. **KPI ownership** is `KPI-ACC-001`…`KPI-ACC-012` in
[KPI_CATALOG.md](../../KPI_CATALOG.md), each naming its governed SQL owner among the three accounting
reporting views. **The testing requirements** are the `DQ-IAS-*`, `DQ-GLA-*` and `DQ-GLB-*` families,
the `RECON-ACC-*` and `RECON-GLB-*` families — headed by `RECON-ACC-BOOK-IDENTITY`, which proves the
book-value identity per line and to the cent — with a seeded corruption case per critical rule, and an
independent warehouse derivation per KPI in `tests/integration/test_kpi_verification.py`.

**`SQ-31` was the fourth and is no longer blocked.** `DASH.5` promoted
`warehouse.fact_sales_target` from Deferred through the four Gate 4 conditions
([ARCHITECTURE.md §28](../../ARCHITECTURE.md)), and the evidence for each is recorded rather than
asserted: the question above required the domain and predates the increment; the fact's grain is
declared in [DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) and enforced physically by
`uq_fact_sales_target_grain` over five NOT NULL columns; KPI ownership is
`KPI-TGT-001`…`KPI-TGT-010` in [KPI_CATALOG.md](../../KPI_CATALOG.md), each naming
`reporting.vw_target_attainment` as its SQL owner; and the testing requirements are the `DQ-TGT-*`
family, the `RECON-TGT-*` family with a seeded corruption case per critical rule, and an independent
warehouse derivation per KPI in `tests/integration/test_kpi_verification.py`. The promotion happened
in the same change that made the KPIs computable, which is what §7 requires.

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
