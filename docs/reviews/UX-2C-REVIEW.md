# `UX.2C` — Demand, People and Controls, as built

What `UX.2C` did to `/dashboard/leads-marketing`, `/dashboard/employees`, `/dashboard/accounting`
and `/dashboard/actions`, measured against the before-figures in
[`UX-2C-BASELINE.md`](UX-2C-BASELINE.md) rather than described.

Same harness, same definitions, same conditions: production build (`next build`,
`next start -p 3111`), Chromium, 1440 × 900 and 390 × 844, `proseRepo` a rendered paragraph of
eight words or more outside `.sr-only` and outside a closed `<details>`, `proseEye` every such
paragraph at any length, route cost as compressed transfer from Resource Timing.

**One measurement convention changed and it is stated here rather than buried.** The
label-and-value rows the new figures draw — `Under 5 minutes … 87 · 10.4%` — were briefly
`<p>` elements and are `<div>`s in what shipped. They are data rows, not paragraphs; the
sections they replaced used `<div>` for the same shape, so the after-figures below count the
same kind of thing the baseline counted. The correction moved `proseEye` on Leads by 41 words
and on Accounting by 12, and changed no `proseRepo` figure.

---

## A. Baseline, and what replaced it

| Route | Height, desktop | Height, mobile | Framed figures | In first viewport | First figure | `proseRepo` | `proseEye` | Route cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Leads & Marketing** before | 8,821 | 11,896 | 7 | 1 | 639 px | 1,102 | 1,143 | 434.6 kB |
| Leads & Marketing after | **3,998** | **7,187** | 7 | **3** | 833 px | **555** | **673** | 451.6 kB |
| | −55% | −40% | — | +2 | +194 px | **−50%** | **−41%** | +17.0 kB |
| **Employees** before | 5,386 | 9,417 | **0** | 0 | — | 303 | 317 | 415.7 kB |
| Employees after | **4,169** | **6,311** | **2** | **2** | 790 px | 258 | 279 | 419.6 kB |
| | −23% | −33% | +2 | +2 | new | −15% | −12% | +3.9 kB |
| **Accounting** before | 3,290 | 5,032 | **0** | 0 | — | 422 | 453 | 402.6 kB |
| Accounting after | **2,408** | **4,228** | **2** | **2** | 783 px | 434 | 494 | 408.4 kB |
| | −27% | −16% | +2 | +2 | new | **+12 words** | +41 words | +5.8 kB |
| **Actions** before | **16,741** | **22,401** | **0** | 0 | — | 922 | 1,567 | 525.6 kB |
| Actions after | **7,437** | **17,551** | **1** | **1** | 370 px | 835 | **847** | 530.3 kB |
| | **−56%** | −22% | +1 | +1 | new | −9% | **−46%** | +4.7 kB |

`data-visual-region` — the hook `UX.2A` introduced so a first-viewport contract can be asserted
by measurement — was on **zero** elements across the four routes. It is now on **16**: eight on
Leads, three on Employees, three on Accounting, two on Actions.

**The first figure on Leads moved DOWN, from 639 px to 833 px, and that is the improvement.**
At 639 px the reader met the top edge of a funnel whose rest did not fit, behind 213 words of
prose. At 833 px they meet a seven-figure demand rail first — the route's first headline figure
of any kind — and then three complete figures inside the same screen.

**Under a filter the layout now responds.** `/dashboard/employees?role=finance` measures
1,683 px against the salesperson view's 4,169; `/dashboard/accounting?store=GSA-003` 1,787
against 2,408; `/dashboard/actions?severity=high` 3,576 against 7,437. Before `UX.2C` the
filtered Leads route measured 8,702 px against 8,821 — the shape did not move at all.

---

## B. Leads & Marketing

