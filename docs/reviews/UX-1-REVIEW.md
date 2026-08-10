# `UX.1` — review

The productization increment, answered question by question. Measurements are from
a production build served locally; the before-figures are
[`UX-1-BASELINE.md`](UX-1-BASELINE.md).

**Read the qualifications first.** Two things this increment set out to do were not
fully achieved, and both are stated in the answers rather than left to be
discovered:

1. **The 40% prose-reduction target was met on the operating shell and not on the
   page totals.** Visible prose on the Executive surface fell 2,636 → 2,523 words
   (−4.3%), not the 40% §44 asks for. What fell 37% is the distance to the first
   visualization, and what was removed entirely is the header's badge row, its
   breadcrumb, its eyebrow and its trust line. The remaining prose is chart
   captions and withheld-figure reasons; cutting it would have hidden caveats
   rather than mechanisms. Q28 gives the paragraph-by-paragraph account.
2. **Four cross-domain visualizations were refused rather than approximated**,
   because they could not be built honestly from a published grain. Q52 names all
   four and `PRODUCT_GAPS.md` §3 states each one's grain problem.

### How the review was carried out

Measurement and rendered-text inspection, not screenshot comparison. Every figure
in this document came from loading a production build in Chromium and reading the
DOM: visible paragraph text inside `<main>` excluding collapsed disclosures and
`sr-only` content, the scroll offset of the first `<figure>`, `<main>`'s own
height at 1440 × 900 and 390 × 844, and compressed transfer summed per route.

Screenshots were taken during the work and are not committed — the repository
does not store review captures, and `.gitignore` says so. The measurement tooling
was scratch and was removed before merge, per the increment's instruction not to
commit scratch tooling; what survives is the numbers it produced, in
[`UX-1-BASELINE.md`](UX-1-BASELINE.md) and in the tables below, and the two
permanent guards that now enforce what the review found —
`operating-copy.spec.ts` and `ux1-visual-geometry.test.tsx`.

The reason to prefer measurement here: the questions §72 asks — how many
paragraphs before the first visualization, can the primary question be answered in
ten seconds, does the page look like software or documentation — are answered more
honestly by a number a later reader can reproduce than by a capture only this
session could see.

---

## A. Product identity

**1. What is ARPI now presented as?** A dealership management intelligence platform.
The root URL renders the Executive Command Center; the engineering is one utility
destination behind it.

**2. What is the mission statement?** *ARPI gives dealership leadership one
operating view of the business, connecting sales, gross, inventory, F&I, marketing,
employee activity and accounting so managers can see what is happening, understand
the operating context, drill into the transactions behind it, and know where deeper
investigation is required.* Recorded in ADR-0015 and in `PRODUCT_VISION.md`.

**3. What business problem appears first?** *How is the group performing, and which
store is different.* The KPI rail, the trend, and the three-store comparison are one
region, in one eyeline, 1,389 px from the top.

**4. Is the stack secondary?** Yes, and it is checkable rather than asserted.
`operating-copy.spec.ts` fails if PostgreSQL, SQL, Python, TypeScript, Next.js,
React, TMDL, DAX, Power BI, a dataset version, a contract fingerprint, a semantic
model, a reporting view, a schema or a warehouse appears in the visible copy of any
of the nine operating routes.

**5. Is the synthetic state still clear?** Yes, and on more screens than before. The
rail carries *Granite Auto Group is fictional. Operating figures are synthetic.*
permanently; the control band's methodology summary carries the same sentence, so it
is above the fold at 1440 × 900 and at 390 × 844; the full statement is the first
thing inside the disclosure, asserted on all nine routes.

## B. Home

**6. What is canonical `/`?** The Executive Command Center. `ROUTES.home`, rendered
by `app/(operating)/page.tsx`.

**7. What happens to `/dashboard`?** Permanent 308 redirect to `/`.

