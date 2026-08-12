/**
 * Evaluating `.railway/railway.ts` without touching Railway.
 *
 * The Railway SDK ships a runner, `railway-iac-ts`, whose `evaluate` command
 * compiles the IaC file into the resource graph Railway would converge onto and
 * needs no credential and no network to do it. That makes it the single most
 * useful test in this whole deployment: it turns "the declaration is correct"
 * into something a unit test can assert, offline, in CI, on a fork, with no
 * secrets configured.
 *
 * What `evaluate` proves:
 *   - the file compiles and its guards did not throw
 *   - the exact service and database names that would be created
 *   - which variables are LITERALS and which are REFERENCES — the graph tags
 *     each one, so "no database credential was copied into the website" is a
 *     mechanical assertion rather than a code review
 *   - which variables carry a server-side `generator`, so no password originates
 *     in this repository
 *   - the build and deploy configuration, so it can be compared to railway.json
 *
 * What it cannot prove: anything about the live project. That is the verifier's
 * job, and it needs a token.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, IAC_PATH, type ToolingSpec } from './spec.ts'

/**
 * The variable through which the target environment reaches the declaration.
 *
 * The Railway context (`ctx.environmentName`) is populated by the platform during
 * `railway config plan` and `apply` against a linked environment, and is the
 * guard's primary input. It is NOT populated during a local `evaluate`, so this
 * variable is the second input — set by every tool here that knows the target,
 * which makes the guard both effective on the automated path and testable
 * offline.
 */
export const TARGET_ENVIRONMENT_VARIABLE = 'ARPI_RAILWAY_TARGET_ENVIRONMENT'

/**
 * The variable through which PER-INVOCATION production intent reaches the
 * declaration, added by the `DASH.13` closeout.
 *
 * `DASH.13` approved a production release and taught `bootstrap_railway.ts` to
 * accept `--environment production --confirm-production`, but `.railway/railway.ts`
 * still threw on any evaluation whose target was production. The approved path
 * therefore failed at OFFLINE VALIDATION, before a token was even read — the
 * repository declared production supported and the declaration refused it.
 *
 * The declaration now refuses production unless BOTH hold:
 *
 *   1. `project.productionRelease.approved` is true — the standing decision,
 *      reviewable in the repository;
 *   2. this variable is exactly `"true"` — the per-invocation intent, set ONLY by
 *      a tool that was given `--confirm-production` on its command line.
 *
 * Keeping the second signal separate from the environment NAME is the point. A
 * stray `railway config apply` linked to production, or an ambient
 * `RAILWAY_ENVIRONMENT_NAME=production`, supplies a name and nothing else, so the
 * declaration still throws. Intent has to be typed.
 */
export const CONFIRM_PRODUCTION_VARIABLE = 'ARPI_RAILWAY_CONFIRM_PRODUCTION'

/* -------------------------------------------------------------------------- */
/* The graph shape, narrowed to what this repository asserts on               */
/* -------------------------------------------------------------------------- */

export interface GraphVariableLiteral {
  type: 'literal'
  value?: string
}
export interface GraphVariableReference {
  type: 'reference'
  resource: string
  output: string
}
export interface GraphVariableShared {
  type: 'sharedReference'
  name: string
}
export interface GraphVariableRaw {
  type: 'raw'
  value: { generator?: string; value?: string; isSealed?: boolean }
}
export interface GraphVariablePreserve {
  type: 'preserve'
}

export type GraphVariable =
  | GraphVariableLiteral
  | GraphVariableReference
  | GraphVariableShared
  | GraphVariableRaw
  | GraphVariablePreserve

export interface GraphResource {
  address: string
  type: 'service' | 'database' | 'volume' | 'bucket' | 'group'
  kind?: string
  name: string
  engine?: string
  image?: string
  defaultMountPath?: string
  source?: {
    type?: string
    repo?: string | null
    branch?: string | null
    rootDirectory?: string | null
    checkSuites?: boolean | null
  }
  build?: {
    builder?: string
    dockerfilePath?: string
    watchPatterns?: string[]
  }
  deploy?: {
    healthcheckPath?: string
    healthcheckTimeout?: number
    restartPolicyType?: string
    restartPolicyMaxRetries?: number
    numReplicas?: number
    sleepApplication?: boolean
  }
  variables?: Record<string, GraphVariable>
  configFile?: string
  networking?: unknown
}

export interface GraphEdge {
  from: string
  to: string
  type: string
  key?: string
}

export interface RailwayGraph {
  version: number
  project: { name: string }
  environments: { name: string }[]
  resources: GraphResource[]
  edges: GraphEdge[]
}

export interface EvaluateResult {
  ok: boolean
  command: string
  file: string
  graph?: RailwayGraph
  diagnostics: { severity: 'warning' | 'error'; path: string; message: string }[]
  sdkVersion?: string
}

/* -------------------------------------------------------------------------- */
/* Running the runner                                                          */
/* -------------------------------------------------------------------------- */

function resolveRunner(): string {
  const override = process.env['RAILWAY_IAC_TS_BIN']
  if (override !== undefined && override.trim() !== '') return override
  const local = join(REPO_ROOT, 'node_modules', '.bin', 'railway-iac-ts')
  if (existsSync(local)) return local
  // Falls back to PATH; `resolveRunnerHint` explains the failure if it is absent.
  return 'railway-iac-ts'
}

export function resolveRunnerHint(tooling: ToolingSpec): string {
  return (
    `Install the IaC runner with: npm install   (it is the "${tooling.railwaySdk.package}" ` +
    `devDependency, pinned at ${tooling.railwaySdk.version}), or set RAILWAY_IAC_TS_BIN.`
  )
}

