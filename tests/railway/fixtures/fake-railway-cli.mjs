#!/usr/bin/env node
/**
 * A fake Railway CLI, for testing the bootstrap tool without Railway.
 *
 * WHY A FAKE BINARY RATHER THAN A MODULE MOCK
 * ------------------------------------------
 * The properties worth testing are about what the tool INVOKES: that a dry run
 * issues no mutating command, that a converged project is not re-created, that
 * the token never reaches a command line. A module mock would let the tool's real
 * process-spawning code — the code that decides exactly that — go untested, and
 * that code is where the security property lives.
 *
 * So this is a real executable that the tool resolves through `RAILWAY_CLI_BIN`,
 * exactly as it would resolve a real CLI. It appends every invocation to
 * `FAKE_RAILWAY_LOG` as one JSON object per line, then answers from a canned
 * scenario named by `FAKE_RAILWAY_SCENARIO`.
 *
 * It also records the ENVIRONMENT it was given, so a test can assert the token
 * arrived there and not in `argv`.
 */
import { appendFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const scenario = process.env.FAKE_RAILWAY_SCENARIO ?? 'converged'
const logPath = process.env.FAKE_RAILWAY_LOG

if (logPath) {
  appendFileSync(
    logPath,
    `${JSON.stringify({
      argv,
      // Recorded so a test can assert the token was passed in the environment.
      tokenInEnv: Boolean(process.env.RAILWAY_API_TOKEN),
      targetEnvironment: process.env.ARPI_RAILWAY_TARGET_ENVIRONMENT ?? null,
    })}\n`
  )
}

const emit = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exit(0)
}

/**
 * The subcommand path: the leading tokens before the first flag.
 *
 * NOT `argv.filter(a => !a.startsWith('-'))`. That also keeps flag VALUES, so
 * `link --project proj-123 --environment staging` becomes
 * `link proj-123 staging` and matches nothing — which is how this fake silently
 * failed every `link` before it was fixed.
 */
const command = []
for (const argument of argv) {
  if (argument.startsWith('-')) break
  command.push(argument)
}
const joined = command.join(' ')

/* --- Version probe -------------------------------------------------------- */
if (argv.includes('--version')) {
  process.stdout.write('railway 5.30.1\n')
  process.exit(0)
}

/* --- Fixtures ------------------------------------------------------------- */

const PROJECT = { id: 'proj-0000-1111-2222', name: 'ARPI' }
const ENVIRONMENT = { id: 'env-0000-1111-2222', name: 'staging' }
const SERVICES = [
  { id: 'svc-portfolio', name: 'arpi-portfolio' },
  { id: 'svc-postgres', name: 'Postgres' },
  { id: 'svc-job', name: 'arpi-database-setup' },
]

const scenarios = {
  /** Everything exists and matches. A second bootstrap run must change nothing. */
  converged: {
    projects: [PROJECT],
    environments: [ENVIRONMENT],
    services: SERVICES,
    domains: [{ id: 'dom-1', domain: 'arpi-portfolio-staging.up.railway.app' }],
    planExit: 0,
    deployments: [{ id: 'dep-1', name: 'deployment', status: 'SUCCESS' }],
  },
  /** No project at all: the first-ever run. */
  empty: {
    projects: [],
    environments: [],
    services: [],
    domains: [],
    planExit: 2,
    deployments: [],
  },
  /** Project exists but the declaration has moved on. */
  'changes-pending': {
    projects: [PROJECT],
    environments: [ENVIRONMENT],
    services: SERVICES,
    domains: [{ id: 'dom-1', domain: 'arpi-portfolio-staging.up.railway.app' }],
    planExit: 2,
    deployments: [{ id: 'dep-1', name: 'deployment', status: 'SUCCESS' }],
  },
  /** Two projects share the name. The tool must refuse rather than guess. */
  duplicate: {
    projects: [PROJECT, { id: 'proj-other', name: 'ARPI' }],
    environments: [ENVIRONMENT],
    services: SERVICES,
    domains: [],
    planExit: 0,
    deployments: [],
  },
  /** Services exist but the website has no domain yet. */
  'no-domain': {
    projects: [PROJECT],
    environments: [ENVIRONMENT],
    services: SERVICES,
    domains: [],
    planExit: 0,
    deployments: [{ id: 'dep-1', name: 'deployment', status: 'SUCCESS' }],
  },
}

