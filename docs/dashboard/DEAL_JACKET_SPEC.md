# Deal Jacket Specification — `/dashboard/deals/[saleId]`

**Status:** Planning contract; `DASH.4` implements the base jacket, `DASH.7` itemizes F&I,
`DASH.O-1` would add multi-trade detail.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[DATA_CONTRACT.md](DATA_CONTRACT.md) · [KPI_EXTENSION_PLAN.md](KPI_EXTENSION_PLAN.md) ·
[PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md)

The Deal Jacket is the sanitized, explainable record of one finalized synthetic transaction. It must
read like a dealership deal recap — identity, vehicle, money, people, paper trail — while carrying
its own arithmetic verification and lineage. It is a record view, not a workflow: nothing on it can
be edited, assigned, approved, or submitted.

---

## 1. Route contract

- Path: `/dashboard/deals/[saleId]`; `saleId` is the business code `SLE-########` (`sale_id` from
  `warehouse.fact_vehicle_sale`), never the surrogate `sale_key`.
- Source: the deal's row in the `vw_deal_jacket` export chunk (contract §9). One deal's payload per
  page; no adjacent-deal data.
- Invalid or unknown id → 404 page with a link to `/dashboard/deals`.
- Rendering mode per the `DASH.4-01` measured decision (static generation vs server render); either
  way the page is complete HTML without JavaScript.

## 2. Persistent disclosure

The header region always carries: "Fictional transaction from the synthetic Granite Auto Group
dataset. Not a real sale, customer, or dealership record." — in the body, above the fold, in
addition to the route's standard `TrustLine`.

## 3. Header — deal identity

Synthetic deal id · sale date · delivery date · store (name + `GSA-00#`) · deal status (always
"Finalized" — canceled deals never reach the fact; the label says why in a disclosure) · sale type ·
finance structure (derived per program §9.7) · reconciliation state chip (§14).

## 4. Vehicle section

Synthetic stock number · masked synthetic VIN-style identifier (the `ARPI…` synthetic VIN, displayed
with its policy note per ADR-0005) · year / make / model / trim · condition · body style · odometer
band (banded, not exact) · inventory source · acquisition date · days in inventory at sale ·
original asking price · final asking price · MSRP where applicable ("Not applicable" on used units
without one).

## 5. Front-gross calculation

Rendered as a labeled arithmetic block, in this exact order, using the exported exact decimals:

```text
Sale price
− Acquisition cost
− Reconditioning cost
− Pack amount
= Front-end gross
```

Beneath it: discount from original asking price, discount from final asking price, discount from
MSRP where applicable, and the **formula verification state** — the page recomputes the identity
from the displayed components with exact-decimal arithmetic and shows "verified to the cent" or a
failure state (which the corrupted-fixture e2e test forces). Trade variance is **not** in this
formula; a note names the ARPI definition and links the KPI entry (`KPI-GRS-001`). Manufacturer
holdback, dealer cash, stair-step money, floorplan credits, and unposted adjustments are excluded by
model and the limitations drawer says so.

## 6. Trade section

When a trade exists: trade allowance · trade ACV · allowance-versus-ACV difference (labeled "trade
variance", shown separately from front gross) · payoff and equity ("Not modelled" until `DASH.O-1`
adds them — the row states that honestly) · trade vehicle and disposition when the optional trade
fact exists. When no trade exists: the section renders a single "Not applicable — no trade on this
deal" state, never zeros.

## 7. Finance structure

Structure (Cash / Retail Finance / Lease) · amount financed · cash down · synthetic lender and
lender category (after `DASH.6`; "Not applicable" for cash) · finance reserve gross (after
`DASH.6`). **No APR, term, payment, buy/sell rate, or spread appears anywhere** — the boundary of
[PRIVACY_AND_ETHICS.md §7](../../PRIVACY_AND_ETHICS.md), restated in the drawer.

## 8. F&I product section (`DASH.7`)

One row per product: category · product name · provider · eligibility rule satisfied (`ELIG-*`) ·
retail price · dealer cost · original gross · cancellation amount · chargeback amount · current net
gross · contract status (Active / Cancelled / Charged back / Reinstated). Totals beneath: finance
reserve gross · original product gross · net product gross · back-end gross · **back-gross
reconciliation state** (`back_end_gross = reserve + net product gross + other F&I income (0.00)`,
verified to the cent). Until `DASH.7`, the section shows aggregate back gross labeled "aggregate —
product itemization arrives with the F&I model increment".

## 9. Total deal gross

