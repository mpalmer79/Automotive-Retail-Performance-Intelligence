'use client'

/**
 * InteractiveCard - a card that is itself the control.
 *
 * The static surface lives in `card-static.tsx` and is re-exported here so a
 * consumer that needs both imports from one place.
 *
 * The site deliberately does not use a card for every block of content. A page
 * made entirely of cards has no hierarchy, because each one shouts equally, so
 * cards are reserved for genuinely enumerable, comparable things: an analytical
 * domain, a warehouse entity, a KPI, an evidence record.
 */
import type { ReactNode } from 'react'

import { usePointerPosition, usePrefersReducedMotion } from '@/lib/hooks'
import { cx } from '@/lib/utils'

import { CARD_SURFACE, Card, type CardProps } from './card-static'

export { Card }
export type { CardProps }

const CARD_PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
} as const

export interface InteractiveCardProps {
  children: ReactNode
  className?: string
  padding?: keyof typeof CARD_PADDING
  /** Navigate on activation. Renders an `<a>`. */
  href?: string
  /** Act on activation. Renders a `<button>`. */
  onClick?: () => void
  /** Marks a card acting as a toggle as currently selected. */
  selected?: boolean
  /**
   * The accessible name, for when the card's visible content is not sufficient
   * on its own - a card headed "Sales" wants "Sales analytical domain".
   */
  label?: string
  /** Radio-group semantics, for a card that is one of a set of choices. */
  role?: 'button' | 'radio' | 'tab'
}

/**
 * The pointer highlight is a radial gradient positioned from the pointer,
 * driven by two CSS custom properties updated inside a requestAnimationFrame.
 * It is skipped entirely under reduced motion and never runs on a coarse
 * pointer, so a touch device pays nothing for a hover effect it cannot show.
 *
 * The whole card is one focusable element rather than a card containing links,
 * which avoids the "read the heading, then tab past three redundant links"
 * pattern that nested-interactive cards produce.
 */
export function InteractiveCard({
  children,
  className,
  padding = 'md',
  href,
  onClick,
  selected = false,
  label,
  role,
}: InteractiveCardProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const { ref, position } = usePointerPosition<HTMLElement>(!prefersReducedMotion)

  const highlightStyle: React.CSSProperties | undefined =
    position && !prefersReducedMotion
      ? {
          backgroundImage:
            'radial-gradient(220px circle at var(--pointer-x) var(--pointer-y), color-mix(in oklab, var(--color-accent) 12%, transparent), transparent 70%)',
          ['--pointer-x' as string]: `${String(Math.round(position.x * 100))}%`,
          ['--pointer-y' as string]: `${String(Math.round(position.y * 100))}%`,
        }
      : undefined

  const classes = cx(
    CARD_SURFACE,
    CARD_PADDING[padding],
    'group/card block w-full text-left',
    'transition-[border-color,background-color,translate] duration-(--arpi-motion-base)',
    'ease-(--arpi-ease-standard)',
    'hover:border-line-strong hover:bg-surface-hover/70',
    // A one-pixel rise: enough to register as a response, small enough that a
    // grid of twelve cards does not appear to breathe.
    'hover:-translate-y-px',
    selected && 'border-accent-muted bg-accent-wash/45 hover:border-accent',
    className
  )

  const inner = (
    <>
      {highlightStyle ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-(--arpi-motion-base) group-hover/card:opacity-100"
          style={highlightStyle}
        />
      ) : null}
      <span className="relative block">{children}</span>
    </>
  )

  if (href) {
    return (
      <a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        className={classes}
        aria-label={label}
      >
        {inner}
      </a>
    )
  }

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      className={classes}
      aria-label={label}
      role={role}
      aria-pressed={role === undefined || role === 'button' ? selected : undefined}
      aria-checked={role === 'radio' ? selected : undefined}
      aria-selected={role === 'tab' ? selected : undefined}
    >
      {inner}
    </button>
  )
}
