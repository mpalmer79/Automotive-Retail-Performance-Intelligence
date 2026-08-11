# Information Architecture — ARPI Dealer Operations Command Center

**Status:** As-built through `DASH.11` and restructured by `UX.1`; planning contract for
`/dashboard/actions` (`DASH.12`) alone.

> ### `UX.1` moved the console to the site's root
>
> [ADR-0015](../architecture-decisions/ADR-0015-product-first-operating-experience.md) makes the
> Executive Command Center the canonical entry experience. **`/` renders it and `/dashboard` is a
> permanent 308 redirect to `/` with the query string preserved.** The seven sub-routes are
> unchanged and every deep link into them still resolves.
>
> Three other things in this document were superseded rather than deleted, and each is marked
> **Superseded by `UX.1`** where it appears: the console's internal navigation (§2) is now the
> operating rail rather than a bar under the page header; the public header no longer carries a
> Dashboard item because the site's front door IS the console; and cross-route filter continuity
> (§6) is implemented rather than planned. The pre-`UX.1` text is kept because it records what was
> built and why, which is the point of an as-built document.
Sections marked **As-built** record what shipped and where it diverges from the plan, with the
reason. Nothing in this document was quietly rewritten to match the code.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md) ·
portfolio [`CONTENT_MODEL.md`](../../portfolio/docs/CONTENT_MODEL.md) / `lib/site.ts` conventions

---

## 1. Primary routes

| Route | Title | Status | Registered in |
|---|---|---|---|
| `/` | Executive Command Center | **Built (`DASH.2`), moved to `/` by `UX.1`** | `ROUTES.home` in `portfolio/src/lib/site.ts`, mirrored in `tests/e2e/routes.ts`. `/dashboard` is a permanent 308 to `/`, query preserved |
| `/dashboard/sales-gross` | Sales and gross | **Built (`DASH.3`)** | `ROUTES.dashboardSalesGross`, mirrored in `tests/e2e/routes.ts` |
| `/dashboard/deals` | Deal Explorer | **Built (`DASH.3`)** | `ROUTES.dashboardDeals`, mirrored in `tests/e2e/routes.ts` |
| `/dashboard/deals/[saleId]` | Deal Jacket (dynamic; title carries the synthetic deal id) | **Implemented (DASH.4)** | dynamic — excluded from `inPrimaryNav`, sitemap lists the index route only, and each jacket asks not to be indexed. Marks Deal Explorer current via `NavItem.matchPrefixes`: nobody navigates to "a deal", so it is a drill-through rather than a navigation destination |
| `/dashboard/inventory` | Inventory operations | **Built (`DASH.9`)** | `ROUTES.dashboardInventory`, mirrored in `tests/e2e/routes.ts`. Carries the `unit=` drill-through, which is a URL rather than client state: copyable, correct on reload and under Back/Forward |
| `/dashboard/fi` | F&I performance | **Built (`DASH.7`)** | `ROUTES.dashboardFi`, mirrored in `tests/e2e/routes.ts` |
| `/dashboard/leads-marketing` | Leads and marketing | **Built (`DASH.10`)** | `ROUTES.dashboardLeadsMarketing`, mirrored in `tests/e2e/routes.ts`. `source=` and `campaign=` reach every measure on the route including the appointment outcomes, which is what `reporting.vw_appointment_source_funnel` was added for. `compare=` is declared `not-applicable` here: cohort maturity dominates every conversion and cost measure, so a period-over-period delta would report immaturity as a change in performance |
| `/dashboard/employees` | Employee performance | **Implemented (DASH.11)** | ” |
| `/dashboard/accounting` | Accounting integrity | **Built (`DASH.9`)** | `ROUTES.dashboardAccounting`, mirrored in `tests/e2e/routes.ts`. The exception drill-through targets this route with `store` and `period`, never a warehouse surrogate |
| `/dashboard/actions` | Management actions | Planned (DASH.12) | ” |

