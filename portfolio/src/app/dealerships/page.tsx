import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'

import { DealershipCard } from '@/components/dealerships/dealership-card'
import { GroupSnapshot } from '@/components/dealerships/group-snapshot'
import { Canvas } from '@/components/shell/field'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Heading, Text } from '@/components/ui/typography'
import { BarChart, StackedMixBar } from '@/components/visuals/inventory-charts'
import {
  accentPresentation,
  dealershipGroup,
  dealerships,
  formatPrice,
  formatRange,
  inventorySummary,
} from '@/lib/inventory'
import { pageMetadata } from '@/lib/metadata'
import { INVENTORY_DATA_STATEMENT, ROUTES } from '@/lib/site'
import { cx, formatCount, formatDate } from '@/lib/utils'

export const metadata: Metadata = pageMetadata('dealerships')

/**
 * The group overview.
 *
 * This page is an automotive retail case study, not an architecture diagram with
 * dealership words on it. Its argument is a specific one: three stores in one
 * group, twenty miles apart, running three different businesses, and a group
 * report that treats them as one line loses the only thing that explains their
 * numbers.
 *
 * The store comparison table is the centre of it. Everything above sets it up
 * and everything below says what the data behind it can and cannot support.
 *
 * Server component. Every figure comes from the generated inventory artefacts.
 */
