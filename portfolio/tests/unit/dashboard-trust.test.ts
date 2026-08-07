/**
 * The trust panel (`DASH.2-04`), and the one claim it must never be able to make.
 *
 * THE ASSERTION THIS FILE EXISTS FOR
 * ----------------------------------
 * `DASH.2-04`'s acceptance criteria: "a Power BI 'validated' claim is impossible
 * while evidence files say pending (unit-tested)". That is tested three ways here,
 * because one way is a coincidence:
 *
 *   1. Behaviourally — {@link powerBiTrust} is driven with pending, stale, failed
 *      and passed FIXTURES, and `validated` is asserted false in every case but the
 *      last.
 *   2. Against the real evidence — the committed
 *      `powerbi/validation/*_validation_results.json` files are read from disk and
 *      asserted to say `pending`, and the state the console derives from them is
 *      asserted to match.
 *   3. Structurally — no string in `trust.ts` claims a passing validation outside a
 *      branch guarded by the derived boolean, and the dashboard export manifest is
 *      asserted to carry no Power BI field at all, so there is no second place a
 *      claim could be written.
 *
 * NO REAL EVIDENCE IS TOUCHED. The alternative states are fixtures constructed in
 * this file. Editing `powerbi/validation/` to make a test pass would be editing the
 * thing under test.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { dashboardManifest } from '../../src/lib/dashboard/data.ts'
import {
  GATE_2_STATEMENT,
  exportTrust,
  powerBiTrust,
  reconciliationFailed,
  type TrustManifest,
} from '../../src/lib/dashboard/trust.ts'
import { engines } from '../../src/lib/manifest.ts'
import type { EngineValidation } from '../../src/types/manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')
const REPO = resolve(PORTFOLIO, '..')

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function engineFixture(
  id: 'desktop' | 'fabric',
  overallResult: string,
  validatedAt: string | null = null
): EngineValidation {
  return {
    id,
    label: id === 'desktop' ? 'Power BI Desktop' : 'Microsoft Fabric Service',
    overallResult,
    status: overallResult === 'passed' ? 'complete' : 'pending-external',
    validatedAt,
    passedCheckCount: overallResult === 'passed' ? 42 : 0,
    failedCheckCount: 0,
    note: `Fixture: ${overallResult}.`,
    evidencePath: `powerbi/validation/${id}_validation_results.json`,
    procedurePath: `docs/powerbi/${id.toUpperCase()}_HANDOFF.md`,
  }
}

const BOTH_PENDING = [
  engineFixture('desktop', 'pending'),
  engineFixture('fabric', 'pending'),
]

/** The committed dashboard manifest, widened for the states the panel must render. */
const manifest = dashboardManifest as unknown as TrustManifest

function manifestFixture(overrides: Partial<TrustManifest>): TrustManifest {
  return { ...manifest, ...overrides }
}

/* -------------------------------------------------------------------------- */
/* The export lane                                                             */
/* -------------------------------------------------------------------------- */

