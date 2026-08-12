#!/usr/bin/env tsx
/**
 * Verify a DEPLOYED ARPI origin against the release policy it claims.
 *
 * WHY THIS TOOL EXISTS, AND WHY IT IS NOT A UNIT TEST
 * --------------------------------------------------
 * Every property here is decided by code this repository already tests. What no
 * test in this repository can decide is whether the DEPLOYMENT is internally
 * consistent, because the site's origin and its indexability are resolved from
 * environment variables at two different moments:
 *
 *   - a statically prerendered route bakes them at BUILD time;
 *   - a dynamically rendered route reads them at REQUEST time;
 *   - `robots.txt` and `sitemap.xml` are produced from the BUILD-time values.
 *
 * When a deployment's build environment and runtime environment agree - which is
 * what a fresh build in one environment produces - all three coincide and the
 * site is coherent. When they DISAGREE, which is what promoting or re-running an
 * image built elsewhere produces, the deployment ships a mixture: `DASH.13`
 * measured a tree whose `robots.txt` said `Allow: /` with a production `Host:`
 * while its own home page carried `noindex, nofollow` and canonicalised itself to
 * the staging origin. Nothing failed. Nothing logged. Search engines and social
 * crawlers would have received two contradictory instructions and picked one.
 *
 * That is the defect class this tool is for, and it is only detectable from
 * outside the process, by reading what the deployment actually serves.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   1. Reachability of the origin and of every core public route.
 *   2. ONE indexing policy: `robots.txt` and the per-page `robots` meta agree,
 *      on every route sampled, with the policy the caller declared.
 *   3. Canonical correctness: HTTPS, the requested origin, the canonical route.
 *   4. Open Graph completeness, including `og:site_name`, absolute URLs, and the
 *      1200 x 630 geometry a social crawler sizes the card from.
 *   5. The social image is fetchable, is a PNG, and is actually 1200 x 630.
 *   6. The sitemap uses one origin, lists no redirect alias and no internal route.
 *   7. Optionally, that the deployment serves an expected commit.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not ask a social network to scrape anything. A crawler's cache is not a
 * property of this deployment, so "LinkedIn shows the card" is not something this
 * tool can or should claim; it verifies the PREREQUISITES and says so.
 *
 *   ARPI_REMOTE_BASE_URL=https://arpi.up.railway.app \
 *     tsx scripts/railway/verify_release_policy.ts --expect production
 *
 *   tsx scripts/railway/verify_release_policy.ts \
 *     --url https://arpi-portfolio-staging.up.railway.app --expect preview
 *
 *   tsx scripts/railway/verify_release_policy.ts --expect production \
 *     --expect-commit 0123abc --json
 *
 * Exit codes
 *   0  the deployment matches the declared policy
 *   1  at least one assertion failed
 *   2  refused to start: bad arguments, or no target
 */
import { RunReport, parseCommonArguments, rejectCredentialArguments } from './lib/report.ts'

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    `Verify a deployed ARPI origin against its release policy.

Usage: tsx scripts/railway/verify_release_policy.ts --expect <policy> [options]

  --expect <policy>       REQUIRED. "production" or "preview".
                          production: public routes indexable, sitemap published,
                                      no preview notice.
                          preview:    everything disallowed and noindex.
  --url <url>             Target origin to FETCH. Defaults to ARPI_REMOTE_BASE_URL.
  --canonical-origin <o>  The public origin the deployment should claim, when that
                          differs from the one being fetched. Two legitimate cases:
                          verifying production through a temporary provider URL
                          before a domain cutover, and verifying a build locally.
                          Defaults to --url, which is the strict case.
  --expect-commit <sha>   Also require the deployment to report this commit.
  --route <path>          Extra route to sample; repeatable.
  --json                  Emit a machine-readable result on stdout.

No credential is accepted on the command line, and this tool sends none: every
request is an unauthenticated public GET, which is the same access a search
engine or a social crawler has.
`
  )
  process.exit(0)
}

try {
  rejectCredentialArguments(argv)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}