**KPI rail.** Seven figures at two weights, and the route's first headline figure of any kind.
Primary: valid leads (KPI-FUN-001), contact rate (KPI-FUN-002), appointment-set rate
(KPI-FUN-003), lead-to-sale (KPI-FUN-006). Context at half weight: show rate (KPI-FUN-004),
median response (KPI-FUN-008), never answered. Every card carries its own denominator as its
subtitle — `of contacted leads, not of all leads` under the appointment-set rate, which is the
single most misread figure on the route. One methodology disclosure at the foot of the rail
carries all seven definitions, the arrangement `kpi-strip.tsx` and `sales-workspace.tsx`
arrived at.

**Funnel architecture, and the grain separation (§8).** Two adjacent modules in one row, never
one shrinking ramp.

* `Lead cohort` — the five governed lead-grain stages on the lead-creation date, drawn as
  shares of valid leads so the shape *is* the conversion. Module meta reads
  `Lead grain · lead-creation date`.
* `Appointments` — five appointment-grain counts on two date bases. Module meta reads
  `Appointment grain · two date bases`.

The five lead-grain stages stayed in one figure and that is deliberate: `appointment_shown_leads`
and `sold_leads` are LEAD counts on the lead-creation basis, not appointment counts, so they
share the grain and the basis of the three above them. What §8 forbids — implying denominator
continuity into the appointment KPIs — is prevented by the split, not by breaking a figure that
was already honest. `Reached showroom` carries no rate and no identifier, because
`appointment_shown_leads / appointment_set_leads` is not KPI-FUN-004; a test asserts that
neither KPI-FUN-004 nor KPI-FUN-005 appears anywhere in the lead-grain figure.

**Cancellation treatment (§9).** Advance cancellations are the second BAR of the appointment
progression, drawn in a muted tone as the population removed before the show-rate denominator is
formed, with `23.1% of scheduled — removed from the show-rate denominator` on the line below.
The exclusion that makes show rate correct is now geometry rather than a sentence beside it. It
is not drawn as worse: a cancellation is not a failure and this project publishes no such
judgement.

**Response visualization (§10, §11).** Median headline, mean and P90 beside it, then the four
governed `RESPONSE_BANDS` — `Under 5 minutes`, `5-15 minutes`, `15-60 minutes`,
`Over 60 minutes` — as bars over the answered population. No band invented, no band coloured:
`UX.2C` §11 forbids good/acceptable/slow labels and this project holds no threshold that would
justify one.

**Never-responded treatment.** A row of the same figure, below a rule, drawn against **valid
leads** rather than against the answered population — because that is the population it is a
share of — and labelled as such. It is also a rail card. The line under it reads *"never
answered is not a response of zero seconds"*.

**Stage-loss visualization (§12).** The `DASH.10` mutually exclusive furthest-stage partition,
five bars against valid leads, with a test asserting the five counts sum exactly to the cohort
and that exactly five bars are drawn. Nothing is derived as shown-minus-sold. The walk-in
overlay is stated in words and is NOT a sixth bar: those leads are already inside an earlier
entry and adding them would double-count.

**Source visualization (§13).** `MeasureMatrix` — nineteen sources as rows, four measures as
aligned columns. The three rate columns share one 0–100% scale and compare directly, down a
column and across a row; the volume column is scaled to the largest source and shares no scale
with them, which the caption says. A rate with no denominator draws **no bar at all** and prints
its absence, asserted by a test that counts one fewer bar rather than a zero-length one.

**Marketing economics (§14).** Four headline figures, then the same matrix over sources for
spend, cost per lead, cost per sale and gross ROAS, then the ten-column campaign table behind a
disclosure. An organic source prints `Not applicable` and draws nothing. Gross ROAS is named a
contribution measure in one visible line; the rest is behind methodology.

