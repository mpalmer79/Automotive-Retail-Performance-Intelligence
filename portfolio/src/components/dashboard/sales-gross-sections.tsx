/**
 * The Sales and Gross page's sections.
 *
 * Server components without exception. Every figure arrives already resolved and
 * already formatted by `lib/dashboard/sales-gross.ts`; nothing here computes, and
 * nothing here decides what a measure means.
 *
 * THE STATES ARE THE POINT
 * ------------------------
 * A figure has four renderings and they say four different things: a value, "No
 * matching records" (nothing was finalized), "No eligible denominator" (a rate whose
 * denominator is zero, which is undefined and not zero), and "Not applicable" (the
 * measure cannot apply to this scope at all). Collapsing any of them into $0 would be
 * a false statement about a real month.
 */
import type { ReactNode } from 'react'

import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type {
  BridgeState,
  ComparedFigure,
  Figure,
  GrossDistribution,
  MixBreakdown,
  PerformanceMetric,
  TrendSeries,
} from '@/lib/dashboard/sales-gross'
import { kpiDefinition, kpiDefinitionHref } from '@/lib/dashboard/sales-gross'
import { formatCountExact, formatCurrencyExact } from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import { BridgeChart, DistributionStrip, TrendChart } from './visuals'

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

/** The words each absent state renders. One vocabulary, used everywhere. */
export function figureText(figure: Figure): string {
  switch (figure.kind) {
    case 'value':
      return figure.display
    case 'no-rows':
      return 'No matching records'
    case 'null-ratio':
      return 'No eligible denominator'
    case 'not-applicable':
      return 'Not applicable'
  }
}

function FigureValue({ figure }: { readonly figure: Figure }) {
  const isValue = figure.kind === 'value'
  return (
    <span
      className={cx(
        isValue ? 'numeric text-2xl font-semibold text-ink' : 'text-sm text-ink-muted'
      )}
    >
      {figureText(figure)}
    </span>
  )
}

function ComparisonLine({
  figure,
  comparisonLabel,
}: {
  readonly figure: ComparedFigure
  readonly comparisonLabel: string | null
}) {
  if (figure.difference === null) {
    return (
      <Text size="xs" tone="faint">
        {figure.current.kind === 'not-applicable'
          ? figure.current.reason
          : comparisonLabel === null
            ? 'No comparison period selected.'
            : 'No comparable figure for the comparison period.'}
      </Text>
    )
  }
  return (
    <Text size="xs" tone="muted">
      {/* Neutral wording. This console declares no favourable direction for a gross
          measure, and colouring a fall red would be a judgement, not a figure. */}
      <span className="numeric">{figure.difference}</span>
      {comparisonLabel === null ? '' : ` against ${comparisonLabel}`}
    </Text>
  )
}

/** One metric tile. */
export function MetricTile({
  metric,
  comparisonLabel,
}: {
  readonly metric: PerformanceMetric
  readonly comparisonLabel: string | null
}) {
  const definition = metric.kpiId === null ? undefined : kpiDefinition(metric.kpiId)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line-subtle bg-surface p-4">
      <Text size="xs" tone="muted" className="uppercase tracking-wide">
        {metric.label}
      </Text>
      <FigureValue figure={metric.figure.current} />
      <ComparisonLine figure={metric.figure} comparisonLabel={comparisonLabel} />
      {metric.kpiId ? (
        <a
          href={kpiDefinitionHref(metric.kpiId)}
          className="mt-1 inline-flex min-h-6 items-center text-xs text-ink-faint underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          {metric.kpiId}
        </a>
      ) : null}
      {definition ? (
        <Disclosure label="How is this calculated?">
          <Text size="xs" tone="muted">
            {definition.definition}
          </Text>
          <Text size="xs" tone="faint" className="numeric pt-1">
            {definition.formula}
          </Text>
        </Disclosure>
      ) : null}
    </div>
  )
}

