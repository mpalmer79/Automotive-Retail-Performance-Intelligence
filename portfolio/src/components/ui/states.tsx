/**
 * EmptyState, LockedState, SkipLink and Breadcrumbs.
 *
 * EmptyState and LockedState exist because the two are not the same thing and
 * are constantly conflated. An empty state means "your filters matched nothing,
 * here is how to widen them". A locked state means "this content deliberately
 * does not exist yet, here is the condition that gates it and here is what you
 * can read instead". A "Coming soon" panel is neither, and the site has none.
 */
import { Lock, SearchX } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

import { Card } from './card-static'
import { Heading, Text } from './typography'

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Nothing matched.
 *
 * Rendered inside a `role="status"` region with `aria-live="polite"` so that a
 * screen-reader user filtering a list is told the result count changed to zero.
 * Without that, the list simply goes silent.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description: string
  /** The way out. An empty state with no way out is a dead end. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'flex flex-col items-center gap-4 rounded-xl border border-dashed border-line-strong',
        'bg-surface-sunken/50 px-6 py-14 text-center',
        className
      )}
    >
      <SearchX aria-hidden="true" className="size-7 text-ink-faint" strokeWidth={1.75} />
      <div className="flex flex-col gap-2">
        <Heading level={3} size="h5">
          {title}
        </Heading>
        <Text size="sm" tone="muted" className="mx-auto max-w-md">
          {description}
        </Text>
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* LockedState                                                                 */
/* -------------------------------------------------------------------------- */

export interface LockedStateProps {
  title: string
  /** Why the content is gated. Specific, never "we are working on it". */
  reason: string
  /** The conditions that would unlock it, each one checkable. */
  conditions: readonly { readonly label: string; readonly met: boolean }[]
  /** Where the reader should go instead. Never omitted. */
  alternatives: ReactNode
  className?: string
}

/**
 * Content that deliberately does not exist yet.
 *
 * The conditions list renders met and unmet with different icons AND different
 * text, so it is legible without colour, and it never shows a date. A predicted
 * unlock date on a gate whose conditions depend on external validation would be
 * a guess dressed as a commitment.
 */
export function LockedState({
  title,
  reason,
  conditions,
  alternatives,
  className,
}: LockedStateProps) {
  return (
    <Card
      tone="pending"
      padding="lg"
      className={cx('flex flex-col gap-6', className)}
      as="section"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-pending/40 bg-pending-wash"
          >
            <Lock className="size-4 text-pending" strokeWidth={2.25} />
          </span>
          <Heading level={2} size="h4">
            {title}
          </Heading>
        </div>
        <Text size="body" className="max-w-prose">
          {reason}
        </Text>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="eyebrow text-2xs">Unlock conditions</h3>
        <ul className="flex flex-col gap-2.5">
          {conditions.map((condition) => (
            <li key={condition.label} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cx(
                  'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs leading-none',
                  condition.met
                    ? 'border-verified/50 bg-verified-wash text-verified'
                    : 'border-line-strong bg-surface-sunken text-ink-faint'
                )}
              >
                {condition.met ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-normal text-ink-secondary">
                <span className="sr-only">
                  {condition.met ? 'Condition met: ' : 'Condition not met: '}
                </span>
                {condition.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-pending/20 pt-5">{alternatives}</div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* SkipLink                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Skip to main content.
 *
 * Visible only on focus, positioned over the header rather than shifting it, and
 * the first focusable element in the document. Its target is `#main-content`,
 * which the root layout puts on the `<main>` element.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={cx(
        'sr-only-focusable',
        'fixed top-3 left-3 z-(--arpi-z-skiplink) inline-flex min-h-touch items-center',
        'rounded-lg bg-accent px-4 text-base font-semibold text-ink-inverse shadow-lg'
      )}
    >
      Skip to main content
    </a>
  )
}

/* -------------------------------------------------------------------------- */
/* Breadcrumbs                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The trail back to the overview.
 *
 * A real `<nav>` with an ordered list, and the current page marked with
 * `aria-current="page"` rather than merely styled differently. The separators are
 * `aria-hidden`, so the trail is announced as three links and not as
 * "Overview slash Architecture".
 */
export function Breadcrumbs({
  trail,
  className,
}: {
  trail: readonly { readonly href: string; readonly label: string }[]
  className?: string
}) {
  const last = trail.length - 1
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {trail.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center gap-2">
            {index === last ? (
              <span aria-current="page" className="font-medium text-ink-secondary">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="text-ink-faint transition-colors hover:text-accent"
              >
                {crumb.label}
              </Link>
            )}
            {index !== last ? (
              <span aria-hidden="true" className="text-ink-faint/60">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}
