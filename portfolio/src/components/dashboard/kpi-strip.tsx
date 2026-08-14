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
 * THE `EXEC.1` PRESENTATION PASS, AND WHY IT IS ONLY A PRESENTATION PASS
 * ---------------------------------------------------------------------
 * Measured before it, at 390 × 844: the rail occupied 1,183 px — one and a half phone
 * screens for eight numbers — and the first framed figure on the route was at 1,661 px.
 * Four things were doing it, and none of them was the data.
 *
 *   1. THE COMPARISON LINE BROKE INTO THREE. Fixed in `metric.tsx`, which records the
 *      measurement; a card's comparison is one sentence now and wraps like one.
 *   2. THE LEAD ROW WAS TWO-ACROSS ON A PHONE, so three cards rendered as a pair and an
 *      orphan — a half-empty row in the most valuable 200 px on the route. The lead rank
 *      is ONE across below `sm` and each card lays its figure and its shape out SIDE BY
 *      SIDE there, which uses the width a phone actually has instead of the height it
 *      does not.
 *   3. NOTHING HAD AN EDGE. Near-white cards sat on a pale teal module on a white page —
 *      three surfaces within about eight per cent of each other in luminance, so a card
 *      had no boundary to read. The card surface did not change; the MODULE did, and the
 *      workspace under it (`workspace-grid.tsx`). A near-white card with a hairline on a
 *      white panel over a recessed ground has an edge; the same card on a tinted panel
 *      does not.
 *   4. THE CARD HAD NO ANCHOR. A 12 px label above a 30 px figure and nothing else. Each
 *      lead card carries a zone-tinted icon chip now — decorative, `aria-hidden`, beside
 *      its own visible label, per the rule in `domain-icon.tsx`.
 *
 * NOT ONE FIGURE, DENOMINATOR, COMPARISON, SCOPE NOTE, CATALOGUE IDENTIFIER OR
 * DISCLOSURE MOVED. The eight cards are the same eight in the same order, from the same
 * `buildExecutiveOverview()` selectors, formatted by the same governed formatters. There
 * is no colour on a delta, because this console publishes no favourable direction for most
 * of these measures and `metric.tsx` records why at length.
 *
 * Server component.
 */
import {
  Banknote,
  Boxes,
  Car,
  Filter,
  Gauge,
  Percent,
  type LucideIcon,
} from 'lucide-react'

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

/**
 * A card's mark, keyed on the view model's own card id.
 *
 * KEYED ON THE ID, NOT ON THE POSITION, so a card that moves rank keeps its glyph and a
 * card the rail does not carry cannot silently borrow one. An id with no entry renders no
 * chip at all rather than a placeholder — the same rule `workspace-grid.tsx` states for a
 * module without an icon.
 *
 * Every one is `aria-hidden` and sits beside its own visible label, so it is decorative in
 * the strict accessibility sense: `domain-icon.tsx` records why that is the rule and not a
 * convenience. The glyphs name what the measure IS — a car for units delivered, a note for
 * money, a gauge for money per unit — never how the figure is doing.
 */