function valueOf(flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  return argv[index + 1]
}

function valuesOf(flag: string): string[] {
  const found: string[] = []
  argv.forEach((arg, index) => {
    if (arg === flag && argv[index + 1] !== undefined) found.push(argv[index + 1] as string)
  })
  return found
}

const common = parseCommonArguments(
  // The value-taking flags and their values are not "unknown arguments".
  argv.filter((arg, index) => {
    const valueFlags = [
      '--url',
      '--canonical-origin',
      '--expect',
      '--expect-commit',
      '--route',
    ]
    if (valueFlags.includes(arg)) return false
    const previous = argv[index - 1]
    return previous === undefined || !valueFlags.includes(previous)
  })
)
if (common.unknown.length > 0) {
  process.stderr.write(
    `Unknown argument(s): ${common.unknown.join(', ')}. Run with --help.\n`
  )
  process.exit(2)
}

const expected = valueOf('--expect')
if (expected !== 'production' && expected !== 'preview') {
  process.stderr.write(
    'Refusing to start: --expect must be "production" or "preview".\n\n' +
      'The policy is not inferred from the URL. A deployment that is meant to be a\n' +
      'preview and is serving a public policy is exactly the failure this tool is\n' +
      'for, so the caller has to state which one they believe they deployed.\n'
  )
  process.exit(2)
}

const rawBase = valueOf('--url') ?? process.env.ARPI_REMOTE_BASE_URL
if (rawBase === undefined || rawBase.trim() === '') {
  process.stderr.write(
    'Refusing to start: no target. Pass --url or set ARPI_REMOTE_BASE_URL.\n\n' +
      'This tool does not fall back to localhost. A local server proves the code is\n' +
      'right; it proves nothing about a deployment, which is the only thing here\n' +
      'that cannot be established any other way.\n'
  )
  process.exit(2)
}

let base: URL
try {
  base = new URL(rawBase.trim())
} catch {
  process.stderr.write(`Refusing to start: "${rawBase}" is not a URL.\n`)
  process.exit(2)
}
/** Where requests go. */
const FETCH_ORIGIN = base.origin.replace(/\/+$/, '')

/*
 * WHAT THE DEPLOYMENT SHOULD CLAIM ABOUT ITSELF, which is not always where it is
 * being fetched from. Keeping the two separable is what makes the tool usable at
 * the moment it is most needed: production has to be verified BEFORE a domain
 * cutover, and at that moment it is only reachable on a temporary provider URL
 * while it correctly canonicalises to the public origin it is about to receive.
 * Collapsing them would force a choice between verifying nothing and verifying
 * the wrong thing.
 */
const rawCanonical = valueOf('--canonical-origin')
let CANONICAL_ORIGIN = FETCH_ORIGIN
if (rawCanonical !== undefined && rawCanonical.trim() !== '') {
  try {
    CANONICAL_ORIGIN = new URL(rawCanonical.trim()).origin.replace(/\/+$/, '')
  } catch {
    process.stderr.write(
      `Refusing to start: --canonical-origin "${rawCanonical}" is not a URL.\n`
    )
    process.exit(2)
  }
}
/** Alias kept for the assertions below, all of which judge the claimed origin. */
const ORIGIN = CANONICAL_ORIGIN
const expectCommit = valueOf('--expect-commit')

/** The routes a release is judged on. Extra ones may be added with `--route`. */
const CORE_ROUTES = [
  '/',
  '/dashboard/sales-gross',
  '/dashboard/deals',
  '/dashboard/inventory',
  '/dashboard/fi',
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
  '/technical',
  '/about',
  '/inventory',
  ...valuesOf('--route'),
]

/** Routes whose metadata is sampled in full. Kept small: three fetches, not twelve. */
const METADATA_ROUTES = ['/', '/technical', '/about']

