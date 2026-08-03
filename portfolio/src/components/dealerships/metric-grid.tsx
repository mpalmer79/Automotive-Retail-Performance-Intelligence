/**
 * The derived-metric grid.
 *
 * Every figure the dealership and inventory pages show goes through this
 * component, and the rule it enforces is the one the whole section rests on: a
 * metric whose value is `null` IS NOT RENDERED. Not as a dash, not as "n/a", not
 * as zero.
 *
 * That matters because the three stores' source workbooks expose different
 * things. The independent store's public source published a price for fewer than
 * a tenth of its listings, so a median price for it would be a median of the
 * priced tenth presented as though it described the lot. Dropping the tile is the
 * honest rendering; a dash invites the reader to assume the number exists and is
 * merely missing today.
 *
 * Callers therefore pass `value: string | null` and let the grid decide, rather
 * than deciding at each call site whether to include the tile.
 */
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

export interface Metric {
  readonly label: string
  /** `null` removes the tile entirely. See the note above. */
  readonly value: string | null
  /** One short line under the value. Never a second figure. */
  readonly detail?: ReactNode
}

export interface MetricGridProps {
  readonly metrics: readonly Metric[]
  /** Columns at the widest breakpoint. */
  readonly columns?: 2 | 3 | 4
  /** `lg` for the group-level snapshot, `sm` inside a card. */
  readonly size?: 'sm' | 'md' | 'lg'
  readonly className?: string
}

const COLUMNS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
} as const

const VALUE_SIZE = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'font-display text-3xl tracking-tighter',
} as const

export function MetricGrid({
  metrics,
  columns = 4,
  size = 'md',
  className,
}: MetricGridProps) {
  const present = metrics.filter((metric) => metric.value !== null)
  if (present.length === 0) return null

  return (
    <dl className={cx('grid gap-x-6 gap-y-5', COLUMNS[columns], className)}>
      {present.map((metric) => (
        <div key={metric.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs leading-normal font-medium text-ink-muted">
            {metric.label}
          </dt>
          <dd
            className={cx(
              'numeric font-semibold text-ink',
              VALUE_SIZE[size],
              // A long formatted range ("$8,500 to $109,674") must wrap rather
              // than set the grid column's minimum width.
              'break-words'
            )}
          >
            {metric.value}
          </dd>
          {metric.detail ? (
            <dd className="text-xs leading-normal text-ink-faint">{metric.detail}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  )
}
