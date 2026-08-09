# `DASH.10` staff-level review — the leads and marketing route

**Status:** written after implementation, against the code, the database and the measurements.
**Increment:** `DASH.10-01`, `DASH.10-02`.
**Parents:** [DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) ·
[DATA_CONTRACT.md](../dashboard/DATA_CONTRACT.md) ·
[INFORMATION_ARCHITECTURE.md](../dashboard/INFORMATION_ARCHITECTURE.md) ·
[TEST_STRATEGY.md](../dashboard/TEST_STRATEGY.md) ·
[KPI_CATALOG.md](../../KPI_CATALOG.md) · [LIMITATIONS.md](../../LIMITATIONS.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)

Every answer names its implementation and its test. Where an answer is qualified, the
qualification is stated first and is not softened.

**Three things in this document matter more than the rest.**

1. **A governed KPI was published wrong on `main`, and this increment fixed it.** KPI-FUN-003
   divided by leads received in the export contract and the console selector, against the
   catalogue, the reporting view and an integration test that all say contacted leads. The
   Executive Overview rendered 26.6% where the definition gives 37.0%. Section A2.
2. **The brief's proposed lost-stage identity does not hold in this warehouse**, and the view
   was designed from the model instead. Section E.
3. **One requirement is met structurally but unexercised by the data**: the scheduled-date and
   show-date bases never separate, because no generated customer arrives on a day other than
   the one they were booked for. Section B4.

Measured against the committed export and a production build: 946 valid leads in the default
period, 4,419 stage-loss rows, 5,513 response bins, 1,819 source-aware appointment rows, 121
reconciliations per database run with 0 failing, 1,184 portfolio unit tests, 34 route-specific
end-to-end tests, 0 route-owned client JavaScript.

---

## A. Funnel grain

**A1. Are valid leads and duplicate leads distinct populations? Yes.**
`reporting.vw_leads` zeroes every `*_lead_count` column on a duplicate row, so the exclusion is
structural rather than repeated per measure, and `duplicate_lead_count` publishes the excluded
population. The route renders both: 946 valid leads out of 1,006 lead records in the default
period. `dashboard-leads-marketing.test.ts` asserts
`leads_before_exclusions = leads_received + duplicates_excluded`.

**A2. Are duplicates excluded from every governed numerator and denominator? Yes — and the
denominator of one of them was wrong on `main`.**

This is the defect. `KPI_CATALOG.md` §26 states in bold that KPI-FUN-003's denominator is
"contacted leads, not all leads". `reporting.vw_lead_funnel` divides by `contacted_lead_count`.
`test_kpi_fun_003_denominator_is_contacted_leads_not_all_leads` asserts the view does so and
that it is "emphatically not `leads_received`". Two places disagreed:
`ReconciliationTotal("appointment_set_rate", …)` in `src/arpi/dashboard/contract.py` and
`SELECTORS.appointmentSetRate` in `selectors.ts`. The shipped manifest published
`1473 / 5538 = 0.266` where the governed definition gives `1473 / 3982 = 0.370`, and
`/dashboard` rendered the wrong figure — understated by eleven points, in the direction that
flatters a store with a poor contact rate, which is the exact misreading the catalogue's
denominator exists to prevent.

**Every existing guard looked in the wrong place.** The KPI tests check the view, which was
right. The export tests check that a total's sums match the exported column, which they did —
of the wrong column. Nothing compared the *contract's choice of denominator* against the
governed formula. `test_export_reconciliation_totals_use_the_governed_denominator` now
re-derives every ratio total from the columns the contract declares and requires it to equal
the rate its reporting view publishes;
`test_the_governed_denominator_guard_distinguishes_the_two_candidates` proves the data tells
the two candidates apart, so the guard cannot pass vacuously.

The fix was authorised as a defect correction rather than taken silently, and it changes the
manifest and one Executive figure.

**A3. Is appointment-set rate divided by contacted leads, not all leads? Yes**, now. See A2.
The route also names the denominator in words beside the percentage — "37.0% of contacted
leads" — rather than leaving it to be inferred.

