/**
 * A disclosure: `<details>` and `<summary>`, styled once.
 *
 * WHY IT IS NATIVE AND NOT A CUSTOM CONTROL
 * -----------------------------------------
 * A hand-built disclosure needs `aria-expanded`, `aria-controls`, a keyboard
 * handler, focus management and state - and it needs JavaScript, which means its
 * contents are either absent from the server-rendered document or present and
 * invisible with no way to reveal them if a script fails. `<details>` needs none
 * of that. The contents are in the HTML, the expanded state is communicated to
 * assistive technology by the element itself, Enter and Space work, and it opens
 * with scripting disabled.
 *
 * The site already used raw `<details>` for the chart table alternatives. This
 * is that markup with the styling and the print rule stated once, so a
 * disclosure added later cannot quietly get a different affordance.
 *
 * WHAT MAY AND MAY NOT GO INSIDE ONE
 * ----------------------------------
 * Supplemental reasoning: why a decision was made, the longer form of an
 * argument the visible text has already stated in one line.
 *
 * NOT anything that qualifies how a reader should interpret the artefact beside
 * it. The fictional-entity notice, the sanitized-data statement, Gate 2 status,
 * the case-study lock and the "listings are not sales" boundary all stay
 * visible without interaction, because a caveat a reader has to open is a caveat
 * the page is hoping they will not read.
 *
 * THE LABEL IS THE CONTRACT
 * -------------------------
 * A summary reading "Learn more" tells a reader nothing about whether opening it
 * is worth the click, so every label on this site names the question its
 * contents answer - "Why these stores cannot share one operating model" rather
 * than "More detail". `tests/e2e/content-integrity.spec.ts` asserts no vague
 * label reaches the site.
 *
 * A server component. No state, no JavaScript.
 */
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

export interface DisclosureProps {
  /**
   * The summary label. Name the question the contents answer; do not write
   * "Learn more", "Read more", "Details" or "More".
   */
  readonly label: string
  readonly children: ReactNode
  /** Opens on load. For a disclosure whose contents are usually wanted. */
  readonly defaultOpen?: boolean
  readonly className?: string
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  className,
}: DisclosureProps) {
  return (
    <details
      open={defaultOpen}
      className={cx(
        'group border-t border-line-subtle',
        // Printed pages have no interaction, so every disclosure is opened for
        // print by the rule in globals.css. This class is the hook for it.
        'arpi-disclosure',
        className
      )}
    >
      <summary
        className={cx(
          'flex min-h-touch cursor-pointer list-none items-center gap-2 py-3',
          'text-sm font-medium text-ink-secondary',
          'transition-colors duration-(--arpi-motion-fast) hover:text-accent',
          // The default triangle is removed in both engines that draw one, so
          // the chevron below is the only marker and it can be positioned.
          '[&::-webkit-details-marker]:hidden'
        )}
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2}
          className="size-4 shrink-0 text-ink-faint transition-transform duration-(--arpi-motion-fast) group-open:rotate-90"
        />
        {label}
      </summary>
      <div className="flex flex-col gap-4 pb-5 pl-6">{children}</div>
    </details>
  )
}
