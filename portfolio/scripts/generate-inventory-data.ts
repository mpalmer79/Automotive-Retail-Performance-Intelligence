#!/usr/bin/env tsx
/**
 * Generate the three inventory artefacts the dealership experience is built from.
 *
 *   src/generated/dealerships.json       identity and per-store derived profile
 *   src/generated/inventory-summary.json group totals, facets and chart series
 *   src/generated/inventory-records.json every sanitized listing, one per row
 *
 * WHY THIS EXISTS
 * ---------------
 * The sanitized inventory workbooks are the most persuasive thing in this
 * repository and therefore the most dangerous. They are real vehicle attributes
 * captured from a public listing source, de-identified and reassigned to a
 * fictional dealer group, and a website that renders them carelessly would be
 * publishing a real dealership's inventory under a made-up name.
 *
 * So the browser never sees a workbook. This script opens them at build time,
 * drops every field that could carry a real identity, derives every number the
 * site displays, and refuses to write anything if what it produced still looks
 * like it names a real business. `npm run build` runs it in `--check` mode
 * first, inside the Railway image, so a stale or hand-edited artefact fails the
 * deployment rather than reaching the site.
 *
 * WHAT IT READS
 * -------------
 *   data/sample/dim_dealership.csv                the store registry - names,
 *                                                 types, brands, cities. The
 *                                                 warehouse's own dimension, so
 *                                                 the website cannot disagree
 *                                                 with the data model about who
 *                                                 the three stores are.
 *   data/reference/inventory/<id>/<date>/*.xlsx   one sanitized workbook per
 *                                                 store per snapshot
 *   portfolio/src/content/dealership-profiles.json  authored positioning copy.
 *                                                 Prose only: this file is
 *                                                 asserted to carry no digits.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *   - Emit a count, a range or a median it did not compute from a workbook row.
 *   - Emit a median over a population the source did not price or odometer.
 *   - Emit a VIN, a URL, an email address, a telephone number, a real dealership
 *     domain, or a retired public name.
 *   - Accept a workbook whose `Dealership ID` column disagrees with the folder it
 *     was filed under.
 *   - Invent a coverage statement for a workbook that does not make one.
 *
 * DETERMINISM
 * -----------
 * No clock, no random source, no filesystem ordering. Directory listings are
 * sorted, ties in every "top N" are broken by name, and object keys are written
 * in a fixed order, so `--check` is a byte comparison and two runs on two
 * machines produce identical files.
 *
 * USAGE
 * -----
 *   tsx scripts/generate-inventory-data.ts           write the artefacts
 *   tsx scripts/generate-inventory-data.ts --check   fail if they would change
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  ConditionTotals,
  Dealership,
  DealershipAccent,
  DealershipInventoryProfile,
  DealershipTotals,
  DealershipsFile,
  InventoryRecord,
  InventorySummary,
  MakeCount,
  ModelCount,
  ModelYearCount,
  NumericRange,
  PriceBand,
  VehicleCondition,
} from '../src/types/inventory.ts'
import { cellNumber, cellText, excelSerialToIsoDate, readWorkbook } from './lib/xlsx.ts'
import type { CellValue, Worksheet } from './lib/xlsx.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '..')
const REPO = resolve(PORTFOLIO, '..')

const DEALERSHIP_REGISTRY_PATH = 'data/sample/dim_dealership.csv'
const INVENTORY_ROOT = 'data/reference/inventory'
const PROFILES_PATH = 'portfolio/src/content/dealership-profiles.json'

const DEALERSHIPS_OUTPUT = join(PORTFOLIO, 'src/generated/dealerships.json')
const SUMMARY_OUTPUT = join(PORTFOLIO, 'src/generated/inventory-summary.json')
const RECORDS_OUTPUT = join(PORTFOLIO, 'src/generated/inventory-records.json')

const CHECK_MODE = process.argv.includes('--check')

/** The worksheet every workbook must carry, and the columns it must declare. */
const INVENTORY_SHEET = 'Inventory'
const README_SHEET = 'README'

const REQUIRED_COLUMNS = [
  'Source Record ID',
  'Dealership ID',
  'Captured At',
  'Condition',
  'Model Year',
  'Make',
  'Model',
  'Trim',
  'Odometer Miles',
  'Advertised Price',
  'Pricing Status',
] as const

/**
 * Columns that are read to validate the workbook and then DROPPED.
 *
 * Named here rather than left implicit, because "the generated file happens not
 * to contain a VIN" and "the generator is documented never to emit one" are
 * different guarantees, and only the second survives someone adding a field.
 */
const DISCARDED_COLUMNS = [
  'Store Name',
  'Source Batch ID',
  'Source Feed',
  'Vehicle Display',
  'Synthetic Vehicle ID',
  'Synthetic VIN',
  'Inventory Unit Count',
  'Data Classification',
] as const

