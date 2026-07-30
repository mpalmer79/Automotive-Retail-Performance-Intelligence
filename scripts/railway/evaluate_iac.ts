#!/usr/bin/env tsx
/**
 * Evaluate `.railway/railway.ts` offline and check it against the specification.
 *
 * Needs no Railway token and contacts nothing. This is the strongest check that
 * runs on every push, including on a fork with no secrets: it compiles the
 * declaration and asserts the resulting resource graph is the one the
 * specification describes — right service names, references where references are
 * required, generators where passwords are required, and no literal credential
 * anywhere.
 *
 *   tsx scripts/railway/evaluate_iac.ts
 *   tsx scripts/railway/evaluate_iac.ts --json
 *
 * Exit codes
 *   0  the declaration compiles and matches the specification
 *   1  a mismatch, or an error diagnostic from the runner
 *   2  the declaration could not be evaluated at all
 */
import {
  evaluateIac,
  findResource,
  generatedKeys,
  literalSecretViolations,
  referenceKeys,
  resolveRunnerHint,
  variablesOf,
} from './lib/iac.ts'
import { redactedJson } from './lib/redact.ts'
import {
  parseCommonArguments,
  rejectCredentialArguments,
  RunReport,
} from './lib/report.ts'
import { loadSpecification, validateSpecification } from './lib/spec.ts'

const argv = process.argv.slice(2)
const args = parseCommonArguments(argv)

if (args.help) {
  process.stdout.write(
    'Evaluate the ARPI Railway IaC declaration offline and check it against the\n' +
      'source-controlled specification.\n\n' +
      'Usage: tsx scripts/railway/evaluate_iac.ts [--json]\n\n' +
      'Requires no credential and contacts no service.\n'
  )
  process.exit(0)
}

try {
  rejectCredentialArguments(argv)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}

const spec = loadSpecification()
const specResult = validateSpecification(spec)

const report = new RunReport('ARPI Railway declaration check', args.json, false)
report.header([
  `specification  : ${specResult.ok ? 'valid' : `${String(specResult.errors.length)} error(s)`}`,
  'railway        : not contacted (offline check)',
])

if (!specResult.ok) {
  for (const error of specResult.errors) report.failed('specification', error)
  process.exit(report.finish())
}
for (const warning of specResult.warnings) report.warn('specification', warning)

let evaluation
try {
  evaluation = await evaluateIac({ environmentName: spec.project.project.environment })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (args.json) {
    process.stdout.write(
      `${redactedJson({ ok: false, unevaluable: true, error: message })}\n`
    )
  } else {
    process.stderr.write(
      `\nThe IaC declaration could not be evaluated.\n  ${message}\n\n  ${resolveRunnerHint(spec.tooling)}\n`
    )
  }
  process.exit(2)
}

for (const diagnostic of evaluation.diagnostics) {
  if (diagnostic.severity === 'error') {
    report.failed('iac-diagnostic', `${diagnostic.path}: ${diagnostic.message}`)
  } else {
    report.warn('iac-diagnostic', `${diagnostic.path}: ${diagnostic.message}`)
  }
}

const graph = evaluation.graph
if (!evaluation.ok || graph === undefined) {
  report.failed('iac-evaluate', 'The runner reported the declaration as not ok.')
  process.exit(report.finish())
}

report.ok('iac-evaluate', `graph version ${String(graph.version)}, SDK ${String(evaluation.sdkVersion)}`)

/* --- Project and environment --------------------------------------------- */

if (graph.project.name === spec.project.project.name) {
  report.ok('project-name', graph.project.name)
} else {
  report.failed(
    'project-name',
    `declares "${graph.project.name}", specification says "${spec.project.project.name}"`
  )
}

const environments = graph.environments.map((environment) => environment.name)
if (
  environments.length === 1 &&
  environments[0] === spec.project.project.environment
) {
  report.ok('environments', environments.join(', '))
} else {
  report.failed(
    'environments',
    `declares [${environments.join(', ')}]; exactly one environment ` +
      `("${spec.project.project.environment}") must be declared, because declaring ` +
      'production would create it'
  )
}
if (environments.some((name) => name.toLowerCase() === spec.project.project.productionEnvironment.toLowerCase())) {
  report.failed(
    'production-guard',
    `the declaration names the production environment "${spec.project.project.productionEnvironment}"`
  )
} else {
  report.ok('production-guard', 'production is not declared')
}

/* --- Services ------------------------------------------------------------- */

const portfolioSpec = spec.project.services.portfolio
const postgresSpec = spec.project.services.postgres
const jobSpec = spec.project.services.databaseSetup

const portfolio = findResource(graph, portfolioSpec.name)
const postgres = findResource(graph, postgresSpec.name)
const job = findResource(graph, jobSpec.name)

for (const [label, resource] of [
  [portfolioSpec.name, portfolio],
  [postgresSpec.name, postgres],
  [jobSpec.name, job],
] as const) {
  if (resource === undefined) report.failed('service-present', `"${label}" is not declared`)
  else report.ok('service-present', `${label} (${resource.type}/${String(resource.kind)})`)
}

