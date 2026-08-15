import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { Suspense } from 'react'

import { KpiCatalogue } from '@/components/explorers/kpi-catalogue'
import { OperatingView } from '@/components/sections/operating-view'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'

export function KpisView() {
  return (
    <>
      <TechnicalViewMeta>
        <StatusBadge
          status="complete"
          label={`All ${String(counts.governedKpis.value)} computable from SQL`}
          size="sm"
        />
        <StatusBadge status="pending-external" label="DAX never evaluated" size="sm" />
        <SourceLink path="KPI_CATALOG.md" field="governing definitions" />
      </TechnicalViewMeta>

      {/* Why there are no numbers here. Stated before the catalogue, because it
          is the first question a reviewer will have.

          `UX.3` HALVED THE WORDS AND KEPT BOTH CLAIMS. Each card was a
          sixty-word paragraph that made its point in its first sentence and then
          argued for it. Both points are qualifications on how the catalogue may
          be read, so neither may go behind a disclosure; what they could lose is
          the argument, which the rest of this destination makes at length. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card tone="pending" className="flex flex-col gap-2">
              {/* The heading and the engine clause are both asserted verbatim by
                  `content-integrity.spec.ts`, and that is the right place for the
                  line between compression and disclosure to be drawn: what this
                  card may lose is the argument, never the words that carry the
                  claim. */}
              <Heading level={2} size="h5">
                This page shows definitions, never values
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                No KPI value appears anywhere on this site. The SQL side computes over
                synthetic data for a fictional dealer group, and the DAX side has never
                been evaluated by a Microsoft engine.
              </Text>
            </Card>

            <Card tone="sunken" className="flex flex-col gap-2">
              <Heading level={2} size="h5">
                No invented benchmarks either
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                This project has no real dealership performance data, so it states no
                industry benchmark. Every numeric threshold in the catalogue is labelled a
                project default with its source: a parameter of the calculation, not a
                standard.
              </Text>
              <SourceLink
                path="LIMITATIONS.md"
                field="what this cannot support"
                className="mt-1"
              />
            </Card>
          </div>
        </Container>
      </Section>

      {/* The operating view, moved here from the home page.
          Six domains with one definition each is reference material, and this is
          the page whose subject it is. It sits directly above the catalogue it
          points into: a reader who has just seen which measures answer a
          management question is the reader who wants their definitions. */}
      <OperatingView />

      <Section rhythm="none" tone="panel" className="pt-section-tight pb-section">
        <Container width="wide">
          {/* `useSearchParams` in the catalogue requires a Suspense boundary so
              the shell can be prerendered while the filter state resolves on the
              client. The fallback is a skeleton with the same box, so nothing
              shifts when it swaps. */}
          <Suspense fallback={<CatalogueSkeleton />}>
            <KpiCatalogue />
          </Suspense>
        </Container>
      </Section>
    </>
  )
}

/**
 * The loading state for the catalogue.
 *
 * A dimmed structural placeholder rather than a spinner: the box is the same
 * height as the real controls, so the swap causes no layout shift, and it says
 * what is loading rather than only that something is.
 */
function CatalogueSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken/50 p-4">
        <div className="h-4 w-64 rounded-sm bg-line-subtle" />
        <div className="h-touch w-full rounded-lg border border-line bg-canvas" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-9 w-24 rounded-md bg-line-subtle" />
          ))}
        </div>
      </div>
      <p role="status" className="font-mono text-2xs text-ink-faint">
        Loading the KPI catalogue.
      </p>
    </div>
  )
}
