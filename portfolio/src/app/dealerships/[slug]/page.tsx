import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { InventoryTable } from '@/components/dealerships/inventory-table'
import { MetricGrid } from '@/components/dealerships/metric-grid'
import { Canvas } from '@/components/shell/field'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Heading, Text } from '@/components/ui/typography'
import { BarChart } from '@/components/visuals/inventory-charts'
import {
  accentPresentation,
  coverageSentences,
  dealershipBySlug,
  dealershipGroup,
  dealerships,
  formatMiles,
  formatModelYear,
  formatPrice,
  formatRange,
  formatShare,
  recordsForDealership,
} from '@/lib/inventory'
import { pageMetadata } from '@/lib/metadata'
import { INVENTORY_DATA_STATEMENT, ROUTES, type RouteKey } from '@/lib/site'
import { cx, formatCount, formatDate } from '@/lib/utils'

/**
 * A single store's page.
 *
 * One dynamic segment, three static paths. The three stores are fixed reference
 * data rather than a collection that grows, so `generateStaticParams` enumerates
 * them from the generated file and `dynamicParams = false` makes any other slug a
 * 404 at build time rather than a rendered page for a store that does not exist.
 *
 * The page is deliberately the same shape for all three, because the argument the
 * group page makes only lands if the reader can put the three side by side. What
 * differs is the emphasis paragraph, which comes from the store's authored
 * profile, and which figures are present at all: a metric the store's source did
 * not support is absent rather than dashed. See `<MetricGrid>`.
 */

export const dynamicParams = false

export function generateStaticParams(): { slug: string }[] {
  return dealerships.map((dealership) => ({ slug: dealership.slug }))
}

/** The route-map key for a store, so its metadata is written in one place. */
const ROUTE_KEY_BY_SLUG: Record<string, RouteKey> = {
  'granite-chevrolet': 'graniteChevrolet',
  'granite-subaru': 'graniteSubaru',
  'granite-pre-owned': 'granitePreOwned',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const key = ROUTE_KEY_BY_SLUG[slug]
  if (!key) return {}
  return pageMetadata(key)
}

