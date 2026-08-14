/**
 * How a governed value becomes text.
 *
 * ONE PLACE, FIVE STATES
 * ----------------------
 * Every figure on the console renders through {@link MetricValue}, and every one of
 * the five {@link MetricResult} states renders as different words:
 *
 *   value           the figure, formatted for its unit
 *   not-applicable  "Not applicable" — the store cannot have this measure
 *   no-rows         "No matching records" — the filter selected nothing
 *   null-ratio      "No eligible denominator" — a governed NULL, not a zero
 *   not-derivable   "Not derivable at this scope" — an order statistic above its grain
 *
 * A dash for all five would be the easy thing and the dishonest one. `0` is a
 * measurement; the other four are not, and a reader has to be able to tell them
 * apart without opening anything.
 *
 * NO ARITHMETIC HAPPENS HERE. These components receive resolved exact values from
 * `selectors.ts` and format them. That is the whole reason `format.ts` takes an
 * `Exact` and not a `number`: by the time a figure reaches a component it has
 * already been summed and divided exactly, and formatting is the last step rather
 * than an intermediate one.
 *
 * Server components. No state, no interaction.
 */
import type { ReactNode } from 'react'

import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import { kpiDefinitionHref } from '@/lib/dashboard/executive'
import {
  formatCountDifference,
  formatCountExact,
  formatCurrencyDifference,
  formatCurrencyExact,
  formatDaysDifference,
  formatDaysExact,
  formatMinutesDifference,
  formatMinutesExact,
  formatPerUnitDifference,
  formatPerUnitExact,
  formatPointsDifference,
  formatRatioAsPercent,
  formatTurnsDifference,
  formatTurnsExact,
} from '@/lib/dashboard/format'
import type { ComparedMetric, MetricResult, Selector } from '@/lib/dashboard/selectors'
import type { KpiEntry } from '@/types/content'
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** The formatted absolute value for a selector's unit. */
export function formatMetric(selector: Selector, result: MetricResult): string | null {
  if (result.kind !== 'value') return null
  switch (selector.unit) {
    case 'count':
      return formatCountExact(result.value)
    case 'currency':
      return formatCurrencyExact(result.value)
    case 'currency-per-unit':
      return formatPerUnitExact(result.value)
    case 'ratio':
      return formatRatioAsPercent(result.value)
    case 'days':
      return formatDaysExact(result.value, selector.scale > 0 ? 1 : 0)
    case 'minutes':
      return formatMinutesExact(result.value)
    case 'turns':
      return formatTurnsExact(result.value)
  }
}

/**
 * The formatted difference, in the unit the difference is actually in.
 *
 * A ratio's difference is in PERCENTAGE POINTS, never in percent. Conversion moving
 * from 6.5% to 7.2% is +0.7 percentage points and +10.8 percent, and the two are
 * different claims; labelling the first as the second is the most common way a
 * comparison line misleads. `format.ts` has no function that renders a ratio
 * difference as a percentage, so the mistake is not available.
 */
export function formatDifference(metric: ComparedMetric): string | null {
  if (metric.difference === null) return null
  const { selector, difference } = metric
  switch (selector.unit) {
    case 'count':
      return formatCountDifference(difference, selector.countNoun ?? 'units')
    case 'currency':
      return formatCurrencyDifference(difference)
    case 'currency-per-unit':
      return formatPerUnitDifference(difference)
    case 'ratio':
      return formatPointsDifference(difference)
    case 'days':
      return formatDaysDifference(difference, selector.scale > 0 ? 1 : 0)
    case 'minutes':
      return formatMinutesDifference(difference)
    case 'turns':
      return formatTurnsDifference(difference)
  }
}

/**
 * Whether the formatted value already states its own unit.
 *
 * `$3,470` and `87.3 days` carry it; `92` and `4.40` do not. A label that repeats a
 * unit the value already spells produces "87.3 days days", which is how a table
 * ends up reading like a template rather than like a report.
 */
export function valueCarriesUnit(selector: Selector): boolean {
  return selector.unit !== 'count' && selector.unit !== 'turns'
}

/** The unit, in words, for the card's own label. */
export function unitLabel(selector: Selector): string {
  switch (selector.unit) {
    case 'count':
      return selector.countNoun ?? 'units'
    case 'currency':
      return 'US dollars'
    case 'currency-per-unit':
      return 'US dollars per retail unit'
    case 'ratio':
      return 'percentage'
    case 'days':
      return 'days'
    case 'minutes':
      return 'minutes'
    case 'turns':
      return 'turns per year'
  }
}

/* -------------------------------------------------------------------------- */
/* The unresolved states                                                       */
/* -------------------------------------------------------------------------- */

const STATE_LABEL: Record<Exclude<MetricResult['kind'], 'value'>, string> = {
  'not-applicable': 'Not applicable',
  'no-rows': 'No matching records',
  'null-ratio': 'No eligible denominator',
  'not-derivable': 'Not derivable at this scope',
}

