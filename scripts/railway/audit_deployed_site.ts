#!/usr/bin/env tsx
/**
 * Lighthouse audit of the deployed site, recorded as a non-secret artefact.
 *
 * WHY A WRAPPER RATHER THAN A RAW LIGHTHOUSE INVOCATION
 * ----------------------------------------------------
 * Three reasons, all of them about the result being trustworthy later:
 *
 *   1. Lighthouse's own JSON is ~2 MB per run and its shape changes between
 *      major versions. What this project needs recorded is a dozen numbers, in a
 *      stable shape, that can be diffed against the next run.
 *   2. A score with no URL, no version and no timestamp beside it is not
 *      evidence. Those go in the summary.
 *   3. It must not invent a result. If Lighthouse cannot run, this exits non-zero
 *      and says so, rather than writing zeroes that would later read as "the site
 *      scored badly".
 *
 * The audit is deliberately NOT a pass/fail gate by default. A performance score
 * is a measurement of a network and a runner as much as of a site, and a CI job
 * that fails on a 0.89 teaches people to raise the threshold. `--min-*` flags
 * exist for a caller that genuinely wants a gate; without them this reports.
 *
 *   ARPI_REMOTE_BASE_URL=https://arpi-portfolio-staging.up.railway.app \
 *     tsx scripts/railway/audit_deployed_site.ts
 *
 *   tsx scripts/railway/audit_deployed_site.ts --json --out lighthouse
 *   tsx scripts/railway/audit_deployed_site.ts --min-accessibility 0.95
 *
 * Exit codes
 *   0  the audit ran (and met any thresholds given)
 *   1  a threshold was not met
 *   2  the audit could not run at all
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { redactedJson } from './lib/redact.ts'
import { REPO_ROOT, readRepoJson } from './lib/spec.ts'

interface ToolingWithLighthouse {
  lighthouse: { package: string; version: string }
}

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    `Audit the deployed ARPI site with Lighthouse.

Usage: tsx scripts/railway/audit_deployed_site.ts [options]

  --url <url>              Target. Defaults to ARPI_REMOTE_BASE_URL.
  --route <path>           Route to audit; repeatable. Defaults to / and /kpis.
  --out <directory>        Where to write the summary and the full reports.
                           Defaults to lighthouse/ (git-ignored).
  --json                   Print the summary as JSON on stdout.
  --min-performance <n>    Fail below this score (0..1). Off by default.
  --min-accessibility <n>  Fail below this score (0..1). Off by default.
  --min-best-practices <n> Fail below this score (0..1). Off by default.
  --min-seo <n>            Fail below this score (0..1). Off by default.

Requires a deployed URL. It does not fall back to a local server: a Lighthouse
score for localhost is not a measurement of the deployment.
`
  )
  process.exit(0)
}

function flag(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return argv[index + 1]
}

function flags(name: string): string[] {
  const values: string[] = []
  argv.forEach((argument, index) => {
    if (argument === `--${name}` && argv[index + 1] !== undefined) {
      values.push(argv[index + 1] as string)
    }
  })
  return values
}

function threshold(name: string): number | undefined {
  const raw = flag(`min-${name}`)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    process.stderr.write(`--min-${name} must be a number between 0 and 1.\n`)
    process.exit(2)
  }
  return value
}

const jsonMode = argv.includes('--json')
const baseUrl = (flag('url') ?? process.env['ARPI_REMOTE_BASE_URL'] ?? '').replace(
  /\/+$/,
  ''
)
const routes = flags('route').length > 0 ? flags('route') : ['/', '/kpis']
// `resolve` against the repository root, not `join`.
//
// `join(REPO_ROOT, '/tmp/x')` produces `<repo>/tmp/x` — it concatenates rather
// than honouring the absolute path, so an absolute `--out` silently wrote inside
// the repository. `resolve` returns an absolute argument unchanged and still
// anchors a relative one to the repository root.
const requestedOut = flag('out') ?? 'lighthouse'
const outDirectory = isAbsolute(requestedOut)
  ? requestedOut
  : resolve(REPO_ROOT, requestedOut)

if (baseUrl === '') {
  process.stderr.write(
    'No target URL.\n\n' +
      'Set ARPI_REMOTE_BASE_URL to the deployed origin, or pass --url.\n' +
      'This audit deliberately does not fall back to a local server: a Lighthouse\n' +
      'score for localhost measures a loopback interface, not the deployment.\n'
  )
  process.exit(2)
}

let target: URL
try {
  target = new URL(baseUrl)
} catch {
  process.stderr.write(`"${baseUrl}" is not a valid URL.\n`)
  process.exit(2)
}

const tooling = readRepoJson<ToolingWithLighthouse>('deployment/railway/tooling.json')
const pinned = `${tooling.lighthouse.package}@${tooling.lighthouse.version}`

/* -------------------------------------------------------------------------- */
/* Running Lighthouse                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Locate a Chromium for Lighthouse to drive.
 *
 * Reuses the browser Playwright already installs for the existing browser suites
 * rather than letting Lighthouse download a second one — which on a CI runner is
 * a ~150 MB download for a binary that is already on disk.
 */