**A4. Are lead-grain shown/sold flags distinguished from appointment KPIs? Yes.**
The funnel's fourth stage carries a count and `rate: null`, with the rendered note "the
governed rate at this step is an appointment-grain measure with a different denominator, shown
under Appointment outcomes". Publishing `appointment_shown_leads / appointment_set_leads`
unlabelled would create a governed measure by presentation; labelling it KPI-FUN-004 would
relabel a different one. Asserted by `publishes no rate for the lead-grain shown stage`.

**A5. Does the page avoid implying one lead equals one appointment? Yes.**
The appointment measures are a separate `<figure>` with their own caption stating they are
"appointment-grain measures, not continuations of the lead funnel: one lead can produce several
appointments, so these denominators are not the lead counts above". They are never rendered as
funnel segments.

---

## B. Date bases

**B1. Are FUN-001/002/003/006 on lead-created date? Yes.** All four read `lead-funnel`, whose
date column is `lead_created_date`.

**B2. Is response on lead-created date? Yes.** `lead-response-distribution` is grained on
`lead_created_date`.

**B3. Is show rate on scheduled date? Yes.** `shown_appointments` and `eligible_appointments`
are the scheduled-basis columns of `vw_appointment_source_funnel`, carried through unchanged
from `vw_appointment_funnel`.

**B4. Is show-to-sale on show date? Yes — and this is the qualified answer.**
`show_to_sale_conversion` divides `shown_and_sold_appointments` by
`shown_appointments_on_show_date`, both on the show-date basis, and never by
`shown_appointments`, which is the same population attributed to the scheduled date.

**The qualification:** in the committed data the two bases never separate. `0` of `1,025` shown
appointments have `show_date_key <> scheduled_date_key`, so both totals are 188 in the default
period. The distinction is real in the model and unexercised by the generator.

This is recorded rather than papered over. `carries the two date bases as separate columns,
which this data does not separate` asserts the equality *and its cause*, so a generator that
starts producing late arrivals fails there; and `attributes each basis to its own date when a
visit does arrive on another day` constructs the fixture the data cannot provide — an
appointment scheduled 30 December and attended 2 January — and proves December holds the
scheduled-basis show with no conversion, and January the conversion with no eligible
appointment. That is the strongest available evidence short of changing the generator, which is
not this increment's work.

**B5. Are marketing outcomes anchored to lead creation month? Yes.**
`vw_marketing_performance` attributes sales and gross through the originating lead's creation
month, not the sale date. The route reads only whole months and states so.

**B6. Does any visual falsely imply the bases are identical? No.** Each block renders one basis
and names it. Nothing on the page adds a figure on one basis to a figure on another —
`leads-marketing.ts` reads one dataset per builder, which is the structural version of that
claim.

---

## C. Source and campaign filtering

**C1. Does a source filter scope both numerator and denominator? Yes, structurally.**
`selectScope` runs ONCE per builder and both sums come out of the same selection, so a filter
cannot reach a numerator without reaching its denominator. The defect is not expressible in the
module, so `SEEDED: a source filter applied to one side only changes the rate` constructs it
externally and proves the honest answer differs.

**C2. Does a campaign filter scope both sides? Yes.** Same mechanism; asserted by `scopes both
sides when a campaign filter is applied` and, for marketing, by `SEEDED: a campaign filter
applied to the numerator only changes the answer`.

**C3. Are appointment metrics truly source and campaign aware? Yes, and this is why the
increment added a view.** Before `DASH.10`, `appointment-funnel` carried no source or campaign,
so a source-filtered page could only narrow the lead funnel while KPI-FUN-004 and KPI-FUN-005
stayed group-wide — two populations drawn as one shape. `vw_appointment_source_funnel` resolves
both through the one lead behind each appointment. `fact_appointment.lead_key` is `NOT NULL` and
references `fact_lead`'s primary key, so the join is strictly many-to-one and cannot fan out.

**C4. If they were not, is the partial state explicit? Not applicable** — they are. The filter
declaration marks `source` and `campaign` `applied` rather than `partial`, which is a claim
`scopes the appointment measures with the same filter as the funnel` tests in a browser.

