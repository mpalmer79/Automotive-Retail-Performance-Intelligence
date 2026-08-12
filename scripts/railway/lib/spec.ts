/**
 * Loading and validating the source-controlled deployment specification.
 *
 * The specification under `deployment/railway/` is the only place a service
 * name, an environment name, a health-check path or a required variable key is
 * written down. Everything else — the IaC definition, the bootstrap tool, the
 * verifier, the workflow, the tests — reads it. That is what makes "the
 * deployment matches the repository" a checkable statement rather than a hope.
 *
 * Validation is deliberately strict and runs before any Railway call, because
 * every class of error it catches is one that would otherwise be discovered
 * halfway through mutating a live project: a service the IaC references but the
 * spec never declares, a forbidden variable that is also declared as required,
 * or a production environment name that matches the target.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `scripts/railway/lib` → repository root. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..')

export const PROJECT_SPEC_PATH = 'deployment/railway/project.config.json'
export const VARIABLES_SPEC_PATH = 'deployment/railway/variables.config.json'
export const TOOLING_SPEC_PATH = 'deployment/railway/tooling.json'
export const RAILWAY_CONFIG_PATH = 'railway.json'
export const IAC_PATH = '.railway/railway.ts'

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export interface PublicNetworkingSpec {
  required: boolean
  generateRailwayDomain: boolean
  targetPort?: number
}

export interface ServiceSpec {
  name: string
  kind: 'github' | 'database'
  role?: string
  buildContext?: string
  rootDirectory?: string | null
  railwayConfigFile?: string
  dockerfilePath?: string
  healthcheckPath?: string | null
  healthcheckTimeout?: number
  restartPolicyType?: 'ON_FAILURE' | 'ALWAYS' | 'NEVER'
  restartPolicyMaxRetries?: number
  numReplicas?: number
  publicNetworking: PublicNetworkingSpec
  requiresDatabase?: boolean
  requiresVolume?: boolean
  connectsOverPrivateNetwork?: boolean
  buildArguments?: string[]
  engine?: string
  expectedImagePrefix?: string
  volume?: { required: boolean; mountPath: string }
  ssl?: { required: boolean; providedBy: string }
  tcpProxy?: { required: boolean; applicationPort: number }
}

export interface ProjectSpec {
  specVersion: number
  project: {
    name: string
    environment: string
    productionEnvironment: string
    createProductionEnvironment: boolean
    /**
     * The repository's standing decision about a public production deployment.
     *
     * Optional in the type so a spec written before `DASH.13` still parses, and
     * absent is read as NOT approved — the fail-closed direction.
     */
    productionRelease?: {
      approved: boolean
      approvedBy?: string
      note?: string
      requiredFlags?: string[]
      deploymentRef?: string
      indexable?: boolean
      buildMustSupplyEnvironmentArguments?: boolean
      buildArgumentNote?: string
    }
  }
  repository: {
    slug: string
    deploymentBranch: string
    waitForCiChecks: boolean
  }
  services: {
    portfolio: ServiceSpec
    postgres: ServiceSpec
    databaseSetup: ServiceSpec
  }
  expectedRailwayProvidedVariables: string[]
  expectedPostgresProvidedVariables: string[]
  serviceDependencies: { from: string; to: string; via: string; reason: string }[]
  deliberatelyAbsent: Record<string, string>
}

export interface VariablesSpec {
  specVersion: number
  conventions: Record<string, string>
  services: Record<
    string,
    {
      userDefinedVariables?: Record<string, unknown>
      railwayProvidedVariablesRead?: string[]
      optionalVariables?: Record<string, Record<string, unknown>>
      referenceVariables?: Record<
        string,
        { expression: string; secret?: boolean; copied?: boolean }
      >
      generatedVariables?: Record<
        string,
        { generator: string; rotateOnEveryDeploy?: boolean; secret?: boolean }
      >
      literalVariables?: Record<string, { value: string }>
      forbiddenVariables?: string[]
      managedByRailway?: boolean
    }
  >
  sharedVariables: Record<string, unknown>
  githubActionsSecrets: Record<string, { required: boolean }>
  githubActionsSecretsDeliberatelyAbsent: string[]
}

export interface ToolingSpec {
  specVersion: number
  railwayCli: { package: string; version: string; verifiedCommands: string[] }
  railwaySdk: { package: string; version: string; graphVersion: number }
  node: { version: string }
}

