# ARPI portfolio deployment

Configuration for deploying this site, and the boundaries the deployment is held
to.

**No production deployment has been made, and none should be made without explicit
approval.** This document describes how one would be configured. A branch preview
is permitted under the conditions in section 6.

---

## 1. Target

**Vercel**, with the repository root at `portfolio/`.

Chosen because it is the reference host for Next.js App Router, its free tier
covers a static eight-page site with no function invocations, and it needs no
account credential committed anywhere in this repository. There is no lock-in of
consequence: the site is fourteen statically prerendered routes, so
`next build && next start` behind any Node host, or a static export behind any CDN,
would serve it.

### Project settings

| Setting                       | Value           | Why                                                                          |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------- |
| Root Directory                | `portfolio`     | the repository is a data platform with a website in a subdirectory           |
| Framework Preset              | Next.js         | detected; `vercel.json` states it explicitly                                 |
| Install Command               | `npm ci`        | installs exactly the lockfile and fails if it disagrees with `package.json`  |
| Build Command                 | `npm run build` | `prebuild` runs `manifest:check` first, so a stale manifest fails the deploy |
| Output Directory              | `.next`         | default                                                                      |
| Node version                  | 22.x            | matches CI                                                                   |
| Automatic deploys from `main` | **off**         | see section 2                                                                |

Most of this is in [`vercel.json`](../vercel.json) so it is reviewable in a diff
rather than living only in a dashboard.

### The build gate is the same one CI uses

`prebuild` runs `npm run manifest:check`, which regenerates the project manifest
from the repository's evidence files and fails if it differs from the committed
one. A deploy therefore cannot ship a site whose numbers or statuses have drifted
from the evidence — including a deploy triggered from a dashboard by someone who
never ran the test suite.

That is the single most important line in this document.

---

## 2. Automatic deployment from `main` is disabled

```json
"git": { "deploymentEnabled": { "main": false } }
```

Deliberate. A merge to `main` should not publish a public site as a side effect.
Publishing is a separate, deliberate act — the site makes claims about a project's
state, and those claims going public is a decision rather than a consequence of a
code review.

To deploy production, once approved: promote a specific deployment from the Vercel
dashboard, or `vercel --prod` from `portfolio/` with the CLI authenticated
interactively. Never from CI, because CI has no secrets and must never acquire any.

---

## 3. Environment variables

**Exactly two are permitted, and both are public by design.**

| Variable                              | Value                                                    | Purpose                                                      |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`                | the deployment's own canonical origin, no trailing slash | canonical tags, `sitemap.xml`, `robots.txt`, Open Graph URLs |
| `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` | `false`                                                  | one of five conditions on the case-study gate                |

**No secret may ever be placed in a `NEXT_PUBLIC_*` variable.** The `NEXT_PUBLIC_`
prefix is not a namespace — it is an instruction to Next to inline the value into
the client bundle. A credential put there is published, permanently, in a
fingerprinted JavaScript file, and rotating it does not unpublish it.

The site needs no other variable. It has no database connection, no API key, no
authentication provider, no analytics token, no error-reporting DSN and no
third-party service of any kind. If a future change appears to need a secret, that
is a signal to re-read [ADR-0009](../../docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md):
this directory is a documentation site, not a second analytics application.

`VERCEL_ENV` is provided by the platform and is read, not set.

### Setting `NEXT_PUBLIC_SITE_URL`

Set it per environment, to that environment's own origin. A preview that inherits
production's value emits canonical tags pointing at a site it is not, which is how
a preview ends up outranking the thing it previews.

`src/lib/site.ts` strips any trailing slash and falls back to
`http://localhost:3000`, so local development and the test suite need nothing set.

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

### Production

- `NEXT_PUBLIC_SITE_URL` set to the production origin
- `robots.txt` allows everything except `/ui-lab`, and points at `sitemap.xml`
- `sitemap.xml` lists the eight indexable routes with the priorities declared in
  `src/lib/site.ts`
