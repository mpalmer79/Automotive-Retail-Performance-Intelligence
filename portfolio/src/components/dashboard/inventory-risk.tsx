/**
 * The inventory exposure module: what is on the lot, and what it is costing.
 *
 * TWO DISTRIBUTIONS OVER ONE SET OF BANDS
 * ---------------------------------------
 * `UX.2A` §10 requires the Executive stock reading to communicate unit aging AND capital
 * exposure where the current datasets support both. They do: `inventory-aging` publishes
 * `investment_in_bucket` beside `units_in_bucket`, at the same grain, in the export this
 * route already opens. So the age stack draws two tracks — units, then investment — over
 * the same five governed bands, and the finding a used-car manager is actually looking for
 * becomes visible: the share of the MONEY standing past the aged threshold is not the
 * share of the CARS. Nothing was inferred, no grain was added and no allocation was
 * invented; where a scope produced no capital for a band, the second track is not drawn at
 * all.
 *
 * SEMI-ADDITIVE, AND THE MODULE SAYS SO
 * -------------------------------------
 * Active inventory, investment and aged units are read at ONE snapshot date — the latest
 * the selected period contains — and the date is on the module. KPI-INV-001 states the
 * trap plainly: "a month-level card showing a summed daily count is wrong by roughly a
 * factor of 30 and looks plausible". The selector layer makes that impossible; the scope
 * line makes it visible.
 *
 * THE MEDIAN TABLE IS THE POINT, NOT A FALLBACK
 * ---------------------------------------------
 * There is no group median inventory age in this data, and there cannot be: a median is an
 * order statistic, the export publishes one per store per condition group per snapshot
 * date, and the catalogue says outright that "group median is not derivable from subgroup
 * medians and must be recomputed from rows". So instead of averaging five medians into a
 * sixth number that is a median of nothing, the module shows all five at the grain
 * PostgreSQL computed them at. `UX.2A` moved that table behind a disclosure and moved the
 * median card off the KPI rail for the same reason: it is the right answer to a question a
 * group-scoped rail cannot ask.
 *
 * THE THRESHOLD IS A PROJECT DEFAULT — sixty days, read from the export's own
 * `aged_threshold_days` column rather than typed here, and printed on the stack where the
 * colour ramp turns on it. KPI-INV-005: "different operators use 30, 45, 60, or 90 days.
 * Any finding depending on the threshold must state it in the same sentence." It is not an
 * industry standard and the page does not call it one.
 *
 * WHERE THIS MODULE STOPS
 * -----------------------
 * At the summary. `/dashboard/inventory` holds the 1,501 unit-level rows and the per-unit
 * accounting position. Reproducing them here would cost 356 kB of chunks this route never
 * opens, which `dashboard-boundaries.test.ts` forbids outright. There is no repricing
 * recommendation and no disposal advice: this module reports a position.
 *
 * Server component.
 */
import Link from 'next/link'

import { Disclosure } from '@/components/ui/disclosure'
import { Heading, Text } from '@/components/ui/typography'
import { kpiDefinition, type InventorySummary } from '@/lib/dashboard/executive'
import { exactToString } from '@/lib/dashboard/decimal'
import { formatCurrencyExact, formatIsoDate } from '@/lib/dashboard/format'
import type { ComparedMetric } from '@/lib/dashboard/selectors'

import { KpiDefinitionList, MetricDifference, MetricValue, stateLabel } from './metric'
import { InventoryAgeStack } from './visuals'

/** The four figures the Executive reads. The rest belong to the drill-through. */
function figuresOf(
  inventory: InventorySummary
): readonly { readonly label: string; readonly metric: ComparedMetric }[] {
  /*
   * FOUR, DOWN FROM EIGHT, AND THE OTHER FOUR DID NOT LEAVE THE CONSOLE.
   *
   * Average age is in the aging table. Aged investment is now the second track of the
   * stack, which is a better reading of it than a card was. Days supply and inventory turn
   * are governed scoreboard columns, per store, where a group-level single figure was
   * always the less useful of the two presentations. What is left is the position, the
   * money, the exposed units and the exposed share — which is the module's whole question.
   */
  return [
    { label: 'Active inventory', metric: inventory.activeUnits },
    { label: 'Inventory investment', metric: inventory.investment },
    { label: 'Aged units', metric: inventory.agedUnits },
    { label: 'Aged percentage', metric: inventory.agedPercentage },
  ]
}

