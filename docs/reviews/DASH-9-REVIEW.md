# `DASH.9` staff-level review — the inventory and accounting routes

**Status:** written after implementation, against the code and the measurements.
**Increment:** `DASH.9-01`, `DASH.9-02`, `DASH.9-03`.
**Parents:** [DASHBOARD_BACKLOG.md](../requirements/DASHBOARD_BACKLOG.md) ·
[DATA_CONTRACT.md](../dashboard/DATA_CONTRACT.md) ·
[INFORMATION_ARCHITECTURE.md](../dashboard/INFORMATION_ARCHITECTURE.md) ·
[TEST_STRATEGY.md](../dashboard/TEST_STRATEGY.md) ·
[DATA_DICTIONARY.md](../../DATA_DICTIONARY.md) · [LIMITATIONS.md](../../LIMITATIONS.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md)

Every answer below names its implementation and its test. Where an answer is qualified,
the qualification is stated first and is not softened. **Five answers are qualified**, and
**four record a defect this increment shipped and then fixed** rather than a property it
merely maintained. One of those four reached `main` and was rendering a wrong number to
anyone who looked; it is section J, and it is the most important thing in this document.

Measured against the committed export and a production build: 1,501 unit-grain rows over
6 reportable dates, 43 comparison positions, 4 accounting exceptions, 250 active units at
the latest snapshot, 116 reconciliations recorded per database run with 0 failing, 1,075
portfolio unit tests, 710 end-to-end tests, and 0 critical or serious axe violations on
either new route.

---

## A. Scope boundary — did the console stay inside what the data supports?

**A1. No repricing recommendation is made, anywhere, in any form. Yes.**
`/dashboard/inventory` publishes `price_to_market_ratio` and a price movement since the
prior snapshot. It does not publish a suggested price, a recommended markdown, a "reprice
now" flag, an optimal price, a price opportunity, or the words *overpriced* or
*underpriced*. `dashboard-inventory.spec.ts` sweeps the rendered text for all eight, and
it sweeps for AFFIRMATIVE use rather than for the substring — see D2.

The distinction the page has to hold is that a **ratio is a comparison and not a verdict**.
0.87 means a unit is advertised below a generated reference number. It does not mean the
unit is cheap, that the price is wrong, or that anything should be done. The column header
says `Est. (synthetic)` so that a reader scanning the table sees the qualifier without
opening a disclosure, and the ratio's own SQL comment forbids the recommendation in the
place a future author would be standing when tempted to add one.

**A2. No floorplan carrying cost is modelled. Yes, and the page says so rather than
merely omitting it.**
The unit drill-through renders `floorplan_principal` and labels it *liability context*.
There is no flooring cost, floorplan interest, curtailment, net inventory position or
equity-in-unit figure — none as a column, none as a derived value, none as a sentence. The
panel states that floorplan principal is carried alongside the unit, is not part of book
value and is **never netted against it**, and that ARPI publishes no net inventory
position.

That denial is load-bearing, and it is why the spec needed `affirmativeSentences`: a flat
substring sweep for `/floorplan interest/` flags the sentence written to prevent floorplan
interest, and the only way to make such a test pass is to delete the disclosure. A test
that makes the project less honest is a broken test. There are now two assertions: the
vocabulary may not be asserted, and the denial must be present.

**A3. No general ledger. Yes, and this is the boundary `DASH.8` drew, held at the
presentation layer.**
`/dashboard/accounting` renders no journal entry, journal line, trial balance, balance
sheet, profit and loss, period close or chart of accounts. It reconciles one control
account family against one subledger. The page states that no journal entry, trial balance
or financial statement exists in this project — again as an affirmative-use sweep, for the
same reason as A2.

**A4. Qualified: the reconciliation is not agreement between two independent systems, and
the page leads with that.**
Both sides — the GL control balance and the inventory subledger — are generated from one
governed model in this project. A real controller's reconciliation derives its value from
the two sides having been produced by different systems for different purposes; this one
cannot. The page says so in the sentence beside the figure, the export's own
`known_limitations()` says so, and the Executive card says so. Nothing here should be read
as evidence that ARPI's books agree; it is evidence that the comparison **surface** works
and can show a variance when one exists.