`MarketingSourceRow` applies `marketingMeasures` — the same function, unmodified — at a third
documented group. The file already applied it at two: per source × campaign for the rows, and
over every cost-attributable row for the totals. KPI-MKT-001/002/003 keep their published
definitions at all three, the ratio-of-sums rule and the organic rule are inherited rather than
re-implemented, and a test asserts the source rollup's attributed leads equal the sum of its
campaigns' rather than a mean of their ratios.

**Vendor discrepancy (§15).** Kept, and demoted to the last analytical row at a third of the
width, as a four-step comparison of four counts of four different populations. It is a
reconciliation diagnostic and the demand funnel is the page's subject.

### Refused visuals

1. **A source scatter of conversion against spend or gross.** `buildSourceComparison` reads the
   lead funnel on the lead-creation date at daily grain over the selected period;
   `buildMarketingSummary` reads marketing performance over WHOLE CALENDAR MONTHS only. Whenever
   the period is not exactly a set of whole months the two populations differ, and a bubble
   whose position came from one and whose area came from the other would be a fan-out drawn as a
   finding. §13's own condition — *"only build this if all measures share a defensible source
   grain"* — is not met.
2. **One five-bar shrinking funnel spanning both grains.** §8, and the reasoning above.
3. **A response-time trend.** The response export is a binned distribution per store-month, not
   a time series; a trend would have to reconstruct a median per period from bins, and a median
   does not decompose.
4. **A cost-per-lead target line or benchmark band.** ARPI holds no benchmark for any figure on
   this route and publishes none.

### Prose

