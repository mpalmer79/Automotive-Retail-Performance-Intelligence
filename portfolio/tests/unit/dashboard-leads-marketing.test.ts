/**
 * The leads and marketing model, reconciled against the export and driven with seeded defects.
 *
 * Same contract as `dashboard-inventory.test.ts` and `dashboard-accounting.test.ts`:
 * `dashboard-boundaries.test.ts` permits `leads-marketing.ts` to perform exact arithmetic on
 * the strength of a claim, and this is where the claim is tested rather than asserted.
 *
 * EVERY SEEDED DEFECT BELOW MUST CHANGE THE ANSWER. A corruption that produces the same
 * output under the right and the wrong implementation proves nothing, so each one asserts a
 * DIFFERENCE first and only then asserts which of the two is correct. Where the committed
 * data happens not to distinguish two implementations, the test says so and fails rather
 * than passing vacuously — that is the failure mode the KPI-FUN-003 defect survived nine
 * increments inside.
 */
import { describe, expect, it } from 'vitest'

import { decodeDataset, dashboardLeadSources } from '../../src/lib/dashboard/data.ts'
import { exactToString, type Exact } from '../../src/lib/dashboard/decimal.ts'
import { DEFAULT_FILTERS } from '../../src/lib/dashboard/filters.ts'
import {
  buildAppointmentOutcomes,
  buildCohortFunnel,
  buildMarketingSummary,
  buildResponseSummary,
  buildSourceComparison,
  buildStageLoss,
  buildVendorDiscrepancy,
  isFigure,
  percentileFromBins,
  scopeFromFilters,
  type Figure,
  type LeadsScope,
} from '../../src/lib/dashboard/leads-marketing.ts'
import {
  appointmentSourceChunkFile,
  leadStageLossChunkFile,
  leadsMarketingChunkKeys,
  responseDistributionChunkFile,
} from '../../src/lib/dashboard/leads-marketing-chunks.ts'
import {
  campaignRows,
  marketingPerformanceRows,
} from '../../src/lib/dashboard/leads-marketing-data.ts'
import { chunkFile } from '../../src/lib/dashboard/chunks.ts'
import type { DashboardRow } from '../../src/types/dashboard.ts'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const STORES = ['GSA-001', 'GSA-002', 'GSA-003'] as const
const MONTH = '2025-12'

/** A period covering exactly December 2025, which the export carries in full. */
function period(months: readonly string[] = [MONTH]) {
  const first = months[0] ?? MONTH
  const last = months[months.length - 1] ?? MONTH
  return {
    start: `${first}-01`,
    end: `${last}-31`,
    label: 'December 2025',
    months: [...months],
    wholeMonths: [...months],
    calendarDays: 31,
    sellingDays: 27,
  }
}

function scope(overrides: Partial<LeadsScope> = {}): LeadsScope {
  return {
    stores: [...STORES],
    period: period(),
    leadSources: null,
    campaigns: null,
    ...overrides,
  }
}

/**
 * Read a partition under a key that NAMES it.
 *
 * `decodeDataset` memoizes, and passing the bare dataset name would return the first
 * partition's rows for every store — right columns, plausible counts, wrong store. That
 * defect shipped twice in this project, so the key is built the same way the route builds it.
 */
function partition(
  dataset: string,
  reader: (store: string, month: string) => ReturnType<typeof appointmentSourceChunkFile>,
  stores: readonly string[] = STORES,
  months: readonly string[] = [MONTH]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = reader(store, month)
      if (file === undefined) throw new Error(`no ${dataset} partition ${store}/${month}`)
      rows.push(...decodeDataset(`${dataset}/${store}/${month}`, file))
    }
  }
  return rows
}

function funnelRows(
  stores: readonly string[] = STORES,
  months: readonly string[] = [MONTH]
): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    for (const month of months) {
      const file = chunkFile('lead-funnel', store, month)
      if (file === undefined)
        throw new Error(`no lead-funnel partition ${store}/${month}`)
      rows.push(...decodeDataset(`lead-funnel/${store}/${month}`, file))
    }
  }
  return rows
}

const appointments = () =>
  partition('appointment-source-funnel', appointmentSourceChunkFile)
const stageLoss = () => partition('lead-stage-loss', leadStageLossChunkFile)
const distribution = () =>
  partition('lead-response-distribution', responseDistributionChunkFile)

/** The exact string of a figure, or the absence kind, so both are assertable. */
function show(value: Figure): string {
  return isFigure(value) ? exactToString(value.value) : value.kind
}

function num(value: Exact): number {
  return Number(exactToString(value))
}

/* -------------------------------------------------------------------------- */
/* The cohort funnel                                                           */
/* -------------------------------------------------------------------------- */

