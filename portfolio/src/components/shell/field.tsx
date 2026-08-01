/**
 * The blue field and the white master canvas.
 *
 * These two components are the design. Every route renders `<FieldMotif>` once
 * from the root layout and wraps its content in one or more `<Canvas>` panels,
 * and that is what makes eight pages written at different times read as one
 * system.
 *
 * Both are server components. Neither ships any client JavaScript.
 */
import type { ElementType, ReactNode } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* FieldMotif                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The geometric data motif drawn on the blue field.
 *
 * WHAT IT DEPICTS
 * ---------------
 * Dimensional-model geometry, not decoration for its own sake: warehouse table
 * outlines with a header bar and rows, hexagonal model nodes, relationship
 * paths running between them, and a pipeline trace crossing the field. It is
 * the same vocabulary the Architecture and Data Model routes use in the
 * foreground, at a scale where it reads as texture rather than as a diagram.
 *
 * WHY IT IS STATIC
 * ----------------
 * The direction permits "small geometry drift". It is deliberately not taken.
 * This element is `position: fixed`, so it is on screen on every route for the
 * whole visit - an animation here is not a moment, it is a permanent repaint on
 * every page the site has. That is the "continuous high CPU use" the same
 * direction rules out, and the reference layout's defining quality is that it
 * is calm. A background that never stops moving is the one thing that would
 * make this page read as a presentation template.
 *
 * The consequence worth stating: there is no reduced-motion variant of this
 * component, because there is no motion to reduce. It renders identically under
 * every preference.
 *
 * HOW IT IS KEPT OUT OF THE WAY
 * -----------------------------
 *   - `aria-hidden` and no title or desc, so it is not in the accessibility
 *     tree at all. It carries no information a screen-reader user needs.
 *   - `pointer-events: none`, so it never intercepts a click meant for content.
 *   - `position: fixed` with `z-index: -1`, so it participates in no layout and
 *     can produce no shift.
 *   - Two densities. The dense marginal group is hidden below the `md`
 *     breakpoint, because at 375px the margins the desktop composition fills
 *     are where the canvas already is.
 *
 * Cost: one inline SVG, roughly 3 kB of markup, no request, no script.
 */
export function FieldMotif() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-(--arpi-z-field) overflow-clip"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
        role="presentation"
      >
        <defs>
          {/* A warehouse table: header bar plus three rows. Used at several
              scales, which is why it is a symbol rather than repeated markup. */}
          <symbol id="arpi-table" viewBox="0 0 120 96">
            <rect
              x="0.75"
              y="0.75"
              width="118.5"
              height="94.5"
              rx="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M0.75 26H119.25" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M0.75 49H119.25M0.75 72H119.25"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.55"
            />
            <path d="M40 26V95" stroke="currentColor" strokeWidth="1" opacity="0.55" />
          </symbol>

          {/* A model node. */}
          <symbol id="arpi-hex" viewBox="0 0 100 116">
            <path
              d="M50 2 96 28.5v58L50 113 4 86.5v-58Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </symbol>
        </defs>

        {/*
          Both groups use `currentColor`, set once here. The opacity tokens are
          the only place the motif's weight is decided.
        */}
        <g className="text-(--arpi-inverse-100)">
          {/* ---- Base layer: present at every width -------------------- */}
          <g className="opacity-(--arpi-opacity-motif)">
            {/* Left margin: a governed model cluster. */}
            <use href="#arpi-hex" x="-34" y="86" width="200" height="232" />
            <use href="#arpi-table" x="58" y="470" width="150" height="120" />

            {/* Right margin: the serving side. */}
            <use href="#arpi-hex" x="1298" y="384" width="176" height="204" />
            <use href="#arpi-table" x="1236" y="86" width="150" height="120" />

            {/* The pipeline trace: source systems on the left, through the
                governed middle, out to the analytical domains on the right. It
                passes behind the canvas, which is the point - the page sits on
                top of the platform rather than beside it. */}
            <path
              d="M-20 742C220 742 268 610 470 610s286 150 520 150 320-118 480-118"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.7"
            />
            <circle cx="470" cy="610" r="5" fill="currentColor" />
            <circle cx="990" cy="760" r="5" fill="currentColor" />
          </g>

          {/* ---- Marginal detail: md and up ------------------------------
              Hidden on a phone. At 375px the composition's margins are where
              the canvas already sits, so this group would render underneath it
              and cost markup for nothing. */}
          <g className="hidden opacity-(--arpi-opacity-motif) md:block">
            {/* Column ticks: the grain of a fact table. */}
            <g strokeWidth="1.5" stroke="currentColor" strokeLinecap="round">
              <path d="M126 214v54M158 214v78M190 214v36M222 214v62" />
              <path d="M1216 656v54M1248 656v78M1280 656v36M1312 656v62" />
            </g>

            {/* Relationship paths between the model nodes and the tables. */}
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="5 9"
              opacity="0.75"
            >
              <path d="M120 300C120 392 168 434 208 470" />
              <path d="M1330 300C1330 372 1320 400 1330 384" />
              <path d="M1236 146C1140 146 1090 214 1064 268" />
            </g>

            {/* Small filled nodes. */}
            <g fill="currentColor" className="opacity-(--arpi-opacity-motif-strong)">
              <circle cx="120" cy="300" r="4.5" />
              <circle cx="208" cy="470" r="4.5" />
              <circle cx="1330" cy="300" r="4.5" />
              <circle cx="1064" cy="268" r="4.5" />
              <circle cx="1386" cy="206" r="4.5" />
            </g>

            {/* A faint dimensional grid in the two lower corners. */}
            <g stroke="currentColor" strokeWidth="1" opacity="0.4">
              <path d="M0 838h300M0 866h300M0 894h300" />
              <path d="M1140 838h300M1140 866h300M1140 894h300" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

export interface CanvasProps {
  children: ReactNode
  className?: string
  as?: ElementType
  /**
   * `master` is the dominant panel a route opens with. `panel` is a second,
   * smaller canvas further down the same page, used when the blue field should
   * be visible between two bodies of content.
   */
  variant?: 'master' | 'panel'
  id?: string
}

/**
 * The floating white canvas.
 *
 * One connected surface, not a stack of cards. Sections inside it separate
 * themselves with spacing, a ground shift or a hairline - never by becoming
 * another bordered box, which is the pattern this direction exists to remove.
 *
 * The horizontal inset is a token rather than a page decision, so the blue
 * field is visible down both sides by the same amount on every route: 12px at
 * 320px and 40px on a desktop.
 */
export function Canvas({
  children,
  className,
  as: Tag = 'div',
  variant = 'master',
  id,
}: CanvasProps) {
  return (
    /*
     * Two elements, not one. The outer element owns the inset from the viewport
     * edge and the inner one owns the panel's own maximum width, so the blue
     * field is visible down both sides at EVERY viewport - including one wider
     * than the panel's cap, where a single element with `max-width` plus
     * `margin: auto` would simply centre the panel and leave the inset doing
     * nothing.
     */
    <div className="w-full px-canvas-inset">
      <Tag
        id={id}
        className={cx(
          'canvas-panel mx-auto w-full',
          variant === 'master' ? 'max-w-canvas' : 'max-w-wide',
          className
        )}
      >
        {children}
      </Tag>
    </div>
  )
}