describe('the export lane reads the dashboard manifest and nothing else', () => {
  const state = exportTrust(manifest)

  it('carries the dataset identity a reader would quote', () => {
    expect(state.datasetVersion).toBe(manifest.datasetVersion)
    expect(state.contractVersion).toBe(manifest.contractVersion)
    expect(state.asOfDate).toBe(manifest.asOfDate)
    expect(state.profile).toBe(manifest.profile)
    expect(state.pipelineRunUuid).toBe(manifest.pipelineRunUuid)
  })

  it('publishes a short contract fingerprint rather than a 64-character digest', () => {
    expect(state.contractFingerprint).toHaveLength(12)
    expect(manifest.contractSha256.startsWith(state.contractFingerprint)).toBe(true)
  })

  it('reports the committed export as current, passing and private', () => {
    const verdicts = new Map(state.checks.map((check) => [check.id, check.verdict]))
    expect(verdicts.get('reconciliation')).toBe('pass')
    expect(verdicts.get('privacy')).toBe('pass')
    expect(verdicts.get('validation')).toBe('pass')
    expect(verdicts.get('pipeline-run')).toBe('pass')
    expect(verdicts.get('freshness')).toBe('pass')
    expect(verdicts.get('synthetic')).toBe('pass')
    expect(state.stale).toBe(false)
  })

  it('states every check in words as well as in a verdict', () => {
    for (const check of state.checks) {
      expect(check.label.length, check.id).toBeGreaterThan(3)
      expect(check.value.length, check.id).toBeGreaterThan(0)
      expect(check.detail.length, check.id).toBeGreaterThan(40)
    }
  })

  it('carries the reconciliation count the export actually evaluated', () => {
    const reconciliation = state.checks.find((check) => check.id === 'reconciliation')
    expect(reconciliation?.value).toContain(String(manifest.reconciliationsEvaluated))
  })

  it('lists the approved reporting views and no other schema', () => {
    expect(state.sourceViews.length).toBeGreaterThan(10)
    for (const view of state.sourceViews) {
      expect(view.startsWith('reporting.'), view).toBe(true)
    }
  })

  it('carries the export limitations rather than a hand-written caveat', () => {
    expect(state.limitations).toEqual(manifest.limitations)
    expect(state.limitations.some((line) => line.includes('SYNTHETIC DATA'))).toBe(true)
  })
})

describe('the stale state', () => {
  it('renders as a failure when the manifest reports one', () => {
    const state = exportTrust(manifestFixture({ stale: true }))
    expect(state.stale).toBe(true)
    const freshness = state.checks.find((check) => check.id === 'freshness')
    expect(freshness?.verdict).toBe('fail')
    expect(freshness?.value).toBe('Stale')
    expect(freshness?.detail).toContain('no longer matches')
  })

  it('is a contract comparison, never a wall-clock age', () => {
    const state = exportTrust(manifest)
    const freshness = state.checks.find((check) => check.id === 'freshness')
    expect(freshness?.detail).toContain('not a wall-clock age')
    // Nothing in the panel's own source reads the clock to decide freshness.
    const source = readFileSync(join(PORTFOLIO, 'src/lib/dashboard/trust.ts'), 'utf8')
    expect(source.includes('Date.now()')).toBe(false)
    expect(source.includes('new Date(')).toBe(false)
  })
})

describe('the reconciliation-failure state', () => {
  it('is false for the committed export', () => {
    expect(reconciliationFailed(manifest)).toBe(false)
  })

  it('is true for a fixture whose reconciliation did not pass', () => {
    const failed = manifestFixture({
      reconciliationStatus: 'failed',
      reconciliationsFailed: 3,
    })
    expect(reconciliationFailed(failed)).toBe(true)
    const state = exportTrust(failed)
    const check = state.checks.find((entry) => entry.id === 'reconciliation')
    expect(check?.verdict).toBe('fail')
    expect(check?.value).toContain('3')
  })

  it('reports a failing privacy scan as a failure rather than as a warning', () => {
    const state = exportTrust(manifestFixture({ privacyScanStatus: 'failed' }))
    expect(state.checks.find((check) => check.id === 'privacy')?.verdict).toBe('fail')
  })

  it('reports critical validation failures as a failure', () => {
    const state = exportTrust(manifestFixture({ validationCriticalFailures: 2 }))
    expect(state.checks.find((check) => check.id === 'validation')?.verdict).toBe('fail')
  })
})

/* -------------------------------------------------------------------------- */
/* The Power BI lane                                                           */
/* -------------------------------------------------------------------------- */

