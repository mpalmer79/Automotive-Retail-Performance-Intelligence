/**
 * Target context: the plan, the attainment, the selling-day clock and the projection.
 *
 * WHERE IT SITS IN THE HIERARCHY
 * ------------------------------
 * The actual stays the headline. `KpiStrip` renders retail units and total gross as the
 * primary business result, and this section is the management context beside them — what
 * the store committed to, how far through the month's selling capacity it is, and where
 * the month lands if the current rate holds. Burying the actual under a percentage would
 * invert what an operating report is for.
 *
 * FIVE DIFFERENT KINDS OF NUMBER, RENDERED FIVE DIFFERENT WAYS
 * ------------------------------------------------------------
 * Actual and target are figures in the measure's own unit. Attainment is a percentage.
 * Pace is a rate per selling day and says so. The projection is a figure with a label
 * that never varies. And a missing plan is words, never a zero.
 *
 * "SELLING-DAY PACE PROJECTION", EVERY TIME
 * -----------------------------------------
 * The phrase comes from one exported constant, so it cannot drift. The word "forecast"
 * appears nowhere on this console for this arithmetic, and the end-to-end suite asserts
 * its absence rather than trusting the review that removed it.
 *
 * Server components. No client JavaScript, no chart library, no colour-coded verdict.
 */
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type { Exact } from '@/lib/dashboard/decimal'
import {
  formatCountExact,
  formatCurrencyExact,
  formatIsoDate,
  formatRateExact,
  formatRatioAsPercent,
} from '@/lib/dashboard/format'
import {
  PACE_PROJECTION_LABEL,
  TARGET_DISCLOSURE,
  type SellingDayClock,
  type TargetContext,
  type TargetMeasureContext,
} from '@/lib/dashboard/targets'
import { sellingDayProgress } from '@/lib/dashboard/targets'

import { PaceBar, PaceLine } from './pace-bar'

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A measure's own unit, applied to an exact value.
 *
 * This is the ONE place the display-rounding convention for a projected unit count
 * lives: a projection of `40.6` units renders as `41`, because a store delivers whole
 * cars, and the exact ratio is retained in the value handed in. Rounding here and
 * nowhere earlier is what keeps the export's reconciliation exact.
 */
function formatMeasure(value: Exact, unit: 'count' | 'currency'): string {
  return unit === 'count' ? formatCountExact(value) : formatCurrencyExact(value, 0)
}

/** The pace line's text: units or dollars per governed selling day. */
function formatPace(value: Exact, unit: 'count' | 'currency'): string {
  return unit === 'count'
    ? `${formatRateExact(value, 2)} units per selling day`
    : `${formatCurrencyExact(value, 2)} per selling day`
}

/* -------------------------------------------------------------------------- */
/* The section                                                                 */
/* -------------------------------------------------------------------------- */

export function TargetPaceSection({
  context,
  headingLevel = 'h3',
}: {
  readonly context: TargetContext
  /** So the section can sit under an `h2` on one route and an `h3` on another. */
  readonly headingLevel?: 'h3' | 'h4'
}) {
  if (context.comparability.kind === 'not-comparable') {
    return <TargetNotComparable reason={context.comparability.reason ?? ''} />
  }

  return (
    <div className="flex flex-col gap-3">
      {context.clock === null ? null : <SellingDayClockLine clock={context.clock} />}

      {context.comparability.kind === 'totals-only' ? (
        <Text size="sm" tone="muted" className="max-w-prose">
          {context.comparability.reason}
        </Text>
      ) : null}

      {/*
        ONE COLUMN, NOT TWO. In the command-center grid this module is five of twelve
        columns wide, and two bullet tracks side by side inside it are 120 px each — a
        length that cannot carry a target marker and a selling-day marker distinguishably.
        Stacked, each track is the width of the module and both markers are legible.
      */}
      <div className="flex flex-col gap-4">
        {context.measures.map((measure) => (
          <TargetCard
            key={measure.measure.id}
            measure={measure}
            clock={context.clock}
            headingLevel={headingLevel}
          />
        ))}
      </div>

      <TargetFictionNotice />
    </div>
  )
}

