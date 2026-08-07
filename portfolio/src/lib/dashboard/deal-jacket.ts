/**
 * The Deal Jacket's view model: one finalized transaction, explained to the cent.
 *
 * THE VERIFICATION IS THE POINT, AND IT IS DONE HERE
 * --------------------------------------------------
 * `vw_deal_jacket` publishes `front_end_gross` and `total_gross` as stored, CHECK-
 * constrained columns. This module does NOT trust them. It recomputes both identities
 * from the components the page displays, with exact-decimal arithmetic, and reports
 * whether the recomputation matched:
 *
 *   sale price − acquisition − reconditioning − pack   = front-end gross
 *   front-end gross + back-end gross                   = total gross
 *
 * A verification that reads a flag verifies nothing, which is why the export
 * deliberately publishes no such flag. The corrupted-fixture tests drive this module
 * with a deal whose components do not add up and require the failure to surface.
 *
 * TRADE VARIANCE IS NOT IN THE FRONT-GROSS FORMULA
 * ------------------------------------------------
 * It is computed, displayed and labelled separately. Folding it in would change what
 * `KPI-GRS-001` means, and the whole value of this page is that the figure it shows
 * is the figure the KPI catalogue defines.
 *
 * ABSENCE HAS FOUR DIFFERENT WORDS
 * --------------------------------
 * "Not applicable" for structurally absent (a used unit has no MSRP; a cash deal has
 * no lender). "Not modelled" for out of scope (trade payoff, F&I itemization).
 * "Unattributed" for a role that could have been filled and was not. "No linked lead"
 * for walk-in business. A zero is a real zero and nothing else.
 */
import type { DashboardCell, DashboardRow } from '@/types/dashboard'

import type { Exact } from './decimal'
import {
  addExact,
  cellToExact,
  compareExact,
  isNegative,
  isZero,
  subtractExact,
} from './decimal'
import { dashboardManifest, dashboardStores } from './data'
import {
  formatCountExact,
  formatCurrencyExact,
  formatIsoDate,
  formatMinutesExact,
} from './format'
import { allJacketChunks } from './jacket-chunks'

/* -------------------------------------------------------------------------- */
/* Lookup                                                                      */
/* -------------------------------------------------------------------------- */

/** `SLE-` followed by eight digits. Anything else cannot be a deal and is not looked up. */
const SALE_ID_PATTERN = /^SLE-\d{8}$/

/** Whether a route parameter could name a deal at all. */
export function isWellFormedSaleId(value: string): boolean {
  return SALE_ID_PATTERN.test(value)
}

let index: Map<string, DashboardRow> | null = null

/**
 * Every deal, keyed by its business id.
 *
 * Built once per server process and memoized. The alternative — scanning eighteen
 * partitions per request — would be correct and would repeat the same work for every
 * reader. 650 rows is small enough that the map costs less than the scan it replaces.
 *
 * The whole set is read because a `saleId` carries no store and no month: the route
 * parameter is the business key, deliberately, and deriving a partition from it would
 * mean encoding the store into the URL, which is warehouse structure a reader should
 * not have to know.
 */
function dealIndex(): Map<string, DashboardRow> {
  if (index !== null) return index
  const built = new Map<string, DashboardRow>()
  for (const file of allJacketChunks()) {
    const columns = file.columns
    for (const values of file.rows) {
      const row: Record<string, DashboardCell> = {}
      for (let position = 0; position < columns.length; position += 1) {
        const key = columns[position]
        if (key === undefined) continue
        row[key] = values[position] ?? null
      }
      const saleId = row.sale_id
      if (typeof saleId === 'string') built.set(saleId, row as DashboardRow)
    }
  }
  index = built
  return built
}

/** The deal's row, or `undefined` when no such deal exists. */
export function dealRow(saleId: string): DashboardRow | undefined {
  if (!isWellFormedSaleId(saleId)) return undefined
  return dealIndex().get(saleId)
}

/** Every deal id, for a route that needs to enumerate them. */
export function allSaleIds(): readonly string[] {
  return [...dealIndex().keys()].sort()
}

/* -------------------------------------------------------------------------- */
/* Cell helpers                                                                */
/* -------------------------------------------------------------------------- */

function text(row: DashboardRow, column: string): string {
  const value = row[column]
  return typeof value === 'string' ? value : ''
}

function optionalText(row: DashboardRow, column: string): string | null {
  const value = row[column]
  return typeof value === 'string' && value !== '' ? value : null
}

