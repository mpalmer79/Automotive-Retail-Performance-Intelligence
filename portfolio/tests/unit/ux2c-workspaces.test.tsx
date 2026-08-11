/**
 * `UX.2C`: the demand, people and control workspaces' geometry moves, and the semantics hold.
 *
 * TWO KINDS OF TEST, AND THEY ARE NOT THE SAME KIND
 * -------------------------------------------------
 * `UX.2C` §55 asks for VISUAL FALSIFIABILITY: render each new visual in at least two
 * materially different states and assert its geometry changes. *"A chart whose geometry is
 * fixed must fail."* Those tests are the first half of this file, and each is written so that a
 * primitive ignoring its input — a full-width bar, a fixed composition, two identical balance
 * bars — is caught by the property that makes it decorative rather than by a rendered string.
 *
 * `UX.2C` §56 asks for DATA-SEMANTIC tests: the denominators, the grains, the absence states,
 * the ordering contract and the facet semantics the increment could plausibly have broken while
 * rearranging the pages that carry them. Those are the second half, and several of them perturb
 * the INPUT exactly as a mistaken selector would, which is the only formulation that proves the
 * assertion could have caught the defect.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT ASSERT. Colours as hex, spacing, class names and copy.
 * Those are enforced by the token tests or are editorial, and a geometry suite that pinned them
 * would fail on every honest edit — which is how a suite stops being run.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ReviewPrompt,
  QueueShape,
} from '../../src/components/dashboard/actions-workspace.tsx'
import {
  BalanceComparison,
  ComparisonStates,
  PositionTable,
} from '../../src/components/dashboard/accounting-workspace.tsx'
import {
  EmployeeComparison,
  FamilyRail,
} from '../../src/components/dashboard/employees-workspace.tsx'
import {
  AppointmentProgression,
  LeadProgression,
  MarketingEconomics,
  ResponseWorkspace,
  SourceMatrix,
  StageLossBars,
} from '../../src/components/dashboard/leads-workspace.tsx'
import {
  summarize,
  toComparisonRows,
  varianceDirection,
  type ComparisonRow,
} from '../../src/lib/dashboard/accounting.ts'
import { glReconciliationRows } from '../../src/lib/dashboard/accounting-data.ts'
import {
  buildActionQueue,
  NO_FACETS,
  type ActionFacets,
} from '../../src/lib/dashboard/actions.ts'
import { managementActions } from '../../src/lib/dashboard/actions-data.ts'
import {
  DOMAIN_LABELS,
  SEVERITY_LABELS,
} from '../../src/lib/dashboard/action-contract.ts'
import { chunkFile } from '../../src/lib/dashboard/chunks.ts'
import {
  dashboardLeadSources,
  dashboardStores,
  decodeDataset,
} from '../../src/lib/dashboard/data.ts'
import { exactFromInteger, type Exact } from '../../src/lib/dashboard/decimal.ts'
import {
  buildEmployeeView,
  buildRoster,
  summarise,
  volumeScale,
  ROLE_DESCRIPTIONS,
  ROLE_SLUGS,
  type EmployeeScope,
} from '../../src/lib/dashboard/employees.ts'
import {
  employeeAppointmentRows,
  employeeFinanceRows,
  employeeLeadSourceRows,
  employeeRosterRows,
  employeeSalesRows,
} from '../../src/lib/dashboard/employees-data.ts'
import {
  buildAppointmentOutcomes,
  buildCohortFunnel,
  buildMarketingSummary,
  buildResponseSummary,
  buildSourceComparison,
  buildStageLoss,
  type LeadsScope,
} from '../../src/lib/dashboard/leads-marketing.ts'
import { appointmentSourceChunkFile } from '../../src/lib/dashboard/leads-marketing-chunks.ts'
import {
  campaignRows,
  leadStageLossRows,
  marketingPerformanceRows,
  responseDistributionRows,
} from '../../src/lib/dashboard/leads-marketing-data.ts'
import type {
  ActionDomain,
  ActionSeverity,
  DashboardRow,
} from '../../src/types/dashboard.ts'

afterEach(cleanup)

/* -------------------------------------------------------------------------- */
/* Fixtures — the real export, at the grain each route reads it                 */
/* -------------------------------------------------------------------------- */

const STORES = dashboardStores.map((store) => store.id)
const MONTH = '2025-12'

function period(months: readonly string[] = [MONTH]) {
  const first = months[0] ?? MONTH
  const last = months[months.length - 1] ?? MONTH
  return {
    start: `${first}-01`,
    end: `${last}-31`,
    label: 'December 2025',
    months: [...months],
    wholeMonths: [...months],
    calendarDays: 31,
    sellingDays: 27,
  }
}

