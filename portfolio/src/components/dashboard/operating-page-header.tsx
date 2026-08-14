import type { ReactNode } from 'react'
import Link from 'next/link'

import type { ActiveFilterChip, DashboardFilters } from '@/lib/dashboard/filters'
import { ActiveFilterSummary, OperatingControls } from './operating-controls'
import { Container, Section } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { SYNTHETIC_DATA_STATEMENT, SYNTHETIC_DEMO_SHORT } from '@/lib/site'
import { technicalHref } from '@/lib/technical'
import { cx } from '@/lib/utils'

/**
 * The operating application's control band: title, context, filters, notices.
 *
 * ONE COMPONENT, NINE ROUTES
 * --------------------------
 * Every operating surface opens the same way, so the shape is declared once here
 * rather than assembled nine times. What each route supplies is what genuinely
 * differs: its title, the one line of business context that says what is on
 * screen, its own filter controls — which are its own because applicability is a
 * property of the route's data — and any notice its filter parse produced.
 *
 * WHAT THIS REPLACED, AND WHY IT IS SHORTER
 * -----------------------------------------
 * `<PageHeader>` opens the reference half of the site and is right there: a
 * breadcrumb, an eyebrow, a sentence-length `h1`, a lede, a supporting paragraph,
 * status badges and a trust line. On an operating route that is six restatements
 * of a location the rail has already established, above the figures a manager
 * came for. Measured on `/dashboard` before this increment: the first data
 * visualization began 2,194 px down a 1,440 × 900 viewport — two and a half
 * screens of heading, provenance, badges and prose before a single mark of data.
 *
 * So the operating band carries a NAME, not a sentence. "Executive". "Inventory".
 * The navigation says where the reader is; repeating it in an eyebrow, a
 * breadcrumb, an `h1` and a card title inside 200 px is the page talking to
 * itself. A `context` line states the analytical scope in business words — the
 * stores in scope and the period — because that is what the reader cannot get
 * from the navigation and needs before reading a figure.
 *
 * THE THREE BADGES ARE GONE FROM THE EYE PATH AND NOT FROM THE DOCUMENT
 * --------------------------------------------------------------------
 * The executive header carried a dataset version, an export as-of date and a
 * real-engine validation state as its first three visual elements. All three are
 * true, none of them is what a general manager opens a dashboard for, and a
 * manager who has to read a contract fingerprint before seeing gross has been
 * handed the engineering as a toll gate. They are inside the `methodology`
 * disclosure now, and in full on the technical destination. `<details>` keeps them
 * in the accessibility tree's reading order, in a browser text search, in the
 * printed page and in the no-JavaScript rendering — so nothing was removed from
 * the page; it stopped being the first thing on it.
 *
 * The one thing that stays visible on every operating screen is the demo
 * statement, which the rail carries persistently and this band restates in the
 * disclosure's own summary. A reader can never be looking at a figure without a
 * statement on screen that the dealer group is fictional.
 *
 * WHAT `EXEC.1` CHANGED, AND WHAT IT POINTEDLY DID NOT
 * ---------------------------------------------------
 * Measured on the Executive route before this pass: the band was 298 px on a 390 px
 * phone, 418 px on a tablet and 216 px on a desktop, and every pixel of it was chrome
 * above the first figure. Three things were doing it.
 *
 *   1. THE GROUND. The band was `evidence` — the recessed instrumentation tone — so the
 *      product opened with a grey utility strip and the working surface below it was the
 *      brightest thing on the page. That is backwards for an operating console: the band
 *      is the application's header and the workspace is the instrument. The band is white
 *      now and the workspace is recessed, which is also what makes a module read as a card
 *      (see `workspace-grid.tsx`).
 *   2. THE SCOPE LINE. Title and context were two stacked blocks. They are one baseline
 *      row from `sm` up, because "Executive" and "All three stores · December 2025" are a
 *      heading and its qualifier, not two paragraphs.
 *   3. THE DEMO STATEMENT. It was a bordered box the width of the band, which made the
 *      one sentence on the page that is not a figure the largest object above the figures.
 *      It is a pill now, on the title's own row at `lg`, and it is the SAME sentence with
 *      the SAME full statement inside it. Nothing was shortened, softened or moved out of
 *      the first viewport — `content-integrity` asserts the full synthetic-data statement
 *      is inside this disclosure, and it still is.
 *
 * The rule this band is not allowed to break: compacting the chrome may never compact the
 * disclosure. Anything a reader must see to interpret a figure — the staleness banner, the
 * reconciliation banner, the reset and period notices, the active-filter chips — is
 * outside the disclosure, at full size, exactly where it was.
 */
