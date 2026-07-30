/**
 * Invoking the Railway CLI.
 *
 * Every Railway mutation and every Railway read in this repository goes through
 * this module. That is not architectural tidiness — it is what makes three
 * security properties checkable in one place instead of at twenty call sites:
 *
 *   1. THE TOKEN IS NEVER AN ARGUMENT. It is passed only in the child process's
 *      environment. A command line is visible in `ps`, in a container's process
 *      list, and in a shell history; an environment variable of a child process
 *      is not, and `--token` on a Railway command would put an account
 *      credential in all three.
 *
 *   2. NOTHING IS PRINTED UNREDACTED. Both stdout and stderr pass through
 *      `redact()` before they can reach a log, including on the failure path,
 *      which is exactly where a CLI is most likely to echo what it was given.
 *
 *   3. NO SHELL. `execFile` with an argument array, never `exec` with a string,
 *      so a service or project name containing a shell metacharacter is data
 *      rather than syntax.
 *
 * RESOLUTION
 * ----------
 * The CLI is pinned in `deployment/railway/tooling.json` but is deliberately not
 * an npm dependency of this repository — see the note in the root package.json.
 * It is located, in order: `RAILWAY_CLI_BIN`, then a `railway` already on PATH
 * whose `--version` matches the pin, then `npx --yes @railway/cli@<pinned>`.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { redact } from './redact.ts'
import { REPO_ROOT, type ToolingSpec } from './spec.ts'

const execFileAsync = promisify(execFile)

/** The environment variable the token is read from. The only one accepted. */
export const TOKEN_VARIABLE = 'RAILWAY_API_TOKEN'

export class RailwayCliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'RailwayCliError'
  }
}

export interface RailwayCli {
  /** How the CLI was located, for the run report. Never includes a token. */
  readonly resolution: string
  readonly version: string
  /** Run a command and return its raw stdout. Throws on a non-zero exit. */
  run(args: string[], options?: RunOptions): Promise<string>
  /** Run a command with `--json` and parse the result. */
  json<T>(args: string[], options?: RunOptions): Promise<T>
  /** Run a command, returning the outcome instead of throwing. */
  attempt(args: string[], options?: RunOptions): Promise<CommandOutcome>
}

export interface RunOptions {
  /** Extra environment for this call only. Merged over the base environment. */
  readonly env?: Record<string, string>
  /** Milliseconds. Deployment polling uses a longer value than a list call. */
  readonly timeoutMs?: number
  /** Exit codes to treat as success. `railway config plan
   *  --detailed-exit-code` returns 2 to mean "changes are pending", which is
   *  information rather than failure. */
  readonly allowExitCodes?: readonly number[]
}

export interface CommandOutcome {
  readonly ok: boolean
  readonly exitCode: number | null
  /** Already redacted. */
  readonly stdout: string
  /** Already redacted. */
  readonly stderr: string
}

/**
 * Read the token from the environment.
 *
 * Throws a message that names the variable and says where to set it, and which
 * contains no part of the value — including no length and no prefix, because a
 * "starts with..." hint in a CI log is a real disclosure for a short token.
 */
export function requireToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env[TOKEN_VARIABLE]
  if (token === undefined || token.trim() === '') {
    throw new Error(
      `${TOKEN_VARIABLE} is not set.\n\n` +
        'Create an account- or workspace-scoped token in the Railway dashboard under\n' +
        'Account Settings → Tokens, then:\n' +
        `  - locally:         export ${TOKEN_VARIABLE}=...   (do not commit it, do not pass it as a flag)\n` +
        `  - GitHub Actions:  store it as the repository secret ${TOKEN_VARIABLE}\n\n` +
        'A PROJECT-scoped token is not sufficient: creating a project, creating a service\n' +
        'and generating a domain are account-level operations.'
    )
  }
  return token
}

/** Whether a token is present, without reading or revealing it. */
export function hasToken(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env[TOKEN_VARIABLE]
  return token !== undefined && token.trim() !== ''
}

/**
 * The environment handed to the CLI.
 *
 * Built by ADDING to the inherited environment rather than replacing it: the CLI
 * needs PATH, HOME (for its own state directory) and the proxy variables of
 * whatever host it runs on, and an allow-list would break on the next one of
 * those it started needing.
 */
function childEnvironment(
  token: string,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [TOKEN_VARIABLE]: token,
    // Keep the CLI from trying to update itself mid-run, which would change the
    // pinned version under us and make a run non-reproducible.
    RAILWAY_DISABLE_AUTOUPDATE: '1',
    CI: process.env.CI ?? 'true',
    ...extra,
  }
}

interface Candidate {
  command: string
  baseArgs: string[]
  resolution: string
}

