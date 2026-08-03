/**
 * The XLSX reader.
 *
 * `scripts/lib/xlsx.ts` is hand-written rather than taken from the registry, for
 * the reasons its own header gives. That is a defensible trade only if the thing
 * is tested, and tested against the workbooks it actually has to open rather than
 * against a fixture written to match the implementation.
 *
 * So most of what follows opens the three committed sanitization artefacts. They
 * are the contract: if a future workbook is saved by a different tool and this
 * reader stops understanding it, that has to fail here rather than at the next
 * Railway build.
 */
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  cellNumber,
  cellText,
  columnIndex,
  excelSerialToIsoDate,
  readWorkbook,
} from '../../scripts/lib/xlsx.ts'

const REPO = resolve(__dirname, '../../..')
const INVENTORY_ROOT = join(REPO, 'data/reference/inventory')

/** Every committed workbook, discovered rather than listed. */
function workbookPaths(): string[] {
  const found: string[] = []
  for (const store of readdirSync(INVENTORY_ROOT, { withFileTypes: true })) {
    if (!store.isDirectory()) continue
    for (const snapshot of readdirSync(join(INVENTORY_ROOT, store.name), {
      withFileTypes: true,
    })) {
      if (!snapshot.isDirectory()) continue
      const directory = join(INVENTORY_ROOT, store.name, snapshot.name)
      for (const file of readdirSync(directory)) {
        if (file.endsWith('.xlsx')) found.push(join(directory, file))
      }
    }
  }
  return found.sort()
}

const PATHS = workbookPaths()

describe('the reader opens every committed workbook', () => {
  it('finds three of them', () => {
    expect(PATHS).toHaveLength(3)
  })

  it.each(PATHS)('reads the four declared worksheets of %s', (path) => {
    const workbook = readWorkbook(path)
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      'README',
      'Summary',
      'Inventory',
      'Model Summary',
    ])
  })

  it.each(PATHS)('resolves a worksheet by name in %s', (path) => {
    const workbook = readWorkbook(path)
    expect(workbook.sheet('Inventory')).toBeDefined()
    expect(workbook.sheet('Nope')).toBeUndefined()
  })

  it.each(PATHS)('reads the full inventory header from %s', (path) => {
    const sheet = readWorkbook(path).sheet('Inventory')
    const header = (sheet?.rows[0] ?? []).map((value) => cellText(value))
    for (const column of [
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
    ]) {
      expect(header, `${path} is missing ${column}`).toContain(column)
    }
  })

  it.each(PATHS)('pads every row to the same width in %s', (path) => {
    // A sparse row that came back short would silently shift every column after
    // the first empty cell, which is the defect that turns a price into a
    // pricing status.
    const sheet = readWorkbook(path).sheet('Inventory')
    const widths = new Set((sheet?.rows ?? []).map((row) => row.length))
    expect(widths.size).toBe(1)
  })

  it.each(PATHS)('returns null for an empty cell rather than zero in %s', (path) => {
    const sheet = readWorkbook(path).sheet('Inventory')
    const header = (sheet?.rows[0] ?? []).map((value) => cellText(value))
    const priceColumn = header.indexOf('Advertised Price')
    const values = (sheet?.rows ?? []).slice(1).map((row) => row[priceColumn])
    // Every value is either a number or null. A blank that came back as 0 or as
    // an empty string would price an unpriced listing.
    for (const value of values) {
      expect(value === null || typeof value === 'number').toBe(true)
    }
  })
})

describe('cell coercion keeps a missing value missing', () => {
  it('reads text, trimming it', () => {
    expect(cellText('  Chevrolet  ')).toBe('Chevrolet')
    expect(cellText('')).toBeUndefined()
    expect(cellText('   ')).toBeUndefined()
    expect(cellText(null)).toBeUndefined()
  })

  it('renders a numeric cell as text where text is asked for', () => {
    expect(cellText(2026)).toBe('2026')
  })

  it('reads numbers, including zero', () => {
    // Zero is a real odometer reading on a new vehicle and must not be treated
    // as absent.
    expect(cellNumber(0)).toBe(0)
    expect(cellNumber(38690)).toBe(38690)
    expect(cellNumber(null)).toBeUndefined()
    expect(cellNumber('')).toBeUndefined()
    expect(cellNumber('not a number')).toBeUndefined()
  })

  it('strips currency punctuation from a numeric string', () => {
    expect(cellNumber('$38,690')).toBe(38690)
  })
})

describe('column references resolve', () => {
  it('maps single letters', () => {
    expect(columnIndex('A')).toBe(0)
    expect(columnIndex('Z')).toBe(25)
  })

  it('maps two-letter references', () => {
    expect(columnIndex('AA')).toBe(26)
    expect(columnIndex('AZ')).toBe(51)
    expect(columnIndex('BA')).toBe(52)
  })
})

describe('date serials convert without consulting a timezone', () => {
  it('places serial 61 on 1900-03-01, the first unambiguous date', () => {
    // The 1900 date system counts a 29 February 1900 that did not exist, so the
    // 1899-12-30 epoch is exactly right from 1 March 1900 onward and wrong for
    // everything before it.
    expect(excelSerialToIsoDate(61)).toBe('1900-03-01')
  })

  it('refuses a serial inside the leap-year ambiguity rather than guessing', () => {
    // No single epoch converts both halves of 1900 correctly. Returning a
    // plausible wrong date is worse than stopping, because a capture date is
    // rendered on the site as a fact about when the snapshot was taken.
    for (const serial of [1, 59, 60]) {
      expect(() => excelSerialToIsoDate(serial), String(serial)).toThrow(/ambiguous/i)
    }
  })

  it('converts the snapshot date the workbooks carry', () => {
    expect(excelSerialToIsoDate(46236)).toBe('2026-08-02')
  })

  it('ignores a fractional time component', () => {
    expect(excelSerialToIsoDate(46236.75)).toBe('2026-08-02')
  })

  it('produces the same answer whatever the local timezone is', () => {
    const original = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Kiritimati'
      const east = excelSerialToIsoDate(46236)
      process.env.TZ = 'Pacific/Midway'
      const west = excelSerialToIsoDate(46236)
      expect(east).toBe(west)
      expect(east).toBe('2026-08-02')
    } finally {
      process.env.TZ = original
    }
  })
})

describe('the reader refuses what it does not understand', () => {
  it('rejects a file that is not a ZIP archive', () => {
    expect(() => readWorkbook(join(REPO, 'README.md'))).toThrow(/ZIP/i)
  })
})
