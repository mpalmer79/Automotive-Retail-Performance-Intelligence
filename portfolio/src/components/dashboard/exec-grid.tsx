/**
 * The command center's grid: a module, and the twelve columns it sits in.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * `UX.1` left this route as five full-width horizontal bands, each opening with an
 * eyebrow, an `h2` and usually a paragraph, stacked down an 8,161 px document. That is
 * the rhythm of an article. It reads top to bottom, one subject at a time, and it puts
 * the first framed figure 1,389 px from the top of a 900 px viewport — measured, in
 * `docs/reviews/UX-2-BASELINE.md`.
 *
 * A dashboard does not read top to bottom. It reads outward from a focal point, and its
 * unit is a MODULE: a titled panel with one question in it, sitting beside three others
 * on the same screen. So the page is a twelve-column grid of modules, four rows of them
 * on a desktop, and the region headings that used to introduce each band are gone — a
 * module's own title says what it holds, and `Group performance` above four modules that
 * each already say so was the page talking to itself.
 *
 * WHY TWELVE COLUMNS
 * ------------------
 * Because the content needs 7/5, 5/4/3 and 4/4/4 splits, and twelve is the smallest
 * number that carries all three without a fraction. The columns collapse to six at `md`
 * (a tablet reads two modules across) and to one below it (a phone reads one), which is
 * the responsive contract `UX.2A` §21 sets.
 *
 * WHY A MODULE IS A `<section>` WITH A REAL HEADING
 * -------------------------------------------------
 * A screen-reader user navigating by heading gets the same structure a sighted reader
 * gets from the panel boundary. The alternative — visually-hidden pane headings inside
 * undifferentiated regions, which is what this route did before — gives a keyboard user a
 * list of names with no relationship to the visible layout.
 *
 * `data-visual-region` IS A TEST HOOK AND NOTHING ELSE. It marks the modules whose
 * content is data-driven geometry, so the first-viewport contract in `UX.2A` §4 can be
 * asserted by measurement rather than by eye. It carries no styling and no meaning to a
 * reader.
 *
 * Server components. No client JavaScript.
 */
import type { ReactNode } from 'react'

import { Container, Section } from '@/components/ui/layout'
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* The grid                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One row of the workspace.
 *
 * `gap-4` rather than the section rhythm: the modules in a row are one screen of one
 * subject, and the fluid section padding built for documentation routes put most of a
 * viewport height between figures a reader was trying to compare.
 */
export function GridRow({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cx('grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12', className)}
    >
      {children}
    </div>
  )
}

/**
 * The column spans a module may take, written out in full.
 *
 * WRITTEN OUT BECAUSE TAILWIND SCANS SOURCE TEXT. A span built by template literal
 * produces no CSS at all, and the module renders at full width — which looks like a
 * layout decision rather than the bug it is.
 */
const SPAN: Readonly<Record<3 | 4 | 5 | 6 | 7 | 8 | 12, string>> = {
  3: 'md:col-span-3 xl:col-span-3',
  4: 'md:col-span-3 xl:col-span-4',
  5: 'md:col-span-3 xl:col-span-5',
  6: 'md:col-span-6 xl:col-span-6',
  7: 'md:col-span-6 xl:col-span-7',
  8: 'md:col-span-6 xl:col-span-8',
  12: 'md:col-span-6 xl:col-span-12',
}

/**
 * The restrained domain washes, one class per business area.
 *
 * A WASH ENCODES NOTHING. The stock module is amber whether the lot is clean or ageing
 * badly. No `zone-*` token is a `data-*` token, so a tint can never be read as a value —
 * the rule `UX.1` established and this pass keeps, moved from the band to the module now
 * that the module is the unit a reader's eye lands on.
 */
const ZONE: Readonly<Record<'performance' | 'plan' | 'inventory' | 'funnel', string>> = {
  performance: 'bg-zone-performance',
  plan: 'bg-zone-plan',
  inventory: 'bg-zone-inventory',
  funnel: 'bg-zone-funnel',
}

export interface ModuleProps {
  /** The anchor. Several of these were region anchors and links point at them. */
  readonly id?: string
  /** The module's name. A noun phrase naming the question, never a sentence. */
  readonly title: string
  /**
   * The ONE sentence a reader would misread the module without.
   *
   * Almost every module passes nothing. A note that describes what the module contains is
   * describing what its title and its labels already say, and six of those on one screen
   * is what made this route read as a document.
   */
  readonly note?: ReactNode
  /** A drill-through, a scope line, a count. Sits opposite the title. */
  readonly meta?: ReactNode
  /** Columns at `xl`. At `md` a module is half the screen; below it, all of it. */
  readonly span?: keyof typeof SPAN
  readonly zone?: keyof typeof ZONE
  /** Set when the module's body is data-driven geometry, for the viewport contract. */
  readonly visual?: string
  readonly headingLevel?: 2 | 3
  readonly children: ReactNode
  readonly className?: string
}

export function Module({
  id,
  title,
  note,
  meta,
  span = 12,
  zone,
  visual,
  headingLevel = 2,
  children,
  className,
}: ModuleProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const headingId = `module-${(id ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-visual-region={visual}
      className={cx(
        'flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line-subtle p-3.5',
        zone === undefined ? 'bg-surface/60' : ZONE[zone],
        SPAN[span],
        className
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading
          id={headingId}
          className="text-sm font-semibold tracking-tight text-ink-secondary"
        >
          {title}
        </Heading>
        {meta === undefined ? null : (
          <span className="text-xs text-ink-faint">{meta}</span>
        )}
      </div>
      {note === undefined ? null : (
        <p className="max-w-prose text-xs leading-normal text-ink-muted">{note}</p>
      )}
      {children}
    </section>
  )
}

/**
 * The workspace itself: the grid rows, inside one section and one container.
 *
 * `rhythm="none"` and a flat `py-5`. The console is one subject looked at from several
 * angles, and a fluid section rhythm between rows would reintroduce the vertical
 * emptiness this pass removed.
 */
export function Workspace({ children }: { readonly children: ReactNode }) {
  return (
    <Section rhythm="none" className="py-4">
      <Container width="full">
        <div className="flex flex-col gap-3">{children}</div>
      </Container>
    </Section>
  )
}
