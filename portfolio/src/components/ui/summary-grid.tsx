/**
 * Summary grids: `StatusGrid` and `CapabilityGrid`.
 *
 * Two shapes that the reference half of the site had been rebuilding out of
 * paragraphs, once per route, in a different arrangement each time.
 *
 * `StatusGrid` is a set of named things with a state and a source. Governance
 * controls, delivery milestones, gate conditions and validation paths are all the
 * same object — a claim, whether it holds, and the file that settles it — and the
 * page's job is to let a reader see the shape of the set before reading any one
 * member of it. Four routes were each stating that set as a column of cards with
 * a paragraph inside every card, which reads as an argument rather than as a
 * status.
 *
 * `CapabilityGrid` is a claim about what the author or the project can do, with
 * the artefact that proves it. The rule it enforces is the one the About page
 * already held in prose and can now hold in layout: **the repository proves the
 * claim, so the copy does not have to**. Each entry gets one clause and a link;
 * there is nowhere to put a paragraph, which is the point.
 *
 * Neither grid may carry a proficiency rating, a percentage, a score or a bar
 * whose length implies quality. That prohibition predates this component and is
 * recorded on the About page: a self-assessed "SQL 85%" communicates nothing and
 * invites the reader to wonder about the missing fifteen.
 *
 * `data-visual-region` ON `StatusGrid` AND `StatRail`, AND WHY IT IS NOT ON
 * `CapabilityGrid`
 * -------------------------------------------------------------------------
 * The attribute is the operating console's existing hook for "a region whose
 * content is data-driven geometry", declared in `workspace-grid.tsx`, carrying no
 * styling and no meaning to a reader. `UX.3` extends it to the reference routes
 * for the same reason it exists on the console: the first-viewport claims in this
 * increment are geometric, and a measurement that only recognised `<svg>` and
 * `<figure>` would score a rank of four derived figures as though the page showed
 * nothing — which is exactly how the console's own KPI rail would score, and why
 * the console needed the hook in the first place.
 *
 * `CapabilityGrid` does NOT carry it, deliberately. Its cells hold a claim and a
 * link, not a figure, and marking it would let a route satisfy a
 * first-viewport contract with a list of assertions. The attribute has to keep
 * meaning "derived from data" or it stops being worth measuring.
 */
import type { ReactNode } from 'react'

import { StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { cx } from '@/lib/utils'
import type { StatusLevel } from '@/types/manifest'

/* -------------------------------------------------------------------------- */
/* StatusGrid                                                                  */
/* -------------------------------------------------------------------------- */

export interface StatusEntry {
  readonly label: string
  readonly status: StatusLevel
  /** Overrides the badge's word where the domain has a better one. */
  readonly statusLabel?: string
  /** One clause. If it needs a second sentence it belongs in the body below. */
  readonly detail?: string
  /** The file that settles it. */
  readonly path?: string
  readonly pathField?: string
}

export interface StatusGridProps {
  readonly entries: readonly StatusEntry[]
  /** The accessible name of the list. */
  readonly label: string
  readonly columns?: 2 | 3 | 4
  /** Drop the details and render label plus badge only. */
  readonly density?: 'default' | 'compact'
  readonly className?: string
}

const GRID_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const

/**
 * A set of claims and whether each one holds.
 *
 * Rendered as a `<ul>` rather than a `<dl>`: the state is not a definition of the
 * label, and a screen reader announcing "term / definition" for "Gate 2 / Closed"
 * describes the markup rather than the fact.
 */
export function StatusGrid({
  entries,
  label,
  columns = 3,
  density = 'default',
  className,
}: StatusGridProps) {
  return (
    <ul
      aria-label={label}
      data-visual-region="status-grid"
      className={cx('grid grid-cols-1 gap-3', GRID_COLUMNS[columns], className)}
    >
      {entries.map((entry) => (
        <li
          key={entry.label}
          className={cx(
            'flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken/40',
            density === 'compact' ? 'p-3' : 'p-3.5'
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-sm leading-snug font-semibold text-balance text-ink">
              {entry.label}
            </span>
            <StatusBadge
              status={entry.status}
              size="sm"
              {...(entry.statusLabel === undefined ? {} : { label: entry.statusLabel })}
            />
          </div>
          {density === 'compact' || entry.detail === undefined ? null : (
            <p className="text-xs leading-normal text-ink-muted">{entry.detail}</p>
          )}
          {entry.path === undefined ? null : (
            <SourceLink
              path={entry.path}
              {...(entry.pathField === undefined ? {} : { field: entry.pathField })}
              className="mt-auto pt-1"
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* StatRail                                                                    */
/* -------------------------------------------------------------------------- */

export interface Stat {
  readonly value: string
  readonly label: string
  /** One short clause. Where the figure came from, or what it counts. */
  readonly note?: string
}

export interface StatRailProps {
  readonly stats: readonly Stat[]
  readonly label: string
  readonly className?: string
}

/**
 * A short rank of figures with their labels.
 *
 * Every value arrives as a formatted string from the caller, never as a number
 * this component formats: the manifest owns the counts and the site is forbidden
 * to hardcode one, so a component that took `number` would be one refactor away
 * from carrying a default.
 *
 * A `<dl>` here and not a `<ul>`, because the label genuinely does define the
 * figure, and a screen reader reading "Reporting views, 28" is the right
 * announcement.
 */
export function StatRail({ stats, label, className }: StatRailProps) {
  return (
    <dl
      aria-label={label}
      data-visual-region="stat-rail"
      className={cx(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line',
        stats.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
        className
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-0.5 bg-surface p-3.5">
          <dt className="eyebrow text-2xs text-ink-secondary">{stat.label}</dt>
          <dd className="numeric font-display text-2xl leading-none font-semibold tracking-tight text-ink">
            {stat.value}
          </dd>
          {stat.note === undefined ? null : (
            <dd className="text-2xs leading-snug text-ink-muted">{stat.note}</dd>
          )}
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------------------- */
/* CapabilityGrid                                                              */
/* -------------------------------------------------------------------------- */

export interface Capability {
  readonly name: string
  /**
   * One clause of evidence, ideally containing a count the manifest produced.
   * Not a description of the skill — a description of what is in the repository.
   */
  readonly evidence: string
  /** The path a reviewer opens to check the clause above. */
  readonly path: string
  readonly icon?: ReactNode
}

export interface CapabilityGridProps {
  readonly capabilities: readonly Capability[]
  readonly label: string
  readonly columns?: 2 | 3 | 4
  readonly className?: string
}

export function CapabilityGrid({
  capabilities,
  label,
  columns = 4,
  className,
}: CapabilityGridProps) {
  return (
    <ul
      aria-label={label}
      className={cx('grid grid-cols-1 gap-3', GRID_COLUMNS[columns], className)}
    >
      {capabilities.map((capability) => (
        <li
          key={capability.name}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
        >
          {capability.icon === undefined ? null : (
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface-sunken text-accent [&>svg]:size-4"
            >
              {capability.icon}
            </span>
          )}
          <span className="text-sm font-semibold text-ink">{capability.name}</span>
          <span className="text-xs leading-normal text-ink-muted">
            {capability.evidence}
          </span>
          <SourceLink path={capability.path} className="mt-auto pt-1" />
        </li>
      ))}
    </ul>
  )
}
