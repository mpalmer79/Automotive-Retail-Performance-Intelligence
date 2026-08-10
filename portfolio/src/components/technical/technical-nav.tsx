import Link from 'next/link'

import {
  TECHNICAL_VIEW_DEFINITIONS,
  technicalHref,
  type TechnicalView,
} from '@/lib/technical'
import { cx } from '@/lib/utils'

/**
 * The technical destination's view navigation.
 *
 * A `<nav>` OF PLAIN LINKS, EXPLICITLY NOT A TAB SET
 * -------------------------------------------------
 * The eight views look like tabs and are not. `role="tablist"` promises a screen
 * reader that arrow keys move between panels inside one document and that
 * activating one does not navigate; both are false here, because each view is a
 * server-rendered state at its own URL. Announcing a set of links as tabs is worse
 * than announcing nothing, so this follows the same pattern the platform and
 * console sub-navigations already use: a labelled `<nav>`, an unordered list of
 * links, and `aria-current="page"` on the current one.
 *
 * The consequence a reader can see: each view is bookmarkable, sharable, works
 * with the back button, opens in a new tab from a middle click and renders with
 * scripting disabled.
 */
export function TechnicalNav({
  current,
  className,
}: {
  readonly current: TechnicalView
  readonly className?: string
}) {
  return (
    <nav aria-label="Technical views" className={className}>
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {TECHNICAL_VIEW_DEFINITIONS.map((entry) => {
          const isCurrent = entry.view === current
          return (
            <li key={entry.view}>
              <Link
                href={technicalHref(entry.view)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cx(
                  'relative flex min-h-touch items-center rounded-md px-3 text-sm',
                  'transition-colors duration-(--arpi-motion-fast)',
                  isCurrent
                    ? 'bg-surface-hover font-semibold text-ink'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                  // A rule under the current label as well as the weight change,
                  // so the state survives greyscale.
                  'after:absolute after:inset-x-3 after:bottom-1 after:h-px after:rounded-pill',
                  isCurrent ? 'after:bg-accent' : 'after:bg-transparent'
                )}
              >
                {entry.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
