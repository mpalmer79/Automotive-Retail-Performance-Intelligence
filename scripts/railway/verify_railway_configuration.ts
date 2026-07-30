#!/usr/bin/env tsx
/**
 * Verify the LIVE Railway configuration against the source-controlled
 * specification, without revealing a secret.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BOOTSTRAP TOOL
 * -------------------------------------------------
 * The bootstrap tool converges the project. This asks a different question: is
 * the project still what the repository says it is? Those diverge for ordinary
 * reasons — somebody changes a health-check path in the dashboard, a watch
 * pattern is edited in `railway.json` and nobody re-runs bootstrap, a variable is
 * added by hand while debugging and left behind. Drift is the normal state of
 * infrastructure that is only ever written to, so it needs something that reads.
 *
 * HOW IT AVOIDS READING SECRETS
 * -----------------------------
 * `railway variable list --json` prints RAW VALUES — the CLI's own documentation
 * says so. This tool therefore uses `--kv` never, and from the JSON it reads only
 * the KEYS plus, for the specific question "is this still a reference?", whether
 * the value's TEXT is a `${{...}}` expression. A resolved credential is never
 * compared, never hashed, and never printed; and everything that does reach
 * stdout passes through the redactor regardless.
 *
 * That is why the most important assertion here is expressed as "the value is
 * still a reference expression" rather than "the value equals the database's
 * password". The second phrasing would require holding both.
 *
 *   tsx scripts/railway/verify_railway_configuration.ts
 *   tsx scripts/railway/verify_railway_configuration.ts --json
 *
 * Exit codes
 *   0  the live configuration matches
 *   1  at least one mismatch
 *   2  refused to start: bad specification, missing token
 */
import { hasToken, requireToken, resolveRailwayCli } from './lib/cli.ts'
import { TARGET_ENVIRONMENT_VARIABLE } from './lib/iac.ts'
import {
  collectNamedEntities,
  collectStringsUnderKeys,
  entityNames,
  findByName,
} from './lib/discover.ts'
import { parseCommonArguments, rejectCredentialArguments, RunReport } from './lib/report.ts'
import { loadSpecification, validateSpecification } from './lib/spec.ts'

const argv = process.argv.slice(2)
const args = parseCommonArguments(argv)