**8. Are query parameters preserved?** Yes.
`/dashboard?period=2025-11&store=GSA-002` → `/?period=2025-11&store=GSA-002`,
asserted in `navigation.spec.ts` as the single most load-bearing assertion in the
file: every console link anybody has shared is a `/dashboard?…` URL, and a redirect
that dropped the filters would resolve all of them to the default period while the
page still looked correct.

**9. Are canonical tags unique?** Yes. A test walks `/`, `/technical`, all eight
view states, `/about` and `/inventory`, collects the canonical each declares, and
fails if two paths claim one.

**10. Does Executive appear immediately?** Yes. The first element in `<main>` is the
control band: name, scope, demo statement, filters. First `<figure>` at 1,389 px,
down from 2,194.

## C. Navigation

**11. What are the operating destinations?** Executive · Sales & Gross · Deals ·
Inventory · F&I · Leads & Marketing · Employees · Accounting.

**12. Is Technical one utility destination?** Yes — `/technical`, eight
server-addressable views, reached from the rail's utility group and from the
reference header.

**13. Is Actions hidden until built?** Yes. The rail names it as text under "Not
built yet — Actions · DASH.12" and never as a link. `site.test.ts` fails if a
planned label becomes a route the application can navigate to;
`navigation.spec.ts` asserts no anchor anywhere points at `/dashboard/actions`.

**14. Is the old sanitized inventory ambiguity resolved?** Yes, by name and by
placement. The rail's Inventory means `/dashboard/inventory` and nothing else;
`/inventory` is labelled **Reference listings**, is reached from Technical → Data
sources and from the footer index, and is not in the rail at all. The URL is
unchanged, so every deep link and its own `make`/`model`/`year`/`price`/`sort`
grammar keep working.

**15. Does mobile navigation work?** Yes. Compact app bar plus a drawer that traps
focus, closes on Escape, on a route change and on a scrim click, locks the body
scroll, returns focus to the trigger, and is unmounted rather than hidden when
closed. Every link in it clears the 44 px floor, measured across all of them.

## D. Filters

**16. Is period persistent?** Yes, to every destination that declares it applicable.

**17. Is store persistent?** Yes, same rule.

**18. Are incompatible filters dropped deliberately?** Yes. `navigation.ts` reduces
the context to the parameters the destination declares `applied` or `partial` and
returns the rest to their defaults. `?source=LDS-007` reaches Leads & Marketing and
is dropped for Accounting, asserted both ways.

**19. Are URLs shareable?** Yes. Serialization is canonical — `FILTER_KEYS` order,
defaults omitted, store list sorted — so two equivalent states produce
byte-identical URLs. A test walks every link carrying a query and fails on a
duplicate parameter.

**20. Does no-JS work?** Yes, and this was a defect first. The rail was wrapped in
`<Suspense>`, which makes Next stream it and land it with an inline script; with
scripting disabled the operating application rendered with no navigation at all.
`reduced-motion.spec.ts` caught it. The group declares itself dynamic instead, the
rail is in the initial HTML, and two assertions run with JavaScript off: the rail
navigates, and its hrefs carry the filter context.

## E. Executive

**21. Which KPIs are above the fold?** At 1440 × 900: retail units, total gross,
total gross per retail unit, back gross per retail unit — each with a prior-period
delta and a six-month microtrend — with lead-to-sale conversion, median inventory
age and aged inventory percentage on the same rail below the fold line.

**22. Which major visual is above the fold?** The KPI rail's microtrends. The first
framed figure — the retail-units trend — begins at 1,389 px, inside two screens.

**23. How many major visuals exist?** Eight framed figures on the Executive
surface, plus the KPI rail's microtrends, the pace bullets and the reconciliation
scale.

**24. Which filters move them?** Period, comparison and store move every figure.
Condition moves the inventory measures and says so; lead source moves the funnel and
says so. Both are marked *partial* on their chip.

**25. Is any geometry decorative?** No, and it is now a test rather than an
intention. `ux1-visual-geometry.test.tsx` renders each primitive against two
materially different datasets and fails if the emitted geometry does not change —
plus a determinism case, a flat-versus-varied case, and a not-vacuous case proving
the collector finds marks at all.

