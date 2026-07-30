'use client'

/**
 * The hero visual: synthetic source data -> PostgreSQL layers -> governed
 * semantic model -> managerial decision.
 *
 * WHAT IT IS
 * ----------
 * One inline SVG, roughly 6 kB of markup, animated with CSS-driven stroke dash
 * offsets and a Motion orchestration for the node reveals. No canvas, no WebGL,
 * no particle system, no charting library. The whole thing renders in the
 * server-side HTML and the client work is limited to starting the animation.
 *
 * WHY NOT THREE.JS
 * ----------------
 * A 3D renderer would add roughly 150 kB gzipped and a GPU context to draw a
 * flow diagram that is intrinsically 2D and intrinsically diagrammatic. The
 * performance review in portfolio/docs/PERFORMANCE.md section 7 records the
 * comparison. SVG wins on weight, on accessibility, on the reduced-motion path,
 * and on the fact that a reader can zoom it to 400% and read the labels.
 *
 * WHAT THE MOTION IS FOR
 * ----------------------
 * The signal packets travel left to right along the lanes, once per cycle,
 * because the diagram's subject IS the direction of travel. Watching a value
 * pass from a generator through validation into the warehouse and out to a
 * decision is the fastest way to communicate "this is a governed pipeline, not a
 * dashboard". Remove the movement and the reader has to trace the arrows
 * themselves.
 *
 * ACCESSIBILITY
 * -------------
 * The SVG is `role="img"` with a full text alternative that describes the
 * pipeline in reading order, so a screen-reader user gets the content rather
 * than "graphic". The same content is also present as real text in the hero's
 * stage list below the graphic on small viewports, so nothing depends on the
 * image at all.
 *
 * REDUCED MOTION
 * --------------
 * Every path renders complete and every node renders visible, with no packets.
 * The diagram is a static schematic. Nothing is lost, because the packets carry
 * no information the arrows do not.
 */
import { motion } from 'motion/react'

import { usePrefersReducedMotion } from '@/lib/hooks'
import { DURATION, EASE, STAGGER } from '@/lib/motion'
import { cx } from '@/lib/utils'

/** The four stages, left to right. Labels are short by design. */
const STAGES = [
  { id: 'source', label: 'Synthetic source', sub: 'Seeded Python generators' },
  { id: 'warehouse', label: 'PostgreSQL layers', sub: 'raw / staging / warehouse' },
  { id: 'model', label: 'Governed model', sub: 'reporting -> semantic model' },
  { id: 'decision', label: 'Managerial decision', sub: 'One consistent answer' },
] as const

/**
 * The text alternative. Written as prose in reading order rather than as a list
 * of shapes, because a description of an SVG's geometry tells a screen-reader
 * user nothing.
 */
const ALT_TEXT =
  'A four-stage pipeline diagram. On the left, five synthetic source generators feed into a validation gate. ' +
  'From there a single lane passes through three stacked PostgreSQL layers labelled raw, staging and warehouse, ' +
  'then into a reporting layer. Above the reporting layer sits the governed semantic model, drawn with a dashed ' +
  'outline to show that it has been built but not yet validated by a Microsoft engine. Two lanes leave the model ' +
  'toward a managerial decision on the right. A dashed lane continues past the model to a greyed-out node ' +
  'labelled report pages, which do not exist yet.'

