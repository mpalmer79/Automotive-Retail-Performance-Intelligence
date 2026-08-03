/**
 * The Granite Auto Group overview, as six composable sections.
 *
 * WHY THESE ARE COMPONENTS AND NOT A PAGE
 * ---------------------------------------
 * This content used to be the body of `/dealerships`. It is now the opening of
 * the home page, because it is where the ARPI story actually starts: a visitor
 * needs to know that this group runs three different businesses before any
 * argument about governed definitions means anything to them.
 *
 * `/dealerships` is a permanent redirect to `/` rather than a second page
 * rendering the same thing. That is the whole reason these are sections rather
 * than a page: there is exactly one implementation of the group overview, one
 * place to change it, and no possibility of two copies drifting apart. Importing
 * one Next.js page component into another would have achieved the reuse and none
 * of the routing correctness.
 *
 * WHAT IS HERE, IN NARRATIVE ORDER
 * --------------------------------
 *   1  GroupIntroduction    who this group is, and why one report is hard
 *   2  OperatingModels      the three models, compactly, before the detail
 *   3  GroupInventory       the derived snapshot across all three stores
 *   4  StoreCards           one card per store, each linking to its own page
 *   5  InventoryStrategy    allocation versus acquisition, at length
 *   6  StoreComparison      the same columns for all three, plus distribution
 *   7  GovernedGroupView    what ARPI does about it
 *
 * EVERY FIGURE IS DERIVED
 * -----------------------
 * Nothing here authors a number. The counts, ranges and medians come from
 * `src/generated/`, written at build time from the sanitized workbooks, and
 * `tests/unit/inventory.test.ts` asserts no component in `src/` writes one.
 */
import { ArrowRight } from 'lucide-react'

import { DealershipCard } from '@/components/dealerships/dealership-card'
import { GroupSnapshot } from '@/components/dealerships/group-snapshot'
import { Reveal, RevealGroup, RevealItem } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
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
import { INVENTORY_DATA_STATEMENT, ROUTES } from '@/lib/site'
import { cx, formatCount, formatDate } from '@/lib/utils'

const franchiseStores = dealerships.filter((dealership) => dealership.isFranchise)
const independentStores = dealerships.filter((dealership) => !dealership.isFranchise)

/* -------------------------------------------------------------------------- */
/* 1. Who this group is                                                        */
/* -------------------------------------------------------------------------- */

