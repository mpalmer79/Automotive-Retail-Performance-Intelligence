'use client'

/**
 * The credibility strip.
 *
 * Seven counts, every one of which comes from `project-manifest.json` and
 * therefore from a repository file. None is typed into this component, and
 * `tests/unit/content-integrity.test.ts` fails if one ever is.
 *
 * The numbers count up once, when the strip first enters view. That is the one
 * place on the site where an animated number is justified: these seven figures
 * are the evidence the whole page rests on, and drawing the eye across them in
 * sequence is the point. Everywhere else a number is static.
 *
 * Each count carries a source link. A reviewer who does not believe the figure
 * can be looking at the file that proves it in one click, which is a materially
 * different claim from "trust me".
 */
import { AnimatedCount } from '@/components/motion/motion-boundary'
import { RevealGroup, RevealItem } from '@/components/motion/reveal'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import type { SourcedCount } from '@/types/manifest'

/**
 * The seven figures shown, in a deliberate order: the business shape first
 * (stores, dimensions, facts), then the governed surface (views, KPIs), then the
 * semantic model (relationships, measures). A reader moves from "what is
 * modelled" to "what is defined" to "what is built".
 */
const STRIP: readonly SourcedCount[] = [
  counts.dealerships,
  counts.dimensions,
  counts.facts,
  counts.reportingViews,
  counts.governedKpis,
  counts.semanticRelationships,
  counts.daxMeasures,
]

export function CredibilityStrip() {
  return (
    <Section id="engineering-counts" rhythm="tight" bordered>
      <Container width="wide">
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <Eyebrow>Built, tested and counted from source</Eyebrow>
            <p className="font-mono text-2xs text-ink-faint">
              Every figure below links to the file that proves it
            </p>
          </div>

          <RevealGroup
            as="ul"
            className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-7"
          >
            {STRIP.map((count, index) => (
              <RevealItem
                key={count.label}
                as="li"
                index={index}
                className="flex min-w-0 flex-col gap-1.5"
              >
                <AnimatedCount
                  value={count.value}
                  className="font-display text-4xl font-semibold tracking-tighter text-ink"
                />
                <span className="text-sm leading-snug font-semibold text-ink-secondary">
                  {count.label}
                </span>
                <span className="text-xs leading-normal text-ink-faint">
                  {count.detail}
                </span>
                {count.sources[0] ? (
                  <SourceLink
                    path={count.sources[0].path}
                    field={count.sources[0].field}
                    className="mt-1"
                  />
                ) : null}
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Container>
    </Section>
  )
}