export function PipelineHero({ className }: { className?: string }) {
  const prefersReducedMotion = usePrefersReducedMotion()

  // One flag drives both the packet animation and the path drawing, so the two
  // can never disagree about whether motion is allowed.
  const animate = !prefersReducedMotion

  return (
    <div className={cx('relative w-full', className)}>
      <svg
        viewBox="0 0 880 320"
        role="img"
        aria-label={ALT_TEXT}
        className="w-full"
        // The diagram is legible from 320px to an ultrawide display because it
        // scales as a unit; below `sm` the stage list beneath it carries the
        // labels at a readable size.
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Lane gradient: dim at the source, bright at the governed model. The
              brightening IS the metaphor - the value becomes trustworthy as it
              passes through the layers. */}
          <linearGradient id="hero-lane" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-accent-muted)" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="var(--color-accent)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="hero-lane-model" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-model)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--color-model)" stopOpacity="0.75" />
          </linearGradient>

          {/* The dimensional grid, as a background. */}
          <pattern id="hero-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="var(--color-line-strong)" />
          </pattern>
          <radialGradient id="hero-grid-fade" cx="0.5" cy="0.45" r="0.72">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="hero-grid-mask">
            <rect width="880" height="320" fill="url(#hero-grid-fade)" />
          </mask>
        </defs>

        <rect
          width="880"
          height="320"
          fill="url(#hero-grid)"
          mask="url(#hero-grid-mask)"
          opacity="0.5"
        />

        {/* ---------------------------------------------------------------
            Stage 1: five source generators converging on a validation gate
            --------------------------------------------------------------- */}
        <g stroke="url(#hero-lane)" strokeWidth="1.5" fill="none">
          {[64, 112, 160, 208, 256].map((y, index) => (
            <Lane
              key={y}
              d={`M52 ${String(y)} C110 ${String(y)} 130 160 178 160`}
              animate={animate}
              delay={index * STAGGER}
            />
          ))}
        </g>

        <g>
          {[64, 112, 160, 208, 256].map((y, index) => (
            <Node
              key={y}
              x={44}
              y={y}
              size={16}
              tone="source"
              animate={animate}
              delay={index * STAGGER}
            />
          ))}
        </g>

        {/* The validation gate. A diamond, because a gate is a decision point and
            a rectangle would read as another storage layer. */}
        <Node
          x={178}
          y={160}
          size={22}
          tone="gate"
          shape="diamond"
          animate={animate}
          delay={0.3}
        />

        {/* ---------------------------------------------------------------
            Stage 2: the three PostgreSQL layers, stacked
            --------------------------------------------------------------- */}
        <g stroke="url(#hero-lane)" strokeWidth="1.5" fill="none">
          <Lane d="M200 160 H288" animate={animate} delay={0.36} />
          <Lane d="M340 160 H420" animate={animate} delay={0.5} />
          <Lane d="M472 160 H552" animate={animate} delay={0.62} />
        </g>

        <LayerBlock x={288} label="raw" animate={animate} delay={0.42} />
        <LayerBlock x={420} label="staging" animate={animate} delay={0.54} />
        <LayerBlock x={552} label="warehouse" animate={animate} delay={0.66} />

        {/* ---------------------------------------------------------------
            Stage 3: reporting, then the semantic model above it
            --------------------------------------------------------------- */}
        <g stroke="url(#hero-lane)" strokeWidth="1.5" fill="none">
          <Lane d="M604 160 H660" animate={animate} delay={0.74} />
        </g>
        <LayerBlock
          x={660}
          label="reporting"
          tone="reporting"
          animate={animate}
          delay={0.8}
        />

        {/* The semantic model, above the reporting layer and drawn with a dashed
            outline. The dash is not decorative: it is the visual encoding of
            "built but never loaded by an engine", and the legend below says so. */}
        <g stroke="url(#hero-lane-model)" strokeWidth="1.5" fill="none">
          <Lane d="M700 148 C736 148 736 82 772 82" animate={animate} delay={0.88} />
        </g>
        <g>
          <motion.rect
            x="738"
            y="60"
            width="96"
            height="44"
            rx="8"
            fill="var(--color-model-wash)"
            stroke="var(--color-model)"
            strokeWidth="1.5"
            strokeDasharray="5 3"
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.94, duration: DURATION.slow, ease: EASE.out }}
          />
          <text
            x="786"
            y="78"
            textAnchor="middle"
            fill="var(--color-model)"
            className="font-mono"
            fontSize="9.5"
            letterSpacing="0.6"
          >
            SEMANTIC
          </text>
          <text
            x="786"
            y="91"
            textAnchor="middle"
            fill="var(--color-model)"
            className="font-mono"
            fontSize="9.5"
            letterSpacing="0.6"
          >
            MODEL
          </text>
        </g>

        {/* ---------------------------------------------------------------
            Stage 4: the decision, and the report pages that do not exist
            --------------------------------------------------------------- */}
        <g stroke="url(#hero-lane-model)" strokeWidth="1.5" fill="none">
          <Lane d="M700 172 C736 172 736 238 772 238" animate={animate} delay={0.92} />
        </g>
        <Node x={790} y={238} size={20} tone="decision" animate={animate} delay={1} />
        <text
          x="790"
          y="272"
          textAnchor="middle"
          fill="var(--color-accent)"
          className="font-mono"
          fontSize="9.5"
          letterSpacing="0.6"
        >
          DECISION
        </text>

        {/* The pending report layer. Grey, dashed, no packet ever travels to it,
            and its label says so. This is the honest part of the diagram: the
            hero shows what does not exist as clearly as what does. */}
        <path
          d="M834 82 C858 82 862 130 862 150"
          stroke="var(--color-line-strong)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          fill="none"
        />
        <rect
          x="826"
          y="150"
          width="46"
          height="30"
          rx="6"
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <text
          x="849"
          y="169"
          textAnchor="middle"
          fill="var(--color-ink-faint)"
          className="font-mono"
          fontSize="8"
          letterSpacing="0.4"
        >
          PAGES
        </text>
        <text
          x="849"
          y="196"
          textAnchor="middle"
          fill="var(--color-ink-faint)"
          className="font-mono"
          fontSize="7.5"
          letterSpacing="0.4"
        >
          NOT BUILT
        </text>

        {/* Alignment marks. A blueprint annotation that also serves as the
            diagram's baseline reference. */}
        <g stroke="var(--color-line)" strokeWidth="1">
          <path d="M20 296 H860" strokeDasharray="2 6" />
          <path d="M20 290 V302 M860 290 V302" />
        </g>
      </svg>

      {/* The stage list. Real text, always present, so the pipeline is
          comprehensible with images off, with CSS off, and at any zoom. On small
          viewports it is the primary reading of the diagram rather than a
          caption for it. */}
      <ol className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {STAGES.map((stage, index) => (
          <li key={stage.id} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-mono text-2xs text-accent">
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span aria-hidden="true" className="h-px w-3 bg-accent-muted" />
            </span>
            <span className="text-sm font-semibold text-ink">{stage.label}</span>
            <span className="font-mono text-2xs leading-normal text-ink-faint">
              {stage.sub}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A lane, plus the packet that travels along it.
 *
 * The path draws itself with a stroke dash offset. `data-arpi-draw` is the hook
 * the reduced-motion block in globals.css uses to force the offset to zero, so
 * even if this component's `animate` flag were somehow wrong, the path would
 * still render complete rather than invisible. Two independent guards for the
 * one failure mode that would leave the hero blank.
 */
function Lane({ d, animate, delay }: { d: string; animate: boolean; delay: number }) {
  return (
    <>
      <motion.path
        d={d}
        data-arpi-draw=""
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: { delay, duration: DURATION.deliberate, ease: EASE.out },
          opacity: { delay, duration: DURATION.fast },
        }}
      />
      {animate ? (
        // The signal packet. A 3px dot that runs the path on an 8-second loop
        // with a long pause between passes, so the diagram is mostly still. A
        // packet every second would read as traffic; every eight reads as a
        // periodic batch, which is what this pipeline actually is.
        <motion.circle
          r="2.6"
          fill="var(--color-accent)"
          stroke="none"
          initial={{ offsetDistance: '0%', opacity: 0 }}
          animate={{ offsetDistance: '100%', opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 2.4,
            times: [0, 0.12, 0.85, 1],
            ease: EASE.standard,
            repeat: Infinity,
            repeatDelay: 5.6,
            delay: delay + 1.2,
          }}
          style={{ offsetPath: `path("${d}")`, offsetRotate: '0deg' }}
        />
      ) : null}
    </>
  )
}

const NODE_TONE = {
  source: { fill: 'var(--color-surface)', stroke: 'var(--color-accent-muted)' },
  gate: { fill: 'var(--color-accent-wash)', stroke: 'var(--color-accent)' },
  decision: { fill: 'var(--color-accent-wash)', stroke: 'var(--color-accent)' },
} as const

function Node({
  x,
  y,
  size,
  tone,
  shape = 'square',
  animate,
  delay,
}: {
  x: number
  y: number
  size: number
  tone: keyof typeof NODE_TONE
  shape?: 'square' | 'diamond'
  animate: boolean
  delay: number
}) {
  const { fill, stroke } = NODE_TONE[tone]
  const half = size / 2
  return (
    <motion.g
      initial={animate ? { opacity: 0, scale: 0.75 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: DURATION.slow, ease: EASE.out }}
      style={{ transformOrigin: `${String(x)}px ${String(y)}px` }}
    >
      <rect
        x={x - half}
        y={y - half}
        width={size}
        height={size}
        rx={shape === 'diamond' ? 3 : 4}
        fill={fill}
        stroke={stroke}
        strokeWidth="1.6"
        transform={
          shape === 'diamond' ? `rotate(45 ${String(x)} ${String(y)})` : undefined
        }
      />
      {tone !== 'source' ? (
        <circle cx={x} cy={y} r={size / 5} fill={stroke} stroke="none" />
      ) : null}
    </motion.g>
  )
}

/** One PostgreSQL schema layer. */
function LayerBlock({
  x,
  label,
  tone = 'default',
  animate,
  delay,
}: {
  x: number
  label: string
  tone?: 'default' | 'reporting'
  animate: boolean
  delay: number
}) {
  const stroke =
    tone === 'reporting' ? 'var(--color-accent)' : 'var(--color-accent-muted)'
  const fill =
    tone === 'reporting' ? 'var(--color-accent-wash)' : 'var(--color-surface-raised)'
  return (
    <motion.g
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: DURATION.slow, ease: EASE.out }}
    >
      <rect
        x={x}
        y={138}
        width={52}
        height={44}
        rx="7"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Three internal rules, suggesting stacked rows without drawing a table. */}
      <g stroke={stroke} strokeWidth="1" opacity="0.35">
        <path d={`M${String(x + 9)} 152 H${String(x + 43)}`} />
        <path d={`M${String(x + 9)} 160 H${String(x + 43)}`} />
        <path d={`M${String(x + 9)} 168 H${String(x + 43)}`} />
      </g>
      <text
        x={x + 26}
        y={202}
        textAnchor="middle"
        fill={tone === 'reporting' ? 'var(--color-accent)' : 'var(--color-ink-muted)'}
        className="font-mono"
        fontSize="8.5"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </motion.g>
  )
}
