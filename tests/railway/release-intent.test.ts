/**
 * The dispatch guard on the one workflow that holds a credential.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `.github/workflows/railway-bootstrap.yml` gained a second environment to target
 * in the `DASH.13` closeout, and with it a decision: which environment, whether it
 * was confirmed, which commit is being released. A decision expressed in YAML can
 * only be exercised by dispatching the workflow — which for this one means
 * exercising it against a real Railway account and a real bill. Its first genuine
 * execution would have been the release it was written to guard.
 *
 * So the decision lives in `scripts/railway/check_release_intent.mjs` and is tested
 * here, offline, across the combinations that actually matter. The cases that
 * REFUSE are the point: a guard is only worth having if somebody has watched it
 * say no.
 */
import { describe, expect, it } from 'vitest'

import { asBoolean, checkReleaseIntent } from '../../scripts/railway/check_release_intent.mjs'

/** A full 40-character SHA. `main` at the time this test was written. */
const SHA = '3c43012a22120f7a6a93fad115d7777ef51c310f'
const OTHER_SHA = 'c542f2e5118bec32b1c85bca3e609113a86b1dfd'

/** A valid production apply, which each test below then breaks in exactly one way. */
function productionApply(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'apply',
    targetEnvironment: 'production',
    confirmProduction: 'true',
    expectedReleaseSha: SHA,
    verifyOnly: 'false',
    workflowRef: 'refs/heads/main',
    checkedOutSha: SHA,
    ...overrides,
  }
}

describe('boolean inputs arrive as strings', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['  true  ', true],
    ['false', false],
    ['', false],
    [undefined, false],
    ['yes', false],
  ])('reads %o as %o', (value, expected) => {
    expect(asBoolean(value)).toBe(expected)
  })

  it('does not treat "yes" as consent', () => {
    // GitHub sends `true`/`false`. Anything else is a value this workflow does not
    // understand, and understanding it generously is how a production apply gets
    // confirmed by a string somebody typed into the wrong box.
    expect(asBoolean('yes')).toBe(false)
  })
})

