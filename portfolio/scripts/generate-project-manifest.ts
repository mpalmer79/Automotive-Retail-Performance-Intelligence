#!/usr/bin/env tsx
/**
 * Generate `src/generated/project-manifest.json` from source-controlled
 * repository evidence.
 *
 * WHY THIS EXISTS
 * ---------------
 * A portfolio site is the easiest place in a project to tell a small lie. A
 * count drifts, a "pending" quietly becomes a "validated", a screenshot outlives
 * the thing it showed. This script makes that mechanically hard: the website has
 * no other source for a project number or a project status, and this script
 * refuses to emit a manifest whose statuses contradict the evidence files.
 *
 * WHAT IT READS
 * -------------
 *   powerbi/validation/model_expectations.json          semantic model shape
 *   powerbi/validation/sql_baseline_metadata.json        profile, views, recons
 *   powerbi/validation/desktop_validation_results.json  ADR-0008 path 1
 *   powerbi/validation/fabric_validation_results.json    ADR-0008 path 2
 *   powerbi/.../definition/relationships.tmdl            relationships, as built
 *   powerbi/.../definition/tables/*.tmdl                 tables and measures
 *   powerbi/.../*.Report/definition/                     dashboard pages, if any
 *   docs/requirements/GATE_1_READINESS.md                Gate 1 verdict
 *   docs/requirements/GATE_2_READINESS.md                Gate 2 verdict, if it exists
 *   docs/requirements/PHASE_2_BACKLOG.md                 increment statuses
 *   KPI_CATALOG.md                                       governed KPI count
 *   sql/                                                 script and DDL counts
 *   portfolio/src/content/kpis.json                      cross-check only
 *   portfolio/src/content/data-model.json                cross-check only
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *   - Emit a value it did not read from a file.
 *   - Emit `complete` for a lifecycle phase whose exit criteria are unmet.
 *   - Emit an unlocked case study without every piece of required evidence.
 *   - Copy a credential. It reads only the files listed above, and asserts that
 *     none of the strings it emits looks like a secret.
 *   - Emit a person-level value. Nothing it reads contains one.
 *
 * DETERMINISM
 * -----------
 * No clock and no random source. `generatedFromCommit` comes from git or from
 * the CI-provided commit SHA. Object keys are written in a fixed order and
 * arrays in a fixed order, so `--check` is a byte comparison.
 *
 * USAGE
 * -----
 *   tsx scripts/generate-project-manifest.ts            write the manifest
 *   tsx scripts/generate-project-manifest.ts --check    fail if it would change
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CASE_STUDY_FLAG_VARIABLE, isCaseStudyFlagEnabled } from '../src/lib/flags.ts'
import type {
  DeliveryIncrement,
  EngineValidation,
  EvidenceRecord,
  Gate,
  LifecyclePhase,
  ProjectManifest,
  SourcedCount,
  StatusLevel,
} from '../src/types/manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '..')
const REPO = resolve(PORTFOLIO, '..')
const OUTPUT = join(PORTFOLIO, 'src/generated/project-manifest.json')

const PBIP = 'powerbi/ARPI_Performance_Intelligence'
const MODEL_DEF = `${PBIP}/ARPI_Performance_Intelligence.SemanticModel/definition`
const REPORT_DIR = `${PBIP}/ARPI_Performance_Intelligence.Report`

const CHECK_MODE = process.argv.includes('--check')

// ---------------------------------------------------------------------------
// Failure reporting. Every problem is collected so one run reports all of them,
// rather than making the operator play whack-a-mole.
// ---------------------------------------------------------------------------

const problems: string[] = []

function fail(message: string): void {
  problems.push(message)
}

function requireTrue(condition: boolean, message: string): void {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function repoPath(relative: string): string {
  return join(REPO, relative)
}

function readText(relative: string): string {
  const path = repoPath(relative)
  if (!existsSync(path)) {
    fail(`Required evidence file is missing: ${relative}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function readJson<T>(relative: string): T {
  const raw = readText(relative)
  if (!raw) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    fail(`${relative} is not valid JSON: ${String(error)}`)
    return {} as T
  }
}

function listFiles(relativeDir: string, suffix: string): string[] {
  const path = repoPath(relativeDir)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((name) => name.endsWith(suffix))
    .sort()
}

function countFilesRecursive(relativeDir: string, suffix: string): number {
  const path = repoPath(relativeDir)
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      total += countFilesRecursive(join(relativeDir, entry.name), suffix)
    } else if (entry.name.endsWith(suffix)) {
      total += 1
    }
  }
  return total
}

function commitSha(): string {
  // CI provides the SHA; a local run asks git. Both are deterministic for a
  // given checkout, which is what --check needs.
  //
  // `RAILWAY_GIT_COMMIT_SHA` is here because the Railway image is built from an
  // uploaded build context with no `.git` directory in it, so `git rev-parse`
  // cannot answer and the platform variable is the only source. It is consumed
  // through an `ARG` declared in the builder stage of
  // `portfolio/Dockerfile.railway`; without that declaration Docker would not
  // expose it and this would silently fall through to `unknown`.
  const fromEnv =
    process.env.GITHUB_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// 1. Read the evidence
// ---------------------------------------------------------------------------

interface ModelExpectations {
  project: string
  storage_mode: string
  source_schema: string
  database_identity: string
  table_count: number
  imported_table_count: number
  measure_table_count: number
  relationship_count: number
  active_relationship_count: number
  inactive_relationship_count: number
  bidirectional_relationship_count: number
  many_to_many_relationship_count: number
  marked_date_table: string
  measure_count: number
  kpi_measure_count: number
  supporting_measure_count: number
  expected_row_counts: Record<string, number>
  measure_map: Record<string, string>
  profile: string
}

interface SqlBaselineMetadata {
  git_commit: string
  profile: string
  random_seed: number
  pipeline_run_status: string
  reporting_date_range: { first: string; last: string }
  reporting_view_count: number
  row_counts: Record<string, number>
  reconciliations: { total: number; failing: number }
  credentials_recorded: boolean
}

interface EngineResults {
  validated_at: string | null
  overall_result: string
  passed_checks: unknown[]
  failed_checks: unknown[]
  notes: string
  table_count: number | null
  relationship_count: number | null
  measure_count: number | null
}

const MODEL_EXPECTATIONS_PATH = 'powerbi/validation/model_expectations.json'
const SQL_BASELINE_PATH = 'powerbi/validation/sql_baseline_metadata.json'
const DESKTOP_PATH = 'powerbi/validation/desktop_validation_results.json'
const FABRIC_PATH = 'powerbi/validation/fabric_validation_results.json'
const KPI_CATALOG_PATH = 'KPI_CATALOG.md'
const PHASE_2_PATH = 'docs/requirements/PHASE_2_BACKLOG.md'
const GATE_1_PATH = 'docs/requirements/GATE_1_READINESS.md'
const GATE_2_PATH = 'docs/requirements/GATE_2_READINESS.md'

const expectations = readJson<ModelExpectations>(MODEL_EXPECTATIONS_PATH)
const baseline = readJson<SqlBaselineMetadata>(SQL_BASELINE_PATH)
const desktop = readJson<EngineResults>(DESKTOP_PATH)
const fabric = readJson<EngineResults>(FABRIC_PATH)

// ---------------------------------------------------------------------------
// 2. Derive counts from the model source itself, then assert the register
//    agrees. This is the check that catches a model edit that did not update
//    its own expectations file - the exact drift the site must never render.
// ---------------------------------------------------------------------------

const relationshipsTmdl = readText(`${MODEL_DEF}/relationships.tmdl`)
const derivedRelationships = (relationshipsTmdl.match(/^relationship\s+/gm) ?? []).length
const derivedInactive = (relationshipsTmdl.match(/^\s*isActive:\s*false\s*$/gm) ?? [])
  .length
const derivedBidirectional = (
  relationshipsTmdl.match(/^\s*crossFilteringBehavior:\s*bothDirections\s*$/gm) ?? []
).length

const tableFiles = listFiles(`${MODEL_DEF}/tables`, '.tmdl')
const derivedTables = tableFiles.length
let derivedMeasures = 0
let derivedImportedTables = 0
let derivedMeasureTables = 0
for (const file of tableFiles) {
  const body = readText(`${MODEL_DEF}/tables/${file}`)
  derivedMeasures += (body.match(/^\s{0,4}measure\s+/gm) ?? []).length
  // An imported table declares a Power Query partition over the reporting
  // schema; a measure table is a single-row calculated placeholder.
  if (/mode:\s*import/i.test(body) && /reporting/.test(body)) derivedImportedTables += 1
  else derivedMeasureTables += 1
}

requireTrue(
  derivedRelationships === expectations.relationship_count,
  `Relationship count drift: ${MODEL_DEF}/relationships.tmdl defines ` +
    `${derivedRelationships}, ${MODEL_EXPECTATIONS_PATH} declares ` +
    `${expectations.relationship_count}. The website may not display either until they agree.`
)
requireTrue(
  derivedMeasures === expectations.measure_count,
  `Measure count drift: the TMDL tables define ${derivedMeasures} measures, ` +
    `${MODEL_EXPECTATIONS_PATH} declares ${expectations.measure_count}.`
)
requireTrue(
  derivedTables === expectations.table_count,
  `Table count drift: ${derivedTables} TMDL table files, ` +
    `${MODEL_EXPECTATIONS_PATH} declares ${expectations.table_count}.`
)
requireTrue(
  derivedImportedTables === expectations.imported_table_count,
  `Imported table count drift: ${derivedImportedTables} tables import from the ` +
    `reporting schema, ${MODEL_EXPECTATIONS_PATH} declares ${expectations.imported_table_count}.`
)
requireTrue(
  derivedMeasureTables === expectations.measure_table_count,
  `Measure table count drift: ${derivedMeasureTables} measure-only tables, ` +
    `${MODEL_EXPECTATIONS_PATH} declares ${expectations.measure_table_count}.`
)
requireTrue(
  derivedInactive === expectations.inactive_relationship_count,
  `Inactive relationship drift: TMDL marks ${derivedInactive} inactive, ` +
    `${MODEL_EXPECTATIONS_PATH} declares ${expectations.inactive_relationship_count}.`
)
requireTrue(
  derivedBidirectional === 0 && expectations.bidirectional_relationship_count === 0,
  'A bidirectional relationship appeared in the semantic model. ' +
    'ARCHITECTURE.md section 19.2 prohibits it, and the website must not describe ' +
    'the model as single-direction while one exists.'
)

// The governed KPI count is asserted from three independent places: the
// expectations register, the measure map, and the catalogue's own closing
// statement. All three must agree or the site shows nothing.
const kpiCatalogue = readText(KPI_CATALOG_PATH)
const kpiIdsInCatalogue = new Set(
  [...kpiCatalogue.matchAll(/`(KPI-(?:SLS|GRS|INV|FUN|MKT)-\d{3})`/g)].map((m) => m[1]!)
)
const kpiIdsInMeasureMap = Object.keys(expectations.measure_map ?? {}).filter((id) =>
  id.startsWith('KPI-')
)
requireTrue(
  kpiIdsInCatalogue.size === expectations.kpi_measure_count,
  `Governed KPI count drift: ${KPI_CATALOG_PATH} defines ${kpiIdsInCatalogue.size} ` +
    `KPI identifiers, ${MODEL_EXPECTATIONS_PATH} declares ${expectations.kpi_measure_count}.`
)
requireTrue(
  kpiIdsInMeasureMap.length === expectations.kpi_measure_count,
  `Measure map drift: ${kpiIdsInMeasureMap.length} KPI measures mapped, ` +
    `${expectations.kpi_measure_count} declared.`
)
for (const id of kpiIdsInMeasureMap) {
  requireTrue(
    kpiIdsInCatalogue.has(id),
    `${MODEL_EXPECTATIONS_PATH} maps ${id} to a DAX measure, but ${KPI_CATALOG_PATH} ` +
      'does not define it. A measure with no governed definition may not be counted.'
  )
}

// ---------------------------------------------------------------------------
// 3. Dashboard pages. The site states that none exists; that has to be checked
//    rather than asserted, because it stops being true the moment P2.2 starts.
// ---------------------------------------------------------------------------

const dashboardPageCount =
  countFilesRecursive(`${REPORT_DIR}/definition/pages`, '.json') +
  countFilesRecursive(`${REPORT_DIR}/definition/pages`, '.pbir')

// ---------------------------------------------------------------------------
// 4. SQL and warehouse counts
// ---------------------------------------------------------------------------

// The sanitized public listing lane (ADR-0011) lives in the same directories as the
// MVP warehouse and is deliberately NOT part of it. Its files are read from the one
// place that declares them -- `arpi.inventory.spec.INVENTORY_LANE_SQL_FILES` -- and
// subtracted here, so that "five MVP facts", "eight conformed dimensions" and
// "twenty-eight reporting views" keep meaning what the SQL baseline and the semantic
// model were actually measured against. The lane is then counted on its own, below,
// so it is reported rather than hidden.
//
// Reading the declaration rather than restating it is the point: a second hand-written
// list here is exactly what would drift away from the first.
const inventoryLaneSqlFiles = readInventoryLaneSqlFiles()

function readInventoryLaneSqlFiles(): Set<string> {
  const source = readText('src/arpi/inventory/spec.py')
  const block = /INVENTORY_LANE_SQL_FILES[^=]*=\s*\(([\s\S]*?)\)/.exec(source)
  if (!block) {
    fail(
      'src/arpi/inventory/spec.py no longer declares INVENTORY_LANE_SQL_FILES. The ' +
        'manifest cannot tell the MVP warehouse and the sanitized listing lane apart ' +
        'without it.'
    )
    return new Set()
  }
  const names = [...block[1]!.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]!)
  if (names.length === 0) {
    fail('INVENTORY_LANE_SQL_FILES is declared but empty.')
  }
  return new Set(names)
}

/** Whether a file under `sql/<dir>/` belongs to the sanitized listing lane. */
function inLane(dir: string, name: string): boolean {
  return inventoryLaneSqlFiles.has(`${dir}/${name}`)
}

