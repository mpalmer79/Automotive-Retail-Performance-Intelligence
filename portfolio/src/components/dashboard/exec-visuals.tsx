/**
 * The Executive Command Center's own visual primitives.
 *
 * WHY A SECOND FILE RATHER THAN MORE OF `visuals.tsx`
 * --------------------------------------------------
 * `visuals.tsx` is the console-wide set: eight primitives, five of which are rendered by
 * three or more routes. These three are rendered by ONE route and exist because the
 * command-center layout needs a form the shared set does not have. Adding them there
 * would take that module past 2,000 lines and would imply a reuse that has not happened
 * — `MODULE_DECOMPOSITION_DEBT.md` records the shape of that mistake elsewhere in this
 * codebase. If a second route ever renders one of these, it moves.
 *
 * THE CHART-LIBRARY QUESTION, ASKED AGAIN AND ANSWERED AGAIN
 * ----------------------------------------------------------
 * `UX.2A` §19 requires the decision to be re-made rather than inherited, because the
 * increment is the first one large enough to justify a library. It was re-made, in full,
 * against Recharts, Visx, Chart.js and Observable Plot, and is recorded in
 * `portfolio/docs/DESIGN_SYSTEM.md` §6.0c. The outcome is unchanged and the reason is
 * narrower than "we already decided": three of the four cannot render on the server
 * without a measured container, and this route's contract is that every figure is in the
 * served HTML. The fourth (Visx, used as pure layout maths) would have supplied scales
 * and axes this file does not need — the three forms below are a share, a length and a
 * nesting, and each is one division.
 *
 * MEASURED COST OF THESE THREE: zero bytes of client JavaScript. They are server
 * components, and the one interactive control in the file is a radio group with CSS.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY — the rule `visuals.tsx` states
 * at length holds here without exception. `exactToApproxNumber` is called to compute a
 * width and never to produce a displayed figure.
 */
import type { ReactNode } from 'react'

import { exactToApproxNumber } from '@/lib/dashboard/decimal'
import type { MetricResult } from '@/lib/dashboard/selectors'
import { cx } from '@/lib/utils'

import { ChartFrame, TableDisclosure, storeMarkClass } from './visuals'

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
 * KPI rail uses. The control changes WHICH ONE IS DISPLAYED and nothing else: no value is
 * recomputed, no denominator is re-chosen, no series is re-derived, and no data crosses
 * into the browser that was not already in the document. `UX.2A` §18 permits a metric
 * switch and forbids client-side recalculation; this cannot recalculate, because there is
 * no code here to do it with.
 *
 * WHY NO URL STATE, STATED RATHER THAN ASSUMED
 * --------------------------------------------
 * `INFORMATION_ARCHITECTURE.md` §6 defines one filter grammar shared by every operating
 * route, and every parameter in it changes WHICH ROWS a figure is computed from. This
 * changes neither the population nor the arithmetic — all three answers are on screen
 * simultaneously in the served HTML, and the switch only chooses which one the eye is
 * pointed at. A fourteenth parameter that survived a navigation to `/dashboard/inventory`,
 * where it means nothing, would be a presentation preference wearing the clothes of a
 * console-wide filter. The three panels are equally shareable today: a reader sending a
 * link sends all three.
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
 * peer name built by template literal emits no CSS at all. The page renders three
 * measures; a fourth would be three more literals, and pretending otherwise with a loop
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
/* StoreMeasureBars                                                            */
/* -------------------------------------------------------------------------- */

/** One store's value for one compared measure. */
export interface StoreMeasureRow {
  /** The business code. It, and never the row position, chooses the mark colour. */
  readonly storeId: string
  readonly storeShortName: string
  readonly storeType: string
  /** The whole result, so a structural absence renders as words and no bar. */
  readonly result: MetricResult
  readonly display: string
}

/** One measure, across every store in scope. */
export interface StoreMeasureGroup {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  readonly rows: readonly StoreMeasureRow[]
}