/**
 * Evaluate the IaC file offline.
 *
 * `spawn` rather than `execFile`, for one reason: STDIN MUST BE CLOSED. The
 * runner reads a JSON request from stdin whenever stdin is not a TTY, so a call
 * from a script — where stdin is an inherited pipe nobody writes to — waits for
 * input forever. `execFile` gives no way to set `stdio`, so it hangs, and a hang
 * in CI reads as an infrastructure flake rather than as a bug. `spawn` with
 * `stdio: ['ignore', ...]` closes it.
 */
export async function evaluateIac(
  options: {
    file?: string
    environmentName?: string
    /**
     * Whether the caller was given explicit production intent on ITS command
     * line. Defaults to false, which is the fail-closed direction: a caller that
     * says nothing is a caller that did not ask for production.
     */
    confirmProduction?: boolean
  } = {}
): Promise<EvaluateResult> {
  const file = options.file ?? join(REPO_ROOT, IAC_PATH)
  const args = ['--command', 'evaluate', '--file', file, '--compact']

  // The target environment is communicated through the ENVIRONMENT, not a flag.
  //
  // The runner has no `--environment` option — its flag parser accepts `--cwd`,
  // `--file`, `--endpoint`, `--token`, `--auth-type`, `--project-id` and
  // `--environment-id`, and SILENTLY IGNORES anything else. An earlier version of
  // this function passed `--environment <name>` and the production guard in
  // `.railway/railway.ts` therefore never saw a name and never fired; the guard
  // looked correct and did nothing, which is the worst state a guard can be in.
  // `tests/railway/iac-graph.test.ts` now asserts it fires.
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.environmentName !== undefined) {
    env[TARGET_ENVIRONMENT_VARIABLE] = options.environmentName
  }
  // Set only when the caller genuinely holds the confirmation, and DELETED
  // otherwise rather than left to whatever the ambient environment carries: an
  // inherited `ARPI_RAILWAY_CONFIRM_PRODUCTION=true` from some earlier shell must
  // not confirm a run that did not ask for production.
  if (options.confirmProduction === true) {
    env[CONFIRM_PRODUCTION_VARIABLE] = 'true'
  } else {
    delete env[CONFIRM_PRODUCTION_VARIABLE]
  }

  const { stdout, stderr } = await new Promise<{
    stdout: string
    stderr: string
    code: number | null
  }>((resolve, reject) => {
    const child = spawn(resolveRunner(), args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('railway-iac-ts evaluate timed out after 180s.'))
    }, 180_000)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code,
      })
    })
  })

  // A guard that threw — the production guard, for instance — is reported by the
  // runner as a failed evaluation carrying a diagnostic, on stdout, with a
  // non-zero exit. That is a legitimate result to parse rather than a crash, so
  // the exit code is not consulted: the presence of JSON is.
  const start = stdout.search(/[{]/)
  if (start === -1) {
    throw new Error(
      `railway-iac-ts evaluate produced no JSON.${stderr.trim() === '' ? '' : `\n${stderr}`}`
    )
  }
  return JSON.parse(stdout.slice(start)) as EvaluateResult
}

/* -------------------------------------------------------------------------- */
/* Assertions over the graph                                                   */
/* -------------------------------------------------------------------------- */

export function findResource(
  graph: RailwayGraph,
  name: string
): GraphResource | undefined {
  return graph.resources.find((resource) => resource.name === name)
}

/** Variables on a resource, or an empty record. */
export function variablesOf(resource: GraphResource | undefined): Record<string, GraphVariable> {
  return resource?.variables ?? {}
}

/** Keys whose value is a cross-service reference. */
export function referenceKeys(resource: GraphResource | undefined): string[] {
  return Object.entries(variablesOf(resource))
    .filter(([, value]) => value.type === 'reference')
    .map(([key]) => key)
    .sort()
}

/** Keys whose value Railway generates server-side. */
export function generatedKeys(resource: GraphResource | undefined): string[] {
  return Object.entries(variablesOf(resource))
    .filter(
      ([, value]) => value.type === 'raw' && typeof value.value.generator === 'string'
    )
    .map(([key]) => key)
    .sort()
}

/** Keys whose value is a plain literal written into the declaration. */
export function literalKeys(resource: GraphResource | undefined): string[] {
  return Object.entries(variablesOf(resource))
    .filter(([, value]) => value.type === 'literal')
    .map(([key]) => key)
    .sort()
}

/**
 * Literal variables whose value looks like a credential.
 *
 * This is the assertion that "no database credential was copied" is checked
 * against, and it is checked on the DECLARATION rather than on the live project —
 * so it fails in a unit test, on a fork, with no token, before anything is
 * deployed.
 */
export function literalSecretViolations(resource: GraphResource | undefined): string[] {
  const violations: string[] = []
  for (const [key, value] of Object.entries(variablesOf(resource))) {
    if (value.type !== 'literal') continue
    const literal = value.value ?? ''
    if (/\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:@/]+:[^\s:@/]+@/i.test(literal)) {
      violations.push(`${key} is a literal connection URI with an inline password.`)
    }
    if (/^[A-Za-z0-9+/]{24,}={0,2}$/.test(literal) && /password|secret|token|key/i.test(key)) {
      violations.push(`${key} is a literal that looks like an encoded credential.`)
    }
    if (/password|passwd|secret|token|api[_-]?key/i.test(key) && literal.length >= 8) {
      // A reference or a generator would not land here; a literal under a
      // secret-shaped name is either a copied credential or a placeholder, and
      // neither belongs in a committed declaration.
      violations.push(
        `${key} is a literal under a secret-shaped name. Use a reference or a generator.`
      )
    }
  }
  return violations.sort()
}