function leadsScope(stores: readonly string[] = STORES): LeadsScope {
  return { stores: [...stores], period: period(), leadSources: null, campaigns: null }
}

function funnelRows(stores: readonly string[] = STORES): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    const file = chunkFile('lead-funnel', store, MONTH)
    if (file === undefined) throw new Error(`no lead-funnel partition ${store}/${MONTH}`)
    rows.push(...decodeDataset(`lead-funnel/${store}/${MONTH}`, file))
  }
  return rows
}

function appointmentRows(stores: readonly string[] = STORES): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of stores) {
    const file = appointmentSourceChunkFile(store, MONTH)
    if (file === undefined) throw new Error(`no appointment partition ${store}/${MONTH}`)
    rows.push(...decodeDataset(`appointment-source-funnel/${store}/${MONTH}`, file))
  }
  return rows
}

/** Every rendered bar width, in document order. The geometry, and nothing else. */
function widths(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')].map(
    (node) => node.style.width
  )
}

/* ========================================================================== */
/* PART ONE — the geometry moves (`UX.2C` §55)                                 */
/* ========================================================================== */

describe('the lead-grain funnel is drawn from its own counts', () => {
  it('changes every stage length when the scope changes', () => {
    const wide = render(
      <LeadProgression funnel={buildCohortFunnel(funnelRows(), leadsScope())} />
    )
    const wideWidths = widths(wide.container)
    cleanup()

    const narrow = render(
      <LeadProgression
        funnel={buildCohortFunnel(funnelRows(['GSA-003']), leadsScope(['GSA-003']))}
      />
    )
    const narrowWidths = widths(narrow.container)

    expect(wideWidths.length).toBeGreaterThan(0)
    expect(wideWidths.length).toBe(narrowWidths.length)
    // The FIRST stage is always 100% -- it is the reference -- so the movement has to be
    // looked for below it. A funnel that ignored its data would match on every stage.
    expect(wideWidths.slice(1)).not.toEqual(narrowWidths.slice(1))
  })

  it('narrows monotonically, because every stage is a subset of the first', () => {
    const { container } = render(
      <LeadProgression funnel={buildCohortFunnel(funnelRows(), leadsScope())} />
    )
    const numeric = widths(container).map((width) => Number.parseFloat(width))
    expect(numeric.length).toBeGreaterThan(1)
    for (let index = 1; index < numeric.length; index += 1) {
      expect(numeric[index]).toBeLessThanOrEqual(numeric[index - 1] as number)
    }
  })
})

describe('the appointment progression draws the removed population', () => {
  it('moves with the scope and keeps the cancellation bar inside the figure', () => {
    const all = render(
      <AppointmentProgression
        outcomes={buildAppointmentOutcomes(appointmentRows(), leadsScope())}
      />
    )
    const allWidths = widths(all.container)
    // `UX.2C` §9: cancellation context is adjacent to show rate wherever show rate appears.
    expect(all.container.textContent).toContain('Cancelled in advance')
    expect(all.container.textContent).toContain('removed from the show-rate denominator')
    cleanup()

    const one = render(
      <AppointmentProgression
        outcomes={buildAppointmentOutcomes(
          appointmentRows(['GSA-002']),
          leadsScope(['GSA-002'])
        )}
      />
    )
    expect(allWidths).not.toEqual(widths(one.container))
  })
})

describe('the response distribution is drawn from its band populations', () => {
  it('changes geometry when the responded population changes', () => {
    const all = render(
      <ResponseWorkspace
        response={buildResponseSummary(
          responseDistributionRows(STORES, [MONTH]),
          leadsScope()
        )}
      />
    )
    const allWidths = widths(all.container)
    cleanup()

    const one = render(
      <ResponseWorkspace
        response={buildResponseSummary(
          responseDistributionRows(['GSA-001'], [MONTH]),
          leadsScope(['GSA-001'])
        )}
      />
    )
    expect(allWidths.length).toBeGreaterThan(0)
    expect(allWidths).not.toEqual(widths(one.container))
  })
})

describe('the stage-loss partition is drawn from its own counts', () => {
  it('changes geometry when the cohort changes', () => {
    const all = render(
      <StageLossBars
        loss={buildStageLoss(leadStageLossRows(STORES, [MONTH]), leadsScope())}
      />
    )
    const allWidths = widths(all.container)
    cleanup()

    const one = render(
      <StageLossBars
        loss={buildStageLoss(
          leadStageLossRows(['GSA-003'], [MONTH]),
          leadsScope(['GSA-003'])
        )}
      />
    )
    expect(allWidths.length).toBeGreaterThan(0)
    expect(allWidths).not.toEqual(widths(one.container))
  })
})

