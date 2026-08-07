/**
 * The governed dashboard data lane, asserted against the committed artefacts.
 *
 * Two halves. The first reads what is actually committed - the root export under
 * `data/dashboard/` and the generated tree under `src/generated/dashboard/` - and checks
 * that they agree with each other, with the pinned registry, and with the reconciliation
 * totals the manifest publishes. The second drives the generator over deliberately
 * corrupted copies in a temporary directory and proves each guard can fail: a check that
 * has never been seen to fail is not evidence (`docs/dashboard/TEST_STRATEGY.md`).
 *
 * Documented in `docs/dashboard/DATA_CONTRACT.md` and `portfolio/docs/CONTENT_MODEL.md`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_CLIENT_SCHEMA,
  DASHBOARD_CONTRACT_VERSION,
  DASHBOARD_DATASETS,
  DASHBOARD_EXPORT_SCHEMA,
} from '../../src/types/dashboard.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')
const REPO = resolve(PORTFOLIO, '..')

const EXPORT_DIR = join(REPO, 'data/dashboard')
const GENERATED_DIR = join(PORTFOLIO, 'src/generated/dashboard')

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

interface ExportManifest {
  schema: string
  contract_version: number
  contract_sha256: string
  dataset_version: number
  profile: string
  as_of_date: string
  reporter_role: string
  synthetic_data: boolean
  fictional_dealer_group: boolean
  stale: boolean
  source_views: string[]
  limitations: string[]
  pipeline_run: { run_uuid: string; logical_run_key: string | null; status: string }
  reconciliation: {
    status: string
    method: string
    totals: Record<string, Record<string, unknown>>
  }
  privacy_scan: Record<string, unknown>
  validation: Record<string, number>
  datasets: {
    name: string
    source_view: string
    join_views: string[]
    grain: string
    business_key: string[]
    date_basis: string | null
    sort_keys: string[]
    chunked: boolean
    kpi_ids: string[]
    query_sha256: string
    row_count: number
    file: string
    file_sha256: string
    file_bytes: number
    columns: {
      name: string
      type: string
      nullable: boolean
      class: string
      unit: string | null
      display_precision: number | null
      enumeration: string[] | null
      source_column: string
    }[]
  }[]
}

interface ClientManifest {
  schema: string
  datasetVersion: number
  contractVersion: number
  contractSha256: string
  asOfDate: string
  profile: string
  syntheticData: boolean
  fictionalDealerGroup: boolean
  reconciliationStatus: string
  privacyScanStatus: string
  stale: boolean
  limitations: string[]
  sourceViews: string[]
  reconciliationTotals: Record<string, Record<string, unknown>>
  datasets: {
    name: string
    grain: string
    businessKey: string[]
    dateBasis: string | null
    kpiIds: string[]
    rowCount: number
    columns: {
      name: string
      type: string
      nullable: boolean
      displayPrecision: number | null
    }[]
    chunks:
      | {
          dealershipId: string
          month: string
          file: string
          rowCount: number
          bytes: number
        }[]
      | null
  }[]
  sizes: {
    totalBytes: number
    fileCount: number
    largestFile: { file: string; bytes: number }
    rootExportBytes: number
  }
}

const exportManifest = readJson(join(EXPORT_DIR, 'manifest.json')) as ExportManifest
const clientManifest = readJson(join(GENERATED_DIR, 'manifest.json')) as ClientManifest

/* -------------------------------------------------------------------------- */
/* Exact decimal arithmetic, mirroring the generator's                         */
/* -------------------------------------------------------------------------- */
/*
 * `Number` never touches a monetary value here either. The tests would otherwise pass
 * for the wrong reason: `0.1 + 0.2` agrees with a wrong manifest to fifteen places.
 */

function scaled(value: string): { units: bigint; scale: number } {
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  const [whole = '0', fraction = ''] = digits.split('.')
  const units = BigInt(whole + fraction)
  return { units: negative ? -units : units, scale: fraction.length }
}

