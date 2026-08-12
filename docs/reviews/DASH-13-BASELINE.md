# `DASH.13` — release baseline audit

The state of the repository and the deployment at the moment `DASH.13` began, and the release blockers
that audit found. Written before any `DASH.13` change was made, so that the remediation recorded in
[`DASH-13-REVIEW.md`](DASH-13-REVIEW.md) can be read against a fixed starting point rather than against
a moving one.

---

## 1. Start gate

| Item | Value |
|---|---|
| Starting `main` SHA | `c542f2e5118bec32b1c85bca3e609113a86b1dfd` |
| What it is | Merge of PR #67 — `UX.2D.1`, "five things the operating surface said that were not true" |
| Branch | `claude/arpi-dash13-release-hardening-z0npqk`, created at that SHA |
| Competing `DASH.13` PR | None. No open pull requests at start. |
| `UX.2A` – `UX.2D` | Implemented |
| `UX.2D.1` defect pass | Recorded — [`UX-2D-1-CONTROL-TRUTH.md`](UX-2D-1-CONTROL-TRUTH.md) |
| `UX.2` | Implemented (`UX.2A`–`UX.2D`) |
| `DASH.13` | Planned |

**Post-`UX.2D.1` CI on `main` was still running when this increment began** — run `31610983499`, started
`2026-08-12T15:12:00Z`, with `Integration (PostgreSQL 16)` outstanding and every other job complete. The
starting SHA was not chosen because CI was green; it was chosen because it is the newest `main`, and the
audit that follows is read-only, so it did not depend on the outcome.

**That run has since finished: `success`, 19m 10s, `Integration (PostgreSQL 16)` passed.** The start gate
is therefore satisfied in retrospect — `DASH.13` did branch from a green `main` — and the audit did not
have to be redone, because nothing in it depended on the result.

## 2. Environment capability, and what it makes impossible

This matters more than it usually would, because `DASH.13`'s contract includes a production deployment
and its external verification.

| Capability | State |
|---|---|
| `uv`, Python 3.11, Node 22, `npm`, `psql` 16, Docker | Present |
| Railway CLI | **Absent** |
| `RAILWAY_API_TOKEN` / `RAILWAY_TOKEN` | **Not set** |
| Outbound reach to `arpi.up.railway.app` | **Blocked by the network egress proxy** — `403` to `CONNECT`, confirmed both by `curl` and by the proxy's own status endpoint |

Two consequences, both structural rather than incidental:

1. **No Railway operation of any kind can be performed from this session.** There is no CLI and no
   credential, so creating, configuring or deploying a production environment is a human-only act.
2. **No external verification of any deployment can be performed from this session.** The public host is
   unreachable, so the existing deployment could not be observed either — the "record the current
   deployed Railway state" step of the start gate could not be completed, and is recorded here as
   `UNOBTAINABLE` rather than as a finding.

Per [ADR-0009](../architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md)'s standing
rule and the repository's deployment-verification policy, **an unobtained fact is not recorded as a
pass**. `DASH.13` therefore completes all repository-side work and returns the exact external action
required; it does not mark itself Implemented on a contract half of which it cannot execute.

## 3. Product smoke tour, at the starting SHA

Built and served the production bundle locally and swept every declared route. All 21 addressable
targets answered `200`:

`/`, `/dashboard/sales-gross`, `/dashboard/deals`, `/dashboard/deals/[saleId]`, `/dashboard/inventory`,
`/dashboard/fi`, `/dashboard/leads-marketing`, `/dashboard/employees`, `/dashboard/accounting`,
`/dashboard/actions`, `/technical`, `/about`, `/inventory`, `/case-study`, the three
`/dealerships/*` pages, `/ui-lab`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`,
`/social-preview.png`.

The Deal Jacket was exercised with a real fixture identifier discovered from the Deal Explorer
(`SLE-00000620`), not a guessed one.

## 4. Public route inventory

Seventeen routes in the route map, sixteen indexable. The build reports the render mode, which the audit
found the deployment configuration was describing incorrectly:

| Group | Routes | Render mode |
|---|---|---|
| Operating console | `/`, and the nine `/dashboard/*` routes including `/dashboard/deals/[saleId]` | **Dynamic** — server-rendered on demand, because filter state is a URL query |
| Reference | `/about`, `/inventory`, `/case-study`, `/ui-lab` | Static |
| Reference | the three `/dealerships/[slug]` pages | SSG |
| Reference | `/technical` | Dynamic — eight server-addressable views |
| Metadata | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` | Static |

Eight retired URLs are permanent redirects: `/dashboard`, `/architecture`, `/data-model`, `/kpis`,
`/governance`, `/status`, `/inventory-operations`, `/dealerships`.

## 5. Link, redirect and error-handling sweep

| Check | Result |
|---|---|
| Internal link crawl | 400 distinct targets visited, **zero broken links**. The cap was reached on filter-permutation query strings rather than on distinct pages. |
| Redirects | All eight retired URLs answer `308 Permanent Redirect`. No chains, no loops. |
| Query-string preservation | `/dashboard?period=mtd&store=granite-subaru` → `/?period=mtd&store=granite-subaru`. Preserved. |
| `404` behaviour | `/definitely-not-a-route`, `/dashboard/deals/NOT-A-REAL-ID` and `/dealerships/nope` all answer a real `404`, not a `200` error page. |
| Hostile / unknown query input | Ten probes — script tags, null bytes, path traversal, duplicated parameters, malformed numbers, SQL-shaped strings. All answered `200` deterministically. **No stack trace, no reflected script.** An unrecognised value is echoed into a disclosure of rejected filter values, correctly HTML-escaped (`&lt;img src=x onerror=alert(1)&gt;`) in both the text node and the hidden form input. |

## 6. `UX.2D.1` control-truth re-verification

All five fixes were verified present and structurally load-bearing, not merely present in a changelog:

| `UX.2D.1` defect | Mechanism found in place |
|---|---|
| Inert controls | `filter-bar.tsx` renders a control only when `support[key].support !== 'not-applicable'` **and** an option list arrives. The route-support declaration is the same authority that governs URL-state applicability. |
| Wrong default-period label | The `value=""` option — `"Latest full month (default)"` — is injected by `FilterBar` itself, so no route can rebuild the option list and forget it. |
| Money wrapping | Numeric typography contract in place; verified in the responsive sweep. |
| "Actions not built" copy | `PLANNED_DASHBOARD_SECTIONS` is `[]`, so no planned-section copy can be rendered from stale hard-coded text. |
| Dead methodology component | Absent. The canonical `Disclosure` pattern is what the workspaces use. |

## 7. Release blockers found

Classified per the increment's own scheme. Remediation is recorded in
[`DASH-13-REVIEW.md`](DASH-13-REVIEW.md).

### P0 — release cannot proceed

None found in the repository. The one P0-class condition is **external**: no production environment
exists, and none can be created from this session (§2).

### P1 — release materially misrepresents or degrades the product

| # | Finding | Where |
|---|---|---|
| P1-1 | **`og:site_name` absent from every route.** `pageMetadata()` returns a fresh `openGraph` object and `Metadata` overrides are shallow, so the root layout's `siteName` and `locale` were replaced rather than merged on all seventeen routes. `og:site_name` is the line a social crawler renders as the card's attribution — the one metadata gap that would have shown on the LinkedIn card this release exists to produce. | `portfolio/src/lib/metadata.ts` |
| P1-2 | **`/technical` shipped a doubled title:** `How ARPI works - ARPI - ARPI`. The route builds its own suffixed string and returned it as a plain string, which the root template suffixed again. On the route a technical reviewer is most likely to open. | `portfolio/src/app/(site)/technical/page.tsx` |
| P1-3 | **The About page told visitors "There is no dashboard yet."** False since `DASH.2`, on a public page, in a paragraph whose whole subject is the project's honesty about its own gaps. | `portfolio/src/app/(site)/about/page.tsx` |
| P1-4 | **`LIMITATIONS.md` §14.1–§14.2 described the operating console as non-existent** — "no `/dashboard` route, no dashboard component, no chart, no filter, no navigation entry", generated datasets "consumed by nothing", and ten implemented domains listed as needing warehouse entities that "do not exist yet". | `LIMITATIONS.md` |
| P1-5 | **`README.md` led with "No dashboard page or visual exists"** as an unqualified statement, and described the application as a "portfolio website foundation" that "renders this repository's own documentation". | `README.md` |
| P1-6 | **`PRODUCT_VISION.md` called the deterministic action queue "a planned increment (`DASH.12`), not a shipped capability."** `DASH.12` is Implemented. | `docs/product/PRODUCT_VISION.md` |

### P2 — important, non-blocking

| # | Finding | Disposition |
|---|---|---|
| P2-1 | **Build-time / runtime environment binding is silent and splits the deployment.** Canonical origin and indexability are baked at build time for statically prerendered routes and read at request time for dynamic ones. Reproduced: a tree whose `robots.txt` said `Allow: /` with a production `Host:` while its own home page carried `noindex, nofollow` and canonicalised to staging. Nothing fails, nothing logs. | Addressed — external verifier plus declared constraint and tests |
| P2-2 | `metadata.manifest` pointed at `/site.webmanifest`, which answers `404`. Inert, because Next's file-based `app/manifest.ts` wins and the rendered link is `/manifest.webmanifest`. | Addressed — removed |
| P2-3 | `project.config.json` described the site as "fourteen statically prerendered routes". There are seventeen, and nine are server-rendered on demand. | Addressed |
| P2-4 | The `README.md` status-table row for the application omitted `/dashboard/actions` — the `DASH.12` Management Action Center. | Addressed |
| P2-5 | `audit_deployed_site.ts` defaults to auditing `/` and `/kpis`. `/kpis` has been a retired redirect since the `/technical` consolidation. | Addressed |
| P2-6 | The social preview image leads with an empty `/inventory` wireframe and a dashed semantic-model diagram. Nothing on it is false — the synthetic-data and fictional-group disclosure is accurate and the dashed layers correctly represent Gate 2 pending — but it no longer represents the product's front door, which is now an operating console. | **Recorded, not changed.** Redesigning a social card during a release freeze is scope this increment refuses; the card is accurate, and accuracy was the bar. |

### P3 — cosmetic or deferred

None promoted into work. `DASH.13` is not a redesign increment.

## 8. Quality state at the starting SHA

Recorded in [`DASH-13-REVIEW.md`](DASH-13-REVIEW.md) with the final counts, so the two documents do not
carry two versions of the same number.

## 9. Data-integrity freeze

Confirmed at the start and held throughout: **0** new KPIs, **0** new warehouse dimensions, **0** new
warehouse facts, **0** new reporting views, **0** new export datasets, **0** new action rules. No
finding in this audit required an analytical-model change, so none was made.

---

Power BI real-engine validation remains externally pending; this audit does not alter that state.