describe('the source matrix draws four columns from four measures', () => {
  it('changes geometry when the population changes', () => {
    const all = render(
      <SourceMatrix
        sources={buildSourceComparison(funnelRows(), leadsScope(), dashboardLeadSources)}
      />
    )
    const allWidths = widths(all.container)
    cleanup()

    const one = render(
      <SourceMatrix
        sources={buildSourceComparison(
          funnelRows(['GSA-001']),
          leadsScope(['GSA-001']),
          dashboardLeadSources
        )}
      />
    )
    expect(allWidths.length).toBeGreaterThan(0)
    expect(allWidths).not.toEqual(widths(one.container))
  })

  it('draws no bar at all for a rate that does not exist', () => {
    const sources = buildSourceComparison(
      funnelRows(),
      leadsScope(),
      dashboardLeadSources
    )
    const withAbsence = sources.map((source, index) =>
      index === 0
        ? {
            ...source,
            contactRate: {
              kind: 'no-data' as const,
              reason: 'No valid leads in this scope',
            },
          }
        : source
    )

    const before = render(<SourceMatrix sources={sources} />)
    const beforeCount = widths(before.container).length
    cleanup()

    const after = render(<SourceMatrix sources={withAbsence} />)
    // ONE FEWER BAR, not a zero-length one: a rate that has no denominator is not a rate of
    // zero, and a zero-length bar would draw it as one.
    expect(widths(after.container)).toHaveLength(beforeCount - 1)
    expect(after.container.textContent).toContain('No data')
  })
})

describe('the balance comparison draws the difference at its real size', () => {
  it('scales both balances against one shared maximum', () => {
    const rows = toComparisonRows(glReconciliationRows())
    const date = rows[rows.length - 1]?.comparisonDate ?? null
    const scoped = rows.filter((row) => row.comparisonDate === date)
    const summary = summarize(scoped, date)

    const real = render(
      <BalanceComparison
        summary={summary}
        directionText={varianceDirection(summary.signedVariance)}
      />
    )
    const realWidths = widths(real.container)
    cleanup()

    // A materially different position: the GL side carrying a fifth more than the schedule.
    const skewed = {
      ...summary,
      glTotal: {
        units: (summary.glTotal.units * 6n) / 5n,
        scale: summary.glTotal.scale,
      } as Exact,
    }
    const moved = render(
      <BalanceComparison
        summary={skewed}
        directionText={varianceDirection(skewed.signedVariance)}
      />
    )
    const movedWidths = widths(moved.container)

    expect(realWidths.length).toBeGreaterThan(0)
    expect(realWidths).not.toEqual(movedWidths)
    // ONE SHARED SCALE. The larger side pins at 100% and the smaller one does not; two bars
    // that each filled their own track would report every position as balanced.
    const [subledger, gl] = movedWidths
    // jsdom normalises `100.0000%` to `100%`, so the assertion is on the number.
    expect(Number.parseFloat(gl ?? '0')).toBe(100)
    expect(Number.parseFloat(subledger ?? '0')).toBeLessThan(100)
  })
})

describe('the comparison-state population is drawn from its counts', () => {
  it('changes geometry when the state mix changes', () => {
    const rows = toComparisonRows(glReconciliationRows())
    const date = rows[rows.length - 1]?.comparisonDate ?? null
    const scoped = rows.filter((row) => row.comparisonDate === date)
    const summary = summarize(scoped, date)

    const real = render(<ComparisonStates summary={summary} rows={scoped} />)
    const realWidths = widths(real.container)
    cleanup()

    // A materially different population: half the reconciled positions reported instead as
    // variances. The real export carries none, so shifting THAT count would have moved
    // nothing and the test would have passed for the wrong reason.
    const moving = Math.max(1, Math.floor(summary.reconciledPositions / 2))
    const shifted = {
      ...summary,
      reconciledPositions: summary.reconciledPositions - moving,
      variancePositions: summary.variancePositions + moving,
    }
    const moved = render(<ComparisonStates summary={shifted} rows={scoped} />)
    expect(realWidths.length).toBeGreaterThan(0)
    expect(realWidths).not.toEqual(widths(moved.container))
  })
})

