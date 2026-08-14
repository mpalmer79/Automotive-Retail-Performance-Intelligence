/**
 * The operating application's control architecture, declared once for nine routes.
 *
 * WHAT `UX.2D` MEASURED
 * --------------------
 * On `main` at `9c109b67`, the first `<section>` of every operating route — title,
 * scope, notices, chips, filter form and whatever else the route stacked there —
 * measured, at 390 × 844:
 *
 *   Actions        245 px      (no filter form at all)
 *   Deal Jacket    322 px      (no filter form at all)
 *   Executive      548 px
 *   Sales & Gross  565 px
 *   Deal Explorer  631 px
 *   Employees      711 px
 *   Accounting     718 px
 *   Leads          721 px
 *   F&I            753 px
 *   Inventory      921 px      — taller than the 844 px screen it renders on
 *
 * The first data visualization on a phone was consequently at 624 px (Executive),
 * 787 px (Employees), 794 px (Accounting), 829 px (F&I) and 997 px (Inventory), and
 * ZERO routes put a complete figure inside the first mobile screen. The two routes
 * that did well are the two that carry no filter form. That is the measurement:
 * the control band, not the content, is what a phone reader scrolls past.
 *
 * `UX.2B` recorded the same finding at 985 px on Inventory and fixed the two
 * controls that route owns. `UX.2D` §6 says the target is the SHARED band.
 *
 * THE ARCHITECTURE, AND THE ONE THING THAT MAKES IT WORK WITHOUT JAVASCRIPT
 * ------------------------------------------------------------------------
 * Three tiers, in reading order:
 *
 *   1. THE SCOPE LINE — the route's title and `context`, always visible. It states
 *      the stores and the period in business words, which is what a figure cannot
 *      be read without.
 *   2. THE ACTIVE-FILTER SUMMARY — one removable chip per set parameter and a
 *      reset, always visible, and NOTHING AT ALL when no parameter is set. A
 *      reader can always see what is narrowing the figures and can always undo it
 *      without opening anything.
 *   3. THE CONTROLS — the filter form and the route's own control forms, inside a
 *      native `<details>`. Collapsed on a phone; open on a desktop.
 *
 * The responsive part of tier 3 is done in CSS, in `globals.css`, with
 * `::details-content` — the same pseudo-element this site already uses to open
 * every disclosure for print, and for the same reason: `open` is an attribute,
 * a stylesheet cannot set an attribute, and this is the only way CSS can reveal a
 * closed disclosure. Above 48rem the summary is hidden and the content is forced
 * visible, so a desktop reader sees one compact band of controls and no
 * disclosure at all. Below 48rem the element behaves as an ordinary `<details>`.
 *
 * WHY THAT IS THE NO-JAVASCRIPT ANSWER AND NOT A COMPROMISE
 * --------------------------------------------------------
 * There is no client component here, no state, no effect and no measurement of the
 * viewport in JavaScript. `<details>` toggles natively with a click and with the
 * keyboard, announces its own expanded and collapsed state, and is searchable and
 * printable. With scripting disabled a phone reader taps "Filters", gets the same
 * native GET form that was always there, and submits it. The filter grammar, the
 * URL contract and `FilterBar`'s own no-JavaScript path are untouched.
 *
 * An engine without `::details-content` support ignores the desktop rule and
 * renders the summary — one click to the same controls. The `@supports` guard in
 * `globals.css` is what makes that the fallback rather than a hidden control:
 * the summary is only hidden where the content is provably revealed.
 *
 * WHAT DELIBERATELY STAYS OUTSIDE THE DISCLOSURE
 * ---------------------------------------------
 * Anything a reader must see to interpret a figure, and anything that is
 * navigation rather than filtering: the export-staleness banner, the
 * reconciliation banner, the reset notice, the period notice, the
 * Employees role switch — a reader on `?role=finance` is on a different view, not
 * under a different filter — and the route caveats that `UX.1` ruled must be
 * visible. Hiding a caveat to save 40 px is the trade this file exists not to make.
 *
 * Server components. No client island was added by `UX.2D`.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { Text } from '@/components/ui/typography'
import {
  filtersHref,
  withoutFilter,
  type ActiveFilterChip,
  type DashboardFilters,
} from '@/lib/dashboard/filters'
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* The active-filter summary                                                   */
/* -------------------------------------------------------------------------- */

export interface ActiveFilterSummaryProps {
  readonly chips: readonly ActiveFilterChip[]
  /** The current filter state, so each chip can link to the view without it. */
  readonly filters: DashboardFilters
  /** This route's pathname. Removal and reset are navigations back to it. */
  readonly route: string
}

/**
 * What is narrowing the figures, and how to stop it.
 *
 * ONE COMPONENT, NINE ROUTES, AFTER `UX.2D` FOUND TWO
 * --------------------------------------------------
 * The Executive surface rendered `<ActiveFilters>`: chips that were LINKS to the
 * same view without that parameter, plus a "Reset filters" link, plus a note for
 * every parameter the route could not fully act on. The other eight routes
 * rendered `<ActiveFilterChips>`: the same information as inert `<li>` text, with
 * no removal and no reset anywhere on the page.
 *
 * So on eight of nine operating routes there was no way to clear one filter, and
 * no way to clear all of them, short of setting each select back to its default.
 * That is the same control doing two different things depending on which page you
 * were standing on, which is precisely what `UX.2D` §2 lists first.
 *
 * The Executive treatment won because it is the one that can be undone. Every
 * chip is a server-rendered `<a>` to this route without that parameter; reset is
 * an `<a>` to the bare route. No JavaScript, no state: removing a filter is
 * navigation, and navigation is what links are.
 *
 * NOTHING AT ALL WHEN NOTHING IS SET, AND THAT IS A DELETION `UX.2D` §19 ASKED FOR
 * -------------------------------------------------------------------------------
 * The Executive band previously said, under an "Active filters" label, "None.
 * Showing the group over the latest full month, against the prior month." — a
 * twelve-word paragraph restating the scope line four elements above it, which
 * reads "All three stores · December 2025 · vs November 2025". Duplicate prose in
 * the top 300 px of the busiest route in the product. The scope line stays; the
 * restatement is gone.
 */