export interface OperatingPageHeaderProps {
  /**
   * The route's name. A NOUN, not a sentence.
   *
   * "Executive", "Sales & Gross", "Inventory". The rail has already said where the
   * reader is; an `h1` that reads "How the group is performing, and which store
   * needs attention" is an article title on a working screen.
   */
  readonly title: string
  /**
   * One line of analytical scope, in business words.
   *
   * "All three stores · December 2025". Not what the page is for — the reader
   * chose it — but what is currently selected, which is the one thing a figure
   * cannot be read without.
   */
  readonly context: ReactNode
  /**
   * A short subtitle, ONLY where the title alone would mislead.
   *
   * Most routes pass nothing. `/dashboard/accounting` passes one, because
   * "Accounting" over an inventory-control reconciliation would be read as a
   * general ledger, and that is a claim rather than a label.
   */
  readonly subtitle?: string
  /** Where the reader came from, for a drill-through. Rendered as one back link. */
  readonly backLink?: { readonly href: string; readonly label: string }
  /**
   * The route's filter controls, and any control form the route owns.
   *
   * Rendered inside `<OperatingControls>`: a native disclosure on a phone, and
   * simply the band above 48rem. Everything a reader must SEE to interpret a
   * figure belongs in `notices` or `children` instead — see the file comment on
   * `operating-controls.tsx` for the line between the two.
   */
  readonly filters?: ReactNode
  /**
   * The parameters currently set, for the removable summary above the controls.
   *
   * Passing these rather than rendering a chip list per route is what `UX.2D` §2
   * bought: one summary, with removal and reset, on all nine routes instead of a
   * removable one on the Executive surface and an inert one on the other eight.
   */
  readonly chips?: readonly ActiveFilterChip[]
  /** The current filter state, so a chip can link to the view without it. */
  readonly filterState?: DashboardFilters
  /** This route's pathname. Chip removal and reset are navigations back to it. */
  readonly route?: string
  /** Reset notices, period notices, stale banners. Rendered above the controls. */
  readonly notices?: ReactNode
  /**
   * The route's own methodology and provenance, collapsed.
   *
   * Every operating route passes one, and the content-integrity suite asserts the
   * full synthetic-data statement is inside it, so consolidating the prose did not
   * quietly weaken the disclosure.
   */
  readonly methodology?: ReactNode
  /**
   * The methodology disclosure's element id.
   *
   * `trust` on the Executive surface, which is the anchor the console's evidence
   * region carried before `UX.1` moved the panel up into this band. An anchor that
   * stops resolving is a broken link even when the content is still on the page.
   */
  readonly methodologyId?: string
  /**
   * The route's own control block: notices, chips, the filter form, and any
   * route-specific control such as the Deal Explorer's search or the inventory
   * ordering select.
   *
   * A slot rather than a fixed set of props, because the routes genuinely differ:
   * the Deal Explorer carries a search form, the inventory route carries a sort
   * order, and the leads route carries a campaign control that means nothing
   * anywhere else. What the shell owns is that all of it appears in ONE band, in
   * the same place, under the same heading, on every operating route.
   */
  readonly children?: ReactNode
  readonly className?: string
}

