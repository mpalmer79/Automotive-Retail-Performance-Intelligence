#!/usr/bin/env tsx
/**
 * Bootstrap the ARPI Railway project.
 *
 * WHAT THIS DOES, AND WHAT RAILWAY DOES
 * -------------------------------------
 * Most of the convergence is not this tool's. `railway config apply` reads
 * `.railway/railway.ts` and converges the project onto it, and Railway's own
 * apply path is what makes that idempotent: it creates a service only when no
 * service of that name exists, and creates a database's volume only when that
 * database has none. Re-running it does not duplicate anything.
 *
 * This tool does the four things Railway's declarative path cannot express, plus
 * the reporting:
 *
 *   1. Find or create the PROJECT. A declaration cannot create the project it is
 *      a declaration of.
 *   2. Find or create the ENVIRONMENT, and refuse to touch production.
 *   3. Generate the PUBLIC DOMAIN. A Railway-generated domain's name is chosen
 *      by Railway and is not knowable in advance, so it cannot be declared.
 *      Generated BEFORE the first deployment, because the build reads
 *      RAILWAY_PUBLIC_DOMAIN to produce canonical URLs — generate it afterwards
 *      and the first build bakes in `http://localhost:3000`.
 *   4. Trigger and POLL the first deployment.
 *
 * IDEMPOTENCE
 * -----------
 * Every step reads before it writes, and every write is skipped when the desired
 * state already holds. Re-running converges rather than duplicating: no second
 * project, no second service, no second domain, no replaced database, no
 * regenerated password, and no deployment triggered when a good one already
 * exists. `--dry-run` proves this: on a converged project it reports zero
 * pending changes.
 *
 * SECURITY
 * --------
 * The token is read from RAILWAY_API_TOKEN, is never accepted as an argument, is
 * never printed, and is never written to disk by this tool. Every string this
 * tool emits passes through the redactor. It reads no variable values: the
 * database credentials it configures are references and generators the platform
 * resolves, so this process never holds one.
 *
 *   tsx scripts/railway/bootstrap_railway.ts --dry-run
 *   tsx scripts/railway/bootstrap_railway.ts
 *   tsx scripts/railway/bootstrap_railway.ts --json
 *
 * Exit codes
 *   0  converged (or, with --dry-run, the plan is valid)
 *   1  a step failed
 *   2  refused to start: bad specification, missing token, or a guard tripped
 */
import {
  TARGET_ENVIRONMENT_VARIABLE,
  evaluateIac,
  findResource,
  referenceKeys,
} from './lib/iac.ts'
import {
  hasToken,
  requireToken,
  resolveRailwayCli,
  type RailwayCli,
} from './lib/cli.ts'
import {
  collectNamedEntities,
  collectStringsUnderKeys,
  countMatches,
  entityNames,
  findByName,
} from './lib/discover.ts'
import { redactedJson } from './lib/redact.ts'
import {
  parseCommonArguments,
  rejectCredentialArguments,
  RunReport,
} from './lib/report.ts'
import { loadSpecification, validateSpecification } from './lib/spec.ts'

const argv = process.argv.slice(2)

/*
 * PRODUCTION TARGETING, ADDED BY `DASH.13`.
 *
 * `DASH.13` approved an intentional public production deployment, so this tool
 * has to be ABLE to target production — and must be much harder to point at it by
 * accident than at staging. Four things have to agree:
 *
 *   1. `--environment production`   named explicitly, never defaulted to;
 *   2. `--confirm-production`       a second, non-guessable act of intent;
 *   3. `productionRelease.approved` the repository's standing decision;
 *   4. the project identity check   already performed below against the spec.
 *
 * Anything less targets the declared default, which is staging. Omitting only
 * `--confirm-production` is treated as a REFUSAL rather than a downgrade to
 * staging: silently deploying somewhere other than where the operator said is
 * how the wrong environment gets clobbered.
 */
const environmentFlagIndex = argv.indexOf('--environment')
const requestedEnvironment =
  environmentFlagIndex === -1 ? undefined : argv[environmentFlagIndex + 1]
