# `DASH.13` — release hardening review

What `DASH.13` audited, what it found, what it changed, and — the part that matters most — **what it
could not do and why**. The baseline it is read against is
[`DASH-13-BASELINE.md`](DASH-13-BASELINE.md).

> ## The headline, stated before anything else
>
> **ARPI is not publicly released.** The repository is release-ready and the release policy is built,
> tested and documented. A Railway `production` environment **does not exist**, and could not be created
> from this session: there is no Railway CLI, no API token, and the deployment host is unreachable
> through the network egress proxy. Until an operator performs the one action in §9, ARPI has no public
> indexable origin and **LinkedIn cannot build a social preview card for it** — because a preview
> deployment correctly answers `Disallow: /` to every crawler, which is a working safeguard, not a bug.
>
> `DASH.13` is therefore **In progress**, not Implemented. Marking it Implemented would claim a
> production deployment that has not happened.

---

## 1. Start

| Item | Value |
|---|---|
| Starting `main` SHA | `c542f2e5118bec32b1c85bca3e609113a86b1dfd` (merge of PR #67, `UX.2D.1`) |
| Branch | `claude/arpi-dash13-release-hardening-z0npqk` |
| `UX.2` status at start | Implemented (`UX.2A`–`UX.2D`, plus the `UX.2D.1` defect pass) |
| `DASH.13` status at start | Planned |
| Competing `DASH.13` PR | None |
| Release blockers found | 0 P0 in-repository, 6 P1, 6 P2. One P0-class **external** condition: no production environment. |

`main`'s post-`UX.2D.1` CI run `31610983499` was still executing `Integration (PostgreSQL 16)` when this
increment started. The audit that followed is read-only, so it did not depend on that result; the
branch's own gate results are §6.

## 2. Audit — what the repository was claiming that was not true

Six P1 findings, all of them the same species: statements that were accurate when written and were never
revisited when the increment that falsified them shipped. Full list and classification in the baseline;
what was changed:

| # | Claim | Corrected to |
|---|---|---|
| P1-1 | `og:site_name` absent from all seventeen routes — `pageMetadata()` returns a fresh `openGraph` object, and `Metadata` overrides are **shallow**, so the root layout's `siteName` and `locale` were replaced rather than merged. | `siteName` and `locale` set in `pageMetadata()` itself, with the shallow-override rule stated where it bites. Verified present on all seventeen routes. |
| P1-2 | `/technical` served `<title>How ARPI works - ARPI - ARPI</title>` — the route pre-applied the suffix as a plain string and the root template applied it again. | `title: { absolute: … }`. Now `How ARPI works - ARPI`. |
| P1-3 | The public About page said **"There is no dashboard yet."** | Rewritten to what is actually absent: the Power BI report layer is a shell with no page and no visual, and the semantic model has never been loaded by a Microsoft engine. Both true. |
| P1-4 | `LIMITATIONS.md` §14.1–§14.2 said there was no `/dashboard` route, no component, no chart, no filter and no navigation entry, that the generated datasets were "consumed by nothing", and listed ten implemented domains as needing warehouse entities that did not exist. | Both sections rewritten, with a visible note recording what they used to say. §14.1 now states what remains true and matters more — every figure is synthetic, there is no database connection, no charting library, and no KPI computed in the browser. §14.3–§14.9 unchanged, including the Power BI limitation in §14.8. |
| P1-5 | `README.md` led with an unqualified "No dashboard page or visual exists" and called the application a "portfolio website foundation" that "renders this repository's own documentation". | Scoped explicitly to the **Power BI** deliverable, and the application bullet rewritten as the operating console it is. Status-table row retitled and given the `/dashboard/actions` route it had been omitting. |
| P1-6 | `PRODUCT_VISION.md` called the deterministic action queue "a planned increment (`DASH.12`), not a shipped capability". | Rewritten: the Management Action Center shipped, and the "not a recommendation engine" claim restated in terms of what makes it a queue rather than a recommender — permanent rule identifiers, governed thresholds, three-valued logic, exact decimal arithmetic, no task state. |

Nothing was removed to make the project look better. Every correction moved a claim **towards** what the
repository can prove, and the genuine limitations — Power BI, the CFO gap, service and parts, real market
data, real system integration — are untouched and still stated.

## 3. Hardening — the finding that mattered most

**The build-time / runtime environment split (P2-1).** This is the one an audit is for, because nothing
in the repository was wrong and nothing failed.

The canonical origin and the indexing policy are resolved from `RAILWAY_ENVIRONMENT_NAME` and
`RAILWAY_PUBLIC_DOMAIN`. For a **statically prerendered** route those values are baked at **build** time.
For a **dynamic** route they are read at **request** time. `robots.txt` and `sitemap.xml` take the
build-time values.

When the two environments agree — a fresh build in one environment — everything coincides. `DASH.13`
verified this directly: a clean production build served with production variables carries
`index, follow` and a production canonical on **every** route sampled.

When they disagree — which is what promoting or re-running an image built elsewhere produces —
the deployment ships a **mixture**. Reproduced and recorded:

| Surface | Value served | Source |
|---|---|---|
| `robots.txt` | `Allow: /`, `Host: https://arpi.up.railway.app` | build-time |
| `/` (dynamic) | `noindex, nofollow`, canonical `https://arpi-portfolio-staging.up.railway.app` | request-time |
| `/technical` (dynamic) | `noindex, nofollow`, staging canonical | request-time |
| `/about` (static) | `index, follow`, production canonical | build-time |

Two contradictory instructions to every crawler, and **no error, no warning, no failed check**. This is
exactly the split-brain indexing state a release must not ship, and it is only observable from outside
the process.

Three things were done about it, rather than one:

1. **`scripts/railway/verify_release_policy.ts`** — a new external verifier. Given an origin and a
   declared policy (`--expect production` or `--expect preview`) it asserts reachability of twelve core
   routes, **one coherent indexing policy** across `robots.txt` and per-page metadata, canonical
   correctness, Open Graph completeness including `og:site_name`, absolute URLs on the expected origin,
   that the social image is fetchable as `image/png` and is really `1200x630`, and that the sitemap
   publishes one origin with no retired alias and no `/ui-lab`. `--canonical-origin` separates the origin
   being fetched from the origin being claimed, so production can be verified through a temporary
   provider URL **before** a domain cutover. `--expect-commit` requires the deployment to report a
   specific SHA.
2. **The constraint is declared** in `project.config.json` as
   `productionRelease.buildMustSupplyEnvironmentArguments`, and the specification validator **fails** if
   a production release is approved without it — so approving the release cannot silently approve the
   failure mode with it.
3. **It is documented** in `portfolio/docs/DEPLOYMENT.md` §5 and in the rollback procedure, with the
   reproduction, because the next person to promote an image will not rediscover it.

The verifier was proved against all three states, not just the happy one:

| Scenario | Expectation | Result |
|---|---|---|
| Production build + production runtime | `--expect production` | **14 of 14 pass**, exit `0` |
| Production build + staging runtime (the promoted-image case) | `--expect production` | **5 failures**, exit `1` — coherence, canonical, `og:image`, `og:url`, preview notice |
| Staging build + staging runtime | `--expect preview` | **13 of 13 pass**, exit `0`; LinkedIn prerequisites correctly reported **not verified** |

## 4. Production release policy

`DASH.13` is the increment that approved a public production deployment. The approval was implemented so
that production is **reachable on purpose and unreachable by accident**, and so that the repository
understands **both** environments rather than swapping one for the other.

- `project.config.json` gains `project.productionRelease` — `approved: true`, `approvedBy: "DASH.13"`,
  the two required flags, `deploymentRef: main`, `indexable: true`.
- **The declared default is still `staging`.** The specification validator continues to fail if
  `project.environment` is the production environment, with the reason restated: if editing a JSON file
  were enough to retarget the tooling, then a merge resolution or a search-and-replace of "staging" would
  be enough to deploy production.
- `bootstrap_railway.ts` gains `--environment <name>` and `--confirm-production`. Verified refusals, each
  exiting `2` **before contacting anything**:

  | Invocation | Behaviour |
  |---|---|
  | `--environment production` alone | refuses; does **not** silently fall back to staging |
  | `--confirm-production` alone | refuses — it means the operator believes they are deploying production |
  | `--environment prod` | refuses; neither the declared nor the production environment |
  | production requested, `productionRelease.approved` false | refuses |

- The runtime `production-guard` now checks **agreement** rather than absence: a run that did not ask for
  production and finds itself linked to it fails, and so does a run that asked for production and is
  linked elsewhere. Previously any sign of production was fatal, which would have been wrong after
  approval.
- **Staging is unchanged and still protected.** Not made public, not made indexable, no crawler
  user-agent special-cased. Verified: rendered metadata on a production build is byte-identical across
  `LinkedInBot`, `Twitterbot`, `facebookexternalhit` and an ordinary browser — the application does not
  branch on user agent and was not taught to.

## 5. Social and metadata

Measured against a real production-argument build, not inferred.

| Item | Value |
|---|---|
| Production `robots.txt` | `User-Agent: *` / `Allow: /` / `Disallow: /ui-lab`, plus `Host:` and `Sitemap:` on the production origin |
| Staging `robots.txt` | `User-Agent: *` / `Disallow: /` — no sitemap advertised |
| Production meta robots | `index, follow` on every route sampled |
| Staging meta robots | `noindex, nofollow` — agrees with `robots.txt`, no split brain |
| Preview notice | present on staging, absent on production, absent locally |
| Canonical | absolute, `https`, production origin, self-canonical per route |
| `og:*` | all nine present: `type`, `site_name`, `url`, `title`, `description`, `image`, `image:width` `1200`, `image:height` `630`, `image:alt` |
| `twitter:*` | `summary_large_image`, title, description, image, image alt |
| Social image | `/social-preview.png`, `200 image/png`, **1200x630**, 93,057 bytes |
| Sitemap | 23 entries — sixteen indexable routes plus seven non-default `/technical` views — one origin, no retired alias, no `/ui-lab` |
| Structured data | four nodes, all truthful: `WebSite`, `Person`, `SoftwareSourceCode`, `CreativeWork`. No `Organization`, no rating, no review. Granite Auto Group appears nowhere in it. |
| Assets | `/favicon.svg`, `/favicon-32.png` (32x32), `/apple-touch-icon.png` (180x180) all `200` |
| Manifest | `/manifest.webmanifest` `200`. The inert `metadata.manifest = '/site.webmanifest'` — which answered `404` — was removed; Next's file-based convention was always winning. |

**The social image was reviewed and deliberately not changed.** Nothing on it is false: the
synthetic-data and fictional-group disclosure is accurate, and the dashed semantic-model and report
layers correctly represent Gate 2 as pending. It leads with an empty `/inventory` wireframe rather than
the operating console, which is recorded as P2-6 — accurate but no longer representative. Redesigning a
social card during a release freeze is scope this increment refuses.

## 6. Quality

<!-- Filled from the runs recorded in the pull request. -->

| Suite | Result |
|---|---|
| Vitest | **1,610 passed**, 38 files |
| Playwright (chromium) | see the pull request transcript |
| Python (`-m "not integration"`, `--cov=arpi`) | see the pull request transcript |
| PostgreSQL 16 integration | **not run locally** — no populated database in this environment. GitHub CI's `Integration (PostgreSQL 16)` job is the required evidence. |
| `ruff format --check`, `ruff check`, `mypy` | see the pull request transcript |
| `prettier --check`, `eslint`, `tsc --noEmit` | pass |
| `manifest:check`, `inventory:check`, `dashboard:check` | pass — 541 inventory records across 3 stores; 38 dashboard datasets, 312 files, 7,356,934 bytes |
| `next build` | pass, under local, production and staging environment arguments |
| `check_naming`, `check_secrets`, `check_docs_links`, `check_project_capabilities`, `generate_project_capabilities --check` | pass |
| `check_powerbi_model`, `simulate_semantic_model --check`, `check_simulation_labels` | see the pull request transcript |
| Railway specification validation | pass |

New tests added by this increment: `portfolio/tests/unit/dash13-release-policy.test.ts` (109 cases —
Open Graph completeness per route, single title suffix, both robots policies, fail-closed environment
classification) and a production-release-policy block in
`portfolio/tests/unit/railway-config.test.ts`.

## 7. Performance

Per-route HTML, uncompressed, from the production-argument build:

| Route | Bytes |
|---|---|
| `/dealerships/granite-pre-owned` | 2,092,868 |
| `/dealerships/granite-chevrolet` | 1,369,665 |
| `/dashboard/inventory` | 783,876 |
| `/dashboard/actions` | 663,408 |
| `/` | 619,216 |
| `/dashboard/leads-marketing` | 444,665 |
| `/dashboard/sales-gross` | 339,142 |
| `/dealerships/granite-subaru` | 336,914 |
| `/dashboard/deals` | 329,569 |
| `/dashboard/fi` | 254,949 |
| `/dashboard/employees` | 253,104 |
| `/technical` | 240,440 |
| `/inventory` | 226,368 |
| `/about` | 203,854 |
| `/case-study` | 197,679 |
| `/dashboard/deals/SLE-00000620` | 187,782 |
| `/dashboard/accounting` | 158,776 |

- **Largest HTML route:** `/dealerships/granite-pre-owned`. It is a reference listing page that retains
  every unit record under the disclosure architecture — the size is the governed behaviour, not a
  regression.
- **Largest operating route:** `/dashboard/inventory`.
- **Regressions introduced by this increment: none.** No dependency was added, no chart library, no
  client island. The changes are metadata strings, a test file, a verifier script, configuration and
  documentation.

## 8. Data, privacy and security

| Check | Result |
|---|---|
| New KPIs / warehouse facts / dimensions / reporting views / export datasets / action rules | **0 of each.** The data-integrity freeze held; no finding required an analytical-model change. |
| `check_secrets.py` | pass — no credential anywhere, including in examples |
| Reflected input | Ten hostile query probes across the operating routes. No stack trace, no reflected script. Unrecognised filter values are echoed into a rejected-value disclosure, correctly HTML-escaped in both the text node and the hidden form input. |
| Website database access | none — no credential, no connection, no reference. Unchanged, and re-asserted in the configuration tests. |
| Redirects | eight retired URLs, all `308`, query string preserved, no chains, no loops |
| `404` behaviour | real `404` status on unknown routes, unknown deal identifiers and unknown store slugs |
| Dependency churn | **none.** No package added, removed or upgraded. |

## 9. What remains — the external action

Everything below is outside this repository and outside this session's reach.

**Blocker.** No Railway `production` environment exists. This session has no Railway CLI, no
`RAILWAY_API_TOKEN`, and no outbound network route to the deployment host (`403` to `CONNECT` at the
egress proxy, confirmed by the proxy's own status endpoint).

**The order to follow.** Production must serve the verified release commit, so:

1. Merge this pull request into `main`.
2. Wait for **both** post-merge workflow families on the new `main` — `CI` and `Frontend` — to be
   terminal and green. Record that `main` SHA.
3. Create and deploy the production environment from **that** SHA, as a **fresh build** carrying
   production build arguments:

   ```
   export RAILWAY_API_TOKEN=...        # account- or workspace-scoped
   tsx scripts/railway/bootstrap_railway.ts --environment production \
     --confirm-production --dry-run    # read the plan first
   tsx scripts/railway/bootstrap_railway.ts --environment production \
     --confirm-production
   ```

   Both flags are required and the tool refuses on either alone. It will not delete or retarget staging.
4. **Do not promote the staging image.** §3 is why.
5. Verify from outside, before announcing anything:

   ```
   tsx scripts/railway/verify_release_policy.ts \
     --url <production origin> --expect production --expect-commit <release main SHA>

   tsx scripts/railway/verify_release_policy.ts \
     --url https://arpi.up.railway.app --expect preview
   ```

   The second is not optional: it is what proves the release did not make staging public.
6. **Domain.** `https://arpi.up.railway.app` is currently attached to staging. One stable public origin is
   the objective, so decide deliberately between moving that domain to production and giving production
   its own — and verify production through its temporary provider URL first, using
   `--canonical-origin`, so the cutover is short. Two deployments must never claim the same canonical
   origin.
7. Only once step 5 passes, submit the production origin to **LinkedIn Post Inspector** for a fresh
   scrape: `https://www.linkedin.com/post-inspector/`. If LinkedIn still shows a stale or empty card
   after a successful scrape, **that is a cache, not a code defect** — do not change code for it, and do
   not add cache-busting query parameters.
8. Then, and only then, tag the release and record the deployment evidence.

**Version.** No release tag has been created, deliberately: §104's order is verified production first,
tag second. On the evidence, the honest recommendation is **`0.13.0`, not `1.0.0`** — `portfolio/package.json`
is at `0.1.0`, the repository has no release tag or GitHub Release to follow, Power BI real-engine
validation is pending on both accepted paths, and Gate 2 is CLOSED. A `1.0.0` would assert a completeness
the evidence does not support. That decision is the owner's; nothing in this increment presumes it.

## 10. Roadmap

| Increment | Status |
|---|---|
| `UX.2` (`UX.2A`–`UX.2D`, `UX.2D.1`) | **Implemented** — unchanged by this increment |
| `DASH.0`–`DASH.12` | **Implemented** — unchanged |
| `DASH.13` | **In progress** — repository hardening complete; public production deployment is an external manual dependency (§9) |
| `DASH.O-*` optional enhancements | **Deferred** — none implemented |

`DASH.13` will be Implemented when §9 steps 1–5 have been completed and the verifier's production run
passes against the release commit. Marking it Implemented now would claim a deployment that has not
happened.

---

Power BI real-engine validation remains externally pending on both accepted
[ADR-0008](../architecture-decisions/ADR-0008-real-engine-validation-paths.md) paths, and Gate 2 remains
CLOSED. This increment changed no TMDL, no DAX and no semantic-model relationship, and it does not alter
that state. It is recorded here because a release audit is one of the five situations that must state it.