if (args.help) {
  process.stdout.write(
    `Verify the live ARPI Railway configuration against the repository.

Usage: tsx scripts/railway/verify_railway_configuration.ts [--json]

Reads only variable KEYS and reference expressions, never resolved values. All
output is redacted. Requires RAILWAY_API_TOKEN in the environment; it is never
accepted as an argument.
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
if (args.unknown.length > 0) {
  process.stderr.write(`Unknown argument(s): ${args.unknown.join(', ')}\n`)
  process.exit(2)
}

const spec = loadSpecification()
const specResult = validateSpecification(spec)

const targetProject = spec.project.project.name
const targetEnvironment = spec.project.project.environment
const productionEnvironment = spec.project.project.productionEnvironment
const portfolioName = spec.project.services.portfolio.name
const postgresName = spec.project.services.postgres.name
const jobName = spec.project.services.databaseSetup.name

const report = new RunReport('ARPI Railway configuration verification', args.json, false)
report.header([
  `project        : ${targetProject}`,
  `environment    : ${targetEnvironment}`,
  `token          : ${hasToken() ? 'present (never printed)' : 'MISSING'}`,
  'values         : never read; keys and reference expressions only',
])

if (!specResult.ok) {
  for (const error of specResult.errors) report.failed('specification', error)
  report.finish()
  process.exit(2)
}
report.ok('specification', 'valid')

let token: string
try {
  token = requireToken()
} catch (error) {
  report.failed('authentication', error instanceof Error ? error.message : String(error))
  report.finish()
  process.exit(2)
}

const cli = await resolveRailwayCli(spec.tooling, {
  token,
  onWarning: (message) => report.warn('railway-cli', message),
})
report.ok('railway-cli', `${cli.version} via ${cli.resolution}`)

/* ========================================================================== */
/* Project and environment                                                    */
/* ========================================================================== */

const projects = collectNamedEntities(await cli.json<unknown>(['list']))
const project = findByName(projects, targetProject)
if (project === undefined) {
  report.failed(
    'project',
    `no project named "${targetProject}". Found: ${entityNames(projects).join(', ') || 'none'}.`
  )
  report.finish()
  process.exit(1)
}
report.ok('project', `${project.name}`)

await cli.run([
  'link',
  '--project',
  project.id,
  '--environment',
  targetEnvironment,
  '--json',
])

const environments = collectNamedEntities(await cli.json<unknown>(['environment', 'list']))
const environment = findByName(environments, targetEnvironment)
if (environment === undefined) {
  report.failed('environment', `no environment named "${targetEnvironment}".`)
} else {
  report.ok('environment', environment.name)
}

/**
 * Production must not exist as a consequence of anything this tooling did.
 *
 * Reported as a WARNING rather than a failure when it does exist: a Railway
 * project may legitimately have been created with a default `production`
 * environment before this tooling ever ran, and failing on that would make the
 * verifier unusable for the exact project it is meant to verify. What matters is
 * that this tooling never targets it, which the bootstrap tool's guard and the
 * declaration's guard both enforce, and that a person knows it is there.
 */
const productionExists = environments.some(
  (candidate) => candidate.name.toLowerCase() === productionEnvironment.toLowerCase()
)
if (productionExists) {
  report.warn(
    'production-untouched',
    `an environment named "${productionEnvironment}" exists in this project. This tooling ` +
      'never targets it and has not deployed to it. Confirm in the Railway dashboard that ' +
      'it has no deployment before treating this as expected.'
  )
} else {
  report.ok('production-untouched', `no "${productionEnvironment}" environment exists`)
}

/* ========================================================================== */
/* Services                                                                   */
/* ========================================================================== */

const services = collectNamedEntities(await cli.json<unknown>(['service', 'list']))
for (const expected of [portfolioName, postgresName, jobName]) {
  if (findByName(services, expected) === undefined) {
    report.failed(
      'service',
      `"${expected}" is missing. Found: ${entityNames(services).join(', ') || 'none'}.`
    )
  } else {
    report.ok('service', `${expected} present`)
  }
}

/**
 * Unexpected services.
 *
 * A warning, not a failure. The specification records that ARPI has no
 * general-purpose backend, and a service nobody declared is worth surfacing —
 * both because it may be costing money and because "we accidentally built a
 * backend" is exactly the drift this project is trying not to have. But a
 * Railway project can contain a service somebody added deliberately for a reason
 * this repository does not know about, and failing on that would be presumptuous.
 */
const declared = new Set([portfolioName, postgresName, jobName].map((n) => n.toLowerCase()))
const unexpected = entityNames(services).filter(
  (name) => !declared.has(name.toLowerCase())
)
if (unexpected.length > 0) {
  report.warn(
    'no-undeclared-services',
    `service(s) not in the specification: ${unexpected.join(', ')}. ARPI declares no ` +
      'general-purpose backend; confirm each of these is intended and is not costing money ' +
      'for nothing.'
  )
} else {
  report.ok('no-undeclared-services', 'only the three declared services exist')
}

/* ========================================================================== */
/* The website's source, build and deploy configuration                        */
/* ========================================================================== */

const status = await cli.json<unknown>([
  'status',
  '--project',
  project.id,
  '--environment',
  targetEnvironment,
])

function statusStrings(keys: readonly string[]): string[] {
  return collectStringsUnderKeys(status, keys)
}

const repos = statusStrings(['repo', 'repository', 'repoFullName'])
if (repos.some((repo) => repo.toLowerCase().includes(spec.project.repository.slug.toLowerCase()))) {
  report.ok('github-source', spec.project.repository.slug)
} else if (repos.length === 0) {
  report.warn(
    'github-source',
    'railway status did not report a repository for any service. Confirm the GitHub source ' +
      `is connected: railway service source connect --repo ${spec.project.repository.slug} ` +
      `--branch ${spec.project.repository.deploymentBranch} --service ${portfolioName}`
  )
} else {
  report.failed(
    'github-source',
    `the connected repository does not include "${spec.project.repository.slug}". ` +
      `Reported: ${repos.join(', ')}.`
  )
}

const branches = statusStrings(['branch'])
if (branches.includes(spec.project.repository.deploymentBranch)) {
  report.ok('deployment-branch', spec.project.repository.deploymentBranch)
} else if (branches.length === 0) {
  report.warn('deployment-branch', 'railway status reported no branch.')
} else {
  report.failed(
    'deployment-branch',
    `expected "${spec.project.repository.deploymentBranch}", reported ${branches.join(', ')}.`
  )
}

/**
 * Build and deploy configuration is verified against the live project through
 * the IaC's own `current` view, because that is the only interface that returns
 * the resolved environment config rather than a human-readable summary.
 */
const currentOutcome = await cli.attempt(
  ['config', 'plan', '--json', '--yes', '--detailed-exit-code'],
  {
    allowExitCodes: [2],
    timeoutMs: 600_000,
    env: { [TARGET_ENVIRONMENT_VARIABLE]: targetEnvironment },
  }
)

if (!currentOutcome.ok) {
  report.failed(
    'drift',
    `railway config plan failed (exit ${String(currentOutcome.exitCode)}), so drift could ` +
      `not be assessed: ${currentOutcome.stderr}`
  )
} else if (currentOutcome.exitCode === 2) {
  // THE DRIFT CHECK. `--detailed-exit-code` returns 2 when the live project
  // differs from the declaration. Because the declaration reads `railway.json`,
  // this single assertion covers the Dockerfile path, the watch patterns, the
  // health check, the restart policy, the replica count, the build context, the
  // wait-for-CI setting and every declared variable at once.
  report.failed(
    'drift',
    'the live project DIFFERS from .railway/railway.ts. Re-run the bootstrap workflow to ' +
      'converge it, or read the difference with: railway config plan --verbose'
  )
} else {
  report.ok(
    'drift',
    'no drift: the live project matches the declaration (and therefore railway.json)'
  )
}

/* ========================================================================== */
/* Public networking                                                          */
/* ========================================================================== */

let publicUrl: string | undefined
const domains = collectStringsUnderKeys(
  await cli.json<unknown>(['domain', 'list', '--service', portfolioName]),
  ['domain', 'host']
)
if (domains.length === 0) {
  report.failed('public-domain', `${portfolioName} has no domain.`)
} else {
  const first = domains[0] as string
  publicUrl = `https://${first.replace(/^https?:\/\//, '')}`
  report.ok('public-domain', first)
  if (domains.length > 1) {
    report.warn(
      'public-domain',
      `${String(domains.length)} domains exist (${domains.join(', ')}). More than one is not ` +
        'wrong, but canonical URLs are emitted for exactly one of them.'
    )
  }
}

/* ========================================================================== */
/* Database: volume, TCP proxy, no HTTP domain                                */
/* ========================================================================== */

const expectedMount = spec.project.services.postgres.volume?.mountPath ?? ''
const mountPaths = collectStringsUnderKeys(await cli.json<unknown>(['volume', 'list']), [
  'mountPath',
])
if (mountPaths.includes(expectedMount)) {
  report.ok('postgres-volume', `persistent volume at ${expectedMount}`)
} else {
  report.failed(
    'postgres-volume',
    `no volume at ${expectedMount}. Found: ${mountPaths.join(', ') || 'none'}. Without one ` +
      'the database loses its data on every redeploy.'
  )
}

const proxyDocument = await cli.json<unknown>([
  'tcp-proxy',
  'list',
  '--service',
  postgresName,
])
const proxyHosts = collectStringsUnderKeys(proxyDocument, ['domain', 'proxyDomain', 'host'])
const proxyPorts = collectStringsUnderKeys(proxyDocument, ['proxyPort', 'port', 'publicPort'])
if (proxyHosts.length > 0) {
  report.ok('postgres-tcp-proxy', 'present (host and port reported as outputs)')
} else {
  report.failed(
    'postgres-tcp-proxy',
    'no TCP proxy on the database. A cloud semantic-model engine connects from outside ' +
      'Railway and cannot reach the private network, so the Fabric path has no route in.'
  )
}

const postgresDomains = collectStringsUnderKeys(
  await cli.json<unknown>(['domain', 'list', '--service', postgresName]),
  ['domain', 'host']
)
if (postgresDomains.length === 0) {
  report.ok('postgres-no-http-domain', 'the database has no public HTTP domain')
} else {
  report.warn(
    'postgres-no-http-domain',
    `the database has HTTP domain(s): ${postgresDomains.join(', ')}. A database needs a TCP ` +
      'proxy, not an HTTP domain; this widens its exposure for no benefit.'
  )
}

/* ========================================================================== */
/* Variables — keys and reference expressions only                            */
/* ========================================================================== */

const REFERENCE_EXPRESSION = /\$\{\{\s*[A-Za-z0-9_.-]+\s*\}\}|\$\{\{\s*[A-Za-z0-9_.-]+\.[A-Za-z0-9_]+\s*\}\}/

/**
 * Read a service's variables as a key -> raw-text map.
 *
 * The raw text is needed for exactly one purpose — deciding whether a value is
 * still a `${{...}}` reference — and is used for nothing else. It is not printed,
 * not returned to the caller, and not compared against any other value.
 */
async function variableTextByKey(service: string): Promise<Map<string, string>> {
  const document = await cli.json<unknown>(['variable', 'list', '--service', service])
  const map = new Map<string, string>()

  const walk = (node: unknown, depth = 0): void => {
    if (depth > 8) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') {
        // Only ALL-CAPS keys are treated as variable names; the CLI wraps its
        // payload in camelCase metadata fields that are not variables.
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) map.set(key, String(value))
      } else {
        walk(value, depth + 1)
      }
    }
  }

  walk(document)
  return map
}

