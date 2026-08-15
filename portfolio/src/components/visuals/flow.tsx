/**
 * Flow diagrams: `FlowDiagram` and `LaneFlow`.
 *
 * The reference half of the site explained its own shape in paragraphs. Seven
 * routes opened with between 450 and 1,300 pixels of prose before a reader met
 * anything they could look at, and the sentence doing the work was almost always
 * an ordered list of stages written out longhand — "seeded generators, then
 * validation, then PostgreSQL, then the warehouse, then reporting views, then the
 * export, then this application". A chain of stages is a picture of a chain of
 * stages; writing it as a sentence asks the reader to rebuild the picture.
 *
 * WHY IT IS MARKUP AND NOT AN SVG OR A CHART LIBRARY
 * --------------------------------------------------
 * `PERFORMANCE.md` records the decision that this site ships no client-side
 * visualization runtime, and a diagram is exactly where that discipline is most
 * often abandoned. A stage chain is a list with rules and arrows around it, so it
 * is built from an `<ol>`: the reading order is the flow order, a screen reader
 * announces "3 of 7", the labels are real text that a browser can search and
 * translate, it reflows to one column on a phone without a viewBox, and it costs
 * zero bytes of JavaScript. The connectors are the only decoration and they are
 * `aria-hidden`, because "arrow" announced six times is noise around a list that
 * is already ordered.
 *
 * WHAT A STAGE MAY CLAIM
 * ----------------------
 * A stage label is a name, not a status. `tone` marks a stage the surrounding
 * page has separately established as pending or conceptual — the semantic model
 * awaiting real-engine validation, an integration that does not exist — and it is
 * never the only carrier of that meaning: every caller pairs it with a word.
 * Colour alone would put a claim about project status behind a hue, which is both
 * a WCAG 1.4.1 failure and the exact claim this project is most careful about.
 */
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* FlowDiagram                                                                 */
/* -------------------------------------------------------------------------- */

const STAGE_TONE = {
  /** An ordinary stage of a pipeline that exists. */
  default: 'border-line bg-surface',
  /** The stage the surrounding text is about. */
  accent: 'border-accent-muted/45 bg-accent-wash/50',
  /** Built, but awaiting something outside this repository. */
  pending: 'border-pending/35 bg-pending-wash/40',
  /** The semantic-model layer. Matches the model colour used site-wide. */
  model: 'border-model/30 bg-model-wash/40',
  /** Described but not implemented. Only the product vision uses it. */
  conceptual: 'border-line-strong border-dashed bg-surface-sunken/60',
} as const

export type StageTone = keyof typeof STAGE_TONE

export interface FlowStage {
  readonly label: string
  /** One short clause. Not a sentence with a full stop and a second clause. */
  readonly detail?: string
  /** A count, an identifier or a format. Rendered monospaced. */
  readonly note?: string
  readonly tone?: StageTone
  /**
   * The word that carries whatever `tone` colours. Required whenever `tone` is
   * anything but `default` or `accent`, so the state survives greyscale.
   */
  readonly state?: string
}

export interface FlowDiagramProps {
  readonly stages: readonly FlowStage[]
  /** The accessible name of the figure. Always supplied; visually hidden. */
  readonly label: string
  /** A visible caption under the chain. One sentence. */
  readonly caption?: ReactNode
  /** `row` chains left to right above `lg`. `column` always stacks. */
  readonly direction?: 'row' | 'column'
  /** Smaller type and tighter boxes, for a chain inside a page header. */
  readonly density?: 'default' | 'compact'
  readonly className?: string
}

export function FlowDiagram({
  stages,
  label,
  caption,
  direction = 'row',
  density = 'default',
  className,
}: FlowDiagramProps) {
  const compact = density === 'compact'

  return (
    <figure className={cx('flex flex-col gap-3', className)}>
      <ol
        aria-label={label}
        className={cx(
          'flex flex-col items-stretch gap-1.5',
          direction === 'row' && 'lg:flex-row lg:items-stretch'
        )}
      >
        {stages.map((stage, index) => (
          <li
            key={stage.label}
            className={cx(
              'flex min-w-0 flex-1 items-center gap-1.5',
              direction === 'row' && 'lg:flex-col lg:items-stretch'
            )}
          >
            {index === 0 ? null : (
              <ChevronRight
                aria-hidden="true"
                strokeWidth={2.25}
                className={cx(
                  'size-4 shrink-0 rotate-90 text-ink-faint',
                  direction === 'row' && 'lg:rotate-0 lg:self-center'
                )}
              />
            )}
            <div
              className={cx(
                'flex min-w-0 flex-1 flex-col gap-1 rounded-lg border',
                compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
                STAGE_TONE[stage.tone ?? 'default']
              )}
            >
              <span
                className={cx(
                  'leading-snug font-semibold text-ink',
                  compact ? 'text-xs' : 'text-sm'
                )}
              >
                {stage.label}
              </span>
              {stage.detail === undefined ? null : (
                <span className="text-2xs leading-snug text-ink-muted">
                  {stage.detail}
                </span>
              )}
              {stage.note === undefined && stage.state === undefined ? null : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {stage.note === undefined ? null : (
                    <span className="numeric font-mono text-2xs text-ink-faint">
                      {stage.note}
                    </span>
                  )}
                  {stage.state === undefined ? null : (
                    <span className="eyebrow text-2xs text-ink-secondary">
                      {stage.state}
                    </span>
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {caption === undefined ? null : (
        <figcaption className="text-xs leading-normal text-ink-muted">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* LaneFlow                                                                    */
/* -------------------------------------------------------------------------- */

export interface Lane {
  readonly title: string
  /** The lane's own provenance or status, in words. Never colour alone. */
  readonly state: string
  readonly stages: readonly FlowStage[]
  /** One sentence naming what this lane may and may not be read as. */
  readonly boundary: string
  readonly tone?: 'default' | 'pending' | 'conceptual'
}

export interface LaneFlowProps {
  readonly lanes: readonly Lane[]
  readonly label: string
  readonly className?: string
}

const LANE_TONE = {
  default: 'border-line bg-surface-sunken/40',
  pending: 'border-pending/30 bg-pending-wash/25',
  conceptual: 'border-line-strong border-dashed bg-surface-sunken/60',
} as const

/**
 * Two or more chains side by side, each with its own provenance statement.
 *
 * Built for the two places on this site where the whole point is that two things
 * a reader would assume are one thing are not: the synthetic warehouse lane
 * against the sanitized reference-listing lane, and what is implemented against
 * what is only a design position. In both cases the previous version made the
 * distinction in consecutive paragraphs, which is the arrangement most likely to
 * be read as one continuous claim.
 *
 * The boundary sentence is inside the lane and always visible. It is the reason
 * the lane is drawn separately, so it cannot be a disclosure.
 */
export function LaneFlow({ lanes, label, className }: LaneFlowProps) {
  return (
    <div
      className={cx('grid grid-cols-1 gap-4 lg:grid-cols-2', className)}
      role="group"
      aria-label={label}
    >
      {lanes.map((lane) => (
        <section
          key={lane.title}
          className={cx(
            'flex flex-col gap-3 rounded-xl border p-4',
            LANE_TONE[lane.tone ?? 'default']
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-ink">{lane.title}</h3>
            <span className="eyebrow text-2xs text-ink-secondary">{lane.state}</span>
          </div>
          <FlowDiagram
            stages={lane.stages}
            label={`${lane.title}: stages`}
            direction="column"
            density="compact"
          />
          <p className="text-xs leading-normal text-ink-muted">{lane.boundary}</p>
        </section>
      ))}
    </div>
  )
}
