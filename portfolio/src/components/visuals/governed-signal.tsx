/**
 * The signature visual: six fragmented dealership systems becoming one governed
 * answer.
 *
 * This is the memorable image the site did not have. It is the hero on the home
 * page, the composition the social preview is drawn from, and the thing a
 * reviewer is expected to remember an hour later.
 *
 * A SERVER COMPONENT, WITH MOTION
 * -------------------------------
 * There is no `use client` here and no animation library. Every moving part is a
 * CSS animation on an SVG attribute, declared inline from design tokens. That
 * matters for three reasons and each one was a finding in the baseline audit:
 *
 *   1. The home page shipped 230 kB of JavaScript, a large part of it the
 *      animation library, to draw eight rectangles and move them (B-08). This
 *      component ships none.
 *   2. The library's `motion.rect` animated `width` while `width` was also an
 *      SVG attribute, which threw `Expected length, "undefined"` eight times on
 *      every render (B-04). An attribute that is never animated cannot do that.
 *   3. Motion must not block content. A CSS animation on a fully-drawn diagram
 *      cannot: every node, label and path is in the markup at its final position
 *      and the animation only changes opacity and a dash offset.
 *
 * TWO COMPOSITIONS, NOT ONE SCALED DOWN
 * -------------------------------------
 * An 880-unit-wide diagram rendered into a 375px phone puts a 9.5px label on
 * screen at roughly 4px. The first attempt let it bleed off the right edge
 * instead, which produced 85px of real horizontal page scroll at 375px and 140px
 * at 320px - caught by the overflow check in `scripts/capture-review-screenshots.ts`
 * before it reached a commit.
 *
 * So there are two: a landscape composition for `sm` and above, and a portrait
 * one below it that says the same thing top to bottom. Both are `aria-hidden`,
 * and the accessible equivalent is a single visually-hidden paragraph outside
 * them - which is what stops a viewport change from changing what a screen
 * reader is told, and stops the description being announced twice.
 *
 * REDUCED MOTION
 * --------------
 * Handled by the site-wide block in globals.css, which collapses every animation
 * to 1ms. `[data-arpi-signal]` additionally removes the travelling dash
 * entirely, because a dash that does not travel is a stray mark on a diagram.
 * The composition still reads correctly without it: sources, a governed stack,
 * a pending model, domains, all connected.
 *
 * WHAT IT MAY AND MAY NOT CONTAIN
 * -------------------------------
 * Labels, layer names, states and relationships: yes. A number of any kind: no.
 * Not a revenue figure, not a conversion rate, not an inventory age, not a
 * plausible-looking trend line, not an alert, not a recommendation. The semantic
 * model has never been evaluated by an engine, so every value that could appear
 * here would be invented, and inventing one in the site's most-looked-at
 * composition is the exact failure the project exists to demonstrate the
 * opposite of.
 *
 * The one exception is the state of the semantic-model tile, which is drawn in
 * the pending register - dashed, violet, labelled - because that is true.
 */
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Shared content                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The six source systems. Named as a dealership names them, not as a data
 * platform would: a general manager recognises "DMS" and "F&I", not
 * "transactional source A".
 */
const SOURCES = ['DMS', 'CRM', 'INVENTORY', 'MARKETING', 'F&I', 'SERVICE'] as const

/** The PostgreSQL layers, bottom of the governed stack to top. */
const LAYERS = ['raw', 'staging', 'warehouse', 'reporting'] as const

/** The analytical domains the governed model resolves into. */
const DOMAINS = [
  'Sales',
  'Gross',
  'Inventory',
  'Leads',
  'Marketing',
  'Data quality',
] as const

/**
 * The accessible equivalent of the diagram, not a summary of it.
 *
 * A screen-reader user gets the same six systems, the same four layers, the same
 * pending state and the same six domains, in the same order, because the answer
 * to an inaccessible diagram is an equivalent one rather than an apology for it.
 */
const DESCRIPTION =
  'Six dealership source systems - DMS, CRM, inventory, marketing, F and I, and ' +
  'service - each holding its own definitions and its own reporting cycle. Their ' +
  'signals converge on a single governance gate, then pass through four ' +
  'PostgreSQL layers: raw as imported, staging typed and deduplicated, warehouse ' +
  'at a declared grain, and reporting as the only surface anything above it may ' +
  'read. Above the reporting layer sits the Power BI semantic model, drawn with a ' +
  'dashed outline because it is built and statically validated but has never been ' +
  'loaded by a Microsoft engine. From it, six analytical domains resolve: sales, ' +
  'gross, inventory, leads, marketing and data quality. No value of any kind ' +
  'appears in this diagram.'