export interface RailwayRepoConfig {
  build: {
    builder: string
    dockerfilePath: string
    watchPatterns: string[]
  }
  deploy: {
    healthcheckPath: string
    healthcheckTimeout: number
    restartPolicyType: string
    restartPolicyMaxRetries: number
    numReplicas: number
    sleepApplication: boolean
  }
}

export interface LoadedSpecification {
  project: ProjectSpec
  variables: VariablesSpec
  tooling: ToolingSpec
  railwayConfig: RailwayRepoConfig
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

export function readRepoJson<T>(relativePath: string): T {
  const absolute = join(REPO_ROOT, relativePath)
  let raw: string
  try {
    raw = readFileSync(absolute, 'utf8')
  } catch (error) {
    throw new Error(
      `Cannot read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(
      `${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function loadSpecification(): LoadedSpecification {
  return {
    project: readRepoJson<ProjectSpec>(PROJECT_SPEC_PATH),
    variables: readRepoJson<VariablesSpec>(VARIABLES_SPEC_PATH),
    tooling: readRepoJson<ToolingSpec>(TOOLING_SPEC_PATH),
    railwayConfig: readRepoJson<RailwayRepoConfig>(RAILWAY_CONFIG_PATH),
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Strings that must never appear as a value anywhere in the specification.
 *
 * The specification is committed to a public repository, so a value that looks
 * like a credential in it is a defect regardless of whether it is real. This is
 * a narrow, high-signal check on top of `scripts/check_secrets.py`, not a
 * replacement for it: it fails on a value that looks like a resolved secret in
 * the one family of files whose whole purpose is to hold no secrets.
 */
const FORBIDDEN_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'connection URI with an inline password',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:@/]+:[^\s:@/]+@/i,
  },
  { name: 'a Railway or GitHub token', pattern: /\b(?:ghp_[A-Za-z0-9]{36}|gho_|ghs_)/ },
  { name: 'a bare UUID that could be a project token', pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { name: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (path: string, text: string) => void
): void {
  if (typeof value === 'string') {
    visit(path, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkStrings(item, `${path}[${String(index)}]`, visit)
    })
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(nested, path === '' ? key : `${path}.${key}`, visit)
    }
  }
}

/**
 * Validate the whole specification.
 *
 * Collects every problem rather than throwing on the first, so one run tells the
 * operator everything that is wrong instead of making them fix and re-run.
 */
export function validateSpecification(spec: LoadedSpecification): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const fail = (message: string) => errors.push(message)
  const warn = (message: string) => warnings.push(message)

  /* --- Versions --------------------------------------------------------- */

  for (const [label, version] of [
    [PROJECT_SPEC_PATH, spec.project.specVersion],
    [VARIABLES_SPEC_PATH, spec.variables.specVersion],
    [TOOLING_SPEC_PATH, spec.tooling.specVersion],
  ] as const) {
    if (version !== 1) fail(`${label} declares unsupported specVersion ${String(version)}.`)
  }

  /* --- Project and environment ------------------------------------------ */

  const { project } = spec.project
  if (!project.name.trim()) fail('project.name is empty.')
  if (!project.environment.trim()) fail('project.environment is empty.')

  /*
   * THE SINGLE MOST IMPORTANT ASSERTION IN THIS FUNCTION, AND WHAT `DASH.13`
   * CHANGED ABOUT IT.
   *
   * Before `DASH.13` production was forbidden outright. It is now APPROVED — but
   * approval moved production from "never" to "only on purpose", and this
   * assertion is what keeps the difference real. The DECLARED DEFAULT may still
   * never be production: if editing this JSON file were enough to point the
   * tooling at production, then a copy-paste, a merge resolution or a
   * search-and-replace of "staging" would be enough to deploy it, which is
   * exactly the accident the guard exists for.
   *
   * Production is therefore reachable only as an explicit RUNTIME target, through
   * `--environment production --confirm-production` in `bootstrap_railway.ts`,
   * which additionally requires `productionRelease.approved` here. Three
   * independent things must agree, two of them typed by a person at the moment of
   * the deployment.
   */
  if (
    project.environment.toLowerCase() === project.productionEnvironment.toLowerCase()
  ) {
    fail(
      `project.environment ("${project.environment}") is the production environment. ` +
        'The declared default must remain a non-production environment even now that a ' +
        'production release is approved: production is selected per invocation with ' +
        '--environment production --confirm-production, never by editing this file.'
    )
  }

  const release = project.productionRelease
  if (project.createProductionEnvironment && release?.approved !== true) {
    /*
     * Fail CLOSED on the combination that would matter: a spec that authorises
     * creating production without the repository having approved a production
     * release. An absent `productionRelease` block reads as not approved.
     */
    fail(
      'project.createProductionEnvironment is true but project.productionRelease.approved ' +
        'is not true. Creating a production environment requires the repository to have ' +
        'approved a production release first.'
    )
  }
  if (release !== undefined) {
    if (typeof release.approved !== 'boolean') {
      fail('project.productionRelease.approved must be a boolean.')
    }
    if (release.approved && !release.approvedBy?.trim()) {
      // An approval with nobody and no increment attached is not an approval.
      fail(
        'project.productionRelease.approved is true but approvedBy is empty. An approval ' +
          'must name the increment that made it.'
      )
    }
    if (release.approved && release.buildMustSupplyEnvironmentArguments !== true) {
      /*
       * The constraint `DASH.13` measured: a production deployment whose build did
       * not carry production build arguments ships a robots.txt and a set of page
       * metadata that disagree. Declaring production approved without declaring
       * that constraint would approve the failure mode along with the release.
       */
      fail(
        'project.productionRelease.approved is true but buildMustSupplyEnvironmentArguments ' +
          'is not. A production deployment must be a fresh build carrying production build ' +
          'arguments; a promoted image ships mismatched indexing and canonical metadata.'
      )
    }
  }

  /* --- Repository ------------------------------------------------------- */

  if (!/^[\w.-]+\/[\w.-]+$/.test(spec.project.repository.slug)) {
    fail(
      `repository.slug "${spec.project.repository.slug}" is not in owner/repo form.`
    )
  }
  if (!spec.project.repository.deploymentBranch.trim()) {
    fail('repository.deploymentBranch is empty.')
  }
  if (!spec.project.repository.waitForCiChecks) {
    warn(
      'repository.waitForCiChecks is false, so Railway will deploy without waiting for ' +
        'the GitHub checks that prove the project manifest is current.'
    )
  }

  /* --- Services --------------------------------------------------------- */

  const services = Object.values(spec.project.services)
  const names = services.map((service) => service.name)
  if (new Set(names).size !== names.length) {
    fail(`Service names are not unique: ${names.join(', ')}.`)
  }
  for (const service of services) {
    if (!service.name.trim()) fail('A service has an empty name.')
  }

  const portfolio = spec.project.services.portfolio
  const postgres = spec.project.services.postgres
  const job = spec.project.services.databaseSetup

  /* --- The website ------------------------------------------------------ */

  if (portfolio.rootDirectory !== null) {
    fail(
      `services.portfolio.rootDirectory must be null. Setting it to ` +
        `"${String(portfolio.rootDirectory)}" would isolate the build context to that ` +
        'directory, and the website\'s build reads evidence files from the repository ' +
        'root — it cannot complete in an isolated context.'
    )
  }
  if (portfolio.buildContext !== 'repository-root') {
    fail(
      `services.portfolio.buildContext must be "repository-root", not ` +
        `"${String(portfolio.buildContext)}".`
    )
  }
  if (portfolio.requiresDatabase !== false) {
    fail(
      'services.portfolio.requiresDatabase must be false. The website has no database ' +
        'connection, and declaring otherwise would invite a credential onto it.'
    )
  }
  if (!portfolio.publicNetworking.required) {
    fail('services.portfolio.publicNetworking.required must be true; it is a website.')
  }
  if (portfolio.healthcheckPath === null || portfolio.healthcheckPath === undefined) {
    fail('services.portfolio.healthcheckPath is required.')
  } else if (!portfolio.healthcheckPath.startsWith('/')) {
    fail(
      `services.portfolio.healthcheckPath "${portfolio.healthcheckPath}" must start with a slash.`
    )
  }

  /* --- Consistency with railway.json ------------------------------------ */

  // Two files describe the build. They must not disagree, and the IaC reads
  // railway.json, so a mismatch would mean the spec documents something the
  // deployment does not do.
  if (portfolio.dockerfilePath !== spec.railwayConfig.build.dockerfilePath) {
    fail(
      `services.portfolio.dockerfilePath ("${String(portfolio.dockerfilePath)}") disagrees ` +
        `with railway.json build.dockerfilePath ("${spec.railwayConfig.build.dockerfilePath}").`
    )
  }
  if (portfolio.healthcheckPath !== spec.railwayConfig.deploy.healthcheckPath) {
    fail(
      `services.portfolio.healthcheckPath ("${String(portfolio.healthcheckPath)}") disagrees ` +
        `with railway.json deploy.healthcheckPath ("${spec.railwayConfig.deploy.healthcheckPath}").`
    )
  }
  if (spec.railwayConfig.build.builder !== 'DOCKERFILE') {
    fail(
      `railway.json build.builder must be DOCKERFILE, not ` +
        `"${spec.railwayConfig.build.builder}" — the repository ships a Dockerfile and must ` +
        'not fall back to buildpack auto-detection against the repository root.'
    )
  }
  if (spec.railwayConfig.deploy.restartPolicyType === 'ALWAYS') {
    warn(
      'railway.json deploy.restartPolicyType is ALWAYS, which turns a reproducible ' +
        'startup failure into a crash loop that still reports as deployed.'
    )
  }

  /* --- Postgres --------------------------------------------------------- */

  if (postgres.kind !== 'database') fail('services.postgres.kind must be "database".')
  if (postgres.engine !== 'postgres') {
    fail(`services.postgres.engine must be "postgres", not "${String(postgres.engine)}".`)
  }
  if (!postgres.volume?.required) {
    fail('services.postgres.volume.required must be true; a database without a volume ' +
      'loses its data on every redeploy.')
  }
  if (!postgres.ssl?.required) fail('services.postgres.ssl.required must be true.')
  if (!postgres.tcpProxy?.required) {
    fail(
      'services.postgres.tcpProxy.required must be true; a cloud semantic-model engine ' +
        'cannot reach the private network.'
    )
  }
  if (postgres.tcpProxy && postgres.tcpProxy.applicationPort !== 5432) {
    warn(
      `services.postgres.tcpProxy.applicationPort is ${String(postgres.tcpProxy.applicationPort)}, ` +
        'not the PostgreSQL default 5432.'
    )
  }
  if (postgres.publicNetworking.required) {
    fail(
      'services.postgres.publicNetworking.required must be false. A database needs a TCP ' +
        'proxy, not an HTTP domain.'
    )
  }

  /* --- The provisioning job --------------------------------------------- */

  if (job.role !== 'one-time-job') {
    fail(`services.databaseSetup.role must be "one-time-job", not "${String(job.role)}".`)
  }
  if (job.restartPolicyType !== 'NEVER') {
    fail(
      `services.databaseSetup.restartPolicyType must be NEVER, not ` +
        `"${String(job.restartPolicyType)}". Any other policy restarts a completed run and ` +
        'turns a one-time job into an endless loop.'
    )
  }
  if (job.publicNetworking.required || job.publicNetworking.generateRailwayDomain) {
    fail(
      'services.databaseSetup must not have public networking. It is a job, not a backend ' +
        'API, and giving it a domain is how it becomes one.'
    )
  }
  if (job.healthcheckPath !== null) {
    fail('services.databaseSetup.healthcheckPath must be null; a job serves no traffic.')
  }
  if (!job.requiresDatabase) fail('services.databaseSetup.requiresDatabase must be true.')

  /* --- Variables -------------------------------------------------------- */

  const portfolioVars = spec.variables.services[portfolio.name]
  if (!portfolioVars) {
    fail(`${VARIABLES_SPEC_PATH} has no entry for service "${portfolio.name}".`)
  } else {
    const userDefined = Object.keys(portfolioVars.userDefinedVariables ?? {})
    if (userDefined.length > 0) {
      fail(
        `Service "${portfolio.name}" declares required user-defined variables ` +
          `(${userDefined.join(', ')}). The staging deployment must require none: the site ` +
          'derives its origin from RAILWAY_PUBLIC_DOMAIN and holds no other configuration.'
      )
    }
    for (const forbidden of portfolioVars.forbiddenVariables ?? []) {
      if (
        (portfolioVars.optionalVariables ?? {})[forbidden] !== undefined ||
        (portfolioVars.literalVariables ?? {})[forbidden] !== undefined
      ) {
        fail(
          `Service "${portfolio.name}" both forbids and declares "${forbidden}".`
        )
      }
    }
    if (!(portfolioVars.forbiddenVariables ?? []).includes('DATABASE_URL')) {
      fail(
        `Service "${portfolio.name}" must forbid DATABASE_URL. The website has no database ` +
          'connection and nothing may add one silently.'
      )
    }
  }

  const jobVars = spec.variables.services[job.name]
  if (!jobVars) {
    fail(`${VARIABLES_SPEC_PATH} has no entry for service "${job.name}".`)
  } else {
    const references = jobVars.referenceVariables ?? {}
    if (Object.keys(references).length === 0) {
      fail(
        `Service "${job.name}" declares no reference variables, so it would need copied ` +
          'database credentials.'
      )
    }
    for (const [key, reference] of Object.entries(references)) {
      if (!/^\$\{\{[A-Za-z0-9_.-]+\.[A-Za-z0-9_]+\}\}$/.test(reference.expression)) {
        fail(
          `Service "${job.name}" variable "${key}" has expression ` +
            `"${reference.expression}", which is not a Railway reference of the form ` +
            '${{Service.VARIABLE}}.'
        )
      }
      if (reference.copied === true) {
        fail(
          `Service "${job.name}" variable "${key}" is marked as copied. Cross-service values ` +
            'must be references so they stay in sync and no credential is duplicated.'
        )
      }
    }
    if (references['DATABASE_URL'] === undefined) {
      fail(`Service "${job.name}" must reference DATABASE_URL from the database service.`)
    }
    for (const [key, generated] of Object.entries(jobVars.generatedVariables ?? {})) {
      if (!/^secret\(\d+,\s*".+"\)$/.test(generated.generator)) {
        fail(
          `Service "${job.name}" variable "${key}" has generator "${generated.generator}", ` +
            'which is not of the form secret(<length>, "<alphabet>").'
        )
      }
      const length = Number(/^secret\((\d+)/.exec(generated.generator)?.[1] ?? '0')
      if (length < 32) {
        fail(
          `Service "${job.name}" variable "${key}" generates only ${String(length)} ` +
            'characters; 32 is the floor for a credential that reaches an external service.'
        )
      }
      if (generated.rotateOnEveryDeploy === true) {
        fail(
          `Service "${job.name}" variable "${key}" is marked to rotate on every deploy. ` +
            'That silently breaks a configured downstream consumer on an unrelated commit.'
        )
      }
    }
  }

  /* --- GitHub Actions secrets ------------------------------------------- */

  const requiredSecrets = Object.entries(spec.variables.githubActionsSecrets)
    .filter(([, value]) => value.required)
    .map(([key]) => key)
  if (requiredSecrets.length !== 1 || requiredSecrets[0] !== 'RAILWAY_API_TOKEN') {
    fail(
      `Exactly one GitHub Actions secret must be required, and it must be ` +
        `RAILWAY_API_TOKEN. Found: ${requiredSecrets.join(', ') || '(none)'}.`
    )
  }
  for (const absent of spec.variables.githubActionsSecretsDeliberatelyAbsent) {
    if (spec.variables.githubActionsSecrets[absent] !== undefined) {
      fail(`"${absent}" is listed both as a required GitHub secret and as deliberately absent.`)
    }
  }

  /* --- No secret-shaped value anywhere in the specification ------------- */

  for (const [label, document] of [
    [PROJECT_SPEC_PATH, spec.project as unknown],
    [VARIABLES_SPEC_PATH, spec.variables as unknown],
    [TOOLING_SPEC_PATH, spec.tooling as unknown],
    [RAILWAY_CONFIG_PATH, spec.railwayConfig as unknown],
  ] as const) {
    walkStrings(document, '', (path, text) => {
      for (const { name, pattern } of FORBIDDEN_VALUE_PATTERNS) {
        if (pattern.test(text)) {
          fail(
            `${label} field "${path}" looks like ${name}. The specification is committed to ` +
              'a public repository and must contain no credential, real or otherwise.'
          )
        }
      }
    })
  }

  return { ok: errors.length === 0, errors, warnings }
}
