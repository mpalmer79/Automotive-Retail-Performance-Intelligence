/**
 * Run reporting for the Railway tools.
 *
 * Two output modes from one recorded run, so `--json` and the human-readable
 * output can never describe different outcomes: both are rendered from the same
 * accumulated steps at the end, rather than printed as the run goes.
 *
 * Everything written here goes through `redactedJson`/`redact`, so a value that
 * should not be printed cannot be printed by choosing the wrong mode.
 */
import { redact, redactedJson } from './redact.ts'

export type StepStatus = 'ok' | 'created' | 'unchanged' | 'skipped' | 'warning' | 'failed'

export interface Step {
  readonly name: string
  readonly status: StepStatus
  readonly detail: string
  readonly data?: Record<string, unknown>
}

/** Symbols chosen so the four non-failure states are visually distinct at a
 *  glance in a CI log, where colour is unreliable. */
const SYMBOL: Record<StepStatus, string> = {
  ok: '[ ok ]',
  created: '[ new]',
  unchanged: '[ == ]',
  skipped: '[skip]',
  warning: '[warn]',
  failed: '[FAIL]',
}

export class RunReport {
  readonly #steps: Step[] = []
  readonly #warnings: string[] = []
  #outputs: Record<string, unknown> = {}

  constructor(
    readonly title: string,
    readonly jsonMode: boolean,
    readonly dryRun: boolean
  ) {}

  step(step: Step): void {
    this.#steps.push(step)
    // Progress goes to stderr, always. In `--json` mode stdout must stay a
    // single parseable document, and a caller piping stdout into `jq` should
    // still see progress on their terminal.
    process.stderr.write(`  ${SYMBOL[step.status]} ${step.name.padEnd(30)} ${redact(step.detail)}\n`)
  }

  ok(name: string, detail: string, data?: Record<string, unknown>): void {
    this.step({ name, status: 'ok', detail, ...(data ? { data } : {}) })
  }

  created(name: string, detail: string, data?: Record<string, unknown>): void {
    this.step({ name, status: 'created', detail, ...(data ? { data } : {}) })
  }

  unchanged(name: string, detail: string, data?: Record<string, unknown>): void {
    this.step({ name, status: 'unchanged', detail, ...(data ? { data } : {}) })
  }

  skipped(name: string, detail: string): void {
    this.step({ name, status: 'skipped', detail })
  }

  warn(name: string, detail: string): void {
    this.#warnings.push(`${name}: ${detail}`)
    this.step({ name, status: 'warning', detail })
  }

  failed(name: string, detail: string): void {
    this.step({ name, status: 'failed', detail })
  }

  /** Non-secret values the caller may want programmatically. */
  setOutputs(outputs: Record<string, unknown>): void {
    this.#outputs = { ...this.#outputs, ...outputs }
  }

  get failures(): Step[] {
    return this.#steps.filter((step) => step.status === 'failed')
  }

  get warnings(): readonly string[] {
    return this.#warnings
  }

  header(lines: string[]): void {
    process.stderr.write(`\n${this.title}${this.dryRun ? '  (DRY RUN — no mutation)' : ''}\n`)
    for (const line of lines) process.stderr.write(`  ${redact(line)}\n`)
    process.stderr.write('\n')
  }

  /**
   * Emit the final result and return the process exit code.
   *
   * In `--json` mode the document is the only thing on stdout. In human mode a
   * summary line is, so that `$(...)` capture of either is meaningful.
   */
  finish(): number {
    const failed = this.failures.length > 0
    const exitCode = failed ? 1 : 0

    if (this.jsonMode) {
      process.stdout.write(
        `${redactedJson({
          ok: !failed,
          dryRun: this.dryRun,
          title: this.title,
          steps: this.#steps,
          warnings: this.#warnings,
          outputs: this.#outputs,
        })}\n`
      )
      return exitCode
    }

    process.stderr.write('\n')
    if (Object.keys(this.#outputs).length > 0) {
      process.stderr.write('Outputs (non-secret):\n')
      for (const [key, value] of Object.entries(this.#outputs)) {
        process.stderr.write(`  ${key.padEnd(28)} ${redact(String(value))}\n`)
      }
      process.stderr.write('\n')
    }
    if (this.#warnings.length > 0) {
      process.stderr.write(`${String(this.#warnings.length)} warning(s):\n`)
      for (const warning of this.#warnings) process.stderr.write(`  - ${redact(warning)}\n`)
      process.stderr.write('\n')
    }

    if (failed) {
      process.stdout.write(
        `FAILED: ${String(this.failures.length)} of ${String(this.#steps.length)} step(s).\n`
      )
    } else {
      process.stdout.write(`OK: ${String(this.#steps.length)} step(s).\n`)
    }
    return exitCode
  }
}

/** Minimal argument parsing. Deliberately not a dependency: these tools accept
 *  four flags and no positional arguments, and a token must never be one of
 *  them. */
export interface CommonArguments {
  readonly dryRun: boolean
  readonly json: boolean
  readonly help: boolean
  readonly unknown: string[]
}

export function parseCommonArguments(argv: readonly string[]): CommonArguments {
  const known = new Set(['--dry-run', '--json', '--help', '-h'])
  const unknown = argv.filter((arg) => !known.has(arg))
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    unknown,
  }
}

/**
 * Reject anything that looks like a credential passed on the command line.
 *
 * Called by every tool here before it does anything else. The point is not that
 * these tools have a `--token` flag to misuse — they deliberately do not — but
 * that somebody WILL eventually try `--token=...` or `--password ...`, and the
 * useful response is to refuse and say why rather than to ignore the argument
 * and leave the credential sitting in a shell history and a CI log.
 */
export function rejectCredentialArguments(argv: readonly string[]): void {
  const offenders = argv.filter((arg) =>
    /^--?(token|api[-_]?token|password|secret|key)(=|$)/i.test(arg)
  )
  if (offenders.length > 0) {
    const names = offenders.map((arg) => arg.split('=')[0] ?? arg)
    throw new Error(
      `Refusing to accept ${names.join(', ')} on the command line.\n\n` +
        'A command line is visible in `ps`, in a container process list and in shell\n' +
        'history. Credentials are read from the environment only:\n' +
        '  export RAILWAY_API_TOKEN=...\n'
    )
  }
}