/**
 * The selling-day position, compressed to the line a desk actually says.
 *
 * `SellingDayHeader` is the two-to-three sentence version and is still exported for the
 * surfaces that lead with the clock. On the Executive workspace the clock is one fact among
 * a dozen on the screen, and its long form was 40 words of prose above a bullet chart that
 * already draws the elapsed marker. What survives is the count, the state and the date —
 * everything the marker on the track cannot say.
 */
function SellingDayClockLine({ clock }: { readonly clock: SellingDayClock }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted">
      <span className="font-medium text-ink-secondary">
        {clock.elapsed === 0
          ? `No selling day elapsed of ${String(clock.total)}`
          : `Selling day ${String(clock.elapsed)} of ${String(clock.total)}`}
      </span>
      <span>
        {clock.monthState === 'Complete'
          ? `Month complete, so attainment is final and the ${PACE_PROJECTION_LABEL.toLowerCase()} equals the actual.`
          : `${String(clock.remaining)} remaining at ${formatIsoDate(clock.effectiveAsOfDate)}.`}
      </span>
      <span className="font-mono text-2xs text-ink-faint">KPI-TGT-005 · KPI-TGT-006</span>
    </p>
  )
}

/** One measure's card: actual, target, attainment, pace, projection. */
function TargetCard({
  measure,
  clock,
  headingLevel,
}: {
  readonly measure: TargetMeasureContext
  readonly clock: SellingDayClock | null
  readonly headingLevel: 'h3' | 'h4'
}) {
  const Heading = headingLevel
  const definition = measure.measure
  const unit = definition.unit
  const actualText = formatMeasure(measure.actual, unit)
  const targetText = measure.target === null ? null : formatMeasure(measure.target, unit)

  return (
    <Card as="article" padding="sm" className="flex flex-col gap-3">
      <Heading className="text-sm font-semibold text-ink">
        {definition.label} against plan
      </Heading>

      <PaceBar
        label={definition.label}
        actualText={actualText}
        targetText={targetText}
        numerator={measure.attainmentNumerator}
        denominator={measure.attainmentDenominator}
        attainment={measure.attainment}
        sellingDayProgress={clock === null ? null : sellingDayProgress(clock)}
        missingTargetText="No target set"
      >
        {measure.pace === null ? (
          <PaceLine
            label="Pace"
            value={
              clock === null
                ? 'Not available outside a single calendar month'
                : 'Not available before the first selling day'
            }
            kpiId={definition.paceKpi}
          />
        ) : (
          <PaceLine
            label="Pace"
            value={formatPace(measure.pace, unit)}
            kpiId={definition.paceKpi}
          />
        )}

        {measure.projection === null ? (
          <PaceLine
            label={PACE_PROJECTION_LABEL}
            value={
              clock === null
                ? 'Not available outside a single calendar month'
                : 'Not available before the first selling day'
            }
            kpiId={definition.projectionKpi}
          />
        ) : (
          <PaceLine
            label={PACE_PROJECTION_LABEL}
            value={formatMeasure(measure.projection, unit)}
            kpiId={definition.projectionKpi}
          />
        )}
      </PaceBar>

      {measure.projectionVersusTargetDirection === null ? null : (
        <Text size="xs" tone="muted">
          {differenceSentence(measure)}
        </Text>
      )}

      {measure.excludedStores.length === 0 ? null : (
        <Text size="xs" tone="muted">
          {measure.excludedStores.map((store) => store.shortName).join(', ')} has no plan
          for this period. Its deliveries are in the actual above and are excluded from
          the attainment ratio on both sides, so the percentage compares like with like.
        </Text>
      )}

      <Disclosure
        label={`How ${definition.label.toLowerCase()} against plan is calculated`}
      >
        <ul className="flex flex-col gap-1.5">
          <li>
            <span className="font-medium text-ink-secondary">Target</span> (
            {definition.targetKpi}): the sum of store-scope plan rows for the selected
            stores and months. Department rows exist in the same governed dataset and are
            refinements of the store plan, never addends.
          </li>
          <li>
            <span className="font-medium text-ink-secondary">Attainment</span> (
            {definition.attainmentKpi}): summed actual divided by summed target, over the
            same stores on both sides. It is never the average of store percentages, and a
            store with no plan contributes to neither side.
          </li>
          <li>
            <span className="font-medium text-ink-secondary">Pace</span> (
            {definition.paceKpi}): actual divided by governed selling days elapsed,
            counted from the governed date dimension&rsquo;s selling-day flag and shared
            by all three stores.
          </li>
          <li>
            <span className="font-medium text-ink-secondary">
              {PACE_PROJECTION_LABEL}
            </span>{' '}
            ({definition.projectionKpi}): pace multiplied by the month&rsquo;s selling
            days. It is linear arithmetic over the calendar &mdash; not a forecast, not a
            prediction and not a statistical model &mdash; and it ignores the within-month
            shape of trading, so an early-month figure moves more than a late-month one.
          </li>
        </ul>
        {/*
          The definitions themselves are not restated here: the governing text is the KPI
          catalogue, and the console points at it rather than keeping a second copy that
          would drift on its first edit. The Targets and pace family is deliberately
          absent from the /kpis catalogue for the same reason the listing family is --
          that page renders the 29 MVP KPIs the semantic model implements as measures,
          and these ten are governed SQL measures that no DAX has ever computed.
        */}
        <SourceLink
          path="KPI_CATALOG.md"
          field={`section 39 \u2014 ${definition.targetKpi}, ${definition.attainmentKpi}, ${definition.paceKpi}, ${definition.projectionKpi}`}
          variant="block"
          className="pt-2"
        />
      </Disclosure>
    </Card>
  )
}