The variances themselves are **deliberately planted**, which the page also states. They are
not discovered errors in a real dealership, because there is no real dealership.

---

## B. The two date semantics, and whether a reader can tell them apart

**B1. The inventory route is on the SNAPSHOT-DATE basis and the accounting route is on the
COMPARISON-DATE basis, and both say so in the header. Yes.**
Three date semantics now meet on these two routes: the inventory snapshot date, the
accounting balance date, and the exception's own `exception_date`. A reader who assumes
`2025-12` means one thing across all three gets a wrong answer with no error message, so
`/dashboard/accounting` carries a "Which date owns which row" section that names each.

**B2. Balances are semi-additive and the console never sums them across dates. Yes.**
A control balance is a POSITION AT A DATE. Adding December's balance to November's produces
a number with no meaning that looks entirely plausible, which is the failure mode worth
engineering against. `resolveComparisonDate` reduces a period to its **last** comparison
date rather than aggregating the period, `selectComparisons` filters to that one date, and
the page states "never across dates" in the methodology. `dashboard-accounting.test.ts`
asserts a period containing three dates resolves to one and that the resolved figure is the
last date's rather than any total or average of them.

The same rule governs the unit view: `inventory_investment` and `inventory_unit_count` are
additive across store, vehicle and model and **not** across dates. The view's header says
so, and the route decodes exactly one month for exactly that reason (see I1).

---

## C. The two numbers most likely to be read wrong

**C1. The aged threshold is 60 days, it comes from the data, and it is NOT the top age
bucket. Yes — and this is the single most confusable pair in the increment.**
`reporting.vw_inventory_units` publishes `aged_threshold_days = 60` on every row, and the
page reads that column rather than hard-coding a constant that could drift from the SQL.
The five governed age buckets are `0-30`, `31-60`, `61-90`, `91-120`, `Over 120`, and the
top boundary is 120.

The plausible wrong implementation is to treat 120 as the threshold, because it is the
number the bucket list ends on. On this dataset that reports **2 aged units where the truth
is 5** in the seeded fixture, and 101 aged units at the latest snapshot become far fewer.
`dashboard-inventory.test.ts` seeds ages of 5, 20, 45, 61, 75, 95, 130 and 200 and asserts
both that the answer is 5 and that the wrong rule would have said 2 — a seeded defect that
passes on the right and the wrong implementation alike proves nothing.

The page states the threshold is a **project default and not an industry benchmark**, and
states explicitly that it is "a different number from the top age bucket".

**C2. The market estimate is labelled synthetic everywhere it is rendered, and the ratio is
null where the estimate is null — never zero. Yes.**
`market_price_estimate` is generated by `market_price_estimate_for` in its own
`inventory_market_price_estimate` namespace, absent by design for roughly 8% of units, and
strictly positive when present — the DDL refuses zero, because the column is a denominator
and a zero there is not a cheap unit but a division the reporting layer cannot perform.

Where the estimate is absent the table renders "No estimate" and an em-dash ratio. It does
not render `0.000`, and it does not impute. `dashboard-inventory.test.ts` asserts the two
nulls travel together on every row of a real partition, and that stripping an estimate
moves the unit into `unitsWithoutEstimate` rather than into a zero-ratio bucket.

**C3. The variance is signed, GL minus subledger, and the direction is stated in words.
Yes.**
`+$384.60` alone does not say which side carries more, and a reader who cannot see colour
gets nothing from a red number. Every variance is accompanied by a sentence — "the general
ledger carries more than the subledger", "the two sides agree exactly" — and the convention
`general ledger minus subledger` is printed on the page rather than assumed.

There is **no tone, no traffic light and no status word** on the Executive card. A governed
threshold for "how much variance is too much" does not exist in this project, and inventing
one on the Executive page is exactly how a number acquires a verdict it cannot support. The
card says a variance is "to investigate, not an error".

