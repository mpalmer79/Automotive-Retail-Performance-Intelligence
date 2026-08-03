/**
 * A minimal, read-only XLSX reader.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY
 * ----------------------------------------
 * The inventory generator has to open three sanitized workbooks at build time,
 * inside the Railway image, and read one worksheet from each. The obvious way to
 * do that is `npm install xlsx`, and it was rejected twice over:
 *
 *   - The version published to the public registry is 0.18.5, which carries a
 *     prototype-pollution advisory fixed only in a release the maintainer moved
 *     off npm. This repository's other package reports zero audit findings at any
 *     level and states so in its own package.json; taking a known-vulnerable
 *     parser to read three files the repository itself produced would be a poor
 *     trade.
 *   - A general-purpose reader carries formula evaluation, style resolution,
 *     encryption and a writer. None of that is wanted here, and every one of
 *     them is a way for a build to become non-deterministic.
 *
 * WHAT IT SUPPORTS, AND WHAT IT DELIBERATELY DOES NOT
 * --------------------------------------------------
 * Supported: the ZIP container (stored and deflated entries), the workbook part,
 * the workbook relationships, shared strings, inline strings, and worksheet cells
 * carrying a number or a string. That is the whole of what the sanitization
 * artefacts use, and the generator asserts the shape it gets.
 *
 * Not supported, on purpose: formulas (the cached `<v>` is read, the expression
 * is ignored), styles, number formats, encrypted packages, ZIP64, and writing.
 * A workbook that needs any of them is a workbook this project did not produce,
 * and failing loudly on it is the correct outcome.
 *
 * DATES
 * -----
 * A date cell in the OOXML spec is a number plus a style, and styles are not
 * parsed here, so this reader returns the raw serial. {@link excelSerialToIsoDate}
 * converts one where the caller knows a column is a date. The 1900 leap-year bug
 * is handled the way every spreadsheet handles it: the epoch is 1899-12-30.
 */
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/** A worksheet cell value. `null` is an empty cell, which is not the same as 0. */
export type CellValue = string | number | null

export interface Worksheet {
  readonly name: string
  /** Rows in sheet order, each padded to the sheet's widest row. */
  readonly rows: readonly (readonly CellValue[])[]
}

export interface Workbook {
  readonly sheets: readonly Worksheet[]
  sheet(name: string): Worksheet | undefined
}

/* -------------------------------------------------------------------------- */
/* 1. The ZIP container                                                        */
/* -------------------------------------------------------------------------- */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50

/**
 * Read every entry of a ZIP archive into memory, keyed by name.
 *
 * The central directory is walked rather than the local headers, because a local
 * header may declare its sizes in a trailing data descriptor instead of in the
 * header itself. The central directory always carries them.
 */
function readZipEntries(archive: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is at the tail, after a comment of up to
  // 65,535 bytes. Scan backwards for its signature.
  let eocd = -1
  const lowest = Math.max(0, archive.length - 0xffff - 22)
  for (let offset = archive.length - 22; offset >= lowest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      eocd = offset
      break
    }
  }
  if (eocd === -1) {
    throw new Error('Not a ZIP archive: no end-of-central-directory record.')
  }

  const entryCount = archive.readUInt16LE(eocd + 10)
  let cursor = archive.readUInt32LE(eocd + 16)
  if (cursor === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.')
  }

  const entries = new Map<string, Buffer>()

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error(
        `Corrupt ZIP: central directory entry ${String(index)} is malformed.`
      )
    }
    const method = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`Corrupt ZIP: ${name} has no local file header.`)
    }
    // The local header's own name and extra lengths are authoritative for where
    // the data starts; they can differ from the central directory's extra field.
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) {
      entries.set(name, Buffer.from(compressed))
    } else if (method === 8) {
      entries.set(name, inflateRawSync(compressed))
    } else {
      throw new Error(`Unsupported ZIP compression method ${String(method)} for ${name}.`)
    }

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/* -------------------------------------------------------------------------- */
/* 2. Just enough XML                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Decode the five predefined XML entities and numeric character references.
 *
 * `&amp;` is decoded LAST so that an escaped ampersand in the source
 * (`&amp;lt;`) decodes to the literal text `&lt;` rather than to `<`.
 */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_whole, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_whole, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A tag matcher that tolerates a namespace prefix.
 *
 * The workbooks this reader opens write `<x:row>`; a workbook saved by Excel
 * writes `<row>`. Both are correct OOXML and a reader that understood only one
 * of them would work until the day somebody opened a file and saved it again.
 */
