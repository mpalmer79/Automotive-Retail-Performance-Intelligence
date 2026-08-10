/**
 * The global dashboard filter contract: one grammar, in the URL, for every console
 * page.
 *
 * WHY THE WHOLE VOCABULARY IS HERE BEFORE THE PAGES THAT USE IT
 * ------------------------------------------------------------
 * `INFORMATION_ARCHITECTURE.md` §6 declares thirteen parameters. The Executive
 * Overview can honestly apply five of them. The other eight are parsed, validated,
 * serialized and round-tripped anyway, because the alternative — growing the
 * grammar one page at a time — is how two pages end up spelling the same filter
 * differently and a copied URL stops reproducing the view. A parameter's presence
 * in this file is a statement about the URL contract; whether a given route can
 * *act* on it is a separate declaration ({@link RouteFilterSupport}), and the
 * route says so in words rather than silently ignoring it.
 *
 * WHAT A FILTER MAY NOT DO
 * ------------------------
 * Select rows. Never redefine a measure. ADR-0013 condition 2 is the binding form
 * of this, and the structural guarantee is that nothing in this module knows what a
 * KPI is: it produces a filter context, `selectors.ts` decides which governed
 * columns that context is allowed to touch, and a filter that would move a
 * documented denominator is declared on the page rather than applied quietly.
 *
 * WHERE THE STATE LIVES
 * ---------------------
 * The URL, and only the URL. No `localStorage`, no cookie, no server session, no
 * database. A view is a link; a link is the whole persistence layer; the back
 * button is the undo stack. That is also what makes the no-JavaScript path work,
 * because a native `<form method="get">` produces exactly the same string this
 * module serializes.
 *
 * Pure: no data import, no React, no `window`. Safe in a client island, which is
 * the reason the filter bar can be one.
 */

/* -------------------------------------------------------------------------- */
/* The parameter vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every global parameter, in canonical serialization order.
 *
 * The order is the order of `INFORMATION_ARCHITECTURE.md` §6's table, and it is
 * load-bearing: two views with the same filters must produce byte-identical query
 * strings, or a copied URL and a navigated URL become different cache entries and
 * "the link reproduces the view" stops being checkable.
 */
export const FILTER_KEYS = [
  'period',
  'compare',
  'store',
  'scope',
  'dept',
  'employee',
  'source',
  'campaign',
  'make',
  'model',
  'condition',
  'structure',
  'product',
] as const

export type FilterKey = (typeof FILTER_KEYS)[number]

/** `compare` values. `prior-period` is the default. */
export const COMPARE_MODES = ['prior-period', 'prior-year', 'none'] as const
export type CompareMode = (typeof COMPARE_MODES)[number]

/** `scope` values. `combined` is the default and means "no sale-type restriction". */
export const SCOPE_VALUES = [
  'new',
  'used',
  'certified',
  'lease',
  'wholesale',
  'combined',
] as const
export type ScopeValue = (typeof SCOPE_VALUES)[number]

/** `condition` values, spelled as the warehouse spells them. */
export const CONDITION_VALUES = ['New', 'Used', 'Certified'] as const
export type ConditionValue = (typeof CONDITION_VALUES)[number]

/** `structure` values. Recognized now; no dataset carries deal structure until `DASH.6`. */
export const STRUCTURE_VALUES = ['cash', 'finance', 'lease'] as const
export type StructureValue = (typeof STRUCTURE_VALUES)[number]

/**
 * A period selection.
 *
 * `default` is a real member of the union rather than a null: absent means "the
 * latest full month the dataset holds", which is a decision the data makes and
 * this module must not hard-code. Resolving it is `periods.ts`'s job, against the
 * export's own calendar.
 */
export type PeriodSelection =
  | { readonly kind: 'default' }
  | { readonly kind: 'month'; readonly month: string }
  | { readonly kind: 'range'; readonly start: string; readonly end: string }
  | { readonly kind: 'mtd' }
  | { readonly kind: 'last-30d' }

export interface DashboardFilters {
  readonly period: PeriodSelection
  readonly compare: CompareMode
  /** Store business codes. Empty means the whole group. Always sorted and unique. */
  readonly store: readonly string[]
  readonly scope: ScopeValue
  readonly dept: string | null
  readonly employee: string | null
  readonly source: string | null
  readonly campaign: string | null
  readonly make: string | null
  readonly model: string | null
  readonly condition: ConditionValue | null
  readonly structure: StructureValue | null
  readonly product: string | null
}

/** The canonical default state. Serializes to an empty query string. */
export const DEFAULT_FILTERS: DashboardFilters = {
  period: { kind: 'default' },
  compare: 'prior-period',
  store: [],
  scope: 'combined',
  dept: null,
  employee: null,
  source: null,
  campaign: null,
  make: null,
  model: null,
  condition: null,
  structure: null,
  product: null,
}

