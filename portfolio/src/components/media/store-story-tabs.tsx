'use client'

/**
 * The three rooftops, as one stateful chapter.
 *
 * WHAT THIS REPLACED
 * ------------------
 * Six consecutive home-page sections, all about the same three stores:
 * an introduction, a three-card row of operating models, a derived snapshot, a
 * three-card row of stores, a two-card essay on allocation versus acquisition,
 * and a comparison table. A visitor scrolled roughly four thousand pixels
 * meeting Granite Chevrolet five separate times before reaching anything they
 * could touch.
 *
 * The material was good and almost none of it is gone. It is now one tab set:
 * choosing a store shows that store's identity, its operating model, its
 * strategy, the figures its own workbook supports, a drawn composition of the
 * lot, and two ways deeper. The comparison table survives underneath, because
 * comparison is the one job a table does better than a tab set.
 *
 * WHY A TAB SET RATHER THAN THREE CARDS
 * -------------------------------------
 * Three cards ask a reader to compare three things they have not been told how
 * to compare. A tab set asks them to choose one and read it properly, which is
 * the actual argument this chapter is making: these are three different
 * businesses, and reading them as three instances of one business is the mistake
 * the governed model exists to prevent.
 *
 * ACCESSIBILITY
 * -------------
 * Real tab semantics through `<SegmentedTabs>`: roving tabindex, arrow keys,
 * Home and End, `aria-selected`, `aria-controls`, and a labelled panel. The
 * selected state is carried by a filled surface, a rule and `aria-selected`,
 * never by colour alone. `key` on the panel remounts it, so a screen reader
 * announces the store the reader just chose.
 *
 * EVERY FIGURE IS DERIVED
 * -----------------------
 * The panels arrive as props from `lib/product-preview`, which reads the
 * generated artefacts. Nothing here authors a number, and the observation line
 * describes the shape of a listing snapshot rather than how a store performs.
 */
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'

import { RooftopVisual } from '@/components/media/rooftop-visual'
import { SegmentedTabs } from '@/components/media/segmented-tabs'
import { STORE_TYPE_ICON } from '@/components/ui/domain-icon'
import { Badge } from '@/components/ui/badge'
import { Heading, Text } from '@/components/ui/typography'
import type { StoreStoryPanel } from '@/lib/product-preview'
import { cx } from '@/lib/utils'

/** The caption every fictional composition on this site carries. */
const FICTION_CAPTION =
  'Fictional rooftop visualisation created for the ARPI portfolio case study. Granite Auto Group does not exist and no photograph of any dealership appears on this site.'

export interface StoreStoryTabsProps {
  panels: readonly StoreStoryPanel[]
  className?: string
}

export function StoreStoryTabs({ panels, className }: StoreStoryTabsProps) {
  const baseId = useId()
  const [selected, setSelected] = useState(panels[0]?.dealershipId ?? '')
  const panel = panels.find((entry) => entry.dealershipId === selected) ?? panels[0]

  if (!panel) return null

  const StoreTypeIcon = panel.isFranchise
    ? STORE_TYPE_ICON.franchise
    : STORE_TYPE_ICON.independent

  return (
    <div className={cx('flex flex-col gap-6', className)}>
      <SegmentedTabs
        items={panels.map((entry) => ({
          id: entry.dealershipId,
          label: entry.shortName,
        }))}
        selected={panel.dealershipId}
        onSelect={setSelected}
        label="Granite Auto Group store"
        baseId={baseId}
        className="self-start"
      />

      <div
        key={panel.dealershipId}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${panel.dealershipId}`}
        tabIndex={-1}
        className="animate-wake grid grid-cols-1 gap-8 focus:outline-none lg:grid-cols-12 lg:gap-12"
      >
        <div className="flex flex-col gap-5 lg:col-span-7">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* The store type carries a mark as well as a word. Franchise
                  versus independent is the distinction this whole chapter is
                  about, and it is the one a reader switching tabs is trying to
                  hold in their head. The icon is decorative - the label is
                  inside the same badge - so it is hidden from assistive
                  technology rather than announced before the word it repeats. */}
              <Badge tone="neutral">
                <StoreTypeIcon
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mr-1.5 inline size-3.5 align-[-0.15em] text-ink-faint"
                />
                {panel.storeTypeLabel}
              </Badge>
              <Badge tone="neutral" mono>
                {panel.location}
              </Badge>
            </div>
            <Heading level={3} size="h3">
              {panel.name}
            </Heading>
            <p className="text-base font-medium text-ink-secondary">{panel.tagline}</p>
          </div>

          <Text size="body" tone="muted" className="max-w-prose">
            {panel.positioning}
          </Text>

          {/* THE INVENTORY-STRATEGY PARAGRAPH IS NOT HERE ANY MORE.
              It was a disclosure under this paragraph, and it was the same
              argument three times: a reader switching tabs to compare figures
              read how allocation works, then how a narrow new line works, then
              how acquisition works. Each store's page carries its own strategy
              in full, linked from this panel, so the tab keeps the positioning
              and the figures and sends the reader to the page whose subject the
              rest is. */}

          {/* The figures this store's own workbook supports, and the sentence
              they add up to. Both derived. */}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-5 sm:grid-cols-5">
            {panel.figures.map((figure) => (
              <div key={figure.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="truncate font-mono text-2xs tracking-wide text-ink-faint uppercase">
                  {figure.label}
                </dt>
                <dd className="numeric text-lg leading-none font-semibold tracking-tight text-ink">
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>

          <Text size="sm" tone="muted" className="max-w-prose">
            {panel.observation}
          </Text>

          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={panel.storeHref}
              className="inline-flex min-h-touch items-center gap-1.5 text-sm font-medium text-accent transition-colors duration-(--arpi-motion-fast) hover:text-accent-strong"
            >
              {`The full ${panel.shortName} profile`}
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Link>
            <Link
              href={panel.href}
              className="inline-flex min-h-touch items-center gap-1.5 text-sm font-medium text-ink-secondary underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
            >
              {`Filter the explorer to ${panel.shortName}`}
            </Link>
          </div>
        </div>

        {/* The drawn composition. Captioned as fiction at the point of use, every
            time, rather than once at the top of the section where a reader
            arriving by anchor link would never see it. */}
        <figure className="m-0 flex flex-col gap-3 lg:col-span-5">
          <div className="overflow-hidden rounded-xl border border-line bg-canvas p-4 sm:p-5">
            <RooftopVisual accent={panel.accent} />
          </div>
          <figcaption className="text-xs leading-normal text-ink-faint">
            {FICTION_CAPTION}
          </figcaption>
        </figure>
      </div>
    </div>
  )
}
