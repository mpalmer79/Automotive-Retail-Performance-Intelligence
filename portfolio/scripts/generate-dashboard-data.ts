#!/usr/bin/env tsx
/**
 * Validate the governed dashboard export and generate the typed, client-safe artefacts.
 *
 *   src/generated/dashboard/manifest.json          client-safe manifest (trust surface)
 *   src/generated/dashboard/datasets/<name>.json   one file per unchunked dataset
 *   src/generated/dashboard/datasets/<name>/       store x month partitions, chunked datasets
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser never opens a database (ADR-0013 conditions 8-10). The console's numbers
 * come from `data/dashboard/`, exported from PostgreSQL `reporting` views by
 * `scripts/export_dashboard_dataset.py` running as `arpi_reporter`. This script is the
 * second governed stage: it proves the committed export is internally consistent and
 * current, then reshapes it into artefacts the routes can consume.
 *
 * It does NOT recompute a KPI. Not one division, not one average, not one rounding.
 * ADR-0013 condition 2 forbids a second definition of a governed formula, and a
 * "convenience" aggregate here would be exactly that. What it does compute is sums of
 * additive columns for the sole purpose of comparing them to the root manifest's
 * reconciliation block and failing on a mismatch - arithmetic used as a check, never as
 * a published figure.
 *
 * WHAT IT READS
 * -------------
 *   data/dashboard/manifest.json   the field-level contract, hashes, row counts and
 *                                  reconciliation totals
 *   data/dashboard/<dataset>.json  one file per dataset, hashed by the manifest
 *
 * The manifest is the contract authority. This script pins only the dataset REGISTRY -
 * names, business keys, date bases - in `src/types/dashboard.ts`, because a manifest
 * that silently dropped a dataset would otherwise validate cleanly. Every per-column
 * rule is read from the manifest and enforced against the files it hashes, so the
 * column contract has exactly one home: `arpi.dashboard.contract`.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *   - Accept an unknown schema or contract version.
 *   - Accept a file whose bytes do not hash to what the manifest recorded.
 *   - Accept a row count, column list, type, nullability or enumeration that disagrees
 *     with the manifest.
 *   - Accept a repeated business key, or a reference to a store, lead source or
 *     campaign that no dataset defines.
 *   - Accept a reconciliation total it cannot re-derive from the committed rows.
 *   - Accept connection detail, or a reference to a schema the console may not see.
 *   - Emit a value it did not read from the export.
 *   - Import a database library. There is none in this package, and a test asserts it.
 *
 * DETERMINISM
 * -----------
 * No clock, no random source, no filesystem ordering. Directory listings are sorted,
 * chunk keys are sorted, object keys are written in a fixed order. `--check` is a byte
 * comparison, so two runs on two machines produce identical files.
 *
 * NO ROUTE CONSUMES THESE ARTEFACTS YET. `DASH.1` ships the lane and its guards; the
 * pages arrive with `DASH.2` and later. `tests/unit/dashboard-boundaries.test.ts`
 * asserts that nothing under `src/app` or `src/components` imports them today, and that
 * the chunk files stay server-only when something eventually does.
 *
 * USAGE
 * -----
 *   tsx scripts/generate-dashboard-data.ts           write the artefacts
 *   tsx scripts/generate-dashboard-data.ts --check   fail if they would change
 *   tsx scripts/generate-dashboard-data.ts --sizes   also print the measured size table
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DASHBOARD_CLIENT_SCHEMA,
  DASHBOARD_CONTRACT_VERSION,
  DASHBOARD_DATASETS,
  DASHBOARD_EXPORT_SCHEMA,
} from '../src/types/dashboard.ts'
import type {
  DashboardCell,
  DashboardChunkPointer,
  DashboardClientColumn,
  DashboardClientDataset,
  DashboardClientManifest,
  DashboardColumnContract,
  DashboardColumnType,
  DashboardDatasetFile,
  DashboardDatasetManifest,
  DashboardDatasetName,
  DashboardExportManifest,
  DashboardReconciliationTotal,
  DashboardRow,
  DashboardSizeReport,
} from '../src/types/dashboard.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '..')
const REPO = resolve(PORTFOLIO, '..')

const EXPORT_DIR = 'data/dashboard'
const EXPORT_MANIFEST = `${EXPORT_DIR}/manifest.json`
const OUTPUT_ROOT = join(PORTFOLIO, 'src/generated/dashboard')
const DATASETS_DIR = join(OUTPUT_ROOT, 'datasets')

/**
 * The separator for a composite key.
 *
 * A unit separator, not an empty string: joining `['ab', 'c']` and `['a', 'bc']` with
 * nothing produces the same text, so an empty-string join would treat two different
 * column orders, or two different business keys, as equal. A control character cannot
 * occur in a column name or a business code, which is what makes the split safe.
 */
const KEY_SEPARATOR = '\u001f'

const CHECK_MODE = process.argv.includes('--check')
const SHOW_SIZES = process.argv.includes('--sizes')

/**
 * The privacy allowlist's belt and braces, applied to the bytes this script writes.
 *
 * The primary control is upstream: a column reaches an export only by being declared in
 * `arpi.dashboard.contract`, and the Python exporter runs the repository's
 * prohibited-name tripwire over every header. This is the second control, and it looks
 * at values rather than names, which is the gap the first one documents that it leaves.
 */
