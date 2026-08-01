/**
 * Typography primitives: Heading, Text, Eyebrow, CodeLabel, GrainLabel.
 *
 * The site's type register is enforced here rather than by convention:
 *   - the display face is available only to Heading levels 1 and 2
 *   - the monospace face is available only to CodeLabel and GrainLabel
 *   - body copy has exactly two sizes
 *
 * Heading takes `level` (the semantic level, which determines the tag) and
 * `size` (the visual weight) separately, so a page can keep a correct heading
 * hierarchy without being forced into a visual one. That separation is what
 * makes "one h1 per page, no skipped levels" achievable in a design with
 * varying section prominence.
 */
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Heading                                                                     */
/* -------------------------------------------------------------------------- */

const HEADING_SIZE = {
  /**
   * The home page's h1, and nothing else. Its own type step rather than the 5xl
   * one, because the redesigned headline is a longer sentence than the one it
   * replaced and has to fit a 320px screen without becoming five lines.
   */
  hero: 'font-display text-hero font-bold leading-tight tracking-tighter',
  display: 'font-display text-4xl font-semibold leading-tight tracking-tighter',
  h2: 'font-display text-3xl font-semibold leading-snug tracking-tight',
  h3: 'text-2xl font-semibold leading-snug tracking-tight',
  h4: 'text-xl font-semibold leading-snug tracking-tight',
  h5: 'text-lg font-semibold leading-normal',
  h6: 'text-base font-semibold leading-normal',
} as const

export interface HeadingProps {
  children: ReactNode
  /** The semantic level. Determines the tag, and nothing else. */
  level: 1 | 2 | 3 | 4 | 5 | 6
  /** The visual treatment. Defaults to the level's natural size. */
  size?: keyof typeof HEADING_SIZE
  /** Muted colour, for a subordinate heading in a dense panel. */
  tone?: 'default' | 'muted'
  id?: string
  className?: string
}

const NATURAL_SIZE: Record<1 | 2 | 3 | 4 | 5 | 6, keyof typeof HEADING_SIZE> = {
  1: 'display',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
}

export function Heading({
  children,
  level,
  size,
  tone = 'default',
  id,
  className,
}: HeadingProps) {
  const Tag = `h${String(level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  return (
    <Tag
      id={id}
      className={cx(
        HEADING_SIZE[size ?? NATURAL_SIZE[level]],
        tone === 'muted' ? 'text-ink-secondary' : 'text-ink',
        className
      )}
    >
      {children}
    </Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

const TEXT_SIZE = {
  /** Reading copy. 17px. */
  body: 'text-body leading-relaxed',
  /** UI default. 15px. */
  base: 'text-base leading-normal',
  /** Dense contexts - table cells, card metadata. 13px. */
  sm: 'text-sm leading-normal',
  /** Metadata and captions. 12px. */
  xs: 'text-xs leading-normal',
} as const

const TEXT_TONE = {
  default: 'text-ink-secondary',
  secondary: 'text-ink-secondary',
  strong: 'text-ink',
  muted: 'text-ink-muted',
  faint: 'text-ink-faint',
  accent: 'text-accent',
} as const

export interface TextProps {
  children: ReactNode
  size?: keyof typeof TEXT_SIZE
  tone?: keyof typeof TEXT_TONE
  className?: string
  as?: 'p' | 'span' | 'div' | 'dd' | 'dt' | 'li' | 'figcaption'
  id?: string
}

export function Text({
  children,
  size = 'base',
  tone = 'default',
  className,
  as: Tag = 'p',
  id,
}: TextProps) {
  return (
    <Tag id={id} className={cx(TEXT_SIZE[size], TEXT_TONE[tone], className)}>
      {children}
    </Tag>
  )
}

/* -------------------------------------------------------------------------- */
/* Eyebrow                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The small tracked-out label above a section heading. Rendered as a `<p>` by
 * default rather than as a heading, because it is a label for the heading that
 * follows and adding it to the heading outline would make the outline read as a
 * duplicate of itself.
 */
export function Eyebrow({
  children,
  className,
  tone = 'muted',
  rule = false,
}: {
  children: ReactNode
  className?: string
  tone?: 'muted' | 'accent'
  /**
   * Draw the short rule before the label.
   *
   * Opt-in, and it was not. Every eyebrow on the site carried the rule, which at
   * nine homepage sections plus every page header made it a tic rather than a
   * mark - finding D-01. It now belongs to the two components that open a major
   * block, `SectionHeader` and `PageHeader`, and an eyebrow inside a panel or a
   * card is a plain label.
   */
  rule?: boolean
}) {
  return (
    <p
      className={cx(
        'eyebrow',
        tone === 'accent' && 'text-accent',
        rule && 'flex items-center gap-2.5',
        className
      )}
    >
      {rule ? (
        // Decorative, and hidden from the accessibility tree so a screen reader
        // hears only the words.
        <span
          aria-hidden="true"
          className={cx(
            'inline-block h-px w-6 shrink-0',
            tone === 'accent' ? 'bg-accent' : 'bg-line-strong'
          )}
        />
      ) : null}
      {children}
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* CodeLabel                                                                   */
/* -------------------------------------------------------------------------- */

const CODE_TONE = {
  default: 'text-ink-secondary bg-surface-sunken border-line-subtle',
  accent: 'text-accent bg-accent-wash border-accent-muted/40',
  model: 'text-model bg-model-wash border-model/25',
  bare: 'text-ink-secondary bg-transparent border-transparent px-0',
} as const

/**
 * A technical identifier: a KPI ID, a schema-qualified table name, a column
 * name, a file path, a DAX measure name.
 *
 * Rendered as `<code>`, so assistive technology announces it as code rather
 * than as prose, and so an identifier containing an underscore is never read as
 * an English word.
 */
export function CodeLabel({
  children,
  tone = 'default',
  className,
  title,
}: {
  children: ReactNode
  tone?: keyof typeof CODE_TONE
  className?: string
  title?: string
}) {
  return (
    <code
      title={title}
      className={cx(
        // `inline`, NOT `inline-flex`. An inline-flex box sizes to max-content, so
        // `break-all` has no effect on it and a long schema-qualified identifier
        // widens the page instead of wrapping. Plain inline flow breaks correctly
        // and still accepts the padding and border.
        'inline rounded-sm border px-1.5 py-0.5 font-mono text-xs break-all',
        CODE_TONE[tone],
        className
      )}
    >
      {children}
    </code>
  )
}

/* -------------------------------------------------------------------------- */
/* GrainLabel                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A fact or dimension's declared grain, presented prominently.
 *
 * Grain gets its own component because it is the single most important fact
 * about a fact table, and a design that renders it as ordinary body copy is
 * hiding the thing a reviewer most wants to see.
 */
export function GrainLabel({ grain, className }: { grain: string; className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-col gap-1 rounded-md border border-accent-muted/35 bg-accent-wash/45 px-3 py-2',
        className
      )}
    >
      <span className="eyebrow text-2xs text-accent">Declared grain</span>
      <span className="font-mono text-xs leading-normal text-ink">{grain}</span>
    </div>
  )
}