const confirmProduction = argv.includes('--confirm-production')

const args = parseCommonArguments(
  // The value-taking flag and its value are not "unknown arguments".
  argv.filter((arg, index) => {
    if (arg === '--environment' || arg === '--confirm-production') return false
    return argv[index - 1] !== '--environment'
  })
)

if (args.help) {
  process.stdout.write(
    `Bootstrap the ARPI Railway project.

Usage: tsx scripts/railway/bootstrap_railway.ts [--dry-run] [--json]
       tsx scripts/railway/bootstrap_railway.ts --environment production \\
         --confirm-production

  --dry-run   Make no remote mutation and no deployment. Prints the project,
              services, variable references and settings that would be applied,
              with every value redacted. Exits non-zero on an invalid
              specification.
  --json      Emit a machine-readable result on stdout. Never contains a
              password, a credential-bearing URL, or a token.

  --environment <name>
              Target environment. Defaults to the declared non-production
              environment in deployment/railway/project.config.json.
  --confirm-production
              Required, in addition to --environment production, to target the
              production environment. Both are required every time: production is
              never the default and is never inferred. Targeting production also
              requires project.productionRelease.approved in the configuration.
              Staging is never deleted or repurposed by a production release.

Authentication is read from the RAILWAY_API_TOKEN environment variable only. It
is never accepted as a command-line argument. An account- or workspace-scoped
token is required: creating a project, creating a service and generating a domain
are account-level operations that a project-scoped token cannot perform.
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
  process.stderr.write(
    `Unknown argument(s): ${args.unknown.join(', ')}. Run with --help.\n`
  )
  process.exit(2)
}

/* ========================================================================== */
/* 0. Offline validation, before anything is contacted                        */
/* ========================================================================== */

const spec = loadSpecification()
const specResult = validateSpecification(spec)

const report = new RunReport(
  'ARPI Railway bootstrap',
  args.json,
  args.dryRun
)

const targetProject = spec.project.project.name
const declaredEnvironment = spec.project.project.environment
const productionEnvironment = spec.project.project.productionEnvironment
const productionRelease = spec.project.project.productionRelease

/* --- Resolve the target environment, and gate production on real intent --- */

const wantsProduction =
  requestedEnvironment !== undefined &&
  requestedEnvironment.trim().toLowerCase() === productionEnvironment.toLowerCase()

if (requestedEnvironment !== undefined && requestedEnvironment.trim() === '') {
  process.stderr.write('Refusing to start: --environment was given no value.\n')
  process.exit(2)
}

if (wantsProduction) {
  if (productionRelease?.approved !== true) {
    process.stderr.write(
      `Refusing to target "${productionEnvironment}": the configuration does not approve a ` +
        'production release.\n\n' +
        'Set project.productionRelease.approved in deployment/railway/project.config.json,\n' +
        'which is a reviewable change to the repository rather than a flag on a command.\n'
    )
    process.exit(2)
  }
  if (!confirmProduction) {
    /*
     * REFUSE rather than fall back to staging. An operator who typed
     * `--environment production` and is missing the confirmation must not have
     * their command silently redirected at a different environment.
     */
    process.stderr.write(
      `Refusing to target "${productionEnvironment}" without --confirm-production.\n\n` +
        'This is the public deployment. Re-run with both flags when that is what you mean:\n' +
        `  tsx scripts/railway/bootstrap_railway.ts --environment ${productionEnvironment} ` +
        '--confirm-production\n\n' +
        'Nothing has been contacted and nothing has changed.\n'
    )
    process.exit(2)
  }
} else if (
  requestedEnvironment !== undefined &&
  requestedEnvironment.trim().toLowerCase() !== declaredEnvironment.toLowerCase()
) {
  // An environment that is neither the declared default nor production is a typo
  // far more often than it is a plan, and this tool creates what it cannot find.
  process.stderr.write(
    `Refusing to target "${requestedEnvironment.trim()}": it is neither the declared ` +
      `environment ("${declaredEnvironment}") nor the production environment ` +
      `("${productionEnvironment}").\n`
  )
  process.exit(2)
}

if (confirmProduction && !wantsProduction) {
  // --confirm-production on a staging run means the operator believes they are
  // deploying production. Stop and let them look.
  process.stderr.write(
    '--confirm-production was passed without --environment ' +
      `${productionEnvironment}. Refusing to proceed: this run would have targeted ` +
      `"${declaredEnvironment}".\n`
  )
  process.exit(2)
}

const targetEnvironment = wantsProduction ? productionEnvironment : declaredEnvironment
const portfolioName = spec.project.services.portfolio.name
const postgresName = spec.project.services.postgres.name
const jobName = spec.project.services.databaseSetup.name

report.header([
  `project        : ${targetProject}`,
  `environment    : ${targetEnvironment}`,
  `services       : ${portfolioName}, ${postgresName}, ${jobName}`,
  `repository     : ${spec.project.repository.slug} @ ${spec.project.repository.deploymentBranch}`,
  `token          : ${hasToken() ? 'present (never printed)' : 'MISSING'}`,
])

if (!specResult.ok) {
  for (const error of specResult.errors) report.failed('specification', error)
  // Exit 2, not 1: nothing was attempted.
  report.finish()
  process.exit(2)
}
report.ok('specification', 'valid')
for (const warning of specResult.warnings) report.warn('specification', warning)

/* --- The declaration must compile before we touch anything --------------- */

let iacReferenceCount = 0
try {
  const evaluation = await evaluateIac({ environmentName: targetEnvironment })
  const errors = evaluation.diagnostics.filter((d) => d.severity === 'error')
  if (!evaluation.ok || evaluation.graph === undefined || errors.length > 0) {
    for (const diagnostic of errors) {
      report.failed('iac-declaration', `${diagnostic.path}: ${diagnostic.message}`)
    }
    if (errors.length === 0) {
      report.failed('iac-declaration', 'the runner reported the declaration as not ok')
    }
    report.finish()
    process.exit(2)
  }
  iacReferenceCount = referenceKeys(findResource(evaluation.graph, jobName)).length
  report.ok(
    'iac-declaration',
    `compiles; ${String(evaluation.graph.resources.length)} resource(s), ` +
      `${String(iacReferenceCount)} reference variable(s)`
  )
} catch (error) {
  report.failed(
    'iac-declaration',
    error instanceof Error ? error.message : String(error)
  )
  report.finish()
  process.exit(2)
}

/* ========================================================================== */
/* 1. Authenticate                                                            */
/* ========================================================================== */

let token: string
try {
  token = requireToken()
} catch (error) {
  report.failed('authentication', error instanceof Error ? error.message : String(error))
  report.finish()
  process.exit(2)
}

let cli: RailwayCli
try {
  cli = await resolveRailwayCli(spec.tooling, {
    token,
    onWarning: (message) => report.warn('railway-cli', message),
  })
} catch (error) {
  report.failed('railway-cli', error instanceof Error ? error.message : String(error))
  report.finish()
  process.exit(2)
}
report.ok('railway-cli', `${cli.version} via ${cli.resolution}`)

try {
  // `whoami` is the cheapest proof the token is valid. Its output may name the
  // account's email address, so it is not echoed: the fact of success is what
  // matters here, and an account identifier in a public CI log is gratuitous.
  await cli.json<unknown>(['whoami'])
  report.ok('authentication', 'token accepted (identity not echoed)')
} catch (error) {
  report.failed(
    'authentication',
    'The Railway CLI rejected the token. Confirm RAILWAY_API_TOKEN is an account- or ' +
      'workspace-scoped token that has not expired. ' +
      (error instanceof Error ? error.message : String(error))
  )
  report.finish()
  process.exit(1)
}

/* ========================================================================== */
/* 2. Project: find, or create                                                */
/* ========================================================================== */

interface Resolved {
  projectId?: string
  environmentId?: string
  publicUrl?: string
  tcpProxyHost?: string
  tcpProxyPort?: string
  deploymentId?: string
  deploymentStatus?: string
}
const resolved: Resolved = {}

let projectId: string | undefined

try {
  const projects = collectNamedEntities(await cli.json<unknown>(['list']))
  const matches = countMatches(projects, targetProject)

  if (matches > 1) {
    report.failed(
      'project',
      `${String(matches)} projects are named "${targetProject}". Refusing to guess which ` +
        'one to configure. Rename or delete the duplicate in the Railway dashboard, then ' +
        're-run.'
    )
    report.finish()
    process.exit(1)
  }

  const existing = findByName(projects, targetProject)
  if (existing !== undefined) {
    projectId = existing.id
    report.unchanged('project', `"${existing.name}" already exists`, { projectId })
  } else if (args.dryRun) {
    report.skipped(
      'project',
      `would CREATE project "${targetProject}" (none of ` +
        `${projects.length === 0 ? '(no projects)' : entityNames(projects).join(', ')} matches)`
    )
  } else {
    const created = collectNamedEntities(
      await cli.json<unknown>(['init', '--name', targetProject])
    )
    projectId = findByName(created, targetProject)?.id
    if (projectId === undefined) {
      report.failed(
        'project',
        'railway init reported success but no project id could be read from its output.'
      )
      report.finish()
      process.exit(1)
    }
    report.created('project', `created "${targetProject}"`, { projectId })
  }
} catch (error) {
  report.failed('project', error instanceof Error ? error.message : String(error))
  report.finish()
  process.exit(1)
}

if (projectId !== undefined) resolved.projectId = projectId

/* ========================================================================== */
/* 3. Environment: find, or create — and never production                     */
/* ========================================================================== */

if (projectId === undefined) {
  // Dry run against an account with no project yet. Everything downstream needs
  // a project, so report what would happen and stop cleanly.
  report.skipped(
    'environment',
    `would ensure environment "${targetEnvironment}" after creating the project`
  )
  report.skipped('config-plan', 'no project to plan against yet')
  report.skipped('domain', 'no service to generate a domain for yet')
  report.skipped('deployment', 'nothing to deploy yet')
  report.setOutputs({
    dryRun: true,
    project: targetProject,
    projectExists: false,
    environment: targetEnvironment,
  })
  process.exit(report.finish())
}

try {
  // Link first: every subsequent command resolves the project and environment
  // from the link rather than repeating them, and `railway config plan` has no
  // project flag at all.
  await cli.run([
    'link',
    '--project',
    projectId,
    '--environment',
    targetEnvironment,
    '--json',
  ])
  report.ok('link', `linked ${targetProject} / ${targetEnvironment}`)
} catch {
  // Linking fails when the environment does not exist yet, which is not an error
  // — it is the signal to create it.
  const environments = collectNamedEntities(
    await cli.json<unknown>(['environment', 'list'])
  )
  const existing = findByName(environments, targetEnvironment)

  if (existing !== undefined) {
    report.failed(
      'environment',
      `environment "${targetEnvironment}" exists but could not be linked. This is usually a ` +
        'token scope problem: project and environment operations need an account- or ' +
        'workspace-scoped token.'
    )
    report.finish()
    process.exit(1)
  }

  if (args.dryRun) {
    report.skipped(
      'environment',
      `would CREATE environment "${targetEnvironment}" (existing: ` +
        `${entityNames(environments).join(', ') || 'none'})`
    )
  } else {
    // `--duplicate` is deliberately NOT used. Duplicating an environment copies
    // its services and would clone the database, producing a second Postgres
    // instance and a second volume that both cost money and neither of which
    // anybody asked for.
    await cli.json<unknown>(['environment', 'new', targetEnvironment])
    await cli.run([
      'link',
      '--project',
      projectId,
      '--environment',
      targetEnvironment,
      '--json',
    ])
    report.created('environment', `created and linked "${targetEnvironment}"`)
  }
}

/* --- Confirm what we are actually linked to, and guard production -------- */

try {
  const status = await cli.json<unknown>([
    'status',
    '--project',
    projectId,
    '--environment',
    targetEnvironment,
  ])
  const linkedEnvironments = collectStringsUnderKeys(status, [
    'environmentName',
    'environment',
  ])
  const looksLikeProduction = linkedEnvironments.some(
    (name) => name.toLowerCase() === productionEnvironment.toLowerCase()
  )
  /*
   * The guard now checks AGREEMENT rather than absence.
   *
   * Before `DASH.13` any sign of production here was fatal. Now that production is
   * a supported target, the question is whether what we are linked to is what the
   * operator asked for. Both mismatches are fatal, and the dangerous one is the
   * first: a run that did not ask for production finding itself pointed at it.
   */
  if (looksLikeProduction && !wantsProduction) {
    report.failed(
      'production-guard',
      `the linked environment resolves to "${productionEnvironment}", but this run did not ` +
        'ask for it. Refusing to proceed: re-run with --environment ' +
        `${productionEnvironment} --confirm-production if a production deployment is what ` +
        'you mean.'
    )
    report.finish()
    process.exit(2)
  }
  if (!looksLikeProduction && wantsProduction) {
    report.failed(
      'production-guard',
      `this run asked for "${productionEnvironment}" but the linked environment does not ` +
        'resolve to it. Refusing to proceed rather than deploying a production release into ' +
        'another environment.'
    )
    report.finish()
    process.exit(2)
  }
  const environmentIds = collectStringsUnderKeys(status, ['environmentId'])
  if (environmentIds[0] !== undefined) resolved.environmentId = environmentIds[0]
  report.ok(
    'production-guard',
    wantsProduction
      ? `linked environment is "${productionEnvironment}", as this run explicitly requested`
      : `linked environment is not "${productionEnvironment}"`
  )
} catch (error) {
  report.warn(
    'production-guard',
    'could not read railway status to confirm the linked environment: ' +
      (error instanceof Error ? error.message : String(error)) +
      '. The declaration itself also refuses to evaluate against production, so this is a ' +
      'lost confirmation rather than a lost control.'
  )
}

/* ========================================================================== */
/* 4. Plan, always. Apply, unless this is a dry run.                          */
/* ========================================================================== */

/**
 * `--detailed-exit-code` makes `plan` exit 2 when changes are pending and 0 when
 * none are. That distinction IS the idempotency check: a converged project plans
 * to zero changes, so a second bootstrap run reports "unchanged" rather than
 * re-applying.
 */
const planOutcome = await cli.attempt(
  ['config', 'plan', '--json', '--yes', '--detailed-exit-code'],
  {
    allowExitCodes: [2],
    timeoutMs: 600_000,
    // Hand the declaration the target environment name explicitly, so its
    // production guard fires on this path too rather than depending on Railway
    // populating the context. Belt and braces on the one operation that mutates a
    // live project.
    env: { [TARGET_ENVIRONMENT_VARIABLE]: targetEnvironment },
  }
)

if (!planOutcome.ok) {
  // The one failure worth naming specifically, because its remedy is not
  // guessable: Railway's IaC refuses to manage a service whose `configFile`
  // names a railway.json or railway.toml.
  const managedByRepoConfig = /already managed by railway\.(json|toml)/i.test(
    `${planOutcome.stdout}\n${planOutcome.stderr}`
  )
  report.failed(
    'config-plan',
    managedByRepoConfig
      ? 'A service is already managed by a repository config file, so Railway\'s IaC will ' +
        'not converge it. Clear the "Config as code" path on that service in the Railway ' +
        'dashboard (this repository keeps build and deploy configuration in railway.json ' +
        'and has the IaC read it, precisely so both are not live owners), then re-run. ' +
        `Detail: ${planOutcome.stderr}`
      : `railway config plan failed (exit ${String(planOutcome.exitCode)}): ${planOutcome.stderr}`
  )
  report.finish()
  process.exit(1)
}

const changesPending = planOutcome.exitCode === 2

if (changesPending) {
  report.ok('config-plan', 'changes are pending')
} else {
  report.unchanged('config-plan', 'no changes pending — the project already matches')
}

if (args.dryRun) {
  // The plan document is the whole point of a dry run. It goes through the
  // redactor like everything else, and `--show-values` is deliberately NOT
  // passed, so variable values stay redacted by Railway as well.
  report.skipped(
    'config-apply',
    changesPending
      ? 'DRY RUN: changes are pending and were NOT applied'
      : 'DRY RUN: nothing to apply'
  )
  if (!args.json) {
    process.stderr.write('\n--- railway config plan (values redacted) ---\n')
    process.stderr.write(`${planOutcome.stdout.trim()}\n`)
    process.stderr.write('--- end plan ---\n')
  }
  report.skipped('domain', 'DRY RUN: no domain generated')
  report.skipped('deployment', 'DRY RUN: no deployment triggered')
  report.setOutputs({
    dryRun: true,
    project: targetProject,
    projectId,
    environment: targetEnvironment,
    changesPending,
    referenceVariablesDeclared: iacReferenceCount,
  })
  process.exit(report.finish())
}

if (changesPending) {
  try {
    // `--yes` for non-interactive. `--confirm-destructive` is deliberately NOT
    // passed: a plan that wants to DELETE something in this project is a plan
    // nobody intended, and the correct response is to stop and have a person
    // read it, not to let a workflow delete a database at 3am.
    await cli.run(['config', 'apply', '--json', '--yes'], {
      timeoutMs: 900_000,
      env: { [TARGET_ENVIRONMENT_VARIABLE]: targetEnvironment },
    })
    report.created('config-apply', 'applied')
  } catch (error) {
    report.failed(
      'config-apply',
      'railway config apply failed. If the plan contained a destructive change, that is ' +
        'deliberate: this tool does not pass --confirm-destructive, so a deletion has to be ' +
        'reviewed by a person. ' +
        (error instanceof Error ? error.message : String(error))
    )
    report.finish()
    process.exit(1)
  }
} else {
  report.unchanged('config-apply', 'skipped — nothing to apply')
}

/* ========================================================================== */
/* 5. Services exist                                                          */
/* ========================================================================== */

const services = collectNamedEntities(await cli.json<unknown>(['service', 'list']))
for (const expected of [portfolioName, postgresName, jobName]) {
  const found = findByName(services, expected)
  if (found === undefined) {
    report.failed(
      'service',
      `"${expected}" does not exist after apply. Found: ${entityNames(services).join(', ') || 'none'}.`
    )
  } else {
    report.ok('service', `${expected} present`)
  }
}
if (report.failures.length > 0) {
  report.finish()
  process.exit(1)
}

/* ========================================================================== */
/* 6. Public domain — generated before the first deployment                    */
/* ========================================================================== */

const targetPort = spec.project.services.portfolio.publicNetworking.targetPort ?? 3000

try {
  const domainsDocument = await cli.json<unknown>([
    'domain',
    'list',
    '--service',
    portfolioName,
  ])
  const existingDomains = collectStringsUnderKeys(domainsDocument, ['domain', 'host'])

  if (existingDomains.length > 0) {
    const domain = existingDomains[0] as string
    resolved.publicUrl = `https://${domain.replace(/^https?:\/\//, '')}`
    report.unchanged('domain', `already has ${String(existingDomains.length)} domain(s)`, {
      domain,
    })
  } else {
    // `railway domain` with no argument generates a Railway domain. Only reached
    // when the service has none, so re-running never creates a second one.
    const created = await cli.json<unknown>([
      'domain',
      '--service',
      portfolioName,
      '--port',
      String(targetPort),
    ])
    const domain = collectStringsUnderKeys(created, ['domain', 'host'])[0]
    if (domain === undefined) {
      report.failed(
        'domain',
        'railway domain reported success but no domain could be read from its output.'
      )
    } else {
      resolved.publicUrl = `https://${domain.replace(/^https?:\/\//, '')}`
      report.created('domain', `generated ${domain} -> :${String(targetPort)}`)
    }
  }
} catch (error) {
  report.failed('domain', error instanceof Error ? error.message : String(error))
}

