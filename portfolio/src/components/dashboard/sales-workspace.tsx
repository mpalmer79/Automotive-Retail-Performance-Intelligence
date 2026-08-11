/**
 * The Sales & Gross workspace: the rail, the trend, and the two comparisons.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2B-BASELINE.md` §1: at 1440 × 900 a general sales manager opening
 * `/dashboard/sales-gross` met an `h1`, an `h2` and nothing else. The route's six framed
 * figures began 2,752 px down — three screens — and the gross-change bridge, which is the
 * strongest analytical asset on the surface, sat at the foot of a 7,228 px document. The nine
 * performance figures were nine equal tiles in a three-across grid, each carrying its own
 * `How is this calculated?` line.
 *
 * The rail below ranks three of those nine and qualifies with six; the trend is one large
 * chart with a measure switch instead of four quarter-width ones; and the two comparisons a
 * GSM actually makes — new against used, and store against store — are lengths rather than
 * table cells.
 *
 * NOTHING HERE COMPUTES ANYTHING
 * ------------------------------
 * Every figure arrives already resolved and already formatted by `lib/dashboard/sales-gross.ts`
 * from the governed exports. This file chooses which figure is large, which is small and which
 * is drawn as a length. `UX.2B` §54 forbids a KPI change and §45 forbids business arithmetic
 * in the browser; there is no arithmetic in this file at all, and no client JavaScript —
 * including the measure switch, which is a radio group and CSS.
 *
 * THE FOUR STATES ARE STILL FOUR STATES. A figure renders as a value, "No matching records",
 * "No eligible denominator" or "Not applicable", and a comparison bar draws nothing at all for
 * the last three. Collapsing any of them into $0 would be a false statement about a real
 * month, and a zero-length bar is that same false statement drawn.
 */
import { Card } from '@/components/ui/card-static'
import { Disclosure } from '@/components/ui/disclosure'
import { Heading, Text } from '@/components/ui/typography'
import type {
  MixBreakdown,
  PerformanceMetric,
  TrendSeries,
} from '@/lib/dashboard/sales-gross'
import { kpiDefinition, kpiDefinitionHref } from '@/lib/dashboard/sales-gross'
import { formatCountExact, formatCurrencyExact } from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import { figureText } from './sales-gross-sections'
import { TrendChart, storeMarkClass, type TrendPoint } from './visuals'
import { GroupedMeasureBars, MetricSwitch } from './workspace-visuals'

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The three a general sales manager reads first, and the six that qualify them.
 *
 * WHY THESE THREE. `UX.2B` §6 names retail units, total gross and total GPRU as the likely
 * primary emphasis and warns against mechanically showing all seven at one weight. Volume,
 * money and rate are the three legs of the only sentence a Monday sales meeting opens with,
 * and each of the other six is a decomposition of one of them: new and used split the volume,
 * front and back split the gross, front and back PVR split the rate.
 *
 * ORDER IS FIXED HERE AND NOT READ FROM THE ARRAY. The view model publishes nine metrics in
 * catalogue order, which is not reading order. Selecting by identifier rather than by index
 * means a tenth metric arriving in the middle of that array cannot silently promote itself
 * into the rail.
 */
const LEAD_METRICS = ['retail-units', 'total-gross', 'total-pvr'] as const
const SUPPORTING_METRICS = [
  'new-units',
  'used-units',
  'front-gross',
  'back-gross',
  'front-pvr',
  'back-pvr',
] as const

function pick(
  metrics: readonly PerformanceMetric[],
  ids: readonly string[]
): readonly PerformanceMetric[] {
  return ids
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter((metric): metric is PerformanceMetric => metric !== undefined)
}

/**
 * The rail.
 *
 * ONE METHODOLOGY DISCLOSURE, NOT NINE. Measured before this pass: eleven
 * `How is this calculated?` summary lines on the route, nine of them inside the metric grid,
 * where the methodology was correctly available and repeated until it read as furniture. It
 * is now one disclosure at the foot of the rail carrying every rail card's full catalogue
 * entry in card order — the same definition and the same formula, nothing summarised and
 * nothing dropped. `<details>` keeps all of it in the document, in the accessibility tree's
 * reading order, in a browser text search, in the printed page and with scripting off. This
 * is the arrangement `kpi-strip.tsx` arrived at on the Executive for the same reason.
 */
