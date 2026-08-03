/**
 * The group-level inventory snapshot.
 *
 * Seven derived figures for the whole group, plus the sentence that says what
 * they are and what they are not. Rendered on the home page and again at the top
 * of `/dealerships`.
 *
 * EVERY TILE IS CONDITIONAL. The median price and the median pre-owned mileage
 * are only shown when the source data supports them, which `<MetricGrid>`
 * enforces by dropping a `null` tile rather than drawing a dash. See the note in
 * that component.
 *
 * The medians are stated as medians of the ADVERTISED price, over the listings
 * the source actually priced, and the tile's own detail line says how many that
 * was. A median presented without its denominator is the most common way a
 * partial dataset gets read as a complete one.
 */
import { SourceLink } from '@/components/ui/data-card'
import { Text } from '@/components/ui/typography'
import { MetricGrid } from '@/components/dealerships/metric-grid'
import { formatMiles, formatPrice, inventorySummary } from '@/lib/inventory'
import { cx, formatCount, formatDate } from '@/lib/utils'

export function GroupSnapshot({
  className,
  columns = 4,
  showSources = true,
}: {
  className?: string
  columns?: 2 | 3 | 4
  showSources?: boolean
}) {
  const summary = inventorySummary
  const unpriced = summary.totalRecords - summary.pricedRecords

  return (
    <div className={cx('flex flex-col gap-6', className)}>
      <MetricGrid
        columns={columns}
        size="lg"
        metrics={[
          {
            label: 'Vehicles represented',
            value: formatCount(summary.totalRecords),
            detail: `Across ${formatCount(summary.dealershipCount)} stores`,
          },
          {
            label: 'New vehicles',
            value: formatCount(summary.newRecords),
            detail: 'Franchise rooftops only',
          },
          {
            label: 'Pre-owned vehicles',
            value: formatCount(summary.preOwnedRecords),
            detail: 'All three stores',
          },
          {
            label: 'Brands represented',
            value: formatCount(summary.makeCount),
            detail: `${formatCount(summary.modelCount)} distinct models`,
          },
          {
            label: 'Median advertised price',
            value: summary.medianPrice === null ? null : formatPrice(summary.medianPrice),
            detail: `Over the ${formatCount(summary.pricedRecords)} listings the source priced`,
          },
          {
            label: 'Median pre-owned mileage',
            value:
              summary.medianPreOwnedMileage === null
                ? null
                : formatMiles(summary.medianPreOwnedMileage),
            detail: `Over the ${formatCount(summary.mileageRecords)} listings with an odometer reading`,
          },
          {
            label: 'Snapshot date',
            value: formatDate(summary.latestSnapshotDate),
            detail:
              summary.snapshotDates.length === 1
                ? 'One capture, all three stores'
                : `${formatCount(summary.snapshotDates.length)} captures`,
          },
        ]}
      />

      <Text size="sm" tone="muted" className="max-w-prose">
        {`Every figure above is computed at build time from the sanitized workbooks in the repository. ` +
          `The source exposed an advertised price for ${formatCount(summary.pricedRecords)} of the ` +
          `${formatCount(summary.totalRecords)} listings` +
          (unpriced > 0
            ? `; the other ${formatCount(unpriced)} carry a pricing status instead of a figure and are excluded from every price statistic here. `
            : '. ') +
          `These are listing observations, not sales, deliveries or gross.`}
      </Text>

      {showSources ? (
        <ul className="flex flex-col gap-0.5">
          {summary.generatedFrom.map((path) => (
            <li key={path}>
              <SourceLink path={path} field="sanitized inventory snapshot" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
