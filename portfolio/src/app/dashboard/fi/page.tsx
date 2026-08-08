import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import {
  AdjustmentSection,
  BackGrossComposition,
  CategoryEconomics,
  ManagerComparison,
  PenetrationTable,
  ProductionSummary,
  StructureMix,
} from '@/components/dashboard/fi-sections'
import {
  FilterNotice,
  NoMatchingRecords,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Badge } from '@/components/ui/badge'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Text } from '@/components/ui/typography'
import {
  calendarMonths,
  dashboardConditionGroups,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import {
  activeFilterChips,
  FI_SUPPORT,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import {
  backGrossIdentityHolds,
  backGrossResidual,
  buildFi,
  FI_CATEGORY_ORDER,
  fiCategorySlug,
} from '@/lib/dashboard/fi'
import { formatIsoDate, formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardFi')

const ROUTE = ROUTES.dashboardFi.href

/**
 * F&I performance — the finance director's surface.
 *
 * WHAT THIS PAGE IS FOR
 * ---------------------
 * A finance director arrives holding one number: back-end gross. This page answers what
 * it is made of. Reserve is separated from product gross, the product mix behind it is
 * shown, penetration is shown against the population each category was ELIGIBLE for, the
 * adjustments that took gross back are shown on their own posting dates, and the managers
 * are compared with the context their figures inherit.
 *
 * SECTION ORDER IS THE DIAGNOSTIC ORDER
 * -------------------------------------
 * Totals, then what the total is composed of, then the structure that decides what could
 * be sold, then what was sold against what could have been, then what each category
 * earned, then what came back, then who wrote it. A reader who has seen the composition
 * and the eligible denominators reads the manager table as context rather than as a
 * scorecard — which is the only way it may be read.
 *
 * THREE DATE BASES, LABELLED ON EVERY FIGURE
 * ------------------------------------------
 * Deal date is what the office produced. As-of is what the store retained. Adjustment
 * period groups events by the day they posted. The page never shows two of them in one
 * number without saying so, and the mixed-basis rates carry the export's own disclosure.
 *
 * NO BENCHMARK, NO RECOMMENDATION, NO RANKING
 * -------------------------------------------
 * ARPI publishes no F&I benchmark, so nothing here is captioned good, weak, healthy or
 * on-target. Nothing suggests a product to sell or a customer to sell it to. The manager
 * table is ordered by store and identifier and is not a leaderboard.
 *
 * A SERVER COMPONENT. One client island, the filter bar, receives option lists and no
 * data. With scripting disabled every figure, every table and every disclosure is still
 * in the document, and the filter form degrades to the native GET submission it already is.
 */
export default async function FiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources: dashboardLeadSources.map((source) => source.code),
  })
  const view = buildFi(parsed.filters)
  const chips = activeFilterChips(parsed.filters, FI_SUPPORT)

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)
  const comparisonLabel = view.periodContext.comparison?.label ?? null
  const identityHolds = backGrossIdentityHolds(view.production)
  const residual = backGrossResidual(view.production)

  return (
    <Canvas>
      <PageHeader
        eyebrow="Dealer Operations Command Center"
        title="What the finance office produced, and what the store kept"
        crumbLabel="F&I"
        lede={`Finance reserve against product gross for ${view.scope.label.toLowerCase()}, over ${view.periodContext.period.label}. Penetration is shown against the deals each category was eligible for, never against all retail deliveries, and every figure names the date basis it is on.`}
        dashboardNav
        trustScope="dashboard"
        meta={
          <>
            <Badge tone="neutral" mono>
              Dataset v{exportState.datasetVersion} · {exportState.profile}
            </Badge>
            <Badge tone="neutral" mono>
              As of {formatIsoDate(view.asOfDate)}
            </Badge>
            <Badge tone={powerBi.validated ? 'verified' : 'pending'}>
              {powerBi.validated
                ? 'Real-engine validation recorded'
                : 'Real-engine validation pending'}
            </Badge>
          </>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* Context and controls                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="none" tone="evidence" className="py-section-tight" id="context">
        <Container width="full">
          <div className="flex flex-col gap-6">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />

            <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Period</dt>
                <dd className="text-sm text-ink">{view.periodContext.period.label}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Comparison
                </dt>
                <dd className="text-sm text-ink">
                  {comparisonLabel ?? view.periodContext.comparisonLabel}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Scope</dt>
                <dd className="text-sm text-ink">{view.scope.label}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Data as of
                </dt>
                <dd className="text-sm text-ink">{formatIsoDate(view.asOfDate)}</dd>
              </div>
            </dl>

            {chips.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <li
                    key={chip.key}
                    className="inline-flex min-h-6 items-center gap-1.5 rounded-pill border border-line-subtle bg-surface px-2.5 py-1 text-xs"
                  >
                    <span className="text-ink-muted">{chip.label}</span>{' '}
                    <span className="text-ink">{chip.value}</span>
                    {chip.support === 'applied' ? null : (
                      <span className="text-ink-faint">
                        {chip.support === 'partial'
                          ? '· partly applied'
                          : '· not applied here'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            <FilterBar
              action={ROUTE}
              filters={parsed.filters}
              periodOptions={periodOptions()}
              stores={storeOptions()}
              conditions={conditionOptions()}
              leadSources={leadSourceOptions()}
              conditionHint="Not applied here. Vehicle condition already decides which categories are eligible, and the rule applies it inside each denominator."
              leadSourceHint="Not applied here. The F&I datasets carry no lead-source attribute."
            />

            {/* The synthetic disclosure, once and prominently, rather than repeated
                on every row. Detail is in the methodology section at the foot. */}
            <div className="rounded border border-line-subtle bg-surface px-4 py-3">
              <Text size="sm" tone="muted">
                <strong className="font-medium text-ink">
                  Every lender, product and provider on this page is invented.
                </strong>{' '}
                Prices, costs and eligibility rules are synthetic analytical rules for a
                fictional dealer group. No figure here is an industry benchmark, and ARPI
                models no APR, payment, buy rate, sell rate, rate spread, credit score or
                lending decision of any kind.
              </Text>
            </div>

            {view.notices.map((notice) => (
              <Text key={notice} size="xs" tone="faint">
                {notice}
              </Text>
            ))}
          </div>
        </Container>
      </Section>

      {view.hasRows ? (
        <>
          {/* -------------------------------------------------------------- */}
          {/* 1. Production                                                   */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="production">
            <Container width="full">
              <SectionHeader
                eyebrow="Production"
                title="What the finance office produced"
                lede="Eight governed figures on two date bases. The deal-date figures are what was produced and are never rewritten by a later event; the as-of figure is what remained after every adjustment posted on or before the dataset's own as-of date."
              />
              <div className="pt-6">
                <ProductionSummary view={view} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 2. Composition                                                  */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="composition">
            <Container width="content">
              <SectionHeader
                eyebrow="Composition"
                title="Reserve against product, to the cent"
                lede="Back-end gross was a single number before the F&I model existed. It is now explained: finance reserve plus original product gross accounts for all of it, with other F&I income of exactly $0.00 and no balancing figure."
              />
              <div className="pt-6">
                <BackGrossComposition
                  view={view}
                  identityHolds={identityHolds}
                  residual={residual}
                />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 3. Structure                                                    */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="structure">
            <Container width="content">
              <SectionHeader
                eyebrow="Deal structure"
                title="How the deliveries were funded"
                lede="Structure decides what could be sold before anything about a customer does: GAP needs financing, Lease Wear Protection needs a lease, and a cash delivery can earn no finance reserve at all. It is the context every penetration figure below sits in."
              />
              <div className="pt-6">
                <StructureMix structures={view.structures} view={view} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 4. Penetration                                                  */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="penetration">
            <Container width="full">
              <SectionHeader
                eyebrow="Penetration"
                title="What was sold, against what could have been"
                lede="Each category is measured against the deals it was eligible for — not against all retail deliveries. GAP is over financed deliveries, Lease Wear Protection over leases, Prepaid Maintenance over new and certified units. Both sides of every ratio are shown, so the denominator is never something a reader has to take on trust."
              />
              <div className="pt-6">
                <PenetrationTable view={view} comparisonLabel={comparisonLabel} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 5. Category economics                                           */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="economics">
            <Container width="full">
              <SectionHeader
                eyebrow="Category economics"
                title="What each category earned"
                lede="Retail, cost and gross by category on the deal-date basis, with what remained after adjustments. Attachment and economics are different questions: a category can be attached often and earn little, or rarely and earn a great deal."
              />
              <div className="pt-6">
                <CategoryEconomics view={view} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 6. Adjustments                                                  */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="adjustments">
            <Container width="full">
              <SectionHeader
                eyebrow="Adjustments"
                title="What came back, and when it posted"
                lede="Cancellations, chargebacks, reinstatements and approved adjustments, grouped by the date each posted. A chargeback in this period against a contract written earlier belongs to this period; the earlier contract keeps the gross it was written with."
              />
              <div className="pt-6">
                <AdjustmentSection view={view} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 7. Managers                                                     */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" id="managers">
            <Container width="full">
              <SectionHeader
                eyebrow="Finance managers"
                title="The same measures, by desk, with their context"
                lede="Ordered by store and synthetic identifier. These are not rankings: a finance manager's figures inherit the store's vehicle mix, its finance-structure mix and its product-eligibility mix, and below the governed minimum-deal floor a ratio is withheld rather than shown small."
              />
              <div className="pt-6">
                <ManagerComparison view={view} />
              </div>
            </Container>
          </Section>

          {/* -------------------------------------------------------------- */}
          {/* 8. Methodology                                                  */}
          {/* -------------------------------------------------------------- */}
          <Section rhythm="default" tone="evidence" id="methodology">
            <Container width="content">
              <SectionHeader
                eyebrow="Methodology"
                title="How to read this page, and what it cannot tell you"
              />
              <div className="flex flex-col gap-4 pt-6">
                <Disclosure label="The three date bases, and why they are not interchangeable">
                  <div className="flex flex-col gap-2">
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">Deal date.</strong> What
                      the finance office produced, attributed to the day the deal was
                      struck. Reserve, original product gross and back-end gross are on
                      this basis and are never rewritten when a later event posts.
                    </Text>
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">
                        As of {view.asOfDate}.
                      </strong>{' '}
                      What the store retained: original gross less every adjustment posted
                      on or before that date. The as-of date is the last day anything
                      measured happened in the export, never today&rsquo;s date.
                    </Text>
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">Adjustment period.</strong>{' '}
                      Events grouped by the day they posted. The adjustment section is on
                      this basis alone.
                    </Text>
                  </div>
                </Disclosure>

                <Disclosure label="Why the period proxy rates are not loss rates">
                  <Text size="sm" tone="muted">
                    A chargeback rate on this page divides an amount posted in the
                    selected period by the original gross of contracts <em>sold</em> in
                    the selected period. Those are two different populations: the
                    contracts charged back in a month are mostly not the ones written in
                    it. The result is a period proxy, useful for watching the direction of
                    travel, and it is not a contract-cohort loss rate. Computing a true
                    cohort rate would need the full life of each cohort, and the reporting
                    window truncates the tail of the adjustment lag distribution — which
                    is also why the most recent sale months carry structurally fewer
                    adjustments than the earliest ones.
                  </Text>
                </Disclosure>

                <Disclosure label="Why each category has its own denominator">
                  <Text size="sm" tone="muted">
                    Penetration is only meaningful beside the population it was computed
                    over. A GAP rate over all retail deliveries would count cash buyers
                    who have no loan for GAP to cover, and would make every store with a
                    heavier cash mix look worse for a reason that has nothing to do with
                    its finance office. Each category is therefore measured against the
                    deals eligible for it under one governed rule, the rule identifier is
                    on every row, and both sides of the ratio are published. A category
                    with no eligible deals shows &ldquo;No eligible deals&rdquo; rather
                    than 0%, because a rate with no denominator is undefined and not zero.
                  </Text>
                </Disclosure>

                <Disclosure label="What this page will not tell you">
                  <div className="flex flex-col gap-2">
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">
                        There is no benchmark and no target.
                      </strong>{' '}
                      ARPI publishes no industry F&amp;I figures, so nothing here is good,
                      bad, healthy or standard. A penetration of 40.7% is stated as 40.7%.
                    </Text>
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">
                        There is no recommendation.
                      </strong>{' '}
                      Nothing here suggests a product to sell, a price to charge, a
                      customer to approach or a lender to use. ARPI approves nothing,
                      declines nothing and tiers nobody.
                    </Text>
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">
                        There is no menu and no offer history.
                      </strong>{' '}
                      The model records what was sold, not what was offered and declined,
                      so no closing rate is computable from it.
                    </Text>
                    <Text size="sm" tone="muted">
                      <strong className="font-medium text-ink">
                        Manager rows are comparisons, not evaluations.
                      </strong>{' '}
                      They carry no ranking and no label, and below{' '}
                      {view.periodContext.period.label === '' ? '' : ''}the governed
                      minimum-deal floor a ratio is withheld: a one-deal penetration of
                      100% is a number that will be repeated and cannot be defended.
                    </Text>
                  </div>
                </Disclosure>
              </div>
            </Container>
          </Section>
        </>
      ) : (
        <Section rhythm="default">
          <Container width="content">
            <NoMatchingRecords
              filterSummary={`${view.periodContext.period.label}, ${view.scope.label}.`}
              resetHref={ROUTE}
            />
          </Container>
        </Section>
      )}
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                              */
/* -------------------------------------------------------------------------- */
// Built from the export's own enumerations and the governed category vocabulary, never
// hard-coded: an option the data cannot produce is an invitation to a view that renders
// nothing.

function periodOptions(): readonly FilterOption[] {
  return calendarMonths.map((month) => ({ value: month, label: formatIsoMonth(month) }))
}

function storeOptions(): readonly FilterOption[] {
  return dashboardStores.map((store) => ({ value: store.id, label: store.shortName }))
}

function conditionOptions(): readonly FilterOption[] {
  return dashboardConditionGroups.map((group) => ({ value: group, label: group }))
}

function leadSourceOptions(): readonly FilterOption[] {
  return dashboardLeadSources.map((source) => ({
    value: source.code,
    label: source.name,
  }))
}

/**
 * The governed product categories as filter options.
 *
 * Exported so the tests can assert the slug vocabulary matches the categories the export
 * enumerates, rather than a second hard-coded list drifting beside it.
 */
export function productCategoryOptions(): readonly FilterOption[] {
  return FI_CATEGORY_ORDER.map((category) => ({
    value: fiCategorySlug(category),
    label: category,
  }))
}
