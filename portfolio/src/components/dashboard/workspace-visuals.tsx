/**
 * The primitives a workspace grid needs, shared by more than one operating route.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT `visuals.tsx`
 * ----------------------------------------------------
 * `exec-visuals.tsx` was written at `UX.2A` for three forms the Executive Command Center
 * needed and the console-wide set did not have, and it said in its own docstring what would
 * happen next: *"If a second route ever renders one of these, it moves."* `UX.2B` renders two
 * of the three on `/dashboard/sales-gross`, `/dashboard/inventory` and `/dashboard/fi`, so
 * they moved. `MetricSwitch` and the grouped comparison are here; `FunnelChart` is still
 * rendered by one route and stayed where it was.
 *
 * They did not move into `visuals.tsx`, and the reason is the one that kept them out of it
 * the first time: that module is 1,750 lines carrying eight primitives, and the two below
 * would take it past two thousand.
 * [`MODULE_DECOMPOSITION_DEBT.md`](../../../../docs/reviews/MODULE_DECOMPOSITION_DEBT.md)
 * records what that costs elsewhere in this repository. A third module with a stated
 * membership rule — *rendered by two or more operating routes, and needed by the workspace
 * layout rather than by one page's subject* — is cheaper than a fourth thousand lines.
 *
 * ONE IMPLEMENTATION OF THE GROUPED BAR, TWO NAMES
 * -----------------------------------------------
 * `GroupedMeasureBars` draws several measures across a set of identities. `StoreMeasureBars`
 * is the store-scoped call of it: it supplies `storeMarkClass` so a store's hue is derived
 * from its business code and cannot drift when another store leaves the filter. Sales & Gross
 * calls the general form for New against Used, which needs the same picture and a different
 * palette; a second copy of the geometry would eventually disagree with the first about where
 * a bar's zero sits.
 *
 * MEASURED COST OF EVERYTHING IN THIS FILE: zero bytes of client JavaScript. These are server
 * components, and the one interactive control is a radio group with CSS.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY — the rule `visuals.tsx` states at
 * length holds here without exception. `exactToApproxNumber` is called to compute a width and
 * never to produce a displayed figure.
 */
import type { ReactNode } from 'react'

import type { Exact } from '@/lib/dashboard/decimal'
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
 * into the browser that was not already in the document. `UX.2A` §18 and `UX.2B` §45 permit
 * a metric switch and forbid client-side recalculation; this cannot recalculate, because
 * there is no code here to do it with.
 *
 * WHY NO URL STATE, STATED RATHER THAN ASSUMED
 * --------------------------------------------
 * `INFORMATION_ARCHITECTURE.md` §6 defines one filter grammar shared by every operating
 * route, and every parameter in it changes WHICH ROWS a figure is computed from. This
 * changes neither the population nor the arithmetic — all panels are on screen
 * simultaneously in the served HTML, and the switch only chooses which one the eye is
 * pointed at. A fourteenth parameter that survived a navigation to `/dashboard/inventory`,
 * where it means nothing, would be a presentation preference wearing the clothes of a
 * console-wide filter. The panels are equally shareable today: a reader sending a link
 * sends all of them.
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
 * peer name built by template literal emits no CSS at all. The routes render two or three
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
/* GroupedMeasureBars                                                          */
/* -------------------------------------------------------------------------- */

/** One identity's value for one compared measure. */
export interface MeasureBarRow {
  /** Stable identity. Chooses the row's key and nothing about its geometry. */
  readonly key: string
  readonly label: string
  /** A second column in the table only: an operating model, a condition note. */
  readonly sublabel?: string
  /**
   * The value, or `null` for a state that is not a value.
   *
   * `null` DRAWS NOTHING AND CONTRIBUTES NOTHING TO THE SCALE. A measure a subject cannot
   * have at all is not a measured zero, and a zero-length bar for it would re-create,
   * geometrically, the defect the structural-absence rules exist to remove from the tables.
   */
  readonly value: Exact | null
  /** The value as the reader should see it, or the words for its absent state. */
  readonly display: string
  /** The identity mark. Supplied by the caller, never derived from the row position. */
  readonly markClass: string
}

/** One measure, across every identity in scope. */
export interface MeasureBarGroup {
  readonly id: string
  readonly label: string
  readonly kpiId: string | null
  readonly rows: readonly MeasureBarRow[]
}

