import type { Metadata } from 'next'

import { Canvas } from '@/components/shell/field'
import { GridRow, Module, Workspace } from '@/components/dashboard/exec-grid'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  AdjustmentSection,
  AdjustmentTrend,
  BackGrossComposition,
  BasisTag,
  CategoryEconomics,
  CategoryEconomicsChart,
  FiGrossComposition,
  FiRail,
  ManagerComparison,
  PenetrationChart,
  PenetrationTable,
  ProductionSummary,
  StructureMix,
  StructureMixChart,
} from '@/components/dashboard/fi-sections'
import {
  FilterNotice,
  NoMatchingRecords,
  PeriodNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section } from '@/components/ui/layout'
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
import { formatIsoMonth } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardFi')

const ROUTE = ROUTES.dashboardFi.href

/**
 * F&I performance — the finance director's workspace.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * `UX.1` left this route as eight full-width bands — production, composition, structure,
 * penetration, economics, adjustments, managers, methodology — each opening with an eyebrow,
 * an `h2` and a three-to-five-line lede. Measured on the merge of `UX.2A`, at 1440 × 900:
 * 6,614 px, **zero framed visualizations**, and 700 words of visible prose, which was the
 * second-highest count in the console. The page explained itself beautifully and drew
 * nothing.
 *
 * `UX.2B` rebuilds it on the module grid. The eight band headings are gone; every figure,
 * every denominator, every governed rate and every catalogue identifier is the same value
 * from the same selector.
 *
 * THREE DATE BASES, NOW VISIBLE AT A GLANCE (`UX.2B` §9)
 * ------------------------------------------------------
 * Deal date is what the office produced. As-of is what the store retained. Adjustment
 * period groups events by the day they posted. Before this increment each was a full
 * sentence under each figure — eight sentences saying one of three things. They are now
 * `BasisTag` chips: three values, one vocabulary, on every card and on the face of every
 * module whose basis is not deal date. The full definition of each stays in the methodology
 * disclosure, which is where §9 puts the detail.
 *
 * The rule the chips enforce is unchanged and is the reason they exist: the page never
 * shows two bases inside one number, and the mixed-basis rates still carry the export's own
 * `rate_basis_disclosure` wherever they appear.
 *
 * NO BENCHMARK, NO RECOMMENDATION, NO RANKING — unchanged, and now also true of the
 * geometry. Nothing is captioned good, weak, healthy or on-target. No bar is coloured to
 * say a category should be sold more. The manager module is ordered by store and synthetic
 * identifier and is not a leaderboard; below the governed minimum-deal floor a ratio is
 * withheld rather than shown small.
 *
 * WHAT DID NOT CHANGE. No KPI definition, no eligibility rule, no denominator, no date
 * basis, no minimum-sample floor, no export. The one addition to the view model is a
 * selection: adjustment amount grouped by the exported `adjustment_date` month, which is
 * the same rows the adjustments module already sums, grouped by a column it already reads.
 *
 * A SERVER COMPONENT. One client island, the filter bar, receives option lists and no data.
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
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            {/*
              THE SYNTHETIC DISCLOSURE, ONCE AND PROMINENTLY. It is a caveat rather than a
              mechanism: a reader who takes an invented lender or an invented eligibility
              rule for a real one has misread every figure on the page.
            */}
            <Text size="sm" tone="muted">
              <strong className="font-medium text-ink">
                Every lender, product and provider on this page is invented.
              </strong>{' '}
              Prices, costs and eligibility rules are synthetic analytical rules for a
              fictional dealer group. No figure here is an industry benchmark, and ARPI
              models no APR, payment, buy rate, sell rate, rate spread, credit score or
              lending decision of any kind.
            </Text>
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <PeriodNotice notices={view.periodContext.notices} />
            <ActiveFilterChips chips={chips} />
            {view.notices.map((notice) => (
              <Text key={notice} size="xs" tone="faint">
                {notice}
              </Text>
            ))}
          </div>
        }
        filters={
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
        }
        methodology={
          <div className="flex flex-col gap-4">
            <ExportProvenance
              exportState={exportState}
              powerBi={powerBi}
              asOf={view.asOfDate}
            />
            <FiMethodology asOfDate={view.asOfDate} />
          </div>
        }
      />

      {view.hasRows ? (
        <Workspace>
          {/* ---------------------------------------------------------------- */}
          {/* ROW 1 — the rail                                                  */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="production"
              title="Result"
              zone="fi"
              visual="kpi-rail"
              meta={view.periodContext.period.label}
            >
              <FiRail view={view} />
              <FiDisclosure
                id="production-detail"
                summary="Eight production figures, with every basis line"
              >
                <ProductionSummary view={view} />
              </FiDisclosure>
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 2 — what the total is made of, and what could be sold         */}
          {/* ---------------------------------------------------------------- */}
          {/*
            THE FIRST-VIEWPORT CONTRACT IS MET HERE, and the order is the diagnostic one.
            What is back-end gross made of; what could have been sold, which structure
            decides before anything about a customer does; and what was sold against that
            eligible population. A reader who meets penetration before structure is reading
            rates whose denominators they have not been shown.
          */}
          <GridRow align="start">
            <Module
              id="composition"
              title="Gross composition"
              span={3}
              zone="fi"
              visual="composition"
              meta={<BasisTag basis="deal" />}
            >
              <FiGrossComposition view={view} />
              <FiDisclosure
                id="composition-detail"
                summary="The back-gross identity, recomputed to the cent"
              >
                <BackGrossComposition
                  view={view}
                  identityHolds={identityHolds}
                  residual={residual}
                />
              </FiDisclosure>
            </Module>
            <Module
              id="structure"
              title="Deal structure"
              span={3}
              zone="fi"
              visual="structure"
              meta={<BasisTag basis="deal" />}
              note="Structure decides what could be sold: GAP needs financing, Lease Wear Protection needs a lease, and a cash delivery can earn no reserve at all."
            >
              <StructureMixChart view={view} />
              <FiDisclosure
                id="structure-detail"
                summary="Structure counts and shares, as a table"
              >
                <StructureMix structures={view.structures} view={view} />
              </FiDisclosure>
            </Module>
            <Module
              id="penetration"
              title="Penetration"
              span={6}
              zone="fi"
              visual="penetration"
              meta={<BasisTag basis="deal" />}
            >
              <PenetrationChart view={view} />
              <FiDisclosure
                id="penetration-detail"
                summary="Both sides of every ratio, with its eligibility rule identifier"
              >
                <PenetrationTable view={view} comparisonLabel={comparisonLabel} />
              </FiDisclosure>
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 3 — what each category earned, and what came back             */}
          {/* ---------------------------------------------------------------- */}
          <GridRow align="start">
            <Module
              id="economics"
              title="Category economics"
              span={7}
              zone="fi"
              visual="economics"
              meta={<BasisTag basis="deal" />}
            >
              <CategoryEconomicsChart view={view} />
              <FiDisclosure
                id="economics-detail"
                summary="Retail, cost, gross, adjustments and net, by category"
              >
                <CategoryEconomics view={view} />
              </FiDisclosure>
            </Module>
            <Module
              id="adjustments"
              title="Adjustments"
              span={5}
              zone="fi"
              visual="adjustments"
              meta={<BasisTag basis="adjustment" />}
              note="Events are grouped by the date each posted. A chargeback in this period against a contract written earlier belongs to this period; the earlier contract keeps the gross it was written with."
            >
              <AdjustmentTrend view={view} />
              <FiDisclosure
                id="adjustments-detail"
                summary="By type and category, with their period-proxy rates"
              >
                <AdjustmentSection view={view} />
              </FiDisclosure>
            </Module>
          </GridRow>

          {/* ---------------------------------------------------------------- */}
          {/* ROW 4 — the finance desks                                         */}
          {/* ---------------------------------------------------------------- */}
          <GridRow>
            <Module
              id="managers"
              title="Finance managers, in context"
              span={12}
              zone="fi"
              note="Below the governed minimum-deal floor a ratio is withheld rather than shown small: a one-deal penetration of 100% is a number that will be repeated and cannot be defended."
            >
              <ManagerComparison view={view} />
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
/* Disclosures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A body of detail, collapsed but not removed.
 *
 * THE `id` STAYS ON THE ELEMENT. Each of these was a page region with an anchor that
 * in-page navigation and external links point at, and an anchor that stops resolving is a
 * broken link even when the content is still on the page.
 */
function FiDisclosure({
  id,
  summary,
  children,
}: {
  readonly id: string
  readonly summary: string
  readonly children: React.ReactNode
}) {
  return (
    <details
      id={id}
      className="rounded-xl border border-line-subtle bg-surface-sunken/40"
    >
      <summary className="flex min-h-touch cursor-pointer items-center px-3 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-4">{children}</div>
    </details>
  )
}

/**
 * How to read the page, and what it cannot tell you.
 *
 * MOVED INTO THE CONTROL BAND'S METHODOLOGY PANEL, beside the filters, where every operating
 * route carries its provenance. It was an eighth full-width band at the foot of the document
 * holding four disclosures; nothing inside it was summarised, shortened or dropped, and the
 * four are still four. `UX.2B` §11 asks for mechanics to live in methodology, and this is
 * the page's methodology.
 */
function FiMethodology({ asOfDate }: { readonly asOfDate: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Disclosure label="The three date bases, and why they are not interchangeable">
        <div className="flex flex-col gap-2">
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">Deal date.</strong> What the finance
            office produced, attributed to the day the deal was struck. Reserve, original
            product gross and back-end gross are on this basis and are never rewritten
            when a later event posts.
          </Text>
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">As of {asOfDate}.</strong> What the
            store retained: original gross less every adjustment posted on or before that
            date. The as-of date is the last day anything measured happened in the export,
            never today&rsquo;s date.
          </Text>
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">Adjustment period.</strong> Events
            grouped by the day they posted. The adjustments module is on this basis alone.
          </Text>
        </div>
      </Disclosure>

      <Disclosure label="Why the period proxy rates are not loss rates">
        <Text size="sm" tone="muted">
          A chargeback rate on this page divides an amount posted in the selected period
          by the original gross of contracts <em>sold</em> in the selected period. Those
          are two different populations: the contracts charged back in a month are mostly
          not the ones written in it. The result is a period proxy, useful for watching
          the direction of travel, and it is not a contract-cohort loss rate. Computing a
          true cohort rate would need the full life of each cohort, and the reporting
          window truncates the tail of the adjustment lag distribution — which is also why
          the most recent sale months carry structurally fewer adjustments than the
          earliest ones.
        </Text>
      </Disclosure>

      <Disclosure label="Why each category has its own denominator">
        <Text size="sm" tone="muted">
          Penetration is only meaningful beside the population it was computed over. A GAP
          rate over all retail deliveries would count cash buyers who have no loan for GAP
          to cover, and would make every store with a heavier cash mix look worse for a
          reason that has nothing to do with its finance office. Each category is
          therefore measured against the deals eligible for it under one governed rule,
          the rule identifier is on every row, and both sides of the ratio are published.
          A category with no eligible deals shows &ldquo;No eligible deals&rdquo; rather
          than 0%, because a rate with no denominator is undefined and not zero.
        </Text>
      </Disclosure>

      <Disclosure label="What this page will not tell you">
        <div className="flex flex-col gap-2">
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">
              There is no benchmark and no target.
            </strong>{' '}
            ARPI publishes no industry F&amp;I figures, so nothing here is good, bad,
            healthy or standard. A penetration of 40.7% is stated as 40.7%.
          </Text>
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">There is no recommendation.</strong>{' '}
            Nothing here suggests a product to sell, a price to charge, a customer to
            approach or a lender to use. ARPI approves nothing, declines nothing and tiers
            nobody.
          </Text>
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">
              There is no menu and no offer history.
            </strong>{' '}
            The model records what was sold, not what was offered and declined, so no
            closing rate is computable from it.
          </Text>
          <Text size="sm" tone="muted">
            <strong className="font-medium text-ink">
              Manager rows are comparisons, not evaluations.
            </strong>{' '}
            They carry no ranking and no label, and below the governed minimum-deal floor
            a ratio is withheld: a one-deal penetration of 100% is a number that will be
            repeated and cannot be defended.
          </Text>
        </div>
      </Disclosure>
    </div>
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
