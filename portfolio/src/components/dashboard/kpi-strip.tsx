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
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * No target, no pace, no forecast (`DASH.5` owns targets and there is no
 * `fact_sales_target` in the warehouse yet). No accounting reconciliation variance
 * (`DASH.9`). No sparkline: a trend line needs a shape a reader can check, and the
 * trend page that owns it is `DASH.3`. Their absence is correct; a placeholder card
 * for any of them would be the console claiming a capability it does not have.
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
  unitLabel,
  valueCarriesUnit,
} from './metric'

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
        <MetricValue
          selector={selector}
          result={current}
          size={rank === 'lead' ? 'lead' : 'cell'}
        />
        {resolved ? (
          <MetricDifference metric={card.metric} comparisonLabel={comparisonLabel} />
        ) : (
          <MetricReason result={current} />
        )}
      </div>

      {card.scopeNote === null ? null : (
        <Text size="xs" tone="faint">
          {card.scopeNote}
        </Text>
      )}

      <KpiMethodology selector={selector} definition={card.definition} />
    </Card>
  )
}
