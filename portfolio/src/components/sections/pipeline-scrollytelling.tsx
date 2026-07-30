'use client'

/**
 * Architecture scrollytelling: eight stages, a sticky diagram, and a scroll
 * progress rail.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not scroll hijacking. The page scrolls at exactly its native rate; nothing
 * intercepts the wheel, nothing snaps, nothing animates the scroll position, and
 * a reader can flick past the whole section in one gesture. The only thing tied
 * to scroll position is *which stage is highlighted*, which is a reading aid.
 *
 * WHY STICKY HELPS HERE
 * ---------------------
 * The eight stages are steps through one artefact. Holding the diagram still
 * while the descriptions advance lets a reader see where the current step sits in
 * the whole, which is the entire reason to read them in order. That is the
 * material comprehension gain the brief asks for; a sticky panel that merely
 * looked impressive would not earn it.
 *
 * HOW THE ACTIVE STAGE IS TRACKED
 * -------------------------------
 * One IntersectionObserver across the eight step elements, no scroll listener,
 * no polling. `rootMargin` centres the trigger band on the viewport so the
 * highlighted stage is the one a reader is actually looking at.
 *
 * REDUCED MOTION
 * --------------
 * The sticky panel and the highlight both remain - neither is motion, both are
 * layout and state. What goes is the transition between highlighted stages and
 * the diagram's crossfade: the new stage appears immediately. The section is
 * fully usable, and arguably clearer.
 *
 * BELOW `lg`
 * ----------
 * The sticky panel is not rendered at all. Each step carries its own inline
 * diagram instead, which is a better small-screen reading than a 40vh sticky
 * panel squeezing the text into a letterbox.
 */
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { manifest } from '@/lib/manifest'
import { DURATION, EASE } from '@/lib/motion'
import { cx } from '@/lib/utils'
import type { StatusLevel } from '@/types/manifest'

interface Stage {
  readonly id: string
  readonly ordinal: string
  readonly title: string
  readonly body: string
  readonly detail: string
  readonly status: StatusLevel
  /** Override the status badge's wording where a specific phrase is clearer. */
  readonly statusLabel?: string
  readonly source: { readonly path: string; readonly field: string }
}

/**
 * The eight stages. Statuses for the last three come from the manifest rather
 * than being written here, so they cannot drift from the evidence.
 */
function useStages(): readonly Stage[] {
  const model = manifest.semanticModel
  const gate2 = manifest.gates.find((g) => g.id === 'gate-2')

  return useMemo(
    () => [
      {
        id: 'generation',
        ordinal: '01',
        title: 'Seeded synthetic generation',
        body: 'Fourteen Python generators produce the source data from a typed configuration profile and one fixed random seed.',
        detail:
          'The same profile and seed reproduce byte-identical CSV. Each entity carries a SHA-256 digest of its own bytes in the generation manifest, so a reviewer can prove the data they have is the data the tests ran against.',
        status: 'complete',
        source: { path: 'src/arpi/generation/', field: 'generators' },
      },
      {
        id: 'validation',
        ordinal: '02',
        title: 'In-memory validation',
        body: 'Every generated dataset passes a validation framework before a single row is offered to the database.',
        detail: `${String(manifest.counts.dataQualityChecks.value)} checks across fourteen DQ families on a development run, each with a declared severity. A critical failure exits non-zero, so the pipeline composes in a script and in CI.`,
        status: 'complete',
        source: {
          path: 'src/arpi/validation/checks.py',
          field: 'check registry',
        },
      },
      {
        id: 'raw',
        ordinal: '03',
        title: 'Raw layer',
        body: 'Source records land unmodified, every column as text, with load lineage attached.',
        detail:
          'Nothing is cast, cleaned or rejected here. Keeping the raw layer literal is what makes a later disagreement about a value answerable rather than arguable.',
        status: 'complete',
        source: { path: 'sql/01_raw/', field: 'raw load scripts' },
      },
      {
        id: 'staging',
        ordinal: '04',
        title: 'Staging layer',
        body: 'Typed, deduplicated views over raw that expose only the most recent load batch.',
        detail:
          'A reconciliation proves the arithmetic: raw rows equal accepted plus rejected plus deduplicated, stated as an addition so that a lost row and an extra duplicate cannot cancel each other out.',
        status: 'complete',
        source: { path: 'sql/02_staging/', field: 'staging views' },
      },
      {
        id: 'warehouse',
        ordinal: '05',
        title: 'Warehouse dimensions and facts',
        body: `${String(manifest.counts.dimensions.value)} conformed dimensions and ${String(manifest.counts.facts.value)} facts, each fact at one explicitly declared grain.`,
        detail:
          'The grain is enforced by a UNIQUE constraint in DDL and asserted by the integration suite, so it is a property of the database rather than a promise in a document.',
        status: 'complete',
        source: { path: 'sql/04_facts/', field: 'grain constraints' },
      },
      {
        id: 'reporting',
        ordinal: '06',
        title: 'Reporting views',
        body: `${String(manifest.counts.reportingViews.value)} documented views - the only surface a semantic model or a workbook is permitted to read.`,
        detail: `${String(manifest.counts.governedKpis.value)} governed KPIs are computable from this layer, and each is tested against an independent derivation from the warehouse. A read-only role reaches this schema and provably nothing else.`,
        status: 'complete',
        source: { path: 'sql/05_reporting/', field: 'reporting views' },
      },
      {
        id: 'semantic-model',
        ordinal: '07',
        title: 'Semantic model',
        body: `A Power BI Project stored as TMDL: ${String(manifest.counts.importedTables.value)} imported tables, ${String(manifest.counts.measureTables.value)} measure tables, ${String(manifest.counts.semanticRelationships.value)} single-direction relationships and ${String(manifest.counts.daxMeasures.value)} measures.`,
        detail:
          'Text, diffable, reviewable without a Power BI licence, and validated statically on every push. It has never been loaded by a Microsoft semantic-model engine, so every measure in it is DAX that has never returned a value.',
        status: model.realEngineStatus,
        statusLabel: 'Built, real-engine validation pending',
        source: {
          path: 'powerbi/validation/fabric_validation_results.json',
          field: 'overall_result',
        },
      },
      {
        id: 'reports',
        ordinal: '08',
        title: 'Report pages and case study',
        body:
          model.dashboardPageCount === 0
            ? 'No report page, visual or bookmark exists, and no analytical finding has been drawn.'
            : `${String(model.dashboardPageCount)} report page definitions exist.`,
        detail: `Authoring pages over a model no engine has loaded would merge page defects and model defects into one change, so this is sequenced behind the validation above. The public case study is separately held by Gate 2, whose verdict is ${gate2?.verdict ?? 'CLOSED'}.`,
        status: 'blocked',
        statusLabel: model.dashboardPageCount === 0 ? 'Not built' : 'In progress',
        source: {
          path: 'docs/requirements/PHASE_2_BACKLOG.md',
          field: 'Gate 2 status',
        },
      },
    ],
    [model.realEngineStatus, model.dashboardPageCount, gate2?.verdict]
  )
}

