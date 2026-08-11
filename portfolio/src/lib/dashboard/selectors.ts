/**
 * The governed selector registry: the one place the console decides what may be
 * added to what.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * ADR-0013 condition 2 says the console "does not independently redefine KPI
 * formulas". A console that renders `retailUnits + retailUnits` in a component has
 * redefined one, whether or not it got the same answer. So every aggregation the
 * page performs is declared here, as data, and each declaration carries the
 * evidence that it is not an invention:
 *
 *   `reconciliationKey`  the key in the export manifest's reconciliation block
 *                        whose published total this selector must reproduce
 *                        exactly at group scope over the whole reporting window.
 *   `kpiId`              the governed KPI_CATALOG.md entry the figure resolves to.
 *   `derivation`         the sentence from that entry's declared numerator and
 *                        denominator that this selector implements.
 *
 * `dashboard-executive.test.tsx` walks the registry and checks the first of those
 * against the committed manifest for every selector that has one, so a formula
 * edited in this file fails a test rather than a review.
 *
 * WHAT THE EXPORT ALREADY DECIDED, AND WHY IT MATTERS
 * ---------------------------------------------------
 * `DATA_CONTRACT.md` §12: a ratio's reconciliation total "carries its numerator sum
 * and its denominator sum and stops there. No quotient is published." That is not a
 * gap — it is the mechanism. The export hands the console two additive columns and
 * leaves the division to it, which is precisely what makes an average of store
 * averages impossible to form from this data, and it is why every ratio below names
 * two columns instead of one.
 *
 * THE THREE HONEST FAILURES
 * -------------------------
 * A selector may decline. `null-ratio` is a governed BLANK: KPI_CATALOG says of
 * every ratio here that a zero denominator returns NULL, because an empty lot has
 * no average age rather than an average age of zero. `no-rows` is an empty
 * selection. `not-derivable` is the one that matters most: a median is an order
 * statistic, "group median is not derivable from subgroup medians and must be
 * recomputed from rows" (KPI-INV-004), and the export publishes medians at their
 * own grain and no higher. The console says so and names the scope that would
 * resolve it, rather than averaging five medians into a sixth number that is not a
 * median of anything.
 */
import type { DashboardRow } from '@/types/dashboard'

import {
  addExact,
  cellToExact,
  divideExact,
  exactFromInteger,
  exactZero,
  multiplyByInteger,
  subtractExact,
  type Exact,
} from './decimal'
import type { ChunkedDatasetName } from './chunks'
import {
  chunkedDataset,
  datasetManifest,
  distinctValues,
  numericCell,
  selectRows,
  wholeDataset,
} from './data'
import type { ResolvedPeriod } from './periods'

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type MetricUnit =
  | 'count'
  | 'currency'
  | 'currency-per-unit'
  | 'ratio'
  | 'days'
  | 'minutes'
  | 'turns'

/**
 * What a metric resolved to.
 *
 * Five states, and the page renders five different things. A reader must be able to
 * tell `0` from "Not applicable" from "No matching records" from "Data unavailable"
 * from "Not derivable at this scope", because collapsing any two of them into a
 * dash is how a dashboard becomes untrustworthy in a way nobody can point at.
 */
export type MetricResult =
  | { readonly kind: 'value'; readonly value: Exact; readonly rowCount: number }
  | { readonly kind: 'null-ratio'; readonly reason: string }
  | { readonly kind: 'no-rows'; readonly reason: string }
  | { readonly kind: 'not-applicable'; readonly reason: string }
  | {
      readonly kind: 'not-derivable'
      readonly reason: string
      /** The scope that WOULD resolve it, in words the filter bar can act on. */
      readonly resolveBy: string
    }

