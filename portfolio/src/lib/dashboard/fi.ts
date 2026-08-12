/**
 * F&I performance: the console's view of what the finance office produced and retained.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO
 * ---------------------------------
 * It SELECTS exported rows and SUMS the additive components the export declared as
 * numerators and denominators, then divides once, at the end, with the exact-decimal
 * helpers `DASH.2` established. That is the same standing `targets.ts` has and the same
 * standing ADR-0013 condition 2 gives every selector: the arithmetic is the export's,
 * published as components precisely so a consumer cannot form an average of averages.
 *
 * It does NOT own a formula, an eligibility rule or a date basis. `DASH.6` decided what a
 * penetration denominator is, which categories are eligible on which structures, what a
 * finance structure is, and what an adjustment does to retained gross. Nothing here
 * re-derives any of it.
 *
 * THREE DATE BASES, AND THE WHOLE POINT IS THAT THEY ARE NOT INTERCHANGEABLE
 * --------------------------------------------------------------------------
 *   DEAL DATE          what the office PRODUCED, by the day the deal was struck.
 *                      Never rewritten by a later event.
 *   AS-OF              what the store RETAINED through the governed as-of date:
 *                      original gross less cumulative adjustments posted by then.
 *   ADJUSTMENT PERIOD  events grouped by THEIR OWN posting date. An August chargeback
 *                      against a June contract is an August event and stays one.
 *
 * `fi-summary` is on the first two. `fi-adjustment-summary` is on the third. This module
 * keeps them in separate structures and never joins them into one row, because a
 * sale-date figure sitting on an adjustment-date row is exactly the silent blend the
 * model exists to prevent.
 *
 * THE MIXED-BASIS RATES ARE LABELLED, NOT HIDDEN
 * ----------------------------------------------
 * `KPI-FNI-014`, `-015` and `-018` divide an adjustment-period numerator by a sale-period
 * denominator. They are PERIOD PROXIES, not contract-cohort loss rates: the contracts
 * charged back in a month are mostly not the ones written in it. The disclosure travels
 * with the number, from the export's own `rate_basis_disclosure` column.
 *
 * PENETRATION COUNTS DISTINCT DEALS, AND ITS DENOMINATOR IS ITS OWN
 * -----------------------------------------------------------------
 * One deal may legitimately carry two different products in one category, so contracts
 * and attached deals differ and are never interchangeable. And every category's
 * denominator is the population ELIGIBLE FOR THAT CATEGORY: GAP over financed retail
 * deals, Lease Wear Protection over leases, Prepaid Maintenance over new and certified.
 * Computing GAP over all retail deals is the single most available way to get this number
 * wrong, and the export publishes both sides on every row so the page never has to guess.
 *
 * A FILTER SCOPES BOTH SIDES OR NEITHER
 * -------------------------------------
 * Every selection here narrows the exported ROWS, and both the numerator and the
 * denominator are summed from the same surviving rows. There is no path through this
 * module that filters one and not the other.
 *
 * NOTHING HERE IS A BENCHMARK
 * ---------------------------
 * No figure is good, bad, healthy, weak, strong, on target or industry-standard. ARPI
 * publishes no F&I benchmark, every product and lender is invented, and the eligibility
 * rules are synthetic analytical rules for a fictional group.
 */
import {
  addExact,
  cellToExact,
  compareExact,
  divideExact,
  exactFromInteger,
  exactZero,
  isZero,
  subtractExact,
  type Exact,
} from './decimal'
import { dashboardStores, numericCell, textCell, type DashboardStore } from './data'
import type { DashboardFilters } from './filters'
import { fiAdjustmentRows, fiSummaryRows } from './fi-data'
import { penetrationChunkFile } from './fi-chunks'
import { storeScopeLabel } from './scope'
import { decodeDataset } from './data'
import type { DashboardRow } from '@/types/dashboard'
import { dashboardCalendar, dashboardManifest } from './data'
import { calendarWindow, resolvePeriod, type PeriodContext } from './periods'

/* -------------------------------------------------------------------------- */
/* Governed vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The ten governed product categories, in the order the page renders them.
 *
 * Ordered by how a finance office reads a menu rather than alphabetically: the four
 * categories with their own headline penetration KPI first, then the rest. The set is
 * closed by the export's enumeration, so an eleventh category fails the export rather
 * than appearing here unordered.
 */
export const FI_CATEGORY_ORDER: readonly string[] = [
  'Vehicle Service Contract',
  'GAP',
  'Tire & Wheel',
  'Prepaid Maintenance',
  'Appearance Protection',
  'Paintless Dent Protection',
  'Theft or Security Product',
  'Key Replacement',
  'Lease Wear Protection',
  'Other Aftermarket Product',
]