/* ========================================================================== */
/* 7. Database: volume, TCP proxy                                             */
/* ========================================================================== */

try {
  const volumes = await cli.json<unknown>(['volume', 'list'])
  const mountPaths = collectStringsUnderKeys(volumes, ['mountPath'])
  const expectedMount = spec.project.services.postgres.volume?.mountPath ?? ''
  if (mountPaths.includes(expectedMount)) {
    report.ok('postgres-volume', `persistent volume at ${expectedMount}`)
  } else if (mountPaths.length > 0) {
    report.warn(
      'postgres-volume',
      `volume(s) exist at ${mountPaths.join(', ')} but not at the expected ${expectedMount}`
    )
  } else {
    report.failed(
      'postgres-volume',
      'the database has no persistent volume, so its data would be lost on every redeploy.'
    )
  }
} catch (error) {
  report.warn('postgres-volume', error instanceof Error ? error.message : String(error))
}

try {
  const proxies = await cli.json<unknown>([
    'tcp-proxy',
    'list',
    '--service',
    postgresName,
  ])
  const hosts = collectStringsUnderKeys(proxies, ['domain', 'proxyDomain', 'host'])
  const ports = collectStringsUnderKeys(proxies, ['proxyPort', 'port', 'publicPort'])
  const host = hosts[0]
  const port = ports[0]
  if (host !== undefined) {
    resolved.tcpProxyHost = host
    if (port !== undefined) resolved.tcpProxyPort = port
    report.ok(
      'postgres-tcp-proxy',
      `available (host and port reported as outputs, not hardcoded anywhere)`
    )
  } else {
    report.warn(
      'postgres-tcp-proxy',
      'no TCP proxy found. Railway\'s Postgres template declares one on 5432; if it is ' +
        'genuinely absent, the eventual Microsoft Fabric connection has no route in, because ' +
        'Fabric connects from Microsoft\'s network and cannot reach the private network.'
    )
  }
} catch (error) {
  report.warn('postgres-tcp-proxy', error instanceof Error ? error.message : String(error))
}