function resolveChromium(): string | undefined {
  const explicit = process.env['CHROME_PATH']
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit

  // The path this environment's pre-installed Chromium uses, and the one
  // portfolio/scripts/chromium.ts also consults.
  const candidates = [
    process.env['PLAYWRIGHT_BROWSERS_PATH'] !== undefined
      ? join(process.env['PLAYWRIGHT_BROWSERS_PATH'], 'chromium')
      : undefined,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((candidate): candidate is string => candidate !== undefined)

  return candidates.find((candidate) => existsSync(candidate))
}

interface LighthouseCategory {
  id?: string
  title?: string
  score?: number | null
}

interface LighthouseAudit {
  id?: string
  title?: string
  numericValue?: number
  displayValue?: string
  score?: number | null
}

interface LighthouseReport {
  lighthouseVersion?: string
  finalDisplayedUrl?: string
  requestedUrl?: string
  fetchTime?: string
  categories?: Record<string, LighthouseCategory>
  audits?: Record<string, LighthouseAudit>
}

async function runLighthouse(url: string, reportPath: string): Promise<LighthouseReport> {
  const chromium = resolveChromium()

  const args = [
    '--yes',
    pinned,
    url,
    '--output=json',
    `--output-path=${reportPath}`,
    '--quiet',
    // Explicit categories, in a fixed order, so the summary shape is stable.
    '--only-categories=performance,accessibility,best-practices,seo',
    // Headless, no sandbox: the sandbox needs privileges a CI container does not
    // have, and the page being audited is this project's own site.
    '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
  ]

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (chromium !== undefined) env['CHROME_PATH'] = chromium

  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: REPO_ROOT,
      env,
      // stdin closed: npx must never wait for a confirmation prompt in CI.
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('close', resolve)
  })

  if (code !== 0) {
    throw new Error(
      `Lighthouse exited ${String(code)}. ` +
        (chromium === undefined
          ? 'No Chromium was found — set CHROME_PATH, or run `npx playwright install chromium`.'
          : `Chromium: ${chromium}`)
    )
  }

  if (!existsSync(reportPath)) {
    throw new Error(`Lighthouse reported success but wrote no report to ${reportPath}.`)
  }

  const { readFileSync } = await import('node:fs')
  return JSON.parse(readFileSync(reportPath, 'utf8')) as LighthouseReport
}

/* -------------------------------------------------------------------------- */
/* Summarising                                                                */
/* -------------------------------------------------------------------------- */

const CATEGORY_KEYS = ['performance', 'accessibility', 'best-practices', 'seo'] as const

/** The metrics worth recording. Named by their Lighthouse audit id. */
const METRIC_AUDITS = [
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'first-contentful-paint',
  'total-blocking-time',
  'speed-index',
  'interactive',
  'total-byte-weight',
  'unused-javascript',
  'unused-css-rules',
] as const

interface RouteSummary {
  route: string
  url: string
  lighthouseVersion: string
  fetchTime: string
  scores: Record<string, number | null>
  metrics: Record<string, { value: number | null; display: string | null }>
}