/** How many entries the per-store "top makes" and "top models" lists carry. */
const TOP_N = 8

// ---------------------------------------------------------------------------
// Failure reporting. Every problem is collected so one run reports all of them.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. The store registry
// ---------------------------------------------------------------------------

interface RegistryEntry {
  readonly dealershipId: string
  readonly storeName: string
  readonly storeShortName: string
  readonly storeType: string
  readonly franchiseBrand: string | null
  readonly city: string
  readonly stateCode: string
  readonly marketRegion: string
  readonly openedDate: string
}

/** A CSV parser that understands quoting. The registry is small and regular. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (character !== '\r') {
      field += character
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''))
}

function readRegistry(): RegistryEntry[] {
  const path = repoPath(DEALERSHIP_REGISTRY_PATH)
  if (!existsSync(path)) {
    fail(`The store registry is missing: ${DEALERSHIP_REGISTRY_PATH}`)
    return []
  }
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0] ?? []
  const index = (column: string): number => {
    const found = header.indexOf(column)
    if (found === -1) {
      fail(`${DEALERSHIP_REGISTRY_PATH} has no "${column}" column.`)
    }
    return found
  }

  const columns = {
    dealershipId: index('dealership_id'),
    storeName: index('store_name'),
    storeShortName: index('store_short_name'),
    storeType: index('store_type'),
    franchiseBrand: index('franchise_brand'),
    city: index('city'),
    stateCode: index('state_code'),
    marketRegion: index('market_region'),
    openedDate: index('opened_date'),
    isCurrent: index('is_current'),
  }
  if (Object.values(columns).includes(-1)) return []

  const entries: RegistryEntry[] = []
  for (const row of rows.slice(1)) {
    if ((row[columns.isCurrent] ?? '').trim().toLowerCase() !== 'true') continue
    const brand = (row[columns.franchiseBrand] ?? '').trim()
    entries.push({
      dealershipId: (row[columns.dealershipId] ?? '').trim(),
      storeName: (row[columns.storeName] ?? '').trim(),
      storeShortName: (row[columns.storeShortName] ?? '').trim(),
      storeType: (row[columns.storeType] ?? '').trim(),
      franchiseBrand: brand === '' ? null : brand,
      city: (row[columns.city] ?? '').trim(),
      stateCode: (row[columns.stateCode] ?? '').trim(),
      marketRegion: (row[columns.marketRegion] ?? '').trim(),
      openedDate: (row[columns.openedDate] ?? '').trim(),
    })
  }
  return entries.sort((a, b) => a.dealershipId.localeCompare(b.dealershipId))
}

// ---------------------------------------------------------------------------
// 2. The authored positioning copy
// ---------------------------------------------------------------------------

interface ProfileEntry {
  readonly id: string
  readonly slug: string
  readonly accent: DealershipAccent
  readonly tagline: string
  readonly positioning: string
  readonly inventoryStrategy: string
  readonly customerSegment: string
  readonly analyticsFocus: string
}

interface ProfilesFile {
  readonly group: {
    readonly name: string
    readonly introduction: string
    readonly operatingModel: string
    readonly governanceNote: string
  }
  readonly dealerships: readonly ProfileEntry[]
}

function readProfiles(): ProfilesFile {
  const path = repoPath(PROFILES_PATH)
  if (!existsSync(path)) {
    fail(`The authored dealership profiles are missing: ${PROFILES_PATH}`)
    return {
      group: { name: '', introduction: '', operatingModel: '', governanceNote: '' },
      dealerships: [],
    }
  }
  const raw = readFileSync(path, 'utf8')

  /*
   * The authored file is PROSE ONLY.
   *
   * This is the rule that keeps "no count on the website is hardcoded" true in
   * practice rather than only in intent. A content file is exactly where a
   * plausible-looking "over 500 vehicles in stock" would be typed, and once one
   * is there nothing downstream can tell it from a derived figure. A digit in
   * this file fails the build.
   */
  const withoutIds = raw.replace(/"(?:id|slug)":\s*"[^"]*"/g, '')
  const digits = /\d/.exec(withoutIds)
  requireTrue(
    digits === null,
    `${PROFILES_PATH} contains a digit outside an identifier. Authored dealership copy ` +
      'may not carry a number: every quantity on the website is derived from the ' +
      'inventory workbooks. Move the figure into the generator, or remove it.'
  )

  return JSON.parse(raw) as ProfilesFile
}

// ---------------------------------------------------------------------------
// 3. Locating the latest workbook for each store
// ---------------------------------------------------------------------------

