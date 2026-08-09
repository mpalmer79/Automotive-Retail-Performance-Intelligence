/**
 * The primary KPI row.
 *
 * HIERARCHY, NOT A CARD WALL
 * --------------------------
 * Seven governed figures, in two ranks. Volume, gross and gross per retail unit are
 * the three a general manager reads first and they are set at display size; back
 * PVR, lead-to-sale conversion, median inventory age and aged inventory percentage
 * are the four that qualify them and are set smaller. Seven equal cards in a
 * four-across grid would say all seven matter equally, which is not what an
 * operating meeting is like.
 *
 * EVERY CARD NOW CARRIES ITS OWN SHAPE
 * ------------------------------------
 * The first version of this file recorded why it did not: "a trend line needs a shape a
 * reader can check, and the trend page that owns it is `DASH.3`". That page shipped, so
 * the condition is met and the microtrend arrives — six trailing months of the card's
 * OWN selector at the card's OWN scope, drawn as columns rather than a line for the
 * reason `TrendChart` gives, and never as a second formula.
 *
 * WHAT IS STILL DELIBERATELY ABSENT
 * ---------------------------------
 * No target, no pace, no forecast and no reconciliation variance ON A CARD. The plan and
 * the accounting position are both real facts now and both are on this page — as their
 * own sections, below the figures they qualify. A card is the business result; putting a
 * plan variance beside it in the same visual rank would invert what an operating report
 * is for, and `dashboard-executive.test.tsx` asserts the strip stays clean of all five.
 *
 * Server component.
 */
import { Card } from '@/components/ui/card-static'
import { Heading, Text } from '@/components/ui/typography'
import type { KpiCard as KpiCardModel } from '@/lib/dashboard/executive'
import { cx } from '@/lib/utils'

import {
  KpiMethodology,
  MetricDifference,
  MetricReason,
  MetricValue,
  formatMetric,
  stateLabel,
  unitLabel,
  valueCarriesUnit,
} from './metric'
import { ExecutiveMicroTrend, type MicroTrendPoint } from './visuals'

export function KpiStrip({
  cards,
  comparisonLabel,
  comparisonUnavailable,
}: {
  cards: readonly KpiCardModel[]
  comparisonLabel: string | null
  comparisonUnavailable: string | null
}) {
  const lead = cards.slice(0, 3)
  const supporting = cards.slice(3)
  return (
    <div className="flex flex-col gap-4">
      {comparisonUnavailable === null ? null : (
        <Text size="xs" tone="muted" className="max-w-prose">
          {comparisonUnavailable}
        </Text>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lead.map((card) => (
          <KpiCard
            key={card.id}
            card={card}
            rank="lead"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {supporting.map((card) => (
          <KpiCard
            key={card.id}
            card={card}
            rank="supporting"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>
    </div>
  )
}

function KpiCard({
  card,
  rank,
  comparisonLabel,
}: {
  card: KpiCardModel
  rank: 'lead' | 'supporting'
  comparisonLabel: string | null
}) {
  const { selector, current } = card.metric
  const resolved = current.kind === 'value'

  return (
    <Card
      as="li"
      padding={rank === 'lead' ? 'md' : 'sm'}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <Heading level={3} size="h6" className="text-ink-secondary">
          {card.label}
        </Heading>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {card.kpiId === null ? null : (
            <span className="font-mono text-2xs tracking-wide text-ink-faint">
              {card.kpiId}
            </span>
          )}
          {valueCarriesUnit(selector) ? null : (
            <span className="text-2xs text-ink-faint">{unitLabel(selector)}</span>
          )}
        </p>
      </div>

      <div className={cx('flex flex-col gap-1.5', rank === 'lead' ? 'py-1' : '')}>
        {/*
         * `supporting` is `sub` rather than `cell`: the first version set the four
         * qualifying cards at the same size and weight as their own comparison line,
         * which flattened the two ranks this component exists to establish.
         */}
        <MetricValue
          selector={selector}
          result={current}
          size={rank === 'lead' ? 'lead' : 'sub'}
        />
        {resolved ? (
          <MetricDifference metric={card.metric} comparisonLabel={comparisonLabel} />
        ) : (
          <MetricReason result={current} />
        )}
      </div>

      <ExecutiveMicroTrend
        measure={card.label}
        points={microTrendPoints(card)}
        size={rank}
      />

      {card.scopeNote === null ? null : (
        <Text size="xs" tone="faint">
          {card.scopeNote}
        </Text>
      )}

      <KpiMethodology selector={selector} definition={card.definition} />
    </Card>
  )
}

/**
 * A card's trailing samples, formatted for the strip.
 *
 * The value handed to the primitive stays exact and the display string is produced by
 * the card's own governed formatter, so a column and the figure above it can never be
 * formatted by two different rules. A month the selector declined carries `null` — which
 * the primitive renders as a gap — and its state label as the text a reader gets.
 */
function microTrendPoints(card: KpiCardModel): readonly MicroTrendPoint[] {
  return card.microTrend.map((point) => ({
    key: point.key,
    label: point.label,
    value: point.result.kind === 'value' ? point.result.value : null,
    display:
      formatMetric(card.metric.selector, point.result) ??
      stateLabel(point.result) ??
      'No value',
    isCurrent: point.isCurrent,
  }))
}