export default function DealershipsPage() {
  const summary = inventorySummary
  const franchise = dealerships.filter((dealership) => dealership.isFranchise)
  const independent = dealerships.filter((dealership) => !dealership.isFranchise)

  return (
    <Canvas>
      <PageHeader
        eyebrow="Granite Auto Group"
        title="Three stores, three operating models, one reporting layer"
        lede={dealershipGroup.introduction}
        supporting={dealershipGroup.operatingModel}
        groupNav
        trustScope="inventory"
        meta={
          <>
            <StatusBadge
              status="complete"
              label={`${formatCount(summary.totalRecords)} sanitized listings across ${formatCount(summary.dealershipCount)} stores`}
              size="sm"
            />
            <StatusBadge
              status="pending-external"
              label="Descriptive evidence, not an analytical finding"
              size="sm"
            />
            <SourceLink
              path="data/reference/inventory/"
              field="sanitized reference workbooks"
            />
          </>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* 1. The group snapshot                                              */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="panel" rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Group inventory snapshot"
            title="What the three stores hold, together"
            lede={`Derived at build time from the reference workbooks committed to this repository. Snapshot ${formatDate(summary.latestSnapshotDate)}.`}
          />
          <GroupSnapshot className="mt-8" />
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. The three stores                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="The stores"
            title="Two franchise rooftops and one independent"
            lede="Each store's own page carries its full inventory profile: model-year range, price range, mileage summary, top makes and models, and the complete listing table."
          />

          <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {dealerships.map((dealership) => (
              <DealershipCard key={dealership.id} dealership={dealership} />
            ))}
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Franchise versus independent                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="evidence" rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Inventory strategy"
            title="Allocation is not acquisition"
            lede="The single most useful thing a group-level report can know about these three stores is which of them chooses what it stocks."
          />

          <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <Heading level={3} size="h5">
                {`Franchise: ${franchise.map((store) => store.shortName).join(' and ')}`}
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                A franchise rooftop sells a manufacturer&apos;s new vehicles under a sales
                and service agreement. What arrives on the lot is largely decided by
                allocation: the store orders into a build schedule it does not control,
                and the mix it receives reflects national production as much as local
                demand. The levers it has are pricing, merchandising and turn.
              </Text>
              <Text size="sm" tone="secondary" className="max-w-prose">
                {`In this snapshot the two franchise stores hold ` +
                  `${formatCount(summary.newRecords)} of the group's new listings and all of them. ` +
                  'A group report that compares new-vehicle days supply across all three ' +
                  'stores is comparing two stores and an empty set.'}
              </Text>
              <ul className="flex flex-col gap-3 border-t border-line-subtle pt-4">
                {franchise.map((store) => (
                  <li key={store.id} className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-ink">{store.name}</span>
                    <span className="text-sm text-ink-muted">
                      {store.inventoryStrategy}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="flex flex-col gap-4">
              <Heading level={3} size="h5">
                {`Independent: ${independent.map((store) => store.shortName).join(' and ')}`}
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                An independent store has no franchise agreement, no allocation and no new
                vehicle order bank. Every unit it lists was bought: at auction, from a
                trade, from a lease return, or from another dealer. Its inventory is
                therefore a record of buying decisions in a way a franchise store&apos;s
                is not.
              </Text>
              <Text size="sm" tone="secondary" className="max-w-prose">
                {`That shows up directly in the data. The independent store carries ` +
                  `${formatCount(independent[0]?.inventory.makeCount ?? 0)} makes against the ` +
                  `Chevrolet store's ${formatCount(dealerships[0]?.inventory.makeCount ?? 0)}, ` +
                  'and the widest model-year spread in the group. Neither of those is a ' +
                  'performance result. Both are structural facts a report has to respect.'}
              </Text>
              <ul className="flex flex-col gap-3 border-t border-line-subtle pt-4">
                {independent.map((store) => (
                  <li key={store.id} className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-ink">{store.name}</span>
                    <span className="text-sm text-ink-muted">
                      {store.inventoryStrategy}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Store comparison                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Store comparison"
            title="The same eight columns, for all three"
            lede="Every cell is computed from the store's own workbook. Where a store's source did not expose a value, the cell says so rather than showing a figure derived from a different population."
          />

          <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-canvas">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">
                {`Granite Auto Group store comparison, snapshot ${summary.latestSnapshotDate}.`}
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-sunken/60">
                  <th scope="col" className={cx(HEAD, 'pl-4 sm:pl-5')}>
                    Store
                  </th>
                  <th scope="col" className={HEAD}>
                    Type
                  </th>
                  <th scope="col" className={cx(HEAD, 'text-right')}>
                    Listings
                  </th>
                  <th scope="col" className={cx(HEAD, 'text-right')}>
                    New
                  </th>
                  <th scope="col" className={cx(HEAD, 'text-right')}>
                    Pre-owned
                  </th>
                  <th scope="col" className={cx(HEAD, 'text-right')}>
                    Makes
                  </th>
                  <th scope="col" className={cx(HEAD, 'text-right')}>
                    Model years
                  </th>
                  <th scope="col" className={cx(HEAD, 'pr-4 text-right sm:pr-5')}>
                    Median advertised price
                  </th>
                </tr>
              </thead>
              <tbody>
                {dealerships.map((store) => {
                  const accent = accentPresentation(store.accent)
                  const years = store.inventory.modelYearRange
                  return (
                    <tr
                      key={store.id}
                      className="border-b border-line-subtle last:border-0"
                    >
                      <th scope="row" className={cx(CELL, 'pl-4 font-medium sm:pl-5')}>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cx(
                              'inline-block h-4 w-1 rounded-pill',
                              accent.mark
                            )}
                          />
                          <span className="text-ink">{store.shortName}</span>
                        </span>
                      </th>
                      <td className={cx(CELL, 'text-ink-muted')}>
                        {store.isFranchise
                          ? `Franchise (${store.franchiseBrand ?? ''})`
                          : 'Independent'}
                      </td>
                      <td className={cx(CELL, 'numeric text-right text-ink')}>
                        {formatCount(store.inventory.totalRecords)}
                      </td>
                      <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                        {formatCount(store.inventory.newRecords)}
                      </td>
                      <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                        {formatCount(store.inventory.preOwnedRecords)}
                      </td>
                      <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                        {formatCount(store.inventory.makeCount)}
                      </td>
                      <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                        {years === null
                          ? 'Not exposed'
                          : `${String(years.min)} to ${String(years.max)}`}
                      </td>
                      <td
                        className={cx(CELL, 'numeric pr-4 text-right text-ink sm:pr-5')}
                      >
                        {store.inventory.medianPrice === null
                          ? 'Not exposed'
                          : formatPrice(store.inventory.medianPrice)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Text size="sm" tone="muted" className="mt-4 max-w-prose">
            {`Group price range across the ${formatCount(summary.pricedRecords)} priced listings: ` +
              `${formatRange(summary.priceRange, formatPrice) ?? 'not exposed'}. ` +
              'A median is stated only where the source priced enough of that store to make ' +
              'one meaningful, and each store page names its own denominator.'}
          </Text>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Charts                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Section tone="panel" rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Distribution"
            title="Where the inventory actually sits"
            lede="Two views of the same set. Every chart carries the same figures as a table, and no chart is the only place a number appears."
          />

          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2">
            <BarChart
              title="Inventory by dealership"
              unit="listings"
              headingLevel={3}
              caption="Listing counts, not units on the ground."
              rows={summary.byDealership.map((entry) => ({
                key: entry.dealershipId,
                label: entry.shortName,
                value: entry.total,
                colour: accentPresentation(entry.accent).series,
              }))}
            />
            <StackedMixBar
              title="New and pre-owned mix"
              headingLevel={3}
              caption="Normalised to the share of each store's own snapshot, because the three differ in size by more than an order of magnitude."
              rows={summary.byDealership.map((entry) => ({
                key: entry.dealershipId,
                label: entry.shortName,
                newRecords: entry.newRecords,
                preOwnedRecords: entry.preOwnedRecords,
              }))}
            />
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. How ARPI governs the group view                                 */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="tight">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Governed group reporting"
            title="One number per question, and a store dimension under it"
            lede="A three-store group is where metric governance stops being a preference and starts being load-bearing."
          />

          <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="flex flex-col gap-2">
              <Heading level={3} size="h6">
                One definition, conformed across stores
              </Heading>
              <Text size="sm" tone="secondary">
                A retail unit means the same thing at all three rooftops, so a group total
                is a sum rather than a negotiation. The store dimension is conformed,
                which is what lets the same measure resolve at group level and at store
                level without a second definition.
              </Text>
            </Card>
            <Card className="flex flex-col gap-2">
              <Heading level={3} size="h6">
                Store context travels with the number
              </Heading>
              <Text size="sm" tone="secondary">
                Store type and franchise brand are attributes of the dimension, not labels
                on a report page. A comparison that would be meaningless across an
                independent and a franchise store can therefore be blocked at the model
                rather than caught in review.
              </Text>
            </Card>
            <Card className="flex flex-col gap-2">
              <Heading level={3} size="h6">
                A group total that can be taken apart
              </Heading>
              <Text size="sm" tone="secondary">
                Every group figure on this site decomposes to the three store figures that
                produce it, and the generator refuses to write an artefact whose store
                totals do not reconcile to its group total.
              </Text>
            </Card>
          </div>

          <Card tone="pending" className="mt-8 flex flex-col gap-3">
            <Heading level={3} size="h5">
              What this page is evidence of, and what it is not
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {INVENTORY_DATA_STATEMENT}
            </Text>
            <Text size="sm" tone="secondary" className="max-w-prose">
              An inventory summary is descriptive evidence. It describes a set of listings
              that existed at a capture date. It is not an analytical finding about how
              this group performs, and publishing it does not open Gate 2 or complete the
              analytical case study, both of which remain closed for the reasons the
              status page gives.
            </Text>
            <div className="flex flex-wrap gap-3 pt-1">
              <LinkButton
                href={ROUTES.inventory.href}
                variant="primary"
                iconAfter={<ArrowRight strokeWidth={2} />}
              >
                Open the inventory explorer
              </LinkButton>
              <LinkButton href={ROUTES.governance.href} variant="secondary">
                How this is governed
              </LinkButton>
              <LinkButton href={ROUTES.status.href} variant="ghost">
                What is finished, and what is not
              </LinkButton>
            </div>
          </Card>
        </Container>
      </Section>
    </Canvas>
  )
}

const HEAD = 'px-3 py-3 text-xs font-semibold whitespace-nowrap text-ink-muted'
const CELL = 'px-3 py-3 whitespace-nowrap'
