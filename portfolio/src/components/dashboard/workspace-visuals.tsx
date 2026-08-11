/**
 * The primitives the `UX.2` operating workspaces share.
 *
 * WHY A THIRD VISUAL MODULE, AND WHERE THE LINE IS
 * ------------------------------------------------
 * `visuals.tsx` is the console-wide set that predates `UX.2`: eight primitives, most of
 * them rendered by three or more routes, and its own header records that it is close to
 * the size at which a module stops being readable. `exec-visuals.tsx` is the Executive
 * Command Center's own set, and its header states the rule this file obeys: *if a second
 * route ever renders one of these, it moves*.
 *
 * `MetricSwitch` moved, because `UX.2B` renders it on three more routes. It arrived with
 * `UX.2A` as a command-center control and is now the console's presentation switch, so it
 * lives with the things more than one workspace draws. `FunnelChart` and
 * `StoreMeasureBars` did not move: the funnel is still one route's, and `StoreMeasureBars`
 * takes a whole `MetricResult` because the Executive's structural-absence rule needs it —
 * the revenue routes carry `Figure`, a different resolved shape, and adapting one to the
 * other would put a translation layer between a governed value and its bar.
 *
 * WHAT IS HERE
 * ------------
 *   `MetricSwitch`        a presentation switch: radio group and CSS, no JavaScript
 *   `GroupedMeasureBars`  several measures across the same categories, each own-scaled
 *   `PositionMap`         two unit-grain measures against each other, with a third as area
 *
 * MEASURED COST OF ALL THREE: zero bytes of client JavaScript. They are server components
 * and the only interactive control among them is a radio group with no script behind it.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY — the rule `visuals.tsx` states
 * at length holds here without exception. `exactToApproxNumber` produces a width, a height
 * or a coordinate and never a displayed figure; every number a reader sees was formatted
 * by a governed formatter before it reached this file.
 */
import type { ReactNode } from 'react'

import type { Exact } from '@/lib/dashboard/decimal'
import { exactToApproxNumber } from '@/lib/dashboard/decimal'
import { cx } from '@/lib/utils'