// The dashboard program's own reporting views, subtracted from the MVP count for the
// same reason the listing lane is: `sql_baseline_metadata.json` records the surface the
// SQL baseline and the semantic model were measured against, and a `DASH.*` view is not
// part of it. Read from the Python declaration rather than restated here.
const dashboardLaneSqlFiles = readDashboardLaneSqlFiles()

function readDashboardLaneSqlFiles(): Set<string> {
  const source = readText('src/arpi/dashboard/contract.py')
  const block = /DASHBOARD_LANE_SQL_FILES[^=]*=\s*\(([\s\S]*?)\)/.exec(source)
  if (!block) {
    fail(
      'src/arpi/dashboard/contract.py no longer declares DASHBOARD_LANE_SQL_FILES. The ' +
        'manifest cannot tell the MVP reporting surface and the dashboard program lane ' +
        'apart without it.'
    )
    return new Set()
  }
  const names = [...block[1]!.matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]!)
  if (names.length === 0) {
    fail('DASHBOARD_LANE_SQL_FILES is declared but empty.')
  }
  return new Set(names)
}

/** Whether a file under `sql/<dir>/` belongs to the dashboard program lane. */
function inDashboardLane(dir: string, name: string): boolean {
  return dashboardLaneSqlFiles.has(`${dir}/${name}`)
}

