/**
 * Types for `check_release_intent.mjs`.
 *
 * WHY THE IMPLEMENTATION IS NOT TYPESCRIPT
 * ---------------------------------------
 * Every other tool in `scripts/railway/` is `.ts` and runs under `tsx`. This one is
 * plain ESM on purpose: it is the FIRST step of the bootstrap workflow's first job,
 * and it runs BEFORE `npm ci`. A guard that decides whether a production release may
 * proceed should not be able to fail because a dependency install failed, and it
 * should not require one in order to refuse.
 *
 * So the implementation stays runnable by a bare `node`, and its types live here.
 * `tests/railway/release-intent.test.ts` imports the module and is type-checked
 * against this file like anything else.
 */

/** Parse a GitHub Actions boolean input, which arrives as the string it was typed as. */
export function asBoolean(value: unknown): boolean

/** A dispatch request, as the workflow's inputs reach the guard. */
export interface ReleaseIntentInput {
  mode?: unknown
  targetEnvironment?: unknown
  confirmProduction?: unknown
  expectedReleaseSha?: unknown
  verifyOnly?: unknown
  workflowRef?: unknown
  checkedOutSha?: unknown
}

export interface ReleaseIntentResult {
  /** Whether the run may proceed. False means at least one refusal applies. */
  ok: boolean
  /** Every reason this request was refused. Empty when `ok`. */
  errors: string[]
  /** The request as understood, including whether it would converge anything. */
  summary: string[]
}

export function checkReleaseIntent(input: ReleaseIntentInput): ReleaseIntentResult