describe('the lead-created cohort funnel', () => {
  const funnel = buildCohortFunnel(funnelRows(), scope())

  it('reads a non-empty population from the committed export', () => {
    expect(funnel.rowCount).toBeGreaterThan(0)
    expect(num(funnel.leadsReceived)).toBe(946)
  })

  it('divides KPI-FUN-003 by contacted leads and not by leads received', () => {
    /*
     * THE DEFECT THIS FILE EXISTS FOR. The export contract and the console selector both
     * divided by `leads_received` from DASH.1 until DASH.10, against KPI_CATALOG.md §26,
     * the reporting view and an integration test that all say contacted leads.
     *
     * The two candidates must differ on this data, or the assertion below is vacuous.
     */
    const contacted = num(funnel.stages[1]?.count ?? { units: 0n, scale: 0 })
    const appointmentSet = num(funnel.stages[2]?.count ?? { units: 0n, scale: 0 })
    const received = num(funnel.leadsReceived)
    expect(contacted).not.toBe(received)

    const governed = appointmentSet / contacted
    const defective = appointmentSet / received
    expect(governed).not.toBeCloseTo(defective, 4)

    const rendered = funnel.stages[2]?.rate
    expect(rendered).toBeDefined()
    expect(Number(show(rendered as Figure))).toBeCloseTo(governed, 6)
    expect(funnel.stages[2]?.denominatorLabel).toBe('contacted leads')
  })

  it('divides contact rate and lead-to-sale conversion by valid leads', () => {
    const received = num(funnel.leadsReceived)
    expect(Number(show(funnel.stages[1]?.rate as Figure))).toBeCloseTo(
      num(funnel.stages[1]?.count as Exact) / received,
      6
    )
    expect(Number(show(funnel.stages[4]?.rate as Figure))).toBeCloseTo(
      num(funnel.stages[4]?.count as Exact) / received,
      6
    )
  })

  it('publishes no rate for the lead-grain shown stage', () => {
    /*
     * `appointment_shown_leads / appointment_set_leads` is NOT KPI-FUN-004: show rate is
     * computed over appointments, on the scheduled-date basis, against eligible
     * appointments. Publishing this ratio unlabelled would create a governed measure by
     * presentation, and labelling it KPI-FUN-004 would relabel a different one.
     */
    expect(funnel.stages[3]?.rate).toBeNull()
    expect(funnel.stages[3]?.kpiId).toBeNull()
  })

  it('keeps duplicates out of every stage and publishes them separately', () => {
    expect(num(funnel.duplicatesExcluded)).toBeGreaterThan(0)
    expect(num(funnel.leadsBeforeExclusions)).toBe(
      num(funnel.leadsReceived) + num(funnel.duplicatesExcluded)
    )
  })

  it('SEEDED: a source filter applied to one side only changes the rate', () => {
    /*
     * The console cannot express this defect — `selectScope` runs once and both sums come
     * out of the same selection — so it is constructed here to prove the guard is real
     * rather than merely unreachable by accident.
     */
    const source = 'LDS-007'
    const all = funnelRows()
    const filtered = all.filter((row) => row.lead_source_code === source)
    expect(filtered.length).toBeGreaterThan(0)

    const honest = buildCohortFunnel(all, scope({ leadSources: [source] }))
    const numeratorOnly =
      num(buildCohortFunnel(filtered, scope()).stages[1]?.count as Exact) /
      num(buildCohortFunnel(all, scope()).leadsReceived)

    expect(Number(show(honest.stages[1]?.rate as Figure))).not.toBeCloseTo(
      numeratorOnly,
      4
    )
  })

  it('scopes both sides of every rate when a source filter is applied', () => {
    const source = 'LDS-007'
    const filtered = buildCohortFunnel(funnelRows(), scope({ leadSources: [source] }))
    expect(num(filtered.leadsReceived)).toBeGreaterThan(0)
    expect(num(filtered.leadsReceived)).toBeLessThan(num(funnel.leadsReceived))
    // Recomputed from the filtered counts, which is only possible if both sides moved.
    expect(Number(show(filtered.stages[1]?.rate as Figure))).toBeCloseTo(
      num(filtered.stages[1]?.count as Exact) / num(filtered.leadsReceived),
      6
    )
  })

  it('scopes both sides when a campaign filter is applied', () => {
    const campaign = String(campaignRows()[0]?.campaign_code)
    const filtered = buildCohortFunnel(funnelRows(), scope({ campaigns: [campaign] }))
    expect(num(filtered.leadsReceived)).toBeGreaterThan(0)
    expect(num(filtered.leadsReceived)).toBeLessThan(num(funnel.leadsReceived))
    expect(Number(show(filtered.stages[1]?.rate as Figure))).toBeCloseTo(
      num(filtered.stages[1]?.count as Exact) / num(filtered.leadsReceived),
      6
    )
  })

  it('reports a real zero denominator as an absence rather than a number', () => {
    const empty = buildCohortFunnel(funnelRows(), scope({ leadSources: ['LDS-999'] }))
    expect(num(empty.leadsReceived)).toBe(0)
    expect(isFigure(empty.stages[1]?.rate as Figure)).toBe(false)
    expect(show(empty.stages[1]?.rate as Figure)).toBe('no-data')
  })
})

