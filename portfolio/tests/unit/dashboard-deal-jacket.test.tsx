/**
 * The Deal Jacket: the arithmetic, the absences, and the corrupted-fixture proof.
 *
 * WHAT IS ACTUALLY AT RISK ON THIS PAGE
 * -------------------------------------
 * The Deal Jacket makes the strongest claim in the whole project: that one transaction
 * is explained TO THE CENT. Three defects would each leave that claim looking intact:
 *
 *   * the page displays the stored `front_end_gross` and calls it "verified" without
 *     ever recomputing it, so a wrong figure verifies itself;
 *   * an absence renders as `$0.00` or as a blank, so "this deal had no trade" and
 *     "this deal traded a car worth nothing" become the same sentence;
 *   * trade variance drifts into the front-gross formula, which silently redefines
 *     `KPI-GRS-001` on the one page that promises to show what it means.
 *
 * The last block of this file is the load-bearing one. It rebuilds the module against
 * a CORRUPTED partition -- a deal whose components are one cent off its published
 * gross -- and requires the failure to surface in words. Without it, a verification
 * that always returns `true` passes every other test here.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ChecksSection,
  FrontGrossSection,
  StaffSection,
  TimelineSectionBlock,
  TotalGrossSection,
  TradeSectionBlock,
} from '../../src/components/dashboard/deal-jacket-sections.tsx'
import { dashboardManifest } from '../../src/lib/dashboard/data.ts'
import { addExact, exactToString, parseExact } from '../../src/lib/dashboard/decimal.ts'
import {
  allSaleIds,
  buildDealJacket,
  dealRow,
  isWellFormedSaleId,
  type DealJacket,
} from '../../src/lib/dashboard/deal-jacket.ts'
import type { DashboardCell, DashboardDatasetFile } from '../../src/types/dashboard.ts'

/** Every deal, built once. 650 jackets is cheap and makes the population assertions real. */
const EVERY_JACKET: readonly DealJacket[] = allSaleIds().map((saleId) => {
  const jacket = buildDealJacket(saleId)
  if (jacket === null) throw new Error(`buildDealJacket returned null for ${saleId}`)
  return jacket
})

/**
 * Every string value anywhere in a jacket.
 *
 * The scans below walk STRINGS rather than a JSON dump for two reasons: exact
 * decimals carry `bigint` units, which `JSON.stringify` refuses outright, and a
 * scan that stringified them would be scanning key names and punctuation as well as
 * content. What reaches a reader's eye is the string values, so those are what the
 * privacy and language scans read.
 */
function everyString(value: unknown, collected: string[] = []): string[] {
  if (typeof value === 'string') {
    collected.push(value)
    return collected
  }
  if (value === null || typeof value !== 'object') return collected
  for (const entry of Object.values(value as Record<string, unknown>)) {
    everyString(entry, collected)
  }
  return collected
}

/** The first jacket satisfying a predicate, or a failure that names what was missing. */
function find(
  description: string,
  predicate: (jacket: DealJacket) => boolean
): DealJacket {
  const jacket = EVERY_JACKET.find(predicate)
  if (jacket === undefined) {
    throw new Error(
      `no deal in the export is ${description}; the rendering rule for it is untestable`
    )
  }
  return jacket
}

/* ========================================================================== */
/* The population                                                             */
/* ========================================================================== */

describe('every finalized transaction has a jacket', () => {
  it('covers the whole governed deal population', () => {
    expect(EVERY_JACKET.length).toBe(650)
  })

  it('verifies the front-gross identity on every single deal', () => {
    const failures = EVERY_JACKET.filter(
      (jacket) => !jacket.frontGross.verification.verified
    )
    expect(failures.map((jacket) => jacket.identity.saleId)).toEqual([])
  })

  it('verifies the total-gross identity on every single deal', () => {
    const failures = EVERY_JACKET.filter(
      (jacket) => !jacket.totalGross.verification.verified
    )
    expect(failures.map((jacket) => jacket.identity.saleId)).toEqual([])
  })

  it('recomputes rather than restates: the displayed components add up to the result', () => {
    for (const jacket of EVERY_JACKET) {
      const lines = jacket.frontGross.lines
      const result = lines.at(-1)
      expect(result?.isResult).toBe(true)
      // sale price − acquisition − reconditioning − pack, from the DISPLAYED amounts.
      let running = lines[0]!.amount
      for (const line of lines.slice(1, -1)) {
        expect(line.operator).toBe('−')
        running = { units: running.units - line.amount.units, scale: 2 }
      }
      expect(exactToString(running)).toBe(exactToString(result!.amount))
    }
  })

  it('raises no check for review anywhere in the population', () => {
    const flagged = EVERY_JACKET.filter((jacket) => jacket.checksNeedingReview > 0)
    expect(flagged.map((jacket) => jacket.identity.saleId)).toEqual([])
  })

  it('runs the same five checks on every deal', () => {
    for (const jacket of EVERY_JACKET) {
      expect(jacket.checks.map((check) => check.id)).toEqual([
        'front-gross-identity',
        'total-gross-identity',
        'delivery-date-validity',
        'sale-to-inventory',
        'source-lineage',
      ])
    }
  })
})

