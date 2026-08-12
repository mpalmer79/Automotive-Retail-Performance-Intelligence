/**
 * The executive KPI rail.
 *
 * A RAIL, NOT A CARD WALL
 * -----------------------
 * Eight governed figures in two ranks. Volume, gross and gross per retail unit are the
 * three a general manager reads first and are set at display size across the top; front
 * PVR, back PVR, lead-to-sale conversion, inventory investment and aged inventory
 * percentage qualify them and are set smaller, five across, underneath. Eight equal cards
 * in a four-across grid would say all eight matter equally, which is not what an operating
 * meeting is like. Which eight, and why these eight, is decided in `executive.ts` where
 * the selectors are.
 *
 * EVERY CARD CARRIES ITS OWN SHAPE — six trailing months of the card's OWN selector at the
 * card's OWN scope, drawn as columns rather than a line for the reason `TrendChart` gives,
 * and never as a second formula.
 *
 * ONE METHODOLOGY DISCLOSURE, NOT EIGHT
 * -------------------------------------
 * Every card used to carry its own `How is this calculated?`. Measured on the route before
 * `UX.2A`: twenty of those summary lines, seven of them in the first 400 vertical pixels.
 * The methodology was correctly available and was repeated until it read as furniture.
 *
 * It is now ONE disclosure at the foot of the rail, carrying every rail card's full
 * catalogue entry in card order — the same `KpiMethodology` content, the same fields, the
 * same links, nothing summarised and nothing dropped. `UX.2A` §17 asks for methodology on
 * demand; a reader who wants the denominator for back PVR opens one thing instead of
 * hunting for the card that owns it, and a reader who does not gets eight figures instead
 * of eight repetitions of a question.
 *
 * WHAT IS STILL DELIBERATELY ABSENT
 * ---------------------------------
 * No target, no pace, no forecast and no reconciliation variance ON A CARD. The plan and
 * the accounting position are both real facts and both are on this page — as their own
 * modules, beside the figures they qualify. A card is the business result; putting a plan
 * variance beside it in the same visual rank would invert what an operating report is for,
 * and `dashboard-executive.test.tsx` asserts the rail stays clean of all five.
 *
 * Server component.
 */
import { Card } from '@/components/ui/card-static'
import { Disclosure } from '@/components/ui/disclosure'
import { Heading, Text } from '@/components/ui/typography'
import type { KpiCard as KpiCardModel } from '@/lib/dashboard/executive'

