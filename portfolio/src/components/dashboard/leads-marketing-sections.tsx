/**
 * The visual sections of `/dashboard/leads-marketing`.
 *
 * SERVER COMPONENTS. Every chart here is HTML and CSS in the server response — no chart
 * library, no client island, no canvas. The route adds no route-owned JavaScript, which is
 * what makes the no-JavaScript reading of this page identical to the scripted one rather
 * than a degraded fallback.
 *
 * THE EXACT/GEOMETRY BOUNDARY, HELD IN ONE DIRECTION
 * --------------------------------------------------
 * Displayed numbers are formatted from `Exact`. `exactToApproxNumber` appears only inside
 * `widthOf`, which returns a CSS percentage — a pixel cannot carry twenty significant digits
 * and does not need to. No displayed figure passes through `Number()` or `parseFloat()`.
 *
 * GEOMETRY IS DATA, NOT DECORATION
 * --------------------------------
 * Every bar width is a governed ratio of governed counts. Nothing is scaled to fill its
 * track, nothing is normalised to the largest value where that would misrepresent a share,
 * and no bar exists that does not move when the data moves.
 *
 * COLOUR CARRIES NO MEANING ANYWHERE ON THIS PAGE. There is no benchmark for response time,
 * cost per lead, contact rate or show rate in this project, so nothing is green or red. Bars
 * share one hue and every value is also present as text.
 */
import type { ReactNode } from 'react'

import { exactToApproxNumber, type Exact } from '@/lib/dashboard/decimal'
import {
  formatCountExact,
  formatCurrencyExact,
  formatMinutesExact,
  formatRateExact,
  formatRatioAsPercent,
} from '@/lib/dashboard/format'
import {
  isFigure,
  type AppointmentOutcomes,
  type CohortFunnel,
  type Figure,
  type MarketingSummary,
  type ResponseSummary,
  type SourceRow,
  type StageLoss,
  type VendorDiscrepancy,
} from '@/lib/dashboard/leads-marketing'

import { ChartFrame, TableDisclosure } from './visuals'

/* -------------------------------------------------------------------------- */
/* Shared rendering                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A figure as the reader sees it: the number, or the words for why there is none.
 *
 * The four absence kinds render as four different strings. "Not applicable" and "No data"
 * are not synonyms — the first says the measure does not exist for this thing, the second
 * says it would exist and has not been observed — and a page that prints one dash for both
 * has told the reader nothing.
 */
export function figureText(value: Figure, format: (exact: Exact) => string): string {
  if (isFigure(value)) return format(value.value)
  switch (value.kind) {
    case 'not-applicable':
      return 'Not applicable'
    case 'not-at-this-grain':
      return 'Not published at this grain'
    default:
      return 'No data'
  }
}

/** A bar width as a CSS percentage. The one place approximate numbers are permitted. */
function widthOf(part: Exact, whole: Exact): string {
  if (whole.units === 0n) return '0%'
  const ratio = exactToApproxNumber(part) / exactToApproxNumber(whole)
  const clamped = Math.max(0, Math.min(1, ratio))
  return `${(clamped * 100).toFixed(4)}%`
}

