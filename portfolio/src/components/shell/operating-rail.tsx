'use client'

/**
 * The operating application's navigation: a left rail on the desktop, a drawer on
 * a phone, one list of links in the DOM.
 *
 * WHY A RAIL AND NOT A HEADER
 * ---------------------------
 * The application has eight peer destinations and the reference half of the site
 * has three. A horizontal masthead can carry three; at eight it becomes a row of
 * small type competing with the page title, and the eighth item is the one nobody
 * finds. A vertical rail is what dealership software and every enterprise
 * analytical tool uses for the same reason: eight labels stack legibly, the
 * current one is unambiguous, and the horizontal band above the canvas is left
 * free for the controls that change what the canvas shows.
 *
 * IT IS STICKY, NOT FIXED, AND THE CHOICE WAS MEASURED
 * ---------------------------------------------------
 * `position: fixed` would take the rail out of flow and require the canvas to
 * carry a permanent left margin, which then has to be undone at every breakpoint
 * and inside every full-bleed visual. `position: sticky` inside a flex row keeps
 * the rail in the document, so the grid does the offsetting and a wide table
 * scrolls inside its own container rather than under the navigation. The eleven
 * links plus the demo statement measure 612 px at the default type size, which
 * fits a 900 px viewport without the rail needing its own scrollbar; a shorter
 * viewport scrolls the rail with the page, which is the behaviour sticky gives
 * for free and fixed does not.
 *
 * NOT COLLAPSIBLE. A collapse toggle costs a control, a stored preference — which
 * this application does not have, because the URL is the whole persistence layer —
 * and an icon-only state in which eight labels become eight glyphs a reader has to
 * learn. The rail is 232 px of a 1440 px viewport. Below `lg` it is not a rail at
 * all; it is the drawer, which is the real answer to "the rail is too wide here".
 *
 * WHAT IS NOT IN IT
 * -----------------
 * No user account, no notification bell, no message badge, no settings gear, no
 * search that searches nothing. Every control on this surface navigates somewhere
 * that exists. A dashboard template's chrome is not a product.
 */
import { FolderGit2, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { Wordmark } from '@/components/brand/logo'
import { IconButton } from '@/components/ui/button'
import { operatingHref } from '@/lib/dashboard/navigation'
import { parseFilters } from '@/lib/dashboard/filters'
import { useEscapeKey, useFocusTrap, useScrollLock } from '@/lib/hooks'
import {
  OPERATING_NAV,
  REPOSITORY_URL,
  SYNTHETIC_DEMO_SHORT,
  UTILITY_NAV,
  isNavItemCurrent,
  type NavItem,
} from '@/lib/site'
import { cx } from '@/lib/utils'

/**
 * WHY THE RAIL READS THE QUERY STRING ITSELF
 * ------------------------------------------
 * Each rail link has to carry the reader's analytical context to its destination,
 * so its href depends on the current URL. A Next layout cannot read `searchParams`
 * — that is a route-level input, not a layout-level one — so a rail rendered from
 * the layout has two honest options: receive eight finished hrefs from every page,
 * or read the query string in the browser.
 *
 * It reads it. Threading eight strings through nine pages would put the shell's
 * own concern into every route, which is the repetition the shell exists to remove.
 *
 * THIS IS NOT A SECOND SOURCE OF STATE. The rail parses the URL with the same
 * `parseFilters` the server uses, reduces it with the same route applicability
 * declaration, and serializes it with the same canonical writer. It produces a
 * LINK; the destination re-parses that link on the server exactly as though a
 * reader had typed it. No selection is held in the browser, nothing is computed
 * from data — this island still imports no dataset — and with scripting disabled
 * the rail renders bare pathnames, which navigate correctly and simply arrive at
 * the destination's default period rather than the reader's.
 */
export function OperatingRail() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const hrefs = useMemo<Readonly<Record<string, string>>>(() => {
    /*
     * Parsed WITHOUT `knownStores` or `knownSources`.
     *
     * Validation against the export's own catalogues is the server's job and it
     * has already happened: the page that rendered this shell either accepted the
     * value or reset it and said so. Repeating the check here would need the
     * catalogues in the browser, which is exactly the data import this island is
     * forbidden. A malformed value fails the grammar here as it does there and is
     * dropped from the link rather than carried forward.
     */
    const { filters } = parseFilters(searchParams)
    const map: Record<string, string> = {}
    for (const item of OPERATING_NAV) map[item.href] = operatingHref(item.href, filters)
    return map
  }, [searchParams])

  /*
   * The drawer's open state is the route it was opened on rather than a boolean,
   * so navigating closes it without an effect. The site header uses the same
   * technique and records the reasoning.
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
    <>
      {/* ---------------------------------------------------------------- */}
      {/* The compact app bar. Below `lg` it is the whole navigation.       */}
      {/* ---------------------------------------------------------------- */}
      <div
        data-arpi-print="omit"
        className={cx(
          'sticky top-0 z-(--arpi-z-header) flex h-header items-center gap-3 lg:hidden',
          'border-b border-line bg-canvas px-gutter'
        )}
      >
        <Link
          href="/"
          className="shrink-0 rounded-md"
          aria-label="ARPI Executive Command Center, home"
        >
          <Wordmark />
        </Link>
        <span className="ml-auto truncate text-xs text-ink-faint">
          {currentLabel(pathname)}
        </span>
        <IconButton
          label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={drawerOpen}
          aria-controls="operating-navigation"
          onClick={() => {
            setDrawerOpen(!drawerOpen)
          }}
        >
          {drawerOpen ? <X strokeWidth={2} /> : <Menu strokeWidth={2} />}
        </IconButton>
      </div>

      {drawerOpen ? (
        <>
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
            id="operating-navigation"
            className={cx(
              'fixed inset-x-0 top-header z-(--arpi-z-drawer) lg:hidden',
              'max-h-[calc(100dvh-var(--arpi-size-header))] overflow-y-auto',
              'border-b border-line bg-canvas-raised px-gutter py-4 shadow-xl'
            )}
          >
            <RailBody pathname={pathname} hrefs={hrefs} variant="drawer" />
          </div>
        </>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* The desktop rail.                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div
        data-arpi-print="omit"
        className={cx(
          'hidden shrink-0 lg:block lg:w-rail',
          'border-r border-line bg-canvas'
        )}
      >
        <div className="sticky top-0 flex max-h-dvh flex-col gap-6 overflow-y-auto px-5 py-6">
          <Link
            href="/"
            className="rounded-md"
            aria-label="ARPI Executive Command Center, home"
          >
            <Wordmark />
          </Link>
          <RailBody pathname={pathname} hrefs={hrefs} variant="rail" />
        </div>
      </div>
    </>
  )
}