**C4. A missing side is rendered as missing, never as zero, and is excluded from the money.
Yes.**
A position with one side absent has no variance at all, so it cannot be added to a dollar
figure. The four comparison states are kept as separate vocabulary — reconciled, variance,
missing GL balance, missing subledger balance — the variance column reads "Not comparable"
rather than a number, and the missing sides are counted in their own figure on the
Executive card, labelled "One side missing; no variance exists".

Coalescing either side to zero would turn "we could not compare these two positions" into
"the books are off by the whole balance". `dashboard-accounting.test.ts` seeds exactly that
corruption and asserts it produces a different total.

---

## D. Testing — what is actually proved, and what a green run means

**D1. Every seeded defect changes the answer. Yes.**
39 unit tests across the two selector models (`dashboard-inventory.test.ts`, 24;
`dashboard-accounting.test.ts`, 15). The seeded-defect sections do not merely corrupt and
re-run: each corruption asserts the wrong implementation lands on a **different** number
from the right one. The 60-vs-120 threshold, the population median against averaged
subgroup medians, a null ratio sorted at an extreme rather than last, the missing side
coalesced to zero, the period summed rather than resolved to its last date.

**D2. Qualified: the content sweeps test affirmative use, not the presence of vocabulary.**
This is a deliberate weakening of a blunt test into a correct one, and it is worth naming
because it can be misread as a loosened assertion. `affirmativeSentences` (in
`tests/e2e/helpers.ts`, shared by the F&I, inventory and accounting suites) splits the
rendered text into sentences, keeps those matching the forbidden pattern, and drops those
that negate it. A non-empty result fails.

The cost is real: a page could in principle assert a forbidden concept in a sentence that
also contains the word "not". The benefit is that the disclosures survive. Both new routes
therefore carry a **paired positive assertion** — the denial must be present — so the sweep
cannot be satisfied by silence.

**D3. Both routes are complete HTML with scripting disabled. Yes.**
Six no-JS tests across the two suites cover the summary, the age buckets, the unit table,
the drill-through panel rendered from the URL alone, the balances, the four states, the
exceptions, and the search-and-order form as a native GET. A console that needs a bundle to
show what is on the lot is a console that shows nothing on a bad network.

**D4. `?unit=` is a URL, not client state. Yes.**
Copyable, correct under reload, correct under Back and Forward, and recovering visibly from
a unit identifier that names nothing — "Unit not found" with a way back, rather than a
silently empty page. **No warehouse surrogate composite appears in any URL the console
builds**, which is asserted directly against every exception drill-through href.

**D5. Zero critical or serious axe violations on both routes.**
Both are in `ALL_TESTED_ROUTES`, so the existing accessibility sweep covers them without a
new list. Beyond axe: one `h1` each, an accessible name on every table, a focusable scroll
container so a keyboard reader can pan a table wider than the viewport, and no horizontal
page scroll at 320 or 1920.

**D6. Counts.** 1,075 portfolio unit tests in 26 files; 710 end-to-end tests, of which 38
are the two new suites; 81 integration reconciliation tests including the two new
falsifiability cases; 116 reconciliations recorded per database run, 0 failing.

---

## E. The data lane — grain, size and what was cut

**E1. The unit view is month-end plus latest, not daily, and that decision was measured.**
A daily grain produced a **31.3 MB** export against the contract's 3 MB ceiling. Narrowing
`reporting.vw_inventory_units` to month ends plus the most recent snapshot gives 1,501 rows
at **1,023,530 bytes**, and had a second effect worth more than the size: it aligns 1:1 with
the accounting schedule, which is also month-end, so the unit drill-through's accounting
position is a real join rather than a nearest-date approximation.

| Artifact | Bytes | Rows |
|---|---:|---:|
| Root export, `inventory-units.json` | 1,023,530 | 1,501 |
| Root export, `inventory-accounting.json` | 970,574 | 1,501 |
| Root export, `inventory-gl-reconciliation.json` | 18,637 | 43 |
| Root export, `accounting-exceptions.json` | 2,358 | 4 |
| Generated, `datasets/inventory-units/` (18 partitions) | 313,255 | |
| Generated, `datasets/inventory-accounting/` (18 partitions) | 316,743 | |
| Generated, `datasets/inventory-gl-reconciliation.json` | 7,519 | 43 |
| Generated, `datasets/accounting-exceptions.json` | 2,102 | 4 |
| Largest single generated partition | 21,059 | |
| Root export tree, all 31 files | 15,663,504 | |
| Generated tree, all 218 files | 5,274,190 | |

