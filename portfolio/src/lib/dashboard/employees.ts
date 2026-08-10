/**
 * The view model for `/dashboard/employees` — role-aware employee activity with the context
 * that decides what it means.
 *
 * WHAT THIS MODULE REFUSES TO PRODUCE
 * -----------------------------------
 * There is no rank, no score, no percentile, no tier, no composite and no ordering by any
 * measure anywhere in it, and every one of those absences is structural rather than a matter
 * of restraint:
 *
 *   * `orderEmployees` sorts by store, then role, then employee code. It takes no comparator
 *     argument, so a caller cannot pass one.
 *   * No exported function returns a single number summarising a person. The row type carries
 *     several independent figures and no field that combines them.
 *   * Nothing here reads a "best", "top" or "worst" of anything, because no such selection
 *     exists to read.
 *
 * A table sorted descending by gross is a leaderboard whether or not the word "rank" appears
 * anywhere near it, which is why the sort is fixed here rather than offered as an option.
 *
 * THE SAMPLE FLOOR IS DENOMINATOR-SPECIFIC, AND THAT IS THE WHOLE DESIGN
 * ----------------------------------------------------------------------
 * There is deliberately no `employeeSampleCount`. Each comparative figure carries ITS OWN
 * governed denominator as its sample, because they are different populations:
 *
 *   gross per retail unit        retail units of that credit
 *   contact rate                 valid assigned leads
 *   appointment-set rate         CONTACTED leads, never all valid ones
 *   show rate                    eligible appointments (scheduled basis)
 *   show-to-sale                 shown appointments (show basis)
 *   reserve and back PVR         retail units delivered under that finance credit
 *
 * A person can be comparison-eligible on one and not on another in the same period, and the
 * page says so per figure. The floor itself is read from the export's `minimum_sample_floor`
 * column and is never written as a literal here — a hard-coded 10 would drift from the
 * database function the moment either changed.
 *
 * BELOW THE FLOOR THE RATIO IS NOT PRINTED, AND THE COUNT STILL IS. `insufficient-sample`
 * carries the denominator and the floor so the page can say "6 qualifying retail units,
 * minimum 10" — which explains the suppression instead of hiding it. It is a PUBLICATION
 * STATE and not a verdict: it says the project declines to print a ratio over a denominator
 * this small, and nothing whatever about the person.
 *
 * FOUR ABSENCES, NEVER ONE DASH. `not-applicable` (the measure does not belong to this role),
 * `insufficient-sample` (it does, and the denominator is below the floor), `no-data` (it
 * does, the denominator is zero, nothing was observed) and a real `0` are four different
 * statements and the page renders four different things.
 *
 * RATIOS ARE ALWAYS SUM(numerator) / SUM(denominator), computed once at the grain being
 * reported. Never an average of daily ratios, per-employee ratios or store ratios: those are
 * different numbers and all of them are wrong.
 *
 * NO CAUSAL CLAIM IS MADE ANYWHERE. Figures are credited to, associated with or observed for
 * a person. Nothing here says caused, drove, created or lost, because the model observes
 * associations and does not isolate an individual effect.
 */
import type { DashboardRow } from '@/types/dashboard'

import { numericCell, textCell, type DashboardLeadSource } from './data'
import {
  addExact,
  compareExact,
  exactFromInteger,
  exactZero,
  type Exact,
} from './decimal'
import { absent, figure, isFigure, percentileFromBins, ratio, sumColumn } from './figures'
import type { Figure } from './figures'
import type { DashboardFilters } from './filters'
import type { ResolvedPeriod } from './periods'

/* -------------------------------------------------------------------------- */
/* Role families                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The four operating surfaces, in presentation order. NOT A RANKING.
 *
 * They exist because the surfaces have genuinely different opportunities and genuinely
 * different governed denominators: a contact rate belongs to a lead population and a gross
 * per retail unit to a delivered-unit population, so a figure from one is not comparable with
 * a figure from another. The order below is the order a store is walked through, not an
 * order of importance, seniority or value.
 *
 * `Unassigned` is not here. It is a real population of activity credited to nobody, it is
 * carried in every total, and it is deliberately not a role a person can be viewed under.
 */
export const ROLE_FAMILIES = ['Salesperson', 'Desk Management', 'Finance', 'BDC'] as const

export type RoleFamily = (typeof ROLE_FAMILIES)[number]