1,102 → 555 `proseRepo` words, **−50%**, against a §16 target of ≥35%. `proseEye` 1,143 → 673,
−41%. The fifteen methodology disclosures are still fifteen; what left the page is the visible
paragraphs that restated parts of them inline, and the four whose subject the modules now carry
in their own methodology (the denominators, the two grains, the cancellation exclusion, the
median). Every caveat §16 names as load-bearing is still visible: the denominator differences on
every rail card, the date bases in every module's meta or caption, the cancellation context in
the figure, the attribution caution as the marketing module's note, and the cost `Not
applicable` meaning in the matrix footnote.

---

## C. Employees

**Role navigation.** Unchanged in mechanism — four links, `aria-current="page"`, URL-addressable,
Back and Forward work, no script — and the surface it switches now materially differs.

**Role-specific visual design (§19–§23).** `FAMILY_PRESENTATION` gives each family its own
arrangement:

| Family | Bands | Mix placement | Why |
|---|---|---|---|
| Salesperson | one, `Gross per retail unit` | under | Volume leads; opportunity context decides whether two rows are the same job |
| Desk Management | one, `Gross per retail unit desked` | under | Non-retail units, outside the denominator, are stated on the row |
| Finance | one, `Income per retail unit` | **beside** | Both figures divide by every delivery including cash deals, which cannot generate reserve |
| BDC | **two**, `Lead grain` and `Appointment grain` | under | Two measures count leads and two count appointments |

Finance is the only family with the mix promoted and BDC the only one with two bands, and both
for a reason in the data rather than for visual rhythm. Tests assert that the Finance row
carries both income figures and the cash/lease split together with exactly one mix bar, and that
the BDC row prints both band names.

**Sample treatment (§24).** Every comparative figure carries its own denominator as a chip. Above
the floor it reads `n 23 retail units`; below it the figure prints the words `Insufficient
sample` and the chip reads `Sample 9 of 10 retail units` in the attention treatment. A test
asserts a suppressed row contains neither `0.0%` nor `$0.00`. The family rail draws the floor's
effect as a two-segment bar — how much of the family is publishable, before any figure in it is
read — which is a property of the data and not of the people.

**Context treatment (§26).** `DASH.11`'s fairness context did not shrink and was not meant to:
303 → 258 `proseRepo` words is −15%, and §26 and §53 both say the answer here is form rather than
length. Tenure, store, roster state, assigned leads, commonest source, desk involvement,
certified count, non-retail exclusions, never-responded and median response are all chips on the
row they qualify; the condition and structure mixes are drawn; the twelve-paragraph methodology
is unchanged and still behind its disclosure.

**No-ranking confirmation (§18, §25).** No rank, score, percentile, tier or composite. No sorted
bar, podium, medal, trophy, crown, star, badge, streak or flame. No red/green heat map. The
component maps over the order `orderEmployees` produced and contains no comparator and no
`sort` call. A test renders the real export and asserts the rendered `data-employee` sequence
equals the view's, that the view's sequence equals store|role|code ascending, and that it is
**not** descending by volume — which on this data it is not, so the assertion can fail.

**Privacy confirmation (§59).** A test asserts the rendered markup contains no `salary`,
`commission`, `pay plan`, `bonus`, `hire date`, `email`, `phone`, `gender`, `age`, `rank`,
`ranked`, `ranking`, `score` or `top performer` as a whole word, and that every code matches
`EMP-\d+`. The word `leaderboard` IS on the page — in the sentence that refuses to be one — and
the test asserts that exact sentence rather than banning the word, because deleting it would
remove the statement that makes the ordering rule legible.

---

## D. Accounting

**Balance visual (§29).** Two bars against **one shared maximum**, with the signed variance
marked on the same axis as the overhang between them. One scale is the whole point: scaling each
bar to its own maximum draws two identical full-width bars whatever the variance is, which is a
figure whose geometry never moves. A test asserts the larger side pins at 100% and the smaller
does not.

**Variance treatment.** Neither sign is coloured. The direction is carried three ways — which bar
is longer, the printed amount, and the sentence `varianceDirection` supplies — and a test asserts
the rendered markup contains no `data-positive`, `data-negative`, `text-verified` or `text-failed`.
The visible line reads *"Neither direction is favourable: this project governs no threshold above
which a variance becomes a failure."*

**Comparison states (§30).** The export's own closed set of four, drawn as a population of every
position at the date. Only the two MISSING-SIDE states take the attention treatment, and a test
asserts exactly that pair is marked: a one-sided position is a structural condition — no variance
exists and it is excluded from both totals — while a variance is a finding to investigate and
colouring it would be this console asserting a materiality threshold it does not have. No status
class was invented; `COMPARISON_STATES` throws on anything outside the four.

**Exceptions (§31).** A compact investigation list: business exception code, store chip, exception
date chip, signed amount, the detail, and the drill-through where the type has one. No surrogate
key and no internal identifier. The planted-scenario note is at the foot of the list rather than
three screens away, because a reader who took these for findings in a real dealership would have
taken away the opposite of what they show.

**CFO limitation (§32).** `Inventory control reconciliation. Not a general ledger.` is the route
subtitle, where it cannot scroll away. The full explanation — two sides from one synthetic model,
invented control accounts, the planted scenarios, the position-at-a-date rule — is behind the
header disclosure. No P&L, EBITDA, department statement, cash flow, journal entry, trial balance,
contract in transit, receivable or floorplan interest was added, because none exists in the
export.

**The prose rose and it is recorded rather than buried (§53).** 422 → 434 `proseRepo` words,
+12, and 453 → 494 `proseEye`, +41. Two new figures each need a caveat a reader would misread
them without: the shared-scale statement on the balance comparison, and the structural-versus-
finding distinction on the state population. Against that, the `Period ownership` region — 130
words at the foot of the page — became a table behind a disclosure. The route is 27% shorter and
has two figures where it had none.

---

## E. Actions

**Queue summary (§34).** The queue size, then four partitions of the queue drawn as bars: by
severity, by domain, by store, by review role. Each group scales to its own largest count,
because the four are different partitions of the same queue and lengths only compare inside one.
An empty facet value is absent rather than printed for symmetry — `buildActionQueue` already
filters a value out unless the queue contains it or the reader selected it, so the December queue
shows `High 18` and `Medium 29` and no `Low 0`.

**Severity and domain visuals (§36).** Two different identities from two different token
families. Severity is an ORDERED scale, because the register declares one. Domain is CATEGORICAL,
because Accounting is not more than Inventory, and is keyed on the exported domain code so a
domain keeps its mark when another leaves the queue. Five domains against a palette with three
chromatic entries means two domains take greys — a real limit, stated in the code, and the reason
the mark is never the carrier: every severity and every domain prints its word.

**Facets (§37).** The summary and the facet bar were the same numbers printed twice, one above
the other. They are one object now: the counts ARE the controls. The `nav` keeps its
`Filter the review queue` accessible name, every option is a link with `aria-current`, and the
counts remain counts of the **whole** queue — a test asserts that selecting `severity=high`
narrows `shown` without changing `total` or any domain count.

**Queue design (§35, §39).** Each prompt keeps severity, domain, store, review role, the title,
the observed value, the threshold that fired, the recommended review and the drill-through. The
rule identifier, the entity type and identifier, the date basis, the limitation text and the full
evidence set moved into the prompt's own `<details>` — still in the served markup, in reading
order, in a browser text search and with scripting off. Tests assert the rule identifier is
outside the visible flow and inside the disclosure.

The prompts render two-across above `@4xl`, which is where a 62-prompt queue's height came from.
`proseEye` fell 46% — 1,567 → 847 — and that is the number that captures what §39 targeted: 153
short repeated mechanics paragraphs are gone.

**`proseRepo` fell 9%, against the ≥25% this baseline set, and the reason is stated rather than
excused.** Roughly 800 of the remaining 835 words are 47 × `recommendedReview` — one sentence per
prompt saying what to look at. §39 names the drill-through guidance as something that stays
visible, so cutting it would have hit the target by deleting the substance. The rule-engine
documentation §39 actually targeted is the part that moved, and `proseEye` measures it.

**Change-driver design (§38).** The existing `ChangeDriverBridge` — the same `DASH.3`
decomposition the Executive already draws, through one shared module. There is no second bridge
formula in this repository. Volume, front PVR and back PVR effects with signed semantic colour,
neutral anchor, exact reconciliation, materiality remainder grouped and never dropped, and
`bridge attributes` rather than `caused`. It moved from the foot of an eighteen-screen document
to the first screen, beside the queue shape.

**No-workflow confirmation.** A test renders the queue shape and twelve prompts and asserts the
markup contains no `mark as done`, `mark done`, `assignee`, `assigned to`, `due date`, `snooze`
or `add a comment`, **and that the rendered tree contains zero `button`, `input` or checkbox
elements**. The words `completed` and `workflow state` do appear — in the sentence saying the
queue holds none of them — so the test asserts that sentence rather than banning the words.

---

## F. Accessibility

**axe.** Clean on all four routes with no suppressed rules, through the existing
`accessibility.spec.ts` sweep, which runs axe-core over every primary route.

**PR #55's definition-list guard is preserved and repointed.** The three
`/dashboard/leads-marketing` sections it was written against no longer render anywhere — the
figures that replaced them carry their qualifiers as bar labels rather than as definition lists,
so there is no `<dl>` left on that route to guard, and a guard pointed at a component nothing
renders is a test that passes because it is checking nothing. It now checks the lists `UX.2C`
does ship: the unassigned-activity block, and **every one of the exported action cards
individually** rather than one example. The rule, the fault detector and its own self-test are
unchanged.

**Keyboard.** Every drawn mark is `aria-hidden` with its value in text, so no bar is focusable —
asserted by a test that looks for a focusable `bar-track` on all four routes and requires zero.
Focus-stop counts: Leads 80 or fewer, Employees 80 or fewer, Accounting 60 or fewer, Actions 260
or fewer, which is the queue's 47 prompts × (link + disclosure) plus the facets. Every
`TableDisclosure` scroll region carries `role="region"`, `tabIndex={0}` and an `aria-label`.

**No colour-only meaning.** Severity, domain, comparison state, cost state and sample state all
print their word beside their mark. The one attention treatment on Employees is the suppression
state, spelled out on the same chip; the two on Accounting are the missing-side states, named in
the row.

**Chart alternatives.** Every figure is a `ChartFrame` with an accessible title and a summary
carrying its exact values, plus a `TableDisclosure` where a table adds anything. The matrix's
column keys are `aria-hidden` and the disclosure table carries the same headings as real
`<th scope="col">`, so a screen-reader user reads one representation rather than two.

**No-JavaScript.** All four routes verified complete with scripting off, per route and in the
`UX.2C` suite: the funnel and both progressions, every role family with its rail, samples and
context, both balances with every comparison state, and the queue shape with the bridge. The
Actions facets and the employee role switch both still navigate, because they are links.

**Responsive.** 320 / 375 / 390 / 768 / 1024 / 1280 / 1440 / 1920 with no horizontal page
overflow on any route, and no money value or identifier wrapping mid-token at 320 px.

---

## G. Performance

| Route | HTML | JS | CSS | Fonts | Other | Total | Δ total |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/dashboard/leads-marketing` | 80.5 kB | 189.3 kB | 48.1 kB | 84.9 kB | 48.7 kB | **451.6 kB** | +17.0 kB |
| `/dashboard/employees` | 48.6 kB | 189.3 kB | 48.1 kB | 84.9 kB | 48.8 kB | **419.6 kB** | +3.9 kB |
| `/dashboard/accounting` | 37.3 kB | 189.3 kB | 48.1 kB | 84.9 kB | 48.8 kB | **408.4 kB** | +5.8 kB |
| `/dashboard/actions` | 119.5 kB | 186.9 kB | 48.1 kB | 84.9 kB | 90.9 kB | **530.3 kB** | +4.7 kB |