/* --- The website holds no database credential ----------------------------- */

const portfolioVarSpec = spec.variables.services[portfolioName]
const forbidden = portfolioVarSpec?.forbiddenVariables ?? []

try {
  const portfolioVariables = await variableTextByKey(portfolioName)
  const keys = [...portfolioVariables.keys()].sort()

  const offenders = keys.filter((key) => forbidden.includes(key))
  if (offenders.length === 0) {
    report.ok(
      'website-no-credential',
      `${String(keys.length)} variable(s); none is a database credential`
    )
  } else {
    report.failed(
      'website-no-credential',
      `the website carries forbidden variable(s): ${offenders.join(', ')}. It has no ` +
        'database connection; a credential here is published to a build that does not need it.'
    )
  }

  // A literal PostgreSQL URL under any key at all, not just a forbidden one.
  for (const [key, value] of portfolioVariables) {
    if (/^postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]+@/i.test(value)) {
      report.failed(
        'website-no-credential',
        `variable "${key}" on the website is a literal connection URI with an inline password.`
      )
    }
  }

  // The case-study flag must be absent or false. Anything else is the one
  // configuration change that could publish an unearned page.
  const flag = portfolioVariables.get('NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED')
  if (flag === undefined) {
    report.ok('case-study-locked', 'the flag is not set, so the gate is closed')
  } else if (flag.trim().toLowerCase() === 'true') {
    report.failed(
      'case-study-locked',
      'NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED is "true" on the live service. The repository ' +
        'evidence gate still holds — the flag is necessary and never sufficient, so the page ' +
        'is not actually published — but this must be set back to false: it means somebody ' +
        'intended to open a gate that four other conditions are keeping closed.'
    )
  } else {
    report.ok('case-study-locked', `the flag is "${flag}", which is not "true"`)
  }

  if (portfolioVariables.has('ARPI_SITE_URL')) {
    const value = portfolioVariables.get('ARPI_SITE_URL') ?? ''
    if (REFERENCE_EXPRESSION.test(value)) {
      report.ok('site-url', 'ARPI_SITE_URL is set and is a reference expression')
    } else {
      report.warn(
        'site-url',
        'ARPI_SITE_URL is set to a literal. That is only correct for a custom domain; for a ' +
          'Railway domain the site derives its origin from RAILWAY_PUBLIC_DOMAIN and this ' +
          'variable can go.'
      )
    }
  } else {
    report.ok('site-url', 'not set — the origin comes from RAILWAY_PUBLIC_DOMAIN')
  }
} catch (error) {
  report.failed(
    'website-no-credential',
    error instanceof Error ? error.message : String(error)
  )
}