/* ========================================================================== */
/* 8. Deployment: trigger only if needed, then poll                           */
/* ========================================================================== */

interface DeploymentView {
  id?: string
  status?: string
}

function readDeployments(document: unknown): DeploymentView[] {
  const entities = collectNamedEntities(document)
  const statuses = collectStringsUnderKeys(document, ['status'])
  const ids = collectStringsUnderKeys(document, ['id', 'deploymentId'])
  // Prefer well-formed entities; fall back to parallel id/status lists.
  if (entities.length > 0 && statuses.length > 0) {
    return entities.map((entity, index) => ({
      id: entity.id,
      ...(statuses[index] !== undefined ? { status: statuses[index] } : {}),
    }))
  }
  return ids.map((id, index) => ({
    id,
    ...(statuses[index] !== undefined ? { status: statuses[index] } : {}),
  }))
}

const SUCCESS_STATUSES = new Set(['SUCCESS', 'SLEEPING'])
const FAILURE_STATUSES = new Set(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])

async function currentDeployment(): Promise<DeploymentView | undefined> {
  const document = await cli.json<unknown>([
    'deployment',
    'list',
    '--service',
    portfolioName,
  ])
  return readDeployments(document)[0]
}

try {
  let deployment = await currentDeployment()
  const alreadyGood =
    deployment?.status !== undefined && SUCCESS_STATUSES.has(deployment.status.toUpperCase())

  if (alreadyGood && !changesPending) {
    report.unchanged(
      'deployment',
      `latest deployment is ${String(deployment?.status)}; not triggering another`
    )
  } else {
    // `redeploy` rather than `up`: the service's source is GitHub, and `railway
    // up` would upload the local directory and SWITCH the service to a
    // locally-uploaded source — silently taking routine deployments away from
    // Railway's GitHub integration, which is the one deployment owner this
    // design has.
    await cli.run(['redeploy', '--service', portfolioName, '--yes'], {
      timeoutMs: 300_000,
    })
    report.created('deployment', 'triggered')
  }

  // Poll. The CLI's own automation notes are explicit that a triggered
  // deployment is not waited on, and that polling `deployment list` is the way
  // to observe it.
  const deadline = Date.now() + 15 * 60_000
  let finalStatus = deployment?.status ?? 'UNKNOWN'
  while (Date.now() < deadline) {
    deployment = await currentDeployment()
    finalStatus = (deployment?.status ?? 'UNKNOWN').toUpperCase()
    if (SUCCESS_STATUSES.has(finalStatus) || FAILURE_STATUSES.has(finalStatus)) break
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }

  if (deployment?.id !== undefined) resolved.deploymentId = deployment.id
  resolved.deploymentStatus = finalStatus

  if (SUCCESS_STATUSES.has(finalStatus)) {
    report.ok('deployment-status', finalStatus)
  } else if (FAILURE_STATUSES.has(finalStatus)) {
    report.failed(
      'deployment-status',
      `${finalStatus}. Read the build log with: railway logs --service ${portfolioName}`
    )
  } else {
    report.failed(
      'deployment-status',
      `still ${finalStatus} after 15 minutes. Read the build log with: railway logs ` +
        `--service ${portfolioName}`
    )
  }
} catch (error) {
  report.failed('deployment', error instanceof Error ? error.message : String(error))
}