/**
 * Several governed measures across a set of identities, as one grouped comparison.
 *
 * WHY GROUPED AND NOT ONE CHART PER MEASURE. The question a manager opens with is not "how
 * do the stores compare on units" — it is "which one is different, and on what". Three
 * charts stacked vertically make the reader carry the identity from one to the next by
 * name; one grouped comparison with a stable mark answers it in one eye movement.
 *
 * EACH MEASURE IS SCALED TO ITS OWN MAXIMUM, AND HAS TO BE. Units, dollars and dollars per
 * unit share no axis; a common scale would draw retail units as a hairline beside total
 * gross. The measure's own maximum is therefore the reference within its group, the group
 * label names the measure, and every value is printed. No cross-group length comparison is
 * available, and none is implied.
 *
 * NOTHING IS RANKED. Rows are in the order the caller supplies — a business code, an
 * exported enumeration — no mark means "best", and no composite is formed across measures.
 */
export function GroupedMeasureBars({
  title,
  caption,
  groups,
  identityHeading = 'Store',
  sublabelHeading,
  notice,
  headingLevel = 3,
  className,
}: {
  readonly title: string
  readonly caption?: ReactNode
  readonly groups: readonly MeasureBarGroup[]
  /** The table's first column heading. What one row IS. */
  readonly identityHeading?: string
  /** The table's second column heading, where rows carry a `sublabel`. */
  readonly sublabelHeading?: string
  /** Rendered under the bars when the scope makes the comparison degenerate. */
  readonly notice?: ReactNode
  readonly headingLevel?: 2 | 3 | 4
  readonly className?: string
}) {
  const identities = groups[0]?.rows ?? []
  const hasSublabel = sublabelHeading !== undefined

  const summary =
    groups.length === 0 || identities.length === 0
      ? `No subject in scope resolves ${title.toLowerCase()}.`
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
      {/* One legend for every group below it, so an identity's mark is stated once. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {identities.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline gap-1.5 text-xs text-ink-secondary"
          >
            <span
              aria-hidden="true"
              className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${row.markClass}`}
            />
            {row.label}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const largest = group.rows.reduce(
            (max, row) =>
              row.value === null ? max : Math.max(max, exactToApproxNumber(row.value)),
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
                  const resolved = row.value !== null
                  const width =
                    row.value !== null && largest > 0
                      ? exactToApproxNumber(row.value) / largest
                      : 0
                  return (
                    <li
                      key={row.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
                    >
                      {resolved ? (
                        <span
                          aria-hidden="true"
                          className="h-3 w-full overflow-hidden rounded-pill bg-surface-sunken"
                        >
                          {/* Zero stays zero: a minimum-width bar for a subject that sold
                              nothing would draw a quantity the data does not have. */}
                          <span
                            className={`block h-full rounded-pill ${row.markClass}`}
                            style={{ width: percent(width) }}
                          />
                        </span>
                      ) : (
                        <span className="text-2xs text-ink-faint">{row.label}</span>
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

      {notice === undefined ? null : (
        <p className="text-xs leading-normal text-ink-muted">{notice}</p>
      )}

      <TableDisclosure title={title}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`${title}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                {identityHeading}
              </th>
              {hasSublabel ? (
                <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                  {sublabelHeading}
                </th>
              ) : null}
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
            {identities.map((identity, index) => (
              <tr
                key={identity.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {identity.label}
                </th>
                {hasSublabel ? (
                  <td className="py-1.5 pr-3 text-ink-muted">
                    {identity.sublabel ?? ''}
                  </td>
                ) : null}
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
 * The store-scoped call of `GroupedMeasureBars`.
 *
 * WHY IT TAKES A WHOLE `MetricResult` AND NOT A VALUE. A primitive that took a number could
 * not tell a measured zero from "Not applicable", and would draw a zero-length bar for a
 * store that is not in the business being measured — the exact defect the structural-absence
 * rule in `executive.ts` exists to prevent. The mapping below is the one place that decides
 * a non-`value` result draws nothing.
 *
 * THE MARK COMES FROM THE BUSINESS CODE. See `storeMarkClass`: a store filtered out of scope
 * must not shift the colour of every store after it.
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
  return (
    <GroupedMeasureBars
      title={title}
      caption={caption}
      identityHeading="Store"
      sublabelHeading="Operating model"
      groups={groups.map((group) => ({
        id: group.id,
        label: group.label,
        kpiId: group.kpiId,
        rows: group.rows.map((row) => ({
          key: row.storeId,
          label: row.storeShortName,
          sublabel: row.storeType,
          value: row.result.kind === 'value' ? row.result.value : null,
          display: row.display,
          markClass: storeMarkClass(row.storeId),
        })),
      }))}
      {...(singleStoreNotice === undefined ? {} : { notice: singleStoreNotice })}
      headingLevel={headingLevel}
      {...(className === undefined ? {} : { className })}
    />
  )
}