import { ChartFrame, TableDisclosure } from './visuals'

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1000) / 10)}%`
}

/* -------------------------------------------------------------------------- */
/* MetricSwitch                                                                */
/* -------------------------------------------------------------------------- */

/** One selectable presentation of the same region. */
export interface MetricSwitchOption {
  readonly id: string
  /** The control's label, and the accessible name of the panel it reveals. */
  readonly label: string
  readonly panel: ReactNode
}

/**
 * A presentation switch built from a radio group and CSS, with no JavaScript at all.
 *
 * WHAT IT SWITCHES, AND WHAT IT EMPHATICALLY DOES NOT
 * ---------------------------------------------------
 * Every panel is rendered on the server, in full, from the same governed selectors the
 * figures beside it use. The control changes WHICH ONE IS DISPLAYED and nothing else: no
 * value is recomputed, no denominator is re-chosen, no series is re-derived, and no data
 * crosses into the browser that was not already in the document. `UX.2A` §18 permits a
 * metric switch and forbids client-side recalculation; this cannot recalculate, because
 * there is no code here to do it with.
 *
 * WHY NO URL STATE, STATED RATHER THAN ASSUMED
 * --------------------------------------------
 * `INFORMATION_ARCHITECTURE.md` §6 defines one filter grammar shared by every operating
 * route, and every parameter in it changes WHICH ROWS a figure is computed from. This
 * changes neither the population nor the arithmetic — every answer is on screen
 * simultaneously in the served HTML, and the switch only chooses which one the eye is
 * pointed at. A parameter that survived a navigation to a route where it means nothing
 * would be a presentation preference wearing the clothes of a console-wide filter. The
 * panels are equally shareable today: a reader sending a link sends all of them.
 *
 * ACCESSIBILITY. A `<fieldset>` with a `<legend>` is the group; the options are real
 * radios, so arrow keys move and select, `Tab` enters and leaves the group once, and the
 * selected state is announced by the platform rather than by an ARIA attribute this file
 * would have to keep true. The inputs are `sr-only` and the focus ring is drawn on the
 * label through `peer-focus-visible`, so the ring is where the eye is. The selected option
 * is marked by border, weight AND ground — never by hue alone. An unselected panel is
 * `display: none`, which removes it from the accessibility tree, so a screen-reader user
 * reads one chart rather than three.
 *
 * WITH SCRIPTING OFF the control works, because nothing here was ever script.
 *
 * REDUCED MOTION: nothing animates.
 *
 * THREE SLOTS, WRITTEN OUT. Tailwind resolves class names by scanning source text, so a
 * peer name built by template literal emits no CSS at all. Two or three options are
 * supported; a fourth would be three more literals, and pretending otherwise with a loop
 * would produce a control that silently did nothing.
 */
export function MetricSwitch({
  name,
  legend,
  options,
  className,
}: {
  /** The radio group's form name. Unique per switch on the page. */
  readonly name: string
  /** The group's accessible name, e.g. "Trend measure". */
  readonly legend: string
  /** Exactly two or three. The first is selected. */
  readonly options: readonly MetricSwitchOption[]
  readonly className?: string
}) {
  const [first, second, third] = options
  if (first === undefined || second === undefined) return null

  const CONTROL = cx(
    'inline-flex min-h-touch cursor-pointer items-center rounded-pill border px-3 py-1',
    'border-line bg-surface text-sm text-ink-muted',
    'transition-colors duration-(--arpi-motion-fast) hover:border-line-strong'
  )

  return (
    <fieldset className={cx('flex flex-wrap items-center gap-2', className)}>
      <legend className="sr-only">{legend}</legend>

      {/* The inputs come first so every label and every panel is a FOLLOWING sibling,
          which is what the general-sibling combinator behind `peer-*` requires. */}
      <input
        type="radio"
        id={`${name}-${first.id}`}
        name={name}
        defaultChecked
        className="peer/a sr-only"
      />
      <input
        type="radio"
        id={`${name}-${second.id}`}
        name={name}
        className="peer/b sr-only"
      />
      {third === undefined ? null : (
        <input
          type="radio"
          id={`${name}-${third.id}`}
          name={name}
          className="peer/c sr-only"
        />
      )}

      <label
        htmlFor={`${name}-${first.id}`}
        className={cx(
          CONTROL,
          'peer-checked/a:border-accent-muted peer-checked/a:bg-accent-wash peer-checked/a:font-semibold peer-checked/a:text-accent',
          'peer-focus-visible/a:outline-2 peer-focus-visible/a:outline-offset-2 peer-focus-visible/a:outline-accent'
        )}
      >
        {first.label}
      </label>
      <label
        htmlFor={`${name}-${second.id}`}
        className={cx(
          CONTROL,
          'peer-checked/b:border-accent-muted peer-checked/b:bg-accent-wash peer-checked/b:font-semibold peer-checked/b:text-accent',
          'peer-focus-visible/b:outline-2 peer-focus-visible/b:outline-offset-2 peer-focus-visible/b:outline-accent'
        )}
      >
        {second.label}
      </label>
      {third === undefined ? null : (
        <label
          htmlFor={`${name}-${third.id}`}
          className={cx(
            CONTROL,
            'peer-checked/c:border-accent-muted peer-checked/c:bg-accent-wash peer-checked/c:font-semibold peer-checked/c:text-accent',
            'peer-focus-visible/c:outline-2 peer-focus-visible/c:outline-offset-2 peer-focus-visible/c:outline-accent'
          )}
        >
          {third.label}
        </label>
      )}

      <div className="hidden w-full peer-checked/a:block">{first.panel}</div>
      <div className="hidden w-full peer-checked/b:block">{second.panel}</div>
      {third === undefined ? null : (
        <div className="hidden w-full peer-checked/c:block">{third.panel}</div>
      )}
    </fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* GroupedMeasureBars                                                          */
/* -------------------------------------------------------------------------- */

/** One category's value for one measure. */
export interface MeasureBarRow {
  /** Stable across groups. It, and never the row position, chooses the mark colour. */
  readonly key: string
  readonly label: string
  /**
   * The value the bar is drawn from, or `null` for a state that is not a value.
   *
   * `null` DRAWS NOTHING. A rate with no eligible denominator, a category with no eligible
   * deals and a store that cannot have the measure at all are three different facts and
   * none of them is zero; a zero-length bar would present all three as "earned nothing",
   * which is the defect the resolved-figure vocabulary exists to prevent. The caller
   * passes the words on `display` and this file draws no track.
   */
  readonly value: Exact | null
  /** The value as the reader should see it, already formatted, or the state's words. */
  readonly display: string
  /** An optional second figure printed after the first, e.g. a count behind a rate. */
  readonly note?: string
}

/** One measure, across every category in scope. */
export interface MeasureBarGroup {
  readonly id: string
  readonly label: string
  readonly kpiId?: string | null
  readonly rows: readonly MeasureBarRow[]
}

/** The categorical marks, written out in full so Tailwind's source scan can see them. */
const CATEGORY_MARKS = [
  'bg-data-primary',
  'bg-data-secondary',
  'bg-data-tertiary',
  'bg-data-age-early',
  'bg-data-age-threshold',
  'bg-data-neutral',
] as const

const CATEGORY_MARK_FALLBACK = 'bg-data-neutral'

/**
 * A category's mark colour, derived from its POSITION IN THE CALLER'S ORDER.
 *
 * Correct here and wrong for a store, and the difference is worth stating. A store's
 * colour is derived from its business code, because a store filtered out of scope would
 * otherwise shift the colour of every store after it and a reader who learned that the
 * pre-owned centre is the violet one would be reading a different store one filter change
 * later. A product category or a deal structure has no such identity across pages: the
 * caller passes a governed, stable order (`FI_CATEGORY_ORDER`, `FI_STRUCTURES`), the same
 * order is used for the legend, and the colour is legible only against that legend.
 *
 * ORDER CARRIES NO MEANING. The palette steps are identities, not a ranking, and nothing
 * in this file colours a category "best".
 */
export function categoryMarkClass(index: number): string {
  return CATEGORY_MARKS[index] ?? CATEGORY_MARK_FALLBACK
}

/**
 * How many categories can be told apart by mark alone.
 *
 * Beyond this the palette repeats, so a legend keyed on colour would name two categories
 * with one swatch. The component draws no legend past this count and relies on the row
 * labels, which are always drawn.
 */
const DISTINCT_MARKS = CATEGORY_MARKS.length

/**
 * Several governed measures across the same categories, as one grouped comparison.
 *
 * WHY GROUPED AND NOT ONE CHART PER MEASURE. The question is rarely "how do the categories
 * compare on gross" — it is "which category is different, and on what". Charts stacked
 * vertically make the reader carry the category identity from one to the next by name; one
 * grouped comparison with a stable mark per category answers it in one eye movement.
 *
 * EACH MEASURE IS SCALED TO ITS OWN MAXIMUM, AND HAS TO BE. Counts, dollars, dollars per
 * unit and percentages share no axis; a common scale would draw a penetration rate as a
 * hairline beside a gross total. The measure's own maximum is therefore the reference
 * within its group, the group label names the measure, and every value is printed. No
 * cross-group length comparison is available, and none is implied — the caption says so.
 *
 * NOTHING IS RANKED. Rows are in the caller's governed order, no mark means "best", and no
 * composite is formed across the measures.
 *
 * A NEGATIVE VALUE DRAWS FROM ZERO AND IS MARKED. A category can carry a negative net gross
 * once adjustments post, and that is a real outcome rather than a defect. The track runs
 * left from the zero rule and takes the signed fill, because a bar that ignored the sign
 * would draw a loss as a gain of the same size.
 */
export function GroupedMeasureBars({
  title,
  caption,
  groups,
  legend = true,
  categoryHeading = 'Category',
  mark = (_key, index) => categoryMarkClass(index),
  footnote,
  headingLevel = 3,
  className,
}: {
  readonly title: string
  readonly caption?: ReactNode
  readonly groups: readonly MeasureBarGroup[]
  /** Drawn when the marks carry identity across groups. Off for a single group. */
  readonly legend?: boolean
  /** The table's first column heading, e.g. "Product category". */
  readonly categoryHeading?: string
  /**
   * The fill class for a row, chosen by the CALLER.
   *
   * A store's colour comes from its business code and must not move when a filter removes
   * a store above it; a product category's comes from its position in a governed order that
   * does not change. Both are identity and neither is rank, but they are derived from
   * different things, so the derivation belongs to whoever knows which kind of key this is.
   */
  readonly mark?: (key: string, index: number) => string
  readonly footnote?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}) {
  const categories = groups[0]?.rows ?? []

  const summary =
    groups.length === 0 || categories.length === 0
      ? `No category in scope resolves ${title.toLowerCase()}.`
      : groups
          .map(
            (group) =>
              `${group.label}: ${group.rows
                .map((row) => `${row.label} ${row.display}`)
                .join(', ')}`
          )
          .join('. ') + '.'

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      {/*
        THE LEGEND IS OPTIONAL AND THE ROW LABELS ARE NOT.

        The first version of this identified each row by its mark colour and put the names in
        a legend above. That works for three stores and fails for ten product categories: the
        palette carries six distinct marks, so categories seven through ten shared a fill,
        and a reader looking at the seventh bar had no way at all to learn which category it
        was. Colour is now supporting identity across the groups of one chart, and the name
        beside every bar is the identification — which is also the rule the rest of this
        console follows, and the reason `StoreComparisonBars` prints its store names.
      */}
      {legend && categories.length > 1 && categories.length <= DISTINCT_MARKS ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {categories.map((row, index) => (
            <li
              key={row.key}
              className="flex items-baseline gap-1.5 text-xs text-ink-secondary"
            >
              <span
                aria-hidden="true"
                className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${mark(row.key, index)}`}
              />
              {row.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          /*
           * The scale is the largest ABSOLUTE value in the group, so a negative row and a
           * positive row of the same size draw the same length in opposite directions.
           */
          const largest = group.rows.reduce(
            (max, row) =>
              row.value === null
                ? max
                : Math.max(max, Math.abs(exactToApproxNumber(row.value))),
            0
          )
          const anyNegative = group.rows.some(
            (row) => row.value !== null && exactToApproxNumber(row.value) < 0
          )
          return (
            <div key={group.id} className="flex flex-col gap-1.5">
              <p className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-ink-secondary">
                  {group.label}
                </span>
                {group.kpiId == null ? null : (
                  <span className="font-mono text-2xs tracking-wide text-ink-faint">
                    {group.kpiId}
                  </span>
                )}
              </p>
              <ul className="flex flex-col gap-1">
                {group.rows.map((row, index) => {
                  const resolved = row.value !== null
                  const numeric = resolved ? exactToApproxNumber(row.value) : 0
                  const negative = numeric < 0
                  const width = largest > 0 ? Math.abs(numeric) / largest : 0
                  return (
                    <li
                      key={row.key}
                      className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)_auto] items-center gap-x-2.5"
                    >
                      <span className="truncate text-2xs text-ink-secondary">
                        {row.label}
                      </span>
                      {resolved ? (
                        <span
                          aria-hidden="true"
                          className={cx(
                            'flex h-3 w-full overflow-hidden rounded-pill bg-surface-sunken',
                            /* A group with a negative row splits at the middle so the zero
                               rule is a real position rather than an implied one. */
                            anyNegative ? 'justify-center' : 'justify-start'
                          )}
                        >
                          {/* Zero stays zero: a minimum-width bar for a category that
                              earned nothing would draw a quantity the data does not
                              have. */}
                          <span
                            className={cx(
                              'block h-full',
                              negative
                                ? 'rounded-l-pill bg-data-negative'
                                : `rounded-r-pill ${mark(row.key, index)}`
                            )}
                            style={{
                              width: percent(anyNegative ? width / 2 : width),
                              marginLeft: negative
                                ? percent((1 - width) / 2)
                                : undefined,
                              marginRight: negative ? 'auto' : undefined,
                            }}
                          />
                        </span>
                      ) : (
                        /* A row with no value draws no track at all and leaves the bar
                           column empty. A zero-length bar would present "no eligible
                           denominator" as "earned nothing", which are different facts. */
                        <span />
                      )}
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span
                          className={cx(
                            'text-xs',
                            resolved
                              ? 'numeric font-semibold text-ink'
                              : 'font-medium text-ink-muted'
                          )}
                        >
                          {row.display}
                        </span>
                        {row.note === undefined ? null : (
                          <span className="text-2xs text-ink-faint">{row.note}</span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {footnote === undefined ? null : (
        <p className="text-2xs leading-normal text-ink-faint">{footnote}</p>
      )}

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                {categoryHeading}
              </th>
              {groups.map((group) => (
                <th
                  key={group.id}
                  scope="col"
                  className="py-2 pl-3 text-right font-medium text-ink-muted"
                >
                  {group.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category.key} className="border-b border-line-subtle/60 last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {category.label}
                </th>
                {groups.map((group) => (
                  <td key={group.id} className="numeric py-1.5 pl-3 text-right text-ink">
                    {group.rows[index]?.display ?? 'No value'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* PositionMap                                                                 */
/* -------------------------------------------------------------------------- */

/** One plotted observation. */
export interface PositionPoint {
  readonly key: string
  /** The business identifier a reader recognises, e.g. a unit code. Never a VIN. */
  readonly label: string
  /** A second line of identity, e.g. `2023 Chevrolet Tahoe LT`. */
  readonly sublabel: string
  /** Horizontal position, in the caller's own units. */
  readonly x: Exact
  /** The horizontal value as the reader should see it, already formatted. */
  readonly xDisplay: string
  /** Vertical position, in the caller's own units. */
  readonly y: Exact
  readonly yDisplay: string
  /** Area, in the caller's own units. Larger draws a larger mark. */
  readonly area: Exact | null
  /** The area value as the reader should see it, or the words for its absence. */
  readonly areaDisplay: string
  /** The whole observation as one sentence of exact, formatted figures. */
  readonly description: string
  /** Where selecting this observation goes. */
  readonly href: string
  /** The ordered band the mark's fill is taken from, e.g. the age ramp step. */
  readonly rampStep: number
  /** True for the observation the page's own selection resolves to. */
  readonly isSelected?: boolean
}

/** One labelled division of an axis, printed under or beside the plot. */
export interface PositionAxis {
  /** Neutral, and never a judgement. "Price to market", not "Overpriced". */
  readonly label: string
  /**
   * The tick labels, low to high, already formatted.
   *
   * THE EXTREMES ONLY, AND THE CALLER IS RESPONSIBLE FOR THAT. The ticks are laid out with
   * `justify-between`, so the first sits at the axis floor, the last at its ceiling and
   * ANY INTERIOR TICK IS DRAWN AT AN EVENLY-SPACED POSITION whether or not its value falls
   * there. The first version of this passed the population's median as a middle tick and the
   * plot printed it at the exact centre of a range it did not sit at — a chart lying about
   * its own scale, which is the one defect a reader cannot detect by looking. Two ticks
   * claim nothing that is not true; a caller that wants interior ticks must compute them
   * from the range rather than from the distribution.
   */
  readonly ticks: readonly string[]
  /** The sentence stating what the axis is and what it is not. */
  readonly note?: string
}

const RAMP = [
  'bg-data-age-fresh',
  'bg-data-age-early',
  'bg-data-age-threshold',
  'bg-data-age-aged',
  'bg-data-age-critical',
] as const

const RAMP_LAST = 'bg-data-age-critical'

function rampClass(step: number): string {
  return RAMP[step] ?? RAMP_LAST
}

/**
 * Two unit-grain measures plotted against each other, with a third as mark area.
 *
 * WHY THIS SHAPE EXISTS AT ALL. A used-vehicle manager's question is not "how many units
 * are over ninety days" — the age table already answers that — it is "which of the units
 * that have sat longest are also priced furthest from the reference, and how much capital
 * is in them". That is three measures on one observation, and a position is the only form
 * that carries three at once. Every input is a column of `inventory-units` at unit grain:
 * nothing is estimated, nothing is bucketed to make the picture work, and no fourth
 * measure is derived to rank the points.
 *
 * WHAT IT DOES NOT SAY, AND THIS IS THE LOAD-BEARING PARAGRAPH. Nothing on this plot is
 * labelled overpriced, underpriced, an opportunity or a candidate for anything. The
 * horizontal axis is a ratio against a SYNTHETIC reference the caller's note names as
 * synthetic; a unit at 1.05 is advertised five per cent above that reference and that is
 * the whole of the claim. There is no score, no quadrant name, no recommended action and
 * no ordering of the points by desirability. The console publishes no repricing advice and
 * this component contains no vocabulary with which to give any.
 *
 * COLOUR IS THE AGE RAMP AND NOTHING ELSE. It repeats the vertical position, which is
 * deliberate: a mark's meaning is then legible without reading the axis, and no reader has
 * to distinguish two encodings. The ramp is ordered risk, not good and bad, and the
 * threshold it turns amber at is an ARPI project default that the caller's legend states.
 *
 * ACCESSIBILITY, AND WHY HOVER IS NOT A REQUIREMENT
 * -------------------------------------------------
 * Every mark is a real `<a>` inside a labelled list, so the whole population is reachable
 * by `Tab`, each mark takes a visible focus ring, and its accessible name is the caller's
 * exact `description` — the same figures a mouse user would get, available with no pointer
 * at all. A skip link precedes the list, because a lot of stock is a lot of tab stops and a
 * keyboard reader who does not want them should not have to pay for them. The plot area
 * itself is `aria-hidden` decoration; the list inside it is the content.
 *
 * The table disclosure below carries every observation again, with its exact figures in
 * columns and the same drill-through on the identifier. A reader who cannot use the
 * geometry loses nothing but the geometry.
 *
 * REDUCED MOTION: nothing animates.
 */
export function PositionMap({
  title,
  caption,
  points,
  xAxis,
  yAxis,
  areaLabel,
  legend,
  skipTargetId,
  emptyNote,
  externalTable,
  headingLevel = 3,
  className,
}: {
  readonly title: string
  readonly caption?: ReactNode
  readonly points: readonly PositionPoint[]
  readonly xAxis: PositionAxis
  readonly yAxis: PositionAxis
  /** What the mark's area encodes, named in the legend. */
  readonly areaLabel: string
  /** The ordered bands the ramp encodes, low to high, for the legend. */
  readonly legend: readonly string[]
  /** The id the skip link jumps to: whatever follows the plot. */
  readonly skipTargetId: string
  /** Rendered instead of the plot when nothing can be positioned. */
  readonly emptyNote: string
  /**
   * A pointer to an equivalent table ELSEWHERE ON THE PAGE, in place of the plot's own.
   *
   * WHY THIS EXISTS, MEASURED. Every chart on this console carries its own data table,
   * because a chart whose values are only in geometry is a chart a screen reader cannot
   * read. On `/dashboard/inventory` that rule produced the table TWICE: once inside this
   * plot and once as the route's unit table directly below it, both with a row per unit
   * over roughly 250 units. Measured cost of the duplicate: **+98 kB of route transfer**,
   * for a second copy of a table the reader already has.
   *
   * The accessible contract is unchanged and is worth stating precisely, because this is
   * the kind of option that quietly removes an alternative. Every mark is still a focusable
   * `<a>` whose accessible name is that unit's exact figures, so the per-point information
   * is still reachable without a pointer and without any table at all. This only replaces
   * the SECOND rendering of the same rows with a link to the first, which is on the same
   * page, in the same document, and reachable by the same keyboard.
   *
   * Omit it and the plot renders its own table, which is the right default anywhere the
   * caller does not already publish one.
   */
  readonly externalTable?: { readonly href: string; readonly label: string }
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}) {
  const xs = points.map((point) => exactToApproxNumber(point.x))
  const ys = points.map((point) => exactToApproxNumber(point.y))
  const areas = points
    .map((point) => (point.area === null ? null : exactToApproxNumber(point.area)))
    .filter((value): value is number => value !== null)

  /*
   * THE EXTENTS ARE THE DATA'S OWN, NOT A ROUND NUMBER NEARBY. A padded axis would put
   * whitespace where a reader expects a boundary, and this plot has no gridlines to
   * anchor an invented one against. The `|| 1` guards a population whose values are all
   * identical, where the span is zero and every point would divide by it.
   */
  const xMin = xs.length > 0 ? Math.min(...xs) : 0
  const xMax = xs.length > 0 ? Math.max(...xs) : 1
  const yMin = ys.length > 0 ? Math.min(...ys) : 0
  const yMax = ys.length > 0 ? Math.max(...ys) : 1
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1
  const areaMax = areas.length > 0 ? Math.max(...areas) : 0

  const summary =
    points.length === 0
      ? emptyNote
      : `${String(points.length)} unit${points.length === 1 ? '' : 's'} positioned by ` +
        `${xAxis.label.toLowerCase()} horizontally and ${yAxis.label.toLowerCase()} vertically, ` +
        `with mark area showing ${areaLabel.toLowerCase()}. ` +
        `${xAxis.label} runs ${xAxis.ticks[0] ?? ''} to ${xAxis.ticks[xAxis.ticks.length - 1] ?? ''}; ` +
        `${yAxis.label} runs ${yAxis.ticks[0] ?? ''} to ${yAxis.ticks[yAxis.ticks.length - 1] ?? ''}. ` +
        'Every unit is listed with its exact figures in the table below.'

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      {points.length === 0 ? (
        <p className="text-sm leading-normal text-ink-muted">{emptyNote}</p>
      ) : (
        <>
          <a
            href={`#${skipTargetId}`}
            className="sr-only rounded-md border border-accent-muted bg-surface px-3 py-1 text-xs font-medium text-accent focus-visible:not-sr-only focus-visible:inline-flex focus-visible:min-h-touch focus-visible:items-center"
          >
            {`Skip the ${String(points.length)} unit markers`}
          </a>

          <div className="flex gap-2">
            {/* The vertical axis label, rotated, so the plot keeps its width on a phone. */}
            <p
              aria-hidden="true"
              className="flex shrink-0 items-center justify-center text-2xs text-ink-muted [writing-mode:vertical-rl] [transform:rotate(180deg)]"
            >
              {yAxis.label}
            </p>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex gap-1.5">
                {/* The vertical ticks, highest at the top, as text beside the plot. */}
                <ul
                  aria-hidden="true"
                  className="flex shrink-0 flex-col-reverse justify-between text-2xs text-ink-faint"
                >
                  {yAxis.ticks.map((tick) => (
                    <li key={tick}>{tick}</li>
                  ))}
                </ul>

                <div className="relative aspect-[4/3] min-w-0 flex-1 rounded-lg border border-line-subtle bg-surface-sunken/40">
                  <ul
                    aria-label={`${title}. ${String(points.length)} units.`}
                    className="absolute inset-0"
                  >
                    {points.map((point) => {
                      const x = (exactToApproxNumber(point.x) - xMin) / xSpan
                      const y = (exactToApproxNumber(point.y) - yMin) / ySpan
                      /*
                       * AREA, NOT DIAMETER. A mark whose diameter is proportional to its
                       * value overstates the value by its square — the classic bubble-chart
                       * error — so the radius is the square root of the share.
                       */
                      const share =
                        point.area === null || areaMax <= 0
                          ? 0
                          : exactToApproxNumber(point.area) / areaMax
                      const size = 8 + Math.sqrt(Math.max(share, 0)) * 14
                      return (
                        <li
                          key={point.key}
                          className="absolute"
                          style={{
                            left: percent(x),
                            bottom: percent(y),
                            /* Centres the mark on its coordinate rather than hanging it
                               below and right of it. */
                            transform: 'translate(-50%, 50%)',
                          }}
                        >
                          <a
                            href={point.href}
                            aria-label={point.description}
                            className={cx(
                              'block rounded-full opacity-70 transition-opacity duration-(--arpi-motion-fast)',
                              'hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                              rampClass(point.rampStep),
                              point.isSelected === true
                                ? 'opacity-100 ring-2 ring-ink ring-offset-1'
                                : ''
                            )}
                            style={{
                              width: `${String(Math.round(size))}px`,
                              height: `${String(Math.round(size))}px`,
                            }}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>

              {/* The horizontal ticks, and then the axis's own name. */}
              <ul
                aria-hidden="true"
                className="flex justify-between pl-8 text-2xs text-ink-faint"
              >
                {xAxis.ticks.map((tick) => (
                  <li key={tick}>{tick}</li>
                ))}
              </ul>
              <p aria-hidden="true" className="pl-8 text-center text-2xs text-ink-muted">
                {xAxis.label}
              </p>
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {legend.map((band, index) => (
              <li
                key={band}
                className="flex items-baseline gap-1.5 text-2xs text-ink-secondary"
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-2.5 shrink-0 translate-y-px rounded-full ${rampClass(index)}`}
                />
                {band}
              </li>
            ))}
            <li className="text-2xs text-ink-faint">{`Mark area: ${areaLabel}`}</li>
          </ul>
        </>
      )}

      {/* The two axis notes, which are caveats rather than descriptions and stay
          visible for the reason `UX.1` gives: a reader who takes the horizontal ratio
          for a valuation has misread every mark on the plot. */}
      <div className="flex flex-col gap-1">
        {xAxis.note === undefined ? null : (
          <p className="text-2xs leading-normal text-ink-muted">{xAxis.note}</p>
        )}
        {yAxis.note === undefined ? null : (
          <p className="text-2xs leading-normal text-ink-muted">{yAxis.note}</p>
        )}
      </div>

      {externalTable === undefined ? (
        <TableDisclosure title={title}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{`${title}. ${summary}`}</caption>
            <thead>
              <tr className="border-b border-line-subtle text-left">
                <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                  Unit
                </th>
                <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                  Vehicle
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium text-ink-muted">
                  {yAxis.label}
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium text-ink-muted">
                  {xAxis.label}
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium text-ink-muted">
                  {areaLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.key} className="border-b border-line-subtle/60 last:border-0">
                  <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                    <a
                      href={point.href}
                      className="underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                    >
                      {point.label}
                    </a>
                  </th>
                  <td className="py-1.5 pr-3 text-ink-muted">{point.sublabel}</td>
                  <td className="numeric py-1.5 pl-3 text-right text-ink">
                    {point.yDisplay}
                  </td>
                  <td className="numeric py-1.5 pl-3 text-right text-ink">
                    {point.xDisplay}
                  </td>
                  <td className="numeric py-1.5 pl-3 text-right text-ink">
                    {point.areaDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDisclosure>
      ) : (
        <p className="text-2xs leading-normal text-ink-muted">
          <a
            href={externalTable.href}
            className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
          >
            {externalTable.label}
          </a>
          {' carries every plotted unit and its exact figures. Each mark above is also a link, and its accessible name is that unit\u2019s own values.'}
        </p>
      )}

    </ChartFrame>
  )
}