interface WorkbookLocation {
  /** Repository-relative path. */
  readonly path: string
  /** The snapshot folder's name, which must be an ISO date. */
  readonly snapshotFolder: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Find the newest snapshot folder for a store and the single workbook in it.
 *
 * "Newest" is the lexicographically greatest ISO date folder, which for ISO
 * dates is also the chronologically latest. A folder that is not an ISO date is
 * a filing mistake and is reported rather than skipped, because silently
 * ignoring it is how a snapshot gets added and never appears on the site.
 */
function locateWorkbook(dealershipId: string): WorkbookLocation | undefined {
  const folder = dealershipId.toLowerCase()
  const storeDir = join(INVENTORY_ROOT, folder)
  const absoluteStoreDir = repoPath(storeDir)

  if (!existsSync(absoluteStoreDir)) {
    fail(
      `${dealershipId} has no inventory directory. Expected ${storeDir}/<snapshot-date>/ ` +
        'with one sanitized workbook in it.'
    )
    return undefined
  }

  const snapshots: string[] = []
  for (const entry of readdirSync(absoluteStoreDir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    if (!entry.isDirectory()) continue
    if (!ISO_DATE.test(entry.name)) {
      fail(
        `${storeDir}/${entry.name} is not a snapshot folder. Snapshot folders are named ` +
          'with an ISO date, for example 2026-08-02.'
      )
      continue
    }
    snapshots.push(entry.name)
  }

  const latest = snapshots.at(-1)
  if (latest === undefined) {
    fail(`${storeDir} contains no snapshot folder.`)
    return undefined
  }

  const workbooks = readdirSync(repoPath(join(storeDir, latest)))
    .filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b))

  if (workbooks.length === 0) {
    fail(`${storeDir}/${latest} contains no .xlsx workbook.`)
    return undefined
  }
  if (workbooks.length > 1) {
    fail(
      `${storeDir}/${latest} contains ${String(workbooks.length)} workbooks ` +
        `(${workbooks.join(', ')}). A snapshot folder holds exactly one workbook per store, ` +
        'so that "the latest valid workbook" is never a guess.'
    )
    return undefined
  }

  return {
    path: join(storeDir, latest, workbooks[0] as string).replaceAll('\\', '/'),
    snapshotFolder: latest,
  }
}

// ---------------------------------------------------------------------------
// 4. Reading one workbook
// ---------------------------------------------------------------------------

/** Read the README sheet as a label/value map, for the workbook's own metadata. */
function readmeEntries(sheet: Worksheet | undefined): Map<string, CellValue> {
  const entries = new Map<string, CellValue>()
  if (!sheet) return entries
  for (const row of sheet.rows) {
    const label = cellText(row[0] ?? null)
    if (label === undefined) continue
    // First occurrence wins: the sanitization control table below reuses some
    // labels, and the header block at the top is the authoritative one.
    if (!entries.has(label)) entries.set(label, row[1] ?? null)
  }
  return entries
}

/** The workbook's coverage limitation paragraph, where it states one. */
function readCoverageNote(sheet: Worksheet | undefined): string | null {
  if (!sheet) return null
  const headings = ['Coverage limitation', 'Coverage and pricing limitation']
  for (const [index, row] of sheet.rows.entries()) {
    const label = cellText(row[0] ?? null)
    if (label === undefined || !headings.includes(label)) continue
    // The paragraph is the next non-empty first-column cell.
    for (const next of sheet.rows.slice(index + 1)) {
      const text = cellText(next[0] ?? null)
      if (text !== undefined) return text
    }
  }
  return null
}

/** Normalise the workbook's condition vocabulary to the site's two values. */
function normaliseCondition(raw: string): VehicleCondition | undefined {
  const value = raw.trim().toLowerCase()
  if (value === 'new') return 'new'
  if (value === 'used' || value === 'pre-owned' || value === 'preowned')
    return 'pre-owned'
  return undefined
}

interface ParsedWorkbook {
  readonly records: readonly InventoryRecord[]
  readonly snapshotDate: string
  readonly sourceType: string
  readonly coverageStatus: string | null
  readonly coverageNote: string | null
}