/* ========================================================================== */
/* Lookup                                                                     */
/* ========================================================================== */

describe('the route parameter is validated before it is looked up', () => {
  it('accepts the business key shape and nothing else', () => {
    expect(isWellFormedSaleId('SLE-00000646')).toBe(true)
    for (const malformed of [
      '',
      'SLE-1',
      'SLE-000006460',
      'sle-00000646',
      'SLE-0000064x',
      '../../etc/passwd',
      'SLE-00000646/../SLE-00000001',
      "SLE-00000646' OR '1'='1",
      '<script>alert(1)</script>',
      '00000646',
    ]) {
      expect(isWellFormedSaleId(malformed), `${malformed} was accepted`).toBe(false)
    }
  })

  it('returns null for a well-formed id that names no deal', () => {
    expect(dealRow('SLE-99999999')).toBeUndefined()
    expect(buildDealJacket('SLE-99999999')).toBeNull()
  })

  it('returns null for a malformed id without consulting the index', () => {
    expect(buildDealJacket('../../secrets')).toBeNull()
    expect(buildDealJacket('SLE-abc')).toBeNull()
  })
})

/* ========================================================================== */
/* The test matrix: seven deal shapes, each rendering its own state            */
/* ========================================================================== */

describe('the seven deal shapes each render their own state', () => {
  it('a standard retail deal with a trade shows the trade beside the formula', () => {
    const jacket = find(
      'a retail deal with a trade and a linked lead',
      (candidate) =>
        candidate.identity.isRetail &&
        candidate.trade.kind === 'present' &&
        candidate.timeline.kind === 'linked'
    )
    expect(jacket.trade.kind).toBe('present')
    if (jacket.trade.kind !== 'present') throw new Error('unreachable')
    expect(jacket.trade.allowance).toMatch(/^\$/)
    expect(jacket.trade.acv).toMatch(/^\$/)
    expect(jacket.trade.variance).toMatch(/^-?\$/)
  })

  it('a deal with no trade says so rather than showing zeros', () => {
    const jacket = find(
      'a deal with no trade',
      (candidate) => candidate.trade.kind === 'absent'
    )
    render(<TradeSectionBlock trade={jacket.trade} />)
    expect(screen.getByText(/no trade/i)).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('a walk-in deal states that the absence of a lead is a real outcome', () => {
    const jacket = find(
      'a deal with no linked lead',
      (candidate) => candidate.timeline.kind === 'unlinked'
    )
    if (jacket.timeline.kind !== 'unlinked') throw new Error('unreachable')
    expect(jacket.timeline.statement).toMatch(/No linked lead/i)
    expect(jacket.timeline.statement).toMatch(/not missing data/i)
  })

  it('a negative front gross is shown as negative rather than clamped or hidden', () => {
    const jacket = find(
      'a deal with a negative front-end gross',
      (candidate) => (candidate.frontGross.lines.at(-1)?.amount.units ?? 0n) < 0n
    )
    const result = jacket.frontGross.lines.at(-1)!
    expect(result.display.startsWith('-$')).toBe(true)
    expect(jacket.frontGross.verification.verified).toBe(true)
  })

  it('a cash deal reports no lender because none exists, not because one is hidden', () => {
    const jacket = find(
      'a cash deal',
      (candidate) => candidate.identity.financeStructure === 'Cash'
    )
    expect(jacket.finance.basis).toBe('nothing was financed')
    expect(jacket.finance.amountFinanced).toBe('$0.00')
    const lender = jacket.finance.notModelled.find((entry) =>
      entry.label.startsWith('Lender')
    )
    expect(lender?.reason).toMatch(/Not applicable/)
  })

  it('a financed deal distinguishes "not modelled" from "not applicable"', () => {
    const jacket = find(
      'a retail finance deal',
      (candidate) => candidate.identity.financeStructure === 'Retail Finance'
    )
    expect(jacket.finance.basis).toBe('an amount was financed')
    const lender = jacket.finance.notModelled.find((entry) =>
      entry.label.startsWith('Lender')
    )
    expect(lender?.reason).toMatch(/Not modelled/)
  })

  it('a lease is labelled a lease and derives it from the sale type', () => {
    const jacket = find(
      'a lease',
      (candidate) => candidate.identity.financeStructure === 'Lease'
    )
    expect(jacket.identity.saleType).toBe('Lease')
    expect(jacket.finance.basis).toBe('sale type is Lease')
  })

  it('a wholesale deal has no finance manager, and that is Not applicable', () => {
    const jacket = find('a non-retail deal', (candidate) => !candidate.identity.isRetail)
    const financeManager = jacket.staff.find(
      (member) => member.role === 'Finance manager'
    )
    expect(financeManager?.code).toBeNull()
    expect(financeManager?.absence).toBe('not-applicable')
  })
})

/* ========================================================================== */
/* Trade variance stays outside the formula                                    */
/* ========================================================================== */

describe('trade variance is published beside the front gross, never inside it', () => {
  it('names only the four ARPI cost components in the calculation', () => {
    for (const jacket of EVERY_JACKET) {
      expect(jacket.frontGross.lines.map((line) => line.label)).toEqual([
        'Sale price',
        'Acquisition cost',
        'Reconditioning cost',
        'Pack amount',
        'Front-end gross',
      ])
    }
  })

  it('leaves the identity verified on deals whose trade variance is large', () => {
    const withVariance = EVERY_JACKET.filter(
      (jacket) => jacket.trade.kind === 'present' && jacket.trade.variance !== '$0.00'
    )
    expect(withVariance.length).toBeGreaterThan(0)
    for (const jacket of withVariance) {
      expect(jacket.frontGross.verification.verified).toBe(true)
    }
  })

  it('renders the trade section with its own explanation of why it is separate', () => {
    const jacket = find(
      'a deal with a trade',
      (candidate) => candidate.trade.kind === 'present'
    )
    const { container } = render(<TradeSectionBlock trade={jacket.trade} />)
    // The sentence is split across a <strong>, so it is read from the rendered text
    // rather than matched against a single text node.
    const prose = container.textContent ?? ''
    expect(prose).toMatch(/deliberately\s*not\s*part of the front-gross formula/i)
    expect(prose).toMatch(/allowance less actual cash value/i)
  })
})

/* ========================================================================== */
/* Absence has four words, and a zero is a zero                                */
/* ========================================================================== */

describe('absence is stated, never zeroed and never blank', () => {
  it('renders "Not applicable" for a unit that structurally has no MSRP', () => {
    const jacket = find(
      'a unit with no MSRP',
      (candidate) => candidate.vehicle.msrp === null
    )
    const msrpDiscount = jacket.frontGross.discounts.find((line) =>
      line.label.includes('MSRP')
    )
    expect(msrpDiscount?.display).toBeNull()
    expect(msrpDiscount?.note).toMatch(/Not applicable/)
  })

  it('distinguishes an unattributed role from a role the deal cannot have', () => {
    const unattributed = EVERY_JACKET.flatMap((jacket) => jacket.staff).filter(
      (member) => member.absence === 'unattributed'
    )
    const notApplicable = EVERY_JACKET.flatMap((jacket) => jacket.staff).filter(
      (member) => member.absence === 'not-applicable'
    )
    expect(unattributed.length).toBeGreaterThan(0)
    expect(notApplicable.length).toBeGreaterThan(0)
  })

  it('renders each absence word rather than an empty cell', () => {
    const jacket = find('a deal with an unattributed role', (candidate) =>
      candidate.staff.some((member) => member.absence === 'unattributed')
    )
    const { container } = render(<StaffSection staff={jacket.staff} />)
    // The word appears twice on purpose: once as the value, once where the section
    // explains what it means. Both are wanted, so the assertion counts rather than
    // demanding uniqueness.
    expect(screen.getAllByText(/Unattributed/i).length).toBeGreaterThanOrEqual(2)
    const values = [...container.querySelectorAll('dd')].map(
      (node) => node.textContent ?? ''
    )
    expect(values.some((value) => value.trim() === 'Unattributed')).toBe(true)
    expect(values.every((value) => value.trim() !== '')).toBe(true)
  })

  it('keeps a real zero as a real zero', () => {
    const cashDeals = EVERY_JACKET.filter(
      (jacket) => jacket.identity.financeStructure === 'Cash'
    )
    expect(cashDeals.length).toBeGreaterThan(0)
    // Nothing was financed. That is a measured zero, not an absence, and it is shown.
    for (const jacket of cashDeals) expect(jacket.finance.amountFinanced).toBe('$0.00')
  })

  it('shows a walk-in timeline as a statement rather than an empty list', () => {
    const jacket = find(
      'a walk-in deal',
      (candidate) => candidate.timeline.kind === 'unlinked'
    )
    render(<TimelineSectionBlock timeline={jacket.timeline} />)
    expect(screen.getByText(/No linked lead/i)).toBeInTheDocument()
  })
})

/* ========================================================================== */
/* Privacy                                                                     */
/* ========================================================================== */

describe('nothing a customer would recognise as theirs reaches the page', () => {
  /** Shapes that would betray a real person if one ever reached this lane. */
  const FORBIDDEN_SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] =
    [
      { name: 'an email address', pattern: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i },
      {
        name: 'a telephone number',
        pattern: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/,
      },
      { name: 'a social security number', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
      { name: 'a payment card number', pattern: /\b(?:\d[ -]?){13,16}\b/ },
      {
        name: 'a street address',
        pattern:
          /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr)\b/,
      },
    ]

  it('publishes no value shaped like a personal identifier, on any of the 650 deals', () => {
    // The offenders are collected and asserted ONCE. Half a million `expect` calls
    // would say the same thing and would take longer than the test timeout allows,
    // which is a slow test rather than a strict one.
    const offenders = EVERY_JACKET.flatMap((jacket) =>
      everyString(jacket).flatMap((value) =>
        FORBIDDEN_SHAPES.filter((shape) => shape.pattern.test(value)).map(
          (shape) =>
            `${jacket.identity.saleId}: ${JSON.stringify(value)} is shaped like ${shape.name}`
        )
      )
    )
    expect(offenders).toEqual([])
  })

  it('identifies every person by a synthetic code and a role, never by a name', () => {
    const offShape = EVERY_JACKET.flatMap((jacket) =>
      jacket.staff
        .filter((member) => member.code !== null && !/^EMP-\d+$/.test(member.code))
        .map(
          (member) => `${jacket.identity.saleId} ${member.role}: ${String(member.code)}`
        )
    )
    expect(offShape).toEqual([])
  })

  it('carries no customer attribute at all, under any key', () => {
    const keys = new Set<string>()
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry)
        return
      }
      for (const [key, entry] of Object.entries(value)) {
        keys.add(key.toLowerCase())
        walk(entry)
      }
    }
    walk(EVERY_JACKET[0])
    for (const forbidden of [
      'customer',
      'customerid',
      'customername',
      'firstname',
      'lastname',
      'email',
      'phone',
      'address',
      'postalcode',
      'dateofbirth',
      'ssn',
      'creditscore',
      'lender',
      'apr',
      'term',
      'payment',
    ]) {
      expect(keys.has(forbidden), `the jacket exposes a "${forbidden}" key`).toBe(false)
    }
  })

  it('states the odometer as a band and never as a reading', () => {
    const readings = EVERY_JACKET.filter((jacket) =>
      /^\d+$/.test(jacket.vehicle.odometerBand)
    )
    expect(readings.map((jacket) => jacket.identity.saleId)).toEqual([])
  })

  it('publishes the synthetic vehicle identifier in its ADR-0005 shape', () => {
    const offPolicy = EVERY_JACKET.filter(
      (jacket) =>
        !/^ARPI[ABCDEFGHJKLMNPRSTUVWXYZ0-9]{13}$/.test(jacket.vehicle.syntheticVin)
    )
    expect(offPolicy.map((jacket) => jacket.vehicle.syntheticVin)).toEqual([])
  })
})

