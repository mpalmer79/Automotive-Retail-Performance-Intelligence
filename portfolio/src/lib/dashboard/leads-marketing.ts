/**
 * The leads and marketing surface, built from governed exports and nothing else.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO
 * ---------------------------------
 * Sum additive exported columns, divide one sum by another once at the end, and select an
 * order statistic out of an exported population. That is the whole vocabulary. It defines no
 * KPI, invents no denominator and computes no measure a reporting view does not already own —
 * ADR-0013 condition 2 — and every ratio below names the catalogue formula it implements.
 *
 * THE FIVE DATE BASES THIS PAGE CARRIES, WHICH ARE NOT INTERCHANGEABLE
 * --------------------------------------------------------------------
 *   lead creation   KPI-FUN-001/002/003/006, KPI-FUN-007/008, the stage-loss partition
 *   scheduled       KPI-FUN-004 show rate, and cancellation rate beside it
 *   show            KPI-FUN-005 show-to-sale conversion
 *   spend month     KPI-MKT-001/002/003, anchored to the ORIGINATING LEAD's creation month
 *
 * They are held apart structurally rather than by convention: each builder below reads one
 * dataset on one basis, and nothing in this file adds a figure on one basis to a figure on
 * another. The one place a reader could be misled — a funnel drawn as though every stage
 * shared a basis — is why `appointmentOutcomes` is a separate block with its own stated basis
 * rather than four more segments on the lead funnel.
 *
 * TWO GRAINS, AND WHY THE FUNNEL STOPS WHERE IT DOES
 * --------------------------------------------------
 * The cohort funnel is LEAD grain: five counts of leads. Show rate and show-to-sale
 * conversion are APPOINTMENT grain, because one lead can produce several appointments. They
 * are governed KPIs over different denominators and they are not continuations of the funnel,
 * so they are never rendered as funnel segments and the lead-grain shown/sold counts are never
 * labelled KPI-FUN-004 or KPI-FUN-005.
 *
 * EXACT VALUES, APPROXIMATE GEOMETRY
 * ----------------------------------
 * Every displayed number is `Exact` and every division is `divideExact`, which returns `null`
 * on a zero denominator rather than `Infinity`, `0` or a sentinel. `exactToApproxNumber` is
 * used by the components for bar widths and nothing else.
 */
import type { DashboardRow } from '@/types/dashboard'

import { numericCell, textCell, type DashboardLeadSource } from './data'
import {
  absent,
  figure,
  isFigure,
  percentileFromBins,
  ratio,
  sumColumn,
  type Absent,
  type AbsenceKind,
  type Figure,
} from './figures'
import {
  addExact,
  cellToExact,
  divideExact,
  exactFromInteger,
  exactZero,
  type Exact,
} from './decimal'
import type { DashboardFilters } from './filters'
import {
  appointmentSourceRows,
  campaignRows,
  leadStageLossRows,
  marketingPerformanceRows,
  responseDistributionRows,
} from './leads-marketing-data'
import type { ResolvedPeriod } from './periods'

export {
  absent,
  figure,
  isFigure,
  percentileFromBins,
  type Absent,
  type AbsenceKind,
  type Figure,
}

/* -------------------------------------------------------------------------- */
/* Absence, summation and the order statistic — shared, not owned                */
/* -------------------------------------------------------------------------- */
//
// DASH.11 moved these to `figures.ts` so `/dashboard/employees` could use them without
// importing this module's thousand lines of BDC selector logic, and — the reason that
// mattered — without a second implementation of `percentileFromBins`. Two medians would be
// two chances to drift from the equality RECON-LEAD-RESPONSE-DIST-MEDIAN asserts against
// PostgreSQL, and both copies would return a plausible number of seconds while doing it.
//
// Re-exported here because this module's consumers and tests already import them by this
// path, and an extraction should not make callers move.

/* -------------------------------------------------------------------------- */
/* Summation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Sum a nullable currency column, and say whether any row carried a value.
 *
 * The distinction is the organic cost rule. `spend_amount` is null — never zero — for a
 * source with no advertising cost, so a source-month whose rows are all null has NO SPEND,
 * which is a different statement from spending zero. Summing to `0` and reporting that would
 * turn a walk-in into a zero-cost advertising campaign, which is exactly what
 * RECON-MKT-COST-RULE exists to prevent.
 */
function sumNullableCurrency(
  rows: readonly DashboardRow[],
  column: string
): { readonly total: Exact; readonly present: boolean } {
  let total = exactZero(2)
  let present = false
  for (const row of rows) {
    const cell = numericCell(row, column)
    if (cell === null) continue
    const value = cellToExact(cell)
    if (value === null) continue
    present = true
    total = addExact(total, value)
  }
  return { total, present }
}

