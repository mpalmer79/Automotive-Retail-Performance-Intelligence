/**
 * The Executive Overview view model.
 *
 * WHAT THIS IS, AND WHY IT IS NOT A GENERATED PAYLOAD
 * ---------------------------------------------------
 * `DASH.1` deliberately did not write `executive-summary.json`, because "a page
 * payload is a presentation decision owned by its route and preaggregating KPI
 * values in TypeScript would violate ADR-0013 condition 2". That reasoning still
 * holds, and it points at a selector layer rather than at a second generation
 * stage: this module decides WHICH governed selectors the page shows and in what
 * order, and `selectors.ts` decides what each one is allowed to add up. Nothing is
 * precomputed, nothing is persisted, and there is no second source of a KPI value.
 *
 * It runs on the server. The route renders its output; the one client island on the
 * page receives filter options and never sees a dataset.
 *
 * THE STRUCTURAL-ABSENCE RULE
 * ---------------------------
 * Granite Pre-Owned Center of Merrimack is an independent used-vehicle store. It has
 * no franchise, so it has no new-vehicle allocation, no new inventory and no
 * new-unit sales — and its new-vehicle cells must read "Not applicable", never `0`.
 * A zero is a measurement; this is a property of the operating model, and a
 * scoreboard that prints `0` there ranks a store last for not being in a business
 * it was never in. `isFranchise` comes from the exported store dimension, so the
 * rule is read from the data rather than assumed from a name.
 */
import { glReconciliationRows } from '@/lib/dashboard/accounting-data'
import {
  resolveComparisonDate,
  selectComparisons,
  summarize,
  toComparisonRows,
  varianceDirection,
} from '@/lib/dashboard/accounting'
import { formatCurrencyDifference, formatIsoDate } from '@/lib/dashboard/format'
import type { ReconciliationSignalView } from '@/components/dashboard/reconciliation-signal'
import { kpis } from '@/lib/content'
import type { KpiEntry } from '@/types/content'

import {
  chunkedDataset,
  dashboardCalendar,
  dashboardManifest,
  dashboardStoreIds,
  dashboardStores,
  distinctValues,
  numericCell,
  selectRows,
  textCell,
  type DashboardStore,
} from './data'
import { addExact, cellToExact, exactZero, type Exact } from './decimal'
import {
  EXECUTIVE_OVERVIEW_SUPPORT,
  activeFilterChips,
  type ActiveFilterChip,
  type DashboardFilters,
  type FilterReset,
} from './filters'
import { calendarWindow, resolvePeriod, type PeriodContext } from './periods'
import {
  buildStoreTargetContexts,
  buildTargetContext,
  type StoreTargetContext,
  type TargetContext,
} from './targets'
import {
  SELECTORS,
  compareMetric,
  evaluate,
  notApplicable,
  snapshotDateFor,
  type ComparedMetric,
  type MetricContext,
  type MetricResult,
  type Selector,
} from './selectors'

/* -------------------------------------------------------------------------- */
/* KPI definitions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The governed definition behind a KPI id.
 *
 * `src/content/kpis.json` is the repository's machine-readable extract of
 * KPI_CATALOG.md, already cross-checked against the catalogue and the semantic
 * model by `scripts/generate-project-manifest.ts` on every build — "if a KPI here
 * does not exist in KPI_CATALOG.md, or maps to a measure the model does not define,
 * the build fails". The console reuses it rather than keeping a second copy, and
 * nothing fetches Markdown at runtime.
 */
export function kpiDefinition(kpiId: string): KpiEntry | undefined {
  return kpis.find((entry) => entry.id === kpiId)
}