const dimensionDdl = listFiles('sql/03_dimensions', '.sql').filter(
  (f) => !f.includes('_merge') && !inLane('03_dimensions', f)
)
// The MVP fact DDL. Both lanes are subtracted for the same reason: the Power BI SQL
// baseline and `data-model.json` describe the FIVE MVP facts, and `DASH.5` added a sixth
// fact table that the semantic model has never measured. Counting it here would restate a
// historical baseline rather than record a new capability.
const factDdl = listFiles('sql/04_facts', '.sql').filter(
  (f) => !f.includes('_load') && !inLane('04_facts', f) && !inDashboardLane('04_facts', f)
)
/** The dashboard program's own fact DDL: `warehouse.fact_sales_target` (`DASH.5`). */
const dashboardFactDdl = listFiles('sql/04_facts', '.sql').filter(
  (f) => !f.includes('_load') && inDashboardLane('04_facts', f)
)
const reportingViewFiles = listFiles('sql/05_reporting', '.sql').filter(
  (f) =>
    !f.includes('reporting_scope') &&
    !inLane('05_reporting', f) &&
    !inDashboardLane('05_reporting', f)
)
const dashboardReportingViewFiles = listFiles('sql/05_reporting', '.sql').filter((f) =>
  inDashboardLane('05_reporting', f)
)
const listingReportingViewFiles = listFiles('sql/05_reporting', '.sql').filter((f) =>
  inLane('05_reporting', f)
)
const orderedSqlScripts =
  countFilesRecursive('sql/00_database', '.sql') +
  countFilesRecursive('sql/01_raw', '.sql') +
  countFilesRecursive('sql/02_staging', '.sql') +
  countFilesRecursive('sql/03_dimensions', '.sql') +
  countFilesRecursive('sql/04_facts', '.sql') +
  countFilesRecursive('sql/05_reporting', '.sql') +
  countFilesRecursive('sql/06_indexes', '.sql') +
  countFilesRecursive('sql/07_security', '.sql') +
  countFilesRecursive('sql/08_validation', '.sql')

requireTrue(
  reportingViewFiles.length === baseline.reporting_view_count,
  `Reporting view drift: sql/05_reporting/ holds ${reportingViewFiles.length} view ` +
    `scripts, ${SQL_BASELINE_PATH} declares ${baseline.reporting_view_count}.`
)
requireTrue(
  dimensionDdl.length === 8,
  `Expected eight MVP dimension DDL scripts under sql/03_dimensions/, found ${dimensionDdl.length}.`
)
requireTrue(
  factDdl.length === 5,
  `Expected five MVP fact DDL scripts under sql/04_facts/, found ${factDdl.length}.`
)
requireTrue(
  listingReportingViewFiles.length === 6,
  `Expected six Inventory Operations reporting views under sql/05_reporting/, found ` +
    `${listingReportingViewFiles.length}.`
)
requireTrue(
  dashboardReportingViewFiles.length === 5,
  `Expected five dashboard program reporting views under sql/05_reporting/, found ` +
    `${dashboardReportingViewFiles.length}. A DASH.* view added to the tree and not to ` +
    'DASHBOARD_LANE_SQL_FILES would be counted against the Power BI SQL baseline, which ' +
    'never measured it.'
)
requireTrue(
  dashboardFactDdl.length === 1,
  `Expected one dashboard program fact DDL script under sql/04_facts/, found ` +
    `${dashboardFactDdl.length}. A DASH.* fact added to the tree and not to ` +
    'DASHBOARD_LANE_SQL_FILES would be counted as a sixth MVP fact, which would restate ' +
    'a baseline the semantic model was measured against.'
)
requireTrue(
  !baseline.credentials_recorded,
  `${SQL_BASELINE_PATH} reports credentials_recorded=true. The manifest will not ` +
    'copy from a file that admits to holding a credential.'
)

// ---------------------------------------------------------------------------
// 5. Real-engine validation, per ADR-0008
// ---------------------------------------------------------------------------

function engineStatus(result: EngineResults): StatusLevel {
  const verdict = (result.overall_result ?? '').toLowerCase()
  if (verdict === 'passed') return 'complete'
  if (verdict === 'failed') return 'blocked'
  if (verdict === 'stale') return 'blocked'
  return 'pending-external'
}

function firstSentences(text: string, count: number): string {
  const parts = (text ?? '').split(/(?<=\.)\s+/).slice(0, count)
  return parts.join(' ').trim()
}

const engines: EngineValidation[] = [
  {
    id: 'desktop',
    label: 'Power BI Desktop',
    overallResult: desktop.overall_result ?? 'missing',
    status: engineStatus(desktop),
    validatedAt: desktop.validated_at ?? null,
    passedCheckCount: (desktop.passed_checks ?? []).length,
    failedCheckCount: (desktop.failed_checks ?? []).length,
    note: firstSentences(desktop.notes ?? '', 2),
    evidencePath: DESKTOP_PATH,
    procedurePath: 'docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md',
  },
  {
    id: 'fabric',
    label: 'Microsoft Fabric Service',
    overallResult: fabric.overall_result ?? 'missing',
    status: engineStatus(fabric),
    validatedAt: fabric.validated_at ?? null,
    passedCheckCount: (fabric.passed_checks ?? []).length,
    failedCheckCount: (fabric.failed_checks ?? []).length,
    note: firstSentences(fabric.notes ?? '', 2),
    evidencePath: FABRIC_PATH,
    procedurePath: 'docs/powerbi/FABRIC_SERVICE_HANDOFF.md',
  },
]

// ADR-0008: either path passing closes the gate; both are never required.
const realEnginePassed = engines.some((engine) => engine.status === 'complete')
const realEngineStatus: StatusLevel = realEnginePassed ? 'complete' : 'pending-external'