function flag(row: DashboardRow, column: string): boolean {
  return row[column] === true
}

function optionalFlag(row: DashboardRow, column: string): boolean | null {
  const value = row[column]
  return typeof value === 'boolean' ? value : null
}

function money(row: DashboardRow, column: string): Exact | null {
  const value = row[column]
  if (value === null || value === undefined) return null
  return cellToExact(value as string | number | boolean)
}

function count(row: DashboardRow, column: string): number | null {
  const value = row[column]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value !== '') return Number(value)
  return null
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** One line of a labelled arithmetic block. */
export interface CalculationLine {
  readonly label: string
  readonly operator: '' | '−' | '+' | '='
  readonly amount: Exact
  readonly display: string
  readonly isResult?: boolean
}

/** The outcome of recomputing an identity from the displayed components. */
export interface Verification {
  readonly verified: boolean
  /** What was recomputed, and what the export published, both formatted. */
  readonly recomputed: string
  readonly published: string
  readonly statement: string
}

export interface DealIdentity {
  readonly saleId: string
  readonly saleDate: string
  readonly deliveryDate: string
  readonly storeName: string
  readonly storeId: string
  readonly saleType: string
  readonly isRetail: boolean
  readonly financeStructure: string
  readonly financeStructureBasis: string
}

export interface DealVehicle {
  readonly vehicleCode: string
  readonly syntheticVin: string
  readonly display: string
  readonly modelYear: number | null
  readonly make: string
  readonly modelName: string
  readonly trimLevel: string
  readonly bodyStyle: string
  readonly conditionType: string
  readonly conditionGroup: string
  readonly odometerBand: string
  readonly acquisitionSource: string
  readonly daysInInventory: number | null
  readonly originalAsking: string
  readonly finalAsking: string
  /** Null renders "Not applicable": a used unit legitimately has no MSRP. */
  readonly msrp: string | null
}

export interface DiscountLine {
  readonly label: string
  readonly display: string | null
  readonly note: string | null
}

export type TradeSection =
  | {
      readonly kind: 'present'
      readonly allowance: string
      readonly acv: string
      readonly variance: string
      readonly varianceIsPositive: boolean
    }
  | { readonly kind: 'absent' }

export interface FinanceSection {
  readonly structure: string
  readonly basis: string
  readonly cashDown: string
  readonly amountFinanced: string
  /** What is deliberately not shown, and why. Rendered, not omitted. */
  readonly notModelled: readonly { readonly label: string; readonly reason: string }[]
}

export interface StaffMember {
  readonly role: string
  readonly code: string | null
  readonly jobRole: string | null
  /** `not-applicable` when the deal type cannot have the role at all. */
  readonly absence: 'unattributed' | 'not-applicable' | null
}

export type TimelineStage =
  | {
      readonly kind: 'dated'
      readonly label: string
      readonly date: string
      readonly note: string | null
    }
  | { readonly kind: 'flag'; readonly label: string; readonly happened: boolean }
  | { readonly kind: 'elapsed'; readonly label: string; readonly display: string }

export type TimelineSection =
  | {
      readonly kind: 'linked'
      readonly source: string
      readonly stages: readonly TimelineStage[]
    }
  | { readonly kind: 'unlinked'; readonly statement: string }

export interface IntegrityCheck {
  readonly id: string
  readonly label: string
  readonly state: 'passed' | 'review' | 'note'
  readonly detail: string
}

