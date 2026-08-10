# ADR-0015 — A product-first operating experience

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-10 |
| **Increment** | `UX.1` |
| **Supersedes** | Nothing. It narrows the scope of ADR-0013 §14's "one new public destination" reading, and it changes the *presentation* decisions in `portfolio/docs/EXPERIENCE_REDESIGN_V2.md` without invalidating that document's measurements. |
| **Superseded by** | — |
| **Related** | ADR-0011 (sanitized reference data), ADR-0013 (dashboard data boundary), ADR-0014 (Gate 2 as an external dependency) |

---

## Context

By the end of `DASH.11` the repository contained nine implemented operating surfaces — executive
performance, sales and gross, a deal index, a per-deal jacket, inventory operations, F&I, leads and
marketing, employee performance, and inventory-control accounting — reading twenty-eight governed
reporting views through thirty-eight committed export datasets.

The website in front of them did not reflect that.

**The measured state of the experience before this increment**, at 1440 × 900, taken from a
production build:

| Route | Visible prose (words) | Paragraphs | Desktop height (px) | First data visualization (px from top) |
|---|---:|---:|---:|---:|
| `/` (marketing home) | 651 | 32 | 5,906 | 365 |
| `/dashboard` (executive) | 2,636 | 144 | 7,947 | **2,194** |
| `/dashboard/sales-gross` | 1,331 | 93 | 7,631 | 3,412 |
| `/dashboard/leads-marketing` | 2,248 | 76 | 9,324 | 1,659 |

The number that decided this ADR is 2,194. A general manager opening the operating console met two
and a half screens of heading, breadcrumb, eyebrow, lede, three provenance badges, a filter grammar
disclosure and a context rail before a single mark of data.

Four structural problems, none of which is a styling problem:

1. **The front door was a brochure.** `/` was a hero, a store story, a product tour and a closing
   call to action. The working application was at `/dashboard`, one click behind it.
2. **The navigation offered two kinds of thing as one kind.** Seven header items — Overview,
   Dashboard, Inventory, Platform, KPIs, Status, About — asked a dealership manager to choose
   between a job and a document about how the job's numbers are kept honest.
3. **Two destinations were called Inventory.** `/inventory` is sanitized public listing reference
   data (ADR-0011); `/dashboard/inventory` is the synthetic operating stock position. A visitor had
   no way to know which was which before opening one.
4. **Implementation language was in the operating flow.** A scan of rendered HTML found
   `semantic model`, `SQL` and `Power BI` on all nine operating routes, and `PostgreSQL`,
   `DAX`, `dataset version` and `contract fingerprint` on the executive surface.

## Decision

**1. ARPI is presented primarily as a dealership management intelligence application.**
The mission statement the product works from:

> ARPI gives dealership leadership one operating view of the business, connecting sales, gross,
> inventory, F&I, marketing, employee activity and accounting so managers can see what is happening,
> understand the operating context, drill into the transactions behind it, and know where deeper
> investigation is required.

**2. Operating routes and technical evidence are separate information domains**, with separate
navigation, separate chrome and separate copy rules. They are implemented as Next route groups —
`(operating)` and `(site)` — which change no URL and give each domain one layout that owns its shell.

**3. The Executive Command Center is the canonical product entry experience.** `/` renders it.
`/dashboard` is a permanent (308) redirect to `/` **with the query string preserved**, because every
console URL anybody has shared is a `/dashboard?…` URL and a redirect that dropped the filters would
resolve all of them to the default period without any visible symptom.

The alternative — keeping `/dashboard` canonical and redirecting `/` to it — was considered and
rejected. It keeps a bookmark set intact at the cost of the thing the increment exists to fix: the
product's root URL would still not be the product.

**4. Technical explanation is consolidated into one destination.** `/technical` — "How ARPI works" —
with eight server-addressable views: `overview`, `architecture`, `data-model`, `kpis`, `governance`,
`data-sources`, `status`, `product-vision`. The six retired routes are permanent redirects into the
view that answers for each.

A `?view=` parameter rather than a path segment, and a `<nav>` of plain links rather than a
`role="tablist"`: these are eight states of one document, each server-rendered, each carrying a
canonical link to its own state, each navigable with scripting disabled.

**5. Operating pages describe business meaning, not implementation mechanics.** The restricted
vocabulary is enforced against *rendered, visible* copy on operating routes by
`tests/e2e/operating-copy.spec.ts`. Terms that are genuinely dealership vocabulary — GL, DMS, CRM,
KPI, PVR — are not restricted. Methodology remains one click away in a disclosure on every route.

**6. The URL remains the shareable source of analytical state.** No selection is held in
`localStorage`, a cookie, a session or a component. Navigation between operating routes carries the
compatible filters and **explicitly drops** the ones the destination declares `not-applicable`,
because a chip claiming a lead source is selected on a page whose every figure ignores it is worse
than no chip.

**7. Client-side interaction may improve usability but may not become a second calculation engine.**
The rail parses the URL in the browser to build its links; it uses the same `parseFilters`, the same
route applicability declaration and the same canonical serializer the server uses, and the
destination re-parses the resulting link on the server. No business arithmetic moved.

**8. Existing governance, reconciliation, privacy and data contracts remain binding.** `UX.1` changed
no KPI definition, no reporting view, no export dataset, no warehouse fact or dimension, and no file
under `powerbi/`.

**9. `DASH.12` follows `UX.1`.** The Management Action Center is about management attention: its
placement, its navigation role and its executive hierarchy belong inside the final product
experience rather than inside an information architecture this increment replaces. No `Actions`
navigation item exists until the route does.

**10. Old URLs must not produce duplicate canonical documents.** Eight permanent redirects, none of
them in the route map, none of them in the sitemap, and an end-to-end assertion that no two URLs
claim the same canonical.

## Consequences

**Accepted costs.**

- Every inbound link to `/dashboard`, `/architecture`, `/data-model`, `/kpis`, `/governance`,
  `/status` and `/inventory-operations` now costs one redirect hop. Permanent status codes tell a
  crawler to transfer the ranking rather than keep re-checking.
- The reference header lost four destinations. Those routes are reachable from the technical
  destination's own view navigation, from the footer index — which lists all eight views by name —
  and from the mobile drawer's expanded group.
- The operating rail is a client island, because a Next layout cannot read `searchParams` and the
  rail's links depend on them. It imports no dataset; the modules it does import were already in the
  client bundle for the filter bar.

**What this does not permit.** It is a decision about presentation and information architecture. It
does not authorize a new KPI family, a reporting view added for a visual, a runtime database
connection, a recommendation engine, or any softening of what the evidence files say. Where a
cross-domain visualization could not be built honestly from a published grain, `UX.1` recorded the
gap in `docs/product/PRODUCT_GAPS.md` and did not build the visual.

Power BI real-engine validation remains externally pending; this decision does not alter that state.