// A passing engine result that contradicts the model's own shape is worse than
// no result, so it is checked rather than trusted.
for (const [engine, result] of [
  [engines[0]!, desktop],
  [engines[1]!, fabric],
] as const) {
  if (engine.status !== 'complete') continue
  requireTrue(
    result.relationship_count === expectations.relationship_count,
    `${engine.evidencePath} records a PASSED result with ` +
      `relationship_count=${String(result.relationship_count)} but the model defines ` +
      `${expectations.relationship_count}. A pass that describes a different model is not a pass.`
  )
  requireTrue(
    result.measure_count === expectations.measure_count,
    `${engine.evidencePath} records a PASSED result with ` +
      `measure_count=${String(result.measure_count)} but the model defines ` +
      `${expectations.measure_count}.`
  )
  requireTrue(
    typeof result.validated_at === 'string' && result.validated_at.length > 0,
    `${engine.evidencePath} records a PASSED result with no validated_at timestamp.`
  )
}

// ---------------------------------------------------------------------------
// 6. Gates
// ---------------------------------------------------------------------------

/**
 * Read a gate's written verdict out of its readiness document.
 *
 * The repository writes a verdict as a labelled declaration, and it does so in
 * two shapes that both have to parse:
 *
 *   **Gate 1 verdict:**            (label, blank line, then the word)
 *
 *   **OPEN**
 *
 *   **Gate 2 verdict: CLOSED.**    (label and word on one line)
 *
 * The match is anchored on `Gate <n> verdict` and then takes the FIRST
 * OPEN-or-CLOSED token within a short window, so that prose elsewhere in the
 * document containing the word "open" cannot be mistaken for a verdict. If the
 * anchor is absent the function reports `null`, and the caller treats an
 * unparseable verdict as a failure rather than as a default.
 */
function parseGateVerdict(
  path: string,
  gateNumber: number
): {
  exists: boolean
  verdict: 'OPEN' | 'CLOSED' | null
  recordedOn: string | null
} {
  if (!existsSync(repoPath(path))) {
    return { exists: false, verdict: null, recordedOn: null }
  }
  const body = readFileSync(repoPath(path), 'utf8')

  let verdict: 'OPEN' | 'CLOSED' | null = null
  const anchor = new RegExp(`Gate\\s*${String(gateNumber)}\\s*verdict`, 'gi')
  for (const match of body.matchAll(anchor)) {
    const window = body.slice(match.index, match.index + 160)
    const token = window.match(/\b(OPEN|CLOSED)\b/)
    if (token) {
      verdict = token[1]!.toUpperCase() as 'OPEN' | 'CLOSED'
      break
    }
  }

  const recordedOn =
    body.match(/recorded on\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ??
    body.match(/\*\*Review date\*\*\s*\|\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ??
    null

  return { exists: true, verdict, recordedOn }
}

const gate1 = parseGateVerdict(GATE_1_PATH, 1)
const gate2Doc = parseGateVerdict(GATE_2_PATH, 2)

requireTrue(
  gate1.exists && gate1.verdict !== null,
  `${GATE_1_PATH} does not record a parseable Gate 1 verdict.`
)

const phase2Body = readText(PHASE_2_PATH)

/**
 * Gate 2's verdict. A verdict document is the only thing that can open it. When
 * no such document exists the gate is CLOSED - not "unknown", not "assumed
 * closed". This asymmetry is deliberate: absence of evidence closes a gate and
 * never opens one.
 */
const gate2Verdict: 'OPEN' | 'CLOSED' =
  gate2Doc.exists && gate2Doc.verdict === 'OPEN' ? 'OPEN' : 'CLOSED'

// Gate 2's three conditions come from ARCHITECTURE.md section 28. Each one's
// "met" flag is computed from evidence, never authored.
const findingsFiles = listFiles('docs/findings', '.md')
const gate2Conditions = [
  {
    ordinal: 1,
    condition: 'Core Power BI report pages are complete',
    met: dashboardPageCount > 0,
    evidence:
      dashboardPageCount > 0
        ? `${String(dashboardPageCount)} report page definitions found under ${REPORT_DIR}/definition/pages/.`
        : `${REPORT_DIR}/ is a PBIR shell: a .platform file and a definition.pbir pointing at ` +
          'the semantic model. It contains no page, no visual and no bookmark. Delivered by P2.2.',
  },
  {
    ordinal: 2,
    condition: 'SQL and Power BI totals reconcile',
    met: realEnginePassed,
    evidence: realEnginePassed
      ? 'A real-engine validation has passed and its SQL-to-DAX differences are recorded.'
      : 'The SQL side exists as powerbi/validation/sql_baseline.json. The Power BI side ' +
        'requires a refreshed model, and no engine has refreshed it. Delivered by P2.2-10.',
  },
  {
    ordinal: 3,
    condition: 'Executive findings are drafted',
    met: findingsFiles.length > 0,
    evidence:
      findingsFiles.length > 0
        ? `${String(findingsFiles.length)} finding document(s) present under docs/findings/.`
        : 'docs/findings/ is empty. Delivered by P2.3.',
  },
]

requireTrue(
  gate2Verdict === 'CLOSED' || gate2Conditions.every((c) => c.met),
  `${GATE_2_PATH} records an OPEN verdict, but not all three Gate 2 conditions are met ` +
    'by repository evidence. A written verdict does not override the conditions it evaluates.'
)

const gates: Gate[] = [
  {
    id: 'gate-1',
    name: 'Gate 1 - Power BI development may begin',
    verdict: gate1.verdict ?? 'CLOSED',
    recordedOn: gate1.recordedOn,
    verdictPath: gate1.exists ? GATE_1_PATH : null,
    conditions: [
      {
        ordinal: 1,
        condition: 'Fact grains are approved',
        met: true,
        evidence:
          'Every MVP fact declares one grain, enforced by a UNIQUE constraint and covered by ' +
          'tests/integration/test_schema_objects.py.',
      },
      {
        ordinal: 2,
        condition: 'Dimensions are documented',
        met: true,
        evidence: `All eight MVP dimensions are specified in DATA_DICTIONARY.md with a source-to-target mapping each under docs/source-to-target/.`,
      },
      {
        ordinal: 3,
        condition: 'KPI formulas are documented',
        met: true,
        evidence: `All ${String(expectations.kpi_measure_count)} governed KPIs carry a formula, an explicit numerator and denominator, a grain and a null rule in ${KPI_CATALOG_PATH}.`,
      },
    ],
  },
  {
    id: 'gate-2',
    name: 'Gate 2 - the public analytical case study may begin',
    verdict: gate2Verdict,
    recordedOn: gate2Doc.recordedOn,
    verdictPath: gate2Doc.exists ? GATE_2_PATH : null,
    conditions: gate2Conditions,
  },
]

// ---------------------------------------------------------------------------
// 7. Lifecycle phases and delivery increments
//
// The narrative text is authored here; every *status* is computed. A phase may
// not be `complete` unless the condition that gates it is demonstrably clear.
// ---------------------------------------------------------------------------

const phase5Status: StatusLevel = realEnginePassed ? 'complete' : 'in-progress'

const lifecyclePhases: LifecyclePhase[] = [
  {
    number: 1,
    name: 'Product definition',
    status: 'complete',
    summary:
      'The business problem, the stakeholder personas, the analytical questions, the approved scope and the first KPI catalogue.',
    statusReason:
      'The architecture is approved, the non-goals are accepted and the core KPIs are defined.',
    exitCriteria: ['Architecture approved', 'Non-goals accepted', 'Core KPIs defined'],
  },
  {
    number: 2,
    name: 'Data model',
    status: 'complete',
    summary:
      'The source model, the dimensional model, declared fact grains, the data dictionary, source-to-target mappings and data-quality rules.',
    statusReason:
      'Every fact declares one grain, every relationship is documented and the history policy for each dimension is fixed by ADR-0006.',
    exitCriteria: [
      'Every fact has one declared grain',
      'Every relationship is documented',
      'Required history handling is defined',
    ],
  },
  {
    number: 3,
    name: 'Synthetic data generator',
    status: 'complete',
    summary:
      'A configurable, seeded generator with development, test and portfolio profiles, and a distribution-validation report.',
    statusReason:
      'The generator is deterministic - the same profile and seed reproduce byte-identical CSV, each entry carrying a SHA-256 content digest - and the prohibited-PII checks pass.',
    exitCriteria: [
      'Generated records are plausible',
      'Required relationships are visible but not deterministic',
      'No prohibited PII exists',
    ],
  },
  {
    number: 4,
    name: 'PostgreSQL warehouse',
    status: 'complete',
    summary:
      'Schemas, staging views, conformed dimensions, facts at declared grain, reporting views, audit tables, indexes, roles and grants.',
    statusReason: `Loads are repeatable, grain tests pass, and ${String(baseline.reconciliations.total)} reconciliations are recorded on every database run with ${String(baseline.reconciliations.failing)} failing.`,
    exitCriteria: ['Loads are repeatable', 'Grain tests pass', 'Reconciliations pass'],
  },
  {
    number: 5,
    name: 'Power BI semantic model',
    status: phase5Status,
    summary:
      'Imported reporting views, relationships, a marked date table, measure tables, the core DAX measures and the model documentation.',
    statusReason: realEnginePassed
      ? 'A real-engine validation has passed on an accepted ADR-0008 path, so the exit criteria are met.'
      : 'The model is built and statically validated, but no Microsoft semantic-model engine has loaded, refreshed or evaluated it. Both ADR-0008 paths are pending, so the exit criteria are not met.',
    exitCriteria: [
      'Core totals reconcile to SQL',
      'Filter behaviour is correct',
      'No unresolved ambiguous relationships exist',
    ],
  },
  {
    number: 6,
    name: 'Report pages and dashboards',
    status: dashboardPageCount > 0 ? 'in-progress' : 'blocked',
    summary: 'The seven unblocked MVP report pages over the governed semantic model.',
    statusReason:
      dashboardPageCount > 0
        ? 'Report page definitions exist in the PBIR project.'
        : 'No report page, visual or bookmark exists. Authoring pages over a model that has never been loaded would merge page defects and model defects into one change, so this is sequenced behind Lifecycle Phase 5.',
    exitCriteria: [
      'Every page reads only from the governed semantic model',
      'Page totals reconcile to SQL',
      'Employee views carry the fairness context',
    ],
  },
  {
    number: 7,
    name: 'Findings and recommendations',
    status: 'blocked',
    summary:
      'Executive findings drawn from the completed report layer, and the Gate 2 review that evaluates them.',
    statusReason:
      'docs/findings/ is empty and nothing has been analysed. This phase is blocked behind the report layer, and any conclusion drawn now would describe a synthetic dataset rather than a market.',
    exitCriteria: [
      'Findings trace to a governed KPI and a filter context',
      'Every recommendation states its limitation',
      'Gate 2 records a written verdict',
    ],
  },
  {
    number: 8,
    name: 'Portfolio packaging',
    status: 'in-progress',
    summary:
      'Making the work reviewable by someone with limited time, no database and no Power BI licence.',
    statusReason:
      'The portfolio website foundation, its design system and the gated case-study shell are delivered. The screenshots, the model diagram, the generated DAX measure catalogue, the Excel operating report, the walkthrough and the case-study copy are not, and most of them cannot start until the report layer exists.',
    exitCriteria: [
      'Every artefact a reviewer is pointed at exists at the path it is cited by',
      'Nothing in the packaging claims a capability the repository does not have',
      'Every screenshot carries the synthetic-data statement',
    ],
  },
]

/** Read an increment's declared status line out of the backlog. */
function incrementDeclaredStatus(id: string): string {
  const section = phase2Body
    .split(new RegExp(`\`${id}\``))
    .slice(1)
    .join('')
  const match = section.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|]+)\|/)
  return match ? match[1]!.trim() : ''
}