/**
 * Several governed measures across the stores in scope, as one grouped comparison.
 *
 * WHY GROUPED AND NOT THREE SEPARATE CHARTS. The question a general manager opens the
 * console with is not "how do the stores compare on units" — it is "which store is
 * different, and on what". Three charts stacked vertically make the reader carry the
 * store identity from one to the next by name; one grouped comparison with a stable mark
 * per store answers it in one eye movement. That is the whole reason the mark colour is
 * derived from the business code rather than from the row position: see `storeMarkClass`.
 *
 * EACH MEASURE IS SCALED TO ITS OWN MAXIMUM, AND HAS TO BE. Units, dollars and dollars per
 * unit share no axis; a common scale would draw retail units as a hairline beside total
 * gross. The measure's own maximum is therefore the reference within its group, the group
 * label names the measure, and every value is printed. No cross-group length comparison is
 * available, and none is implied.
 *
 * NOTHING IS RANKED. Rows are in business-code order, no mark means "best", and no
 * composite is formed across the three measures. The three stores run different operating
 * models and this console publishes no league table over them.
 *
 * A STRUCTURAL ABSENCE DRAWS NOTHING. A store that cannot have a measure at all renders
 * its words and no track, and contributes nothing to the scale — the same rule
 * `StoreComparisonBars` states, for the same reason.
 */
