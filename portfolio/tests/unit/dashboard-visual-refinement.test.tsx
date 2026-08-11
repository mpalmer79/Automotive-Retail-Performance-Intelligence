/**
 * The semantic-colour and information-density pass over the executive console.
 *
 * WHAT THIS SUITE IS FOR, AND WHAT IT DELIBERATELY IS NOT
 * ------------------------------------------------------
 * Not "does it look right". A screenshot answers that and a test cannot. What is
 * testable — and what a later edit will quietly get wrong — is the RULE each colour
 * stands for:
 *
 *   * a mark is coloured by MEANING, never by whether a number went up;
 *   * `data-positive` and `data-negative` appear only where sign or an explicit
 *     governed target actually has meaning, and never as a global "up is good";
 *   * the accounting variance is sign-NEUTRAL on both sides of zero, permanently;
 *   * a store's hue is its identity and cannot drift when the filter changes;
 *   * every mark is accompanied by a non-colour carrier, so nothing is encoded in
 *     hue alone;
 *   * collapsing a region does not remove it from the document.
 *
 * The `dashboard-visuals.test.tsx` suite already asserts that every value is text and
 * that the tables are in the document. This one asserts the layer above: that the
 * colour vocabulary means what `tokens.css` §2b says it means.
 *
 * WHY IT ASSERTS CLASS NAMES. A class name is the only observable a `jsdom` render has
 * for a colour — no stylesheet is applied, so `getComputedStyle` reports nothing useful.
 * That is acceptable here because the class names ARE the token binding: `bg-data-positive`
 * resolves through `theme.css` to `--arpi-colour-data-positive` and to nowhere else, and
 * `tokens.test.ts` measures the value at the other end. The pair covers both halves.
 */
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { PaceBar } from '../../src/components/dashboard/pace-bar.tsx'
import {
  BridgeChart,
  GrossComposition,
  InventoryAgeStack,
  ReconciliationScale,
  StoreComparisonBars,
  storeMarkClass,
} from '../../src/components/dashboard/visuals.tsx'
import { parseExact } from '../../src/lib/dashboard/decimal.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

/** Every class name applied anywhere inside a rendered tree. */
function classesIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[class]')].flatMap((node) =>
    node.className.split(/\s+/).filter(Boolean)
  )
}

/* -------------------------------------------------------------------------- */
/* The inventory age ramp                                                      */
/* -------------------------------------------------------------------------- */