describe('a Power BI validated claim is impossible while the evidence says pending', () => {
  it('derives `validated` false when both accepted paths are pending', () => {
    const trust = powerBiTrust(BOTH_PENDING)
    expect(trust.validated).toBe(false)
    expect(trust.state).toBe('pending')
  })

  it('renders a claim that says pending, and says why a rendered number is not proof', () => {
    const trust = powerBiTrust(BOTH_PENDING)
    expect(trust.claim).toContain('pending')
    expect(trust.claim).toContain('rendering a number in HTML proves nothing')
    // The sentence DOES contain the phrase "has been validated", inside a negation:
    // "nothing on this page may be read as evidence that the model has been
    // validated". So the assertion is on the affirmative form the passed branch uses,
    // not on a substring that a correct denial legitimately contains.
    expect(trust.claim).not.toContain('Real-engine validation recorded')
    expect(trust.claim.startsWith('Real-engine validation pending.')).toBe(true)
  })

  it('cannot be talked into a pass by any non-passing verdict', () => {
    for (const verdict of [
      'pending',
      'stale',
      'failed',
      'missing',
      '',
      'PASSING',
      'ok',
    ]) {
      const trust = powerBiTrust([
        engineFixture('desktop', verdict),
        engineFixture('fabric', verdict),
      ])
      expect(trust.validated, verdict).toBe(false)
      expect(trust.claim.startsWith('Real-engine validation recorded'), verdict).toBe(
        false
      )
    }
  })

  it('reports STALE rather than passed when a validated model has since changed', () => {
    const trust = powerBiTrust([
      engineFixture('desktop', 'stale', '2026-01-01T00:00:00Z'),
      engineFixture('fabric', 'pending'),
    ])
    expect(trust.validated).toBe(false)
    expect(trust.state).toBe('stale')
    expect(trust.claim).toContain('stale')
  })

  it('reports FAILED rather than pending when a run did not pass', () => {
    const trust = powerBiTrust([
      engineFixture('desktop', 'failed'),
      engineFixture('fabric', 'pending'),
    ])
    expect(trust.validated).toBe(false)
    expect(trust.state).toBe('failed')
  })

  it('reports PASSED on a passing fixture, so the negative results are not vacuous', () => {
    const trust = powerBiTrust([
      engineFixture('desktop', 'pending'),
      engineFixture('fabric', 'passed', '2026-03-01T09:00:00Z'),
    ])
    expect(trust.validated).toBe(true)
    expect(trust.state).toBe('passed')
    expect(trust.claim).toContain('Real-engine validation recorded')
  })

  it('accepts either path, because ADR-0008 never requires both', () => {
    expect(powerBiTrust([engineFixture('desktop', 'passed')]).validated).toBe(true)
    expect(powerBiTrust([engineFixture('fabric', 'passed')]).validated).toBe(true)
  })

  it('normalises the verdict from the file without reinterpreting it', () => {
    const trust = powerBiTrust([
      engineFixture('desktop', ' PENDING '),
      engineFixture('fabric', 'pending'),
    ])
    expect(trust.paths[0]?.result).toBe('pending')
  })

  it('links each path to its own evidence file and its own procedure', () => {
    const trust = powerBiTrust(BOTH_PENDING)
    expect(trust.paths).toHaveLength(2)
    for (const path of trust.paths) {
      expect(path.evidencePath).toContain('powerbi/validation/')
      expect(path.procedurePath.length).toBeGreaterThan(0)
    }
  })
})

describe('the console reads the real ADR-0008 evidence, unaltered', () => {
  const desktop = JSON.parse(
    readFileSync(join(REPO, 'powerbi/validation/desktop_validation_results.json'), 'utf8')
  ) as { overall_result: string; validated_at: string | null }
  const fabric = JSON.parse(
    readFileSync(join(REPO, 'powerbi/validation/fabric_validation_results.json'), 'utf8')
  ) as { overall_result: string; validated_at: string | null }

  it('finds both accepted paths recorded as pending on disk', () => {
    expect(desktop.overall_result).toBe('pending')
    expect(desktop.validated_at).toBeNull()
    expect(fabric.overall_result).toBe('pending')
    expect(fabric.validated_at).toBeNull()
  })

  it('renders exactly that state, with no validated claim anywhere', () => {
    const trust = powerBiTrust(engines)
    expect(trust.validated).toBe(false)
    expect(trust.state).toBe('pending')
    expect(trust.paths.map((path) => path.result)).toEqual(['pending', 'pending'])
  })

  it('agrees with the project manifest the rest of the site renders', () => {
    // One derivation, two consumers. The status page and the console cannot
    // disagree about whether a Microsoft engine has looked at the model.
    for (const engine of engines) {
      expect(engine.overallResult).toBe('pending')
      expect(engine.status).toBe('pending-external')
    }
  })
})