**26. Desktop page height?** 7,475 px, from 7,947 px.

**27. Mobile page height?** 13,919 px, from 15,479 px.

**28. How much prose was removed?**

| Route | Before | After | Δ |
|---|---:|---:|---:|
| Executive | 2,636 | 2,523 | −4.3% |
| Sales & Gross | 1,331 | 1,371 | +3.0% |
| Deal Jacket | 909 | 924 | +1.6% |
| Inventory | 336 | 405 | +20.5% |
| Leads & Marketing | 2,248 | 2,261 | +0.6% |
| Technical (overview) | — | 637 | — |

**This is the answer §44 asks for and it is not the answer §44 wanted, so here is
what actually happened.** The header prose came off every operating route — a
sentence-length `h1`, a lede, a supporting paragraph, a breadcrumb, an eyebrow, a
five-clause trust line and three provenance badges, on nine routes. What replaced it
is a name, one scope line and the controls. That is why the first visualization
moved 805 px up the page and the page got 472 px shorter while the word count barely
moved.

The words that did not come off are chart captions and withheld-figure reasons, and
`UX.1`'s own rule is that **a caveat is visible and a mechanism is disclosed**. The
mechanisms that could be moved were moved: the median-age computation, three
drill-through paragraphs that described their destination in up to 47 words, and the
executive page's second copy of the trust panel. What remains is the cohort basis of
the funnel, the semi-additive rule on every inventory figure, the reason each
withheld order statistic is withheld, the aged-threshold caveat, the
synthetic-estimate caveat, the fairness statement under the store comparison, and
the planted-scenario disclosure on the reconciliation. Cutting to 1,580 words would
have meant removing those, and §44 is explicit that the target may not be met by
deleting useful capability or making language cryptic.

Three routes went slightly UP, and the reasons are stated rather than averaged away:
Inventory gained a visible two-sentence caveat block, because the aged-threshold and
market-estimate caveats had been carried by the page header's lede and would
otherwise have been lost with it. Sales & Gross and the Deal Jacket gained a scope
line and a subtitle where a name alone would have misled.

**Recorded as an open item for `DASH.13`:** a methodology pass over the chart
captions themselves, which is where the remaining 1,500 words are.

## F. Operating routes

**29. Sales visual hierarchy?** Name and scope → filters → KPI row → trend → mix and
store contribution → the gross-change bridge → discount distribution → deal-level
distribution. Methodology behind the band's disclosure.

**30. Deal Explorer hierarchy?** Name and scope → filters and search in one band →
result count → table → pagination. The lightest operating route at 246 visible words.

**31. Deal Jacket hierarchy?** Deal id as the name, vehicle as the subtitle, store
and delivery date and check status as the scope line, a back link to the index →
fictional-transaction statement → identity → core economics → trade → F&I → staff →
lead → integrity → methodology. The formula verification is still complete and no
longer outranks the transaction.

**32. Inventory visual hierarchy?** Name → the two caveats that would misread the
page → filters, search and ordering → position rail → age distribution → price
against the synthetic estimate → unit table with drill-through.

**33. F&I visual hierarchy?** Name and scope → filters → back PVR, reserve, product
→ structure mix → penetration on eligible denominators → category economics →
adjustments → manager comparison under the sample floor.

**34. Leads visual hierarchy?** Name and scope → filters → the funnel, first framed
figure at 780 px → response distribution with the unanswered leads beside it → stage
partition → source performance → marketing economics.

**35. Employees visual hierarchy?** Name, scope and the role in view → role
navigation → comparison matrix → selected employee → sample state. Every `DASH.11`
fairness contract intact: no comparator argument, no composite score, no performance
sorting, no rate below its floor.

**36. Accounting visual hierarchy?** Name, the subtitle *Inventory control
reconciliation. Not a general ledger.*, the position date → filters → subledger, GL,
signed variance → the four comparison states → missing-side positions → exceptions
with drill-through.