**E2. Chunking was decided from those numbers.** The two unit-grain datasets are
partitioned by store × month, 18 each, every partition well inside the 256 KB ceiling. The
reconciliation set at 18.6 kB and the exception set at 2.4 kB are single files. Partitioning
them because it is the local pattern would have added two boundary rules and two manifest
chunk indexes to save nothing. The exception set has a second reason: its date column is
`exception_date`, the exception's own business date, so partitioning it would key partitions
by a third date semantic.

**E3. No surrogate key crosses the export boundary. Yes — after a correction.**
An `entity_id` column carrying warehouse composites (`20250930-1-2`) was exported and then
removed entirely, because it contradicted the contract note sitting three lines above it.
The drill-through was rebuilt from business columns. `vehicle_id` **is** exported, on the
unit-grain datasets only, narrowed under the `sale_id` precedent from `DASH.3`; `vin`,
`vehicle_key` and stock numbers remain prohibited.

---

## F. Route scoping — is the boundary real or stated?

**F1. An import is a graph edge, and the boundary suite asserts the importer set in both
directions. Yes.**
`inventory-chunks.ts` (313 kB of unit detail) and `accounting-chunks.ts` (317 kB) are
imported by `/dashboard/inventory` and by nothing else. `accounting-data.ts` carries the
43-row reconciliation set into `/dashboard` and `/dashboard/accounting`, and the exception
set into `/dashboard/accounting` alone.

`/dashboard` may import the reconciliation set precisely because 43 rows and 18 kB **is**
the whole comparison surface — the narrow set is the summary, so no second aggregate needed
inventing, which would have meant a second KPI formula. What `/dashboard` must not acquire
is the 630 kB of per-vehicle detail, and `dashboard-boundaries.test.ts` enumerates the
importers exhaustively rather than sampling.

**F2. No component touches an exact decimal. Yes.**
`ReconciliationSignal` takes pre-formatted strings only. The sign, the grouping and the
direction sentence are all decided in `lib/dashboard/executive.ts`. The boundary suite fails
the build if a component reaches for the exact-decimal helpers.

---

## G. Performance, measured

Production build, cold, compressed, by `scripts/report-bundle.ts` — the same method as
§9.3–§9.6 of `portfolio/docs/PERFORMANCE.md`. **A baseline, not a budget.**

| Route | HTML | Route JS | Total |
|---|---:|---:|---:|
| `/dashboard/inventory` | 74.5 kB | 164.5 kB | 369.1 kB |
| `/dashboard/inventory?unit=VEH-0000005` | 76.6 kB | 164.5 kB | 371.2 kB |
| `/dashboard/inventory?store=GSA-001&period=2025-11` | 47.3 kB | 164.5 kB | 341.9 kB |
| `/dashboard/accounting` | 33.4 kB | 164.5 kB | 328.0 kB |
| `/dashboard/accounting?store=GSA-001&period=2025-11` | 31.5 kB | 164.5 kB | 326.1 kB |
| `/dashboard` (heaviest console route, for scale) | 123.9 kB | 164.5 kB | 418.5 kB |

**Zero new client JavaScript.** 164.5 kB on both routes, the figure every console route
reports. Every section, every table and both disclosures are server components; the console
still has exactly one client island, the filter bar, and `DASH.9` added none.

**The store filter is the interesting measurement.** `/dashboard/inventory` narrowed to one
store costs 47.3 kB against 74.5 kB — **27.2 kB less**, because it opens one partition
instead of three. A page that filtered in the browser would have shipped all three stores'
units and hidden two thirds, and the payload would not have moved.

`/dashboard/accounting` is the **lightest console route in HTML** at 33.4 kB, below the
Deal Jacket and the F&I page, despite rendering the whole comparison. The reason is grain:
43 positions is a small surface, and the route resists the temptation to enrich it.