```text
Front-end gross
+ Back-end gross
= Total gross
```

With exact verification against the exported `total_gross` (`KPI-GRS-003` lineage).

## 10. Staff attribution

Salesperson · desk manager · finance manager · BDC employee where linked — each as synthetic id +
role + store, linking to the employee page's filtered view. **No names.** Synthetic IDs are the
approved presentation; absent roles render "Not applicable" (e.g. wholesale) or "Unattributed" where
the synthetic policy allows absence.

## 11. Lead and appointment timeline

When a lead links to the deal: lead created (timestamp) → first response (elapsed time, or "never
responded") → contacted → appointment set → appointment date → showed → test drive → write-up →
sale → delivery, each with its date where modelled. Flags come from `fact_lead` /
`fact_appointment`; stages the data cannot distinguish render as unavailable rather than invented.
**No message content, notes, emails, phone numbers, or free-form text** — none exists in the model,
and the drawer says that this is by design. Unlinked deals state "No linked lead — walk-in or
unattributed."

## 12. Accounting checks

A checklist rendered from data, each with pass/exception state: front-gross identity ·
back-gross reconciliation (`DASH.7`) · total-gross identity · product eligibility (`DASH.7`) ·
product-adjustment validity (`DASH.7`) · sale-to-inventory relationship (unit existed and was
active) · sale/delivery date validity · source lineage (chunk hash matches manifest).

## 13. KPI and lineage drawer

A `Disclosure` listing: the KPI ids this deal feeds (`KPI-SLS-001`, `KPI-GRS-001..006`, days-to-sale,
funnel KPIs where linked, FNI/ACC after their increments) with plain-English definitions and
formulas; the source reporting view (`reporting.vw_deal_jacket`) and fact grain; the date basis; the
export dataset name, version, and file hash; and known limitations (synthetic data, excluded gross
components, banded odometer).

## 14. Reconciliation state chip

Header chip summarizing §12: "All checks passed" or "N checks need review", using the existing
status-badge vocabulary (verified/pending/blocked tones, icon + word, never color alone).

## 15. Empty and not-applicable states

Every section defines its absent state above; the global rule: **"Not applicable" for
structurally-absent, "Not modelled" for out-of-scope, "No data" for missing-but-expected** (the last
is also an accounting-check exception). Zeros are real zeros only.

## 16. Responsive presentation

Desktop (≥1024px): two-column operating layout — money columns (front gross, F&I, totals) right,
identity/vehicle/people/timeline left. Mobile: single column preserving the §5→§9 calculation order;
wide tables become the established stacked-card pattern with exactly one representation in the
accessibility tree; monetary alignment kept readable (tabular numerals via the `numeric` utility);
all controls ≥44px; heading hierarchy unchanged across breakpoints; no horizontal page overflow at
320px.

## 17. Print behavior

A print stylesheet delivers a paper deal recap: synthetic disclosure (first), deal identity, vehicle,
front-gross block, F&I table, total gross, reconciliation checklist, data as-of date and dataset
version. Not printed: site header/footer, dashboard navigation, filter bar, interactive controls,
drawers (their content prints expanded via the existing `arpi-disclosure` print-open rule where it
is content, and is dropped where it is navigation).

## 18. Accessibility requirements

Axe-clean at 375/1440; keyboard-complete; every check state carries icon + text; the calculation
blocks are semantic (`<dl>` or table, not positioned divs); the timeline is an ordered list; section
landmarks via headings; print view retains reading order.

## 19. Test cases (minimum, from the development-profile fixtures)

| Case | Must assert |
|---|---|
| Standard financed retail deal with trade | Every section populated; identities verified |
| No-trade deal | §6 renders Not applicable, no zeros |
| Trade with allowance ≠ ACV | Variance shown separately; front gross unchanged |
| Negative front-gross deal | Negative rendered signed and unhidden (§19.6 architecture rule) |
| Cash deal | No reserve, structure Cash, lender Not applicable |
| Lease | Structure Lease; lease-eligible products only (`DASH.7`) |
| Wholesale / dealer trade | Retail-only sections Not applicable; no customer required |
| Used unit without MSRP | MSRP Not applicable; MSRP discount absent |
| Deal without linked lead | §11 unlinked state |
| Multiple products incl. a cancelled and a charged-back contract (`DASH.7`) | Net gross arithmetic; statuses; back-gross reconciliation |
| Invalid `saleId` | 404 with return link |
| Corrupted fixture (broken identity) | Verification failure state renders; page does not hide it |
| Print mode | §17 include/exclude list |
