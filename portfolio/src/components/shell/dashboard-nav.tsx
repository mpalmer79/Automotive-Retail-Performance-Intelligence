'use client'

/**
 * DashboardNav — the console's internal navigation.
 *
 * Follows `PlatformNav` exactly, and for the same reason: it moves between
 * documents rather than switching panels inside one, so `role="tablist"` would be
 * a lie to assistive technology. A `<nav>` of plain links with `aria-current` is
 * what it actually is, and every destination is a server-rendered `<a>`, so
 * back/forward, open-in-new-tab and copy-link all behave.
 *
 * ONE DESTINATION TODAY, AND THAT IS THE HONEST STATE.
 * `INFORMATION_ARCHITECTURE.md` §1 lists ten console routes and `DASH.2` builds
 * one. The other nine are named on the page as text, with the increment that
 * delivers each; they are deliberately not here, because a navigation item that
 * goes nowhere is worse than a navigation bar with one item in it.
 *
 * The IA's mobile presentation for this bar is a native `<details>` disclosure, so
 * that ten destinations never render as a horizontally scrolling strip. With one
 * item that would be a disclosure a reader has to open to find the page they are
 * already on. The wrapping row below cannot overflow at 320px at this length; the
 * disclosure arrives with the increment that makes the list long enough to need
 * it, and `INFORMATION_ARCHITECTURE.md` records the divergence.
 *
 * Client, because the current item comes from the pathname. No state, no effect,
 * no listener — and no data: nothing in this component or its imports can reach
 * the generated dashboard tree.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { DASHBOARD_NAV, isNavItemCurrent } from '@/lib/site'
import { cx } from '@/lib/utils'

export function DashboardNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Dashboard" className={className}>
      <ul
        className={cx(
          'inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl',
          'border border-line bg-surface-sunken/70 p-1'
        )}
      >
        {DASHBOARD_NAV.map((item) => {
          const current = isNavItemCurrent(item, pathname)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-9 items-center rounded-lg px-3.5 text-base',
                  'transition-colors duration-(--arpi-motion-fast)',
                  current
                    ? 'bg-surface-raised font-semibold text-ink shadow-sm inset-shadow-top'
                    : 'font-medium text-ink-muted hover:text-ink-secondary'
                )}
              >
                {item.label}
                {current ? <span className="sr-only"> (current page)</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