/* ========================================================================== */
/* Lineage                                                                     */
/* ========================================================================== */

describe('every jacket says where its figures came from', () => {
  it('names the source view, the dataset version and the contract fingerprint', () => {
    const jacket = EVERY_JACKET[0]!
    // Resolved FROM the manifest rather than typed into the module: the console names
    // no database object in its own source, and a lineage statement that could drift
    // from what the exporter actually read would be worse than none.
    expect(jacket.lineage.sourceView).toBe('reporting.vw_deal_jacket')
    expect(dashboardManifest.sourceViews).toContain(jacket.lineage.sourceView)
    expect(jacket.lineage.datasetName).toBe('deal-jacket')
    expect(jacket.lineage.datasetVersion).toBeGreaterThan(0)
    expect(jacket.lineage.contractFingerprint).toMatch(/^[0-9a-f]{12}$/)
    expect(jacket.lineage.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('states what the front-end gross excludes, on the page rather than in a doc', () => {
    const limitations = EVERY_JACKET[0]!.lineage.limitations.join(' ')
    expect(limitations).toMatch(/holdback/i)
    expect(limitations).toMatch(/back-end gross is aggregate/i)
    expect(limitations).toMatch(/Synthetic data/i)
  })

  it('makes no causal claim anywhere in the rendered content', () => {
    const prose = EVERY_JACKET.flatMap((jacket) => everyString(jacket)).map((value) =>
      value.toLowerCase()
    )
    for (const phrase of [
      'caused',
      'because of',
      'drove the',
      'led to the',
      'responsible for',
      'thanks to',
      'as a result of',
    ]) {
      const offending = prose.find((value) => value.includes(phrase))
      expect(offending, `a jacket claims causation: "${offending ?? ''}"`).toBeUndefined()
    }
  })
})

/* ========================================================================== */
/* THE CORRUPTED FIXTURES                                                      */
/* ========================================================================== */

/**
 * The seeded-defect block.
 *
 * Each test rebuilds `deal-jacket.ts` against a partition table whose first deal has
 * been mutated by ONE CENT, and requires the page's verification to report the
 * failure in words. These fixtures exist only here: nothing in `data/dashboard/` or
 * `src/generated/` is touched, and the module registry is reset afterwards so the
 * rest of the suite sees the real export.
 *
 * Without this block, a `verify()` that returned `true` unconditionally would pass
 * every other test in this file.
 */
describe('a corrupted export surfaces as a visible verification failure', () => {
  /** Return the real partitions with one cent added to `column` on the first row. */
  async function corruptedChunks(
    column: string
  ): Promise<readonly DashboardDatasetFile[]> {
    const real = await import('../../src/lib/dashboard/jacket-chunks.ts')
    // Deep-copied into MUTABLE shapes. The published type is deeply readonly, which is
    // right for the real partitions and is exactly what a fixture has to escape.
    const files = real.allJacketChunks().map((file) => ({
      ...file,
      columns: [...file.columns],
      rows: file.rows.map((row) => [...row]) as DashboardCell[][],
    }))

    const first = files[0]!
    const position = first.columns.indexOf(column)
    if (position < 0) throw new Error(`the export has no ${column} column to corrupt`)
    const target = first.rows[0]!
    const mutated = addExact(parseExact(String(target[position])), parseExact('0.01'))
    target[position] = exactToString(mutated)
    return files as unknown as readonly DashboardDatasetFile[]
  }

  /** Build the first deal of a corrupted partition table. */
  async function jacketFromCorrupted(column: string): Promise<DealJacket> {
    const files = await corruptedChunks(column)
    vi.doMock('../../src/lib/dashboard/jacket-chunks.ts', () => ({
      allJacketChunks: () => files,
      jacketChunkKeys: () => [],
      jacketChunkFile: () => undefined,
      jacketChunkKey: (dealershipId: string, month: string) => `${dealershipId}/${month}`,
    }))
    const rebuilt = await import('../../src/lib/dashboard/deal-jacket.ts')
    const saleIdPosition = files[0]!.columns.indexOf('sale_id')
    const saleId = String(files[0]!.rows[0]![saleIdPosition])
    const jacket = rebuilt.buildDealJacket(saleId)
    if (jacket === null) throw new Error(`the corrupted fixture did not build ${saleId}`)
    return jacket
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('../../src/lib/dashboard/jacket-chunks.ts')
    vi.resetModules()
  })

  it('reports a one-cent front-gross discrepancy as a failure, with both figures', async () => {
    const jacket = await jacketFromCorrupted('front_end_gross')
    expect(jacket.frontGross.verification.verified).toBe(false)
    expect(jacket.frontGross.verification.statement).toMatch(/Verification FAILED/)
    expect(jacket.frontGross.verification.statement).toMatch(
      /defect, not a rounding artefact/
    )
    expect(jacket.frontGross.verification.recomputed).not.toBe(
      jacket.frontGross.verification.published
    )
  })

  it('raises the front-gross check for review rather than passing it', async () => {
    const jacket = await jacketFromCorrupted('front_end_gross')
    const check = jacket.checks.find((entry) => entry.id === 'front-gross-identity')
    expect(check?.state).toBe('review')
    expect(jacket.checksNeedingReview).toBeGreaterThan(0)
  })

  it('reports a one-cent total-gross discrepancy as a failure', async () => {
    const jacket = await jacketFromCorrupted('total_gross')
    expect(jacket.totalGross.verification.verified).toBe(false)
    const check = jacket.checks.find((entry) => entry.id === 'total-gross-identity')
    expect(check?.state).toBe('review')
  })

  it('renders the failure in words, not in colour alone', async () => {
    const jacket = await jacketFromCorrupted('front_end_gross')
    render(<FrontGrossSection jacket={jacket} />)
    expect(screen.getByText(/Verification failed\./)).toBeInTheDocument()
  })

  it('still shows the figures as exported rather than hiding a broken deal', async () => {
    const jacket = await jacketFromCorrupted('front_end_gross')
    render(<FrontGrossSection jacket={jacket} />)
    expect(screen.getByText(jacket.frontGross.lines.at(-1)!.display)).toBeInTheDocument()
  })

  it('surfaces the failed check in the checklist with a count needing review', async () => {
    const jacket = await jacketFromCorrupted('total_gross')
    const { container } = render(
      <ChecksSection checks={jacket.checks} needingReview={jacket.checksNeedingReview} />
    )
    expect(screen.getByText(/Total-gross identity/)).toBeInTheDocument()
    // The failed check is marked in a word, and the section states how many need
    // review. Both are asserted from the rendered text: `review` legitimately appears
    // in more than one node, so a unique-node query would fail on a correct render.
    const prose = container.textContent ?? ''
    expect(prose).toMatch(/\breview\b/i)
    expect(prose).toMatch(new RegExp(`${String(jacket.checksNeedingReview)} check`))
  })

  it('leaves the real export verified once the fixture is unmocked', async () => {
    vi.resetModules()
    const rebuilt = await import('../../src/lib/dashboard/deal-jacket.ts')
    const saleId = rebuilt.allSaleIds()[0]!
    const jacket = rebuilt.buildDealJacket(saleId)
    expect(jacket?.frontGross.verification.verified).toBe(true)
    expect(jacket?.totalGross.verification.verified).toBe(true)
  })
})

/* ========================================================================== */
/* Component markup                                                            */
/* ========================================================================== */

describe('the calculation blocks are semantic rather than positioned', () => {
  it('renders the front-gross block as a description list with an accessible name', () => {
    const jacket = EVERY_JACKET[0]!
    const { container } = render(<FrontGrossSection jacket={jacket} />)
    const list = container.querySelector('dl[aria-label]')
    expect(list).not.toBeNull()
    expect(list?.querySelectorAll('dt').length).toBe(jacket.frontGross.lines.length)
    expect(list?.querySelectorAll('dd').length).toBe(jacket.frontGross.lines.length)
  })

  it('marks the calculation blocks for print rather than relying on their position', () => {
    const jacket = EVERY_JACKET[0]!
    const { container } = render(<TotalGrossSection jacket={jacket} />)
    expect(container.querySelector('[data-arpi-print="calculation"]')).not.toBeNull()
  })

  it('pairs every operator with its own line and hides it from assistive technology', () => {
    const jacket = EVERY_JACKET[0]!
    const { container } = render(<FrontGrossSection jacket={jacket} />)
    const operators = container.querySelectorAll('dt span[aria-hidden="true"]')
    expect(operators.length).toBe(jacket.frontGross.lines.length)
  })
})