/* -------------------------------------------------------------------------- */
/* The component                                                               */
/* -------------------------------------------------------------------------- */

export function GovernedSignal({ className }: { className?: string }) {
  return (
    <figure className={cx('m-0 flex flex-col', className)}>
      {/* The one accessible description, outside both SVGs so that neither the
          viewport nor `display: none` can change what is announced. */}
      <p className="sr-only">
        How ARPI turns fragmented dealership systems into one governed view. {DESCRIPTION}
      </p>
      <WideSignal className="hidden sm:block" />
      <StackedSignal className="sm:hidden" />
    </figure>
  )
}

/* -------------------------------------------------------------------------- */
/* Landscape, sm and above                                                     */
/* -------------------------------------------------------------------------- */

/*
 * The landscape geometry.
 *
 * The viewBox is 760 units wide against a column that is roughly 760px at a
 * 1440px viewport, so the scale sits near 1 and a 12-unit label renders at close
 * to 12px. That is the constraint the whole layout is built around, and it is
 * why the first version was rebuilt: an 880-unit box in the same column put
 * every label at roughly 8px and made the site's signature image its least
 * legible one.
 */
const W_VIEW = { width: 760, height: 344 }
const W_SOURCE_W = 104
const W_GATE_X = 200
const W_STACK_X = 258
const W_STACK_W = 150
const W_MODEL_X = 448
const W_DOMAIN_X = 596
/** The horizontal line every stage hangs off. */
const W_SPINE_Y = 168