export default async function DealershipPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const dealership = dealershipBySlug(slug)
  if (!dealership) notFound()

  const records = recordsForDealership(dealership.id)
  const inventory = dealership.inventory
  const accent = accentPresentation(dealership.accent)
  const coverage = coverageSentences(dealership)

  const preOwnedRecords = records.filter((record) => record.condition === 'pre-owned')
  const otherStores = dealerships.filter((store) => store.id !== dealership.id)

  return (
    <Canvas>
      <PageHeader
        eyebrow={`${dealership.id} · ${dealership.storeTypeLabel}`}
        title={dealership.name}
        lede={dealership.positioning}
        supporting={dealership.customerSegment}
        groupNav
        trustScope="inventory"
        // The group overview is the home page, so the parent crumb points there
        // and names the group rather than repeating "Overview".
        parentCrumb={{ href: ROUTES.home.href, label: dealershipGroup.name }}
        meta={
          <>
            <StatusBadge
              status="complete"
              label={`${formatCount(inventory.totalRecords)} listings, snapshot ${inventory.snapshotDate}`}
              size="sm"
            />
            {inventory.coverageStatus === null ? null : (
              <StatusBadge
                status={
                  /partial/i.test(inventory.coverageStatus)
                    ? 'pending-external'
                    : 'complete'
                }
                label={inventory.coverageStatus}
                size="sm"
              />
            )}
            <SourceLink path={inventory.sourceWorkbook} field="sanitized workbook" />
          </>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* 1. Identity                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="panel" rhythm="tight">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cx(
                    'inline-flex items-center rounded-pill border px-2.5 py-0.5',
                    'text-2xs font-semibold tracking-wide uppercase',
                    accent.chip
                  )}
                >
                  {dealership.isFranchise ? 'Franchise' : 'Independent'}
                </span>
                {dealership.franchiseBrand ? (
                  <span className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2 py-0.5 text-xs text-ink-secondary">
                    {`${dealership.franchiseBrand} franchise brand`}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2 py-0.5 text-xs text-ink-secondary">
                    No franchise brand
                  </span>
                )}
                <span className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2 py-0.5 text-xs text-ink-secondary">
                  {`${dealership.city}, ${dealership.stateCode}`}
                </span>
                <span className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2 py-0.5 text-xs text-ink-secondary">
                  {dealership.marketRegion}
                </span>
              </div>

              <Heading level={2} size="h4">
                {dealership.tagline}
              </Heading>
              <Text size="body" tone="secondary" className="max-w-prose">
                {dealership.inventoryStrategy}
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                {dealership.analyticsFocus}
              </Text>
            </div>

            <Card tone="sunken" className="flex flex-col gap-4">
              <Heading level={2} size="h6">
                Store record
              </Heading>
              <dl className="flex flex-col gap-3 text-sm">
                <Row term="Dealership id" value={dealership.id} mono />
                <Row term="Store type" value={dealership.storeTypeLabel} />
                <Row
                  term="Franchise brand"
                  value={dealership.franchiseBrand ?? 'None. Independent store.'}
                />
                <Row
                  term="Location"
                  value={`${dealership.city}, ${dealership.stateCode}`}
                />
                <Row term="Market" value={dealership.marketRegion} />
                <Row term="Opened" value={formatDate(dealership.openedDate)} />
              </dl>
              <Text size="xs" tone="faint">
                Store attributes come from the warehouse&apos;s own store dimension, so
                this page and the data model cannot disagree about who this store is.
              </Text>
              <SourceLink path="data/sample/dim_dealership.csv" field="store dimension" />
            </Card>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Inventory profile                                               */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Inventory profile"
            title="What this store had listed at the snapshot date"
            lede={`Every figure below is computed from ${formatCount(inventory.totalRecords)} rows in this store's own sanitized workbook. A statistic is shown only where the source exposed enough of the population to support it.`}
          />

          <MetricGrid
            className="mt-8"
            columns={4}
            size="md"
            metrics={[
              {
                label: 'Listings in snapshot',
                value: formatCount(inventory.totalRecords),
                detail: `Captured ${formatDate(inventory.snapshotDate)}`,
              },
              {
                label: 'New',
                value: formatCount(inventory.newRecords),
                detail:
                  formatShare(inventory.newRecords, inventory.totalRecords) ?? undefined,
              },
              {
                label: 'Pre-owned',
                value: formatCount(inventory.preOwnedRecords),
                detail:
                  formatShare(inventory.preOwnedRecords, inventory.totalRecords) ??
                  undefined,
              },
              {
                label: 'Model-year range',
                value:
                  inventory.modelYearRange === null
                    ? null
                    : (formatRange(inventory.modelYearRange, formatModelYear) ?? null),
                detail: 'Oldest to newest listed',
              },
              {
                label: 'Advertised price range',
                value:
                  inventory.priceRange === null
                    ? null
                    : (formatRange(inventory.priceRange, formatPrice) ?? null),
                detail: `Over ${formatCount(inventory.pricedRecords)} priced listings`,
              },
              {
                label: 'Median advertised price',
                value:
                  inventory.medianPrice === null
                    ? null
                    : formatPrice(inventory.medianPrice),
                detail: 'Advertised, never transacted',
              },
              {
                label: 'Median pre-owned mileage',
                value:
                  inventory.medianPreOwnedMileage === null
                    ? null
                    : formatMiles(inventory.medianPreOwnedMileage),
                detail:
                  inventory.preOwnedMileageRange === null
                    ? undefined
                    : `Range ${formatRange(inventory.preOwnedMileageRange, formatMiles) ?? ''}`,
              },
              {
                label: 'Makes represented',
                value: formatCount(inventory.makeCount),
                detail: `${formatCount(inventory.modelCount)} distinct models`,
              },
            ]}
          />
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Top makes and models                                            */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="evidence" rhythm="tight">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <BarChart
              title="Top makes"
              unit="listings"
              headingLevel={2}
              colour={accent.series}
              caption={
                inventory.makeCount > inventory.topMakes.length
                  ? `The ${formatCount(inventory.topMakes.length)} largest of ${formatCount(inventory.makeCount)} makes in this store's snapshot.`
                  : 'Every make in this store’s snapshot.'
              }
              rows={inventory.topMakes.map((entry) => ({
                key: entry.make,
                label: entry.make,
                value: entry.count,
                note: formatShare(entry.count, inventory.totalRecords) ?? undefined,
              }))}
            />
            <BarChart
              title="Top models"
              unit="listings"
              headingLevel={2}
              colour={accent.series}
              caption={
                inventory.modelCount > inventory.topModels.length
                  ? `The ${formatCount(inventory.topModels.length)} largest of ${formatCount(inventory.modelCount)} models in this store's snapshot.`
                  : 'Every model in this store’s snapshot.'
              }
              rows={inventory.topModels.map((entry) => ({
                key: `${entry.make} ${entry.model}`,
                label: `${entry.make} ${entry.model}`,
                value: entry.count,
                note: formatShare(entry.count, inventory.totalRecords) ?? undefined,
              }))}
            />
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Data coverage                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <Card tone="pending" className="flex flex-col gap-3">
            <Heading level={2} size="h5">
              Data coverage for this store
            </Heading>
            {coverage.map((sentence) => (
              <Text key={sentence} size="sm" tone="secondary" className="max-w-prose">
                {sentence}
              </Text>
            ))}
            {inventory.coverageNote ? (
              <Text size="sm" tone="secondary" className="max-w-prose">
                {inventory.coverageNote}
              </Text>
            ) : null}
            <Text size="sm" tone="secondary" className="max-w-prose">
              {INVENTORY_DATA_STATEMENT}
            </Text>
            <SourceLink
              path={inventory.sourceWorkbook}
              field="README sheet, sanitization controls and limitations"
              className="pt-1"
            />
          </Card>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. The listings                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="panel" rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Inventory table"
            title={`All ${formatCount(records.length)} listings`}
            lede="The complete sanitized snapshot for this store, in generated order. No VIN and no source URL exists in the generated data, so neither can appear here."
            action={
              <LinkButton
                href={`${ROUTES.inventory.href}?dealership=${dealership.id}`}
                variant="secondary"
                iconAfter={<ArrowRight strokeWidth={2} />}
                // `max-w-full` and `whitespace-normal` together, and both are
                // needed. The button's base style is `shrink-0` and
                // `whitespace-nowrap`, which is right for a two-word action and
                // wrong for a 37-character store name: at 320px the box is wider
                // than its container, cannot shrink, and is clipped rather than
                // wrapped. That is a WCAG 1.4.10 reflow failure, and it was one.
                className="max-w-full whitespace-normal text-left"
              >
                Filter and sort in the explorer
              </LinkButton>
            }
          />

          <InventoryTable
            className="mt-8"
            records={records}
            caption={`${dealership.name} inventory, snapshot ${inventory.snapshotDate}.`}
          />

          {preOwnedRecords.length > 0 ? (
            <Text size="sm" tone="muted" className="mt-4 max-w-prose">
              {`${formatCount(preOwnedRecords.length)} of these listings are pre-owned. ` +
                `${formatCount(inventory.mileageRecords)} of the store's listings carry an ` +
                'odometer reading; the rest are shown as not exposed, which is what the ' +
                'source said rather than a rendering fault.'}
            </Text>
          ) : null}
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. Back to the group                                               */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <div className="flex flex-col gap-6 border-t border-line pt-8">
            <Heading level={2} size="h5">
              The other two stores, and the group view
            </Heading>
            <div className="flex flex-wrap gap-3">
              <LinkButton
                href={ROUTES.home.href}
                variant="primary"
                iconBefore={<ArrowLeft strokeWidth={2} />}
                className="max-w-full whitespace-normal text-left"
              >
                Back to Granite Auto Group
              </LinkButton>
              {otherStores.map((store) => (
                <LinkButton
                  key={store.id}
                  href={store.href}
                  variant="secondary"
                  className="max-w-full whitespace-normal text-left"
                >
                  {store.name}
                </LinkButton>
              ))}
            </div>
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}

function Row({
  term,
  value,
  mono = false,
}: {
  term: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow text-2xs">{term}</dt>
      <dd className={cx('text-ink-secondary', mono ? 'font-mono text-xs' : 'text-sm')}>
        {value}
      </dd>
    </div>
  )
}