/** The short label for a state that is not a value. */
export function stateLabel(result: MetricResult): string | null {
  return result.kind === 'value' ? null : STATE_LABEL[result.kind]
}

/* -------------------------------------------------------------------------- */
/* MetricValue                                                                 */
/* -------------------------------------------------------------------------- */

export interface MetricValueProps {
  selector: Selector
  result: MetricResult
  /**
   * `lead` for a primary KPI card, `sub` for a supporting one, `cell` inside a table,
   * `inline` in running text.
   *
   * `sub` exists because `cell` was doing two jobs. A supporting KPI card set at `cell`
   * rendered its value at the same size and weight as the comparison line beneath it,
   * which erased the rank the strip is arranged to express; a table cell genuinely wants
   * that weight, so the two needed different names rather than a compromise.
   */
  size?: 'lead' | 'sub' | 'cell' | 'inline'
  className?: string
}

/**
 * A figure, or the reason there is not one.
 *
 * `numeric` (globals.css) sets tabular figures, so a column of gross values aligns
 * digit for digit and a reader can compare magnitudes by their shape rather than by
 * reading every character.
 */
export function MetricValue({
  selector,
  result,
  size = 'cell',
  className,
}: MetricValueProps) {
  const formatted = formatMetric(selector, result)
  /*
   * `leading-none` ON THE TWO DISPLAY SIZES, AND IT IS A LAYOUT FIX WITH A MEASUREMENT
   * BEHIND IT. The display face carries a generous line box built for headings, so a
   * `text-3xl` figure occupied 68 px of vertical space to draw 30 px of digits. On a
   * documentation route that is correct typography; on a KPI rail it is 38 px of nothing,
   * eight times over, in the part of the page the first-viewport contract is fighting for.
   * A single-line figure has nothing to lead against.
   */
  const sizeClass =
    size === 'lead'
      ? 'font-display text-3xl leading-none font-semibold tracking-tight'
      : size === 'sub'
        ? 'font-display text-xl leading-none font-semibold tracking-tight'
        : size === 'cell'
          ? 'text-sm font-medium'
          : 'text-sm'

  if (formatted === null) {
    const label = stateLabel(result)
    return (
      <span
        className={cx(
          size === 'lead'
            ? 'text-xl font-semibold'
            : size === 'sub'
              ? 'text-base font-semibold'
              : 'text-sm font-medium',
          'text-ink-muted',
          className
        )}
      >
        {label}
      </span>
    )
  }

  return <span className={cx('numeric text-ink', sizeClass, className)}>{formatted}</span>
}

/* -------------------------------------------------------------------------- */
/* MetricDifference                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The comparison line.
 *
 * DELIBERATELY NEUTRAL. There is no green, no red, no arrow that means "good". A
 * lower median inventory age is usually desirable; a lower gross is not; a lower
 * response time is; a lower aged percentage can be a store quietly wholesaling its
 * mistakes. The console has no governed favourable/unfavourable direction for these
 * measures, so it states the direction — "higher", "lower", "unchanged" — and lets
 * the reader supply the judgement, which is the part they are actually paid for.
 *
 * `DASH.5` brings targets, and a target is what makes a direction assessable.
 */
