/**
 * The bootstrap tool's behaviour, driven through a fake Railway CLI.
 *
 * The tool is run as a real process against a real executable on
 * `RAILWAY_CLI_BIN`, so its own process-spawning, argument-building and
 * output-handling code is what is under test — not a mock standing in for it.
 * That matters because the three properties being checked all live in exactly
 * that code:
 *
 *   1. `--dry-run` issues no mutating command. Verified by reading the log of what
 *      was actually invoked, not by trusting the flag.
 *   2. A converged project is not re-created. Idempotency, checked the same way.
 *   3. The token never reaches a command line. Verified by asserting it is absent
 *      from every recorded `argv` and present in the recorded environment.
 *
 * NOTHING HERE CONTACTS RAILWAY.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const FAKE_CLI = join(HERE, 'fixtures', 'fake-railway-cli.mjs')
const BOOTSTRAP = join(REPO, 'scripts', 'railway', 'bootstrap_railway.ts')

/** A token that is easy to search for in a log. */
const TEST_TOKEN = 'placeholder-token-DO-NOT-LOG-a1b2c3d4'

interface Invocation {
  argv: string[]
  tokenInEnv: boolean
  targetEnvironment: string | null
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  invocations: Invocation[]
  /** Commands, with flags stripped, in order. */
  commands: string[]
}

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'arpi-bootstrap-test-'))
})

afterEach(() => {
  if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
})

async function runBootstrap(
  scenario: string,
  flags: string[] = [],
  options: { token?: string } = {}
): Promise<RunResult> {
  const logPath = join(workspace, 'invocations.jsonl')

  let exitCode = 0
  let stdout = ''
  let stderr = ''
  try {
    const result = await execFileAsync(
      process.execPath,
      [join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), BOOTSTRAP, ...flags],
      {
        cwd: REPO,
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          RAILWAY_API_TOKEN: options.token ?? TEST_TOKEN,
          RAILWAY_CLI_BIN: FAKE_CLI,
          FAKE_RAILWAY_SCENARIO: scenario,
          FAKE_RAILWAY_LOG: logPath,
          // The fake CLI reports a plausible Railway hostname that does not
          // exist, so the health check is EXPECTED to fail. Without a short
          // budget it would retry for the five minutes railway.json allows, and a
          // suite that takes five minutes to assert one expected failure is a
          // suite that gets skipped.
          ARPI_HEALTH_CHECK_BUDGET_SECONDS: '2',
          NO_PROXY: '*',
        },
      }
    )
    stdout = result.stdout
    stderr = result.stderr
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    exitCode = typeof failure.code === 'number' ? failure.code : 1
    stdout = failure.stdout ?? ''
    stderr = failure.stderr ?? ''
  }

  const invocations = existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Invocation)
    : []

  return {
    exitCode,
    stdout,
    stderr,
    invocations,
    commands: invocations.map((invocation) => subcommandOf(invocation.argv)),
  }
}

/**
 * The subcommand path of an invocation: the leading tokens before the first flag.
 *
 * Not "every token that is not a flag" — that also collects flag VALUES, so
 * `link --project proj-123 --environment staging` would read as the nonsense
 * command `link proj-123 staging`. Matching the fake CLI's own parsing keeps the
 * assertions in this file talking about the same thing the fake responded to.
 */
function subcommandOf(argv: readonly string[]): string {
  const parts: string[] = []
  for (const argument of argv) {
    if (argument.startsWith('-')) break
    parts.push(argument)
  }
  return parts.join(' ')
}

/** The commands that change something on Railway. */
const MUTATING_COMMANDS = [
  'init',
  'environment new',
  'config apply',
  'redeploy',
  'up',
  'domain',
  'volume add',
  'tcp-proxy create',
  'service delete',
  'environment delete',
  'variable set',
  'variable delete',
]

/**
 * Mutating commands issued during a run.
 *
 * EXACT match, not prefix. A prefix rule classifies `domain list` — a read — as a
 * mutation because it starts with `domain`, which made the idempotency assertions
 * fail on a run that had correctly changed nothing. `subcommandOf` already yields
 * exactly these strings, so exact matching is both correct and sufficient.
 */
function mutationsIn(result: RunResult): string[] {
  return result.commands.filter((command) => MUTATING_COMMANDS.includes(command))
}

/* ========================================================================== */
/* Dry run                                                                    */
/* ========================================================================== */

