/**
 * Card - the static container surface.
 *
 * Kept in its own module, separate from `InteractiveCard`, so that a server
 * component can render a card without pulling the pointer-tracking client
 * bundle in with it. That split is worth a file: `Card` appears on every route,
 * `InteractiveCard` on three, and merging them would make every route pay for
 * the interaction.
 *
 * Dark-theme elevation here is a lightening border plus a contained shadow plus
 * a one-pixel inset top highlight - not a large soft drop shadow, which on a
 * near-black ground reads as a smudge rather than as height.
 */
import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from '@/lib/utils'

export const CARD_SURFACE = cx(
  'relative rounded-xl border border-line bg-surface/85',
  'shadow-sm inset-shadow-top'
)

const CARD_PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
} as const

const CARD_TONE = {
  default: '',
  sunken: 'bg-surface-sunken/70',
  accent: 'border-accent-muted/40 bg-accent-wash/35',
  pending: 'border-pending/30 bg-pending-wash/30',
  model: 'border-model/25 bg-model-wash/30',
} as const

/**
 * Pass-through props are forwarded. Without this the component silently swallowed
 * `aria-live` on the governance page's trust-framework panel, so the panel changed
 * without announcing itself - a defect that no type error and no visual check
 * would have surfaced.
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  children: ReactNode
  className?: string
  /** `none` when the card's children manage their own padding. */
  padding?: keyof typeof CARD_PADDING
  tone?: keyof typeof CARD_TONE
  as?: 'div' | 'article' | 'li' | 'section' | 'aside'
}

export function Card({
  children,
  className,
  padding = 'md',
  tone = 'default',
  as: Tag = 'div',
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(CARD_SURFACE, CARD_PADDING[padding], CARD_TONE[tone], className)}
      {...rest}
    >
      {children}
    </Tag>
  )
}