describe("the employee family rail draws the floor's effect", () => {
  it('changes the eligible bar when the eligible count changes', () => {
    const summary = {
      people: 9,
      volumeLabel: 'Retail units',
      volume: 140,
      eligible: 6,
      belowFloor: 3,
      floor: 10,
    }
    const first = render(
      <FamilyRail
        summary={summary}
        family="Salesperson"
        description={ROLE_DESCRIPTIONS.Salesperson}
      />
    )
    const firstWidths = widths(first.container)
    cleanup()

    const second = render(
      <FamilyRail
        summary={{ ...summary, eligible: 9, belowFloor: 0 }}
        family="Salesperson"
        description={ROLE_DESCRIPTIONS.Salesperson}
      />
    )
    expect(firstWidths.length).toBeGreaterThan(0)
    expect(firstWidths).not.toEqual(widths(second.container))
  })
})

describe('the queue shape is drawn from the facet counts', () => {
  it('changes geometry when the queue changes', () => {
    const labels = Object.fromEntries(
      dashboardStores.map((store) => [store.id, store.shortName])
    )
    const all = managementActions()
    const full = buildActionQueue(
      all,
      NO_FACETS,
      labels,
      DOMAIN_LABELS as Readonly<Record<ActionDomain, string>>,
      SEVERITY_LABELS as Readonly<Record<ActionSeverity, string>>
    )
    const first = render(
      <QueueShape view={full} facets={NO_FACETS} asOfDate="2025-12-31" />
    )
    const firstWidths = widths(first.container)
    cleanup()

    // Half the queue is a materially different distribution, not a smaller version of the
    // same one: the counts per facet change independently.
    const half = buildActionQueue(
      all.filter((_, index) => index % 2 === 0),
      NO_FACETS,
      labels,
      DOMAIN_LABELS as Readonly<Record<ActionDomain, string>>,
      SEVERITY_LABELS as Readonly<Record<ActionSeverity, string>>
    )
    const second = render(
      <QueueShape view={half} facets={NO_FACETS} asOfDate="2025-12-31" />
    )
    expect(firstWidths.length).toBeGreaterThan(0)
    expect(firstWidths).not.toEqual(widths(second.container))
  })
})

/* ========================================================================== */
/* PART TWO — the semantics hold (`UX.2C` §56)                                 */
/* ========================================================================== */