/* -------------------------------------------------------------------------- */
/* Appointment outcomes                                                        */
/* -------------------------------------------------------------------------- */

describe('appointment outcomes', () => {
  const outcomes = buildAppointmentOutcomes(appointments(), scope())

  it('divides show rate by eligible appointments, not by all scheduled', () => {
    /*
     * A customer who cancelled the day before never had the opportunity to show. The two
     * denominators must differ on this data or the assertion proves nothing.
     */
    expect(num(outcomes.cancelledInAdvance)).toBeGreaterThan(0)
    expect(num(outcomes.eligible)).not.toBe(num(outcomes.scheduled))

    const governed = num(outcomes.shown) / num(outcomes.eligible)
    const defective = num(outcomes.shown) / num(outcomes.scheduled)
    expect(governed).not.toBeCloseTo(defective, 4)
    expect(Number(show(outcomes.showRate))).toBeCloseTo(governed, 6)
  })

  it('publishes cancellation rate alongside show rate', () => {
    // The model cannot hand the page one without the other: both are on the same object,
    // and the component test asserts both reach the DOM.
    expect(isFigure(outcomes.showRate)).toBe(true)
    expect(isFigure(outcomes.cancellationRate)).toBe(true)
    expect(Number(show(outcomes.cancellationRate))).toBeCloseTo(
      num(outcomes.cancelledInAdvance) / num(outcomes.scheduled),
      6
    )
  })

  it('divides show-to-sale by shown appointments on the SHOW date', () => {
    expect(Number(show(outcomes.showToSale))).toBeCloseTo(
      num(outcomes.shownAndSold) / num(outcomes.shownOnShowDate),
      6
    )
  })

  it('carries the two date bases as separate columns, which this data does not separate', () => {
    /*
     * AN HONEST NEGATIVE RESULT, RECORDED RATHER THAN HIDDEN.
     *
     * `shown_appointments` is attributed to the SCHEDULED date and
     * `shown_appointments_on_show_date` to the SHOW date. In the committed export the two
     * totals are EQUAL, and the reason is not that the console collapsed them: the
     * generator never produces a customer who arrives on a day other than the one they were
     * booked for — 0 of 1,025 shown appointments have `show_date_key <> scheduled_date_key`.
     *
     * So the distinction is real in the model and unexercised by the data. Asserting that
     * the two differ would fail against correct code; asserting nothing would let a future
     * collapse of the two columns pass unnoticed. This asserts the equality AND its cause,
     * so a generator that starts producing late arrivals fails here and sends the reader to
     * the test below, which proves the builder separates them when they do differ.
     */
    expect(num(outcomes.shown)).toBe(num(outcomes.shownOnShowDate))
  })

  it('attributes each basis to its own date when a visit does arrive on another day', () => {
    /*
     * The fixture the committed data cannot provide. An appointment scheduled on 30
     * December and attended on 2 January belongs to December on the show-rate basis and to
     * January on the conversion basis, and a page whose period filter collapsed the two
     * would report the visit twice or not at all.
     */
    const rows: DashboardRow[] = [
      {
        dealership_id: 'GSA-001',
        appointment_date: '2025-12-30',
        lead_source_code: 'LDS-001',
        campaign_code: null,
        scheduled_appointments: 1,
        eligible_appointments: 1,
        cancelled_in_advance_appointments: 0,
        confirmed_appointments: 1,
        shown_appointments: 1,
        show_rate: '1.000',
        cancellation_rate: '0.000',
        shown_appointments_on_show_date: 0,
        shown_and_sold_appointments: 0,
        test_drive_appointments: 0,
        write_up_appointments: 0,
        show_to_sale_conversion: null,
      },
      {
        dealership_id: 'GSA-001',
        appointment_date: '2026-01-02',
        lead_source_code: 'LDS-001',
        campaign_code: null,
        scheduled_appointments: 0,
        eligible_appointments: 0,
        cancelled_in_advance_appointments: 0,
        confirmed_appointments: 0,
        shown_appointments: 0,
        show_rate: null,
        cancellation_rate: null,
        shown_appointments_on_show_date: 1,
        shown_and_sold_appointments: 1,
        test_drive_appointments: 1,
        write_up_appointments: 1,
        show_to_sale_conversion: '1.000',
      },
    ] as unknown as DashboardRow[]

    const december = buildAppointmentOutcomes(rows, {
      stores: ['GSA-001'],
      period: { ...period(), start: '2025-12-01', end: '2025-12-31' },
      leadSources: null,
      campaigns: null,
    })
    // December holds the SCHEDULED-basis show, and none of the show-basis outcome.
    expect(num(december.shown)).toBe(1)
    expect(num(december.shownOnShowDate)).toBe(0)
    expect(show(december.showToSale)).toBe('no-data')

    const january = buildAppointmentOutcomes(rows, {
      stores: ['GSA-001'],
      period: { ...period(), start: '2026-01-01', end: '2026-01-31' },
      leadSources: null,
      campaigns: null,
    })
    // January holds the visit and its outcome, and no eligible appointment at all.
    expect(num(january.shown)).toBe(0)
    expect(num(january.shownOnShowDate)).toBe(1)
    expect(Number(show(january.showToSale))).toBeCloseTo(1, 6)
    expect(show(january.showRate)).toBe('no-data')
  })

  it('is genuinely source-aware, so a filtered page is not mixing populations', () => {
    const source = 'LDS-007'
    const filtered = buildAppointmentOutcomes(
      appointments(),
      scope({ leadSources: [source] })
    )
    expect(num(filtered.scheduled)).toBeGreaterThan(0)
    expect(num(filtered.scheduled)).toBeLessThan(num(outcomes.scheduled))
  })

  it('rolls up across source and campaign to the group appointment totals', () => {
    // The SQL reconciliation proves this against vw_appointment_funnel on every database
    // run; this proves the EXPORTED partitions preserve it, which is a different claim.
    const bySource = new Map<string, number>()
    for (const row of appointments()) {
      const code = String(row.lead_source_code)
      bySource.set(code, (bySource.get(code) ?? 0) + Number(row.scheduled_appointments))
    }
    const summed = [...bySource.values()].reduce((a, b) => a + b, 0)
    expect(summed).toBe(num(outcomes.scheduled))
  })
})