const report = new RunReport('ARPI release policy verification', common.json, false)
report.header([
  `fetching       : ${FETCH_ORIGIN}`,
  `claimed origin : ${CANONICAL_ORIGIN}${
    CANONICAL_ORIGIN === FETCH_ORIGIN ? '' : '  (pre-cutover verification)'
  }`,
  `expected policy: ${expected}`,
  `core routes    : ${CORE_ROUTES.length}`,
  ...(expectCommit ? [`expected commit: ${expectCommit}`] : []),
])

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

interface Fetched {
  readonly status: number
  readonly contentType: string
  readonly body: string
  readonly bytes: Uint8Array
  readonly location: string | null
  readonly error?: string
}

async function get(path: string, accept = 'text/html'): Promise<Fetched> {
  // Requests go to the FETCH origin; every assertion judges the CLAIMED origin.
  const url = path.startsWith('http') ? path : `${FETCH_ORIGIN}${path}`
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        Accept: accept,
        // A crawler's access is the access being verified, so the request is
        // made as one. This is NOT the app branching on a user agent - the app
        // does not, and `DASH.13` verified its rendered metadata is identical
        // across LinkedInBot, Twitterbot, facebookexternalhit and a browser.
        'User-Agent':
          'LinkedInBot/1.0 (compatible; Mozilla/5.0; +ARPI-release-verification)',
      },
    })
    const buffer = new Uint8Array(await response.arrayBuffer())
    const isText = (response.headers.get('content-type') ?? '').startsWith('text/') ||
      (response.headers.get('content-type') ?? '').includes('xml')
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: isText ? new TextDecoder().decode(buffer) : '',
      bytes: buffer,
      location: response.headers.get('location'),
    }
  } catch (error) {
    return {
      status: 0,
      contentType: '',
      body: '',
      bytes: new Uint8Array(),
      location: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Metadata extraction                                                        */
/* -------------------------------------------------------------------------- */

function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
    'i'
  )
  const tag = pattern.exec(html)?.[0]
  if (tag === undefined) return null
  return /content="([^"]*)"/i.exec(tag)?.[1] ?? null
}

function canonicalOf(html: string): string | null {
  const tag = /<link[^>]+rel="canonical"[^>]*>/i.exec(html)?.[0]
  if (tag === undefined) return null
  return /href="([^"]*)"/i.exec(tag)?.[1] ?? null
}

/** PNG dimensions, read from the IHDR chunk. No image library for two integers. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/* -------------------------------------------------------------------------- */
/* 1. Reachability                                                            */
/* -------------------------------------------------------------------------- */

const root = await get('/')
if (root.status === 0) {
  report.failed(
    'reachability',
    `${ORIGIN} could not be reached: ${root.error ?? 'unknown error'}. ` +
      'An unreachable host is a failure, not an absence of evidence.'
  )
  process.exit(report.finish())
}
if (root.status !== 200) {
  report.failed('reachability', `GET / answered ${root.status}, expected 200.`)
} else {
  report.ok('reachability', `GET / answered 200 (${root.bytes.length} bytes)`)
}

const routeResults: { path: string; status: number }[] = []
for (const path of CORE_ROUTES) {
  const response = await get(path)
  routeResults.push({ path, status: response.status })
}
const brokenRoutes = routeResults.filter((r) => r.status !== 200)
if (brokenRoutes.length > 0) {
  report.failed(
    'core-routes',
    `${brokenRoutes.length} of ${routeResults.length} did not answer 200: ` +
      brokenRoutes.map((r) => `${r.path} (${r.status})`).join(', ')
  )
} else {
  report.ok('core-routes', `all ${routeResults.length} core routes answered 200`)
}

/* -------------------------------------------------------------------------- */
/* 2. One indexing policy                                                     */
/* -------------------------------------------------------------------------- */

const robots = await get('/robots.txt', 'text/plain')
const robotsBody = robots.body
const robotsDisallowsAll = /^\s*disallow:\s*\/\s*$/im.test(robotsBody)
const robotsAllowsRoot = /^\s*allow:\s*\/\s*$/im.test(robotsBody)
const robotsExcludesUiLab = /disallow:\s*\/ui-lab/i.test(robotsBody)
const robotsSitemap = /^\s*sitemap:\s*(\S+)/im.exec(robotsBody)?.[1] ?? null

