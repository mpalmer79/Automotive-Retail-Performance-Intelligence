/**
 * The Leads & Marketing workspace: the demand rail, the two progressions, and the comparisons.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2C-BASELINE.md` §1–§3: at 1440 × 900 a BDC director opening
 * `/dashboard/leads-marketing` met **213 words of prose and not one complete figure**. The
 * route drew seven framed figures — more than any other operating surface — and put one of
 * them inside the first screen, because each was a full-width band opening with an eyebrow, an
 * `h2` and a lede, stacked down an 8,821 px document. At 1,102 `proseRepo` words it was the
 * most explanation-heavy operating route in the console.
 *
 * The rail below is the first headline figure this route has ever had. The two progressions
 * are side by side rather than three screens apart. And the fifteen methodology disclosures
 * that were correct and correctly placed are still fifteen: what left the page is the eleven
 * visible paragraphs that restated parts of them inline.
 *
 * THE GRAIN BOUNDARY IS THE WHOLE DESIGN (`UX.2C` §8)
 * ---------------------------------------------------
 * `UX.2C` §8 forbids "one mathematically dishonest shrinking funnel" and asks for two
 * connected blocks where a single shape would imply false denominator continuity. That is what
 * `LeadProgression` and `AppointmentProgression` are, and the split is drawn where the export
 * actually puts it:
 *
 *   * **Lead grain, lead-creation date.** All five stages of `CohortFunnel` count LEADS. That
 *     includes "Reached showroom" and "Sold", which are `appointment_shown_leads` and
 *     `sold_leads` — lead counts, not appointment counts. They belong in one shape because
 *     they share one grain and one date basis, and the funnel draws every stage as a share of
 *     valid leads so the shape IS the conversion.
 *   * **Appointment grain, two date bases.** Show rate is KPI-FUN-004 over ELIGIBLE
 *     appointments on the SCHEDULED date; show-to-sale is KPI-FUN-005 over appointments shown
 *     on the SHOW date. One lead can produce several appointments, so these denominators are
 *     not the lead counts beside them.
 *
 * The two modules sit in the same row and each names its own grain and basis in its own
 * caption. What they are NOT is one five-bar ramp with a percentage under every segment: that
 * shape would tell a reader the cohort continued into the appointment measures, and it does
 * not. Correctness outranks visual drama, which is what §8 says in as many words.
 *
 * WHAT THIS FILE DOES NOT DO
 * --------------------------
 * It computes nothing. Every count, rate, band, share and cost arrives already resolved and
 * already formatted by `lib/dashboard/leads-marketing.ts` from the governed exports. This file
 * chooses which figure is large, which is small and which is drawn as a length. `UX.2C` §57
 * forbids a KPI, view, export or warehouse change and there is none; §43 forbids funnel
 * arithmetic in the browser and there is no client JavaScript here at all.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY. `exactToApproxNumber` is reached
 * only through `widthOf`, which returns a CSS percentage. No displayed figure passes through
 * it.
 *
 * NOTHING ON THIS ROUTE IS COLOURED GOOD OR BAD. ARPI holds no benchmark for response time,
 * contact rate, show rate, cost per lead or gross return, so no band is green, no source is
 * red, and every bar in a comparison shares one hue.
 */
import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card-static'
import { Disclosure } from '@/components/ui/disclosure'
import { exactToApproxNumber, type Exact } from '@/lib/dashboard/decimal'
import { figure } from '@/lib/dashboard/figures'
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
import { cx } from '@/lib/utils'

import { figureText } from './leads-marketing-sections'
import { ChartFrame, TableDisclosure } from './visuals'
import { FunnelChart, type FunnelStageBar } from './workspace-visuals'

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/** A bar width as a CSS percentage. The one place approximate numbers are permitted. */
function widthOf(part: Exact, whole: Exact): string {
  if (whole.units === 0n) return '0%'
  const ratio = exactToApproxNumber(part) / exactToApproxNumber(whole)
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(4)}%`
}

/** A rate's own width. Rates share a 0–1 scale, so this needs no reference value. */
function rateWidth(value: Figure): string | null {
  if (!isFigure(value)) return null
  const ratio = exactToApproxNumber(value.value)
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(4)}%`
}

function percent1(value: Exact): string {
  return formatRatioAsPercent(value, 1)
}

/* -------------------------------------------------------------------------- */
/* The demand rail                                                             */
/* -------------------------------------------------------------------------- */

/** One rail figure, already resolved. */
interface RailFigure {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly note: string
  readonly kpiId: string | null
}

/**
 * The four a BDC director reads first, and the three that qualify them.
 *
 * WHY THESE FOUR. `UX.2C` §7 names valid leads, contact rate, appointment-set rate and
 * lead-to-sale as the likely primary emphasis and warns against forcing all seven to one
 * weight. Volume and the three governed lead-grain conversion rates are the whole of the
 * question "how much demand arrived and what did we do with it". The other three are
 * qualifiers: show rate belongs to a different grain, and both response figures are blind to
 * the leads nobody answered — which is why the unanswered count is one of them rather than a
 * footnote under them.
 *
 * THE DENOMINATOR IS ON EVERY CARD. `KPI-FUN-003` divides by CONTACTED leads and not by all of
 * them, so a store reaching a fifth of its leads can post a healthier appointment-set rate
 * than one reaching most of them. That is correct behaviour, it is the single most misread
 * thing on this route, and the card says `of contacted leads` under the figure rather than
 * leaving it to the methodology drawer.
 *
 * ONE METHODOLOGY DISCLOSURE, NOT SEVEN — the arrangement `kpi-strip.tsx` arrived at on the
 * Executive and `sales-workspace.tsx` on Sales & Gross, for the same reason: a
 * `How is this calculated?` line under every card is methodology correctly available and
 * repeated until it reads as furniture.
 */