**C5. Does campaign filtering alter response statistics correctly? Yes.**
`lead-response-distribution` carries `campaign_code` in its grain, so a campaign-filtered median
is a true median of the filtered population rather than a blend. `changes the median when the
source filter changes` asserts the analogous property for source.

**C6. Does the roll-up hold? Yes.** `RECON-APPT-SOURCE-ROLLUP` compares all nine additive
columns on both date bases against `vw_appointment_funnel` on every store and date, on every
database run. Components rather than rates, because compensating inflation divides back to a
plausible rate. `test_a_seeded_fan_out_fails_the_rollup_rule` seeds a lead resolved twice and
observes the rule fail — the first version of that test seeded an extra *appointment*, which
increments both sides and passed against the corruption it was meant to catch; the comment
records that.

---

## D. Response time

**D1. Is median the headline? Yes.** Larger type, first position, labelled KPI-FUN-008 with "the
headline, because the distribution is heavily skewed".

**D2. Is mean shown as companion? Yes**, labelled KPI-FUN-007 and "companion to the median,
moved by the tail".

**D3. Is P90 context only? Yes**, labelled "diagnostic context · the tail the median is
insensitive to". It carries no KPI identifier because none exists for it.

**D4. Are never-responded leads visible? Yes**, on the same block, as a count and a coverage
rate, with the sentence explaining that both KPIs are blind to them. Not in a disclosure.

**D5. Is NULL response distinct from zero-second response? Yes, structurally.**
The never-responded population is its own bin with `first_response_seconds` NULL,
`response_time_band` NULL and `responded_lead_count` 0. `SEEDED: treating a never-responded lead
as zero seconds moves the median` proves coalescing them improves the median, which is the most
flattering mistake available on this page. `keeps a zero-second response as a real observation`
proves a genuine zero is not discarded.

*Qualification:* the development profile contains no zero-second response, so
`test_a_zero_second_response_would_be_counted_as_responded` asserts the RULE rather than an
observation and says so in its docstring.

**D6. Is the group median recomputed from the correct population? Yes.**
`percentileFromBins` reproduces `PERCENTILE_CONT` over the exported population under the current
filters. Verified against PostgreSQL at the default route scope: **27.5 minutes both ways**.
`RECON-LEAD-RESPONSE-DIST-MEDIAN` re-proves it on every database run by expanding each bin and
comparing to the median over `vw_leads`.

**D7. Is no average of subgroup medians used? Correct, and the difference is measured.**
Averaging the medians `vw_lead_response` publishes at store × source × day gives **65.11
minutes** against a true **27.5** — a factor of 2.4, not a rounding difference. Asserted in
`SEEDED: averaging subgroup medians gives a different and wrong answer` and in
`test_the_average_of_published_medians_is_a_different_number`, which fails if the two ever
converge, because the dataset would then not be justified.

**D8. Is no response-time benchmark invented? Correct.** No target, no SLA, no colour. The bands
are descriptive bins in one hue. `publishes no benchmark, target or quality judgement` sweeps
the rendered text for affirmative benchmark language.

---

## E. Lost stage

**E1. Are lost-stage values diagnostics rather than KPIs? Yes.** `lead-stage-loss` declares
`kpi_ids = ()`, asserted by `test_the_stage_loss_dataset_claims_no_kpi`. No column carries an
identifier and none is rendered as a governed rate.

**E2. Are counts owned by governed SQL? Yes.** `reporting.vw_lead_stage_loss` owns the
partition; the console selects and sums it.

**E3. Are they non-negative? Yes, by construction.** Each term is a `FILTER` over a disjoint
predicate rather than a difference of two sums, so non-negativity is structural.
`RECON-LEAD-STAGE-PARTITION` re-proves it every run.

**E4. Does the exact progression identity hold? Yes — but NOT the one the brief proposed, and
that is the substantive design finding of this increment.**