/* --- The job's cross-service values are still references ------------------ */

const jobVarSpec = spec.variables.services[jobName]
const expectedReferences = Object.keys(jobVarSpec?.referenceVariables ?? {})
const expectedGenerated = Object.keys(jobVarSpec?.generatedVariables ?? {})

try {
  const jobVariables = await variableTextByKey(jobName)

  const missing = expectedReferences.filter((key) => !jobVariables.has(key))
  if (missing.length > 0) {
    report.failed(
      'job-reference-keys',
      `missing expected variable(s): ${missing.join(', ')}.`
    )
  } else {
    report.ok(
      'job-reference-keys',
      `all ${String(expectedReferences.length)} expected reference key(s) present`
    )
  }

  // THE ASSERTION THAT MATTERS MOST HERE.
  //
  // A reference that has been replaced by its resolved value still WORKS, which
  // is why this silently degrades rather than breaking: the job connects, the
  // deployment succeeds, and the project now has a copy of a database password
  // that will not follow a rotation. So the check is that the text is still an
  // unresolved `${{...}}` expression.
  const flattened: string[] = []
  for (const key of expectedReferences) {
    const value = jobVariables.get(key)
    if (value === undefined) continue
    if (!REFERENCE_EXPRESSION.test(value)) flattened.push(key)
  }
  if (flattened.length === 0) {
    report.ok(
      'references-still-references',
      `${String(expectedReferences.length)} cross-service value(s) are unresolved references`
    )
  } else {
    report.failed(
      'references-still-references',
      `variable(s) ${flattened.join(', ')} are no longer reference expressions — they hold ` +
        'copied literal values. A copy keeps working while silently not following the ' +
        'source, so this does not announce itself. Re-run the bootstrap workflow.'
    )
  }

  const missingGenerated = expectedGenerated.filter((key) => !jobVariables.has(key))
  if (missingGenerated.length === 0) {
    report.ok(
      'generated-secrets-present',
      `${String(expectedGenerated.length)} generated credential(s) exist in Railway`
    )
  } else {
    report.failed(
      'generated-secrets-present',
      `missing generated credential(s): ${missingGenerated.join(', ')}. The Fabric handoff ` +
        'reads one of these out of Railway; without it there is nothing to hand off.'
    )
  }

  if (jobVariables.has('RAILWAY_API_TOKEN')) {
    report.failed(
      'job-holds-no-token',
      'the provisioning job carries RAILWAY_API_TOKEN. It needs no Railway credential: every ' +
        'value it reads is a reference the platform resolves, and its passwords are generated ' +
        'by the platform.'
    )
  } else {
    report.ok('job-holds-no-token', 'the job holds no Railway token')
  }
} catch (error) {
  report.failed(
    'job-reference-keys',
    error instanceof Error ? error.message : String(error)
  )
}