/**
 * The factual comparison sentence.
 *
 * Deliberately arithmetic rather than evaluative: "6 units above target", never
 * "excellent". ARPI has no governed favourable direction for these measures, and a
 * console that supplied one would be publishing a judgement rather than a figure.
 */
function differenceSentence(measure: TargetMeasureContext): string {
  const direction = measure.projectionVersusTargetDirection
  const magnitude = measure.projectionVersusTargetMagnitude
  if (direction === null || magnitude === null) return ''
  if (direction === 'level') return `${PACE_PROJECTION_LABEL} is exactly at target.`
  const text = formatMeasure(magnitude, measure.measure.unit)
  return `${PACE_PROJECTION_LABEL} is ${text} ${direction} target.`
}

/** What the page shows instead of a percentage when the filter broke the comparison. */
export function TargetNotComparable({ reason }: { readonly reason: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken p-4">
      <Text size="sm" tone="secondary" className="max-w-prose">
        <span className="font-medium text-ink">Target context is not comparable.</span>{' '}
        {reason}
      </Text>
      <Text size="xs" tone="muted" className="max-w-prose pt-2">
        {TARGET_DISCLOSURE}
      </Text>
    </div>
  )
}

/** The synthetic-target disclosure. One per surface that shows a target. */
export function TargetFictionNotice() {
  return (
    <Text size="xs" tone="muted" className="max-w-prose border-t border-line pt-3">
      {TARGET_DISCLOSURE}
    </Text>
  )
}

/* -------------------------------------------------------------------------- */
/* Scoreboard cell                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The scoreboard's compact pace cell.
 *
 * ONE COLUMN, NOT FOUR. Adding a target column, an attainment column, a pace column and
 * a projection column would take the table from ten columns to fourteen and push it off
 * every laptop; the card view below 1280px would grow by the same four. Two lines in one
 * management cell carry the same information in the order a GM reads it — where the
 * month lands, against what it was supposed to be.
 */
export function ScoreboardPaceCell({
  measures,
}: {
  readonly measures: readonly TargetMeasureContext[]
}) {
  if (measures.length === 0) {
    return <span className="text-ink-faint">Not comparable</span>
  }
  return (
    <span className="flex flex-col gap-0.5 text-right">
      {measures.map((measure) => (
        <span key={measure.measure.id} className="block">
          <span className="sr-only">{measure.measure.label}: </span>
          <span className="font-mono text-sm text-ink tabular-nums">
            {measure.projection === null
              ? 'None'
              : formatMeasure(measure.projection, measure.measure.unit)}
          </span>
          <span className="text-2xs text-ink-faint">
            {' '}
            projected /{' '}
            {measure.target === null
              ? 'no target set'
              : formatMeasure(measure.target, measure.measure.unit)}{' '}
            target
          </span>
          {measure.attainment === null ? null : (
            <span className="block font-mono text-2xs text-ink-muted tabular-nums">
              {formatRatioAsPercent(measure.attainment, 1)} of target
            </span>
          )}
        </span>
      ))}
    </span>
  )
}