/* ========================================================================== */
/* 9. Health check the deployed site                                          */
/* ========================================================================== */

const healthPath = spec.railwayConfig.deploy.healthcheckPath

/**
 * How long to keep retrying the public health check.
 *
 * Defaults to `railway.json`'s own `healthcheckTimeout`, so the tool waits
 * exactly as long as Railway does rather than picking a second number that could
 * disagree with it.
 *
 * `ARPI_HEALTH_CHECK_BUDGET_SECONDS` overrides it. That is an operational knob
 * rather than a test hook — a workflow with a tight job timeout has a legitimate
 * reason to wait less — and the test suite uses it so that asserting "the health
 * check failed against a hostname that does not exist" does not take five minutes.
 */
const healthBudgetSeconds = (() => {
  const override = Number(process.env['ARPI_HEALTH_CHECK_BUDGET_SECONDS'] ?? '')
  if (Number.isFinite(override) && override > 0) return override
  return spec.railwayConfig.deploy.healthcheckTimeout
})()

if (resolved.publicUrl === undefined) {
  report.failed('health-check', 'no public URL to check')
} else {
  const url = `${resolved.publicUrl}${healthPath}`
  let healthy = false
  const deadline = Date.now() + healthBudgetSeconds * 1_000
  let lastDetail = 'not attempted'

  while (Date.now() < deadline && !healthy) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
      lastDetail = `HTTP ${String(response.status)}`
      if (response.ok) healthy = true
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error)
    }
    // Back off between attempts, but never past the deadline.
    if (!healthy && Date.now() + 10_000 < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    } else if (!healthy) {
      break
    }
  }

  if (healthy) report.ok('health-check', `${healthPath} -> ${lastDetail}`)
  else report.failed('health-check', `${url} never became healthy (${lastDetail})`)
}

