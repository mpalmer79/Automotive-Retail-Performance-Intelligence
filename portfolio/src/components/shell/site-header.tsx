'use client'

/**
 * The reference domain's header.
 *
 * Three content destinations, a GitHub action, and a menu button below the large
 * breakpoint. That is the whole surface.
 *
 * WHAT `UX.1` REMOVED, AND WHY
 * ----------------------------
 *   - Four destinations, and the header's claim to be the site's navigation. It
 *     carried seven items covering both halves of the site at once, so a
 *     dealership manager reading gross was offered "Status" and "KPIs" as peers
 *     of "Dashboard". The operating application has a rail of its own now; this
 *     header covers the reference half and opens with a link back into the
 *     application, because every route it serves is one a reader arrived at FROM
 *     there.
 *   - "Platform". It grouped Architecture, Data Model, Inventory Operations and
 *     Governance; all four are states of `/technical` now, reached from one
 *     "Technical" item and linked to each other by `<TechnicalNav>`.
 *
 * WHAT AN EARLIER PASS REMOVED, AND WHY IT STAYS REMOVED
 * -----------------------------------------------------
 *   - The bordered amber "Case Study LOCKED" control. It was the only filled,
 *     bordered element in a header of plain links, which made the emptiest page
 *     on the site its loudest destination. The case study is still visible in
 *     the footer and on the technical status view, and it still says "locked" in
 *     words.
 *
 * ACCESSIBILITY DECISIONS WORTH NAMING
 * ------------------------------------
 *   - The current item is marked `aria-current="page"`, not merely coloured, and
 *     "Platform" is current on all three of its pages.
 *   - The drawer traps focus, closes on Escape, closes on route change, closes
 *     on a scrim click, locks the body scroll and returns focus to the trigger.
 *   - Desktop and mobile navigation are ONE list rendered once and moved by CSS,
 *     so there is no set of links that exists in the DOM but cannot be reached.
 */