const FORBIDDEN_IN_OUTPUT: readonly {
  readonly pattern: RegExp
  readonly what: string
}[] = [
  { pattern: /\braw\./, what: 'a raw-schema object reference' },
  { pattern: /\bstaging\./, what: 'a staging-schema object reference' },
  { pattern: /\bwarehouse\./, what: 'a warehouse-schema object reference' },
  { pattern: /\baudit\./, what: 'an audit-schema object reference' },
  { pattern: /postgres(?:ql)?:\/\//i, what: 'a connection string' },
  { pattern: /\bsslmode\b/i, what: 'a connection parameter' },
  { pattern: /\bPGPASSWORD\b/, what: 'a credential environment variable' },
  { pattern: /\bpassword\b/i, what: 'a credential field' },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, what: 'an email address' },
  { pattern: /https?:\/\//i, what: 'a URL' },
  {
    // A VIN is 17 characters from a 33-letter alphabet with at least one digit. No
    // dashboard dataset carries a vehicle identifier at all, so any match is a leak.
    pattern: /\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b/,
    what: 'a VIN-shaped identifier',
  },
]

/* -------------------------------------------------------------------------- */
/* Failure reporting. Every problem is collected so one run reports all of them. */
/* -------------------------------------------------------------------------- */

const problems: string[] = []

function fail(message: string): void {
  problems.push(message)
}

function requireTrue(condition: boolean, message: string): void {
  if (!condition) fail(message)
}

function repoPath(relative: string): string {
  return join(REPO, relative)
}

function sha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/* -------------------------------------------------------------------------- */
/* Runtime validation of external JSON                                         */
/* -------------------------------------------------------------------------- */
/*
 * Every value below starts as `unknown` and is narrowed by a check that can fail with a
 * message naming the field. There is no `as` cast onto parsed JSON anywhere in this
 * script: an assertion would make a malformed manifest a runtime crash three functions
 * later instead of a reported problem here.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(relative: string): unknown {
  const path = repoPath(relative)
  if (!existsSync(path)) {
    fail(
      `${relative} is missing. Generate the export with\n` +
        '    python scripts/export_dashboard_dataset.py\n' +
        '  against a loaded warehouse, and commit the result.'
    )
    return undefined
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    fail(`${relative} is not valid JSON: ${String(error)}`)
    return undefined
  }
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  where: string
): string {
  const value = source[key]
  if (typeof value !== 'string' || value === '') {
    fail(`${where} has no usable string "${key}" (found ${JSON.stringify(value)}).`)
    return ''
  }
  return value
}

function requireNumber(
  source: Record<string, unknown>,
  key: string,
  where: string
): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where} has no usable number "${key}" (found ${JSON.stringify(value)}).`)
    return 0
  }
  return value
}

function requireStringArray(
  source: Record<string, unknown>,
  key: string,
  where: string
): readonly string[] {
  const value = source[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(`${where} has no usable string array "${key}".`)
    return []
  }
  return value as readonly string[]
}

const COLUMN_TYPES: readonly DashboardColumnType[] = [
  'currency',
  'exact',
  'double',
  'integer',
  'date',
  'string',
  'boolean',
]

function readColumnContract(
  raw: unknown,
  dataset: string,
  index: number
): DashboardColumnContract | undefined {
  const where = `${dataset} column ${String(index)}`
  if (!isRecord(raw)) {
    fail(`${where} is not an object in the export manifest.`)
    return undefined
  }
  const name = requireString(raw, 'name', where)
  const type = raw['type']
  if (typeof type !== 'string' || !COLUMN_TYPES.includes(type as DashboardColumnType)) {
    fail(
      `${where} (${name}) declares type ${JSON.stringify(type)}, which this consumer does not ` +
        `understand. Known types: ${COLUMN_TYPES.join(', ')}.`
    )
    return undefined
  }
  if (typeof raw['nullable'] !== 'boolean') {
    fail(`${where} (${name}) does not declare a boolean "nullable".`)
    return undefined
  }
  if (raw['class'] !== 'non-personal') {
    fail(
      `${where} (${name}) is classified ${JSON.stringify(raw['class'])}. Only "non-personal" is ` +
        'eligible for public export.'
    )
    return undefined
  }
  const enumeration = raw['enumeration']
  if (
    enumeration !== null &&
    (!Array.isArray(enumeration) ||
      enumeration.some((entry) => typeof entry !== 'string'))
  ) {
    fail(`${where} (${name}) declares a malformed enumeration.`)
    return undefined
  }
  const unit = raw['unit']
  const precision = raw['display_precision']
  return {
    name,
    type: type as DashboardColumnType,
    nullable: raw['nullable'],
    class: 'non-personal',
    unit: typeof unit === 'string' ? unit : null,
    display_precision: typeof precision === 'number' ? precision : null,
    enumeration: enumeration === null ? null : (enumeration as readonly string[]),
    source_column: requireString(raw, 'source_column', where),
  }
}

function readDatasetManifest(
  raw: unknown,
  index: number
): DashboardDatasetManifest | undefined {
  const where = `${EXPORT_MANIFEST} datasets[${String(index)}]`
  if (!isRecord(raw)) {
    fail(`${where} is not an object.`)
    return undefined
  }
  const name = requireString(raw, 'name', where)
  const rawColumns = raw['columns']
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    fail(`${where} (${name}) declares no columns.`)
    return undefined
  }
  const columns: DashboardColumnContract[] = []
  for (const [position, entry] of rawColumns.entries()) {
    const column = readColumnContract(entry, name, position)
    if (column) columns.push(column)
  }
  if (columns.length !== rawColumns.length) return undefined

  const dateBasis = raw['date_basis']
  const notes = raw['notes']
  return {
    name,
    source_view: requireString(raw, 'source_view', where),
    join_views: Array.isArray(raw['join_views'])
      ? requireStringArray(raw, 'join_views', where)
      : [],
    grain: requireString(raw, 'grain', where),
    business_key: requireStringArray(raw, 'business_key', where),
    date_basis: typeof dateBasis === 'string' ? dateBasis : null,
    sort_keys: requireStringArray(raw, 'sort_keys', where),
    chunked: raw['chunked'] === true,
    kpi_ids: Array.isArray(raw['kpi_ids'])
      ? requireStringArray(raw, 'kpi_ids', where)
      : [],
    columns,
    notes: typeof notes === 'string' ? notes : '',
    query_sha256: requireString(raw, 'query_sha256', where),
    row_count: requireNumber(raw, 'row_count', where),
    file: requireString(raw, 'file', where),
    file_sha256: requireString(raw, 'file_sha256', where),
    file_bytes: requireNumber(raw, 'file_bytes', where),
  }
}

function readReconciliationTotals(
  raw: unknown
): Readonly<Record<string, DashboardReconciliationTotal>> {
  if (!isRecord(raw)) {
    fail(`${EXPORT_MANIFEST} reconciliation.totals is not an object.`)
    return {}
  }
  const totals: Record<string, DashboardReconciliationTotal> = {}
  for (const [name, entry] of Object.entries(raw).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const where = `${EXPORT_MANIFEST} reconciliation total "${name}"`
    if (!isRecord(entry)) {
      fail(`${where} is not an object.`)
      continue
    }
    const kpiId = entry['kpi_id']
    const unit = entry['unit']
    const precision = entry['display_precision']
    const shared = {
      dataset: requireString(entry, 'dataset', where),
      kpi_id: typeof kpiId === 'string' ? kpiId : null,
      unit: typeof unit === 'string' ? unit : null,
      display_precision: typeof precision === 'number' ? precision : null,
    }
    if (typeof entry['total'] === 'string') {
      totals[name] = {
        ...shared,
        column: requireString(entry, 'column', where),
        total: entry['total'],
      }
      continue
    }
    if (
      typeof entry['numerator'] === 'string' &&
      typeof entry['denominator'] === 'string'
    ) {
      totals[name] = {
        ...shared,
        numerator_column: requireString(entry, 'numerator_column', where),
        denominator_column: requireString(entry, 'denominator_column', where),
        numerator: entry['numerator'],
        denominator: entry['denominator'],
      }
      continue
    }
    fail(
      `${where} is neither a plain total (column + total) nor a ratio ` +
        '(numerator_column + denominator_column + numerator + denominator).'
    )
  }
  return totals
}

/* -------------------------------------------------------------------------- */
/* 1. The root manifest                                                        */
/* -------------------------------------------------------------------------- */

function readExportManifest(): DashboardExportManifest | undefined {
  const raw = readJson(EXPORT_MANIFEST)
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    fail(`${EXPORT_MANIFEST} does not contain a JSON object.`)
    return undefined
  }

  if (raw['schema'] !== DASHBOARD_EXPORT_SCHEMA) {
    fail(
      `${EXPORT_MANIFEST} declares schema ${JSON.stringify(raw['schema'])}. This consumer ` +
        `understands ${DASHBOARD_EXPORT_SCHEMA} and refuses an unknown version rather than ` +
        'guessing at a shape.'
    )
    return undefined
  }
  if (raw['contract_version'] !== DASHBOARD_CONTRACT_VERSION) {
    fail(
      `${EXPORT_MANIFEST} declares contract_version ` +
        `${JSON.stringify(raw['contract_version'])}; this consumer understands ` +
        `${String(DASHBOARD_CONTRACT_VERSION)}.`
    )
    return undefined
  }
  requireTrue(
    raw['stale'] === false,
    `${EXPORT_MANIFEST} declares stale=true. A stale export never reaches a build.`
  )
  requireTrue(
    raw['synthetic_data'] === true && raw['fictional_dealer_group'] === true,
    `${EXPORT_MANIFEST} must declare synthetic_data and fictional_dealer_group true. The ` +
      'console labels every figure it renders as synthetic, and the label comes from here.'
  )

  const rawDatasets = raw['datasets']
  if (!Array.isArray(rawDatasets)) {
    fail(`${EXPORT_MANIFEST} carries no datasets array.`)
    return undefined
  }
  const datasets: DashboardDatasetManifest[] = []
  for (const [index, entry] of rawDatasets.entries()) {
    const dataset = readDatasetManifest(entry, index)
    if (dataset) datasets.push(dataset)
  }
  if (datasets.length !== rawDatasets.length) return undefined

  const reconciliation = raw['reconciliation']
  const privacy = raw['privacy_scan']
  const validation = raw['validation']
  const run = raw['pipeline_run']
  if (
    !isRecord(reconciliation) ||
    !isRecord(privacy) ||
    !isRecord(validation) ||
    !isRecord(run)
  ) {
    fail(
      `${EXPORT_MANIFEST} is missing one of the reconciliation, privacy_scan, validation or ` +
        'pipeline_run blocks. The console renders its trust surface from all four.'
    )
    return undefined
  }
  requireTrue(
    reconciliation['status'] === 'passed',
    `${EXPORT_MANIFEST} reports reconciliation status ` +
      `${JSON.stringify(reconciliation['status'])}, not "passed".`
  )
  requireTrue(
    privacy['status'] === 'passed' && privacy['prohibited_hits'] === 0,
    `${EXPORT_MANIFEST} reports a privacy scan of ${JSON.stringify(privacy['status'])} with ` +
      `${JSON.stringify(privacy['prohibited_hits'])} prohibited hit(s).`
  )
  requireTrue(
    validation['critical_failures'] === 0,
    `${EXPORT_MANIFEST} records ${JSON.stringify(validation['critical_failures'])} critical ` +
      'validation failure(s); a build may not consume such an export.'
  )
  requireTrue(
    run['status'] === 'succeeded',
    `${EXPORT_MANIFEST} records pipeline-run status ${JSON.stringify(run['status'])}.`
  )
  const limitations = requireStringArray(raw, 'limitations', EXPORT_MANIFEST)
  requireTrue(
    limitations.length > 0,
    `${EXPORT_MANIFEST} carries no limitations. Every figure the console renders inherits them.`
  )

  const logicalRunKey = run['logical_run_key']
  const sizes = isRecord(raw['sizes']) ? raw['sizes'] : {}
  const largest = isRecord(sizes['largest_dataset']) ? sizes['largest_dataset'] : {}
  const limits = isRecord(sizes['limits']) ? sizes['limits'] : {}

  return {
    schema: DASHBOARD_EXPORT_SCHEMA,
    contract_version: DASHBOARD_CONTRACT_VERSION,
    contract_sha256: requireString(raw, 'contract_sha256', EXPORT_MANIFEST),
    dataset_version: requireNumber(raw, 'dataset_version', EXPORT_MANIFEST),
    generated_at: requireString(raw, 'generated_at', EXPORT_MANIFEST),
    as_of_date: requireString(raw, 'as_of_date', EXPORT_MANIFEST),
    profile: requireString(raw, 'profile', EXPORT_MANIFEST),
    random_seed: requireNumber(raw, 'random_seed', EXPORT_MANIFEST),
    source_commit: requireString(raw, 'source_commit', EXPORT_MANIFEST),
    exporter_version: requireString(raw, 'exporter_version', EXPORT_MANIFEST),
    query_normalisation: requireString(raw, 'query_normalisation', EXPORT_MANIFEST),
    reporter_role: requireString(raw, 'reporter_role', EXPORT_MANIFEST),
    synthetic_data: true,
    fictional_dealer_group: true,
    pipeline_run: {
      run_uuid: requireString(run, 'run_uuid', `${EXPORT_MANIFEST} pipeline_run`),
      logical_run_key: typeof logicalRunKey === 'string' ? logicalRunKey : null,
      status: requireString(run, 'status', `${EXPORT_MANIFEST} pipeline_run`),
    },
    source_views: requireStringArray(raw, 'source_views', EXPORT_MANIFEST),
    datasets,
    reconciliation: {
      status: requireString(
        reconciliation,
        'status',
        `${EXPORT_MANIFEST} reconciliation`
      ),
      method: requireString(
        reconciliation,
        'method',
        `${EXPORT_MANIFEST} reconciliation`
      ),
      totals: readReconciliationTotals(reconciliation['totals']),
    },
    privacy_scan: {
      status: requireString(privacy, 'status', `${EXPORT_MANIFEST} privacy_scan`),
      prohibited_hits: requireNumber(
        privacy,
        'prohibited_hits',
        `${EXPORT_MANIFEST} privacy_scan`
      ),
      columns_scanned: requireNumber(
        privacy,
        'columns_scanned',
        `${EXPORT_MANIFEST} privacy_scan`
      ),
      primary_control: requireString(
        privacy,
        'primary_control',
        `${EXPORT_MANIFEST} privacy_scan`
      ),
      secondary_control: requireString(
        privacy,
        'secondary_control',
        `${EXPORT_MANIFEST} privacy_scan`
      ),
    },
    validation: {
      critical_failures: requireNumber(
        validation,
        'critical_failures',
        `${EXPORT_MANIFEST} validation`
      ),
      warnings: requireNumber(validation, 'warnings', `${EXPORT_MANIFEST} validation`),
      checks_evaluated: requireNumber(
        validation,
        'checks_evaluated',
        `${EXPORT_MANIFEST} validation`
      ),
      reconciliations_evaluated: requireNumber(
        validation,
        'reconciliations_evaluated',
        `${EXPORT_MANIFEST} validation`
      ),
      reconciliations_failed: requireNumber(
        validation,
        'reconciliations_failed',
        `${EXPORT_MANIFEST} validation`
      ),
    },
    sizes: {
      dataset_bytes_total:
        typeof sizes['dataset_bytes_total'] === 'number'
          ? sizes['dataset_bytes_total']
          : 0,
      largest_dataset: {
        name: typeof largest['name'] === 'string' ? largest['name'] : '',
        bytes: typeof largest['bytes'] === 'number' ? largest['bytes'] : 0,
        rows: typeof largest['rows'] === 'number' ? largest['rows'] : 0,
      },
      limits: Object.fromEntries(
        Object.entries(limits).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number'
        )
      ),
    },
    stale: false,
    limitations,
  }
}