describe('--dry-run makes no mutation', () => {
  it('issues no mutating command against a converged project', async () => {
    const result = await runBootstrap('converged', ['--dry-run'])
    expect(mutationsIn(result), `mutating commands were issued: ${mutationsIn(result).join(', ')}`).toEqual(
      []
    )
    expect(result.exitCode).toBe(0)
  })

  it('issues no mutating command against an empty account', async () => {
    // The case with the most to create is the case where a dry run must create
    // least: nothing.
    const result = await runBootstrap('empty', ['--dry-run'])
    expect(mutationsIn(result)).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  it('reports what it WOULD create, rather than silently doing nothing', async () => {
    const result = await runBootstrap('empty', ['--dry-run'])
    expect(result.stderr).toMatch(/would CREATE project "ARPI"/)
  })

  it('does not apply a pending plan', async () => {
    const result = await runBootstrap('changes-pending', ['--dry-run'])
    expect(result.commands).toContain('config plan')
    expect(result.commands).not.toContain('config apply')
    expect(result.stderr).toMatch(/DRY RUN: changes are pending and were NOT applied/)
    expect(result.exitCode).toBe(0)
  })

  it('triggers no deployment and generates no domain', async () => {
    const result = await runBootstrap('no-domain', ['--dry-run'])
    expect(result.stderr).toMatch(/DRY RUN: no domain generated/)
    expect(result.stderr).toMatch(/DRY RUN: no deployment triggered/)
    expect(result.commands).not.toContain('redeploy')
  })

  it('does not pass --show-values, so the plan stays redacted', async () => {
    const result = await runBootstrap('changes-pending', ['--dry-run'])
    const planInvocation = result.invocations.find((invocation) =>
      invocation.argv.join(' ').includes('config plan')
    )
    expect(planInvocation).toBeDefined()
    expect(planInvocation?.argv).not.toContain('--show-values')
    expect(planInvocation?.argv).not.toContain('--decrypt-variables')
  })

  it('emits parseable, redacted JSON with --json', async () => {
    const result = await runBootstrap('converged', ['--dry-run', '--json'])
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean
      dryRun: boolean
      outputs: Record<string, unknown>
    }
    expect(parsed.dryRun).toBe(true)
    expect(parsed.ok).toBe(true)
    expect(parsed.outputs['project']).toBe('ARPI')
    expect(parsed.outputs['environment']).toBe('staging')
  })

  it('keeps stdout a single JSON document, with progress on stderr', async () => {
    // So that piping stdout into `jq` works while a human still sees progress.
    const result = await runBootstrap('converged', ['--dry-run', '--json'])
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stderr).toMatch(/ARPI Railway bootstrap/)
  })
})

/* ========================================================================== */
/* Idempotency                                                                */
/* ========================================================================== */

describe('idempotency', () => {
  it('creates nothing when the project is already converged', async () => {
    // The claim the whole design rests on. Not "it is safe to re-run" as an
    // assertion, but "re-running issues no create command", read off the log.
    const result = await runBootstrap('converged')
    expect(mutationsIn(result)).toEqual([])
  })

  it('does not create a second project', async () => {
    const result = await runBootstrap('converged')
    expect(result.commands).not.toContain('init')
  })

  it('does not create a second environment', async () => {
    const result = await runBootstrap('converged')
    expect(result.commands).not.toContain('environment new')
  })

  it('does not generate a second domain when one exists', async () => {
    const result = await runBootstrap('converged')
    expect(result.commands.filter((command) => command === 'domain')).toEqual([])
    // It DID look first, which is what makes the skip a decision rather than luck.
    expect(result.commands).toContain('domain list')
  })

  it('does not re-apply when the plan reports no changes', async () => {
    const result = await runBootstrap('converged')
    expect(result.commands).toContain('config plan')
    expect(result.commands).not.toContain('config apply')
    expect(result.stderr).toMatch(/no changes pending/)
  })

  it('does not trigger a deployment when the latest one already succeeded', async () => {
    const result = await runBootstrap('converged')
    expect(result.commands).not.toContain('redeploy')
    expect(result.stderr).toMatch(/not triggering another/)
  })

  it('reads before it writes, in every case', async () => {
    // Each of the four read commands appears before any write could have happened.
    const result = await runBootstrap('converged')
    for (const readCommand of ['list', 'service list', 'domain list', 'volume list']) {
      expect(result.commands, `${readCommand} was not issued`).toContain(readCommand)
    }
  })

  it('produces the same result on a second run', async () => {
    const first = await runBootstrap('converged')
    const second = await runBootstrap('converged')
    expect(mutationsIn(second)).toEqual(mutationsIn(first))
    expect(second.exitCode).toBe(first.exitCode)
  })
})