export function DemandRail({
  funnel,
  appointments,
  response,
}: {
  readonly funnel: CohortFunnel
  readonly appointments: AppointmentOutcomes
  readonly response: ResponseSummary
}) {
  const stage = (id: string) => funnel.stages.find((entry) => entry.id === id)
  const contacted = stage('contacted')
  const appointmentSet = stage('appointment-set')
  const sold = stage('sold')

  const lead: readonly RailFigure[] = [
    {
      id: 'valid-leads',
      label: 'Valid leads',
      value: formatCountExact(funnel.leadsReceived),
      note: `${formatCountExact(funnel.duplicatesExcluded)} duplicates excluded`,
      kpiId: 'KPI-FUN-001',
    },
    {
      id: 'contact-rate',
      label: 'Contact rate',
      value:
        contacted?.rate === undefined || contacted.rate === null
          ? 'No value'
          : figureText(contacted.rate, percent1),
      note: 'of valid leads',
      kpiId: 'KPI-FUN-002',
    },
    {
      id: 'appointment-set-rate',
      label: 'Appointment-set rate',
      value:
        appointmentSet?.rate === undefined || appointmentSet.rate === null
          ? 'No value'
          : figureText(appointmentSet.rate, percent1),
      // THE DENOMINATOR THAT IS NOT THE OBVIOUS ONE, on the card rather than in a drawer.
      note: 'of contacted leads, not of all leads',
      kpiId: 'KPI-FUN-003',
    },
    {
      id: 'lead-to-sale',
      label: 'Lead-to-sale',
      value:
        sold?.rate === undefined || sold.rate === null
          ? 'No value'
          : figureText(sold.rate, percent1),
      note: 'of valid leads. Not the product of the steps',
      kpiId: 'KPI-FUN-006',
    },
  ]

  const context: readonly RailFigure[] = [
    {
      id: 'show-rate',
      label: 'Show rate',
      value: figureText(appointments.showRate, percent1),
      note: 'appointment grain, scheduled date',
      kpiId: 'KPI-FUN-004',
    },
    {
      id: 'median-response',
      label: 'Median response',
      value: figureText(response.medianMinutes, (v) => formatMinutesExact(v, 1)),
      note: 'answered leads only',
      kpiId: 'KPI-FUN-008',
    },
    {
      id: 'unanswered',
      label: 'Never answered',
      value: formatCountExact(response.unrespondedLeads),
      note: 'excluded from both response figures',
      kpiId: null,
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        {lead.map((entry) => (
          <RailCard key={entry.id} figure={entry} rank="lead" />
        ))}
      </ul>
      <ul className="grid grid-cols-3 gap-2">
        {context.map((entry) => (
          <RailCard key={entry.id} figure={entry} rank="supporting" />
        ))}
      </ul>

      <Disclosure label="How every figure on this rail is calculated" className="border-0">
        <div className="flex flex-col gap-4 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">Valid leads (KPI-FUN-001)</strong> counts
            non-duplicate lead records on the date the lead arrived. Duplicates are removed
            from both sides of every rate rather than from neither: they inflate volume and
            depress every conversion rate at once.
          </p>
          <p>
            <strong className="text-ink">Contact rate (KPI-FUN-002)</strong> divides
            contacted leads by valid leads.{' '}
            <strong className="text-ink">Appointment-set rate (KPI-FUN-003)</strong>{' '}
            divides by <em>contacted</em> leads, not by all of them: an appointment cannot
            be set with someone who was never reached.{' '}
            <strong className="text-ink">Lead-to-sale (KPI-FUN-006)</strong> divides by
            valid leads again, so it is not the product of the steps above it.
          </p>
          <p>
            <strong className="text-ink">Show rate (KPI-FUN-004)</strong> is an
            appointment-grain measure over eligible appointments on the scheduled date. One
            lead can produce several appointments, so it does not continue the lead counts
            beside it, and it is on this rail as context rather than as a funnel step.
          </p>
          <p>
            <strong className="text-ink">Median response (KPI-FUN-008)</strong> is
            recomputed from the exported response population under the current filters, not
            blended from published medians: a median does not decompose, and averaging daily
            or store medians gives a different and wrong answer. It and the mean both
            exclude leads that were never answered, which is why{' '}
            <strong className="text-ink">Never answered</strong> is on the same rail. A lead
            with no recorded response was never answered; it is not a response of zero
            seconds, and a genuine zero-second auto-response is counted normally.
          </p>
          <p>
            No figure here is coloured or compared to a target. ARPI holds no benchmark for
            any of them and publishes none.
          </p>
        </div>
      </Disclosure>
    </div>
  )
}

/**
 * One rail card.
 *
 * THE IDENTIFIER SITS UNDER THE FIGURE, never between the name and the value — the correction
 * `kpi-strip.tsx` made and `sales-workspace.tsx` repeated. It is still in text, still found by
 * a browser search, still read in order by assistive technology.
 */
function RailCard({
  figure,
  rank,
}: {
  readonly figure: RailFigure
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={figure.id}
      data-kpi-rank={rank}
      className={cx(
        'flex min-w-0 flex-col gap-1',
        rank === 'lead' ? 'p-3.5' : 'gap-0.5 p-2.5'
      )}
    >
      <h3 className="text-xs leading-snug font-semibold text-ink-secondary">
        {figure.label}
      </h3>
      <span
        className={cx(
          'numeric font-semibold text-ink',
          rank === 'lead' ? 'text-2xl' : 'text-base'
        )}
      >
        {figure.value}
      </span>
      <p className="text-2xs leading-normal text-ink-muted">{figure.note}</p>
      {figure.kpiId === null ? null : (
        <p className="mt-auto pt-0.5 font-mono text-2xs tracking-wide text-ink-faint">
          {figure.kpiId}
        </p>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Lead-grain progression                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The five lead counts, as a nesting, on one grain and one date basis.
 *
 * Every stage counts LEADS on the date the lead arrived, and every bar is that stage's share
 * of valid leads rather than of the stage above it — drawn against the preceding stage, a
 * store converting 90% at each step and one converting 30% produce the same picture, because
 * each bar fills most of its predecessor. Drawn against the cohort, the shape is the
 * conversion.
 *
 * THE MIDDLE STAGE HAS NO RATE AND KEEPS NONE. `appointment_shown_leads / appointment_set_leads`
 * is not KPI-FUN-004: that measure is appointment-grain on the scheduled date. Labelling this
 * share with that identifier would relabel a measure rather than report one, and publishing it
 * as an unlabelled percentage would create a governed measure by presentation. It is a count.
 */
export function LeadProgression({ funnel }: { readonly funnel: CohortFunnel }) {
  const base = exactToApproxNumber(funnel.leadsReceived)

  const stages: readonly FunnelStageBar[] = funnel.stages.map((entry) => {
    const count = exactToApproxNumber(entry.count)
    // A zero base has no shares: five stages at zero width would present "nobody enquired"
    // as "everybody dropped out at the first step".
    const share = base === 0 ? null : count / base
    return {
      key: entry.id,
      label: entry.label,
      display: formatCountExact(entry.count),
      share,
      shareDisplay: share === null ? null : `${(share * 100).toFixed(1)}%`,
      rate:
        entry.rate === null
          ? null
          : {
              display: `${figureText(entry.rate, percent1)} of ${entry.denominatorLabel ?? 'valid leads'}`,
              kpiId: entry.kpiId,
            },
    }
  })

  return (
    <FunnelChart
      title="Lead-created cohort"
      stages={stages}
      caption="Every stage counts LEADS, on the date the lead arrived. Bar length is the stage over valid leads."
      shareNote="The bar is arithmetic on two exported columns, not a governed KPI; each governed rate is named beside its count with the denominator it divides by. Reached showroom carries no rate — the governed show measure is appointment grain and sits in the figure beside this one, not inside it."
      headingLevel={3}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Appointment-grain progression                                               */
/* -------------------------------------------------------------------------- */

/**
 * The appointment-grain block: three counts, two governed rates, two date bases.
 *
 * CANCELLATION CONTEXT IS INSIDE THE PROGRESSION, not beside it and not in a drawer
 * (`UX.2C` §9). The middle bar of this figure is the advance cancellations, drawn as the part
 * of the scheduled population that is REMOVED before the show-rate denominator is formed, so
 * the exclusion that makes show rate correct is visible as geometry rather than asserted in a
 * sentence. It is also the part of the measure a store can game — recording no-shows as
 * advance cancellations produces a flattering show rate — and the two figures are meaningless
 * apart.
 *
 * BARS ARE SHARES OF SCHEDULED APPOINTMENTS, which is the one population every count here is
 * inside. Show-to-sale's own denominator is different again — appointments shown on the SHOW
 * date, not the scheduled date — so its bar is drawn against scheduled for scale and its rate
 * names its own denominator in words.
 */
export function AppointmentProgression({
  outcomes,
}: {
  readonly outcomes: AppointmentOutcomes
}) {
  const scheduled = outcomes.scheduled

  const bars: readonly {
    readonly key: string
    readonly label: string
    readonly count: Exact
    readonly rate: string | null
    readonly kpiId: string | null
    readonly removed?: boolean
  }[] = [
    {
      key: 'scheduled',
      label: 'Scheduled appointments',
      count: scheduled,
      rate: null,
      kpiId: null,
    },
    {
      key: 'cancelled',
      label: 'Cancelled in advance',
      count: outcomes.cancelledInAdvance,
      rate: `${figureText(outcomes.cancellationRate, percent1)} of scheduled — removed from the show-rate denominator`,
      kpiId: null,
      removed: true,
    },
    {
      key: 'eligible',
      label: 'Eligible to show',
      count: outcomes.eligible,
      rate: 'scheduled less advance cancellations',
      kpiId: null,
    },
    {
      key: 'shown',
      label: 'Shown',
      count: outcomes.shown,
      rate: `${figureText(outcomes.showRate, percent1)} of eligible appointments`,
      kpiId: 'KPI-FUN-004',
    },
    {
      key: 'shown-and-sold',
      label: 'Shown and sold',
      count: outcomes.shownAndSold,
      rate: `${figureText(outcomes.showToSale, percent1)} of ${formatCountExact(outcomes.shownOnShowDate)} visits on the show date`,
      kpiId: 'KPI-FUN-005',
    },
  ]

  return (
    <ChartFrame
      title="Appointment outcomes"
      caption="Counts APPOINTMENTS, not leads: one lead can produce several, so these denominators are not the lead counts beside them. Show rate is on the scheduled date; show-to-sale on the show date."
      summary={`${formatCountExact(scheduled)} scheduled appointments, ${formatCountExact(
        outcomes.cancelledInAdvance
      )} cancelled in advance, ${formatCountExact(
        outcomes.eligible
      )} eligible to show, ${formatCountExact(
        outcomes.shown
      )} shown, ${formatCountExact(outcomes.shownAndSold)} shown and sold.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-2">
        {bars.map((bar) => (
          <li key={bar.key} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {bar.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {formatCountExact(bar.count)}
              </span>
            </p>
            <span
              aria-hidden="true"
              className="flex h-4 w-full items-center overflow-hidden rounded-xs bg-surface-sunken"
            >
              {/*
                THE REMOVED POPULATION IS DRAWN DIFFERENTLY AND IS NOT DRAWN AS WORSE. A
                hatched, muted bar says "this is taken out of what follows"; a red one would
                say a cancellation is a failure, and this project publishes no such
                judgement. The distinction is also carried in words on the line below, so it
                is never colour alone.
              */}
              <span
                className={cx(
                  'h-full rounded-xs',
                  bar.removed === true ? 'bg-data-tertiary/60' : 'bg-data-primary'
                )}
                style={{ width: widthOf(bar.count, scheduled) }}
              />
            </span>
            {bar.rate === null ? null : (
              <p className="text-2xs leading-normal text-ink-muted">
                {bar.rate}
                {bar.kpiId === null ? null : (
                  <span className="font-mono text-ink-faint"> {bar.kpiId}</span>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      <TableDisclosure title="appointment outcomes">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <caption className="sr-only">
            Appointment outcomes: count, governed rate and the denominator it divides by.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
              <th scope="col" className="py-2 pr-3">
                Stage
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Appointments
              </th>
              <th scope="col" className="py-2">
                Governed rate
              </th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {bar.label}
                </th>
                <td className="numeric py-2 pr-3 text-right">
                  {formatCountExact(bar.count)}
                </td>
                <td className="py-2 text-ink-muted">
                  {bar.rate ?? 'Count only'}
                  {bar.kpiId === null ? '' : ` (${bar.kpiId})`}
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
/* Response                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The banded distribution, with the median as the headline and the ignored leads inside it.
 *
 * THE DENOMINATOR OF EVERY BAND IS RESPONDED LEADS. The bands partition the answered
 * population; dividing by all leads would fold the ignored ones invisibly into every band, and
 * normalising to the largest band would draw a chart that fills its width whatever the data
 * says.
 *
 * NEVER-ANSWERED IS A ROW OF THIS FIGURE, not a note under it (`UX.2C` §10). Both response
 * KPIs are blind to those leads, so a store that answers few leads quickly reports an
 * excellent median. Drawn on the same axis as the bands — against valid leads, which is the
 * population it is a share of, and labelled as such — the omission is visible rather than
 * stated.
 *
 * NO BAND IS GOOD OR BAD. The four bands are the governed `RESPONSE_BANDS` enumeration and
 * nothing else; `UX.2C` §11 forbids inventing good/acceptable/slow labels, and this project
 * holds no threshold that would justify one. One hue, four descriptive bins.
 */
export function ResponseWorkspace({ response }: { readonly response: ResponseSummary }) {
  const centres: readonly RailFigure[] = [
    {
      id: 'median',
      label: 'Median',
      value: figureText(response.medianMinutes, (v) => formatMinutesExact(v, 1)),
      note: 'the headline: the distribution is heavily skewed',
      kpiId: 'KPI-FUN-008',
    },
    {
      id: 'mean',
      label: 'Mean',
      value: figureText(response.meanMinutes, (v) => formatMinutesExact(v, 1)),
      note: 'moved by the tail',
      kpiId: 'KPI-FUN-007',
    },
    {
      id: 'p90',
      label: '90th percentile',
      value: figureText(response.p90Minutes, (v) => formatMinutesExact(v, 1)),
      note: 'the tail the median cannot see',
      kpiId: null,
    },
  ]

  return (
    <ChartFrame
      title="Time to first response"
      summary={`Median first response ${figureText(response.medianMinutes, (v) =>
        formatMinutesExact(v, 1)
      )} across ${formatCountExact(
        response.respondedLeads
      )} answered leads, with ${formatCountExact(
        response.unrespondedLeads
      )} leads carrying no recorded response.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="grid grid-cols-3 gap-2">
        {centres.map((entry) => (
          <RailCard key={entry.id} figure={entry} rank="supporting" />
        ))}
      </ul>

      <ul className="flex flex-col gap-1.5">
        {response.bands.map((band) => (
          <li key={band.label} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {band.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {formatCountExact(band.count)}
                <span className="pl-2 text-2xs font-normal text-ink-muted">
                  {figureText(band.share, percent1)}
                </span>
              </span>
            </p>
            <span
              aria-hidden="true"
              className="h-3 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span
                className="block h-full rounded-pill bg-data-primary"
                style={{ width: widthOf(band.count, response.respondedLeads) }}
              />
            </span>
          </li>
        ))}

        {/* THE POPULATION BOTH KPIS CANNOT SEE, on the same axis as the ones they can. */}
        <li className="mt-1 flex flex-col gap-1 border-t border-line pt-2">
          <p className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-ink-secondary">
              Never answered
            </span>
            <span className="numeric shrink-0 text-sm font-semibold text-ink">
              {formatCountExact(response.unrespondedLeads)}
            </span>
          </p>
          <span
            aria-hidden="true"
            className="h-3 w-full overflow-hidden rounded-pill bg-surface-sunken"
          >
            <span
              className="block h-full rounded-pill bg-data-tertiary/60"
              style={{ width: widthOf(response.unrespondedLeads, response.validLeads) }}
            />
          </span>
          <p className="text-2xs leading-normal text-ink-muted">
            A share of {formatCountExact(response.validLeads)} valid leads, not of the
            answered population above: response coverage{' '}
            {figureText(response.coverageRate, percent1)}. Excluded from the median and the
            mean by definition — never answered is not a response of zero seconds.
          </p>
        </li>
      </ul>

      <TableDisclosure title="the response distribution">
        <table className="w-full min-w-[24rem] border-collapse text-sm">
          <caption className="sr-only">
            First-response bands, with the count of answered leads in each and its share of
            all answered leads.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
              <th scope="col" className="py-2 pr-3">
                Band
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Answered leads
              </th>
              <th scope="col" className="py-2 text-right">
                Share of answered
              </th>
            </tr>
          </thead>
          <tbody>
            {response.bands.map((band) => (
              <tr key={band.label} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {band.label}
                </th>
                <td className="numeric py-2 pr-3 text-right">
                  {formatCountExact(band.count)}
                </td>
                <td className="numeric py-2 text-right">
                  {figureText(band.share, percent1)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                No recorded response
              </th>
              <td className="numeric py-2 pr-3 text-right">
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
/* Stage loss                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where the cohort stopped, as the governed mutually-exclusive partition.
 *
 * `DASH.10` owns the arithmetic: each lead is counted once, at the furthest stage it reached,
 * and the entries sum exactly to valid leads. `UX.2C` §12 forbids deriving a lost-stage count
 * as shown-minus-sold, and nothing here derives anything — the five counts arrive from the
 * export.
 *
 * THE WALK-IN OVERLAY IS NOT A SIXTH BAR. Leads that bought with no modelled showroom visit are
 * already inside one of the earlier entries; drawing them as a sixth segment would double-count
 * them and break the identity with valid leads. It is stated as an overlay, in words, under the
 * partition — which is where §12 says separate behaviour stays separate.
 *
 * THE LABELS SAY WHERE, NEVER WHY. No communication content, activity detail or disposition is
 * modelled anywhere in this project, so nothing here can distinguish a customer who stopped
 * replying from a store that stopped calling.
 */
export function StageLossBars({ loss }: { readonly loss: StageLoss }) {
  return (
    <ChartFrame
      title="Furthest stage reached"
      summary={`${formatCountExact(
        loss.leadsReceived
      )} valid leads partitioned across ${String(loss.entries.length)} terminal stages, each lead counted once.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-1.5">
        {loss.entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {entry.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {formatCountExact(entry.count)}
              </span>
            </p>
            <span
              aria-hidden="true"
              className="h-3 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span
                className="block h-full rounded-pill bg-data-primary"
                style={{ width: widthOf(entry.count, loss.leadsReceived) }}
              />
            </span>
          </li>
        ))}
      </ul>

      <p className="text-2xs leading-normal text-ink-muted">
        Each lead is counted once, at the furthest stage it reached, and the counts sum to{' '}
        {formatCountExact(loss.leadsReceived)} valid leads. They say where progression
        stopped, never why: no communication or activity detail exists in this project to
        carry a reason. Separately, {formatCountExact(loss.soldWithoutShowroomVisit)} of the
        leads that bought have no modelled showroom visit — already counted in an earlier
        stage above, shown here rather than added.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* The comparison matrix                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The matrix's column templates, written out in full, one per supported column count.
 *
 * WRITTEN OUT BECAUSE TAILWIND SCANS SOURCE TEXT — the same rule `workspace-grid.tsx` states
 * for its span map, and the same failure when it is broken. The first version of this file
 * built the template with `grid-cols-[...repeat(${count}...)]`, which emits no CSS at all: the
 * rows fell back to a single-column grid, every cell stacked under the one before it, and the
 * route measured 7,784 px instead of 5,015 while looking like a deliberate layout rather than
 * the bug it was.
 */
const MATRIX_GRID: Readonly<Record<3 | 4, string>> = {
  3: 'grid grid-cols-[minmax(5rem,1.3fr)_repeat(3,minmax(0,1fr))] gap-x-3',
  4: 'grid grid-cols-[minmax(5rem,1.3fr)_repeat(4,minmax(0,1fr))] gap-x-3',
}

/** One measure column of the matrix. */
interface MatrixColumn<Row> {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  /** What the measure divides by, for the column key under the figure. */
  readonly of: string
  readonly value: (row: Row) => Figure
  readonly format: (value: Exact) => string
  /**
   * How the column's lengths are scaled.
   *
   * `rate` — the value IS the length, because a rate is already a fraction of one. Columns
   * scaled this way compare directly with each other and with the same column on another
   * figure.
   *
   * `own-max` — scaled to the largest resolved value in this column. Lengths compare WITHIN
   * the column and never across two, which is why the caption on every matrix says so.
   */
  readonly scale: 'rate' | 'own-max'
  readonly mark: string
}

/**
 * A set of identities against several measures, as one aligned matrix.
 *
 * WHY A MATRIX AND NOT `GroupedMeasureBars`. Nineteen lead sources across four measures is
 * seventy-six bars, and the grouped form draws them as four stacks of nineteen under a
 * nineteen-item colour legend — a reader comparing two sources on contact rate carries an
 * identity down four separate groups by hue, and nineteen hues is not a legend anybody reads.
 * The grouped form is right for three stores and wrong for nineteen sources. One row per
 * identity with the measures as aligned columns lets the eye scan a COLUMN for the outlier on
 * a measure and a ROW for one identity's whole profile, which are the two questions actually
 * asked of both figures on this route.
 *
 * A MEASURE THAT DOES NOT EXIST DRAWS NOTHING. `Figure` carries four absence states, and the
 * three that are not a value render as their words with no track and no bar. A zero-length bar
 * for an organic source's cost per lead would state that the cost is zero, which is the exact
 * defect the organic rule exists to prevent — and it would do it geometrically, where the
 * words cannot correct it.
 *
 * NOTHING IS RANKED. Rows arrive in the order the caller supplies, which on both call sites is
 * the business code, and there is no control to change it.
 */
function MeasureMatrix<Row extends { readonly key: string; readonly label: string }>({
  title,
  caption,
  summary,
  identityHeading,
  rows,
  columns,
  footnote,
  children,
}: {
  readonly title: string
  readonly caption: ReactNode
  readonly summary: string
  readonly identityHeading: string
  readonly rows: readonly Row[]
  readonly columns: readonly MatrixColumn<Row>[]
  readonly footnote?: ReactNode
  /** The exact table. Supplied by the caller because its columns are its own. */
  readonly children: ReactNode
}) {
  // Each column's own reference value, computed once rather than per cell.
  const maxima = new Map<string, number>()
  for (const column of columns) {
    if (column.scale !== 'own-max') continue
    let largest = 0
    for (const row of rows) {
      const value = column.value(row)
      if (isFigure(value)) largest = Math.max(largest, exactToApproxNumber(value.value))
    }
    maxima.set(column.id, largest)
  }

  const widthFor = (column: MatrixColumn<Row>, row: Row): string | null => {
    const value = column.value(row)
    if (!isFigure(value)) return null
    if (column.scale === 'rate') return rateWidth(value)
    const largest = maxima.get(column.id) ?? 0
    if (largest === 0) return '0%'
    const share = exactToApproxNumber(value.value) / largest
    return `${(Math.max(0, Math.min(1, share)) * 100).toFixed(4)}%`
  }

  const grid = MATRIX_GRID[columns.length === 3 ? 3 : 4]

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <div className="flex flex-col gap-1.5">
        {/*
          THE COLUMN KEYS ARE `aria-hidden`, and the exact table below carries the same
          headings as real `<th scope="col">`. A screen-reader user reads the table, where
          every value has a row header and a column header; a sighted user reads the matrix,
          where the same information is a grid. Announcing both would be the same figure
          twice.
        */}
        <div
          aria-hidden="true"
          className={cx(grid, 'border-b border-line-subtle pb-1 text-2xs text-ink-faint')}
        >
          <span>{identityHeading}</span>
          {columns.map((column) => (
            <span key={column.id} className="min-w-0 truncate">
              {column.label}
            </span>
          ))}
        </div>

        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className={cx(grid, 'items-center gap-y-0.5')}>
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {row.label}
              </span>
              {columns.map((column) => {
                const value = column.value(row)
                const width = widthFor(column, row)
                return (
                  <span key={column.id} className="flex min-w-0 flex-col gap-0.5">
                    <span className="numeric truncate text-2xs text-ink">
                      {figureText(value, column.format)}
                    </span>
                    {width === null ? null : (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
                      >
                        <span
                          className={cx('block h-full rounded-pill', column.mark)}
                          style={{ width }}
                        />
                      </span>
                    )}
                  </span>
                )
              })}
            </li>
          ))}
        </ul>
      </div>

      {footnote === undefined ? null : (
        <p className="text-2xs leading-normal text-ink-muted">{footnote}</p>
      )}

      {children}
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Source comparison                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every source on volume and the three governed lead-grain rates.
 *
 * THE THREE RATE COLUMNS SHARE A 0–100% SCALE and compare directly, to each other and down the
 * column. The volume column does not share it and is scaled to the largest source in scope.
 * The caption says which is which, because a reader who assumed one scale across all four
 * would read a high-volume source's short contact bar as a long one.
 *
 * NO SCORE, NO RANK, NO BEST OR WORST. Business-code order, no control to change it. Sources
 * differ in lead quality — `vw_lead_funnel`'s own column comment says so — and a composite
 * blending volume with conversion would be a judgement this project cannot support, presented
 * as a measurement.
 */
export function SourceMatrix({ sources }: { readonly sources: readonly SourceRow[] }) {
  const columns = [
    {
      id: 'contact',
      label: 'Contact',
      kpiId: 'KPI-FUN-002',
      of: 'valid leads',
      value: (row: SourceRow) => row.contactRate,
      format: percent1,
      scale: 'rate' as const,
      mark: 'bg-data-primary',
    },
    {
      id: 'appointment',
      label: 'Appt set',
      kpiId: 'KPI-FUN-003',
      of: 'contacted leads',
      value: (row: SourceRow) => row.appointmentSetRate,
      format: percent1,
      scale: 'rate' as const,
      mark: 'bg-data-primary',
    },
    {
      id: 'sale',
      label: 'Lead-to-sale',
      kpiId: 'KPI-FUN-006',
      of: 'valid leads',
      value: (row: SourceRow) => row.leadToSale,
      format: percent1,
      scale: 'rate' as const,
      mark: 'bg-data-primary',
    },
  ]

  const rows = sources.map((source) => ({ ...source, key: source.code, label: source.name }))

  return (
    <MeasureMatrix
      title="Sources on volume and the three governed rates"
      caption="The three rate columns share one 0–100% scale and compare directly. Volume is scaled to the largest source in scope and shares no scale with them. Business-code order; nothing is ranked and no composite score exists."
      summary={`${String(sources.length)} lead sources in scope, each with valid leads, contact rate, appointment-set rate and lead-to-sale conversion.`}
      identityHeading="Source"
      rows={rows}
      columns={[
        {
          id: 'volume',
          label: 'Valid leads',
          kpiId: 'KPI-FUN-001',
          of: 'the largest source in scope',
          value: (row) => figure(row.leadsReceived),
          format: formatCountExact,
          scale: 'own-max',
          mark: 'bg-data-secondary',
        },
        ...columns,
      ]}
      footnote={
        <>
          {columns
            .map((column) => `${column.label} divides by ${column.of} (${column.kpiId})`)
            .join('. ')}
          . Appointment-set rate divides by CONTACTED leads and not by all of them, so a
          source reached rarely can post a higher one than a source reached often.
        </>
      }
    >
      <TableDisclosure title="source outcomes">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">
            Lead source, category, valid leads, contact rate, appointment-set rate,
            lead-to-sale conversion and sold leads.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
              <th scope="col" className="py-2 pr-3">
                Source
              </th>
              <th scope="col" className="py-2 pr-3">
                Category
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Valid leads
              </th>
              {columns.map((column) => (
                <th key={column.id} scope="col" className="py-2 pr-3 text-right">
                  {column.label}
                </th>
              ))}
              <th scope="col" className="py-2 text-right">
                Sold
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.code} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                  {row.name}
                </th>
                <td className="py-2 pr-3 text-ink-muted">{row.category}</td>
                <td className="numeric py-2 pr-3 text-right">
                  {formatCountExact(row.leadsReceived)}
                </td>
                {columns.map((column) => (
                  <td key={column.id} className="numeric py-2 pr-3 text-right">
                    {figureText(column.value(row), percent1)}
                  </td>
                ))}
                <td className="numeric py-2 text-right">
                  {formatCountExact(row.soldLeads)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </MeasureMatrix>
  )
}

/* -------------------------------------------------------------------------- */
/* Marketing economics                                                         */
/* -------------------------------------------------------------------------- */

const COST_STATE_LABEL: Readonly<Record<string, string>> = {
  measurable: 'Measured',
  'not-cost-attributable': 'Organic or internal — no advertising cost',
  'spend-without-leads': 'Spend with no attributed leads',
  'spend-without-sales': 'Spend with no attributed sales',
  'leads-without-spend': 'Leads with no recorded spend',
}

/**
 * The group's three cost measures, and the same three compared across sources.
 *
 * ORGANIC SOURCES DRAW NO BAR AND SAY "NOT APPLICABLE" (`UX.2C` §14). `GroupedMeasureBars`
 * renders a `null` value as words and no geometry, which is the only correct treatment: a
 * $0.00 cost per lead would draw a walk-in as the most efficient channel the group operates,
 * and a zero-length bar is that same false statement drawn.
 *
 * GROSS ROAS IS NOT PROFIT AND IS NOT CALLED PROFIT. It nets out the cost of the vehicle and
 * nothing else — no personnel, facility, floor-plan, overhead, tax or agency cost is modelled
 * anywhere in this project. One visible caveat says so; the rest is behind the route's
 * methodology, which is the split §14 asks for.
 *
 * THE COMPARISON IS AT SOURCE GRAIN AND THE TABLE IS AT CAMPAIGN GRAIN. Thirty-five campaign
 * rows is a table, not a comparison. `MarketingSourceRow` is the same `marketingMeasures`
 * function at a coarser group — the ratio-of-sums rule and the organic rule are inherited from
 * it rather than re-implemented here, so neither can drift.
 */
export function MarketingEconomics({
  marketing,
}: {
  readonly marketing: MarketingSummary
}) {
  if (marketing.monthGrainUnavailable) {
    return (
      <p className="rounded-lg border border-line bg-surface-sunken/60 p-3 text-sm text-ink">
        <strong className="font-semibold">Not published at this grain.</strong> Marketing
        spend is recorded by calendar month, so cost per lead, cost per sale and gross
        return are only defined over whole months, and the selected period covers no
        complete month. Spend is never prorated: this project governs no proration rule.
      </p>
    )
  }

  const headline: readonly RailFigure[] = [
    {
      id: 'spend',
      label: 'Attributable spend',
      value: figureText(marketing.totalSpend, (v) => formatCurrencyExact(v, 0)),
      note: 'cost-attributable sources only',
      kpiId: null,
    },
    {
      id: 'cost-per-lead',
      label: 'Cost per valid lead',
      value: figureText(marketing.costPerLead, (v) => formatCurrencyExact(v, 2)),
      note: 'total spend ÷ total attributed leads',
      kpiId: 'KPI-MKT-001',
    },
    {
      id: 'cost-per-sale',
      label: 'Cost per attributed sale',
      value: figureText(marketing.costPerSale, (v) => formatCurrencyExact(v, 2)),
      note: 'total spend ÷ total attributed retail units',
      kpiId: 'KPI-MKT-002',
    },
    {
      id: 'gross-roas',
      label: 'Gross return on ad spend',
      value: figureText(marketing.grossRoas, (v) => formatRateExact(v, 2)),
      note: 'attributed gross ÷ spend. Contribution, not profit',
      kpiId: 'KPI-MKT-003',
    },
  ]

  const money = (value: Exact) => formatCurrencyExact(value, 2)
  const rate = (value: Exact) => formatRateExact(value, 2)

  const sourceRows = marketing.bySource.map((row) => ({
    ...row,
    key: row.sourceCode,
    label: row.sourceName,
  }))

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        {headline.map((entry) => (
          <RailCard key={entry.id} figure={entry} rank="supporting" />
        ))}
      </ul>

      <MeasureMatrix
        title="Cost and return, by source"
        caption={`Whole calendar months only: ${marketing.wholeMonths.join(', ')}. Each column is scaled to its own largest source; lengths compare within a column and never across two.`}
        summary={`${String(marketing.bySource.length)} lead sources over ${marketing.wholeMonths.join(', ')}, each with spend, cost per valid lead, cost per attributed sale and gross return on ad spend.`}
        identityHeading="Source"
        rows={sourceRows}
        columns={[
          {
            id: 'spend',
            label: 'Spend',
            kpiId: null,
            of: 'the largest spending source',
            value: (row) => row.spend,
            format: (value) => formatCurrencyExact(value, 0),
            scale: 'own-max',
            mark: 'bg-data-secondary',
          },
          {
            id: 'cost-per-lead',
            label: 'Cost/lead',
            kpiId: 'KPI-MKT-001',
            of: 'attributed leads',
            value: (row) => row.costPerLead,
            format: money,
            scale: 'own-max',
            mark: 'bg-data-primary',
          },
          {
            id: 'cost-per-sale',
            label: 'Cost/sale',
            kpiId: 'KPI-MKT-002',
            of: 'attributed retail units',
            value: (row) => row.costPerSale,
            format: money,
            scale: 'own-max',
            mark: 'bg-data-primary',
          },
          {
            id: 'gross-roas',
            label: 'Gross ROAS',
            kpiId: 'KPI-MKT-003',
            of: 'spend',
            value: (row) => row.grossRoas,
            format: rate,
            scale: 'own-max',
            mark: 'bg-data-primary',
          },
        ]}
        footnote="An organic or internal source has NO cost per opportunity — not a cost of zero — so it prints Not applicable and draws no bar; a zero-length bar would rank a walk-in as the most efficient channel the group operates. Gross return is attributed gross divided by spend: it nets out the cost of the vehicle and nothing else, which makes it a contribution measure and not profit, ROI or incremental return."
      >
        <MarketingDetail marketing={marketing} />
      </MeasureMatrix>
    </div>
  )
}

/** The exact campaign-grain detail, behind a disclosure because it is ten columns wide. */
function MarketingDetail({ marketing }: { readonly marketing: MarketingSummary }) {
  return (
    <TableDisclosure title="spend and attribution by campaign">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">
          Marketing performance by source and campaign: spend, attributed leads and retail
          sales, cost per lead, cost per sale, attributed gross, gross return and cost
          state.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
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
              <td className="numeric py-2 pr-3 text-right">
                {figureText(row.spend, (v) => formatCurrencyExact(v, 0))}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {formatCountExact(row.attributedLeads)}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {formatCountExact(row.attributedRetailUnits)}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {figureText(row.costPerLead, (v) => formatCurrencyExact(v, 2))}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {figureText(row.costPerSale, (v) => formatCurrencyExact(v, 2))}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {formatCurrencyExact(row.attributedTotalGross, 0)}
              </td>
              <td className="numeric py-2 pr-3 text-right">
                {figureText(row.grossRoas, (v) => formatRateExact(v, 2))}
              </td>
              <td className="py-2 text-xs text-ink-muted">
                {COST_STATE_LABEL[row.costState] ?? row.costState}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableDisclosure>
  )
}

/* -------------------------------------------------------------------------- */
/* Vendor counts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Four counts of four different things, never reconciled to each other.
 *
 * SECONDARY BY POSITION (`UX.2C` §15). This is a reconciliation diagnostic, and the demand
 * funnel is the page's subject; it sits in the last analytical row rather than beside the
 * conversion measures. It is a compact stepped comparison rather than four equal cells,
 * because the interesting thing about these four numbers is the size of the gaps between them.
 *
 * The vendor figure is never substituted for KPI-FUN-001 and the two are never reconciled:
 * vendors count differently and typically count duplicates. The gap is something to raise with
 * a vendor, not a defect to correct.
 */
export function VendorCounts({
  vendor,
  wholeMonths,
}: {
  readonly vendor: VendorDiscrepancy
  readonly wholeMonths: readonly string[]
}) {
  const cells: readonly { readonly label: string; readonly value: Exact }[] = [
    { label: 'Vendor reported', value: vendor.vendorReported },
    { label: 'Lead records received', value: vendor.crmReceived },
    { label: 'Duplicates excluded', value: vendor.duplicatesExcluded },
    { label: 'Valid leads (KPI-FUN-001)', value: vendor.validLeads },
  ]
  const largest = cells.reduce(
    (max, cell) => (cell.value.units > max.units ? cell.value : max),
    { units: 0n, scale: 0 } as Exact
  )

  return (
    <ChartFrame
      title="Vendor counts against the CRM"
      summary={`Over ${
        wholeMonths.length === 0 ? 'no complete month' : wholeMonths.join(', ')
      }, vendors reported ${formatCountExact(
        vendor.vendorReported
      )} leads against ${formatCountExact(vendor.validLeads)} valid CRM leads.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-1.5">
        {cells.map((cell) => (
          <li key={cell.label} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {cell.label}
              </span>
              <span className="numeric shrink-0 text-sm font-semibold text-ink">
                {formatCountExact(cell.value)}
              </span>
            </p>
            <span
              aria-hidden="true"
              className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span
                className="block h-full rounded-pill bg-data-secondary"
                style={{ width: widthOf(cell.value, largest) }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-2xs leading-normal text-ink-muted">
        Four counts of four different populations, deliberately not reconciled to each
        other. Vendor spend is recorded by month, so the comparison is formed only over
        whole months in the selected period.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* The cohort caveat                                                           */
/* -------------------------------------------------------------------------- */

/** The one-line maturity caution, where a conversion or cost measure is read. */
export function CohortMaturityLine({
  immature,
}: {
  readonly immature: boolean
}): ReactNode {
  if (!immature) return null
  return (
    <p
      className="rounded-lg border border-line bg-surface-sunken/60 px-3 py-2 text-xs text-ink"
      data-testid="cohort-maturity-notice"
    >
      <strong className="font-semibold">This period includes an immature cohort.</strong>{' '}
      Leads count in the period they arrived, so the newest ones have had least time to
      convert: lead-to-sale, cost per attributed sale and gross return are structurally
      incomplete here and improve as those leads mature.
    </p>
  )
}