function tagPattern(name: string, flags: string): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b([^>]*?)(/?)>`, flags)
}

/** Read an attribute from a captured tag-attribute string. */
function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)
  return match ? decodeXmlText(match[1] as string) : undefined
}

/* -------------------------------------------------------------------------- */
/* 3. Worksheet parts                                                          */
/* -------------------------------------------------------------------------- */

/** Convert a spreadsheet column reference (`A`, `Z`, `AA`) to a zero-based index. */
export function columnIndex(reference: string): number {
  let index = 0
  for (const character of reference) {
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index - 1
}

/** Shared strings, in index order. Each `<si>` concatenates its `<t>` runs. */
function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const items: string[] = []
  const itemPattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?si\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?si>`,
    'g'
  )
  for (const item of xml.matchAll(itemPattern)) {
    const body = item[1] as string
    const runs = [
      ...body.matchAll(
        /<(?:[A-Za-z0-9_.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?t>/g
      ),
    ]
    items.push(runs.map((run) => decodeXmlText(run[1] as string)).join(''))
  }
  return items
}

/** Parse one worksheet part into a dense, rectangular grid. */
function parseWorksheet(
  name: string,
  xml: string,
  sharedStrings: readonly string[]
): Worksheet {
  const rows: CellValue[][] = []
  let widest = 0

  const rowPattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?row>)`,
    'g'
  )

  for (const rowMatch of xml.matchAll(rowPattern)) {
    const body = rowMatch[2] ?? ''
    const cells: CellValue[] = []

    const cellPattern = new RegExp(
      `<(?:[A-Za-z0-9_.-]+:)?c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?c>)`,
      'g'
    )

    for (const cellMatch of body.matchAll(cellPattern)) {
      const attributes = cellMatch[1] as string
      const inner = cellMatch[2] ?? ''
      const reference = attribute(attributes, 'r')
      const type = attribute(attributes, 't') ?? 'n'

      // Place the cell at its declared column, so a sparse row keeps its shape.
      const target = reference
        ? columnIndex(/^([A-Z]+)/.exec(reference)?.[1] ?? 'A')
        : cells.length
      while (cells.length < target) cells.push(null)

      cells[target] = readCellValue(type, inner, sharedStrings)
    }

    widest = Math.max(widest, cells.length)
    rows.push(cells)
  }

  // Pad every row to the widest, so a caller may index a column without first
  // checking the row's length.
  for (const row of rows) {
    while (row.length < widest) row.push(null)
  }

  return { name, rows }
}

function readCellValue(
  type: string,
  inner: string,
  sharedStrings: readonly string[]
): CellValue {
  if (type === 'inlineStr') {
    const runs = [
      ...inner.matchAll(
        /<(?:[A-Za-z0-9_.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?t>/g
      ),
    ]
    if (runs.length === 0) return null
    return runs.map((run) => decodeXmlText(run[1] as string)).join('')
  }

  const valueMatch =
    /<(?:[A-Za-z0-9_.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?v>/.exec(inner)
  if (!valueMatch) return null
  const raw = decodeXmlText(valueMatch[1] as string)

  switch (type) {
    case 's': {
      const index = Number.parseInt(raw, 10)
      return sharedStrings[index] ?? null
    }
    case 'str':
    case 'e':
      return raw
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE'
    default: {
      const numeric = Number(raw)
      return Number.isFinite(numeric) ? numeric : raw
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. The workbook                                                             */
/* -------------------------------------------------------------------------- */

/** Open an XLSX file and read every worksheet it declares, in sheet order. */
export function readWorkbook(path: string): Workbook {
  const entries = readZipEntries(readFileSync(path))

  const workbookXml = entries.get('xl/workbook.xml')
  if (!workbookXml) {
    throw new Error(`${path} is not an XLSX package: xl/workbook.xml is missing.`)
  }

  // Relationship id -> part name, so a sheet is resolved by its relationship
  // rather than by assuming `sheet1.xml` is the first tab. It frequently is not.
  const relationships = new Map<string, string>()
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  for (const match of relsXml.matchAll(tagPattern('Relationship', 'g'))) {
    const attributes = match[1] as string
    const id = attribute(attributes, 'Id')
    const target = attribute(attributes, 'Target')
    if (id && target) {
      relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''))
    }
  }

  const sharedStrings = parseSharedStrings(
    entries.get('xl/sharedStrings.xml')?.toString('utf8')
  )

  const sheets: Worksheet[] = []
  for (const match of workbookXml.toString('utf8').matchAll(tagPattern('sheet', 'g'))) {
    const attributes = match[1] as string
    const name = attribute(attributes, 'name')
    // The relationship attribute is namespaced (`r:id`), and the prefix is
    // declared per-file, so it is matched by local name.
    const relationshipId = /\br:id="([^"]*)"/.exec(attributes)?.[1]
    if (!name || !relationshipId) continue

    const part = relationships.get(relationshipId)
    const sheetXml = part ? entries.get(`xl/${part}`) : undefined
    if (!sheetXml) {
      throw new Error(`${path}: worksheet "${name}" resolves to no part in the package.`)
    }
    sheets.push(parseWorksheet(name, sheetXml.toString('utf8'), sharedStrings))
  }

  return {
    sheets,
    sheet(name: string) {
      return sheets.find((sheet) => sheet.name === name)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Value helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The lowest serial this function will convert.
 *
 * Serial 61 is 1 March 1900, and it is the first date on which the 1899-12-30
 * epoch below is exactly right. See {@link excelSerialToIsoDate}.
 */
const LOWEST_UNAMBIGUOUS_SERIAL = 61

/**
 * Convert an Excel date serial to an ISO `YYYY-MM-DD` date.
 *
 * THE EPOCH IS 1899-12-30, AND THAT IS NOT A ROUNDING CHOICE
 * ----------------------------------------------------------
 * The 1900 date system counts a 29 February 1900 that never existed, inherited
 * from Lotus 1-2-3 and kept for compatibility. Serials from 61 (1 March 1900)
 * onwards are therefore two days ahead of a true day count from 1900-01-01, and
 * shifting the epoch back to 1899-12-30 cancels exactly that. Every date from 1
 * March 1900 to the end of the format's range converts correctly.
 *
 * Serials below 61 do NOT. Serial 1 is 1 January 1900 in a spreadsheet but
 * 31 December 1899 under this epoch, serial 60 is the day that does not exist,
 * and no single epoch gets both halves right. Rather than return a silently
 * wrong answer for a date nothing in this repository can legitimately carry -
 * an inventory snapshot is a recent capture date - this throws. A workbook
 * producing a serial that low has a corrupt or misidentified date column, and
 * the build should stop and say so.
 *
 * Computed in UTC arithmetic only. No local timezone is consulted, so the answer
 * does not depend on where the build runs.
 */
export function excelSerialToIsoDate(serial: number): string {
  const EPOCH_UTC_MS = Date.UTC(1899, 11, 30)
  const DAY_MS = 86_400_000
  const whole = Math.floor(serial)
  if (!Number.isFinite(whole) || whole < LOWEST_UNAMBIGUOUS_SERIAL) {
    throw new Error(
      `Excel date serial ${String(serial)} is below ${String(LOWEST_UNAMBIGUOUS_SERIAL)} ` +
        '(1 March 1900), where the 1900 leap-year bug makes the conversion ambiguous. ' +
        'A date column producing this is not a capture date.'
    )
  }
  const date = new Date(EPOCH_UTC_MS + whole * DAY_MS)
  const year = date.getUTCFullYear().toString().padStart(4, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** A trimmed string, or `undefined` for an empty or non-string cell. */
export function cellText(value: CellValue): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'number') return String(value)
  return undefined
}

/** A finite number, or `undefined` for an empty or non-numeric cell. */
export function cellNumber(value: CellValue): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value.replace(/[$,\s]/g, ''))
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return undefined
}
