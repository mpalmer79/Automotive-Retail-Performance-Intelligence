/**
 * The Executive Command Center's own visual primitive.
 *
 * WHAT USED TO BE HERE, AND WHERE IT WENT
 * ---------------------------------------
 * `UX.2A` put three forms in this file — a presentation switch, a grouped store comparison
 * and this funnel — because the command-center layout needed shapes the console-wide set in
 * `visuals.tsx` did not have, and only one route rendered them. The docstring said what would
 * happen if that stopped being true: *"If a second route ever renders one of these, it
 * moves."*
 *
 * `UX.2B` renders the switch and the grouped comparison on `/dashboard/sales-gross`,
 * `/dashboard/inventory` and `/dashboard/fi`, so both moved to `workspace-visuals.tsx`, whose
 * membership rule is stated there. The funnel did not: `/` is still the only route that draws
 * it, and an abstraction over one call site is a guess about the second.
 *
 * THE CHART-LIBRARY QUESTION, ASKED AGAIN AND ANSWERED AGAIN
 * ----------------------------------------------------------
 * `UX.2A` §19 required the decision to be re-made rather than inherited, and it was, in full,
 * against Recharts, Visx, Chart.js and Observable Plot; the record is in
 * `portfolio/docs/DESIGN_SYSTEM.md` §6.0c. `UX.2B` §44 required it to be re-made a third time
 * against a genuinely harder case — a scatter plot with a keyboard-reachable point set — and
 * the record of THAT is §6.0e. The outcome is unchanged both times and the reason is narrower
 * than "we already decided": three of the four cannot render on the server without a measured
 * container, and this console's contract is that every figure is in the served HTML.
 *
 * MEASURED COST: zero bytes of client JavaScript. It is a server component.
 *
 * EXACT VALUES IN, APPROXIMATE NUMBERS ONLY FOR GEOMETRY — the rule `visuals.tsx` states at
 * length holds here without exception.
 */
import type { ReactNode } from 'react'

import { ChartFrame, TableDisclosure } from './visuals'

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1000) / 10)}%`
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
