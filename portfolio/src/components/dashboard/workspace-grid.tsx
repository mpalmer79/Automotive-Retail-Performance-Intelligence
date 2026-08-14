/**
 * The console's workspace grid: a module, and the twelve columns it sits in.
 *
 * IT WAS `exec-grid.tsx` AND IT IS NOT ANY MORE. `UX.2A` built it for one route and named it
 * after that route. `UX.2B` lays out `/dashboard/sales-gross`, `/dashboard/deals`,
 * `/dashboard/deals/[saleId]`, `/dashboard/inventory` and `/dashboard/fi` with the same three
 * components, so the old name had become a false statement about where the file is used. The
 * rename is the whole of that change: no prop, no span, no zone and no markup moved with it.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * `UX.1` left the Executive route as five full-width horizontal bands, each opening with an
 * eyebrow, an `h2` and usually a paragraph, stacked down an 8,161 px document. That is
 * the rhythm of an article. It reads top to bottom, one subject at a time, and it puts
 * the first framed figure 1,389 px from the top of a 900 px viewport — measured, in
 * `docs/reviews/UX-2-BASELINE.md`. The same shape, measured on the five revenue and vehicle
 * routes in `docs/reviews/UX-2B-BASELINE.md`, was worse: four of them contained no framed
 * figure at all.
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
 * WHY THE GROUND IS INVERTED — `EXEC.1`
 * ------------------------------------
 * Modules used to be TINTED PANELS ON A WHITE PAGE: each carried its business area's
 * pastel wash and sat on the canvas's pure white. Measured on the Executive route at
 * 1440 × 900, that produced a screen of pale teal cards inside a pale teal panel inside a
 * white page — three surfaces within about eight per cent of each other in luminance, so
 * nothing had an edge and the KPI cards read as ghosts of themselves. It also made a row
 * of three modules read as three unrelated pastel boxes rather than as one instrument,
 * because the only strong visual signal on the row was that the tints DIFFERED.
 *
 * The ground is now the other way round: the workspace is a soft recessed ground and every
 * module is the same WHITE raised card on it, with a hairline, a small shadow and a real
 * panel header. One surface vocabulary for every module on every operating route, and the
 * eye reads a row of modules as a row.
 *
 * THE DOMAIN WASH DID NOT LEAVE; IT MOVED AND SHRANK. It is now the ground of the
 * module's icon chip. It still names a business area, it still encodes nothing — the
 * stock module is amber whether the lot is clean or ageing badly — and no `zone-*` token
 * is a `data-*` token, so a tint still cannot be read as a value. What changed is that
 * four pastel washes no longer compete with the figures they are behind.
 *
 * THE GLYPH IS ONE COLOUR ON ALL FIVE CHIPS, and that is deliberate rather than lazy.
 * Colouring the icon by zone as well would double the encoding and would put a status
 * ramp — an emerald glyph, an amber glyph — beside figures this console publishes no
 * favourable direction for. The accent is the brand's one hue and means "ARPI", not
 * "good": `tokens.test.ts` measures it against every zone ground.
 *
 * Server components. No client JavaScript.
 */