describe('the inventory age ramp is ordered, and its order is the export order', () => {
  const FIVE = [
    { key: 'a', label: '0-30', display: '99 units', share: 0.4 },
    { key: 'b', label: '31-60', display: '50 units', share: 0.2 },
    { key: 'c', label: '61-90', display: '26 units', share: 0.1 },
    { key: 'd', label: '91-120', display: '24 units', share: 0.1 },
    { key: 'e', label: 'Over 120', display: '51 units', share: 0.2 },
  ]

  const RAMP = [
    'bg-data-age-fresh',
    'bg-data-age-early',
    'bg-data-age-threshold',
    'bg-data-age-aged',
    'bg-data-age-critical',
  ]

  it('draws five distinct age tokens rather than one hue at five opacities', () => {
    const { container } = render(
      <InventoryAgeStack title="Age" segments={FIVE} snapshotNote="note" />
    )
    const applied = new Set(classesIn(container))
    for (const step of RAMP) {
      expect(applied.has(step), `${step} is not drawn`).toBe(true)
    }
    // The presentation this replaced encoded the order in `opacity`, which is not a
    // colour a reader can name and not a value a test can check.
    for (const node of container.querySelectorAll<HTMLElement>('[style]')) {
      expect(node.style.opacity, node.outerHTML.slice(0, 90)).toBe('')
    }
  })

  it('keeps a band on its own colour when an earlier band is empty', () => {
    /*
     * THE DEFECT THIS EXISTS FOR. The horizontal stack draws only the bands with a
     * non-zero share, and the legend draws all of them. Colouring by position in the
     * DRAWN list rather than in the full list therefore shifted every band after an
     * empty one, so the bar and its own legend disagreed about which band was which —
     * silently, and only for a scope where a bucket happened to be empty.
     */
    const withEmptyFirst = [{ ...FIVE[0]!, share: 0 }, ...FIVE.slice(1)]
    const { container } = render(
      <InventoryAgeStack title="Age" segments={withEmptyFirst} snapshotNote="note" />
    )
    // The HORIZONTAL stack only, which is the composition that filters empty bands.
    // The vertical rows below `sm` draw every band including the empty one, and reading
    // both would compare two different populations.
    // `data-stack-track` names the horizontal track. `UX.2A` gave the stack a second
    // track — the capital standing in each band — so a class-shaped selector would now
    // match the wrapper that holds both rather than the segments inside one.
    const stack = container.querySelector<HTMLElement>('[data-stack-track="units"]')
    expect(stack, 'the horizontal stack is not in the document').not.toBeNull()
    const drawn = [...(stack?.children ?? [])]
      .map((node) => RAMP.find((step) => node.className.includes(step)))
      .filter((step): step is string => step !== undefined)

    // The first band has no width and is not drawn; the second band keeps `early`.
    expect(drawn).not.toContain('bg-data-age-fresh')
    expect(drawn[0]).toBe('bg-data-age-early')
    expect(drawn).toEqual([
      'bg-data-age-early',
      'bg-data-age-threshold',
      'bg-data-age-aged',
      'bg-data-age-critical',
    ])
  })

  it('holds at the last step rather than inventing a colour for a sixth band', () => {
    const six = [...FIVE, { key: 'f', label: 'Over 180', display: '3 units', share: 0.1 }]
    const { container } = render(
      <InventoryAgeStack title="Age" segments={six} snapshotNote="note" />
    )
    const critical = classesIn(container).filter(
      (name) => name === 'bg-data-age-critical'
    )
    // Two compositions plus a legend swatch for each of the two critical bands.
    expect(critical.length).toBeGreaterThanOrEqual(4)
  })

  it('prints the threshold the ramp turns on, and names it a project default', () => {
    const { container } = render(
      <InventoryAgeStack
        title="Age"
        segments={FIVE}
        snapshotNote="note"
        thresholdDays={60}
      />
    )
    expect(container.textContent).toContain('60-day')
    expect(container.textContent).toContain('project default')
    expect(container.textContent).not.toContain('industry benchmark threshold')
  })

  it('says nothing about a threshold when the scope carries more than one', () => {
    const { container } = render(
      <InventoryAgeStack
        title="Age"
        segments={FIVE}
        snapshotNote="note"
        thresholdDays={null}
      />
    )
    expect(container.textContent).not.toContain('project default')
  })

  it('prints every band and its count beside the colour, so hue carries nothing alone', () => {
    const { container } = render(
      <InventoryAgeStack title="Age" segments={FIVE} snapshotNote="note" />
    )
    for (const segment of FIVE) {
      expect(container.textContent, segment.label).toContain(segment.label)
      expect(container.textContent, segment.display).toContain(segment.display)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Sign, where sign has meaning                                                */
/* -------------------------------------------------------------------------- */

describe('sign is coloured where it means something and nowhere else', () => {
  const bar = (key: string, value: string, kind: 'anchor' | 'step') => ({
    key,
    label: key,
    value: parseExact(value),
    display: value,
    kind,
  })

  it('gives a waterfall its rise, its fall and its anchors three different tokens', () => {
    const { container } = render(
      <BridgeChart
        title="Gross change"
        summary="A decomposition."
        bars={[
          bar('open', '1000.00', 'anchor'),
          bar('up', '400.00', 'step'),
          bar('down', '-250.00', 'step'),
          bar('close', '1150.00', 'anchor'),
        ]}
      />
    )
    const applied = new Set(classesIn(container))
    expect(applied.has('bg-data-positive')).toBe(true)
    expect(applied.has('bg-data-negative')).toBe(true)
    // An anchor is a LEVEL, and a level has no direction.
    expect(applied.has('bg-data-reference')).toBe(true)
  })

  it('still separates a rise from a fall by a glyph and a sign, not only by hue', () => {
    const { container } = render(
      <BridgeChart
        title="Gross change"
        summary="A decomposition."
        bars={[bar('up', '400.00', 'step'), bar('down', '-250.00', 'step')]}
      />
    )
    expect(container.textContent).toContain('↑')
    expect(container.textContent).toContain('↓')
    expect(container.textContent).toContain('-250.00')
  })

  it('never colours the GL-versus-subledger variance by its sign', () => {
    /*
     * THE ONE THAT MUST NOT DRIFT. The export's own exception detail says both sides
     * are valid data and a variance is a finding to investigate, so a red marker for
     * one sign and a green one for the other would publish a judgement this console is
     * not authorised to make. Both signs take the SAME neutral token.
     */
    const account = (key: string, variance: string) => ({
      key,
      label: key,
      variance: parseExact(variance),
      display: variance,
      state: 'Variance',
      isComparable: true,
    })
    const { container } = render(
      <ReconciliationScale
        title="Reconciliation"
        accounts={[account('over', '1200.00'), account('under', '-1200.00')]}
        totalDisplay="$0.00"
        directionText="the two sides agree exactly"
        excludedCount={0}
      />
    )
    const applied = new Set(classesIn(container))
    expect(applied.has('bg-data-neutral')).toBe(true)
    expect(applied.has('bg-data-positive')).toBe(false)
    expect(applied.has('bg-data-negative')).toBe(false)
    expect(applied.has('bg-data-warning')).toBe(false)
  })

  it('colours the two gross components as identities rather than as a sign', () => {
    const segment = (key: string, value: string) => ({
      key,
      label: key,
      value: parseExact(value),
      display: value,
    })
    const { container } = render(
      <GrossComposition
        title="Front and back gross"
        segments={[segment('Front', '213657.00'), segment('Back', '108277.00')]}
        total={parseExact('321934.00')}
      />
    )
    const applied = new Set(classesIn(container))
    expect(applied.has('bg-data-primary')).toBe(true)
    expect(applied.has('bg-data-secondary')).toBe(true)
    // Neither half of a deal is the good half.
    expect(applied.has('bg-data-positive')).toBe(false)
    expect(applied.has('bg-data-negative')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Store identity                                                              */
/* -------------------------------------------------------------------------- */

describe('a store keeps its colour when the filter changes', () => {
  it('derives the mark from the business code, not from the row position', () => {
    expect(storeMarkClass('GSA-002')).toBe(storeMarkClass('GSA-002'))
    expect(storeMarkClass('GSA-001')).not.toBe(storeMarkClass('GSA-002'))
    expect(storeMarkClass('GSA-002')).not.toBe(storeMarkClass('GSA-003'))
  })

  it('gives an unexpected identifier one stable colour rather than a moving one', () => {
    const once = storeMarkClass('BRANCH-WITHOUT-A-NUMBER')
    expect(storeMarkClass('BRANCH-WITHOUT-A-NUMBER')).toBe(once)
    expect(once.startsWith('bg-data-')).toBe(true)
  })

  it('draws the same store in the same hue whether or not the first store is in scope', () => {
    const row = (key: string, value: string) => ({
      key,
      storeShortName: key,
      storeType: 'Franchise',
      result: { kind: 'value' as const, value: parseExact(value), rowCount: 1 },
      display: value,
    })
    const markOf = (container: HTMLElement, index: number) =>
      [...container.querySelectorAll<HTMLElement>('div.rounded-pill.h-full')]
        .map((node) => node.className)
        .at(index)

    const all = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[row('GSA-001', '35'), row('GSA-002', '35'), row('GSA-003', '22')]}
      />
    )
    const narrowed = render(
      <StoreComparisonBars
        title="Retail units"
        kpiId="KPI-SLS-001"
        rows={[row('GSA-002', '35'), row('GSA-003', '22')]}
      />
    )
    // GSA-002 is the second row in one render and the first in the other.
    expect(markOf(all.container, 1)).toBe(markOf(narrowed.container, 0))
  })
})

/* -------------------------------------------------------------------------- */
/* The one threshold the console is allowed to colour                          */
/* -------------------------------------------------------------------------- */

describe('target attainment changes colour at 100% and at no other point', () => {
  const paceBar = (actual: string, target: string) => (
    <PaceBar
      label="Retail units"
      actualText={actual}
      targetText={target}
      numerator={parseExact(actual)}
      denominator={parseExact(target)}
      attainment={null}
      sellingDayProgress={0.5}
      missingTargetText="No target"
    />
  )

  it('holds the neutral fill below the boundary, however far below', () => {
    for (const [actual, target] of [
      ['10.00', '100.00'],
      ['70.00', '100.00'],
      ['99.99', '100.00'],
    ]) {
      const { container } = render(paceBar(actual!, target!))
      const applied = new Set(classesIn(container))
      expect(applied.has('bg-accent-muted'), `${actual!} of ${target!}`).toBe(true)
      expect(applied.has('bg-data-positive'), `${actual!} of ${target!}`).toBe(false)
      // No red for behind, and no amber ramp approaching the boundary: a store at 70%
      // on the fifteenth selling day is not behind, which is what the clock marker on
      // the track exists to say.
      expect(applied.has('bg-data-negative'), `${actual!} of ${target!}`).toBe(false)
      expect(applied.has('bg-data-warning'), `${actual!} of ${target!}`).toBe(false)
    }
  })

  it('takes the positive fill at the boundary exactly, and above it', () => {
    for (const [actual, target] of [
      ['100.00', '100.00'],
      ['134.00', '100.00'],
    ]) {
      const { container } = render(paceBar(actual!, target!))
      const applied = new Set(classesIn(container))
      expect(applied.has('bg-data-positive'), `${actual!} of ${target!}`).toBe(true)
    }
  })

  it('still carries the attainment in words, so the colour is never the only reading', () => {
    const { container } = render(
      <PaceBar
        label="Retail units"
        actualText="104"
        targetText="97"
        numerator={parseExact('104')}
        denominator={parseExact('97')}
        attainment={parseExact('1.0722')}
        sellingDayProgress={1}
        missingTargetText="No target"
      />
    )
    expect(container.textContent).toContain('107.2% of target')
    expect(container.textContent).toContain('Target 97')
  })
})

/* -------------------------------------------------------------------------- */
/* The rules that hold across the whole console                                */
/* -------------------------------------------------------------------------- */

describe('the console has one source of visual constants and no chart library', () => {
  const DASHBOARD_COMPONENTS = [
    'src/components/dashboard/visuals.tsx',
    'src/components/dashboard/kpi-strip.tsx',
    'src/components/dashboard/metric.tsx',
    'src/components/dashboard/operating.tsx',
    'src/components/dashboard/inventory-risk.tsx',
    'src/components/dashboard/sales-gross.tsx',
    'src/components/dashboard/lead-funnel.tsx',
    'src/components/dashboard/reconciliation.tsx',
    'src/components/dashboard/store-scoreboard.tsx',
    'src/components/dashboard/trust-panel.tsx',
    'src/components/dashboard/target-context.tsx',
    'src/components/dashboard/pace-bar.tsx',
    'src/app/(operating)/page.tsx',
  ]

  it.each(DASHBOARD_COMPONENTS)('%s introduces no raw hex value', (file) => {
    // Three-, four-, six- and eight-digit forms. A colour that is not in `tokens.css`
    // cannot be measured by `tokens.test.ts`, which is the whole reason that file exists.
    const hex = source(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(hex).toEqual([])
  })

  it.each(DASHBOARD_COMPONENTS)('%s reaches for no colour function either', (file) => {
    const functions = source(file).match(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/g) ?? []
    expect(functions).toEqual([])
  })

  it('added no charting dependency, in either dependency list', async () => {
    const manifest = JSON.parse(source('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const installed = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]
    for (const library of [
      'recharts',
      'chart.js',
      'react-chartjs-2',
      '@nivo/core',
      'echarts',
      'apexcharts',
      'victory',
      '@visx/visx',
      'd3',
    ]) {
      expect(installed, library).not.toContain(library)
    }
  })

  it('keeps the zone washes out of the data vocabulary', () => {
    /*
     * A domain tint marks a business AREA and encodes no state — the stock region is
     * amber whether the lot is clean or ageing badly. If a `zone-*` token ever resolved
     * to the same value as a `data-*` token, a reader could not tell a region's tint
     * from a value's colour, and the page would be asserting something it had not
     * encoded.
     */
    const tokens = source('src/styles/tokens.css')
    const declared = new Map(
      [...tokens.matchAll(/(--arpi-colour-(?:zone|data)-[a-z-]+):\s*([^;]+);/g)].map(
        (match) => [match[1] ?? '', (match[2] ?? '').trim()]
      )
    )
    const zones = [...declared].filter(([name]) => name.includes('-zone-'))
    const data = new Set(
      [...declared].filter(([name]) => name.includes('-data-')).map(([, value]) => value)
    )
    expect(zones.length).toBe(4)
    for (const [name, value] of zones) {
      expect(data.has(value), `${name} shares a value with a data token`).toBe(false)
    }
  })
})

describe('the page collapses detail without removing it', () => {
  const page = source('src/app/(operating)/page.tsx')

  it('keeps the scoreboard and the backlog anchors resolvable', () => {
    // These were page regions with anchors that navigation and external links point
    // at. An anchor that stops resolving is a broken link even when the content is
    // still on the page, so the ids moved onto the `<details>` elements.
    //
    // `id="trust"` LEFT THIS LIST AT `UX.1`, and the disclosure did not. The trust
    // panel moved into the control band's `methodology` slot — one screen higher,
    // beside the filters, still a `<details>`, still carrying the full synthetic
    // statement. What that removed is the SECOND copy: it was rendered here and in
    // the page header's trust line, and a disclosure stated twice on one document is
    // not twice as honest. The assertion that it is still rendered is below.
    for (const id of ['store-scoreboard', 'not-built']) {
      expect(page, id).toContain(`id="${id}"`)
    }
  })

  it('renders the provenance and the full statement above the figures', () => {
    // The control band's methodology disclosure. It is unconditional: a reader whose
    // filter returned no rows is the reader most likely to be asking what the data is
    // and how far it has been proved.
    const methodologyIndex = page.indexOf('methodology={')
    expect(methodologyIndex).toBeGreaterThan(0)
    expect(page).toContain('<TrustPanel')
    expect(page.slice(methodologyIndex - 600, methodologyIndex)).not.toContain(
      'overview.empty'
    )
  })

  it('renders the scoreboard only when there are rows to put in it', () => {
    /*
     * `UX.2A` replaced the per-region `overview.empty ? null :` guards with one branch
     * around the whole workspace, which is the same rule expressed once: an empty
     * selection renders `NoMatchingRecords` and the evidence disclosures, and nothing that
     * needs matching rows. The assertion follows the structure rather than the old idiom.
     */
    const branch = page.indexOf('{overview.empty ? (')
    expect(branch).toBeGreaterThan(0)
    expect(page.slice(branch)).toContain('<NoMatchingRecords')
    const workspace = page.indexOf('<Workspace>')
    const scoreboardIndex = page.indexOf('id="store-scoreboard"')
    expect(workspace).toBeGreaterThan(branch)
    expect(scoreboardIndex).toBeGreaterThan(workspace)
  })

  it('opens with figures rather than with a region explaining what is not built', () => {
    const performance = page.indexOf('id="group-performance"')
    const backlog = page.indexOf('id="not-built"')
    expect(performance).toBeGreaterThan(0)
    expect(backlog).toBeGreaterThan(performance)
    // The region heading it used to carry is gone. Checked against the CODE rather
    // than the file, because the comment recording what moved names the old heading —
    // and a test that forced the record to be deleted would be a test making the
    // repository less honest.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('What this console does not do yet')
    expect(code).toContain('What is not built yet')
  })
})