function parseWorkbook(
  registry: RegistryEntry,
  location: WorkbookLocation
): ParsedWorkbook | undefined {
  let workbook
  try {
    workbook = readWorkbook(repoPath(location.path))
  } catch (error) {
    fail(`${location.path} could not be opened as a workbook: ${String(error)}`)
    return undefined
  }

  const readme = readmeEntries(workbook.sheet(README_SHEET))
  const sheet = workbook.sheet(INVENTORY_SHEET)
  if (!sheet) {
    fail(
      `${location.path} has no "${INVENTORY_SHEET}" worksheet. It declares ` +
        `${workbook.sheets.map((s) => `"${s.name}"`).join(', ')}.`
    )
    return undefined
  }

  const header = (sheet.rows[0] ?? []).map((value) => cellText(value) ?? '')
  const column = new Map(header.map((name, index) => [name, index]))

  const missing = REQUIRED_COLUMNS.filter((name) => !column.has(name))
  if (missing.length > 0) {
    fail(
      `${location.path} is missing required inventory column(s): ${missing.join(', ')}. ` +
        `The sheet declares: ${header.filter(Boolean).join(', ')}.`
    )
    return undefined
  }

  const at = (row: readonly CellValue[], name: string): CellValue =>
    row[column.get(name) ?? -1] ?? null

  // The README's dealership ID is checked before a single row is read, so a
  // workbook filed under the wrong store fails with the reason rather than with
  // 300 row-level mismatches.
  const declaredId = cellText(readme.get('Dealership ID') ?? null)
  if (declaredId !== undefined && declaredId !== registry.dealershipId) {
    fail(
      `${location.path} declares Dealership ID ${declaredId} in its README sheet but is ` +
        `filed under ${registry.dealershipId}. Move the workbook to ` +
        `${INVENTORY_ROOT}/${declaredId.toLowerCase()}/ or correct the workbook.`
    )
    return undefined
  }

  const records: InventoryRecord[] = []
  const snapshotDates = new Set<string>()

  for (const [offset, row] of sheet.rows.slice(1).entries()) {
    const rowNumber = offset + 2
    const stockReference = cellText(at(row, 'Source Record ID'))
    if (stockReference === undefined) continue // a trailing blank row

    const rowDealershipId = cellText(at(row, 'Dealership ID'))
    if (rowDealershipId !== registry.dealershipId) {
      fail(
        `${location.path} row ${String(rowNumber)} carries Dealership ID ` +
          `${rowDealershipId ?? '(empty)'}, but the workbook is filed under ` +
          `${registry.dealershipId}. A workbook holds one store's inventory.`
      )
      return undefined
    }

    const conditionRaw = cellText(at(row, 'Condition'))
    const condition = conditionRaw ? normaliseCondition(conditionRaw) : undefined
    if (condition === undefined) {
      fail(
        `${location.path} row ${String(rowNumber)} has condition ` +
          `"${conditionRaw ?? '(empty)'}", which is neither New nor Used.`
      )
      return undefined
    }

    const modelYear = cellNumber(at(row, 'Model Year'))
    const make = cellText(at(row, 'Make'))
    const model = cellText(at(row, 'Model'))
    if (modelYear === undefined || make === undefined || model === undefined) {
      fail(
        `${location.path} row ${String(rowNumber)} is missing a model year, a make or a ` +
          'model. These three are required: a listing without them describes no vehicle.'
      )
      return undefined
    }

    const capturedAt = cellNumber(at(row, 'Captured At'))
    if (capturedAt === undefined) {
      fail(`${location.path} row ${String(rowNumber)} has no capture date.`)
      return undefined
    }
    const snapshotDate = excelSerialToIsoDate(capturedAt)
    snapshotDates.add(snapshotDate)

    const mileage = cellNumber(at(row, 'Odometer Miles'))
    const price = cellNumber(at(row, 'Advertised Price'))
    const trim = cellText(at(row, 'Trim'))

    records.push({
      stockReference,
      dealershipId: registry.dealershipId,
      condition,
      modelYear,
      make,
      model,
      trim: trim ?? null,
      // A missing value stays missing. Filling it with 0 would put a free car and
      // a delivery-mileage car in the same bucket as an unpriced listing.
      mileage: mileage ?? null,
      price: price ?? null,
      pricingStatus: cellText(at(row, 'Pricing Status')) ?? 'Not stated',
      snapshotDate,
    })
  }

  if (records.length === 0) {
    fail(`${location.path} has a header row but no inventory rows.`)
    return undefined
  }

  const uniqueReferences = new Set(records.map((record) => record.stockReference))
  requireTrue(
    uniqueReferences.size === records.length,
    `${location.path} repeats a Source Record ID. Stock references identify a listing and ` +
      'must be unique within a snapshot.'
  )

  if (snapshotDates.size > 1) {
    fail(
      `${location.path} mixes ${String(snapshotDates.size)} capture dates ` +
        `(${[...snapshotDates].sort().join(', ')}). One workbook is one snapshot.`
    )
    return undefined
  }

  const snapshotDate = [...snapshotDates][0] as string
  requireTrue(
    snapshotDate === location.snapshotFolder,
    `${location.path} captures ${snapshotDate} but is filed under the ` +
      `${location.snapshotFolder} snapshot folder.`
  )

  // The discarded columns are asserted present-and-dropped rather than silently
  // ignored, so that a workbook which stopped carrying a VIN column is noticed.
  for (const name of DISCARDED_COLUMNS) {
    requireTrue(
      column.has(name),
      `${location.path} no longer declares the "${name}" column. The generator drops it ` +
        'deliberately; a change to the workbook contract should be a reviewed change.'
    )
  }

  return {
    records,
    snapshotDate,
    sourceType:
      cellText(readme.get('Source type') ?? null) ?? 'Not stated in the source workbook',
    coverageStatus: cellText(readme.get('Coverage status') ?? null) ?? null,
    coverageNote: readCoverageNote(workbook.sheet(README_SHEET)),
  }
}