---

## H. Documentation and honesty

**H1. The export states its own limitations, and the stale ones were removed.**
`known_limitations()` carried "29 governed KPIs" and "inventory accounting is not modelled
yet" — the first false since `DASH.5`, the second false since `DASH.8`. Both are corrected,
and seven accounting limitations are added: not a chart of accounts, no financial-statement
assertion, not agreement between two independent systems, balances semi-additive, a missing
side never rendered as zero, the market estimate SYNTHETIC, no repricing recommendation,
floorplan never netted against book value. The test asserts the substance of each rather
than pinning a sentence, so the phrasing can improve without the guarantee weakening.

**H2. `DATA_DICTIONARY.md` section 15 described a table that did not exist.**
Three documented columns had never been created and three real ones were missing. See
section J.

---

## I. What this review found that the implementation had not

**I1. The inventory route decoded eighteen partitions on every request.**
Roughly 1,500 unit rows read to render a page showing one date. It made the route the
heaviest render in the console and the first page to flake under a parallel browser suite —
two accessibility tests that passed in isolation. The route now resolves ONE month from the
manifest's chunk index (metadata it already holds; no partition is opened to discover the
months) and decodes three partitions, or one when a store filter is applied. The flakes
went away because the cause did, not because a timeout was raised.

**I2. Six lane-count registries needed updating and only five were found locally.**
CI caught the sixth. The cause was running `pytest -x`, which hides every failure after the
first, and then re-running only one file after editing a shared constant. Recorded here
rather than in a commit message alone because the lesson is about the tool, not the count.

**I3. A migration checksum was written at the wrong nesting level** in `checksums.json`,
outside the `migrations` key. Silent, and it would have made the ledger's next verification
meaningless.

**I4. A boundary test matched its own prose.** The assertion for "no route outside
`/dashboard/inventory` imports `inventory-chunks`" matched a COMMENT containing the module
name. It now matches the import statement.

---

## J. The defect that reached `main`

`/dashboard/inventory` reported **288 active units**. The correct figure is **250**. Every
row was labelled GSA-001, and a store filter for GSA-002 or GSA-003 returned nothing.

`decodeDataset(cacheKey, file)` memoizes by key. The route passed the bare dataset name for
all three of its per-store partitions, so the first decode was cached and returned for the
other two — 96 rows, three times. Nothing about the result looked wrong: **every partition
of a dataset has identical columns**, so the wrong file is indistinguishable from the right
one in shape, in type, and at a glance. Only a reader who knew the lot had 250 units, or who
compared the store column against the store filter, would have found it.

Three things are worth recording.

**It was already a known hazard.** `fi.ts` carries a comment saying "ONE CACHE KEY PER
PARTITION, which is not a detail. `decodeDataset` memoizes by key". The warning existed and
was not enough. A comment does not prevent a defect in a file that does not contain the
comment.

**The unit suite could not see it.** `dashboard-inventory.test.ts` made the same mistake in
its own helper AND only ever asked for GSA-001, so the bug was invisible on both sides of
the test boundary. A test that reads one partition cannot detect a bug about reading three,
and the population assertion that would have failed — the union across stores — did not
exist until it was written.

**The fix is the class, not the instance.** Passing per-partition keys fixes this route.
`decodeDataset` now THROWS when one key is presented with two different files: each
generated file is a module-level object, so two partitions can never be the same reference,
and a silent wrong answer for the life of the process becomes a loud failure on the first
render. It fired immediately on the test helper above, which is the guard doing its job
before a human had to.

The honest summary is that this shipped, was merged, and was wrong in production for the
duration. It was found by writing the end-to-end test that renders the table and counts
what is in it — which is the argument for that test, made the expensive way.

---

**Power BI real-engine validation remains externally pending; this increment does not
change that state.** No TMDL, DAX, semantic-model relationship or Power BI artifact was
touched: `DASH.9` is a reporting-view, export and web-console increment, and the 49 DAX
measures the simulation covers are unchanged.
