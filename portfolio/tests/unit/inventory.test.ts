/**
 * Inventory-integrity tests.
 *
 * The dealership experience renders sanitized data captured from a public
 * listing source. That makes it the part of this site with the most ways to go
 * wrong quietly: a count that no longer matches the workbook, a median computed
 * over a population the source never priced, a store's rows filed under another
 * store, or a VIN that survived ingestion and is now on a public web page.
 *
 * Each test below corresponds to one of those, and they are asserted against the
 * WORKBOOKS wherever the workbook can be reached, rather than against the
 * generated file alone. A test that only compares the generated file to itself
 * proves the generator is self-consistent, which is not the property that
 * matters.
 *
 * The companion suite `tests/unit/xlsx.test.ts` covers the reader underneath
 * this, and `tests/e2e/inventory.spec.ts` covers what actually reaches a screen.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import dealershipsJson from '@/generated/dealerships.json'
import recordsJson from '@/generated/inventory-records.json'
import summaryJson from '@/generated/inventory-summary.json'
import profiles from '@/content/dealership-profiles.json'
import { readWorkbook } from '../../scripts/lib/xlsx.ts'
import type {
  DealershipsFile,
  InventoryRecord,
  InventorySummary,
} from '../../src/types/inventory.ts'

const PORTFOLIO = resolve(__dirname, '../..')
const REPO = resolve(PORTFOLIO, '..')

const dealershipsFile = dealershipsJson as unknown as DealershipsFile
const summary = summaryJson as unknown as InventorySummary
const records = recordsJson as unknown as InventoryRecord[]
const stores = dealershipsFile.dealerships

const EXPECTED_IDS = ['GSA-001', 'GSA-002', 'GSA-003'] as const

const EXPECTED_NAMES: Record<string, string> = {
  'GSA-001': 'Granite Chevrolet of Nashua',
  'GSA-002': 'Granite Subaru of Manchester',
  'GSA-003': 'Granite Pre-Owned Center of Merrimack',
}

/* -------------------------------------------------------------------------- */
/* The three stores                                                           */
/* -------------------------------------------------------------------------- */