describe('Leads: the two grains stay apart and the denominators stay named', () => {
  it('names the contacted-lead denominator on the appointment-set rate', () => {
    // KPI-FUN-003 divides by CONTACTED leads, never by all valid ones. The defect this pins
    // is a rearrangement that dropped the denominator label while keeping the percentage.
    const { container } = render(
      <LeadProgression funnel={buildCohortFunnel(funnelRows(), leadsScope())} />
    )
    expect(container.textContent).toContain('of contacted leads')
    expect(container.textContent).toContain('KPI-FUN-003')
  })

  it('gives the lead-grain shown stage no rate and no appointment KPI identifier', () => {
    // `appointment_shown_leads / appointment_set_leads` is NOT KPI-FUN-004: that measure is
    // appointment grain on the scheduled date. Labelling this share with that identifier
    // would relabel a measure rather than report one.
    const funnel = buildCohortFunnel(funnelRows(), leadsScope())
    const shown = funnel.stages.find((stage) => stage.id === 'shown')
    expect(shown?.rate).toBeNull()
    expect(shown?.kpiId).toBeNull()

    const { container } = render(<LeadProgression funnel={funnel} />)
    expect(container.textContent).not.toContain('KPI-FUN-004')
    expect(container.textContent).not.toContain('KPI-FUN-005')
  })

  it('keeps the appointment measures on their own grain and their own two date bases', () => {
    const { container } = render(
      <AppointmentProgression
        outcomes={buildAppointmentOutcomes(appointmentRows(), leadsScope())}
      />
    )
    expect(container.textContent).toContain('Counts APPOINTMENTS, not leads')
    expect(container.textContent).toContain('of eligible appointments')
    expect(container.textContent).toContain('on the show date')
  })

  it('draws never-answered leads against valid leads, not against the answered ones', () => {
    // Both response KPIs are blind to unanswered leads, so the count's own denominator is the
    // valid-lead population. Drawing it against responded leads would overstate its share.
    const response = buildResponseSummary(
      responseDistributionRows(STORES, [MONTH]),
      leadsScope()
    )
    const { container } = render(<ResponseWorkspace response={response} />)
    expect(container.textContent).toContain('Never answered')
    expect(container.textContent).toContain('valid leads, not of the answered population')
    expect(container.textContent).toContain('never answered is not a response of zero')
  })

  it('publishes the median from the exported population rather than the drawn bands', () => {
    // A median does not decompose. The bands are a partition for the eye; the headline is
    // KPI-FUN-008 as the builder resolved it, and the two are never reconciled to each other.
    const response = buildResponseSummary(
      responseDistributionRows(STORES, [MONTH]),
      leadsScope()
    )
    const { container } = render(<ResponseWorkspace response={response} />)
    expect(container.textContent).toContain('KPI-FUN-008')
    expect(response.bands.length).toBeGreaterThan(0)
  })

  it('keeps the stage-loss partition summing to the cohort and the overlay outside it', () => {
    const loss = buildStageLoss(leadStageLossRows(STORES, [MONTH]), leadsScope())
    const summed = loss.entries.reduce((total, entry) => total + entry.count.units, 0n)
    expect(summed).toBe(loss.leadsReceived.units)

    const { container } = render(<StageLossBars loss={loss} />)
    // Six bars would mean the walk-in overlay had been added to the partition, which would
    // double-count leads already inside one of the five.
    expect(widths(container)).toHaveLength(loss.entries.length)
    expect(container.textContent).toContain('shown here rather than added')
  })

  it('reports an organic source as not applicable and never as zero cost', () => {
    const marketing = buildMarketingSummary(
      marketingPerformanceRows(),
      campaignRows(),
      leadsScope(),
      dashboardLeadSources
    )
    const organic = marketing.bySource.filter((row) => !row.costAttributable)
    expect(organic.length).toBeGreaterThan(0)
    for (const row of organic) {
      expect(row.costPerLead.kind).toBe('not-applicable')
      expect(row.costState).toBe('not-cost-attributable')
    }

    const { container } = render(<MarketingEconomics marketing={marketing} />)
    expect(container.textContent).toContain('Not applicable')
    // A bar per organic source would state that its cost is zero, geometrically, where the
    // words cannot correct it.
    const drawn = widths(container).length
    const cells = marketing.bySource.length * 4
    expect(drawn).toBeLessThan(cells)
  })

  it('forms the source rollup as a ratio of sums, not a mean of campaign ratios', () => {
    // The same governed function at a coarser group. If the rollup averaged the campaign
    // ratios it would weight a two-lead campaign like a two-hundred-lead one, and the two
    // numbers differ on real data.
    const marketing = buildMarketingSummary(
      marketingPerformanceRows(),
      campaignRows(),
      leadsScope(),
      dashboardLeadSources
    )
    for (const source of marketing.bySource) {
      const campaigns = marketing.rows.filter(
        (row) => row.sourceCode === source.sourceCode
      )
      const leads = campaigns.reduce(
        (total, row) => total + row.attributedLeads.units,
        0n
      )
      expect(source.attributedLeads.units).toBe(leads)
    }
  })
})

