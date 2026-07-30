'use client'

/**
 * The site header: wordmark, primary navigation, the case-study state, and the
 * mobile drawer.
 *
 * Client, because the active-route indicator needs the pathname and the drawer
 * needs state. Everything inside it that could be static is - the wordmark is an
 * inline SVG, the links are `next/link`, and no data is fetched.
 *
 * Accessibility decisions worth naming:
 *   - The active link is marked `aria-current="page"`, not merely coloured.
 *   - The drawer traps focus, closes on Escape, closes on route change, locks
 *     the body scroll and returns focus to the trigger.
 *   - The desktop navigation is not hidden with `display: none` on mobile and
 *     then duplicated - it is one list, rendered once, moved by CSS - so there
 *     is no set of links that exists in the DOM but cannot be reached.
 */
import { FolderGit2, Lock, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'

import { Wordmark } from '@/components/brand/logo'
import { IconButton } from '@/components/ui/button'
import { useEscapeKey, useFocusTrap, useScrollLock } from '@/lib/hooks'
import { caseStudyUnlocked } from '@/lib/manifest'
import { PRIMARY_NAV, REPOSITORY_URL, ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

export function SiteHeader() {
  const pathname = usePathname()

  /*
   * The drawer's open state is stored as THE ROUTE IT WAS OPENED ON, not as a
   * boolean. It is therefore open only while the visitor is still on that route,
   * so navigating closes it without an effect.
   *
   * The obvious version - a boolean plus `useEffect(() => setOpen(false),
   * [pathname])` - works, but it sets state inside an effect body, which means an
   * extra render on every navigation and a lint error that is right to fire.
   * Deriving the state from the value that should control it is both smaller and
   * correct by construction.
   */
  const [openedOnRoute, setOpenedOnRoute] = useState<string | null>(null)
  const drawerOpen = openedOnRoute === pathname

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      setOpenedOnRoute(open ? pathname : null)
    },
    [pathname]
  )

  const drawerRef = useFocusTrap<HTMLDivElement>(drawerOpen)

  useScrollLock(drawerOpen)
  useEscapeKey(drawerOpen, () => setDrawerOpen(false))

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    /*
     * The scrim and the drawer are SIBLINGS of <header>, not children of it.
     *
     * The header carries `backdrop-filter`, and a backdrop-filter makes an element
     * the containing block for every `position: fixed` descendant. While the scrim
     * lived inside the header, its `top: 4rem; bottom: 0` resolved against the
     * header's own 64px box rather than against the viewport - so it computed to
     * zero height, covered nothing, and could not be clicked. The drawer only
     * looked correct by coincidence, because its top offset happened to equal the
     * header's height.
     *
     * This is invisible in a screenshot: the drawer painted exactly where it was
     * meant to, and the only symptom was that clicking outside it did nothing.
     */
    <>
      <header
        className={cx(
          'sticky top-0 z-(--arpi-z-header) w-full',
          'border-b border-line-subtle bg-canvas/85 backdrop-blur-[14px]',
          'supports-[backdrop-filter]:bg-canvas/70'
        )}
      >
        <div className="mx-auto flex h-header w-full max-w-full items-center gap-4 px-gutter">
          <Link
            href="/"
            className="shrink-0 rounded-md"
            aria-label="ARPI - Automotive Retail Performance Intelligence, home"
          >
            <Wordmark />
          </Link>

          {/* Desktop navigation */}
          <nav aria-label="Primary" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-0.5">
              {PRIMARY_NAV.map((route) => (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    aria-current={isActive(route.href) ? 'page' : undefined}
                    className={cx(
                      'relative flex min-h-touch items-center rounded-md px-3 text-base font-medium',
                      'transition-colors duration-(--arpi-motion-fast)',
                      isActive(route.href)
                        ? 'text-ink'
                        : 'text-ink-muted hover:text-ink-secondary',
                      // The active indicator: a short rule under the label. Present
                      // in addition to the colour change, so it survives greyscale.
                      'after:absolute after:inset-x-3 after:bottom-1.5 after:h-px after:rounded-full',
                      'after:transition-colors after:duration-(--arpi-motion-base)',
                      isActive(route.href) ? 'after:bg-accent' : 'after:bg-transparent'
                    )}
                  >
                    {route.navLabel}
                  </Link>
                </li>
              ))}
              <li className="ml-2">
                <CaseStudyNavLink active={isActive(ROUTES.caseStudy.href)} />
              </li>
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-3">
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cx(
                'inline-flex size-touch items-center justify-center rounded-lg',
                'text-ink-muted transition-colors duration-(--arpi-motion-fast)',
                'hover:bg-surface-hover hover:text-ink'
              )}
            >
              <FolderGit2 aria-hidden="true" className="size-[18px]" strokeWidth={2} />
              <span className="sr-only">
                Source repository on GitHub (opens in a new tab)
              </span>
            </a>

            <IconButton
              label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={drawerOpen}
              aria-controls="mobile-navigation"
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="lg:hidden"
            >
              {drawerOpen ? <X strokeWidth={2} /> : <Menu strokeWidth={2} />}
            </IconButton>
          </div>
        </div>
      </header>

      {/* Mobile drawer, outside the header for the reason above. */}
      {drawerOpen ? (
        <>
          {/* The scrim.
              Two things here are written the long way on purpose.
              1. The sides are set individually rather than with `inset-0` plus a
                 `top-*` override. The combination produced a zero-height box, so
                 the scrim was unclickable and the drawer could only be closed with
                 Escape or the button.
              2. The tint and the blur use literal modifiers, not
                 `bg-canvas/(--arpi-opacity-scrim)`. A CSS variable in a colour
                 opacity modifier produced an invalid `color-mix()` and the whole
                 background-color declaration was dropped, leaving the scrim fully
                 transparent. 72% matches --arpi-opacity-scrim and 4px matches
                 --arpi-blur-scrim; both are asserted in
                 tests/e2e/design-system.spec.ts. */}
          <div
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className={cx(
              'fixed top-header right-0 bottom-0 left-0 z-(--arpi-z-scrim) lg:hidden',
              'bg-canvas/72 backdrop-blur-[4px]'
            )}
          />
          <div
            ref={drawerRef}
            id="mobile-navigation"
            className={cx(
              'fixed inset-x-0 top-header z-(--arpi-z-drawer) lg:hidden',
              'max-h-[calc(100dvh-var(--arpi-size-header))] overflow-y-auto',
              'border-b border-line bg-canvas-raised shadow-xl'
            )}
          >
            <nav aria-label="Primary" className="px-gutter py-4">
              <ul className="flex flex-col">
                {PRIMARY_NAV.map((route) => (
                  <li
                    key={route.href}
                    className="border-b border-line-subtle last:border-0"
                  >
                    <Link
                      href={route.href}
                      aria-current={isActive(route.href) ? 'page' : undefined}
                      className={cx(
                        'flex min-h-touch flex-col justify-center gap-0.5 py-3',
                        isActive(route.href) ? 'text-accent' : 'text-ink'
                      )}
                    >
                      <span className="flex items-center gap-2 text-lg font-semibold">
                        {isActive(route.href) ? (
                          <span
                            aria-hidden="true"
                            className="inline-block h-4 w-0.5 rounded-full bg-accent"
                          />
                        ) : null}
                        {route.navLabel}
                      </span>
                      <span className="text-xs leading-normal text-ink-faint">
                        {shortPurpose(route.href)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="mt-4 border-t border-line pt-4">
                <CaseStudyNavLink
                  active={isActive(ROUTES.caseStudy.href)}
                  variant="block"
                />
              </div>
            </nav>
          </div>
        </>
      ) : null}
    </>
  )
}

/**
 * The case-study entry.
 *
 * Rendered as a visually distinct locked item while Gate 2 is closed, and it
 * says "Locked" rather than "Coming soon". The lock is stated in the accessible
 * name too, so the padlock icon is not the only signal.
 */
function CaseStudyNavLink({
  active,
  variant = 'inline',
}: {
  active: boolean
  variant?: 'inline' | 'block'
}) {
  const locked = !caseStudyUnlocked
  return (
    <Link
      href={ROUTES.caseStudy.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex min-h-touch items-center gap-2 rounded-lg border px-3 text-base font-medium',
        'transition-colors duration-(--arpi-motion-fast)',
        variant === 'block' && 'w-full',
        locked
          ? 'border-pending/35 bg-pending-wash/50 text-pending hover:border-pending/60'
          : 'border-accent-muted bg-accent-wash text-accent hover:border-accent',
        active && 'ring-1 ring-inset ring-current'
      )}
    >
      {locked ? (
        <Lock aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      ) : null}
      Case Study
      {locked ? (
        <>
          <span
            aria-hidden="true"
            className="rounded-pill border border-current/35 px-1.5 py-0.5 font-mono text-2xs leading-none"
          >
            LOCKED
          </span>
          <span className="sr-only"> - locked, Gate 2 is closed</span>
        </>
      ) : null}
    </Link>
  )
}

/** A one-line purpose per route, for the mobile drawer's secondary line. */
function shortPurpose(href: string): string {
  switch (href) {
    case '/':
      return 'What the project is and why it exists'
    case '/architecture':
      return 'The pipeline, layer by layer'
    case '/data-model':
      return 'Dimensions, facts and declared grains'
    case '/kpis':
      return 'Every governed metric definition'
    case '/governance':
      return 'Synthetic data, privacy and scope gates'
    case '/status':
      return 'What is finished and what is not'
    case '/about':
      return 'The author and the domain experience'
    default:
      return ''
  }
}
