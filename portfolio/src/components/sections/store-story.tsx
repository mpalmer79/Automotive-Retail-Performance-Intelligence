/**
 * Chapter two: the three-store operating model.
 *
 * WHAT THIS SECTION IS, AND WHAT IT REPLACED
 * ------------------------------------------
 * Six consecutive home-page sections used to describe the same three rooftops:
 * `GroupIntroduction`, `OperatingModels`, `GroupInventory`, `StoreCards`,
 * `InventoryStrategy` and `StoreComparison`. Between them they met Granite
 * Chevrolet five times in five different card layouts across roughly four
 * thousand pixels, and a reader had touched nothing by the end of it.
 *
 * This is all six, as one chapter with three states:
 *
 *   1  the tab set        one store at a time, read properly
 *   2  the contrast       allocation versus acquisition, in two columns
 *   3  the comparison     the same eight columns for all three, plus the mix
 *   4  the boundary       what a listing snapshot is evidence of, and what it is not
 *
 * The tab set is where the operating models now live, because "these are three
 * different businesses" is an argument a reader has to make one store at a time.
 * The comparison table stays a table, because simultaneous comparison across
 * eight columns is the one job a table does better than a selection.
 *
 * EVERY FIGURE IS DERIVED
 * -----------------------
 * Nothing here authors a number. Counts, ranges and medians come from
 * `src/generated/`, written at build time from the sanitized workbooks, and
 * `tests/unit/inventory.test.ts` asserts no component in `src/` writes one.
 *
 * A server component wrapping one client island. The tab set holds the
 * selection; the table, the charts and the disclosure cost no JavaScript.
 */
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { StoreStoryTabs } from '@/components/media/store-story-tabs'
import { Reveal } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
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
import { storeStoryPanels } from '@/lib/product-preview'
import { INVENTORY_DATA_STATEMENT, ROUTES } from '@/lib/site'
import { cx, formatCount, formatDate } from '@/lib/utils'

const franchiseStores = dealerships.filter((dealership) => dealership.isFranchise)
const independentStores = dealerships.filter((dealership) => !dealership.isFranchise)

const HEAD = 'px-3 py-3 text-xs font-semibold whitespace-nowrap text-ink-muted'
const CELL = 'px-3 py-3 whitespace-nowrap'

/**
 * The three properties that make a group total meaningful across stores this
 * different. One line each: the long form is `/governance`.
 */
const CONFORMANCE: readonly { readonly title: string; readonly detail: string }[] = [
  {
    title: 'One definition, conformed across stores',
    detail:
      'A retail unit means the same thing at all three rooftops, so a group total is a sum rather than a negotiation.',
  },
  {
    title: 'Store context travels with the number',
    detail:
      'Store type and franchise brand are attributes of the dimension, so a comparison that would be meaningless across an independent and a franchise store is blocked at the model rather than caught in review.',
  },
  {
    title: 'A group total that can be taken apart',
    detail:
      'Every group figure on this site decomposes to the three store figures that produce it, and the generator refuses to write an artefact whose store totals do not reconcile.',
  },
]