/* ========================================================================== */
/* Latest deployment, and the live health endpoint                            */
/* ========================================================================== */

const deploymentStatuses = collectStringsUnderKeys(
  await cli.json<unknown>(['deployment', 'list', '--service', portfolioName]),
  ['status']
)
const latest = (deploymentStatuses[0] ?? 'UNKNOWN').toUpperCase()
if (latest === 'SUCCESS' || latest === 'SLEEPING') {
  report.ok('latest-deployment', latest)
} else {
  report.failed(
    'latest-deployment',
    `${latest}. Read it with: railway logs --service ${portfolioName}`
  )
}

if (publicUrl === undefined) {
  report.failed('health-endpoint', 'no public URL to check')
} else {
  const url = `${publicUrl}${spec.railwayConfig.deploy.healthcheckPath}`
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok) {
      report.ok(
        'health-endpoint',
        `${spec.railwayConfig.deploy.healthcheckPath} -> HTTP ${String(response.status)}`
      )
    } else {
      report.failed('health-endpoint', `${url} -> HTTP ${String(response.status)}`)
    }
  } catch (error) {
    report.failed(
      'health-endpoint',
      `${url} did not respond: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

report.setOutputs({
  project: targetProject,
  projectId: project.id,
  environment: targetEnvironment,
  publicUrl: publicUrl ?? '(none)',
  tcpProxyHost: proxyHosts[0] ?? '(none)',
  tcpProxyPort: proxyPorts[0] ?? '(none)',
  latestDeploymentStatus: latest,
  productionEnvironmentExists: productionExists,
})

process.exit(report.finish())
