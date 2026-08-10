# `DASH.11` staff-level review — the employee performance route

**Status:** written after implementation, against the code, the database and the measurements.
**Increment:** `DASH.11-01`, `DASH.11-02`.
**Parents:** [DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) ·
[DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[DATA_CONTRACT.md](../dashboard/DATA_CONTRACT.md) ·
[INFORMATION_ARCHITECTURE.md](../dashboard/INFORMATION_ARCHITECTURE.md) ·
[TEST_STRATEGY.md](../dashboard/TEST_STRATEGY.md) ·
[PRIVACY_AND_ETHICS.md](../../PRIVACY_AND_ETHICS.md) · [LIMITATIONS.md](../../LIMITATIONS.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)

Every answer names its implementation and its test. Where an answer is qualified, the
qualification is stated first and is not softened.

**Four things in this document matter more than the rest.**

1. **The planning line said the wrong thing about SCD2, and the implementation does the opposite.**
   The backlog specified "current role-assignment version from the SCD2 timeline"; as built the view
   keys on the FACT-LINKED version, so history keeps its store and its title. Section F.
2. **The increment ships TWO reporting views where the plan expected one**, and the reason is a
   grain argument rather than a convenience. Section 3.
3. **A governed budget was re-derived rather than the design distorted to fit it.** The 20 MB
   export-directory ceiling was set at `DASH.7` against a 13.6 MB measurement and never revisited.
   Section I3.
4. **One §5.2 context is structurally constant on this data and the page says so** rather than
   giving it prominent space: every generated delivery has a desk manager. Section A8.

Measured against the committed export and a production build: 3,624 employee-performance rows,
5,963 lead-source-and-response bins, 30 employees across 28 credited, 90 reconciliations per
database run with 0 failing, 2,798 Python unit tests, 1,287 portfolio unit tests, 43
route-specific end-to-end tests, 0 route-owned client JavaScript.

---

## 1. What was built

| Artefact | What it is |
|---|---|
| `warehouse.fn_employee_role_family()` | THE role-family map, derived from the fact audit in §2 |
| `reporting.vw_employee_performance` | Role-aware components at store × date × role family × employee VERSION |
| `reporting.vw_employee_lead_source_response` | The assigned-lead population beneath that grain, by source and by response bin |
| `audit.vw_recon_employee_performance` | Thirteen `RECON-EMP-*` rules |
| `employees`, `employee-sales`, `employee-finance`, `employee-appointments`, `employee-lead-source` | Five browser datasets |
| `/dashboard/employees` | Four role surfaces, URL-addressable, no route-owned JavaScript |

---

## 2. The physical role mapping, as audited

Every role-family decision was made from this table, produced by querying the development warehouse
before any SQL was written. It is not inferred from job titles.

| Role-playing key | Job roles observed | Rows | Null |
|---|---|---:|---:|
| `fact_vehicle_sale.salesperson_key` | Salesperson | 650 | 0 |
| `fact_vehicle_sale.desk_manager_key` | Desk Manager (178), Sales Manager (231), General Manager (241) | 650 | 0 |
| `fact_vehicle_sale.finance_manager_key` | Finance Manager | 515 | **135** |
| `fact_lead.assigned_employee_key` | BDC Representative (2,320), Salesperson (2,230), Sales Manager (596), General Manager (558) | 5,704 | **296** |
| `fact_appointment.salesperson_key` | Salesperson (1,391), Sales Manager (360), General Manager (360) | 2,111 | 0 |
| `fact_appointment.bdc_employee_key` | BDC Representative | 1,590 | **521** |
| `fact_finance_product_sale.finance_manager_key` | Finance Manager | 957 | 0 |
| `fact_finance_product_adjustment.finance_manager_key` | Finance Manager | 52 | 0 |

**What the audit decided.**

- **Sales Manager and General Manager are Desk Management.** Both are credited on real deliveries in
  `desk_manager_key`, so both participate, and both keep their own `job_role` label on every row.
  Neither is promoted to a Desk Manager and neither acquires a metric the facts do not carry.
- **Service Advisor has no family.** `fact_service_visit` is Deferred and no fact credits a service
  advisor with anything. Two service advisors exist in `dim_employee` and appear on no employee
  surface. A Service family would have rendered a page of zeroes that read as poor performance.
- **BDC Manager is mapped and unpopulated.** It is in the `job_role` domain and no generated employee
  holds it. The map is total over the declared domain; that is not a claim that a surface exists.
- **Salesperson lead volume is real.** 2,230 leads are assigned to salespeople, so the SQ-08
  lead-volume context is the genuine measure and not a relabelled BDC figure.
- **Twenty-eight of thirty employees are credited somewhere.** The two that are not are the service
  advisors.

`RECON-EMP-ROLE-COMPAT` re-proves every line of this on each database run: 0 unmapped credited rows,
0 incompatible role keys.

---

## 3. Why there are two views

The plan expected one. Two required pieces of fairness context are grained BENEATH the employee row:

- **Lead-source mix (SQ-08).** Putting the source in `vw_employee_performance`'s grain would repeat
  that employee-day's units, gross, reserve and appointment counts on every source row, and anything
  summing the result would multiply all of them by the number of sources the person worked. Pivoting
  nine categories into nine columns would encode a dimension's membership in the schema.
- **A response median (SQ-28).** A median does not decompose. It can only be recomputed from the
  population, so the population has to exist somewhere.

Both are the same lead population cut two ways, so they share one view rather than costing two:
summing across `first_response_seconds` gives the exact mix, summing across `lead_source_key` gives
the exact distribution. 5,963 rows against 4,384 for a mix-only view — 1,579 rows for an exact
median instead of an approximate one. The view carries no unit, gross or appointment measure, so
reading it beside the primary view cannot fan one out; `RECON-EMP-SOURCE-ROLLUP` proves it re-cuts
the same population and the export test proves the columns are absent.

**Correct grain outranks preserving a planning count.** Recorded as an as-built divergence in the
backlog, the program document and `DATA_CONTRACT.md` §3.

---

## 4. The grain, and why daily

`vw_employee_performance` is **store × calendar date × role family × employee VERSION**.

**Daily rather than monthly**, because the filter grammar accepts a month, an explicit date range,
month-to-date and last-30-days. A monthly view answers the first and none of the other three: "last
30 days" crosses a month boundary and a range from the 8th to the 22nd has no monthly row at all.
Declaring those filters not-applicable would have been a SQL convenience dressed as a product
decision. The cost is 3,624 rows — smaller than eleven datasets already exported.

**Four date bases, each named in the column that uses it**, following `vw_appointment_funnel`'s
established precedent: sale date for `sold_`/`desked_`/`financed_`, lead-created date for the lead
columns, appointment scheduled date for `bdc_eligible_` and `..._scheduled_basis`, appointment show
date for `..._show_basis` and shown-and-sold. A row is a DATE BUCKET, not a cohort — each column sums
correctly over a range independently of the others. Shown appointments appear twice on purpose,
because the show-rate numerator and the show-to-sale denominator are different populations.

**The sale columns are named per credit relationship** — `sold_`, `desked_`, `financed_` — because one
delivery is credited to three different people. A single shared "retail units" column disambiguated
by `role_family` was rejected: it triples every delivery for anything summing across families, and it
collapses entirely in the unassigned group, where a sale with no finance manager and a sale with no
salesperson would land in the same bucket under the same column with no way to tell them apart. As
built, each group reconciles over the WHOLE view with no family filter — which is the property the
naming buys, and what `RECON-EMP-SALES-UNITS` asserts.

**No `meets_minimum_sample` column**, departing from `vw_fi_summary`. The floor governs an AGGREGATED
denominator over a reporting period, and a daily flag would be false for nearly every row while the
period figure is comparison-eligible. It is also denominator-specific, so one flag could not have
served five measures even at the right grain.

---

## A. Fairness

**1. Is there any employee rank?** No. No rank column exists in any view or dataset, no ordering by a
measure exists in the route, and `orderEmployees` takes no comparator argument so a caller cannot
pass one. *Tests:* `dashboard-employees.test.ts` "orders the comparison by store, role and code",
"exposes no sort control and no comparator argument"; `test_no_employee_dataset_declares_a_score_rank_or_target_column`.

**2. Is there any composite score?** No. No exported function returns a single number summarising a
person; the row type carries several independent figures and no field combining them. *Test:*
"produces no composite figure and no employee target".

**3. Can the UI be sorted by performance?** No. There is no sort control in the markup and none in
the filter grammar. *Tests:* the source guard above, and the browser test "offers no control that
sorts by a measure", which reads every anchor, button, select and input on the rendered page.

**4. Does any label say best/worst/top/bottom?** No. Checked against every string the model produces
as a LABEL — twenty banned phrases across all four families — rather than against source, because a
raw source scan cannot tell an assertion from a disclaimer and the page deliberately SAYS "a list
sorted by gross is a leaderboard whether or not it is labelled one". Gamification vocabulary
(trophy, medal, crown, podium, streak, and five score compounds) is separately banned in
comment-stripped source, where no legitimate disclaiming use exists. *Test:* "uses no ranking
vocabulary in anything it renders as a label", "carries no gamification vocabulary in any executable
source".

**5. Is tenure visible?** Yes, as `tenure_band` on every employee row, taken from the FACT-LINKED
version. No hire date, no exact tenure, no months or days employed exists anywhere in the lane.
*Test:* browser "puts tenure, store and mix beside the figures rather than in a drawer".

**6. Is new/used mix visible where relevant?** Yes, on Salesperson and Desk rows, as a partition
summing exactly to retail units, with certified published as a SUBSET of used. *Tests:* "keeps
certified units inside used and never as a third category"; `RECON-EMP-MIX-PARTITION`.

**7. Is inventory availability visible where relevant?** Yes, in the Opportunity region as average
active units per store over the observed snapshot days. *Qualification:* it is a STORE figure and is
on no employee row, deliberately — see A11 and H8.

**8. Is manager involvement visible where relevant?** Yes, as "Deals with a desk manager: N of N" on
every Salesperson row. **Qualified:** `desk_manager_key` is never null on the development profile, so
the figure equals retail units on every row and the context is STRUCTURALLY CONSTANT. The page states
it plainly in a compact context cell rather than giving it prominent space, which is what §24 of the
brief asks for when this happens. It is published rather than asserted so the claim is checkable.

**9. Is lead volume visible where relevant?** Yes. "Assigned leads" on every Salesperson row, and the
BDC volume figure is itself the valid assigned-lead count. Supported by real data: 2,230 leads are
assigned to salespeople.

**10. Is lead-source mix visible where relevant?** Yes. A full category mix bar on every BDC row and
the commonest category on every Salesperson row, ordered by NAME rather than by size so the biggest
source cannot read as the best one. *Test:* "orders the mix by name and never by size".

**11. Is store context visible?** Yes. Every employee row carries its store code, and the Opportunity
region publishes per-store inventory availability. No cross-store ranking exists.

**12. Is no causal employee claim made?** Yes — none is made. The vocabulary is "credited to",
"observed for", "on transactions handled by". *Test:* "makes no causal claim about a person"; the
view comments state the same rule at the database.

---

## B. Sample discipline

**13. Does every comparative ratio use its actual denominator as sample count?** Yes, and there is
deliberately no shared `employeeSampleCount`. Gross per unit → retail units of that credit; contact
rate → valid leads; appointment-set rate → CONTACTED leads; show rate → eligible appointments; 
show-to-sale → shown appointments; reserve and back PVR → retail units delivered under that credit.
*Test:* "applies each governed denominator to its own measure and not a shared row count", which
asserts the four BDC denominators are not all the same number and names each sample label.

**14. Does the sample floor come from `warehouse.fn_minimum_sample_floor()`?** Yes. The view publishes
`minimum_sample_floor` from the function and `RECON-EMP-SAMPLE-FLOOR` asserts one distinct published
value equal to the function's.

**15. Is it absent from React constants?** Yes. The route reads it from the export. *Test:* "reads the
sample floor from the export and never from a constant", which scans comment-stripped source in all
five lane modules for a literal floor assignment.

**16. Does below-floor render "Insufficient sample"?** Yes, in words, with the attention treatment and
the words together so colour is never the sole carrier.

**17. Is n visible?** Yes — above and below the floor alike. Above: "n = 13 retail units". Below: "9
retail units, minimum 10". The count that caused the suppression is never hidden.

**18. Is the floor visible?** Yes, in the role summary ("Minimum sample 10, 10 below it") and inside
every suppression message.

**19. Is below-floor distinct from zero?** Yes. A zero denominator produces `no-data`, not
`insufficient-sample`: there is no sample, which is not the same as one that is too small. *Test:*
"distinguishes a below-floor sample from no sample at all".

**20. Is below-floor distinct from N/A?** Yes. Four kinds in one union — `not-applicable`,
`insufficient-sample`, `no-data`, and a real value — rendering four different strings.

**21. Is a real below-floor route state tested?** Yes, from committed data rather than a fixture. In
December 2025, 10 of 12 credited salespeople fall below the floor. The unit test asserts that BOTH
populations are non-empty and fails with a message saying the browser assertion has become vacuous
if either disappears; the browser test renders it and asserts no "$0" or "0.0%" appears in the
suppressed row.

---

## C. Sales

**22. Are retail units retail-only?** Yes, and the excluded population is published beside it:
`sold_non_retail_units` / `desked_non_retail_units` carry the wholesale and dealer-trade units, so
the exclusion is checkable rather than trusted. *Test:* "keeps wholesale and dealer-trade units out of
the retail denominator", which asserts non-retail units exist in the export first.

**23. Are Certified units included in Used?** Yes. `sold_certified_units` is a SUBSET of
`sold_used_units`, published as context, and new + used equals retail units exactly on every row.
*Tests:* the mix test above and `RECON-EMP-MIX-PARTITION` (0 certified violations).

**24. Is GPRU ratio-of-sums?** Yes, computed once at the grain being reported. *Test:* "computes gross
per retail unit as SUM over SUM, not as an average of ratios", which asserts the two answers differ
by more than $0.50 on the committed data before asserting which one the model produced. Seeded
defect observed failing.

**25. Is salesperson attribution from `salesperson_key`?** Yes, the `sold_` column group.

**26. Is desk attribution from `desk_manager_key`?** Yes, the `desked_` column group.

**27. Is no sale attributed to the wrong role?** Correct. Each credit is a separately named column
group, `RECON-EMP-ROLE-COMPAT` proves each key resolves to a compatible role, and
`RECON-EMP-SALES-UNITS` proves each group reproduces the authority's 558 retail units exactly.

---

## D. BDC

**28. Are duplicates excluded?** Yes, structurally: every measure derives from `reporting.vw_leads`,
where a duplicate carries zero in every valid measure and a NULL first response, so no numerator and
no denominator can pick the exclusion up differently. `duplicate_lead_count` keeps them visible.
*Test:* "excludes duplicate leads from every funnel denominator".

**29. Is contact rate on the valid-leads denominator?** Yes.

**30. Is appointment-set rate on the CONTACTED-leads denominator?** Yes — the defect this project
already shipped once, pinned here by construction and by a test that asserts the two denominators
differ materially before asserting which the model used. Seeded defect observed failing: dividing by
valid leads moves the rate by 12.1 points.

**31. Is the median a true median?** Yes. Recomputed from the exported bins with
`percentileFromBins`, which reproduces PostgreSQL's `percentile_cont` interpolation exactly.
`RECON-EMP-SOURCE-MEDIAN` asserts equality PER EMPLOYEE against the median over
`reporting.vw_leads`: 0 disagreeing employees. The function was EXTRACTED from `leads-marketing.ts`
into `figures.ts` rather than copied — two medians would be two chances to drift from the equality
those rules prove, and both copies would return a plausible number of seconds.

**32. Are unresponded leads visible?** Yes, "Never responded: N" on every BDC row, beside the median.

**33. Is NULL response distinct from zero seconds?** Yes, separated by predicate and never coalesced.
Zero seconds is a real instant response and is included. Seeded defect observed failing: coalescing
the null bin to zero moves the median.

**34. Is show rate appointment grain?** Yes, and the lead-grain and appointment-grain measures are
separate blocks with separate sample labels.

**35. Are cancellations visible?** Yes, "Cancelled in advance: N" on the same row as show rate — not
in methodology, because the exclusion that makes show rate correct is the one a store can game.
*Test:* "excludes advance cancellations from the show-rate denominator and publishes them", which
asserts cancellations exist and that eligible = scheduled − cancelled.

**36. Is show rate scheduled-date based?** Yes.

**37. Is show-to-sale show-date based?** Yes, over a SEPARATE shown-appointment column. *Test:* "takes
show-to-sale from the show-date population, not the scheduled-date one".

*Qualification carried forward from `DASH.10`:* the scheduled-date and show-date populations never
separate on this data, because no generated customer arrives on a day other than the one they were
booked for. The two bases are structurally distinct and independently reconciled; the committed data
does not exercise the difference.

---

## E. Finance

**38. Does finance performance reuse existing F&I authorities?** Yes. `financed_*` derives from the
same facts and the same `warehouse.fn_finance_structure()`, and `RECON-EMP-FINANCE` compares against
`reporting.vw_fi_summary` at the FULL grain the two share — store, sale date, manager — rather than in
total, because two managers' figures could be swapped and still sum correctly. 0 disagreeing groups.

**39. Are cash deals treated correctly?** Yes: inside the denominator, where the governed definition
puts them. *Test:* "keeps cash deals inside the PVR denominator", asserting the denominator is not
units-minus-cash.

**40. Is structure mix visible beside PVR?** Yes, on the same row as both figures, as a partition
summing exactly to retail units.

**41. Are eligible denominators preserved?** Not applicable here, and deliberately: category-grain
penetration has a per-category eligible-deal denominator this page does not carry.
`/dashboard/fi` owns it and the finance rows link there with the employee code.

**42. Are distinct attached deals used for penetration?** Not applicable — no penetration figure is
published on this route. `financed_contract_count` is CONTRACT ROWS and is documented as such, and a
test asserts no measure or context label on the finance surface contains "penetration".

**43. Are F&I date bases not blended?** Correct. This route is on the DEAL-DATE basis only. The as-of
and adjustment-period bases are deliberately absent; `/dashboard/fi` owns both.

**44. Are manager rows not ranked?** Correct — the same ordering and the same absence of controls as
every other family.

---

## F. SCD2

**45. Do historical facts keep their historical store?** Yes. `dealership_key` is the FACT's store and
`employee_version_dealership_id` publishes the version's store beside it.
`RECON-EMP-SCD2-ATTRIBUTION` fails on any divergence: 0 store divergences, 0 unresolved versions.

**46. Do historical facts keep their historical role?** Yes. `job_role`, `department` and
`tenure_band` come from the version the fact points at, on both views.

**47. Is the current employee version used only for current context?** Yes, and only for
`is_active_in_current_roster`, which is named for exactly what it is.

**48. Can one employee code appear under multiple historical role/store segments?** Yes — the grain is
the VERSION key, so segments stay separate while `employee_code` follows the person across them.

**49. Are inactive-current employees' historical activities retained?** Yes. `is_active` is roster
context and is never used as a historical filter; three employees are currently inactive and nothing
drops their activity.

**Qualification, stated plainly.** The committed development data cannot exercise the SCD2 defect.
All four multi-version employees changed store or role BEFORE the reporting window opened
(2023-12-08, 2024-05-18, 2024-12-09 and 2020-12-19 against a window starting 2025-07-01), so every
in-window fact points at what is also the current version and a current-version join would
coincidentally agree. The implementation is correct by construction — it joins the fact's key and
never resolves `employee_id` — and `RECON-EMP-SCD2-ATTRIBUTION` is an equality over every row rather
than a spot check, so it fails the moment a divergent version appears. **What does not exist is a
committed case that would fail under the wrong implementation**, and this review says so rather than
implying the reconciliation is currently discriminating.

---

## G. Privacy

**50. Are employee names absent?** Yes — none exists in the warehouse to export.

**51. Are exact hire dates absent from the browser?** Yes. Tenure is a band, everywhere.

**52. Are termination dates absent?** Yes, and no leaving vocabulary is used: "inactive in current
roster" is the whole statement.

**53. Is compensation absent?** Yes — no salary, commission, pay plan, bonus, draw, spiff or
commissionable gross anywhere.

**54. Are protected attributes absent?** Yes, and none exists in the warehouse. No geography beyond
the operational store assignment.

**55. Is free text absent?** Yes — no note, comment or remark column on any employee dataset.

**56. Are only synthetic employee codes exposed?** Yes. `EMP-#####` is the only label; `employee_key`
and `employee_grain_key` stop at the export boundary as every surrogate does.

**57. Is no customer data added to the employee export?** Yes. The lead-source view is a COUNTED
DISTRIBUTION carrying no lead key, lead code, customer, sale or vehicle — a stronger guarantee than an
allowlist over a lead-grain projection, because there is nothing to leak.

*Controls:* the existing privacy tripwire, plus three DASH.11-specific export tests (exact allowlist
by equality for `employees`; personal/pay vocabulary as words and substrings on every dataset
carrying an employee code; rank/score/target vocabulary on the same set), plus a browser test that no
personnel phrase and no `<img>` appears in `<main>`.

---

## H. Reconciliation

All thirteen `RECON-EMP-*` rules pass on every database run; 90 of 90 reconciliations pass overall.

**58. Do salesperson totals reconcile?** Yes — `RECON-EMP-SALES-UNITS`: 558 sold retail units against
`vw_vehicle_sales`' 558, with no family filter. `RECON-EMP-SALES-GROSS`: front $1,270,498.26 and total
$1,936,571.59, both exact.

**59. Do desk totals reconcile?** Yes — the same two rules, same figures for the desk credit.

**60. Do finance totals reconcile?** Yes — `RECON-EMP-FINANCE` at full grain against `vw_fi_summary`.

**61. Do BDC leads reconcile?** Yes — `RECON-EMP-LEADS`, all nine components including the duplicate
and unresponded exclusions, which are reconciled explicitly rather than assumed.

**62. Do appointments reconcile?** Yes — `RECON-EMP-APPOINTMENTS`, on BOTH date bases, with the two
shown-appointment populations reconciled separately.

**63. Is unassigned activity preserved?** Yes — `RECON-EMP-UNASSIGNED`, the one rule every other
rollup would survive if the rows were dropped from both sides. 135 finance units, 296 leads, 290
eligible appointments, each matched against the nullable role keys directly.

**64. Does source mix reconcile?** Yes — `RECON-EMP-SOURCE-ROLLUP` at store × date × employee, 0
disagreeing groups, plus `RECON-EMP-SOURCE-MEDIAN` per employee.

**65. Does inventory context reconcile?** Yes, by construction: it is computed from the governed
`inventory-health` export that `/dashboard/inventory` publishes, not from a second source.

---

## I. Web architecture

**66. Does the route use governed committed exports only?** Yes.

**67. Is there no runtime DB?** Correct.

**68. Is there no API?** Correct.

**69. Is the employee payload route-scoped?** Yes. `employees-data.ts` and `employees-chunks.ts` are
two new declared doors — fifteen in total — and only `/dashboard/employees` imports either. The route
deliberately does NOT re-import `inventory-health`: it reads the same governed dataset through the
shared `chunks.ts`, so the store inventory figure cannot become a second number.

**70. Is displayed money exact?** Yes.

**71. Is approximate conversion geometry-only?** Yes. `exactToApproxNumber` appears in exactly one
function, `shareWidth`, which returns a CSS percentage. The volume bar divides two integer counts and
touches no exact value. Registered in the boundary test's exhaustive list.

**72. Is there no chart library?** Correct — no dependency added.

**73. Is URL state shareable?** Yes. Role, period, store and employee are all query parameters, and
both link builders go through the governed `filtersHref` serializer rather than hand-assembled query
strings, so two equivalent states produce byte-identical URLs.

**74. Does `employee=` use the existing grammar?** Yes — the one parameter for a person, already in
`FILTER_KEYS`. No `manager=`, `salesperson=`, `bdc=` or `financeManager=` was introduced. An unknown
but well-formed code is reported as unknown rather than silently rendering an empty page.

**I3. The export-directory ceiling.** The design was minimised first: split by measure group rather
than exported as one 51-column view (5,282,320 B on its own, past the single-file ceiling), each
split filtered to the rows its group populates, the lead funnel published once rather than twice. The
lane still measures 3,626,017 B and the total reached 23,064,376 B against a 20 MB ceiling. That
ceiling was written when the measured total was 13,608,954 B at `DASH.7` and was never revisited;
`DASH.8`–`DASH.10` carried it to 19,438,359 B. It is re-derived to 28 MB with the same ~30% headroom
`DATA_CONTRACT.md` §10 used when the single-file ceiling broke, and both measurements are recorded
there. `DASH.13-02` owns setting the real budgets.

---

## J. UX

**75. Does each role show only role-relevant measures?** Yes. The four families are four different
question sets, not four copies of one card grid: Salesperson shows volume + gross + mix + opportunity;
Desk shows desked volume + gross + mix; Finance shows F&I income + structure; BDC shows the lead
progression, response and appointment outcomes. A measure structurally unrelated to a family is
absent rather than zero — a salesperson has no row in `employee-finance` at all.

**76. Is the page visual rather than prose-heavy?** Yes. Six regions, one methodology disclosure, and
the reading order is see → context → investigate → prove.

**77. Is fairness context near the figure?** Yes — tenure, store, mix, sample, opportunity and the
role-specific context are all on the row. Only the arithmetic explanation is behind the disclosure.

**78. Does colour avoid employee judgement?** Yes. Four stable categorical role marks from the
existing `data-*` palette carry identity, not evaluation. No `data-positive` or `data-negative`
appears in the component; the only non-neutral state is the suppression, which uses the attention
token and is spelled out in words on the same line. *Test:* "applies no good/bad colour to any
employee outcome".

**79. Does mobile remain useful?** Yes. No horizontal overflow at any of 320/375/390/768/1024/1280/
1440/1920, tenure and the mix and the sample state all still present at every width, and no employee
row fills a 390×844 screen on its own.

**80. Is no-JS complete?** Yes. All four surfaces, role navigation, employee selection, the
suppression state, the store context and the methodology all render with JavaScript disabled. The
route ships no client island.

**81. Is axe clean?** Yes, on seven states — four role families, below-floor, selected employee and
unknown employee — with no suppressed rules and zero serious or critical violations. The definition
lists pass the PR #55 structural guard explicitly.

**82. Is the selected employee an investigation view rather than an HR profile?** Yes: what was
credited, the sample behind each figure, the mix, and where to look next. No personnel detail exists
to show.

---

## K. Roadmap

**83. Is `DASH.11` complete?** Yes — `DASH.11-01` and `DASH.11-02` both Implemented.

**84. Is `DASH.12` untouched?** Yes, still Planned. No action, recommendation or coaching output
exists on this route.

**85. Is `DASH.13` untouched?** Yes, still Planned.

**86. Are employee targets still unpopulated?** Yes — zero employee-scope rows in
`fact_sales_target`, and no target, quota, goal, attainment or pace column exists on any employee
dataset.

**87. Is service performance still absent?** Yes. `fact_service_visit` remains Deferred and no Service
tab, estimate or proxy was created.

**88. Are MVP baseline counts preserved?** Yes: 8 dimensions, 5 facts, 28 MVP reporting views, 29 MVP
KPIs, all unchanged. The dashboard-program lane moves from 13 views to 15 and the full reporting
surface from 50 to 52. No `KPI-EMP-###` identifier was created — employee performance is a
presentation grain over existing governed KPIs, not a measure family.

**89. Are Power BI artifacts untouched?** Yes — zero files changed under `powerbi/`. No TMDL, no DAX,
no relationship, no report page.

---

Power BI real-engine validation remains externally pending; `DASH.11` does not modify the semantic
model.