export function OperatingPageHeader({
  title,
  context,
  subtitle,
  backLink,
  filters,
  chips,
  filterState,
  route,
  notices,
  methodology,
  methodologyId,
  children,
  className,
}: OperatingPageHeaderProps) {
  const summary =
    chips === undefined || filterState === undefined || route === undefined ? null : (
      <ActiveFilterSummary chips={chips} filters={filterState} route={route} />
    )

  return (
    <Section
      rhythm="none"
      tone="canvas"
      data-operating-band
      className={cx('border-b border-line py-3 sm:py-4', className)}
    >
      <Container width="full">
        {/* `gap-3`, not `gap-4`. The control band is four stacked things on every
            operating route, and `UX.2A` §4 asks for it to be compact: sixteen pixels
            between each of them cost fifty vertical pixels that the first viewport
            contract needs for a chart. */}
        <div className="flex flex-col gap-2.5 sm:gap-3">
          {backLink === undefined ? null : (
            <Link
              href={backLink.href}
              className="w-fit text-xs text-ink-muted underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
            >
              &larr; {backLink.label}
            </Link>
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            {/*
              THE TITLE AND ITS SCOPE ARE ONE BASELINE ROW, NOT TWO BLOCKS.

              `items-baseline` with `flex-wrap`: on a desktop "Executive" and
              "All three stores · December 2025 · vs November 2025" sit on one line
              with the scope set smaller and quieter, which is the relationship
              between them; on a phone the scope wraps under the title and costs the
              one line it always cost. The accent keyline is the only ornament in the
              band and it is 2 px wide — enough to mark where the application's
              header starts, not enough to be a graphic.
            */}
            <div className="flex min-w-0 items-baseline gap-3">
              <span
                aria-hidden="true"
                className="mt-1 hidden h-6 w-0.5 shrink-0 self-center rounded-pill bg-accent sm:block"
              />
              <div className="flex min-w-0 flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-baseline">
                <Heading level={1} size="h3">
                  {title}
                </Heading>
                {subtitle === undefined ? null : (
                  <Text size="sm" tone="muted">
                    {subtitle}
                  </Text>
                )}
                <p className="text-xs font-medium text-ink-muted sm:text-sm">{context}</p>
              </div>
            </div>

            {methodology === undefined ? null : (
              <details
                id={methodologyId}
                className="min-w-0 max-w-full rounded-xl border border-line-subtle bg-surface"
              >
                {/*
                  THE SUMMARY IS THE DISCLOSURE, NOT A LABEL FOR ONE.

                  It carries the compact statement in full — fictional group,
                  synthetic figures — so a reader who never opens the disclosure has
                  still read it, and so the statement is above the fold on every
                  operating screen at 1440 × 900 and at 390 × 844. `UX.1` §17 allows
                  exactly one compact synthetic-demo statement in the first viewport
                  and forbids the long one; this is that statement, and the long one
                  is the first thing inside.

                  `EXEC.1` MADE IT A PILL AND CHANGED NOT ONE WORD OF IT. The box it
                  replaced was the width of the band and read as a banner; a pill
                  reads as what it is — a caption with a disclosure behind it — and
                  the sentence, the dot, the full statement inside and the
                  governance link are all exactly as they were.
                */}
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-2xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden="true"
                    className="inline-block size-1.5 shrink-0 rounded-pill bg-pending"
                  />
                  <span className="text-ink-secondary">{SYNTHETIC_DEMO_SHORT}</span>
                  <span className="hidden sm:inline">&middot; data and methodology</span>
                </summary>
                <div className="flex max-w-3xl flex-col gap-4 px-3 pb-4">
                  <Text size="xs" tone="faint">
                    {SYNTHETIC_DATA_STATEMENT}
                  </Text>
                  {methodology}
                  <Text size="xs" tone="faint">
                    <Link
                      href={technicalHref('governance')}
                      className="underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                    >
                      How this is built, governed and validated
                    </Link>
                  </Text>
                </div>
              </details>
            )}
          </div>

          {notices === undefined ? null : notices}
          {summary}
          {filters === undefined ? null : (
            <OperatingControls activeCount={chips?.length ?? 0}>
              {filters}
            </OperatingControls>
          )}
          {children === undefined ? null : children}
        </div>
      </Container>
    </Section>
  )
}

/**
 * The scope line, assembled from the parts every route already has.
 *
 * A helper rather than a convention, because "All three stores · December 2025"
 * being punctuated three different ways on three routes is precisely the drift a
 * shared shell exists to prevent.
 */
export function operatingContext(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

/** The demo statement, for a surface that renders no methodology disclosure. */
export const OPERATING_DEMO_STATEMENT = SYNTHETIC_DEMO_SHORT