const CARD_ICON: Readonly<Record<string, LucideIcon>> = {
  retailUnits: Car,
  totalGross: Banknote,
  totalPvr: Gauge,
  frontPvr: Banknote,
  backPvr: Banknote,
  leadToSale: Filter,
  inventoryInvestment: Boxes,
  agedInventoryPercentage: Percent,
}

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
    <div className="flex flex-col gap-2.5">
      {comparisonUnavailable === null ? null : (
        <Text size="xs" tone="muted" className="max-w-prose">
          {comparisonUnavailable}
        </Text>
      )}

      {/*
        ONE ACROSS BELOW `sm`. Two-across put three cards into a pair and an orphan, and
        an orphan card beside an empty grid cell is the most expensive way a layout can
        say nothing. The card itself changes composition at the same breakpoint — see
        `KpiCard`.
      */}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
        {lead.map((card) => (
          <KpiCard
            key={card.id}
            card={card}
            rank="lead"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 sm:gap-2.5 xl:grid-cols-5">
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
 *
 * TWO COMPOSITIONS OF THE SAME CARD, AT ONE BREAKPOINT (`EXEC.1`)
 * --------------------------------------------------------------
 * Below `sm` the card is the full width of a phone and reads ACROSS — the shape beside the
 * figure, the comparison beside the figure — because a 326 px card has width to spare and
 * no height to spare. From `sm` up it is one of three ~300 px columns, which has exactly
 * the opposite problem, so the same elements stack and the shape runs the full width of the
 * card.
 *
 * TWO `sm:flex-col`s, NOT TWO RENDERINGS. Every element is in the document exactly once at
 * every width. Nothing is duplicated for assistive technology, nothing is hidden from it,
 * and there is no width at which a reader gets a different set of facts — which is what a
 * `hidden sm:block` pair of alternative markups would have cost.
 *
 * Measured: the stacked-on-a-phone composition put the label, the figure, a two-line
 * comparison, the shape and the metadata on five separate rows — 145 px per lead card, 435
 * px for the rank, and the rank is the first thing under the title.
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
  const Icon = CARD_ICON[card.id]

  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={card.id}
      data-kpi-rank={rank}
      className="flex min-w-0 flex-col gap-2 p-3 sm:gap-2.5 sm:p-3.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon === undefined ? null : (
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-wash text-accent"
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </span>
        )}
        <Heading
          level={3}
          size="h6"
          className="min-w-0 text-xs leading-snug font-medium text-ink-secondary"
        >
          {card.label}
        </Heading>
      </div>

      {/*
        ONE WRAPPING FLEX LINE ON A PHONE, ONE COLUMN FROM `sm`.

        Below `sm` the figure and the shape share the first line — the shape pushed to the
        right edge by `ml-auto` — and the comparison takes `w-full`, which is what makes it
        wrap onto a line of its own instead of being squeezed into whatever the figure left
        behind. That squeeze is not hypothetical: with the comparison beside a `$321,935`
        set at 29 px there were 32 px of column left for it, and it rendered as FIVE lines
        of two words. A 72 px comparison line under a 30 px figure is the failure this
        arrangement exists to prevent, not an aesthetic preference.

        `order` is used ONLY below `sm`, and the DOM order is the reading order at every
        width: figure, comparison, shape. From `sm` the container is a column and every
        `order` resets, so what is painted and what is announced are the same sequence.
      */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1 sm:flex-col sm:items-stretch sm:gap-2">
        <MetricValue
          selector={selector}
          result={current}
          size="lead"
          className="order-1 shrink-0 sm:order-none"
        />

        {resolved ? (
          <MetricDifference
            metric={card.metric}
            comparisonLabel={comparisonLabel}
            className="order-3 w-full sm:order-none sm:w-auto"
          />
        ) : (
          <MetricReason
            result={current}
            className="order-3 w-full sm:order-none sm:w-auto"
          />
        )}

        <ExecutiveMicroTrend
          measure={card.label}
          points={points}
          size="lead"
          axisLabels={false}
          className="order-2 ml-auto w-20 shrink-0 sm:order-none sm:ml-0 sm:w-auto"
        />
      </div>

      {/* The microtrend's axis, the identifier and the unit share one row. Three
          separate rows for six words is 36 px of the first viewport. */}
      <p className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 border-t border-line-subtle pt-1.5 text-2xs text-ink-faint">
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
      className="flex min-w-0 flex-col gap-0.5 p-2.5 sm:p-3"
    >
      <Heading
        level={3}
        size="h6"
        className="text-xs leading-snug font-medium text-ink-secondary"
      >
        {card.label}
      </Heading>
      <MetricValue selector={selector} result={current} size="sub" />
      {current.kind === 'value' ? (
        <MetricDifference
          metric={card.metric}
          comparisonLabel={comparisonLabel}
          size="compact"
        />
      ) : (
        <MetricReason result={current} />
      )}
      {card.kpiId === null ? null : (
        <p className="mt-auto pt-1.5 font-mono text-2xs tracking-wide text-ink-faint">
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
