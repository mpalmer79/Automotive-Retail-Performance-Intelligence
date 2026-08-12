import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  AdjustmentSection,
  BackGrossComposition,
  CategoryEconomics,
  ManagerComparison,
  ProductionSummary,
} from '@/components/dashboard/fi-sections'
import {
  AdjustmentBars,
  DateBasisKey,
  FiDisclosure,
  FiRail,
  PenetrationBars,
  StructureComposition,
} from '@/components/dashboard/fi-workspace'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import {
  FilterNotice,
  NoMatchingRecords,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Container, Section } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import {
  calendarMonths,
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
import { formatCountExact, formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { operatingHref, withRouteParam } from '@/lib/dashboard/navigation'
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

  /*
   * THE ONE DRILL-THROUGH OUT OF THIS ROUTE, AND WHERE ITS RULES COME FROM.
   *
   * `operatingHref` reduces the current filter context to what `/dashboard/employees`
   * declares it can act on — it drops `compare`, which Employees does not support, and
   * keeps period and store — and then the destination's own `role` parameter is
   * appended, exactly as `employees/page.tsx` appends it to its own links. `role` is
   * that route's parameter and not part of the thirteen-key global grammar, which is
   * why it is not something `operatingHref` knows about.
   */
  const managerHref = (code: string): string =>
    withRouteParam(
      operatingHref(ROUTES.dashboardEmployees.href, {
        ...parsed.filters,
        employee: code,
      }),
      'role',
      'finance'
    )

  return (
    <Canvas>
      {/* ------------------------------------------------------------------ */}
      {/* Context and controls                                                */}
      {/* ------------------------------------------------------------------ */}
      <OperatingPageHeader
        title="F&I"
        context={operatingContext([
          view.scope.label,
          view.periodContext.period.label,
          comparisonLabel === null
            ? view.periodContext.comparisonUnavailable === null
              ? view.periodContext.comparisonLabel
              : `${view.periodContext.comparisonLabel} unavailable`
            : `vs ${comparisonLabel}`,
        ])}
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            asOf={view.asOfDate}
          />
        }
        chips={chips}
        filterState={parsed.filters}
        route={ROUTE}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />
          </div>
        }
        filters={
          <FilterBar
            action={ROUTE}
            support={FI_SUPPORT}
            filters={parsed.filters}
            periodOptions={periodOptions()}
            stores={storeOptions()}
          />
        }
      >
        <div className="flex flex-col gap-4">
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
      </OperatingPageHeader>

      {view.hasRows ? (
        <Workspace>
          {/* -------------------------------------------------------------- */}
          {/* ROW 1 — what the finance office produced                        */}
          {/* -------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="production"
              title="Production"
              zone="finance"
              visual="kpi-rail"
              meta={view.periodContext.period.label}
            >
              <FiRail view={view} />
              {/*
                ALL EIGHT GOVERNED PRODUCTION FIGURES ARE STILL ON THIS PAGE. The rail ranks
                six of them; the other two — products per retail unit and gross per contract
                — and the gross amounts behind every rate are in the disclosure below, in
                full, with their catalogue identifiers and their date bases. `UX.2B` §12
                permits moving detail behind a disclosure and forbids removing a figure, and
                `<details>` removes nothing: the block is in the document, in the
                accessibility tree's reading order, in a browser text search and with
                scripting off.
              */}
              <FiDisclosure
                id="production-detail"
                summary="Every governed production figure, with its basis"
              >
                <ProductionSummary view={view} />
              </FiDisclosure>
            </Module>
          </GridRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 2 — what it was made of, and what could be sold into        */}
          {/* -------------------------------------------------------------- */}
          {/*
            `UX.2B` §49 asks F&I to show the rail and a gross-or-structure visual inside
            1440 × 900. Both are here, and the third module is the date-basis key: this
            route publishes figures on three different bases, and a reader who does not
            know which one a number is on can misread every figure below.
          */}
          <GridRow>
            <Module
              id="composition"
              title="Reserve against product"
              span={5}
              zone="finance"
              visual="back-composition"
            >
              <BackGrossComposition
                view={view}
                identityHolds={identityHolds}
                residual={residual}
              />
            </Module>
            <Module
              id="structure"
              title="Deal structure"
              span={4}
              zone="finance"
              visual="structure-mix"
            >
              <StructureComposition
                structures={view.structures}
                totalDisplay={formatCountExact(view.production.retailUnits)}
                periodLabel={view.periodContext.period.label}
              />
            </Module>
            <Module
              id="bases"
              title="Which date a figure is on"
              span={3}
              note="Three bases, never collapsed into one. Every figure on this page carries the one it is measured on."
            >
              <DateBasisKey
                asOfDate={view.asOfDate}
                periodLabel={view.periodContext.period.label}
              />
            </Module>
          </GridRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 3 — attachment, and what came back                          */}
          {/* -------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="penetration"
              title="Penetration"
              span={7}
              zone="finance"
              visual="penetration"
            >
              <PenetrationBars
                categories={view.categories}
                comparisonLabel={comparisonLabel}
              />
            </Module>
            <Module id="adjustments" title="Adjustments" span={5} visual="adjustments">
              {view.adjustmentTypes.length === 0 ? (
                <Text size="sm" tone="muted">
                  {`No adjustment posted in ${view.periodContext.period.label}. That is a genuine absence of events rather than a zero: cancellations and chargebacks are grouped by the date they posted, and the reporting window truncates the tail of the lag distribution, so the most recent sale months carry structurally fewer of them.`}
                </Text>
              ) : (
                <div className="flex flex-col gap-4">
                  <AdjustmentBars
                    rows={view.adjustmentTypes}
                    periodLabel={view.periodContext.period.label}
                  />
                  {/*
                    THE EXACT TABLE STAYS, BEHIND THE BARS RATHER THAN INSTEAD OF THEM. It
                    carries three things the bars do not: contracts affected, the mixed-basis
                    period proxy rate with the export's own disclosure sentence, and the net
                    effect on retained gross. None of those is a length, and none of them was
                    dropped.
                  */}
                  <FiDisclosure
                    id="adjustment-detail"
                    summary="Events, contracts affected and the period proxy rate"
                  >
                    <AdjustmentSection view={view} />
                  </FiDisclosure>
                </div>
              )}
            </Module>
          </GridRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 4 — the exact tables                                        */}
          {/* -------------------------------------------------------------- */}
          {/*
            NEITHER OF THESE MODULES CARRIES A NOTE, AND THAT IS THE PROSE REDUCTION. Both
            section bodies already state, visibly, the sentence a reader needs: category
            economics states that original gross is the deal-date figure and net is what
            remained as at the as-of date, and the manager comparison states that the rows
            are ordered by store and identifier and never by a metric. A module note
            restating either is the same caveat printed twice on one screen — measured at
            700 visible words on this route before `UX.2B`.

            THE TABLES STAY TABLES. `UX.2B` §60 is explicit: charts answer summary,
            comparison, distribution and composition questions, and a table answers
            "what exactly did each category earn". Category economics is nine columns of
            money over six categories, and the manager comparison is a contextual table
            that may never become a ranking. Neither is drawn.
          */}
          <GridRow>
            <Module id="economics" title="What each category earned" span={12}>
              <CategoryEconomics view={view} />
            </Module>
          </GridRow>

          <GridRow>
            <Module
              id="managers"
              title="The same measures, by desk, with their context"
              span={12}
            >
              <ManagerComparison view={view} managerHref={managerHref} />
            </Module>
          </GridRow>

          {/* -------------------------------------------------------------- */}
          {/* ROW 5 — how to read the page, on demand                         */}
          {/* -------------------------------------------------------------- */}
          <GridRow>
            <Module id="methodology" title="How to read this page" span={12}>
              <FiDisclosure
                id="date-bases"
                summary="The three date bases, and why they are not interchangeable"
              >
                <Text size="sm" tone="muted">
                  <strong className="font-medium text-ink">Deal date.</strong> What the
                  finance office produced, attributed to the day the deal was struck.
                  Reserve, original product gross and back-end gross are on this basis and
                  are never rewritten when a later event posts.
                </Text>
                <Text size="sm" tone="muted">
                  <strong className="font-medium text-ink">As of {view.asOfDate}.</strong>{' '}
                  What the store retained: original gross less every adjustment posted on
                  or before that date. The as-of date is the last day anything measured
                  happened in the export, never today&rsquo;s date.
                </Text>
                <Text size="sm" tone="muted">
                  <strong className="font-medium text-ink">Adjustment period.</strong>{' '}
                  Events grouped by the day they posted. The adjustment module is on this
                  basis alone.
                </Text>
              </FiDisclosure>

              <FiDisclosure
                id="proxy-rates"
                summary="Why the period proxy rates are not loss rates"
              >
                <Text size="sm" tone="muted">
                  A chargeback rate on this page divides an amount posted in the selected
                  period by the original gross of contracts <em>sold</em> in the selected
                  period. Those are two different populations: the contracts charged back
                  in a month are mostly not the ones written in it. The result is a period
                  proxy, useful for watching the direction of travel, and it is not a
                  contract-cohort loss rate. Computing a true cohort rate would need the
                  full life of each cohort, and the reporting window truncates the tail of
                  the adjustment lag distribution — which is also why the most recent sale
                  months carry structurally fewer adjustments than the earliest ones.
                </Text>
              </FiDisclosure>

              <FiDisclosure
                id="denominators"
                summary="Why each category has its own denominator"
              >
                <Text size="sm" tone="muted">
                  Penetration is only meaningful beside the population it was computed
                  over. A GAP rate over all retail deliveries would count cash buyers who
                  have no loan for GAP to cover, and would make every store with a heavier
                  cash mix look worse for a reason that has nothing to do with its finance
                  office. Each category is therefore measured against the deals eligible
                  for it under one governed rule, the rule identifier is on every row, and
                  both sides of the ratio are published. A category with no eligible deals
                  shows &ldquo;No eligible deals&rdquo; rather than 0%, because a rate
                  with no denominator is undefined and not zero.
                </Text>
              </FiDisclosure>

              <FiDisclosure id="limits" summary="What this page will not tell you">
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
                  Nothing here suggests a product to sell, a price to charge, a customer
                  to approach or a lender to use. ARPI approves nothing, declines nothing
                  and tiers nobody.
                </Text>
                <Text size="sm" tone="muted">
                  <strong className="font-medium text-ink">
                    There is no menu and no offer history.
                  </strong>{' '}
                  The model records what was sold, not what was offered and declined, so
                  no closing rate is computable from it.
                </Text>
                <Text size="sm" tone="muted">
                  <strong className="font-medium text-ink">
                    Manager rows are comparisons, not evaluations.
                  </strong>{' '}
                  They carry no ranking and no label, and below the governed minimum-deal
                  floor a ratio is withheld: a one-deal penetration of 100% is a number
                  that will be repeated and cannot be defended.
                </Text>
              </FiDisclosure>
            </Module>
          </GridRow>
        </Workspace>
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