/** The catalogue anchor for a KPI. A real destination, not a placeholder route. */
export function kpiDefinitionHref(kpiId: string): string {
  return `/kpis#${kpiId}`
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

export interface StoreScope {
  readonly ids: readonly string[]
  readonly stores: readonly DashboardStore[]
  readonly isGroup: boolean
  readonly label: string
}

function resolveStoreScope(filters: DashboardFilters): StoreScope {
  const ids = filters.store.length === 0 ? dashboardStoreIds : filters.store
  const stores = dashboardStores.filter((store) => ids.includes(store.id))
  return {
    ids,
    stores,
    isGroup: filters.store.length === 0,
    label:
      filters.store.length === 0
        ? 'Granite Auto Group, all three stores'
        : stores.map((store) => store.shortName).join(', '),
  }
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

export interface KpiCard {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  readonly metric: ComparedMetric
  /** Where "How is this calculated?" and the drill-through point. */
  readonly definitionHref: string | null
  readonly definition: KpiEntry | undefined
  /** Extra scope the reader needs: the snapshot date, the condition filter. */
  readonly scopeNote: string | null
}

/* -------------------------------------------------------------------------- */
/* Scoreboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface ScoreboardColumn {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  readonly selector: Selector
  /** A short note rendered under the column heading, where one is needed. */
  readonly note?: string
}

export interface ScoreboardCell {
  readonly column: ScoreboardColumn
  readonly result: MetricResult
}

export interface ScoreboardRow {
  readonly store: DashboardStore
  readonly cells: readonly ScoreboardCell[]
  /**
   * The store's own target context, for the scoreboard's compact pace cell.
   *
   * Built by the same function the group card uses, called with a single store, so a
   * cell and a card can never disagree about what one store's attainment is.
   */
  readonly target: StoreTargetContext
}

/**
 * The scoreboard's columns.
 *
 * Median response time (KPI-FUN-008) is deliberately NOT one of them, and the note
 * on the response column says why: the export publishes that median at store ×
 * lead source × lead-creation date, so no store-level median exists to read and one
 * cannot be formed from the ones that do. Average response time (KPI-FUN-007) is a
 * ratio of two additive columns and is exact at any scope, so it is the column that
 * can be honest. The median is on the page — in the funnel section, with the scope
 * that resolves it.
 */
export const SCOREBOARD_COLUMNS: readonly ScoreboardColumn[] = [
  {
    id: 'retailUnits',
    label: 'Retail units',
    kpiId: 'KPI-SLS-001',
    selector: SELECTORS.retailUnits,
  },
  {
    id: 'newUnits',
    label: 'New units',
    kpiId: 'KPI-SLS-002',
    selector: SELECTORS.newUnits,
    note: 'Not applicable to the independent store, which holds no franchise.',
  },
  {
    id: 'frontPvr',
    label: 'Front PVR',
    kpiId: 'KPI-GRS-004',
    selector: SELECTORS.frontPvr,
  },
  { id: 'backPvr', label: 'Back PVR', kpiId: 'KPI-GRS-005', selector: SELECTORS.backPvr },
  {
    id: 'totalPvr',
    label: 'Total PVR',
    kpiId: 'KPI-GRS-006',
    selector: SELECTORS.totalPvr,
  },
  {
    id: 'leadToSale',
    label: 'Lead-to-sale',
    kpiId: 'KPI-FUN-006',
    selector: SELECTORS.leadToSale,
    note: 'Lead cohort, by creation date.',
  },
  {
    id: 'agedInventoryPercentage',
    label: 'Aged inventory',
    kpiId: 'KPI-INV-006',
    selector: SELECTORS.agedInventoryPercentage,
  },
  {
    id: 'daysSupply',
    label: 'Days supply',
    kpiId: 'KPI-INV-009',
    selector: SELECTORS.daysSupply,
    note: 'Trailing 30 days, a project default.',
  },
  {
    id: 'inventoryTurn',
    label: 'Inventory turn',
    kpiId: 'KPI-INV-008',
    selector: SELECTORS.inventoryTurn,
    note: 'Annualized, whole months only.',
  },
  {
    id: 'averageResponseMinutes',
    label: 'Average response',
    kpiId: 'KPI-FUN-007',
    selector: SELECTORS.averageResponseMinutes,
    note: 'The median (KPI-FUN-008) is an order statistic published only at store, source and day; see the funnel section.',
  },
]

/** Selector ids whose subject is new vehicles, for the structural-absence rule. */
const NEW_VEHICLE_SELECTORS = new Set<string>(['newUnits'])

/**
 * Replace a measured zero with a structural absence where the store cannot have the
 * measure at all.
 *
 * Two cases, both read from the data. A new-unit measure at a store with no
 * franchise. And any inventory measure filtered to the `New` condition group at a
 * store that has no `New` rows in the export because it never stocks one.
 */
function applyStructuralAbsence(
  store: DashboardStore,
  selector: Selector,
  conditionGroups: readonly string[] | null,
  result: MetricResult
): MetricResult {
  if (store.isFranchise) return result
  const reason = `${store.name} is an independent used-vehicle store with no franchise, so it has no new-vehicle allocation, no new inventory and no new-unit sales. The absence is structural, not a measured zero.`
  if (NEW_VEHICLE_SELECTORS.has(selector.id)) return notApplicable(reason)
  if (
    conditionGroups !== null &&
    conditionGroups.length === 1 &&
    conditionGroups[0] === 'New' &&
    result.kind === 'no-rows'
  ) {
    return notApplicable(reason)
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* Sales and gross, in brief                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The compact gross composition the Executive Overview carries.
 *
 * Five exported totals and nothing derived from them beyond the governed
 * per-unit ratios. There is no trend and no change bridge: a bridge needs the
 * driver model `DASH.3` builds, and one assembled here from two period totals
 * would be a different calculation wearing the same name.
 */
export interface SalesGrossSummary {
  readonly newUnits: ComparedMetric
  readonly usedUnits: ComparedMetric
  readonly frontGross: ComparedMetric
  readonly backGross: ComparedMetric
  readonly frontPvr: ComparedMetric
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

export interface AgeBucket {
  readonly label: string
  readonly sortOrder: number
  readonly units: Exact
  readonly share: number
}

export interface GovernedMedian {
  readonly store: DashboardStore
  readonly conditionGroup: string
  readonly value: MetricResult
}

export interface InventorySummary {
  readonly snapshotDate: string | null
  readonly agedThresholdDays: number | null
  readonly activeUnits: ComparedMetric
  readonly investment: ComparedMetric
  readonly averageAge: ComparedMetric
  readonly medianAge: ComparedMetric
  readonly agedUnits: ComparedMetric
  readonly agedInvestment: ComparedMetric
  readonly agedPercentage: ComparedMetric
  readonly daysSupply: ComparedMetric
  readonly turn: ComparedMetric
  readonly buckets: readonly AgeBucket[]
  /** Every governed median in scope, at the grain the export publishes it. */
  readonly governedMedians: readonly GovernedMedian[]
}

/* -------------------------------------------------------------------------- */
/* Funnel                                                                      */
/* -------------------------------------------------------------------------- */

export interface FunnelStage {
  readonly id: string
  readonly label: string
  readonly result: MetricResult
  /** The governed rate against leads received, where one exists for this stage. */
  readonly rate: ComparedMetric | null
}

export interface FunnelSummary {
  readonly stages: readonly FunnelStage[]
  readonly leadToSale: ComparedMetric
  readonly medianResponse: ComparedMetric
  readonly averageResponse: ComparedMetric
  readonly respondedLeads: ComparedMetric
  readonly unrespondedLeads: ComparedMetric
  readonly responseBands: readonly {
    readonly label: string
    readonly result: MetricResult
  }[]
}

/* -------------------------------------------------------------------------- */
/* The overview                                                                */
/* -------------------------------------------------------------------------- */

export interface ExecutiveOverview {
  readonly filters: DashboardFilters
  readonly resets: readonly FilterReset[]
  readonly chips: readonly ActiveFilterChip[]
  readonly periodContext: PeriodContext
  readonly scope: StoreScope
  readonly conditionGroups: readonly string[] | null
  readonly leadSources: readonly string[] | null
  readonly cards: readonly KpiCard[]
  /**
   * Targets, attainment and the selling-day clock for the selected scope.
   *
   * Secondary management context, never the headline: `cards` carries the actual, and
   * this carries what the store committed to. When the active filter changes the actual
   * population without changing the plan, `comparability` says so and `measures` is
   * empty, so the page renders the sentence rather than a valid percentage of the wrong
   * thing.
   */
  readonly targets: TargetContext
  readonly scoreboard: readonly ScoreboardRow[]
  readonly salesGross: SalesGrossSummary
  readonly inventory: InventorySummary
  readonly funnel: FunnelSummary
  /** True when no dataset in scope produced a single row. */
  readonly empty: boolean
  /**
   * The export's own as-of date.
   *
   * On the view model rather than read from the manifest by a component, so the
   * date in the context header and the date every period was resolved against are
   * the same value. The control options a route needs come from `data.ts`
   * directly - they are dimension lookups, not part of this page's state.
   */
  readonly asOfDate: string
}

/** The calendar window the console resolves every period against. */
export const reportingCalendar = calendarWindow(
  dashboardCalendar,
  dashboardManifest.asOfDate
)

/**
 * Build the whole page's view model from a parsed filter state.
 *
 * One function, called once per request, so every figure on the page shares one
 * period resolution and one store scope. A component that resolved its own scope
 * could disagree with the context header, and a disagreement of that kind is
 * invisible until somebody checks a total by hand.
 */
export function buildExecutiveOverview(
  filters: DashboardFilters,
  resets: readonly FilterReset[]
): ExecutiveOverview {
  const periodContext = resolvePeriod(filters.period, filters.compare, reportingCalendar)
  const scope = resolveStoreScope(filters)
  const conditionGroups = filters.condition === null ? null : [filters.condition]
  const leadSources = filters.source === null ? null : [filters.source]

  const context: MetricContext = {
    stores: scope.ids,
    conditionGroups,
    leadSources,
    period: periodContext.period,
  }
  const priorContext: MetricContext | null =
    periodContext.comparison === null
      ? null
      : { ...context, period: periodContext.comparison }

  const compare = (selector: Selector): ComparedMetric =>
    compareMetric(selector, context, priorContext)

  const snapshotDate = snapshotDateFor(SELECTORS.activeInventory, context)
  const snapshotNote =
    snapshotDate === null
      ? null
      : `At the ${snapshotDate} inventory snapshot. A semi-additive measure read at one date, never summed across dates.`
  const conditionNote =
    filters.condition === null
      ? null
      : `Condition scope: ${filters.condition} inventory only.`

  const cards: readonly KpiCard[] = [
    buildCard('retailUnits', 'Retail units', SELECTORS.retailUnits, compare, null),
    buildCard('totalGross', 'Total gross', SELECTORS.totalGross, compare, null),
    buildCard(
      'totalPvr',
      'Total gross per retail unit',
      SELECTORS.totalPvr,
      compare,
      null
    ),
    buildCard('backPvr', 'Back gross per retail unit', SELECTORS.backPvr, compare, null),
    buildCard(
      'leadToSale',
      'Lead-to-sale conversion',
      SELECTORS.leadToSale,
      compare,
      'Lead-creation cohort: a lead created in the period counts here even if it sells later.'
    ),
    buildCard(
      'medianInventoryAge',
      'Median inventory age',
      SELECTORS.medianInventoryAge,
      compare,
      joinNotes(snapshotNote, conditionNote)
    ),
    buildCard(
      'agedInventoryPercentage',
      'Aged inventory percentage',
      SELECTORS.agedInventoryPercentage,
      compare,
      joinNotes(snapshotNote, conditionNote)
    ),
  ]

  const targets = buildTargetContext(filters, periodContext.period, scope.ids)
  const storeTargets = buildStoreTargetContexts(filters, periodContext.period, scope.ids)

  const scoreboard: readonly ScoreboardRow[] = scope.stores.map((store) => {
    const storeContext: MetricContext = { ...context, stores: [store.id] }
    return {
      store,
      cells: SCOREBOARD_COLUMNS.map((column) => ({
        column,
        result: applyStructuralAbsence(
          store,
          column.selector,
          conditionGroups,
          evaluate(column.selector, storeContext)
        ),
      })),
      target: storeTargets.find((entry) => entry.storeId === store.id) ?? {
        storeId: store.id,
        measures: [],
        clock: null,
      },
    }
  })

  const salesGross: SalesGrossSummary = {
    newUnits: compare(SELECTORS.newUnits),
    usedUnits: compare(SELECTORS.usedUnits),
    frontGross: compare(SELECTORS.frontGross),
    backGross: compare(SELECTORS.backGross),
    frontPvr: compare(SELECTORS.frontPvr),
  }
  const inventory = buildInventory(
    context,
    priorContext,
    scope,
    conditionGroups,
    snapshotDate
  )
  const funnel = buildFunnel(compare, context)

  /*
   * Empty means every dataset in scope produced nothing, which is a filter result
   * and not a data failure. It is deliberately not "the first card is zero": a
   * period in which the group sold no cars is a real answer, and an empty state
   * over it would hide a fact rather than report one.
   */
  const empty =
    cards.every((card) => card.metric.current.kind === 'no-rows') &&
    inventory.activeUnits.current.kind === 'no-rows' &&
    funnel.stages.every((stage) => stage.result.kind === 'no-rows')

  return {
    filters,
    resets,
    chips: activeFilterChips(filters, EXECUTIVE_OVERVIEW_SUPPORT),
    periodContext,
    scope,
    conditionGroups,
    leadSources,
    cards,
    targets,
    scoreboard,
    salesGross,
    inventory,
    funnel,
    empty,
    asOfDate: dashboardManifest.asOfDate,
  }
}

function joinNotes(...notes: readonly (string | null)[]): string | null {
  const present = notes.filter((note): note is string => note !== null)
  return present.length === 0 ? null : present.join(' ')
}

function buildCard(
  id: string,
  label: string,
  selector: Selector,
  compare: (selector: Selector) => ComparedMetric,
  scopeNote: string | null
): KpiCard {
  return {
    id,
    label,
    kpiId: selector.kpiId,
    metric: compare(selector),
    definitionHref: selector.kpiId === null ? null : kpiDefinitionHref(selector.kpiId),
    definition: selector.kpiId === null ? undefined : kpiDefinition(selector.kpiId),
    scopeNote,
  }
}

/* -------------------------------------------------------------------------- */
/* Inventory assembly                                                          */
/* -------------------------------------------------------------------------- */

function buildInventory(
  context: MetricContext,
  priorContext: MetricContext | null,
  scope: StoreScope,
  conditionGroups: readonly string[] | null,
  snapshotDate: string | null
): InventorySummary {
  const compare = (selector: Selector): ComparedMetric =>
    compareMetric(selector, context, priorContext)

  const healthRows = chunkedDataset('inventory-health', scope.ids, context.period.months)
  const scoped = selectRows(healthRows, {
    stores: scope.ids,
    ...(conditionGroups === null ? {} : { conditionGroups }),
    dateColumn: 'snapshot_date',
    ...(snapshotDate === null ? {} : { start: snapshotDate, end: snapshotDate }),
  })

  const thresholds = new Set(
    scoped.map((row) => Number(numericCell(row, 'aged_threshold_days') ?? 0))
  )
  const agedThresholdDays = thresholds.size === 1 ? ([...thresholds][0] ?? null) : null

  /*
   * Every governed median in scope, at the grain the export publishes it.
   *
   * This is the "available valid scope" the console shows instead of inventing a
   * group median: one row per store per condition group at the snapshot date, each
   * one a value PostgreSQL computed with PERCENTILE_CONT over the units themselves.
   */
  const governedMedians: GovernedMedian[] = []
  for (const store of scope.stores) {
    const storeRows = scoped.filter((row) => row.dealership_id === store.id)
    const groups = distinctValues(storeRows, 'condition_group')
    for (const group of groups) {
      const row = storeRows.find((entry) => entry.condition_group === group)
      if (row === undefined) continue
      const raw = numericCell(row, 'median_inventory_age')
      const value = raw === null ? null : cellToExact(raw)
      governedMedians.push({
        store,
        conditionGroup: group,
        value:
          value === null
            ? { kind: 'null-ratio', reason: 'The exported population is empty.' }
            : { kind: 'value', value, rowCount: 1 },
      })
    }
    if (
      !store.isFranchise &&
      (conditionGroups === null || conditionGroups.includes('New'))
    ) {
      governedMedians.push({
        store,
        conditionGroup: 'New',
        value: notApplicable(
          `${store.name} holds no franchise and therefore stocks no new vehicles. The absence is structural, not a measured zero.`
        ),
      })
    }
  }

  /* ---- age distribution ------------------------------------------------- */
  const agingRows = chunkedDataset('inventory-aging', scope.ids, context.period.months)
  const agingScoped = selectRows(agingRows, {
    stores: scope.ids,
    ...(conditionGroups === null ? {} : { conditionGroups }),
    dateColumn: 'snapshot_date',
    ...(snapshotDate === null ? {} : { start: snapshotDate, end: snapshotDate }),
  })
  const bucketTotals = new Map<string, { sortOrder: number; units: Exact }>()
  for (const row of agingScoped) {
    const label = textCell(row, 'age_bucket')
    const sortOrder = Number(numericCell(row, 'age_bucket_sort_order') ?? 0)
    const units = cellToExact(numericCell(row, 'units_in_bucket')) ?? exactZero(0)
    const existing = bucketTotals.get(label)
    bucketTotals.set(label, {
      sortOrder,
      units: existing === undefined ? units : addExact(existing.units, units),
    })
  }
  let bucketGrandTotal = 0
  for (const entry of bucketTotals.values()) bucketGrandTotal += Number(entry.units.units)
  const buckets: AgeBucket[] = [...bucketTotals.entries()]
    .map(([label, entry]) => ({
      label,
      sortOrder: entry.sortOrder,
      units: entry.units,
      // Geometry only. The unit counts beside each bar are the exact values.
      share: bucketGrandTotal === 0 ? 0 : Number(entry.units.units) / bucketGrandTotal,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return {
    snapshotDate,
    agedThresholdDays,
    activeUnits: compare(SELECTORS.activeInventory),
    investment: compare(SELECTORS.inventoryInvestment),
    averageAge: compare(SELECTORS.averageInventoryAge),
    medianAge: compare(SELECTORS.medianInventoryAge),
    agedUnits: compare(SELECTORS.agedInventoryUnits),
    agedInvestment: compare(SELECTORS.agedInventoryInvestment),
    agedPercentage: compare(SELECTORS.agedInventoryPercentage),
    daysSupply: compare(SELECTORS.daysSupply),
    turn: compare(SELECTORS.inventoryTurn),
    buckets,
    governedMedians,
  }
}

/* -------------------------------------------------------------------------- */
/* Funnel assembly                                                             */
/* -------------------------------------------------------------------------- */

function buildFunnel(
  compare: (selector: Selector) => ComparedMetric,
  context: MetricContext
): FunnelSummary {
  const stages: readonly FunnelStage[] = [
    {
      id: 'leads',
      label: 'Leads',
      result: evaluate(SELECTORS.leadsReceived, context),
      rate: null,
    },
    {
      id: 'contacted',
      label: 'Contacted',
      result: evaluate(SELECTORS.contactedLeads, context),
      rate: compare(SELECTORS.contactRate),
    },
    {
      id: 'appointment-set',
      label: 'Appointment set',
      result: evaluate(SELECTORS.appointmentSetLeads, context),
      rate: compare(SELECTORS.appointmentSetRate),
    },
    {
      id: 'showed',
      label: 'Showed',
      result: evaluate(SELECTORS.appointmentShownLeads, context),
      // No governed rate is published for this stage against leads received. Show
      // rate (KPI-FUN-004) has a different denominator - eligible appointments -
      // and belongs to the appointment dataset, so putting it here would relabel a
      // measure rather than report one.
      rate: null,
    },
    {
      id: 'sold',
      label: 'Sold',
      result: evaluate(SELECTORS.soldLeads, context),
      rate: compare(SELECTORS.leadToSale),
    },
  ]

  return {
    stages,
    leadToSale: compare(SELECTORS.leadToSale),
    medianResponse: compare(SELECTORS.medianResponseMinutes),
    averageResponse: compare(SELECTORS.averageResponseMinutes),
    respondedLeads: compare(SELECTORS.respondedLeads),
    unrespondedLeads: compare(SELECTORS.unrespondedLeads),
    responseBands: [
      { label: 'Under 5 minutes', result: evaluate(SELECTORS.responsesUnder5, context) },
      { label: '5 to 15 minutes', result: evaluate(SELECTORS.responses5to15, context) },
      { label: '15 to 60 minutes', result: evaluate(SELECTORS.responses15to60, context) },
      { label: 'Over 60 minutes', result: evaluate(SELECTORS.responsesOver60, context) },
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* The accounting signal (DASH.9)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build the Executive reconciliation signal.
 *
 * WHY IT READS THE NARROW DOOR AND NOTHING ELSE
 * ---------------------------------------------
 * `accounting-data.ts` carries 43 comparison rows and 18 kB. That IS the whole comparison
 * surface, so the Executive card needs no second aggregate invented for it — which would
 * have meant a second definition of the same figure, computed somewhere else, free to
 * disagree. `/dashboard` must never open `inventory-chunks.ts` or `accounting-chunks.ts`,
 * which carry 356 kB and 360 kB of per-unit detail it has no use for, and
 * `dashboard-boundaries.test.ts` asserts exactly that.
 *
 * EVERYTHING LEAVES HERE AS A STRING. The card is a component and no component may touch an
 * exact decimal, so the sign, the grouping and the direction sentence are decided here.
 *
 * THE MISSING SIDES ARE COUNTED, NOT ADDED. A position with one side absent has no variance,
 * so it contributes to no money figure and is reported as its own count. Folding it in would
 * turn "could not be compared" into "off by this much", which is a different claim.
 */
export function buildAccountingSignal(
  filters: DashboardFilters
): ReconciliationSignalView {
  const rows = toComparisonRows(glReconciliationRows())
  const comparisonDate = resolveComparisonDate(rows, filters)
  const selected = selectComparisons(rows, comparisonDate, filters)
  const summary = summarize(selected, comparisonDate)

  return {
    asOfLabel: comparisonDate === null ? null : formatIsoDate(comparisonDate),
    signedVarianceLabel:
      summary.comparablePositions === 0
        ? null
        : formatCurrencyDifference(summary.signedVariance, 2),
    directionSentence:
      summary.comparablePositions === 0
        ? 'No position at this date has both sides, so no variance exists'
        : varianceDirection(summary.signedVariance),
    comparablePositions: summary.comparablePositions,
    reconciledPositions: summary.reconciledPositions,
    variancePositions: summary.variancePositions,
    notComparablePositions:
      summary.missingGlPositions + summary.missingSubledgerPositions,
  }
}