export function isValue(
  result: MetricResult
): result is { kind: 'value'; value: Exact; rowCount: number } {
  return result.kind === 'value'
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

export interface MetricContext {
  /** The stores in scope. Always explicit; a group view lists all three. */
  readonly stores: readonly string[]
  /** `null` when no condition filter is in force. */
  readonly conditionGroups: readonly string[] | null
  /** `null` when no lead-source filter is in force. */
  readonly leadSources: readonly string[] | null
  readonly period: ResolvedPeriod
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How a selector picks its rows out of the period.
 *
 *   `period`    every row whose date falls in the range. Sales, gross, leads.
 *   `snapshot`  the single latest snapshot date inside the range. Inventory levels
 *               are semi-additive — KPI-INV-001's caution: "a month-level card
 *               showing a summed daily count is wrong by roughly a factor of 30 and
 *               looks plausible" — so they are read at one date and the date is
 *               stated on the section.
 *   `month`     rows at month grain, restricted to the months the period covers in
 *               FULL. A turn figure over eleven days of a month is not a turn
 *               figure.
 */
export type SelectorBasis = 'period' | 'snapshot' | 'month'

interface SelectorCommon {
  readonly id: string
  readonly label: string
  /** The governed KPI this resolves to, or `null` for a raw exported count. */
  readonly kpiId: string | null
  readonly dataset: string
  readonly dateColumn: string
  readonly basis: SelectorBasis
  readonly unit: MetricUnit
  /** Decimals the exact value is carried to before display. */
  readonly scale: number
  /**
   * The noun a `count` unit is counted in.
   *
   * Units, leads and appointments are all integers and are not the same thing, and
   * "+12" on a card that could mean any of them is not a figure a manager can act
   * on. Every count selector names its noun.
   */
  readonly countNoun?: string
  /** The manifest reconciliation key this must reproduce at group scope, if any. */
  readonly reconciliationKey?: string
  /** The catalogue's declared numerator/denominator, implemented here. */
  readonly derivation: string
}

export type Selector =
  | (SelectorCommon & { readonly kind: 'sum'; readonly column: string })
  | (SelectorCommon & {
      readonly kind: 'ratio'
      readonly numeratorColumn: string
      readonly denominatorColumn: string
      /**
       * A per-row constant that multiplies the numerator, named as a column so the
       * factor comes from the export rather than from this file. `days-supply`
       * carries `trailing_days`; nothing else uses it.
       */
      readonly numeratorFactorColumn?: string
      /**
       * A unit conversion applied to the denominator, and ONLY a unit conversion.
       *
       * The single use is 60, turning a seconds-per-lead quotient into minutes,
       * which is part of the governed definition rather than an addition to it:
       * KPI-FUN-007 declares its unit as minutes and KPI-FUN-008 spells the
       * division by 60 into its formula. A factor here may never carry business
       * meaning; anything that does is a formula and belongs in a reporting view.
       */
      readonly denominatorUnitFactor?: number
    })
  | (SelectorCommon & {
      readonly kind: 'inventory-turn'
      readonly unitsColumn: string
      readonly unitDaysColumn: string
      readonly calendarDaysColumn: string
      readonly snapshotDaysColumn: string
    })
  | (SelectorCommon & {
      readonly kind: 'order-statistic'
      readonly column: string
      /** The grain the export publishes it at. Resolvable only at exactly this grain. */
      readonly grainDescription: string
      readonly resolveBy: string
    })

const CHUNKED = new Set<string>([
  'inventory-health',
  'inventory-aging',
  'days-supply',
  'lead-funnel',
  'lead-response',
])

/**
 * Every selector the Executive Overview can form, and nothing else.
 *
 * Adding one means naming its governed KPI, its two exported columns and — where
 * the export publishes a matching total — its reconciliation key. Anything that
 * cannot be written in those terms is not a selection; it is a new formula, and a
 * new formula belongs in a reporting view.
 */
export const SELECTORS = {
  retailUnits: {
    id: 'retailUnits',
    label: 'Retail units',
    kpiId: 'KPI-SLS-001',
    dataset: 'sales-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'retail_units_sold',
    unit: 'count',
    countNoun: 'units',
    scale: 0,
    reconciliationKey: 'retail_units',
    derivation:
      'Sum of the exported additive column `retail_units_sold` over the period.',
  },
  newUnits: {
    id: 'newUnits',
    label: 'New units',
    kpiId: 'KPI-SLS-002',
    dataset: 'sales-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'new_units_sold',
    unit: 'count',
    countNoun: 'units',
    scale: 0,
    reconciliationKey: 'new_units',
    derivation: 'Sum of the exported additive column `new_units_sold` over the period.',
  },
  usedUnits: {
    id: 'usedUnits',
    label: 'Used units',
    kpiId: 'KPI-SLS-003',
    dataset: 'sales-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'used_units_sold',
    unit: 'count',
    countNoun: 'units',
    scale: 0,
    reconciliationKey: 'used_units',
    derivation: 'Sum of the exported additive column `used_units_sold` over the period.',
  },
  frontGross: {
    id: 'frontGross',
    label: 'Front-end gross',
    kpiId: 'KPI-GRS-001',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'front_end_gross',
    unit: 'currency',
    scale: 2,
    reconciliationKey: 'front_end_gross',
    derivation: 'Sum of the exported additive column `front_end_gross` over the period.',
  },
  backGross: {
    id: 'backGross',
    label: 'Back-end gross',
    kpiId: 'KPI-GRS-002',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'back_end_gross',
    unit: 'currency',
    scale: 2,
    reconciliationKey: 'back_end_gross',
    derivation: 'Sum of the exported additive column `back_end_gross` over the period.',
  },
  totalGross: {
    id: 'totalGross',
    label: 'Total gross',
    kpiId: 'KPI-GRS-003',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'sum',
    column: 'total_gross',
    unit: 'currency',
    scale: 2,
    reconciliationKey: 'total_gross',
    derivation: 'Sum of the exported additive column `total_gross` over the period.',
  },
  frontPvr: {
    id: 'frontPvr',
    label: 'Front gross per retail unit',
    kpiId: 'KPI-GRS-004',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'front_end_gross',
    denominatorColumn: 'retail_units_sold',
    unit: 'currency-per-unit',
    scale: 2,
    reconciliationKey: 'front_gross_per_retail_unit',
    derivation:
      'Exported `front_end_gross` summed over the period, divided by exported `retail_units_sold` summed over the same rows: the catalogue numerator and denominator, divided once at the end.',
  },
  backPvr: {
    id: 'backPvr',
    label: 'Back gross per retail unit',
    kpiId: 'KPI-GRS-005',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'back_end_gross',
    denominatorColumn: 'retail_units_sold',
    unit: 'currency-per-unit',
    scale: 2,
    reconciliationKey: 'back_gross_per_retail_unit',
    derivation:
      'Exported `back_end_gross` summed over the period, divided by exported `retail_units_sold` summed over the same rows.',
  },
  totalPvr: {
    id: 'totalPvr',
    label: 'Total gross per retail unit',
    kpiId: 'KPI-GRS-006',
    dataset: 'gross-summary',
    dateColumn: 'sale_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'total_gross',
    denominatorColumn: 'retail_units_sold',
    unit: 'currency-per-unit',
    scale: 2,
    reconciliationKey: 'total_gross_per_retail_unit',
    derivation:
      'Exported `total_gross` summed over the period, divided by exported `retail_units_sold` summed over the same rows.',
  },

  /* ---- inventory, at one snapshot date --------------------------------- */
  activeInventory: {
    id: 'activeInventory',
    label: 'Active inventory',
    kpiId: 'KPI-INV-001',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'sum',
    column: 'active_inventory_units',
    unit: 'count',
    countNoun: 'units',
    scale: 0,
    derivation:
      'Sum of exported `active_inventory_units` at the single latest snapshot date in the period. Semi-additive: never summed across dates.',
  },
  inventoryInvestment: {
    id: 'inventoryInvestment',
    label: 'Inventory investment',
    kpiId: 'KPI-INV-002',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'sum',
    column: 'inventory_investment',
    unit: 'currency',
    scale: 2,
    derivation:
      'Sum of exported `inventory_investment` at the single latest snapshot date in the period.',
  },
  averageInventoryAge: {
    id: 'averageInventoryAge',
    label: 'Average inventory age',
    kpiId: 'KPI-INV-003',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'ratio',
    numeratorColumn: 'days_in_stock_total',
    denominatorColumn: 'active_inventory_units',
    unit: 'days',
    scale: 1,
    derivation:
      'Exported `days_in_stock_total` divided by exported `active_inventory_units` at the snapshot date: the catalogue formula SUM(days_in_stock) / COUNT(active units), recomputed at this level rather than averaged from store averages.',
  },
  medianInventoryAge: {
    id: 'medianInventoryAge',
    label: 'Median inventory age',
    kpiId: 'KPI-INV-004',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'order-statistic',
    column: 'median_inventory_age',
    unit: 'days',
    scale: 0,
    grainDescription: 'store × snapshot date × condition group',
    resolveBy: 'one store and one condition group',
    derivation:
      'PERCENTILE_CONT(0.5) over days_in_stock, computed in PostgreSQL and exported at store × snapshot date × condition group. An order statistic is not decomposable: the catalogue states that a group median is not derivable from subgroup medians and must be recomputed from rows, so the console reads the exported value where the filter resolves to exactly one and declines everywhere else.',
  },
  agedInventoryUnits: {
    id: 'agedInventoryUnits',
    label: 'Aged inventory units',
    kpiId: 'KPI-INV-005',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'sum',
    column: 'aged_inventory_units',
    unit: 'count',
    countNoun: 'units',
    scale: 0,
    derivation:
      'Sum of exported `aged_inventory_units` at the snapshot date, using the aged threshold the export itself carries in `aged_threshold_days`.',
  },
  agedInventoryInvestment: {
    id: 'agedInventoryInvestment',
    label: 'Aged inventory investment',
    kpiId: 'KPI-INV-002',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'sum',
    column: 'aged_inventory_investment',
    unit: 'currency',
    scale: 2,
    derivation:
      'Sum of exported `aged_inventory_investment` at the snapshot date. The aged share of KPI-INV-002.',
  },
  agedInventoryPercentage: {
    id: 'agedInventoryPercentage',
    label: 'Aged inventory percentage',
    kpiId: 'KPI-INV-006',
    dataset: 'inventory-health',
    dateColumn: 'snapshot_date',
    basis: 'snapshot',
    kind: 'ratio',
    numeratorColumn: 'aged_inventory_units',
    denominatorColumn: 'active_inventory_units',
    unit: 'ratio',
    scale: 6,
    derivation:
      'Exported `aged_inventory_units` divided by exported `active_inventory_units` at the same snapshot date: KPI-INV-005 over KPI-INV-001 as the catalogue declares them, both additive at a single date.',
  },
  daysSupply: {
    id: 'daysSupply',
    label: 'Dealer days supply',
    kpiId: 'KPI-INV-009',
    dataset: 'days-supply',
    dateColumn: 'as_of_date',
    basis: 'snapshot',
    kind: 'ratio',
    numeratorColumn: 'active_inventory_units',
    denominatorColumn: 'trailing_retail_units',
    numeratorFactorColumn: 'trailing_days',
    unit: 'days',
    scale: 1,
    derivation:
      'Exported `active_inventory_units` at the as-of date, divided by exported `trailing_retail_units` over the trailing window and multiplied by the exported `trailing_days` of that window: the catalogue formula "current active inventory / average daily retail sales", rearranged so both operands are additive exported columns.',
  },
  inventoryTurn: {
    id: 'inventoryTurn',
    label: 'Inventory turn',
    kpiId: 'KPI-INV-008',
    dataset: 'inventory-turn',
    dateColumn: 'month_start_date',
    basis: 'month',
    kind: 'inventory-turn',
    unitsColumn: 'retail_units_sold',
    unitDaysColumn: 'inventory_unit_days',
    calendarDaysColumn: 'calendar_days_in_period',
    snapshotDaysColumn: 'snapshot_day_count',
    unit: 'turns',
    scale: 4,
    derivation:
      'Exported `retail_units_sold` summed and annualized by 365 over the exported calendar days of the period, divided by exported `inventory_unit_days` summed over the exported snapshot days of the period: the catalogue formula of annualized retail units over average daily active inventory, formed from four additive exported columns.',
  },

  /* ---- lead funnel ------------------------------------------------------ */
  leadsReceived: {
    id: 'leadsReceived',
    label: 'Leads received',
    kpiId: 'KPI-FUN-001',
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'leads_received',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    reconciliationKey: 'leads_received',
    derivation: 'Sum of the exported additive column `leads_received` over the period.',
  },
  contactedLeads: {
    id: 'contactedLeads',
    label: 'Contacted',
    kpiId: null,
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'contacted_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    reconciliationKey: 'contacted_leads',
    derivation: 'Sum of the exported additive column `contacted_leads` over the period.',
  },
  appointmentSetLeads: {
    id: 'appointmentSetLeads',
    label: 'Appointment set',
    kpiId: null,
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'appointment_set_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    reconciliationKey: 'appointment_set_leads',
    derivation:
      'Sum of the exported additive column `appointment_set_leads` over the period.',
  },
  appointmentShownLeads: {
    id: 'appointmentShownLeads',
    label: 'Showed',
    kpiId: null,
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'appointment_shown_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation:
      'Sum of the exported additive column `appointment_shown_leads` over the period.',
  },
  soldLeads: {
    id: 'soldLeads',
    label: 'Sold',
    kpiId: null,
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'sold_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    reconciliationKey: 'sold_leads',
    derivation: 'Sum of the exported additive column `sold_leads` over the period.',
  },
  contactRate: {
    id: 'contactRate',
    label: 'Contact rate',
    kpiId: 'KPI-FUN-002',
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'contacted_leads',
    denominatorColumn: 'leads_received',
    unit: 'ratio',
    scale: 6,
    reconciliationKey: 'contact_rate',
    derivation:
      'Exported `contacted_leads` divided by exported `leads_received`, both summed first.',
  },
  /**
   * KPI-FUN-003. THE DENOMINATOR IS CONTACTED LEADS.
   *
   * It read `leads_received` here until DASH.10, matching the export's reconciliation
   * total and contradicting everything else: `KPI_CATALOG.md` §26 ("The denominator is
   * contacted leads, not all leads"), the governed lead-funnel view, and an integration test
   * asserting the view divides by contacted leads and "emphatically not leads_received".
   *
   * An appointment cannot be set with someone who was never reached, so dividing by all
   * leads does not make the rate conservative — it makes it a different measure, and one
   * that moves when contact rate moves. The Executive funnel published 26.6% where the
   * governed definition gives 37.0%.
   *
   * Both sides are summed before dividing, so this is a ratio of sums and not a mean of
   * per-row rates.
   */
  appointmentSetRate: {
    id: 'appointmentSetRate',
    label: 'Appointment-set rate',
    kpiId: 'KPI-FUN-003',
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'appointment_set_leads',
    denominatorColumn: 'contacted_leads',
    unit: 'ratio',
    scale: 6,
    reconciliationKey: 'appointment_set_rate',
    derivation:
      'Exported `appointment_set_leads` divided by exported `contacted_leads`, both summed first. The denominator is CONTACTED leads, not all leads: an appointment cannot be set with someone who was never reached, which is why this rate must never be read without contact rate beside it.',
  },
  leadToSale: {
    id: 'leadToSale',
    label: 'Lead-to-sale conversion',
    kpiId: 'KPI-FUN-006',
    dataset: 'lead-funnel',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'sold_leads',
    denominatorColumn: 'leads_received',
    unit: 'ratio',
    scale: 6,
    reconciliationKey: 'lead_to_sale_conversion',
    derivation:
      'Exported `sold_leads` divided by exported `leads_received`, both summed over the lead-creation cohort first.',
  },

  /* ---- response time ---------------------------------------------------- */
  averageResponseMinutes: {
    id: 'averageResponseMinutes',
    label: 'Average response time',
    kpiId: 'KPI-FUN-007',
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'ratio',
    numeratorColumn: 'response_seconds_total',
    denominatorColumn: 'responded_leads',
    denominatorUnitFactor: 60,
    unit: 'minutes',
    scale: 4,
    derivation:
      'Exported `response_seconds_total` divided by exported `responded_leads`, both summed first, then converted from seconds to minutes as the catalogue unit requires. The exported reconciliation total publishes the same two sums in seconds.',
  },
  medianResponseMinutes: {
    id: 'medianResponseMinutes',
    label: 'Median response time',
    kpiId: 'KPI-FUN-008',
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'order-statistic',
    column: 'median_response_minutes',
    unit: 'minutes',
    scale: 4,
    grainDescription: 'store × lead source × lead-creation date',
    resolveBy: 'one store, one lead source and a single day',
    derivation:
      'PERCENTILE_CONT(0.5) over first_response_seconds, computed in PostgreSQL and exported at store × lead source × lead-creation date. The catalogue states it "must be recomputed from row-level values at every aggregation level"; the export carries no row-level response times, so the console reads the exported value only where the filter resolves to exactly one row.',
  },
  respondedLeads: {
    id: 'respondedLeads',
    label: 'Responded leads',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'responded_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation: 'Sum of the exported additive column `responded_leads` over the period.',
  },
  unrespondedLeads: {
    id: 'unrespondedLeads',
    label: 'Leads with no recorded response',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'unresponded_leads',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation:
      'Sum of the exported additive column `unresponded_leads` over the period.',
  },
  responsesUnder5: {
    id: 'responsesUnder5',
    label: 'Under 5 minutes',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'responses_under_5_minutes',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation: 'Sum of the exported additive column `responses_under_5_minutes`.',
  },
  responses5to15: {
    id: 'responses5to15',
    label: '5 to 15 minutes',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'responses_5_to_15_minutes',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation: 'Sum of the exported additive column `responses_5_to_15_minutes`.',
  },
  responses15to60: {
    id: 'responses15to60',
    label: '15 to 60 minutes',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'responses_15_to_60_minutes',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation: 'Sum of the exported additive column `responses_15_to_60_minutes`.',
  },
  responsesOver60: {
    id: 'responsesOver60',
    label: 'Over 60 minutes',
    kpiId: null,
    dataset: 'lead-response',
    dateColumn: 'lead_created_date',
    basis: 'period',
    kind: 'sum',
    column: 'responses_over_60_minutes',
    unit: 'count',
    countNoun: 'leads',
    scale: 0,
    derivation: 'Sum of the exported additive column `responses_over_60_minutes`.',
  },
} as const satisfies Record<string, Selector>

export type SelectorId = keyof typeof SELECTORS

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a dimension filter applies to a dataset, read from the manifest.
 *
 * A condition filter has no meaning for `gross-summary`, which carries retail
 * totals and no condition split, and a lead-source filter has no meaning for
 * `inventory-health`. Applying one anyway would match nothing and the page would
 * report "no matching records" for a measure that has plenty of them — a filter
 * silently zeroing an unrelated card is the worst of the three possible behaviours.
 *
 * The other two are: refuse the filter outright (which would make a lead-source
 * view of the funnel impossible), or declare per route which measure families each
 * filter reaches. The route declares exactly that in `EXECUTIVE_OVERVIEW_SUPPORT` —
 * `condition` and `source` are `partial`, with a note naming what they scope — and
 * this function is that declaration enforced against the export's own column list
 * rather than against a second hand-maintained one.
 */
function datasetCarries(dataset: string, column: string): boolean {
  return datasetManifest(dataset).columns.some((entry) => entry.name === column)
}

/** Rows for a selector's dataset, restricted to the context. */
function rowsFor(selector: Selector, context: MetricContext): readonly DashboardRow[] {
  const source = CHUNKED.has(selector.dataset)
    ? chunkedDataset(
        selector.dataset as ChunkedDatasetName,
        context.stores,
        selector.basis === 'month' ? context.period.wholeMonths : context.period.months
      )
    : wholeDataset(selector.dataset)

  const scopedByCondition =
    context.conditionGroups !== null &&
    datasetCarries(selector.dataset, 'condition_group')
  const scopedBySource =
    context.leadSources !== null && datasetCarries(selector.dataset, 'lead_source_code')

  const base = selectRows(source, {
    stores: context.stores,
    ...(scopedByCondition && context.conditionGroups !== null
      ? { conditionGroups: context.conditionGroups }
      : {}),
    ...(scopedBySource && context.leadSources !== null
      ? { leadSources: context.leadSources }
      : {}),
  })

  if (selector.basis === 'month') {
    const wanted = new Set(context.period.wholeMonths)
    return base.filter((row) => {
      const value = row[selector.dateColumn]
      return typeof value === 'string' && wanted.has(value.slice(0, 7))
    })
  }

  const inRange = selectRows(base, {
    dateColumn: selector.dateColumn,
    start: context.period.start,
    end: context.period.end,
  })

  if (selector.basis === 'period') return inRange

  // `snapshot`: one date, the latest the period contains. Semi-additive measures
  // are read at a date, never summed across dates.
  const dates = distinctValues(inRange, selector.dateColumn)
  const latest = dates[dates.length - 1]
  if (latest === undefined) return []
  return inRange.filter((row) => row[selector.dateColumn] === latest)
}

/** The snapshot date a `snapshot`-basis selector resolved to, for labelling. */
export function snapshotDateFor(
  selector: Selector,
  context: MetricContext
): string | null {
  if (selector.basis !== 'snapshot') return null
  const rows = rowsFor(selector, context)
  const first = rows[0]
  if (first === undefined) return null
  const value = first[selector.dateColumn]
  return typeof value === 'string' ? value : null
}

function sumColumn(rows: readonly DashboardRow[], column: string): Exact {
  let total = exactZero(0)
  for (const row of rows) {
    const value = cellToExact(numericCell(row, column))
    if (value === null) continue
    total = addExact(total, value)
  }
  return total
}

/**
 * Evaluate a selector in a context.
 *
 * Every arithmetic operation in the console happens inside this function. A React
 * component receives a {@link MetricResult} and renders it; it never adds.
 */
export function evaluate(selector: Selector, context: MetricContext): MetricResult {
  const rows = rowsFor(selector, context)

  if (rows.length === 0) {
    return {
      kind: 'no-rows',
      reason: 'No exported rows match the selected period, store and filter scope.',
    }
  }

  switch (selector.kind) {
    case 'sum':
      return {
        kind: 'value',
        value: sumColumn(rows, selector.column),
        rowCount: rows.length,
      }

    case 'ratio': {
      let numerator = sumColumn(rows, selector.numeratorColumn)
      if (selector.numeratorFactorColumn !== undefined) {
        const factorColumn = selector.numeratorFactorColumn
        const factors = new Set(rows.map((row) => String(numericCell(row, factorColumn))))
        if (factors.size !== 1) {
          return {
            kind: 'not-derivable',
            reason: `The exported rows in scope carry more than one ${selector.numeratorFactorColumn} value, so a single trailing window cannot be stated.`,
            resolveBy: 'a period whose rows share one trailing window',
          }
        }
        const factor = [...factors][0]
        numerator = multiplyByInteger(numerator, BigInt(factor ?? '1'))
      }
      let denominator = sumColumn(rows, selector.denominatorColumn)
      if (selector.denominatorUnitFactor !== undefined) {
        denominator = multiplyByInteger(
          denominator,
          BigInt(selector.denominatorUnitFactor)
        )
      }
      const quotient = divideExact(numerator, denominator, selector.scale)
      if (quotient === null) {
        return {
          kind: 'null-ratio',
          reason: `The denominator (${selector.denominatorColumn.replace(/_/g, ' ')}) is zero in this scope, so the governed value is null rather than zero.`,
        }
      }
      return { kind: 'value', value: quotient, rowCount: rows.length }
    }

    case 'inventory-turn': {
      if (context.period.wholeMonths.length === 0) {
        return {
          kind: 'not-derivable',
          reason:
            'Inventory turn is exported at month grain and the selected period covers no whole month. A turn figure over part of a month is not a turn figure.',
          resolveBy: 'a period covering at least one whole calendar month',
        }
      }
      // Calendar days and snapshot days are properties of a MONTH, not of a row, so
      // they are counted once per month rather than once per store-condition row.
      const perMonth = new Map<string, { calendarDays: bigint; snapshotDays: bigint }>()
      for (const row of rows) {
        const monthValue = row[selector.dateColumn]
        if (typeof monthValue !== 'string') continue
        if (perMonth.has(monthValue)) continue
        perMonth.set(monthValue, {
          calendarDays: BigInt(String(numericCell(row, selector.calendarDaysColumn))),
          snapshotDays: BigInt(String(numericCell(row, selector.snapshotDaysColumn))),
        })
      }
      let calendarDays = 0n
      let snapshotDays = 0n
      for (const entry of perMonth.values()) {
        calendarDays += entry.calendarDays
        snapshotDays += entry.snapshotDays
      }
      const units = sumColumn(rows, selector.unitsColumn)
      const unitDays = sumColumn(rows, selector.unitDaysColumn)
      // (units × 365 / calendarDays) / (unitDays / snapshotDays)
      const numerator = multiplyByInteger(units, 365n * snapshotDays)
      const denominator = multiplyByInteger(unitDays, calendarDays)
      const quotient = divideExact(numerator, denominator, selector.scale)
      if (quotient === null) {
        return {
          kind: 'null-ratio',
          reason:
            'Average daily active inventory is zero in this scope, so turn is null rather than zero.',
        }
      }
      return { kind: 'value', value: quotient, rowCount: rows.length }
    }

    case 'order-statistic': {
      if (rows.length > 1) {
        return {
          kind: 'not-derivable',
          reason: `${selector.label} is an order statistic. The export publishes it at ${selector.grainDescription}, and an order statistic cannot be combined across groups. A group median is not the average of subgroup medians. ${rows.length} exported values are in scope.`,
          resolveBy: selector.resolveBy,
        }
      }
      const row = rows[0]
      if (row === undefined) {
        return { kind: 'no-rows', reason: 'No exported rows match this scope.' }
      }
      const raw = numericCell(row, selector.column)
      if (raw === null) {
        return {
          kind: 'null-ratio',
          reason: 'The exported population is empty, so the governed value is null.',
        }
      }
      const value = cellToExact(raw)
      if (value === null) {
        return { kind: 'null-ratio', reason: 'The exported value is null.' }
      }
      return { kind: 'value', value, rowCount: 1 }
    }
  }
}

/**
 * A metric with its comparison, ready to render.
 *
 * The difference is only formed when BOTH periods resolved to a value. Comparing a
 * value against a governed null, or against a period that produced no rows, has no
 * arithmetic meaning, and rendering `+100%` for it is the kind of number that ends
 * up in a slide.
 */
export interface ComparedMetric {
  readonly selector: Selector
  readonly current: MetricResult
  readonly prior: MetricResult | null
  readonly difference: Exact | null
  /** Why no difference was formed, when a comparison was requested. */
  readonly differenceUnavailable: string | null
}

export function compareMetric(
  selector: Selector,
  context: MetricContext,
  priorContext: MetricContext | null
): ComparedMetric {
  const current = evaluate(selector, context)
  if (priorContext === null) {
    return {
      selector,
      current,
      prior: null,
      difference: null,
      differenceUnavailable: null,
    }
  }
  const prior = evaluate(selector, priorContext)
  if (!isValue(current) || !isValue(prior)) {
    return {
      selector,
      current,
      prior,
      difference: null,
      differenceUnavailable: !isValue(prior)
        ? 'The comparison period did not resolve to a value, so no difference is shown.'
        : 'This period did not resolve to a value, so no difference is shown.',
    }
  }
  return {
    selector,
    current,
    prior,
    difference: subtractExact(current.value, prior.value),
    differenceUnavailable: null,
  }
}

/** A structurally-absent metric. Used where a store cannot have the measure at all. */
export function notApplicable(reason: string): MetricResult {
  return { kind: 'not-applicable', reason }
}

/** An exact integer as a metric value, for counts the page derives from row counts. */
export function metricValue(count: number): MetricResult {
  return { kind: 'value', value: exactFromInteger(count), rowCount: 1 }
}