export function StoreMeasureBars({
  title,
  caption,
  groups,
  singleStoreNotice,
  headingLevel = 3,
  className,
}: {
  readonly title: string
  readonly caption?: ReactNode
  readonly groups: readonly StoreMeasureGroup[]
  readonly singleStoreNotice?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}) {
  const stores = groups[0]?.rows ?? []

  const summary =
    groups.length === 0 || stores.length === 0
      ? `No store in scope resolves ${title.toLowerCase()}.`
      : groups
          .map(
            (group) =>
              `${group.label}: ${group.rows
                .map((row) => `${row.storeShortName} ${row.display}`)
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
      {/* One legend for every group below it, so a store's mark is stated once. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {stores.map((row) => (
          <li
            key={row.storeId}
            className="flex items-baseline gap-1.5 text-xs text-ink-secondary"
          >
            <span
              aria-hidden="true"
              className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${storeMarkClass(row.storeId)}`}
            />
            {row.storeShortName}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const largest = group.rows.reduce(
            (max, row) =>
              row.result.kind === 'value'
                ? Math.max(max, exactToApproxNumber(row.result.value))
                : max,
            0
          )
          return (
            <div key={group.id} className="flex flex-col gap-1.5">
              <p className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-ink-secondary">
                  {group.label}
                </span>
                {group.kpiId === null ? null : (
                  <span className="font-mono text-2xs tracking-wide text-ink-faint">
                    {group.kpiId}
                  </span>
                )}
              </p>
              <ul className="flex flex-col gap-1">
                {group.rows.map((row) => {
                  const resolved = row.result.kind === 'value'
                  const width =
                    resolved && largest > 0
                      ? exactToApproxNumber(row.result.value) / largest
                      : 0
                  return (
                    <li
                      key={row.storeId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
                    >
                      {resolved ? (
                        <span
                          aria-hidden="true"
                          className="h-3 w-full overflow-hidden rounded-pill bg-surface-sunken"
                        >
                          {/* Zero stays zero: a minimum-width bar for a store that sold
                              nothing would draw a quantity the data does not have. */}
                          <span
                            className={`block h-full rounded-pill ${storeMarkClass(row.storeId)}`}
                            style={{ width: percent(width) }}
                          />
                        </span>
                      ) : (
                        <span className="text-2xs text-ink-faint">
                          {row.storeShortName}
                        </span>
                      )}
                      <span
                        className={cx(
                          'shrink-0 text-xs',
                          resolved
                            ? 'numeric font-semibold text-ink'
                            : 'font-medium text-ink-muted'
                        )}
                      >
                        {row.display}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {singleStoreNotice === undefined ? null : (
        <p className="text-xs leading-normal text-ink-muted">{singleStoreNotice}</p>
      )}

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Store
              </th>
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Operating model
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
            {stores.map((store, index) => (
              <tr
                key={store.storeId}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {store.storeShortName}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">{store.storeType}</td>
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
/* FunnelChart                                                                 */
/* -------------------------------------------------------------------------- */

/** One stage of the funnel, ready to render. */
export interface FunnelStageBar {
  readonly key: string
  readonly label: string
  /** The count, already formatted, or the words for a state that is not a value. */
  readonly display: string
  /**
   * The stage's share of the FIRST stage, `0`-`1`, or `null` where it is undefined.
   *
   * Arithmetic on two exported columns for the geometry, and labelled as such wherever it
   * is printed. It is not one of the governed rates: those arrive on `rate` with their
   * catalogue identifiers, and the two are never presented as the same kind of thing.
   */
  readonly share: number | null
  readonly shareDisplay: string | null
  /** The governed rate published for this stage against leads received, if any. */
  readonly rate: {
    readonly display: string
    readonly kpiId: string | null
  } | null
}

/**
 * The five governed funnel stages, as a nesting.
 *
 * WHY A NESTING AND NOT A RAMP. Each stage is a SUBSET of the one above it, so the
 * narrowing width already carries the whole progression. A colour ramp down the stages
 * would have to say which end is the good end, and this console publishes no governed
 * favourable direction for conversion — the same reasoning `lead-funnel.tsx` recorded when
 * this was a table with a bar in one column.
 *
 * WHAT CHANGED FROM THE TABLE, AND WHAT DID NOT. The presentation. Every stage, every
 * count, every governed rate and every catalogue identifier is the same value from the
 * same selector; the share is the same two-column division, still labelled as arithmetic
 * rather than as a KPI; show rate is still absent from the "Showed" stage, because
 * KPI-FUN-004 has a different denominator and putting it here would relabel a measure
 * rather than report one.
 *
 * A ZERO BASE HAS NO SHARES. Drawing five stages at zero width would present "nobody
 * enquired" as "everybody dropped out at the first step", so `share` is `null` and the
 * row says so.
 */
export function FunnelChart({
  title,
  caption,
  stages,
  shareNote,
  headingLevel = 3,
  className,
}: {
  readonly title: string
  readonly caption?: ReactNode
  readonly stages: readonly FunnelStageBar[]
  /** The one sentence that keeps the bar from being read as a governed rate. */
  readonly shareNote: string
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}) {
  const summary =
    stages.length === 0
      ? 'No funnel stage resolves for this scope.'
      : stages
          .map(
            (stage) =>
              `${stage.label} ${stage.display}` +
              (stage.rate === null ? '' : ` (${stage.rate.display})`)
          )
          .join(', ') + '.'

  return (
    <ChartFrame
      title={title}
      caption={caption}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={headingLevel}
      className={className}
    >
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li key={stage.key} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-ink-secondary">
                {stage.label}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="numeric text-sm font-semibold text-ink">
                  {stage.display}
                </span>
                {stage.rate === null ? null : (
                  <span className="numeric text-2xs text-ink-muted">
                    {stage.rate.display}
                    {stage.rate.kpiId === null ? null : (
                      <span className="font-mono text-ink-faint">
                        {' '}
                        {stage.rate.kpiId}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </p>
            {stage.share === null ? (
              <p className="text-2xs text-ink-faint">
                No proportion is defined without leads received
              </p>
            ) : (
              <span
                aria-hidden="true"
                className="flex h-4 w-full items-center gap-2 overflow-hidden rounded-xs bg-surface-sunken"
              >
                <span
                  className="h-full rounded-xs bg-data-primary"
                  style={{ width: percent(stage.share) }}
                />
                <span className="numeric shrink-0 pr-1 text-2xs text-ink-faint">
                  {stage.shareDisplay}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="text-2xs leading-normal text-ink-faint">{shareNote}</p>

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Stage
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Leads
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Share of leads received
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Governed rate
              </th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr
                key={stage.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {stage.label}
                </th>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {stage.display}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink-muted">
                  {stage.shareDisplay ?? 'Not defined'}
                </td>
                <td className="numeric py-1.5 text-right text-ink">
                  {stage.rate === null
                    ? 'No governed rate at this stage'
                    : `${stage.rate.display}${stage.rate.kpiId === null ? '' : ` (${stage.rate.kpiId})`}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </ChartFrame>
  )
}