/** The URL vocabulary for the role parameter, and its map to the exported family. */
export const ROLE_SLUGS = {
  salesperson: 'Salesperson',
  desk: 'Desk Management',
  finance: 'Finance',
  bdc: 'BDC',
} as const satisfies Readonly<Record<string, RoleFamily>>

export type RoleSlug = keyof typeof ROLE_SLUGS

export const DEFAULT_ROLE_SLUG: RoleSlug = 'salesperson'

/** The exported family a slug names, or the default when the slug is not one of the four. */
export function roleFromSlug(value: string | null | undefined): RoleSlug {
  if (value === null || value === undefined) return DEFAULT_ROLE_SLUG
  const normalised = value.trim().toLowerCase()
  return normalised in ROLE_SLUGS ? (normalised as RoleSlug) : DEFAULT_ROLE_SLUG
}

/** The slug for a family, so a link can be built from a row. */
export function slugForRole(family: RoleFamily): RoleSlug {
  const found = (Object.keys(ROLE_SLUGS) as RoleSlug[]).find(
    (slug) => ROLE_SLUGS[slug] === family
  )
  return found ?? DEFAULT_ROLE_SLUG
}

/** How each family is described where the page has to say what it is measuring. */
export const ROLE_DESCRIPTIONS: Readonly<Record<RoleFamily, string>> = {
  Salesperson:
    'Units delivered under a salesperson credit, the gross on them, and the opportunity and mix that surrounded it.',
  'Desk Management':
    'Units delivered with this person credited as the desk manager, and the condition mix of those transactions.',
  Finance:
    'Retail deliveries with this person on the F&I desk, the finance structure of them, and the income earned.',
  BDC: 'Leads assigned, how many were reached and booked, how fast and how often they were answered, and what the appointments did.',
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

export interface EmployeeScope {
  readonly stores: readonly string[]
  readonly period: ResolvedPeriod
  readonly role: RoleSlug
  readonly family: RoleFamily
  /** The employee the URL selected, or `null`. Validated against the export, never trusted. */
  readonly employee: string | null
  /** True when `employee=` named a code the export does not contain. */
  readonly employeeUnknown: boolean
}

export function scopeFromFilters(
  filters: DashboardFilters,
  period: ResolvedPeriod,
  allStores: readonly string[],
  role: RoleSlug,
  knownEmployees: readonly string[]
): EmployeeScope {
  const stores = filters.store.length === 0 ? allStores : filters.store
  const requested = filters.employee
  // A SYNTACTICALLY VALID BUT UNKNOWN CODE MUST NOT SILENTLY EMPTY THE PAGE. `EMP-99999`
  // parses and matches nothing, and a page that quietly rendered "no activity" for it would
  // be making a false statement about a person who does not exist. It is carried as an
  // explicit unknown so the route can say so.
  const known = requested !== null && knownEmployees.includes(requested)
  return {
    stores,
    period,
    role,
    family: ROLE_SLUGS[role],
    employee: known ? requested : null,
    employeeUnknown: requested !== null && !known,
  }
}

/* -------------------------------------------------------------------------- */
/* Sample discipline                                                           */
/* -------------------------------------------------------------------------- */

export interface Sample {
  /** The governed denominator of THIS measure, as a count. */
  readonly denominator: number
  /** The floor, read from the export. Never a literal in this file. */
  readonly floor: number
  readonly meets: boolean
}

export function sample(denominator: Exact, floor: number): Sample {
  const count = Number(denominator.units) / 10 ** denominator.scale
  return { denominator: count, floor, meets: count >= floor }
}

/**
 * A ratio that is only printed when its own governed denominator reaches the floor.
 *
 * The three outcomes are three different statements and the caller renders three different
 * things: a value; `insufficient-sample`, which carries the denominator and the floor so the
 * page can explain the suppression rather than hide it; and `no-data`, which means the
 * denominator is zero and nothing was observed at all. A zero denominator is NOT an
 * insufficient sample — there is no sample — and conflating them would tell a reader that
 * someone fell short of a threshold when in fact they had no opportunity.
 */
export function comparative(
  numerator: Exact,
  denominator: Exact,
  sampleState: Sample,
  scale: number,
  measure: string
): Figure {
  if (sampleState.denominator === 0) {
    return absent('no-data', `No ${measure} observed in this period.`)
  }
  if (!sampleState.meets) {
    return absent(
      'insufficient-sample',
      `${String(sampleState.denominator)} ${measure}, minimum ${String(sampleState.floor)}`
    )
  }
  return ratio(numerator, denominator, scale, `No ${measure} observed in this period.`)
}

/** The floor the export publishes, read rather than assumed. */
export function floorFromRows(rows: readonly DashboardRow[], fallback: number): number {
  for (const row of rows) {
    const cell = numericCell(row, 'minimum_sample_floor')
    if (cell !== null) return Number(cell)
  }
  return fallback
}

/* -------------------------------------------------------------------------- */
/* Row selection                                                               */
/* -------------------------------------------------------------------------- */

function inScope(row: DashboardRow, scope: EmployeeScope, dateColumn: string): boolean {
  if (!scope.stores.includes(textCell(row, 'dealership_id'))) return false
  const date = textCell(row, dateColumn)
  return date >= scope.period.start && date <= scope.period.end
}

/** Rows of one role family, in scope. The `Unassigned` family never matches a family here. */
function familyRows(
  rows: readonly DashboardRow[],
  scope: EmployeeScope,
  dateColumn: string
): readonly DashboardRow[] {
  return rows.filter(
    (row) => inScope(row, scope, dateColumn) && row.role_family === scope.family
  )
}

/** Rows credited to nobody, in scope. Carried so the page can show what it excluded. */
function unassignedRows(
  rows: readonly DashboardRow[],
  scope: EmployeeScope,
  dateColumn: string
): readonly DashboardRow[] {
  return rows.filter(
    (row) => inScope(row, scope, dateColumn) && row.role_family === 'Unassigned'
  )
}

function groupByEmployee(
  rows: readonly DashboardRow[]
): ReadonlyMap<string, readonly DashboardRow[]> {
  const grouped = new Map<string, DashboardRow[]>()
  for (const row of rows) {
    const code = row.employee_code
    if (typeof code !== 'string') continue
    const bucket = grouped.get(code)
    if (bucket === undefined) grouped.set(code, [row])
    else bucket.push(row)
  }
  return grouped
}

/* -------------------------------------------------------------------------- */
/* The roster                                                                  */
/* -------------------------------------------------------------------------- */

export interface RosterEntry {
  readonly code: string
  readonly storeId: string
  readonly department: string
  readonly jobRole: string
  readonly isManager: boolean
  readonly tenureBand: string
  /** CURRENT roster context. Never used to filter a historical row out of a period. */
  readonly activeInCurrentRoster: boolean
}

export function buildRoster(rows: readonly DashboardRow[]): readonly RosterEntry[] {
  return rows.map((row) => ({
    code: textCell(row, 'employee_code'),
    storeId: textCell(row, 'dealership_id'),
    department: textCell(row, 'department'),
    jobRole: textCell(row, 'job_role'),
    isManager: row.is_manager === true,
    tenureBand: textCell(row, 'tenure_band'),
    activeInCurrentRoster: row.is_active === true,
  }))
}

/* -------------------------------------------------------------------------- */
/* One employee's row                                                          */
/* -------------------------------------------------------------------------- */

/** One labelled figure with the sample that governs it. */
export interface Measured {
  readonly label: string
  readonly figure: Figure
  readonly sample: Sample | null
  /** The governed denominator's name, so the page can say what the sample counts. */
  readonly sampleLabel: string | null
}

/** A share of a whole, for a mix bar. Always a count over its own total. */
export interface MixSlice {
  readonly label: string
  readonly count: number
  readonly share: Figure
}

export interface EmployeeRow {
  readonly code: string
  readonly storeId: string
  /** The job role AS AT THE EVENT, from the fact-linked version. Never the current title. */
  readonly jobRole: string
  readonly tenureBand: string
  readonly family: RoleFamily
  readonly activeInCurrentRoster: boolean
  /** The volume figure this family leads with. Always a count, never a rate. */
  readonly volumeLabel: string
  readonly volume: number
  /** The comparative figures, each with its own denominator and its own floor verdict. */
  readonly measures: readonly Measured[]
  /** Condition or structure mix, where the family has one. */
  readonly mix: readonly MixSlice[]
  readonly mixLabel: string | null
  /** Opportunity and operating context that changes what the figures mean. */
  readonly context: readonly { readonly label: string; readonly value: string }[]
}

/**
 * The stable, neutral order: store, then role, then employee code.
 *
 * TAKES NO COMPARATOR, deliberately. A sort argument would make a leaderboard one call away,
 * and the page's whole contract is that no ordering here encodes a judgement. The business-key
 * order is documented, reproducible and says nothing about anybody.
 */
export function orderEmployees(rows: readonly EmployeeRow[]): readonly EmployeeRow[] {
  return [...rows].sort(
    (a, b) =>
      a.storeId.localeCompare(b.storeId) ||
      a.jobRole.localeCompare(b.jobRole) ||
      a.code.localeCompare(b.code)
  )
}

/* -------------------------------------------------------------------------- */
/* Family builders                                                             */
/* -------------------------------------------------------------------------- */

function toCount(value: Exact): number {
  return Number(value.units) / 10 ** value.scale
}

function shareOf(part: Exact, whole: Exact, label: string): MixSlice {
  return {
    label,
    count: toCount(part),
    share: ratio(part, whole, 4, `No ${label.toLowerCase()} units in this period.`),
  }
}

interface EmployeeIdentity {
  readonly jobRole: string
  readonly tenureBand: string
}

function identityFrom(rows: readonly DashboardRow[]): EmployeeIdentity {
  // The FACT-LINKED version's values, taken from the rows themselves rather than looked up
  // in the roster: the roster carries the CURRENT version, and resolving a historical row
  // through it would relabel August with December's title. Where a period spans a version
  // change the row values differ, and the last one in export order is the later one.
  const last = rows[rows.length - 1]
  return {
    jobRole: last === undefined ? '' : String(last.job_role ?? ''),
    tenureBand: last === undefined ? '' : String(last.tenure_band ?? ''),
  }
}

function salespersonRow(
  code: string,
  rows: readonly DashboardRow[],
  leadRows: readonly DashboardRow[],
  roster: ReadonlyMap<string, RosterEntry>,
  floor: number,
  sources: ReadonlyMap<string, DashboardLeadSource>
): EmployeeRow {
  const units = sumColumn(rows, 'sold_retail_units')
  const front = sumColumn(rows, 'sold_front_end_gross')
  const total = sumColumn(rows, 'sold_total_gross')
  const unitSample = sample(units, floor)
  const identity = identityFrom(rows)
  const entry = roster.get(code)

  const withDesk = sumColumn(rows, 'sold_retail_units_with_desk_manager')
  const validLeads = sumColumn(leadRows, 'valid_lead_count')
  const mixTop = topSourceCategory(leadRows, sources)

  return {
    code,
    storeId: textCell(rows[0] as DashboardRow, 'dealership_id'),
    jobRole: identity.jobRole,
    tenureBand: identity.tenureBand,
    family: 'Salesperson',
    activeInCurrentRoster: entry?.activeInCurrentRoster ?? true,
    volumeLabel: 'Retail units',
    volume: toCount(units),
    measures: [
      {
        label: 'Front gross per retail unit',
        figure: comparative(front, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
      {
        label: 'Total gross per retail unit',
        figure: comparative(total, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
    ],
    mixLabel: 'New and used mix',
    mix: [
      shareOf(sumColumn(rows, 'sold_new_units'), units, 'New'),
      shareOf(sumColumn(rows, 'sold_used_units'), units, 'Used'),
    ],
    context: [
      { label: 'Assigned leads', value: String(toCount(validLeads)) },
      { label: 'Commonest lead source', value: mixTop },
      {
        label: 'Certified, inside used',
        value: String(toCount(sumColumn(rows, 'sold_certified_units'))),
      },
      {
        label: 'Deals with a desk manager',
        value: `${String(toCount(withDesk))} of ${String(toCount(units))}`,
      },
    ],
  }
}

function deskRow(
  code: string,
  rows: readonly DashboardRow[],
  roster: ReadonlyMap<string, RosterEntry>,
  floor: number
): EmployeeRow {
  const units = sumColumn(rows, 'desked_retail_units')
  const front = sumColumn(rows, 'desked_front_end_gross')
  const total = sumColumn(rows, 'desked_total_gross')
  const unitSample = sample(units, floor)
  const identity = identityFrom(rows)
  const entry = roster.get(code)

  return {
    code,
    storeId: textCell(rows[0] as DashboardRow, 'dealership_id'),
    jobRole: identity.jobRole,
    tenureBand: identity.tenureBand,
    family: 'Desk Management',
    activeInCurrentRoster: entry?.activeInCurrentRoster ?? true,
    volumeLabel: 'Retail units desked',
    volume: toCount(units),
    measures: [
      {
        label: 'Front gross per retail unit',
        figure: comparative(front, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
      {
        label: 'Total gross per retail unit',
        figure: comparative(total, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
    ],
    mixLabel: 'New and used mix',
    mix: [
      shareOf(sumColumn(rows, 'desked_new_units'), units, 'New'),
      shareOf(sumColumn(rows, 'desked_used_units'), units, 'Used'),
    ],
    context: [
      {
        label: 'Certified, inside used',
        value: String(toCount(sumColumn(rows, 'desked_certified_units'))),
      },
      {
        label: 'Non-retail units, excluded',
        value: String(toCount(sumColumn(rows, 'desked_non_retail_units'))),
      },
    ],
  }
}

function financeRow(
  code: string,
  rows: readonly DashboardRow[],
  roster: ReadonlyMap<string, RosterEntry>,
  floor: number
): EmployeeRow {
  const units = sumColumn(rows, 'financed_retail_units')
  const reserve = sumColumn(rows, 'financed_reserve_gross')
  const back = sumColumn(rows, 'financed_back_end_gross')
  const cash = sumColumn(rows, 'financed_cash_deals')
  const finance = sumColumn(rows, 'financed_retail_finance_deals')
  const lease = sumColumn(rows, 'financed_lease_deals')
  const unitSample = sample(units, floor)
  const identity = identityFrom(rows)
  const entry = roster.get(code)

  return {
    code,
    storeId: textCell(rows[0] as DashboardRow, 'dealership_id'),
    jobRole: identity.jobRole,
    tenureBand: identity.tenureBand,
    family: 'Finance',
    activeInCurrentRoster: entry?.activeInCurrentRoster ?? true,
    volumeLabel: 'Retail units',
    volume: toCount(units),
    measures: [
      {
        label: 'Back gross per retail unit',
        figure: comparative(back, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
      {
        label: 'Reserve per retail unit',
        figure: comparative(reserve, units, unitSample, 2, 'qualifying retail units'),
        sample: unitSample,
        sampleLabel: 'retail units',
      },
    ],
    // THE STRUCTURE MIX IS NOT OPTIONAL CONTEXT. Both figures above divide by ALL retail
    // units, and a cash deal cannot generate reserve, so a different cash mix moves both for
    // reasons that have nothing to do with the finance office. It sits beside them.
    mixLabel: 'Finance structure',
    mix: [
      shareOf(cash, units, 'Cash'),
      shareOf(finance, units, 'Retail finance'),
      shareOf(lease, units, 'Lease'),
    ],
    context: [
      {
        label: 'Deliveries carrying a product',
        value: `${String(toCount(sumColumn(rows, 'financed_deals_with_a_product')))} of ${String(toCount(units))}`,
      },
      {
        label: 'Product contracts written',
        value: String(toCount(sumColumn(rows, 'financed_contract_count'))),
      },
    ],
  }
}

function bdcRow(
  code: string,
  leadRows: readonly DashboardRow[],
  appointmentRows: readonly DashboardRow[],
  roster: ReadonlyMap<string, RosterEntry>,
  floor: number,
  sources: ReadonlyMap<string, DashboardLeadSource>
): EmployeeRow {
  const valid = sumColumn(leadRows, 'valid_lead_count')
  const contacted = sumColumn(leadRows, 'contacted_lead_count')
  const apptSet = sumColumn(leadRows, 'appointment_set_lead_count')
  const unresponded = sumColumn(leadRows, 'unresponded_lead_count')
  const eligible = sumColumn(appointmentRows, 'bdc_eligible_appointments')
  const shownScheduled = sumColumn(
    appointmentRows,
    'bdc_shown_appointments_scheduled_basis'
  )
  const shownShow = sumColumn(appointmentRows, 'bdc_shown_appointments_show_basis')
  const shownSold = sumColumn(appointmentRows, 'bdc_shown_and_sold_appointments')
  const cancelled = sumColumn(appointmentRows, 'bdc_cancelled_in_advance_appointments')

  const validSample = sample(valid, floor)
  const contactedSample = sample(contacted, floor)
  const eligibleSample = sample(eligible, floor)
  const shownSample = sample(shownShow, floor)

  const identity = identityFrom(leadRows.length > 0 ? leadRows : appointmentRows)
  const entry = roster.get(code)
  const storeRow = (leadRows[0] ?? appointmentRows[0]) as DashboardRow

  return {
    code,
    storeId: textCell(storeRow, 'dealership_id'),
    jobRole: identity.jobRole,
    tenureBand: identity.tenureBand,
    family: 'BDC',
    activeInCurrentRoster: entry?.activeInCurrentRoster ?? true,
    volumeLabel: 'Valid leads assigned',
    volume: toCount(valid),
    measures: [
      {
        label: 'Contact rate',
        figure: comparative(contacted, valid, validSample, 4, 'valid assigned leads'),
        sample: validSample,
        sampleLabel: 'valid leads',
      },
      {
        // KPI-FUN-003's denominator is CONTACTED leads, never all valid ones. That defect was
        // found and corrected once already and is pinned here by construction.
        label: 'Appointment-set rate',
        figure: comparative(apptSet, contacted, contactedSample, 4, 'contacted leads'),
        sample: contactedSample,
        sampleLabel: 'contacted leads',
      },
      {
        label: 'Show rate',
        figure: comparative(
          shownScheduled,
          eligible,
          eligibleSample,
          4,
          'eligible appointments'
        ),
        sample: eligibleSample,
        sampleLabel: 'eligible appointments',
      },
      {
        label: 'Show-to-sale',
        figure: comparative(shownSold, shownShow, shownSample, 4, 'shown appointments'),
        sample: shownSample,
        sampleLabel: 'shown appointments',
      },
    ],
    mixLabel: 'Lead source mix',
    mix: sourceMix(leadRows, sources, valid),
    context: [
      { label: 'Never responded', value: String(toCount(unresponded)) },
      { label: 'Cancelled in advance', value: String(toCount(cancelled)) },
      {
        label: 'Median response',
        value: medianLabel(leadRows),
      },
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Lead source mix and response                                                */
/* -------------------------------------------------------------------------- */

/**
 * The share of a person's valid assigned leads by source CATEGORY.
 *
 * CONTEXT, NEVER A JUDGEMENT. No lead-quality score, difficulty index or source weighting
 * exists anywhere in ARPI and none is invented here. It is shown because comparing two
 * people's contact rates without it compares two different jobs.
 *
 * The categories are ordered by name, not by volume: ordering a mix by size would make the
 * biggest source read as the best one.
 */
export function sourceMix(
  rows: readonly DashboardRow[],
  sources: ReadonlyMap<string, DashboardLeadSource>,
  total: Exact
): readonly MixSlice[] {
  const byCategory = new Map<string, Exact>()
  for (const row of rows) {
    const source = sources.get(textCell(row, 'lead_source_code'))
    const category = source === undefined ? 'Unclassified' : source.category
    const cell = numericCell(row, 'valid_lead_count')
    const value = cell === null ? exactZero(0) : exactFromInteger(Number(cell))
    byCategory.set(category, addExact(byCategory.get(category) ?? exactZero(0), value))
  }
  return [...byCategory.entries()]
    .filter(([, value]) => toCount(value) > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, value]) => shareOf(value, total, category))
}

/** The commonest source category by valid leads, for a one-line context cell. */
function topSourceCategory(
  rows: readonly DashboardRow[],
  sources: ReadonlyMap<string, DashboardLeadSource>
): string {
  const slices = sourceMix(rows, sources, exactFromInteger(1))
  if (slices.length === 0) return 'No assigned leads'
  let best = slices[0] as MixSlice
  for (const slice of slices) if (slice.count > best.count) best = slice
  return `${best.label} (${String(best.count)})`
}

/**
 * A TRUE median first-response time, recomputed from the exported bins.
 *
 * Never an average of medians and never estimated from bands. The never-responded bin carries
 * a null value and is excluded here by predicate rather than coalesced to zero, which would
 * sort the ignored leads to the fastest end and improve the figure.
 */
export function medianResponseSeconds(rows: readonly DashboardRow[]): Exact | null {
  const bins: { value: number; count: number }[] = []
  for (const row of rows) {
    const seconds = numericCell(row, 'first_response_seconds')
    if (seconds === null) continue
    const responded = numericCell(row, 'responded_lead_count')
    const count = responded === null ? 0 : Number(responded)
    if (count > 0) bins.push({ value: Number(seconds), count })
  }
  return percentileFromBins(bins, 0.5, 0)
}

function medianLabel(rows: readonly DashboardRow[]): string {
  const seconds = medianResponseSeconds(rows)
  if (seconds === null) return 'No answered leads'
  const value = toCount(seconds)
  if (value < 60) return `${String(Math.round(value))} sec`
  return `${String(Math.round(value / 60))} min`
}

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export interface UnassignedSummary {
  readonly label: string
  readonly count: number
  readonly note: string
}

export interface EmployeeView {
  readonly family: RoleFamily
  readonly rows: readonly EmployeeRow[]
  readonly floor: number
  /** Activity credited to nobody, kept visible rather than dropped. */
  readonly unassigned: readonly UnassignedSummary[]
  /** True when every row's management-participation context is the same figure. */
  readonly deskParticipationConstant: boolean
  readonly selected: EmployeeRow | null
}

export function buildEmployeeView(
  scope: EmployeeScope,
  data: {
    readonly roster: readonly RosterEntry[]
    readonly sales: readonly DashboardRow[]
    readonly finance: readonly DashboardRow[]
    readonly appointments: readonly DashboardRow[]
    readonly leadSource: readonly DashboardRow[]
  },
  sources: readonly DashboardLeadSource[],
  fallbackFloor: number
): EmployeeView {
  const rosterByCode = new Map(data.roster.map((entry) => [entry.code, entry]))
  const sourceByCode = new Map(sources.map((source) => [source.code, source]))

  const salesScoped = familyRows(data.sales, scope, 'activity_date')
  const financeScoped = familyRows(data.finance, scope, 'activity_date')
  const apptScoped = familyRows(data.appointments, scope, 'activity_date')
  const leadScoped = familyRows(data.leadSource, scope, 'lead_created_date')

  // THE FLOOR COMES FROM THE EXPORT, from whichever dataset this family actually reads.
  const floor = floorFromRows(
    [...salesScoped, ...financeScoped, ...apptScoped],
    fallbackFloor
  )

  const leadsByEmployee = groupByEmployee(leadScoped)
  let rows: EmployeeRow[] = []

  if (scope.family === 'Salesperson') {
    for (const [code, employeeRows] of groupByEmployee(salesScoped)) {
      rows.push(
        salespersonRow(
          code,
          employeeRows,
          leadsByEmployee.get(code) ?? [],
          rosterByCode,
          floor,
          sourceByCode
        )
      )
    }
  } else if (scope.family === 'Desk Management') {
    for (const [code, employeeRows] of groupByEmployee(salesScoped)) {
      rows.push(deskRow(code, employeeRows, rosterByCode, floor))
    }
  } else if (scope.family === 'Finance') {
    for (const [code, employeeRows] of groupByEmployee(financeScoped)) {
      rows.push(financeRow(code, employeeRows, rosterByCode, floor))
    }
  } else {
    const appointmentsByEmployee = groupByEmployee(apptScoped)
    const codes = new Set([...leadsByEmployee.keys(), ...appointmentsByEmployee.keys()])
    for (const code of codes) {
      rows.push(
        bdcRow(
          code,
          leadsByEmployee.get(code) ?? [],
          appointmentsByEmployee.get(code) ?? [],
          rosterByCode,
          floor,
          sourceByCode
        )
      )
    }
  }

  rows = [...orderEmployees(rows)]

  const unassigned = buildUnassigned(scope, data)
  const participation = rows.every(
    (row) =>
      row.family !== 'Salesperson' ||
      row.context
        .find((item) => item.label === 'Deals with a desk manager')
        ?.value.split(' of ')[0] ===
        row.context
          .find((item) => item.label === 'Deals with a desk manager')
          ?.value.split(' of ')[1]
  )

  return {
    family: scope.family,
    rows,
    floor,
    unassigned,
    deskParticipationConstant: participation,
    selected:
      scope.employee === null
        ? null
        : (rows.find((row) => row.code === scope.employee) ?? null),
  }
}

/**
 * Activity credited to nobody, in scope, kept visible rather than tidied away.
 *
 * Three role keys are nullable and the development profile exercises all three. The tempting
 * defect is an inner join that makes the employee totals look clean by losing these rows; the
 * page shows them instead, outside the comparison and inside the store's totals.
 */
function buildUnassigned(
  scope: EmployeeScope,
  data: {
    readonly sales: readonly DashboardRow[]
    readonly finance: readonly DashboardRow[]
    readonly appointments: readonly DashboardRow[]
    readonly leadSource: readonly DashboardRow[]
  }
): readonly UnassignedSummary[] {
  const summaries: UnassignedSummary[] = []
  if (scope.family === 'Finance') {
    const rows = unassignedRows(data.finance, scope, 'activity_date')
    summaries.push({
      label: 'Deliveries with nobody on the F&I desk',
      count: toCount(sumColumn(rows, 'financed_retail_units')),
      note: 'Real retail deliveries with no finance manager credited. Inside the store total, outside the comparison above.',
    })
  }
  if (scope.family === 'BDC') {
    const leads = unassignedRows(data.leadSource, scope, 'lead_created_date')
    const appts = unassignedRows(data.appointments, scope, 'activity_date')
    summaries.push({
      label: 'Valid leads assigned to nobody',
      count: toCount(sumColumn(leads, 'valid_lead_count')),
      note: 'Real opportunity that reached no assignee. Counted in the store funnel, credited to no person.',
    })
    summaries.push({
      label: 'Eligible appointments with no BDC employee',
      count: toCount(sumColumn(appts, 'bdc_eligible_appointments')),
      note: 'Appointments the store kept or missed with nobody credited for setting them.',
    })
  }
  return summaries.filter((summary) => summary.count > 0)
}

/* -------------------------------------------------------------------------- */
/* Store context                                                               */
/* -------------------------------------------------------------------------- */

export interface StoreInventoryContext {
  readonly storeId: string
  /** Average active units available at the store across the observed snapshot days. */
  readonly averageActiveUnits: Figure
  readonly observedDays: number
}

/**
 * Store inventory availability, from the governed `inventory-health` export.
 *
 * A PROPERTY OF THE STORE AND NOT OF THE PERSON. Nobody can sell inventory the store does not
 * have, so it belongs beside a selling comparison — but it is not on any employee row, and
 * that is deliberate: a repeated store figure on employee rows is a figure something will
 * eventually sum across people and publish as group inventory, which would be nonsense. It is
 * computed once per store here and cannot be summed across employees because no employee
 * carries it.
 *
 * It is an AVERAGE OVER OBSERVED SNAPSHOT DAYS, which is the only additive reading of a
 * semi-additive stock measure: summing daily unit counts over a month overstates by roughly a
 * factor of thirty and looks entirely plausible while doing it.
 *
 * It is labelled availability and never difficulty. There is no such thing here as good, bad,
 * easy or hard inventory.
 */
export function buildStoreInventory(
  rows: readonly DashboardRow[],
  scope: EmployeeScope
): readonly StoreInventoryContext[] {
  const byStore = new Map<string, { total: Exact; days: Set<string> }>()
  for (const row of rows) {
    const store = textCell(row, 'dealership_id')
    if (!scope.stores.includes(store)) continue
    const date = textCell(row, 'snapshot_date')
    if (date < scope.period.start || date > scope.period.end) continue
    const cell = numericCell(row, 'active_inventory_units')
    const units = cell === null ? exactZero(0) : exactFromInteger(Number(cell))
    const bucket = byStore.get(store) ?? { total: exactZero(0), days: new Set<string>() }
    bucket.total = addExact(bucket.total, units)
    bucket.days.add(date)
    byStore.set(store, bucket)
  }
  return [...byStore.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([storeId, bucket]) => ({
      storeId,
      observedDays: bucket.days.size,
      averageActiveUnits:
        bucket.days.size === 0
          ? absent('no-data', 'No inventory snapshot falls inside this period.')
          : ratio(
              bucket.total,
              exactFromInteger(bucket.days.size),
              1,
              'No inventory snapshot falls inside this period.'
            ),
    }))
}

/* -------------------------------------------------------------------------- */
/* Totals for the role summary                                                 */
/* -------------------------------------------------------------------------- */

export interface RoleSummary {
  readonly people: number
  readonly volumeLabel: string
  readonly volume: number
  /** How many people are comparison-eligible on the family's leading ratio, and how many are not. */
  readonly eligible: number
  readonly belowFloor: number
  readonly floor: number
}

export function summarise(view: EmployeeView): RoleSummary {
  const leading = view.rows.map((row) => row.measures[0])
  return {
    people: view.rows.length,
    volumeLabel: view.rows[0]?.volumeLabel ?? 'Activity',
    volume: view.rows.reduce((sum, row) => sum + row.volume, 0),
    eligible: leading.filter(
      (measure) => measure !== undefined && isFigure(measure.figure)
    ).length,
    belowFloor: leading.filter(
      (measure) => measure !== undefined && measure.figure.kind === 'insufficient-sample'
    ).length,
    floor: view.floor,
  }
}

/** The widest volume on the page, so a bar can be drawn to scale from real data. */
export function volumeScale(rows: readonly EmployeeRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.volume), 0)
}

export { compareExact, figure, isFigure }
export type { Figure }