if (portfolio === undefined || postgres === undefined || job === undefined) {
  process.exit(report.finish())
}

/* --- The website's source and build -------------------------------------- */

if (portfolio.source?.repo === spec.project.repository.slug) {
  report.ok('portfolio-repo', String(portfolio.source.repo))
} else {
  report.failed(
    'portfolio-repo',
    `declares "${String(portfolio.source?.repo)}", specification says ` +
      `"${spec.project.repository.slug}"`
  )
}
if (portfolio.source?.branch === spec.project.repository.deploymentBranch) {
  report.ok('portfolio-branch', String(portfolio.source.branch))
} else {
  report.failed(
    'portfolio-branch',
    `declares "${String(portfolio.source?.branch)}", specification says ` +
      `"${spec.project.repository.deploymentBranch}"`
  )
}
if (portfolio.source?.checkSuites === spec.project.repository.waitForCiChecks) {
  report.ok(
    'wait-for-ci',
    portfolio.source.checkSuites === true
      ? 'enabled: Railway waits for GitHub checks before deploying'
      : 'disabled by specification'
  )
} else {
  report.failed(
    'wait-for-ci',
    `declares checkSuites=${String(portfolio.source?.checkSuites)}, specification says ` +
      `${String(spec.project.repository.waitForCiChecks)}`
  )
}

// The build context assertion, which is the one that would silently break the
// site's content-integrity gate if it regressed.
const rootDirectory = portfolio.source?.rootDirectory
if (rootDirectory === undefined || rootDirectory === null || rootDirectory === '') {
  report.ok('build-context', 'repository root preserved (no service root directory)')
} else {
  report.failed(
    'build-context',
    `rootDirectory is "${String(rootDirectory)}". The website's build reads evidence from ` +
      'the repository root and cannot complete in an isolated context.'
  )
}

if (portfolio.build?.dockerfilePath === spec.railwayConfig.build.dockerfilePath) {
  report.ok('dockerfile', String(portfolio.build.dockerfilePath))
} else {
  report.failed(
    'dockerfile',
    `declares "${String(portfolio.build?.dockerfilePath)}", railway.json says ` +
      `"${spec.railwayConfig.build.dockerfilePath}"`
  )
}
if (portfolio.build?.builder === spec.railwayConfig.build.builder) {
  report.ok('builder', String(portfolio.build.builder))
} else {
  report.failed(
    'builder',
    `declares "${String(portfolio.build?.builder)}", railway.json says ` +
      `"${spec.railwayConfig.build.builder}"`
  )
}

const declaredWatch = [...(portfolio.build?.watchPatterns ?? [])].sort()
const expectedWatch = [...spec.railwayConfig.build.watchPatterns].sort()
if (JSON.stringify(declaredWatch) === JSON.stringify(expectedWatch)) {
  report.ok('watch-patterns', `${String(declaredWatch.length)} pattern(s), matching railway.json`)
} else {
  report.failed(
    'watch-patterns',
    'the declaration and railway.json disagree. Missing from the declaration: ' +
      `[${expectedWatch.filter((p) => !declaredWatch.includes(p)).join(', ')}]; extra: ` +
      `[${declaredWatch.filter((p) => !expectedWatch.includes(p)).join(', ')}]`
  )
}

if (portfolio.deploy?.healthcheckPath === spec.railwayConfig.deploy.healthcheckPath) {
  report.ok('healthcheck', String(portfolio.deploy.healthcheckPath))
} else {
  report.failed(
    'healthcheck',
    `declares "${String(portfolio.deploy?.healthcheckPath)}", railway.json says ` +
      `"${spec.railwayConfig.deploy.healthcheckPath}"`
  )
}

// `configFile` must stay unset. Railway's IaC refuses to manage a service whose
// configFile names a railway.json/toml, so setting it would converge the service
// once and never again.
if (portfolio.configFile === undefined) {
  report.ok('single-config-owner', 'configFile unset, so the IaC keeps managing this service')
} else {
  report.failed(
    'single-config-owner',
    `configFile is "${portfolio.configFile}". Railway's IaC treats a service whose ` +
      'configFile names a railway.json or railway.toml as managed by the repo config and ' +
      'refuses to converge it again, which destroys idempotency.'
  )
}

/* --- The website holds no credential ------------------------------------- */

const portfolioVarSpec = spec.variables.services[portfolioSpec.name]
const portfolioKeys = Object.keys(variablesOf(portfolio)).sort()
const forbidden = portfolioVarSpec?.forbiddenVariables ?? []
const present = portfolioKeys.filter((key) => forbidden.includes(key))
if (present.length === 0) {
  report.ok(
    'portfolio-no-db',
    `${String(portfolioKeys.length)} variable(s), none forbidden: ${portfolioKeys.join(', ')}`
  )
} else {
  report.failed(
    'portfolio-no-db',
    `the website declares forbidden variable(s): ${present.join(', ')}`
  )
}

const portfolioReferences = referenceKeys(portfolio)
if (portfolioReferences.length === 0) {
  report.ok('portfolio-no-refs', 'the website references no other service')
} else {
  report.failed(
    'portfolio-no-refs',
    `the website references another service: ${portfolioReferences.join(', ')}. It has no ` +
      'runtime data source and must depend on nothing.'
  )
}

