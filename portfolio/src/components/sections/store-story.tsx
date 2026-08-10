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
 * This is all six, as one chapter with four states:
 *
 *   1  the tab set        one store at a time, read properly
 *   2  the contrast       allocation versus acquisition, in two columns
 *   3  the comparison     the same eight columns for all three, plus the mix
 *   4  the conformance    what a group total has to be true of
 *
 * WHAT THE WORD-COUNT PASS TOOK OUT
 * ---------------------------------
 * 375 words of visible prose became 170, and every sentence removed is still
 * published on the route whose subject it is. The generated group introduction,
 * the operating-model paragraph under the tabs, the independent store's
 * acquisition model, the sanitized-reference-data statement and the
 * "descriptive evidence" boundary all went; `/governance`,
 * `/dealerships/granite-pre-owned` and the hero's trust line carry them. The
 * tabs, the table, both charts and every derived figure stayed, because they are
 * what this chapter is for.
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
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { BarChart, StackedMixBar } from '@/components/visuals/inventory-charts'
import {
  accentPresentation,
  dealerships,
  formatPrice,
  formatRange,
  inventorySummary,
} from '@/lib/inventory'
import { storeStoryPanels } from '@/lib/product-preview'
import { cx, formatCount, formatDate } from '@/lib/utils'
import { technicalHref } from '@/lib/technical'

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
        {/* ONE PARAGRAPH, THEN THE ARTEFACT.
            The lede used to be the generated group introduction, which spent
            forty-seven words establishing that the group is fictional. That
            disclosure is the trust line in the hero and it is `/governance` at
            length; repeating it here bought nothing and cost the reader the
            first screen of the section that carries the strongest material on
            the site. The paragraph below states only what the tabs are about.
            The operating-model paragraph that used to sit under the tabs is
            gone with it: it said the same thing a second time, one disclosure
            lower. */}
        <SectionHeader
          layout="wide"
          eyebrow="The business being modelled"
          title="One group, three businesses"
          lede="Three rooftops in Southern New Hampshire, reported through one governed layer. Two carry a manufacturer allocation; the third buys every unit it lists. Those differences are why a group total needs a store dimension under it."
        />

        <StoreStoryTabs panels={storeStoryPanels} className="mt-10" />

        {/* 2. The contrast the tab set demonstrates one store at a time, stated
               once as the general case. This is the sentence a group-level
               report has to respect, and it is the reason the store dimension
               exists. */}
        {/* The contrast, stated once as the general case.
            The finding is one sentence and it is visible. The four paragraphs
            that argue it - what a franchise agreement is, what an independent
            buyer does, and the two figures from this snapshot that show it -
            are supplemental, and they are behind a summary that names the
            question they answer. */}
        <Reveal className="mt-16 flex flex-col gap-5 border-t border-line pt-12">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-2xs">Inventory strategy</span>
            <Heading level={3} size="h4">
              Allocation is not acquisition
            </Heading>
            <Text size="body" tone="muted" className="max-w-prose">
              The most useful thing a group report can know about these three stores is
              which of them chooses what it stocks. Two do not.
            </Text>
          </div>

          <Disclosure label="Why these stores cannot share one operating model">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card className="flex flex-col gap-3">
                <Heading level={4} size="h6">
                  {`Franchise: ${franchiseStores.map((store) => store.shortName).join(' and ')}`}
                </Heading>
                <Text size="sm" tone="secondary" className="max-w-prose">
                  A franchise rooftop sells a manufacturer&apos;s new vehicles under a
                  sales and service agreement, and what arrives is largely decided by
                  allocation: the store orders into a build schedule it does not control.
                  Its levers are pricing, merchandising and turn.
                </Text>
                <Text size="sm" tone="muted" className="max-w-prose">
                  {`In this snapshot the two franchise stores hold ${formatCount(summary.newRecords)} of the group's new listings and all of them. A group report that compares new-vehicle days supply across all three stores is comparing two stores and an empty set.`}
                </Text>
              </Card>

              {/* The independent store's operating model is stated on its own
                  page, which carries it as that store's positioning and its
                  inventory strategy. The paragraph that used to open this card
                  said the same thing in different words, so it is gone rather
                  than moved: `/dealerships/granite-pre-owned` already says the
                  store carries no franchise and buys every unit it sells. What
                  stays here is the part that page cannot make, which is the
                  comparison against the franchise rooftop beside it. */}
              <Card className="flex flex-col gap-3">
                <Heading level={4} size="h6">
                  {`Independent: ${independentStores.map((store) => store.shortName).join(' and ')}`}
                </Heading>
                <Text size="sm" tone="muted" className="max-w-prose">
                  {`It shows in the data. The independent store carries ${formatCount(independentStores[0]?.inventory.makeCount ?? 0)} makes against the Chevrolet store's ${formatCount(dealerships[0]?.inventory.makeCount ?? 0)}, and the widest model-year spread in the group. Neither is a performance result. Both are structural facts a report has to respect.`}
                </Text>
              </Card>
            </div>
          </Disclosure>
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
            {`Every cell is computed from that store's own workbook. Where the source exposed no value, the cell says so. Snapshot ${formatDate(summary.latestSnapshotDate)}.`}
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
          {`Group price range across the ${formatCount(summary.pricedRecords)} priced listings: ${formatRange(summary.priceRange, formatPrice) ?? 'not exposed'}.`}
        </Text>

        {/* The provenance of every figure above, at the point the figures stop.
            The three workbooks are linked rather than described: a reader who
            wants to check a median can open the file the median came from. */}
        <div className="mt-8 flex flex-col gap-2 border-t border-line-subtle pt-6">
          <span className="eyebrow text-2xs">Group inventory snapshot</span>
          <Text size="sm" tone="muted" className="max-w-prose">
            {`Derived at build time from ${formatCount(summary.generatedFrom.length)} sanitized workbooks committed to this repository: ${formatCount(summary.totalRecords)} listings across ${formatCount(summary.dealershipCount)} stores. Snapshot date ${formatDate(summary.latestSnapshotDate)}.`}
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

        {/* 4. What a group total has to be true of, stated where the figures
               stop.

            THE DISCLAIMER CARD THAT USED TO SIT BESIDE THIS IS GONE.
            It carried two paragraphs, 137 words between them: the sanitized
            reference-data statement and the "an inventory summary is descriptive
            evidence" boundary. Both are still published, in full, on
            `/governance`, which is the page whose subject they are, and the
            second is on `/inventory` as well. Nothing was softened and nothing
            was deleted from the site; the home page stopped being the third
            place to say it. The one-line form a stranger landing here needs is
            the trust line in the hero.

            The two destinations the card offered stay, as links. */}
        <Reveal className="mt-16 flex flex-col gap-5 border-t border-line pt-12">
          {/* The three properties stay visible as titles - they are the claim.
              Their explanations are behind one disclosure, because a reader who
              accepts "one definition, conformed across stores" does not need the
              paragraph and a reader who does not, does. */}
          <div className="flex flex-col gap-5">
            <span className="eyebrow text-2xs">Governed group reporting</span>
            <Heading level={3} size="h4">
              One number per question, and a store dimension under it
            </Heading>
            <ul className="flex flex-col gap-2">
              {CONFORMANCE.map((item) => (
                <li key={item.title} className="text-sm font-semibold text-ink">
                  {item.title}
                </li>
              ))}
            </ul>
            <Disclosure label="What each of those three actually guarantees">
              <dl className="flex flex-col gap-4">
                {CONFORMANCE.map((item) => (
                  <div key={item.title} className="flex flex-col gap-1">
                    <dt className="text-sm font-semibold text-ink">{item.title}</dt>
                    <dd>
                      <Text size="sm" tone="muted" className="max-w-prose">
                        {item.detail}
                      </Text>
                    </dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
          </div>

          <div className="flex flex-wrap gap-3">
            <LinkButton
              href={technicalHref('governance')}
              variant="secondary"
              size="sm"
              iconAfter={<ArrowRight strokeWidth={2} />}
            >
              How this is governed
            </LinkButton>
            <LinkButton href={technicalHref('status')} variant="ghost" size="sm">
              What is finished
            </LinkButton>
          </div>
        </Reveal>
      </Container>
    </Section>
  )
}