describe('there is no second place a Power BI claim could be written', () => {
  it('finds no Power BI field in the dashboard export manifest', () => {
    const keys = Object.keys(dashboardManifest as unknown as Record<string, unknown>)
    for (const key of keys) {
      expect(key.toLowerCase().includes('powerbi'), key).toBe(false)
      expect(key.toLowerCase().includes('dax'), key).toBe(false)
    }
  })

  it('finds no Power BI field in the committed generated manifest file', () => {
    const raw = readFileSync(
      join(PORTFOLIO, 'src/generated/dashboard/manifest.json'),
      'utf8'
    )
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(parsed).some((key) => /power.?bi/i.test(key))).toBe(false)
  })

  it('derives the panel state from the evidence rather than from a constant', () => {
    const source = readFileSync(join(PORTFOLIO, 'src/lib/dashboard/trust.ts'), 'utf8')
    // `validated` is computed, once, from the normalised results.
    expect(source).toContain("const validated = results.includes('passed')")
    // Nothing assigns it a literal.
    expect(/validated\s*[:=]\s*true/.test(source)).toBe(false)
  })

  it('never lets the trust panel component decide the claim for itself', () => {
    const panel = readFileSync(
      join(PORTFOLIO, 'src/components/dashboard/trust-panel.tsx'),
      'utf8'
    )
    // The component renders `state.claim` and branches on `state.validated`; it
    // does not carry a sentence of its own about validation having happened.
    expect(panel).toContain('{state.claim}')
    expect(panel.includes('Real-engine validation recorded on an accepted')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Gate 2                                                                      */
/* -------------------------------------------------------------------------- */

describe('Gate 2 language', () => {
  it('states that the gate is closed, in the words the project uses', () => {
    expect(GATE_2_STATEMENT).toContain('Gate 2 remains CLOSED')
    expect(GATE_2_STATEMENT).toContain('never findings, recommendations or conclusions')
    expect(GATE_2_STATEMENT).toContain('may not be cited as Gate 2 evidence')
  })

  it('is rendered by the panel rather than restated in it', () => {
    const panel = readFileSync(
      join(PORTFOLIO, 'src/components/dashboard/trust-panel.tsx'),
      'utf8'
    )
    expect(panel).toContain('GATE_2_STATEMENT')
  })

  it('is not softened by the surrounding copy', () => {
    const panel = readFileSync(
      join(PORTFOLIO, 'src/components/dashboard/trust-panel.tsx'),
      'utf8'
    )
    for (const softener of [
      'nearly closed',
      'effectively closed',
      'about to close',
      'unblocked',
    ]) {
      expect(panel.toLowerCase().includes(softener), softener).toBe(false)
    }
  })

  it('agrees with the project manifest, which holds the gate itself', () => {
    // The console never computes the gate; it restates it. The manifest is the one
    // place the gate's verdict is derived, and `/status` renders that.
    const manifestJson = JSON.parse(
      readFileSync(join(PORTFOLIO, 'src/generated/project-manifest.json'), 'utf8')
    ) as { gates: { id: string; status: string }[] }
    const gate2 = manifestJson.gates.find((gate) => gate.id === 'gate-2')
    expect(gate2).toBeDefined()
    expect(gate2?.status).not.toBe('complete')
  })
})
