/**
 * Badge, StatusBadge and KpiChip.
 *
 * StatusBadge is the most load-bearing component on the site. Every claim about
 * what is finished, pending, blocked or deferred passes through it, and it is
 * built so that a status cannot be communicated by colour alone: each badge
 * renders an icon AND a word, and the icon differs per status rather than only
 * changing hue. Remove all colour and the badge still reads correctly - which is
 * both the WCAG 1.4.1 requirement and the honest way to show a project whose
 * central fact is that something has not been validated yet.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  LoaderCircle,
  Lock,
  PauseCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { statusPresentation } from '@/lib/manifest'
import { cx } from '@/lib/utils'
import type { StatusLevel } from '@/types/manifest'

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

const BADGE_TONE = {
  neutral: 'border-line bg-surface-sunken/80 text-ink-muted',
  accent: 'border-accent-muted/45 bg-accent-wash text-accent',
  model: 'border-model/30 bg-model-wash text-model',
  verified: 'border-verified/35 bg-verified-wash text-verified',
  pending: 'border-pending/35 bg-pending-wash text-pending',
  blocked: 'border-blocked/35 bg-blocked-wash text-blocked',
  deferred: 'border-line-strong bg-deferred-wash text-deferred',
  failed: 'border-failed/35 bg-failed-wash text-failed',
} as const

export type BadgeTone = keyof typeof BADGE_TONE

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  /** Icon rendered before the label. Decorative. */
  icon?: ReactNode
  className?: string
  /** Monospace, for a badge holding an identifier. */
  mono?: boolean
}

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
  mono = false,
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs leading-none',
        mono ? 'font-mono' : 'font-medium',
        BADGE_TONE[tone],
        className
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* StatusBadge                                                                 */
/* -------------------------------------------------------------------------- */

const STATUS_ICON = {
  check: CheckCircle2,
  progress: LoaderCircle,
  clock: Clock,
  lock: Lock,
  pause: PauseCircle,
  circle: Circle,
  alert: AlertTriangle,
} as const

export interface StatusBadgeProps {
  status: StatusLevel
  /**
   * Override the label. Used where a status needs a domain-specific wording -
   * "No page exists" rather than "Blocked" - while keeping the same icon,
   * colour and semantics.
   */
  label?: string
  className?: string
  size?: 'sm' | 'md'
}

/**
 * A status, rendered as an icon plus a word.
 *
 * The icon for `in-progress` is a static ring, not a spinner: an endlessly
 * rotating icon on a status page is decorative motion on a page whose entire
 * job is to be read carefully.
 */
export function StatusBadge({ status, label, className, size = 'md' }: StatusBadgeProps) {
  const presentation = statusPresentation(status)
  const Icon = STATUS_ICON[presentation.icon]
  const text = label ?? presentation.label

  return (
    <span
      data-status={status}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill border font-semibold leading-none',
        size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1.5 text-xs',
        BADGE_TONE[presentation.tone],
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cx('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5')}
        strokeWidth={2.25}
      />
      {text}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* KpiChip                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A KPI identifier shown as a compact chip, optionally linking to its entry in
 * the catalogue.
 *
 * The chip shows the ID and never a value. There are no KPI values anywhere on
 * this site: the semantic model has never been evaluated by an engine, so any
 * number here would be invented.
 */
export function KpiChip({
  id,
  name,
  href,
  className,
}: {
  id: string
  /** Included in the accessible name so the chip does not read as a code alone. */
  name?: string
  href?: string
  className?: string
}) {
  const body = (
    <>
      <span className="font-mono text-2xs tracking-wide">{id}</span>
      {name ? <span className="sr-only"> - {name}</span> : null}
    </>
  )

  const classes = cx(
    'inline-flex items-center rounded-sm border border-line bg-surface-sunken/80 px-1.5 py-0.5 text-ink-muted',
    href &&
      'transition-colors duration-(--arpi-motion-fast) hover:border-accent-muted hover:bg-accent-wash hover:text-accent',
    className
  )

  if (href) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    )
  }
  return <span className={classes}>{body}</span>
}