if (robots.status !== 200) {
  report.failed('robots-txt', `GET /robots.txt answered ${robots.status}, expected 200.`)
} else if (expected === 'preview') {
  if (robotsDisallowsAll && !robotsAllowsRoot) {
    report.ok('robots-txt', 'preview policy: Disallow: / — nothing is offered for crawl')
  } else {
    report.failed(
      'robots-txt',
      'a preview deployment must serve "Disallow: /". It served: ' +
        JSON.stringify(robotsBody.slice(0, 200))
    )
  }
} else {
  if (robotsAllowsRoot && !robotsDisallowsAll && robotsExcludesUiLab) {
    report.ok('robots-txt', 'production policy: Allow: / with /ui-lab excluded')
  } else {
    report.failed(
      'robots-txt',
      'a production deployment must Allow: / and still Disallow: /ui-lab. It served: ' +
        JSON.stringify(robotsBody.slice(0, 200))
    )
  }
  if (robotsSitemap === null) {
    report.failed('robots-sitemap', 'production robots.txt publishes no Sitemap: line.')
  } else if (!robotsSitemap.startsWith(`${ORIGIN}/`)) {
    report.failed(
      'robots-sitemap',
      `robots.txt points at a sitemap on another origin: ${robotsSitemap} (expected ${ORIGIN}). ` +
        'This is the build-time/runtime environment mismatch described at the top of this file.'
    )
  } else {
    report.ok('robots-sitemap', robotsSitemap)
  }
}

/*
 * THE COHERENCE ASSERTION. The whole reason this tool exists.
 *
 * `robots.txt` comes from the build-time environment; a dynamic route's meta
 * robots comes from the runtime environment. Sampling both and requiring them to
 * agree is what catches a deployment serving two contradictory policies.
 */
const metadata = new Map<string, Fetched>()
for (const path of METADATA_ROUTES) metadata.set(path, await get(path))

const indexStates = METADATA_ROUTES.map((path) => {
  const html = metadata.get(path)?.body ?? ''
  const robotsMeta = metaContent(html, 'robots') ?? ''
  return { path, robotsMeta, noindex: /noindex/i.test(robotsMeta) }
})

const wantNoindex = expected === 'preview'
const disagreeing = indexStates.filter((state) => state.noindex !== wantNoindex)
if (disagreeing.length > 0) {
  report.failed(
    'indexing-coherence',
    `${disagreeing.length} route(s) contradict the declared "${expected}" policy: ` +
      disagreeing.map((s) => `${s.path} => "${s.robotsMeta}"`).join(', ') +
      '. robots.txt and the page metadata must state ONE policy; a mixture means the ' +
      'build-time and runtime environments disagree, which a promoted image causes.'
  )
} else {
  report.ok(
    'indexing-coherence',
    `robots.txt and all ${indexStates.length} sampled routes agree on "${expected}"`
  )
}

/* -------------------------------------------------------------------------- */
/* 3. Canonical correctness                                                   */
/* -------------------------------------------------------------------------- */

const canonicalProblems: string[] = []
for (const path of METADATA_ROUTES) {
  const html = metadata.get(path)?.body ?? ''
  const canonical = canonicalOf(html)
  const want = path === '/' ? ORIGIN : `${ORIGIN}${path}`
  if (canonical === null) {
    canonicalProblems.push(`${path}: absent`)
  } else if (!canonical.startsWith('https://') && !ORIGIN.startsWith('http://')) {
    canonicalProblems.push(`${path}: not https (${canonical})`)
  } else if (canonical.replace(/\/+$/, '') !== want.replace(/\/+$/, '')) {
    canonicalProblems.push(`${path}: ${canonical} (expected ${want})`)
  }
}
if (canonicalProblems.length > 0) {
  report.failed('canonical', canonicalProblems.join('; '))
} else {
  report.ok('canonical', `all ${METADATA_ROUTES.length} sampled routes canonicalise to ${ORIGIN}`)
}