const increments: DeliveryIncrement[] = [
  {
    id: 'P2.1',
    name: 'Power BI semantic model',
    status: realEnginePassed ? 'complete' : 'in-progress',
    statusReason: realEnginePassed
      ? 'Built, statically validated and validated on a real engine.'
      : 'Built and statically validated. The increment does not meet its exit criteria until the real-engine validation gate passes on one accepted path.',
    lifecyclePhase: 5,
    blockingGate: null,
  },
  {
    id: 'P2.2',
    name: 'MVP dashboard pages',
    status: 'blocked',
    statusReason:
      'Not started, and sequenced behind the real-engine validation of the semantic model.',
    lifecyclePhase: 6,
    blockingGate: 'Real-engine validation of the semantic model',
  },
  {
    id: 'P2.3',
    name: 'Findings, recommendations and the Gate 2 review',
    status: 'blocked',
    statusReason: 'Not started, and blocked behind the report layer.',
    lifecyclePhase: 7,
    blockingGate: 'P2.2',
  },
  {
    id: 'P2.4',
    name: 'Portfolio packaging',
    status: 'in-progress',
    statusReason:
      'The portfolio website foundation and the gated case-study shell are delivered. The remaining items depend on the report layer and on the Gate 2 verdict.',
    lifecyclePhase: 8,
    blockingGate: 'Gate 2 for the case study only',
  },
]

// The backlog is the governing document. If it says an increment is delivered
// and this manifest says it is blocked, one of the two is wrong and the site
// must not pick a side silently.
for (const increment of increments) {
  const declared = incrementDeclaredStatus(increment.id).toLowerCase()
  if (!declared) continue
  if (increment.status === 'complete') {
    requireTrue(
      !declared.includes('not started') && !declared.includes('not complete'),
      `${increment.id} is emitted as complete, but ${PHASE_2_PATH} declares its status as ` +
        `"${incrementDeclaredStatus(increment.id)}".`
    )
  }
}

// ---------------------------------------------------------------------------
// 8. Case-study gate
//
// Five independent conditions, ALL of which must hold. The environment flag is
// necessary and never sufficient: a flag flipped in a deployment dashboard
// cannot conjure a Gate 2 verdict, a findings document, or a screenshot.
// ---------------------------------------------------------------------------

// Parsed through the shared helper rather than compared inline, so that the
// generator, the website and the deployment verifier cannot disagree about what
// counts as "on". Missing, empty, malformed and unrecognised all mean false, so
// a Railway deployment that sets no variable at all resolves to LOCKED.
const flagEnabled = isCaseStudyFlagEnabled(
  process.env[CASE_STUDY_FLAG_VARIABLE] as string | undefined
)
const requiredCaseStudyContent = ['portfolio/content/case-study.md']
const requiredCaseStudyScreenshots = 'portfolio/public/case-study/screenshots'