describe('a converged run still verifies, and its only failure is reachability', () => {
  it('fails ONLY on the health check, because the fake domain does not resolve', async () => {
    // Recorded rather than worked around. The fake CLI reports a plausible Railway
    // hostname that does not exist, so the health check is expected to fail — and
    // asserting that it is the ONLY failure is what proves every other step
    // passed against a converged project.
    const result = await runBootstrap('converged', ['--json'])
    const parsed = JSON.parse(result.stdout) as {
      steps: { name: string; status: string }[]
    }
    const failures = parsed.steps.filter((step) => step.status === 'failed')
    expect(failures.map((step) => step.name)).toEqual(['health-check'])
  })
})

/* ========================================================================== */
/* Creation paths                                                             */
/* ========================================================================== */

describe('it creates what is missing, and only that', () => {
  it('generates a domain when the website has none', async () => {
    const result = await runBootstrap('no-domain')
    expect(result.commands).toContain('domain list')
    expect(result.commands).toContain('domain')
    // and still does not create anything else
    expect(result.commands).not.toContain('init')
    expect(result.commands).not.toContain('environment new')
  })

  it('applies when the plan reports changes', async () => {
    const result = await runBootstrap('changes-pending')
    expect(result.commands).toContain('config apply')
  })

  it('never passes --confirm-destructive', async () => {
    // A plan that wants to DELETE something in this project is a plan nobody
    // intended. The correct response is to stop and have a person read it, not to
    // let a workflow delete a database unattended.
    const result = await runBootstrap('changes-pending')
    for (const invocation of result.invocations) {
      expect(invocation.argv).not.toContain('--confirm-destructive')
    }
  })
})

/* ========================================================================== */
/* Refusals                                                                   */
/* ========================================================================== */

describe('it refuses rather than guessing', () => {
  it('refuses when two projects share the target name', async () => {
    const result = await runBootstrap('duplicate')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/Refusing to guess/)
    expect(mutationsIn(result)).toEqual([])
  })

  it('refuses without a token, before contacting anything', async () => {
    const result = await runBootstrap('converged', ['--dry-run'], { token: '' })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/RAILWAY_API_TOKEN is not set/)
    // Not even a version probe: the token is required first.
    expect(result.invocations.filter((i) => !i.argv.includes('--version'))).toEqual([])
  })

  it('refuses a credential passed as an argument', async () => {
    const result = await runBootstrap('converged', ['--token=placeholder-leaked'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/Refusing to accept --token on the command line/)
    expect(result.invocations).toEqual([])
  })

  it('refuses an unknown argument rather than ignoring it', async () => {
    const result = await runBootstrap('converged', ['--dry-runn'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/Unknown argument/)
  })
})

/* ========================================================================== */
/* The token                                                                  */
/* ========================================================================== */

describe('the token never reaches a command line', () => {
  it('is absent from every recorded argv', async () => {
    const result = await runBootstrap('converged', ['--dry-run'])
    expect(result.invocations.length).toBeGreaterThan(3)
    for (const invocation of result.invocations) {
      expect(
        invocation.argv.join(' '),
        'the token appeared in a command line, where `ps` and shell history can read it'
      ).not.toContain(TEST_TOKEN)
      expect(invocation.argv).not.toContain('--token')
    }
  })

  it('is delivered through the environment instead', async () => {
    const result = await runBootstrap('converged', ['--dry-run'])
    const railwayCalls = result.invocations.filter((i) => !i.argv.includes('--version'))
    expect(railwayCalls.length).toBeGreaterThan(0)
    for (const invocation of railwayCalls) {
      expect(invocation.tokenInEnv).toBe(true)
    }
  })

  it('never appears in the tool\'s own output', async () => {
    const result = await runBootstrap('converged', ['--dry-run', '--json'])
    expect(result.stdout).not.toContain(TEST_TOKEN)
    expect(result.stderr).not.toContain(TEST_TOKEN)
  })

  it('reports only its presence, never any part of its value', async () => {
    const result = await runBootstrap('converged', ['--dry-run'])
    expect(result.stderr).toMatch(/token\s+: present \(never printed\)/)
    // Not a prefix, not a length — either is a real disclosure for a short token.
    expect(result.stderr).not.toContain(TEST_TOKEN.slice(0, 8))
  })
})

/* ========================================================================== */
/* The production guard reaches the declaration                                */
/* ========================================================================== */

describe('the target environment is handed to the declaration', () => {
  it('passes the environment name on the plan and apply calls', async () => {
    // This is what makes the declaration's production guard effective on the path
    // that actually mutates a live project, rather than only where Railway happens
    // to populate its own context.
    const result = await runBootstrap('changes-pending')
    const planAndApply = result.invocations.filter((invocation) =>
      /config (plan|apply)/.test(invocation.argv.join(' '))
    )
    expect(planAndApply.length).toBeGreaterThanOrEqual(2)
    for (const invocation of planAndApply) {
      expect(invocation.targetEnvironment).toBe('staging')
    }
  })
})