**Superseded by `UX.1`.** ~~The public header gains exactly one destination: Dashboard →
`/dashboard` — the seventh `PRIMARY_NAV` item, at the existing `MAX_PRIMARY_NAV_ITEMS = 7` cap.~~

The site has two navigations now, on two disjoint sets of routes:

- **`OPERATING_NAV`** — the application rail. Eight destinations: Executive, Sales & Gross, Deals,
  Inventory, F&I, Leads & Marketing, Employees, Accounting. Rendered by
  `components/shell/operating-rail.tsx` on every route in the `(operating)` route group.
- **`PRIMARY_NAV`** — the reference header, three items: Executive (back into the application),
  Technical, About. Rendered by `components/shell/site-header.tsx` on the `(site)` group.

`MAX_PRIMARY_NAV_ITEMS = 7` is unchanged and now unspent: the header uses three of it.

**As-built (`DASH.2`).** Only `/dashboard` is registered in `ROUTES`. The nine routes above it in
this table are *not* registered, because a route entry is what puts a destination into the footer
index, the sitemap and the navigation sweep — and a sitemap entry for a page that 404s is a promise
the project does not make. The Dashboard item sits **second** in the header, after Overview: it is
the product the project builds toward, and placing it after four documentation destinations would
have made the header disagree with what the site is for. `dashboard.spec.ts` asserts each of the nine
unbuilt routes answers 404 and that no anchor anywhere on the console points at one.

## 2. Internal dashboard navigation

**Superseded by `UX.1`.** `DashboardNav` and `PlatformNav` are both gone. The console's eight
destinations are the operating rail — a left rail at `lg` and above, a drawer below it, one list of
links, `aria-current="page"` on the current one, explicitly not `role="tablist"` for the same reason
recorded below. The four platform routes are states of `/technical` and are linked by `TechnicalNav`,
which follows the same pattern.

**What the rail added that the bar did not have:** every rail link carries the reader's analytical
context to its destination, and drops the parameters the destination declares `not-applicable` (§6).
That was planned here from the beginning and was not implemented until `UX.1`.

The original as-built record follows.

`DashboardNav`, following the `PlatformNav` pattern exactly: a `<nav aria-label="Dashboard">` of
plain links with `aria-current="page"`, rendered on every dashboard route between the page header
and content. Explicitly not `role="tablist"`. Order: Command center · Sales and gross · Deals ·
Inventory · F&I · Leads and marketing · Employees · Accounting · Actions.

- **Desktop (≥1024px):** single horizontal row under the site header; the current item carries the
  hairline-rule current marker.
- **Mobile:** the same list inside a native `<details>` disclosure labelled with the current page
  name ("Section: Sales and gross"), so all ten destinations never render as a horizontally
  scrolling strip. No horizontal page overflow at 320px.
- Filter state (§6) is **preserved across internal navigation** where the target page supports the
  parameter, and silently dropped where it does not (with the target page's filter summary making
  the active set visible).

**As-built (`DASH.2`).** `DashboardNav` follows `PlatformNav` exactly — `<nav aria-label="Dashboard">`,
plain links, `aria-current="page"`, explicitly not `role="tablist"` — and carries **only implemented
destinations**, which today means one. The other nine are rendered on the page as text under "What
this console does not do yet", each beside the increment that delivers it, so a reader can check the
claim against the backlog rather than take "coming soon" on trust.

Two divergences from the plan above, both because the list is one item long:

- **The mobile `<details>` presentation was not built.** Its purpose is to stop ten destinations
  rendering as a horizontally scrolling strip. With one destination it would be a disclosure a reader
  has to open to find the page they are already on, and the wrapping row it replaces cannot overflow
  at 320px at this length (asserted at eight widths). It arrives with the increment that makes the
  list long enough to need it.
- **Filter preservation across internal navigation is untestable and unbuilt**, because there is no
  second console route to navigate to. The mechanism it needs already exists — `filtersHref()` in
  `lib/dashboard/filters.ts` serializes a state onto any pathname — and the first route that ships
  beside this one will use it.

