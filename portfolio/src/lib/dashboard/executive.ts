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
import { kpis } from '@/lib/content'
import type { KpiEntry } from '@/types/content'

import { accountingExceptionRows, glReconciliationRows } from './accounting-data'
import {
  CONTROLLED_SCENARIO_NOTE,
  resolveComparisonDate,
  selectComparisons,
  summarize,
  toComparisonRows,
  toExceptionRows,
  varianceDirection,
  type ComparisonRow,
  type ReconciliationSummary,
} from './accounting'
import {
  calendarMonths,
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
import { formatIsoMonth } from './format'
import {
  calendarWindow,
  resolvePeriod,
  type PeriodContext,
  type ResolvedPeriod,
} from './periods'
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
/* The trailing window                                                         */
/* -------------------------------------------------------------------------- */

/** How many months of shape a card and the operating trend carry. */
export const TRAILING_MONTHS = 6

/** One month of the trailing window, resolved against the governed calendar. */
export interface TrailingMonth {
  readonly key: string
  readonly label: string
  readonly period: ResolvedPeriod
  /** True for the month the selected period resolves to, where it resolves to one. */
  readonly isCurrent: boolean
}

/**
 * The trailing months a shape is drawn over, anchored on the selected period.
 *
 * ANCHORED, NOT FIXED. A window that was always the six exported months would draw the
 * same picture for every period selection, and a picture that does not move when the
 * filter moves is a decoration. This ends at the last month the selected period touches
 * and runs back from there, so selecting September genuinely shortens it — which is
 * both the honest behaviour and the one the visual-binding tests can prove.
 *
 * EVERY MONTH IS RESOLVED BY `resolvePeriod` AGAINST THE EXPORT'S OWN CALENDAR, so a
 * column's selling-day count, month boundaries and label come from the same place the
 * selected period's did. Nothing here constructs a date, and nothing here does
 * arithmetic: this module may not, and does not need to.
 */
export function trailingMonths(
  periodContext: PeriodContext,
  count: number = TRAILING_MONTHS
): readonly TrailingMonth[] {
  const touched = periodContext.period.months
  const anchor = touched[touched.length - 1] ?? calendarMonths[calendarMonths.length - 1]
  if (anchor === undefined) return []

  const upToAnchor = calendarMonths.filter((month) => month <= anchor)
  const window = upToAnchor.slice(Math.max(upToAnchor.length - count, 0))

  /*
   * "Current" means the selected period resolves to exactly this one month. A range
   * spanning three months marks none of them, and the accessible sentence says so
   * rather than picking the last and implying the reader chose it.
   */
  const selected = touched.length === 1 ? touched[0] : null

  return window.map((month) => ({
    key: month,
    label: formatIsoMonth(month),
    period: resolvePeriod({ kind: 'month', month }, 'none', reportingCalendar).period,
    isCurrent: month === selected,
  }))
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

/** One month of a card's own shape. */
export interface MicroTrendSample {
  readonly key: string
  readonly label: string
  readonly result: MetricResult
  readonly isCurrent: boolean
}

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
  /**
   * The card's shape over the trailing months, at the same scope as its value.
   *
   * Every sample is the card's OWN selector evaluated over one month — never a second
   * formula, never a smoothed series, and never a value carried over from a neighbouring
   * month. A month the selector declines renders as a gap.
   */
  readonly microTrend: readonly MicroTrendSample[]
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
  /**
   * The governed totals, carried as the composition DENOMINATORS and shown nowhere.
   *
   * A component may not add two segments together to find the whole it is a share of
   * (`dashboard-boundaries.test.ts`), and a denominator assembled from the parts could
   * disagree with the total the KPI row already prints. So both totals come from their
   * own governed selector, and neither is rendered a second time: a console that shows
   * the same figure twice on one screen invites a reader to check whether the two agree.
   */
  readonly totalGross: ComparedMetric
  readonly retailUnits: ComparedMetric
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
/* The operating trend                                                         */
/* -------------------------------------------------------------------------- */

/** One month of the operating trend. */
export interface TrendBucket {
  readonly key: string
  readonly label: string
  readonly isCurrent: boolean
  readonly retailUnits: MetricResult
  readonly totalGross: MetricResult
}

/* -------------------------------------------------------------------------- */
/* Store comparison                                                            */
/* -------------------------------------------------------------------------- */

export interface StoreComparisonRow {
  readonly store: DashboardStore
  readonly result: MetricResult
}

/**
 * One governed measure across the stores in scope.
 *
 * The measure is CHOSEN HERE rather than by a URL parameter, and deliberately. The
 * console has one filter grammar shared by every route (`INFORMATION_ARCHITECTURE.md`
 * §6), and a fourteenth parameter that existed only to swap which measure a chart drew
 * would be a route-local presentation toggle wearing the clothes of a console-wide
 * filter. Two comparisons are rendered — volume and gross per retail unit — because
 * those are the two a general manager compares three stores on; the other eight governed
 * columns are in the scoreboard below, which is what a table is for.
 */
export interface StoreComparison {
  readonly id: string
  readonly label: string
  readonly selector: Selector
  readonly rows: readonly StoreComparisonRow[]
}

/* -------------------------------------------------------------------------- */
/* Accounting integrity                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The Executive Overview's accounting signal.
 *
 * WHY THE NARROW DATASET IS THE WHOLE ANSWER. `accounting-data.ts` records the finding
 * this depends on: the GL-versus-subledger comparison is 43 rows, so "the narrow set IS
 * the Executive summary and no second aggregate had to be invented for it". This route
 * therefore opens that door and no other — it does NOT import `accounting-chunks.ts`,
 * whose 360 kB of per-unit book values belong to `/dashboard/accounting`.
 *
 * IT IS A POSITION AT ONE DATE. `accounting.ts` rule 3: the balances are semi-additive,
 * so a period resolves to the LAST comparable comparison date inside it and never to a
 * sum over it. The section states the date for the same reason the inventory section
 * states its snapshot.
 */
export interface ReconciliationSignal {
  readonly summary: ReconciliationSummary
  readonly accounts: readonly ComparisonRow[]
  /** The direction of the signed total, in words, from the governed helper. */
  readonly directionText: string
  /** Exceptions raised inside the selected period and store scope. */
  readonly exceptionCount: number
  /** The disclosure both accounting surfaces must carry. */
  readonly scenarioNote: string
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
  /** The months every shape on the page is drawn over, anchored on the selection. */
  readonly trailing: readonly TrailingMonth[]
  readonly trend: readonly TrendBucket[]
  readonly comparisons: readonly StoreComparison[]
  readonly reconciliation: ReconciliationSignal
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

  /*
   * The trailing window, resolved once and shared by every shape on the page.
   *
   * One resolution rather than one per card: seven cards and a trend that each built
   * their own window could disagree about which months they were drawn over, and a
   * disagreement of that kind is invisible until somebody counts the columns.
   */
  const trailing = trailingMonths(periodContext)
  const sample = (selector: Selector): readonly MicroTrendSample[] =>
    trailing.map((month) => ({
      key: month.key,
      label: month.label,
      result: evaluate(selector, { ...context, period: month.period }),
      isCurrent: month.isCurrent,
    }))

  const cards: readonly KpiCard[] = [
    buildCard(
      'retailUnits',
      'Retail units',
      SELECTORS.retailUnits,
      compare,
      null,
      sample
    ),
    buildCard('totalGross', 'Total gross', SELECTORS.totalGross, compare, null, sample),
    buildCard(
      'totalPvr',
      'Total gross per retail unit',
      SELECTORS.totalPvr,
      compare,
      null,
      sample
    ),
    buildCard(
      'backPvr',
      'Back gross per retail unit',
      SELECTORS.backPvr,
      compare,
      null,
      sample
    ),
    buildCard(
      'leadToSale',
      'Lead-to-sale conversion',
      SELECTORS.leadToSale,
      compare,
      'Lead-creation cohort: a lead created in the period counts here even if it sells later.',
      sample
    ),
    buildCard(
      'medianInventoryAge',
      'Median inventory age',
      SELECTORS.medianInventoryAge,
      compare,
      joinNotes(snapshotNote, conditionNote),
      sample
    ),
    buildCard(
      'agedInventoryPercentage',
      'Aged inventory percentage',
      SELECTORS.agedInventoryPercentage,
      compare,
      joinNotes(snapshotNote, conditionNote),
      sample
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
    totalGross: compare(SELECTORS.totalGross),
    retailUnits: compare(SELECTORS.retailUnits),
  }
  const inventory = buildInventory(
    context,
    priorContext,
    scope,
    conditionGroups,
    snapshotDate
  )
  const funnel = buildFunnel(compare, context)

  /* ---- the operating trend ---------------------------------------------- */
  const trend: readonly TrendBucket[] = trailing.map((month) => {
    const monthContext: MetricContext = { ...context, period: month.period }
    return {
      key: month.key,
      label: month.label,
      isCurrent: month.isCurrent,
      retailUnits: evaluate(SELECTORS.retailUnits, monthContext),
      totalGross: evaluate(SELECTORS.totalGross, monthContext),
    }
  })

  /* ---- the store comparison --------------------------------------------- */
  const comparisons: readonly StoreComparison[] = COMPARISON_MEASURES.map((measure) => ({
    id: measure.id,
    label: measure.label,
    selector: measure.selector,
    rows: scope.stores.map((store) => ({
      store,
      result: applyStructuralAbsence(
        store,
        measure.selector,
        conditionGroups,
        evaluate(measure.selector, { ...context, stores: [store.id] })
      ),
    })),
  }))

  const reconciliation = buildReconciliation(filters, periodContext)

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
    trailing,
    trend,
    comparisons,
    reconciliation,
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
  scopeNote: string | null,
  sample: (selector: Selector) => readonly MicroTrendSample[]
): KpiCard {
  return {
    id,
    label,
    kpiId: selector.kpiId,
    metric: compare(selector),
    definitionHref: selector.kpiId === null ? null : kpiDefinitionHref(selector.kpiId),
    definition: selector.kpiId === null ? undefined : kpiDefinition(selector.kpiId),
    scopeNote,
    microTrend: sample(selector),
  }
}

/* -------------------------------------------------------------------------- */
/* The compared measures                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The two measures three stores are compared on, side by side.
 *
 * Volume and gross per retail unit: one says how big a store is and the other says how
 * well it converts that size into money, and between them they separate "smaller" from
 * "worse" — which is the distinction a scoreboard row cannot make at a glance. Both are
 * governed KPIs with reconciliation keys. Everything else is the table below.
 */
const COMPARISON_MEASURES: readonly {
  readonly id: string
  readonly label: string
  readonly selector: Selector
}[] = [
  { id: 'retailUnits', label: 'Retail units', selector: SELECTORS.retailUnits },
  { id: 'totalPvr', label: 'Total gross per retail unit', selector: SELECTORS.totalPvr },
]

/* -------------------------------------------------------------------------- */
/* Accounting assembly                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The reconciliation position for the selected period and store scope.
 *
 * Every decision here belongs to `accounting.ts` and is called rather than reimplemented:
 * which comparison date a period resolves to, which rows a store filter keeps, and how
 * the four states are counted. This function chooses nothing except which exceptions
 * fall inside the period, which is a date comparison on the export's own column.
 */
function buildReconciliation(
  filters: DashboardFilters,
  periodContext: PeriodContext
): ReconciliationSignal {
  const rows = toComparisonRows(glReconciliationRows())
  const comparisonDate = resolveComparisonDate(rows, filters)
  const accounts = selectComparisons(rows, comparisonDate, filters)
  const summary = summarize(accounts, comparisonDate)

  const stores = new Set(filters.store)
  const exceptions = toExceptionRows(accountingExceptionRows()).filter(
    (row) =>
      (stores.size === 0 || stores.has(row.dealershipId)) &&
      row.exceptionDate >= periodContext.period.start &&
      row.exceptionDate <= periodContext.period.end
  )

  return {
    summary,
    accounts,
    directionText: varianceDirection(summary.signedVariance),
    exceptionCount: exceptions.length,
    scenarioNote: CONTROLLED_SCENARIO_NOTE,
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