## G. Technical consolidation

**37. Which technical route is canonical?** `/technical`.

**38–43. Where did each move?**

| Was | Now |
|---|---|
| `/architecture` | `/technical?view=architecture` |
| `/data-model` | `/technical?view=data-model` |
| `/kpis` | `/technical?view=kpis` |
| `/governance` | `/technical?view=governance` |
| `/status` | `/technical?view=status` |
| `/inventory-operations` | `/technical?view=data-sources` |
| the marketing home's store story, product tour and engineering proof | `/technical?view=overview` |
| — (new) | `/technical?view=product-vision` |
| `/inventory` | unchanged URL, relabelled *Reference listings*, reached from `?view=data-sources` |

**44. Do old URLs redirect?** All eight — the six above plus `/dashboard` and
`/dealerships` — are permanent 308s, none takes a path beneath it, and none is in
the sitemap. Derived from `LEGACY_TECHNICAL_ROUTES` so the redirect, the view
registry and the navigation cannot disagree.

## H. Content

**45. Which technical terms were removed from operating UI?** Every term in the
guard's list, and the specific sentences that carried them: the median-age
computation named the storage engine and the aggregate function; the gross bridge
said "computed in SQL"; the sale-type note said "no reporting view owns"; the F&I
identity said "proved in the warehouse"; the Deal Jacket's provenance line printed a
dataset version and a contract digest, and three of its sentences said "the
warehouse". The constant floor of *semantic model · SQL · Power BI* on all nine
routes came from one component, `<TrustLine>`, which no longer renders on them.

**46. Where is methodology now?** Three places, by kind. Route provenance is the
control band's disclosure, on every operating route. A metric's own definition is
the existing `KpiMethodology` disclosure on the card. A figure's mechanism is
`components/dashboard/methodology.tsx`, a `<details>` labelled *How this is
measured*.

**47. How is synthetic status shown?** One persistent line in the rail, the same
line as the methodology disclosure's summary, and the full statement inside it.

**48. Is repeated trust prose reduced?** Yes. The trust line was on all nineteen
routes; it is on the reference domain only. The Executive surface rendered the trust
panel twice — in the page header's line and in the evidence region — and now renders
it once, one screen higher.

**49. Are business labels dealership-native?** Yes: retail units, front gross, back
gross, gross per retail unit, aged inventory, inventory investment, lead-to-sale,
reserve, product gross, adjustment, GL balance, subledger, variance. GL, DMS, CRM,
KPI and PVR are deliberately not restricted — a controller says "GL" and means the
general ledger.

## I. Visualization

**50. Which visuals are new?** None, and that is the increment's scope. `UX.1` added
no chart. What it changed is where the existing ones sit, what stands in front of
them, and whether a test can prove they move.

**51. Which are cross-domain?** The Executive surface already reads five domains —
sales, gross, inventory, demand, accounting integrity — and `UX.1` brought the
accounting signal and the inventory summary into the same eyeline as the KPI rail
rather than four regions below it. No new cross-domain JOIN was created.

**52. Which were refused due to unsupported grain?** Four, each recorded in
`PRODUCT_GAPS.md` §3 rather than approximated:

- **Inventory mix against delivered mix** — a position at a date drawn against a
  period total.
- **Days in stock against front gross** — computable at deal grain, refused because
  with no control for condition, model year or trade involvement it invites a causal
  reading the data cannot support.
- **Lead economics as one row per source** — attributed gross excludes walk-in
  business, so summing it by source would silently drop a population a reader would
  assume was included.
- **A single store operating pulse row** — six measures on six grains and four date
  bases, and a composite of them would be a store score.

**53. How does colour encode meaning?** Unchanged. Categorical store marks derived
from the business code, never from row position; `zone-*` washes encode a business
area and never a state; the age ramp is keyed on exported bucket order.

