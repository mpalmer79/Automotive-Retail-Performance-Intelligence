/**
 * The case-study gate, tested as a function.
 *
 * The browser suite checks that the LOCKED page renders correctly. This suite
 * checks the gate's LOGIC across every combination of its five conditions,
 * including the ones the repository cannot currently produce - specifically, that
 * setting the environment flag while the repository evidence is absent does not
 * unlock anything.
 *
 * That case is the whole point of the control and it is the one a browser test
 * cannot reach, because reaching it would mean committing a fake Gate 2 verdict.
 *
 * Enforces control C1 in
 * docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md.
 */
import { describe, expect, it } from 'vitest'

import manifest from '@/generated/project-manifest.json'

/**
 * The gate, reimplemented from its specification.
 *
 * Deliberately a second implementation rather than an import of the generator's
 * copy. The generator runs in Node with filesystem access and cannot be imported
 * into a jsdom test without dragging its whole read path along; and a test that
 * imported the same expression it is checking would only prove that the
 * expression equals itself. Writing it out from the ADR means the two must agree,
 * and `agrees with the generated manifest` below is what enforces that.
 */
interface GateInputs {
  flagEnabled: boolean
  readinessDocumentExists: boolean
  gate2Verdict: 'OPEN' | 'CLOSED' | null
  requiredContentPresent: boolean
  requiredScreenshotsPresent: boolean
}

function caseStudyUnlocks(inputs: GateInputs): boolean {
  return (
    inputs.flagEnabled &&
    inputs.readinessDocumentExists &&
    inputs.gate2Verdict === 'OPEN' &&
    inputs.requiredContentPresent &&
    inputs.requiredScreenshotsPresent
  )
}

const ALL_MET: GateInputs = {
  flagEnabled: true,
  readinessDocumentExists: true,
  gate2Verdict: 'OPEN',
  requiredContentPresent: true,
  requiredScreenshotsPresent: true,
}

describe('the case-study gate', () => {
  it('unlocks only when all five conditions hold', () => {
    expect(caseStudyUnlocks(ALL_MET)).toBe(true)
  })

  it('stays locked when any single condition fails', () => {
    const singleFailures: [string, GateInputs][] = [
      ['the build flag is off', { ...ALL_MET, flagEnabled: false }],
      ['no readiness document exists', { ...ALL_MET, readinessDocumentExists: false }],
      ['the Gate 2 verdict is CLOSED', { ...ALL_MET, gate2Verdict: 'CLOSED' }],
      ['the Gate 2 verdict is unparseable', { ...ALL_MET, gate2Verdict: null }],
      ['the content file is missing', { ...ALL_MET, requiredContentPresent: false }],
      ['no screenshot exists', { ...ALL_MET, requiredScreenshotsPresent: false }],
    ]

    for (const [description, inputs] of singleFailures) {
      expect(caseStudyUnlocks(inputs), `unlocked even though ${description}`).toBe(false)
    }
  })

  /**
   * The property that matters most. The environment flag is the only input an
   * operator can change without committing anything, so it must be incapable of
   * unlocking the page on its own.
   */
  it('cannot be unlocked by the environment flag alone', () => {
    const repositoryStates: Omit<GateInputs, 'flagEnabled'>[] = [
      {
        readinessDocumentExists: false,
        gate2Verdict: null,
        requiredContentPresent: false,
        requiredScreenshotsPresent: false,
      },
      {
        readinessDocumentExists: true,
        gate2Verdict: 'CLOSED',
        requiredContentPresent: false,
        requiredScreenshotsPresent: false,
      },
      {
        readinessDocumentExists: true,
        gate2Verdict: 'OPEN',
        requiredContentPresent: false,
        requiredScreenshotsPresent: false,
      },
      {
        readinessDocumentExists: true,
        gate2Verdict: 'OPEN',
        requiredContentPresent: true,
        requiredScreenshotsPresent: false,
      },
    ]

    for (const state of repositoryStates) {
      expect(
        caseStudyUnlocks({ ...state, flagEnabled: true }),
        `the flag unlocked the page against ${JSON.stringify(state)}`
      ).toBe(false)
    }
  })

  it('is a pure conjunction: the flag can only ever withhold', () => {
    // For every repository state, turning the flag ON must never produce a
    // different result from the conjunction of the other four - and turning it
    // OFF must always lock. That is what "necessary and never sufficient" means.
    const booleans = [true, false]
    for (const readinessDocumentExists of booleans) {
      for (const gate2Verdict of ['OPEN', 'CLOSED', null] as const) {
        for (const requiredContentPresent of booleans) {
          for (const requiredScreenshotsPresent of booleans) {
            const repository = {
              readinessDocumentExists,
              gate2Verdict,
              requiredContentPresent,
              requiredScreenshotsPresent,
            }
            expect(caseStudyUnlocks({ ...repository, flagEnabled: false })).toBe(false)

            const evidenceComplete =
              readinessDocumentExists &&
              gate2Verdict === 'OPEN' &&
              requiredContentPresent &&
              requiredScreenshotsPresent
            expect(caseStudyUnlocks({ ...repository, flagEnabled: true })).toBe(
              evidenceComplete
            )
          }
        }
      }
    }
  })

  it('agrees with the generated manifest for the repository as it stands', () => {
    // The generator's own computation, cross-checked against this independent
    // reimplementation. If the two ever disagree, one of them has drifted from
    // ADR-0009 and the build should not be trusted.
    const gate2 = manifest.gates.find((g) => g.id === 'gate-2')
    // The manifest is imported as JSON, so `verdict` widens to `string`. Narrowing
    // it here rather than casting keeps an unexpected third value from silently
    // being treated as OPEN.
    const verdict =
      gate2?.verdict === 'OPEN' || gate2?.verdict === 'CLOSED' ? gate2.verdict : null
    const reimplemented = caseStudyUnlocks({
      flagEnabled: manifest.caseStudy.flagEnabled,
      readinessDocumentExists: manifest.caseStudy.readinessDocumentExists,
      gate2Verdict: verdict,
      requiredContentPresent: manifest.caseStudy.requiredContentPresent,
      requiredScreenshotsPresent: manifest.caseStudy.requiredScreenshotsPresent,
    })
    expect(reimplemented).toBe(manifest.caseStudy.unlocked)
  })

  it('is currently locked, and names every unmet condition', () => {
    expect(manifest.caseStudy.unlocked).toBe(false)
    expect(manifest.caseStudy.blockingReasons.length).toBeGreaterThan(0)
    for (const reason of manifest.caseStudy.blockingReasons) {
      // A reason has to be specific enough to act on.
      expect(reason.length).toBeGreaterThan(30)
      expect(reason).not.toMatch(/coming soon|work in progress|stay tuned/i)
    }
  })

  it('names no date anywhere in its blocking reasons', () => {
    for (const reason of manifest.caseStudy.blockingReasons) {
      expect(reason).not.toMatch(/\b20\d{2}\b/)
      expect(reason).not.toMatch(/\bQ[1-4]\b/)
    }
  })
})
