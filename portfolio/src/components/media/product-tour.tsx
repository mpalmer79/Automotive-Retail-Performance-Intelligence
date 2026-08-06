'use client'

/**
 * The product tour: four working experiences, shown rather than linked.
 *
 * WHY THIS SECTION EXISTS
 * -----------------------
 * The four strongest artefacts on this site are the inventory explorer, the
 * architecture explorer, the data model explorer and the KPI catalogue. Before
 * this release the home page mentioned all four and showed none of them. A
 * reviewer with sixty seconds saw thirteen chapters of prose about software they
 * had to take on trust.
 *
 * Each step shows what the route actually looks like, says in one paragraph what
 * it is for, states one technical decision a reader could not guess from a
 * screenshot, and offers exactly one way in.
 *
 * THE IMAGES ARE CAPTURES, NOT MOCKUPS
 * ------------------------------------
 * Every frame is a straight screenshot of the named route, taken from a
 * production build by `scripts/capture-product-media.ts` and committed. Nothing
 * is composed, retouched or annotated, and no interface element in any of them
 * was drawn for the tour. A mocked-up dashboard would be indistinguishable to a
 * reader from a real one, which is the exact confusion this project exists to
 * argue against, so the rule is absolute: if it is in a frame, it is on the
 * route, and the route is one click away.
 *
 * ONE VISIBLE FRAME AT A TIME
 * ---------------------------
 * Only the selected step's image is in the DOM. Four 60 kB captures stacked
 * vertically would be the heaviest thing on the page and three of them would
 * never be looked at. Each is `loading="lazy"` with intrinsic dimensions, so the
 * box is reserved before the bytes arrive and the swap causes no layout shift.
 *
 * ACCESSIBILITY
 * -------------
 * Real tab semantics through `<SegmentedTabs>`: roving tabindex, arrow keys,
 * Home and End, `aria-selected`, `aria-controls`, a labelled panel. Every
 * capture has an alt description of what is on screen rather than the words
 * "screenshot of". Provenance is a word, never a colour.
 */
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'

import {
  ApplicationFrame,
  ApplicationImage,
  type FrameProvenance,
} from '@/components/media/application-frame'
import { SegmentedTabs } from '@/components/media/segmented-tabs'
import { LinkButton } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Heading, Text } from '@/components/ui/typography'
import { cx } from '@/lib/utils'

/** One step of the tour. Plain data, so the section can build it on the server. */
export interface TourStep {
  readonly id: string
  /** The control's label. Short enough for a segmented control at 375px. */
  readonly tab: string
  /** The step's heading. */
  readonly title: string
  /** The route the step is about. */
  readonly href: string
  /** The chrome label on the frame. */
  readonly surface: string
  readonly provenance: FrameProvenance
  /** The clause qualifying the provenance, in the chrome. */
  readonly provenanceNote: string
  /** One paragraph on what the route is for. */
  readonly summary: string
  /** One decision a reader could not infer from the picture. */
  readonly insight: string
  /**
   * The summary the insight sits behind. Names the specific decision, not its
   * category: four steps labelled "The decision behind it" are four labels a
   * reader cannot choose between.
   */
  readonly insightLabel: string
  readonly cta: string
  readonly image: {
    readonly src: string
    readonly alt: string
    readonly width: number
    readonly height: number
  }
}

export interface ProductTourProps {
  steps: readonly TourStep[]
  className?: string
}

export function ProductTour({ steps, className }: ProductTourProps) {
  const baseId = useId()
  const [selected, setSelected] = useState(steps[0]?.id ?? '')
  const step = steps.find((entry) => entry.id === selected) ?? steps[0]

  if (!step) return null

  return (
    <div className={cx('flex flex-col gap-8', className)}>
      <SegmentedTabs
        items={steps.map((entry) => ({ id: entry.id, label: entry.tab }))}
        selected={step.id}
        onSelect={setSelected}
        label="Product tour step"
        baseId={baseId}
      />

      <div
        key={step.id}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${step.id}`}
        tabIndex={-1}
        className="animate-wake grid grid-cols-1 items-start gap-8 focus:outline-none lg:grid-cols-12 lg:gap-12"
      >
        {/* The visual dominates: seven columns of twelve, and it comes first in
            the source at every width, because it is the argument. */}
        <ApplicationFrame
          title={step.surface}
          path={step.href}
          provenance={step.provenance}
          note={step.provenanceNote}
          label={step.title}
          className="lg:col-span-7"
        >
          <ApplicationImage
            src={step.image.src}
            alt={step.image.alt}
            width={step.image.width}
            height={step.image.height}
          />
        </ApplicationFrame>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Heading level={3} size="h4">
            {step.title}
          </Heading>
          <Text size="body" tone="muted" className="max-w-prose">
            {step.summary}
          </Text>

          {/* The decision behind the route, behind a summary that states which
              decision. "The decision behind it" was an accurate eyebrow and a
              useless label - it told a reader the kind of thing they would get
              rather than which thing, so every step read the same. */}
          <Disclosure label={step.insightLabel}>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {step.insight}
            </Text>
          </Disclosure>

          <div className="mt-1">
            <LinkButton href={step.href} variant="secondary" iconAfter={<ArrowRight />}>
              {step.cta}
            </LinkButton>
          </div>
        </div>
      </div>
    </div>
  )
}