// ---------------------------------------------------------------------------
// 5. Derivations
// ---------------------------------------------------------------------------

/**
 * The median of a sample.
 *
 * Returns `null` for an empty sample rather than 0 or NaN, and the caller is
 * typed to handle it. An even-sized sample takes the mean of the two central
 * values and is rounded, because every quantity this is used on - a dollar price,
 * an odometer reading - is a whole number and a `.5` would read as spurious
 * precision.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
}

function range(values: readonly number[]): NumericRange | null {
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** Count by key, ordered by count descending then key ascending. */
function tally<T extends string>(keys: readonly T[]): { key: T; count: number }[] {
  const counts = new Map<T, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function makeCounts(records: readonly InventoryRecord[]): MakeCount[] {
  return tally(records.map((record) => record.make)).map(({ key, count }) => ({
    make: key,
    count,
  }))
}

/**
 * The separator for a composite tally key.
 *
 * A unit separator, not a space: "Silverado 1500" and "Grand Cherokee" are
 * two-word models, so splitting a `make model` key on whitespace would silently
 * truncate every one of them. A control character cannot occur in a make or a
 * model name, which is the property that makes the split safe.
 */
const KEY_SEPARATOR = '\u001f'

function modelCounts(records: readonly InventoryRecord[]): ModelCount[] {
  return tally(
    records.map((record) => `${record.make}${KEY_SEPARATOR}${record.model}`)
  ).map(({ key, count }) => {
    const [make, model] = key.split(KEY_SEPARATOR)
    return { make: make as string, model: model as string, count }
  })
}

function buildProfile(
  parsed: ParsedWorkbook,
  location: WorkbookLocation
): DealershipInventoryProfile {
  const records = parsed.records
  const preOwned = records.filter((record) => record.condition === 'pre-owned')
  const prices = records.flatMap((record) =>
    record.price === null ? [] : [record.price]
  )
  const preOwnedMileages = preOwned.flatMap((record) =>
    record.mileage === null ? [] : [record.mileage]
  )

  const makes = makeCounts(records)
  const models = modelCounts(records)

  return {
    snapshotDate: parsed.snapshotDate,
    sourceWorkbook: location.path,
    sourceType: parsed.sourceType,
    coverageStatus: parsed.coverageStatus,
    coverageNote: parsed.coverageNote,

    totalRecords: records.length,
    newRecords: records.length - preOwned.length,
    preOwnedRecords: preOwned.length,
    pricedRecords: prices.length,
    mileageRecords: records.filter((record) => record.mileage !== null).length,

    priceRange: range(prices),
    medianPrice: median(prices),
    preOwnedMileageRange: range(preOwnedMileages),
    medianPreOwnedMileage: median(preOwnedMileages),
    modelYearRange: range(records.map((record) => record.modelYear)),

    makeCount: makes.length,
    modelCount: models.length,
    topMakes: makes.slice(0, TOP_N),
    topModels: models.slice(0, TOP_N),
  }
}

/**
 * The advertised-price histogram.
 *
 * Fixed bands rather than computed quantiles, because the chart's job is to let a
 * reader compare the three stores' price positions, and a band whose boundaries
 * move with the data cannot do that. The top band is open-ended and labelled so,
 * rather than being closed at a maximum that would imply a ceiling the data does
 * not have.
 */
const PRICE_BAND_EDGES = [
  0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 75_000,
] as const

function buildPriceBands(records: readonly InventoryRecord[]): PriceBand[] {
  const priced = records.flatMap((record) =>
    record.price === null ? [] : [record.price]
  )
  const bands: PriceBand[] = []

  for (const [index, min] of PRICE_BAND_EDGES.entries()) {
    const max = PRICE_BAND_EDGES[index + 1] ?? null
    const count = priced.filter(
      (price) => price >= min && (max === null || price < max)
    ).length
    const thousands = (value: number) => `$${String(Math.round(value / 1000))}k`
    bands.push({
      label:
        max === null
          ? `${thousands(min)} and above`
          : `${thousands(min)} to ${thousands(max)}`,
      min,
      max,
      count,
    })
  }
  return bands
}

/** The public rendering of a warehouse `store_type` value. */
function storeTypeLabel(storeType: string, isFranchise: boolean): string {
  if (isFranchise) return 'Franchise dealership'
  if (/used/i.test(storeType)) return 'Independent pre-owned dealership'
  return 'Independent dealership'
}

// ---------------------------------------------------------------------------
// 6. The sanitization gate
// ---------------------------------------------------------------------------

/**
 * Patterns that must not appear in anything this script writes.
 *
 * Applied to the SERIALISED OUTPUT rather than to individual fields, so a value
 * that reached the file through a field nobody thought to check is still caught.
 * Every one of these describes something the sanitization was supposed to have
 * removed upstream; finding one here means the workbook is not what it claims to
 * be, and the correct response is to stop rather than to strip it and continue.
 */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /https?:\/\//i, what: 'a source URL' },
  { pattern: /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i, what: 'a hostname' },
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    what: 'an email address',
  },
  {
    // Anchored on both sides. The unanchored form reads a stock reference
    // ("GSA001-20260802-0140") and an adjacent year pair as phone numbers, and a
    // sanitization gate that fires on correct data is a gate somebody removes.
    pattern: /(?<![\d,.-])(?:\+?1[ .-])?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d,.-])/,
    what: 'a telephone number',
  },
  {
    // A VIN is 17 characters from a 33-letter alphabet with at least one digit.
    // The sanitized workbooks carry synthetic ones; this generator drops the
    // column, so any 17-character token in the output is a leak.
    pattern: /\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b/,
    what: 'a VIN-shaped identifier',
  },
  { pattern: /\b[a-z0-9-]+\.(?:com|net|org|co|dealer|auto)\b/i, what: 'a domain name' },
  { pattern: /Granite State Auto Group/i, what: 'the retired group name' },
  { pattern: /Granite Used Auto/i, what: 'the retired store name' },
  { pattern: /Game Auto Group/i, what: 'a name this project does not use' },
]