/* ========================================================================== */
/* 10. Report                                                                 */
/* ========================================================================== */

report.setOutputs({
  project: targetProject,
  projectId: resolved.projectId ?? '(unknown)',
  environment: targetEnvironment,
  environmentId: resolved.environmentId ?? '(unknown)',
  portfolioService: portfolioName,
  postgresService: postgresName,
  databaseSetupService: jobName,
  publicUrl: resolved.publicUrl ?? '(none)',
  healthcheckPath: healthPath,
  // Reported so the Fabric handoff never has to be assembled by hand, and never
  // hardcoded anywhere. Neither value is a credential.
  tcpProxyHost: resolved.tcpProxyHost ?? '(unknown)',
  tcpProxyPort: resolved.tcpProxyPort ?? '(unknown)',
  deploymentId: resolved.deploymentId ?? '(unknown)',
  deploymentStatus: resolved.deploymentStatus ?? '(unknown)',
  referenceVariablesDeclared: iacReferenceCount,
  productionCreated: false,
})

const exitCode = report.finish()

if (!args.json && exitCode === 0) {
  process.stderr.write(
    'The website is deployed. The database exists but is NOT provisioned: run the\n' +
      `${jobName} service once to build the schema and load the profile. See\n` +
      'deployment/railway/README.md section 6.\n\n'
  )
}

process.exit(exitCode)