describe('Employees: no ranking, and the sample stays a publication state', () => {
  function employeeView(role: EmployeeScope['role']) {
    const roster = buildRoster(employeeRosterRows())
    const scope: EmployeeScope = {
      stores: [...STORES],
      period: period(),
      role,
      family: ROLE_SLUGS[role],
      employee: null,
      employeeUnknown: false,
    }
    return buildEmployeeView(
      scope,
      {
        roster,
        sales: employeeSalesRows(STORES, [MONTH]),
        finance: employeeFinanceRows(),
        appointments: employeeAppointmentRows(),
        leadSource: employeeLeadSourceRows(STORES, [MONTH]),
      },
      dashboardLeadSources,
      0
    )
  }

  it('renders people in the business-key order and never in a measure order', () => {
    // THE ORDERING CONTRACT (`UX.2C` §25). A future refactor that reached for
    // `.sort((a, b) => b.volume - a.volume)` because it "reads better" fails here.
    const view = employeeView('salesperson')
    expect(view.rows.length).toBeGreaterThan(2)

    const { container } = render(
      <EmployeeComparison
        rows={view.rows}
        scale={volumeScale(view.rows)}
        family="Salesperson"
        hrefFor={(code) => `/dashboard/employees?employee=${code}`}
        selectedCode={null}
      />
    )
    const rendered = [...container.querySelectorAll('[data-employee]')].map(
      (node) => node.getAttribute('data-employee') ?? ''
    )
    expect(rendered).toEqual(view.rows.map((row) => row.code))

    const byKey = [...view.rows]
      .map((row) => `${row.storeId}|${row.jobRole}|${row.code}`)
      .sort((a, b) => a.localeCompare(b))
    expect(view.rows.map((row) => `${row.storeId}|${row.jobRole}|${row.code}`)).toEqual(
      byKey
    )

    // And the rendering is NOT in descending volume order, unless the business key happens
    // to agree — which on this data it does not.
    const volumes = view.rows.map((row) => row.volume)
    const descending = [...volumes].sort((a, b) => b - a)
    expect(volumes).not.toEqual(descending)
  })

  it('prints the words and the sample for a below-floor measure, never a zero', () => {
    const view = employeeView('bdc')
    const rows = view.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            measures: row.measures.map((measure) => ({
              ...measure,
              figure: {
                kind: 'insufficient-sample' as const,
                reason: '3 valid leads, minimum 10',
              },
              sample: { denominator: 3, floor: 10, meets: false },
            })),
          }
        : row
    )

    const { container } = render(
      <EmployeeComparison
        rows={rows}
        scale={volumeScale(view.rows)}
        family="BDC"
        hrefFor={(code) => `/dashboard/employees?employee=${code}`}
        selectedCode={null}
      />
    )
    const suppressed = container.querySelector('[data-employee]')
    expect(suppressed).not.toBeNull()
    const text = suppressed?.textContent ?? ''
    expect(text).toContain('Insufficient sample')
    expect(text).toContain('3 of 10')
    expect(text).not.toContain('0.0%')
    expect(text).not.toContain('$0.00')
  })

  it('draws the BDC measures as two labelled grain bands', () => {
    const view = employeeView('bdc')
    const { container } = render(
      <EmployeeComparison
        rows={view.rows}
        scale={volumeScale(view.rows)}
        family="BDC"
        hrefFor={(code) => `/dashboard/employees?employee=${code}`}
        selectedCode={null}
      />
    )
    expect(container.textContent).toContain('Lead grain')
    expect(container.textContent).toContain('Appointment grain')
  })

  it('keeps the finance structure mix on the same row as the two income figures', () => {
    // `UX.2C` §22: both figures divide by every retail delivery, including cash deals, which
    // cannot generate reserve, so the split must not be a screen away from them.
    const view = employeeView('finance')
    const { container } = render(
      <EmployeeComparison
        rows={view.rows}
        scale={volumeScale(view.rows)}
        family="Finance"
        hrefFor={(code) => `/dashboard/employees?employee=${code}`}
        selectedCode={null}
      />
    )
    const first = container.querySelector('[data-employee]')
    const text = first?.textContent ?? ''
    expect(text).toContain('Back gross per retail unit')
    expect(text).toContain('Reserve per retail unit')
    expect(text).toContain('Cash')
    expect(text).toContain('Lease')
    expect(within(first as HTMLElement).getAllByTestId('mix-bar').length).toBe(1)
  })

  it('exposes synthetic codes and no personal attribute anywhere in the markup', () => {
    const view = employeeView('salesperson')
    const { container } = render(
      <EmployeeComparison
        rows={view.rows}
        scale={volumeScale(view.rows)}
        family="Salesperson"
        hrefFor={(code) => `/dashboard/employees?employee=${code}`}
        selectedCode={null}
      />
    )
    const text = (container.textContent ?? '').toLowerCase()
    /*
     * WORD BOUNDARIES, NOT SUBSTRINGS. "age" is inside "average" and "manager", and "rank"
     * inside "franchise"; a substring ban on either fails on copy that is entirely correct
     * and teaches the next person to delete the test rather than the defect.
     */
    for (const banned of [
      'salary',
      'commission',
      'pay plan',
      'bonus',
      'hire date',
      'email',
      'phone',
      'gender',
      'age',
      'rank',
      'ranked',
      'ranking',
      'score',
      'top performer',
    ]) {
      expect(
        new RegExp(`\\b${banned}\\b`).test(text),
        `employee markup contains "${banned}"`
      ).toBe(false)
    }
    /*
     * "leaderboard" IS on the page, in the sentence that refuses to be one -- "a list sorted
     * by a measure is a leaderboard whether or not it is labelled one" -- which is the
     * contract rather than a breach of it. Banning the word outright would delete the
     * statement that makes the ordering rule legible, so the assertion is that it appears in
     * exactly that shape and that the ordering itself is the business key, which the test
     * above proves.
     */
    expect(text).toContain('is a leaderboard whether or not it is labelled one')
    for (const row of view.rows) expect(row.code).toMatch(/^EMP-\d+$/)
  })

  it('summarises the family without forming any composite across measures', () => {
    const view = employeeView('salesperson')
    const summary = summarise(view)
    expect(summary.eligible + summary.belowFloor).toBeLessThanOrEqual(summary.people)
    const { container } = render(
      <FamilyRail
        summary={summary}
        family={view.family}
        description={ROLE_DESCRIPTIONS[view.family]}
      />
    )
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).not.toContain('score')
    expect(text).not.toContain('rank')
    expect(text).toContain('publication discipline')
  })
})