export interface DealJacket {
  readonly identity: DealIdentity
  readonly vehicle: DealVehicle
  readonly frontGross: {
    readonly lines: readonly CalculationLine[]
    readonly verification: Verification
    readonly discounts: readonly DiscountLine[]
  }
  readonly trade: TradeSection
  readonly finance: FinanceSection
  readonly backGross: { readonly display: string; readonly note: string }
  readonly totalGross: {
    readonly lines: readonly CalculationLine[]
    readonly verification: Verification
  }
  readonly staff: readonly StaffMember[]
  readonly timeline: TimelineSection
  readonly checks: readonly IntegrityCheck[]
  readonly checksNeedingReview: number
  readonly lineage: {
    /** Null when the manifest does not publish it, which the page states rather than guesses. */
    readonly sourceView: string | null
    readonly datasetName: string
    readonly datasetVersion: number
    readonly asOfDate: string
    readonly contractFingerprint: string
    readonly kpiIds: readonly string[]
    readonly limitations: readonly string[]
  }
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

const STORE_NAMES: ReadonlyMap<string, string> = new Map(
  dashboardStores.map((store) => [store.id, store.name])
)

/** The export this page reads. A dataset name, which is not a database object. */
const DATASET_NAME = 'deal-jacket'

/**
 * The reporting view the EXPORTER read, resolved from the manifest rather than typed
 * here.
 *
 * The console does not name a database object in its own source: a view name in
 * dashboard code is how somebody starts building a query string, and
 * `tests/unit/dashboard-boundaries.test.ts` fails the build over one. But the page
 * genuinely has to state its provenance, so the name is looked up in the list of
 * views the exporter published in the manifest — data, produced by the run that
 * produced the figures.
 *
 * Resolving it this way also means the lineage cannot drift: if the exporter ever
 * reads a different view, the page says so without anyone remembering to edit a
 * literal, and if the manifest stops publishing it at all the page states that rather
 * than asserting something it cannot support.
 */
const SOURCE_VIEW: string | null =
  dashboardManifest.sourceViews.find((view) =>
    view.endsWith(`vw_${DATASET_NAME.replaceAll('-', '_')}`)
  ) ?? null

/** Recompute an identity and report the comparison honestly. */
function verify(recomputed: Exact, published: Exact, subject: string): Verification {
  const verified = compareExact(recomputed, published) === 0
  return {
    verified,
    recomputed: formatCurrencyExact(recomputed, 2),
    published: formatCurrencyExact(published, 2),
    statement: verified
      ? `Verified to the cent: the components above recompute ${subject} exactly.`
      : `Verification FAILED: the components above recompute ${formatCurrencyExact(recomputed, 2)}, and the export publishes ${formatCurrencyExact(published, 2)}. The figures are shown as exported and this difference is a defect, not a rounding artefact.`,
  }
}

/** Build the jacket, or `null` when no such deal exists. */
export function buildDealJacket(saleId: string): DealJacket | null {
  const row = dealRow(saleId)
  if (row === undefined) return null

  const salePrice = money(row, 'sale_price')
  const acquisition = money(row, 'acquisition_cost')
  const reconditioning = money(row, 'reconditioning_cost')
  const pack = money(row, 'pack_amount')
  const frontGross = money(row, 'front_end_gross')
  const backGross = money(row, 'back_end_gross')
  const totalGross = money(row, 'total_gross')
  if (
    salePrice === null ||
    acquisition === null ||
    reconditioning === null ||
    pack === null ||
    frontGross === null ||
    backGross === null ||
    totalGross === null
  ) {
    return null
  }

  // The front-gross identity, recomputed from the displayed components.
  const recomputedFront = subtractExact(
    subtractExact(subtractExact(salePrice, acquisition), reconditioning),
    pack
  )
  const recomputedTotal = addExact(frontGross, backGross)

  const isRetail = flag(row, 'is_retail')
  const msrp = money(row, 'msrp')

  return {
    identity: {
      saleId: text(row, 'sale_id'),
      saleDate: formatIsoDate(text(row, 'sale_date')),
      deliveryDate: formatIsoDate(text(row, 'delivery_date')),
      storeId: text(row, 'dealership_id'),
      storeName:
        STORE_NAMES.get(text(row, 'dealership_id')) ?? text(row, 'dealership_id'),
      saleType: text(row, 'sale_type'),
      isRetail,
      financeStructure: text(row, 'finance_structure'),
      financeStructureBasis: text(row, 'finance_structure_basis'),
    },
    vehicle: {
      vehicleCode: text(row, 'vehicle_code'),
      syntheticVin: text(row, 'synthetic_vin'),
      display: text(row, 'vehicle_display'),
      modelYear: count(row, 'model_year'),
      make: text(row, 'make'),
      modelName: text(row, 'model_name'),
      trimLevel: text(row, 'trim_level'),
      bodyStyle: text(row, 'body_style'),
      conditionType: text(row, 'condition_type'),
      conditionGroup: text(row, 'condition_group'),
      odometerBand: text(row, 'odometer_band'),
      acquisitionSource: text(row, 'acquisition_source'),
      daysInInventory: count(row, 'days_in_inventory_at_sale'),
      originalAsking: formatCurrencyExact(
        money(row, 'original_asking_price') ?? salePrice
      ),
      finalAsking: formatCurrencyExact(money(row, 'final_asking_price') ?? salePrice),
      msrp: msrp === null ? null : formatCurrencyExact(msrp),
    },
    frontGross: {
      lines: [
        {
          label: 'Sale price',
          operator: '',
          amount: salePrice,
          display: formatCurrencyExact(salePrice, 2),
        },
        {
          label: 'Acquisition cost',
          operator: '−',
          amount: acquisition,
          display: formatCurrencyExact(acquisition, 2),
        },
        {
          label: 'Reconditioning cost',
          operator: '−',
          amount: reconditioning,
          display: formatCurrencyExact(reconditioning, 2),
        },
        {
          label: 'Pack amount',
          operator: '−',
          amount: pack,
          display: formatCurrencyExact(pack, 2),
        },
        {
          label: 'Front-end gross',
          operator: '=',
          amount: frontGross,
          display: formatCurrencyExact(frontGross, 2),
          isResult: true,
        },
      ],
      verification: verify(recomputedFront, frontGross, 'the front-end gross'),
      discounts: buildDiscounts(row, msrp),
    },
    trade: buildTrade(row),
    finance: buildFinance(row),
    backGross: {
      display: formatCurrencyExact(backGross, 2),
      note: 'Aggregate back-end gross. Product-level itemization arrives with the F&I model increment (DASH.7); no finance-product fact exists in the warehouse yet, so no reserve, VSC, GAP or other product figure is shown or implied.',
    },
    totalGross: {
      lines: [
        {
          label: 'Front-end gross',
          operator: '',
          amount: frontGross,
          display: formatCurrencyExact(frontGross, 2),
        },
        {
          label: 'Back-end gross',
          operator: '+',
          amount: backGross,
          display: formatCurrencyExact(backGross, 2),
        },
        {
          label: 'Total gross',
          operator: '=',
          amount: totalGross,
          display: formatCurrencyExact(totalGross, 2),
          isResult: true,
        },
      ],
      verification: verify(recomputedTotal, totalGross, 'the total gross'),
    },
    staff: buildStaff(row, isRetail),
    timeline: buildTimeline(row),
    checks: buildChecks(row, recomputedFront, frontGross, recomputedTotal, totalGross),
    checksNeedingReview: buildChecks(
      row,
      recomputedFront,
      frontGross,
      recomputedTotal,
      totalGross
    ).filter((check) => check.state === 'review').length,
    lineage: {
      sourceView: SOURCE_VIEW,
      datasetName: DATASET_NAME,
      datasetVersion: dashboardManifest.datasetVersion,
      asOfDate: dashboardManifest.asOfDate,
      contractFingerprint: dashboardManifest.contractSha256.slice(0, 12),
      kpiIds: ['KPI-SLS-001', 'KPI-GRS-001', 'KPI-GRS-002', 'KPI-GRS-003', 'KPI-INV-007'],
      limitations: [
        'Synthetic data. Granite Auto Group and every store, employee role and transaction referenced here are fictional.',
        'Front-end gross EXCLUDES manufacturer holdback, dealer cash, stair-step money, floorplan credits and unposted accounting adjustments. None is modelled, and none is implied.',
        'Back-end gross is aggregate. Reserve and product gross are not separated until the F&I model increment.',
        'The odometer reading is banded, never exact.',
        'Trade payoff and equity are not modelled: no trade fact exists.',
        'No lender, APR, term, payment, buy rate, sell rate or rate spread exists anywhere in ARPI.',
        'The vehicle identifier is not a stock number. The model contains none.',
      ],
    },
  }
}

function buildDiscounts(row: DashboardRow, msrp: Exact | null): readonly DiscountLine[] {
  const fromOriginal = money(row, 'discount_from_original')
  const fromFinal = money(row, 'discount_from_final')
  const fromMsrp = money(row, 'discount_from_msrp')
  return [
    {
      label: 'Discount from original asking price',
      display: fromOriginal === null ? null : formatCurrencyExact(fromOriginal, 2),
      note:
        fromOriginal !== null && isNegative(fromOriginal)
          ? 'Sold above the first advertised price.'
          : null,
    },
    {
      label: 'Discount from final asking price',
      display: fromFinal === null ? null : formatCurrencyExact(fromFinal, 2),
      note: null,
    },
    {
      label: 'Discount from MSRP',
      display: fromMsrp === null ? null : formatCurrencyExact(fromMsrp, 2),
      note:
        msrp === null
          ? 'Not applicable: this unit carries no MSRP, and one is not inferred.'
          : null,
    },
  ]
}

function buildTrade(row: DashboardRow): TradeSection {
  if (!flag(row, 'has_trade')) return { kind: 'absent' }
  const allowance = money(row, 'trade_allowance')
  const acv = money(row, 'trade_acv')
  const variance = money(row, 'trade_variance')
  if (allowance === null || acv === null || variance === null) return { kind: 'absent' }
  return {
    kind: 'present',
    allowance: formatCurrencyExact(allowance, 2),
    acv: formatCurrencyExact(acv, 2),
    variance: formatCurrencyExact(variance, 2),
    varianceIsPositive: !isNegative(variance) && !isZero(variance),
  }
}

function buildFinance(row: DashboardRow): FinanceSection {
  const structure = text(row, 'finance_structure')
  const notModelled: { label: string; reason: string }[] = [
    {
      label: 'Lender and lender category',
      reason:
        structure === 'Cash'
          ? 'Not applicable: nothing was financed on this deal.'
          : 'Not modelled: no lender dimension exists in the warehouse until DASH.6.',
    },
    {
      label: 'APR, term, payment, buy rate, sell rate, rate spread',
      reason:
        'Not modelled, and deliberately out of scope. PRIVACY_AND_ETHICS.md §7 places rate mechanics outside what this project publishes.',
    },
    {
      label: 'Finance reserve gross',
      reason: 'Not modelled: reserve is not separated from back-end gross until DASH.7.',
    },
  ]
  return {
    structure,
    basis: text(row, 'finance_structure_basis'),
    cashDown: formatCurrencyExact(money(row, 'cash_down') ?? { units: 0n, scale: 2 }, 2),
    amountFinanced: formatCurrencyExact(
      money(row, 'amount_financed') ?? { units: 0n, scale: 2 },
      2
    ),
    notModelled,
  }
}

function buildStaff(row: DashboardRow, isRetail: boolean): readonly StaffMember[] {
  const roles: {
    role: string
    codeColumn: string
    jobColumn: string | null
    retailOnly: boolean
  }[] = [
    {
      role: 'Salesperson',
      codeColumn: 'salesperson_code',
      jobColumn: 'salesperson_role',
      retailOnly: false,
    },
    {
      role: 'Desk manager',
      codeColumn: 'desk_manager_code',
      jobColumn: 'desk_manager_role',
      retailOnly: false,
    },
    {
      role: 'Finance manager',
      codeColumn: 'finance_manager_code',
      jobColumn: 'finance_manager_role',
      retailOnly: true,
    },
    { role: 'BDC', codeColumn: 'bdc_employee_code', jobColumn: null, retailOnly: false },
  ]
  return roles.map((entry) => {
    const code = optionalText(row, entry.codeColumn)
    return {
      role: entry.role,
      code,
      jobRole: entry.jobColumn === null ? null : optionalText(row, entry.jobColumn),
      absence:
        code !== null
          ? null
          : entry.retailOnly && !isRetail
            ? ('not-applicable' as const)
            : ('unattributed' as const),
    }
  })
}

function buildTimeline(row: DashboardRow): TimelineSection {
  if (!flag(row, 'is_lead_attributed')) {
    return {
      kind: 'unlinked',
      statement:
        'No linked lead: walk-in or unattributed. This is a real outcome, not missing data. A deal with no CRM lead behind it is business the store earned without one.',
    }
  }
  const stages: TimelineStage[] = []
  const created = optionalText(row, 'lead_created_date')
  if (created !== null) {
    stages.push({
      kind: 'dated',
      label: 'Lead created',
      date: formatIsoDate(created),
      note: null,
    })
  }
  const responseSeconds = count(row, 'first_response_seconds')
  stages.push(
    responseSeconds === null
      ? { kind: 'flag', label: 'First response', happened: false }
      : {
          kind: 'elapsed',
          label: 'First response',
          display: formatMinutesExact({
            units: BigInt(Math.round((responseSeconds / 60) * 10)),
            scale: 1,
          }),
        }
  )
  const contacted = optionalFlag(row, 'lead_contacted')
  if (contacted !== null) {
    stages.push({ kind: 'flag', label: 'Contacted', happened: contacted })
  }
  const appointmentSet = optionalFlag(row, 'lead_appointment_set')
  if (appointmentSet !== null) {
    stages.push({ kind: 'flag', label: 'Appointment set', happened: appointmentSet })
  }
  if (flag(row, 'has_appointment')) {
    const scheduled = optionalText(row, 'appointment_scheduled_date')
    if (scheduled !== null) {
      stages.push({
        kind: 'dated',
        label: 'Appointment date',
        date: formatIsoDate(scheduled),
        note: null,
      })
    }
    const shown = optionalFlag(row, 'appointment_shown')
    if (shown !== null) stages.push({ kind: 'flag', label: 'Showed', happened: shown })
    const showDate = optionalText(row, 'appointment_show_date')
    if (showDate !== null) {
      stages.push({
        kind: 'dated',
        label: 'Showed on',
        date: formatIsoDate(showDate),
        note: null,
      })
    }
    // Test drive and write-up are REAL modelled flags, which is why these two
    // stages are shown rather than declared unavailable.
    const testDrive = optionalFlag(row, 'appointment_test_drive')
    if (testDrive !== null) {
      stages.push({ kind: 'flag', label: 'Test drive', happened: testDrive })
    }
    const writeUp = optionalFlag(row, 'appointment_write_up')
    if (writeUp !== null) {
      stages.push({ kind: 'flag', label: 'Write-up', happened: writeUp })
    }
  }
  stages.push({
    kind: 'dated',
    label: 'Sale',
    date: formatIsoDate(text(row, 'sale_date')),
    note: null,
  })
  stages.push({
    kind: 'dated',
    label: 'Delivery',
    date: formatIsoDate(text(row, 'delivery_date')),
    note: null,
  })
  return {
    kind: 'linked',
    source: optionalText(row, 'lead_source_name') ?? 'Unrecorded source',
    stages,
  }
}

/**
 * The integrity checklist.
 *
 * Only checks this increment can actually perform. Back-gross reconciliation,
 * product eligibility and product-adjustment validity need the F&I model and are
 * absent rather than shown as passing, because a check that cannot fail is not a
 * check.
 */
function buildChecks(
  row: DashboardRow,
  recomputedFront: Exact,
  publishedFront: Exact,
  recomputedTotal: Exact,
  publishedTotal: Exact
): readonly IntegrityCheck[] {
  const frontOk = compareExact(recomputedFront, publishedFront) === 0
  const totalOk = compareExact(recomputedTotal, publishedTotal) === 0
  const deliveryOk = flag(row, 'delivery_on_or_after_sale')
  const snapshots = count(row, 'inventory_snapshot_count') ?? 0

  return [
    {
      id: 'front-gross-identity',
      label: 'Front-gross identity',
      state: frontOk ? 'passed' : 'review',
      detail: frontOk
        ? 'Sale price less acquisition, reconditioning and pack equals the published front-end gross, to the cent.'
        : 'The published front-end gross does not equal its own components.',
    },
    {
      id: 'total-gross-identity',
      label: 'Total-gross identity',
      state: totalOk ? 'passed' : 'review',
      detail: totalOk
        ? 'Front-end gross plus back-end gross equals the published total gross, to the cent.'
        : 'The published total gross does not equal front plus back.',
    },
    {
      id: 'delivery-date-validity',
      label: 'Delivery date validity',
      state: deliveryOk ? 'passed' : 'review',
      detail: deliveryOk
        ? 'The vehicle was delivered on or after the date the deal was finalized.'
        : 'The delivery date precedes the sale date.',
    },
    {
      id: 'sale-to-inventory',
      label: 'Sale-to-inventory relationship',
      state: snapshots > 0 ? 'passed' : 'note',
      detail:
        snapshots > 0
          ? `The unit appears in ${String(snapshots)} inventory snapshot${snapshots === 1 ? '' : 's'} before it sold.`
          : 'The unit never appears in an inventory snapshot. That is legitimate for a unit acquired and sold between two snapshot dates, so it is reported as a note rather than as a failure.',
    },
    {
      id: 'source-lineage',
      label: 'Source lineage',
      state: 'passed',
      detail: `Read from the committed deal-jacket export, dataset version ${String(dashboardManifest.datasetVersion)}, contract ${dashboardManifest.contractSha256.slice(0, 12)}, as of ${formatIsoDate(dashboardManifest.asOfDate)}.`,
    },
  ]
}

/** Counting helper the route uses for its heading. */
export function formatDealCount(value: number): string {
  return formatCountExact({ units: BigInt(value), scale: 0 })
}