**Client JavaScript owned by these four routes: zero bytes, before and after.** The JS column is
the framework and the shell, unchanged to the byte. Every figure `UX.2C` adds is server-rendered
HTML and CSS.

**Every increase is HTML and every increase is drawn geometry.** Leads is +16.9 kB of markup for
nineteen sources × four measure cells twice over, five appointment bars, four response bands plus
the never-answered row, five stage-loss bars and four vendor bars, each with its track, its
value and its table row. Accounting is +5.7 kB for two balance bars, the variance mark, four
state bars and the state tags. Employees is +3.8 kB for the floor bar, the store bars and the
context chips. Actions is +4.6 kB for four facet partitions drawn as bars, offset against the
prompt compaction. CSS moved 48.0 → 48.1 kB across the whole console.

Nothing was optimised away and nothing was hidden: a route that draws more marks carries more
markup, and 17 kB of gzipped HTML for a route that lost 4,823 px of height and half its prose is
the trade this increment makes.

---

## H. Data impact

| | Expected | Actual |
|---|---|---|
| New SQL | 0 | **0** |
| New warehouse objects | 0 | **0** |
| New reporting views | 0 | **0** |
| New export datasets | 0 | **0** |
| New KPI definitions | 0 | **0** |
| Power BI files changed | 0 | **0** |
| Generated dataset bytes changed | 0 | **0** — `dashboard:check` reports 38 datasets, 312 files, 7,356,934 bytes, unchanged |