- canonical tags are absolute, on the production origin
- `/ui-lab` additionally carries `X-Robots-Tag: noindex, nofollow`

### Preview

`IS_PREVIEW` is true when `VERCEL_ENV === 'preview'` or
`NEXT_PUBLIC_ARPI_PREVIEW === 'true'`. A preview:

- **disallows all crawling** — `robots.txt` is `User-agent: * / Disallow: /`, with
  no sitemap reference
- sets its canonical tags to its own origin, never production's
- renders a visible preview marker, so a screenshot of a preview cannot be mistaken
  for the published site
- is otherwise byte-identical in behaviour, including the locked case study

The crawl block is a requirement rather than a preference. A preview of this site
states that Gate 2 is closed and that real-engine validation is pending. An indexed
preview would put a point-in-time snapshot of those statements into search results,
where it would outlive the state it describes — and the whole point of this site is
that its statements track their evidence.

### Local

```bash
npm run dev     # regenerates the manifest, then serves on :3000
npm run build && npm run start   # production build, :3000
```

No environment variable required.

---

## 6. Branch previews before production approval

A branch preview is permitted while production is not, but only under all of these
conditions:

- it incurs **no paid charge** — free tier, no add-on, no seat
- it exposes **no credential**, because there is none to expose
- it does **not** claim Gate 2 is open
- it does **not** claim the case study is complete
- it clearly labels the data as synthetic and the validation as pending
- it is **not** promoted, linked or described as a launch

The site satisfies the middle four by construction: the case-study route renders
its locked state and its blocking reasons, the synthetic-data statement appears on
every primary route, and `tests/e2e/case-study-gate.spec.ts` asserts no route claims
a published case study. The first and last conditions are operational and are the
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

Vercel keeps every deployment addressable, so rollback is promoting the previous
one — a dashboard action, no rebuild, no revert commit.

For a content problem rather than a code problem, the faster fix is often upstream:
because every number and status comes from the generated manifest, correcting an
evidence file and rebuilding changes what the site says. There is no cache to purge
and no revalidation window to wait out.

If a deployment ever publishes a claim it should not have, the correct order is:
promote the previous deployment first, then fix the evidence, then redeploy. Not the
other way round — the wrong claim being public is the urgent part.

---

## 9. What is deliberately absent

| Absent                          | Why                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Analytics of any kind           | no third-party tracker, no advertising script, no session recorder, no consent banner to need |
| Error reporting                 | no DSN, no client-side reporter                                                               |
| Edge middleware                 | nothing to decide per request                                                                 |
| Serverless or edge functions    | all fourteen routes are statically prerendered                                                |
| Image optimisation              | every graphic is an authored SVG                                                              |
| Incremental static regeneration | there is no data source to revalidate against                                                 |
| A custom domain                 | none configured; no production deployment exists                                              |
| Deploy hooks                    | a deploy is a deliberate act, not a webhook                                                   |
| CI-driven deployment            | CI has no secrets and must never acquire any                                                  |

---

## 10. Pre-deployment checklist

Run from `portfolio/`:

```bash
npm ci
npm run verify        # format, lint, types, manifest, unit tests, production build
npm run test:e2e      # accessibility, navigation, content integrity, design system,
                      # case-study gate, reduced motion
```

Then confirm by inspection:

- [ ] `NEXT_PUBLIC_SITE_URL` is set to **this** environment's origin, no trailing slash
- [ ] `NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED` is `false`
- [ ] no other environment variable is configured
- [ ] `/case-study` renders locked, and lists its blocking reasons
- [ ] `/status` reports Lifecycle Phase 5 as in progress and both engine paths as
      pending external validation
- [ ] `/robots.txt` matches the environment — production allows all but `/ui-lab`;
      a preview disallows everything
- [ ] `/sitemap.xml` lists eight routes and not `/ui-lab`
- [ ] the synthetic-data statement is visible on every primary route
- [ ] for production only: explicit approval has been given