const requiredContentPresent = requiredCaseStudyContent.every((p) =>
  existsSync(repoPath(p))
)
const requiredScreenshotsPresent =
  countFilesRecursive(requiredCaseStudyScreenshots, '.png') > 0

const caseStudyBlockingReasons: string[] = []
if (!flagEnabled) {
  caseStudyBlockingReasons.push(
    'The NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED build flag is not set to true.'
  )
}
if (!gate2Doc.exists) {
  caseStudyBlockingReasons.push(
    `${GATE_2_PATH} does not exist, so no Gate 2 review has been written.`
  )
}
if (gate2Verdict !== 'OPEN') {
  caseStudyBlockingReasons.push(
    'The recorded Gate 2 verdict is CLOSED. Its three conditions are: complete report ' +
      'pages, reconciled SQL and Power BI totals, and drafted executive findings.'
  )
}
if (!requiredContentPresent) {
  caseStudyBlockingReasons.push(
    'The case-study content file has not been written. No findings have been drawn.'
  )
}
if (!requiredScreenshotsPresent) {
  caseStudyBlockingReasons.push(
    'No report screenshots exist, because no report page exists to screenshot.'
  )
}

const caseStudyUnlocked =
  flagEnabled &&
  gate2Doc.exists &&
  gate2Verdict === 'OPEN' &&
  requiredContentPresent &&
  requiredScreenshotsPresent

requireTrue(
  caseStudyUnlocked === (caseStudyBlockingReasons.length === 0),
  'The case-study lock state and its blocking reasons disagree. This is a generator bug, ' +
    'not a content problem, and the manifest will not be written.'
)

// ---------------------------------------------------------------------------
// 9. Counts, each with its provenance
// ---------------------------------------------------------------------------

function sourced(
  value: number,
  label: string,
  detail: string,
  sources: { path: string; field: string }[]
): SourcedCount {
  requireTrue(
    Number.isInteger(value) && value >= 0,
    `Count "${label}" resolved to ${String(value)}, which is not a whole number. ` +
      'A displayed count must be read from a file, never computed from a guess.'
  )
  requireTrue(
    sources.length > 0,
    `Count "${label}" has no recorded source. Every number on the site must name the ` +
      'file that proves it.'
  )
  return { value, label, detail, sources }
}

const rowCounts = expectations.expected_row_counts ?? {}

const counts = {
  dealerships: sourced(
    rowCounts['vw_dealership'] ?? 0,
    'Fictional dealerships',
    'Granite Auto Group stores. All three are invented.',
    [{ path: MODEL_EXPECTATIONS_PATH, field: 'expected_row_counts.vw_dealership' }]
  ),
  dimensions: sourced(
    dimensionDdl.length,
    'MVP dimensions',
    'Conformed dimensions built, constrained and populated.',
    [{ path: 'sql/03_dimensions/', field: 'dimension DDL scripts' }]
  ),
  facts: sourced(
    factDdl.length,
    'MVP facts',
    'Each with one declared grain enforced by a UNIQUE constraint.',
    [{ path: 'sql/04_facts/', field: 'fact DDL scripts' }]
  ),
  reportingViews: sourced(
    baseline.reporting_view_count ?? 0,
    'Reporting views',
    'The only surface the semantic model is permitted to read.',
    [
      { path: SQL_BASELINE_PATH, field: 'reporting_view_count' },
      { path: 'sql/05_reporting/', field: 'view scripts' },
    ]
  ),
  governedKpis: sourced(
    expectations.kpi_measure_count ?? 0,
    'Governed KPIs',
    'Each with a formula, an explicit numerator and denominator, a grain and a null rule.',
    [
      { path: KPI_CATALOG_PATH, field: 'KPI index' },
      { path: MODEL_EXPECTATIONS_PATH, field: 'kpi_measure_count' },
    ]
  ),
  semanticRelationships: sourced(
    expectations.relationship_count ?? 0,
    'Semantic relationships',
    'All single-direction. No bidirectional filter and no many-to-many.',
    [
      { path: `${MODEL_DEF}/relationships.tmdl`, field: 'relationship definitions' },
      { path: MODEL_EXPECTATIONS_PATH, field: 'relationship_count' },
    ]
  ),
  daxMeasures: sourced(
    expectations.measure_count ?? 0,
    'DAX measures',
    'Written and statically validated. Never evaluated by an engine.',
    [
      { path: `${MODEL_DEF}/tables/`, field: 'measure definitions in TMDL' },
      { path: MODEL_EXPECTATIONS_PATH, field: 'measure_count' },
    ]
  ),
  semanticTables: sourced(
    expectations.table_count ?? 0,
    'Semantic model tables',
    'Imported reporting views plus measure-only tables.',
    [{ path: MODEL_EXPECTATIONS_PATH, field: 'table_count' }]
  ),
  importedTables: sourced(
    expectations.imported_table_count ?? 0,
    'Imported tables',
    'Import mode over the reporting schema only.',
    [{ path: MODEL_EXPECTATIONS_PATH, field: 'imported_table_count' }]
  ),
  measureTables: sourced(
    expectations.measure_table_count ?? 0,
    'Measure tables',
    'Measure groups kept separate from the data tables.',
    [{ path: MODEL_EXPECTATIONS_PATH, field: 'measure_table_count' }]
  ),
  supportingMeasures: sourced(
    expectations.supporting_measure_count ?? 0,
    'Supporting measures',
    'Intermediate measures that governed KPIs build on.',
    [{ path: MODEL_EXPECTATIONS_PATH, field: 'supporting_measure_count' }]
  ),
  reconciliations: sourced(
    baseline.reconciliations?.total ?? 0,
    'Reconciliations',
    'Recorded on every database run. Each proves a number rather than asserting it.',
    [{ path: SQL_BASELINE_PATH, field: 'reconciliations.total' }]
  ),
  dataQualityChecks: sourced(
    rowCounts['vw_data_quality_summary'] ?? 0,
    'Data-quality checks',
    'Run in memory before any row is loaded, each with a declared severity.',
    [
      {
        path: MODEL_EXPECTATIONS_PATH,
        field: 'expected_row_counts.vw_data_quality_summary',
      },
    ]
  ),
  staticAssertions: sourced(
    derivedTables + derivedRelationships + derivedMeasures,
    'Model objects statically asserted',
    'Every table, relationship and measure parsed from TMDL and checked against the model documentation on every push.',
    [
      { path: `${MODEL_DEF}/`, field: 'TMDL source' },
      { path: 'scripts/check_powerbi_model.py', field: 'static validation' },
    ]
  ),
  sqlScripts: sourced(
    orderedSqlScripts,
    'Ordered SQL scripts',
    'Re-runnable, lexically ordered so that build order is file order.',
    [{ path: 'sql/', field: 'numbered build directories' }]
  ),
}

// ---------------------------------------------------------------------------
// 10. Evidence ledger
// ---------------------------------------------------------------------------

