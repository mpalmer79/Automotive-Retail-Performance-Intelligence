import type { Metadata } from 'next'
import { Suspense } from 'react'

import { KpiCatalogue } from '@/components/explorers/kpi-catalogue'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Heading, Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { Canvas } from '@/components/shell/field'

export const metadata: Metadata = pageMetadata('kpis')

export default function KpisPage() {
  return (
    <Canvas>
      <PageHeader
        eyebrow="KPI catalogue"
        title="A ratio without both sides is not a KPI, it is a rumour"
        lede={`${String(counts.governedKpis.value)} governed metrics, each with a business definition, a formula, an explicit numerator and denominator, a declared grain, a date basis, inclusion and exclusion rules, a null rule, a source reporting view and an interpretation caution.`}
        supporting="No metric in this project may exist as an unexplained dashboard measure. Additive measures state that they have no denominator rather than leaving the field blank, so the omission is visibly deliberate."
        meta={
          <>
            <StatusBadge
              status="complete"
              label={`All ${String(counts.governedKpis.value)} computable from SQL`}
              size="sm"
            />
            <StatusBadge
              status="pending-external"
              label="DAX never evaluated"
              size="sm"
            />
            <SourceLink path="KPI_CATALOG.md" field="governing definitions" />
          </>
        }
      />

      {/* Why there are no numbers here. Stated before the catalogue, because it
          is the first question a reviewer will have. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card tone="pending" className="flex flex-col gap-2">
              <Heading level={2} size="h5">
                This page shows definitions, never values
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                There is no KPI value anywhere on this site. The SQL side computes over a
                synthetic dataset describing a fictional dealer group, and the DAX side
                has never been evaluated by a Microsoft engine. A grid of figures here
                would look like results and would mean nothing, so the catalogue presents
                what the project actually has: the arithmetic, and the rules around it.
              </Text>
            </Card>

            <Card tone="sunken" className="flex flex-col gap-2">
              <Heading level={2} size="h5">
                No invented benchmarks either
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                The catalogue contains no industry benchmark value, because the project
                has no access to real dealership performance data and therefore cannot
                state what good looks like. Where a numeric threshold appears - the 60-day
                aged-inventory line, the 30-day days-supply window - it is labelled a
                project default with its source cited, and it is a parameter of the
                calculation rather than a performance standard.
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
    </Canvas>
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