**One view-model addition, and it is a grouping rather than a measure.** `MarketingSummary.bySource`
applies the existing `marketingMeasures` function at a third documented group. That function
already runs at two grains in the same file; the ratio-of-sums rule, the organic rule and the
zero-denominator states are inherited from it rather than re-implemented, so KPI-MKT-001,
KPI-MKT-002 and KPI-MKT-003 keep their published definitions. No SQL, view or export changed to
support it.

**One presentation-layer count.** The Accounting rail's `Units on the schedule` sums the exported
`stock_unit_count` across the positions at ONE date. A unit belongs to exactly one control
account, so this is addition of a partition rather than a statistic, it is never summed across
dates, and a scope publishing none renders `Not published` rather than zero.

**Shared primitives.** `FunnelChart` moved from `exec-visuals.tsx` to `workspace-visuals.tsx`,
which that file's own docstring required once a second route drew it, and the emptied file was
deleted. Its stage row now wraps rather than truncating — `Appointment set` rendered as `Appoi…`
in a three-of-twelve module, which is wrong at every width it happens at. `MeasureMatrix` is new
and lives in `leads-workspace.tsx` with two call sites on one route, per this repository's stated
rule that an abstraction over one call site is a guess about the second.

**Three `-sections.tsx` files are gone.** `leads-marketing-sections.tsx` and
`employees-sections.tsx` were emptied by the rebuild; what was left in the second — a mark, a
formatter and a nav — is not a section, so it moved into the workspace and the file was deleted
rather than kept for its name. `actions-sections.tsx` remains, holding the two evidence
formatters, the change-driver bridge and the two components the Executive renders.

