/**
 * The target pace bar: the console's one reusable plan-versus-actual primitive.
 *
 * WHY IT EXISTS NOW AND NOT IN `DASH.3`
 * -------------------------------------
 * `DASH.3` deliberately shipped no pace or bullet primitive, because the target domain
 * did not exist and a bar with nothing to point at would have been a decoration. The
 * plan is real from `DASH.5`, so the primitive arrives with the data it measures.
 *
 * A BAR IS THE SECONDARY READING. THE TEXT IS THE PRIMARY ONE.
 * -----------------------------------------------------------
 * Every figure this component draws is also written beside it: the actual, the target,
 * the attainment percentage, the selling-day position, the pace, the projection. Bar
 * length is a second, faster reading of the same numbers, and it is never the only one.
 * That is not only an accessibility rule — it is what makes the component honest at
 * 320px, in print, with images disabled, and for a reader who cannot resolve a 3px
 * length difference. There is no tooltip anywhere in this file: a figure a reader has
 * to hover to obtain is a figure a keyboard user and a phone user do not have.
 *
 * COLOUR CHANGES AT ONE BOUNDARY AND NOWHERE ELSE
 * -----------------------------------------------
 * The fill is one neutral accent at every attainment below 100%, and the positive data
 * token at 100% and above. That single step is the whole of the colour semantics here,
 * and the restraint is the point:
 *
 *   - THERE IS NO RED FOR BEHIND, and there must not be. A store at 40% attainment on
 *     the twelfth selling day of the month is not behind; that is what the selling-day
 *     marker on the track exists to show. Colouring a below-100% bar would publish a
 *     verdict the elapsed clock contradicts.
 *   - THERE IS NO RAMP. Nothing shades from amber at 80% to green at 100%. Any such
 *     ramp encodes thresholds ARPI has not governed and did not publish.
 *   - THE BOUNDARY IS DEFENSIBLE BECAUSE THE BUSINESS SET IT. This is the narrow case
 *     ADR-0013 leaves open: the console may not invent a favourable direction, but a
 *     target IS an explicit governed reference the business itself published, and
 *     "the plan was met" is a fact about that reference rather than a judgement about
 *     the store. Attainment is the only measure on this console that has one.
 *
 * Colour is never the only carrier. Over 100% still shows the visible overflow rule at
 * the end of the track, the attainment percentage sits beside the bar in text, and the
 * accessible summary states the actual, the target and the attainment in words. The one
 * comparison sentence the component writes stays factual — "6 units above target" — and
 * never evaluative.
 *
 * NO GAUGE, NO SPEEDOMETER, NO CHART LIBRARY
 * ------------------------------------------
 * Two nested `div`s and a border. The whole thing is server-rendered HTML and CSS with
 * zero client JavaScript, so it costs the route nothing and works with scripting off.
 *
 * REDUCED MOTION: nothing here animates, so there is nothing to suppress.
 *
 * A server component.
 */
import type { ReactNode } from 'react'

import { Text } from '@/components/ui/typography'
import { formatRatioAsPercent } from '@/lib/dashboard/format'
import { paceBarGeometry } from '@/lib/dashboard/targets'
import type { Exact } from '@/lib/dashboard/decimal'
import { cx } from '@/lib/utils'

export interface PaceBarProps {
  /** Names what is being measured, e.g. "Retail units". */
  readonly label: string
  /** The actual, already formatted. */
  readonly actualText: string
  /** The target, already formatted, or `null` when no plan exists. */
  readonly targetText: string | null
  /** The exact attainment numerator, for the bar's geometry only. */
  readonly numerator: Exact | null
  /** The exact attainment denominator, for the bar's geometry only. */
  readonly denominator: Exact | null
  /** The exact attainment ratio, rendered as the percentage beside the bar. */
  readonly attainment: Exact | null
  /**
   * How far through the month's selling days the clock has run, `0`–`1`.
   *
   * Drawn as a thin marker on the track, so a reader can see attainment against
   * elapsed capacity rather than against the whole month. `null` when the period is not
   * a single calendar month and the clock does not apply.
   */
  readonly sellingDayProgress: number | null
  /** The sentence the surface shows when there is no plan. */
  readonly missingTargetText: string
  /** Supplementary lines: the selling-day count, the pace, the projection. */
  readonly children?: ReactNode
}

/**
 * Actual against target, with the month's selling-day position marked.
 *
 * @param props See {@link PaceBarProps}.
 * @returns The rendered primitive.
 */
export function PaceBar({
  label,
  actualText,
  targetText,
  numerator,
  denominator,
  attainment,
  sellingDayProgress,
  missingTargetText,
  children,
}: PaceBarProps) {
  const { fill, overflow } = paceBarGeometry(numerator, denominator)
  const attainmentText = attainment === null ? null : formatRatioAsPercent(attainment, 1)

  /*
   * The accessible summary. One sentence carrying every figure the bar encodes, so a
   * screen-reader user is never asked to interpret a length. The bar itself is
   * `aria-hidden`: it repeats this sentence visually and announcing both would read the
   * same numbers twice.
   */
  const summary =
    targetText === null
      ? `${label}: ${actualText} actual. ${missingTargetText}`
      : `${label}: ${actualText} actual against a target of ${targetText}${
          attainmentText === null ? '' : `, ${attainmentText} of target`
        }.`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
          {label}
        </span>
        {attainmentText === null ? (
          <span className="text-xs text-ink-faint">No target set</span>
        ) : (
          <span className="font-mono text-xs text-ink-secondary">
            {attainmentText} of target
          </span>
        )}
      </div>

      <p className="sr-only">{summary}</p>

      <div
        aria-hidden="true"
        className={cx(
          'relative h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken',
          'border border-line-subtle'
        )}
      >
        {targetText === null ? null : (
          <div
            className={cx(
              'absolute inset-y-0 left-0 rounded-full',
              // `overflow` is `ratio >= 1` exactly, so the step lands on the boundary
              // and not near it. Below it, the neutral accent -- never a warning.
              overflow ? 'bg-data-positive' : 'bg-accent-muted'
            )}
            style={{ width: `${String(Math.round(fill * 1000) / 10)}%` }}
          />
        )}
        {/*
         * The overflow rule. A bar clamped at 100% with nothing to say so would read as
         * "exactly on target" for a store 34% ahead, which is the one reading a clamp
         * must not produce. The percentage beside the bar carries the real figure; this
         * is the visual acknowledgement that the track ran out.
         */}
        {overflow ? (
          <div className="absolute inset-y-0 right-0 w-1 bg-ink-secondary" />
        ) : null}
        {sellingDayProgress === null ? null : (
          <div
            className="absolute inset-y-0 w-px bg-ink-muted"
            style={{
              left: `${String(Math.round(sellingDayProgress * 1000) / 10)}%`,
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono text-sm font-medium text-ink tabular-nums">
          {actualText}
        </span>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {targetText === null ? missingTargetText : `Target ${targetText}`}
        </span>
      </div>

      {children === undefined ? null : (
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      )}
    </div>
  )
}

/** One supplementary line under a pace bar: a label and its governed value. */
export function PaceLine({
  label,
  value,
  kpiId,
}: {
  readonly label: string
  readonly value: string
  readonly kpiId?: string
}) {
  return (
    <Text size="xs" tone="muted" className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
      {kpiId === undefined ? null : (
        <span className="font-mono text-2xs text-ink-faint">{kpiId}</span>
      )}
    </Text>
  )
}