export function SalesRail({
  metrics,
  comparisonLabel,
  comparisonUnavailable,
}: {
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
  readonly comparisonUnavailable: string | null
}) {
  const lead = pick(metrics, LEAD_METRICS)
  const supporting = pick(metrics, SUPPORTING_METRICS)
  const rail = [...lead, ...supporting]

  return (
    <div className="flex flex-col gap-2">
      {comparisonUnavailable === null ? null : (
        <Text size="xs" tone="muted" className="max-w-prose">
          {comparisonUnavailable}
        </Text>
      )}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {lead.map((metric) => (
          <RailCard
            key={metric.id}
            metric={metric}
            rank="lead"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {supporting.map((metric) => (
          <RailCard
            key={metric.id}
            metric={metric}
            rank="supporting"
            comparisonLabel={comparisonLabel}
          />
        ))}
      </ul>

      <Disclosure
        label="How every figure on this rail is calculated"
        className="border-0"
      >
        <div className="flex flex-col gap-5">
          {rail.map((metric) => {
            const definition =
              metric.kpiId === null ? undefined : kpiDefinition(metric.kpiId)
            return (
              <div key={metric.id} className="flex flex-col gap-1">
                <Heading level={4} size="h6" className="text-ink-secondary">
                  {metric.label}
                </Heading>
                {metric.kpiId === null ? null : (
                  <a
                    href={kpiDefinitionHref(metric.kpiId)}
                    className="inline-flex min-h-6 items-center self-start font-mono text-2xs tracking-wide text-ink-faint underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  >
                    {metric.kpiId}
                  </a>
                )}
                {definition === undefined ? (
                  <Text size="xs" tone="muted">
                    {`No catalogue entry: ${metric.label.toLowerCase()} is a derived figure this page publishes for context, in ${metric.unit}.`}
                  </Text>
                ) : (
                  <>
                    <Text size="xs" tone="muted">
                      {definition.definition}
                    </Text>
                    <Text size="xs" tone="faint" className="numeric">
                      {definition.formula}
                    </Text>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Disclosure>
    </div>
  )
}

/**
 * One rail card.
 *
 * THE IDENTIFIER SITS UNDER THE FIGURE, not above it — the same correction `kpi-strip.tsx`
 * made: a `KPI-GRS-006` between a card's name and its value is in the eye path of a reader
 * looking for a number. It is still on the card, in text, found by a browser search and read
 * in order by assistive technology.
 *
 * THE COMPARISON IS NEVER COLOURED. This console declares no favourable direction for a gross
 * measure, and colouring a fall red would be a judgement rather than a figure.
 */
function RailCard({
  metric,
  rank,
  comparisonLabel,
}: {
  readonly metric: PerformanceMetric
  readonly rank: 'lead' | 'supporting'
  readonly comparisonLabel: string | null
}) {
  const figure = metric.figure
  const resolved = figure.current.kind === 'value'
  return (
    <Card
      as="li"
      padding="none"
      data-kpi-card={metric.id}
      data-kpi-rank={rank}
      className={cx(
        'flex min-w-0 flex-col gap-1',
        rank === 'lead' ? 'p-3.5' : 'gap-0.5 p-2.5'
      )}
    >
      <Heading level={3} size="h6" className="text-xs leading-snug text-ink-secondary">
        {metric.label}
      </Heading>
      <span
        className={cx(
          resolved
            ? cx(
                'numeric font-semibold text-ink',
                rank === 'lead' ? 'text-2xl' : 'text-base'
              )
            : 'text-sm text-ink-muted'
        )}
      >
        {figureText(figure.current)}
      </span>
      {figure.difference === null ? (
        <p className="text-2xs leading-normal text-ink-faint">
          {figure.current.kind === 'not-applicable'
            ? figure.current.reason
            : comparisonLabel === null
              ? 'No comparison period selected'
              : 'No comparable figure'}
        </p>
      ) : (
        <p className="numeric text-2xs leading-normal text-ink-muted">
          {figure.difference}
          {comparisonLabel === null ? '' : ` vs ${comparisonLabel}`}
        </p>
      )}
      {metric.kpiId === null ? null : (
        <p className="mt-auto pt-0.5 font-mono text-2xs tracking-wide text-ink-faint">
          {metric.kpiId}
        </p>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* The primary trend                                                           */
/* -------------------------------------------------------------------------- */

const GRANULARITY_COPY: Readonly<Record<string, string>> = {
  daily: 'one column per sale date',
  weekly: 'one column per ISO week, starting Monday',
  monthly: 'one column per calendar month',
}

/**
 * The period's shape, on whichever of the three rail measures the reader asks for.
 *
 * ONE LARGE CHART INSTEAD OF FOUR SMALL ONES. The route drew retail units, total gross, front
 * gross and total PVR as four quarter-width charts in a two-column grid — 32 columns of a
 * December daily series across roughly 300 px, which is a column every nine pixels. `UX.2B` §7
 * asks for a primary trend large enough to reveal movement and forbids substituting decorative
 * microcharts for it. One chart at full module width does that, and the switch is what makes
 * three measures fit in the space of one.
 *
 * FRONT GROSS LEFT THE SWITCH AND DID NOT LEAVE THE PAGE. It is a rail figure with its own
 * comparison, and it is a segment of the gross-composition module. What it stopped being is a
 * fourth trend the reader had to scan past to reach the rate.
 *
 * THE SWITCH RECOMPUTES NOTHING. All three panels are server-rendered from the same
 * `TrendSeries` the view model built, and each bucket's per-unit gross was recomputed inside
 * that bucket from its own summed gross and units — never the mean of the daily rates the
 * dataset publishes, which would weight a one-unit Tuesday like a nine-unit Saturday.
 */
export function SalesTrend({
  series,
  comparisonLabel,
}: {
  readonly series: TrendSeries
  readonly comparisonLabel: string | null
}) {
  const caption = `Aggregated to ${GRANULARITY_COPY[series.granularity] ?? series.granularity}, chosen from the length of the selected period.`

  const panels = [
    {
      id: 'units',
      label: 'Retail units',
      valueHeading: 'Units',
      caption,
      points: series.points.map((point): TrendPoint => ({
        key: point.key,
        label: point.label,
        value: point.retailUnits,
        display: formatCountExact(point.retailUnits),
      })),
    },
    {
      id: 'gross',
      label: 'Total gross',
      valueHeading: 'Total gross',
      caption,
      points: series.points.map((point): TrendPoint => ({
        key: point.key,
        label: point.label,
        value: point.totalGross,
        display: formatCurrencyExact(point.totalGross),
      })),
    },
    {
      id: 'gpru',
      label: 'Total GPRU',
      valueHeading: 'Total gross per retail unit',
      caption: `${caption} A period with no retail unit has no per-unit gross and is drawn as a gap, never as zero.`,
      points: series.points.map((point): TrendPoint => ({
        key: point.key,
        label: point.label,
        value: point.totalPvr,
        display:
          point.totalPvr === null
            ? 'No eligible denominator'
            : formatCurrencyExact(point.totalPvr),
      })),
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      {series.notice === null ? null : (
        <Text size="xs" tone="muted">
          {series.notice}
        </Text>
      )}
      <MetricSwitch
        name="sales-trend"
        legend="Trend measure"
        options={panels.map((panel) => ({
          id: panel.id,
          label: panel.label,
          panel: (
            <TrendChart
              title={panel.label}
              caption={panel.caption}
              measure={panel.label}
              points={panel.points}
              periodHeading="Period"
              valueHeading={panel.valueHeading}
              className="pt-3"
            />
          ),
        }))}
      />
      {comparisonLabel === null ? null : (
        <p className="text-2xs leading-normal text-ink-faint">
          {`${comparisonLabel} is shown as a difference on the rail above rather than as a second series here: two overlaid shapes invite a reader to compare outlines when the figure that matters is the difference.`}
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* New against used                                                            */
/* -------------------------------------------------------------------------- */

/** The two condition marks. Identity, in exported order, and not a ranking. */
const CONDITION_MARKS: Readonly<Record<string, string>> = {
  new: 'bg-data-primary',
  used: 'bg-data-secondary',
}

const CONDITION_MARK_FALLBACK = 'bg-data-tertiary'

/**
 * New against used, on volume, money and rate.
 *
 * ONE COMPARISON, THREE MEASURES — not three visual encodings of the same answer, which
 * `UX.2B` §8 forbids. Volume, gross and GPRU answer three different questions about the same
 * split, and a used department can carry more units than new while earning less per unit; that
 * is the finding, and it is invisible unless all three are on one set of bars.
 *
 * CERTIFIED IS INSIDE USED AND HAS NO BAR HERE. The warehouse splits gross into New and Used
 * only, and a certified pre-owned unit is Used. `UX.2B` §8 forbids a third certified unit KPI
 * and this creates none: the certified retail unit count is published, as secondary context,
 * in the sale-type detail below the fold, where it is labelled as already being inside the
 * retail count.
 *
 * A ZERO IS DRAWN AND AN UNDEFINED RATE IS NOT. A store that sold no new vehicle in the period
 * has a real zero, and it draws a zero-length bar. Its new GPRU is undefined rather than zero,
 * and draws nothing at all.
 */
export function ConditionSplit({ mix }: { readonly mix: MixBreakdown }) {
  return (
    <GroupedMeasureBars
      // The MODULE is titled "New and used"; the figure inside it says what is compared, so
      // the two headings do not print the same three words one above the other.
      title="Condition contribution"
      caption="Each measure is scaled to its own larger side. Lengths compare within a measure and never across two."
      identityHeading="Condition"
      groups={[
        {
          id: 'units',
          label: 'Retail units',
          kpiId: null,
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.unitsExact,
            display: formatCountExact(row.unitsExact),
            markClass: CONDITION_MARKS[row.key] ?? CONDITION_MARK_FALLBACK,
          })),
        },
        {
          id: 'gross',
          label: 'Total gross',
          kpiId: 'KPI-GRS-003',
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.gross,
            display: row.grossDisplay,
            markClass: CONDITION_MARKS[row.key] ?? CONDITION_MARK_FALLBACK,
          })),
        },
        {
          id: 'gpru',
          label: 'Total GPRU',
          kpiId: 'KPI-GRS-006',
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.pvr,
            display: row.pvrDisplay ?? 'No eligible denominator',
            markClass: CONDITION_MARKS[row.key] ?? CONDITION_MARK_FALLBACK,
          })),
        },
      ]}
      notice="A certified pre-owned unit is Used, which is the split the export publishes. The certified retail unit count is in the sale-type detail below and is already inside the retail count."
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Store contribution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What each store contributed, on the same three measures.
 *
 * THE MARK COMES FROM THE BUSINESS CODE, through the same `storeMarkClass` the Executive
 * comparison uses, so a store keeps its hue across both routes and cannot change colour
 * because another store left the filter.
 *
 * NOTHING IS RANKED. Rows are in the order the view model resolved the scope in, which is
 * business-code order; no mark means best, no composite is formed across the three measures,
 * and the words best, worst, winner and loser appear nowhere on this route.
 */
export function StoreContribution({
  mix,
  singleStore,
}: {
  readonly mix: MixBreakdown
  readonly singleStore: boolean
}) {
  return (
    <GroupedMeasureBars
      title="Store contribution"
      caption="Each measure is scaled to its own largest store. Lengths compare within a measure and never across two."
      identityHeading="Store"
      groups={[
        {
          id: 'units',
          label: 'Retail units',
          kpiId: 'KPI-SLS-001',
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.unitsExact,
            display: formatCountExact(row.unitsExact),
            markClass: storeMarkClass(row.key),
          })),
        },
        {
          id: 'gross',
          label: 'Total gross',
          kpiId: 'KPI-GRS-003',
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.gross,
            display: row.grossDisplay,
            markClass: storeMarkClass(row.key),
          })),
        },
        {
          id: 'gpru',
          label: 'Total GPRU',
          kpiId: 'KPI-GRS-006',
          rows: mix.rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.pvr,
            display: row.pvrDisplay ?? 'No eligible denominator',
            markClass: storeMarkClass(row.key),
          })),
        },
      ]}
      notice={
        singleStore
          ? 'One store is in scope, so there is nothing to compare it against. Remove the store filter above to see all three.'
          : 'Business-code order. Nothing is ranked and no store score exists: the three run different operating models.'
      }
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Sale-type detail                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The sale-type counts, as a table, because they are counts and nothing else.
 *
 * NOT DRAWN AS A COMPARISON, DELIBERATELY. The export publishes a unit count per sale type and
 * no gross, so the only measure available is one column; a bar chart of four counts where the
 * page above already carries the volume comparison would be `UX.2B` §11's "third visual
 * encoding of the same answer". Wholesale and dealer trades are also not inside the retail
 * count, so drawing them beside a retail split would invite exactly the addition the note
 * forbids.
 */
export function SaleTypeDetail({ mix }: { readonly mix: MixBreakdown }) {
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{mix.title}</caption>
        <thead>
          <tr className="border-b border-line-subtle text-left">
            <th scope="col" className="py-1.5 pr-2 font-medium text-ink-muted">
              Sale type
            </th>
            <th scope="col" className="py-1.5 text-right font-medium text-ink-muted">
              Units
            </th>
          </tr>
        </thead>
        <tbody>
          {mix.rows.map((row) => (
            <tr key={row.key} className="border-b border-line-subtle/60 last:border-0">
              <th scope="row" className="py-1.5 pr-2 font-normal text-ink-secondary">
                {row.label}
              </th>
              <td className="numeric py-1.5 text-right text-ink">
                {formatCountExact(row.unitsExact)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mix.note === null ? null : (
        <p className="text-2xs leading-normal text-ink-faint">{mix.note}</p>
      )}
    </div>
  )
}
