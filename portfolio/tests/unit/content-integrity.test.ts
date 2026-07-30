/**
 * Content-integrity tests.
 *
 * These are the most important tests in this project's frontend. Every other
 * suite checks that the site works; this one checks that it is not lying.
 *
 * Each test corresponds to a specific way the site could drift from the
 * repository's evidence, and each of those was chosen because it is the kind of
 * drift that happens quietly: a count that nobody re-derived, a status that was
 * true last month, a gate that was opened in one file and forgotten in another.
 *
 * Enforces controls C2, C3 and C5 in
 * docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import manifest from '@/generated/project-manifest.json'
import kpis from '@/content/kpis.json'
import dataModel from '@/content/data-model.json'

const PORTFOLIO = resolve(__dirname, '../..')
const REPO = resolve(PORTFOLIO, '..')

function repoJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(REPO, relative), 'utf8')) as T
}

function repoText(relative: string): string {
  return readFileSync(join(REPO, relative), 'utf8')
}

/** Every .ts/.tsx file under src/, excluding the generated manifest. */
function sourceFiles(dir = join(PORTFOLIO, 'src')): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'generated') continue
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}

const expectations = repoJson<{
  table_count: number
  imported_table_count: number
  measure_table_count: number
  relationship_count: number
  active_relationship_count: number
  inactive_relationship_count: number
  bidirectional_relationship_count: number
  measure_count: number
  kpi_measure_count: number
  supporting_measure_count: number
  measure_map: Record<string, string>
  expected_row_counts: Record<string, number>
}>('powerbi/validation/model_expectations.json')

const baseline = repoJson<{
  reporting_view_count: number
  reconciliations: { total: number; failing: number }
  random_seed: number
  profile: string
}>('powerbi/validation/sql_baseline_metadata.json')

const desktop = repoJson<{ overall_result: string }>(
  'powerbi/validation/desktop_validation_results.json'
)
const fabric = repoJson<{ overall_result: string }>(
  'powerbi/validation/fabric_validation_results.json'
)

/* -------------------------------------------------------------------------- */

describe('every displayed count traces to repository evidence', () => {
  it('matches the semantic model register exactly', () => {
    expect(manifest.counts.semanticTables.value).toBe(expectations.table_count)
    expect(manifest.counts.importedTables.value).toBe(expectations.imported_table_count)
    expect(manifest.counts.measureTables.value).toBe(expectations.measure_table_count)
    expect(manifest.counts.semanticRelationships.value).toBe(
      expectations.relationship_count
    )
    expect(manifest.counts.daxMeasures.value).toBe(expectations.measure_count)
    expect(manifest.counts.governedKpis.value).toBe(expectations.kpi_measure_count)
    expect(manifest.counts.supportingMeasures.value).toBe(
      expectations.supporting_measure_count
    )
  })

  it('matches the SQL baseline metadata exactly', () => {
    expect(manifest.counts.reportingViews.value).toBe(baseline.reporting_view_count)
    expect(manifest.counts.reconciliations.value).toBe(baseline.reconciliations.total)
    expect(manifest.dataset.randomSeed).toBe(baseline.random_seed)
    expect(manifest.dataset.profile).toBe(baseline.profile)
  })

  it('derives the relationship count from the TMDL itself, not only the register', () => {
    const tmdl = repoText(
      'powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel/definition/relationships.tmdl'
    )
    const defined = (tmdl.match(/^relationship\s+/gm) ?? []).length
    expect(defined).toBe(manifest.counts.semanticRelationships.value)
  })

  it('derives the measure count from the TMDL itself', () => {
    const dir =
      'powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel/definition/tables'
    const files = readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.tmdl'))
    const total = files.reduce(
      (sum, file) =>
        sum + (repoText(join(dir, file)).match(/^\s{0,4}measure\s+/gm) ?? []).length,
      0
    )
    expect(total).toBe(manifest.counts.daxMeasures.value)
  })

  it('counts the eight dimensions and five facts from the DDL on disk', () => {
    const dims = readdirSync(join(REPO, 'sql/03_dimensions')).filter(
      (f) => f.endsWith('.sql') && !f.includes('_merge')
    ).length
    const facts = readdirSync(join(REPO, 'sql/04_facts')).filter(
      (f) => f.endsWith('.sql') && !f.includes('_load')
    ).length
    expect(manifest.counts.dimensions.value).toBe(dims)
    expect(manifest.counts.facts.value).toBe(facts)
    expect(dims).toBe(8)
    expect(facts).toBe(5)
  })

  it('gives every count at least one source path that exists', () => {
    for (const [key, count] of Object.entries(manifest.counts)) {
      expect(count.sources.length, `${key} has no recorded source`).toBeGreaterThan(0)
      for (const source of count.sources) {
        expect(
          () => statSync(join(REPO, source.path)),
          `${key} cites ${source.path}, which does not exist`
        ).not.toThrow()
      }
    }
  })

  it('gives every evidence record a source path that exists', () => {
    for (const record of manifest.evidence) {
      expect(record.sources.length, `${record.id} has no source`).toBeGreaterThan(0)
      for (const source of record.sources) {
        expect(
          () => statSync(join(REPO, source.path)),
          `${record.id} cites ${source.path}, which does not exist`
        ).not.toThrow()
      }
    }
  })
})