/* -------------------------------------------------------------------------- */
/* Value grammars                                                              */
/* -------------------------------------------------------------------------- */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
const STORE_PATTERN = /^GSA-\d{3}$/
const EMPLOYEE_PATTERN = /^EMP-\d{5}$/
/** A catalogue code or slug: letters, digits, hyphen, underscore, space, dot. */
const FREE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/

/** Whether an ISO date names a day that exists. `2025-02-30` matches the shape and does not. */
export function isRealDate(iso: string): boolean {
  const match = DATE_PATTERN.exec(iso)
  if (match === null) return false
  const [, year, month, day] = match
  if (year === undefined || month === undefined || day === undefined) return false
  const lengths = [
    31,
    isLeapYear(Number(year)) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  const limit = lengths[Number(month) - 1]
  return limit !== undefined && Number(day) >= 1 && Number(day) <= limit
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** One parameter that was supplied, rejected, and replaced by its default. */
export interface FilterReset {
  readonly key: FilterKey
  /** What arrived, truncated so a hostile URL cannot inject a paragraph into the page. */
  readonly received: string
  /** Why it was rejected, in words a reader can act on. */
  readonly reason: string
}

export interface ParsedFilters {
  readonly filters: DashboardFilters
  /** Non-empty when the page must show the "some filters were reset" notice. */
  readonly reset: readonly FilterReset[]
  /** Keys that are not part of the grammar. Ignored silently, per IA §6. */
  readonly ignored: readonly string[]
}

export interface ParseOptions {
  /**
   * The store codes the export actually carries.
   *
   * Optional so the grammar can be tested without data, and supplied by every real
   * caller so `?store=GSA-999` is rejected as a store that does not exist rather
   * than accepted as a well-formed code that silently matches nothing.
   */
  readonly knownStores?: readonly string[]
  /** The lead-source codes the export carries. Same rule. */
  readonly knownSources?: readonly string[]
}

/** How the query string arrives. `URLSearchParams` and Next's `searchParams` both fit. */
export type QueryInput =
  URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>

function readParam(query: QueryInput, key: string): string | undefined {
  if (query instanceof URLSearchParams) {
    const value = query.get(key)
    return value === null ? undefined : value
  }
  const value = query[key]
  if (value === undefined) return undefined
  // A repeated parameter (`?store=a&store=b`) arrives as an array. The first wins,
  // deliberately: merging them would make `?compare=none&compare=prior-year` mean
  // something the URL does not say.
  return Array.isArray(value) ? value[0] : (value as string)
}

function queryKeys(query: QueryInput): string[] {
  if (query instanceof URLSearchParams) return [...new Set(query.keys())]
  return Object.keys(query)
}

/** Truncate a rejected value so a notice cannot become an injection vector. */
function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`
}

/**
 * Parse a query string into a filter context.
 *
 * Never throws and never returns a partially-valid state: every parameter either
 * validates or is replaced by its default and recorded in `reset`. A page renders
 * with defaults and a visible notice rather than with an error, because a filter a
 * reader mistyped is not a broken page.
 */
export function parseFilters(
  query: QueryInput,
  options: ParseOptions = {}
): ParsedFilters {
  const reset: FilterReset[] = []
  const known = new Set<string>(FILTER_KEYS)
  const ignored = queryKeys(query).filter((key) => !known.has(key))

  const reject = (key: FilterKey, received: string, reason: string): void => {
    reset.push({ key, received: truncate(received), reason })
  }

  /* ---- period ---------------------------------------------------------- */
  let period: PeriodSelection = DEFAULT_FILTERS.period
  const rawPeriod = readParam(query, 'period')
  if (rawPeriod !== undefined && rawPeriod !== '') {
    if (rawPeriod === 'mtd') {
      period = { kind: 'mtd' }
    } else if (rawPeriod === 'last-30d') {
      period = { kind: 'last-30d' }
    } else if (MONTH_PATTERN.test(rawPeriod)) {
      period = { kind: 'month', month: rawPeriod }
    } else {
      const range = RANGE_PATTERN.exec(rawPeriod)
      if (range === null) {
        reject(
          'period',
          rawPeriod,
          'Expected a month (2025-12), a date range (2025-12-01..2025-12-31), mtd, or last-30d.'
        )
      } else {
        const [, start, end] = range
        if (start === undefined || end === undefined) {
          reject('period', rawPeriod, 'The date range could not be read.')
        } else if (!isRealDate(start) || !isRealDate(end)) {
          reject('period', rawPeriod, 'One end of the range is not a date that exists.')
        } else if (start > end) {
          reject('period', rawPeriod, 'The range starts after it ends.')
        } else {
          period = { kind: 'range', start, end }
        }
      }
    }
  }

  /* ---- compare --------------------------------------------------------- */
  let compare: CompareMode = DEFAULT_FILTERS.compare
  const rawCompare = readParam(query, 'compare')
  if (rawCompare !== undefined && rawCompare !== '') {
    if ((COMPARE_MODES as readonly string[]).includes(rawCompare)) {
      compare = rawCompare as CompareMode
    } else {
      reject('compare', rawCompare, `Expected one of ${COMPARE_MODES.join(', ')}.`)
    }
  }

  /* ---- store ----------------------------------------------------------- */
  let store: readonly string[] = DEFAULT_FILTERS.store
  const rawStore = readParam(query, 'store')
  if (rawStore !== undefined && rawStore !== '') {
    const requested = rawStore
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    const malformed = requested.filter((code) => !STORE_PATTERN.test(code))
    const unknown =
      options.knownStores === undefined
        ? []
        : requested.filter(
            (code) => STORE_PATTERN.test(code) && !options.knownStores?.includes(code)
          )
    if (requested.length === 0) {
      reject('store', rawStore, 'No store code was supplied.')
    } else if (malformed.length > 0) {
      reject('store', rawStore, `Not a store code: ${malformed.join(', ')}.`)
    } else if (unknown.length > 0) {
      reject('store', rawStore, `No such store in this dataset: ${unknown.join(', ')}.`)
    } else {
      store = [...new Set(requested)].sort()
    }
  }

  /* ---- scope ----------------------------------------------------------- */
  let scope: ScopeValue = DEFAULT_FILTERS.scope
  const rawScope = readParam(query, 'scope')
  if (rawScope !== undefined && rawScope !== '') {
    if ((SCOPE_VALUES as readonly string[]).includes(rawScope)) {
      scope = rawScope as ScopeValue
    } else {
      reject('scope', rawScope, `Expected one of ${SCOPE_VALUES.join(', ')}.`)
    }
  }

  /* ---- condition ------------------------------------------------------- */
  let condition: ConditionValue | null = null
  const rawCondition = readParam(query, 'condition')
  if (rawCondition !== undefined && rawCondition !== '') {
    if ((CONDITION_VALUES as readonly string[]).includes(rawCondition)) {
      condition = rawCondition as ConditionValue
    } else {
      reject('condition', rawCondition, `Expected one of ${CONDITION_VALUES.join(', ')}.`)
    }
  }

  /* ---- structure ------------------------------------------------------- */
  let structure: StructureValue | null = null
  const rawStructure = readParam(query, 'structure')
  if (rawStructure !== undefined && rawStructure !== '') {
    if ((STRUCTURE_VALUES as readonly string[]).includes(rawStructure)) {
      structure = rawStructure as StructureValue
    } else {
      reject('structure', rawStructure, `Expected one of ${STRUCTURE_VALUES.join(', ')}.`)
    }
  }

  /* ---- employee -------------------------------------------------------- */
  let employee: string | null = null
  const rawEmployee = readParam(query, 'employee')
  if (rawEmployee !== undefined && rawEmployee !== '') {
    if (EMPLOYEE_PATTERN.test(rawEmployee)) {
      employee = rawEmployee
    } else {
      reject(
        'employee',
        rawEmployee,
        'Expected an employee reference of the form EMP-00000.'
      )
    }
  }

  /* ---- source ---------------------------------------------------------- */
  let source: string | null = null
  const rawSource = readParam(query, 'source')
  if (rawSource !== undefined && rawSource !== '') {
    if (!FREE_CODE_PATTERN.test(rawSource)) {
      reject('source', rawSource, 'Not a lead-source code.')
    } else if (
      options.knownSources !== undefined &&
      !options.knownSources.includes(rawSource)
    ) {
      reject('source', rawSource, 'No such lead source in this dataset.')
    } else {
      source = rawSource
    }
  }

  /* ---- the remaining free-text catalogue codes -------------------------- */
  const freeCodes: readonly FilterKey[] = ['dept', 'campaign', 'make', 'model', 'product']
  const free: Partial<Record<FilterKey, string | null>> = {}
  for (const key of freeCodes) {
    const raw = readParam(query, key)
    if (raw === undefined || raw === '') {
      free[key] = null
      continue
    }
    if (FREE_CODE_PATTERN.test(raw)) {
      free[key] = raw
    } else {
      free[key] = null
      reject(key, raw, 'Not a catalogue value.')
    }
  }

  return {
    filters: {
      period,
      compare,
      store,
      scope,
      dept: free.dept ?? null,
      employee,
      source,
      campaign: free.campaign ?? null,
      make: free.make ?? null,
      model: free.model ?? null,
      condition,
      structure,
      product: free.product ?? null,
    },
    reset,
    ignored,
  }
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/** The `period` parameter's serialized form, or `null` when the default is in force. */
export function serializePeriod(period: PeriodSelection): string | null {
  switch (period.kind) {
    case 'default':
      return null
    case 'month':
      return period.month
    case 'range':
      return `${period.start}..${period.end}`
    case 'mtd':
      return 'mtd'
    case 'last-30d':
      return 'last-30d'
  }
}

/** The value a parameter carries, or `null` when it is at its default and is omitted. */
export function filterValue(filters: DashboardFilters, key: FilterKey): string | null {
  switch (key) {
    case 'period':
      return serializePeriod(filters.period)
    case 'compare':
      return filters.compare === DEFAULT_FILTERS.compare ? null : filters.compare
    case 'store':
      return filters.store.length === 0 ? null : [...filters.store].sort().join(',')
    case 'scope':
      return filters.scope === DEFAULT_FILTERS.scope ? null : filters.scope
    case 'dept':
      return filters.dept
    case 'employee':
      return filters.employee
    case 'source':
      return filters.source
    case 'campaign':
      return filters.campaign
    case 'make':
      return filters.make
    case 'model':
      return filters.model
    case 'condition':
      return filters.condition
    case 'structure':
      return filters.structure
    case 'product':
      return filters.product
  }
}

/**
 * The canonical query string, without a leading `?`.
 *
 * Parameters appear in {@link FILTER_KEYS} order, defaults are omitted, and a store
 * list is sorted — so any two equivalent states serialize identically. Empty for
 * the default state, which is what makes "Reset filters" a link to the bare route.
 */
export function serializeFilters(filters: DashboardFilters): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filterValue(filters, key)
    if (value !== null) params.set(key, value)
  }
  return params.toString()
}

/** A route href carrying the filters. `/dashboard` when nothing is set. */
export function filtersHref(pathname: string, filters: DashboardFilters): string {
  const query = serializeFilters(filters)
  return query === '' ? pathname : `${pathname}?${query}`
}

/** Whether the state is the canonical default — i.e. whether "Reset" would change anything. */
export function isDefaultFilters(filters: DashboardFilters): boolean {
  return serializeFilters(filters) === ''
}

/** A copy with one parameter returned to its default. Used by the per-chip remove control. */
export function withoutFilter(
  filters: DashboardFilters,
  key: FilterKey
): DashboardFilters {
  switch (key) {
    case 'period':
      return { ...filters, period: DEFAULT_FILTERS.period }
    case 'compare':
      return { ...filters, compare: DEFAULT_FILTERS.compare }
    case 'store':
      return { ...filters, store: [] }
    case 'scope':
      return { ...filters, scope: DEFAULT_FILTERS.scope }
    default:
      return { ...filters, [key]: null }
  }
}

/* -------------------------------------------------------------------------- */
/* Route support                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a route can honestly do with a parameter.
 *
 *   `applied`        every figure on the route is selected by it
 *   `partial`        some measure families are; the route names which, on the card
 *   `not-applicable` the route's data carries no such attribute
 *
 * `not-applicable` is not a synonym for "unimplemented". `structure` and `product`
 * describe a finance domain that does not exist in the warehouse until `DASH.6`;
 * pretending the Executive Overview filters by them would be inventing a
 * capability, and quietly dropping them would be worse. The grammar accepts them
 * because they belong to the URL contract; the page states that it cannot act on
 * them.
 */
export type FilterSupport = 'applied' | 'partial' | 'not-applicable'

export interface FilterSupportEntry {
  readonly support: FilterSupport
  /** The human label for the parameter. */
  readonly label: string
  /** For `partial` and `not-applicable`: what the reader needs to know. */
  readonly note?: string
}

export type RouteFilterSupport = Readonly<Record<FilterKey, FilterSupportEntry>>

/**
 * The Executive Overview's declaration.
 *
 * Five parameters change what this page shows. Eight do not, and each says why in
 * the same words the trust panel would use: the attribute is not in the export, or
 * the domain does not exist yet.
 */
export const EXECUTIVE_OVERVIEW_SUPPORT: RouteFilterSupport = {
  period: { support: 'applied', label: 'Period' },
  compare: { support: 'applied', label: 'Comparison' },
  store: { support: 'applied', label: 'Store' },
  condition: {
    support: 'partial',
    label: 'Condition',
    note: 'Selects inventory measures only. The exported sales and gross datasets carry retail totals rather than a condition split, so units, gross and per-unit gross stay at the selected store scope.',
  },
  source: {
    support: 'partial',
    label: 'Lead source',
    note: 'Selects lead funnel and response measures only. Units, gross and inventory carry no lead-source attribute.',
  },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'The exported gross dataset separates retail from all-types totals but publishes no per-sale-type gross, so a sale-type scope cannot be applied to this page without changing what a governed measure means.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'Employee performance arrives with DASH.11; no employee-grain dataset is exported.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'Campaign analysis is the Leads and marketing page (DASH.10).',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'Vehicle-attribute filters arrive with the inventory page (DASH.9).',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'Vehicle-attribute filters arrive with the inventory page (DASH.9).',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure is not modelled in the warehouse until DASH.6, so no dataset carries it.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'F&I products are not modelled in the warehouse until DASH.6, so no dataset carries them.',
  },
}

/** One active filter, ready to render as a removable chip. */
export interface ActiveFilterChip {
  readonly key: FilterKey
  readonly label: string
  readonly value: string
  readonly support: FilterSupport
  readonly note?: string
}

/**
 * Every parameter carrying a non-default value, in canonical order.
 *
 * Includes the ones this route cannot apply, marked as such. A filter that is in
 * the URL and not in the summary is a filter the reader believes is working.
 */
export function activeFilterChips(
  filters: DashboardFilters,
  support: RouteFilterSupport
): readonly ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  for (const key of FILTER_KEYS) {
    const value = filterValue(filters, key)
    if (value === null) continue
    const entry = support[key]
    chips.push({
      key,
      label: entry.label,
      value,
      support: entry.support,
      ...(entry.note === undefined ? {} : { note: entry.note }),
    })
  }
  return chips
}

/**
 * The Sales and Gross page's declaration.
 *
 * Two entries differ from the Executive Overview's, and both differences are real
 * rather than cosmetic.
 *
 * `condition` is APPLIED here. The Executive Overview marks it partial because the
 * datasets it reads carry retail totals with no condition split, so narrowing them
 * would have been a filter that changed nothing or a figure that was wrong. This
 * page reads `sales-gross-trend`, which publishes `new_*` and `used_*` gross as
 * additive columns, so selecting New reads a different governed column rather than
 * re-filtering a total that cannot be split. `Certified` remains partial: it is a
 * condition TYPE, and the export splits gross by condition GROUP, in which a
 * certified unit is Used.
 *
 * `scope` is PARTIAL rather than not-applicable, for the same reason in reverse: the
 * trend dataset publishes per-sale-type unit COUNTS but no per-sale-type gross, so a
 * sale-type selection can narrow the mix and cannot narrow a gross figure.
 */
export const SALES_GROSS_SUPPORT: RouteFilterSupport = {
  period: { support: 'applied', label: 'Period' },
  compare: { support: 'applied', label: 'Comparison' },
  store: { support: 'applied', label: 'Store' },
  condition: {
    support: 'applied',
    label: 'Condition',
    note: 'New and Used select the exported condition split of units and gross. Certified narrows the deal-level distribution only: the export splits gross by condition group, and a certified unit is Used inside it.',
  },
  scope: {
    support: 'partial',
    label: 'Sale-type scope',
    note: 'Narrows the sale-type mix, which the export publishes as unit counts. No gross figure changes: the export publishes no per-sale-type gross, and apportioning the retail total would invent a measure the reporting layer does not own.',
  },
  source: {
    support: 'not-applicable',
    label: 'Lead source',
    note: 'The store-day trend dataset carries no lead-source attribute; lead-source analysis is the Leads and marketing page (DASH.10). The Deal Explorer carries attribution at deal grain.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'Employee performance arrives with DASH.11; no employee-grain dataset is exported.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'Campaign analysis is the Leads and marketing page (DASH.10).',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'Vehicle-attribute filters apply to the Deal Explorer, not to the store-day trend.',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'Vehicle-attribute filters apply to the Deal Explorer, not to the store-day trend.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure is not modelled in the warehouse until DASH.6, so no dataset carries it.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'F&I products are not modelled in the warehouse until DASH.6, so no dataset carries them.',
  },
}

/**
 * The Deal Explorer's declaration.
 *
 * The deal-grain dataset carries vehicle attributes and lead attribution, so this is
 * the route where `make`, `model` and `source` finally do something.
 */
export const DEAL_EXPLORER_SUPPORT: RouteFilterSupport = {
  period: { support: 'applied', label: 'Period' },
  compare: {
    support: 'not-applicable',
    label: 'Comparison',
    note: 'An index lists the deals in one period. There is no figure here for a comparison period to change.',
  },
  store: { support: 'applied', label: 'Store' },
  condition: { support: 'applied', label: 'Condition' },
  scope: { support: 'applied', label: 'Sale-type scope' },
  source: {
    support: 'applied',
    label: 'Lead source',
    note: 'Resolved through the lead linked to the deal. A deal with no linked lead is walk-in or unattributed business and is excluded when a source is selected.',
  },
  make: { support: 'applied', label: 'Make' },
  model: { support: 'applied', label: 'Model' },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'Employee performance arrives with DASH.11. The index shows the synthetic ids on each deal but does not filter by them.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'The deal dataset carries the linked lead source but not its campaign.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure is not modelled in the warehouse until DASH.6, so no dataset carries it.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'The deal index carries no product detail: itemization is the Deal Jacket, and the category view is the F&I page.',
  },
}

/**
 * The F&I page's declaration (`DASH.7`).
 *
 * Six parameters change what this page shows and seven do not. `structure` is the
 * interesting one: it is marked `partial` rather than `applied` because the exported F&I
 * datasets carry the structure MIX as counts — which is what `KPI-FNI-019` is — and not a
 * per-structure split of reserve, product gross and penetration. Marking it `applied`
 * would claim the whole page reorganized itself around a structure it can only report on.
 *
 * `condition` is `not-applicable` for a reason worth stating: vehicle condition already
 * decides which categories are ELIGIBLE, and the rule applies it inside each denominator.
 * A second condition filter on top would narrow the numerator without narrowing the
 * governed denominator, which is the exact defect the eligibility model exists to prevent.
 */
export const FI_SUPPORT: RouteFilterSupport = {
  period: { support: 'applied', label: 'Period' },
  compare: {
    support: 'partial',
    label: 'Comparison',
    note: 'Selects the prior-period penetration column. The production totals and the adjustment analysis show the selected period only.',
  },
  store: { support: 'applied', label: 'Store' },
  employee: {
    support: 'applied',
    label: 'Finance manager',
    note: 'Selects the finance manager credited on the deal, and scopes both the numerator and the eligible denominator of every penetration figure.',
  },
  product: {
    support: 'applied',
    label: 'F&I product category',
    note: 'Selects one governed category. "extended-warranty" is accepted as a user-facing alias for Vehicle Service Contract.',
  },
  structure: {
    support: 'partial',
    label: 'Finance structure',
    note: 'The exported datasets carry the structure mix as counts rather than a per-structure split of reserve, product gross and penetration, so the selection is reported in the finance structure section and is not applied to the other figures.',
  },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'F&I exists only on retail deliveries. A wholesale or dealer-trade disposal has no consumer, so it carries no finance product and no consumer lender, and a sale-type scope would select nothing this page measures.',
  },
  condition: {
    support: 'not-applicable',
    label: 'Condition',
    note: 'Vehicle condition decides which categories are ELIGIBLE — Prepaid Maintenance is new and certified only — and the eligibility rule already applies it inside each denominator. A second condition filter on top would narrow the numerator without narrowing the governed denominator.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  source: {
    support: 'not-applicable',
    label: 'Lead source',
    note: 'The F&I datasets carry no lead-source attribute.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'The F&I datasets carry no campaign attribute.',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'The F&I datasets are at store, day, manager and category grain and carry no vehicle attribute.',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'The F&I datasets are at store, day, manager and category grain and carry no vehicle attribute.',
  },
}

/**
 * `/dashboard/accounting` (`DASH.9`).
 *
 * `period` is `partial` and the wording matters. It does not select a range of balances to
 * add up: a control balance is a POSITION at a date, so the period selects the LAST
 * comparison date inside it and the page reports that one date. Calling this `applied`
 * would imply a period total that the semi-additive rule forbids anyone to compute.
 *
 * `store` is the only fully applied filter, and it can only be fully applied: each exported
 * row already carries both sides of one store's comparison, so there is no shape in which a
 * store filter could narrow the general ledger and not the subledger. The dataset forbids
 * the bug rather than a rule forbidding it.
 *
 * Everything else is `not-applicable`, and for one reason repeated: this lane is at store,
 * control-account and date grain. It carries no employee, no lead source, no campaign, no
 * vehicle attribute and no deal structure, so those parameters would select nothing rather
 * than select narrowly.
 */
export const ACCOUNTING_SUPPORT: RouteFilterSupport = {
  period: {
    support: 'partial',
    label: 'Period',
    note: 'Selects the last comparison date inside the period and reports that date. Control balances are positions at a date and are never summed or averaged across dates, so a period is a way of choosing one date rather than a range to total.',
  },
  compare: {
    support: 'not-applicable',
    label: 'Comparison',
    note: 'A prior-period comparison of two balances is a movement in the position, not a reconciliation result, and reading a balance delta as a variance is the specific misreading this page exists to prevent.',
  },
  store: { support: 'applied', label: 'Store' },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'The reconciliation is over stock held, not over deliveries. A sale-type scope selects nothing on a balance.',
  },
  condition: {
    support: 'not-applicable',
    label: 'Condition',
    note: 'Vehicle condition already decides which control account a unit belongs to, and that grouping IS the account. Note that the accounting domain separates Certified into its own control account where the sales domain groups it with Used.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'A control balance is not attributable to a person, and ARPI records no preparer, approver or poster for one.',
  },
  source: {
    support: 'not-applicable',
    label: 'Lead source',
    note: 'The accounting datasets carry no lead-source attribute.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'The accounting datasets carry no campaign attribute.',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'The comparison is at store, control-account and date grain and carries no vehicle attribute.',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'The comparison is at store, control-account and date grain and carries no vehicle attribute.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure is a property of a transaction, not of a stock position.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'The accounting datasets carry no product attribute.',
  },
}

/**
 * `/dashboard/inventory` (`DASH.9`).
 *
 * `period` is `partial` for the same reason it is on the accounting route, and the reason is
 * worth repeating rather than cross-referencing: a unit count and an investment figure are
 * POSITIONS at a snapshot date. The period selects the last snapshot inside it and the page
 * reports that one date. Summing a month of daily positions would report unit-days.
 *
 * `condition` narrows on the condition TYPE, so `Certified` selects certified units alone
 * rather than the Used group that contains them. The row carries both groupings and they are
 * not interchangeable: the accounting domain separates Certified into its own control
 * account while the sales domain merges it into Used.
 *
 * This route also reads three parameters that are NOT in the global grammar — `unit`, `q`
 * and `sort` — because each means something only here. They are deliberately absent from
 * this matrix, which describes the shared vocabulary.
 */
export const INVENTORY_SUPPORT: RouteFilterSupport = {
  period: {
    support: 'partial',
    label: 'Period',
    note: 'Selects the last snapshot date inside the period and reports that date. Unit counts and investment are positions at a date and are never summed across dates, so a period chooses one date rather than a range to total.',
  },
  compare: {
    support: 'not-applicable',
    label: 'Comparison',
    note: 'Price movement is already published per unit against its prior snapshot. A second period-over-period comparison of stock positions would describe turnover rather than the lot as it stands.',
  },
  store: { support: 'applied', label: 'Store' },
  condition: {
    support: 'applied',
    label: 'Condition',
    note: 'Narrows on the vehicle condition type, so Certified selects certified units alone rather than the whole Used group.',
  },
  make: { support: 'applied', label: 'Make' },
  model: { support: 'applied', label: 'Model' },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'This page is stock held, not deliveries. A sale-type scope selects nothing on a unit that has not been sold.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'A unit in stock is not attributable to a salesperson; ARPI records no assignment of stock to a person.',
  },
  source: {
    support: 'not-applicable',
    label: 'Lead source',
    note: 'The inventory datasets carry no lead-source attribute.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'The inventory datasets carry no campaign attribute.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure is a property of a transaction, not of a unit in stock.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'The inventory datasets carry no product attribute.',
  },
}

/**
 * The Leads and marketing declaration (`DASH.10`).
 *
 * THE INTERESTING ENTRIES ARE `source` AND `campaign`, and they are `applied` rather than
 * `partial` for a reason this increment had to build for. Before `DASH.10` the appointment
 * measures carried no source or campaign at all, so a source filter could only have scoped the
 * lead funnel while KPI-FUN-004 and KPI-FUN-005 stayed group-wide — and a page showing a
 * filtered funnel above unfiltered appointment rates, drawn as one shape, is not a filtered
 * funnel. The DASH.10 source-aware appointment view resolves both through the one lead behind
 * each appointment, so every measure on this route now moves with the filter, including both
 * sides of every ratio.
 *
 * `compare` is deliberately `not-applicable`. Nothing on this page renders a
 * period-over-period delta: cohort maturity dominates every conversion and cost measure here,
 * so a comparison against a prior period would put an immature cohort beside a mature one and
 * report the difference as a change in performance. That is the single most common misreading
 * of these measures, and offering the control would invite it.
 */
export const LEADS_MARKETING_SUPPORT: RouteFilterSupport = {
  period: {
    support: 'applied',
    label: 'Period',
    note: 'Lead, response and stage measures are on the lead-creation basis; appointment measures on the scheduled and show dates; marketing on whole calendar months only.',
  },
  compare: {
    support: 'not-applicable',
    label: 'Comparison',
    note: 'No period-over-period delta is published here. Cohort maturity dominates conversion and cost on this page, so comparing a period-to-date cohort against a matured one would report immaturity as a change in performance.',
  },
  store: { support: 'applied', label: 'Store' },
  source: {
    support: 'applied',
    label: 'Lead source',
    note: 'Scopes the funnel, the stage partition, the response distribution, the appointment outcomes and the marketing table — both sides of every ratio, never a numerator alone.',
  },
  campaign: {
    support: 'applied',
    label: 'Campaign',
    note: 'Scopes the same five blocks. A lead with no campaign is excluded by a campaign filter rather than counted against it: null means no campaign, not unknown campaign.',
  },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'No lead or appointment dataset carries a sale type. The sale-type mix belongs to Sales and gross.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'No department-grain reporting view exists yet. A campaign declares a target department, which states intent rather than where its leads landed.',
  },
  employee: {
    support: 'not-applicable',
    label: 'Employee',
    note: 'This page is deliberately not a BDC leaderboard: it reads no employee-grain dataset and scopes nothing by a person. DASH.11 built /dashboard/employees, which does, with a minimum-sample floor on every comparative figure.',
  },
  condition: {
    support: 'not-applicable',
    label: 'Condition',
    note: 'Leads and appointments carry no condition group; a campaign declares a target vehicle category, which is intent and not the condition of what the lead bought.',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'Vehicle-attribute filters apply to the Deal Explorer, not to lead or appointment grain.',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'Vehicle-attribute filters apply to the Deal Explorer, not to lead or appointment grain.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'Deal structure belongs to the F&I surface; no lead-grain dataset carries it.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'F&I products belong to the F&I surface; no lead-grain dataset carries them.',
  },
}

/**
 * The employee-performance page's declaration (`DASH.11`).
 *
 * FOUR PARAMETERS CHANGE WHAT THIS PAGE SHOWS AND NINE DO NOT, and the nine are worth reading
 * rather than skipping: several of them could have been made to work and were deliberately
 * not, because a filter that narrows a numerator without narrowing its governed denominator
 * is worse than a filter that says no.
 *
 * `compare` IS NOT-APPLICABLE, AND THAT IS THE INCREMENT'S MOST DELIBERATE OMISSION. A
 * prior-period delta on an employee figure needs both periods to independently satisfy the
 * same role assignment, the same measure, the same denominator AND the minimum-sample floor.
 * On this data most people clear the floor in neither period, so most deltas would be
 * computed from a value the page had just declined to print — and where a person changed role
 * or store between the periods, the difference would be an assignment change presented as
 * performance movement. Declaring it not-applicable is the more honest contract than shipping
 * a delta with four conditions attached.
 *
 * `dept` IS NOT-APPLICABLE for a reason specific to this page: department is an employee-
 * VERSION attribute, and the role families already partition the population on a finer,
 * fact-derived basis. The two disagree — a Sales Manager and a General Manager are both
 * department Management and both are credited desk management — so a department control
 * beside the role navigation would offer two answers to the same question.
 */
export const EMPLOYEES_SUPPORT: RouteFilterSupport = {
  period: { support: 'applied', label: 'Period' },
  store: { support: 'applied', label: 'Store' },
  employee: {
    support: 'applied',
    label: 'Employee',
    note: 'Opens one synthetic employee for investigation. Validated against the exported roster: a well-formed code the export does not contain is reported as unknown rather than silently rendering an empty page.',
  },
  source: {
    support: 'partial',
    label: 'Lead source',
    note: 'Scopes the lead-source mix and the lead funnel, which are the only blocks a source can reach. Units, gross and finance structure are properties of a delivery and are not narrowed by it, so the page reports the selection rather than applying it everywhere.',
  },
  compare: {
    support: 'not-applicable',
    label: 'Comparison',
    note: 'Deliberately not offered. A prior-period employee delta needs both periods to satisfy the same role assignment, the same denominator and the minimum-sample floor independently — and a delta computed from a value the page declined to print, or across a role or store change, would present an assignment change as performance movement.',
  },
  dept: {
    support: 'not-applicable',
    label: 'Department',
    note: 'The role families already partition the population on a finer, fact-derived basis, and the two disagree: a Sales Manager and a General Manager are both department Management and both are credited desk management. A department control here would answer the same question differently.',
  },
  condition: {
    support: 'not-applicable',
    label: 'Condition',
    note: 'The new and used mix is shown on every selling row as context, because it is part of what a gross figure means. A condition filter would narrow the gross numerator without narrowing the retail-unit denominator the floor is applied to, which is the defect the mix exists to make visible instead.',
  },
  structure: {
    support: 'not-applicable',
    label: 'Finance structure',
    note: 'The structure mix travels beside every finance figure for the same reason: reserve and back PVR divide by ALL retail units including cash deals, so filtering to one structure would narrow the numerator and leave the governed denominator alone.',
  },
  scope: {
    support: 'not-applicable',
    label: 'Sale-type scope',
    note: 'Every employee measure here is retail-only by governed definition. The wholesale and dealer-trade units excluded from each denominator are published beside it so the exclusion is checkable, which is what a scope control would otherwise be for.',
  },
  product: {
    support: 'not-applicable',
    label: 'F&I product category',
    note: 'Category-grain penetration has a per-category eligible-deal denominator that this page does not carry. The F&I route owns it, and the finance rows link to it.',
  },
  campaign: {
    support: 'not-applicable',
    label: 'Campaign',
    note: 'The employee lead dataset carries the lead source but not its campaign.',
  },
  make: {
    support: 'not-applicable',
    label: 'Make',
    note: 'No employee dataset carries a vehicle attribute. Vehicle filters belong to the Deal Explorer.',
  },
  model: {
    support: 'not-applicable',
    label: 'Model',
    note: 'No employee dataset carries a vehicle attribute. Vehicle filters belong to the Deal Explorer.',
  },
}
