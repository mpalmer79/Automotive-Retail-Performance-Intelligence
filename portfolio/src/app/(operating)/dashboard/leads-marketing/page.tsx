import type { Metadata } from 'next'

import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  AppointmentOutcomesSection,
  AttributionNotice,
  CohortFunnelSection,
  CohortMaturityNotice,
  MarketingSection,
  ResponseSection,
  SourceComparisonSection,
  StageLossSection,
  VendorDiscrepancySection,
} from '@/components/dashboard/leads-marketing-sections'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
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
 * Leads and marketing — the BDC and marketing operating surface.
 *
 * THE ELEVEN QUESTIONS THIS PAGE EXISTS TO ANSWER, in the order a BDC director asks them:
 * how many valid leads arrived and from where, how many were reached, how many booked, how
 * many showed, how many bought, how fast the store answered, how many it never answered,
 * where the cohort stopped, which sources produce delivered cars rather than activity, what
 * the spend bought, and where the vendor's count and the CRM's disagree.
 *
 * WHAT IT REFUSES TO BE
 * ---------------------
 * It is not a CRM screen. No lead, customer, message, note, phone number or email exists
 * anywhere in the export it reads — the response distribution is a histogram whose bins carry
 * counts and no identity — so there is nothing here to drill into a person with, by design
 * rather than by omission.
 *
 * It is not a BDC leaderboard. Employee performance is `DASH.11` and no employee-grain dataset
 * is exported, so the `employee` filter is declared `not-applicable` rather than quietly
 * ignored.
 *
 * It makes no recommendation. Nothing on this page says increase spend, pause a campaign,
 * call faster or change staffing. Deterministic action logic is `DASH.12`; this page presents
 * the evidence such logic would read.
 *
 * THE FIVE THINGS THE COPY HERE HAS TO GET RIGHT
 * ----------------------------------------------
 * 1. THE DATE BASES ARE NOT THE SAME. Lead measures are on lead creation, show rate on the
 *    scheduled date, show-to-sale on the show date, marketing on whole calendar months. Each
 *    block states its own basis, and no visual spans two.
 * 2. THE GRAINS ARE NOT THE SAME. The funnel counts leads; show rate and show-to-sale count
 *    appointments. They are separate blocks because one lead can produce several appointments.
 * 3. CANCELLATION RATE TRAVELS WITH SHOW RATE, because the exclusion that makes show rate
 *    correct is also the one a store can game.
 * 4. LEADS NOBODY ANSWERED ARE VISIBLE WHEREVER RESPONSE TIME IS. Both response KPIs are blind
 *    to them.
 * 5. AN ORGANIC SOURCE HAS NO COST PER LEAD. Not zero — none.
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
      {/* ROW 1 — context and filters */}
      <OperatingPageHeader
        title="Leads & Marketing"
        context={operatingContext([
          scope.stores.length === dashboardStores.length
            ? 'All three stores'
            : scope.stores.join(', '),
          periodContext.period.label,
        ])}
        methodology={<ExportProvenance exportState={exportState} powerBi={powerBi} />}
      >
        <div className="flex flex-col gap-4">
          <StaleBanner stale={exportState.stale} />
          <ReconciliationBanner failed={reconciliationFailed(dashboardManifest)} />
          <FilterNotice resets={parsed.reset} resetHref={ROUTE} />

          <ActiveFilterChips chips={chips} />

          <FilterBar
            action={ROUTE}
            filters={parsed.filters}
            periodOptions={periodOptions}
            stores={storeOptions}
            conditions={[]}
            leadSources={sourceOptions}
            campaigns={campaignOptions}
            conditionHint="Not applied here. No lead or appointment dataset carries a condition group."
            leadSourceHint="Scopes both sides of every rate on this page, including the appointment outcomes."
            campaignHint="Scopes the funnel, response, appointment and marketing blocks alike."
          />

          <CohortMaturityNotice immature={view.includesImmatureCohort} />
        </div>
      </OperatingPageHeader>

      {/* ROW 2 — the cohort funnel, which is the question the page opens with */}
      <Section rhythm="tight" id="funnel">
        <Container width="full">
          <SectionHeader
            eyebrow="Funnel"
            title="The lead-created cohort"
            lede="Five counts of leads on the date they arrived, with the governed conversion at each step that has one."
          />
          <CohortFunnelSection funnel={view.funnel} />
        </Container>
      </Section>

      {/* ROW 3 — response time: the second thing a BDC director looks at, and on mobile
          it must arrive before campaign detail. */}
      <Section rhythm="tight" tone="evidence" id="response">
        <Container width="full">
          <ResponseSection response={view.response} />
        </Container>
      </Section>

      {/* ROW 4 — appointment outcomes, on their own grain and their own two date bases */}
      <Section rhythm="tight" id="appointments">
        <Container width="full">
          <AppointmentOutcomesSection outcomes={view.appointments} />
        </Container>
      </Section>

      {/* ROW 5 — where the cohort stopped */}
      <Section rhythm="tight" tone="evidence" id="stage-loss">
        <Container width="full">
          <StageLossSection loss={view.stageLoss} />
        </Container>
      </Section>

      {/* ROW 6 — sources by outcome */}
      <Section rhythm="tight" id="sources">
        <Container width="full">
          <SourceComparisonSection sources={view.sources} />
        </Container>
      </Section>

      {/* ROW 7 — marketing efficiency and the vendor comparison */}
      <Section rhythm="tight" tone="evidence" id="marketing">
        <Container width="full">
          <div className="flex flex-col gap-10">
            <MarketingSection marketing={view.marketing} />
            <AttributionNotice />
            <VendorDiscrepancySection
              vendor={view.vendor}
              wholeMonths={view.marketing.wholeMonths}
            />
          </div>
        </Container>
      </Section>

      {/* ROW 8 — the disclosures a reader needs to trust or discount everything above */}
      <Section rhythm="tight" id="methodology">
        <Container width="full">
          <SectionHeader
            eyebrow="Methodology"
            title="How to read this page"
            lede="The denominators, the date bases, the attribution convention and what none of it can tell you."
          />
          <div className="flex flex-col gap-3">
            <Disclosure label="Why the stages use different denominators">
              <Text size="sm">
                Contact rate divides by valid leads. Appointment-set rate divides by
                CONTACTED leads, not by all of them: an appointment cannot be set with
                someone who was never reached, so a store reaching 20% of its leads can
                show a healthier appointment-set rate than one reaching 70%. That is
                correct behaviour and is exactly why the two rates are never shown apart.
                Lead-to-sale conversion divides by valid leads again, so it is not the
                product of the steps above it.
              </Text>
            </Disclosure>
            <Disclosure label="Why appointment outcomes are a separate block">
              <Text size="sm">
                Show rate and show-to-sale conversion are computed over APPOINTMENTS, and
                one lead can produce several. Their denominators are therefore not the
                lead counts in the funnel, and drawing them as two more funnel segments
                would tell you the cohort continued into them. Show rate is attributed to
                the date the appointment was scheduled — an appointment booked for next
                month is not eligible to show this month — and show-to-sale conversion to
                the date the customer arrived, so the visit and its outcome sit in the
                same period.
              </Text>
            </Disclosure>
            <Disclosure label="Why the cancellation rate is beside the show rate">
              <Text size="sm">
                Appointments cancelled before the scheduled date are excluded from the
                show-rate denominator, because the customer never had the opportunity to
                show and counting them as a no-show conflates two different failures. That
                exclusion is also the part of the measure a store can game: recording
                no-shows as advance cancellations produces a flattering show rate. The two
                figures are only meaningful together.
              </Text>
            </Disclosure>
            <Disclosure label="Why the median response is the headline, and what it cannot see">
              <Text size="sm">
                First-response time is heavily right-skewed: most answers come in minutes
                and a few come days later, so one four-day response moves a store&rsquo;s
                mean for a whole month. The median describes what the typical customer
                experienced. Both the median and the mean exclude leads that were never
                answered, which means a store that ignores half its leads can report an
                excellent response time — the unanswered count and the coverage rate are
                published beside the distribution for that reason. A lead with no recorded
                response was never answered; it is not a response of zero seconds, and a
                genuine zero-second auto-response is counted normally in the fastest band.
                The median here is recomputed from the exported response population under
                your current filters, not blended from published medians: a median does
                not decompose, and averaging daily or store medians gives a different and
                wrong answer.
              </Text>
            </Disclosure>
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
                Each lead is counted once, at the furthest stage it reached, and the five
                counts sum exactly to the valid leads in scope. They say where progression
                stopped. They say nothing about why, and nothing in this project could: no
                communication content, activity detail, note or disposition is modelled
                anywhere in the warehouse, so no reason for a stalled lead exists to
                report. Some leads that bought have no modelled showroom visit — a walk-in
                later matched to a lead — which is why the chain of stage rates only
                approximates lead-to-sale conversion rather than equalling it. That
                difference is expected and is not an error.
              </Text>
            </Disclosure>
            <Disclosure label="Why marketing is monthly, and why organic sources show no cost">
              <Text size="sm">
                Spend is recorded by calendar month while leads arrive daily, so dividing
                a month of spend by part of a month of leads would produce a figure that
                looks precise and means nothing. Cost measures are therefore computed only
                over whole months in the selected period, and spend is never prorated:
                this project governs no proration rule. For organic and internal sources,
                cost per lead, cost per sale and gross return are NOT APPLICABLE rather
                than zero — a walk-in is not a zero-cost advertising campaign, and a $0.00
                cost per lead would rank it as the most efficient channel the group
                operates. Where spend produced no attributed lead or no attributed sale,
                that is stated as its own result rather than shown as an infinite or
                missing cost.
              </Text>
            </Disclosure>
            <Disclosure label="What gross return on ad spend is, and is not">
              <Text size="sm">
                It is attributed gross divided by spend: a contribution measure. It nets
                out the cost of the vehicle and nothing else — no personnel, facility,
                floor-plan, overhead, tax or agency cost beyond the modelled spend is
                deducted anywhere in this project — so it is not profit, not net profit
                and not return on investment. A revenue-based return is deliberately not
                shown as a headline: vehicle revenue includes the cost of the vehicle,
                which inflates such a ratio by roughly an order of magnitude. Clicks and
                impressions are vendor-reported activity rather than value, and are not
                presented as marketing outcomes.
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
                looks worst. ARPI defines no maturity horizon, so recent cohorts are shown
                in full and labelled rather than hidden or adjusted.
              </Text>
            </Disclosure>
            <Disclosure label="Why vendor lead counts do not match the CRM">
              <Text size="sm">
                They are different populations on purpose. Vendors count leads their own
                way and typically count duplicates that the CRM de-duplicates, so the two
                figures are published side by side and never reconciled to each other. The
                gap is something to raise with a vendor; it is not automatically a
                data-quality failure, and the vendor figure is never substituted for the
                governed valid-lead count.
              </Text>
            </Disclosure>
            <Disclosure label="What this page deliberately does not contain">
              <Text size="sm">
                No lead, customer, salesperson, message, note, call recording, phone
                number or email address appears anywhere on this page, because none of it
                is exported: the response distribution is a histogram of counts with no
                identity attached to any bin. Every source, vendor and campaign named here
                is fictional, and the data is synthetic throughout. There is no employee
                ranking — that is a later increment — and no recommendation: this page
                reports evidence and does not tell you what to do about it.
              </Text>
            </Disclosure>
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}