/**
 * The URL slug for each governed category, and back.
 *
 * The `product` filter is a URL parameter, and a URL parameter carrying
 * `Vehicle%20Service%20Contract` is a URL nobody can read or type. The slug vocabulary is
 * derived mechanically from the governed names — lowercase, non-alphanumerics to hyphens
 * — so it cannot drift into a second category list: {@link fiCategoryForSlug} is the only
 * way back, and a slug that resolves to nothing is an unknown filter rather than an
 * eleventh category.
 *
 * "extended-warranty" is accepted as a USER-FACING ALIAS for Vehicle Service Contract,
 * which is what `DASH.6` permits: an alias in the URL grammar, never a stored value and
 * never a category of its own.
 */
export function fiCategorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const CATEGORY_BY_SLUG: ReadonlyMap<string, string> = new Map([
  ...FI_CATEGORY_ORDER.map((category) => [fiCategorySlug(category), category] as const),
  ['extended-warranty', 'Vehicle Service Contract'] as const,
])

/** The governed category a `product=` slug names, or `null` when it names none. */
export function fiCategoryForSlug(slug: string): string | null {
  return CATEGORY_BY_SLUG.get(slug.toLowerCase()) ?? null
}

/**
 * The exact sentence every mixed-basis rate carries.
 *
 * The export publishes its own `rate_basis_disclosure` per row and that is what the page
 * renders. This constant exists so the tests can assert the page said it, and so the
 * phrase cannot drift into "loss rate" in one component while staying correct in another.
 */
export const PERIOD_PROXY_LABEL = 'Period proxy, not a contract-cohort loss rate'

/** The three retail structures, in the order `KPI-FNI-019` reports them. */
export const FI_STRUCTURES: readonly string[] = ['Cash', 'Retail Finance', 'Lease']

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** A ratio the page renders from its own published components. */
export interface FiRatio {
  readonly numerator: Exact
  readonly denominator: Exact
  /** `null` when the denominator is zero — which is a state, never a zero. */
  readonly value: Exact | null
}

/** Why a ratio has no value. Four different statements, never collapsed into one. */
export type FiEmptyReason =
  | 'no-eligible-deals'
  | 'no-retail-units'
  | 'no-contracts'
  | 'no-adjustments'
  | 'insufficient-sample'

export interface FiProduction {
  readonly retailUnits: Exact
  readonly cashDeals: Exact
  readonly financeDeals: Exact
  readonly leaseDeals: Exact
  readonly financeReserveGross: Exact
  readonly backEndGrossDealDate: Exact
  readonly contractCount: Exact
  readonly dealsWithAProduct: Exact
  readonly productRetailPrice: Exact
  readonly productDealerCost: Exact
  readonly originalProductGross: Exact
  readonly originalFiGross: Exact
  readonly cumulativeAdjustmentAmount: Exact
  readonly adjustmentEventCount: Exact
  readonly netProductGrossAsOf: Exact
  readonly netFiGrossAsOf: Exact
  /** Reserve ÷ retail units. `KPI-FNI-002`. */
  readonly reservePvr: FiRatio
  /** Original product gross ÷ retail units. `KPI-FNI-005`, deal-date basis. */
  readonly productGrossPvr: FiRatio
  /** Back-end gross ÷ retail units. `KPI-GRS-005`, deal-date basis. */
  readonly backGrossPvr: FiRatio
  /** As-of retained F&I gross ÷ retail units. `KPI-FNI-022` basis. */
  readonly netFiGrossPvr: FiRatio
  /** Contracts ÷ ALL retail units — never ÷ deals that bought something. `KPI-FNI-006`. */
  readonly productsPerRetailUnit: FiRatio
  /** Original product gross ÷ contracts. `KPI-FNI-011`. */
  readonly grossPerContract: FiRatio
}

/** One structure's share of retail deliveries. `KPI-FNI-019`. */
export interface FiStructureShare {
  readonly structure: string
  readonly deals: Exact
  readonly share: FiRatio
}

