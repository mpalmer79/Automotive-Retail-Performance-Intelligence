#!/usr/bin/env node
/**
 * Decide whether a dispatched Railway bootstrap run is allowed to proceed.
 *
 * WHY THIS IS A FILE RATHER THAN A `run:` BLOCK
 * ---------------------------------------------
 * `.github/workflows/railway-bootstrap.yml` is the only workflow in this
 * repository that holds a credential, and the `DASH.13` closeout gave it a second
 * environment to target. That turned a workflow with one path into a workflow
 * with a decision in it, and a decision that lives in YAML can only be exercised
 * by dispatching it — which, for this workflow, means exercising it against a
 * real Railway account. A guard whose first real execution is the release it is
 * guarding is not a guard.
 *
 * So the logic lives here, is pure, and is unit-tested by
 * `tests/railway/release-intent.test.ts` across every combination that matters.
 * The workflow calls it as its first step.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not replace `bootstrap_railway.ts`'s guards. That tool refuses the same
 * requests on its own, before contacting anything, and would still refuse them if
 * this file were deleted. Two independent implementations of the same refusal is
 * the intent: this one fails the run early and legibly, and the tool is the one
 * that is actually load-bearing.
 *
 * It reads no credential, makes no request, and prints no input it was not given.
 */

/** Parse a GitHub Actions boolean input, which arrives as the string it was typed as. */
export function asBoolean(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'true'
}

/** A full 40-character hexadecimal commit SHA. An abbreviation is not one. */
const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * Evaluate a dispatch request.
 *
 * @param {object} input
 * @returns {{ok: boolean, errors: string[], summary: string[]}}
 */
export function checkReleaseIntent(input) {
  const mode = String(input.mode ?? '').trim()
  const target = String(input.targetEnvironment ?? '').trim()
  const confirmProduction = asBoolean(input.confirmProduction)
  const expectedSha = String(input.expectedReleaseSha ?? '').trim()
  const verifyOnly = asBoolean(input.verifyOnly)
  const ref = String(input.workflowRef ?? '').trim()
  const checkedOutSha = String(input.checkedOutSha ?? '').trim()

  const errors = []
  const wantsProduction = target === 'production'
  // `verify_only` reads the live configuration and converges nothing, so it is
  // not an apply however `mode` was set.
  const mutating = mode === 'apply' && !verifyOnly

  if (mode !== 'dry-run' && mode !== 'apply') {
    errors.push(`mode must be "dry-run" or "apply"; received "${mode}".`)
  }

  /*
   * Surrounding whitespace is trimmed and NOTHING ELSE is normalised.
   *
   * The distinction matters. Trimming is safe: the value arrives from a `choice`
   * input and, on the paths that do not, through an environment variable, and
   * neither can carry meaningful leading space. Case-folding and aliasing are not:
   * "Production" and "prod" are requests this workflow does not understand, and
   * deciding which environment somebody probably meant is how the wrong one gets
   * converged.
   */
  if (target !== 'staging' && target !== 'production') {
    errors.push(
      `target_environment must be exactly "staging" or "production"; received "${target}".`
    )
  }

  if (wantsProduction && !confirmProduction) {
    errors.push(
      'target_environment is "production" but confirm_production is false. This is the ' +
        'public deployment: it is never the default and is never inferred. Re-dispatch ' +
        'with confirm_production checked when that is what you mean. Nothing has been ' +
        'contacted.'
    )
  }

  /*
   * The reverse is an error too, and it is the more interesting one. An operator
   * who ticked confirm_production believes they are releasing production; running
   * their request against staging instead would tell them production was
   * converged when it was not.
   */
  if (!wantsProduction && confirmProduction) {
    errors.push(
      `confirm_production is true but target_environment is "${target}". Refusing to ` +
        'proceed rather than silently converging a different environment than the one ' +
        'this run was confirmed for.'
    )
  }

  if (wantsProduction && mutating) {
    if (ref !== 'refs/heads/main') {
      errors.push(
        `a production apply must be dispatched from main; this run is on "${ref}". ` +
          'Production serves the release commit, and a branch is not one.'
      )
    }
    if (expectedSha === '') {
      errors.push(
        'expected_release_sha is required for a production apply. Production must be built ' +
          'from a named commit, so that what was released can be compared with what is ' +
          'serving afterwards.'
      )
    } else if (!FULL_SHA.test(expectedSha)) {
      errors.push(
        'expected_release_sha must be a full 40-character commit SHA. An abbreviation is ' +
          'not an identity: two commits share a prefix often enough to matter here.'
      )
    } else if (checkedOutSha !== '' && expectedSha !== checkedOutSha) {
      errors.push(
        `expected_release_sha (${expectedSha}) is not the commit this run checked out ` +
          `(${checkedOutSha}). The build would not be the release that was named.`
      )
    }
  }

  /*
   * A staging run that names a release SHA is refused rather than ignored. The
   * input means "this is the commit being released", and honouring it on staging
   * while calling it a release would put a release SHA on a preview deployment.
   */
  if (!wantsProduction && expectedSha !== '') {
    errors.push(
      'expected_release_sha was given for a staging run. It names the commit a PRODUCTION ' +
        'release is built from; leave it empty for staging.'
    )
  }

  const summary = [
    `mode                 : ${mode}`,
    `target_environment   : ${target}`,
    `confirm_production   : ${String(confirmProduction)}`,
    `verify_only          : ${String(verifyOnly)}`,
    `expected_release_sha : ${expectedSha === '' ? '(none)' : expectedSha}`,
    `ref                  : ${ref}`,
    `checked out          : ${checkedOutSha === '' ? '(unknown)' : checkedOutSha}`,
    `converges            : ${mutating ? `YES — ${target}` : 'no (plan or verification only)'}`,
  ]

  return { ok: errors.length === 0, errors, summary }
}

/* Executed as a script by the workflow; imported as a module by its tests. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkReleaseIntent({
    mode: process.env['ARPI_MODE'],
    targetEnvironment: process.env['ARPI_TARGET_ENVIRONMENT'],
    confirmProduction: process.env['ARPI_CONFIRM_PRODUCTION'],
    expectedReleaseSha: process.env['ARPI_EXPECTED_RELEASE_SHA'],
    verifyOnly: process.env['ARPI_VERIFY_ONLY'],
    workflowRef: process.env['ARPI_WORKFLOW_REF'],
    checkedOutSha: process.env['ARPI_CHECKED_OUT_SHA'],
  })

  process.stdout.write(`${result.summary.join('\n')}\n`)

  if (!result.ok) {
    for (const error of result.errors) {
      process.stdout.write(`\n::error::${error}\n`)
    }
    process.stdout.write('\nNothing has been contacted and nothing has changed.\n')
    process.exit(1)
  }

  process.stdout.write('\nRelease intent accepted.\n')
}