function Track({ width, label }: { readonly width: string; readonly label: string }) {
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
      aria-hidden="true"
      data-testid="bar-track"
      data-width={width}
      data-label={label}
    >
      <div className="h-full rounded-pill bg-accent/70" style={{ width }} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The lead-created cohort funnel                                              */
/* -------------------------------------------------------------------------- */

/**
 * Five lead counts on the lead-creation basis, drawn as widths of the first.
 *
 * WHY THE WIDTHS ARE SHARES OF VALID LEADS rather than of the preceding stage: a funnel whose
 * every segment is drawn against the one above it looks identical for a store converting 90%
 * at each step and one converting 30%, because each bar fills most of its predecessor. Drawn
 * against the cohort, the shape IS the conversion.
 *
 * The rate beside each stage is its GOVERNED rate, which does not always divide by the same
 * thing the width does — KPI-FUN-003 divides by contacted leads. Both are labelled, and the
 * denominator is named in words next to the percentage rather than left to be inferred.
 */
export function CohortFunnelSection({ funnel }: { readonly funnel: CohortFunnel }) {
  const total = funnel.leadsReceived
  return (
    <ChartFrame
      title="Lead-created cohort"
      headingLevel={2}
      caption={
        <>
          Every stage counts LEADS, on the date the lead arrived. A lead created in
          October that buys in December counts in October, which is why the most recent
          period always shows the fewest sold leads.
        </>
      }
      summary={`${formatCountExact(total)} valid leads, of which ${formatCountExact(
        funnel.stages[4]?.count ?? total
      )} are linked to a delivered retail sale. Bar length is each stage as a share of valid leads.`}
    >
      <ol className="flex flex-col gap-3">
        {funnel.stages.map((stage) => (
          <li key={stage.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-ink">{stage.label}</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {formatCountExact(stage.count)}
              </span>
            </div>
            <Track
              width={widthOf(stage.count, total)}
              label={`${stage.label}: ${formatCountExact(stage.count)} leads`}
            />
            <p className="text-xs text-ink-muted">
              {stage.rate === null ? (
                stage.kpiId === null ? (
                  <>
                    Stage count only. The governed rate at this step is an
                    appointment-grain measure with a different denominator, shown under
                    Appointment outcomes.
                  </>
                ) : (
                  <>{stage.kpiId} · valid non-duplicate leads</>
                )
              ) : (
                <>
                  {stage.kpiId} ·{' '}
                  {figureText(stage.rate, (v) => formatRatioAsPercent(v, 1))} of{' '}
                  {stage.denominatorLabel}
                </>
              )}
            </p>
          </li>
        ))}
      </ol>

      <TableDisclosure title="the cohort funnel">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">
            Lead-created cohort funnel: stage, lead count, governed rate and its
            denominator.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-3">
                Stage
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Leads
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Rate
              </th>
              <th scope="col" className="py-2">
                Measure
              </th>
            </tr>
          </thead>
          <tbody>
            {funnel.stages.map((stage) => (
              <tr key={stage.id} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {stage.label}
                </th>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCountExact(stage.count)}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {stage.rate === null
                    ? '—'
                    : figureText(stage.rate, (v) => formatRatioAsPercent(v, 1))}
                </td>
                <td className="py-2 text-ink-muted">
                  {stage.kpiId ?? 'Diagnostic count, not a governed KPI'}
                  {stage.denominatorLabel === null ? '' : ` of ${stage.denominatorLabel}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>

      <p className="text-xs text-ink-muted">
        {formatCountExact(funnel.duplicatesExcluded)} duplicate leads are excluded from
        every count above, out of {formatCountExact(funnel.leadsBeforeExclusions)} lead
        records received. Duplicates inflate volume and depress every conversion rate at
        once, so they are removed from both sides of every rate rather than from neither.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Appointment outcomes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * KPI-FUN-004 and KPI-FUN-005, kept visibly apart from the funnel above.
 *
 * These are APPOINTMENT-grain measures on two different date bases, and one lead can produce
 * several appointments. Rendering them as two more funnel segments would imply the counts
 * continue the lead cohort, and they do not.
 *
 * CANCELLATION RATE IS ON THIS BLOCK, NOT IN A DRAWER. Show rate excludes appointments
 * cancelled in advance from its denominator, which is correct — a customer who cancelled never
 * had the opportunity to show — and is also the one part of the measure a store can game, by
 * recording no-shows as advance cancellations. The two figures are meaningless apart.
 */
export function AppointmentOutcomesSection({
  outcomes,
}: {
  readonly outcomes: AppointmentOutcomes
}) {
  const cells: readonly {
    readonly label: string
    readonly value: string
    readonly note: string
  }[] = [
    {
      label: 'Show rate',
      value: figureText(outcomes.showRate, (v) => formatRatioAsPercent(v, 1)),
      note: `KPI-FUN-004 · ${formatCountExact(outcomes.shown)} of ${formatCountExact(
        outcomes.eligible
      )} eligible appointments · scheduled-date basis`,
    },
    {
      label: 'Cancelled in advance',
      value: figureText(outcomes.cancellationRate, (v) => formatRatioAsPercent(v, 1)),
      note: `${formatCountExact(outcomes.cancelledInAdvance)} of ${formatCountExact(
        outcomes.scheduled
      )} scheduled · excluded from the show-rate denominator`,
    },
    {
      label: 'Show-to-sale conversion',
      value: figureText(outcomes.showToSale, (v) => formatRatioAsPercent(v, 1)),
      note: `KPI-FUN-005 · ${formatCountExact(
        outcomes.shownAndSold
      )} of ${formatCountExact(outcomes.shownOnShowDate)} visits · show-date basis`,
    },
  ]

  return (
    <ChartFrame
      title="Appointment outcomes"
      headingLevel={2}
      caption={
        <>
          These are appointment-grain measures, not continuations of the lead funnel: one
          lead can produce several appointments, so these denominators are not the lead
          counts above. Show rate is attributed to the date the appointment was scheduled;
          show-to-sale conversion to the date the customer arrived.
        </>
      }
      summary={`Show rate ${figureText(outcomes.showRate, (v) =>
        formatRatioAsPercent(v, 1)
      )} with an advance-cancellation rate of ${figureText(
        outcomes.cancellationRate,
        (v) => formatRatioAsPercent(v, 1)
      )}, and show-to-sale conversion ${figureText(outcomes.showToSale, (v) =>
        formatRatioAsPercent(v, 1)
      )}.`}
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-3"
          >
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              {cell.label}
            </dt>
            <dd className="font-mono text-xl tabular-nums text-ink">{cell.value}</dd>
            <p className="text-xs text-ink-muted">{cell.note}</p>
          </div>
        ))}
      </dl>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Response distribution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The banded distribution, with the median as the headline and the ignored leads beside it.
 *
 * THE DENOMINATOR OF EVERY BAND IS RESPONDED LEADS. The bands partition the answered
 * population, so dividing by all leads would fold the ignored ones invisibly into every band,
 * and normalising to the largest band would draw a chart that always fills its width whatever
 * the data says.
 *
 * NO BAND IS GOOD OR BAD. ARPI holds no benchmark response time and publishes no target, so
 * the bands are descriptive bins in one hue. A five-minute threshold coloured green would be
 * this project asserting an industry standard it has no data for.
 *
 * UNRESPONDED LEADS ARE ON THIS BLOCK. Both response KPIs exclude leads that were never
 * answered, so a store ignoring half its leads can report an excellent median. That is not a
 * footnote; it is the number that decides whether the median means anything.
 */
export function ResponseSection({ response }: { readonly response: ResponseSummary }) {
  return (
    <ChartFrame
      title="Time to first response"
      headingLevel={2}
      caption={
        <>
          Bands are shares of leads that received a response. Leads never responded to are
          excluded from the median and the mean by definition and are counted separately
          below — a store that answers few leads quickly can show an excellent median.
        </>
      }
      summary={`Median first response ${figureText(response.medianMinutes, (v) =>
        formatMinutesExact(v, 1)
      )} across ${formatCountExact(
        response.respondedLeads
      )} responded leads, with ${formatCountExact(
        response.unrespondedLeads
      )} leads carrying no recorded response.`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 sm:col-span-1">
          <span className="text-xs uppercase tracking-wide text-ink-muted">
            Median response
          </span>
          <span className="font-mono text-2xl tabular-nums text-ink">
            {figureText(response.medianMinutes, (v) => formatMinutesExact(v, 1))}
          </span>
          <span className="text-xs text-ink-muted">
            KPI-FUN-008 · the headline, because the distribution is heavily skewed
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-3">
          <span className="text-xs uppercase tracking-wide text-ink-muted">
            Mean response
          </span>
          <span className="font-mono text-xl tabular-nums text-ink">
            {figureText(response.meanMinutes, (v) => formatMinutesExact(v, 1))}
          </span>
          <span className="text-xs text-ink-muted">
            KPI-FUN-007 · companion to the median, moved by the tail
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-3">
          <span className="text-xs uppercase tracking-wide text-ink-muted">
            90th percentile
          </span>
          <span className="font-mono text-xl tabular-nums text-ink">
            {figureText(response.p90Minutes, (v) => formatMinutesExact(v, 1))}
          </span>
          <span className="text-xs text-ink-muted">
            Diagnostic context · the tail the median is insensitive to
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {response.bands.map((band) => (
          <li key={band.label} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-ink">{band.label}</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {formatCountExact(band.count)} ·{' '}
                {figureText(band.share, (v) => formatRatioAsPercent(v, 1))}
              </span>
            </div>
            <Track
              width={widthOf(band.count, response.respondedLeads)}
              label={`${band.label}: ${formatCountExact(band.count)} responded leads`}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-sunken/60 p-3">
        <span className="text-xs uppercase tracking-wide text-ink-muted">
          Leads with no recorded response
        </span>
        <span className="font-mono text-xl tabular-nums text-ink">
          {formatCountExact(response.unrespondedLeads)}
        </span>
        <p className="text-xs text-ink-muted">
          Response coverage{' '}
          {figureText(response.coverageRate, (v) => formatRatioAsPercent(v, 1))} of{' '}
          {formatCountExact(response.validLeads)} valid leads. A lead with no recorded
          response was never answered; it is not a response of zero seconds, and an
          instant response of zero seconds is a real observation counted in the first
          band.
        </p>
      </div>

      <TableDisclosure title="the response distribution">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">
            First-response bands, with the count of responded leads in each and its share
            of all responded leads.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-3">
                Band
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Responded leads
              </th>
              <th scope="col" className="py-2 text-right">
                Share of responded
              </th>
            </tr>
          </thead>
          <tbody>
            {response.bands.map((band) => (
              <tr key={band.label} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {band.label}
                </th>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCountExact(band.count)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {figureText(band.share, (v) => formatRatioAsPercent(v, 1))}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                No recorded response
              </th>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {formatCountExact(response.unrespondedLeads)}
              </td>
              <td className="py-2 text-right text-ink-muted">Excluded from both KPIs</td>
            </tr>
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Lost-stage analysis                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Where the cohort stopped, in counts and neutral language.
 *
 * THE LABELS SAY WHERE, NEVER WHY. ARPI models no communication content, no activity detail
 * and no disposition, so nothing in this project can distinguish a customer who stopped
 * replying from a store that stopped calling. "Did not reach contact" is the strongest true
 * statement available; "BDC failed to follow up" would be an assertion invented at the
 * presentation layer.
 */
export function StageLossSection({ loss }: { readonly loss: StageLoss }) {
  return (
    <ChartFrame
      title="Where the cohort stopped"
      headingLevel={2}
      caption={
        <>
          Each lead is counted once, at the furthest stage it reached. These counts
          describe where progression stopped in the modelled funnel; they carry no
          information about why, because no communication or activity detail exists in
          this project to carry it.
        </>
      }
      summary={`${formatCountExact(
        loss.leadsReceived
      )} valid leads partitioned across five terminal stages. Bar length is each stage as a share of the cohort.`}
    >
      <ul className="flex flex-col gap-3">
        {loss.entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-ink">{entry.label}</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {formatCountExact(entry.count)}
              </span>
            </div>
            <Track
              width={widthOf(entry.count, loss.leadsReceived)}
              label={`${entry.label}: ${formatCountExact(entry.count)} leads`}
            />
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-muted">
        The five counts above sum to {formatCountExact(loss.leadsReceived)} valid leads.{' '}
        {formatCountExact(loss.soldWithoutShowroomVisit)} of the leads that bought have no
        modelled showroom visit — a walk-in later matched to a lead, for example. Those
        leads are already counted in one of the first three stages and are shown here
        separately rather than added, which is why the funnel chain only approximates
        lead-to-sale conversion.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Source comparison                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sources side by side on the governed measures, in business-code order.
 *
 * NO SCORE, NO RANK, NO BEST OR WORST. Sources differ in lead quality, so a composite would
 * be a judgement this project cannot support presented as a measurement. The order is the
 * business code and never the data, so a reader comparing two periods finds the same source
 * in the same place.
 */
export function SourceComparisonSection({
  sources,
}: {
  readonly sources: readonly SourceRow[]
}) {
  const largest = sources.reduce(
    (max, row) => (row.leadsReceived.units > max.units ? row.leadsReceived : max),
    { units: 0n, scale: 0 } as Exact
  )

  return (
    <ChartFrame
      title="Sources by outcome, not by volume alone"
      headingLevel={2}
      caption={
        <>
          Volume, the two governed funnel rates and delivered sales for each source in
          scope, in business-code order. Sources are not ranked and no composite score is
          computed: they differ in lead quality, so the measures are shown side by side
          rather than blended into one number.
        </>
      }
      summary={`${String(
        sources.length
      )} lead sources in scope, each with valid leads, contact rate, appointment-set rate, lead-to-sale conversion and delivered sales.`}
    >
      <ul className="flex flex-col gap-4">
        {sources.map((source) => (
          <li key={source.code} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-ink">{source.name}</span>
              <span className="font-mono text-sm tabular-nums text-ink">
                {formatCountExact(source.leadsReceived)} leads ·{' '}
                {formatCountExact(source.soldLeads)} sold
              </span>
            </div>
            <Track
              width={widthOf(source.leadsReceived, largest)}
              label={`${source.name}: ${formatCountExact(source.leadsReceived)} valid leads`}
            />
            <p className="text-xs text-ink-muted">
              {source.category} · contact{' '}
              {figureText(source.contactRate, (v) => formatRatioAsPercent(v, 1))} ·
              appointment-set{' '}
              {figureText(source.appointmentSetRate, (v) => formatRatioAsPercent(v, 1))} ·
              lead-to-sale{' '}
              {figureText(source.leadToSale, (v) => formatRatioAsPercent(v, 1))}
            </p>
          </li>
        ))}
      </ul>

      <TableDisclosure title="source outcomes">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">
            Lead source, category, valid leads, contact rate, appointment-set rate,
            lead-to-sale conversion and sold leads.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-3">
                Source
              </th>
              <th scope="col" className="py-2 pr-3">
                Category
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Valid leads
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Contact
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Appt set
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Lead-to-sale
              </th>
              <th scope="col" className="py-2 text-right">
                Sold
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.code} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {source.name}
                </th>
                <td className="py-2 pr-3 text-ink-muted">{source.category}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCountExact(source.leadsReceived)}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(source.contactRate, (v) => formatRatioAsPercent(v, 1))}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(source.appointmentSetRate, (v) =>
                    formatRatioAsPercent(v, 1)
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(source.leadToSale, (v) => formatRatioAsPercent(v, 1))}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatCountExact(source.soldLeads)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Marketing efficiency                                                        */
/* -------------------------------------------------------------------------- */

const COST_STATE_LABEL: Readonly<Record<string, string>> = {
  measurable: 'Measured',
  'not-cost-attributable': 'Organic or internal — no advertising cost',
  'spend-without-leads': 'Spend with no attributed leads',
  'spend-without-sales': 'Spend with no attributed sales',
  'leads-without-spend': 'Leads with no recorded spend',
}

/**
 * Spend against attributed outcomes, at month grain, with the cost states made explicit.
 *
 * GROSS RETURN IS NOT PROFIT AND IS NOT CALLED PROFIT. It nets out the cost of the vehicle
 * and nothing else — no personnel, facility, floor-plan or overhead cost is modelled — so it
 * is a contribution measure. Calling it ROI or profit would overstate what the number knows
 * by every operating expense the group has.
 *
 * ORGANIC SOURCES SHOW "NOT APPLICABLE", NEVER ZERO. A walk-in has no cost per lead, and a
 * $0.00 cost per lead would sort it to the top of any efficiency comparison as the best
 * channel in the group.
 *
 * REVENUE IS ABSENT ON PURPOSE. Vehicle revenue includes the cost of the vehicle, so a
 * revenue-based return is inflated by roughly an order of magnitude; the export carries it and
 * this table does not promote it.
 */
export function MarketingSection({
  marketing,
}: {
  readonly marketing: MarketingSummary
}) {
  if (marketing.monthGrainUnavailable) {
    return (
      <ChartFrame
        title="Marketing efficiency"
        headingLevel={2}
        summary="Marketing cost measures are not available for this period."
      >
        <p className="rounded-lg border border-line bg-surface-sunken/60 p-3 text-sm text-ink">
          <strong className="font-semibold">Not published at this grain.</strong>{' '}
          Marketing spend is recorded by calendar month, so cost per lead, cost per sale
          and gross return are only defined over whole months. The selected period covers
          no complete month. Spend is not prorated across a partial month: this project
          governs no proration rule, and inventing one would produce a figure that looks
          precise and means nothing.
        </p>
      </ChartFrame>
    )
  }

  return (
    <ChartFrame
      title="Marketing efficiency"
      headingLevel={2}
      caption={
        <>
          Spend and attributed outcomes over {marketing.wholeMonths.join(', ')}. Leads and
          sales are attributed under ARPI&rsquo;s single-source first-touch convention and
          anchored to the originating lead&rsquo;s creation month, not the sale date.
          Group figures are total spend over total outcomes, never an average of
          per-campaign ratios.
        </>
      }
      summary={`${figureText(marketing.totalSpend, (v) =>
        formatCurrencyExact(v, 0)
      )} of attributable spend against ${formatCountExact(
        marketing.attributedRetailUnits
      )} attributed retail units and ${formatCurrencyExact(
        marketing.attributedTotalGross,
        0
      )} of attributed gross.`}
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Attributable spend',
            value: figureText(marketing.totalSpend, (v) => formatCurrencyExact(v, 0)),
            note: 'Cost-attributable sources only',
          },
          {
            label: 'Cost per valid lead',
            value: figureText(marketing.costPerLead, (v) => formatCurrencyExact(v, 2)),
            note: 'KPI-MKT-001 · total spend ÷ total attributed leads',
          },
          {
            label: 'Cost per attributed sale',
            value: figureText(marketing.costPerSale, (v) => formatCurrencyExact(v, 2)),
            note: 'KPI-MKT-002 · total spend ÷ total attributed retail units',
          },
          {
            label: 'Gross return on ad spend',
            value: figureText(marketing.grossRoas, (v) => formatRateExact(v, 2)),
            note: 'KPI-MKT-003 · attributed gross ÷ spend. A contribution measure, not profit',
          },
        ].map((cell) => (
          <div
            key={cell.label}
            className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-3"
          >
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              {cell.label}
            </dt>
            <dd className="font-mono text-xl tabular-nums text-ink">{cell.value}</dd>
            <p className="text-xs text-ink-muted">{cell.note}</p>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">
            Marketing performance by source and campaign: spend, attributed leads and
            retail sales, cost per lead, cost per sale, attributed gross, gross return and
            cost state.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-3">
                Source
              </th>
              <th scope="col" className="py-2 pr-3">
                Campaign
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Spend
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Leads
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Sales
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Cost/lead
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Cost/sale
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Attributed gross
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Gross ROAS
              </th>
              <th scope="col" className="py-2">
                Cost state
              </th>
            </tr>
          </thead>
          <tbody>
            {marketing.rows.map((row) => (
              <tr key={row.key} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {row.sourceName}
                </th>
                <td className="py-2 pr-3 text-ink-muted">
                  {row.campaignName ?? 'No campaign'}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(row.spend, (v) => formatCurrencyExact(v, 0))}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCountExact(row.attributedLeads)}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCountExact(row.attributedRetailUnits)}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(row.costPerLead, (v) => formatCurrencyExact(v, 2))}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(row.costPerSale, (v) => formatCurrencyExact(v, 2))}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {formatCurrencyExact(row.attributedTotalGross, 0)}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">
                  {figureText(row.grossRoas, (v) => formatRateExact(v, 2))}
                </td>
                <td className="py-2 text-xs text-ink-muted">
                  {COST_STATE_LABEL[row.costState] ?? row.costState}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        Gross return on advertising spend is attributed gross divided by spend. It is a
        contribution measure and not profit: it nets out the cost of the vehicle and
        nothing else, with no personnel, facility, floor-plan or overhead cost modelled
        anywhere in this project. Clicks and impressions are vendor-reported activity, not
        value measures, and are not shown here.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Vendor discrepancy                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Four counts of four different things, never reconciled to each other.
 *
 * Vendors count differently and typically count duplicates. The gap between what a vendor
 * reports and what reached the CRM as a valid lead is evidence to take to the vendor, not a
 * data-quality failure, and the vendor figure is never substituted for KPI-FUN-001.
 */
export function VendorDiscrepancySection({
  vendor,
  wholeMonths,
}: {
  readonly vendor: VendorDiscrepancy
  readonly wholeMonths: readonly string[]
}) {
  const cells = [
    { label: 'Vendor reported', value: vendor.vendorReported },
    { label: 'Lead records received', value: vendor.crmReceived },
    { label: 'Duplicates excluded', value: vendor.duplicatesExcluded },
    { label: 'Valid leads (KPI-FUN-001)', value: vendor.validLeads },
  ]
  return (
    <ChartFrame
      title="Vendor counts against the CRM"
      headingLevel={2}
      caption={
        <>
          Vendor-reported leads and valid CRM leads are deliberately different
          populations: vendors count differently and typically count duplicates. The
          difference is something to raise with a vendor, not a defect to correct, and the
          vendor figure is never substituted for the governed lead count.
        </>
      }
      summary={`Over ${
        wholeMonths.length === 0 ? 'no complete month' : wholeMonths.join(', ')
      }, vendors reported ${formatCountExact(
        vendor.vendorReported
      )} leads against ${formatCountExact(vendor.validLeads)} valid CRM leads.`}
    >
      <dl className="grid gap-3 sm:grid-cols-4">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-3"
          >
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              {cell.label}
            </dt>
            <dd className="font-mono text-lg tabular-nums text-ink">
              {formatCountExact(cell.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">
        Vendor spend is recorded by month, so this comparison is only formed over whole
        months in the selected period.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared notice                                                               */
/* -------------------------------------------------------------------------- */

/** The cohort-maturity caution, stated wherever a conversion or cost measure is read. */
export function CohortMaturityNotice({ immature }: { readonly immature: boolean }) {
  if (!immature) return null
  return (
    <p
      className="rounded-lg border border-line bg-surface-sunken/60 p-3 text-sm text-ink"
      data-testid="cohort-maturity-notice"
    >
      <strong className="font-semibold">This period includes an immature cohort.</strong>{' '}
      Leads are counted in the period they arrived, and a lead created near the end of the
      window has had less time to convert. Lead-to-sale conversion, cost per attributed
      sale and gross return are therefore structurally incomplete here and will improve as
      those leads mature. ARPI defines no maturity horizon, so no cohort is hidden or
      marked complete on your behalf.
    </p>
  )
}

/** The attribution convention, stated where marketing results are read. */
export function AttributionNotice(): ReactNode {
  return (
    <p className="text-xs text-ink-muted" data-testid="attribution-notice">
      Every marketing result on this page is attributed under ARPI&rsquo;s single-source,
      first-touch convention: a lead is credited to exactly one source and campaign, and a
      customer who arrived through three channels is credited to one. No multi-touch,
      linear, time-decay, last-touch or position-based model exists in this project.
      Association under that convention is not causation.
    </p>
  )
}