/* -------------------------------------------------------------------------- */
/* 2. The pinned registry, checked in both directions                          */
/* -------------------------------------------------------------------------- */

function checkRegistry(manifest: DashboardExportManifest): void {
  const pinned = DASHBOARD_DATASETS.map((entry) => entry.name)
  const declared = manifest.datasets.map((entry) => entry.name)

  if (declared.join(KEY_SEPARATOR) !== pinned.join(KEY_SEPARATOR)) {
    fail(
      `${EXPORT_MANIFEST} declares datasets [${declared.join(', ')}]; this consumer expects ` +
        `[${pinned.join(', ')}], in that order. A dataset added, removed or renamed upstream is ` +
        'a reviewed change to src/types/dashboard.ts, not something a manifest may do silently.'
    )
    return
  }

  for (const expected of DASHBOARD_DATASETS) {
    const actual = manifest.datasets.find((entry) => entry.name === expected.name)
    if (!actual) continue
    requireTrue(
      actual.business_key.join(',') === expected.businessKey.join(','),
      `dataset ${expected.name} declares business key [${actual.business_key.join(', ')}] but ` +
        `this consumer pins [${expected.businessKey.join(', ')}]. The grain changed.`
    )
    requireTrue(
      actual.date_basis === expected.dateBasis,
      `dataset ${expected.name} declares date basis ${JSON.stringify(actual.date_basis)} but ` +
        `this consumer pins ${JSON.stringify(expected.dateBasis)}. The console labels every ` +
        'figure with its date basis, so a silent change would mislabel a chart.'
    )
    requireTrue(
      actual.chunked === expected.chunked,
      `dataset ${expected.name} declares chunked=${String(actual.chunked)} but this consumer ` +
        `pins ${String(expected.chunked)}.`
    )
  }

  for (const view of manifest.source_views) {
    requireTrue(
      view.startsWith('reporting.'),
      `${EXPORT_MANIFEST} names source view ${view}, which is not in the reporting schema. ` +
        'ADR-0013 condition 8 permits no other.'
    )
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Reading and validating each dataset                                      */
/* -------------------------------------------------------------------------- */

interface LoadedDataset {
  readonly manifest: DashboardDatasetManifest
  readonly rows: readonly DashboardRow[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** An exact positional decimal. Exponent notation is refused: it is a second spelling. */
const EXACT_DECIMAL = /^-?\d+(?:\.\d+)?$/

function cellMatchesType(type: DashboardColumnType, value: DashboardCell): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'double':
      return typeof value === 'number' && Number.isFinite(value)
    case 'currency':
      return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value)
    case 'exact':
      return typeof value === 'string' && EXACT_DECIMAL.test(value)
    case 'date':
      return typeof value === 'string' && ISO_DATE.test(value)
    case 'string':
      return typeof value === 'string'
  }
}

function isCell(value: unknown): value is DashboardCell {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function loadDataset(entry: DashboardDatasetManifest): LoadedDataset | undefined {
  const relative = `${EXPORT_DIR}/${entry.file}`
  const path = repoPath(relative)
  if (!existsSync(path)) {
    fail(`${relative} is missing, but ${EXPORT_MANIFEST} declares it.`)
    return undefined
  }
  const text = readFileSync(path, 'utf8')

  const digest = sha256(text)
  if (digest !== entry.file_sha256) {
    fail(
      `${relative} hashes to ${digest} but ${EXPORT_MANIFEST} records ${entry.file_sha256}. The ` +
        'committed file and its manifest disagree: one of them was edited by hand. Regenerate ' +
        'the export rather than reconciling them by hand.'
    )
    return undefined
  }
  if (Buffer.byteLength(text, 'utf8') !== entry.file_bytes) {
    fail(
      `${relative} is ${String(Buffer.byteLength(text, 'utf8'))} bytes but the manifest records ` +
        `${String(entry.file_bytes)}.`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    fail(`${relative} is not valid JSON: ${String(error)}`)
    return undefined
  }
  if (!Array.isArray(parsed)) {
    fail(`${relative} does not contain a JSON array.`)
    return undefined
  }
  if (parsed.length !== entry.row_count) {
    fail(
      `${relative} holds ${String(parsed.length)} row(s) but the manifest records ` +
        `${String(entry.row_count)}.`
    )
    return undefined
  }

  const expectedColumns = entry.columns.map((column) => column.name)
  const rows: DashboardRow[] = []
  const seenKeys = new Set<string>()
  let reported = 0

  for (const [index, raw] of parsed.entries()) {
    if (!isRecord(raw)) {
      fail(`${relative} row ${String(index)} is not a JSON object.`)
      break
    }
    if (Object.keys(raw).join(KEY_SEPARATOR) !== expectedColumns.join(KEY_SEPARATOR)) {
      fail(
        `${relative} row ${String(index)} declares keys [${Object.keys(raw).join(', ')}]; the ` +
          `manifest declares [${expectedColumns.join(', ')}], in that order.`
      )
      break
    }
    const row: Record<string, DashboardCell> = {}
    for (const column of entry.columns) {
      const value = raw[column.name]
      if (!isCell(value)) {
        if (reported < 5) {
          fail(
            `${relative} row ${String(index)} column ${column.name} is not a scalar value.`
          )
          reported += 1
        }
        continue
      }
      if (value === null) {
        if (!column.nullable && reported < 5) {
          fail(
            `${relative} row ${String(index)} has a null ${column.name}, which the manifest ` +
              'declares required. Null means "not applicable or not observed" and a required ' +
              'column may not carry one.'
          )
          reported += 1
        }
      } else if (!cellMatchesType(column.type, value) && reported < 5) {
        fail(
          `${relative} row ${String(index)} column ${column.name} carries ` +
            `${JSON.stringify(value)}, which is not a valid ${column.type} value.`
        )
        reported += 1
      } else if (
        column.enumeration &&
        typeof value === 'string' &&
        !column.enumeration.includes(value) &&
        reported < 5
      ) {
        fail(
          `${relative} row ${String(index)} column ${column.name} carries ` +
            `${JSON.stringify(value)}, outside its closed enumeration ` +
            `(${column.enumeration.join(', ')}).`
        )
        reported += 1
      }
      row[column.name] = value
    }

    const key = entry.business_key
      .map((name) => JSON.stringify(row[name]))
      .join(KEY_SEPARATOR)
    if (seenKeys.has(key)) {
      fail(
        `${relative} repeats the business key (${entry.business_key.join(', ')}) = ${key}. The ` +
          `declared grain is: ${entry.grain}`
      )
    }
    seenKeys.add(key)
    rows.push(row)
  }

  return { manifest: entry, rows }
}

/* -------------------------------------------------------------------------- */
/* 4. Referential integrity                                                    */
/* -------------------------------------------------------------------------- */
/*
 * Every business code a measure row carries must resolve to a dimension row the export
 * also carries. Without this a chart would silently drop a store, or label a funnel row
 * with a campaign code nothing defines.
 */

function checkReferences(loaded: ReadonlyMap<DashboardDatasetName, LoadedDataset>): void {
  const codes = (dataset: DashboardDatasetName, column: string): ReadonlySet<string> => {
    const entry = loaded.get(dataset)
    if (!entry) return new Set()
    return new Set(
      entry.rows.flatMap((row) => {
        const value = row[column]
        return typeof value === 'string' ? [value] : []
      })
    )
  }

  const stores = codes('stores', 'dealership_id')
  const sources = codes('lead-sources', 'lead_source_code')
  const campaigns = codes('campaigns', 'campaign_code')
  const dates = codes('calendar', 'calendar_date')

  const references: readonly {
    readonly column: string
    readonly universe: ReadonlySet<string>
    readonly owner: string
  }[] = [
    { column: 'dealership_id', universe: stores, owner: 'stores' },
    { column: 'lead_source_code', universe: sources, owner: 'lead-sources' },
    { column: 'campaign_code', universe: campaigns, owner: 'campaigns' },
  ]

  for (const [name, entry] of loaded) {
    if (name === 'stores' || name === 'lead-sources' || name === 'campaigns') continue
    for (const { column, universe, owner } of references) {
      if (!entry.manifest.columns.some((declared) => declared.name === column)) continue
      const unresolved = [
        ...new Set(
          entry.rows.flatMap((row) => {
            const value = row[column]
            return typeof value === 'string' && !universe.has(value) ? [value] : []
          })
        ),
      ].sort()
      requireTrue(
        unresolved.length === 0,
        `dataset ${name} references ${column} value(s) [${unresolved.join(', ')}] that the ` +
          `${owner} dataset does not define. An unresolved reference would render as a row ` +
          'nothing can be labelled with.'
      )
    }

    const dateColumn = entry.manifest.columns.find((column) => column.type === 'date')
    if (!dateColumn || entry.manifest.date_basis === null) continue
    const outside = [
      ...new Set(
        entry.rows.flatMap((row) => {
          const value = row[dateColumn.name]
          return typeof value === 'string' && !dates.has(value) ? [value] : []
        })
      ),
    ].sort()
    requireTrue(
      outside.length === 0,
      `dataset ${name} carries ${dateColumn.name} value(s) [${outside.slice(0, 5).join(', ')}] ` +
        'outside the exported calendar. Period filters resolve against the calendar dataset, so ' +
        'a date it does not contain is unfilterable.'
    )
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Reconciliation: recompute, compare, never publish                        */
/* -------------------------------------------------------------------------- */
/*
 * EXACT DECIMAL ARITHMETIC WITHOUT A LIBRARY, AND WITHOUT A FLOAT.
 *
 * Each value is split into sign, integer digits and fraction digits, rescaled to a
 * common number of decimal places, and summed as a `bigint`. `Number` is never applied
 * to a monetary string: `0.1 + 0.2` is the reason this code exists.
 *
 * The sum is used only to compare against the root manifest. Nothing derived here is
 * written to an artefact - ADR-0013 condition 2 keeps KPI arithmetic in SQL.
 */

interface Scaled {
  readonly units: bigint
  readonly scale: number
}

function parseExact(value: string): Scaled | undefined {
  if (!EXACT_DECIMAL.test(value)) return undefined
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  const [whole = '0', fraction = ''] = digits.split('.')
  const units = BigInt(whole + fraction)
  return { units: negative ? -units : units, scale: fraction.length }
}

function rescale(value: Scaled, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale)
}

function render(units: bigint, scale: number): string {
  const negative = units < 0n
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** Sum one column exactly. Null is absent, never zero. */
function sumColumn(
  rows: readonly DashboardRow[],
  column: string
): { units: bigint; scale: number } {
  const values: Scaled[] = []
  for (const row of rows) {
    const value = row[column]
    if (value === null || value === undefined) continue
    const parsed =
      typeof value === 'number' ? parseExact(String(value)) : parseExact(String(value))
    if (parsed === undefined) {
      fail(
        `column ${column} carries ${JSON.stringify(value)}, which is not an exact decimal.`
      )
      return { units: 0n, scale: 0 }
    }
    values.push(parsed)
  }
  const scale = values.reduce((widest, value) => Math.max(widest, value.scale), 0)
  const units = values.reduce((total, value) => total + rescale(value, scale), 0n)
  return { units, scale }
}

/** Compare two exact decimal strings for numeric equality, ignoring trailing-zero padding. */
function sameExactValue(left: string, right: string): boolean {
  const a = parseExact(left)
  const b = parseExact(right)
  if (!a || !b) return false
  const scale = Math.max(a.scale, b.scale)
  return rescale(a, scale) === rescale(b, scale)
}

function checkReconciliation(
  manifest: DashboardExportManifest,
  loaded: ReadonlyMap<DashboardDatasetName, LoadedDataset>
): void {
  for (const [name, total] of Object.entries(manifest.reconciliation.totals)) {
    const dataset = loaded.get(total.dataset as DashboardDatasetName)
    if (!dataset) {
      fail(
        `reconciliation total ${name} names dataset ${total.dataset}, which was not loaded.`
      )
      continue
    }
    const components =
      'column' in total
        ? [{ label: 'total', column: total.column, expected: total.total }]
        : [
            {
              label: 'numerator',
              column: total.numerator_column,
              expected: total.numerator,
            },
            {
              label: 'denominator',
              column: total.denominator_column,
              expected: total.denominator,
            },
          ]

    for (const { label, column, expected } of components) {
      const { units, scale } = sumColumn(dataset.rows, column)
      const actual = render(units, scale)
      requireTrue(
        sameExactValue(actual, expected),
        `reconciliation total ${name}: summing ${total.dataset}.${column} over the committed ` +
          `rows gives ${actual}, but ${EXPORT_MANIFEST} records a ${label} of ${expected}. The ` +
          'export and its own manifest disagree; regenerate it.'
      )
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Chunking                                                                 */
/* -------------------------------------------------------------------------- */
/*
 * Chunk keys are stable business dimensions: store business code x calendar month, per
 * DATA_CONTRACT.md section 9. A partition is a pure regrouping of exported rows - no
 * row is dropped, duplicated or altered - and the chunk index carries every key with
 * its row count so a missing partition is a check failure rather than an empty page.
 */

const CHUNK_SIZE_CEILING = 256 * 1024

interface Chunk {
  readonly dealershipId: string
  readonly month: string
  readonly rows: readonly DashboardRow[]
}

function chunkDataset(entry: LoadedDataset): readonly Chunk[] {
  const dateColumn = entry.manifest.columns.find((column) => column.type === 'date')
  if (!dateColumn) {
    fail(
      `dataset ${entry.manifest.name} is declared chunked but carries no date column to ` +
        'partition by month.'
    )
    return []
  }
  const buckets = new Map<string, DashboardRow[]>()
  for (const row of entry.rows) {
    const store = row['dealership_id']
    const date = row[dateColumn.name]
    if (typeof store !== 'string' || typeof date !== 'string') {
      fail(
        `dataset ${entry.manifest.name} has a row without a usable chunk key ` +
          `(dealership_id, ${dateColumn.name}).`
      )
      return []
    }
    const key = `${store}${KEY_SEPARATOR}${date.slice(0, 7)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const [dealershipId = '', month = ''] = key.split(KEY_SEPARATOR)
      return { dealershipId, month, rows }
    })
}

/* -------------------------------------------------------------------------- */
/* 7. Serialisation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One row per line, LF endings, trailing newline, values in `columns` order.
 *
 * See `DashboardDatasetFile` for why this file is columnar while the root export is not.
 * One row per line is kept regardless: it is what makes a change to a single period
 * legible in review even in a machine-consumed file.
 */
function serialiseDataset(file: DashboardDatasetFile): string {
  const header =
    `{\n  "dataset": ${JSON.stringify(file.dataset)},\n` +
    `  "rowCount": ${String(file.rowCount)},\n` +
    `  "columns": ${JSON.stringify(file.columns)},\n  "rows": [`
  if (file.rows.length === 0) return `${header}]\n}\n`
  const rows = file.rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n')
  return `${header}\n${rows}\n  ]\n}\n`
}

/** Project a validated row object onto the dataset's column order. */
function toValues(
  columns: readonly string[],
  row: DashboardRow
): readonly DashboardCell[] {
  return columns.map((column) => row[column] ?? null)
}

function serialiseManifest(manifest: DashboardClientManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function assertSanitized(label: string, serialised: string): void {
  for (const { pattern, what } of FORBIDDEN_IN_OUTPUT) {
    const found = pattern.exec(serialised)
    if (found) {
      fail(
        `${label} contains ${what}: "${found[0]}". The generated dashboard data is public, and ` +
          'nothing in the export lane may carry connection detail, an internal object path, or a ' +
          'value the sanitization contract says should never have existed. Fix the export rather ' +
          'than the assertion.'
      )
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 8. Build                                                                    */
/* -------------------------------------------------------------------------- */

const manifest = readExportManifest()

interface Artefact {
  readonly path: string
  readonly label: string
  readonly body: string
}

const artefacts: Artefact[] = []
const clientDatasets: DashboardClientDataset[] = []

if (manifest) {
  checkRegistry(manifest)

  const loaded = new Map<DashboardDatasetName, LoadedDataset>()
  for (const entry of manifest.datasets) {
    const dataset = loadDataset(entry)
    if (dataset) loaded.set(entry.name as DashboardDatasetName, dataset)
  }

  if (loaded.size === manifest.datasets.length) {
    checkReferences(loaded)
    checkReconciliation(manifest, loaded)
  }

  for (const entry of manifest.datasets) {
    const dataset = loaded.get(entry.name as DashboardDatasetName)
    if (!dataset) continue
    const columns = entry.columns.map((column) => column.name)
    const clientColumns: readonly DashboardClientColumn[] = entry.columns.map(
      (column) => ({
        name: column.name,
        type: column.type,
        nullable: column.nullable,
        unit: column.unit,
        displayPrecision: column.display_precision,
        enumeration: column.enumeration,
      })
    )

    let chunks: DashboardChunkPointer[] | null = null

    if (entry.chunked) {
      chunks = []
      let reconciled = 0
      for (const chunk of chunkDataset(dataset)) {
        const file = `datasets/${entry.name}/${chunk.dealershipId}/${chunk.month}.json`
        const body = serialiseDataset({
          dataset: entry.name as DashboardDatasetName,
          rowCount: chunk.rows.length,
          columns,
          rows: chunk.rows.map((row) => toValues(columns, row)),
        })
        reconciled += chunk.rows.length
        chunks.push({
          dealershipId: chunk.dealershipId,
          month: chunk.month,
          file,
          rowCount: chunk.rows.length,
          bytes: Buffer.byteLength(body, 'utf8'),
        })
        artefacts.push({ path: join(OUTPUT_ROOT, file), label: file, body })
      }
      requireTrue(
        reconciled === dataset.rows.length,
        `dataset ${entry.name} chunked to ${String(reconciled)} row(s) from ` +
          `${String(dataset.rows.length)}. Partitioning is a regrouping: no row may be lost or ` +
          'duplicated.'
      )
      for (const pointer of chunks) {
        requireTrue(
          pointer.bytes <= CHUNK_SIZE_CEILING,
          `${pointer.file} is ${String(pointer.bytes)} bytes, which exceeds the ` +
            `${String(CHUNK_SIZE_CEILING)}-byte chunk ceiling (DATA_CONTRACT.md section 10).`
        )
      }
    } else {
      const file = `datasets/${entry.name}.json`
      const body = serialiseDataset({
        dataset: entry.name as DashboardDatasetName,
        rowCount: dataset.rows.length,
        columns,
        rows: dataset.rows.map((row) => toValues(columns, row)),
      })
      artefacts.push({ path: join(OUTPUT_ROOT, file), label: file, body })
    }

    clientDatasets.push({
      name: entry.name as DashboardDatasetName,
      grain: entry.grain,
      businessKey: entry.business_key,
      dateBasis: entry.date_basis,
      kpiIds: entry.kpi_ids,
      rowCount: dataset.rows.length,
      columns: clientColumns,
      chunks,
    })
  }
}

/* -------------------------------------------------------------------------- */
/* 9. The client-safe manifest                                                 */
/* -------------------------------------------------------------------------- */

if (manifest) {
  const rootExportBytes = manifest.datasets.reduce(
    (total, entry) => total + entry.file_bytes,
    0
  )
  const datasetBytes = artefacts.reduce(
    (total, artefact) => total + Buffer.byteLength(artefact.body, 'utf8'),
    0
  )
  const largest = artefacts.reduce(
    (widest, artefact) => {
      const bytes = Buffer.byteLength(artefact.body, 'utf8')
      return bytes > widest.bytes ? { file: artefact.label, bytes } : widest
    },
    { file: '', bytes: 0 }
  )

  const sizes: DashboardSizeReport = {
    // The manifest's own bytes cannot be counted inside itself, so this is the dataset
    // total and the file count excludes the manifest. The `--sizes` report below prints
    // the complete figure.
    totalBytes: datasetBytes,
    fileCount: artefacts.length,
    largestFile: largest,
    rootExportBytes,
  }

  const clientManifest: DashboardClientManifest = {
    schema: DASHBOARD_CLIENT_SCHEMA,
    datasetVersion: manifest.dataset_version,
    contractVersion: manifest.contract_version,
    contractSha256: manifest.contract_sha256,
    generatedAt: manifest.generated_at,
    asOfDate: manifest.as_of_date,
    profile: manifest.profile,
    randomSeed: manifest.random_seed,
    sourceCommit: manifest.source_commit,
    exporterVersion: manifest.exporter_version,
    syntheticData: true,
    fictionalDealerGroup: true,
    pipelineRunUuid: manifest.pipeline_run.run_uuid,
    pipelineRunStatus: manifest.pipeline_run.status,
    sourceViews: manifest.source_views,
    reconciliationStatus: manifest.reconciliation.status,
    reconciliationMethod: manifest.reconciliation.method,
    reconciliationTotals: manifest.reconciliation.totals,
    privacyScanStatus: manifest.privacy_scan.status,
    validationCriticalFailures: manifest.validation.critical_failures,
    validationWarnings: manifest.validation.warnings,
    reconciliationsEvaluated: manifest.validation.reconciliations_evaluated,
    reconciliationsFailed: manifest.validation.reconciliations_failed,
    stale: false,
    limitations: manifest.limitations,
    datasets: clientDatasets,
    sizes,
  }

  artefacts.push({
    path: join(OUTPUT_ROOT, 'manifest.json'),
    label: 'manifest.json',
    body: serialiseManifest(clientManifest),
  })
}

for (const artefact of artefacts) {
  assertSanitized(artefact.label, artefact.body)
}

/* -------------------------------------------------------------------------- */
/* 10. Write or verify                                                         */
/* -------------------------------------------------------------------------- */

if (problems.length > 0) {
  console.error('\ndashboard data generation FAILED\n')
  for (const [index, problem] of problems.entries()) {
    console.error(`  ${String(index + 1)}. ${problem}\n`)
  }
  console.error(
    `${String(problems.length)} problem(s). The console is not permitted to display a figure it ` +
      'cannot trace to an approved reporting view, so nothing was written.\n'
  )
  process.exit(1)
}

/** Every file currently under the generated tree, repository-relative to OUTPUT_ROOT. */
function existingFiles(directory: string, prefix = ''): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory())
      found.push(...existingFiles(join(directory, entry.name), relative))
    else found.push(relative)
  }
  return found
}

const expected = new Set(artefacts.map((artefact) => artefact.label))
const present = existingFiles(OUTPUT_ROOT)
const unexpected = present.filter((name) => !expected.has(name))

const totalBytes = artefacts.reduce(
  (total, artefact) => total + Buffer.byteLength(artefact.body, 'utf8'),
  0
)

function reportSizes(): void {
  if (!SHOW_SIZES) return
  console.log('\n  generated artefact sizes (bytes)')
  const rows = artefacts
    .map((artefact) => ({
      label: artefact.label,
      bytes: Buffer.byteLength(artefact.body, 'utf8'),
    }))
    .sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label))
  for (const row of rows.slice(0, 12)) {
    console.log(`    ${String(row.bytes).padStart(9)}  ${row.label}`)
  }
  if (rows.length > 12)
    console.log(`    ${' '.repeat(9)}  ... ${String(rows.length - 12)} more`)
  console.log(
    `    ${String(totalBytes).padStart(9)}  TOTAL (${String(artefacts.length)} files)`
  )
}

if (CHECK_MODE) {
  const stale = artefacts.filter((artefact) => {
    const existing = existsSync(artefact.path) ? readFileSync(artefact.path, 'utf8') : ''
    return existing !== artefact.body
  })
  if (stale.length > 0 || unexpected.length > 0) {
    console.error('\ndashboard data is STALE.\n')
    for (const artefact of stale) console.error(`  - would change: ${artefact.label}`)
    for (const name of unexpected) console.error(`  - not declared: ${name}`)
    console.error(
      '\nThe committed artefacts do not match the governed export in data/dashboard/. Run\n' +
        '  npm run dashboard\n' +
        'from portfolio/ and commit the result, then read the diff: it is telling you that a\n' +
        'figure the console would display no longer matches its source.\n'
    )
    process.exit(1)
  }
  console.log(
    `dashboard data: up to date. ${String(clientDatasets.length)} datasets, ` +
      `${String(artefacts.length)} files, ${String(totalBytes)} bytes.`
  )
  reportSizes()
  process.exit(0)
}

// A regenerated tree is a replacement, not an overlay: a renamed dataset or a store that
// stopped trading would otherwise leave a chunk behind that nothing validates.
if (existsSync(DATASETS_DIR)) rmSync(DATASETS_DIR, { recursive: true })
for (const artefact of artefacts) {
  mkdirSync(dirname(artefact.path), { recursive: true })
  writeFileSync(artefact.path, artefact.body, 'utf8')
}

console.log(
  `dashboard data written to src/generated/dashboard/ (${String(totalBytes)} bytes)`
)
for (const dataset of clientDatasets) {
  const chunkNote = dataset.chunks ? ` in ${String(dataset.chunks.length)} chunks` : ''
  console.log(
    `  ${dataset.name.padEnd(24)} ${String(dataset.rowCount).padStart(5)} rows${chunkNote}`
  )
}
reportSizes()
