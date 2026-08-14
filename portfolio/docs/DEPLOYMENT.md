# ARPI portfolio deployment

Configuration for deploying this site, and the boundaries the deployment is held
to.

**The site is deployed to Railway's `staging` environment**, which is `noindex`
with crawling disallowed — see [section 5](#5-environment-behaviour). **No
production deployment has been made, and none should be made without explicit
approval;** production promotion is a separate, deliberate act described in
[`deployment/railway/README.md`](../../deployment/railway/README.md) section 7.

**Being deployed is a narrow claim.** This site holds no database credential and
opens no connection (see [section 1](#1-target)), so it being reachable says
nothing about PostgreSQL or about the semantic model. The three statuses are
recorded separately in
[`deployment/evidence/portfolio_deployment.json`](../../deployment/evidence/portfolio_deployment.json),
where every field this repository's own automation could not obtain reads
`UNVERIFIED` rather than a guess.

---

## 1. Target

**Railway**, with the **repository root** as the build context, building
[`Dockerfile.railway`](../Dockerfile.railway).

Chosen over Vercel because ARPI needs more than a website: it needs a cloud
PostgreSQL database with an externally reachable endpoint, so that Microsoft
Fabric can read the `reporting` schema from Microsoft's network. Railway provides
the site, the database and the TCP proxy in one project, with one credential and
one bill. The full deployment is documented in
[`deployment/railway/README.md`](../../deployment/railway/README.md); this page is
the _website's_ half of the contract.

**Vercel is still supported and has not been removed.** [`vercel.json`](../vercel.json)
still describes a working deployment, and the origin resolver still honours
`VERCEL_ENV` and the deprecated `NEXT_PUBLIC_SITE_URL`. Keeping it costs one config
file and creates no security surface.

### The build context is the repository root, and must stay that way

This is the single most important fact on this page, and the reason the Railway
service's root directory is **not** set to `/portfolio`.

[`../scripts/generate-project-manifest.ts`](../scripts/generate-project-manifest.ts)
generates every engineering count and every project status the site displays, and
it reads them from evidence files **outside** `portfolio/`: the Power BI validation
results, the semantic model's TMDL, the KPI catalogue, the readiness documents and
the SQL tree. `npm run build` runs `manifest:check` first, which regenerates the
manifest from those files and fails if it differs from the committed one.

The same is true of the second generator.
[`../scripts/generate-inventory-data.ts`](../scripts/generate-inventory-data.ts)
reads the sanitized inventory workbooks under `data/reference/inventory/` and the
store dimension in `data/sample/dim_dealership.csv`, and writes the three
artefacts the dealership and inventory routes render. `prebuild` runs
`inventory:check` beside `manifest:check`, and both run again inside the image.

So an isolated `portfolio/` context does not merely lose a nice-to-have: the build
**cannot complete** in it, and if it somehow did, the site would be free to display
numbers no longer backed by anything.

The workbooks are copied into the BUILDER stage and never into the runtime stage.
What the site serves is the generated JSON; shipping the source spreadsheets into
a public image would put the pre-sanitization column set one `docker pull` away,
and `railway-config.test.ts` asserts the runtime stage references no path under
`data/reference`.

`portfolio/tests/unit/railway-config.test.ts` extracts BOTH generators' read sets
and fails if any source either of them touches is missing from the Dockerfile's
`COPY` list, from `railway.json`'s watch patterns, or is excluded by
`.dockerignore`.

### Project settings

| Setting           | Value                          | Why                                                                    |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Root Directory    | **unset**                      | see above; `/portfolio` would break the content-integrity gate         |
| Builder           | `DOCKERFILE`                   | declared in [`railway.json`](../../railway.json)                       |
| Dockerfile path   | `portfolio/Dockerfile.railway` | named explicitly so no other tool picks it up by convention            |
| Health-check path | `/technical`                   | an existing prerendered route, not an endpoint invented to be probed   |
| Restart policy    | `ON_FAILURE`, 3 retries        | this container has no legitimate reason to exit, so an exit is a fault |
| Replicas          | 1                              | nineteen static routes with no session state                           |
| Wait for CI       | on (`checkSuites`)             | the CI checks are what prove the manifest is current                   |
| Node version      | 22                             | matches CI and `engines.node`                                          |
| Autodeploy branch | `main`                         | Railway's GitHub integration is the one routine deployment owner       |

The health check probed `/status` until `UX.1` consolidated the six documentation
routes into `/technical?view=...`. `/status` still answers — it is one of the eight
permanent redirects in [`next.config.ts`](../next.config.ts) — but a probe pointed at
it would be checking the redirect rather than the application, so the check names the
DESTINATION. The value here is the one in
[`railway.json`](../../railway.json) and
[`deployment/railway/project.config.json`](../../deployment/railway/project.config.json);
those two are the configuration, and this table describes them.

All of the build and deploy half lives in [`railway.json`](../../railway.json), so
it is reviewable in a diff rather than in a dashboard — and
[`.railway/railway.ts`](../../.railway/railway.ts) imports that file rather than
restating it, so the two cannot drift.

### The build gate is the same one CI uses

`prebuild` runs `npm run manifest:check` and `npm run inventory:check`. Both run
**twice**: once in CI against the repository, and once **inside the image**, where
they prove the generated artefacts match the evidence that was actually copied into
the build. A missing `COPY` therefore fails the build rather than shipping a site
whose numbers came from a partially populated context.

`inventory:check` is also the sanitization gate. The generator refuses to write an
artefact whose output still contains a VIN, a source URL, a domain, an email
address or a telephone number, so a workbook that was committed without being
sanitized fails the deployment rather than reaching a public page.

That is the single most important line in this document.

---

## 2. Deployment ownership

**Railway's GitHub integration deploys `main`, and nothing else deploys.**

It waits for this repository's GitHub checks before building (`checkSuites`), which
matters here specifically: `ci.yml` and `frontend.yml` are the gate that proves the
manifest is current and the site makes no unbacked claim. Deploying before they
finish would publish first and check afterwards.

GitHub Actions is used for **bootstrap, verification and post-deployment checks**
only — never for a routine `railway up`. Two deployment owners would make it
impossible to say which system deployed what, and
`.github/workflows/railway-bootstrap.yml` is `workflow_dispatch` only for exactly
that reason.

Watch paths are **not** `portfolio/**`. A change to a validation result, the KPI
catalogue, a gate document or the SQL tree changes what the site is required to say
while touching nothing under `portfolio/`, so all of it is watched. See
[`deployment/railway/README.md`](../../deployment/railway/README.md) section 4.

The **Vercel** side keeps `"git": { "deploymentEnabled": { "main": false } }`, so a
merge cannot publish to two hosts at once.

---

## 3. Environment variables

**The Railway staging deployment requires ZERO variables typed by a person.**

That is a change from the Vercel arrangement, which required `NEXT_PUBLIC_SITE_URL`
to be entered per environment. Asking a human to type the deployment's own URL into
a dashboard is the most error-prone variable a static site can have: get it wrong
and every canonical tag, sitemap entry and Open Graph URL points somewhere the site
is not, and nothing in the build fails.

### The canonical origin resolves itself

[`../src/lib/site-url.ts`](../src/lib/site-url.ts) is the one place the origin is
decided. It is a pure function, and every ordered path through it is covered by
`tests/unit/site-url.test.ts`.

| Order | Source                             | Notes                                                             |
| ----- | ---------------------------------- | ----------------------------------------------------------------- |
| 1     | `ARPI_SITE_URL`                    | explicit, **server-only**. Needed only for a custom domain        |
| 2     | `https://${RAILWAY_PUBLIC_DOMAIN}` | the platform's own answer — **this is what Railway staging uses** |
| 3     | `NEXT_PUBLIC_SITE_URL`             | **deprecated**; kept for backward compatibility only              |
| 4     | a request origin                   | only for a host on a strict allow-list; see below                 |
| 5     | `http://localhost:3000`            | development and the test suite need nothing set                   |

**Why `ARPI_SITE_URL` and not `NEXT_PUBLIC_ARPI_SITE_URL`.** `NEXT_PUBLIC_` is not
a namespace — it is an instruction to Next to inline the value into the client
bundle. The origin is only ever needed while rendering on the server, so there is
no reason to publish it into JavaScript a visitor downloads.

**Why the deprecated variable is ordered BELOW the platform.** A value left over
from an earlier host must never win against the platform's statement of where this
deployment actually is. An operator who genuinely wants to override the platform
sets `ARPI_SITE_URL`, which is ordered above it. Removing `NEXT_PUBLIC_SITE_URL`
outright is tracked as a separate change in
[`../../docs/requirements/DOCUMENTATION_BACKLOG.md`](../../docs/requirements/DOCUMENTATION_BACKLOG.md).

**Why path 4 is behind an allow-list.** A request's `Host` header is set by whoever
made the request. Believing it unconditionally would let anyone who can reach the
site mint a canonical tag pointing at a domain they control — a real
SEO-poisoning primitive. Only `localhost`, `127.0.0.1` and `*.railway.app` /
`*.up.railway.app` are trusted.

**Path 4 is deliberately not wired into the static metadata.** All fourteen routes
are statically prerendered, so there is no request in scope when `metadataBase`,
the sitemap or `robots.txt` are produced; the origin for those is decided once, at
build time. Making them per-request in order to read a header would make the site's
canonical URLs vary with an attacker-controlled value for no benefit, since Railway
has already told the build what the domain is. `requestOriginFromHeaders()` is
exported and tested for a caller that genuinely renders per request; today there is
none.

### Variables that are set, and by what

| Variable                              | Value   | Set by                | Secret? |
| ------------------------------------- | ------- | --------------------- | ------- |
| `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` | `false` | `.railway/railway.ts` | no      |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30`    | `.railway/railway.ts` | no      |

Neither is typed by a person. Both are non-secret. Everything else the build reads
— `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_GIT_COMMIT_SHA`,
`PORT` — is provided by Railway and is **read, not set**.

A Railway service variable is invisible to a Dockerfile build unless an `ARG` of
the same name is declared in the stage that consumes it. Those `ARG`s are in
[`../Dockerfile.railway`](../Dockerfile.railway), and
`tests/unit/railway-config.test.ts` asserts every build argument the specification
lists is declared — and that **no** `ARG` has a secret-shaped name, because a build
argument is recorded in the image's history.

### No secret, ever

**No secret may be placed in a `NEXT_PUBLIC_*` variable.** A credential put there
is published, permanently, in a fingerprinted JavaScript file, and rotating it does
not unpublish it.

More than that: **this site needs no secret at all.** It has no database
connection, no API key, no authentication provider, no analytics token, no
error-reporting DSN and no third-party service of any kind.
`deployment/railway/variables.config.json` lists `DATABASE_URL`, `PG*`,
`POSTGRES_PASSWORD`, `ARPI_*_PASSWORD` and `RAILWAY_API_TOKEN` as **forbidden** on
this service, and `scripts/railway/verify_railway_configuration.ts` fails if one
appears. If a future change appears to need a secret, that is a signal to re-read
[ADR-0009](../../docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md):
this directory is a documentation site, not a second analytics application.

---

## 4. The case-study flag

`NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` must be `false` on every environment, and
setting it to `true` today changes nothing.

It is one of five build-time conditions, all of which are required:

1. the flag is `true`
2. `docs/requirements/GATE_2_READINESS.md` exists
3. the recorded Gate 2 verdict is `OPEN`
4. the case-study content file exists
5. report screenshots exist

Conditions 2 through 5 are statements about whether the analytical work has been
done, read from the repository at build time. **The flag is necessary and never
sufficient**, so it can only ever unlock a case study that is already justified.
The full contract is in [CONTENT_MODEL.md](CONTENT_MODEL.md) section 6.

CI and the Playwright suite both run with the flag off, which is its real
configuration.

---

## 5. Environment behaviour

### The rule: anything that is not `production` is unpublished

`IS_PREVIEW` in [`../src/lib/flags.ts`](../src/lib/flags.ts) is true when any of:

- `VERCEL_ENV === 'preview'`
- `NEXT_PUBLIC_ARPI_PREVIEW === 'true'`
- the Railway environment is anything **other than** `production`

The third is the important one, and it is deliberately expressed as "not
production" rather than "named staging". A rule that had to name each new
environment would fail open the first time somebody added one; this one fails
**closed**, and failing closed costs a staging deployment nothing, because it is not
meant to be in a search index.

**`DASH.13` did not change this rule, and the tempting simplification remains
forbidden.** Now that a production environment is approved, `environment !== 'staging'
⇒ production` looks equivalent and is not: it would publish a typo, a renamed
environment or a future PR environment. Only the exact name `production` counts —
compared case-insensitively and whitespace-trimmed, because those values are typed
into a dashboard text field. `tests/unit/flags.test.ts` owns the truth table and
`tests/unit/dash13-release-policy.test.ts` asserts the release reading of it.

### An unpublished deployment (Railway `staging`, today)

- **disallows all crawling** — `robots.txt` is `User-agent: * / Disallow: /`, with
  no sitemap reference
- sets `noindex, nofollow` in its metadata
- sets its canonical tags to **its own** origin, never production's
- renders a visible **"Unpublished deployment"** marker above the header, in the
  document flow, so it appears in a full-page screenshot
- is otherwise byte-identical in behaviour, including the locked case study

The crawl block is a requirement rather than a preference. This site states that
Gate 2 is closed and that real-engine validation is pending. An indexed staging
deployment would put a point-in-time snapshot of those statements into search
results, where it would outlive the state it describes — and the whole point of the
site is that its statements track their evidence.

### Production — approved by `DASH.13`, and not yet created

Approval is recorded in `deployment/railway/project.config.json` under
`project.productionRelease`. It makes production a **supported target**, not the
default one: the declared `project.environment` is still `staging`, and the
bootstrap tool refuses production unless `--environment production` and
`--confirm-production` are both present. See §6.

What a production deployment must look like, every item of which
`scripts/railway/verify_release_policy.ts --expect production` checks from outside:

- `ARPI_SITE_URL` set only if a custom domain is used; otherwise the platform's
  domain still answers
- `robots.txt` allows everything except `/ui-lab`, and points at `sitemap.xml` on
  the production origin
- `sitemap.xml` lists the sixteen indexable routes plus the seven non-default
  `/technical` views — 23 entries, one origin, no retired alias, no `/ui-lab`
- canonical tags are absolute, `https`, on the production origin
- `og:site_name`, `og:url`, `og:title`, `og:description`, `og:image`,
  `og:image:width` `1200`, `og:image:height` `630` and `og:image:alt` all present,
  with absolute URLs on the production origin
- `/brand/social-preview.png` answers `200 image/png` and is really `1200x630`
- `/ui-lab` carries `X-Robots-Tag: noindex, nofollow`
- the preview marker renders nothing

#### A production deployment must be a fresh build. This is not a preference.

The canonical origin and the indexing policy are resolved from
`RAILWAY_ENVIRONMENT_NAME` and `RAILWAY_PUBLIC_DOMAIN` at **build** time for every
statically prerendered route, and at **request** time for a dynamic one. Both
values must therefore be present as build arguments — they are, in
`project.config.json`'s `buildArguments` — and the build must happen **in the
environment it is being deployed to**.

Promote or re-run an image built elsewhere and the deployment ships a mixture.
`DASH.13` reproduced it: `robots.txt` said `Allow: /` with a production `Host:`
while the home page carried `noindex, nofollow` and canonicalised itself to the
staging origin. Two contradictory instructions to every crawler, and **nothing
failed and nothing logged**. That is the single failure mode this policy exists to
prevent, and the external verifier is what detects it.

### Local

```bash
npm run dev                       # regenerates the manifest, then serves on :3000
npm run build && npm run start    # production build, :3000
```

No environment variable required, and no preview marker: a local build has no
search index to stay out of, and marking it a preview would put the banner on every
screenshot taken during development.

### Reproducing the Railway image locally

```bash
# From the repository ROOT, not from portfolio/.
docker build -f portfolio/Dockerfile.railway -t arpi-portfolio:local \
  --build-arg RAILWAY_PUBLIC_DOMAIN=127.0.0.1:8412 \
  --build-arg RAILWAY_ENVIRONMENT_NAME=staging \
  --build-arg RAILWAY_GIT_COMMIT_SHA="$(git rev-parse HEAD)" .

docker run --rm -e PORT=8412 -p 8412:8412 arpi-portfolio:local
```

`frontend.yml`'s `railway-image` job does exactly this on every push, then asserts
the runtime contract and the served site.

---

## 6. Staging keeps every safeguard, now that production exists

`DASH.13` approved a production release. **Nothing in that approval loosens staging.**
The conditions below were written when staging was the only deployment, and they
continue to bind it: staging remains non-production, `noindex`, `Disallow: /`,
preview-marked, and safe to point at unfinished work — which is the whole reason to
keep it after a public release exists rather than to retire or promote it.

The release was **not** implemented by making staging public, by allowing crawlers on
it, or by special-casing any crawler's user agent. `DASH.13` verified that the
rendered metadata on a production build is byte-identical across `LinkedInBot`,
`Twitterbot`, `facebookexternalhit` and an ordinary browser: the application does not
branch on user agent, and the release did not teach it to.

A staging deployment is permitted under all of these conditions:

- it **incurs a cost that has been approved** — unlike Vercel's free tier, Railway
  charges for the compute and for the database volume. See
  [`deployment/railway/README.md`](../../deployment/railway/README.md) section 11
- it exposes **no credential**, because the site holds none
- it does **not** claim Gate 2 is open
- it does **not** claim the case study is complete
- it clearly labels the data as synthetic and the validation as pending
- it is **not** indexed, promoted, linked or described as a launch

The site satisfies the middle four by construction, and the indexing condition
mechanically: the case-study route renders its locked state and its blocking
reasons, the synthetic-data statement appears on every primary route,
`tests/e2e/case-study-gate.spec.ts` asserts no route claims a published case study,
and `IS_PREVIEW` forces `noindex` on every non-production environment.

`tests/remote/deployed-site.spec.ts` re-checks all of it against the deployed URL,
because a build-time gate is not evidence about a served page.

The cost condition and the "not promoted" condition are operational and are the
deploying human's responsibility.

---

## 7. Headers

Set in both `next.config.ts` and `vercel.json`. The duplication is intentional:
`next.config.ts` covers `next start` and any Node host, `vercel.json` covers the
platform's edge, and a header that exists in only one place is a header that
disappears when the deployment target changes.

| Header                      | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| `X-Content-Type-Options`    | `nosniff`                                              |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                      |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), payment=()` |
| `X-Robots-Tag` on `/ui-lab` | `noindex, nofollow`                                    |

`poweredByHeader: false` removes `X-Powered-By`.

**No Content-Security-Policy is set, and that is a gap rather than a decision.**
The site would tolerate a strict one easily — it makes no third-party request, and
`tests/e2e/content-integrity.spec.ts` asserts that — but the single inline
`<script type="application/ld+json">` and the `<noscript><style>` block would each
need a hash or a nonce, and shipping a CSP that has not been verified against a real
deployment is worse than shipping none: a broken CSP either blocks the site or gets
loosened until it means nothing. This should be added with the first production
deployment, verified in the browser console, and recorded here.

---

## 8. Rollback

Railway keeps previous deployments addressable, so rollback is redeploying the
previous one — a dashboard action, or:

```bash
railway deployment list --service arpi-portfolio --json
railway redeploy --service arpi-portfolio --yes
```

No rebuild, no revert commit.

For a **content** problem rather than a code problem the faster fix is usually
upstream: because every number and status comes from the generated manifest,
correcting an evidence file and letting Railway rebuild changes what the site says.
There is no cache to purge and no revalidation window to wait out.

If a deployment ever publishes a claim it should not have, the correct order is:
**roll back first, then fix the evidence, then redeploy.** Not the other way round —
the wrong claim being public is the urgent part.

Rolling back a _configuration_ change is a different operation: revert the commit
that changed `railway.json` or `.railway/railway.ts` and re-run the bootstrap
workflow, which converges the project back onto the declaration.

### Rolling back the production release

Written before the first production cutover rather than after it, because a rollback
procedure invented during an incident is not a procedure. Six steps, in order:

1. **Identify the previous good production deployment** and its commit.
   `railway deployment list --service arpi-portfolio --environment production --json`.
   "Good" means it was verified, not merely that it built.
2. **Redeploy it.** `railway redeploy --service arpi-portfolio --environment production --yes`.
   No rebuild, so the build arguments that produced its metadata are the ones it had.
3. **Restore the public domain** if the rollback is a domain problem rather than a
   code problem — the domain belongs to an environment, so moving it back is the
   rollback.
4. **Verify the commit.** The deployment must report the SHA you intended, not merely
   answer `200`:
   `tsx scripts/railway/verify_release_policy.ts --url <origin> --expect production --expect-commit <sha>`.
   A reachable deployment serving a different commit is not evidence for the tree you
   think you rolled back to.
5. **Re-verify robots and canonical.** Same command, whose `indexing-coherence` and
   `canonical` steps are the ones that catch a rollback landing on an image built for
   another environment.
6. **Confirm staging is untouched.** `--expect preview` against the staging origin.
   Staging is never deleted, retargeted or made public by any production operation,
   including a failed one, and this is where that is checked rather than assumed.

**Order matters when a wrong claim is public:** roll back first, then fix, then
redeploy. If the problem is that production was never coherent in the first place —
the mixed-metadata failure in §5 — the fix is a **fresh build with production build
arguments**, not a redeploy of the same image.

**Do not test this destructively against a live release.** Steps 1 and 4–6 are
read-only and can be rehearsed at any time; 2 and 3 change what the public sees.

---

## 9. What is deliberately absent

| Absent                          | Why                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Analytics of any kind           | no third-party tracker, no advertising script, no session recorder, no consent banner to need      |
| Error reporting                 | no DSN, no client-side reporter                                                                    |
| Edge middleware                 | nothing to decide per request                                                                      |
| Serverless or edge functions    | all fourteen routes are statically prerendered                                                     |
| A database connection           | the site has no runtime data source, and every database variable is forbidden on its service       |
| PR environments                 | evaluated and deliberately not enabled; see `deployment/railway/README.md` section 9               |
| Image optimisation              | every graphic is an authored SVG                                                                   |
| Incremental static regeneration | there is no data source to revalidate against                                                      |
| A custom domain                 | none configured; the Railway-generated domain answers, and no production deployment exists         |
| Deploy hooks                    | Railway's GitHub integration is the one deployment owner; a second trigger would be ambiguous      |
| CI-driven deployment            | `ci.yml` and `frontend.yml` hold no secret. The one workflow that does is `workflow_dispatch` only |

---

## 10. Pre-deployment checklist

Run from `portfolio/`:

```bash
npm ci
npm run verify        # format, lint, types, manifest, unit tests, production build
npm run test:e2e      # accessibility, navigation, content integrity, design system,
                      # case-study gate, reduced motion
```

Run from the repository **root**, for the deployment itself:

```bash
npm ci
npm run verify        # typecheck, tooling tests, specification, IaC declaration
```

Then, against the deployed URL:

```bash
cd portfolio
ARPI_REMOTE_BASE_URL=https://<the-railway-domain> \
  npx playwright test --config playwright.remote.config.ts
cd ..
ARPI_REMOTE_BASE_URL=https://<the-railway-domain> \
  npx tsx scripts/railway/audit_deployed_site.ts
```

Most of what used to be a manual checklist here is now asserted by
`tests/remote/deployed-site.spec.ts`, which is the point of having it. What remains
for a person to confirm by inspection:

- [ ] the Railway cost for the compute and the database volume has been approved
- [ ] `railway variable list --service arpi-portfolio` shows only the two non-secret
      literals, and no database variable
- [ ] `npm run verify:railway` reports no drift
- [ ] for production only: explicit approval has been given, and the consequence
      that the site becomes indexable is intended
