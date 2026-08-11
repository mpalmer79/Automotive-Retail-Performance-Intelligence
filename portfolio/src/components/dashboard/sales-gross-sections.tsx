/**
 * The Sales and Gross page's remaining sections: the metric tile, the deal-gross
 * distribution and the change bridge.
 *
 * WHAT LEFT THIS FILE AT `UX.2B`. It held four more section components — the four-chart
 * trend, the three mix tables, the front/back contribution block and a layout wrapper — and
 * each of them was a full-width band in a document. The workspace grid replaced the bands:
 * the trend is one large chart with a measure switch in `sales-workspace.tsx`, the two mixes
 * that answer a question are grouped comparisons there, the third is a disclosure on the
 * page, and front against back is the shared `GrossComposition` primitive. Nothing was
 * deleted without a replacement that shows the same governed figures.
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
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type {
  BridgeState,
  ComparedFigure,
  Figure,
  GrossDistribution,
  PerformanceMetric,
} from '@/lib/dashboard/sales-gross'
import { kpiDefinition, kpiDefinitionHref } from '@/lib/dashboard/sales-gross'
import { formatCurrencyExact } from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import { BridgeChart, DistributionStrip } from './visuals'

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

/**
 * A grid of metric tiles.
 *
 * `UX.2B` narrowed what this renders rather than how it renders it. It carried the route's
 * nine governed performance figures as nine equal tiles in a three-across grid; the rail in
 * `sales-workspace.tsx` now ranks those, and what is left here is the three per-unit discount
 * figures, which have no catalogue identifier, no rank between them and one module to sit in.
 * `columns="single"` is that module: three tiles in a narrow column rather than a grid that
 * would leave two thirds of it empty.
 */
export function PerformanceGrid({
  metrics,
  comparisonLabel,
  columns = 'auto',
}: {
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
  readonly columns?: 'auto' | 'single'
}) {
  return (
    <div
      className={cx(
        'grid gap-2',
        columns === 'single' ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3'
      )}
    >
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} comparisonLabel={comparisonLabel} />
      ))}
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
