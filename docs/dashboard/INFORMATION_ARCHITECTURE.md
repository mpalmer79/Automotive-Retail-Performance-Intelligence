# Information Architecture — ARPI Dealer Operations Command Center

**Status:** Planning contract; becomes as-built with `DASH.2` onward.
**Parents:** [DASHBOARD_PROGRAM.md](../requirements/DASHBOARD_PROGRAM.md) ·
[ADR-0013](../architecture-decisions/ADR-0013-governed-web-operating-console.md) ·
portfolio [`CONTENT_MODEL.md`](../../portfolio/docs/CONTENT_MODEL.md) / `lib/site.ts` conventions

---

## 1. Primary routes

| Route | Title | Registered in |
|---|---|---|
| `/dashboard` | Command center | `ROUTES` in `portfolio/src/lib/site.ts`, mirrored in `tests/e2e/routes.ts` |
| `/dashboard/sales-gross` | Sales and gross | ” |
| `/dashboard/deals` | Deal explorer | ” |
| `/dashboard/deals/[saleId]` | Deal Jacket (dynamic; title carries the synthetic deal id) | dynamic — excluded from `inPrimaryNav`, sitemap lists the index route only |
| `/dashboard/inventory` | Inventory operations | ” |
| `/dashboard/fi` | F&I performance | ” |
| `/dashboard/leads-marketing` | Leads and marketing | ” |
| `/dashboard/employees` | Employee performance | ” |
| `/dashboard/accounting` | Accounting integrity | ” |
| `/dashboard/actions` | Management actions | ” |

The public header gains exactly one destination: **Dashboard → `/dashboard`** — the seventh
`PRIMARY_NAV` item, at the existing `MAX_PRIMARY_NAV_ITEMS = 7` cap. Its `matches` array covers the
whole `/dashboard` family so the header marks it current on every dashboard route. No other public
header change.

## 2. Internal dashboard navigation

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

## 3. Page hierarchy

Every dashboard page:

1. Site header (unchanged) → breadcrumbs (§5) → `PageHeader` (h1, lede, `TrustLine` with dashboard
   scope) → `DashboardNav` → context header (§7 of the program: selected period, comparison period,
   store scope, as-of date, dataset version) → filter bar → content sections (h2) → drill-through
   detail (h3).
2. One `h1` per route; no skipped heading level (existing sweep rule).
3. Section order is fixed per page and documented in that page's increment item — summary first,
   analysis second, detail tables last.

## 4. Drill-through paths

| From | To | Carries |
|---|---|---|
| Executive KPI card | Owning page (`/dashboard/sales-gross`, `/dashboard/inventory`, …) | Period, comparison, store filters |
| Store scoreboard row | Same page filtered to the store | `store=GSA-00#` |
| Sales/gross deal table row · deal index row | `/dashboard/deals/[saleId]` | none (deal id is the key) |
| Inventory unit row | Unit detail panel on `/dashboard/inventory` (`unit=` param) | Stock reference |
| F&I manager row | `/dashboard/fi?manager=EMP-#####` | Manager filter |
| Funnel stage / lost-stage cell | `/dashboard/leads-marketing` filtered view | Stage + period |
| Accounting exception row | Deal Jacket accounting section, or inventory unit detail | Entity id |
| Action row | The rule's declared drill-through route | Entity id + period |
| Deal Jacket lineage drawer | `/kpis` catalogue entries | KPI id anchor |

Every drill-through is an ordinary link (server-rendered `<a>`), so back/forward, open-in-new-tab,
and copy-link behave.

## 5. Breadcrumb behavior

`Breadcrumbs` (existing component) on every dashboard route below the root:
`Dashboard → <Page>` and `Dashboard → Deal explorer → SLE-00001234`. The current page is text, not a
link. Breadcrumbs never encode filters.

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
| `structure` | `cash` \| `finance` \| `lease` | After `DASH.6` |
| `product` | F&I category slug | After `DASH.6` |
| Page-specific | declared per route (e.g. `unit=`, `severity=`, `rule=`, `q=`, `sort=`, `page=`) | Extend, never override, the global set |

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

## 9. No-JavaScript behavior

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
