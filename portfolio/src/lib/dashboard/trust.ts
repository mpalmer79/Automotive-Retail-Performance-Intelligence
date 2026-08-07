/**
 * The console's evidence state, in two lanes that never touch.
 *
 * WHY TWO LANES
 * -------------
 * The export lane and the Power BI lane answer different questions and are proved
 * by different artefacts, and merging them is how a console ends up claiming a
 * validation it has not had. `src/types/dashboard.ts` records the decision on the
 * data side: the client manifest carries no Power BI field at all, "because putting
 * a Power BI field here would create a second place a 'validated' claim could be
 * written". This module is the other half of that decision. The export lane reads
 * the dashboard manifest; the Power BI lane reads the ADR-0008 evidence through the
 * project manifest, which `scripts/generate-project-manifest.ts` builds from
 * `powerbi/validation/desktop_validation_results.json` and
 * `powerbi/validation/fabric_validation_results.json` and from nothing else.
 *
 * WHAT MAKES A FALSE CLAIM IMPOSSIBLE
 * -----------------------------------
 * {@link powerBiTrust} takes the evidence as an argument and returns a state. There
 * is no string in this file that says a validation passed; the only way `validated`
 * becomes true is for an evidence file to record `overall_result: "passed"`, and
 * `dashboard-trust.test.ts` drives the function with pending, stale, failed and
 * passed fixtures to prove each branch. Editing this module cannot close ADR-0008,
 * and editing the evidence is a separate, reviewed act — which is the point.
 *
 * Rendering a number in HTML proves nothing about a DAX measure. The console says
 * so on the page.
 */
import type { EngineValidation } from '@/types/manifest'

import type { DashboardClientManifest } from '@/types/dashboard'

/* -------------------------------------------------------------------------- */
/* The export lane                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The manifest as the trust panel reads it.
 *
 * `DashboardClientManifest` pins `stale` to the literal `false`, and correctly so:
 * `DATA_CONTRACT.md` §11 says CI never lets a stale artefact merge, and a type that
 * allowed `true` would invite a component to treat staleness as an ordinary runtime
 * condition. But the panel still has to be ABLE to render the state, and the e2e
 * suite still has to be able to force it with a deliberately corrupted fixture. So
 * the trust lane reads a widened view: the committed manifest is assignable to it,
 * and a fixture that says `stale: true` renders the warning it should.
 */
export type TrustManifest = Omit<DashboardClientManifest, 'stale'> & {
  readonly stale: boolean
}

/** How a single check reads on the panel. `pending` is never dressed as `pass`. */
export type TrustVerdict = 'pass' | 'fail' | 'pending'

export interface TrustCheck {
  readonly id: string
  readonly label: string
  /** The state, and the words beside it. Colour never carries the meaning alone. */
  readonly verdict: TrustVerdict
  readonly value: string
  readonly detail: string
}

export interface ExportTrust {
  readonly datasetVersion: number
  readonly contractVersion: number
  /** The first twelve characters of the contract digest. The staleness signal. */
  readonly contractFingerprint: string
  readonly asOfDate: string
  readonly generatedAt: string
  readonly sourceCommit: string
  readonly profile: string
  readonly randomSeed: number
  readonly pipelineRunUuid: string
  readonly stale: boolean
  readonly checks: readonly TrustCheck[]
  readonly sourceViews: readonly string[]
  readonly limitations: readonly string[]
}

/**
 * The export lane, read from the dashboard manifest and from nothing else.
 *
 * `DATA_CONTRACT.md` §11 is explicit that stale is a state and not a guess: "an
 * export generated a month ago whose contract has not changed is current". So no
 * wall-clock age appears here, and the panel shows `generatedAt` as provenance
 * rather than as freshness.
 */
export function exportTrust(manifest: TrustManifest): ExportTrust {
  const stale = manifest.stale === true
  const reconciliationPassed = manifest.reconciliationStatus === 'passed'
  const privacyPassed = manifest.privacyScanStatus === 'passed'
  const pipelinePassed = manifest.pipelineRunStatus === 'succeeded'

  const checks: TrustCheck[] = [
    {
      id: 'reconciliation',
      label: 'Export reconciliation',
      verdict: reconciliationPassed ? 'pass' : 'fail',
      value: reconciliationPassed
        ? `${manifest.reconciliationsEvaluated} of ${manifest.reconciliationsEvaluated} passed`
        : `${manifest.reconciliationsFailed} failed`,
      detail:
        'Every published total is an exact sum over an additive exported column, re-derived from the committed rows. A ratio publishes its numerator and denominator separately and no quotient.',
    },
    {
      id: 'privacy',
      label: 'Privacy scan',
      verdict: privacyPassed ? 'pass' : 'fail',
      value: manifest.privacyScanStatus,
      detail:
        'The exporter scans every column of every approved view against the prohibited-field list before writing a byte. No customer-grain dataset exists.',
    },
    {
      id: 'validation',
      label: 'Pipeline validation',
      verdict: manifest.validationCriticalFailures === 0 ? 'pass' : 'fail',
      value: `${manifest.validationCriticalFailures} critical, ${manifest.validationWarnings} warnings`,
      detail:
        'The warehouse run this export was taken from. A failing run cannot produce a passing export: the exporter refuses to run.',
    },
    {
      id: 'pipeline-run',
      label: 'Source pipeline run',
      verdict: pipelinePassed ? 'pass' : 'fail',
      value: manifest.pipelineRunStatus,
      detail: `Run ${manifest.pipelineRunUuid}, profile ${manifest.profile}, seed ${manifest.randomSeed}.`,
    },
    {
      id: 'freshness',
      label: 'Contract freshness',
      verdict: stale ? 'fail' : 'pass',
      value: stale ? 'Stale' : 'Current',
      detail: stale
        ? 'The declared contract digest no longer matches this export. The figures on this page describe a contract that has since changed.'
        : 'The contract digest recorded in the export matches the declared contract. Freshness is a contract comparison, not a wall-clock age.',
    },
    {
      id: 'synthetic',
      label: 'Synthetic data',
      verdict: manifest.syntheticData ? 'pass' : 'fail',
      value: 'Declared',
      detail:
        'Every warehouse record is machine generated from a seed. Granite Auto Group and its three stores are fictional.',
    },
  ]

  return {
    datasetVersion: manifest.datasetVersion,
    contractVersion: manifest.contractVersion,
    contractFingerprint: manifest.contractSha256.slice(0, 12),
    asOfDate: manifest.asOfDate,
    generatedAt: manifest.generatedAt,
    sourceCommit: manifest.sourceCommit,
    profile: manifest.profile,
    randomSeed: manifest.randomSeed,
    pipelineRunUuid: manifest.pipelineRunUuid,
    stale,
    checks,
    sourceViews: manifest.sourceViews,
    limitations: manifest.limitations,
  }
}