import type { ComponentType, ReactNode, SVGProps } from 'react'

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
  align = 'stretch',
  className,
}: {
  readonly children: ReactNode
  /**
   * Whether the modules in the row stretch to the tallest, or size to their content.
   *
   * `stretch` IS THE DEFAULT AND IS USUALLY RIGHT: modules answering sibling questions
   * read as one band when their panels line up, and a 40 px difference resolved by
   * stretching is invisible.
   *
   * `start` exists for the case where the difference is not 40 px. A five-bar waterfall
   * beside a module with its own disclosures is a 350 px panel next to a 750 px one, and
   * stretching draws 400 px of empty bordered box under the waterfall. An empty panel is
   * not neutral — a reader looks into it for the thing that is missing. A ragged lower
   * edge says the modules are different sizes, which is true.
   */
  readonly align?: 'stretch' | 'start'
  readonly className?: string
}) {
  return (
    <div
      className={cx(
        'grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 xl:grid-cols-12',
        align === 'start' ? 'items-start' : null,
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * The column a module takes on a desktop, written out in full.
 *
 * WRITTEN OUT BECAUSE TAILWIND SCANS SOURCE TEXT. A span built by template literal
 * produces no CSS at all, and the module renders at full width — which looks like a
 * layout decision rather than the bug it is.
 */
const XL_SPAN: Readonly<Record<3 | 4 | 5 | 6 | 7 | 8 | 12, string>> = {
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  5: 'xl:col-span-5',
  6: 'xl:col-span-6',
  7: 'xl:col-span-7',
  8: 'xl:col-span-8',
  12: 'xl:col-span-12',
}

/**
 * The column a module takes on a tablet, where the grid is six wide.
 *
 * A SEPARATE MAP, AND `EXEC.1` SPLIT IT OUT OF THE DESKTOP ONE FOR A MEASURED REASON.
 * The tablet span used to be derived from the desktop one — anything below six columns
 * took half the tablet grid — which is right for a 4/4/4 row and wrong for a 5/4/3 one.
 * At 768 px the Executive route's stock, demand and gross row rendered as two half-width
 * modules and a third alone on the line beneath, and the attention and detail rows each
 * put one half-width module beside an empty half. Four ragged half-rows on one screen.
 *
 * Deriving the tablet span was also the reason the only available fix was a `className`
 * carrying a second `md:col-span-*`, which does not reliably win: `cx` is a join, and two
 * utilities setting the same property are resolved by the stylesheet's own ordering rather
 * than by the order they appear in the attribute. A prop cannot be ambiguous.
 */
const MD_SPAN: Readonly<Record<3 | 6, string>> = {
  3: 'md:col-span-3',
  6: 'md:col-span-6',
}

/** What a desktop span takes on a tablet when the module does not say. */
const MD_SPAN_DEFAULT: Readonly<Record<3 | 4 | 5 | 6 | 7 | 8 | 12, 3 | 6>> = {
  3: 3,
  4: 3,
  5: 3,
  6: 6,
  7: 6,
  8: 6,
  12: 6,
}

/**
 * The restrained domain washes, one class per business area.
 *
 * A WASH ENCODES NOTHING. The stock module is amber whether the lot is clean or ageing
 * badly. No `zone-*` token is a `data-*` token, so a tint can never be read as a value —
 * the rule `UX.1` established and every pass since has kept.
 *
 * `EXEC.1` moved it from the module's whole body to the module's icon chip, for the reason
 * the file comment records: four pastel bodies on one screen made a row of modules read as
 * four unrelated boxes and left every card inside them without an edge. A 28 px chip names
 * the business area just as well and competes with nothing.
 */
const ZONE: Readonly<
  Record<'performance' | 'plan' | 'inventory' | 'funnel' | 'finance', string>
> = {
  performance: 'bg-zone-performance',
  plan: 'bg-zone-plan',
  inventory: 'bg-zone-inventory',
  funnel: 'bg-zone-funnel',
  finance: 'bg-zone-finance',
}

/**
 * An icon component, as `lucide-react` exports one.
 *
 * Typed structurally rather than imported as `LucideIcon`, so this file — which every
 * operating route imports — does not pull the icon package into its own module graph for
 * the sake of a type.
 */
export type ModuleIcon = ComponentType<SVGProps<SVGSVGElement>>

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
  /**
   * The module's mark, drawn on the zone chip beside the title.
   *
   * DECORATIVE IN THE STRICT SENSE and `aria-hidden`, because the title beside it carries
   * the meaning — the same rule `domain-icon.tsx` states for the six analytical domains.
   * A module that passes none gets a chip-less header rather than a placeholder glyph.
   */
  readonly icon?: ModuleIcon
  /** Columns at `xl`. At `md` a module is half the screen; below it, all of it. */
  readonly span?: keyof typeof XL_SPAN
  /**
   * Columns at `md`, where the grid is six wide. Half by default for a desktop span
   * below six, whole at six and above.
   *
   * Passed by a module that would otherwise be the odd one out of a three-module row on
   * a tablet — see {@link MD_SPAN} for the four places that was happening.
   */
  readonly mdSpan?: keyof typeof MD_SPAN
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
  icon: Icon,
  span = 12,
  mdSpan,
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
        /*
         * `@container` MAKES THE MODULE THE LAYOUT REFERENCE FOR ITS OWN CONTENT.
         *
         * The section components were written when each was a full-width band, so their
         * fact grids ask for four columns at the `lg` VIEWPORT width — and a three-of-
         * twelve module on a 1440 px screen is about 300 px wide while still satisfying
         * `lg`. On the Deal Jacket that produced four ~70 px columns and broke a money
         * value across lines: `AMOUNT FINANCED` rendered as "$21,358." above "02".
         *
         * A container query asks how wide THIS PANEL is rather than how wide the window
         * is, which is the only question a module's contents can usefully ask. The class
         * costs nothing on its own; the grids inside opt in with `@sm:` / `@lg:`.
         */
        '@container',
        /*
         * ONE SURFACE FOR EVERY MODULE. White, a hairline, a small shadow, and the
         * workspace's recessed ground behind it. See the file comment on why this is the
         * inverse of what it replaced.
         */
        'flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line',
        'bg-surface-raised p-3.5 shadow-sm sm:p-4',
        MD_SPAN[mdSpan ?? MD_SPAN_DEFAULT[span]],
        XL_SPAN[span],
        className
      )}
    >
      {/*
        A REAL PANEL HEADER, RULED OFF FROM THE BODY.

        The header used to be one small muted line that the module's first figure sat
        directly under, so a module had a caption rather than a head. The hairline is what
        makes a panel read as a panel; the title takes the full ink colour because a
        module's name is the thing a reader navigates the grid by.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-subtle pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon === undefined ? null : (
            <span
              aria-hidden="true"
              className={cx(
                'grid size-7 shrink-0 place-items-center rounded-lg text-accent',
                zone === undefined ? 'bg-accent-wash' : ZONE[zone]
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
          )}
          <Heading
            id={headingId}
            className="min-w-0 text-sm font-semibold tracking-tight text-ink"
          >
            {title}
          </Heading>
        </div>
        {meta === undefined ? null : (
          <span className="shrink-0 text-2xs text-ink-faint">{meta}</span>
        )}
      </div>
      {note === undefined ? null : (
        <p className="max-w-prose text-2xs leading-normal text-ink-muted">{note}</p>
      )}
      {children}
    </section>
  )
}

/**
 * The workspace itself: the grid rows, inside one section and one container.
 *
 * `rhythm="none"` and a flat padding. The console is one subject looked at from several
 * angles, and a fluid section rhythm between rows would reintroduce the vertical
 * emptiness this pass removed.
 *
 * `tone="evidence"` IS WHAT MAKES A WHITE MODULE READ AS A CARD. The recessed ground is
 * the workspace's, and the modules are the raised things on it — the inversion the file
 * comment describes. It also draws a visible boundary between the control band above and
 * the working surface below without a second hairline doing it.
 */
export function Workspace({ children }: { readonly children: ReactNode }) {
  return (
    <Section rhythm="none" tone="evidence" className="py-4 sm:py-5">
      <Container width="full">
        <div className="flex flex-col gap-3 sm:gap-4">{children}</div>
      </Container>
    </Section>
  )
}