/** One category's penetration and economics, with its own eligible denominator. */
export interface FiCategoryRow {
  readonly category: string
  readonly slug: string
  /** The governed `ELIG-*` rule that produced the denominator. */
  readonly eligibilityRuleId: string
  /** Distinct deals carrying at least one contract in this category. */
  readonly attachedDeals: Exact
  /** Deals ELIGIBLE for this category. Not all retail deals. */
  readonly eligibleDeals: Exact
  /** Contracts written. Differs from `attachedDeals` when a deal carried two. */
  readonly contracts: Exact
  readonly penetration: FiRatio
  /** The same ratio over the comparison period, or `null` when none was formed. */
  readonly priorPenetration: FiRatio | null
  /**
   * The change in penetration, as a PROPORTION difference.
   *
   * `null` when either period has no eligible denominator. 0.428 against 0.371 is
   * `0.057`, which `formatPointsDifference` renders as `+5.7 percentage points`.
   *
   * WHY THIS IS NOT PRE-MULTIPLIED BY 100
   * -------------------------------------
   * It was, briefly, and the page rendered `+350.9 percentage points` for a change of
   * three and a half. The console's shared formatter already performs the proportion
   * to points conversion, exactly as it does for every other ratio difference on every
   * other route, so a module that converts first converts twice. The field carries the
   * same unit every other difference in the console carries, and the formatter owns
   * the presentation -- which is the only arrangement where there is one place to be
   * wrong instead of two.
   */
  readonly penetrationChange: Exact | null
  readonly productRetailPrice: Exact
  readonly productDealerCost: Exact
  readonly originalProductGross: Exact
  readonly cumulativeAdjustmentAmount: Exact
  readonly netProductGrossAsOf: Exact
  readonly grossPerContract: FiRatio
  /** This category's share of all categories' original product gross. `KPI-FNI-020`. */
  readonly grossMixShare: FiRatio
  /** Why the row has no penetration, when it has none. */
  readonly emptyReason: FiEmptyReason | null
}

/** One adjustment type's activity, on the ADJUSTMENT-DATE basis. */
export interface FiAdjustmentTypeRow {
  readonly adjustmentType: string
  readonly events: Exact
  /** Signed: positive reduces retained gross, negative restores it. */
  readonly amount: Exact
  readonly contracts: Exact
  /**
   * The mixed-basis period-proxy rate: this type's amount over the ORIGINAL product
   * gross of contracts SOLD in the selected period. `null` when nothing was sold.
   */
  readonly periodProxyRate: FiRatio
  /** The export's own disclosure sentence for this rate. */
  readonly disclosure: string
}

/** One category's adjustment activity, for the diagnostic table. */
export interface FiAdjustmentCategoryRow {
  readonly category: string
  readonly events: Exact
  readonly amount: Exact
}

/** One finance manager's comparison row. Never a ranking. */
export interface FiManagerRow {
  /** The synthetic employee code, or `null` for the unstaffed group. */
  readonly code: string | null
  readonly label: string
  /** Which stores this manager's deals sit in, for the context the ratio needs. */
  readonly stores: readonly string[]
  readonly retailUnits: Exact
  readonly contractCount: Exact
  readonly financeReserveGross: Exact
  readonly originalProductGross: Exact
  readonly netProductGrossAsOf: Exact
  readonly reservePvr: FiRatio
  readonly productGrossPvr: FiRatio
  readonly productsPerRetailUnit: FiRatio
  /** `KPI-FNI-022`: reserve plus RETAINED product gross, over this manager's units. */
  readonly netFiGrossPvr: FiRatio
  /** The governed floor, from the export. Never hard-coded here. */
  readonly minimumSampleFloor: Exact
  /**
   * Whether this row's own denominator reached the floor.
   *
   * Below it the page renders "Insufficient sample (n = X)" and shows no ratio: a
   * one-deal penetration of 100% is a number that will be repeated and cannot be
   * defended. The components are still carried, because suppressing a ratio is a
   * rendering decision and blanking the evidence would be a different one.
   */
  readonly meetsMinimumSample: boolean
}

/** The whole page, assembled once on the server. */
export interface FiView {
  readonly periodContext: PeriodContext
  readonly scope: { readonly label: string; readonly stores: readonly DashboardStore[] }
  readonly asOfDate: string
  readonly hasRows: boolean
  readonly production: FiProduction
  readonly priorProduction: FiProduction | null
  readonly structures: readonly FiStructureShare[]
  readonly categories: readonly FiCategoryRow[]
  readonly adjustmentTypes: readonly FiAdjustmentTypeRow[]
  readonly adjustmentCategories: readonly FiAdjustmentCategoryRow[]
  readonly adjustmentEventTotal: Exact
  readonly adjustmentAmountTotal: Exact
  readonly managers: readonly FiManagerRow[]
  readonly minimumSampleFloor: Exact
  /** The category filter in force, resolved to a governed name. */
  readonly categoryFilter: string | null
  /** The structure filter in force, resolved to a governed name. */
  readonly structureFilter: string | null
  readonly managerFilter: string | null
  /** Reasons a section is empty, so the page states which of them applies. */
  readonly notices: readonly string[]
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */

const RATIO_SCALE = 6

function ratio(numerator: Exact, denominator: Exact): FiRatio {
  if (isZero(denominator)) return { numerator, denominator, value: null }
  return {
    numerator,
    denominator,
    value: divideExact(numerator, denominator, RATIO_SCALE),
  }
}

function money(row: DashboardRow, column: string): Exact {
  return cellToExact(numericCell(row, column)) ?? exactZero(2)
}

function count(row: DashboardRow, column: string): Exact {
  return cellToExact(numericCell(row, column)) ?? exactZero(0)
}

function optionalText(row: DashboardRow, column: string): string | null {
  const value = row[column]
  return typeof value === 'string' ? value : null
}

/** A running sum keyed by name, so the accumulation loops stay flat. */
class Sums {
  private readonly values = new Map<string, Exact>()