function sumExact(values: readonly string[]): { units: bigint; scale: number } {
  const parsed = values.map(scaled)
  const scale = parsed.reduce((widest, entry) => Math.max(widest, entry.scale), 0)
  const units = parsed.reduce(
    (total, entry) => total + entry.units * 10n ** BigInt(scale - entry.scale),
    0n
  )
  return { units, scale }
}

function sameExact(left: string, right: string): boolean {
  const a = scaled(left)
  const b = scaled(right)
  const scale = Math.max(a.scale, b.scale)
  return (
    a.units * 10n ** BigInt(scale - a.scale) === b.units * 10n ** BigInt(scale - b.scale)
  )
}

/* -------------------------------------------------------------------------- */
/* The committed root export                                                   */
/* -------------------------------------------------------------------------- */

describe('the committed root export validates', () => {
  it('declares the schema and contract version this consumer understands', () => {
    expect(exportManifest.schema).toBe(DASHBOARD_EXPORT_SCHEMA)
    expect(exportManifest.contract_version).toBe(DASHBOARD_CONTRACT_VERSION)
    expect(exportManifest.contract_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is not stale and reports a passing warehouse', () => {
    expect(exportManifest.stale).toBe(false)
    expect(exportManifest.reconciliation.status).toBe('passed')
    expect(exportManifest.privacy_scan['status']).toBe('passed')
    expect(exportManifest.privacy_scan['prohibited_hits']).toBe(0)
    expect(exportManifest.validation['critical_failures']).toBe(0)
    expect(exportManifest.validation['reconciliations_failed']).toBe(0)
    expect(exportManifest.pipeline_run.status).toBe('succeeded')
  })

  it('labels itself synthetic and fictional', () => {
    expect(exportManifest.synthetic_data).toBe(true)
    expect(exportManifest.fictional_dealer_group).toBe(true)
    expect(exportManifest.limitations.length).toBeGreaterThan(0)
  })

  it('records the reporter privilege boundary the export ran inside', () => {
    expect(exportManifest.reporter_role).toBe('arpi_reporter')
  })

  it('reads only reporting views', () => {
    expect(exportManifest.source_views.length).toBeGreaterThan(0)
    for (const view of exportManifest.source_views) {
      expect(view.startsWith('reporting.')).toBe(true)
    }
  })

  it('lists exactly the pinned dataset registry, in order', () => {
    expect(exportManifest.datasets.map((entry) => entry.name)).toEqual(
      DASHBOARD_DATASETS.map((entry) => entry.name)
    )
  })

  it('agrees with the pinned registry about every grain and date basis', () => {
    for (const pinned of DASHBOARD_DATASETS) {
      const declared = exportManifest.datasets.find((entry) => entry.name === pinned.name)
      expect(declared, pinned.name).toBeDefined()
      expect(declared?.business_key).toEqual([...pinned.businessKey])
      expect(declared?.date_basis).toBe(pinned.dateBasis)
      expect(declared?.chunked).toBe(pinned.chunked)
    }
  })

  it('hashes every committed file to what the manifest records', () => {
    for (const entry of exportManifest.datasets) {
      const text = readFileSync(join(EXPORT_DIR, entry.file), 'utf8')
      expect(sha256(text), entry.file).toBe(entry.file_sha256)
      expect(Buffer.byteLength(text, 'utf8'), entry.file).toBe(entry.file_bytes)
    }
  })

  it('records a row count matching every committed file', () => {
    for (const entry of exportManifest.datasets) {
      const rows = readJson(join(EXPORT_DIR, entry.file))
      expect(Array.isArray(rows), entry.file).toBe(true)
      expect((rows as unknown[]).length, entry.file).toBe(entry.row_count)
    }
  })

  it('gives every dataset a distinct query hash', () => {
    const hashes = exportManifest.datasets.map((entry) => entry.query_sha256)
    expect(new Set(hashes).size).toBe(hashes.length)
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('classifies every column as the one publicly eligible class', () => {
    for (const entry of exportManifest.datasets) {
      for (const column of entry.columns) {
        expect(column.class, `${entry.name}.${column.name}`).toBe('non-personal')
        expect(column.source_column.startsWith('reporting.')).toBe(true)
      }
    }
  })

  it('holds the export directory to a closed set of files', () => {
    const declared = new Set([
      'manifest.json',
      ...exportManifest.datasets.map((entry) => entry.file),
    ])
    const present = readdirSync(EXPORT_DIR).filter((name) => name.endsWith('.json'))
    expect(present.sort()).toEqual([...declared].sort())
  })
})

/* -------------------------------------------------------------------------- */
/* Currency and precision survive the whole lane                               */
/* -------------------------------------------------------------------------- */

describe('exact values survive the export', () => {
  const currencyColumns = exportManifest.datasets.flatMap((entry) =>
    entry.columns
      .filter((column) => column.type === 'currency')
      .map((column) => ({ dataset: entry, column }))
  )

  it('declares at least one monetary column, so this suite means something', () => {
    expect(currencyColumns.length).toBeGreaterThan(0)
  })

  it('carries every monetary value as a two-place decimal string, never a number', () => {
    for (const { dataset, column } of currencyColumns) {
      const rows = readJson(join(EXPORT_DIR, dataset.file)) as Record<string, unknown>[]
      for (const row of rows) {
        const value = row[column.name]
        if (value === null) {
          expect(column.nullable, `${dataset.name}.${column.name}`).toBe(true)
          continue
        }
        expect(typeof value, `${dataset.name}.${column.name}`).toBe('string')
        expect(String(value), `${dataset.name}.${column.name}`).toMatch(/^-?\d+\.\d{2}$/)
      }
    }
  })

  it('preserves a negative gross with its sign', () => {
    const gross = exportManifest.datasets.find((entry) => entry.name === 'gross-summary')
    expect(gross).toBeDefined()
    const rows = readJson(join(EXPORT_DIR, gross?.file ?? '')) as Record<string, string>[]
    const negatives = rows.filter((row) => row['front_end_gross']?.startsWith('-'))
    expect(
      negatives.length,
      'the development profile is expected to contain negative front gross days; a negative ' +
        'gross is a real dealership outcome and the export must keep it visible'
    ).toBeGreaterThan(0)
  })

  it('keeps the front + back = total identity on every gross row', () => {
    const gross = exportManifest.datasets.find((entry) => entry.name === 'gross-summary')
    const rows = readJson(join(EXPORT_DIR, gross?.file ?? '')) as Record<string, string>[]
    for (const row of rows) {
      const sum = sumExact([row['front_end_gross'] ?? '0', row['back_end_gross'] ?? '0'])
      const total = scaled(row['total_gross'] ?? '0')
      const scale = Math.max(sum.scale, total.scale)
      expect(
        sum.units * 10n ** BigInt(scale - sum.scale),
        `${row['dealership_id'] ?? ''} ${row['sale_date'] ?? ''}`
      ).toBe(total.units * 10n ** BigInt(scale - total.scale))
    }
  })

  it('carries every ratio unrounded, with a display precision beside it', () => {
    for (const entry of exportManifest.datasets) {
      for (const column of entry.columns) {
        if (column.type !== 'exact') continue
        // A ratio the console will round must say how far. Counts and sums measured in
        // whole units legitimately have no display precision.
        if (column.unit === 'ratio') {
          expect(column.display_precision, `${entry.name}.${column.name}`).not.toBeNull()
        }
      }
    }
  })

  it('carries an order statistic as a number, not as a decimal it never had', () => {
    const health = exportManifest.datasets.find(
      (entry) => entry.name === 'inventory-health'
    )
    const median = health?.columns.find(
      (column) => column.name === 'median_inventory_age'
    )
    expect(median?.type).toBe('double')
    const rows = readJson(join(EXPORT_DIR, health?.file ?? '')) as Record<
      string,
      unknown
    >[]
    for (const row of rows) expect(typeof row['median_inventory_age']).toBe('number')
  })
})

/* -------------------------------------------------------------------------- */
/* Reconciliation: export bytes to manifest totals                             */
/* -------------------------------------------------------------------------- */

describe('the manifest reconciliation totals re-derive from the committed rows', () => {
  const rowsByDataset = new Map<string, Record<string, unknown>[]>(
    exportManifest.datasets.map((entry) => [
      entry.name,
      readJson(join(EXPORT_DIR, entry.file)) as Record<string, unknown>[],
    ])
  )

  it('publishes totals for every governed KPI family the export covers', () => {
    const kpis = new Set(
      Object.values(exportManifest.reconciliation.totals)
        .map((total) => total['kpi_id'])
        .filter((id): id is string => typeof id === 'string')
    )
    for (const expected of [
      'KPI-SLS-001',
      'KPI-SLS-002',
      'KPI-SLS-003',
      'KPI-GRS-001',
      'KPI-GRS-002',
      'KPI-GRS-003',
      'KPI-GRS-004',
      'KPI-GRS-005',
      'KPI-GRS-006',
      'KPI-FUN-001',
      'KPI-FUN-002',
      'KPI-FUN-003',
      'KPI-FUN-004',
      'KPI-FUN-005',
      'KPI-FUN-006',
      'KPI-FUN-007',
      'KPI-MKT-001',
      'KPI-MKT-002',
      'KPI-MKT-003',
    ]) {
      expect(kpis.has(expected), `${expected} has no reconciliation total`).toBe(true)
    }
  })

  it('publishes no quotient, only exact components', () => {
    for (const [name, total] of Object.entries(exportManifest.reconciliation.totals)) {
      expect(total['value'], `${name} publishes a quotient`).toBeUndefined()
      const hasPlain = typeof total['total'] === 'string'
      const hasRatio =
        typeof total['numerator'] === 'string' && typeof total['denominator'] === 'string'
      expect(
        hasPlain !== hasRatio,
        `${name} is neither a plain total nor a ratio pair`
      ).toBe(true)
    }
  })

  it('re-derives every component by exact summation of the committed rows', () => {
    for (const [name, total] of Object.entries(exportManifest.reconciliation.totals)) {
      const rows = rowsByDataset.get(String(total['dataset']))
      expect(rows, `${name} names an unknown dataset`).toBeDefined()
      if (!rows) continue

      const components =
        typeof total['total'] === 'string'
          ? [{ column: String(total['column']), expected: String(total['total']) }]
          : [
              {
                column: String(total['numerator_column']),
                expected: String(total['numerator']),
              },
              {
                column: String(total['denominator_column']),
                expected: String(total['denominator']),
              },
            ]

      for (const { column, expected } of components) {
        const values = rows.flatMap((row) => {
          const value = row[column]
          return value === null || value === undefined ? [] : [String(value)]
        })
        const { units, scale } = sumExact(values)
        const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0')
        const whole = digits.slice(0, digits.length - scale)
        const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`
        const actual = `${units < 0n ? '-' : ''}${whole}${fraction}`
        expect(
          sameExact(actual, expected),
          `${name}.${column}: ${actual} != ${expected}`
        ).toBe(true)
      }
    }
  })

  it('does not publish a group total for a non-additive figure', () => {
    // A group median is not the average of store medians. The only safe protection is for
    // the wrong number to be unavailable.
    const doubleColumns = new Set(
      exportManifest.datasets.flatMap((entry) =>
        entry.columns
          .filter((column) => column.type === 'double')
          .map((column) => column.name)
      )
    )
    expect(doubleColumns.size).toBeGreaterThan(0)
    for (const [name, total] of Object.entries(exportManifest.reconciliation.totals)) {
      for (const key of ['column', 'numerator_column', 'denominator_column']) {
        const column = total[key]
        if (typeof column === 'string') {
          expect(
            doubleColumns.has(column),
            `${name} sums the non-additive ${column}`
          ).toBe(false)
        }
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The generated tree                                                          */
/* -------------------------------------------------------------------------- */

describe('the generated client artefacts are current and consistent', () => {
  it('declares the client schema', () => {
    expect(clientManifest.schema).toBe(DASHBOARD_CLIENT_SCHEMA)
    expect(clientManifest.contractVersion).toBe(DASHBOARD_CONTRACT_VERSION)
  })

  it('carries the root export identity forward without alteration', () => {
    expect(clientManifest.datasetVersion).toBe(exportManifest.dataset_version)
    expect(clientManifest.contractSha256).toBe(exportManifest.contract_sha256)
    expect(clientManifest.asOfDate).toBe(exportManifest.as_of_date)
    expect(clientManifest.profile).toBe(exportManifest.profile)
    expect(clientManifest.reconciliationStatus).toBe(exportManifest.reconciliation.status)
    expect(clientManifest.privacyScanStatus).toBe(exportManifest.privacy_scan['status'])
    expect(clientManifest.limitations).toEqual(exportManifest.limitations)
    expect(clientManifest.sourceViews).toEqual(exportManifest.source_views)
    expect(clientManifest.stale).toBe(false)
    expect(clientManifest.syntheticData).toBe(true)
    expect(clientManifest.fictionalDealerGroup).toBe(true)
  })

  it('carries every dataset with the same row count as the root export', () => {
    expect(clientManifest.datasets.map((entry) => entry.name)).toEqual(
      exportManifest.datasets.map((entry) => entry.name)
    )
    for (const entry of clientManifest.datasets) {
      const root = exportManifest.datasets.find(
        (candidate) => candidate.name === entry.name
      )
      expect(entry.rowCount, entry.name).toBe(root?.row_count)
      expect(
        entry.columns.map((column) => column.name),
        entry.name
      ).toEqual(root?.columns.map((column) => column.name))
    }
  })

  it('writes every declared file, and only declared files', () => {
    const declared = new Set<string>(['manifest.json'])
    for (const entry of clientManifest.datasets) {
      if (entry.chunks) for (const chunk of entry.chunks) declared.add(chunk.file)
      else declared.add(`datasets/${entry.name}.json`)
    }
    const present = new Set<string>()
    const walk = (directory: string, prefix: string): void => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix === '' ? item.name : `${prefix}/${item.name}`
        if (item.isDirectory()) walk(join(directory, item.name), relative)
        else present.add(relative)
      }
    }
    walk(GENERATED_DIR, '')
    expect([...present].sort()).toEqual([...declared].sort())
  })

  it('partitions a chunked dataset without losing or duplicating a row', () => {
    const chunked = clientManifest.datasets.filter((entry) => entry.chunks !== null)
    expect(chunked.length, 'the contract declares chunked datasets').toBeGreaterThan(0)
    for (const entry of chunked) {
      const chunks = entry.chunks ?? []
      const counted = chunks.reduce((total, chunk) => total + chunk.rowCount, 0)
      expect(counted, entry.name).toBe(entry.rowCount)

      const keys = chunks.map((chunk) => `${chunk.dealershipId}/${chunk.month}`)
      expect(new Set(keys).size, `${entry.name} repeats a chunk key`).toBe(keys.length)
      expect([...keys].sort(), `${entry.name} chunk keys are not sorted`).toEqual(keys)
    }
  })

  it('holds every chunk inside the contract size ceiling', () => {
    for (const entry of clientManifest.datasets) {
      for (const chunk of entry.chunks ?? []) {
        expect(chunk.bytes, chunk.file).toBeLessThanOrEqual(256 * 1024)
        expect(statSync(join(GENERATED_DIR, chunk.file)).size, chunk.file).toBe(
          chunk.bytes
        )
      }
    }
  })

  it('preserves every value exactly through the columnar re-encoding', () => {
    for (const entry of exportManifest.datasets) {
      if (entry.chunked) continue
      const source = readJson(join(EXPORT_DIR, entry.file)) as Record<string, unknown>[]
      const generated = readJson(join(GENERATED_DIR, `datasets/${entry.name}.json`)) as {
        columns: string[]
        rows: unknown[][]
      }
      expect(generated.columns, entry.name).toEqual(
        entry.columns.map((column) => column.name)
      )
      expect(generated.rows.length, entry.name).toBe(source.length)
      for (const [index, row] of generated.rows.entries()) {
        const original = source[index] ?? {}
        for (const [position, column] of generated.columns.entries()) {
          expect(
            row[position],
            `${entry.name}[${String(index)}].${column}`
          ).toStrictEqual(original[column])
        }
      }
    }
  })

  it('reports its own measured sizes', () => {
    expect(clientManifest.sizes.totalBytes).toBeGreaterThan(0)
    expect(clientManifest.sizes.fileCount).toBeGreaterThan(0)
    expect(clientManifest.sizes.largestFile.bytes).toBeGreaterThan(0)
    expect(clientManifest.sizes.rootExportBytes).toBe(
      exportManifest.datasets.reduce((total, entry) => total + entry.file_bytes, 0)
    )
  })

  it('does not carry the root manifest per-column SQL lineage into the client', () => {
    const serialised = JSON.stringify(clientManifest)
    expect(serialised).not.toContain('source_column')
    expect(serialised).not.toContain('query_sha256')
  })
})

/* -------------------------------------------------------------------------- */
/* Guards proven able to fail                                                  */
/* -------------------------------------------------------------------------- */
/*
 * Each case copies the committed export into a temporary tree, corrupts one thing, and
 * runs the generator against it with `--check`. The generator resolves the export
 * relative to the repository root, so the corruption is applied to a full checkout copy.
 */

const sandboxes: string[] = []

afterAll(() => {
  for (const sandbox of sandboxes) rmSync(sandbox, { recursive: true, force: true })
})

/**
 * Run the generator against a copy of the export with one file rewritten.
 *
 * The copy holds only what the generator reads, plus a symlink-free copy of the portfolio
 * scripts and types, so a corrupted run cannot touch the real tree.
 */
function runGeneratorWith(mutate: (exportDir: string) => void): {
  code: number
  output: string
} {
  const sandbox = mkdtempSync(join(tmpdir(), 'arpi-dashboard-'))
  sandboxes.push(sandbox)

  cpSync(EXPORT_DIR, join(sandbox, 'data/dashboard'), { recursive: true })
  cpSync(join(PORTFOLIO, 'scripts'), join(sandbox, 'portfolio/scripts'), {
    recursive: true,
  })
  cpSync(join(PORTFOLIO, 'src/types'), join(sandbox, 'portfolio/src/types'), {
    recursive: true,
  })
  cpSync(GENERATED_DIR, join(sandbox, 'portfolio/src/generated/dashboard'), {
    recursive: true,
  })

  mutate(join(sandbox, 'data/dashboard'))

  try {
    const output = execFileSync(
      process.execPath,
      [
        join(PORTFOLIO, 'node_modules/tsx/dist/cli.mjs'),
        join(sandbox, 'portfolio/scripts/generate-dashboard-data.ts'),
        '--check',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return { code: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      code: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

function rewriteManifest(
  exportDir: string,
  mutate: (manifest: ExportManifest) => void
): void {
  const path = join(exportDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ExportManifest
  mutate(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

describe('the generator refuses a corrupted export', () => {
  it('passes on the committed tree, so the failures below mean something', () => {
    const result = runGeneratorWith(() => undefined)
    expect(result.output).toContain('up to date')
    expect(result.code).toBe(0)
  }, 60_000)

  it('refuses an unknown schema version', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.schema = 'arpi.dashboard_export/99'
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('refuses an unknown version')
  }, 60_000)

  it('refuses an unknown contract version', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.contract_version = 99
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('contract_version')
  }, 60_000)

  it('refuses a file whose hash no longer matches the manifest', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'stores.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['city'] = 'Somewhere Else'
      writeFileSync(
        path,
        `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      )
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('hashes to')
  }, 60_000)

  it('refuses a row count that disagrees with the manifest', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'stores.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      const body = `[\n${[...rows, rows[0]].map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'stores') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('row(s) but the manifest records')
  }, 60_000)

  it('refuses a repeated business key', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'stores.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      const doubled = [...rows, rows[0]]
      const body = `[\n${doubled.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'stores') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
          entry.row_count = doubled.length
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('repeats the business key')
  }, 60_000)

  it('refuses a tampered reconciliation total', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        const total = manifest.reconciliation.totals['total_gross']
        if (total) total['total'] = '999999.99'
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('reconciliation total total_gross')
  }, 60_000)

  it('refuses a dataset the pinned registry does not know', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.datasets = manifest.datasets.slice(0, -1)
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('this consumer expects')
  }, 60_000)

  it('refuses a changed grain', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name === 'gross-summary') entry.business_key = ['dealership_id']
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('The grain changed')
  }, 60_000)

  it('refuses a stale flag', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.stale = true
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('stale=true')
  }, 60_000)

  it('refuses an export taken from a failing warehouse', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.validation['critical_failures'] = 2
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('critical')
  }, 60_000)

  it('refuses an unresolved store reference', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'gross-summary.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['dealership_id'] = 'GSA-999'
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'gross-summary') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('GSA-999')
  }, 60_000)

  it('refuses a null in a required column', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'gross-summary.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['front_end_gross'] = null
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'gross-summary') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('declares required')
  }, 60_000)

  it('refuses a monetary value that became a number', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'gross-summary.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['front_end_gross'] = 1383.77
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'gross-summary') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('not a valid currency value')
  }, 60_000)

  it('refuses an out-of-enumeration value', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'inventory-health.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['condition_group'] = 'Certified'
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'inventory-health') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('closed enumeration')
  }, 60_000)

  it('refuses an internal schema reference in a value', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'reconciliation-status.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['reconciliation_id'] = 'warehouse.fact_vehicle_sale'
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'reconciliation-status') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('warehouse-schema object reference')
  }, 60_000)

  it('refuses a missing dataset file', () => {
    const result = runGeneratorWith((dir) => {
      rmSync(join(dir, 'days-supply.json'))
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('days-supply.json is missing')
  }, 60_000)

  it('reports stale generated output when the export moved underneath it', () => {
    const result = runGeneratorWith((dir) => {
      const path = join(dir, 'stores.json')
      const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
      if (rows[0]) rows[0]['city'] = 'Concord'
      const body = `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
      writeFileSync(path, body)
      rewriteManifest(dir, (manifest) => {
        for (const entry of manifest.datasets) {
          if (entry.name !== 'stores') continue
          entry.file_sha256 = sha256(body)
          entry.file_bytes = Buffer.byteLength(body, 'utf8')
        }
      })
      // Restate the reconciliation totals so the staleness guard, not the hash guard, is
      // the one that has to fire.
    })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/STALE|would change/)
  }, 60_000)
})

