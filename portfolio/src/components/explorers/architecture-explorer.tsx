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
import { useCallback, useMemo, useRef, useState } from 'react'
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

export function ArchitectureExplorer() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listboxRef = useRef<SVGGElement | null>(null)

  const selected = useMemo(
    () => (selectedId ? ARCHITECTURE_NODES.find((n) => n.id === selectedId) : undefined),
    [selectedId]
  )

  const { upstream, downstream } = useMemo(() => {
    if (!selectedId) return { upstream: new Set<string>(), downstream: new Set<string>() }
    return { upstream: upstreamOf(selectedId), downstream: downstreamOf(selectedId) }
  }, [selectedId])

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
    <div className="flex flex-col gap-6">
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

                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={`M${String(x1)} ${String(y1)} C${String(mid)} ${String(y1)} ${String(mid)} ${String(y2)} ${String(x2 - 6)} ${String(y2)}`}
                      stroke={
                        onPath
                          ? 'var(--color-accent)'
                          : edge.kind === 'planned'
                            ? 'var(--color-line-strong)'
                            : 'var(--color-accent-muted)'
                      }
                      strokeWidth={onPath ? 2 : 1.3}
                      strokeDasharray={edge.kind === 'planned' ? '4 4' : undefined}
                      opacity={selectedId && !onPath ? 0.22 : 0.85}
                      markerEnd="url(#arch-arrow)"
                      className="transition-opacity duration-(--arpi-motion-base)"
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
                      animate={{ opacity: state === 'dimmed' ? 0.3 : 1 }}
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
              <NodeDetail node={selected} upstream={upstream} downstream={downstream} />
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
