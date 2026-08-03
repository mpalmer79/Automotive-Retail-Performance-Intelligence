import type { Metadata } from 'next'
import { Suspense } from 'react'

import { InventoryExplorer } from '@/components/explorers/inventory-explorer'
import { Canvas } from '@/components/shell/field'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Heading, Text } from '@/components/ui/typography'
import { BarChart } from '@/components/visuals/inventory-charts'
import {
  accentPresentation,
  formatPrice,
  formatRange,
  inventorySummary,
} from '@/lib/inventory'
import { pageMetadata } from '@/lib/metadata'
import { INVENTORY_DATA_STATEMENT } from '@/lib/site'
import { formatCount, formatDate } from '@/lib/utils'

export const metadata: Metadata = pageMetadata('inventory')

/**
 * The inventory explorer page.
 *
 * The explorer is the page. Everything above it establishes what the reader is
 * about to filter, and everything below it is the distribution the filters cut
 * into.
 *
 * The two charts sit UNDER the explorer rather than over it. A reader arriving
 * here wants the table; a reader who has finished with the table is the one who
 * wants to know how the set is shaped.
 */
export default function InventoryPage() {
  const summary = inventorySummary
  const topMakes = summary.byMake.slice(0, 10)
  const unpriced = summary.totalRecords - summary.pricedRecords

  return (
    <Canvas>
      <PageHeader
        eyebrow="Inventory explorer"
        title="Every listing the three stores carried, and nothing they did not"
        lede={`${formatCount(summary.totalRecords)} sanitized listings across ${formatCount(summary.dealershipCount)} stores, captured ${formatDate(summary.latestSnapshotDate)}. Filter by store, condition, make, model, model year, advertised price and mileage; sort six ways.`}
        supporting="The records were read from the reference workbooks at build time. Nothing on this page is fetched, and no Excel file is parsed in your browser."
        groupNav
        trustScope="inventory"
        meta={
          <>
            <StatusBadge
              status="complete"
              label={`${formatCount(summary.totalRecords)} listings generated from ${formatCount(summary.generatedFrom.length)} workbooks`}
              size="sm"
            />
            <StatusBadge
              status="pending-external"
              label="Listing observations, not sales results"
              size="sm"
            />
            <SourceLink
              path="portfolio/scripts/generate-inventory-data.ts"
              field="build-time ingestion"
            />
          </>
        }
      />

      <Section rhythm="tight" tone="panel">
        <Container width="wide">
          <Suspense fallback={<ExplorerSkeleton />}>
            <InventoryExplorer />
          </Suspense>
        </Container>
      </Section>

      <Section rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Distribution"
            title="How the set is shaped"
            lede="Three views of the same listings. Each carries a table alternative, and no figure appears only inside a chart."
          />

          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
            <BarChart
              title="Inventory by make"
              unit="listings"
              headingLevel={3}
              caption={`The ${formatCount(topMakes.length)} largest of ${formatCount(summary.makeCount)} makes represented.`}
              rows={topMakes.map((entry) => ({
                key: entry.make,
                label: entry.make,
                value: entry.count,
              }))}
            />
            <BarChart
              title="Inventory by model year"
              unit="listings"
              headingLevel={3}
              caption={
                summary.modelYearRange === null
                  ? 'Model years present in the snapshot.'
                  : `Model years ${String(summary.modelYearRange.min)} to ${String(summary.modelYearRange.max)}.`
              }
              valueHeading="Listings"
              rows={summary.byModelYear.map((entry) => ({
                key: String(entry.modelYear),
                label: String(entry.modelYear),
                value: entry.count,
              }))}
            />
            <BarChart
              title="Advertised price distribution"
              unit="priced listings"
              headingLevel={3}
              caption={`Over the ${formatCount(summary.pricedRecords)} listings the source priced. Fixed bands, so the three stores can be compared against the same scale.`}
              valueHeading="Priced listings"
              rows={summary.priceBands.map((band) => ({
                key: band.label,
                label: band.label,
                value: band.count,
              }))}
            />
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {summary.byDealership.map((entry) => {
              const accent = accentPresentation(entry.accent)
              return (
                <Card key={entry.dealershipId} className="flex flex-col gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1 w-10 rounded-pill ${accent.mark}`}
                  />
                  <Heading level={3} size="h6">
                    {entry.name}
                  </Heading>
                  <Text size="sm" tone="secondary">
                    {`${formatCount(entry.total)} listings: ${formatCount(entry.newRecords)} new and ${formatCount(entry.preOwnedRecords)} pre-owned.`}
                  </Text>
                </Card>
              )
            })}
          </div>
        </Container>
      </Section>

      <Section rhythm="tight" tone="evidence">
        <Container width="wide">
          <Card tone="pending" className="flex flex-col gap-3">
            <Heading level={2} size="h5">
              What these rows are
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {INVENTORY_DATA_STATEMENT}
            </Text>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {`Across the whole set the source exposed an advertised price for ` +
                `${formatCount(summary.pricedRecords)} listings` +
                (unpriced > 0 ? ` and none for the other ${formatCount(unpriced)}` : '') +
                `. Prices run ${formatRange(summary.priceRange, formatPrice) ?? 'over a range the source did not expose'}. ` +
                'An advertised price is not a transaction price, an acquisition cost, an ' +
                'inventory investment, a manufacturer suggested price or a gross figure, ' +
                'and a listing that later disappears has been removed from a feed rather ' +
                'than proven sold.'}
            </Text>
            <Text size="sm" tone="secondary" className="max-w-prose">
              This page is descriptive evidence about a reference dataset. It is not an
              analytical finding about dealership performance, and it does not open the
              case-study gate.
            </Text>
            <ul className="flex flex-col gap-0.5 pt-1">
              {summary.generatedFrom.map((path) => (
                <li key={path}>
                  <SourceLink path={path} field="sanitized workbook" />
                </li>
              ))}
            </ul>
          </Card>
        </Container>
      </Section>
    </Canvas>
  )
}

/**
 * The explorer's loading state.
 *
 * `useSearchParams` in the explorer requires a Suspense boundary so the shell can
 * be prerendered while the filter state resolves on the client. The fallback is a
 * structural placeholder of the same shape, so nothing shifts when it swaps.
 */
function ExplorerSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken/50 p-4 sm:p-5">
        <div className="h-4 w-40 rounded-sm bg-line-subtle" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-touch rounded-lg border border-line bg-canvas"
            />
          ))}
        </div>
      </div>
      <div className="h-96 rounded-xl border border-line bg-canvas" />
      <p role="status" className="font-mono text-2xs text-ink-faint">
        Loading the inventory explorer.
      </p>
    </div>
  )
}