function toInt(value: Exact): number {
  return Number(value.units) / 10 ** value.scale
}

/* -------------------------------------------------------------------------- */
/* Row selection                                                               */
/* -------------------------------------------------------------------------- */

export interface LeadsScope {
  readonly stores: readonly string[]
  readonly period: ResolvedPeriod
  /** `null` when no source filter is in force. */
  readonly leadSources: readonly string[] | null
  /** `null` when no campaign filter is in force. */
  readonly campaigns: readonly string[] | null
}

/**
 * Apply the scope to a dataset's rows.
 *
 * THE SAME FILTER REACHES BOTH SIDES OF EVERY RATIO, and that is not a convention this file
 * asks callers to respect — it is structural. Each builder selects its rows ONCE with this
 * function and then sums the numerator and denominator out of the same selection, so a source
 * filter cannot scope a numerator while leaving its denominator group-wide. The alternative
 * shape, selecting twice with different predicates, is the defect
 * `leads-marketing.test.ts` seeds and proves it catches.
 */
function selectScope(
  rows: readonly DashboardRow[],
  scope: LeadsScope,
  dateColumn: string
): readonly DashboardRow[] {
  return rows.filter((row) => {
    const date = row[dateColumn]
    if (typeof date !== 'string') return false
    if (date < scope.period.start || date > scope.period.end) return false
    const store = row.dealership_id
    if (typeof store !== 'string' || !scope.stores.includes(store)) return false
    if (scope.leadSources !== null) {
      const source = row.lead_source_code
      if (typeof source !== 'string' || !scope.leadSources.includes(source)) return false
    }
    if (scope.campaigns !== null) {
      const campaign = row.campaign_code
      if (typeof campaign !== 'string' || !scope.campaigns.includes(campaign))
        return false
    }
    return true
  })
}

/* -------------------------------------------------------------------------- */
/* The lead-created cohort funnel                                              */
/* -------------------------------------------------------------------------- */

export interface FunnelStageView {
  readonly id: string
  readonly label: string
  readonly count: Exact
  /** The governed rate at this stage, or `null` where the project publishes none. */
  readonly rate: Figure | null
  readonly kpiId: string | null
  /** What the rate divides by, named so the reader is never guessing. */
  readonly denominatorLabel: string | null
}

export interface CohortFunnel {
  readonly stages: readonly FunnelStageView[]
  readonly leadsReceived: Exact
  readonly duplicatesExcluded: Exact
  readonly leadsBeforeExclusions: Exact
  readonly rowCount: number
}

/**
 * The lead-grain cohort funnel: five counts on the lead-creation basis.
 *
 * KPI-FUN-002 divides by leads received, KPI-FUN-003 by CONTACTED leads — an appointment
 * cannot be set with someone who was never reached, so a store with a poor contact rate can
 * show a healthy appointment-set rate, and that is correct behaviour rather than a flaw to
 * normalise away. It is also why the two rates are always rendered together.
 *
 * The last two stages carry counts and NO rate. `appointment_shown_leads / appointment_set_leads`
 * is not KPI-FUN-004 and `sold_leads / appointment_shown_leads` is not KPI-FUN-005: those KPIs
 * are appointment-grain, on different date bases, and labelling a lead-grain share with their
 * identifiers would relabel a measure rather than report one. Publishing them as unlabelled
 * percentages instead would create a governed measure by presentation, so they are counts.
 */