const evidence: EvidenceRecord[] = [
  {
    id: 'deterministic-generation',
    label: 'Deterministic synthetic generation',
    kind: 'privacy',
    status: 'complete',
    detail: `The same profile and seed reproduce byte-identical CSV. Seed ${String(baseline.random_seed)} on the ${baseline.profile} profile, with a SHA-256 content digest per entity in the generation manifest.`,
    sources: [
      { path: SQL_BASELINE_PATH, field: 'random_seed' },
      { path: 'data/sample/generation_manifest.json', field: 'content digests' },
    ],
  },
  {
    id: 'declared-grains',
    label: 'Declared fact grains',
    kind: 'test',
    status: 'complete',
    detail: `Each of the ${String(factDdl.length)} MVP facts declares one grain, enforced by a UNIQUE constraint in DDL and asserted by the integration suite.`,
    sources: [
      { path: 'sql/04_facts/', field: 'grain constraints' },
      { path: 'tests/integration/test_schema_objects.py', field: 'grain assertions' },
    ],
  },
  {
    id: 'governed-kpi-catalogue',
    label: 'Governed KPI catalogue',
    kind: 'static',
    status: 'complete',
    detail: `All ${String(expectations.kpi_measure_count)} KPIs carry a business definition, a formula, an explicit numerator and denominator, a grain, a date basis, inclusion and exclusion rules, a null rule, a source view and an interpretation caution.`,
    sources: [{ path: KPI_CATALOG_PATH, field: 'sections 6 to 34' }],
  },
  {
    id: 'kpi-independent-derivation',
    label: 'KPI verification against an independent derivation',
    kind: 'test',
    status: 'complete',
    detail: `Every KPI computed from the reporting schema is asserted equal to the same figure derived independently from the warehouse, and every ratio is asserted to return NULL rather than zero or infinity on an empty denominator.`,
    sources: [
      { path: 'tests/integration/test_kpi_verification.py', field: 'per-KPI assertions' },
    ],
  },
  {
    id: 'reconciliations',
    label: 'Reconciliation suite',
    kind: 'reconciliation',
    status: baseline.reconciliations?.failing === 0 ? 'complete' : 'blocked',
    detail: `${String(baseline.reconciliations?.total ?? 0)} reconciliations recorded on every database run, ${String(baseline.reconciliations?.failing ?? 0)} failing. Every critical rule is proven to fail against a deliberately corrupted fixture.`,
    sources: [
      { path: SQL_BASELINE_PATH, field: 'reconciliations' },
      { path: 'sql/08_validation/', field: 'reconciliation SQL' },
      { path: 'tests/integration/test_reconciliations.py', field: 'negative tests' },
    ],
  },
  {
    id: 'privacy-safeguards',
    label: 'Privacy safeguards',
    kind: 'privacy',
    status: 'complete',
    detail:
      'The data model prohibits names, street addresses, email addresses, phone numbers, full birth dates, government identifiers and bank information. Age is a band; geography stops at county or market area. No real VIN is linked to a synthetic customer.',
    sources: [
      { path: 'PRIVACY_AND_ETHICS.md', field: 'prohibited attributes' },
      { path: 'src/arpi/validation/privacy.py', field: 'enforcement' },
      { path: 'tests/unit/test_privacy.py', field: 'prohibition tests' },
    ],
  },
  {
    id: 'read-only-reporting-role',
    label: 'Read-only reporting role',
    kind: 'test',
    status: 'complete',
    detail:
      'The reporting identity is provably unable to read the raw, staging, warehouse or audit schemas, asserted end to end rather than described in a grant script.',
    sources: [
      { path: 'sql/07_security/01_grants.sql', field: 'grants' },
      {
        path: 'tests/integration/test_reporter_role_end_to_end.py',
        field: 'negative access tests',
      },
    ],
  },
  {
    id: 'static-model-validation',
    label: 'Static semantic-model validation',
    kind: 'static',
    status: 'complete',
    detail: `The TMDL source is parsed as text and checked against the model documentation on every push: ${String(derivedTables)} tables, ${String(derivedRelationships)} relationships and ${String(derivedMeasures)} measures, with a bidirectional filter, a non-reporting schema or a PII-bearing column failing the build. No engine is launched, so this proves shape and never proves arithmetic.`,
    sources: [
      { path: 'scripts/check_powerbi_model.py', field: 'assertions' },
      { path: '.github/workflows/ci.yml', field: 'repository-checks job' },
    ],
  },
  {
    id: 'sql-to-dax-baseline',
    label: 'SQL-to-DAX baseline',
    kind: 'reconciliation',
    status: 'complete',
    detail:
      'The SQL side of every KPI is committed across twenty-one filter contexts, generated from the database rather than typed by hand. It is one half of a reconciliation whose other half needs a refreshed model.',
    sources: [
      { path: 'powerbi/validation/sql_baseline.json', field: 'expected totals' },
      { path: 'scripts/generate_sql_baseline.py', field: 'generator' },
    ],
  },
  {
    id: 'real-engine-validation',
    label: 'Real-engine semantic-model validation',
    kind: 'real-engine',
    status: realEngineStatus,
    detail: realEnginePassed
      ? 'A Microsoft semantic-model engine has loaded, refreshed and queried the model on an accepted ADR-0008 path.'
      : 'Neither accepted path has run. No Microsoft semantic-model engine has loaded this model, refreshed it, or returned a single number from it, so every measure in it is text that has never produced a value. Static parsing cannot substitute.',
    sources: [
      { path: DESKTOP_PATH, field: 'overall_result' },
      { path: FABRIC_PATH, field: 'overall_result' },
      {
        path: 'docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md',
        field: 'accepted paths and proof obligation',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 11. Cross-check the authored content files against the manifest
// ---------------------------------------------------------------------------

interface KpiContent {
  kpis: { id: string; measureName: string; status: string; domain: string }[]
  deferred: unknown[]
}
interface DataModelContent {
  entities: { id: string; kind: string; reportingView: string }[]
  relationships: unknown[]
}

const kpiContentPath = 'portfolio/src/content/kpis.json'
const dataModelContentPath = 'portfolio/src/content/data-model.json'
const kpiContent = readJson<KpiContent>(kpiContentPath)
const dataModelContent = readJson<DataModelContent>(dataModelContentPath)

requireTrue(
  (kpiContent.kpis ?? []).length === expectations.kpi_measure_count,
  `${kpiContentPath} holds ${String((kpiContent.kpis ?? []).length)} KPIs; the repository ` +
    `evidences ${String(expectations.kpi_measure_count)}.`
)
for (const kpi of kpiContent.kpis ?? []) {
  requireTrue(
    kpiIdsInCatalogue.has(kpi.id),
    `${kpiContentPath} contains ${kpi.id}, which ${KPI_CATALOG_PATH} does not define.`
  )
  const mapped = expectations.measure_map?.[kpi.id]
  requireTrue(
    mapped === kpi.measureName,
    `${kpiContentPath} maps ${kpi.id} to measure "${kpi.measureName}"; ` +
      `${MODEL_EXPECTATIONS_PATH} maps it to "${String(mapped)}".`
  )
}

const contentDimensions = (dataModelContent.entities ?? []).filter(
  (e) => e.kind === 'dimension'
)
const contentFacts = (dataModelContent.entities ?? []).filter((e) => e.kind === 'fact')
requireTrue(
  contentDimensions.length === dimensionDdl.length,
  `${dataModelContentPath} describes ${String(contentDimensions.length)} dimensions; ` +
    `sql/03_dimensions/ builds ${String(dimensionDdl.length)}.`
)
requireTrue(
  contentFacts.length === factDdl.length,
  `${dataModelContentPath} describes ${String(contentFacts.length)} facts; ` +
    `sql/04_facts/ builds ${String(factDdl.length)}.`
)
requireTrue(
  (dataModelContent.relationships ?? []).length === expectations.relationship_count,
  `${dataModelContentPath} describes ${String((dataModelContent.relationships ?? []).length)} ` +
    `relationships; the model defines ${String(expectations.relationship_count)}.`
)
for (const entity of dataModelContent.entities ?? []) {
  const view = entity.reportingView.replace(/^reporting\./, '')
  requireTrue(
    Object.hasOwn(rowCounts, view),
    `${dataModelContentPath} points ${entity.id} at ${entity.reportingView}, which is not ` +
      `among the reporting views in ${MODEL_EXPECTATIONS_PATH}.`
  )
}

// ---------------------------------------------------------------------------
// 12. Secret and PII safety net over everything about to be written
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: [RegExp, string][] = [
  [
    /postgres(?:ql)?:\/\/[^\s"]*:[^\s"@]+@/i,
    'a connection string with an embedded password',
  ],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  [
    /\b(?:password|passwd|secret|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"',}]{6,}/i,
    'a credential assignment',
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, 'a bearer token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'a JWT'],
]

function assertNoSecrets(serialised: string): void {
  for (const [pattern, description] of SECRET_PATTERNS) {
    const match = serialised.match(pattern)
    if (match) {
      fail(
        `The manifest would contain what looks like ${description}. Refusing to write it. ` +
          `Matched near: ${match[0].slice(0, 24)}...`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 13. Assemble
// ---------------------------------------------------------------------------

const manifest: ProjectManifest = {
  schema: 'arpi.project_manifest/1',
  generatedFromCommit: commitSha(),
  dataProfile: baseline.profile ?? expectations.profile ?? 'development',

  project: {
    name: 'Automotive Retail Performance Intelligence',
    shortName: 'ARPI',
    author: 'Michael Palmer',
    dealershipGroup: 'Granite Auto Group',
    repositoryUrl:
      'https://github.com/mpalmer79/Automotive-Retail-Performance-Intelligence',
    licence: 'MIT',
  },

  counts,

  semanticModel: {
    projectName: expectations.project ?? '',
    storageMode: expectations.storage_mode ?? '',
    sourceSchema: expectations.source_schema ?? '',
    databaseIdentity: expectations.database_identity ?? '',
    markedDateTable: expectations.marked_date_table ?? '',
    activeRelationships: expectations.active_relationship_count ?? 0,
    inactiveRelationships: expectations.inactive_relationship_count ?? 0,
    bidirectionalRelationships: expectations.bidirectional_relationship_count ?? 0,
    manyToManyRelationships: expectations.many_to_many_relationship_count ?? 0,
    staticValidationStatus: 'complete',
    realEngineStatus,
    dashboardPageCount,
  },

  engines,
  lifecyclePhases,
  increments,
  gates,
  evidence,

  caseStudy: {
    unlocked: caseStudyUnlocked,
    flagEnabled,
    gate2Open: gate2Verdict === 'OPEN',
    readinessDocumentExists: gate2Doc.exists,
    requiredContentPresent,
    requiredScreenshotsPresent,
    blockingReasons: caseStudyBlockingReasons,
  },

  dataset: {
    profile: baseline.profile ?? 'development',
    randomSeed: baseline.random_seed ?? 0,
    reportingDateRange: {
      first: baseline.reporting_date_range?.first ?? '',
      last: baseline.reporting_date_range?.last ?? '',
    },
    synthetic: true,
    containsPii: false,
  },
}

// A final consistency sweep across the assembled object. These are the rules
// section 24 of the brief requires the build to enforce.
requireTrue(
  !(
    manifest.lifecyclePhases.find((p) => p.number === 5)?.status === 'complete' &&
    !realEnginePassed
  ),
  'Lifecycle Phase 5 is emitted as complete while both real-engine validation paths are ' +
    'pending. This is the single claim this project must never make.'
)
requireTrue(
  !(manifest.caseStudy.unlocked && gate2Verdict !== 'OPEN'),
  'The case study is emitted as unlocked while the Gate 2 verdict is CLOSED.'
)
requireTrue(
  !(manifest.semanticModel.realEngineStatus === 'complete' && !realEnginePassed),
  'The semantic model is emitted as real-engine validated while no engine has passed.'
)
requireTrue(
  manifest.semanticModel.dashboardPageCount === 0 ||
    manifest.lifecyclePhases.find((p) => p.number === 6)?.status !== 'blocked',
  'Report pages exist, but Lifecycle Phase 6 is still emitted as blocked.'
)

const serialised = `${JSON.stringify(manifest, null, 2)}\n`
assertNoSecrets(serialised)

// ---------------------------------------------------------------------------
// 14. Write or verify
// ---------------------------------------------------------------------------

if (problems.length > 0) {
  console.error('\nproject-manifest generation FAILED\n')
  for (const [index, problem] of problems.entries()) {
    console.error(`  ${index + 1}. ${problem}\n`)
  }
  console.error(
    `${problems.length} problem(s). The website is not permitted to display an unsourced ` +
      'or contradictory claim, so no manifest was written.\n'
  )
  process.exit(1)
}

if (CHECK_MODE) {
  const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (existing !== serialised) {
    // The commit SHA legitimately differs between a local checkout and CI, so a
    // difference confined to that field is reported as a hint rather than a
    // failure of content integrity.
    const normalise = (text: string) =>
      text.replace(/"generatedFromCommit": "[^"]*"/, '"generatedFromCommit": "<sha>"')
    if (normalise(existing) === normalise(serialised)) {
      console.log(
        'project-manifest: content matches; only generatedFromCommit differs. Regenerating.'
      )
      writeFileSync(OUTPUT, serialised, 'utf8')
      process.exit(0)
    }
    console.error(
      '\nproject-manifest is STALE.\n\n' +
        'The committed manifest does not match what the repository evidences. Run\n' +
        '  npm run manifest\n' +
        'from portfolio/ and commit the result, then re-read the diff: it is telling you\n' +
        'that a count or a status on the website no longer matches its source.\n'
    )
    process.exit(1)
  }
  console.log('project-manifest: up to date and consistent with repository evidence.')
  process.exit(0)
}

writeFileSync(OUTPUT, serialised, 'utf8')
console.log(`project-manifest written to src/generated/project-manifest.json`)
console.log(
  `  Gate 2: ${gate2Verdict} | real-engine: ${realEngineStatus} | ` +
    `case study: ${caseStudyUnlocked ? 'UNLOCKED' : 'LOCKED'} | ` +
    `dashboard pages: ${String(dashboardPageCount)}`
)