import {
  KpiDefinitionList,
  MetricDifference,
  MetricReason,
  MetricValue,
  formatMetric,
  stateLabel,
  unitLabel,
  valueCarriesUnit,
} from './metric'
import {
  ExecutiveMicroTrend,
  microTrendAxisEnd,
  microTrendAxisStart,
  type MicroTrendPoint,
} from './visuals'

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
  const scopeNotes = [
    ...new Set(
      cards.map((card) => card.scopeNote).filter((note): note is string => note !== null)
    ),
  ]
  return (
    <div className="flex flex-col gap-2">
      {comparisonUnavailable === null ? null : (
        <Text size="xs" tone="muted" className="max-w-prose">
          {comparisonUnavailable}
        </Text>
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {lead.map((card) => (
          <KpiCard
            key={card.id}
            card={card}
            rank="lead"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {supporting.map((card) => (
          <SupportingCell key={card.id} card={card} comparisonLabel={comparisonLabel} />
        ))}
      </ul>

      {/*
        THE SCOPE NOTES, ONCE, RATHER THAN ONCE PER CARD.

        Two rail figures are read at an inventory snapshot rather than summed over the
        period, and a reader who does not know that can misread them by roughly a factor of
        thirty — KPI-INV-001 says so outright, so the note is not optional. What was
        optional is printing the SAME sentence on both cards, in a two-hundred-pixel column
        where it wrapped to three lines and made the qualifying row taller than the primary
        one above it. The distinct notes are collected and stated once, under the row they
        qualify, in the reading order a screen reader meets them in.
      */}
      {scopeNotes.length === 0 ? null : (
        <p className="text-2xs text-ink-faint">{scopeNotes.join(' · ')}</p>
      )}

      <Disclosure label="How every figure on this rail is measured" className="border-0">
        <KpiRailMethodology cards={cards} />
      </Disclosure>
    </div>
  )
}

/**
 * One of the three primary cards: the figure, its comparison, and its shape.
 *
 * THE IDENTIFIER AND THE UNIT SIT UNDER THE FIGURE, not above it. They were between the
 * card's name and its value, which put a `KPI-GRS-006` and a
 * `US dollars per retail unit` in the eye path of a reader looking for a number. Both are
 * still on the card, in text, found by a browser search and read in order by assistive
 * technology — after the figure, where a reader who wants to check the identifier goes
 * looking rather than passes through.
 */
function KpiCard({
  card,
  rank,
  comparisonLabel,
}: {
  card: KpiCardModel
  rank: 'lead'
  comparisonLabel: string | null
}) {
  const { selector, current } = card.metric
  const resolved = current.kind === 'value'
  const points = microTrendPoints(card)

  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={card.id}
      data-kpi-rank={rank}
      className="flex min-w-0 flex-col gap-1 p-3"
    >
      <Heading level={3} size="h6" className="text-xs leading-snug text-ink-secondary">
        {card.label}
      </Heading>

      <MetricValue selector={selector} result={current} size="lead" />

      {resolved ? (
        <MetricDifference metric={card.metric} comparisonLabel={comparisonLabel} />
      ) : (
        <MetricReason result={current} />
      )}

      <ExecutiveMicroTrend
        measure={card.label}
        points={points}
        size="lead"
        axisLabels={false}
      />

      {/* The microtrend's axis, the identifier and the unit share one row. Three
          separate rows for six words is 36 px of the first viewport. */}
      <p className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 pt-0.5 text-2xs text-ink-faint">
        <span aria-hidden="true">
          {microTrendAxisStart(points)} &ndash; {microTrendAxisEnd(points)}
        </span>
        <span className="flex items-baseline gap-x-2">
          {card.kpiId === null ? null : (
            <span className="font-mono tracking-wide">{card.kpiId}</span>
          )}
          {valueCarriesUnit(selector) ? null : <span>{unitLabel(selector)}</span>}
        </span>
      </p>
    </Card>
  )
}

/**
 * One of the five qualifying figures.
 *
 * NO MICROTREND HERE, AND THAT IS THE COMPACTION. `UX.2A` §6 makes the microtrend
 * optional on a card, and eight of them made the rail 651 px tall — which is most of a
 * viewport spent on the thing that is supposed to leave room for the charts. The three
 * measures a manager reads first keep their shape; the five that qualify them keep their
 * figure and their comparison, and their six-month shape is one click away on the surface
 * that owns each measure. Nothing about the VALUE changed, and no comparison was dropped.
 *
 * THE SCOPE NOTE STAYS. On the two inventory figures it names the snapshot date, which is
 * the difference between a position and a total, and a reader who does not have it can
 * misread the number by a factor of thirty.
 */
function SupportingCell({
  card,
  comparisonLabel,
}: {
  card: KpiCardModel
  comparisonLabel: string | null
}) {
  const { selector, current } = card.metric
  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={card.id}
      data-kpi-rank="supporting"
      className="flex min-w-0 flex-col gap-0.5 p-2.5"
    >
      <Heading level={3} size="h6" className="text-xs leading-snug text-ink-secondary">
        {card.label}
      </Heading>
      <MetricValue selector={selector} result={current} size="sub" />
      {current.kind === 'value' ? (
        <MetricDifference metric={card.metric} comparisonLabel={comparisonLabel} />
      ) : (
        <MetricReason result={current} />
      )}
      {card.kpiId === null ? null : (
        <p className="mt-auto pt-0.5 font-mono text-2xs tracking-wide text-ink-faint">
          {card.kpiId}
        </p>
      )}
    </Card>
  )
}

/**
 * Every rail card's catalogue entry, in card order, behind one summary.
 *
 * Rendered from the same `KpiEntry` and the same `Selector` each card's own disclosure
 * rendered, through the same component, so consolidating the SUMMARY LINES did not
 * consolidate the content: eight full entries are here, and a `<details>` keeps all of
 * them in the document, in the accessibility tree's reading order, in a browser text
 * search, in the printed page and with scripting off.
 */
function KpiRailMethodology({ cards }: { readonly cards: readonly KpiCardModel[] }) {
  return (
    <div className="flex flex-col gap-6">
      {cards.map((card) => (
        <div key={card.id} className="flex flex-col gap-2">
          <Heading level={4} size="h6" className="text-ink-secondary">
            {card.label}
          </Heading>
          <KpiDefinitionList
            selector={card.metric.selector}
            definition={card.definition}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * A card's trailing samples, formatted for the rail.
 *
 * The value handed to the primitive stays exact and the display string is produced by the
 * card's own governed formatter, so a column and the figure above it can never be
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