/* -------------------------------------------------------------------------- */
/* Response time                                                               */
/* -------------------------------------------------------------------------- */

describe('response time', () => {
  const response = buildResponseSummary(distribution(), scope())

  it('recomputes the median from the population, not from published medians', () => {
    /*
     * Verified against PostgreSQL at this exact scope while the route was built:
     * percentile_cont(0.5) over the governed lead rows for December 2025 across all three
     * stores is 1650 seconds — 27.5 minutes.
     */
    expect(Number(show(response.medianMinutes))).toBeCloseTo(27.5, 1)
  })

  it('SEEDED: averaging subgroup medians gives a different and wrong answer', () => {
    /*
     * The defect the distribution dataset exists to make impossible. Averaging the median
     * of each store-day is not the median of anything, and on this data it is off by a
     * factor of well over two — which is why a "close enough" tolerance would not save it.
     */
    const rows = distribution()
    const byGroup = new Map<string, number[]>()
    for (const row of rows) {
      const seconds = row.first_response_seconds
      if (seconds === null) continue
      const key =
        `${String(row.dealership_id)}/${String(row.lead_source_code)}/` +
        String(row.lead_created_date)
      const bucket = byGroup.get(key) ?? []
      for (let i = 0; i < Number(row.responded_lead_count); i += 1)
        bucket.push(Number(seconds))
      byGroup.set(key, bucket)
    }
    const subgroupMedians = [...byGroup.values()]
      .filter((values) => values.length > 0)
      .map((values) => {
        const sorted = [...values].sort((a, b) => a - b)
        const mid = (sorted.length - 1) / 2
        const lo = sorted[Math.floor(mid)] ?? 0
        const hi = sorted[Math.ceil(mid)] ?? 0
        return (lo + hi) / 2
      })
    const averageOfMedians =
      subgroupMedians.reduce((a, b) => a + b, 0) / subgroupMedians.length / 60

    /*
     * Averaged at the grain `lead-response` publishes medians at -- store x lead source x
     * lead-creation date -- which is the shape a naive implementation would actually reach
     * for. PostgreSQL gives 65.11 minutes for that average against a true median of 27.5:
     * not a rounding difference, a factor of 2.4.
     */
    const truth = Number(show(response.medianMinutes))
    expect(truth).toBeCloseTo(27.5, 1)
    expect(averageOfMedians).toBeCloseTo(65.11, 0)
    expect(averageOfMedians / truth).toBeGreaterThan(2)
  })

  it('SEEDED: treating a never-responded lead as zero seconds moves the median', () => {
    /*
     * NULL means never answered. Coalescing it to zero sorts the ignored leads to the
     * fastest end of the distribution and improves the median — the single most flattering
     * mistake available on this page.
     */
    const bins: { value: number; count: number }[] = []
    const corrupted: { value: number; count: number }[] = []
    for (const row of distribution()) {
      const seconds = row.first_response_seconds
      if (seconds === null) {
        corrupted.push({ value: 0, count: Number(row.unresponded_lead_count) })
        continue
      }
      const bin = { value: Number(seconds), count: Number(row.responded_lead_count) }
      bins.push(bin)
      corrupted.push(bin)
    }
    const honest = percentileFromBins(bins, 0.5, 4)
    const defective = percentileFromBins(corrupted, 0.5, 4)
    expect(honest).not.toBeNull()
    expect(defective).not.toBeNull()
    expect(Number(exactToString(defective as Exact))).toBeLessThan(
      Number(exactToString(honest as Exact))
    )
  })

  it('keeps a zero-second response as a real observation', () => {
    // Zero is an instant auto-response and belongs in the population and the first band.
    // NULL is an absence. `percentileFromBins` must treat them differently, which the
    // seeded test above proves; this asserts a genuine zero is not discarded.
    const withZero = percentileFromBins(
      [
        { value: 0, count: 1 },
        { value: 100, count: 1 },
      ],
      0.5,
      4
    )
    expect(Number(exactToString(withZero as Exact))).toBeCloseTo(50, 4)
  })

  it('publishes the unanswered population beside both statistics', () => {
    expect(num(response.unrespondedLeads)).toBeGreaterThan(0)
    expect(num(response.validLeads)).toBe(
      num(response.respondedLeads) + num(response.unrespondedLeads)
    )
    expect(Number(show(response.coverageRate))).toBeCloseTo(
      num(response.respondedLeads) / num(response.validLeads),
      6
    )
  })

  it('divides every band by responded leads, never by all leads', () => {
    const banded = response.bands.reduce((sum, band) => sum + num(band.count), 0)
    expect(banded).toBe(num(response.respondedLeads))
    for (const band of response.bands) {
      expect(Number(show(band.share))).toBeCloseTo(
        num(band.count) / num(response.respondedLeads),
        6
      )
    }
    // The shares of a partition sum to one. Dividing by all leads would not.
    const shares = response.bands.reduce((sum, band) => sum + Number(show(band.share)), 0)
    expect(shares).toBeCloseTo(1, 6)
  })

  it('forms the mean from summed seconds over summed responded leads', () => {
    const seconds = distribution().reduce(
      (sum, row) => sum + Number(row.response_seconds_total),
      0
    )
    expect(Number(show(response.meanMinutes))).toBeCloseTo(
      seconds / num(response.respondedLeads) / 60,
      3
    )
  })

  it('reports no median rather than a zero when nothing was answered', () => {
    const empty = buildResponseSummary(
      distribution(),
      scope({ leadSources: ['LDS-999'] })
    )
    expect(show(empty.medianMinutes)).toBe('no-data')
    expect(show(empty.meanMinutes)).toBe('no-data')
  })

  it('changes the median when the source filter changes', () => {
    const a = buildResponseSummary(distribution(), scope({ leadSources: ['LDS-001'] }))
    const b = buildResponseSummary(distribution(), scope({ leadSources: ['LDS-007'] }))
    expect(isFigure(a.medianMinutes)).toBe(true)
    expect(isFigure(b.medianMinutes)).toBe(true)
    expect(show(a.medianMinutes)).not.toBe(show(b.medianMinutes))
  })
})