function assertSanitized(label: string, serialised: string): void {
  for (const { pattern, what } of FORBIDDEN) {
    const found = pattern.exec(serialised)
    if (found) {
      fail(
        `${label} contains ${what}: "${found[0]}". The generated frontend data is public, ` +
          'and the sanitization contract says this value should never have survived ' +
          'ingestion. Fix the workbook rather than the assertion.'
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Build
// ---------------------------------------------------------------------------

const registry = readRegistry()
const profiles = readProfiles()

requireTrue(
  registry.length === 3,
  `${DEALERSHIP_REGISTRY_PATH} declares ${String(registry.length)} current stores. ` +
    'Granite Auto Group has three, and the website, the warehouse dimension and the ' +
    'inventory directory all have to agree on that.'
)

const registryIds = new Set(registry.map((entry) => entry.dealershipId))
requireTrue(
  registryIds.size === registry.length,
  `${DEALERSHIP_REGISTRY_PATH} repeats a dealership_id.`
)

const profileById = new Map(profiles.dealerships.map((entry) => [entry.id, entry]))
for (const entry of registry) {
  requireTrue(
    profileById.has(entry.dealershipId),
    `${PROFILES_PATH} has no profile for ${entry.dealershipId} (${entry.storeName}).`
  )
}
for (const profile of profiles.dealerships) {
  requireTrue(
    registryIds.has(profile.id),
    `${PROFILES_PATH} declares a profile for ${profile.id}, which is not a current store ` +
      `in ${DEALERSHIP_REGISTRY_PATH}.`
  )
}

const slugs = new Set(profiles.dealerships.map((profile) => profile.slug))
requireTrue(
  slugs.size === profiles.dealerships.length,
  `${PROFILES_PATH} repeats a slug. Each store's detail page needs its own route.`
)

// Every store directory under the inventory root must belong to a current store.
if (existsSync(repoPath(INVENTORY_ROOT))) {
  for (const entry of readdirSync(repoPath(INVENTORY_ROOT), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    requireTrue(
      registryIds.has(entry.name.toUpperCase()),
      `${INVENTORY_ROOT}/${entry.name} does not correspond to a store in ` +
        `${DEALERSHIP_REGISTRY_PATH}. Inventory directories are named for a dealership ` +
        'id, in lower case.'
    )
  }
} else {
  fail(`The inventory reference directory is missing: ${INVENTORY_ROOT}`)
}

const dealerships: Dealership[] = []
const allRecords: InventoryRecord[] = []
const sourceWorkbooks: string[] = []

for (const entry of registry) {
  const profile = profileById.get(entry.dealershipId)
  const location = locateWorkbook(entry.dealershipId)
  if (!profile || !location) continue

  const parsed = parseWorkbook(entry, location)
  if (!parsed) continue

  sourceWorkbooks.push(location.path)
  allRecords.push(...parsed.records)

  const isFranchise = entry.franchiseBrand !== null

  dealerships.push({
    id: entry.dealershipId,
    slug: profile.slug,
    href: `/dealerships/${profile.slug}`,
    name: entry.storeName,
    shortName: entry.storeShortName,
    storeType: entry.storeType,
    storeTypeLabel: storeTypeLabel(entry.storeType, isFranchise),
    isFranchise,
    franchiseBrand: entry.franchiseBrand,
    city: entry.city,
    stateCode: entry.stateCode,
    marketRegion: entry.marketRegion,
    openedDate: entry.openedDate,

    accent: profile.accent,
    tagline: profile.tagline,
    positioning: profile.positioning,
    inventoryStrategy: profile.inventoryStrategy,
    customerSegment: profile.customerSegment,
    analyticsFocus: profile.analyticsFocus,

    inventory: buildProfile(parsed, location),
  })
}

requireTrue(
  dealerships.length === registry.length,
  'One or more stores produced no inventory profile. Every current store needs a ' +
    'sanitized workbook; the failures above say which.'
)

// Sorted by dealership id, so record order is a property of the data rather than
// of the order the directories happened to be read in.
allRecords.sort(
  (a, b) =>
    a.dealershipId.localeCompare(b.dealershipId) ||
    a.stockReference.localeCompare(b.stockReference)
)

const globalReferences = new Set(allRecords.map((record) => record.stockReference))
requireTrue(
  globalReferences.size === allRecords.length,
  'Two stores share a stock reference. Stock references are group-unique so that a ' +
    'filtered inventory view can key on them.'
)

const dealershipIds = new Set(dealerships.map((dealership) => dealership.id))
for (const record of allRecords) {
  requireTrue(
    dealershipIds.has(record.dealershipId),
    `An inventory record is assigned to ${record.dealershipId}, which is not a store.`
  )
}

const reconciled = dealerships.reduce(
  (total, dealership) => total + dealership.inventory.totalRecords,
  0
)
requireTrue(
  reconciled === allRecords.length,
  `The per-store totals sum to ${String(reconciled)} but ${String(allRecords.length)} ` +
    'records were read. The summary and the record set must describe the same inventory.'
)

// ---------------------------------------------------------------------------
// 8. The group summary
// ---------------------------------------------------------------------------

const preOwnedRecords = allRecords.filter((record) => record.condition === 'pre-owned')
const groupPrices = allRecords.flatMap((record) =>
  record.price === null ? [] : [record.price]
)
const groupPreOwnedMileages = preOwnedRecords.flatMap((record) =>
  record.mileage === null ? [] : [record.mileage]
)
const groupMakes = makeCounts(allRecords)
const groupModels = modelCounts(allRecords)
const snapshotDates = [...new Set(allRecords.map((record) => record.snapshotDate))].sort()

const byDealership: DealershipTotals[] = dealerships.map((dealership) => ({
  dealershipId: dealership.id,
  name: dealership.name,
  shortName: dealership.shortName,
  slug: dealership.slug,
  accent: dealership.accent,
  total: dealership.inventory.totalRecords,
  newRecords: dealership.inventory.newRecords,
  preOwnedRecords: dealership.inventory.preOwnedRecords,
}))

const byCondition: ConditionTotals[] = [
  {
    condition: 'new',
    label: 'New',
    count: allRecords.length - preOwnedRecords.length,
  },
  { condition: 'pre-owned', label: 'Pre-owned', count: preOwnedRecords.length },
]

const byModelYear: ModelYearCount[] = [
  ...tally(allRecords.map((record) => String(record.modelYear))),
]
  .map(({ key, count }) => ({ modelYear: Number(key), count }))
  .sort((a, b) => a.modelYear - b.modelYear)

const mileages = allRecords.flatMap((record) =>
  record.mileage === null ? [] : [record.mileage]
)

const summary: InventorySummary = {
  generatedFrom: [...sourceWorkbooks].sort(),
  latestSnapshotDate: snapshotDates.at(-1) ?? '',
  snapshotDates,

  totalRecords: allRecords.length,
  newRecords: allRecords.length - preOwnedRecords.length,
  preOwnedRecords: preOwnedRecords.length,
  pricedRecords: groupPrices.length,
  mileageRecords: mileages.length,
  dealershipCount: dealerships.length,
  makeCount: groupMakes.length,
  modelCount: groupModels.length,

  medianPrice: median(groupPrices),
  medianPreOwnedMileage: median(groupPreOwnedMileages),
  priceRange: range(groupPrices),
  modelYearRange: range(allRecords.map((record) => record.modelYear)),

  byDealership,
  byCondition,
  byMake: groupMakes,
  byModelYear,
  priceBands: buildPriceBands(allRecords),

  facets: {
    dealershipIds: dealerships.map((dealership) => dealership.id),
    conditions: byCondition
      .filter((entry) => entry.count > 0)
      .map((entry) => entry.condition),
    makes: [...new Set(allRecords.map((record) => record.make))].sort((a, b) =>
      a.localeCompare(b)
    ),
    models: [...groupModels].sort(
      (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model)
    ),
    modelYears: [...new Set(allRecords.map((record) => record.modelYear))].sort(
      (a, b) => b - a
    ),
    priceBounds: range(groupPrices),
    mileageBounds: range(mileages),
  },
}

requireTrue(
  summary.newRecords + summary.preOwnedRecords === summary.totalRecords,
  'New plus pre-owned does not reconcile to the total inventory count.'
)
requireTrue(
  byDealership.reduce((total, entry) => total + entry.total, 0) === summary.totalRecords,
  'The per-dealership totals do not reconcile to the group total.'
)
requireTrue(
  summary.byMake.reduce((total, entry) => total + entry.count, 0) ===
    summary.totalRecords,
  'The make breakdown does not reconcile to the group total.'
)
requireTrue(
  summary.byModelYear.reduce((total, entry) => total + entry.count, 0) ===
    summary.totalRecords,
  'The model-year breakdown does not reconcile to the group total.'
)
requireTrue(
  summary.priceBands.reduce((total, band) => total + band.count, 0) ===
    summary.pricedRecords,
  'The price histogram does not reconcile to the number of priced records.'
)

const dealershipsFile: DealershipsFile = {
  generatedFrom: [DEALERSHIP_REGISTRY_PATH, PROFILES_PATH, ...sourceWorkbooks].sort(),
  group: {
    name: profiles.group.name,
    introduction: profiles.group.introduction,
    operatingModel: profiles.group.operatingModel,
    governanceNote: profiles.group.governanceNote,
    marketRegion: registry[0]?.marketRegion ?? '',
    dealershipCount: dealerships.length,
  },
  dealerships,
}

// ---------------------------------------------------------------------------
// 9. Write or verify
// ---------------------------------------------------------------------------

const artefacts: { path: string; label: string; body: string }[] = [
  {
    path: DEALERSHIPS_OUTPUT,
    label: 'dealerships.json',
    body: `${JSON.stringify(dealershipsFile, null, 2)}\n`,
  },
  {
    path: SUMMARY_OUTPUT,
    label: 'inventory-summary.json',
    body: `${JSON.stringify(summary, null, 2)}\n`,
  },
  {
    path: RECORDS_OUTPUT,
    label: 'inventory-records.json',
    // One record per line rather than fully expanded: 500-plus records at four
    // lines each is a diff nobody reads, and a one-line-per-record file makes an
    // added or changed listing legible in review.
    body: `[\n${allRecords.map((record) => `  ${JSON.stringify(record)}`).join(',\n')}\n]\n`,
  },
]

for (const artefact of artefacts) {
  assertSanitized(artefact.label, artefact.body)
}

if (problems.length > 0) {
  console.error('\ninventory generation FAILED\n')
  for (const [index, problem] of problems.entries()) {
    console.error(`  ${String(index + 1)}. ${problem}\n`)
  }
  console.error(
    `${String(problems.length)} problem(s). The website is not permitted to display an ` +
      'unsourced inventory figure, so nothing was written.\n'
  )
  process.exit(1)
}

if (CHECK_MODE) {
  const stale = artefacts.filter((artefact) => {
    const existing = existsSync(artefact.path) ? readFileSync(artefact.path, 'utf8') : ''
    return existing !== artefact.body
  })
  if (stale.length > 0) {
    console.error(
      '\ninventory data is STALE.\n\n' +
        `${stale.map((artefact) => `  - ${artefact.label}`).join('\n')}\n\n` +
        'The committed artefacts do not match the sanitized workbooks. Run\n' +
        '  npm run inventory\n' +
        'from portfolio/ and commit the result, then read the diff: it is telling you that\n' +
        'a figure on the dealership or inventory pages no longer matches its source.\n'
    )
    process.exit(1)
  }
  console.log(
    `inventory data: up to date. ${String(summary.totalRecords)} records across ` +
      `${String(summary.dealershipCount)} stores, snapshot ${summary.latestSnapshotDate}.`
  )
  process.exit(0)
}

for (const artefact of artefacts) {
  writeFileSync(artefact.path, artefact.body, 'utf8')
}

console.log('inventory data written to src/generated/')
for (const dealership of dealerships) {
  const profile = dealership.inventory
  console.log(
    `  ${dealership.id}  ${dealership.name.padEnd(38)} ` +
      `${String(profile.totalRecords).padStart(4)} records ` +
      `(${String(profile.newRecords)} new / ${String(profile.preOwnedRecords)} pre-owned) ` +
      `from ${String(statSync(repoPath(profile.sourceWorkbook)).size)} bytes`
  )
}
console.log(
  `  GROUP    ${String(summary.totalRecords)} records, ${String(summary.makeCount)} makes, ` +
    `snapshot ${summary.latestSnapshotDate}`
)