/* -------------------------------------------------------------------------- */
/* Freshness is a state, not a guess                                           */
/* -------------------------------------------------------------------------- */

describe('freshness is derived from content, never from a clock', () => {
  it('the committed export is current even though it was generated in the past', () => {
    // The whole point: no wall-clock age appears anywhere in the freshness decision. The
    // generator's verdict comes from hashes, row counts and the contract fingerprint.
    const result = runGeneratorWith(() => undefined)
    expect(result.code).toBe(0)
  }, 60_000)

  it('a changed contract fingerprint makes a byte-identical export stale', () => {
    const result = runGeneratorWith((dir) => {
      rewriteManifest(dir, (manifest) => {
        manifest.contract_sha256 = '0'.repeat(64)
      })
    })
    // The transformer trusts the root exporter's own fingerprint check for the contract,
    // and re-derives everything else. A changed fingerprint therefore changes the client
    // manifest, which makes the committed generated tree stale.
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/STALE|would change/)
  }, 60_000)

  it('the generator writes no wall-clock timestamp of its own', () => {
    // Every instant in the generated manifest came from the export, so regenerating twice
    // is byte-identical. `generatedAt` is the export's, not this run's.
    expect(clientManifest['generatedAt' as keyof ClientManifest]).toBe(
      exportManifest.datasets.length > 0
        ? exportManifest['generated_at' as keyof ExportManifest]
        : ''
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Documentation and wiring                                                    */
/* -------------------------------------------------------------------------- */

describe('the lane is wired into the repository lifecycle', () => {
  const packageJson = readJson(join(PORTFOLIO, 'package.json')) as {
    scripts: Record<string, string>
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  it('exposes generate and check commands', () => {
    expect(packageJson.scripts['dashboard']).toBe(
      'tsx scripts/generate-dashboard-data.ts'
    )
    expect(packageJson.scripts['dashboard:check']).toBe(
      'tsx scripts/generate-dashboard-data.ts --check'
    )
  })

  it('checks the dashboard data before every production build', () => {
    expect(packageJson.scripts['prebuild']).toContain('dashboard:check')
    expect(packageJson.scripts['verify']).toContain('dashboard:check')
  })

  it('adds no database dependency to the portfolio', () => {
    const forbidden = [
      'pg',
      'postgres',
      'psycopg',
      'knex',
      'prisma',
      'drizzle-orm',
      'sequelize',
    ]
    for (const name of [
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.devDependencies),
    ]) {
      expect(forbidden, `${name} is a database dependency`).not.toContain(name)
    }
  })

  it('watches the export directory for deployment', () => {
    const railway = readJson(join(REPO, 'railway.json')) as {
      build: { watchPatterns: string[] }
    }
    expect(railway.build.watchPatterns).toContain('data/dashboard/**')
  })

  it('copies the export into the Railway build stage', () => {
    const dockerfile = readFileSync(join(PORTFOLIO, 'Dockerfile.railway'), 'utf8')
    expect(dockerfile).toContain('COPY data/dashboard ./data/dashboard')
    expect(dockerfile).toContain('npm run dashboard:check')
  })

  it('keeps the export out of the runtime image', () => {
    const dockerfile = readFileSync(join(PORTFOLIO, 'Dockerfile.railway'), 'utf8')
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM '))
    expect(runtime).not.toContain('data/dashboard')
  })

  it('is documented in the content model', () => {
    const contentModel = readFileSync(join(PORTFOLIO, 'docs/CONTENT_MODEL.md'), 'utf8')
    expect(contentModel).toContain('generated/dashboard')
    expect(contentModel).toContain('generate-dashboard-data.ts')
  })

  it('is documented in the data contract as built', () => {
    const contract = readFileSync(join(REPO, 'docs/dashboard/DATA_CONTRACT.md'), 'utf8')
    expect(contract).toContain('arpi.dashboard_export/1')
    for (const entry of DASHBOARD_DATASETS) {
      expect(contract, `${entry.name} is not documented`).toContain(`\`${entry.name}\``)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Existing lanes are unchanged                                                */
/* -------------------------------------------------------------------------- */

describe('the existing generated lanes still exist and are untouched by this one', () => {
  it('keeps the inventory artefacts where they were', () => {
    for (const name of [
      'dealerships.json',
      'inventory-summary.json',
      'inventory-records.json',
      'project-manifest.json',
    ]) {
      expect(existsSync(join(PORTFOLIO, 'src/generated', name)), name).toBe(true)
    }
  })

  it('puts the dashboard lane in its own directory', () => {
    const top = readdirSync(join(PORTFOLIO, 'src/generated'), { withFileTypes: true })
    const directories = top
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    expect(directories).toEqual(['dashboard'])
  })
})