`warehouse.fact_lead` enforces exactly three implications as CHECK constraints: an appointment
implies contact, a show implies an appointment, a sale implies a sale key. It does **not**
enforce that a sale implies a show, and the data bears it out: **175 of 400 sold leads never
showed**. The brief's candidate identity —
`leads_received = not_contacted + contacted_no_appointment + appointment_set_no_show +
showed_not_sold + sold_leads` — therefore does not hold, and its fourth term,
`appointment_shown_leads - sold_leads`, is not the count of leads that showed without buying:
it subtracts leads that were never in that population, and goes negative where more leads sold
than showed.

The view was designed from the model instead. It partitions by FURTHEST STAGE REACHED —
`not_contacted`, `contacted_not_appointment_set`, `appointment_set_not_shown`, `shown_not_sold`,
`shown_and_sold` — which is mutually exclusive, exhaustive, and sums exactly to
`leads_received` on every row. The sales that skipped the modelled path are published as
`sold_without_modelled_showroom_visit`, an OVERLAY on the first three terms that must never be
added to the five.

`test_the_naive_subtraction_is_wrong_and_the_data_proves_it` asserts both that sold-without-show
leads exist and that the naive subtraction would go negative on real rows — so if the generator
ever changed, the test would tell us the simpler shape had become correct.

**E5. Does the language avoid claiming why? Yes.** "Did not reach contact", "Did not reach
appointment", "Did not reach showroom", "Showed without attributed sale". The block states that
no communication content, activity detail or disposition is modelled anywhere in the warehouse,
so no reason exists to report. `makes no recommendation and attributes no cause` sweeps for
"BDC failed", "salesperson lost", "bad lead", "poor follow-up" and six more.

---

## F. Marketing

**F1. Is month the finest valid grain? Yes, structurally.** `vw_marketing_performance` joins the
calendar on the first day of the month, so a day-grain cost figure cannot be produced from it.
The route reads only `period.wholeMonths`.

**F2. Are organic cost measures N/A, not zero? Yes.** Where `is_cost_attributable` is false,
spend and all three measures return `not-applicable` and render "Not applicable".
`SEEDED: an organic source reports Not applicable and never a zero cost` asserts the state, the
absence of `0`/`0.00`, and that at least one such source actually produced leads. `renders no
organic cost as a zero` re-asserts it against the rendered DOM.

**F3. Does spend-with-zero-leads render explicitly? Yes** — `spend-without-leads`, rendering
"Spend with no attributed leads", with `cost_per_lead` absent rather than infinite.

**F4. Does spend-with-zero-sales render explicitly? Yes** — 28 such rows in the default period,
rendering "Spend with no attributed sales" with `cost_per_sale` absent, asserted by `reports
spend with no attributed sales as its own state, never as $0 or infinity`.

**F5. Does zero spend avoid infinite ROAS? Yes.** `divideExact` returns `null` on a zero
denominator. `renders no infinite or NaN figure anywhere` sweeps the rendered text for
`Infinity`, `NaN`, `undefined` and `null`.

**F6–F8. Are CPL, CPS and gross ROAS ratio-of-sums? Yes**, over the cost-attributable rows only.
Verified against PostgreSQL: $17.29, $2,835.50 and 1.04. The mean-of-ratios alternatives give
**$32.59** and **1.86** — both flattering — and `SEEDED: averaging per-campaign ratios gives a
different and flattering answer` asserts the divergence.

Folding organic leads into a group cost denominator would divide real money by opportunities it
did not buy; the totals therefore exclude non-attributable rows, which is stated in the card
note "Cost-attributable sources only".

**F9. Is attributed gross clearly not net profit? Yes.** Labelled "Gross return on ad spend", a
"contribution measure, not profit", with the disclosure naming every cost not netted out.
`never calls gross return profit, net profit or return on investment` uses
`affirmativeSentences`, so the disclosure's own denial does not trip its own guard.

**F10. Is revenue return secondary only? Yes** — it is not rendered at all. The export carries
`attributed_revenue`; the table does not promote it, and the disclosure explains why.

**F11. Are clicks and impressions secondary only? Yes** — carried in the model, not rendered in
the table, with the note that they are "vendor-reported activity, not value measures".

---

## G. Attribution

**G1. Is attribution single-source first-touch? Yes**, inherited from `fact_lead` and stated in
a notice beside the marketing block.

**G2. Is there no multi-touch model? Correct.** None exists in the project and none was added.