async function probeVersion(candidate: Candidate): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      candidate.command,
      [...candidate.baseArgs, '--version'],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    )
    // `railway 5.30.1`
    return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Locate the Railway CLI and return a bound invoker.
 *
 * A version mismatch against the pin is a WARNING rather than an error: the
 * commands used here are stable, refusing to run because a developer has 5.31
 * installed would be obstructive, and the mismatch is reported in the run output
 * so a behaviour difference is attributable.
 */
export async function resolveRailwayCli(
  tooling: ToolingSpec,
  options: { token?: string; onWarning?: (message: string) => void } = {}
): Promise<RailwayCli> {
  const token = options.token ?? requireToken()
  const pinned = tooling.railwayCli.version
  const warn = options.onWarning ?? (() => undefined)

  const candidates: Candidate[] = []
  const override = process.env['RAILWAY_CLI_BIN']
  if (override !== undefined && override.trim() !== '') {
    candidates.push({ command: override, baseArgs: [], resolution: 'RAILWAY_CLI_BIN' })
  }
  candidates.push({ command: 'railway', baseArgs: [], resolution: 'railway on PATH' })
  candidates.push({
    command: 'npx',
    baseArgs: ['--yes', `${tooling.railwayCli.package}@${pinned}`],
    resolution: `npx ${tooling.railwayCli.package}@${pinned}`,
  })

  let chosen: Candidate | null = null
  let version = 'unknown'

  for (const candidate of candidates) {
    const probed = await probeVersion(candidate)
    if (probed === null) continue
    chosen = candidate
    version = probed
    if (probed !== pinned) {
      warn(
        `Railway CLI ${probed} resolved via ${candidate.resolution}, but ` +
          `${TOOLING_LABEL} pins ${pinned}. Proceeding; a behavioural difference is ` +
          'attributable to this mismatch.'
      )
    }
    break
  }

  if (chosen === null) {
    throw new Error(
      'Could not run the Railway CLI.\n\n' +
        `Tried, in order: ${candidates.map((c) => c.resolution).join(', ')}.\n` +
        `Install it with: npm install -g ${tooling.railwayCli.package}@${pinned}\n` +
        'or set RAILWAY_CLI_BIN to its path.'
    )
  }

  const resolvedCandidate = chosen

  async function attempt(
    args: string[],
    runOptions: RunOptions = {}
  ): Promise<CommandOutcome> {
    const allowed = new Set([0, ...(runOptions.allowExitCodes ?? [])])
    try {
      const { stdout, stderr } = await execFileAsync(
        resolvedCandidate.command,
        [...resolvedCandidate.baseArgs, ...args],
        {
          cwd: REPO_ROOT,
          env: childEnvironment(token, runOptions.env),
          timeout: runOptions.timeoutMs ?? 300_000,
          maxBuffer: 32 * 1024 * 1024,
        }
      )
      return { ok: true, exitCode: 0, stdout: redact(stdout), stderr: redact(stderr) }
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        code?: number | string
        stdout?: string
        stderr?: string
      }
      const exitCode = typeof failure.code === 'number' ? failure.code : null
      const outcome: CommandOutcome = {
        ok: exitCode !== null && allowed.has(exitCode),
        exitCode,
        stdout: redact(failure.stdout ?? ''),
        stderr: redact(failure.stderr ?? redact(String(failure.message ?? ''))),
      }
      return outcome
    }
  }

  async function run(args: string[], runOptions: RunOptions = {}): Promise<string> {
    const outcome = await attempt(args, runOptions)
    if (!outcome.ok) {
      throw new RailwayCliError(
        // The argument list is safe to echo: the token is not in it, by
        // construction, and knowing which command failed is most of the
        // diagnosis.
        `railway ${args.join(' ')} exited ${String(outcome.exitCode)}.\n${outcome.stderr}`,
        outcome.exitCode,
        outcome.stdout,
        outcome.stderr
      )
    }
    return outcome.stdout
  }

  async function json<T>(args: string[], runOptions: RunOptions = {}): Promise<T> {
    const stdout = await run(args.includes('--json') ? args : [...args, '--json'], runOptions)
    // The CLI documents that progress and selection echoes go to stderr, so
    // stdout should be pure JSON. It is not assumed: the first `{` or `[` is
    // located so a stray banner line cannot break parsing.
    const start = stdout.search(/[[{]/)
    if (start === -1) {
      throw new RailwayCliError(
        `railway ${args.join(' ')} produced no JSON.`,
        0,
        stdout,
        ''
      )
    }
    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch (error) {
      throw new RailwayCliError(
        `railway ${args.join(' ')} produced unparseable JSON: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        0,
        stdout,
        ''
      )
    }
  }

  return {
    resolution: resolvedCandidate.resolution,
    version,
    run,
    json,
    attempt,
  }
}

const TOOLING_LABEL = 'deployment/railway/tooling.json'