const state = scenarios[scenario] ?? scenarios.converged

/* --- Command routing ------------------------------------------------------ */

if (joined === 'whoami') emit({ id: 'user-1', name: 'test-user' })

if (joined === 'list') emit({ projects: state.projects })

if (joined === 'init') emit({ id: PROJECT.id, name: 'ARPI' })

if (joined === 'link') {
  // Linking fails when the environment does not exist, which is how the tool
  // learns it has to create one.
  if (state.environments.length === 0) {
    process.stderr.write('environment not found\n')
    process.exit(1)
  }
  emit({ project: PROJECT, environment: ENVIRONMENT })
}

if (joined === 'environment list') emit({ environments: state.environments })
if (joined === 'environment new') emit({ id: ENVIRONMENT.id, name: 'staging' })

if (joined === 'status') {
  emit({
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    environmentId: ENVIRONMENT.id,
    environmentName: ENVIRONMENT.name,
    services: SERVICES.map((service) => ({
      ...service,
      repo: 'mpalmer79/Automotive-Retail-Performance-Intelligence',
      branch: 'main',
    })),
  })
}

if (joined === 'service list') emit({ services: state.services })

if (joined === 'config plan') {
  process.stdout.write(
    `${JSON.stringify({ ok: true, command: 'plan', changeSet: { changes: [] } })}\n`
  )
  process.exit(state.planExit)
}

if (joined === 'config apply') emit({ ok: true, command: 'apply' })

if (joined === 'domain list') emit({ domains: state.domains })

// `railway domain` with no subcommand generates a domain.
if (command.length === 1 && command[0] === 'domain') {
  emit({ domain: 'arpi-portfolio-staging.up.railway.app' })
}

if (joined === 'volume list') {
  emit({ volumes: [{ id: 'vol-1', name: 'postgres-volume', mountPath: '/var/lib/postgresql/data' }] })
}

if (joined === 'tcp-proxy list') {
  emit({
    proxies: [
      { id: 'tcp-1', domain: 'monorail.proxy.rlwy.net', proxyPort: 34567, applicationPort: 5432 },
    ],
  })
}

if (joined === 'deployment list') emit({ deployments: state.deployments })

if (joined === 'redeploy') emit({ id: 'dep-2', status: 'BUILDING' })

if (joined === 'variable list') {
  const service = argv[argv.indexOf('--service') + 1]
  if (service === 'arpi-portfolio') {
    emit({
      variables: {
        NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED: 'false',
        RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '30',
      },
    })
  }
  if (service === 'arpi-database-setup') {
    emit({
      variables: {
        DATABASE_URL: '${{Postgres.DATABASE_URL}}',
        PGHOST: '${{Postgres.RAILWAY_PRIVATE_DOMAIN}}',
        PGPORT: '${{Postgres.PGPORT}}',
        PGDATABASE: '${{Postgres.PGDATABASE}}',
        PGUSER: '${{Postgres.PGUSER}}',
        PGPASSWORD: '${{Postgres.PGPASSWORD}}',
        ARPI_TCP_PROXY_DOMAIN: '${{Postgres.RAILWAY_TCP_PROXY_DOMAIN}}',
        ARPI_TCP_PROXY_PORT: '${{Postgres.RAILWAY_TCP_PROXY_PORT}}',
        ARPI_PIPELINE_PASSWORD: 'placeholder-not-read-by-the-verifier',
        ARPI_FABRIC_PASSWORD: 'placeholder-not-read-by-the-verifier',
        ARPI_PROFILE: 'development',
      },
    })
  }
  emit({ variables: {} })
}

process.stderr.write(`fake-railway-cli: unhandled command "${joined}"\n`)
process.exit(64)