export function buildCohortFunnel(
  rows: readonly DashboardRow[],
  scope: LeadsScope
): CohortFunnel {
  const selected = selectScope(rows, scope, 'lead_created_date')
  const received = sumColumn(selected, 'leads_received')
  const contacted = sumColumn(selected, 'contacted_leads')
  const appointmentSet = sumColumn(selected, 'appointment_set_leads')
  const shown = sumColumn(selected, 'appointment_shown_leads')
  const sold = sumColumn(selected, 'sold_leads')

  return {
    leadsReceived: received,
    duplicatesExcluded: sumColumn(selected, 'duplicate_leads_excluded'),
    leadsBeforeExclusions: sumColumn(selected, 'leads_before_exclusions'),
    rowCount: selected.length,
    stages: [
      {
        id: 'received',
        label: 'Valid leads',
        count: received,
        rate: null,
        kpiId: 'KPI-FUN-001',
        denominatorLabel: null,
      },
      {
        id: 'contacted',
        label: 'Contacted',
        count: contacted,
        rate: ratio(contacted, received, 6, 'No valid leads in this scope'),
        kpiId: 'KPI-FUN-002',
        denominatorLabel: 'valid leads',
      },
      {
        id: 'appointment-set',
        label: 'Appointment set',
        count: appointmentSet,
        rate: ratio(appointmentSet, contacted, 6, 'No contacted leads in this scope'),
        kpiId: 'KPI-FUN-003',
        denominatorLabel: 'contacted leads',
      },
      {
        id: 'shown',
        label: 'Reached showroom',
        count: shown,
        rate: null,
        kpiId: null,
        denominatorLabel: null,
      },
      {
        id: 'sold',
        label: 'Sold',
        count: sold,
        rate: ratio(sold, received, 6, 'No valid leads in this scope'),
        kpiId: 'KPI-FUN-006',
        denominatorLabel: 'valid leads',
      },
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Appointment outcomes                                                        */
/* -------------------------------------------------------------------------- */

export interface AppointmentOutcomes {
  readonly scheduled: Exact
  readonly eligible: Exact
  readonly cancelledInAdvance: Exact
  readonly shown: Exact
  readonly showRate: Figure
  readonly cancellationRate: Figure
  readonly shownOnShowDate: Exact
  readonly shownAndSold: Exact
  readonly showToSale: Figure
  readonly rowCount: number
}

/**
 * KPI-FUN-004 and KPI-FUN-005, at appointment grain, on their own two date bases.
 *
 * Show rate divides by ELIGIBLE appointments — scheduled less those cancelled in advance —
 * because a customer who cancelled the day before never had the opportunity to show, and
 * counting them as a no-show conflates two different failures. That exclusion is also the
 * manipulable part of the measure: reclassifying no-shows as advance cancellations produces a
 * flattering show rate. `cancellationRate` is returned on the same object and the component
 * renders it on the same visual, which is the only reason the exclusion is safe to make.
 *
 * Show-to-sale is on the SHOW date, so the visit and its outcome sit in the same period. Its
 * denominator is `shown_appointments_on_show_date` and never `shown_appointments`, which is
 * the same count attributed to the scheduled date instead.
 */
export function buildAppointmentOutcomes(
  rows: readonly DashboardRow[],
  scope: LeadsScope
): AppointmentOutcomes {
  const selected = selectScope(rows, scope, 'appointment_date')
  const scheduled = sumColumn(selected, 'scheduled_appointments')
  const eligible = sumColumn(selected, 'eligible_appointments')
  const cancelled = sumColumn(selected, 'cancelled_in_advance_appointments')
  const shown = sumColumn(selected, 'shown_appointments')
  const shownOnShowDate = sumColumn(selected, 'shown_appointments_on_show_date')
  const shownAndSold = sumColumn(selected, 'shown_and_sold_appointments')

  return {
    scheduled,
    eligible,
    cancelledInAdvance: cancelled,
    shown,
    shownOnShowDate,
    shownAndSold,
    rowCount: selected.length,
    showRate: ratio(
      shown,
      eligible,
      6,
      'No appointment was eligible to show in this scope'
    ),
    cancellationRate: ratio(
      cancelled,
      scheduled,
      6,
      'No appointment was scheduled in this scope'
    ),
    showToSale: ratio(shownAndSold, shownOnShowDate, 6, 'Nobody showed in this scope'),
  }
}

/* -------------------------------------------------------------------------- */
/* Response time                                                               */
/* -------------------------------------------------------------------------- */

export interface ResponseBand {
  readonly label: string
  readonly count: Exact
  /** Share of RESPONDED leads. Never of all leads, and never of the largest band. */
  readonly share: Figure
}

export interface ResponseSummary {
  readonly validLeads: Exact
  readonly respondedLeads: Exact
  readonly unrespondedLeads: Exact
  readonly coverageRate: Figure
  readonly medianMinutes: Figure
  readonly meanMinutes: Figure
  readonly p90Minutes: Figure
  readonly bands: readonly ResponseBand[]
  readonly rowCount: number
}

/** The governed bands, in ascending order. Descriptive bins: ARPI publishes no target. */
export const RESPONSE_BANDS = [
  'Under 5 minutes',
  '5-15 minutes',
  '15-60 minutes',
  'Over 60 minutes',
] as const

/**
 * KPI-FUN-007, KPI-FUN-008, the distribution, and the population both KPIs are blind to.
 *
 * The median is the headline because the distribution is severely right-skewed and one lead
 * answered four days late moves a store-month mean. The mean is retained as its companion and
 * because it alone reconciles additively to total response seconds; P90 shows the tail the
 * median is deliberately insensitive to.
 *
 * UNRESPONDED LEADS ARE RETURNED WITH THEM, ALWAYS. Both response KPIs exclude leads that were
 * never answered, so a store that ignores half its leads can report an excellent median. That
 * is not a caveat for a methodology drawer: the count and the coverage rate come back on the
 * same object and the component renders them beside the distribution.
 *
 * A NULL first response means never answered. Zero seconds means an instant response and is an
 * ordinary observation, included in the median and in the under-five-minute band. The two are
 * separated here by predicate, not by coalescing.
 */
export function buildResponseSummary(
  rows: readonly DashboardRow[],
  scope: LeadsScope
): ResponseSummary {
  const selected = selectScope(rows, scope, 'lead_created_date')

  const validLeads = sumColumn(selected, 'lead_count')
  const responded = sumColumn(selected, 'responded_lead_count')
  const unresponded = sumColumn(selected, 'unresponded_lead_count')
  const secondsTotal = sumColumn(selected, 'response_seconds_total')

  const bins: { value: number; count: number }[] = []
  for (const row of selected) {
    const cell = numericCell(row, 'first_response_seconds')
    // NULL is the never-responded bin. It is not a value and never becomes one.
    if (cell === null) continue
    const count = numericCell(row, 'responded_lead_count')
    bins.push({ value: Number(cell), count: Number(count ?? 0) })
  }

  const medianSeconds = percentileFromBins(bins, 0.5, 4)
  const p90Seconds = percentileFromBins(bins, 0.9, 4)
  const sixty = exactFromInteger(60)
  const noResponse = 'No lead was responded to in this scope'

  /** Seconds to minutes, carrying the absence rather than substituting a number for it. */
  const inMinutes = (seconds: Exact | null): Figure => {
    if (seconds === null) return absent('no-data', noResponse)
    const minutes = divideExact(seconds, sixty, 4)
    return minutes === null ? absent('no-data', noResponse) : figure(minutes)
  }

  /*
   * KPI-FUN-007 is summed seconds over summed responded leads, divided once, then converted
   * to the catalogue's unit. Never an average of per-row averages: the export publishes
   * `response_seconds_total` as a separate additive column precisely so a group mean is
   * formed from components rather than from already-averaged values.
   */
  const meanSeconds = divideExact(secondsTotal, responded, 6)

  const bands = RESPONSE_BANDS.map((label) => {
    const count = sumColumn(
      selected.filter((row) => row.response_time_band === label),
      'responded_lead_count'
    )
    return {
      label,
      count,
      // The denominator is RESPONDED leads: the bands partition the answered population.
      // Dividing by all leads would silently fold the ignored ones into every band, and
      // dividing by the largest band would draw a chart that always fills its width.
      share: ratio(count, responded, 6, 'No lead was responded to in this scope'),
    }
  })

  return {
    validLeads,
    respondedLeads: responded,
    unrespondedLeads: unresponded,
    rowCount: selected.length,
    coverageRate: ratio(responded, validLeads, 6, 'No valid lead in this scope'),
    meanMinutes: inMinutes(meanSeconds),
    medianMinutes: inMinutes(medianSeconds),
    p90Minutes: inMinutes(p90Seconds),
    bands,
  }
}

/* -------------------------------------------------------------------------- */
/* Lost-stage analysis                                                         */
/* -------------------------------------------------------------------------- */

export interface StageLossEntry {
  readonly id: string
  readonly label: string
  readonly count: Exact
}

export interface StageLoss {
  readonly leadsReceived: Exact
  readonly entries: readonly StageLossEntry[]
  readonly soldWithoutShowroomVisit: Exact
  readonly rowCount: number
}

/**
 * Where the cohort stopped, in neutral language and with no claim about why.
 *
 * The five entries are the exported partition and are mutually exclusive: SQL owns the
 * arithmetic, this function selects and sums it. The labels say a lead did not REACH a stage,
 * which is the only defensible statement — ARPI models no communication content, activity
 * detail or disposition, so nothing here can distinguish a customer who stopped replying from
 * a store that stopped calling, and a label implying either would be an assertion the data
 * cannot support.
 *
 * `soldWithoutShowroomVisit` is an OVERLAY, not a sixth entry. Those leads are already inside
 * one of the first three counts, and adding it to the five would double-count them and break
 * the identity with leads received.
 */
export function buildStageLoss(
  rows: readonly DashboardRow[],
  scope: LeadsScope
): StageLoss {
  const selected = selectScope(rows, scope, 'lead_created_date')
  return {
    leadsReceived: sumColumn(selected, 'leads_received'),
    rowCount: selected.length,
    soldWithoutShowroomVisit: sumColumn(selected, 'sold_without_modelled_showroom_visit'),
    entries: [
      {
        id: 'not-contacted',
        label: 'Did not reach contact',
        count: sumColumn(selected, 'not_contacted'),
      },
      {
        id: 'no-appointment',
        label: 'Did not reach appointment',
        count: sumColumn(selected, 'contacted_not_appointment_set'),
      },
      {
        id: 'no-show',
        label: 'Did not reach showroom',
        count: sumColumn(selected, 'appointment_set_not_shown'),
      },
      {
        id: 'shown-not-sold',
        label: 'Showed without attributed sale',
        count: sumColumn(selected, 'shown_not_sold'),
      },
      {
        id: 'shown-and-sold',
        label: 'Showed and bought',
        count: sumColumn(selected, 'shown_and_sold'),
      },
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Source comparison                                                           */
/* -------------------------------------------------------------------------- */

export interface SourceRow {
  readonly code: string
  readonly name: string
  readonly category: string
  readonly leadsReceived: Exact
  readonly contactRate: Figure
  readonly appointmentSetRate: Figure
  readonly leadToSale: Figure
  readonly soldLeads: Exact
}

/**
 * One row per lead source in scope, ordered by business code.
 *
 * NO COMPOSITE SCORE, NO RANK, NO BEST OR WORST. A source's leads are not comparable to
 * another's without controlling for source — that is what `vw_lead_funnel`'s own column
 * comment says — so a single number blending volume, conversion and cost would be a judgement
 * this project cannot support, presented as a measurement. The reader gets the governed
 * measures side by side and does the comparing.
 *
 * The order is the business code, ascending, and is therefore stable: a table that reorders
 * itself when the data moves makes period-over-period reading impossible.
 */
export function buildSourceComparison(
  funnelRows: readonly DashboardRow[],
  scope: LeadsScope,
  sources: readonly DashboardLeadSource[]
): readonly SourceRow[] {
  const selected = selectScope(funnelRows, scope, 'lead_created_date')
  const byCode = new Map<string, DashboardRow[]>()
  for (const row of selected) {
    const code = textCell(row, 'lead_source_code')
    const bucket = byCode.get(code)
    if (bucket === undefined) byCode.set(code, [row])
    else bucket.push(row)
  }

  const rows: SourceRow[] = []
  for (const [code, group] of byCode) {
    const definition = sources.find((entry) => entry.code === code)
    const received = sumColumn(group, 'leads_received')
    const contacted = sumColumn(group, 'contacted_leads')
    const appointmentSet = sumColumn(group, 'appointment_set_leads')
    const sold = sumColumn(group, 'sold_leads')
    rows.push({
      code,
      name: definition?.name ?? code,
      category: definition?.category ?? 'Unclassified',
      leadsReceived: received,
      soldLeads: sold,
      contactRate: ratio(contacted, received, 6, 'No valid leads from this source'),
      appointmentSetRate: ratio(
        appointmentSet,
        contacted,
        6,
        'No contacted leads from this source'
      ),
      leadToSale: ratio(sold, received, 6, 'No valid leads from this source'),
    })
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

/* -------------------------------------------------------------------------- */
/* Marketing efficiency                                                        */
/* -------------------------------------------------------------------------- */

export type CostState =
  | 'measurable'
  | 'not-cost-attributable'
  | 'spend-without-leads'
  | 'spend-without-sales'
  | 'leads-without-spend'

export interface MarketingRow {
  readonly key: string
  readonly sourceCode: string
  readonly sourceName: string
  readonly campaignCode: string | null
  readonly campaignName: string | null
  readonly channel: string | null
  readonly targetVehicleCategory: string | null
  readonly costAttributable: boolean
  readonly spend: Figure
  readonly attributedLeads: Exact
  readonly attributedRetailUnits: Exact
  readonly attributedTotalGross: Exact
  readonly attributedFrontGross: Exact
  readonly vendorReportedLeads: Exact
  readonly impressions: Exact
  readonly clicks: Exact
  readonly costPerLead: Figure
  readonly costPerSale: Figure
  readonly grossRoas: Figure
  readonly costState: CostState
}

const NOT_COST_ATTRIBUTABLE =
  'This source carries no advertising cost, so a cost per opportunity is not a figure that exists for it'

/**
 * Ratio of sums, per group, with the organic rule and the zero-denominator states.
 *
 * RATIO OF SUMS, NEVER A MEAN OF RATIOS. Cost per lead over several campaign-months is
 * total spend over total attributed leads. Averaging the per-row cost per lead weights a
 * campaign that produced two leads the same as one that produced two hundred, and returns a
 * different number — `leads-marketing.test.ts` asserts the two differ on real data so the
 * rule cannot be satisfied by coincidence.
 *
 * THE ORGANIC RULE IS ABSOLUTE. Where `is_cost_attributable` is false, all three measures are
 * NOT APPLICABLE and never zero. A walk-in is not a zero-cost advertising campaign, and `$0.00
 * cost per lead` would sort it to the top of any cost comparison as the most efficient channel
 * the group operates.
 *
 * ZERO DENOMINATORS ARE STATES, NOT NUMBERS. Spend with no attributed lead is reported as
 * exactly that, because "cost per lead: no data" does not tell a manager the money was spent.
 * Nothing here returns Infinity.
 */
function marketingMeasures(
  rows: readonly DashboardRow[],
  costAttributable: boolean
): Pick<
  MarketingRow,
  'spend' | 'costPerLead' | 'costPerSale' | 'grossRoas' | 'costState'
> & {
  readonly attributedLeads: Exact
  readonly attributedRetailUnits: Exact
  readonly attributedTotalGross: Exact
} {
  const spend = sumNullableCurrency(rows, 'spend_amount')
  const leads = sumColumn(rows, 'attributed_leads')
  const units = sumColumn(rows, 'attributed_retail_units')
  const gross = sumColumn(rows, 'attributed_total_gross')

  const shared = {
    attributedLeads: leads,
    attributedRetailUnits: units,
    attributedTotalGross: gross,
  }

  if (!costAttributable) {
    return {
      ...shared,
      spend: absent('not-applicable', NOT_COST_ATTRIBUTABLE),
      costPerLead: absent('not-applicable', NOT_COST_ATTRIBUTABLE),
      costPerSale: absent('not-applicable', NOT_COST_ATTRIBUTABLE),
      grossRoas: absent('not-applicable', NOT_COST_ATTRIBUTABLE),
      costState: 'not-cost-attributable',
    }
  }

  if (!spend.present) {
    // A cost-attributable source with no spend row in this period: leads arrived, no money
    // is recorded against them. Reported as its own state rather than as zero spend.
    return {
      ...shared,
      spend: absent('no-data', 'No spend is recorded for this scope'),
      costPerLead: absent('no-data', 'No spend is recorded for this scope'),
      costPerSale: absent('no-data', 'No spend is recorded for this scope'),
      grossRoas: absent('no-data', 'No spend is recorded for this scope'),
      costState: 'leads-without-spend',
    }
  }

  const noLeads = leads.units === 0n
  const noUnits = units.units === 0n

  return {
    ...shared,
    spend: figure(spend.total),
    costPerLead: noLeads
      ? absent('no-data', 'Spend with no attributed leads')
      : ratio(spend.total, leads, 2, 'Spend with no attributed leads'),
    costPerSale: noUnits
      ? absent('no-data', 'Spend with no attributed retail sales')
      : ratio(spend.total, units, 2, 'Spend with no attributed retail sales'),
    grossRoas: ratio(gross, spend.total, 2, 'No spend to return against'),
    costState: noLeads
      ? 'spend-without-leads'
      : noUnits
        ? 'spend-without-sales'
        : 'measurable',
  }
}

export interface MarketingSummary {
  readonly rows: readonly MarketingRow[]
  readonly totalSpend: Figure
  readonly attributedLeads: Exact
  readonly attributedRetailUnits: Exact
  readonly attributedTotalGross: Exact
  readonly costPerLead: Figure
  readonly costPerSale: Figure
  readonly grossRoas: Figure
  /** Months the period covers in FULL. Marketing is month grain and never renders below it. */
  readonly wholeMonths: readonly string[]
  /** `true` when the period covers no whole month, so no cost measure is comparable. */
  readonly monthGrainUnavailable: boolean
  readonly rowCount: number
}

/**
 * Marketing efficiency at its finest valid grain, which is the MONTH.
 *
 * Spend is monthly and leads are daily. Dividing a month of spend by eleven days of leads
 * produces a number that is meaningless and looks entirely reasonable, so this builder reads
 * only the months the selected period covers IN FULL. A period covering no whole month
 * returns `monthGrainUnavailable`, and the page renders the cost measures as structurally
 * unavailable rather than prorating spend — ARPI governs no proration policy, and inventing
 * one here would be a formula, not a selection.
 *
 * The group totals are ratio-of-sums over the COST-ATTRIBUTABLE rows only. Folding organic
 * leads into the denominator of a group cost per lead would divide real money by opportunities
 * that money did not buy, which flatters every paid channel at once.
 */
export function buildMarketingSummary(
  rows: readonly DashboardRow[],
  campaigns: readonly DashboardRow[],
  scope: LeadsScope,
  sources: readonly DashboardLeadSource[]
): MarketingSummary {
  const wholeMonths = scope.period.wholeMonths
  const monthStarts = new Set(wholeMonths.map((month) => `${month}-01`))

  const selected = rows.filter((row) => {
    const month = row.month_start_date
    if (typeof month !== 'string' || !monthStarts.has(month)) return false
    const store = row.dealership_id
    if (typeof store !== 'string' || !scope.stores.includes(store)) return false
    if (scope.leadSources !== null) {
      const source = row.lead_source_code
      if (typeof source !== 'string' || !scope.leadSources.includes(source)) return false
    }
    if (scope.campaigns !== null) {
      const campaign = row.campaign_code
      if (typeof campaign !== 'string' || !scope.campaigns.includes(campaign))
        return false
    }
    return true
  })

  const campaignByCode = new Map<string, DashboardRow>()
  for (const row of campaigns) campaignByCode.set(textCell(row, 'campaign_code'), row)

  const grouped = new Map<string, DashboardRow[]>()
  for (const row of selected) {
    const source = textCell(row, 'lead_source_code')
    const campaign = row.campaign_code
    const key = `${source}::${typeof campaign === 'string' ? campaign : ''}`
    const bucket = grouped.get(key)
    if (bucket === undefined) grouped.set(key, [row])
    else bucket.push(row)
  }

  const built: MarketingRow[] = []
  for (const [key, group] of grouped) {
    const first = group[0]
    if (first === undefined) continue
    const sourceCode = textCell(first, 'lead_source_code')
    const campaignCode =
      typeof first.campaign_code === 'string' ? first.campaign_code : null
    const costAttributable = group.some((row) => row.is_cost_attributable === true)
    const campaign = campaignCode === null ? undefined : campaignByCode.get(campaignCode)
    const measures = marketingMeasures(group, costAttributable)

    built.push({
      key,
      sourceCode,
      sourceName: sources.find((entry) => entry.code === sourceCode)?.name ?? sourceCode,
      campaignCode,
      campaignName: campaign === undefined ? null : textCell(campaign, 'campaign_name'),
      channel: campaign === undefined ? null : textCell(campaign, 'channel'),
      targetVehicleCategory:
        campaign === undefined ? null : textCell(campaign, 'target_vehicle_category'),
      costAttributable,
      attributedFrontGross: sumColumn(group, 'attributed_front_end_gross'),
      vendorReportedLeads: sumColumn(group, 'vendor_reported_leads'),
      impressions: sumColumn(group, 'impressions'),
      clicks: sumColumn(group, 'clicks'),
      ...measures,
    })
  }

  built.sort(
    (a, b) =>
      a.sourceCode.localeCompare(b.sourceCode) ||
      (a.campaignCode ?? '').localeCompare(b.campaignCode ?? '')
  )

  const paidRows = selected.filter((row) => row.is_cost_attributable === true)
  const totals = marketingMeasures(paidRows, paidRows.length > 0)

  return {
    rows: built,
    rowCount: selected.length,
    wholeMonths,
    monthGrainUnavailable: wholeMonths.length === 0,
    totalSpend: totals.spend,
    attributedLeads: sumColumn(selected, 'attributed_leads'),
    attributedRetailUnits: sumColumn(selected, 'attributed_retail_units'),
    attributedTotalGross: sumColumn(selected, 'attributed_total_gross'),
    costPerLead: totals.costPerLead,
    costPerSale: totals.costPerSale,
    grossRoas: totals.grossRoas,
  }
}

/* -------------------------------------------------------------------------- */
/* Vendor count discrepancy                                                    */
/* -------------------------------------------------------------------------- */

export interface VendorDiscrepancy {
  readonly vendorReported: Exact
  readonly crmReceived: Exact
  readonly duplicatesExcluded: Exact
  readonly validLeads: Exact
  readonly difference: Exact
}

/**
 * Four counts of four different things, published side by side and never reconciled.
 *
 * Vendors count differently and typically count duplicates, so vendor-reported leads and valid
 * CRM leads are DELIBERATELY different populations. The difference is evidence to investigate
 * with a vendor, not a data-quality failure and not a number to make go away — and
 * `vendor_reported_leads` is never substituted for KPI-FUN-001.
 *
 * The vendor figure is month-grain and the CRM figures are day-grain, so the comparison is
 * only formed over whole months; the page says so where it renders.
 */
export function buildVendorDiscrepancy(
  marketingRows: readonly DashboardRow[],
  funnelRows: readonly DashboardRow[],
  scope: LeadsScope
): VendorDiscrepancy {
  const monthStarts = new Set(scope.period.wholeMonths.map((month) => `${month}-01`))
  const marketing = marketingRows.filter((row) => {
    const month = row.month_start_date
    if (typeof month !== 'string' || !monthStarts.has(month)) return false
    const store = row.dealership_id
    if (typeof store !== 'string' || !scope.stores.includes(store)) return false
    if (scope.leadSources !== null) {
      const source = row.lead_source_code
      if (typeof source !== 'string' || !scope.leadSources.includes(source)) return false
    }
    if (scope.campaigns !== null) {
      const campaign = row.campaign_code
      if (typeof campaign !== 'string' || !scope.campaigns.includes(campaign))
        return false
    }
    return true
  })

  const wholeMonthScope: LeadsScope = {
    ...scope,
    period: {
      ...scope.period,
      start:
        scope.period.wholeMonths.length === 0
          ? scope.period.end
          : `${scope.period.wholeMonths[0]}-01`,
      end: scope.period.end,
    },
  }
  const funnel = selectScope(
    funnelRows,
    scope.period.wholeMonths.length === 0 ? scope : wholeMonthScope,
    'lead_created_date'
  )

  const vendor = sumColumn(marketing, 'vendor_reported_leads')
  const valid = sumColumn(funnel, 'leads_received')
  const duplicates = sumColumn(funnel, 'duplicate_leads_excluded')
  const crm = sumColumn(funnel, 'leads_before_exclusions')

  return {
    vendorReported: vendor,
    crmReceived: crm,
    duplicatesExcluded: duplicates,
    validLeads: valid,
    difference: addExact(vendor, { units: -valid.units, scale: valid.scale }),
  }
}

/* -------------------------------------------------------------------------- */
/* The page payload                                                            */
/* -------------------------------------------------------------------------- */

export interface LeadsMarketingView {
  readonly scope: LeadsScope
  readonly funnel: CohortFunnel
  readonly appointments: AppointmentOutcomes
  readonly response: ResponseSummary
  readonly stageLoss: StageLoss
  readonly sources: readonly SourceRow[]
  readonly marketing: MarketingSummary
  readonly vendor: VendorDiscrepancy
  /** `true` when the period includes the newest cohort the export carries. */
  readonly includesImmatureCohort: boolean
}

/**
 * Assemble the page from the datasets its route door carries.
 *
 * COHORT MATURITY IS DISCLOSED, NOT MODELLED. A lead created near the end of the window has
 * had less time to convert, so lead-to-sale conversion, cost per sale and gross return all
 * improve for weeks after a period closes. ARPI governs no maturity horizon and this increment
 * does not invent one: `includesImmatureCohort` says only whether the selected period reaches
 * the last date the export carries, and the page states in words that recent cohorts are
 * structurally incomplete. Choosing a "mature after N days" threshold would be a governed
 * decision, and it is not one a presentation increment gets to make.
 */
export function buildLeadsMarketingView(
  funnelRows: readonly DashboardRow[],
  scope: LeadsScope,
  sources: readonly DashboardLeadSource[],
  lastExportDate: string
): LeadsMarketingView {
  const { stores } = scope
  const months = scope.period.months

  return {
    scope,
    funnel: buildCohortFunnel(funnelRows, scope),
    appointments: buildAppointmentOutcomes(appointmentSourceRows(stores, months), scope),
    response: buildResponseSummary(responseDistributionRows(stores, months), scope),
    stageLoss: buildStageLoss(leadStageLossRows(stores, months), scope),
    sources: buildSourceComparison(funnelRows, scope, sources),
    marketing: buildMarketingSummary(
      marketingPerformanceRows(),
      campaignRows(),
      scope,
      sources
    ),
    vendor: buildVendorDiscrepancy(marketingPerformanceRows(), funnelRows, scope),
    includesImmatureCohort: scope.period.end >= lastExportDate,
  }
}

/**
 * Convert the console's filter state into this route's scope.
 *
 * `source` and `campaign` are single-valued in the console's filter grammar, and they are
 * widened to one-element lists here so every builder above applies them the same way. An
 * empty selection becomes `null` — meaning "no filter", not "match nothing" — because a
 * filter that matched nothing would zero every card on the page and read as an empty month.
 */
export function scopeFromFilters(
  filters: DashboardFilters,
  period: ResolvedPeriod,
  allStores: readonly string[]
): LeadsScope {
  return {
    stores: filters.store.length === 0 ? allStores : filters.store,
    period,
    leadSources: filters.source === null ? null : [filters.source],
    campaigns: filters.campaign === null ? null : [filters.campaign],
  }
}

export { toInt }