  add(key: string, value: Exact): void {
    const current = this.values.get(key)
    this.values.set(key, current === undefined ? value : addExact(current, value))
  }

  get(key: string, scale = 2): Exact {
    return this.values.get(key) ?? exactZero(scale)
  }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

function inPeriod(
  row: DashboardRow,
  column: string,
  start: string,
  end: string
): boolean {
  const date = textCell(row, column)
  return date >= start && date <= end
}

function inStores(row: DashboardRow, stores: readonly string[]): boolean {
  if (stores.length === 0) return true
  return stores.includes(textCell(row, 'dealership_id'))
}

function matchesManager(row: DashboardRow, employee: string | null): boolean {
  if (employee === null) return true
  return optionalText(row, 'finance_manager_code') === employee
}

/**
 * Which structure a `structure=` value names.
 *
 * The URL grammar spells them `cash`, `finance`, `lease`; the warehouse spells them
 * `Cash`, `Retail Finance`, `Lease`. One mapping, here, rather than a second derivation:
 * `DASH.6`'s function is the only thing that decides what a deal's structure IS, and this
 * only translates a filter value into that vocabulary.
 */
export function structureForFilter(value: string | null): string | null {
  if (value === 'cash') return 'Cash'
  if (value === 'finance') return 'Retail Finance'
  if (value === 'lease') return 'Lease'
  return null
}

/* -------------------------------------------------------------------------- */
/* Production                                                                  */
/* -------------------------------------------------------------------------- */

const PRODUCTION_MONEY = [
  'finance_reserve_gross',
  'back_end_gross_deal_date',
  'product_retail_price',
  'product_dealer_cost',
  'original_product_gross',
  'original_fi_gross',
  'cumulative_adjustment_amount',
  'net_product_gross_as_of',
  'net_fi_gross_as_of',
] as const

const PRODUCTION_COUNTS = [
  'retail_units',
  'cash_deal_count',
  'retail_finance_deal_count',
  'lease_deal_count',
  'contract_count',
  'deals_with_a_product',
  'adjustment_event_count',
] as const

function buildProduction(rows: readonly DashboardRow[]): FiProduction {
  const sums = new Sums()
  for (const row of rows) {
    for (const column of PRODUCTION_MONEY) sums.add(column, money(row, column))
    for (const column of PRODUCTION_COUNTS) sums.add(column, count(row, column))
  }

  const retailUnits = sums.get('retail_units', 0)
  const contractCount = sums.get('contract_count', 0)
  const financeReserveGross = sums.get('finance_reserve_gross')
  const originalProductGross = sums.get('original_product_gross')
  const backEndGrossDealDate = sums.get('back_end_gross_deal_date')
  const netFiGrossAsOf = sums.get('net_fi_gross_as_of')

  return {
    retailUnits,
    cashDeals: sums.get('cash_deal_count', 0),
    financeDeals: sums.get('retail_finance_deal_count', 0),
    leaseDeals: sums.get('lease_deal_count', 0),
    financeReserveGross,
    backEndGrossDealDate,
    contractCount,
    dealsWithAProduct: sums.get('deals_with_a_product', 0),
    productRetailPrice: sums.get('product_retail_price'),
    productDealerCost: sums.get('product_dealer_cost'),
    originalProductGross,
    originalFiGross: sums.get('original_fi_gross'),
    cumulativeAdjustmentAmount: sums.get('cumulative_adjustment_amount'),
    adjustmentEventCount: sums.get('adjustment_event_count', 0),
    netProductGrossAsOf: sums.get('net_product_gross_as_of'),
    netFiGrossAsOf,
    reservePvr: ratio(financeReserveGross, retailUnits),
    productGrossPvr: ratio(originalProductGross, retailUnits),
    backGrossPvr: ratio(backEndGrossDealDate, retailUnits),
    netFiGrossPvr: ratio(netFiGrossAsOf, retailUnits),
    productsPerRetailUnit: ratio(contractCount, retailUnits),
    grossPerContract: ratio(originalProductGross, contractCount),
  }
}

function buildStructures(production: FiProduction): readonly FiStructureShare[] {
  // The denominator is the sum of the three retail structures, not retail_units. They
  // agree today and the sum is what the share is OF, so a wholesale row entering the
  // dataset could never silently shrink every share.
  const total = addExact(
    addExact(production.cashDeals, production.financeDeals),
    production.leaseDeals
  )
  const byStructure: Record<string, Exact> = {
    Cash: production.cashDeals,
    'Retail Finance': production.financeDeals,
    Lease: production.leaseDeals,
  }
  return FI_STRUCTURES.map((structure) => ({
    structure,
    deals: byStructure[structure] ?? exactZero(0),
    share: ratio(byStructure[structure] ?? exactZero(0), total),
  }))
}

/* -------------------------------------------------------------------------- */
/* Penetration and category economics                                          */
/* -------------------------------------------------------------------------- */

interface CategoryAccumulator {
  eligibilityRuleId: string
  attached: Exact
  eligible: Exact
  contracts: Exact
  retail: Exact
  cost: Exact
  gross: Exact
  adjustments: Exact
  net: Exact
}

function emptyAccumulator(): CategoryAccumulator {
  return {
    eligibilityRuleId: '',
    attached: exactZero(0),
    eligible: exactZero(0),
    contracts: exactZero(0),
    retail: exactZero(2),
    cost: exactZero(2),
    gross: exactZero(2),
    adjustments: exactZero(2),
    net: exactZero(2),
  }
}

function accumulateCategories(
  rows: readonly DashboardRow[]
): ReadonlyMap<string, CategoryAccumulator> {
  const byCategory = new Map<string, CategoryAccumulator>()
  for (const row of rows) {
    const category = textCell(row, 'product_category')
    const entry = byCategory.get(category) ?? emptyAccumulator()
    // The rule id is a property of the category, identical on every row, so taking the
    // first is taking the only one. `DASH.6` guarantees exactly one rule per category.
    entry.eligibilityRuleId = textCell(row, 'eligibility_rule_id')
    entry.attached = addExact(entry.attached, count(row, 'penetration_numerator'))
    entry.eligible = addExact(entry.eligible, count(row, 'penetration_denominator'))
    entry.contracts = addExact(entry.contracts, count(row, 'contract_count'))
    entry.retail = addExact(entry.retail, money(row, 'product_retail_price'))
    entry.cost = addExact(entry.cost, money(row, 'product_dealer_cost'))
    entry.gross = addExact(entry.gross, money(row, 'original_product_gross'))
    entry.adjustments = addExact(
      entry.adjustments,
      money(row, 'cumulative_adjustment_amount')
    )
    entry.net = addExact(entry.net, money(row, 'net_product_gross_as_of'))
    byCategory.set(category, entry)
  }
  return byCategory
}

/**
 * The change between two penetrations, in PERCENTAGE POINTS.
 *
 * `null` when either period has no eligible denominator, because "no eligible population"
 * and "a population that bought nothing" are different statements and subtracting across
 * them would produce a number that means neither.
 */
function penetrationChange(current: FiRatio, prior: FiRatio | null): Exact | null {
  if (current.value === null || prior === null || prior.value === null) return null
  // An ABSOLUTE difference between two proportions, and nothing else. Rendered as
  // percentage points by the shared formatter; never as "+15.4%", which is a relative
  // change and a different metric nobody asked for.
  return subtractExact(current.value, prior.value)
}

function buildCategories(
  rows: readonly DashboardRow[],
  priorRows: readonly DashboardRow[] | null,
  categoryFilter: string | null
): readonly FiCategoryRow[] {
  const current = accumulateCategories(rows)
  const prior = priorRows === null ? null : accumulateCategories(priorRows)

  // The mix denominator is every category's gross in this selection, so the shares sum to
  // one over what is shown. Computed before the loop so each row divides by the same total.
  let grossTotal = exactZero(2)
  for (const entry of current.values()) grossTotal = addExact(grossTotal, entry.gross)

  const categories = FI_CATEGORY_ORDER.filter(
    (category) => categoryFilter === null || category === categoryFilter
  )

  return categories.map((category) => {
    const entry = current.get(category) ?? emptyAccumulator()
    const priorEntry = prior?.get(category) ?? null
    const penetration = ratio(entry.attached, entry.eligible)
    const priorPenetration =
      priorEntry === null ? null : ratio(priorEntry.attached, priorEntry.eligible)

    let emptyReason: FiEmptyReason | null = null
    if (isZero(entry.eligible)) emptyReason = 'no-eligible-deals'
    else if (isZero(entry.contracts)) emptyReason = 'no-contracts'

    return {
      category,
      slug: fiCategorySlug(category),
      eligibilityRuleId: entry.eligibilityRuleId,
      attachedDeals: entry.attached,
      eligibleDeals: entry.eligible,
      contracts: entry.contracts,
      penetration,
      priorPenetration,
      penetrationChange: penetrationChange(penetration, priorPenetration),
      productRetailPrice: entry.retail,
      productDealerCost: entry.cost,
      originalProductGross: entry.gross,
      cumulativeAdjustmentAmount: entry.adjustments,
      netProductGrossAsOf: entry.net,
      grossPerContract: ratio(entry.gross, entry.contracts),
      grossMixShare: ratio(entry.gross, grossTotal),
      emptyReason,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Adjustments                                                                 */
/* -------------------------------------------------------------------------- */

const ADJUSTMENT_TYPE_ORDER: readonly string[] = [
  'Chargeback',
  'Cancellation',
  'Reinstatement',
  'Approved Adjustment',
]

function buildAdjustments(
  rows: readonly DashboardRow[],
  soldGross: Exact
): {
  types: readonly FiAdjustmentTypeRow[]
  categories: readonly FiAdjustmentCategoryRow[]
  events: Exact
  amount: Exact
} {
  const byType = new Map<string, { events: Exact; amount: Exact; contracts: Exact }>()
  const byCategory = new Map<string, { events: Exact; amount: Exact }>()
  let disclosure = ''
  let events = exactZero(0)
  let amount = exactZero(2)

  for (const row of rows) {
    const type = textCell(row, 'adjustment_type')
    const category = textCell(row, 'product_category')
    const rowEvents = count(row, 'adjustment_count')
    const rowAmount = money(row, 'adjustment_amount')
    const rowContracts = count(row, 'distinct_adjusted_contract_count')
    disclosure = textCell(row, 'rate_basis_disclosure')

    const typeEntry = byType.get(type) ?? {
      events: exactZero(0),
      amount: exactZero(2),
      contracts: exactZero(0),
    }
    byType.set(type, {
      events: addExact(typeEntry.events, rowEvents),
      amount: addExact(typeEntry.amount, rowAmount),
      contracts: addExact(typeEntry.contracts, rowContracts),
    })

    const categoryEntry = byCategory.get(category) ?? {
      events: exactZero(0),
      amount: exactZero(2),
    }
    byCategory.set(category, {
      events: addExact(categoryEntry.events, rowEvents),
      amount: addExact(categoryEntry.amount, rowAmount),
    })

    events = addExact(events, rowEvents)
    amount = addExact(amount, rowAmount)
  }

  const types = ADJUSTMENT_TYPE_ORDER.filter((type) => byType.has(type)).map((type) => {
    const entry = byType.get(type)!
    return {
      adjustmentType: type,
      events: entry.events,
      amount: entry.amount,
      contracts: entry.contracts,
      // THE MIXED-BASIS RATE. The numerator's period is POSTING time and the
      // denominator's is SELLING time, which is why it is a proxy and says so.
      periodProxyRate: ratio(entry.amount, soldGross),
      disclosure,
    }
  })

  const categories = FI_CATEGORY_ORDER.filter((category) => byCategory.has(category)).map(
    (category) => {
      const entry = byCategory.get(category)!
      return { category, events: entry.events, amount: entry.amount }
    }
  )

  return { types, categories, events, amount }
}

/* -------------------------------------------------------------------------- */
/* Managers                                                                    */
/* -------------------------------------------------------------------------- */

const UNSTAFFED_LABEL = 'No finance manager credited'

interface ManagerAccumulator {
  stores: Set<string>
  units: Exact
  contracts: Exact
  reserve: Exact
  gross: Exact
  net: Exact
  netFi: Exact
  floor: Exact
}

function buildManagers(
  rows: readonly DashboardRow[],
  storeNames: ReadonlyMap<string, string>,
  floor: Exact
): readonly FiManagerRow[] {
  const byManager = new Map<string | null, ManagerAccumulator>()

  for (const row of rows) {
    const code = optionalText(row, 'finance_manager_code')
    const entry = byManager.get(code) ?? {
      stores: new Set<string>(),
      units: exactZero(0),
      contracts: exactZero(0),
      reserve: exactZero(2),
      gross: exactZero(2),
      net: exactZero(2),
      netFi: exactZero(2),
      floor,
    }
    entry.stores.add(textCell(row, 'dealership_id'))
    entry.units = addExact(entry.units, count(row, 'retail_units'))
    entry.contracts = addExact(entry.contracts, count(row, 'contract_count'))
    entry.reserve = addExact(entry.reserve, money(row, 'finance_reserve_gross'))
    entry.gross = addExact(entry.gross, money(row, 'original_product_gross'))
    entry.net = addExact(entry.net, money(row, 'net_product_gross_as_of'))
    entry.netFi = addExact(entry.netFi, money(row, 'net_fi_gross_as_of'))
    // The floor is a project constant published on every row; taking the last is taking
    // the only one. It is never hard-coded in this module.
    entry.floor = count(row, 'minimum_sample_floor')
    byManager.set(code, entry)
  }

  const managers = [...byManager.entries()].map(([code, entry]) => {
    const stores = [...entry.stores].sort()
    return {
      code,
      label: code ?? UNSTAFFED_LABEL,
      stores: stores.map((id) => storeNames.get(id) ?? id),
      retailUnits: entry.units,
      contractCount: entry.contracts,
      financeReserveGross: entry.reserve,
      originalProductGross: entry.gross,
      netProductGrossAsOf: entry.net,
      reservePvr: ratio(entry.reserve, entry.units),
      productGrossPvr: ratio(entry.gross, entry.units),
      productsPerRetailUnit: ratio(entry.contracts, entry.units),
      netFiGrossPvr: ratio(entry.netFi, entry.units),
      minimumSampleFloor: entry.floor,
      // The floor is compared against THIS ROW'S OWN denominator, which is the manager's
      // retail units in the current selection -- not the store's, and not the group's.
      meetsMinimumSample: compareExact(entry.units, entry.floor) >= 0,
    }
  })

  /*
   * NEUTRAL ORDER, AND THAT IS THE POINT.
   *
   * Store, then synthetic code, with the unstaffed group last. Sorting by a performance
   * metric would make the table a leaderboard, and PRIVACY_AND_ETHICS.md section 5 does
   * not permit one: a finance manager's figures inherit their store's mix, their
   * structure mix and their eligibility mix, and the first row of a metric-sorted table
   * reads as a verdict whatever the caption says.
   */
  return managers.sort((a, b) => {
    if (a.code === null) return 1
    if (b.code === null) return -1
    const storeCompare = (a.stores[0] ?? '').localeCompare(b.stores[0] ?? '')
    if (storeCompare !== 0) return storeCompare
    return a.code.localeCompare(b.code)
  })
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Penetration rows for the stores and months asked for.
 *
 * ONE CACHE KEY PER PARTITION, which is not a detail. `decodeDataset` memoizes by key, so
 * decoding eighteen partitions under one key returns the first partition eighteen times
 * — inflating every numerator AND every denominator by a factor nobody would notice,
 * because the ratio still looks plausible. This mirrors `chunkedDataset` in `data.ts`
 * exactly, and it reads only the partitions the period touches rather than all eighteen.
 */
function penetrationRows(
  stores: readonly string[],
  months: readonly string[]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = penetrationChunkFile(store, month)
      if (file === undefined) continue
      rows.push(...decodeDataset(`fi-product-penetration/${store}/${month}`, file))
    }
  }
  return rows
}

/**
 * The whole F&I page, assembled from the governed export.
 *
 * One pass per dataset, one division per ratio, and every filter applied to the ROWS so
 * that a numerator and its denominator are always summed from the same surviving set.
 */
export function buildFi(filters: DashboardFilters): FiView {
  const window = calendarWindow(dashboardCalendar, dashboardManifest.asOfDate)
  const periodContext = resolvePeriod(filters.period, filters.compare, window)
  const { period, comparison } = periodContext

  const categoryFilter =
    filters.product === null ? null : fiCategoryForSlug(filters.product)
  const structureFilter = structureForFilter(filters.structure)
  const managerFilter = filters.employee

  const storeNames = new Map(dashboardStores.map((store) => [store.id, store.shortName]))
  const scopeStores =
    filters.store.length === 0
      ? dashboardStores
      : dashboardStores.filter((store) => filters.store.includes(store.id))

  const notices: string[] = []

  /* ---- production, on the SALE-DATE basis ------------------------------- */
  const summaryAll = fiSummaryRows()
  const summarySelected = summaryAll.filter(
    (row) =>
      inStores(row, filters.store) &&
      matchesManager(row, managerFilter) &&
      inPeriod(row, 'sale_date', period.start, period.end)
  )
  const production = buildProduction(summarySelected)

  const priorSummary =
    comparison === null
      ? null
      : summaryAll.filter(
          (row) =>
            inStores(row, filters.store) &&
            matchesManager(row, managerFilter) &&
            inPeriod(row, 'sale_date', comparison.start, comparison.end)
        )
  const priorProduction = priorSummary === null ? null : buildProduction(priorSummary)

  /* ---- penetration, on the SALE-DATE basis ------------------------------ */
  // The partitions the two periods touch, and no others. A comparison that resolves to
  // months outside the current period simply adds those partitions.
  const scopeIds = scopeStores.map((store) => store.id)
  const monthsNeeded = [
    ...new Set([...period.months, ...(comparison?.months ?? [])]),
  ].sort()
  const penetrationAll = penetrationRows(scopeIds, monthsNeeded)
  const penetrationSelected = penetrationAll.filter(
    (row) =>
      matchesManager(row, managerFilter) &&
      inPeriod(row, 'sale_date', period.start, period.end)
  )
  const penetrationPrior =
    comparison === null
      ? null
      : penetrationAll.filter(
          (row) =>
            matchesManager(row, managerFilter) &&
            inPeriod(row, 'sale_date', comparison.start, comparison.end)
        )
  const categories = buildCategories(
    penetrationSelected,
    penetrationPrior,
    categoryFilter
  )

  /* ---- adjustments, on the ADJUSTMENT-DATE basis ------------------------ */
  const adjustmentSelected = fiAdjustmentRows().filter(
    (row) =>
      inStores(row, filters.store) &&
      matchesManager(row, managerFilter) &&
      inPeriod(row, 'adjustment_date', period.start, period.end) &&
      (categoryFilter === null || textCell(row, 'product_category') === categoryFilter)
  )
  const adjustments = buildAdjustments(
    adjustmentSelected,
    production.originalProductGross
  )

  /* ---- managers --------------------------------------------------------- */
  const floor =
    summarySelected.length === 0
      ? exactZero(0)
      : count(summarySelected[0]!, 'minimum_sample_floor')
  const managers = buildManagers(summarySelected, storeNames, floor)

  if (structureFilter !== null) {
    notices.push(
      `The structure filter names ${structureFilter}. The exported F&I datasets carry the structure MIX as counts rather than a per-structure split of reserve, product gross and penetration, so it is shown in the finance structure section and is not applied to the other figures on this page.`
    )
  }

  return {
    periodContext,
    scope: {
      label: storeScopeLabel(filters.store),
      stores: scopeStores,
    },
    asOfDate: dashboardManifest.asOfDate,
    hasRows: summarySelected.length > 0,
    production,
    priorProduction,
    structures: buildStructures(production),
    categories,
    adjustmentTypes: adjustments.types,
    adjustmentCategories: adjustments.categories,
    adjustmentEventTotal: adjustments.events,
    adjustmentAmountTotal: adjustments.amount,
    managers,
    minimumSampleFloor: floor,
    categoryFilter,
    structureFilter,
    managerFilter,
    notices,
  }
}

/**
 * The deal-date back-gross identity, verified from the displayed components.
 *
 * `back_end_gross = finance_reserve_gross + original_product_gross`, with
 * `other_fi_income` exactly `0.00`. NET product gross is deliberately NOT used: a later
 * cancellation is supposed to make retained gross differ from produced gross, and
 * substituting the retained figure here would make the identity fail on every adjusted
 * population — which would be the check reporting a defect that is actually correct
 * behaviour.
 *
 * A verification, not a second definition: `RECON-FI-001` proves the same identity per
 * deal in the warehouse, and this recomputes it from what the page put on the screen.
 */
export function backGrossIdentityHolds(production: FiProduction): boolean {
  const explained = addExact(
    production.financeReserveGross,
    production.originalProductGross
  )
  return compareExact(explained, production.backEndGrossDealDate) === 0
}

/** The difference the identity leaves unexplained. Zero when it holds. */
export function backGrossResidual(production: FiProduction): Exact {
  return subtractExact(
    production.backEndGrossDealDate,
    addExact(production.financeReserveGross, production.originalProductGross)
  )
}

/**
 * Retained F&I gross, verified from its own components.
 *
 * `net_fi_gross_as_of = finance_reserve_gross + net_product_gross_as_of`. Reserve is not
 * adjusted — no modelled event takes it back — so the whole difference between produced
 * and retained F&I gross is the product side.
 */
export function netFiGrossIdentityHolds(production: FiProduction): boolean {
  const explained = addExact(
    production.financeReserveGross,
    production.netProductGrossAsOf
  )
  return compareExact(explained, production.netFiGrossAsOf) === 0
}

/** Whether a ratio has enough sample to be shown as a comparable figure. */
export function isPublishable(row: FiManagerRow): boolean {
  return row.meetsMinimumSample
}

/** `exactFromInteger` re-exported for the page's own small conversions. */
export { exactFromInteger }