export function ActiveFilterSummary({ chips, filters, route }: ActiveFilterSummaryProps) {
  if (chips.length === 0) return null

  const unapplied = chips.filter((chip) => chip.support === 'not-applicable')

  return (
    <div className="flex flex-col gap-2" data-active-filters>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
          Filters
        </span>
        <ul className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Link
                href={filtersHref(route, withoutFilter(filters, chip.key))}
                data-filter-chip={chip.key}
                className={cx(
                  // `min-h-6`: WCAG 2.2 Target Size (Minimum) is 24 CSS pixels, and
                  // a 13px line with 4px of padding is 21. The chips sit in a
                  // wrapping row where the neighbour offset cannot be relied on.
                  'inline-flex min-h-6 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs leading-none',
                  'transition-colors duration-(--arpi-motion-fast)',
                  chip.support === 'not-applicable'
                    ? 'border-line-strong bg-deferred-wash text-deferred hover:border-line-strong'
                    : 'border-accent-muted/45 bg-accent-wash text-accent hover:border-accent'
                )}
              >
                <span className="font-medium">{chip.label}: </span>
                <span className="font-mono">{chip.value}</span>
                {chip.support === 'not-applicable' ? (
                  <span className="text-2xs">(not applied here)</span>
                ) : chip.support === 'partial' ? (
                  <span className="text-2xs">(partial)</span>
                ) : null}
                <span aria-hidden="true">&times;</span>
                <span className="sr-only">Remove this filter</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={route}
          data-filter-reset
          className="inline-flex min-h-6 items-center rounded-pill border border-line px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:border-line-strong hover:text-ink"
        >
          Reset filters
        </Link>
      </div>

      {/*
        THE NOTE IS FOR `not-applicable` ONLY.

        A `partial` parameter is doing something and the chip says so in one word;
        the control that set it carries the sentence explaining what it reaches, and
        repeating that sentence here put four lines of prose in the band on routes
        that declare two partial parameters. A `not-applicable` parameter is the
        opposite case: it is in the URL, it is doing nothing, and a reader who
        believes it is working is reading a group figure as a filtered one. That one
        keeps its sentence.
      */}
      {unapplied.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {unapplied.map((chip) => (
            <li key={chip.key}>
              <Text size="xs" tone="muted">
                <span className="font-medium text-ink-secondary">{chip.label}</span>{' '}
                {chip.note}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The control disclosure                                                      */
/* -------------------------------------------------------------------------- */

export interface OperatingControlsProps {
  /**
   * How many parameters are currently set, for the collapsed summary.
   *
   * Passed rather than derived, because the number a reader wants is the number
   * of chips they can see above — and a route may render a control the global
   * grammar does not name.
   */
  readonly activeCount: number
  /** The filter form and the route's own control forms. */
  readonly children: ReactNode
}

/**
 * The controls: compact on a desktop, one tap away on a phone.
 *
 * `data-operating-controls` is the CSS hook and the test hook. `globals.css`
 * carries the two rules that make the disclosure disappear above 48rem, and
 * `tests/e2e/ux2d-controls.spec.ts` asserts the measured height at both ends.
 */
export function OperatingControls({ activeCount, children }: OperatingControlsProps) {
  return (
    <details data-operating-controls className="group min-w-0">
      {/*
        `EXEC.1` MADE THE COLLAPSED SUMMARY A PILL RATHER THAN A BAR.

        It was a full-width bordered box the height of a touch target, which on a phone
        put a 44 px white slab the width of the screen between the scope line and the
        first figure — the second-largest object in the band, for a control that is
        closed. `w-fit` with a pill radius makes it read as the control it is. It keeps
        the 44 px height, because unlike the methodology caption this IS a primary
        control on a phone and `UX.1` §12 sets that floor; what it gives up is the
        width it never needed.
      */}
      <summary
        className={cx(
          'flex min-h-touch w-fit cursor-pointer list-none items-center gap-2 rounded-pill border border-line',
          'bg-canvas px-4 text-sm font-medium text-ink-secondary',
          'transition-colors duration-(--arpi-motion-fast) hover:border-line-strong hover:text-ink',
          '[&::-webkit-details-marker]:hidden'
        )}
      >
        <ChevronDown
          aria-hidden="true"
          strokeWidth={2}
          className="size-4 shrink-0 text-ink-faint transition-transform duration-(--arpi-motion-fast) group-open:rotate-180"
        />
        <span>Filters and controls</span>
        <span className="text-xs font-normal text-ink-muted">
          {activeCount === 0 ? 'none applied' : `${String(activeCount)} applied`}
        </span>
      </summary>
      <div className="flex flex-col gap-3 pt-3 md:pt-0" data-operating-controls-body>
        {children}
      </div>
    </details>
  )
}
