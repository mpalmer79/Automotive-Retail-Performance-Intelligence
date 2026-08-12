# ARPI — product vision

**Status: PRODUCT VISION. Nothing in the "with authorized access" sections of this document is
implemented.** ARPI has no connection to any dealer management system, customer relationship
management system, F&I contracting platform, accounting system, inventory management tool, digital
retail platform, lead provider or marketing platform. Every figure the application renders is
produced from synthetic data generated inside this repository, for a fictional dealer group.

This document says what ARPI is, what it is for, and what it would become if a dealer group
authorized it to read their systems. The companion document,
[`PRODUCT_GAPS.md`](PRODUCT_GAPS.md), says what it cannot answer today, persona by persona and
question by question. Read them together: a vision without a gap analysis is a brochure.

---

## 1. What is ARPI?

ARPI is a **dealership management intelligence platform**: a governed analytical layer that connects
sales, gross, inventory, F&I, marketing, employee activity and accounting into one operating view.

**Positioning statement.** Turn fragmented dealership data into one trusted operating system for
management decisions.

**Mission statement.** ARPI gives dealership leadership one operating view of the business,
connecting sales, gross, inventory, F&I, marketing, employee activity and accounting so managers can
see what is happening, understand the operating context, drill into the transactions behind it, and
know where deeper investigation is required.

What it is *not*, stated first because the distinction is the whole design:

- Not a dealer management system. It does not write a deal, book a unit or post a journal entry.
- Not a CRM. It does not own a customer, assign a task or manage a follow-up.
- Not an F&I contracting platform. It does not produce a contract or transmit to a lender.
- Not an accounting system. It reconciles *against* a ledger; it does not restate one.
- Not a recommendation engine. It organizes evidence. The Management Action Center shipped in
  `DASH.12` and is a **deterministic queue**, not a recommender: every entry is produced by a
  registered rule with a permanent identifier, a governed threshold and three-valued logic over exact
  decimal arithmetic, so the same data and the same as-of date always produce the same queue. It ranks
  evidence a manager already owns and links to the transactions behind it; it does not score options,
  predict outcomes, or decide anything. No entry is a recommendation, and there is no task state —
  ARPI does not track whether anyone acted.
- Not artificial intelligence. There is no model, no inference and no prediction anywhere in it. The
  one "projection" it publishes is linear arithmetic over a governed selling-day calendar and says so
  wherever it appears.

## 2. What real dealership problems does it solve?

Five, and each is a problem of *reconciliation between systems* rather than of missing data. A
dealer group usually has every one of these numbers somewhere; what it does not have is one answer.

**One number, one meaning.** Front gross in the DMS report, front gross in the CRM dashboard and
front gross in the manufacturer's portal are three numbers, computed from three populations, on
three date bases. A management meeting spends its first twenty minutes deciding which one is real.
ARPI publishes each metric once, with its explicit numerator, denominator, grain, date basis,
inclusion rules and null rule, and every surface reads that one definition.

**A denominator you can defend.** Product penetration over "all deals" is not penetration: a
prepaid-maintenance product that cannot be sold on a used unit is being measured against used units.
Contact rate over all leads counts leads nobody could have contacted. ARPI computes every ratio
against its own governed eligible denominator, and withholds a comparative figure below a minimum
sample rather than printing a rate derived from four deliveries.

**The transaction behind the figure, in one motion.** Aggregate gross moved; the question is always
*which deals*. ARPI drills from a group figure to the store, to the day, to the deal, to the deal's
own front, back, trade and F&I composition, without leaving the operating view.

**Whether the books agree with the operation.** The stock schedule and the general ledger control
account disagree more often than anyone admits, and the disagreement is usually found at month end.
ARPI reconciles the inventory subledger against control accounts continuously, preserves a
missing-side position *as missing* rather than as a zero, and treats a variance as a finding to
investigate rather than as an error to suppress.

**Capital, not just units.** Aged inventory is a capital problem before it is a gross problem. ARPI
reports age against a declared threshold *and* the investment standing behind each age band, so the
question "how much money is in units over sixty days" has an answer that does not require a
spreadsheet.