**Chart library: still none, and the question was asked a fourth time.** The hardest case this
increment produced was the source comparison — nineteen identities against four measures, which
is exactly the shape a charting library's grouped-bar or small-multiples API exists for. It was
built as an aligned CSS grid instead, and the reason is unchanged from `DESIGN_SYSTEM.md` §6.0c
and §6.0e: the figure has to be in the served HTML, and three of the four candidates cannot
render server-side without a measured container. Nothing in `UX.2C` came close to justifying a
dependency; the record of the question is here rather than in a new ADR because the answer did
not change.

---

## I. Verification

| Gate | Result |
|---|---|
| `uv run ruff format --check .` | 319 files already formatted |
| `uv run ruff check .` | All checks passed |
| `uv run mypy src tests` | no issues in 172 source files |
| `uv run pytest -q -m "not integration" --cov=arpi` | **3,667 passed**, 1,229 deselected, 88.94% coverage |
| `check_naming.py` | OK — 2,427 files read |
| `check_docs_links.py` | OK |
| `check_reference_data.py` | every rule passed |
| `check_secrets.py` | OK — 1,301 files, 7 detectors |
| `check_project_capabilities.py` | OK |
| `generate_project_capabilities.py --check` | OK |
| `check_powerbi_model.py` | OK — 49 measures, 9,452 assertions |
| `simulate_semantic_model.py --check` | SIMULATED SEMANTIC-MODEL VALIDATION — 1,271 checks, 49/49 measures, 0 findings |
| `check_simulation_labels.py` | passed |
| `npm run format:check` / `lint` / `typecheck` | clean |
| `npm run manifest:check` / `inventory:check` / `dashboard:check` | up to date |
| `npx vitest run` | **1,455 passed**, 36 files |
| `npx playwright test --project=chromium` | **903 passed**, 0 failed, 0 flaky |

**Integration tests were not run locally and no claim is made that they were.** They need a
populated PostgreSQL database; GitHub CI exercises its canonical integration lane. No data-layer
file changed in this increment.

---

## J. Roadmap

| Increment | Status |
|---|---|
| `UX.2A` | **Implemented** |
| `UX.2B` | **Implemented** |
| `UX.2C` | **Implemented** |
| `UX.2D` | Planned — not begun |
| `DASH.13` | Planned — not begun |

**Non-goals held.** No `UX.2D` work: no cross-route interaction consistency pass, no shared
visual-vocabulary refactor beyond the two primitives that moved for a stated reason. No
`DASH.13` work: no route × viewport sweep beyond this increment's own four routes, no payload
budgets set, no release audit. No warehouse fact, dimension, reporting view, export dataset, KPI
definition or Power BI artefact was added or modified.

Power BI real-engine validation remains externally pending; `UX.2C` does not alter that state.
