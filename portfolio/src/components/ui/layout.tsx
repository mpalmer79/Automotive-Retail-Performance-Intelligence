/**
 * Layout primitives: Container, Section, Stack, Cluster, Grid, Prose.
 *
 * These five components own every horizontal constraint and every vertical
 * rhythm on the site. A page composes them; it does not set its own max-width or
 * its own section padding, which is what keeps the page rhythm consistent
 * across eight routes written at different times.
 *
 * All are server components. None carries interaction.
 */
import type { ElementType, ReactNode } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Container                                                                   */
/* -------------------------------------------------------------------------- */

const CONTAINER_WIDTH = {
  narrow: 'max-w-narrow',
  content: 'max-w-content',
  wide: 'max-w-wide',
  /* `max-w-bleed`, not `max-w-full`: `full` is a Tailwind keyword meaning 100%,
     and a --container-full token would override it site-wide. See theme.css. */
  full: 'max-w-bleed',
} as const

export interface ContainerProps {
  children: ReactNode
  /**
   * `narrow` for reading copy, `content` for most pages, `wide` for diagrams and
   * data tables, `full` for the widest layout (96rem). Defaults to `content`.
   */
  width?: keyof typeof CONTAINER_WIDTH
  className?: string
  as?: ElementType
}

/**
 * The horizontal constraint. Gutter padding is fluid, so a 320px phone gets
 * 20px of edge and a large desktop gets 48px, without a breakpoint jump.
 */
export function Container({
  children,
  width = 'content',
  className,
  as: Tag = 'div',
}: ContainerProps) {
  return (
    <Tag className={cx('mx-auto w-full px-gutter', CONTAINER_WIDTH[width], className)}>
      {children}
    </Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export interface SectionProps {
  children: ReactNode
  /** Rendered as the section's accessible name via aria-labelledby. */
  id?: string
  className?: string
  /** `tight` for a subsection, `default` for a page section. */
  rhythm?: 'tight' | 'default' | 'none'
  /** A hairline top border, for a hard section boundary. */
  bordered?: boolean
  as?: ElementType
}

const RHYTHM = {
  none: '',
  tight: 'py-section-tight',
  default: 'py-section',
} as const

/** Vertical rhythm and the optional section boundary rule. */
export function Section({
  children,
  id,
  className,
  rhythm = 'default',
  bordered = false,
  as: Tag = 'section',
}: SectionProps) {
  return (
    <Tag
      id={id}
      className={cx(
        'relative',
        RHYTHM[rhythm],
        bordered && 'border-t border-line-subtle',
        className
      )}
    >
      {children}
    </Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Stack and Cluster                                                           */
/* -------------------------------------------------------------------------- */

const GAP = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
  16: 'gap-16',
} as const

export type GapStep = keyof typeof GAP

export interface StackProps {
  children: ReactNode
  gap?: GapStep
  className?: string
  as?: ElementType
  align?: 'start' | 'center' | 'end' | 'stretch'
}

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const

/** Vertical flow with a single consistent gap. */
export function Stack({
  children,
  gap = 4,
  className,
  as: Tag = 'div',
  align = 'stretch',
}: StackProps) {
  return (
    <Tag className={cx('flex flex-col', GAP[gap], ALIGN[align], className)}>
      {children}
    </Tag>
  )
}

export interface ClusterProps extends StackProps {
  justify?: 'start' | 'center' | 'end' | 'between'
  wrap?: boolean
}

const JUSTIFY = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const

/**
 * Horizontal flow that wraps. Used for badge rows, button pairs and filter
 * chips - anywhere a row of items must survive a 320px viewport by wrapping
 * rather than by overflowing.
 */
export function Cluster({
  children,
  gap = 3,
  className,
  as: Tag = 'div',
  align = 'center',
  justify = 'start',
  wrap = true,
}: ClusterProps) {
  return (
    <Tag
      className={cx(
        'flex',
        wrap && 'flex-wrap',
        GAP[gap],
        ALIGN[align],
        JUSTIFY[justify],
        className
      )}
    >
      {children}
    </Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Grid                                                                        */
/* -------------------------------------------------------------------------- */

export interface GridProps {
  children: ReactNode
  /**
   * Desktop column count. Mobile is always one column and the intermediate
   * step is derived, because every layout on this site stacks on a phone.
   */
  columns?: 2 | 3 | 4 | 6 | 12
  gap?: GapStep
  className?: string
  as?: ElementType
}

const COLUMNS = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
  12: 'grid-cols-4 md:grid-cols-8 lg:grid-cols-12',
} as const

/** The responsive grid. `columns={12}` is the editorial desktop grid. */
export function Grid({
  children,
  columns = 3,
  gap = 6,
  className,
  as: Tag = 'div',
}: GridProps) {
  return (
    <Tag className={cx('grid', COLUMNS[columns], GAP[gap], className)}>{children}</Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Prose                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A reading measure. Caps the line length in characters rather than pixels, so
 * it stays correct at 200% zoom and on an ultrawide display, which a pixel
 * max-width does not.
 */
export function Prose({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cx('max-w-prose', className)}>{children}</div>
}