/** Whether every dashboard route must carry a reconciliation-failure banner. */
export function reconciliationFailed(manifest: TrustManifest): boolean {
  return manifest.reconciliationStatus !== 'passed'
}

/* -------------------------------------------------------------------------- */
/* The Power BI lane                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The verbatim ADR-0008 verdicts.
 *
 * `stale` is a real state and not an error: a model that was validated and then
 * edited has no valid evidence, and the freshness checker reports that rather than
 * letting the old PASSED stand.
 */
export type PowerBiResult = 'passed' | 'pending' | 'stale' | 'failed' | 'missing'

export interface PowerBiPath {
  readonly id: string
  readonly label: string
  /** The evidence file's own `overall_result`, lowercased. Never reinterpreted. */
  readonly result: PowerBiResult
  readonly validatedAt: string | null
  readonly evidencePath: string
  readonly procedurePath: string
  readonly note: string
}

export interface PowerBiTrust {
  /**
   * True only while an accepted path records `passed`.
   *
   * Nothing else in the console may assert Power BI validation, and no string in
   * this module claims it: this boolean is derived from the evidence and every
   * sentence the panel renders is chosen by it.
   */
  readonly validated: boolean
  /** The strongest state any accepted path reached. */
  readonly state: PowerBiResult
  /** The sentence the panel renders. Derived, never authored per state by a caller. */
  readonly claim: string
  readonly paths: readonly PowerBiPath[]
}

function normaliseResult(value: string): PowerBiResult {
  const text = value.trim().toLowerCase()
  if (text === 'passed' || text === 'pending' || text === 'stale' || text === 'failed') {
    return text
  }
  return 'missing'
}

/**
 * Merge the two accepted ADR-0008 paths into one state.
 *
 * Either path passing is sufficient; both are never required. The precedence below
 * is deliberately ordered so that nothing outranks a real failure except a real
 * pass, and `missing` never reads better than `pending`.
 */
export function powerBiTrust(engines: readonly EngineValidation[]): PowerBiTrust {
  const paths: PowerBiPath[] = engines.map((engine) => ({
    id: engine.id,
    label: engine.label,
    result: normaliseResult(engine.overallResult),
    validatedAt: engine.validatedAt,
    evidencePath: engine.evidencePath,
    procedurePath: engine.procedurePath,
    note: engine.note,
  }))

  const results = paths.map((path) => path.result)
  const validated = results.includes('passed')
  const state: PowerBiResult = validated
    ? 'passed'
    : results.includes('stale')
      ? 'stale'
      : results.includes('failed')
        ? 'failed'
        : results.includes('pending')
          ? 'pending'
          : 'missing'

  const claim = validated
    ? 'Real-engine validation recorded on an accepted ADR-0008 path. The semantic model has been opened, refreshed and compared against the SQL baseline by a Microsoft engine.'
    : state === 'stale'
      ? 'A real-engine validation was recorded and the semantic model has changed since. The evidence is stale, so no validation claim stands.'
      : state === 'failed'
        ? 'A real-engine validation ran and did not pass. The recorded differences are in the evidence file.'
        : 'Real-engine validation pending. Neither accepted ADR-0008 path has recorded a result, so nothing on this page may be read as evidence that the Power BI semantic model has been validated. This console renders exported SQL figures; rendering a number in HTML proves nothing about a DAX measure.'

  return { validated, state, claim, paths }
}

/**
 * The Gate 2 sentence, stated once.
 *
 * A constant rather than a derivation, because Gate 2's conditions are a documented
 * scope decision rather than a machine-readable state, and this console is
 * explicitly excluded from being evidence toward any of them (ADR-0013 condition 6).
 * `dashboard-trust.test.ts` pins the wording so it cannot soften by accident.
 */
export const GATE_2_STATEMENT =
  'Gate 2 remains CLOSED. This console publishes figures and deterministic rule outputs, never findings, recommendations or conclusions, and it may not be cited as Gate 2 evidence.'