## 3. Page hierarchy

Every dashboard page:

1. Site header (unchanged) → breadcrumbs (§5) → `PageHeader` (h1, lede, `TrustLine` with dashboard
   scope) → `DashboardNav` → context header (§7 of the program: selected period, comparison period,
   store scope, as-of date, dataset version) → filter bar → content sections (h2) → drill-through
   detail (h3).

**As-built (`DASH.2`).** `/dashboard` renders, in order: context rail (six facts) → active-filter
summary with per-chip removal → filter bar → the full synthetic statement → primary KPI row (seven
governed cards in two ranks) → store scoreboard → sales and gross in brief → inventory risk → lead
funnel → trust and evidence → what is not built. The KPI row is set in two ranks rather than seven
equal cards, because an operating meeting does not treat volume, gross and gross per unit as equal in
weight to the four figures that qualify them.

**As-built (`DASH.5`).** A **targets and pace** section (`#targets`) is inserted after the primary KPI
row and before the store scoreboard, and the scoreboard gains **one** compact pace column.
`/dashboard/sales-gross` gains the same section after its performance block. The placement is
deliberate: **the actual is the business result and the plan is the management context beside it**, so
target context never displaces or outranks the figure it qualifies. The section carries, for retail
units and total gross: actual month-to-date, target, attainment, the selling-day clock ("Day 14 of 26
selling days"), the rate per selling day, and the **selling-day pace projection** — always beside the
actual and the target, never alone.

**As-built (visual overhaul).** `/dashboard` no longer runs as nine independently-padded page
sections. It ran as seven rows on a twelve-column console grid, and now runs as **five regions** on
the same grid, at `Container width="full"` (96rem) with `Section rhythm="tight"`.

**As-built (semantic-colour and density pass).** Seven rows was one region per *component*. Five is
one region per *question a general manager asks*, which is the arrangement below:

| Region | `id` | Question | Contents | Grid at ≥1280px | Ground |
|---|---|---|---|---|---|
| 1 | `#context` | what am I looking at, and how do I change it | banners, context rail, filter bar | 12 | evidence |
| 2 | `#group-performance` | how did the group do, over what shape, and which store is different | seven KPI cards with their own microtrends · operating trend · three-store comparison | 12, then 7 / 5 | `zone-performance` |
| 3 | `#targets` | where is the month against plan, and what is standing on the lot | targets and pace · inventory risk, the age stack and the `/dashboard/inventory` drill-through | 5 / 7 | `zone-plan`, with the stock pane on `zone-inventory` |
| 4 | `#composition` | what produced the units, and what the gross was made of | gross composition and unit mix · lead funnel and the `/dashboard/leads-marketing` drill-through | 7 / 5 | `zone-funnel` |
| 5 | `#accounting-integrity` | does the ledger agree, and what can this console prove | the GL-versus-subledger scale and its `/dashboard/accounting` drill-through, then three disclosures: `#store-scoreboard`, `#trust`, `#not-built` | 12 | evidence |

Measured against the seven-row arrangement, at 1440×900 and 390×844:

| | Before | After | Change |
|---|---|---|---|
| Visible prose words | 1,744 | 1,003 | −42.5% |
| Prose paragraphs | 61 | 39 | −36.1% |
| All visible words | 3,541 | 2,407 | −32.0% |
| Region headings (`h2`) | 8 | 4 | −50% |
| Page height, desktop | 11,595 px | 8,731 px | −24.7% |
| Page height, mobile | 23,762 px | 17,095 px | −28.1% |

Five things about this arrangement are load-bearing rather than aesthetic.

- **The reading order is `SEE → COMPARE → INVESTIGATE → PROVE`.** The original order asked a reader
  to read roughly a thousand words of always-visible prose before the first comparison they could
  make by eye, and only three parts of the page carried data-driven geometry at all. Nine
  visualisations now do, every one of them drawn from a governed selector.
- **The KPI row, the trend and the store comparison are one region.** They are one question read at
  three grains — the figure, its shape, and whose it is — and separating them cost two headings, two
  eyebrows and two paragraphs while putting the store bars outside the eyeline of the figure they
  decompose.
- **The store scoreboard is a disclosure, not a region.** Region 2 carries the *comparison* — two
  governed measures across the stores, as bars. The ten-column table is the *investigation*, and a
  report is not what an operating console opens with. Both are on the page; neither replaces the
  other.
- **`<details>` collapses, it does not remove.** The scoreboard, the trust evidence and the delivery
  backlog are all in the served document while shut: in the accessibility tree's reading order, in a
  browser text search, in print, and with scripting off. `dashboard.spec.ts` asserts each claim
  twice — once against the served HTML with the disclosure closed, and once against the rendered
  text with it open — because a `textContent` sweep alone would pass for a disclosure that never
  opened. The three `id`s moved onto the `<details>` elements so the anchors still resolve. The two
  disclosures that can answer without matching rows render even when the filter matches nothing: a
  reader whose filter returned nothing is the reader most likely to be asking what the data is.
- **Region 5 is the `DASH.9-03` executive signal, and it drills through.** `DASH.9` delivered the
  reconciliation view model, its tests and the narrow data door, and `accounting-data.ts` records
  that the 43-row GL comparison set "IS the Executive summary" for this route. This region reads that
  set and nothing else — the 360 kB of per-unit book values in `accounting-chunks.ts` stay with
  `/dashboard/accounting`, and `dashboard-boundaries.test.ts` fails the build if this route opens
  them. Both operating routes are built, so region 5 links to `/dashboard/accounting` and region 3's
  inventory pane links to `/dashboard/inventory`. The link is the reason the Executive region can
  stay a summary — a reader who needs the four comparison states account by account, or the units
  behind the age stack, follows it rather than having the detail reproduced here.

  `dashboard.spec.ts` asserts both drill-throughs positively, by clicking them and checking the
  destination's `h1`. The negative it replaced — "links to no accounting route, because none is
  built" — was correct through `DASH.8` and false after `DASH.9`. The route-integrity sweep it was
  protecting is unchanged in shape but shorter by one: `DASH.10` moves
  `/dashboard/leads-marketing` out of `UNBUILT_DASHBOARD_ROUTES` in the same diff that makes the
  destination real, and the Executive lead-funnel pane gains a drill-through to it carrying the
  reader's current filters. `DASH.11` does the same for `/dashboard/employees`, which also leaves
  `PLANNED_DASHBOARD_SECTIONS` in that diff rather than a later one. `/dashboard/actions` is the ONE
  section left: still asserted unreachable from every console route and still asserted to 404 when
  fetched directly.

**A region's ground marks a business area and encodes no state.** The stock area is amber whether the
lot is clean or ageing badly. Every ground is a `zone-*` token and none of them is a `data-*` token,
so a tint can never be mistaken for a value — `dashboard-visual-refinement.test.tsx` asserts the two
vocabularies share no value. The grounds are opaque rather than a fractional opacity, because a
translucent wash makes the real ground a composite and the contrast floor is measured against the
token; all four therefore join the four whites in `tokens.test.ts`.

Prose that moved rather than prose that was deleted: the region ledes are one sentence or absent
entirely; the full `SYNTHETIC_DATA_STATEMENT` sits in the "Data and methodology" disclosure; the
contribution and mix qualifications are in per-figure disclosures; three chart summaries are
`sr-only` because the component below each already prints every figure the sentence carries. The
caveats that stayed visible are the ones a figure would be **misread** without: the lead-creation
cohort caveat, the semi-additive snapshot statement, the aged-threshold project default — now printed
on the age stack itself, where the colour ramp turns on it — the statement that the funnel share
column is not a governed KPI, and one sentence naming what the console's colour does and does not
mean.

2. One `h1` per route; no skipped heading level (existing sweep rule).
3. Section order is fixed per page and documented in that page's increment item — summary first,
   analysis second, detail tables last.

## 4. Drill-through paths

| From | To | Carries |
|---|---|---|
| Executive KPI card | Owning page (`/dashboard/sales-gross`, `/dashboard/inventory`, …) | Period, comparison, store filters |
| Executive inventory pane (row 4) | `/dashboard/inventory` | none — the destination resolves its own snapshot from the same governed calendar |
| Executive accounting signal (row 6) | `/dashboard/accounting` | none — the destination resolves its own comparison date from the same governed rule |
| Store scoreboard row | Same page filtered to the store | `store=GSA-00#` |
| Sales/gross deal table row · deal index row | `/dashboard/deals/[saleId]` | none (deal id is the key) |
| Inventory unit row | Unit detail panel on `/dashboard/inventory` (`unit=` param) | Stock reference |
| F&I manager row | `/dashboard/fi?employee=EMP-#####` | Manager filter. **As-built the parameter is `employee=`, not `manager=`**: the console has ONE filter grammar and one parameter for a person, and a route-specific spelling of the same concept would have been a second vocabulary for `filters.ts` to reconcile. Scopes both the numerator and the eligible denominator of every penetration figure. |
| Employee row (Finance) | `/dashboard/fi?employee=EMP-#####` | **`DASH.11`, and the same parameter.** The F&I route declares `employee` `applied` and scopes both sides of every penetration figure by it, so the finance rows link there with the code. This is the reverse of the row above and deliberately reuses its parameter rather than introducing a second spelling. |
| Employee row (Salesperson, Desk) | `/dashboard/sales-gross` | **Filters carried, employee NOT carried.** That route declares `employee` `not-applicable`, and a parameter the destination cannot honour is a false drill-through. The link says so in its own caption rather than implying a person-scoped view. |
| Employee row (BDC) | `/dashboard/leads-marketing` | Same rule. The governed store funnel, explicitly not filtered to the person. |
| Executive lead funnel (row 5) | `/dashboard/leads-marketing` | The reader's whole current filter state, via `filtersHref` |
| Funnel stage / lost-stage cell | **Not built, deliberately.** `DASH.10` reserved a `stage=` parameter and did not add it: the page already renders the whole stage partition, so a stage filter would scope nothing a reader cannot already see, and a query parameter that changes no result is a promise the URL does not keep | — |
| Accounting exception row | Deal Jacket accounting section, or inventory unit detail | Entity id |
| Action row | The rule's declared drill-through route | Entity id + period |
| Deal Jacket lineage drawer | `/kpis` catalogue entries | KPI id anchor |

Every drill-through is an ordinary link (server-rendered `<a>`), so back/forward, open-in-new-tab,
and copy-link behave.

## 5. Breadcrumb behavior

`Breadcrumbs` (existing component) on every dashboard route below the root:
`Dashboard → <Page>` and `Dashboard → Deal explorer → SLE-00001234`. The current page is text, not a
link. Breadcrumbs never encode filters.

**As-built (`DASH.2`).** `/dashboard` is the root of the family, so its trail is the site's standard
`Overview / <page>`. `PageHeader` gained a `crumbLabel` prop for it: the h1 is a sentence — "How the
group is performing, and which store needs attention" — and a trail that repeated it would be a trail
nobody reads, so the crumb reads "Dealer Operations Command Center". The current crumb is a `<span
aria-current="page">`, not a link, and carries no query string.

## 6. URL filter contract

Filter state lives in the query string; a copied URL reproduces the view exactly.

| Param | Values | Notes |
|---|---|---|
| `period` | `YYYY-MM` \| `YYYY-MM-DD..YYYY-MM-DD` \| `mtd` \| `last-30d` | Default: latest full month in the dataset |
| `compare` | `prior-period` \| `prior-year` \| `none` | Default `prior-period` |
| `store` | `GSA-001`,`GSA-002`,`GSA-003`, comma list, or absent = group | |
| `scope` | `new` \| `used` \| `certified` \| `lease` \| `wholesale` \| `combined` | Default `combined`; pages state when a value does not apply |
| `dept` | department code | Employee/accounting pages |
| `employee` | `EMP-#####` | |
| `source` | lead-source id | |
| `campaign` | campaign id | |
| `make` / `model` | catalogue values | Inventory, deals |
| `condition` | `New` \| `Used` \| `Certified` | |
| `structure` | `cash` \| `finance` \| `lease` | Acted on by `/dashboard/fi` from `DASH.7`, and declared **partial** there: the exported F&I datasets carry the structure MIX as counts rather than a per-structure split of reserve, product gross and penetration, so the page states that rather than filtering figures it cannot filter |
| `product` | F&I category slug | Acted on by `/dashboard/fi` from `DASH.7`. Slugs are derived mechanically from the ten governed category names, with `extended-warranty` accepted as a user-facing ALIAS for Vehicle Service Contract — an alias in the URL grammar, never a stored value and never an eleventh category |
| Page-specific | declared per route (e.g. `unit=`, `severity=`, `rule=`, `q=`, `sort=`, `page=`) | Extend, never override, the global set |

**As-built (`DASH.2`).** All thirteen parameters parse, validate, serialize and round-trip in
`portfolio/src/lib/dashboard/filters.ts`, whatever the route can act on. Canonical serialization is
`FILTER_KEYS` order with defaults omitted and a store list sorted, so two equivalent states produce
byte-identical query strings and the empty string is the default state — which is what makes "Reset
filters" a link to the bare route.

Four things the as-built adds to the table above:

- **Route support is declared, not implied.** `EXECUTIVE_OVERVIEW_SUPPORT` gives every parameter one
  of `applied`, `partial` or `not-applicable`, with a note. `/dashboard` applies `period`, `compare`
  and `store` to everything; applies `condition` and `source` to the measure families whose exported
  datasets carry the attribute, and says which; and states in words that the remaining eight describe
  attributes or domains this route has no dataset for. An active filter the route cannot apply still
  appears in the summary, marked "not applied here" — a filter that is in the URL and not in the
  summary is a filter the reader believes is working.
- **A partial filter is applied per dataset, from the manifest's own column list.** The first
  implementation applied `condition` to every dataset, which matched zero rows in `gross-summary` and
  made the gross card report "no matching records" for a month with plenty. Silently zeroing an
  unrelated card is the worst of the three available behaviours.
- **The control surface is narrower than the grammar, deliberately.** The bar offers period presets,
  comparison, one store, one condition and one lead source. A custom date range and a multi-store list
  are fully supported in the URL and documented with copyable examples in a disclosure beside the bar:
  a two-input range composed into one parameter cannot be expressed by a native GET form without
  scripting, and a control that only works with JavaScript would be the one part of this page that
  breaks when the rest does not.
- **`condition=Certified` parses but is not offered.** It is part of the console-wide vocabulary; the
  warehouse models New and Used only, and the control reads its options from the export's declared
  enumeration rather than from this table.

Rules (binding): unknown keys ignored; invalid values fall back to defaults **with a visible "some
filters were reset" notice**; filters use native controls (`SelectControl`, `TextControl`); active
filters render as text chips with per-chip remove and a "Reset filters" control; the selected and
comparison periods are always visible in the context header; filters never change a KPI definition —
they select rows inside the documented denominator, and any filter that *would* change a denominator
(e.g. store scope on an eligibility-based penetration) is documented on the page as scoping both
numerator and denominator together; mobile filter bar wraps, never overflows horizontally.

## 7. Interaction model

Click-to-filter on chart segments and table cells where accessible, always with a keyboard-equivalent
(the segment is a button or link); sortable tables via `aria-sort` buttons; search with visible
label; expandable KPI definitions ("How is this calculated?" `Disclosure` naming the KPI id, formula,
basis, and limitations); "Why did this change?" panels per the driver spec; every chart with a
data-table alternative; stable back-button behavior (filter changes push history entries at most once
per discrete change); loading is not applicable at runtime (data is build-packaged), so there are no
spinners — only rendered states.

**As-built (`DASH.2`).** Filter changes push history entries — `router.push`, not `replace` — so Back
returns the previous view and Forward the next; the explorers use `replace` for the opposite and
equally deliberate reason, that they filter on every keystroke. Click-to-filter on a table cell and
sortable columns are not built: neither is needed by an executive summary, and both belong with the
pages that have long tables. Every KPI surface carries a "How is this calculated?" `Disclosure` naming
the governed KPI id, its formula, numerator, denominator, grain, date basis, unit, null behaviour,
source reporting view and interpretation caution — read from `src/content/kpis.json`, the same
machine-readable extract of KPI_CATALOG.md that `/kpis` renders — plus one row the catalogue cannot
supply: which exported columns *this page* summed to get the figure above it.

Excluded, permanently: fake refresh, fake notifications, fake saved/assigned actions, fake
collaboration, fake write-back, any control that pretends to mutate dealership data.

## 8. Empty, error, freshness, and disclosure states

- **Empty filter result:** `EmptyState` with the active filters restated and a reset action. Ratios
  render NULL semantics ("—, no eligible deals"), never 0 or ∞.
- **Not applicable:** explicit "Not applicable" text (pre-owned store's new-vehicle cells, cash
  deal's reserve, no-trade deal's trade section).
- **Invalid deal id:** the Deal Jacket route returns the 404 page with a link back to the deal index.
- **Data freshness:** every route's context header shows the dataset as-of date and version; the
  stale state (contract §11) renders a visible warning banner; CI prevents a stale artifact from
  merging.
- **Synthetic disclosure:** `TrustLine` (dashboard scope) in the body of every route — "Deterministic
  synthetic data. Granite Auto Group is fictional." plus the real Power BI validation clause and the
  governance link. The full `SYNTHETIC_DATA_STATEMENT` renders on `/dashboard` itself. Consistent
  with the existing ≤2-per-route repetition rule.
- **Reconciliation failure state:** if the manifest reports a failed reconciliation, every dashboard
  route renders a "figures failed reconciliation" banner and the trust panel details it (this state
  is producible only with a deliberately corrupted fixture — and the e2e suite does exactly that).

**As-built (`DASH.2`).** Six states, and each renders different words, because collapsing any two of
them into a dash is how a console becomes untrustworthy in a way nobody can point at:

| State | What the reader sees | When |
|---|---|---|
| A value | The figure, formatted for its unit | The selector resolved |
| `Not applicable` | The words, with the structural reason one tap away | The store cannot have the measure — the independent centre's new-vehicle cells |
| `No matching records` | The words, plus which scope selected nothing | The filter matched no exported row |
| `No eligible denominator` | The words, plus which denominator was zero | A governed NULL: KPI_CATALOG's zero-denominator rule |
| `Not derivable at this scope` | The words, the reason, and the filter that *would* resolve it | An order statistic above its published grain |
| Stale / reconciliation failed | A banner above everything, not dismissible | The manifest says so |

**As-built (`DASH.5`) — three more states, and they are not the same state.** Target context adds
distinctions a dash would destroy:

| State | What the reader sees | When |
|---|---|---|
| `No target set` | The words, never `0` and never `0%` | No target row exists for that store, month and metric. **A missing planning record and a goal of zero are different statements** |
| `Pace not available before the first selling day` | The words, in place of a rate and a projection | Zero selling days have elapsed. Never `∞`, never `NaN`, never a division |
| `Target context is not comparable` | The words, plus **which filter** made it so | The active filter changed the actual population but no target exists at that scope — a Used-only actual against an all-retail target is arithmetically valid and operationally false |

A `Month complete` marker sits beside the clock once every selling day has elapsed, and the projection
is stated to equal the final actual rather than presented as forward-looking.

A seventh state the plan implied and the as-built makes explicit: a **period outside the export** is
substituted or trimmed with a visible notice naming the reporting window, never rendered as a screen
of zeroes. A period the export partially covers is trimmed and said so; a comparison window that
falls outside it is **withheld rather than clamped**, because comparing December against the five days
of November an export happened to contain produces a difference that is arithmetically correct and
operationally meaningless.

## 9. No-JavaScript behavior

**As-built (`DASH.2`).** `/dashboard` has exactly one client island: the filter controls. Everything
else — every figure, table, funnel, disclosure and trust check — is a server component, and the
no-JavaScript e2e block asserts the KPI values, the scoreboard including its `Not applicable` cell,
the inventory summary, the funnel, the trust state, the synthetic statement and the methodology
inside the closed disclosures are all in the document with scripting off. The filter form is a real
`<form method="get">`, so it degrades by doing exactly what it already does; with scripting on, the
submit handler builds the canonical URL instead of letting the browser serialize five controls
including the empty ones.

Server-rendered content — KPI values, tables, captions, disclosure text — is complete without
JavaScript, matching the site's existing no-JS guarantee. Filter forms degrade to native form
submission (GET to the same route with query params). Chart islands render their data-table
alternative; interactive-only affordances (sort toggles, click-to-filter) are absent, not broken.
The reduced-motion/no-JS e2e patterns extend to every dashboard route.

## 10. Deep-link behavior

Every route × valid filter combination is a stable URL; e2e tests load deep links cold (no prior
navigation) at the tested widths and assert identical content to the navigated state. The Deal
Jacket accepts only the business `sale_id` form (`SLE-########`); anything else 404s. Sitemap lists
the nine navigable routes; `[saleId]` pages are crawlable but unlisted (development-profile scale
keeps this tractable; revisit in the `portfolio`-profile refresh).

**As-built (`DASH.2`).** The sitemap lists `/dashboard` and nothing beneath it, because nothing
beneath it exists. Deep links are exercised cold in `dashboard-filters.spec.ts` — store, month,
arbitrary range, multi-store, comparison mode, and the store-source-day scope at which an order
statistic resolves — and one test asserts the navigated view and the deep-linked view produce
identical text, which is the claim "a copied URL reproduces the view" stated as an equality.

---

## `/dashboard/actions` — Management Actions (`DASH.12`)

The ninth operating destination, last in the rail: management attention follows business status.

**Five regions.** Queue summary · facets · review queue · change drivers · methodology on demand.

**The queue arrives decided.** The route selects from it and arranges it. It evaluates no rule,
decides no severity, reads no threshold and builds no drill-through — all of that happened at export
time against the rule file.

**No filter bar, and the reason is in `ACTIONS_SUPPORT`.** Every other operating route carries the
shared period/store/condition control. This one does not, because each rule declares its OWN as-of
scope and they differ by domain: the as-of snapshot for inventory, the as-of month for deliveries,
the published exception register for accounting. A period control over rows selected on three
different bases would offer a selection meaning something different in each. `store` is the one
global parameter that survives, and it appears as a facet beside the three the route owns —
`severity`, `domain` and `owner`.

**Facets are anchors.** URL state, canonically serialised, surviving reload, copy-paste, Back and
Forward, and working with scripting off. Facet counts are computed over the WHOLE queue rather than
the filtered one, because a count that fell to zero the moment its own facet was selected would
answer no question a reader has.

**The Executive block.** Five prompts on `/`, a prefix of the queue's own order — no second ranking,
no rotation, no sampling, no personalisation — placed after the business regions with a compact
change-driver panel beside it.

**Actions and change drivers are different things**, and the page keeps them apart. An action is a
condition holding now; a driver is arithmetic about a change that already happened. Neither explains
the other.