const portfolioLiteralViolations = literalSecretViolations(portfolio)
if (portfolioLiteralViolations.length === 0) {
  report.ok('portfolio-no-literal-secret', 'no literal credential declared')
} else {
  for (const violation of portfolioLiteralViolations) {
    report.failed('portfolio-no-literal-secret', violation)
  }
}

/* --- Postgres ------------------------------------------------------------- */

if (postgres.engine === 'postgres') report.ok('postgres-engine', 'postgres')
else report.failed('postgres-engine', `declares engine "${String(postgres.engine)}"`)

const imagePrefix = postgresSpec.expectedImagePrefix ?? ''
if (postgres.image !== undefined && postgres.image.startsWith(imagePrefix)) {
  report.ok('postgres-image', postgres.image)
} else {
  report.failed(
    'postgres-image',
    `image "${String(postgres.image)}" does not start with the expected official prefix ` +
      `"${imagePrefix}". SSL termination is a property of that image.`
  )
}
if (postgres.defaultMountPath === postgresSpec.volume?.mountPath) {
  report.ok('postgres-volume-path', String(postgres.defaultMountPath))
} else {
  report.failed(
    'postgres-volume-path',
    `default mount path "${String(postgres.defaultMountPath)}" does not match the ` +
      `specification's "${String(postgresSpec.volume?.mountPath)}"`
  )
}

/* --- The provisioning job ------------------------------------------------- */

const jobVarSpec = spec.variables.services[jobSpec.name]
const declaredReferences = referenceKeys(job)
const expectedReferences = Object.keys(jobVarSpec?.referenceVariables ?? {}).sort()
if (JSON.stringify(declaredReferences) === JSON.stringify(expectedReferences)) {
  report.ok(
    'job-references',
    `${String(declaredReferences.length)} reference variable(s): ${declaredReferences.join(', ')}`
  )
} else {
  report.failed(
    'job-references',
    `references [${declaredReferences.join(', ')}], specification expects ` +
      `[${expectedReferences.join(', ')}]`
  )
}

// Each reference must point at the database service, by address.
for (const [key, value] of Object.entries(variablesOf(job))) {
  if (value.type !== 'reference') continue
  if (value.resource !== `database.${postgresSpec.name}`) {
    report.failed(
      'job-reference-target',
      `${key} references "${value.resource}", not "database.${postgresSpec.name}"`
    )
  }
}

const declaredGenerated = generatedKeys(job)
const expectedGenerated = Object.keys(jobVarSpec?.generatedVariables ?? {}).sort()
if (JSON.stringify(declaredGenerated) === JSON.stringify(expectedGenerated)) {
  report.ok(
    'job-generated-secrets',
    `${String(declaredGenerated.length)} generated by Railway: ${declaredGenerated.join(', ')}`
  )
} else {
  report.failed(
    'job-generated-secrets',
    `generates [${declaredGenerated.join(', ')}], specification expects ` +
      `[${expectedGenerated.join(', ')}]`
  )
}

const jobLiteralViolations = literalSecretViolations(job)
if (jobLiteralViolations.length === 0) {
  report.ok('job-no-literal-secret', 'no literal credential declared')
} else {
  for (const violation of jobLiteralViolations) {
    report.failed('job-no-literal-secret', violation)
  }
}

if (job.deploy?.restartPolicyType === 'NEVER') {
  report.ok('job-restart-policy', 'NEVER — a completed run is not restarted')
} else {
  report.failed(
    'job-restart-policy',
    `restart policy is "${String(job.deploy?.restartPolicyType)}", not NEVER. Any other ` +
      'policy restarts a finished job and turns it into an endless loop.'
  )
}
if (job.deploy?.healthcheckPath === undefined) {
  report.ok('job-no-healthcheck', 'no health check — it serves no traffic')
} else {
  report.failed(
    'job-no-healthcheck',
    `declares healthcheckPath "${String(job.deploy.healthcheckPath)}"; a job is not a backend`
  )
}

/* --- Dependency edges ----------------------------------------------------- */

const edgeSummary = graph.edges
  .filter((edge) => edge.type === 'variable')
  .map((edge) => `${edge.from} -> ${edge.to} (${String(edge.key)})`)
const websiteEdges = graph.edges.filter(
  (edge) => edge.from === `service.${portfolioSpec.name}`
)
if (websiteEdges.length === 0) {
  report.ok('dependency-edges', `${String(edgeSummary.length)} edge(s), none from the website`)
} else {
  report.failed(
    'dependency-edges',
    `the website has ${String(websiteEdges.length)} dependency edge(s); it must have none`
  )
}

report.setOutputs({
  project: graph.project.name,
  environment: environments.join(','),
  services: graph.resources
    .filter((resource) => resource.type === 'service' || resource.type === 'database')
    .map((resource) => resource.name)
    .join(','),
  referenceVariables: declaredReferences.length,
  generatedSecrets: declaredGenerated.length,
  websiteUserVariables: portfolioKeys.length,
})

process.exit(report.finish())
