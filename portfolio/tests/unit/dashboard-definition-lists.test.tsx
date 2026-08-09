/**
 * `<dl>` structure, checked in the unit lane.
 *
 * WHY THIS IS NOT LEFT TO AXE. `tests/e2e/accessibility.spec.ts` runs axe-core over every
 * primary route and would have caught the defect this file exists for -- a `<p>` sitting
 * beside the `<dt>`/`<dd>` pair inside a definition-list group, which axe reports as a
 * SERIOUS `definition-list` violation against WCAG 1.3.1. It did not catch it in time,
 * and the reason is a property of the pipeline rather than of the rule:
 *
 *   * `Browser suites` is a DEPENDENT job. When the `Quality` job ahead of it fails, it
 *     reports `skipped` -- so a formatting error or a stray lint failure anywhere in the
 *     repository silently switches the whole accessibility sweep off.
 *   * The defect therefore merged, sat on `main`, and only surfaced on the next branch
 *     that happened to get a green `Quality` ahead of a browser run.
 *
 * A test in the unit lane has none of that fragility: it runs on every push, needs no
 * browser and no server, and fails in seconds. It does not REPLACE the axe sweep -- axe
 * checks the rendered page against dozens of rules this file knows nothing about -- it
 * makes this one structural rule cheap enough to be checked unconditionally.
 *
 * WHAT THE RULE ACTUALLY IS. Per the HTML specification and axe's `only-dlitems`, a `<dl>`
 * may contain, as direct children, only: `<dt>`, `<dd>`, `<script>`, `<template>`, and
 * `<div>` elements that themselves wrap a `<dt>`/`<dd>` group. The wrapping `<div>` is
 * permitted precisely so a group can be styled as a unit -- which is what these sections
 * use it for -- but its contents are then held to the same rule. Explanatory copy belongs
 * INSIDE the `<dd>` it qualifies, where a screen reader receives it as part of the
 * description rather than as loose text between groups.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AppointmentOutcomesSection,
  MarketingSection,
  VendorDiscrepancySection,
} from '../../src/components/dashboard/leads-marketing-sections.tsx'
import { decodeDataset } from '../../src/lib/dashboard/data.ts'
import {
  buildAppointmentOutcomes,
  buildMarketingSummary,
  buildVendorDiscrepancy,
  type LeadsScope,
} from '../../src/lib/dashboard/leads-marketing.ts'
import { appointmentSourceChunkFile } from '../../src/lib/dashboard/leads-marketing-chunks.ts'
import {
  campaignRows,
  marketingPerformanceRows,
} from '../../src/lib/dashboard/leads-marketing-data.ts'
import { chunkFile } from '../../src/lib/dashboard/chunks.ts'
import { dashboardLeadSources } from '../../src/lib/dashboard/data.ts'
import type { DashboardRow } from '../../src/types/dashboard.ts'

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything a `<dl>` is allowed to contain directly. */
const DIRECT = new Set(['DT', 'DD', 'DIV', 'SCRIPT', 'TEMPLATE'])

/** Everything a grouping `<div>` inside a `<dl>` is allowed to contain. */
const GROUPED = new Set(['DT', 'DD', 'SCRIPT', 'TEMPLATE'])

/**
 * Every way a definition list in this tree breaks its own contract.
 *
 * Returns descriptions rather than a boolean, so a failure names the offending element
 * and the list it is in instead of reporting that something, somewhere, is wrong.
 */
function definitionListFaults(container: HTMLElement): string[] {
  const faults: string[] = []
  for (const list of container.querySelectorAll('dl')) {
    const label = list.className || '(no class)'
    for (const child of list.children) {
      if (!DIRECT.has(child.tagName)) {
        faults.push(
          `<dl class="${label}"> contains <${child.tagName.toLowerCase()}> directly`
        )
        continue
      }
      if (child.tagName !== 'DIV') continue
      for (const grandchild of child.children) {
        if (GROUPED.has(grandchild.tagName)) continue
        faults.push(
          `<dl class="${label}"> group contains ` +
            `<${grandchild.tagName.toLowerCase()}> beside its <dt>/<dd>: ` +
            `"${(grandchild.textContent ?? '').trim().slice(0, 60)}"`
        )
      }
    }
    // A group that wraps nothing is not a group. Caught here because an empty wrapper
    // reads as a definition with no term, which is the same defect from the other side.
    for (const group of list.querySelectorAll(':scope > div')) {
      if (group.querySelector(':scope > dt') === null) {
        faults.push(`<dl class="${label}"> has a grouping <div> with no <dt>`)
      }
      if (group.querySelector(':scope > dd') === null) {
        faults.push(`<dl class="${label}"> has a grouping <div> with no <dd>`)
      }
    }
  }
  return faults
}

/* -------------------------------------------------------------------------- */
/* Fixtures — the real export, at the grain the route reads it                  */
/* -------------------------------------------------------------------------- */

const STORES = ['GSA-001', 'GSA-002', 'GSA-003'] as const
const MONTH = '2025-12'

function period() {
  return {
    start: `${MONTH}-01`,
    end: `${MONTH}-31`,
    label: 'December 2025',
    months: [MONTH],
    wholeMonths: [MONTH],
    calendarDays: 31,
    sellingDays: 27,
  }
}

function scope(): LeadsScope {
  return {
    stores: [...STORES],
    period: period(),
    leadSources: null,
    campaigns: null,
  }
}