export function InventoryRisk({
  inventory,
  comparisonLabel,
  unitsHref,
}: {
  inventory: InventorySummary
  comparisonLabel: string | null
  /**
   * The Inventory route, carrying the context this scope can be reproduced with.
   *
   * BUILT BY THE PAGE THROUGH `operatingHref`, not written here as a bare
   * pathname. `UX.2D` §10 measured this link on `main`: from `/?period=2025-11&store=GSA-002`
   * it pointed at `/dashboard/inventory` with nothing attached, so a general manager
   * who had selected Granite Subaru and November arrived at the whole group at the
   * latest snapshot and had to select both again. Inventory declares `store` applied
   * and `period` partial, so both survive the journey.
   */
  readonly unitsHref: string
}) {
  const figures = figuresOf(inventory)

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium text-ink-secondary">{figure.label}</dt>
            <dd>
              <MetricValue
                selector={figure.metric.selector}
                result={figure.metric.current}
                size="sub"
              />
            </dd>
            <dd>
              {figure.metric.current.kind === 'value' ? (
                <MetricDifference
                  metric={figure.metric}
                  comparisonLabel={comparisonLabel}
                />
              ) : (
                <Text size="xs" tone="faint">
                  {stateLabel(figure.metric.current)}
                </Text>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <InventoryAgeStack
        title="Age and capital exposure"
        caption={
          inventory.snapshotDate === null
            ? 'No inventory snapshot falls inside the selected period.'
            : `Units and the money standing in them, over the exported age bands, at the ${formatIsoDate(inventory.snapshotDate)} snapshot. A position read at one date and never summed across dates.`
        }
        segments={inventory.buckets.map((bucket) => ({
          key: bucket.label,
          label: bucket.label,
          display: `${exactToString(bucket.units)} units`,
          share: bucket.share,
          capitalDisplay: formatCurrencyExact(bucket.investment, 0),
          capitalShare: bucket.investmentShare,
        }))}
        snapshotNote={
          inventory.snapshotDate === null
            ? 'No inventory snapshot falls inside the selected period.'
            : `Read at the ${formatIsoDate(inventory.snapshotDate)} snapshot, at one date and never summed across dates.`
        }
        thresholdDays={inventory.agedThresholdDays}
        headingLevel={3}
      />

      {inventory.agedThresholdDays === null ? (
        <Text size="xs" tone="faint" className="max-w-prose">
          The scope in view carries more than one aged threshold, so no single threshold
          is stated.
        </Text>
      ) : null}

      <Disclosure label="Median inventory age, and how these figures are calculated">
        <MedianTable inventory={inventory} />
        <div className="flex flex-col gap-6">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col gap-2">
              <Heading level={4} size="h6" className="text-ink-secondary">
                {figure.label}
              </Heading>
              <KpiDefinitionList
                selector={figure.metric.selector}
                definition={
                  figure.metric.selector.kpiId === null
                    ? undefined
                    : kpiDefinition(figure.metric.selector.kpiId)
                }
              />
            </div>
          ))}
        </div>
      </Disclosure>

      <Text size="xs" tone="faint">
        <Link className="underline" href={unitsHref}>
          Open the units behind these figures
        </Link>
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Governed medians                                                            */
/* -------------------------------------------------------------------------- */

function MedianTable({ inventory }: { inventory: InventorySummary }) {
  return (
    <section aria-labelledby="governed-medians" className="flex flex-col gap-3">
      <Heading level={4} size="h6" id="governed-medians">
        Median inventory age, at the grain it is published
      </Heading>
      <Text size="xs" tone="muted" className="max-w-prose">
        A median is published per store, per condition group, per snapshot date, and it
        cannot be combined upward: a group median is not the average of store medians.
        KPI-INV-004 is an order statistic, computed with PERCENTILE_CONT over the units
        themselves in the reporting layer, at the finest grain at which the value is
        defined.
      </Text>
      {inventory.governedMedians.length === 0 ? (
        <Text size="sm" tone="muted">
          No inventory rows fall inside the selected period and scope.
        </Text>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Exported median inventory age by store and condition group
          </caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                Store
              </th>
              <th scope="col" className={HEAD}>
                Condition
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Median age
              </th>
            </tr>
          </thead>
          <tbody>
            {inventory.governedMedians.map((entry) => (
              <tr
                key={`${entry.store.id}-${entry.conditionGroup}`}
                className="border-t border-line-subtle"
              >
                <th scope="row" className="py-2 text-left font-medium text-ink-secondary">
                  {entry.store.shortName}
                </th>
                <td className="py-2 text-ink-muted">{entry.conditionGroup}</td>
                <td className="py-2 text-right">
                  {entry.value.kind === 'value' ? (
                    <span className="numeric text-ink">
                      {exactToString(entry.value.value)} days
                    </span>
                  ) : (
                    <span className="text-ink-muted">
                      {entry.value.kind === 'not-applicable'
                        ? 'Not applicable'
                        : 'No eligible population'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const HEAD = 'py-1.5 font-mono text-2xs tracking-wide text-ink-muted uppercase'
