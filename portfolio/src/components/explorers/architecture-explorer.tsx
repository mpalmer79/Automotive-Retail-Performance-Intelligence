'use client'

/**
 * The architecture explorer.
 *
 * Fourteen nodes on a fixed left-to-right layout. Selecting one highlights its
 * transitive upstream and downstream dependencies and opens a detail panel with
 * ownership, status, source paths, documentation, privacy boundary and role
 * access.
 *
 * WHY NOT AN INFINITE CANVAS
 * --------------------------
 * A pan-and-zoom canvas would let a reader lose the diagram, and there is nothing
 * here to explore that a fixed layout cannot show. The layout is also
 * information: left-to-right is direction of travel and vertical position groups
 * by concern, both of which a force-directed graph would destroy on every render.
 * On narrow viewports the SVG scrolls horizontally inside its own container, with
 * the page itself never scrolling sideways.
 *
 * KEYBOARD MODEL
 * --------------
 * The graph is a single-select listbox rather than fourteen tab stops:
 *
 *   Tab            enters the graph, landing on the selected node
 *   Arrow keys     move the selection between nodes in layout order
 *   Home / End     first and last node
 *   Enter / Space  no-op; arrow movement already selects, so there is no
 *                  hidden second step
 *   Escape         clears the selection
 *
 * That is the ARIA listbox pattern, which is what a "pick one of these" graph
 * actually is. Fourteen individually-focusable nodes would mean fourteen tab
 * stops before the detail panel, which is worse for a keyboard user than for a
 * mouse user - the opposite of the intent.
 *
 * NONINTERACTIVE FALLBACK
 * -----------------------
 * Below the graph, every node is also rendered as a plain definition list with
 * its dependencies, status and source paths. That list is always in the DOM and is
 * the complete reading of this page - the graph is an operable summary of it, not
 * the only way to the content.
 *
 * The SVG is NOT `aria-hidden`. Its decorative layers (the grid, the layer bands,
 * the edges, the drawn labels) carry `aria-hidden` individually, while the
 * listbox and its options are exposed with an accessible name per node. Hiding
 * the whole SVG would leave a keyboard-operable control that assistive technology
 * could not see.
 */
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'

import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { DefinitionList, SourceLink } from '@/components/ui/data-card'
import { CodeLabel, Heading, Text } from '@/components/ui/typography'
import {
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODES,
  LAYER_LABEL,
  downstreamOf,
  flowDistances,
  upstreamOf,
  type ArchitectureNode,
} from '@/content/architecture'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { engine, semanticModel } from '@/lib/manifest'
import { DURATION, EASE } from '@/lib/motion'
import { cx } from '@/lib/utils'
import type { StatusLevel } from '@/types/manifest'

/**
 * The drawing grid.
 *
 * 1147 rather than 1000: the first version was 1000 wide, and the two
 * presentation nodes sat at x=960 with a node width of 96, so their right-hand 56
 * units were outside the viewBox entirely - clipped, silently, because an SVG does
 * not complain about content past its own edge. They also overlapped the two
 * engine-validation nodes by 21x14 units. Both defects are now asserted against by
 * `tests/unit/architecture.test.ts`, which checks the viewBox bound, pairwise
 * overlap at the real NODE_WIDTH and NODE_HEIGHT, and band containment.
 */
const VIEW_WIDTH = 1147
const VIEW_HEIGHT = 520
const NODE_WIDTH = 96
const NODE_HEIGHT = 54

/**
 * Resolve a node's status. Nodes whose state is evidenced carry `null` in the
 * content file and are resolved from the manifest here, so the explorer cannot
 * show a stale status for the parts of the system that are still moving.
 */
function resolveStatus(node: ArchitectureNode): StatusLevel {
  if (node.status !== null) return node.status
  switch (node.id) {
    case 'semantic-model':
      return semanticModel.realEngineStatus === 'complete' ? 'complete' : 'in-progress'
    case 'desktop-validation':
      return engine('desktop').status
    case 'fabric-validation':
      return engine('fabric').status
    case 'report-pages':
      return semanticModel.dashboardPageCount > 0 ? 'in-progress' : 'blocked'
    case 'case-study':
      return 'blocked'
    default:
      return 'not-started'
  }
}