/* -------------------------------------------------------------------------- */
/* 4. Open Graph completeness                                                 */
/* -------------------------------------------------------------------------- */

const REQUIRED_OG = [
  'og:type',
  'og:site_name',
  'og:url',
  'og:title',
  'og:description',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
] as const
const REQUIRED_TWITTER = [
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
] as const

const rootHtml = metadata.get('/')?.body ?? ''
const ogMissing = REQUIRED_OG.filter((key) => {
  const value = metaContent(rootHtml, key)
  return value === null || value.trim() === ''
})
const twitterMissing = REQUIRED_TWITTER.filter((key) => {
  const value = metaContent(rootHtml, key)
  return value === null || value.trim() === ''
})

if (ogMissing.length > 0) {
  report.failed('open-graph', `absent or empty on /: ${ogMissing.join(', ')}`)
} else {
  report.ok('open-graph', `all ${REQUIRED_OG.length} required og:* tags present on /`)
}
if (twitterMissing.length > 0) {
  report.failed('twitter-card', `absent or empty on /: ${twitterMissing.join(', ')}`)
} else {
  report.ok('twitter-card', metaContent(rootHtml, 'twitter:card') ?? '')
}

const ogWidth = metaContent(rootHtml, 'og:image:width')
const ogHeight = metaContent(rootHtml, 'og:image:height')
if (ogWidth !== '1200' || ogHeight !== '630') {
  report.failed(
    'og-geometry',
    `og:image:width/height are ${String(ogWidth)}x${String(ogHeight)}, expected 1200x630. ` +
      'A social crawler sizes the card from these before the image loads.'
  )
} else {
  report.ok('og-geometry', '1200x630')
}

const ogImage = metaContent(rootHtml, 'og:image')
const ogUrl = metaContent(rootHtml, 'og:url')
for (const [name, value] of [
  ['og:image', ogImage],
  ['og:url', ogUrl],
] as const) {
  if (value === null) continue
  if (!/^https?:\/\//i.test(value)) {
    report.failed(name, `"${value}" is not absolute. A relative ${name} is not resolvable by a crawler.`)
  } else if (!value.startsWith(ORIGIN)) {
    report.failed(
      name,
      `"${value}" is not on ${ORIGIN}. A social card that points at another environment is the ` +
        'build-time/runtime mismatch this tool exists to catch.'
    )
  } else {
    report.ok(name, value)
  }
}

/* -------------------------------------------------------------------------- */
/* 5. The social image is really there, and is really 1200 x 630              */
/* -------------------------------------------------------------------------- */

const imagePath = ogImage !== null && ogImage.startsWith(ORIGIN)
  ? ogImage.slice(ORIGIN.length)
  : '/social-preview.png'
const image = await get(imagePath, 'image/png')
if (image.status !== 200) {
  report.failed('og-image-fetch', `GET ${imagePath} answered ${image.status}, expected 200.`)
} else if (!image.contentType.includes('image/png')) {
  report.failed('og-image-fetch', `${imagePath} served Content-Type "${image.contentType}", expected image/png.`)
} else {
  const size = pngSize(image.bytes)
  if (size === null) {
    report.failed('og-image-fetch', `${imagePath} is served as PNG but has no readable PNG header.`)
  } else if (size.width !== 1200 || size.height !== 630) {
    report.failed(
      'og-image-fetch',
      `${imagePath} is ${size.width}x${size.height}; the declared geometry is 1200x630.`
    )
  } else {
    report.ok(
      'og-image-fetch',
      `${imagePath} 200 image/png ${size.width}x${size.height} (${image.bytes.length} bytes)`
    )
  }
}

/* -------------------------------------------------------------------------- */
/* 6. The sitemap                                                             */
/* -------------------------------------------------------------------------- */