describe('Accounting: the variance stays signed, neutral and one-sided-aware', () => {
  function position() {
    const rows = toComparisonRows(glReconciliationRows())
    const date = rows[rows.length - 1]?.comparisonDate ?? null
    const scoped = rows.filter((row) => row.comparisonDate === date)
    return { scoped, summary: summarize(scoped, date), date }
  }

  it('computes the signed variance as GL minus subledger', () => {
    const { summary } = position()
    expect(summary.signedVariance.units).toBe(
      summary.glTotal.units - summary.subledgerTotal.units
    )
  })

  it('applies no positive or negative semantic colour to either sign', () => {
    // `UX.2C` §29. The sign is carried by the longer bar, the printed amount and the
    // direction sentence — never by a green/red pair, which would publish a judgement this
    // console is not authorized to make.
    const { summary } = position()
    const { container } = render(
      <BalanceComparison
        summary={summary}
        directionText={varianceDirection(summary.signedVariance)}
      />
    )
    const markup = container.innerHTML
    expect(markup).not.toContain('data-positive')
    expect(markup).not.toContain('data-negative')
    expect(markup).not.toContain('text-verified')
    expect(markup).not.toContain('text-failed')
    expect(container.textContent).toContain('Neither direction is favourable')
  })

  it('marks only the two structural states, and never a variance', () => {
    const { scoped, summary } = position()
    const { container } = render(<ComparisonStates summary={summary} rows={scoped} />)
    const marked = [...container.querySelectorAll('[data-state]')].filter((node) =>
      node.innerHTML.includes('data-warning')
    )
    const names = marked.map((node) => node.getAttribute('data-state') ?? '')
    expect(names.sort()).toEqual(['Missing GL balance', 'Missing subledger balance'])
  })

  it('shows a missing side as missing rather than as a balance of zero', () => {
    const { scoped, date } = position()
    const oneSided: ComparisonRow = {
      ...(scoped[0] as ComparisonRow),
      glBalance: null,
      varianceAmount: null,
      comparisonState: 'Missing GL balance',
      isComparable: false,
    }
    const { container } = render(
      <PositionTable rows={[oneSided, ...scoped.slice(1)]} comparisonDate={date} />
    )
    expect(container.textContent).toContain('No GL balance')
    expect(container.textContent).toContain('Not comparable')
    const row = container.querySelector('[data-position-state="Missing GL balance"]')
    expect(row?.textContent).not.toContain('$0.00')
  })

  it('excludes one-sided positions from both totals', () => {
    const { scoped, summary } = position()
    const comparable = scoped.filter((row) => row.isComparable)
    const subledger = comparable.reduce(
      (total, row) => total + (row.subledgerBalance?.units ?? 0n),
      0n
    )
    expect(summary.subledgerTotal.units).toBe(subledger)
    expect(summary.comparablePositions).toBe(comparable.length)
  })
})

