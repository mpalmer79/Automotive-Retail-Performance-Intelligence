import type { Metadata } from 'next'

import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  AppointmentProgression,
  CohortMaturityLine,
  DemandRail,
  LeadProgression,
  MarketingEconomics,
  ResponseWorkspace,
  SourceMatrix,
  StageLossBars,
  VendorCounts,
} from '@/components/dashboard/leads-workspace'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import {
  calendarBounds,
  calendarMonths,
  chunkedDataset,
  dashboardCalendar,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import {
  activeFilterChips,
  LEADS_MARKETING_SUPPORT,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { formatIsoMonth } from '@/lib/dashboard/format'
import { storeScopeLabel } from '@/lib/dashboard/scope'
import {
  buildLeadsMarketingView,
  scopeFromFilters,
} from '@/lib/dashboard/leads-marketing'
import { campaignRows } from '@/lib/dashboard/leads-marketing-data'
import { calendarWindow, resolvePeriod } from '@/lib/dashboard/periods'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardLeadsMarketing')

const ROUTE = ROUTES.dashboardLeadsMarketing.href

/**
 * Leads and marketing — the BDC and marketing operating workspace.
 *
 * WHAT THIS ROUTE WAS, MEASURED, AND WHAT IT IS NOW
 * ------------------------------------------------
 * `docs/reviews/UX-2C-BASELINE.md` measured it on the merge of `UX.2B.1`: eight full-width
 * bands stacked down an 8,821 px document, each opening with an eyebrow, an `h2` and a lede.
 * At 1440 × 900 the first viewport contained **213 words of prose and not one complete
 * figure** — the top of the funnel entered at 639 px and the rest of it did not fit. The route
 * drew seven framed figures, more than any other operating surface, and had no headline figure
 * of any kind. At 1,102 `proseRepo` words it was the most explanation-heavy route in the
 * console.
 *
 * `UX.2C` rebuilds it as the twelve-column module grid `UX.2A` established, in the order a BDC
 * director actually reads: how much arrived and what converted, how the two progressions
 * differ, how fast the store answered, where the cohort stopped, which sources produced what,
 * and what the spend bought. The region eyebrows and the region `h2`s are gone — a module's
 * own title says what it holds, and `Funnel` above a module titled `The lead-created cohort`
 * was the page talking to itself.
 *
 * THE FIRST-VIEWPORT CONTRACT (`UX.2C` §5 and §52)
 * ------------------------------------------------
 * At 1440 × 900, before any scrolling: the control band; the seven-figure demand rail, whole;
 * and three modules of data-driven geometry — the lead-grain progression, the appointment-grain
 * progression and the response distribution. Every module whose body is geometry carries
 * `data-visual-region`, so the contract is asserted by MEASUREMENT rather than by eye:
 * `tests/e2e/dashboard-leads-marketing.spec.ts` reads their offsets against the viewport under
 * more than one filter state.
 *
 * THE TWO GRAINS ARE TWO MODULES (`UX.2C` §8)
 * -------------------------------------------
 * Not one five-bar ramp. The lead-grain funnel counts LEADS on the lead-creation date; the
 * appointment block counts APPOINTMENTS on two different date bases, and one lead can produce
 * several. Drawing them as one shrinking shape would assert a denominator continuity that does
 * not exist. They are adjacent, each names its own grain in its own title, and neither borrows
 * the other's percentages. The reasoning is in `leads-workspace.tsx`.
 *
 * WHAT IT STILL REFUSES TO BE
 * ---------------------------
 * Not a CRM screen: no lead, customer, message, note, phone number or email exists in the
 * export it reads, so there is nothing here to drill into a person with. Not a BDC
 * leaderboard: no employee-grain dataset is exported and the `employee` filter is declared
 * `not-applicable` rather than quietly ignored. It makes no recommendation — deterministic
 * action logic is `DASH.12`, and this page presents the evidence such logic reads.
 *
 * THE FIVE THINGS THE COPY HERE HAS TO GET RIGHT, unchanged from `DASH.10` and now carried by
 * the modules rather than by paragraphs between them:
 * 1. THE DATE BASES ARE NOT THE SAME. Lead measures on lead creation, show rate on the
 *    scheduled date, show-to-sale on the show date, marketing on whole calendar months. Each
 *    module states its own basis and no visual spans two.
 * 2. THE GRAINS ARE NOT THE SAME — the two modules above.
 * 3. CANCELLATION RATE TRAVELS WITH SHOW RATE. It is a bar of the appointment progression, not
 *    a note beside it.
 * 4. LEADS NOBODY ANSWERED ARE VISIBLE WHEREVER RESPONSE TIME IS. They are on the rail and they
 *    are a row of the response figure.
 * 5. AN ORGANIC SOURCE HAS NO COST PER LEAD. Not zero — none, and it draws no bar.
 */
export default async function LeadsMarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const knownSources = dashboardLeadSources.map((source) => source.code)
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources,
  })

  const window = calendarWindow(dashboardCalendar, dashboardManifest.asOfDate)
  const periodContext = resolvePeriod(
    parsed.filters.period,
    parsed.filters.compare,
    window
  )
  const scope = scopeFromFilters(
    parsed.filters,
    periodContext.period,
    dashboardStores.map((store) => store.id)
  )

  const funnelRows = chunkedDataset('lead-funnel', scope.stores, scope.period.months)
  const view = buildLeadsMarketingView(
    funnelRows,
    scope,
    dashboardLeadSources,
    calendarBounds.last
  )

  const chips = activeFilterChips(parsed.filters, LEADS_MARKETING_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)

  // Built from the export's own enumerations, never hard-coded: an option the data cannot
  // produce is an invitation to a view that renders nothing.
  const periodOptions: readonly FilterOption[] = calendarMonths.map((month) => ({
    value: month,
    label: formatIsoMonth(month),
  }))
  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))
  const sourceOptions: readonly FilterOption[] = dashboardLeadSources.map((source) => ({
    value: source.code,
    label: source.name,
  }))
  const campaignOptions: readonly FilterOption[] = campaignRows()
    .map((row) => ({
      value: String(row.campaign_code),
      label: String(row.campaign_name),
    }))
    .sort((a, b) => a.value.localeCompare(b.value))

  return (
    <Canvas>
      <OperatingPageHeader
        title="Leads & Marketing"
        context={operatingContext([
          storeScopeLabel(parsed.filters.store),
          periodContext.period.label,
        ])}
        methodology={<ExportProvenance exportState={exportState} powerBi={powerBi} />}
        chips={chips}
        filterState={parsed.filters}
        route={ROUTE}
        notices={
          <div className="flex flex-col gap-3 empty:hidden">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={reconciliationFailed(dashboardManifest)} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
          </div>
        }
        filters={
          <FilterBar
            action={ROUTE}
            support={LEADS_MARKETING_SUPPORT}
            filters={parsed.filters}
            periodOptions={periodOptions}
            stores={storeOptions}
            leadSources={sourceOptions}
            campaigns={campaignOptions}
            leadSourceHint="Scopes both sides of every rate on this page, including the appointment outcomes."
            campaignHint="Scopes the funnel, response, appointment and marketing blocks alike."
          />
        }
      >
        <CohortMaturityLine immature={view.includesImmatureCohort} />
      </OperatingPageHeader>

      <Workspace>
        {/* ------------------------------------------------------------------ */}
        {/* ROW 1 — the demand rail                                             */}
        {/* ------------------------------------------------------------------ */}
        <GridRow>
          <Module
            id="demand"
            title="Demand"
            zone="funnel"
            visual="kpi-rail"
            meta={periodContext.period.label}
          >
            <DemandRail
              funnel={view.funnel}
              appointments={view.appointments}
              response={view.response}
            />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 2 — the three the viewport contract is measured on              */}
        {/* ------------------------------------------------------------------ */}
        {/*
          THE TWO PROGRESSIONS SIT SIDE BY SIDE SO THE GRAIN BOUNDARY IS VISIBLE. On the
          route this replaced they were regions 2 and 4, separated by a screen and a half of
          response distribution, and a reader could reach the appointment percentages having
          forgotten that the funnel above them counted something else. Adjacency is the
          clearest available statement that these are two populations, and each title names
          its own grain rather than relying on the reader having read a lede.

          Response is the third because it is the second thing a BDC director looks at and
          because `UX.2C` §10 asks for it as a major visual element rather than a figure at
          the foot of a page.
        */}
        <GridRow align="start">
          <Module
            id="funnel"
            title="Lead cohort"
            span={4}
            zone="funnel"
            visual="lead-funnel"
            meta="Lead grain · lead-creation date"
          >
            <LeadProgression funnel={view.funnel} />
          </Module>
          <Module
            id="appointments"
            title="Appointments"
            span={4}
            zone="funnel"
            visual="appointment-progression"
            meta="Appointment grain · two date bases"
          >
            <AppointmentProgression outcomes={view.appointments} />
          </Module>
          <Module
            id="response"
            title="Response"
            span={4}
            visual="response-distribution"
            meta="Lead grain · lead-creation date"
          >
            <ResponseWorkspace response={view.response} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 3 — where it stopped, and which source it came from             */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module
            id="stage-loss"
            title="Where the cohort stopped"
            span={4}
            visual="stage-loss"
            meta="Mutually exclusive"
          >
            <StageLossBars loss={view.stageLoss} />
          </Module>
          <Module id="sources" title="Sources" span={8} visual="source-matrix">
            <SourceMatrix sources={view.sources} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 4 — what the spend bought, and what the vendor says it bought   */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module
            id="marketing"
            title="Marketing economics"
            span={8}
            visual="marketing-economics"
            meta={
              view.marketing.monthGrainUnavailable
                ? 'No complete month in this period'
                : view.marketing.wholeMonths.join(', ')
            }
            note="Attribution is single-source and first-touch: a customer who arrived through three channels is credited to one, and sales are anchored to the originating lead's creation month rather than the sale date. Association under that convention is not causation."
          >
            <MarketingEconomics marketing={view.marketing} />
          </Module>
          <Module id="vendor" title="Vendor reconciliation" span={4} visual="vendor">
            <VendorCounts vendor={view.vendor} wholeMonths={view.marketing.wholeMonths} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 5 — the disclosures a reader needs to trust or discount the rest */}
        {/* ------------------------------------------------------------------ */}
        {/*
          ELEVEN DISCLOSURES, DOWN FROM TWELVE, AND EVERY ONE OF THEM IS STILL HERE. What
          left this region is the four that the modules above now carry in their own
          methodology — the denominators, the two grains, the cancellation exclusion and the
          median — because a caveat printed once beside the figure it qualifies is worth more
          than the same caveat printed twice on one page. Nothing was deleted for length.
        */}
        <GridRow>
          <Module id="methodology" title="How to read this page" span={12}>
            <div className="flex flex-col gap-2">
              <Disclosure label="Why there are no targets or benchmark colours">
                <Text size="sm">
                  ARPI holds no benchmark data for response time, contact rate, show rate,
                  cost per lead, cost per sale or gross return, so it publishes no target
                  for any of them and nothing on this page is coloured good or bad. The
                  response bands are descriptive bins. Compare stores, sources and periods
                  against each other; this project has no industry standard to offer you.
                </Text>
              </Disclosure>
              <Disclosure label="What the lost-stage counts do and do not say">
                <Text size="sm">
                  Each lead is counted once, at the furthest stage it reached, and the
                  counts sum exactly to the valid leads in scope. They say where
                  progression stopped. They say nothing about why, and nothing in this
                  project could: no communication content, activity detail, note or
                  disposition is modelled anywhere in it. Some leads that bought have no
                  modelled showroom visit — a walk-in later matched to a lead — which is
                  why the chain of stage rates only approximates lead-to-sale conversion
                  rather than equalling it. That difference is expected and is not an
                  error.
                </Text>
              </Disclosure>
              <Disclosure label="Why marketing is monthly, and why organic sources show no cost">
                <Text size="sm">
                  Spend is recorded by calendar month while leads arrive daily, so
                  dividing a month of spend by part of a month of leads would produce a
                  figure that looks precise and means nothing. Cost measures are computed
                  only over whole months in the selected period, and spend is never
                  prorated: this project governs no proration rule. For organic and
                  internal sources, cost per lead, cost per sale and gross return are NOT
                  APPLICABLE rather than zero — a walk-in is not a zero-cost advertising
                  campaign, and a $0.00 cost per lead would rank it as the most efficient
                  channel the group operates. Where spend produced no attributed lead or
                  no attributed sale, that is stated as its own result rather than shown
                  as an infinite or missing cost.
                </Text>
              </Disclosure>
              <Disclosure label="Why the comparison is by source and the table is by campaign">
                <Text size="sm">
                  Cost per lead, cost per sale and gross return are ratios of sums at
                  whatever group they are formed over: total spend over total attributed
                  outcomes, never an average of per-campaign ratios, which would weight a
                  campaign that produced two leads the same as one that produced two
                  hundred. The same governed arithmetic is applied at three groups on this
                  page — per source for the comparison, per source and campaign for the
                  table, and over every cost-attributable row for the headline figures.
                  KPI-MKT-001, KPI-MKT-002 and KPI-MKT-003 keep their published
                  definitions at all three.
                </Text>
              </Disclosure>
              <Disclosure label="What gross return on ad spend is, and is not">
                <Text size="sm">
                  It is attributed gross divided by spend: a contribution measure. It nets
                  out the cost of the vehicle and nothing else — no personnel, facility,
                  floor-plan, overhead, tax or agency cost beyond the modelled spend is
                  deducted anywhere in this project — so it is not profit, not net profit
                  and not return on investment. A revenue-based return is deliberately not
                  shown: vehicle revenue includes the cost of the vehicle, which inflates
                  such a ratio by roughly an order of magnitude. Clicks and impressions
                  are vendor-reported activity rather than value, and are not presented as
                  marketing outcomes.
                </Text>
              </Disclosure>
              <Disclosure label="How leads are attributed, and why cohorts look worse recently">
                <Text size="sm">
                  Attribution is single-source and first-touch: a lead is credited to
                  exactly one source and one campaign, and a customer who arrived through
                  three channels is credited to one. No multi-touch, linear, time-decay,
                  last-touch, position-based or view-through model exists in this project.
                  Sales and gross are attributed through the originating lead&rsquo;s
                  creation month rather than the sale date, so this month&rsquo;s spend is
                  never credited with last quarter&rsquo;s leads — and the consequence is
                  that the most recent cohort has had the least time to convert and always
                  looks worst. ARPI defines no maturity horizon, so recent cohorts are
                  shown in full and labelled rather than hidden or adjusted.
                </Text>
              </Disclosure>
              <Disclosure label="Why vendor lead counts do not match the CRM">
                <Text size="sm">
                  They are different populations on purpose. Vendors count leads their own
                  way and typically count duplicates that the CRM de-duplicates, so the
                  two figures are published side by side and never reconciled to each
                  other. The gap is something to raise with a vendor; it is not
                  automatically a data-quality failure, and the vendor figure is never
                  substituted for the governed valid-lead count.
                </Text>
              </Disclosure>
              <Disclosure label="What this page deliberately does not contain">
                <Text size="sm">
                  No lead, customer, salesperson, message, note, call recording, phone
                  number or email address appears anywhere on this page, because none of
                  it is exported: the response distribution is a histogram of counts with
                  no identity attached to any bin. Every source, vendor and campaign named
                  here is fictional, and the data is synthetic throughout. There is no
                  employee ranking — that is a separate surface — and no recommendation:
                  this page reports evidence and does not tell you what to do about it.
                </Text>
              </Disclosure>
            </div>
          </Module>
        </GridRow>
      </Workspace>
    </Canvas>
  )
}
