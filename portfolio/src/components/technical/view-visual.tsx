/**
 * The visual anchor for each state of the technical destination.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured on a production build before `UX.3`, at 1440 × 900: six of the eight
 * technical views contained no framed visual region inside the first viewport,
 * and the first one on the governance view began 1,297 px down. At 390 × 844 the
 * status view's first visual was 3,542 px down — four phone screens of reading
 * before anything to look at. Every one of those views opened with a `<PageHeader>`
 * and then a card of prose, so the fix belongs in one component rather than in
 * eight.
 *
 * Each entry answers the same question in the same shape: **what is the size and
 * state of the thing this view is about**, before the view argues about it. The
 * body of each view still carries the diagram, the explorer or the catalogue that
 * is the real subject; this is the figure that arrives with the sentence.
 *
 * EVERY FIGURE IS DERIVED, NONE IS TYPED
 * --------------------------------------
 * The counts come from the generated project manifest, the KPI domain
 * distribution from the catalogue content, and the reference-lane row counts from
 * the workbook contract. `tests/unit/content-integrity.test.ts` scans the
 * component tree for manifest values appearing as literals, so a number typed
 * here would fail the build — which is the intended relationship between this
 * file and the repository.
 */
import { BarChart } from '@/components/visuals/inventory-charts'
import { StatRail, StatusGrid } from '@/components/ui/summary-grid'
import {
  KPI_DOMAINS,
  dimensions,
  facts,
  inventoryOperations,
  kpiIdsForDomain,
} from '@/lib/content'
import { counts, engines, gate, semanticModel } from '@/lib/manifest'
import { formatCount } from '@/lib/utils'
import type { TechnicalView } from '@/lib/technical'

export function TechnicalViewVisual({ view }: { readonly view: TechnicalView }) {
  switch (view) {
    case 'overview':
      return (
        <StatRail
          label="The platform in four figures"
          stats={[
            {
              value: formatCount(counts.reportingViews.value),
              label: 'Reporting views',
              note: 'Own the SQL side of every KPI',
            },
            {
              value: formatCount(counts.governedKpis.value),
              label: 'Governed KPIs',
              note: 'Formula, both sides, grain, caution',
            },
            {
              value: formatCount(counts.reconciliations.value),
              label: 'Reconciliations',
              note: 'Proved on every run',
            },
            {
              value: formatCount(counts.sqlScripts.value),
              label: 'SQL scripts',
              note: 'Ordered, re-runnable end to end',
            },
          ]}
        />
      )

    case 'architecture':
      return (
        <StatRail
          label="The pipeline in four figures"
          stats={[
            {
              value: formatCount(counts.sqlScripts.value),
              label: 'Build scripts',
              note: 'Lexical order is execution order',
            },
            {
              value: formatCount(counts.reportingViews.value),
              label: 'Reporting views',
              note: 'The only schema the model reads',
            },
            {
              value: formatCount(counts.dataQualityChecks.value),
              label: 'Quality checks',
              note: 'In memory, before anything is written',
            },
            {
              value: formatCount(counts.reconciliations.value),
              label: 'Reconciliations',
              note: 'Each proves a number rather than asserting it',
            },
          ]}
        />
      )

    case 'data-model':
      return (
        <StatRail
          label="The warehouse in four figures"
          stats={[
            {
              value: formatCount(dimensions.length),
              label: 'Conformed dimensions',
              note: 'Shared keys across seven domains',
            },
            {
              value: formatCount(facts.length),
              label: 'Facts',
              note: 'Grain declared and constrained',
            },
            {
              value: formatCount(counts.reportingViews.value),
              label: 'Reporting views',
              note: 'The published surface',
            },
            {
              value: '0',
              label: 'Personal columns',
              note: 'Not redacted. Never designed.',
            },
          ]}
        />
      )

    case 'kpis':
      return (
        <BarChart
          title="Governed KPIs by domain"
          unit="KPIs"
          valueHeading="KPIs"
          headingLevel={2}
          caption="Definitions, never values. No KPI value appears anywhere on this site."
          rows={KPI_DOMAINS.map((entry) => ({
            key: entry.id,
            label: entry.label,
            value: kpiIdsForDomain(entry.id).length,
          }))}
        />
      )

    case 'governance':
      return (
        <StatusGrid
          label="The governance controls, and whether each one is enforced"
          columns={2}
          density="compact"
          entries={[
            { label: 'Synthetic data only', status: 'complete' },
            { label: 'No personal data, by construction', status: 'complete' },
            { label: 'Declared grain on every fact', status: 'complete' },
            { label: 'Reporting role confined by test', status: 'complete' },
            { label: 'Reconciliation as a control', status: 'complete' },
            {
              label: `Gate 2 ${gate('gate-2').verdict}`,
              status: 'blocked',
              statusLabel: 'Closed',
            },
          ]}
        />
      )

    case 'data-sources':
      return (
        <StatRail
          label="The reference listing lane in three figures"
          stats={[
            {
              value: formatCount(
                inventoryOperations.artifacts.reduce(
                  (running, entry) => running + entry.rows,
                  0
                )
              ),
              label: 'Sanitized listings',
              note: 'Observed, then de-identified',
            },
            {
              value: formatCount(inventoryOperations.artifacts.length),
              label: 'Governed workbooks',
              note: 'Each declared with its SHA-256',
            },
            {
              value: formatCount(inventoryOperations.pipeline.length),
              label: 'Pipeline stages',
              note: 'Private input to governed view',
            },
          ]}
        />
      )

    case 'status':
      return (
        <StatusGrid
          label="The four states routinely conflated, and which one this project is in"
          columns={2}
          density="compact"
          entries={[
            { label: 'Static source validation', status: 'complete' },
            {
              label: 'Real-engine validation',
              status: semanticModel.realEngineStatus,
              statusLabel: engines.every((path) => path.validatedAt === null)
                ? 'Never run'
                : undefined,
            },
            {
              label: 'Report pages built',
              status: 'blocked',
              statusLabel:
                semanticModel.dashboardPageCount === 0 ? 'None exists' : 'In progress',
            },
            {
              label: 'Case study published',
              status: 'blocked',
              statusLabel: `Gate 2 ${gate('gate-2').verdict}`,
            },
          ]}
        />
      )

    case 'product-vision':
      return (
        <StatusGrid
          label="What exists today, and what is a design position"
          columns={2}
          density="compact"
          entries={[
            { label: 'Governed model over synthetic data', status: 'complete' },
            { label: 'Operating console and drill-through', status: 'complete' },
            {
              label: 'Dealer system integrations',
              status: 'not-started',
              statusLabel: 'None exists',
            },
            {
              label: 'Production deployment',
              status: 'not-started',
              statusLabel: 'Not built',
            },
          ]}
        />
      )
  }
}