export function StoreStory() {
  const summary = inventorySummary

  return (
    <Section id="stores" tone="panel" className="scroll-mt-24">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The business being modelled"
          title="One group, three businesses"
          lede={dealershipGroup.introduction}
        />

        <Text size="body" tone="muted" className="mt-6 max-w-prose">
          {dealershipGroup.operatingModel}
        </Text>

        <StoreStoryTabs panels={storeStoryPanels} className="mt-10" />

        {/* 2. The contrast the tab set demonstrates one store at a time, stated
               once as the general case. This is the sentence a group-level
               report has to respect, and it is the reason the store dimension
               exists. */}
        <Reveal className="mt-16 flex flex-col gap-6 border-t border-line pt-12">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-2xs">Inventory strategy</span>
            <Heading level={3} size="h4">
              Allocation is not acquisition
            </Heading>
            <Text size="body" tone="muted" className="max-w-prose">
              The single most useful thing a group-level report can know about these three
              stores is which of them chooses what it stocks.
            </Text>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <Heading level={4} size="h6">
                {`Franchise: ${franchiseStores.map((store) => store.shortName).join(' and ')}`}
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                A franchise rooftop sells a manufacturer&apos;s new vehicles under a sales
                and service agreement, and what arrives is largely decided by allocation:
                the store orders into a build schedule it does not control. Its levers are
                pricing, merchandising and turn.
              </Text>
              <Text size="sm" tone="muted" className="max-w-prose">
                {`In this snapshot the two franchise stores hold ${formatCount(summary.newRecords)} of the group's new listings and all of them. A group report that compares new-vehicle days supply across all three stores is comparing two stores and an empty set.`}
              </Text>
            </Card>

            <Card className="flex flex-col gap-3">
              <Heading level={4} size="h6">
                {`Independent: ${independentStores.map((store) => store.shortName).join(' and ')}`}
              </Heading>
              <Text size="sm" tone="secondary" className="max-w-prose">
                An independent store has no franchise agreement, no allocation and no new
                vehicle order bank. Every unit it lists was bought: at auction, from a
                trade, from a lease return, or from another dealer. Its inventory is a
                record of buying decisions in a way a franchise store&apos;s is not.
              </Text>
              <Text size="sm" tone="muted" className="max-w-prose">
                {`It shows in the data. The independent store carries ${formatCount(independentStores[0]?.inventory.makeCount ?? 0)} makes against the Chevrolet store's ${formatCount(dealerships[0]?.inventory.makeCount ?? 0)}, and the widest model-year spread in the group. Neither is a performance result. Both are structural facts a report has to respect.`}
              </Text>
            </Card>
          </div>
        </Reveal>

        {/* 3. The comparison. A table, because eight columns across three stores
               is what a table is for, and a selection would hide two thirds of
               the point. */}
        <div className="mt-16 flex flex-col gap-3 border-t border-line pt-12">
          <span className="eyebrow text-2xs">Store comparison</span>
          <Heading level={3} size="h4">
            The same eight columns, for all three
          </Heading>
          <Text size="body" tone="muted" className="max-w-prose">
            {`Every cell is computed from that store's own workbook. Where a store's source did not expose a value, the cell says so rather than showing a figure derived from a different population. Snapshot ${formatDate(summary.latestSnapshotDate)}.`}
          </Text>
        </div>

        {/* The scroll container is focusable and named. A container that scrolls
            but cannot receive focus is unreachable by keyboard, because the cells
            inside it are text rather than controls. */}
        <div
          role="region"
          aria-label="Granite Auto Group store comparison"
          tabIndex={0}
          className="mt-6 overflow-x-auto rounded-xl border border-line bg-canvas"
        >
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
                    {/* The store cell carries the FULL name, and it is a link.
                        Two reasons, and the second is the one that made it
                        change: a link labelled "Granite Chevrolet" is ambiguous
                        out of context, and the tab set above shows one store at
                        a time, so without this the home page would offer a route
                        to whichever rooftop happened to be selected. All three
                        are always reachable from here. */}
                    <th
                      scope="row"
                      className="px-3 py-3 pl-4 align-top font-medium sm:pl-5"
                    >
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={cx(
                            'mt-1 inline-block h-4 w-1 shrink-0 rounded-pill',
                            accent.mark
                          )}
                        />
                        <span className="flex flex-col gap-0.5">
                          <Link
                            href={store.href}
                            className="text-ink underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                          >
                            {store.name}
                          </Link>
                          <span className="text-xs text-ink-muted">
                            {`${store.city}, ${store.stateCode}`}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-3 align-top text-ink-muted">
                      <span className="flex flex-col gap-0.5">
                        <span>{store.storeTypeLabel}</span>
                        {store.franchiseBrand === null ? null : (
                          <span className="text-xs text-ink-faint">
                            {store.franchiseBrand}
                          </span>
                        )}
                      </span>
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
                    <td className={cx(CELL, 'numeric pr-4 text-right text-ink sm:pr-5')}>
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
          {`Group price range across the ${formatCount(summary.pricedRecords)} priced listings: ${formatRange(summary.priceRange, formatPrice) ?? 'not exposed'}. A median is stated only where the source priced enough of that store to make one meaningful, and each store page names its own denominator.`}
        </Text>

        {/* The provenance of every figure above, at the point the figures stop.
            The three workbooks are linked rather than described: a reader who
            wants to check a median can open the file the median came from. */}
        <div className="mt-8 flex flex-col gap-2 border-t border-line-subtle pt-6">
          <span className="eyebrow text-2xs">Group inventory snapshot</span>
          <Text size="sm" tone="muted" className="max-w-prose">
            {`Derived at build time from ${formatCount(summary.generatedFrom.length)} sanitized workbooks committed to this repository, covering ${formatCount(summary.totalRecords)} listings across ${formatCount(summary.dealershipCount)} stores. Snapshot date ${formatDate(summary.latestSnapshotDate)}. Median advertised price is computed over priced listings only, never over the whole set.`}
          </Text>
          <ul className="mt-1 flex flex-col gap-0.5">
            {summary.generatedFrom.map((path) => (
              <li key={path}>
                <SourceLink path={path} field="sanitized inventory snapshot" />
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-2">
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

        {/* 4. The boundary. Stated where the evidence was just shown, rather
               than in a footer nobody reaches. */}
        <Reveal className="mt-16 grid grid-cols-1 gap-8 border-t border-line pt-12 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <span className="eyebrow text-2xs">Governed group reporting</span>
            <Heading level={3} size="h4">
              One number per question, and a store dimension under it
            </Heading>
            <ul className="flex flex-col gap-4">
              {CONFORMANCE.map((item) => (
                <li key={item.title} className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-ink">{item.title}</span>
                  <Text size="sm" tone="muted" className="max-w-prose">
                    {item.detail}
                  </Text>
                </li>
              ))}
            </ul>
          </div>

          <Card tone="pending" className="flex flex-col gap-3 lg:col-span-5">
            <Heading level={4} size="h6">
              What this is evidence of, and what it is not
            </Heading>
            <Text size="sm" tone="secondary">
              {INVENTORY_DATA_STATEMENT}
            </Text>
            <Text size="sm" tone="secondary">
              An inventory summary is descriptive evidence. It describes a set of listings
              that existed at a capture date. It is not an analytical finding about how
              this group performs, and publishing it does not open Gate 2 or complete the
              analytical case study, both of which remain closed for the reasons the
              status page gives.
            </Text>
            <div className="mt-1 flex flex-wrap gap-3">
              <LinkButton
                href={ROUTES.governance.href}
                variant="secondary"
                size="sm"
                iconAfter={<ArrowRight strokeWidth={2} />}
              >
                How this is governed
              </LinkButton>
              <LinkButton href={ROUTES.status.href} variant="ghost" size="sm">
                What is finished
              </LinkButton>
            </div>
          </Card>
        </Reveal>
      </Container>
    </Section>
  )
}