describe('staging stays staging', () => {
  it('accepts an ordinary staging dry run', () => {
    const result = checkReleaseIntent({
      mode: 'dry-run',
      targetEnvironment: 'staging',
      confirmProduction: 'false',
      expectedReleaseSha: '',
      verifyOnly: 'false',
      workflowRef: 'refs/heads/main',
      checkedOutSha: SHA,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a staging apply from a branch', () => {
    // The main-only rule is a PRODUCTION rule. Staging is a preview environment and
    // converging it from a branch is a normal thing to want.
    const result = checkReleaseIntent({
      mode: 'apply',
      targetEnvironment: 'staging',
      confirmProduction: 'false',
      expectedReleaseSha: '',
      verifyOnly: 'false',
      workflowRef: 'refs/heads/claude/some-branch',
      checkedOutSha: SHA,
    })
    expect(result.ok).toBe(true)
  })

  it('REFUSES a staging run that was confirmed for production', () => {
    // The interesting direction. An operator who ticked the box believes they are
    // releasing production; running it against staging would report success for a
    // release that did not happen.
    const result = checkReleaseIntent({
      mode: 'apply',
      targetEnvironment: 'staging',
      confirmProduction: 'true',
      expectedReleaseSha: '',
      verifyOnly: 'false',
      workflowRef: 'refs/heads/main',
      checkedOutSha: SHA,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/confirm_production is true but target_environment/)
  })

  it('REFUSES a staging run that names a release SHA', () => {
    const result = checkReleaseIntent({
      mode: 'apply',
      targetEnvironment: 'staging',
      confirmProduction: 'false',
      expectedReleaseSha: SHA,
      verifyOnly: 'false',
      workflowRef: 'refs/heads/main',
      checkedOutSha: SHA,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/names the commit a PRODUCTION release/)
  })
})

describe('production is never reached by accident', () => {
  it('accepts a fully specified production apply', () => {
    expect(checkReleaseIntent(productionApply()).ok).toBe(true)
  })

  it('REFUSES production without confirm_production', () => {
    const result = checkReleaseIntent(productionApply({ confirmProduction: 'false' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/never the default and is never inferred/)
  })

  it('does not silently downgrade an unconfirmed production request to staging', () => {
    // The failure this refusal exists to prevent: a request for production that
    // quietly converges the other environment and reports success.
    const result = checkReleaseIntent(productionApply({ confirmProduction: 'false' }))
    expect(result.ok).toBe(false)
    expect(result.summary.join('\n')).toMatch(/target_environment {3}: production/)
  })

  it('REFUSES a production apply from a branch', () => {
    const result = checkReleaseIntent(
      productionApply({ workflowRef: 'refs/heads/claude/arpi-dash13-final-closeout' })
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/must be dispatched from main/)
  })

  it('REFUSES a production apply with no expected_release_sha', () => {
    const result = checkReleaseIntent(productionApply({ expectedReleaseSha: '' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/expected_release_sha is required/)
  })

  it('REFUSES an abbreviated expected_release_sha', () => {
    // Seven characters is enough to read and not enough to identify. Two commits
    // share a prefix often enough that this must not be a comparison.
    const result = checkReleaseIntent(productionApply({ expectedReleaseSha: '3c43012' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/full 40-character commit SHA/)
  })

  it('REFUSES when the release SHA is not the commit that was checked out', () => {
    const result = checkReleaseIntent(productionApply({ checkedOutSha: OTHER_SHA }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/is not the commit this run checked out/)
  })

  it('REFUSES an environment that is neither staging nor production', () => {
    // No aliasing and no case-folding. Each of these is a value the workflow does
    // not understand, and deciding which one somebody probably meant is how the
    // wrong environment gets converged.
    for (const target of ['prod', 'Production', 'PRODUCTION', 'prod-uction', '']) {
      const result = checkReleaseIntent(productionApply({ targetEnvironment: target }))
      expect(result.ok, `"${target}" must not be understood as production`).toBe(false)
    }
  })

  it('trims surrounding whitespace and normalises nothing else', () => {
    // The one normalisation that is safe, stated so the boundary is deliberate
    // rather than incidental: the value reaches this guard through an environment
    // variable, which is exactly where a trailing newline comes from.
    expect(checkReleaseIntent(productionApply({ targetEnvironment: ' production ' })).ok).toBe(
      true
    )
    expect(checkReleaseIntent(productionApply({ expectedReleaseSha: `${SHA}\n` })).ok).toBe(true)
  })

  it('allows a production DRY RUN without a release SHA', () => {
    // A dry run converges nothing, and requiring the release SHA to plan one would
    // push operators towards skipping the dry run — which is the step that makes an
    // apply safe.
    const result = checkReleaseIntent({
      mode: 'dry-run',
      targetEnvironment: 'production',
      confirmProduction: 'true',
      expectedReleaseSha: '',
      verifyOnly: 'false',
      workflowRef: 'refs/heads/main',
      checkedOutSha: SHA,
    })
    expect(result.ok).toBe(true)
    expect(result.summary.join('\n')).toMatch(/converges {12}: no/)
  })

  it('treats verify_only as non-mutating even when mode is apply', () => {
    const result = checkReleaseIntent(
      productionApply({ verifyOnly: 'true', expectedReleaseSha: '' })
    )
    expect(result.ok).toBe(true)
    expect(result.summary.join('\n')).toMatch(/converges {12}: no/)
  })
})

describe('the run summary says what will happen', () => {
  it('names the environment that would be converged', () => {
    expect(checkReleaseIntent(productionApply()).summary.join('\n')).toMatch(
      /converges {12}: YES — production/
    )
  })

  it('reports an unrecognised mode', () => {
    const result = checkReleaseIntent(productionApply({ mode: 'deploy' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/mode must be/)
  })
})