/** The current route's short label, shown beside the wordmark on a phone. */
function currentLabel(pathname: string): string {
  const item = OPERATING_NAV.find((entry) => isNavItemCurrent(entry, pathname))
  return item?.label ?? ''
}

/**
 * The links themselves, rendered once for the rail and once for the drawer.
 *
 * TWO RENDERINGS RATHER THAN ONE MOVED BY CSS, and the reason differs from the
 * site header's. The header's seven items are the same list at two sizes. Here the
 * drawer carries each item's purpose line — there is room on a phone and a reader
 * on a phone has less context — and the rail does not. Rendering both and hiding
 * one would put eight sentences into the desktop DOM that no desktop reader will
 * ever see, and a screen-reader user on a desktop would hear all of them.
 */
function RailBody({
  pathname,
  hrefs,
  variant,
}: {
  readonly pathname: string
  readonly hrefs: Readonly<Record<string, string>>
  readonly variant: 'rail' | 'drawer'
}) {
  const drawer = variant === 'drawer'
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Operating">
        <p className="eyebrow text-2xs text-ink-faint">Operating</p>
        <ul className="mt-2 flex flex-col">
          {OPERATING_NAV.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              href={hrefs[item.href] ?? item.href}
              current={isNavItemCurrent(item, pathname)}
              showPurpose={drawer}
            />
          ))}
        </ul>
      </nav>

      {/*
        The unbuilt section, named as text and never as a link.

        It is here rather than only at the foot of the Executive page because the
        rail is where a reader looks for "is there a page for that", and the honest
        answer for management actions is "not yet, and here is the increment that
        delivers it". A disabled-looking link would be a promise; a line of text is
        a status.
      */}
      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <p className="eyebrow text-2xs text-ink-faint">Not built yet</p>
        <p className="text-sm text-ink-faint">Actions · DASH.12</p>
      </div>

      <nav aria-label="Utility" className="border-t border-line pt-4">
        <ul className="flex flex-col">
          {UTILITY_NAV.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              href={item.href}
              current={isNavItemCurrent(item, pathname)}
              showPurpose={drawer}
              subdued
            />
          ))}
          <li>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cx(
                'flex min-h-touch items-center gap-2 rounded-md text-sm',
                'text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-ink'
              )}
            >
              <FolderGit2 aria-hidden="true" className="size-4" strokeWidth={2} />
              GitHub
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </nav>

      {/*
        THE ONE PERSISTENT TRUST INDICATOR.

        Not a badge, not three badges, and not a paragraph. The full statement, the
        provenance of both data lanes and the external validation status are in the
        methodology disclosure every operating page carries and in the technical
        destination; this is the line that has to be on screen while a manager is
        reading a gross figure.
      */}
      <p className="border-t border-line pt-4 text-2xs leading-normal text-ink-faint">
        {SYNTHETIC_DEMO_SHORT}
      </p>
    </div>
  )
}

function RailLink({
  item,
  href,
  current,
  showPurpose,
  subdued = false,
}: {
  readonly item: NavItem
  readonly href: string
  readonly current: boolean
  readonly showPurpose: boolean
  readonly subdued?: boolean
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cx(
          'relative flex min-h-touch flex-col justify-center rounded-md py-2 pl-3',
          'transition-colors duration-(--arpi-motion-fast)',
          // The active indicator is a rule down the leading edge IN ADDITION to
          // the weight and colour change, so it survives greyscale and does not
          // rely on hue alone.
          'before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-pill',
          current ? 'before:bg-accent' : 'before:bg-transparent',
          current
            ? 'bg-surface-hover font-semibold text-ink'
            : subdued
              ? 'text-ink-muted hover:text-ink'
              : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'
        )}
      >
        <span className="text-sm">{item.label}</span>
        {showPurpose ? (
          <span className="text-2xs leading-normal text-ink-faint">{item.purpose}</span>
        ) : null}
      </Link>
    </li>
  )
}