export function PerformanceGrid({
  metrics,
  comparisonLabel,
}: {
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} comparisonLabel={comparisonLabel} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

const GRANULARITY_COPY: Readonly<Record<string, string>> = {
  daily: 'one column per sale date',
  weekly: 'one column per ISO week, starting Monday',
  monthly: 'one column per calendar month',
}

/**
 * Four trends over the same buckets.
 *
 * The per-unit trend is recomputed inside each bucket from that bucket's own summed
 * gross and units. It is never the average of the daily rates the dataset publishes,
 * which would weight a one-unit Tuesday the same as a nine-unit Saturday.
 */
export function TrendSection({
  series,
  comparisonLabel,
}: {
  readonly series: TrendSeries
  readonly comparisonLabel: string | null
}) {
  const caption = `Aggregated to ${GRANULARITY_COPY[series.granularity] ?? series.granularity}, chosen from the length of the selected period.`
  return (
    <div className="flex flex-col gap-8">
      {series.notice ? (
        <Text size="sm" tone="muted">
          {series.notice}
        </Text>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-2">
        <TrendChart
          title="Retail units"
          caption={caption}
          measure="Retail units"
          points={series.points.map((point) => ({
            key: point.key,
            label: point.label,
            value: point.retailUnits,
            display: formatCountExact(point.retailUnits),
          }))}
          periodHeading="Period"
          valueHeading="Units"
        />
        <TrendChart
          title="Total gross"
          caption={caption}
          measure="Total gross"
          points={series.points.map((point) => ({
            key: point.key,
            label: point.label,
            value: point.totalGross,
            display: formatCurrencyExact(point.totalGross),
          }))}
          valueHeading="Total gross"
        />
        <TrendChart
          title="Front gross"
          caption={caption}
          measure="Front gross"
          points={series.points.map((point) => ({
            key: point.key,
            label: point.label,
            value: point.frontGross,
            display: formatCurrencyExact(point.frontGross),
          }))}
          valueHeading="Front gross"
        />
        <TrendChart
          title="Total gross per retail unit"
          caption={`${caption} A period with no retail unit has no per-unit gross and is drawn as a gap, never as zero.`}
          measure="Total gross per retail unit"
          points={series.points.map((point) => ({
            key: point.key,
            label: point.label,
            value: point.totalPvr,
            display:
              point.totalPvr === null
                ? 'No eligible denominator'
                : formatCurrencyExact(point.totalPvr),
          }))}
          valueHeading="Total PVR"
        />
      </div>
      {comparisonLabel ? (
        <Text size="xs" tone="faint">
          {`The comparison period (${comparisonLabel}) is shown as a difference on each metric above rather than as a second series: two overlaid lines invite a reader to compare shapes when the figure that matters is the difference.`}
        </Text>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mix                                                                         */
/* -------------------------------------------------------------------------- */

export function MixSection({ mixes }: { readonly mixes: readonly MixBreakdown[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {mixes.map((mix) => (
        <div
          key={mix.id}
          className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4"
        >
          <h3 className="text-base font-semibold text-ink">{mix.title}</h3>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{mix.title}</caption>
            <thead>
              <tr className="border-b border-line-subtle text-left">
                <th scope="col" className="py-1.5 pr-2 font-medium text-ink-muted">
                  Segment
                </th>
                <th
                  scope="col"
                  className="py-1.5 pr-2 text-right font-medium text-ink-muted"
                >
                  Units
                </th>
                <th scope="col" className="py-1.5 text-right font-medium text-ink-muted">
                  Gross
                </th>
              </tr>
            </thead>
            <tbody>
              {mix.rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-line-subtle/60 last:border-0"
                >
                  <th scope="row" className="py-1.5 pr-2 font-normal text-ink-secondary">
                    {row.label}
                    {row.share ? (
                      <span className="ml-1.5 text-xs text-ink-faint">{row.share}</span>
                    ) : null}
                  </th>
                  <td className="numeric py-1.5 pr-2 text-right text-ink">{row.units}</td>
                  <td className="numeric py-1.5 text-right text-ink">
                    {row.grossDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mix.note ? (
            <Text size="xs" tone="faint">
              {mix.note}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Contribution                                                                */
/* -------------------------------------------------------------------------- */

export function ContributionSection({
  front,
  back,
  frontShare,
  backShare,
}: {
  readonly front: Figure
  readonly back: Figure
  readonly frontShare: string | null
  readonly backShare: string | null
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface p-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Front-end gross
          </dt>
          <dd className="numeric text-2xl font-semibold text-ink">{figureText(front)}</dd>
          <dd className="text-xs text-ink-faint">
            {frontShare === null
              ? 'Share undefined on a zero total.'
              : `${frontShare} of total gross`}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Back-end gross
          </dt>
          <dd className="numeric text-2xl font-semibold text-ink">{figureText(back)}</dd>
          <dd className="text-xs text-ink-faint">
            {backShare === null
              ? 'Share undefined on a zero total.'
              : `${backShare} of total gross`}
          </dd>
        </div>
      </dl>
      <Text size="xs" tone="faint">
        Front and back are published separately and are not ranked against each other. A
        store can hold total gross steady while front collapses and the finance office
        compensates, and that is a materially different situation from one where both are
        stable: which is preferable depends on the store, not on the figure.
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Distribution                                                                */
/* -------------------------------------------------------------------------- */

export function DistributionSection({
  distribution,
}: {
  readonly distribution: GrossDistribution
}) {
  return (
    <div className="flex flex-col gap-5">
      <DistributionStrip
        title="Total gross per deal"
        caption="Every retail transaction in scope, counted into bands by its own total gross."
        buckets={distribution.bands}
        unit="deals"
        median={
          distribution.medianDisplay === null
            ? null
            : { label: 'Median', display: distribution.medianDisplay }
        }
        mean={
          distribution.meanDisplay === null
            ? null
            : { label: 'Mean', display: distribution.meanDisplay }
        }
      />
      <div className="rounded-lg border border-line-subtle bg-surface-sunken/50 p-4">
        <Text size="xs" tone="muted">
          {`${String(distribution.negativeFrontCount)} of ${String(distribution.dealCount)} deals in scope closed at a front-end loss. A negative front is a real dealership outcome: it is counted, shown with its sign, and never suppressed.`}
        </Text>
        <Text size="xs" tone="faint" className="pt-2">
          The median is computed from the deal-level values themselves, never from store
          medians: an order statistic cannot be recomputed from an aggregate. The mean
          over a retail population is total gross divided by retail units, which is
          KPI-GRS-006 by definition, so it is the same figure the performance summary
          shows.
        </Text>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The gross change bridge.
 *
 * NON-CAUSAL BY CONSTRUCTION. The sentence comes from the view model, which builds it
 * from the exported components using attribution verbs only. Nothing in this component
 * can turn it into a causal claim, because nothing here writes a sentence.
 */
export function BridgeSection({ bridge }: { readonly bridge: BridgeState }) {
  if (bridge.kind === 'unavailable') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-surface-sunken/50 p-5">
        <h3 className="text-base font-semibold text-ink">
          Bridge not comparable for this period
        </h3>
        <Text size="sm" tone="muted">
          {bridge.reason}
        </Text>
        {bridge.changeDisplay ? (
          <Text size="sm" tone="secondary">
            {`The period change itself is still defined: total gross moved ${bridge.changeDisplay}. Only its decomposition is unavailable.`}
          </Text>
        ) : null}
      </div>
    )
  }

  const bars = [
    {
      key: 'comparison',
      label: 'Comparison total',
      value: bridge.comparisonTotal,
      display: formatCurrencyExact(bridge.comparisonTotal),
      kind: 'anchor' as const,
    },
    ...bridge.components.map((component) => ({
      key: component.code,
      label: component.label,
      value: component.amount,
      display: component.display,
      kind: 'step' as const,
    })),
    ...(bridge.rounding === null
      ? []
      : [
          {
            key: 'rounding',
            label: 'Rounding',
            value: bridge.rounding,
            display: formatCurrencyExact(bridge.rounding, 2),
            kind: 'step' as const,
            note: 'display only',
          },
        ]),
    {
      key: 'current',
      label: 'Current total',
      value: bridge.currentTotal,
      display: formatCurrencyExact(bridge.currentTotal),
      kind: 'anchor' as const,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <BridgeChart
        title="What changed against the month before"
        bars={bars}
        summary={bridge.statement}
      />
      <div className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-surface-sunken/50 p-4">
        <Text size="xs" tone={bridge.verified ? 'muted' : 'secondary'}>
          {bridge.verified
            ? 'Verified: the exported component numerators sum exactly to the comparison unit count multiplied by the period change, with no division on either side of the identity.'
            : 'The exported components did not reconcile to the period change. The figures above are shown as exported, and this state is a defect rather than a rounding artefact.'}
        </Text>
        {bridge.rounding === null ? null : (
          <Text size="xs" tone="faint">
            The rounding line is the residual left when each component is divided by the
            comparison unit count and rounded to the cent. It is shown rather than folded
            into a component, because adjusting one component to make a column add up
            would misstate that component.
          </Text>
        )}
        <Text size="xs" tone="faint">
          The bridge attributes change under a documented arithmetic order: volume priced
          at the comparison period rate, then each rate change valued at the current
          period volume. It is an attribution, not a cause. Nothing here identifies why
          volume or rate moved, and no person, department, inventory position or marketing
          spend is implicated by it.
        </Text>
      </div>
    </div>
  )
}

/** A labelled block with a heading, used by the page for each section body. */
export function SectionBody({ children }: { readonly children: ReactNode }) {
  return <div className="pt-6">{children}</div>
}