export function MetricDifference({
  metric,
  comparisonLabel,
  size = 'default',
  className,
}: {
  metric: ComparedMetric
  /** "November 2025". Always named: "+12" against an unnamed period is not a fact. */
  comparisonLabel: string | null
  /**
   * `compact` for a card in a qualifying rank, where the line sits under a smaller figure.
   *
   * A PROP RATHER THAN A CLASS FROM THE CALL SITE, because `cx` is a join and not a
   * conflict resolver: passing `text-2xs` alongside this component's own `text-xs` leaves
   * both in the attribute and lets the stylesheet's ordering decide which one paints,
   * which is a coin toss that survives review.
   */
  size?: 'default' | 'compact'
  className?: string
}) {
  const formatted = formatDifference(metric)

  if (formatted === null) {
    const reason = metric.differenceUnavailable
    if (reason === null) return null
    return (
      <Text size="xs" tone="faint" className={className}>
        {reason}
      </Text>
    )
  }

  const direction =
    metric.difference?.units === 0n
      ? 'unchanged from'
      : (metric.difference?.units ?? 0n) > 0n
        ? 'higher than'
        : 'lower than'

  /*
   * ONE FLOWING LINE, NOT TWO FLEX CHILDREN — `EXEC.1`.
   *
   * This was `flex flex-wrap` with the amount and the direction phrase as two boxes, and
   * a flex container breaks between its children before it breaks inside one. In a 160 px
   * KPI card on a 390 px phone that rendered as three stacked lines — "+13 units", "higher
   * than", "November 2025" — which is 36 px of dead height on eight cards, and reads as
   * three facts rather than one sentence. Measured on the Executive rail before this pass:
   * the rail was 1,183 px tall on a phone, and this was the single largest contributor.
   *
   * Inline text wraps at word boundaries wherever the line actually runs out, so the same
   * sentence occupies one line where it fits and breaks sensibly where it does not. The
   * amount keeps `numeric` — tabular figures and no mid-number break — and the words are
   * the same words: `dashboard-executive.test.tsx` asserts the direction vocabulary and
   * `dashboard.spec.ts` asserts it again on the rendered page.
   */
  return (
    <p
      className={cx(
        'leading-snug text-ink-faint',
        size === 'compact' ? 'text-2xs' : 'text-xs',
        className
      )}
    >
      <span className="numeric font-semibold text-ink-secondary">{formatted}</span>{' '}
      {direction} {comparisonLabel ?? 'the comparison period'}
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* The reason a value is missing                                               */
/* -------------------------------------------------------------------------- */

/** The sentence behind a `not-applicable`, `no-rows`, `null-ratio` or `not-derivable`. */
export function MetricReason({
  result,
  className,
}: {
  result: MetricResult
  className?: string
}) {
  if (result.kind === 'value') return null
  return (
    <Text size="xs" tone="muted" className={className}>
      {result.reason}
      {result.kind === 'not-derivable'
        ? ` Filter to ${result.resolveBy} to read the exported value.`
        : ''}
    </Text>
  )
}

/* -------------------------------------------------------------------------- */
/* KpiMethodology                                                              */
/* -------------------------------------------------------------------------- */

/**
 * "How is this calculated?"
 *
 * Every field comes from `src/content/kpis.json`, the repository's machine-readable
 * extract of KPI_CATALOG.md — the same file `/kpis` renders and the same file the
 * project-manifest generator validates against the catalogue and the semantic model
 * on every build. There is no second KPI catalogue in the frontend, nothing is
 * copied by hand, and no Markdown is fetched at runtime.
 *
 * The last row is the console's own: which exported columns this page summed to get
 * the number above. That is the sentence a reviewer actually needs, and it is the
 * one a KPI catalogue cannot supply, because it is a property of the consumer.
 */
export function KpiMethodology({
  selector,
  definition,
  defaultOpen = false,
}: {
  selector: Selector
  definition: KpiEntry | undefined
  defaultOpen?: boolean
}) {
  return (
    <Disclosure label="How this is measured" defaultOpen={defaultOpen}>
      <KpiDefinitionList selector={selector} definition={definition} />
    </Disclosure>
  )
}

/**
 * The catalogue entry itself, with no disclosure around it.
 *
 * SPLIT OUT IN `UX.2A`, AND THE SPLIT IS THE WHOLE POINT. The Executive KPI rail collapsed
 * eight `How is this calculated?` summary lines into one, which is a change to how many
 * times the QUESTION is asked and not to how much of the ANSWER is available: the rail's
 * single disclosure renders this component eight times, with every field, every link and
 * every caution intact. A surface that shows one figure — a response card, a scoreboard
 * cell — still renders `KpiMethodology` and gets its own summary, because there is nothing
 * to consolidate it with.
 */
export function KpiDefinitionList({
  selector,
  definition,
}: {
  selector: Selector
  definition: KpiEntry | undefined
}) {
  if (definition === undefined) {
    return (
      <Text size="sm" tone="muted">
        This figure is an exported column rather than a governed KPI.{' '}
        {selector.derivation}
      </Text>
    )
  }

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(9rem,auto)_1fr]">
      <Row term="Governed KPI">
        <a
          href={kpiDefinitionHref(definition.id)}
          className="font-mono text-xs underline decoration-dotted underline-offset-4 hover:text-accent"
        >
          {definition.id}
        </a>{' '}
        <span className="text-ink-muted">{definition.name}</span>
      </Row>
      <Row term="Plain English">{definition.purpose}</Row>
      <Row term="Inclusions and exclusions">{definition.definition}</Row>
      <Row term="Formula">
        <code className="font-mono text-xs">{definition.formula}</code>
      </Row>
      <Row term="Numerator">{definition.numerator}</Row>
      <Row term="Denominator">{definition.denominator}</Row>
      <Row term="Grain">{definition.grain}</Row>
      <Row term="Date basis">{definition.dateBasis}</Row>
      <Row term="Unit">{definition.unit}</Row>
      <Row term="Null behaviour">{definition.nullBehaviour}</Row>
      <Row term="Source reporting view">
        <code className="font-mono text-xs">{definition.sourceView}</code>
      </Row>
      <Row term="Known limitations">{definition.caution}</Row>
      <Row term="What this page selected">{selector.derivation}</Row>
    </dl>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
        {term}
      </dt>
      <dd className="text-sm leading-normal text-ink-secondary">{children}</dd>
    </>
  )
}