/* -------------------------------------------------------------------------- */
/* Lost stages                                                                 */
/* -------------------------------------------------------------------------- */

describe('the lost-stage partition', () => {
  const loss = buildStageLoss(stageLoss(), scope())

  it('sums exactly to leads received', () => {
    const summed = loss.entries.reduce((sum, entry) => sum + num(entry.count), 0)
    expect(summed).toBe(num(loss.leadsReceived))
  })

  it('agrees with the funnel on the cohort it partitions', () => {
    expect(num(loss.leadsReceived)).toBe(
      num(buildCohortFunnel(funnelRows(), scope()).leadsReceived)
    )
  })

  it('carries no negative count', () => {
    for (const entry of loss.entries) expect(num(entry.count)).toBeGreaterThanOrEqual(0)
    expect(num(loss.soldWithoutShowroomVisit)).toBeGreaterThanOrEqual(0)
  })

  it('SEEDED: the naive subtraction is not the shown-without-sale count', () => {
    /*
     * `appointment_shown_leads - sold_leads` looks like the leads that showed and did not
     * buy. It is not: `fact_lead` does not enforce that a sale implies a show, so sold
     * leads that never showed are subtracted from a population they were never in. On a
     * narrow enough scope it goes negative, which is defect 13 in the increment brief.
     */
    const funnel = buildCohortFunnel(funnelRows(), scope())
    const naive =
      num(funnel.stages[3]?.count as Exact) - num(funnel.stages[4]?.count as Exact)
    const governed = num(
      loss.entries.find((entry) => entry.id === 'shown-not-sold')?.count as Exact
    )
    expect(num(loss.soldWithoutShowroomVisit)).toBeGreaterThan(0)
    expect(naive).not.toBe(governed)
  })

  it('keeps the overlay out of the partition', () => {
    // Adding the overlay to the five would double-count leads already inside the first
    // three terms, and would break the identity with leads received.
    const summed = loss.entries.reduce((sum, entry) => sum + num(entry.count), 0)
    expect(summed + num(loss.soldWithoutShowroomVisit)).not.toBe(num(loss.leadsReceived))
  })

  it('demonstrates that the funnel chain only approximates lead-to-sale conversion', () => {
    /*
     * RECON-FUNNEL-CHAIN is informational, not an equality, and this is why: the chain
     * crosses lead grain into appointment grain and the sold population is not a subset of
     * the shown population. A test asserting equality would be asserting a defect.
     */
    const funnel = buildCohortFunnel(funnelRows(), scope())
    const outcomes = buildAppointmentOutcomes(appointments(), scope())
    const chain =
      Number(show(funnel.stages[1]?.rate as Figure)) *
      Number(show(funnel.stages[2]?.rate as Figure)) *
      Number(show(outcomes.showRate)) *
      Number(show(outcomes.showToSale))
    const leadToSale = Number(show(funnel.stages[4]?.rate as Figure))
    expect(chain).not.toBeCloseTo(leadToSale, 4)
  })
})