**54. Is red/green governed?** Yes, and only in the three cases it already was:
which side of zero a signed value falls, whether an explicit target was met, and how
old a unit is. No employee, store or source is coloured by outcome.

**55. Is every major visual data-driven?** Proved, not assumed —
`ux1-visual-geometry.test.tsx`, Q25.

## J. Personas

**56. Can a GM complete the acceptance tour?** Yes. From `/`: read group units,
gross and GPRU in the KPI rail; compare the three stores in the same region; read
pace against plan; read the age distribution and capital; read the funnel; drill to
Sales & Gross, then to one deal; move to Inventory, F&I and Employees; return to
Executive. Period and store survive every step, and no step requires Technical.

**57. Can a GSM answer gross-change questions?** Yes — the documented bridge on
Sales & Gross, with the new/used split, the store contribution and the discount
distribution beside it.

**58. Can a Used Manager inspect inventory risk?** Yes — age bands, capital by band,
price against the synthetic estimate, price movement, unit drill-through. No
repricing recommendation, and the estimate is labelled synthetic everywhere.

**59. Can an F&I Director inspect production and adjustments?** Yes — back PVR split
into reserve and product, structure mix, penetration on each category's own eligible
denominator, adjustments on their own posting dates.

**60. Can a BDC Director inspect funnel and response?** Yes — the lead-created
cohort funnel, the response distribution with the unanswered leads preserved beside
it, where the cohort stopped, and spend against attributed outcomes.

**61. Can a CFO inspect inventory control and accounting?** Yes, within what the
model holds: subledger against GL controls, signed variance, four comparison states,
missing sides preserved as missing, exceptions with drill-through, inventory
investment.

**62. Which CFO questions remain impossible?** Operating profit, departmental
statements, controllable expense, cash, receivables, contracts in transit, floorplan
interest, factory receivables, trial balance, journal activity, month-end close and
EBITDA. All twelve are verified absent from the warehouse and listed in
`PRODUCT_GAPS.md` §4. The accounting route's own subtitle says *Not a general
ledger.*

## K. Engineering

**63. Was runtime DB access added?** No. ADR-0013 is unchanged: the browser consumes
committed governed exports and nothing else.

**64. Was a second KPI engine added?** No. The rail parses the URL with the same
`parseFilters` the server uses, reduces it with the same applicability declaration
and serializes it with the same canonical writer; the destination re-parses the
resulting link on the server. No arithmetic moved to the client.

**65. Were KPI definitions changed?** No. 29 governed KPIs, unchanged.

**66. Were warehouse facts changed?** No. 5 facts, 8 dimensions, 28 reporting views,
38 export datasets — all unchanged.

**67. Were Power BI files changed?** No. Zero files under `powerbi/`.

**68. Was a chart library added?** No.

**69. If yes, why?** Not applicable. The existing hand-built primitives carried every
requirement without becoming a charting framework: `UX.1` added no primitive, so the
`DASH.3-02` evaluation did not need reopening.

**70. What is the bundle delta?** Route JavaScript on every operating route fell
**317.9 kB → 170.6 kB (−46%)**, and total route cost on the Executive surface fell
**680.6 kB → 432.2 kB (−36.5%)**. `UX.1` ADDED an island and the routes got lighter,
because the rail replaced a masthead that prefetched all seven reference
destinations from every operating page. Full table in `PERFORMANCE.md` §9.10.

**71. What is the client-island delta?** +1 on operating routes (the rail), 0
elsewhere. It imports no dataset; the modules it does import were already in the
client bundle for the filter bar.

## L. Quality

**72. Vitest count?** 1,306 passing, up from 1,244. New: 14 geometry-contract cases.

**73. Playwright count?** 795 passing on Chromium, up from 791. New:
`operating-copy.spec.ts` (22 cases), plus redirect, canonical-uniqueness,
filter-continuity, rail and no-JS cases in `navigation.spec.ts` and
`reduced-motion.spec.ts`.