export function PipelineScrollytelling() {
  const stages = useStages()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const elements = stepRefs.current.filter((el): el is HTMLLIElement => el !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Take the entry closest to the centre band rather than the first
        // intersecting one, so a tall step does not hold the highlight after the
        // reader has moved past it.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        const top = visible[0]
        if (!top) return
        const index = elements.indexOf(top.target as HTMLLIElement)
        if (index >= 0) setActiveIndex(index)
      },
      // A band across the vertical middle of the viewport.
      { rootMargin: '-42% 0px -42% 0px', threshold: [0, 0.5, 1] }
    )

    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [stages.length])

  const active = stages[activeIndex] ?? stages[0]!

  return (
    <Section id="architecture-walkthrough" bordered>
      <Container width="wide">
        <Reveal className="mb-12 flex max-w-prose flex-col gap-5">
          <Eyebrow>How it fits together</Eyebrow>
          <Heading level={2}>
            Eight stages, and the last two are honest about not existing.
          </Heading>
          <Text size="body">
            A value in this project can be traced from the generator that produced it to
            the measure that would report it. Each stage below names what it does, what
            proves it, and what state it is actually in.
          </Text>
        </Reveal>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          {/* The sticky panel. Rendered only at `lg` and above. */}
          <div className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-[calc(var(--arpi-size-header)+2.5rem)] flex flex-col gap-6">
              <StageDiagram
                activeIndex={activeIndex}
                total={stages.length}
                prefersReducedMotion={prefersReducedMotion}
              />

              <div
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface/80 p-5"
                // The panel mirrors the active step, which is already fully
                // present in the list beside it. Announcing it again would make a
                // screen reader read every step twice as the page scrolls.
                aria-hidden="true"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xs text-accent">{active.ordinal}</span>
                  <h3 className="text-base font-semibold text-ink">{active.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-ink-muted">{active.detail}</p>
                <StatusBadge
                  status={active.status}
                  label={active.statusLabel}
                  size="sm"
                  className="self-start"
                />
              </div>

              {/* Scroll progress. Discrete rather than continuous: the reader is
                  on step N of eight, which is more useful than a percentage. */}
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xs text-ink-faint">
                  {active.ordinal} / {String(stages.length).padStart(2, '0')}
                </span>
                <div
                  className="flex h-1 flex-1 gap-1 overflow-hidden rounded-pill"
                  role="presentation"
                >
                  {stages.map((stage, index) => (
                    <span
                      key={stage.id}
                      className={cx(
                        'h-full flex-1 rounded-pill transition-colors duration-(--arpi-motion-base)',
                        index <= activeIndex ? 'bg-accent' : 'bg-line'
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* The steps. A real ordered list, so the sequence is in the markup. */}
          <ol className="flex flex-col lg:col-span-7">
            {stages.map((stage, index) => (
              <li
                key={stage.id}
                ref={(element) => {
                  stepRefs.current[index] = element
                }}
                className={cx(
                  'relative border-l border-line-subtle py-8 pl-8 first:pt-0 last:pb-0 sm:pl-10',
                  'transition-colors duration-(--arpi-motion-slow)',
                  index === activeIndex && 'border-l-accent-muted'
                )}
              >
                {/* The step marker. Filled when reached, hollow when not, so the
                    rail is legible without colour. */}
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute top-8 left-0 size-[13px] -translate-x-1/2 rounded-full border-2 first:top-0',
                    'transition-colors duration-(--arpi-motion-slow)',
                    index === 0 && 'top-0',
                    index <= activeIndex
                      ? 'border-accent bg-accent/30'
                      : 'border-line-strong bg-canvas'
                  )}
                />

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-mono text-2xs tracking-wide text-accent">
                      {stage.ordinal}
                    </span>
                    <h3 className="text-xl font-semibold tracking-tight text-ink">
                      {stage.title}
                    </h3>
                    <StatusBadge
                      status={stage.status}
                      label={stage.statusLabel}
                      size="sm"
                    />
                  </div>

                  <Text size="body" className="max-w-prose">
                    {stage.body}
                  </Text>

                  {/* The detail is in the list too, not only in the sticky panel.
                      Nothing on this site is available only in a position that
                      depends on viewport width. */}
                  <Text size="sm" tone="muted" className="max-w-prose lg:hidden">
                    {stage.detail}
                  </Text>

                  <SourceLink path={stage.source.path} field={stage.source.field} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  )
}

/**
 * The sticky diagram: eight layers as a vertical stack, with the active one
 * lit.
 *
 * A vertical stack rather than a horizontal flow, because the panel is tall and
 * narrow and because the eight stages genuinely are a stack of layers. The last
 * two are drawn dashed regardless of which is active, so their state is legible
 * even when they are not the one being read.
 */
function StageDiagram({
  activeIndex,
  total,
  prefersReducedMotion,
}: {
  activeIndex: number
  total: number
  prefersReducedMotion: boolean
}) {
  const rowHeight = 30
  const height = total * rowHeight + 24

  return (
    <svg
      viewBox={`0 0 300 ${String(height)}`}
      // Decorative: it duplicates the step list beside it, which is the
      // authoritative reading.
      aria-hidden="true"
      className="w-full"
    >
      <defs>
        <pattern id="stage-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="var(--color-line-strong)" />
        </pattern>
      </defs>
      <rect width="300" height={height} fill="url(#stage-grid)" opacity="0.25" />

      {Array.from({ length: total }, (_, index) => {
        const y = 12 + index * rowHeight
        const isActive = index === activeIndex
        const isReached = index <= activeIndex
        // The last two stages are not built. Dashed, always.
        const isUnbuilt = index >= total - 1
        const isPending = index === total - 2

        return (
          <g key={index}>
            {/* The connector into this layer. */}
            {index > 0 ? (
              <path
                d={`M40 ${String(y - rowHeight + 22)} V${String(y)}`}
                stroke={isReached ? 'var(--color-accent-muted)' : 'var(--color-line)'}
                strokeWidth="1.2"
                strokeDasharray={isUnbuilt || isPending ? '3 3' : undefined}
              />
            ) : null}

            <motion.rect
              x="28"
              y={y}
              width={isActive ? 244 : 210}
              height="22"
              rx="5"
              fill={
                isActive
                  ? 'var(--color-accent-wash)'
                  : isReached
                    ? 'var(--color-surface-raised)'
                    : 'var(--color-surface-sunken)'
              }
              stroke={
                isUnbuilt
                  ? 'var(--color-line-strong)'
                  : isPending
                    ? 'var(--color-model)'
                    : isActive
                      ? 'var(--color-accent)'
                      : isReached
                        ? 'var(--color-accent-muted)'
                        : 'var(--color-line)'
              }
              strokeWidth={isActive ? 1.6 : 1.2}
              strokeDasharray={isUnbuilt || isPending ? '4 3' : undefined}
              animate={{ width: isActive ? 244 : 210 }}
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: DURATION.base, ease: EASE.standard }
              }
            />

            {/* The active marker: a filled square at the layer's left edge. */}
            {isActive ? (
              <rect
                x="20"
                y={y + 7}
                width="8"
                height="8"
                rx="2"
                fill="var(--color-accent)"
              />
            ) : null}

            <text
              x="40"
              y={y + 15}
              fill={
                isUnbuilt
                  ? 'var(--color-ink-faint)'
                  : isActive
                    ? 'var(--color-accent)'
                    : 'var(--color-ink-muted)'
              }
              className="font-mono"
              fontSize="9"
              letterSpacing="0.5"
            >
              {STAGE_DIAGRAM_LABELS[index]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Short labels for the sticky diagram. The full titles are in the step list. */
const STAGE_DIAGRAM_LABELS = [
  'generators + seed',
  'validation',
  'raw',
  'staging',
  'warehouse',
  'reporting',
  'semantic model  (pending)',
  'report pages  (not built)',
] as const