/* -------------------------------------------------------------------------- */
/* Source comparison                                                           */
/* -------------------------------------------------------------------------- */

describe('the source comparison', () => {
  const sources = buildSourceComparison(funnelRows(), scope(), dashboardLeadSources)

  it('covers the sources in scope and orders them by business code', () => {
    expect(sources.length).toBeGreaterThan(1)
    expect(sources.map((row) => row.code)).toEqual(
      [...sources.map((row) => row.code)].sort()
    )
  })

  it('reconciles to the group funnel', () => {
    const total = sources.reduce((sum, row) => sum + num(row.leadsReceived), 0)
    expect(total).toBe(num(buildCohortFunnel(funnelRows(), scope()).leadsReceived))
  })

  it('recomputes each rate from that source own counts', () => {
    for (const row of sources) {
      if (!isFigure(row.leadToSale)) continue
      expect(Number(show(row.leadToSale))).toBeCloseTo(
        num(row.soldLeads) / num(row.leadsReceived),
        6
      )
    }
  })

  it('publishes no composite score, rank or ordering by performance', () => {
    // The shape of the row type is the guard: there is no score field to render, and the
    // order is the business code rather than any measure.
    for (const row of sources) {
      expect(Object.keys(row)).not.toContain('score')
      expect(Object.keys(row)).not.toContain('rank')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Marketing                                                                   */
/* -------------------------------------------------------------------------- */

describe('marketing efficiency', () => {
  const marketing = buildMarketingSummary(
    marketingPerformanceRows(),
    campaignRows(),
    scope(),
    dashboardLeadSources
  )

  it('reads the whole month and reconciles to the export', () => {
    expect(marketing.monthGrainUnavailable).toBe(false)
    expect(marketing.rows.length).toBeGreaterThan(0)
    expect(Number(show(marketing.totalSpend))).toBeCloseTo(8506.51, 2)
  })

  it('forms every group measure as a ratio of sums', () => {
    // Verified against PostgreSQL at this scope: 8506.51 / 492 and 8506.51 / 3.
    expect(Number(show(marketing.costPerLead))).toBeCloseTo(17.29, 2)
    expect(Number(show(marketing.costPerSale))).toBeCloseTo(2835.5, 2)
    expect(Number(show(marketing.grossRoas))).toBeCloseTo(1.04, 2)
  })

  it('SEEDED: averaging per-campaign ratios gives a different and flattering answer', () => {
    const measurable = marketing.rows.filter((row) => isFigure(row.costPerLead))
    const meanOfRatios =
      measurable.reduce((sum, row) => sum + Number(show(row.costPerLead)), 0) /
      measurable.length
    const ratioOfSums = Number(show(marketing.costPerLead))
    expect(meanOfRatios).not.toBeCloseTo(ratioOfSums, 1)

    const roasRows = marketing.rows.filter((row) => isFigure(row.grossRoas))
    const meanRoas =
      roasRows.reduce((sum, row) => sum + Number(show(row.grossRoas)), 0) /
      roasRows.length
    expect(meanRoas).not.toBeCloseTo(Number(show(marketing.grossRoas)), 1)
  })

  it('SEEDED: an organic source reports Not applicable and never a zero cost', () => {
    const organic = marketing.rows.filter((row) => !row.costAttributable)
    expect(organic.length).toBeGreaterThan(0)
    for (const row of organic) {
      expect(row.costState).toBe('not-cost-attributable')
      for (const measure of [
        row.spend,
        row.costPerLead,
        row.costPerSale,
        row.grossRoas,
      ]) {
        expect(isFigure(measure)).toBe(false)
        expect(show(measure)).toBe('not-applicable')
      }
      // A zero would be the defect: it sorts the walk-in to the top of any cost comparison
      // as the most efficient channel the group operates.
      expect(show(row.costPerLead)).not.toBe('0')
      expect(show(row.costPerLead)).not.toBe('0.00')
    }
    // And at least one of them actually produced leads, so the state is not an artefact of
    // an empty row.
    expect(organic.some((row) => num(row.attributedLeads) > 0)).toBe(true)
  })

  it('reports spend with no attributed sales as its own state, never as $0 or infinity', () => {
    const withoutSales = marketing.rows.filter(
      (row) => row.costState === 'spend-without-sales'
    )
    expect(withoutSales.length).toBeGreaterThan(0)
    for (const row of withoutSales) {
      expect(isFigure(row.spend)).toBe(true)
      expect(num(row.attributedRetailUnits)).toBe(0)
      expect(show(row.costPerSale)).toBe('no-data')
      expect(Number.isFinite(Number(show(row.costPerSale)))).toBe(false)
    }
  })

  it('distinguishes a cost-attributable source with no spend row from an organic one', () => {
    const noSpend = marketing.rows.filter(
      (row) => row.costState === 'leads-without-spend'
    )
    expect(noSpend.length).toBeGreaterThan(0)
    for (const row of noSpend) {
      expect(row.costAttributable).toBe(true)
      expect(show(row.spend)).toBe('no-data')
      // Different words from the organic case, because they are different facts.
      expect(show(row.spend)).not.toBe('not-applicable')
    }
  })

  it('never produces an infinite or NaN measure anywhere in the table', () => {
    for (const row of marketing.rows) {
      for (const measure of [row.costPerLead, row.costPerSale, row.grossRoas]) {
        if (!isFigure(measure)) continue
        const value = Number(show(measure))
        expect(Number.isFinite(value)).toBe(true)
        expect(Number.isNaN(value)).toBe(false)
      }
    }
  })

  it('refuses cost measures entirely when no whole month is in range', () => {
    const partial = buildMarketingSummary(
      marketingPerformanceRows(),
      campaignRows(),
      scope({
        period: { ...period(), wholeMonths: [], start: '2025-12-05', end: '2025-12-19' },
      }),
      dashboardLeadSources
    )
    expect(partial.monthGrainUnavailable).toBe(true)
    expect(partial.rows).toHaveLength(0)
    // Spend is NOT prorated across a partial month: no proration policy is governed.
    expect(isFigure(partial.costPerLead)).toBe(false)
  })

  it('SEEDED: a campaign filter applied to the numerator only changes the answer', () => {
    const campaign = marketing.rows.find((row) => row.campaignCode !== null)?.campaignCode
    expect(campaign).toBeDefined()
    const honest = buildMarketingSummary(
      marketingPerformanceRows(),
      campaignRows(),
      scope({ campaigns: [campaign as string] }),
      dashboardLeadSources
    )
    expect(isFigure(honest.costPerLead)).toBe(true)

    const numeratorOnly = Number(show(honest.totalSpend)) / num(marketing.attributedLeads)
    expect(Number(show(honest.costPerLead))).not.toBeCloseTo(numeratorOnly, 2)
  })
})

/* -------------------------------------------------------------------------- */
/* Vendor counts                                                               */
/* -------------------------------------------------------------------------- */

describe('the vendor comparison', () => {
  const vendor = buildVendorDiscrepancy(marketingPerformanceRows(), funnelRows(), scope())

  it('keeps four different counts as four different numbers', () => {
    expect(num(vendor.vendorReported)).toBeGreaterThan(0)
    expect(num(vendor.validLeads)).toBeGreaterThan(0)
    expect(num(vendor.vendorReported)).not.toBe(num(vendor.validLeads))
    expect(num(vendor.crmReceived)).toBe(
      num(vendor.validLeads) + num(vendor.duplicatesExcluded)
    )
  })

  it('never substitutes the vendor count for KPI-FUN-001', () => {
    const funnel = buildCohortFunnel(funnelRows(), scope())
    expect(num(vendor.validLeads)).toBe(num(funnel.leadsReceived))
    expect(num(funnel.leadsReceived)).not.toBe(num(vendor.vendorReported))
  })
})

/* -------------------------------------------------------------------------- */
/* Partitions and cache keys                                                   */
/* -------------------------------------------------------------------------- */

describe('the partition tables', () => {
  it('carries eighteen partitions for each of the three datasets', () => {
    const keys = leadsMarketingChunkKeys()
    for (const dataset of [
      'appointment-source-funnel',
      'lead-stage-loss',
      'lead-response-distribution',
    ]) {
      expect(keys[dataset], dataset).toHaveLength(18)
    }
  })

  it('SEEDED: two partitions decoded under one key is an error, not a cache hit', () => {
    /*
     * The compensating-error case. A shared key returns the FIRST partition's rows for
     * every store, and the result looks entirely plausible: right columns, right shape,
     * wrong store. It shipped on /dashboard/inventory, which rendered one store's 96 units
     * three times and reported 288.
     */
    const first = appointmentSourceChunkFile('GSA-001', MONTH)
    const second = appointmentSourceChunkFile('GSA-002', MONTH)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)

    const key = 'collision-probe/appointment-source-funnel'
    decodeDataset(key, first as never)
    expect(() => decodeDataset(key, second as never)).toThrow(/one key per partition/)
  })

  it('gives each dataset its own key space, so three tables cannot collide', () => {
    const a = decodeDataset(
      `appointment-source-funnel/GSA-001/${MONTH}`,
      appointmentSourceChunkFile('GSA-001', MONTH) as never
    )
    const b = decodeDataset(
      `lead-stage-loss/GSA-001/${MONTH}`,
      leadStageLossChunkFile('GSA-001', MONTH) as never
    )
    const c = decodeDataset(
      `lead-response-distribution/GSA-001/${MONTH}`,
      responseDistributionChunkFile('GSA-001', MONTH) as never
    )
    // Different datasets, so different columns: a collision would have returned one of
    // these for all three.
    expect(Object.keys(a[0] ?? {})).toContain('scheduled_appointments')
    expect(Object.keys(b[0] ?? {})).toContain('not_contacted')
    expect(Object.keys(c[0] ?? {})).toContain('first_response_seconds')
  })

  it('SEEDED: raw counts differ per store, so a collision cannot hide in a ratio', () => {
    /*
     * Two compensating errors preserve a plausible RATIO. Only the raw counts catch a
     * partition read three times, which is why this asserts counts rather than rates.
     */
    const one = num(buildCohortFunnel(funnelRows(['GSA-001']), scope()).leadsReceived)
    const two = num(buildCohortFunnel(funnelRows(['GSA-002']), scope()).leadsReceived)
    const three = num(buildCohortFunnel(funnelRows(['GSA-003']), scope()).leadsReceived)
    expect(new Set([one, two, three]).size).toBe(3)
    expect(one + two + three).toBe(
      num(buildCohortFunnel(funnelRows(), scope()).leadsReceived)
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Scope adaptation                                                            */
/* -------------------------------------------------------------------------- */

describe('the filter adapter', () => {
  it('treats an unset source or campaign as no filter rather than as match-nothing', () => {
    const result = scopeFromFilters(DEFAULT_FILTERS, period(), [...STORES])
    expect(result.leadSources).toBeNull()
    expect(result.campaigns).toBeNull()
    expect(result.stores).toEqual([...STORES])
  })

  it('widens a single-valued source and campaign into the scope', () => {
    const result = scopeFromFilters(
      { ...DEFAULT_FILTERS, source: 'LDS-007', campaign: 'CMP-00001' },
      period(),
      [...STORES]
    )
    expect(result.leadSources).toEqual(['LDS-007'])
    expect(result.campaigns).toEqual(['CMP-00001'])
  })
})

/* -------------------------------------------------------------------------- */
/* Cross-store geometry                                                        */
/* -------------------------------------------------------------------------- */

describe('the data moves the geometry', () => {
  it('produces different funnel shapes for different stores', () => {
    const shapes = STORES.map((store) => {
      const funnel = buildCohortFunnel(funnelRows([store]), scope({ stores: [store] }))
      return funnel.stages
        .map((stage) => (num(stage.count) / num(funnel.leadsReceived)).toFixed(4))
        .join(',')
    })
    expect(new Set(shapes).size).toBe(STORES.length)
  })

  it('produces different response distributions for different periods', () => {
    const july = buildResponseSummary(
      partition('lead-response-distribution', responseDistributionChunkFile, STORES, [
        '2025-07',
      ]),
      scope({ period: period(['2025-07']) })
    )
    const december = buildResponseSummary(distribution(), scope())
    const shapeOf = (summary: typeof july) =>
      summary.bands.map((band) => show(band.share)).join(',')
    expect(shapeOf(july)).not.toBe(shapeOf(december))
  })

  it('produces different stage-loss shapes under different source filters', () => {
    const a = buildStageLoss(stageLoss(), scope({ leadSources: ['LDS-001'] }))
    const b = buildStageLoss(stageLoss(), scope({ leadSources: ['LDS-007'] }))
    expect(a.entries.map((entry) => num(entry.count)).join(',')).not.toBe(
      b.entries.map((entry) => num(entry.count)).join(',')
    )
  })
})
