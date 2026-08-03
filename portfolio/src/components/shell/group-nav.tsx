'use client'

/**
 * GroupNav - the sub-navigation that makes "Dealerships" a destination group.
 *
 * Rendered by `/dealerships`, the three store pages and `/inventory`, directly
 * under each page's heading block. It is the same device as `<PlatformNav>` and
 * exists for the same reason: a visitor who arrives at one store should be able
 * to see, without scrolling, that the other two and the inventory explorer are
 * one click away. It is also what keeps the header at seven items rather than
 * eleven.
 *
 * Client, because the current item comes from the pathname. Nothing else in it
 * is interactive.
 *
 * A `<nav>` with `aria-current`, not a tablist. It navigates between documents
 * rather than switching panels inside one, and claiming otherwise would be a lie
 * to assistive technology.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { GROUP_NAV, isNavItemCurrent } from '@/lib/site'
import { cx } from '@/lib/utils'

export function GroupNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Granite Auto Group" className={className}>
      <ul
        className={cx(
          'inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl',
          'border border-line bg-surface-sunken/70 p-1'
        )}
      >
        {GROUP_NAV.map((item) => {
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