describe('no component hardcodes a project count', () => {
  /**
   * The scan looks for a count's VALUE and its own LABEL in the same file.
   *
   * A bare numeric scan does not work and was tried first: 28 is a motion
   * distance token, 42 is an SVG x-coordinate, 104 is an SVG y-coordinate, and
   * every one of those is legitimate. Requiring the label as well makes the
   * check precise - `<span>42</span> Semantic relationships` is caught,
   * `x={42 + index * 6}` in a diagram is not - and a precise check is one that
   * stays enabled instead of being commented out after its third false positive.
   *
   * Enforces control C2 in ADR-0009.
   */
  const CHECKS = Object.entries(manifest.counts).map(([key, count]) => ({
    key,
    value: count.value,
    label: count.label,
  }))

  it.each(CHECKS)('reads $key from the manifest rather than writing $value', (check) => {
    const offenders: string[] = []
    const value = String(check.value)

    // A count is a defect only where it would be RENDERED. Two positions do
    // that: JSX text between tags, and a bare `{42}` expression child. A number
    // inside a class name, an SVG attribute, an object key, a font size or an
    // arithmetic expression is not a claim about the project, and matching those
    // is what made the first version of this check unusable.
    const asJsxText = new RegExp(
      `>[^<>{}]{0,80}(^|[^\\w.-])${value}([^\\w.%-]|$)[^<>{}]{0,80}<`
    )
    // Anchored on `>` so it matches a JSX CHILD (`>{42}<`) and not an attribute
    // value (`height={5}`), which is geometry rather than a claim.
    const asExpressionChild = new RegExp(`>\\s*\\{\\s*${value}\\s*\\}`)

    for (const file of sourceFiles()) {
      if (file.includes('/content/') || file.includes('/types/')) continue
      const body = readFileSync(file, 'utf8')
      // Only files that also mention the count's subject can plausibly be
      // presenting it, which removes the remaining coincidences.
      const labelWords = check.label.toLowerCase().split(/\s+/)
      const keyword = labelWords[labelWords.length - 1] ?? check.label.toLowerCase()
      if (!body.toLowerCase().includes(keyword)) continue

      for (const line of body.split('\n')) {
        const trimmed = line.trim()
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          continue
        }
        if (asJsxText.test(line) || asExpressionChild.test(line)) {
          offenders.push(`${file.replace(PORTFOLIO, '.')}: ${trimmed.slice(0, 90)}`)
        }
      }
    }

    expect(
      offenders,
      `${check.key} (${value} "${check.label}") appears as a rendered literal. ` +
        `Read it from the project manifest instead:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})

describe('status claims match current evidence', () => {
  const enginePassed = (result: string) => result.toLowerCase() === 'passed'
  const anyEnginePassed =
    enginePassed(desktop.overall_result) || enginePassed(fabric.overall_result)

  it('never emits Lifecycle Phase 5 as complete while both engines are pending', () => {
    const phase5 = manifest.lifecyclePhases.find((p) => p.number === 5)
    expect(phase5).toBeDefined()
    if (!anyEnginePassed) {
      expect(phase5?.status).not.toBe('complete')
    }
  })

  it('mirrors each engine evidence file verbatim', () => {
    const desktopEntry = manifest.engines.find((e) => e.id === 'desktop')
    const fabricEntry = manifest.engines.find((e) => e.id === 'fabric')
    expect(desktopEntry?.overallResult).toBe(desktop.overall_result)
    expect(fabricEntry?.overallResult).toBe(fabric.overall_result)
  })

  it('never renders a pending engine result as a pass', () => {
    for (const engine of manifest.engines) {
      if (!enginePassed(engine.overallResult)) {
        expect(engine.status).not.toBe('complete')
        expect(engine.validatedAt).toBeNull()
      }
    }
  })

  it('reports the semantic model as real-engine validated only when one has passed', () => {
    if (!anyEnginePassed) {
      expect(manifest.semanticModel.realEngineStatus).toBe('pending-external')
    }
  })

  it('reports P2.2 as blocked while no engine has passed', () => {
    const p22 = manifest.increments.find((i) => i.id === 'P2.2')
    if (!anyEnginePassed) {
      expect(p22?.status).toBe('blocked')
    }
  })

  it('leaves P2.4 and Lifecycle Phase 8 incomplete', () => {
    const p24 = manifest.increments.find((i) => i.id === 'P2.4')
    const phase8 = manifest.lifecyclePhases.find((p) => p.number === 8)
    expect(p24?.status).not.toBe('complete')
    expect(phase8?.status).not.toBe('complete')
  })

  it('reports zero dashboard pages while the report project is a shell', () => {
    const pagesDir = join(
      REPO,
      'powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.Report/definition/pages'
    )
    let pagesExist = false
    try {
      pagesExist = readdirSync(pagesDir).length > 0
    } catch {
      pagesExist = false
    }
    if (!pagesExist) {
      expect(manifest.semanticModel.dashboardPageCount).toBe(0)
    }
  })
})

describe('Gate 2 and the case-study lock', () => {
  it('records Gate 2 as CLOSED while no readiness document records OPEN', () => {
    const gate2 = manifest.gates.find((g) => g.id === 'gate-2')
    expect(gate2).toBeDefined()
    let readinessOpen = false
    try {
      const body = repoText('docs/requirements/GATE_2_READINESS.md')
      readinessOpen = /Gate\s*2\s*verdict[\s\S]{0,160}?\bOPEN\b/i.test(body)
    } catch {
      readinessOpen = false
    }
    if (!readinessOpen) expect(gate2?.verdict).toBe('CLOSED')
  })

  it('never unlocks the case study while Gate 2 is closed', () => {
    if (!manifest.caseStudy.gate2Open) {
      expect(manifest.caseStudy.unlocked).toBe(false)
    }
  })

  it('requires the flag AND the repository evidence, not either', () => {
    const c = manifest.caseStudy
    if (c.unlocked) {
      expect(c.flagEnabled).toBe(true)
      expect(c.readinessDocumentExists).toBe(true)
      expect(c.gate2Open).toBe(true)
      expect(c.requiredContentPresent).toBe(true)
      expect(c.requiredScreenshotsPresent).toBe(true)
    }
  })

  it('states a blocking reason for every locked state, and none when unlocked', () => {
    expect(manifest.caseStudy.blockingReasons.length === 0).toBe(
      manifest.caseStudy.unlocked
    )
  })

  it('marks each Gate 2 condition unmet while the gate is closed', () => {
    const gate2 = manifest.gates.find((g) => g.id === 'gate-2')
    if (gate2?.verdict === 'CLOSED') {
      expect(gate2.conditions.every((c) => c.met)).toBe(false)
      for (const condition of gate2.conditions) {
        expect(condition.evidence.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('the authored content files agree with the repository', () => {
  it('holds exactly the governed KPI set', () => {
    expect(kpis.kpis).toHaveLength(expectations.kpi_measure_count)
    const catalogue = repoText('KPI_CATALOG.md')
    for (const kpi of kpis.kpis) {
      expect(catalogue, `${kpi.id} is not defined in KPI_CATALOG.md`).toContain(kpi.id)
      expect(expectations.measure_map[kpi.id]).toBe(kpi.measureName)
    }
  })

  it('gives every KPI both sides of its ratio', () => {
    for (const kpi of kpis.kpis) {
      expect(kpi.numerator.length, `${kpi.id} has no numerator`).toBeGreaterThan(5)
      expect(kpi.denominator.length, `${kpi.id} has no denominator`).toBeGreaterThan(5)
    }
  })

  it('gives every KPI an interpretation caution and a null rule', () => {
    for (const kpi of kpis.kpis) {
      expect(kpi.caution.length, `${kpi.id} has no caution`).toBeGreaterThan(20)
      expect(kpi.nullBehaviour.length, `${kpi.id} has no null rule`).toBeGreaterThan(10)
    }
  })

  it('never labels a deferred metric as implemented', () => {
    for (const entry of kpis.deferred) {
      expect(entry.status).toBe('deferred')
    }
    // The four deferred subjects must not appear as an implemented KPI.
    const deferredSubjects =
      /F&I|penetration|retention|service-to-sales|target attainment/i
    for (const kpi of kpis.kpis) {
      expect(
        deferredSubjects.test(kpi.name),
        `${kpi.id} "${kpi.name}" names a deferred subject but is marked implemented`
      ).toBe(false)
    }
  })

  it('describes exactly the entities the warehouse builds', () => {
    const dims = dataModel.entities.filter((e) => e.kind === 'dimension')
    const facts = dataModel.entities.filter((e) => e.kind === 'fact')
    expect(dims).toHaveLength(manifest.counts.dimensions.value)
    expect(facts).toHaveLength(manifest.counts.facts.value)
    expect(dataModel.relationships).toHaveLength(
      manifest.counts.semanticRelationships.value
    )
  })

  it('gives every entity a declared grain and a privacy classification', () => {
    for (const entity of dataModel.entities) {
      expect(entity.grain.length, `${entity.id} has no grain`).toBeGreaterThan(5)
      expect(
        entity.piiClassification.length,
        `${entity.id} has no privacy classification`
      ).toBeGreaterThan(5)
      expect(entity.primaryKey.length, `${entity.id} has no primary key`).toBeGreaterThan(
        1
      )
    }
  })

  it('points every entity at a reporting view the semantic model imports', () => {
    for (const entity of dataModel.entities) {
      const view = entity.reportingView.replace(/^reporting\./, '')
      expect(
        Object.hasOwn(expectations.expected_row_counts, view),
        `${entity.id} points at ${entity.reportingView}, which the model does not import`
      ).toBe(true)
    }
  })

  it('agrees with the model register on active and inactive relationships', () => {
    const active = dataModel.relationships.filter((r) => r.active).length
    const inactive = dataModel.relationships.length - active
    expect(active).toBe(expectations.active_relationship_count)
    expect(inactive).toBe(expectations.inactive_relationship_count)
  })

  it('contains no bidirectional relationship', () => {
    expect(expectations.bidirectional_relationship_count).toBe(0)
    expect(manifest.semanticModel.bidirectionalRelationships).toBe(0)
  })

  it('holds no record-level personal data', () => {
    /**
     * The privacy field must describe a POLICY, never carry an example value.
     * These patterns are what a leaked example would look like.
     */
    const looksPersonal = [
      /\b\d{3}-\d{2}-\d{4}\b/, // a government identifier
      /\b[\w.]+@[\w.]+\.\w{2,}\b/, // an email address
      /\b\d{3}[.\s-]\d{3}[.\s-]\d{4}\b/, // a phone number
      /\b\d{4}-\d{2}-\d{2}\b[^"]{0,40}birth/i, // a birth date beside a person field
      /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|Road|Avenue|Lane|Drive)\b/, // a street address
    ]
    const serialised = JSON.stringify(dataModel)
    for (const pattern of looksPersonal) {
      expect(
        pattern.test(serialised),
        `data-model.json matches ${String(pattern)} - a privacy field must state a policy, never an example`
      ).toBe(false)
    }
  })
})

describe('the manifest carries no secret', () => {
  const SECRET_PATTERNS: [RegExp, string][] = [
    [/postgres(?:ql)?:\/\/[^\s"]*:[^\s"@]+@/i, 'a connection string with a password'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, 'a bearer token'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'a JWT'],
    [
      /\b(?:password|passwd|secret|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"',}]{6,}/i,
      'a credential assignment',
    ],
  ]

  it.each(SECRET_PATTERNS)('does not contain %s', (pattern) => {
    expect(pattern.test(JSON.stringify(manifest))).toBe(false)
  })

  it('does not contain one in the authored content either', () => {
    const serialised = JSON.stringify(kpis) + JSON.stringify(dataModel)
    for (const [pattern] of SECRET_PATTERNS) {
      expect(pattern.test(serialised)).toBe(false)
    }
  })
})