function summarise(route: string, report: LighthouseReport): RouteSummary {
  const scores: Record<string, number | null> = {}
  for (const key of CATEGORY_KEYS) {
    scores[key] = report.categories?.[key]?.score ?? null
  }

  const metrics: RouteSummary['metrics'] = {}
  for (const id of METRIC_AUDITS) {
    const audit = report.audits?.[id]
    metrics[id] = {
      value: audit?.numericValue ?? null,
      display: audit?.displayValue ?? null,
    }
  }

  return {
    route,
    url: report.finalDisplayedUrl ?? report.requestedUrl ?? '',
    lighthouseVersion: report.lighthouseVersion ?? 'unknown',
    fetchTime: report.fetchTime ?? 'unknown',
    scores,
    metrics,
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                      */
/* -------------------------------------------------------------------------- */

mkdirSync(outDirectory, { recursive: true })

const summaries: RouteSummary[] = []
const failures: string[] = []

for (const route of routes) {
  const url = `${target.origin}${route}`
  const slug = route === '/' ? 'home' : route.replace(/^\/+/, '').replace(/\//g, '-')
  const reportPath = join(outDirectory, `lighthouse-${slug}.json`)

  process.stderr.write(`\nAuditing ${url}\n`)
  try {
    const report = await runLighthouse(url, reportPath)
    summaries.push(summarise(route, report))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`  FAILED: ${message}\n`)
    // Exit 2: the audit could not run. Deliberately NOT a zero score — a
    // fabricated number would be read later as a measurement.
    if (jsonMode) {
      process.stdout.write(
        `${redactedJson({ ok: false, unavailable: true, error: message, url })}\n`
      )
    }
    process.exit(2)
  }
}

const thresholds: Record<string, number | undefined> = {
  performance: threshold('performance'),
  accessibility: threshold('accessibility'),
  'best-practices': threshold('best-practices'),
  seo: threshold('seo'),
}

for (const summary of summaries) {
  for (const [category, minimum] of Object.entries(thresholds)) {
    if (minimum === undefined) continue
    const score = summary.scores[category]
    if (score === null || score === undefined) {
      failures.push(`${summary.route}: ${category} was not measured.`)
    } else if (score < minimum) {
      failures.push(
        `${summary.route}: ${category} scored ${score.toFixed(2)}, below the ` +
          `required ${minimum.toFixed(2)}.`
      )
    }
  }
}

const result = {
  ok: failures.length === 0,
  target: target.origin,
  routes: summaries,
  thresholdsApplied: Object.fromEntries(
    Object.entries(thresholds).filter(([, value]) => value !== undefined)
  ),
  failures,
}

const summaryPath = join(outDirectory, 'summary.json')
writeFileSync(summaryPath, `${redactedJson(result)}\n`, 'utf8')

if (jsonMode) {
  process.stdout.write(`${redactedJson(result)}\n`)
} else {
  process.stderr.write('\nLighthouse summary\n')
  for (const summary of summaries) {
    process.stderr.write(`\n  ${summary.route}  (${summary.url})\n`)
    for (const key of CATEGORY_KEYS) {
      const score = summary.scores[key]
      process.stderr.write(
        `    ${key.padEnd(16)} ${score === null || score === undefined ? 'n/a' : score.toFixed(2)}\n`
      )
    }
    for (const id of ['largest-contentful-paint', 'cumulative-layout-shift', 'total-byte-weight'] as const) {
      process.stderr.write(
        `    ${id.padEnd(16)} ${summary.metrics[id]?.display ?? 'n/a'}\n`
      )
    }
  }
  process.stderr.write(`\n  Full reports and summary.json written to ${outDirectory}\n\n`)
  for (const failure of failures) process.stderr.write(`  [FAIL] ${failure}\n`)
  process.stdout.write(
    failures.length === 0
      ? `OK: audited ${String(summaries.length)} route(s).\n`
      : `FAILED: ${String(failures.length)} threshold failure(s).\n`
  )
}

process.exit(failures.length === 0 ? 0 : 1)