import { FolderGit2, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'

import { Wordmark } from '@/components/brand/logo'
import { IconButton } from '@/components/ui/button'
import { useEscapeKey, useFocusTrap, useScrollLock } from '@/lib/hooks'
import {
  GROUP_NAV,
  PRIMARY_NAV,
  REPOSITORY_URL,
  isNavItemCurrent,
  type NavItem,
} from '@/lib/site'
import { TECHNICAL_VIEW_DEFINITIONS, technicalHref } from '@/lib/technical'
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
  useEscapeKey(drawerOpen, () => {
    setDrawerOpen(false)
  })

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
      {/*
       * Solid white, not translucent.
       *
       * The previous header was `bg-canvas/85` over a backdrop blur, which on a
       * near-black page read as depth. Over a blue field it reads as a smear:
       * the gradient shows through the bar, so the "white header" that the whole
       * composition rests on is actually pale blue, and it changes colour as the
       * visitor scrolls. The direction rules out glassmorphism for this reason.
       *
       * Removing the blur has a second effect worth naming: `backdrop-filter`
       * makes an element the containing block for its `position: fixed`
       * descendants, which is the bug the scrim comment below describes. That
       * hazard is now gone at the source, though the scrim stays a sibling
       * because the structure is correct on its own merits.
       */}
      {/*
        `data-arpi-print="omit"`: a masthead is an affordance for a surface that can be
        clicked, and on paper it is something the reader has to look past to reach the
        content. The rule lives in the print block of `globals.css`. It is set on the
        element rather than through a class so a restyle cannot silently start printing
        the navigation again.
      */}
      <header
        data-arpi-print="omit"
        className={cx(
          'sticky top-0 z-(--arpi-z-header) w-full',
          'border-b border-line bg-canvas'
        )}
      >
        <div className="mx-auto flex h-header w-full max-w-bleed items-center gap-4 px-gutter">
          <Link
            href="/"
            className="shrink-0 rounded-md"
            aria-label="ARPI - Automotive Retail Performance Intelligence, home"
          >
            <Wordmark />
          </Link>

          {/* Desktop navigation. Seven items, evenly weighted. Two destination
              GROUPS - "Platform" and "Dealerships" - stand in for six routes
              between them, which is what keeps this a navigation rather than a
              table of contents. */}
          <nav aria-label="Primary" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-1">
              {PRIMARY_NAV.map((item) => {
                const current = isNavItemCurrent(item, pathname)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className={cx(
                        'relative flex min-h-touch items-center rounded-md px-3.5 text-base font-medium',
                        'transition-colors duration-(--arpi-motion-fast)',
                        current ? 'text-ink' : 'text-ink-muted hover:text-ink-secondary',
                        // The active indicator: a short rule under the label,
                        // present in addition to the colour change so it survives
                        // greyscale. One indicator - not a pill, not a fill, not
                        // a border.
                        'after:absolute after:inset-x-3.5 after:bottom-1.5 after:h-px after:rounded-pill',
                        'after:transition-colors after:duration-(--arpi-motion-base)',
                        current ? 'after:bg-accent' : 'after:bg-transparent'
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-4">
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
              onClick={() => {
                setDrawerOpen(!drawerOpen)
              }}
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
                 `bg-field-deepest/(--arpi-opacity-scrim)`. A CSS variable in a
                 colour opacity modifier produced an invalid `color-mix()` and the
                 whole background-color declaration was dropped, leaving the scrim
                 fully transparent. 72% matches --arpi-opacity-scrim and 4px
                 matches --arpi-blur-scrim; both are asserted in
                 tests/e2e/design-system.spec.ts.
              3. The tint is the deepest FIELD blue, not the canvas. A scrim's
                 job is to push the page back behind the drawer, and on a light
                 theme a white scrim cannot: it is the same value as the content
                 it is meant to recede. */}
          <div
            aria-hidden="true"
            onClick={() => {
              setDrawerOpen(false)
            }}
            className={cx(
              'fixed top-header right-0 bottom-0 left-0 z-(--arpi-z-scrim) lg:hidden',
              'bg-field-deepest/72 backdrop-blur-[4px]'
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
                {PRIMARY_NAV.map((item) => {
                  const current = isNavItemCurrent(item, pathname)
                  return (
                    <li
                      key={item.href}
                      className="border-b border-line-subtle last:border-0"
                    >
                      <Link
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        className={cx(
                          'flex min-h-touch flex-col justify-center gap-0.5 py-3.5',
                          current ? 'text-accent' : 'text-ink'
                        )}
                      >
                        <span className="flex items-center gap-2 text-lg font-semibold">
                          {current ? (
                            <span
                              aria-hidden="true"
                              className="inline-block h-4 w-0.5 rounded-pill bg-accent"
                            />
                          ) : null}
                          {item.label}
                        </span>
                        <span className="text-xs leading-normal text-ink-faint">
                          {item.purpose}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>

              {/* The two destination groups, expanded.
                  On a phone there is room to show the pages behind "Platform"
                  and "Dealerships" rather than making a visitor land on one and
                  then discover a sub-navigation. On a desktop that job belongs
                  to `<PlatformNav>` and `<GroupNav>`, which are on the pages
                  themselves. */}
              {/* On a phone there is room to show the eight technical views and the
                  demo group's pages rather than making a visitor land on one and
                  then discover a sub-navigation. On a desktop that job belongs to
                  `<TechnicalNav>` and `<GroupNav>`, which are on the pages. */}
              <NavGroup
                heading="How ARPI works"
                items={TECHNICAL_VIEW_DEFINITIONS.map((entry) => ({
                  href: technicalHref(entry.view),
                  label: entry.label,
                  matches: [technicalHref(entry.view)],
                  purpose: entry.lede,
                }))}
                pathname={pathname}
              />
              <NavGroup heading="The demo group" items={GROUP_NAV} pathname={pathname} />
            </nav>
          </div>
        </>
      ) : null}
    </>
  )
}

/**
 * One expanded destination group inside the mobile drawer.
 *
 * Extracted rather than repeated, because there are now two of them and a copied
 * block is where the second one quietly stops matching the first.
 */
function NavGroup({
  heading,
  items,
  pathname,
}: {
  heading: string
  items: readonly NavItem[]
  pathname: string
}) {
  return (
    <div className="mt-5 flex flex-col gap-1 border-t border-line pt-4">
      <p className="eyebrow text-2xs">{heading}</p>
      <ul className="flex flex-col">
        {items.map((item) => {
          const current = isNavItemCurrent(item, pathname)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'flex min-h-touch items-center text-base',
                  current
                    ? 'font-semibold text-accent'
                    : 'text-ink-secondary hover:text-ink'
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