/**
 * Read a partition under a key that NAMES it.
 *
 * `decodeDataset` memoizes, and passing the bare dataset name would return the first
 * partition's rows for every store. The route builds the key this way and so does this.
 */
function appointments(): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of STORES) {
    const file = appointmentSourceChunkFile(store, MONTH)
    if (file === undefined) throw new Error(`no appointment partition ${store}/${MONTH}`)
    rows.push(...decodeDataset(`appointment-source-funnel/${store}/${MONTH}`, file))
  }
  return rows
}

function funnelRows(): readonly DashboardRow[] {
  const rows: DashboardRow[] = []
  for (const store of STORES) {
    const file = chunkFile('lead-funnel', store, MONTH)
    if (file === undefined) throw new Error(`no lead-funnel partition ${store}/${MONTH}`)
    rows.push(...decodeDataset(`lead-funnel/${store}/${MONTH}`, file))
  }
  return rows
}

/* -------------------------------------------------------------------------- */

describe('the leads and marketing definition lists are structurally valid', () => {
  /*
   * Rendered from the REAL export rather than from a hand-written fixture. The defect
   * lived in the `.map()` that builds each group, so a fixture with one cell would have
   * exercised the same code — but a builder that returns no rows for a scope would not,
   * and these sections change shape when a measure is unavailable. Real data keeps the
   * rendered shape the same one the route produces.
   */
  it('AppointmentOutcomesSection keeps its notes inside the description', () => {
    const { container } = render(
      <AppointmentOutcomesSection
        outcomes={buildAppointmentOutcomes(appointments(), scope())}
      />
    )
    expect(container.querySelectorAll('dl').length).toBeGreaterThan(0)
    expect(definitionListFaults(container)).toEqual([])
  })

  it('MarketingSection keeps its notes inside the description', () => {
    const { container } = render(
      <MarketingSection
        marketing={buildMarketingSummary(
          marketingPerformanceRows(),
          campaignRows(),
          scope(),
          dashboardLeadSources
        )}
      />
    )
    expect(container.querySelectorAll('dl').length).toBeGreaterThan(0)
    expect(definitionListFaults(container)).toEqual([])
  })

  it('VendorDiscrepancySection keeps its notes inside the description', () => {
    const { container } = render(
      <VendorDiscrepancySection
        vendor={buildVendorDiscrepancy(marketingPerformanceRows(), funnelRows(), scope())}
        wholeMonths={[MONTH]}
      />
    )
    expect(container.querySelectorAll('dl').length).toBeGreaterThan(0)
    expect(definitionListFaults(container)).toEqual([])
  })

  it('still renders the explanatory copy, rather than having dropped it', () => {
    /*
     * THE FIX THIS TEST GUARDS COULD HAVE BEEN MADE BY DELETING THE NOTES. That would
     * pass every structural assertion above and would be strictly worse than the defect:
     * "KPI-FUN-004 · 188 of 309 eligible appointments · scheduled-date basis" is what
     * tells a reader which denominator produced the figure. So the text is asserted
     * present, and asserted to be inside the `<dd>` it qualifies.
     */
    const { container } = render(
      <AppointmentOutcomesSection
        outcomes={buildAppointmentOutcomes(appointments(), scope())}
      />
    )
    const descriptions = [...container.querySelectorAll('dd')].map(
      (node) => node.textContent ?? ''
    )
    expect(descriptions.some((text) => text.includes('KPI-FUN-004'))).toBe(true)
    expect(descriptions.some((text) => text.includes('KPI-FUN-005'))).toBe(true)
    expect(
      descriptions.some((text) =>
        text.includes('excluded from the show-rate denominator')
      )
    ).toBe(true)
  })
})

describe('the fault detector reports the shape it is there to catch', () => {
  /*
   * A structural assertion that returns `[]` for everything is a test that passes for
   * the wrong reason, and this one is easy to write that way -- `querySelectorAll('dl')`
   * on a tree with no `<dl>` finds nothing to complain about. So the detector is shown
   * the exact markup that shipped, and required to object to it.
   */
  it('names a <p> sitting beside a <dt>/<dd> pair', () => {
    const { container } = render(
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt>Show rate</dt>
          <dd>46.8%</dd>
          <p>KPI-FUN-004 · 188 of 309 eligible appointments</p>
        </div>
      </dl>
    )
    const faults = definitionListFaults(container)
    expect(faults).toHaveLength(1)
    expect(faults[0]).toContain('<p> beside its <dt>/<dd>')
    expect(faults[0]).toContain('KPI-FUN-004')
  })

  it('names a non-group element directly inside the list', () => {
    const { container } = render(
      <dl>
        <dt>Term</dt>
        <dd>Description</dd>
        <span>Stray</span>
      </dl>
    )
    expect(definitionListFaults(container)).toEqual([
      '<dl class="(no class)"> contains <span> directly',
    ])
  })

  it('names a group that is missing half of its pair', () => {
    const { container } = render(
      <dl>
        <div>
          <dt>Term with no description</dt>
        </div>
      </dl>
    )
    expect(definitionListFaults(container)).toEqual([
      '<dl class="(no class)"> has a grouping <div> with no <dd>',
    ])
  })

  it('accepts the corrected shape', () => {
    const { container } = render(
      <dl>
        <div>
          <dt>Show rate</dt>
          <dd>
            <span>46.8%</span>
            <p>KPI-FUN-004 · 188 of 309 eligible appointments</p>
          </dd>
        </div>
      </dl>
    )
    expect(definitionListFaults(container)).toEqual([])
  })
})