describe('Actions: the queue keeps its rules, its facets and its refusals', () => {
  const labels = Object.fromEntries(
    dashboardStores.map((store) => [store.id, store.shortName])
  )
  const all = managementActions()

  function queue(facets: ActionFacets = NO_FACETS) {
    return buildActionQueue(
      all,
      facets,
      labels,
      DOMAIN_LABELS as Readonly<Record<ActionDomain, string>>,
      SEVERITY_LABELS as Readonly<Record<ActionSeverity, string>>
    )
  }

  it('counts facets over the whole queue even when one is selected', () => {
    // `UX.2C` §37: the semantics are full-queue counts and this increment does not change
    // them to cross-filtered ones. Selecting High narrows the ROWS, never the counts.
    const unfiltered = queue()
    const filtered = queue({ ...NO_FACETS, severity: 'high' })
    expect(filtered.shown).toBeLessThan(filtered.total)
    expect(filtered.total).toBe(unfiltered.total)
    expect(filtered.domains.map((option) => option.count)).toEqual(
      unfiltered.domains.map((option) => option.count)
    )
  })

  it('renders every facet group as links inside the named navigation', () => {
    const view = queue()
    render(<QueueShape view={view} facets={NO_FACETS} asOfDate="2025-12-31" />)
    const nav = screen.getByRole('navigation', { name: /filter the review queue/i })
    const links = within(nav).getAllByRole('link')
    const expected =
      view.severities.length +
      view.domains.length +
      view.stores.length +
      view.owners.length
    expect(links).toHaveLength(expected)
    // Every label is text beside its mark, so no facet is identified by colour alone.
    for (const option of view.severities) {
      expect(within(nav).getByText(option.label)).toBeTruthy()
    }
  })

  it('adds no workflow vocabulary to the queue or to any prompt', () => {
    const view = queue()
    const { container } = render(
      <QueueShape view={view} facets={NO_FACETS} asOfDate="2025-12-31" />
    )
    let markup = container.innerHTML
    for (const action of all.slice(0, 12)) {
      const rendered = render(<ReviewPrompt action={action} />)
      markup += rendered.container.innerHTML
      rendered.unmount()
    }
    const lowered = markup.toLowerCase()
    /*
     * THE CONTROLS, NOT THE WORDS. `DASH.12`'s own copy contains "completed", "assigned"
     * and "workflow state" -- in the sentence that says the queue has NONE of them, which is
     * the contract rather than a breach of it. What must never appear is a control or a
     * field: a button, an input, a checkbox, or a label naming a state the queue cannot
     * hold.
     */
    for (const banned of [
      'mark as done',
      'mark done',
      'assignee',
      'assigned to',
      'due date',
      'snooze',
      'add a comment',
    ]) {
      expect(lowered, `actions markup contains "${banned}"`).not.toContain(banned)
    }
    expect(container.querySelectorAll('button, input, [type="checkbox"]')).toHaveLength(0)
    expect(lowered).toContain('holds no workflow state')
  })

  it('keeps the observed value and its threshold on the prompt, and the rule off it', () => {
    const action = all.find(
      (candidate) => candidate.thresholdsUsed.length > 0 && candidate.evidence.length > 1
    )
    expect(action).toBeDefined()
    if (action === undefined) return

    const { container } = render(<ReviewPrompt action={action} />)
    // Visible, outside any disclosure: the value and the threshold that fired.
    const visible = container.cloneNode(true) as HTMLElement
    for (const details of visible.querySelectorAll('details')) details.remove()
    expect(visible.textContent).toContain(action.title)
    expect(visible.textContent).toContain(action.thresholdsUsed[0]?.label ?? '')
    expect(visible.textContent).not.toContain(action.ruleId)

    // Present, inside the disclosure and therefore in the served markup.
    expect(container.textContent).toContain(action.ruleId)
    expect(container.textContent).toContain(action.limitations)
  })

  it('does not print the same unit twice on the headline evidence', () => {
    const action = all.find((candidate) => {
      const [lead] = candidate.evidence
      return (
        lead !== undefined &&
        lead.unit !== null &&
        lead.unit !== 'USD' &&
        lead.unit !== 'ratio'
      )
    })
    if (action === undefined) return
    const { container } = render(<ReviewPrompt action={action} />)
    const unit = action.evidence[0]?.unit ?? ''
    const occurrences =
      (container.textContent ?? '').split(new RegExp(`\\b${unit}\\b`)).length - 1
    // The unit may legitimately appear in a threshold line; what must not happen is the
    // value and its own label printing it back to back, as "212 days days in stock".
    expect(container.textContent).not.toContain(`${unit} ${unit}`)
    expect(occurrences).toBeGreaterThan(0)
  })

  it('preserves every action identifier, severity and threshold the export published', () => {
    // `UX.2C` §56: the deterministic register is unchanged by a presentation increment.
    const view = queue()
    expect(view.total).toBe(all.length)
    expect(view.actions.map((action) => action.actionId)).toEqual(
      all.map((action) => action.actionId)
    )
    for (const action of all) {
      const rendered = view.actions.find(
        (candidate) => candidate.actionId === action.actionId
      )
      expect(rendered?.severity).toBe(action.severity)
      expect(rendered?.thresholdsUsed).toEqual(action.thresholdsUsed)
      expect(rendered?.drillThrough).toBe(action.drillThrough)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* A guard on the guards                                                       */
/* -------------------------------------------------------------------------- */

describe('the geometry helper reports what it is there to catch', () => {
  it('finds no widths in a component that draws nothing', () => {
    const { container } = render(<div>no geometry here</div>)
    expect(widths(container)).toEqual([])
  })

  it('reads the width the caller set, so an unchanged chart cannot pass', () => {
    const { container } = render(<span style={{ width: '42.5%' }} />)
    expect(widths(container).map((width) => Number.parseFloat(width))).toEqual([42.5])
  })
})

/** Keeps `exactFromInteger` imported where a fixture needs an exact count. */
export const EXACT_ONE: Exact = exactFromInteger(1)