/** A per-node status label where the generic word would under-inform. */
function statusLabel(node: ArchitectureNode): string | undefined {
  switch (node.id) {
    case 'semantic-model':
      return semanticModel.realEngineStatus === 'complete'
        ? undefined
        : 'Built, real-engine validation pending'
    case 'report-pages':
      return semanticModel.dashboardPageCount === 0 ? 'Not built' : undefined
    case 'case-study':
      return 'Gated by Gate 2'
    default:
      return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * THE MOTION IN THIS DIAGRAM EXPLAINS SOMETHING, OR IT IS NOT HERE
 * ----------------------------------------------------------------
 * Before this release the only thing that moved was opacity: selecting a node
 * dimmed the unrelated ones. That is a highlight, and a highlight is a fine
 * answer to "which of these are related". It is not an answer to the question
 * the diagram is actually making a claim about, which is DIRECTION - this data
 * is generated, then persisted, then modelled, then presented, and a node's
 * upstream is not the same kind of thing as its downstream.
 *
 * So there are exactly two animations, both finite:
 *
 *   1. On arrival, and once, the built edges draw themselves left to right in
 *      band order: generate, then persist, then model, then present. It states
 *      the direction of travel one time and stops. It does not loop, it does not
 *      gate the controls - every node is selectable from the first frame - and
 *      it never runs again, including when a selection is cleared.
 *
 *   2. On selection, the edges on the selected node's path redraw as a wave.
 *      Upstream edges resolve INWARD, farthest first, so the flow arrives at the
 *      node. Downstream edges leave OUTWARD, nearest first, so the flow departs
 *      from it. Because every edge is drawn along its own direction of travel,
 *      "toward" and "away" are properties of the drawing rather than a
 *      convention a reader has to be told.
 *
 * What is deliberately absent: particles, arrows that travel continuously, any
 * loop, and any animation of all sixteen edges at once. A diagram whose parts
 * are permanently in motion is a diagram nobody reads twice.
 *
 * Planned edges never draw. They are the dashed ones, they represent work that
 * has not been done, and `pathLength` and `strokeDasharray` are the same two
 * SVG properties - so animating them would both fight the dash and imply flow
 * through a stage that does not exist.
 */

/** Seconds between one band's edges drawing and the next band's, on arrival. */
const INTRO_BAND_STEP = 0.16

/** Seconds between one hop of the selection wave and the next. */
const SELECT_HOP_STEP = 0.07

/** The order the intro sequence walks: generate, persist, model, present. */
const INTRO_BAND_ORDER: readonly NodeLayerGroup[] = [
  'generate',
  'persist',
  'model',
  'present',
]

type NodeLayerGroup = 'generate' | 'persist' | 'model' | 'present'

/** Which of the four drawn bands a node sits in. */
function bandOf(nodeId: string): NodeLayerGroup {
  const node = ARCHITECTURE_NODES.find((entry) => entry.id === nodeId)
  switch (node?.layer) {
    case 'configuration':
    case 'generation':
    case 'validation':
      return 'generate'
    case 'database':
      return 'persist'
    case 'semantic':
      return 'model'
    default:
      return 'present'
  }
}

export function ArchitectureExplorer() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listboxRef = useRef<SVGGElement | null>(null)

  /**
   * Whether the one-time arrival sequence has already played.
   *
   * A ref rather than state on purpose: nothing renders differently because of
   * it, and a state update here would re-render fourteen nodes and sixteen edges
   * to change a boolean no element reads during paint. It starts `true` under
   * reduced motion, which is what makes the sequence never run at all rather
   * than run instantly.
   */
  const introPlayed = useRef(false)
  const [introRunning, setIntroRunning] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion || introPlayed.current) return
    setIntroRunning(true)
    const total = (INTRO_BAND_ORDER.length * INTRO_BAND_STEP + DURATION.deliberate) * 1000
    const timer = setTimeout(() => {
      introPlayed.current = true
      setIntroRunning(false)
    }, total)
    return () => {
      clearTimeout(timer)
    }
  }, [prefersReducedMotion])

  const selected = useMemo(
    () => (selectedId ? ARCHITECTURE_NODES.find((n) => n.id === selectedId) : undefined),
    [selectedId]
  )

  const { upstream, downstream } = useMemo(() => {
    if (!selectedId) return { upstream: new Set<string>(), downstream: new Set<string>() }
    return { upstream: upstreamOf(selectedId), downstream: downstreamOf(selectedId) }
  }, [selectedId])

  /** Hop counts in both directions, used only to order the selection wave. */
  const distances = useMemo(
    () => (selectedId ? flowDistances(selectedId) : null),
    [selectedId]
  )

  /** The farthest upstream hop, so the wave can start at the far end. */
  const deepestUpstream = useMemo(() => {
    if (!distances) return 0
    return Math.max(0, ...[...distances.upstream.values()])
  }, [distances])

  /** How a node should be drawn given the current selection. */
  const emphasis = useCallback(
    (id: string): 'selected' | 'upstream' | 'downstream' | 'dimmed' | 'neutral' => {
      if (!selectedId) return 'neutral'
      if (id === selectedId) return 'selected'
      if (upstream.has(id)) return 'upstream'
      if (downstream.has(id)) return 'downstream'
      return 'dimmed'
    },
    [selectedId, upstream, downstream]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>) => {
      const currentIndex = selectedId
        ? ARCHITECTURE_NODES.findIndex((n) => n.id === selectedId)
        : -1

      let nextIndex: number | null = null
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = Math.min(currentIndex + 1, ARCHITECTURE_NODES.length - 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = ARCHITECTURE_NODES.length - 1
          break
        case 'Escape':
          setSelectedId(null)
          event.preventDefault()
          return
        default:
          return
      }

      event.preventDefault()
      const next = ARCHITECTURE_NODES[nextIndex]
      if (next) setSelectedId(next.id)
    },
    [selectedId]
  )

  return (
    // The id is a contract, not decoration: `scripts/capture-product-media.ts`
    // locates this explorer by it to photograph the running application for the
    // home page's product tour, and a deep link can address it. A structural
    // selector would be a guess about markup that the next layout change breaks.
    <div id="architecture-explorer" className="flex flex-col gap-6">
      {/* Toolbar: the legend and the reset. Reset is always present rather than
          appearing only when something is selected, so its position never moves. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-2xs text-ink-faint">
          <LegendItem tone="built" label="Implemented and tested" />
          <LegendItem tone="pending" label="Built, validation pending" />
          <LegendItem tone="planned" label="Not built" />
        </ul>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedId(null)}
          disabled={selectedId === null}
          iconBefore={<RotateCcw />}
        >
          Reset selection
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* The graph. Scrolls inside its own container on narrow viewports; the
            page body never scrolls sideways. */}
        <div className="xl:col-span-8">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface-sunken/60 p-4">
            {/* The SVG itself is NOT aria-hidden. An earlier revision hid it and
                put the listbox inside, which made a keyboard-operable control
                invisible to assistive technology - the roles were present and
                inert. Instead the decorative layers below carry `aria-hidden`
                individually, and the listbox is exposed with a named option per
                node. The component list further down remains the complete
                reading; this graph is the operable summary of it. */}
            <svg
              viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
              // 820px rather than 720px, raised with the viewBox so a node still
              // renders around 68 CSS pixels wide at the narrowest scroll width.
              // Below that the two-line node labels start to collide.
              className="h-auto w-full min-w-[820px]"
            >
              <defs>
                <pattern
                  id="arch-grid"
                  width="24"
                  height="24"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="1" cy="1" r="0.9" fill="var(--color-line-strong)" />
                </pattern>
                <marker
                  id="arch-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0 1 L7 4 L0 7 z" fill="context-stroke" />
                </marker>
              </defs>

              <rect
                aria-hidden="true"
                width={VIEW_WIDTH}
                height={VIEW_HEIGHT}
                fill="url(#arch-grid)"
                opacity="0.3"
              />

              {/* Layer bands. Drawn behind everything as a faint grouping cue. */}
              <g aria-hidden="true">
                {LAYER_BANDS.map((band) => (
                  <g key={band.label}>
                    <rect
                      x={band.x}
                      y={8}
                      width={band.width}
                      height={VIEW_HEIGHT - 40}
                      rx="10"
                      fill="var(--color-surface)"
                      opacity="0.35"
                    />
                    <text
                      x={band.x + band.width / 2}
                      y={VIEW_HEIGHT - 14}
                      textAnchor="middle"
                      fill="var(--color-ink-faint)"
                      className="font-mono"
                      fontSize="9"
                      letterSpacing="1"
                    >
                      {band.label}
                    </text>
                  </g>
                ))}
              </g>

              {/* Edges, behind the nodes. Decorative: the dependency lists in the
                  detail panel and in the component list carry the same information
                  as text, and describing sixteen curves would be noise. */}
              <g fill="none" aria-hidden="true">
                {ARCHITECTURE_EDGES.map((edge) => {
                  const from = ARCHITECTURE_NODES.find((n) => n.id === edge.from)
                  const to = ARCHITECTURE_NODES.find((n) => n.id === edge.to)
                  if (!from || !to) return null

                  // Highlighted when both ends are on the selected node's path.
                  const onPath =
                    selectedId !== null &&
                    (edge.from === selectedId ||
                      upstream.has(edge.from) ||
                      downstream.has(edge.from)) &&
                    (edge.to === selectedId ||
                      upstream.has(edge.to) ||
                      downstream.has(edge.to))

                  const x1 = from.x + NODE_WIDTH
                  const y1 = from.y + NODE_HEIGHT / 2
                  const x2 = to.x
                  const y2 = to.y + NODE_HEIGHT / 2
                  const mid = x1 + (x2 - x1) / 2
                  const d = `M${String(x1)} ${String(y1)} C${String(mid)} ${String(y1)} ${String(mid)} ${String(y2)} ${String(x2 - 6)} ${String(y2)}`

                  const opacity = selectedId && !onPath ? 0.22 : 0.85

                  /*
                   * A planned edge is never drawn: `pathLength` is implemented
                   * with the same two dash properties that make it dashed, so
                   * the two cannot coexist, and animating flow along a stage
                   * that has not been built would be the diagram telling a lie
                   * for the sake of a transition.
                   */
                  if (edge.kind === 'planned' || prefersReducedMotion) {
                    return (
                      <path
                        key={`${edge.from}-${edge.to}`}
                        d={d}
                        stroke={
                          onPath
                            ? 'var(--color-accent)'
                            : edge.kind === 'planned'
                              ? 'var(--color-line-strong)'
                              : 'var(--color-accent-muted)'
                        }
                        strokeWidth={onPath ? 2 : 1.3}
                        strokeDasharray={edge.kind === 'planned' ? '4 4' : undefined}
                        opacity={opacity}
                        markerEnd="url(#arch-arrow)"
                        className="transition-opacity duration-(--arpi-motion-base)"
                      />
                    )
                  }

                  /*
                   * The draw order.
                   *
                   * Upstream: an edge whose SOURCE is n hops back from the
                   * selection draws at position (deepest - n), so the outermost
                   * feeder goes first and the direct one goes last - the flow
                   * arrives.
                   *
                   * Downstream: an edge whose TARGET is n hops forward draws at
                   * position (n - 1), so the one leaving the selected node goes
                   * first - the flow departs.
                   */
                  let drawOrder: number | null = null
                  if (selectedId !== null && onPath && distances) {
                    const upFrom = distances.upstream.get(edge.from)
                    const downTo = distances.downstream.get(edge.to)
                    if (upFrom !== undefined && upFrom > 0) {
                      drawOrder = deepestUpstream - upFrom
                    } else if (downTo !== undefined && downTo > 0) {
                      drawOrder = downTo - 1
                    }
                  } else if (selectedId === null && introRunning) {
                    drawOrder = INTRO_BAND_ORDER.indexOf(bandOf(edge.from))
                  }

                  const draws = drawOrder !== null
                  const step = selectedId === null ? INTRO_BAND_STEP : SELECT_HOP_STEP

                  return (
                    <motion.path
                      /*
                       * The selection is in the key so a new selection REMOUNTS
                       * the path and replays its draw. The same idiom the hero's
                       * product panel uses: `key` is what makes a once-only
                       * animation run again on a genuinely new state, and
                       * nothing else re-triggers a `pathLength` that is already
                       * at 1.
                       */
                      key={`${edge.from}-${edge.to}-${selectedId ?? 'none'}`}
                      // The reduced-motion stylesheet forces any element
                      // carrying this attribute to its completed dash state, so
                      // a preference change mid-animation cannot strand a
                      // half-drawn edge.
                      data-arpi-draw=""
                      d={d}
                      stroke={
                        onPath ? 'var(--color-accent)' : 'var(--color-accent-muted)'
                      }
                      strokeWidth={onPath ? 2 : 1.3}
                      markerEnd="url(#arch-arrow)"
                      initial={draws ? { pathLength: 0, opacity: 0 } : false}
                      animate={{ pathLength: 1, opacity }}
                      transition={{
                        pathLength: {
                          duration: draws ? DURATION.deliberate : 0,
                          delay: draws ? (drawOrder ?? 0) * step : 0,
                          ease: EASE.out,
                        },
                        opacity: {
                          duration: DURATION.base,
                          delay: draws ? (drawOrder ?? 0) * step : 0,
                          ease: EASE.standard,
                        },
                      }}
                    />
                  )
                })}
              </g>

              {/* Nodes. One listbox, roving selection. */}
              <g
                ref={listboxRef}
                role="listbox"
                aria-label="Architecture components"
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              >
                {ARCHITECTURE_NODES.map((node) => {
                  const state = emphasis(node.id)
                  const status = resolveStatus(node)
                  const isPlanned = status === 'blocked' || status === 'not-started'
                  const isPending =
                    status === 'pending-external' || status === 'in-progress'

                  return (
                    <motion.g
                      key={node.id}
                      role="option"
                      // The option's name must be the component, not the two
                      // truncated words drawn inside the box. Without this a
                      // screen-reader user arrowing the graph hears "semantic
                      // model" as "semantic, model" - or nothing at all.
                      aria-label={`${node.label}. ${LAYER_LABEL[node.layer]} layer. ${
                        statusLabel(node) ?? resolveStatus(node)
                      }.`}
                      aria-selected={node.id === selectedId}
                      onClick={() =>
                        setSelectedId(node.id === selectedId ? null : node.id)
                      }
                      className="cursor-pointer"
                      /*
                       * The selected node grows by four percent. Small enough
                       * that it reads as emphasis rather than as a popped
                       * element, and it is the one thing that separates "this is
                       * the node you chose" from "this node is also on the
                       * path", which stroke colour alone was carrying.
                       *
                       * `transformBox: fill-box` makes `transformOrigin: center`
                       * mean the centre of this group's own bounding box. Its
                       * absence is why an earlier attempt scaled every node
                       * about the SVG's top-left corner and moved them across
                       * the diagram.
                       */
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                      animate={{
                        opacity: state === 'dimmed' ? 0.3 : 1,
                        scale: state === 'selected' && !prefersReducedMotion ? 1.04 : 1,
                      }}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { duration: DURATION.base, ease: EASE.standard }
                      }
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx="8"
                        fill={
                          state === 'selected'
                            ? 'var(--color-accent-wash)'
                            : isPlanned
                              ? 'var(--color-surface-sunken)'
                              : 'var(--color-surface-raised)'
                        }
                        stroke={
                          state === 'selected'
                            ? 'var(--color-accent)'
                            : state === 'upstream' || state === 'downstream'
                              ? 'var(--color-accent-muted)'
                              : isPlanned
                                ? 'var(--color-line-strong)'
                                : isPending
                                  ? 'var(--color-model)'
                                  : 'var(--color-line-strong)'
                        }
                        strokeWidth={state === 'selected' ? 2 : 1.3}
                        strokeDasharray={isPlanned || isPending ? '4 3' : undefined}
                      />

                      {/* The status pip. Shape differs per state as well as
                          colour: filled square for built, hollow for pending,
                          absent for not built. */}
                      {!isPlanned ? (
                        <rect
                          x={node.x + 8}
                          y={node.y + 8}
                          width="6"
                          height="6"
                          rx="1.5"
                          fill={isPending ? 'none' : 'var(--color-verified)'}
                          stroke={isPending ? 'var(--color-pending)' : 'none'}
                          strokeWidth="1.4"
                        />
                      ) : null}

                      {node.shortLabel.map((line, index) => (
                        <text
                          aria-hidden="true"
                          key={line}
                          x={node.x + NODE_WIDTH / 2}
                          y={
                            node.y +
                            NODE_HEIGHT / 2 +
                            (node.shortLabel.length === 1 ? 4 : index === 0 ? -3 : 11)
                          }
                          textAnchor="middle"
                          fill={
                            state === 'selected'
                              ? 'var(--color-accent)'
                              : isPlanned
                                ? 'var(--color-ink-faint)'
                                : 'var(--color-ink-secondary)'
                          }
                          className="font-mono"
                          fontSize="10"
                          letterSpacing="0.3"
                        >
                          {line}
                        </text>
                      ))}
                    </motion.g>
                  )
                })}
              </g>
            </svg>
          </div>

          <p className="mt-3 font-mono text-2xs text-ink-faint">
            Select a component to highlight its dependencies. Tab into the diagram and use
            the arrow keys, or read the full component list below.
          </p>
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-4">
          <div className="xl:sticky xl:top-[calc(var(--arpi-size-header)+2rem)]">
            {selected ? (
              /*
               * Keyed by node, so the panel replays its arrival on every new
               * selection rather than reconciling silently into different text.
               * The `wake` animation is CSS and the site-wide reduced-motion
               * rule collapses it to 1ms, so a reader who asked for no animation
               * gets the same panel instantly. It is also what makes assistive
               * technology treat this as a new panel: the `aria-live` region
               * inside it announces a replacement rather than an edit.
               */
              <div key={selected.id} className="animate-wake">
                <NodeDetail node={selected} upstream={upstream} downstream={downstream} />
              </div>
            ) : (
              <Card tone="sunken" className="flex flex-col gap-3">
                {/* Level 2, not 3. This panel is the first heading after the page
                    title, so a level-3 heading here would skip a level. The
                    visual size is set separately. */}
                <Heading level={2} size="h5">
                  No component selected
                </Heading>
                <Text size="sm" tone="muted">
                  Choose a component in the diagram, or from the list below, to see what
                  owns it, what state it is in, which files implement it, and which
                  database role can reach it.
                </Text>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* The noninteractive fallback. Always present, and the authoritative
          reading of this page for assistive technology. */}
      <section aria-labelledby="architecture-components-heading" className="mt-6">
        <Heading
          level={2}
          size="h3"
          id="architecture-components-heading"
          className="mb-6"
        >
          Every component, in order
        </Heading>
        <ol className="flex flex-col gap-4">
          {ARCHITECTURE_NODES.map((node) => {
            const status = resolveStatus(node)
            const label = statusLabel(node)
            const ups = [...upstreamOf(node.id)]
            const downs = [...downstreamOf(node.id)]
            return (
              <li key={node.id}>
                <Card as="article" className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-mono text-2xs tracking-wide text-accent">
                        {LAYER_LABEL[node.layer].toUpperCase()}
                      </span>
                      <h3 className="text-lg font-semibold text-ink">{node.label}</h3>
                    </div>
                    <StatusBadge status={status} label={label} size="sm" />
                  </div>

                  <Text size="sm" tone="secondary" className="max-w-prose">
                    {node.summary}
                  </Text>
                  <Text size="sm" tone="muted" className="max-w-prose">
                    {node.detail}
                  </Text>

                  <DefinitionList
                    layout="columns"
                    rows={[
                      { term: 'Ownership', value: node.ownership },
                      { term: 'Privacy boundary', value: node.privacyBoundary },
                      { term: 'Role access', value: node.roleAccess },
                      {
                        term: 'Depends on',
                        value:
                          ups.length > 0
                            ? ups.map((id) => nodeLabel(id)).join(', ')
                            : 'Nothing - this is an entry point.',
                      },
                      {
                        term: 'Feeds',
                        value:
                          downs.length > 0
                            ? downs.map((id) => nodeLabel(id)).join(', ')
                            : 'Nothing - this is a terminal node.',
                      },
                    ]}
                  />

                  <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
                    <span className="eyebrow text-2xs">Source and documentation</span>
                    <ul className="flex flex-col gap-1">
                      {[...node.sourcePaths, ...node.docPaths].map((path) => (
                        <li key={path}>
                          <SourceLink path={path} variant="block" />
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The four layer bands behind the graph.
 *
 * Each band's x range must contain every node assigned to it, at the real
 * NODE_WIDTH. The first version's ranges predated the node coordinates and
 * contained roughly half of them, so the bands grouped nothing:
 * `tests/unit/architecture.test.ts` now asserts containment.
 */
const LAYER_BANDS = [
  { label: 'GENERATE', x: 16, width: 390 },
  { label: 'PERSIST', x: 422, width: 449 },
  { label: 'MODEL', x: 879, width: 110 },
  { label: 'PRESENT', x: 1005, width: 126 },
] as const

function nodeLabel(id: string): string {
  return ARCHITECTURE_NODES.find((n) => n.id === id)?.label ?? id
}

function LegendItem({
  tone,
  label,
}: {
  tone: 'built' | 'pending' | 'planned'
  label: string
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cx(
          'inline-block size-2.5 rounded-sm',
          tone === 'built' && 'bg-verified',
          tone === 'pending' && 'border-2 border-pending',
          tone === 'planned' && 'border border-dashed border-line-strong'
        )}
      />
      {label}
    </li>
  )
}

function NodeDetail({
  node,
  upstream,
  downstream,
}: {
  node: ArchitectureNode
  upstream: Set<string>
  downstream: Set<string>
}) {
  const status = resolveStatus(node)
  return (
    <Card
      tone="accent"
      className="flex flex-col gap-4"
      // Announced when the selection changes, so a keyboard user arrowing
      // through the graph hears the detail rather than only seeing it.
      as="aside"
    >
      <div aria-live="polite" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-2xs tracking-wide text-accent">
            {LAYER_LABEL[node.layer].toUpperCase()}
          </span>
          <Heading level={2} size="h4">
            {node.label}
          </Heading>
        </div>

        <StatusBadge status={status} label={statusLabel(node)} className="self-start" />

        <Text size="sm" tone="secondary">
          {node.summary}
        </Text>
        <Text size="sm" tone="muted">
          {node.detail}
        </Text>
      </div>

      <DefinitionList
        rows={[
          { term: 'Ownership', value: node.ownership },
          { term: 'Privacy boundary', value: node.privacyBoundary },
          { term: 'Role access', value: node.roleAccess },
        ]}
      />

      <div className="flex flex-col gap-3 border-t border-accent-muted/30 pt-3">
        <DependencyList
          icon="up"
          title="Upstream dependencies"
          ids={[...upstream]}
          empty="None. This is an entry point."
        />
        <DependencyList
          icon="down"
          title="Downstream consumers"
          ids={[...downstream]}
          empty="None. This is a terminal node."
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-accent-muted/30 pt-3">
        <span className="eyebrow text-2xs">Source</span>
        <ul className="flex flex-col gap-1">
          {node.sourcePaths.map((path) => (
            <li key={path}>
              <SourceLink path={path} variant="block" />
            </li>
          ))}
        </ul>
        <span className="eyebrow mt-2 text-2xs">Documentation</span>
        <ul className="flex flex-col gap-1">
          {node.docPaths.map((path) => (
            <li key={path}>
              <SourceLink path={path} variant="block" />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function DependencyList({
  icon,
  title,
  ids,
  empty,
}: {
  icon: 'up' | 'down'
  title: string
  ids: readonly string[]
  empty: string
}) {
  const Icon = icon === 'up' ? ArrowUp : ArrowDown
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow flex items-center gap-1.5 text-2xs">
        <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
        {title}
      </span>
      {ids.length === 0 ? (
        <span className="text-xs text-ink-faint">{empty}</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <li key={id}>
              <CodeLabel tone="bare" className="text-2xs">
                {nodeLabel(id)}
              </CodeLabel>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