function WideSignal({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${String(W_VIEW.width)} ${String(W_VIEW.height)}`}
      aria-hidden="true"
      className={cx('w-full', className)}
    >
      <GridGround id="gs-w" width={W_VIEW.width} height={W_VIEW.height} />

      {/* 1. The fragmented half. The six inbound paths cross each other and
             arrive at the gate from different depths. The crossing is the
             argument: these systems do not agree, and the picture says so
             before the paragraph beside it does. */}
      <g fill="none" strokeWidth="1.2">
        {SOURCES.map((label, index) => {
          const y = 36 + index * 44
          const path = inboundPath(y, index)
          return (
            <g key={label}>
              <path d={path} stroke="var(--color-line-strong)" opacity="0.9" />
              {/* One dash the length of the path's own gap, offset to the start
                  and animated to zero: exactly one pulse runs the path once and
                  stops. Each source starts a beat after the one above, which is
                  what makes the eye follow the convergence rather than see six
                  things blink at once. */}
              <path
                data-arpi-signal=""
                d={path}
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="24 800"
                style={{
                  ['--signal-length' as string]: '824',
                  animation: 'var(--animate-signal-run)',
                  animationDelay: `${String(120 + index * 90)}ms`,
                }}
              />
            </g>
          )
        })}
      </g>

      {SOURCES.map((label, index) => {
        const y = 36 + index * 44
        return (
          <g key={label} style={wake(index * 70)}>
            <rect
              x="8"
              y={y - 13}
              width={W_SOURCE_W}
              height="26"
              rx="5"
              fill="var(--color-surface)"
              stroke="var(--color-line-strong)"
              strokeWidth="1.3"
            />
            <text
              x="20"
              y={y + 4}
              fill="var(--color-ink-secondary)"
              className="font-mono"
              fontSize="11.5"
              letterSpacing="0.7"
            >
              {label}
            </text>
          </g>
        )
      })}

      <Caption x={8} y={330}>
        SOURCE SYSTEMS
      </Caption>

      {/* 2. The governance gate. */}
      <g style={wake(620)}>
        <rect
          x={W_GATE_X}
          y="112"
          width="16"
          height="112"
          rx="8"
          fill="var(--color-accent-wash)"
          stroke="var(--color-accent)"
          strokeWidth="1.6"
        />
        <path
          d={`M${String(W_GATE_X + 8)} 126 V210`}
          stroke="var(--color-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.6"
        />
        <text
          x={W_GATE_X + 8}
          y="244"
          textAnchor="middle"
          fill="var(--color-accent)"
          className="font-mono"
          fontSize="10"
          letterSpacing="1"
        >
          GOVERNED
        </text>
      </g>

      {/* 3. The PostgreSQL stack. */}
      {LAYERS.map((label, index) => {
        const y = 48 + index * 40
        const isReporting = label === 'reporting'
        return (
          <g key={label} style={wake(760 + index * 110)}>
            <rect
              x={W_STACK_X}
              y={y}
              width={W_STACK_W}
              height="30"
              rx="6"
              fill={
                isReporting ? 'var(--color-accent-wash)' : 'var(--color-surface-raised)'
              }
              stroke={isReporting ? 'var(--color-accent)' : 'var(--color-accent-muted)'}
              strokeWidth="1.4"
            />
            <text
              x={W_STACK_X + 14}
              y={y + 20}
              fill={isReporting ? 'var(--color-accent)' : 'var(--color-ink-secondary)'}
              className="font-mono"
              fontSize="12"
              letterSpacing="0.4"
            >
              {label}
            </text>
            {index < LAYERS.length - 1 ? (
              <path
                d={`M${String(W_STACK_X + W_STACK_W / 2)} ${String(y + 30)} V${String(y + 40)}`}
                stroke="var(--color-accent-muted)"
                strokeWidth="1.3"
              />
            ) : null}
          </g>
        )
      })}

      {/* The gate feeds the top of the stack. Raw sits at the top of the box and
          reporting at the bottom, because the reader is travelling left to right
          across the diagram rather than upward through it. */}
      <path
        d={`M${String(W_GATE_X + 16)} ${String(W_SPINE_Y)} H${String(W_STACK_X - 10)} M${String(W_STACK_X - 10)} ${String(W_SPINE_Y)} V63 H${String(W_STACK_X)}`}
        fill="none"
        stroke="var(--color-accent-muted)"
        strokeWidth="1.3"
      />

      <Caption x={W_STACK_X} y={330}>
        POSTGRESQL
      </Caption>

      {/* 4. The semantic model, in the pending register. */}
      <g style={wake(1240)}>
        <path
          d={`M${String(W_STACK_X + W_STACK_W)} 183 H${String(W_MODEL_X - 12)} M${String(W_MODEL_X - 12)} 183 V${String(W_SPINE_Y)} H${String(W_MODEL_X)}`}
          fill="none"
          stroke="var(--color-model)"
          strokeWidth="1.3"
          strokeDasharray="4 3"
        />
        <rect
          x={W_MODEL_X}
          y="138"
          width="118"
          height="60"
          rx="9"
          fill="var(--color-model-wash)"
          stroke="var(--color-model)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text
          x={W_MODEL_X + 14}
          y="162"
          fill="var(--color-model)"
          className="font-mono"
          fontSize="11.5"
          letterSpacing="0.4"
        >
          semantic
        </text>
        <text
          x={W_MODEL_X + 14}
          y="178"
          fill="var(--color-model)"
          className="font-mono"
          fontSize="11.5"
          letterSpacing="0.4"
        >
          model
        </text>
        <text
          x={W_MODEL_X + 59}
          y="218"
          textAnchor="middle"
          fill="var(--color-pending)"
          className="font-mono"
          fontSize="9.5"
          letterSpacing="0.7"
        >
          ENGINE PENDING
        </text>
      </g>

      {/* 5. The analytical domains. Six ordered tiles, evenly spaced, all
             aligned: the visual answer to the crossing strokes on the left. */}
      {DOMAINS.map((domain, index) => {
        const y = 36 + index * 38
        return (
          <g key={domain} style={wake(1420 + index * 80)}>
            <rect
              x={W_DOMAIN_X}
              y={y}
              width="156"
              height="30"
              rx="6"
              fill="var(--color-surface)"
              stroke="var(--color-line-strong)"
              strokeWidth="1.2"
            />
            <rect
              x={W_DOMAIN_X}
              y={y}
              width="3"
              height="30"
              rx="1.5"
              fill="var(--color-accent)"
            />
            <text
              x={W_DOMAIN_X + 14}
              y={y + 20}
              fill="var(--color-ink-secondary)"
              fontSize="12.5"
              letterSpacing="0.1"
            >
              {domain}
            </text>
          </g>
        )
      })}

      <path
        d={`M${String(W_MODEL_X + 118)} ${String(W_SPINE_Y)} H${String(W_DOMAIN_X - 14)} M${String(W_DOMAIN_X - 14)} 51 V241`}
        fill="none"
        stroke="var(--color-line-strong)"
        strokeWidth="1.2"
      />
      <g stroke="var(--color-line-strong)" strokeWidth="1.2" fill="none">
        {DOMAINS.map((domain, index) => (
          <path
            key={domain}
            d={`M${String(W_DOMAIN_X - 14)} ${String(51 + index * 38)} H${String(W_DOMAIN_X)}`}
          />
        ))}
      </g>

      <Caption x={W_DOMAIN_X} y={330}>
        ANALYTICAL DOMAINS
      </Caption>
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Portrait, below sm                                                          */
/* -------------------------------------------------------------------------- */

const S_VIEW = { width: 340, height: 500 }
const S_GATE_Y = 132

/**
 * The same argument, read downward.
 *
 * Deliberately not the landscape one rotated. Two things change because a phone
 * is a different reading surface: the six sources become a three-by-two block
 * rather than a column, so they occupy a band rather than a scroll; and the
 * domains become a two-by-three block for the same reason. Everything between
 * them stays a single vertical spine, which is the direction a thumb is already
 * moving.
 *
 * The viewBox is 340 units wide against a 320px minimum viewport, so every label
 * renders at roughly its nominal pixel size. That is the constraint the whole
 * layout is built around.
 */
function StackedSignal({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${String(S_VIEW.width)} ${String(S_VIEW.height)}`}
      aria-hidden="true"
      className={cx('w-full', className)}
    >
      <GridGround id="gs-s" width={S_VIEW.width} height={S_VIEW.height} vertical />

      <Caption x={8} y={14}>
        SOURCE SYSTEMS
      </Caption>

      {/* The six sources, three across and two down. */}
      {SOURCES.map((label, index) => {
        const col = index % 3
        const row = Math.floor(index / 3)
        const x = 8 + col * 110
        const y = 26 + row * 36
        return (
          <g key={label} style={wake(index * 70)}>
            <rect
              x={x}
              y={y}
              width="102"
              height="26"
              rx="5"
              fill="var(--color-surface)"
              stroke="var(--color-line-strong)"
              strokeWidth="1.1"
            />
            <text
              x={x + 10}
              y={y + 17}
              fill="var(--color-ink-muted)"
              className="font-mono"
              fontSize="9"
              letterSpacing="0.6"
            >
              {label}
            </text>
          </g>
        )
      })}

      {/* Convergence. Six curves from the bottom edge of the source block down
          into one gate, still crossing. */}
      <g fill="none" strokeWidth="1.1">
        {SOURCES.map((label, index) => {
          const col = index % 3
          const row = Math.floor(index / 3)
          const x = 59 + col * 110
          const y = 52 + row * 36
          const path = `M${String(x)} ${String(y)} C${String(x)} ${String(y + 28)} 170 ${String(S_GATE_Y - 34)} 170 ${String(S_GATE_Y)}`
          return (
            <g key={label}>
              <path d={path} stroke="var(--color-line-strong)" opacity="0.85" />
              <path
                data-arpi-signal=""
                d={path}
                stroke="var(--color-accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeDasharray="20 600"
                style={{
                  ['--signal-length' as string]: '620',
                  animation: 'var(--animate-signal-run)',
                  animationDelay: `${String(120 + index * 90)}ms`,
                }}
              />
            </g>
          )
        })}
      </g>

      {/* The gate. */}
      <g style={wake(620)}>
        <rect
          x="126"
          y={S_GATE_Y}
          width="88"
          height="14"
          rx="7"
          fill="var(--color-accent-wash)"
          stroke="var(--color-accent)"
          strokeWidth="1.4"
        />
        <text
          x="170"
          y={S_GATE_Y + 27}
          textAnchor="middle"
          fill="var(--color-accent)"
          className="font-mono"
          fontSize="8.5"
          letterSpacing="1.1"
        >
          GOVERNED
        </text>
      </g>

      {/* The PostgreSQL stack, as a vertical spine. */}
      <Caption x={8} y={186}>
        POSTGRESQL
      </Caption>
      {LAYERS.map((label, index) => {
        const y = 196 + index * 34
        const isReporting = label === 'reporting'
        return (
          <g key={label} style={wake(760 + index * 110)}>
            <rect
              x="60"
              y={y}
              width="220"
              height="26"
              rx="6"
              fill={
                isReporting ? 'var(--color-accent-wash)' : 'var(--color-surface-raised)'
              }
              stroke={isReporting ? 'var(--color-accent)' : 'var(--color-accent-muted)'}
              strokeWidth="1.2"
            />
            <text
              x="72"
              y={y + 17}
              fill={isReporting ? 'var(--color-accent)' : 'var(--color-ink-secondary)'}
              className="font-mono"
              fontSize="9.5"
              letterSpacing="0.5"
            >
              {label}
            </text>
            {index > 0 ? (
              <path
                d={`M170 ${String(y)} V${String(y - 8)}`}
                stroke="var(--color-accent-muted)"
                strokeWidth="1.2"
              />
            ) : null}
          </g>
        )
      })}
      <path
        d={`M170 ${String(S_GATE_Y + 14)} V196`}
        stroke="var(--color-accent-muted)"
        strokeWidth="1.2"
        fill="none"
      />

      {/* The semantic model, pending. */}
      <g style={wake(1240)}>
        <path
          d="M170 332 V344"
          stroke="var(--color-model)"
          strokeWidth="1.2"
          strokeDasharray="4 3"
          fill="none"
        />
        <rect
          x="60"
          y="344"
          width="220"
          height="34"
          rx="7"
          fill="var(--color-model-wash)"
          stroke="var(--color-model)"
          strokeWidth="1.3"
          strokeDasharray="5 4"
        />
        <text
          x="72"
          y="365"
          fill="var(--color-model)"
          className="font-mono"
          fontSize="9.5"
          letterSpacing="0.5"
        >
          semantic model
        </text>
        <text
          x="268"
          y="365"
          textAnchor="end"
          fill="var(--color-pending)"
          className="font-mono"
          fontSize="8"
          letterSpacing="0.6"
        >
          PENDING
        </text>
      </g>

      {/* The domains, two across and three down. */}
      <path
        d="M170 378 V396"
        stroke="var(--color-line-strong)"
        strokeWidth="1.1"
        fill="none"
      />
      <Caption x={8} y={406}>
        ANALYTICAL DOMAINS
      </Caption>
      {DOMAINS.map((domain, index) => {
        const col = index % 2
        const row = Math.floor(index / 2)
        const x = 8 + col * 166
        const y = 416 + row * 28
        return (
          <g key={domain} style={wake(1420 + index * 80)}>
            <rect
              x={x}
              y={y}
              width="158"
              height="24"
              rx="5"
              fill="var(--color-surface)"
              stroke="var(--color-line-strong)"
              strokeWidth="1.1"
            />
            <rect x={x} y={y} width="3" height="24" rx="1.5" fill="var(--color-accent)" />
            <text
              x={x + 12}
              y={y + 16}
              fill="var(--color-ink-secondary)"
              fontSize="10.5"
              letterSpacing="0.2"
            >
              {domain}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** The wake animation, as an inline style. One helper so the delay is the only
 *  thing a call site decides. */
function wake(delayMs: number): React.CSSProperties {
  return {
    animation: 'var(--animate-wake)',
    animationDelay: `${String(delayMs)}ms`,
  }
}

/** A small tracked caption inside the diagram. */
function Caption({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text
      x={x}
      y={y}
      fill="var(--color-ink-faint)"
      className="font-mono"
      fontSize="8.5"
      letterSpacing="1.1"
    >
      {children}
    </text>
  )
}

/**
 * The dimensional-grid ground. A pattern rather than an image, so it costs no
 * request and scales with the viewBox. The `id` is a parameter because both
 * compositions are in the document at once and duplicate SVG ids are resolved by
 * document order, which would give the portrait one the landscape one's mask.
 */
function GridGround({
  id,
  width,
  height,
  vertical = false,
}: {
  id: string
  width: number
  height: number
  vertical?: boolean
}) {
  return (
    <>
      <defs>
        <pattern id={`${id}-dots`} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="var(--color-line-strong)" />
        </pattern>
        <linearGradient
          id={`${id}-fade`}
          x1="0"
          y1="0"
          x2={vertical ? '0' : '1'}
          y2={vertical ? '1' : '0'}
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="55%" stopColor="white" stopOpacity="0.14" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width={width} height={height} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} opacity="0.5">
        <rect width={width} height={height} fill={`url(#${id}-dots)`} />
      </g>
    </>
  )
}

/**
 * One source system's path to the gate, in the landscape composition.
 *
 * Each curve overshoots vertically by a different amount so the six cross rather
 * than fanning neatly. A neat fan would say "these systems are organised", which
 * is the opposite of the thing being illustrated.
 */
function inboundPath(y: number, index: number): string {
  // Starts at the chip's right edge, not the page's. The first version began at
  // x=28 and every curve was drawn straight through the label beside it.
  const startX = 8 + W_SOURCE_W
  const overshoot = [54, -32, 40, -46, 28, -40][index] ?? 0
  const midX = startX + 16 + (index % 3) * 14
  return `M${String(startX)} ${String(y)} C${String(midX)} ${String(y)} ${String(midX + 40)} ${String(W_SPINE_Y + overshoot)} ${String(W_GATE_X)} ${String(W_SPINE_Y)}`
}