**G3. Does the page avoid causal language? Yes.** "Attributed under", "associated with", "did
not reach". The attribution notice ends "Association under that convention is not causation".

**G4. Are recent cohorts visibly qualified? Yes.** `CohortMaturityNotice` renders when the
period reaches the last date the export carries — which the default period does — and says the
measures are "structurally incomplete here and will improve as those leads mature".

**G5. Was no arbitrary maturity threshold invented? Correct.** `includesImmatureCohort` is a
boolean about whether the period touches the end of the window. No "mature after N days" rule
exists, and the notice says so explicitly: "ARPI defines no maturity horizon, so no cohort is
hidden or marked complete on your behalf."

---

## H. Vendor counts

**H1. Are vendor-reported leads distinguished from valid CRM leads? Yes** — four counts in four
cells, never reconciled to each other.

**H2. Are they never substituted into KPI-FUN-001? Correct**, asserted by `never substitutes the
vendor count for KPI-FUN-001`, which checks the valid-lead figure equals the funnel's and
differs from the vendor's.

**H3. Is the discrepancy treated as investigatory context? Yes.** The caption says it is
"something to raise with a vendor, not a defect to correct". No reconciliation targets equality.

---

## I. Privacy

**I1. Does any new export carry customer information? No**, and the response distribution's shape
is why. It is a COUNTED DISTRIBUTION, not lead rows: grouping by the response value and counting
preserves the multiset exactly — which is what makes the median recomputable — while the
artefact carries no lead key, lead code, customer, employee, sale or vehicle at all. That is a
stronger guarantee than an allowlist over a lead-grain projection, because there is nothing to
allow or forbid.

`test_it_carries_no_identity_column_at_all` asserts the exact column set against the database
catalogue; `test_response_distribution_carries_no_identity_column` asserts it against the
contract; `test_the_three_datasets_publish_no_surrogate_key` covers all three new datasets.

**I2. Does it carry communication content? No.** None exists anywhere in the warehouse.

**I3. Does it carry free text? No.** The only string columns are business codes and the governed
band vocabulary, which is a closed enumeration.

**I4. Are rendered results aggregate? Yes.** The rows are histogram bins and the page renders
band totals, never a bin. `exposes no lead, customer or communication detail` sweeps the
rendered text for code patterns, email addresses and phone numbers.

**I5. Are all source, vendor and campaign names fictional? Yes** — unchanged from the existing
`lead-sources` and `campaigns` dimensions, which `check_reference_data.py` and the privacy
tripwire already cover. This increment introduced no new name.

---

## J. Web architecture

**J1. Does the route use only governed exports? Yes** — five datasets through one door.

**J2. Is there no runtime database? Correct.** No client, no credential, no query.

**J3. Is there no API? Correct.**

**J4. Is there no second KPI engine? Yes, and it is enforced.**
`dashboard-boundaries.test.ts` permits exact arithmetic in `leads-marketing.ts` only by naming
it in a declared list, with a comment recording what it may and may not do. Its one genuinely
new computation is `percentileFromBins`, an order statistic over an exported population — the
same shape `inventory.ts` uses, and for the same reason.

**J5. Are new heavy datasets route-scoped? Yes.** `leads-marketing-chunks.ts` and
`leads-marketing-data.ts` are the twelfth and thirteenth declared doors, imported by one route.

**J6. Does Executive avoid importing DASH.10 detail data? Yes**, asserted by the door list. The
Executive change is one anchor and its sentence.

**J7. Is displayed money exact? Yes.** Every figure is `Exact`, formatted by the shared
formatters.

**J8. Is approximate conversion confined to geometry? Yes.**
`exactToApproxNumber` appears in `leads-marketing-sections.tsx` in exactly one function,
`widthOf`, which returns a CSS percentage. The boundary test's allowlist names the file and the
reason.

---

## K. Visual and accessibility

**K1. Does important geometry move with data? Yes.** Funnel, band, stage and source bar widths
are governed ratios of governed counts. `draws different funnel shapes for two different stores`
compares the full width vector across two stores in a browser — an assertion a "the bar exists"
test cannot make, because a hardcoded bar would pass that one.