**74. axe result?** Clean. Zero serious or critical violations across the sweep, no
suppressed rules. The definition-list guard from PR #55 is unchanged and still
enforced.

**75. no-JS result?** Every reference route readable; the technical destination fully
navigable across all eight views; the operating rail navigates and carries the
filter context. All asserted with scripting disabled.

**76. Responsive result?** 320 / 375 / 390 / 768 / 1024 / 1280 / 1440 / 1920 with no
horizontal page overflow, and reflow clean at 200% zoom.

**77. CI result?** Reported on the pull request head.

**78. Frontend result?** Reported on the pull request head.

### The deployment-verification workflow, and a soundness hole it exposed

`verify-deployment.yml` runs the remote suite against the live deployment, and it runs
on a pull request that touches the remote suite or the evidence file — which `UX.1`
does. It went red, and the reason is worth recording because it is not a defect in this
branch.

The deployment serves `main`, at `f5a1eac`. The remote suite is read from *this* tree,
where the routes are `UX.1`'s. Twenty-six assertions written for the new build were
evaluated against the old one; the host answered every request. **On a pull request the
deployment is never running the branch under review, so a branch that changes routes
could not make this check green by any means available to it.**

Underneath that is a real soundness hole. The recorder wrote `commit_sha` — the commit
read off the *deployment's* footer — into the same record as check results produced by a
suite read from the *workflow's* tree. When those differ the record claims a commit
passed checks that were never run against it, which is the precise failure
`portfolio_deployment.json` exists to prevent.

The fix names the commit. `record_deployment_evidence.py` takes `--expect-commit`, and
the workflow passes the head SHA. When the deployment is running something else the run
is **reported and nothing is written**: the register is only ever written by a run that
observed the artefact it describes. Such a run cannot fail the branch either, for the
same reason it cannot verify it. What it can still fail on is the host not answering at
all — that is a fact about the deployment, not about the artefact on it.

The first attempt at that fix was still wrong, and the way it failed is the clearest
statement of the principle. It kept the *health-path* probe as a hard failure, reasoning
that a health check is about the host. It is not. `health_path` is declared by this tree
and names `/technical`, a route `UX.1` created; asking a deployment running the previous
commit for it is the same category error one level down, and the job failed with "the
deployment did not answer" about a deployment that had answered `200` on `/`. Only the
homepage is artefact-independent, because `/` exists in every build. So the health result
counts as a verdict when the commits agree and is reported as context when they do not.

A manual run after a deploy is unaffected and still strict: the SHAs agree, every check
must pass, and the evidence is written. Comparison is by prefix in both directions, so an
abbreviated SHA in the footer is the commit it abbreviates; `UNVERIFIED`, an empty value
and anything shorter than seven characters all answer *not a match*, because not knowing
must never resolve to *same commit*.

Two bindings moved with the routes. `status_route` named `/status is reachable`, a test
`UX.1` renamed; it is now `health_route`, bound to the role rather than the path so the
next move of the health route does not silently retire the check. `retired_urls` is new
and binds the eight permanent redirects, which are a property of the build and would
otherwise be the one `UX.1` guarantee the deployed-site suite did not record.

The evidence file's own recorded run is left exactly as it stands. It is a faithful
record of what happened on 2026-08-01 against `b90e3244` — 81 passed, 0 failed — a
commit where `/status` did exist, and rewriting an observation by hand is the thing this
repository forbids most plainly. Its `checks` therefore still carry the key
`status_route`, which is the correct name for what that run measured.

## M. Roadmap

**79. `UX.1` status?** Implemented.

**80. `DASH.12` status?** Planned. Untouched — no action rule, no action dataset, no
route, no navigation item.

**81. `DASH.13` status?** Planned. Untouched.

**82. What product gaps move to future roadmap?** In the order `PRODUCT_GAPS.md` §6
sets: the general ledger and financial statements; service and parts; the four
refused presentation-grain views; real market data; authorized source integration.

---

Power BI real-engine validation remains externally pending; `UX.1` does not alter
that state.
