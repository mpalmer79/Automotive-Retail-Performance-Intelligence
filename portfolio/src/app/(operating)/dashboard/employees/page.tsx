import type { Metadata } from 'next'

import {
  EmployeeMatrix,
  RoleNav,
  RoleSummarySection,
  SelectedEmployeeSection,
  StoreContextSection,
  UnassignedSection,
  UnknownEmployeeNotice,
} from '@/components/dashboard/employees-sections'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import {
  calendarMonths,
  chunkedDataset,
  dashboardCalendar,
  dashboardLeadSources,
  dashboardManifest,
  dashboardStores,
} from '@/lib/dashboard/data'
import {
  buildEmployeeView,
  buildRoster,
  buildStoreInventory,
  ROLE_DESCRIPTIONS,
  ROLE_SLUGS,
  DEFAULT_ROLE_SLUG,
  roleFromSlug,
  scopeFromFilters,
  summarise,
  volumeScale,
  type RoleSlug,
} from '@/lib/dashboard/employees'
import {
  employeeAppointmentRows,
  employeeFinanceRows,
  employeeLeadSourceRows,
  employeeRosterRows,
  employeeSalesRows,
} from '@/lib/dashboard/employees-data'
import {
  activeFilterChips,
  EMPLOYEES_SUPPORT,
  filtersHref,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { formatIsoMonth } from '@/lib/dashboard/format'
import { calendarWindow, resolvePeriod } from '@/lib/dashboard/periods'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { operatingHref } from '@/lib/dashboard/navigation'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardEmployees')

const ROUTE = ROUTES.dashboardEmployees.href

/**
 * This route's own query parameter, read defensively.
 *
 * `role` is not one of the thirteen parameters of the global filter grammar, so `parseFilters`
 * neither knows nor validates it. It is read here and normalised by `roleFromSlug`, which
 * falls back to the default rather than erroring: an unrecognised role in a shared link should
 * still render a page.
 */
function readRoleParam(query: QueryInput): string | undefined {
  if (query instanceof URLSearchParams) return query.get('role') ?? undefined
  const value = query.role
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  return value[0]
}

const ROLE_LABELS: Readonly<Record<RoleSlug, string>> = {
  salesperson: 'Salesperson',
  desk: 'Desk management',
  finance: 'Finance',
  bdc: 'BDC',
}

/**
 * Employee performance — role-aware activity with the context that decides what it means.
 *
 * THE THIRTEEN QUESTIONS THIS PAGE EXISTS TO ANSWER, in the order a manager asks them: what
 * was credited to each person in the period, what business outcomes accompanied it, what
 * denominator produced each rate, whether the sample is large enough to publish, what
 * opportunity and operating context changes the reading, what the new and used mix was, what
 * lead volume and source mix surrounded it, what inventory the store had, how often a desk
 * manager was on the deal, what the BDC funnel did from assignment through the appointment,
 * what finance structure accompanied the F&I result, when to refuse the comparison outright,
 * and where to look next.
 *
 * THE FIVE QUESTIONS IT REFUSES TO ANSWER, and refuses structurally rather than by tone: who
 * is best, who is worst, who is underperforming, who deserves a raise, who should be let go.
 * No such judgement is supported by this model and none is derivable from what it publishes.
 * There is no rank, no score, no percentile, no tier and no composite anywhere in the route;
 * the list is ordered by store, role and employee code and there is no control to change
 * that; and every comparative figure is withheld below its own governed minimum sample.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not an HR system. No name, initial, photo, avatar, contact detail, hire date,
 * termination date, exact tenure, age, compensation, commission, pay plan, bonus or protected
 * attribute exists in the export it reads, so there is nothing here to render one from.
 *
 * It is not a coaching engine. Nothing on this page says coach, train, improve, pair with or
 * take corrective action. Deterministic management actions are `DASH.12`; this page presents
 * the evidence such logic would read.
 *
 * It makes no causal claim. Figures are CREDITED TO and OBSERVED FOR a person. The model
 * records associations and does not isolate an individual effect, so nothing here says
 * caused, drove, created or lost.
 *
 * THE SIX THINGS THE COPY HERE HAS TO GET RIGHT
 * ---------------------------------------------
 * 1. THE FOUR ROLE FAMILIES ARE NOT COMPARABLE WITH EACH OTHER. Different opportunities,
 *    different governed denominators. The role switch changes the questions, not the layout.
 * 2. EVERY RATIO CARRIES ITS OWN DENOMINATOR AS ITS SAMPLE. Gross per unit is floored on
 *    retail units, contact rate on valid leads, appointment-set rate on CONTACTED leads,
 *    show rate on eligible appointments, show-to-sale on shown appointments.
 * 3. FOUR ABSENCES ARE FOUR DIFFERENT STATEMENTS. Not applicable, insufficient sample, no
 *    data, and a real zero.
 * 4. CONTEXT SITS BESIDE THE FIGURE, not in a drawer. Tenure, store, mix, opportunity and the
 *    sample are all on the row; only the methodology is behind the disclosure.
 * 5. THE STRUCTURE MIX TRAVELS WITH EVERY FINANCE FIGURE, because reserve and back PVR divide
 *    by all retail units and a cash deal cannot generate reserve.
 * 6. CANCELLATIONS TRAVEL WITH SHOW RATE, because the exclusion that makes show rate correct
 *    is also the one a store can game.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
    knownSources: dashboardLeadSources.map((source) => source.code),
  })

  // ROLE IS URL STATE, NOT COMPONENT STATE. It survives reload, copy-paste, Back, Forward and
  // JavaScript being off, because it is read here from the query string and rendered on the
  // server. An unrecognised value falls back to the default rather than erroring: a bad role
  // in a shared link should still show a page.
  const role = roleFromSlug(readRoleParam(query))

  const window = calendarWindow(dashboardCalendar, dashboardManifest.asOfDate)
  const periodContext = resolvePeriod(
    parsed.filters.period,
    parsed.filters.compare,
    window
  )

  const roster = buildRoster(employeeRosterRows())
  const scope = scopeFromFilters(
    parsed.filters,
    periodContext.period,
    dashboardStores.map((store) => store.id),
    role,
    roster.map((entry) => entry.code)
  )

  const months = scope.period.months
  const view = buildEmployeeView(
    scope,
    {
      roster,
      sales: employeeSalesRows(scope.stores, months),
      finance: employeeFinanceRows(),
      appointments: employeeAppointmentRows(),
      leadSource: employeeLeadSourceRows(scope.stores, months),
    },
    dashboardLeadSources,
    // The floor the export publishes is used; this is only what to say if no row carries one,
    // which happens when the selection is empty. It is never applied to a printed figure.
    0
  )

  const inventory = buildStoreInventory(
    chunkedDataset('inventory-health', scope.stores, months),
    scope
  )

  const summary = summarise(view)
  const scale = volumeScale(view.rows)
  const chips = activeFilterChips(parsed.filters, EMPLOYEES_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)

  const periodOptions: readonly FilterOption[] = calendarMonths.map((month) => ({
    value: month,
    label: formatIsoMonth(month),
  }))
  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))

  // BOTH LINK BUILDERS GO THROUGH THE GOVERNED SERIALIZER, never through hand-assembled
  // query strings. `serializeFilters` fixes the canonical parameter order and the sorted
  // store list, so two equivalent states produce byte-identical URLs; a local `URLSearchParams`
  // here would have produced a second, subtly different serialization of the same filters.
  // `role` is appended afterwards because it is this route's own parameter and not part of
  // the thirteen-parameter global grammar.
  const withRole = (href: string, slug: string): string => {
    if (slug === DEFAULT_ROLE_SLUG) return href
    return href.includes('?') ? `${href}&role=${slug}` : `${href}?role=${slug}`
  }

  /** A link that keeps every filter and changes only the role. */
  const roleHref = (slug: string): string =>
    withRole(filtersHref(ROUTE, { ...parsed.filters, employee: null }), slug)

  /** A link that keeps the role and the filters and selects one employee. */
  const employeeHref = (code: string): string =>
    withRole(filtersHref(ROUTE, { ...parsed.filters, employee: code }), role)

  const roleItems = (Object.keys(ROLE_SLUGS) as RoleSlug[]).map((slug) => ({
    slug,
    label: ROLE_LABELS[slug],
    href: roleHref(slug),
  }))

  // DRILL-THROUGH IS ONLY OFFERED WHERE THE DESTINATION HONOURS THE PARAMETER. `/dashboard/fi`
  // declares `employee` applied and scopes both sides of every penetration figure by it, so a
  // finance row links there with the code. No other route declares it applied, so no other
  // link carries one: a parameter the destination cannot honour is a false drill-through, and
  // the BDC link goes to the store-and-period funnel without pretending to be person-scoped.
  const selectedLinks =
    view.selected === null
      ? []
      : view.selected.family === 'Finance'
        ? [
            {
              label: 'F&I detail for this manager',
              href: operatingHref(ROUTES.dashboardFi.href, {
                ...parsed.filters,
                employee: view.selected.code,
              }),
              note: 'Category penetration on its eligible denominators, which this page does not carry.',
            },
          ]
        : view.selected.family === 'BDC'
          ? [
              {
                label: 'Leads and marketing for these stores and period',
                href: operatingHref(ROUTES.dashboardLeadsMarketing.href, {
                  ...parsed.filters,
                  employee: null,
                }),
                note: 'The governed store funnel. It is not filtered to this person: that route declares the employee parameter not applicable.',
              },
            ]
          : [
              {
                label: 'Sales and gross for these stores and period',
                href: operatingHref(ROUTES.dashboardSalesGross.href, {
                  ...parsed.filters,
                  employee: null,
                }),
                note: 'The governed store totals these deliveries are inside. Not filtered to this person: that route declares the employee parameter not applicable.',
              },
            ]

  return (
    <Canvas>
      {/* REGION 1 — context, role family and filters */}
      <OperatingPageHeader
        title="Employees"
        context={operatingContext([
          scope.stores.length === dashboardStores.length
            ? 'All three stores'
            : scope.stores.join(', '),
          periodContext.period.label,
          `${ROLE_SLUGS[role]} view`,
        ])}
        methodology={<ExportProvenance exportState={exportState} powerBi={powerBi} />}
      >
        <div className="flex flex-col gap-4">
          <StaleBanner stale={exportState.stale} />
          <ReconciliationBanner failed={reconciliationFailed(dashboardManifest)} />
          <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
          <UnknownEmployeeNotice
            code={scope.employeeUnknown ? parsed.filters.employee : null}
          />

          <RoleNav items={roleItems} current={role} />

          <ActiveFilterChips chips={chips} />

          <FilterBar
            action={ROUTE}
            filters={parsed.filters}
            periodOptions={periodOptions}
            stores={storeOptions}
            conditions={[]}
            leadSources={[]}
            conditionHint="Not applied here. The new and used mix is shown on every selling row instead, because a condition filter would narrow the gross numerator without narrowing the retail-unit denominator the sample floor is applied to."
          />
        </div>
      </OperatingPageHeader>

      {/* REGION 2 — what this surface measures, and how much of it clears the floor */}
      <Section rhythm="tight" id="summary">
        <Container width="full">
          <SectionHeader
            eyebrow={view.family}
            title="What this surface measures"
            lede="The four role families answer different questions because the facts credit them differently. A figure from one is not comparable with a figure from another."
          />
          <RoleSummarySection
            summary={summary}
            family={view.family}
            description={ROLE_DESCRIPTIONS[view.family]}
          />
        </Container>
      </Section>

      {/* REGION 3 — the comparison matrix, in stable non-performance order */}
      <Section rhythm="tight" tone="evidence" id="people">
        <Container width="full">
          <SectionHeader
            eyebrow="Comparison"
            title="Credited activity, by person"
            lede="Ordered by store, then role, then employee code. That order is fixed: there is no control here to sort by a measure, because a list sorted by gross is a leaderboard whether or not it is labelled one."
          />
          <EmployeeMatrix
            rows={view.rows}
            scale={scale}
            family={view.family}
            hrefFor={employeeHref}
            selectedCode={view.selected?.code ?? null}
          />
        </Container>
      </Section>

      {/* REGION 4 — the operating context that changes what the figures mean */}
      <Section rhythm="tight" id="context-store">
        <Container width="full">
          <SectionHeader
            eyebrow="Opportunity"
            title="What the stores had to work with"
            lede="Nobody can sell inventory the store does not have, and nobody can work a lead they were not assigned. These are properties of the store and the period, not of any person, and they are not on any employee row."
          />
          <StoreContextSection inventory={inventory} />
          {view.unassigned.length > 0 ? (
            <div className="mt-8">
              <SectionHeader
                eyebrow="Unassigned"
                title="Activity credited to nobody"
                lede="Real transactions and real opportunity with no employee credited. Inside every store total, outside the comparison above, and never given an invented employee code."
              />
              <UnassignedSection entries={view.unassigned} />
            </div>
          ) : null}
        </Container>
      </Section>

      {/* REGION 5 — the selected employee, when the URL names one */}
      {view.selected === null ? null : (
        <Section rhythm="tight" tone="evidence" id="selected">
          <Container width="full">
            <SectionHeader
              eyebrow="Selected"
              title={`${view.selected.code} in this period`}
              lede="An investigation surface: what was credited, the sample behind each figure, the mix around it, and where to look next. Not a personnel record."
            />
            <SelectedEmployeeSection row={view.selected} links={selectedLinks} />
          </Container>
        </Section>
      )}

      {/* REGION 6 — methodology, and only methodology */}
      <Section rhythm="tight" id="method">
        <Container width="full">
          <SectionHeader
            eyebrow="Method"
            title="How to read these figures"
            lede="The context that changes interpretation is on the rows above. What is behind this disclosure is how the arithmetic was done."
          />
          <Disclosure label="How to read employee metrics">
            <div className="flex flex-col gap-4 text-sm text-ink-muted">
              <p>
                <strong className="text-ink">Every ratio is a ratio of sums.</strong>{' '}
                Gross per retail unit is total gross divided by total retail units at the
                grain being reported — never an average of daily figures, per-person
                figures or store figures, which are different numbers and all of them
                wrong.
              </p>
              <p>
                <strong className="text-ink">
                  Each figure has its own sample, and its own floor verdict.
                </strong>{' '}
                Gross per unit is governed by retail units; contact rate by valid assigned
                leads; appointment-set rate by <em>contacted</em> leads, never by all
                valid ones; show rate by eligible appointments on the scheduled date;
                show-to-sale by appointments shown on the show date. One person can be
                comparison-eligible on one figure and not on another in the same period,
                and the page says so per figure.
              </p>
              <p>
                <strong className="text-ink">
                  The minimum sample is a publication discipline, not a performance
                  threshold.
                </strong>{' '}
                Below it this page prints the count and declines to print the ratio. That
                says the project will not compare a rate computed over a denominator this
                small. It says nothing whatever about the person, and it is not a failing
                grade.
              </p>
              <p>
                <strong className="text-ink">Four absences, four statements.</strong>{' '}
                &ldquo;Not applicable&rdquo; means the measure does not belong to the
                role. &ldquo;Insufficient sample&rdquo; means it does and the denominator
                is below the floor. &ldquo;No data&rdquo; means it does and nothing was
                observed. A zero is a real observed value and is none of those three.
              </p>
              <p>
                <strong className="text-ink">
                  History keeps its own store and title.
                </strong>{' '}
                Every row&rsquo;s role, store and tenure band are the values that were
                true when the activity happened, taken from the employee version the
                transaction points at. A transfer or a promotion later does not move
                earlier activity to the new store or relabel it with the new title.
              </p>
              <p>
                <strong className="text-ink">Certified units are used units.</strong> The
                certified count shown beside a mix is a subset of the used count, not a
                third category, and adding it to used would double count.
              </p>
              <p>
                <strong className="text-ink">
                  Cash deals are inside the finance denominators.
                </strong>{' '}
                Reserve and back gross per retail unit divide by every retail delivery,
                including cash deals, which cannot generate reserve. A different cash mix
                moves both figures for reasons unrelated to the finance office, which is
                why the structure mix is on the same row rather than in this drawer.
              </p>
              <p>
                <strong className="text-ink">
                  Appointments and leads are different populations.
                </strong>{' '}
                One lead can produce several appointments, so the lead-grain rates and the
                appointment-grain rates do not share a denominator. Show rate is on the
                scheduled date and excludes appointments cancelled in advance — an
                exclusion a store can game, which is why the cancellation count is
                published beside it. Show-to-sale is on the show date, so a visit late in
                a period whose sale lands days later still counts at the visit;
                period-to-date conversion improves as the data matures.
              </p>
              <p>
                <strong className="text-ink">
                  A response time nobody answered is not a fast one.
                </strong>{' '}
                A never-responded lead has no response value at all and is excluded from
                the median rather than counted as zero seconds. The count of leads never
                answered is published beside the median, because the statistic is blind to
                them.
              </p>
              <p>
                <strong className="text-ink">
                  Lead-source mix is context, not a score.
                </strong>{' '}
                This project publishes no lead-quality ranking, difficulty index or source
                weighting, and none is derivable here. The mix is shown because comparing
                two people&rsquo;s contact rates without it compares two different jobs.
              </p>
              <p>
                <strong className="text-ink">Nothing here is causal.</strong> A figure is
                credited to a person, observed for them, or on transactions they handled.
                The model records associations between people and outcomes; it does not
                isolate an individual effect, and no figure on this page supports a
                statement about individual skill.
              </p>
              <p>
                <strong className="text-ink">
                  Every person on this page is invented, and so is every number.
                </strong>{' '}
                The codes identify fictional employees in a synthetic dataset. No name,
                contact detail, hire date, termination date, exact tenure, age, pay,
                commission or protected attribute exists anywhere in the governed export
                this page reads, and no figure here is comparable to any published market
                figure.
              </p>
            </div>
          </Disclosure>
        </Container>
      </Section>
    </Canvas>
  )
}