**K2. Does filter state change geometry? Yes** — asserted for store, source and period.

**K3. Are accessible textual equivalents present? Yes.** Every visual is a `<figure>` with a
`<figcaption>`, a summary sentence carrying the exact values, and — for the multi-category ones
— a real table in a disclosure. Bar tracks are `aria-hidden`, because the numbers beside them
are the accessible content.

**K4. Is colour the only meaning carrier anywhere? No.** One hue throughout. There is no
benchmark in this project for any measure on this page, so nothing is green or red.

**K5. Does no-JS preserve the page? Yes.** Fifteen fragments spanning every block are asserted
present with scripting disabled, the bars are asserted to be drawn server-side with varying
widths, and the filter form is asserted to work as a native GET submission.

**K6. Does reduced motion preserve all data? Yes.** The route introduces no animation; the
existing `reduced-motion.spec.ts` sweep covers it as a console route.

**K7. Does 320 px work? Yes** — asserted at 320, 375, 390, 768, 1024, 1280, 1440 and 1920, with
the wide marketing table asserted to scroll inside its own container rather than pushing the
page sideways.

**K8. Is axe clean? Yes** — the route is in `ALL_TESTED_ROUTES`, so the existing axe sweep covers
it at every viewport with zero critical or serious violations.

**K9. Was a chart library avoided? Yes.** No dependency was added. Every visual is HTML and CSS.

---

## L. Roadmap

**L1. Is `DASH.10` complete? Yes** — route, export, SQL, tests, documentation.

**L2–L4. Did `DASH.11`, `DASH.12` and `DASH.13` remain untouched? Yes.** All three remain
`Planned`. `/dashboard/employees` and `/dashboard/actions` remain in
`UNBUILT_DASHBOARD_ROUTES` and still 404.

**L5. Did the MVP baselines remain unchanged? Yes.** 8 dimensions, 5 facts, 28 MVP reporting
views, 29 MVP KPIs. The dashboard-program lane moved from 10 views to 13, which is where the
three new views belong and where the counts record them separately.

**L6. Did Power BI artifacts remain untouched? Yes.** Zero TMDL, DAX or semantic-model changes.

---

## What this increment does not do

- It is **not a CRM screen**. No lead, customer, message, note, phone number or email exists in
  what it reads, so there is nothing to drill into a person with.
- It is **not a BDC leaderboard**. Employee performance is `DASH.11`; the `employee` filter is
  declared `not-applicable` rather than quietly ignored.
- It **makes no recommendation**. Deterministic action logic is `DASH.12`.
- It publishes **no comparison against a prior period**. Cohort maturity dominates every
  conversion and cost measure here, so a period-over-period delta would report immaturity as a
  change in performance. `compare` is declared `not-applicable` for that reason, which is the
  one filter this route declines that a reader might expect.

---

## Measurements

| Measure | Value |
|---|---|
| Root export datasets | 33 (30 before) |
| Root export bytes | 19,438,359 (16,138,000 before) |
| Generated dashboard bytes | 6,247,679 (5,706,000 before) |
| `appointment-source-funnel` | 1,819 rows · 903,784 B root · 237,366 B generated · 18 partitions |
| `lead-stage-loss` | 4,419 rows · 1,311,089 B root · 278,435 B generated · 18 partitions |
| `lead-response-distribution` | 5,513 rows · 1,538,524 B root · 435,808 B generated · 18 partitions |
| Largest new partition | 31,896 B, well inside the 256 kB ceiling |
| `/dashboard/leads-marketing` HTML | 345,313 B |
| Route JavaScript | 676,071 B — **byte-identical to `/dashboard`**, so zero route-owned client JS |
| Route CSS | 76,525 B, shared and unchanged |
| Client islands | 1, the shared filter bar |
| `/dashboard` delta | one anchor and its sentence; no new import, no data added to its graph |
| Reconciliations per run | 121, 0 failing (116 before) |
| Dashboard-lane reporting views | 13 (10 before) |

**Power BI real-engine validation remains externally pending; `DASH.10` does not modify the
semantic model.**
