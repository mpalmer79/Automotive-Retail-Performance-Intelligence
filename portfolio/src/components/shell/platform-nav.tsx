'use client'

/**
 * PlatformNav — the sub-navigation that makes "Platform" a real destination.
 *
 * Rendered by `/architecture`, `/data-model` and `/governance`, directly under
 * each page's heading block. It is the whole reason the primary navigation could
 * drop from seven items to five without hiding anything: a visitor who arrives
 * at Architecture from "Platform" can see, without scrolling, that the data
 * model and the governance rules are two clicks that belong with it.
 *
 * Rejected alternatives are recorded in `lib/site.ts` above `PRIMARY_NAV` and in
 * EXPERIENCE_REDESIGN_V2.md section 3.1. The short version: a header disclosure
 * menu costs a focus trap and a hover ambiguity to replace two links, and a
 * `/platform` overview route would be a page whose only content is links to two
 * better pages.
 *
 * Client, because the current item comes from the pathname. Nothing else in it
 * is interactive; there is no state, no effect and no listener.
 *
 * Presented as a segmented rail rather than as tabs. It navigates between
 * documents rather than switching panels within one, so `role="tablist"` would
 * be a lie to assistive technology - `<nav>` with `aria-current` is what it
 * actually is.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PLATFORM_NAV, isNavItemCurrent } from '@/lib/site'
import { cx } from '@/lib/utils'

export function PlatformNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Platform" className={className}>
      <ul
        className={cx(
          'inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl',
          'border border-line bg-surface-sunken/70 p-1'
        )}
      >
        {PLATFORM_NAV.map((item) => {
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