describe('the generated group is the three stores it claims to be', () => {
  it('generates exactly three dealerships', () => {
    expect(stores).toHaveLength(3)
    expect(dealershipsFile.group.dealershipCount).toBe(3)
    expect(summary.dealershipCount).toBe(3)
  })

  it('gives every dealership a unique id, slug and route', () => {
    expect(new Set(stores.map((store) => store.id)).size).toBe(stores.length)
    expect(new Set(stores.map((store) => store.slug)).size).toBe(stores.length)
    expect(new Set(stores.map((store) => store.href)).size).toBe(stores.length)
  })

  it('uses the established dealership ids, unchanged', () => {
    expect(stores.map((store) => store.id)).toEqual([...EXPECTED_IDS])
  })

  it('publishes the correct public name for each store', () => {
    for (const store of stores) {
      expect(store.name, store.id).toBe(EXPECTED_NAMES[store.id])
    }
  })

  it('publishes the group under its current name', () => {
    expect(dealershipsFile.group.name).toBe('Granite Auto Group')
  })

  it('classifies two franchise rooftops and one independent store', () => {
    const franchise = stores.filter((store) => store.isFranchise)
    const independent = stores.filter((store) => !store.isFranchise)
    expect(franchise.map((store) => store.franchiseBrand)).toEqual([
      'Chevrolet',
      'Subaru',
    ])
    expect(independent).toHaveLength(1)
    expect(independent[0]?.franchiseBrand).toBeNull()
    expect(independent[0]?.id).toBe('GSA-003')
  })

  it('agrees with the warehouse store dimension about every store', () => {
    // The registry is the warehouse's own dimension. The website deriving its
    // dealership identity from anywhere else is how a site and a data model come
    // to disagree about who a business is.
    const csv = readFileSync(join(REPO, 'data/sample/dim_dealership.csv'), 'utf8')
    const rows = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','))
    const header = csv.split('\n')[0]!.split(',')
    const column = (name: string) => header.indexOf(name)

    for (const store of stores) {
      const row = rows.find((entry) => entry[column('dealership_id')] === store.id)
      expect(row, `${store.id} is not in the store dimension`).toBeDefined()
      expect(row?.[column('store_name')]).toBe(store.name)
      expect(row?.[column('city')]).toBe(store.city)
      expect(row?.[column('state_code')]).toBe(store.stateCode)
      expect(row?.[column('franchise_brand')] || null).toBe(store.franchiseBrand)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Records reconcile                                                          */
/* -------------------------------------------------------------------------- */

describe('every inventory record belongs to a store, and the totals reconcile', () => {
  it('maps every record to a declared dealership', () => {
    const ids = new Set(stores.map((store) => store.id))
    for (const record of records) {
      expect(ids.has(record.dealershipId), record.stockReference).toBe(true)
    }
  })

  it('gives every record a group-unique stock reference', () => {
    const references = records.map((record) => record.stockReference)
    expect(new Set(references).size).toBe(references.length)
  })

  it('reconciles the per-store totals to the record set', () => {
    for (const store of stores) {
      const owned = records.filter((record) => record.dealershipId === store.id)
      expect(owned.length, store.id).toBe(store.inventory.totalRecords)
      expect(owned.filter((record) => record.condition === 'new').length, store.id).toBe(
        store.inventory.newRecords
      )
      expect(
        owned.filter((record) => record.condition === 'pre-owned').length,
        store.id
      ).toBe(store.inventory.preOwnedRecords)
    }
  })

  it('reconciles new plus pre-owned to the total, at both levels', () => {
    expect(summary.newRecords + summary.preOwnedRecords).toBe(summary.totalRecords)
    for (const store of stores) {
      expect(store.inventory.newRecords + store.inventory.preOwnedRecords, store.id).toBe(
        store.inventory.totalRecords
      )
    }
  })

  it('reconciles the store totals to the group total', () => {
    const summed = stores.reduce(
      (total, store) => total + store.inventory.totalRecords,
      0
    )
    expect(summed).toBe(summary.totalRecords)
    expect(summed).toBe(records.length)
  })

  it('reconciles every breakdown in the summary to the record count', () => {
    const sum = (entries: readonly { count: number }[]) =>
      entries.reduce((total, entry) => total + entry.count, 0)
    expect(sum(summary.byCondition)).toBe(summary.totalRecords)
    expect(sum(summary.byMake)).toBe(summary.totalRecords)
    expect(sum(summary.byModelYear)).toBe(summary.totalRecords)
    expect(sum(summary.byDealership.map((entry) => ({ count: entry.total })))).toBe(
      summary.totalRecords
    )
    // The histogram counts PRICED listings, not all of them, and saying so is the
    // whole reason the two numbers are allowed to differ.
    expect(sum(summary.priceBands)).toBe(summary.pricedRecords)
  })

  it('counts priced and odometered listings correctly', () => {
    expect(records.filter((record) => record.price !== null)).toHaveLength(
      summary.pricedRecords
    )
    expect(records.filter((record) => record.mileage !== null)).toHaveLength(
      summary.mileageRecords
    )
    for (const store of stores) {
      const owned = records.filter((record) => record.dealershipId === store.id)
      expect(owned.filter((record) => record.price !== null).length, store.id).toBe(
        store.inventory.pricedRecords
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Against the workbooks themselves                                           */
/* -------------------------------------------------------------------------- */

describe('the generated counts equal the source workbook counts', () => {
  it('files every workbook under the store it declares', () => {
    for (const store of stores) {
      const workbook = readWorkbook(join(REPO, store.inventory.sourceWorkbook))
      const readme = workbook.sheet('README')
      const declared = readme?.rows.find(
        (row) => String(row[0] ?? '') === 'Dealership ID'
      )?.[1]
      expect(String(declared), store.inventory.sourceWorkbook).toBe(store.id)
      expect(
        store.inventory.sourceWorkbook.startsWith(
          `data/reference/inventory/${store.id.toLowerCase()}/`
        ),
        `${store.id} workbook is filed under the wrong directory`
      ).toBe(true)
    }
  })

  it('reads the same number of rows the workbook holds', () => {
    for (const store of stores) {
      const workbook = readWorkbook(join(REPO, store.inventory.sourceWorkbook))
      const sheet = workbook.sheet('Inventory')
      expect(sheet, `${store.id} has no Inventory worksheet`).toBeDefined()
      const dataRows = (sheet?.rows ?? [])
        .slice(1)
        .filter((row) => String(row[0] ?? '').trim() !== '')
      expect(dataRows.length, store.id).toBe(store.inventory.totalRecords)
    }
  })

  it('finds exactly one workbook per store, under an ISO-dated snapshot folder', () => {
    const root = join(REPO, 'data/reference/inventory')
    const directories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(directories).toEqual(EXPECTED_IDS.map((id) => id.toLowerCase()))

    for (const directory of directories) {
      const snapshots = readdirSync(join(root, directory), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      expect(snapshots.length, directory).toBeGreaterThan(0)
      for (const snapshot of snapshots) {
        expect(snapshot, `${directory}/${snapshot}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const workbooks = readdirSync(join(root, directory, snapshot)).filter((name) =>
          name.endsWith('.xlsx')
        )
        expect(workbooks, `${directory}/${snapshot}`).toHaveLength(1)
      }
    }
  })

  it('cites a source workbook that exists for every store', () => {
    for (const store of stores) {
      expect(
        () => statSync(join(REPO, store.inventory.sourceWorkbook)),
        `${store.id} cites a workbook that does not exist`
      ).not.toThrow()
    }
    for (const path of summary.generatedFrom) {
      expect(existsSync(join(REPO, path)), path).toBe(true)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Derived statistics are honest                                              */
/* -------------------------------------------------------------------------- */

describe('a derived statistic never outruns the data it came from', () => {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    if (sorted.length === 0) return null
    if (sorted.length % 2 === 1) return sorted[middle] as number
    return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
  }

  it('computes the group median price over the priced listings only', () => {
    const priced = records.flatMap((record) =>
      record.price === null ? [] : [record.price]
    )
    expect(summary.medianPrice).toBe(median(priced))
    expect(priced).toHaveLength(summary.pricedRecords)
  })

  it('computes each median over its own store, not the group', () => {
    for (const store of stores) {
      const priced = records
        .filter((record) => record.dealershipId === store.id)
        .flatMap((record) => (record.price === null ? [] : [record.price]))
      expect(store.inventory.medianPrice, store.id).toBe(median(priced))
    }
  })

  it('computes the pre-owned mileage median over pre-owned listings only', () => {
    const mileages = records
      .filter((record) => record.condition === 'pre-owned' && record.mileage !== null)
      .map((record) => record.mileage as number)
    expect(summary.medianPreOwnedMileage).toBe(median(mileages))
  })

  it('never states a range wider than the values it covers', () => {
    for (const store of stores) {
      const owned = records.filter((record) => record.dealershipId === store.id)
      const prices = owned.flatMap((record) =>
        record.price === null ? [] : [record.price]
      )
      if (store.inventory.priceRange !== null) {
        expect(store.inventory.priceRange.min, store.id).toBe(Math.min(...prices))
        expect(store.inventory.priceRange.max, store.id).toBe(Math.max(...prices))
      } else {
        expect(prices, store.id).toHaveLength(0)
      }

      const years = owned.map((record) => record.modelYear)
      expect(store.inventory.modelYearRange?.min, store.id).toBe(Math.min(...years))
      expect(store.inventory.modelYearRange?.max, store.id).toBe(Math.max(...years))
    }
  })

  it('never reports more priced or odometered listings than it has', () => {
    for (const store of stores) {
      expect(store.inventory.pricedRecords).toBeLessThanOrEqual(
        store.inventory.totalRecords
      )
      expect(store.inventory.mileageRecords).toBeLessThanOrEqual(
        store.inventory.totalRecords
      )
    }
    expect(summary.pricedRecords).toBeLessThanOrEqual(summary.totalRecords)
  })

  it('leaves a statistic null rather than inventing one', () => {
    // The generator must never fill a missing value. Where a store has no priced
    // listing at all, its median must be null rather than 0.
    for (const store of stores) {
      if (store.inventory.pricedRecords === 0) {
        expect(store.inventory.medianPrice, store.id).toBeNull()
        expect(store.inventory.priceRange, store.id).toBeNull()
      }
    }
  })

  it('records a coverage status where the workbook states one, and null where it does not', () => {
    for (const store of stores) {
      const status = store.inventory.coverageStatus
      expect(status === null || status.length > 5, store.id).toBe(true)
      expect(store.inventory.sourceType.length, store.id).toBeGreaterThan(10)
    }
    // At least one store's workbook declares a partial sample, and that has to
    // survive into the generated data or the site would present it as complete.
    expect(
      stores.some((store) => /partial/i.test(store.inventory.coverageStatus ?? '')),
      'no store carries a partial-coverage status; the Subaru workbook declares one'
    ).toBe(true)
  })

  it('reports the top makes and models in descending order, ties broken by name', () => {
    for (const store of stores) {
      const counts = store.inventory.topMakes.map((entry) => entry.count)
      expect(
        [...counts].sort((a, b) => b - a),
        store.id
      ).toEqual(counts)
      expect(store.inventory.topMakes.length).toBeLessThanOrEqual(
        store.inventory.makeCount
      )
      expect(store.inventory.topModels.length).toBeLessThanOrEqual(
        store.inventory.modelCount
      )
    }
  })

  it('keeps multi-word model names intact', () => {
    // The composite make-and-model tally is keyed on a joined string. Splitting
    // that key on whitespace instead of on a separator truncates every two-word
    // model, and "Silverado 1500" becoming "Silverado" is invisible in a total.
    const multiWord = records.filter((record) => record.model.includes(' '))
    expect(multiWord.length).toBeGreaterThan(0)
    const generatedModels = new Set(
      stores.flatMap((store) => store.inventory.topModels.map((entry) => entry.model))
    )
    const sourceModels = new Set(records.map((record) => record.model))
    for (const model of generatedModels) {
      expect(sourceModels.has(model), `"${model}" is not a model in the record set`).toBe(
        true
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Sanitization                                                               */
/* -------------------------------------------------------------------------- */

describe('nothing unsanitized reaches the generated frontend data', () => {
  const ARTEFACTS: [string, string][] = [
    ['dealerships.json', JSON.stringify(dealershipsJson)],
    ['inventory-summary.json', JSON.stringify(summaryJson)],
    ['inventory-records.json', JSON.stringify(recordsJson)],
    ['dealership-profiles.json', JSON.stringify(profiles)],
  ]

  const FORBIDDEN: [RegExp, string][] = [
    [/https?:\/\//i, 'a source URL'],
    [/\bwww\.[a-z0-9-]+\.[a-z]{2,}/i, 'a hostname'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
    [
      /(?<![\d,.-])(?:\+?1[ .-])?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d,.-])/,
      'a telephone number',
    ],
    [
      /\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b/,
      'a VIN-shaped identifier',
    ],
    [/\b[a-z0-9-]+\.(?:com|net|org|co|dealer|auto)\b/i, 'a domain name'],
  ]

  for (const [label, body] of ARTEFACTS) {
    for (const [pattern, what] of FORBIDDEN) {
      it(`${label} contains no ${what}`, () => {
        const found = pattern.exec(body)
        expect(found?.[0] ?? null, `${label} matched ${String(pattern)}`).toBeNull()
      })
    }
  }

  it('declares no VIN field on the record type at all', () => {
    // Stronger than "no value looks like a VIN": there is no field for one.
    const keys = new Set(records.flatMap((record) => Object.keys(record)))
    expect([...keys].sort()).toEqual([
      'condition',
      'dealershipId',
      'make',
      'mileage',
      'model',
      'modelYear',
      'price',
      'pricingStatus',
      'snapshotDate',
      'stockReference',
      'trim',
    ])
    for (const forbidden of [
      'vin',
      'syntheticVin',
      'sourceUrl',
      'storeName',
      'sourceFeed',
    ]) {
      expect(keys.has(forbidden), `the record type carries "${forbidden}"`).toBe(false)
    }
  })

  it('never uses a retired public name anywhere in the generated data', () => {
    for (const [label, body] of ARTEFACTS) {
      for (const retired of [
        'Granite State Auto Group',
        'Granite Used Auto',
        'Game Auto Group',
      ]) {
        expect(body.includes(retired), `${label} contains "${retired}"`).toBe(false)
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Authored content carries no number                                         */
/* -------------------------------------------------------------------------- */

describe('the authored dealership copy carries prose and nothing else', () => {
  it('contains no digit outside an identifier', () => {
    // The rule that keeps "no count on the website is hardcoded" true in practice
    // rather than only in intent. The generator enforces the same thing and fails
    // the build; this states it where a reader of the tests will find it.
    const raw = readFileSync(
      join(PORTFOLIO, 'src/content/dealership-profiles.json'),
      'utf8'
    )
    const withoutIds = raw.replace(/"(?:id|slug)":\s*"[^"]*"/g, '')
    expect(/\d/.exec(withoutIds)?.[0] ?? null).toBeNull()
  })

  it('declares a profile for each store and no others', () => {
    expect(profiles.dealerships.map((entry) => entry.id).sort()).toEqual([
      ...EXPECTED_IDS,
    ])
  })

  it('gives every store a positioning paragraph long enough to be one', () => {
    for (const entry of profiles.dealerships) {
      expect(entry.positioning.length, entry.id).toBeGreaterThan(80)
      expect(entry.inventoryStrategy.length, entry.id).toBeGreaterThan(60)
      expect(entry.customerSegment.length, entry.id).toBeGreaterThan(40)
      expect(entry.analyticsFocus.length, entry.id).toBeGreaterThan(40)
    }
  })

  it('uses no em dash in public-facing dealership copy', () => {
    const raw = readFileSync(
      join(PORTFOLIO, 'src/content/dealership-profiles.json'),
      'utf8'
    )
    expect(raw.includes('—'), 'dealership-profiles.json contains an em dash').toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* No component authors an inventory figure                                   */
/* -------------------------------------------------------------------------- */

describe('no component hardcodes an inventory count', () => {
  /** Every .ts/.tsx file under src/, excluding the generated artefacts. */
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

  /**
   * The counts that would be tempting to type, and the word that would be beside
   * one if somebody had. Matched the same way `content-integrity.test.ts` matches
   * a manifest count: the value AND its subject in the same rendered position,
   * because a bare numeric scan flags every SVG coordinate in the file.
   */
  const CHECKS = [
    { key: 'totalRecords', value: summary.totalRecords, keyword: 'listing' },
    { key: 'newRecords', value: summary.newRecords, keyword: 'new' },
    { key: 'preOwnedRecords', value: summary.preOwnedRecords, keyword: 'pre-owned' },
    { key: 'makeCount', value: summary.makeCount, keyword: 'make' },
    ...stores.map((store) => ({
      key: `${store.id} totalRecords`,
      value: store.inventory.totalRecords,
      keyword: 'listing',
    })),
  ]

  it.each(CHECKS)(
    'reads $key from the generated data rather than writing $value',
    (check) => {
      const value = String(check.value)
      const asJsxText = new RegExp(
        `>[^<>{}]{0,80}(^|[^\\w.-])${value}([^\\w.%-]|$)[^<>{}]{0,80}<`
      )
      const asExpressionChild = new RegExp(`>\\s*\\{\\s*${value}\\s*\\}`)
      const offenders: string[] = []

      for (const file of sourceFiles()) {
        if (file.includes('/content/') || file.includes('/types/')) continue
        const body = readFileSync(file, 'utf8')
        if (!body.toLowerCase().includes(check.keyword)) continue
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
        `${check.key} (${value}) appears as a rendered literal. Read it from ` +
          `lib/inventory.ts instead:\n${offenders.join('\n')}`
      ).toEqual([])
    }
  )
})
