import type { ReactNode } from 'react'

import { Text } from '@/components/ui/typography'
import { cx } from '@/lib/utils'

/**
 * A metric's methodology, on demand rather than in the eye path.
 *
 * THE PROBLEM IT SOLVES
 * ---------------------
 * The console's figures were correct and their explanations were exhaustive, and
 * the explanations were rendered beside the figures. Measured on the Executive
 * surface before `UX.1`: 2,636 words of visible prose across 144 paragraphs, of
 * which the longest were not business context but IMPLEMENTATION context — how an
 * order statistic is computed, at which grain the export publishes it, why it
 * cannot be combined upward.
 *
 * Every one of those sentences is true and worth keeping. None of them is what a
 * general manager is reading the chart for, and several of them named the storage
 * engine, which `UX.1`'s copy boundary puts outside the operating eye path
 * entirely.
 *
 * THE RULE THIS ENCODES
 * ---------------------
 * A caption stays VISIBLE when the figure would be MISREAD without it — a
 * project-default threshold, a cohort basis, a denominator that is not the
 * obvious one, a statement that a number is not a valuation. A caption moves in
 * HERE when it explains how the number was produced rather than what it means.
 *
 * The distinction in one line: **a caveat is visible, a mechanism is disclosed.**
 *
 * WHY `<details>` AND NOT A POPOVER
 * ---------------------------------
 * It stays in the accessibility tree's reading order, in a browser text search, in
 * the printed page and in the no-JavaScript rendering, and it needs no focus trap,
 * no escape handler and no positioning logic. It is the same technique every chart
 * on the console already uses for its data table, which also means a reader learns
 * one interaction rather than two.
 */
export function Methodology({
  label = 'How this is measured',
  children,
  className,
}: {
  /**
   * The summary text.
   *
   * Defaults to a phrasing that says what opening it gives you. A vague summary —
   * "learn more", "details" — fails `content-integrity.spec.ts`, and rightly: a
   * reader deciding whether to open something is entitled to know what is inside.
   */
  readonly label?: string
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <details
      className={cx(
        'rounded-lg border border-line-subtle bg-surface-sunken/40',
        className
      )}
    >
      <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {label}
      </summary>
      <div className="flex max-w-prose flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  )
}

/** One paragraph of methodology, at the size the disclosure sets. */
export function MethodologyNote({ children }: { readonly children: ReactNode }) {
  return (
    <Text size="xs" tone="muted">
      {children}
    </Text>
  )
}