export function GroupIntroduction() {
  return (
    <Section id="granite-auto-group" tone="canvas">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The business being modelled"
          title="One group, three businesses"
          lede={dealershipGroup.introduction}
        />
        <Reveal className="mt-8">
          <Text size="body" tone="secondary" className="max-w-prose">
            {dealershipGroup.operatingModel}
          </Text>
        </Reveal>
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 2. The three models, compactly                                              */
/* -------------------------------------------------------------------------- */

/**
 * The three operating models, one line each.
 *
 * Deliberately ahead of the store cards and ahead of the snapshot. A reader who
 * meets the numbers first has no frame for why the independent store's model-year
 * spread is three times the Chevrolet store's, and will read it as a difference
 * in performance rather than a difference in business.
 */
export function OperatingModels() {
  return (
    <Section id="operating-models" tone="panel" rhythm="tight">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="Three operating models"
          title="What decides the inventory is not the same at all three"
          lede="Two of these stores receive much of what they sell. The third buys every unit of it. That single difference is the reason a group total needs a store dimension under it."
        />

        <RevealGroup className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {dealerships.map((store, index) => {
            const accent = accentPresentation(store.accent)
            return (
              <RevealItem key={store.id} index={index}>
                <div className="flex h-full flex-col gap-3 border-t-2 pt-4 [border-image:none]">
                  <span
                    aria-hidden="true"
                    className={cx('block h-1 w-10 rounded-pill', accent.mark)}
                  />
                  <Heading level={3} size="h6">
                    {store.shortName}
                  </Heading>
                  <p className="text-sm font-medium text-ink-secondary">
                    {store.tagline}
                  </p>
                  <Text size="sm" tone="muted">
                    {store.inventoryStrategy}
                  </Text>
                </div>
              </RevealItem>
            )
          })}
        </RevealGroup>
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 3. The derived snapshot                                                     */
/* -------------------------------------------------------------------------- */

export function GroupInventory() {
  const summary = inventorySummary
  return (
    <Section id="group-inventory" tone="canvas" rhythm="tight">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="Group inventory snapshot"
          title="What the three stores hold, together"
          lede={`Derived at build time from the sanitized reference workbooks committed to this repository. Snapshot ${formatDate(summary.latestSnapshotDate)}.`}
        />
        <GroupSnapshot className="mt-8" />
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 4. The stores                                                               */
/* -------------------------------------------------------------------------- */

export function StoreCards() {
  return (
    <Section id="stores" tone="panel" rhythm="tight">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The stores"
          title="Two franchise rooftops and one independent"
          lede="Each store's own page carries its full inventory profile: model-year range, price range, mileage summary, top makes and models, and the complete listing table."
        />

        <RevealGroup className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {dealerships.map((dealership, index) => (
            <RevealItem key={dealership.id} index={index} className="flex">
              <DealershipCard dealership={dealership} className="w-full" />
            </RevealItem>
          ))}
        </RevealGroup>
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 5. Allocation versus acquisition                                            */
/* -------------------------------------------------------------------------- */

export function InventoryStrategy() {
  const summary = inventorySummary
  return (
    <Section id="inventory-strategy" tone="evidence" rhythm="tight">
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
              {`Franchise: ${franchiseStores.map((store) => store.shortName).join(' and ')}`}
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              A franchise rooftop sells a manufacturer&apos;s new vehicles under a sales
              and service agreement. What arrives on the lot is largely decided by
              allocation: the store orders into a build schedule it does not control, and
              the mix it receives reflects national production as much as local demand.
              The levers it has are pricing, merchandising and turn.
            </Text>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {`In this snapshot the two franchise stores hold ` +
                `${formatCount(summary.newRecords)} of the group's new listings and all of them. ` +
                'A group report that compares new-vehicle days supply across all three ' +
                'stores is comparing two stores and an empty set.'}
            </Text>
            <ul className="flex flex-col gap-3 border-t border-line-subtle pt-4">
              {franchiseStores.map((store) => (
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
              {`Independent: ${independentStores.map((store) => store.shortName).join(' and ')}`}
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              An independent store has no franchise agreement, no allocation and no new
              vehicle order bank. Every unit it lists was bought: at auction, from a
              trade, from a lease return, or from another dealer. Its inventory is
              therefore a record of buying decisions in a way a franchise store&apos;s is
              not.
            </Text>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {`That shows up directly in the data. The independent store carries ` +
                `${formatCount(independentStores[0]?.inventory.makeCount ?? 0)} makes against the ` +
                `Chevrolet store's ${formatCount(dealerships[0]?.inventory.makeCount ?? 0)}, ` +
                'and the widest model-year spread in the group. Neither of those is a ' +
                'performance result. Both are structural facts a report has to respect.'}
            </Text>
            <ul className="flex flex-col gap-3 border-t border-line-subtle pt-4">
              {independentStores.map((store) => (
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
  )
}

/* -------------------------------------------------------------------------- */
/* 6. The comparison, and the distribution behind it                           */
/* -------------------------------------------------------------------------- */

const HEAD = 'px-3 py-3 text-xs font-semibold whitespace-nowrap text-ink-muted'
const CELL = 'px-3 py-3 whitespace-nowrap'

export function StoreComparison() {
  const summary = inventorySummary

  return (
    <Section id="store-comparison" tone="canvas" rhythm="tight">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="Store comparison"
          title="The same eight columns, for all three"
          lede="Every cell is computed from the store's own workbook. Where a store's source did not expose a value, the cell says so rather than showing a figure derived from a different population."
        />

        {/* The scroll container is focusable and named. A container that scrolls
            but cannot receive focus is unreachable by keyboard, because the cells
            inside it are text rather than controls. */}
        <div
          role="region"
          aria-label="Granite Auto Group store comparison"
          tabIndex={0}
          className="mt-8 overflow-x-auto rounded-xl border border-line bg-canvas"
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
                    <th scope="row" className={cx(CELL, 'pl-4 font-medium sm:pl-5')}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cx('inline-block h-4 w-1 rounded-pill', accent.mark)}
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
          {`Group price range across the ${formatCount(summary.pricedRecords)} priced listings: ` +
            `${formatRange(summary.priceRange, formatPrice) ?? 'not exposed'}. ` +
            'A median is stated only where the source priced enough of that store to make ' +
            'one meaningful, and each store page names its own denominator.'}
        </Text>

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
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 7. What ARPI does about it                                                  */
/* -------------------------------------------------------------------------- */

export function GovernedGroupView() {
  return (
    <Section id="governed-group" tone="panel" rhythm="tight">
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
              is a sum rather than a negotiation. The store dimension is conformed, which
              is what lets the same measure resolve at group level and at store level
              without a second definition.
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
            What this is evidence of, and what it is not
          </Heading>
          <Text size="sm" tone="secondary" className="max-w-prose">
            {INVENTORY_DATA_STATEMENT}
          </Text>
          <Text size="sm" tone="secondary" className="max-w-prose">
            An inventory summary is descriptive evidence. It describes a set of listings
            that existed at a capture date. It is not an analytical finding about how this
            group performs, and publishing it does not open Gate 2 or complete the
            analytical case study, both of which remain closed for the reasons the status
            page gives.
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
  )
}
