/**
 * The ARPI visual identity.
 *
 * Two marks, both original to this project, both drawn as inline SVG so they
 * inherit the text colour and cost no network request.
 *
 * DESIGN RATIONALE
 * ----------------
 * The monogram is a 3x3 dimensional grid with an "A" formed by the signal path
 * through it: two diagonals rising to a shared apex and one crossbar, drawn as
 * strokes on the grid's lattice points. It reads as an A, and it reads as a
 * query path through a star schema. That double reading is the whole idea -
 * automotive precision expressed as a data structure rather than as a wheel, a
 * gauge, or a chevron.
 *
 * Deliberately NOT used: a steering wheel, a speedometer arc, a tachometer
 * needle, a tyre track, a chequered flag, a road-perspective vanishing point, a
 * chrome bevel, or an italic "speed" slant. Every one of those is an automotive
 * cliche, and none of them says anything about analytics.
 *
 * The wordmark sets ARPI in the display face at a tightened tracking with the
 * monogram as a lockup, and carries the full project name at small size beneath
 * it on the wide variant.
 *
 * The same geometry is reused for the favicon (public/favicon.svg), so the
 * identity is one shape at every size. The share card no longer shares it: since
 * ADR-0016 `public/brand/social-preview.png` is a supplied raster rather than a
 * render of these marks. Source geometry is documented in
 * portfolio/docs/DESIGN_SYSTEM.md section 8.
 */
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Monogram                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The mark alone. 32x32 viewBox on a 4-unit grid.
 *
 * `aria-hidden` by default: in every placement on this site the mark sits beside
 * the words "ARPI" or "Automotive Retail Performance Intelligence", so
 * announcing it again would make a screen reader say the name twice.
 */
export function Monogram({
  className,
  title,
}: {
  className?: string
  /** Supply only when the mark appears WITHOUT adjacent text. */
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cx('size-8', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
    >
      {/* The dimensional grid: nine lattice points at 8-unit spacing. Rendered
          at low opacity so it reads as structure rather than as decoration. */}
      <g fill="currentColor" opacity="0.28">
        <circle cx="6" cy="6" r="1.15" />
        <circle cx="16" cy="6" r="1.15" />
        <circle cx="26" cy="6" r="1.15" />
        <circle cx="6" cy="16" r="1.15" />
        <circle cx="26" cy="16" r="1.15" />
        <circle cx="6" cy="26" r="1.15" />
        <circle cx="16" cy="26" r="1.15" />
        <circle cx="26" cy="26" r="1.15" />
      </g>

      {/* The signal path: the two rising strokes and the crossbar that form the
          A. Butt caps and mitre joins, because a rounded terminal would soften
          a mark whose whole register is precision. */}
      <path
        d="M6 27 L16 5 L26 27"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M10.4 18.4 H21.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="square"
      />

      {/* The apex node. Solid, larger than the lattice points, and the mark's
          single point of emphasis - the resolved value at the end of the path. */}
      <circle cx="16" cy="5" r="2.4" fill="currentColor" />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Wordmark                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The horizontal lockup.
 *
 * `compact` is the header and footer form: mark plus "ARPI".
 * `full` adds the expanded project name, for the hero and the social preview.
 *
 * The text is real text, not a path, so it stays selectable, searchable and
 * legible at any zoom, and so it inherits the site's own font loading rather
 * than shipping a second copy of the letterforms.
 */
export function Wordmark({
  variant = 'compact',
  className,
}: {
  variant?: 'compact' | 'full'
  className?: string
}) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <Monogram className="size-7 shrink-0 text-accent" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-bold tracking-tight text-ink">
          ARPI
        </span>
        {variant === 'full' ? (
          <span className="mt-1 font-mono text-2xs leading-tight tracking-wide text-ink-muted">
            Automotive Retail
            <br />
            Performance Intelligence
          </span>
        ) : null}
      </span>
    </span>
  )
}