const sitemap = await get('/sitemap.xml', 'application/xml')
if (expected === 'preview') {
  // A preview may still serve the file; what matters is that robots.txt does not
  // advertise it. Recorded rather than asserted.
  report.ok('sitemap', `preview: GET /sitemap.xml answered ${sitemap.status} (not advertised)`)
} else if (sitemap.status !== 200) {
  report.failed('sitemap', `GET /sitemap.xml answered ${sitemap.status}, expected 200.`)
} else {
  const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string)
  const foreign = locations.filter((loc) => !loc.startsWith(`${ORIGIN}/`) && loc.replace(/\/+$/, '') !== ORIGIN)
  const RETIRED = ['/architecture', '/data-model', '/kpis', '/governance', '/status', '/inventory-operations', '/dashboard', '/dealerships']
  const aliases = locations.filter((loc) => {
    const path = loc.startsWith(ORIGIN) ? loc.slice(ORIGIN.length) || '/' : loc
    return RETIRED.includes(path.replace(/\/+$/, '') || '/')
  })
  const internal = locations.filter((loc) => loc.includes('/ui-lab'))

  if (locations.length === 0) {
    report.failed('sitemap', 'the sitemap contains no <loc> entries.')
  } else if (foreign.length > 0) {
    report.failed(
      'sitemap',
      `${foreign.length} entr(ies) are on another origin, e.g. ${foreign[0]}. Expected ${ORIGIN}.`
    )
  } else if (aliases.length > 0) {
    report.failed('sitemap', `lists retired redirect alias(es): ${aliases.join(', ')}`)
  } else if (internal.length > 0) {
    report.failed('sitemap', `lists the internal UI lab: ${internal.join(', ')}`)
  } else {
    report.ok('sitemap', `${locations.length} entries, all on ${ORIGIN}, no alias, no /ui-lab`)
  }
}

/* -------------------------------------------------------------------------- */
/* 7. Preview notice, and the commit                                          */
/* -------------------------------------------------------------------------- */

const hasPreviewNotice = /Unpublished deployment/i.test(rootHtml)
if (expected === 'production' && hasPreviewNotice) {
  report.failed(
    'preview-notice',
    'the production origin renders the "Unpublished deployment" notice. A released site ' +
      'must not tell a visitor it is not launched.'
  )
} else if (expected === 'preview' && !hasPreviewNotice) {
  report.failed(
    'preview-notice',
    'a preview deployment does not render the "Unpublished deployment" notice, so a ' +
      'reader has no visible signal that this is not the launched site.'
  )
} else {
  report.ok(
    'preview-notice',
    expected === 'production' ? 'absent, as a released site requires' : 'present'
  )
}

if (expectCommit !== undefined) {
  /*
   * Build identity. The site publishes the commit it was built from in its
   * generated project manifest, which is the mechanism that already exists - no
   * new endpoint, and nothing secret.
   */
  const needle = expectCommit.trim().toLowerCase().slice(0, 7)
  const technical = metadata.get('/technical')?.body ?? ''
  const found = rootHtml.toLowerCase().includes(needle) || technical.toLowerCase().includes(needle)
  if (found) {
    report.ok('deployed-commit', `the deployment reports ${needle}`)
  } else {
    report.failed(
      'deployed-commit',
      `no occurrence of ${needle} in / or /technical. A reachable deployment serving another ` +
        'commit is not evidence for this tree.'
    )
  }
}

report.setOutputs({
  fetchOrigin: FETCH_ORIGIN,
  canonicalOrigin: CANONICAL_ORIGIN,
  expectedPolicy: expected,
  robotsPolicy: expected === 'preview' ? 'disallow-all' : 'allow-public',
  ogImage,
  ogUrl,
  canonicalSampled: METADATA_ROUTES.length,
  coreRoutesChecked: routeResults.length,
  /*
   * Stated as a prerequisite, never as a confirmation. Whether LinkedIn SHOWS the
   * card depends on its cache, which is not a property of this deployment.
   */
  linkedInPrerequisites:
    report.failures.length === 0 && expected === 'production'
      ? 'verified — submit the origin to LinkedIn Post Inspector for a fresh scrape'
      : 'not verified',
})

process.exit(report.finish())