## 3. Why would a dealer group use it?

Because the alternative is a reporting estate: a DMS report set nobody trusts, a CRM dashboard that
disagrees with it, three spreadsheets maintained by three people, and a monthly deck assembled by
hand. The cost of that estate is not the licences. It is that management decisions are made from
numbers that are argued about.

What ARPI offers instead:

- **One conformed model.** Store, date, vehicle, employee and lead keys conformed once, so a store
  means the same store in every domain and a figure can be decomposed without fanning out.
- **A metric contract.** The definition is source-controlled, reviewable and versioned. A change to a
  KPI is a diff.
- **Reconciliation as a control, not a report.** Every run proves its own totals against
  independently computed ones and records the outcome. A rule that has never been observed failing
  is not treated as a control.
- **Governed drill-through.** From the group to the transaction, with the definition travelling with
  the figure.
- **Discipline about what it will not say.** No ranking of people, no composite score, no invented
  favourable direction, no rate below its sample floor, no valuation presented as a market price.

## 4. What systems would it sit above?

The production vision, stated as a division of responsibility:

| System | Stays the system of record for | ARPI's role |
|---|---|---|
| Dealer management system | The transaction, the deal file, the stock record, the journal | Reads deliveries, costs, stock and postings. Never writes. |
| Customer relationship management | Customer ownership, task assignment, the working queue | Reads leads, assignment, activity and appointment outcomes. Reports on outcomes; manages no follow-up. |
| Inventory management | Acquisition, reconditioning workflow, pricing actions | Reads acquisition cost, recon, pricing history and market position. Recommends no price. |
| Digital retail | The online deal and its handoff into the store | Reads progression and the point of handoff. |
| F&I contracting | The product contract, the lender decision, funding | Reads product sales, reserve, cancellations and chargebacks. Reports the economics of what was contracted. |
| Accounting | The general ledger — the book of record | Reconciles the subledger against control accounts. Restates nothing. |
| Lead providers | Delivery, cost and validity of third-party leads | Reads volume, cost and validity. |
| Marketing platforms | Campaign delivery and channel operations | Reads spend and attributed outcomes. Builds no attribution model of its own beyond what the source provides. |
| Manufacturer systems | Allocation, incentives, receivables, programs | Reads allocation, program attainment and receivables. |

## 5. What would change with authorized full access?

Nothing about the *shape* of the product. The operating surfaces, the metric contract, the
reconciliation controls and the drill-through are the same. What changes is the source, the volume
and the latency — and four capabilities the current model cannot support at all:

**A real general ledger, and therefore real financial reporting.** The accounting surface today is
an inventory-control reconciliation against selected synthetic control accounts. With authorized
accounting access it becomes a trial balance, journal activity, departmental statements, controllable
expense, cash, receivables, contracts in transit, floorplan interest, factory receivables and a
month-end close position. That is the single largest gap between what ARPI is and what a CFO needs;
[`PRODUCT_GAPS.md`](PRODUCT_GAPS.md) §4 states it in full.

**Service and parts.** `fact_service_visit` is declared and deferred, and the employee surface
deliberately gives Service Advisor no role family: a family of zeroes reads as poor performance
rather than as absent data. Fixed operations is roughly half of a franchise dealership's gross and
none of it is modelled.

**Real market data.** The price-to-market ratio is computed against a *synthetic estimate generated
for this dataset*. It is not a valuation and the application says so wherever it appears. With an
authorized market data source it becomes a real price position.

**Continuous rather than batch.** The pipeline is a batch load with a content-digest manifest. The
governance design does not depend on batch, but the freshness statement would change from "as of a
snapshot date" to something closer to intraday, and the staleness rule would have to be rewritten
around it.

## 6. What ARPI does not replace, restated

A management intelligence layer earns its place by *not* being the systems beneath it. It has no
transaction to protect, no contract to produce and no book to close, which is exactly why it can
hold one consistent view across all of them. A platform that starts writing deals acquires the
obligations of a DMS and loses the only property that made it trustworthy: that it has no stake in
the numbers it reports.

---

Power BI real-engine validation remains externally pending; this document does not alter that state.
