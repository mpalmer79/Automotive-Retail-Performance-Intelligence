/**
 * The Inventory workspace's modules.
 *
 * Server components without exception. Every figure arrives already resolved by
 * `lib/dashboard/inventory.ts` and is formatted here by a governed formatter; nothing in
 * this file computes a measure, and nothing decides what one means.
 *
 * THE THREE THINGS THIS ROUTE IS CAREFUL ABOUT, AND WHY EACH APPEARS IN THE GEOMETRY
 * ----------------------------------------------------------------------------------
 * THE MARKET ESTIMATE IS SYNTHETIC. It is generated, no auction result or guidebook exists
 * anywhere in this project, and the ratio built on it is descriptive: above 1.0 means
 * advertised above the estimate and nothing more. Every visual that draws it carries that
 * sentence, and none of them contains the words overpriced, underpriced, reprice or
 * opportunity — there is no vocabulary in this file with which to make a recommendation.
 *
 * THE AGED THRESHOLD IS READ AND IS A PROJECT DEFAULT. It is 60, it comes off the row
 * rather than out of this file, and it is a DIFFERENT NUMBER from the top age bucket. The
 * age ramp turns amber at it, so the legend states it: a colour ramp that turned at an
 * unstated boundary would read as an industry standard nobody published.
 *
 * A MISSING VALUE IS MISSING. A unit with no estimate is absent from the position map and
 * counted in the coverage figure, never plotted at zero. A unit on its first reportable
 * snapshot has no prior price and is counted as a first appearance, never as an unchanged
 * one.
 */
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import { exactFromInteger, type Exact } from '@/lib/dashboard/decimal'
import {
  formatCurrencyDifference,
  formatCurrencyExact,
  formatRateExact,
} from '@/lib/dashboard/format'
import type { InventorySummary, PriceMovement, UnitRow } from '@/lib/dashboard/inventory'

import { DistributionStrip, InventoryAgeStack, TableDisclosure } from './visuals'
import { PositionMap, type PositionPoint } from './workspace-visuals'

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

function RailCell({
  id,
  label,
  value,
  note,
  rank,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly note?: string
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <li
      data-kpi-card={id}
      data-kpi-rank={rank}
      className={`flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface ${rank === 'lead' ? 'p-3' : 'p-2.5'}`}
    >
      <h3 className="text-xs leading-snug font-medium text-ink-secondary">{label}</h3>
      <span
        className={`numeric font-semibold text-ink ${rank === 'lead' ? 'text-2xl' : 'text-lg'}`}
      >
        {value}
      </span>
      {note === undefined ? null : (
        <p className="mt-auto pt-0.5 text-2xs text-ink-faint">{note}</p>
      )}
    </li>
  )
}

/**
 * The lot at one date, as six figures.
 *
 * THE POSITION IS AT ONE DATE AND THE RAIL SAYS SO ONCE. Unit counts and investment are
 * semi-additive: they add across units and stores on the snapshot date and never across
 * dates. Repeating that on six cards is what made the previous four-card grid taller than
 * the chart it introduced, so it is stated once, under the rail, in the reading order a
 * screen reader meets it in.
 *
 * MEDIAN AGE IS THE HEADLINE AND THE MEAN IS BESIDE IT. Inventory age is right-skewed and
 * the gap between the two IS the aged tail; either alone invites the wrong conclusion.
 *
 * MEAN ASKING PRICE AND COVERAGE CARRY NO CATALOGUE IDENTIFIER, because neither is a
 * published KPI. Both are arithmetic over exported columns at the grain the export
 * publishes them, and the cards do not pretend otherwise by wearing an identifier.
 */
export function InventoryRail({ summary }: { readonly summary: InventorySummary }) {
  const threshold = summary.agedThresholdDays ?? 60
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <RailCell
          id="active-units"
          rank="lead"
          label="Active units"
          value={String(summary.units)}
        />
        <RailCell
          id="investment"
          rank="lead"
          label="Inventory investment"
          value={formatCurrencyExact(summary.investment)}
          note="Acquisition plus reconditioning. Not the accounting book value."
        />
        <RailCell
          id="median-age"
          rank="lead"
          label="Median days in stock"
          value={summary.medianAge === null ? '—' : String(summary.medianAge)}
          note={
            summary.meanAge === null ? undefined : `Mean ${summary.meanAge.toFixed(1)} days`
          }
        />
      </ul>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <RailCell
          id="aged-share"
          rank="supporting"
          label={`Aged over ${String(threshold)} days`}
          value={
            summary.agedShare === null
              ? String(summary.agedUnits)
              : `${(summary.agedShare * 100).toFixed(1)}%`
          }
          note={`${String(summary.agedUnits)} of ${String(summary.units)} units · ARPI project default, not an industry benchmark`}
        />
        <RailCell
          id="mean-asking"
          rank="supporting"
          label="Average asking price"
          value={
            summary.meanAskingPrice === null
              ? '—'
              : formatCurrencyExact(summary.meanAskingPrice, 0)
          }
          note="Mean advertised price across the units in scope. Not a published KPI."
        />
        <RailCell
          id="estimate-coverage"
          rank="supporting"
          label="Market-estimate coverage"
          value={
            summary.estimateCoverage === null
              ? '—'
              : `${(summary.estimateCoverage * 100).toFixed(1)}%`
          }
          note={`${String(summary.unitsWithEstimate)} of ${String(summary.units)} units carry a synthetic estimate · ${String(summary.unitsWithoutEstimate)} have none`}
        />
      </ul>
      <p className="text-2xs text-ink-faint">
        Positions at the snapshot date. They add across units and stores on that date and
        never across dates.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Age and capital                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The five governed age buckets, as units and as the capital standing in them.
 *
 * TWO TRACKS OVER THE SAME BANDS, WHICH IS THE WHOLE POINT. Eleven per cent of the units
 * and twenty-six per cent of the money is the finding a used-vehicle manager is looking
 * for, and it is invisible unless the two distributions are read against each other on one
 * set of bands. `InventoryAgeStack` already draws exactly that for the Executive, from the
 * same five governed buckets; this route hands it the same shape computed from the unit
 * grain it decodes rather than from the aging export, and the two agree because both sum
 * the same population into the same exported bucket labels.
 *
 * THE CAPITAL TRACK IS DRAWN ONLY WHEN EVERY BAND CARRIES A FIGURE. A partial capital bar
 * beside a complete unit bar invites exactly the comparison it cannot support.
 */
export function AgeAndCapital({ summary }: { readonly summary: InventorySummary }) {
  /*
   * BOTH SHARES ARRIVE ALREADY DIVIDED. `summarizeInventory` divides each bucket's capital
   * against the population's own total, exactly, and publishes the ratio; this file turns a
   * ratio into a width and touches no exact value at all. Every capital figure a reader
   * sees is formatted by `formatCurrencyExact` from the exact amount, never from a float.
   */
  const segments = summary.buckets.map((bucket) => ({
    key: bucket.bucket,
    label: `${bucket.bucket} days`,
    display: `${String(bucket.units)} unit${bucket.units === 1 ? '' : 's'}`,
    share: bucket.share ?? 0,
    capitalDisplay: formatCurrencyExact(bucket.investment, 0),
    capitalShare: bucket.investmentShare ?? 0,
  }))

  return (
    <InventoryAgeStack
      title="Units and capital, by age bucket"
      segments={segments}
      snapshotNote={
        summary.snapshotDate === null
          ? 'No snapshot date falls inside the selected period.'
          : `Position at ${summary.snapshotDate}.`
      }
      thresholdDays={summary.agedThresholdDays}
      headingLevel={4}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Price movement                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How the advertised price moved between the two most recent month ends.
 *
 * WHAT THE GRAIN SUPPORTS, AND WHAT IT DOES NOT. `UX.2B` §6D asks for asking-price change
 * "over available snapshot context where current grain supports it". The route decodes ONE
 * month's partitions per request — a deliberate cost decision recorded on the page — so a
 * multi-month price track per unit is not available to it without opening five more
 * partitions per store to draw one chart. What IS available is the change the export
 * publishes on every row: current asking price less the prior month end's, for the same
 * unit at the same store. That is one observation per unit, so it is drawn as a
 * DISTRIBUTION of changes rather than as a time series, which is the honest form for it.
 *
 * A FIRST APPEARANCE IS NOT AN UNCHANGED PRICE and is counted separately, outside the
 * bands, because a lot that has just taken delivery of thirty units is not a lot that has
 * held thirty prices steady.
 *
 * NOTHING HERE IS A DECISION. The change is observed. ARPI models no repricing action, no
 * pricing strategy and no manager intent, and the note under the bands says so.
 */
export function PriceMovementSection({
  movement,
  units,
}: {
  readonly movement: PriceMovement
  readonly units: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <DistributionStrip
        title="Change since the prior month end"
        buckets={movement.bands.map((band) => ({
          key: band.key,
          label: band.label,
          count: band.units,
          isNegative: band.isReduction,
        }))}
        unit="units"
        headingLevel={4}
      />
      <dl className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col rounded-lg border border-line-subtle bg-surface p-2.5">
          <dt className="text-2xs leading-snug text-ink-muted">First appearance</dt>
          <dd className="numeric text-base font-semibold text-ink">
            {String(movement.firstAppearance)}
          </dd>
          <dd className="text-2xs text-ink-faint">
            No prior observation, so no change is defined
          </dd>
        </div>
        <div className="flex min-w-0 flex-col rounded-lg border border-line-subtle bg-surface p-2.5">
          <dt className="text-2xs leading-snug text-ink-muted">
            With a recorded markdown
          </dt>
          <dd className="numeric text-base font-semibold text-ink">
            {String(movement.withMarkdown)}
          </dd>
          <dd className="text-2xs text-ink-faint">
            {`of ${String(units)} units in scope, to date`}
          </dd>
        </div>
      </dl>
      <Text size="xs" tone="faint">
        An observed change between consecutive month-end snapshots of the same unit at the
        same store. It is not evidence of a manager decision, a pricing strategy or a
        repricing action; ARPI models none of those.
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The position map                                                            */
/* -------------------------------------------------------------------------- */

/** The age ramp step a unit's bucket sits at, from the governed bucket order. */
const BUCKET_STEP: Readonly<Record<string, number>> = {
  '0-30': 0,
  '31-60': 1,
  '61-90': 2,
  '91-120': 3,
  'Over 120': 4,
}

/**
 * Days in stock against price to market, with inventory investment as mark area.
 *
 * WHY THIS IS BUILT AND WHAT WAS CHECKED FIRST. `UX.2B` §6C permits it only if the current
 * unit-grain data supports every dimension without fabrication. It does, and every one is a
 * published column of `inventory-units` on the row being plotted: `days_in_stock`,
 * `price_to_market_ratio` and `inventory_investment`. No fourth measure is derived, no
 * score is formed, and no point is imputed.
 *
 * UNITS WITHOUT AN ESTIMATE ARE ABSENT, NOT PLOTTED AT ZERO. A unit the estimator declined
 * to price has no ratio, and drawing it at 0.0 would put it at the extreme left of an axis
 * it does not belong on. The count of those units is on the rail as coverage and is stated
 * again under the plot, so the population the picture describes is never something a reader
 * has to infer.
 *
 * NEUTRAL LANGUAGE THROUGHOUT, and it is checked by a test rather than by intention. The
 * axes are named "Price to market (synthetic estimate)" and "Days in stock". There is no
 * quadrant, no zone, no label and no ordering that says which end of either axis is the
 * good end.
 */
export function PositionMapSection({
  units,
  summary,
  route,
  selectedUnitId,
  skipTargetId,
}: {
  readonly units: readonly UnitRow[]
  readonly summary: InventorySummary
  readonly route: string
  readonly selectedUnitId: string | null
  readonly skipTargetId: string
}) {
  const plotted = units.filter((unit) => unit.priceToMarketRatio !== null)
  const points: readonly PositionPoint[] = plotted.map((unit) => {
    const ratio = unit.priceToMarketRatio as Exact
    const days = daysAsExact(unit.daysInStock)
    const ratioDisplay = formatRateExact(ratio, 3)
    return {
      key: unit.vehicleId,
      label: unit.vehicleId,
      sublabel: `${String(unit.modelYear)} ${unit.make} ${unit.modelName}`,
      x: ratio,
      xDisplay: ratioDisplay,
      y: days,
      yDisplay: String(unit.daysInStock),
      area: unit.inventoryInvestment,
      areaDisplay: formatCurrencyExact(unit.inventoryInvestment, 0),
      /*
       * THE MARK'S ACCESSIBLE NAME, AND IT IS AS SHORT AS IT CAN BE WITHOUT LOSING A FIGURE.
       *
       * It carries the identity and all three plotted values, which is what `UX.2B` §7's
       * "exact textual point information" requires. It deliberately does NOT repeat the age
       * bucket (the day count is on the same line and the bucket is derived from it) or the
       * phrase "against the synthetic estimate" (the axis note states it once, and 234 marks
       * repeating it is several kilobytes of the same sentence).
       */
      description:
        `${unit.vehicleId}, ${String(unit.modelYear)} ${unit.make} ${unit.modelName}. ` +
        `${String(unit.daysInStock)} days in stock. ` +
        `Asking ${formatCurrencyExact(unit.currentAskingPrice, 0)}. ` +
        `Price to market ${ratioDisplay}. ` +
        `Investment ${formatCurrencyExact(unit.inventoryInvestment, 0)}.`,
      href: `${route}?unit=${unit.vehicleId}#unit`,
      rampStep: BUCKET_STEP[unit.ageBucket] ?? 4,
      ...(selectedUnitId === unit.vehicleId ? { isSelected: true } : {}),
    }
  })

  const ratios = plotted
    .map((unit) => unit.priceToMarketRatio)
    .filter((value): value is Exact => value !== null)
  const days = plotted.map((unit) => unit.daysInStock)

  return (
    <div className="flex flex-col gap-3">
      <PositionMap
        title="Days in stock against price to market"
        points={points}
        xAxis={{
          label: 'Price to market (synthetic estimate)',
          ticks: axisTicks(ratios.map((value) => formatRateExact(value, 2))),
          note: 'Price to market is the asking price divided by a SYNTHETIC reference value generated for this fictional dataset. It is not a market valuation and is drawn from no auction result, guidebook or licensed benchmark. A unit at 1.05 is advertised five per cent above that reference, and that is the whole of the claim.',
        }}
        yAxis={{
          label: 'Days in stock',
          ticks: axisTicks(days.map((value) => String(value))),
        }}
        areaLabel="Inventory investment"
        legend={summary.buckets.map((bucket) => `${bucket.bucket} days`)}
        skipTargetId={skipTargetId}
        emptyNote="No unit in this selection carries a synthetic market estimate, so no position can be plotted. A unit without an estimate has no ratio; it is not plotted at zero."
        externalTable={{ href: '#units', label: 'The unit table' }}
        headingLevel={4}
      />
      <Text size="xs" tone="faint">
        {`${String(plotted.length)} of ${String(summary.units)} units are plotted. ` +
          `${String(summary.unitsWithoutEstimate)} carry no synthetic estimate and therefore no ratio; they are absent rather than drawn at zero.`}
      </Text>
    </div>
  )
}

/**
 * The two ends of an axis, as already-formatted labels.
 *
 * THE EXTREMES AND NOTHING BETWEEN THEM, and the reason is a defect this increment shipped
 * and caught. The first version returned three labels — the smallest value, the MEDIAN and
 * the largest — and the primitive lays ticks out with `justify-between`, so the median was
 * drawn at the exact centre of a range it does not sit at. On the December lot that printed
 * "46" halfway up an axis running 0 to 334, and "0.97" halfway along one running 0.86 to
 * 1.12. Both are true numbers in false positions, which is the one kind of chart error a
 * reader cannot detect by looking at the chart.
 *
 * The extremes are the DATA'S OWN rather than rounded to a pleasant number nearby: this
 * plot draws no gridlines, so an invented boundary would have nothing to anchor against and
 * would move the marks relative to their own labels.
 */
function axisTicks(values: readonly string[]): readonly string[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => Number(a) - Number(b))
  const low = sorted[0] ?? ''
  const high = sorted[sorted.length - 1] ?? ''
  return low === high ? [low] : [low, high]
}

/**
 * A whole-number day count as an exact value, so a coordinate can be computed from it.
 *
 * `days_in_stock` is exported as an integer and arrives on `UnitRow` as a `number`, which
 * is correct for a count. The position primitive takes `Exact` for every coordinate — the
 * rule `visuals.tsx` states — so the count is lifted rather than the rule being bent.
 */
function daysAsExact(days: number): Exact {
  return exactFromInteger(Math.round(days))
}

/* -------------------------------------------------------------------------- */
/* Unit table                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every unit on the lot, with its exact figures.
 *
 * IT IS A DISCLOSURE AND IT IS STILL IN THE DOCUMENT. `<details>` collapses the table
 * visually while leaving it in the accessibility tree's reading order, in a browser text
 * search and in the printed page — the same technique every chart on this console uses for
 * its data alternative. A reader arriving to look at a lot meets its shape first; a reader
 * who wants two hundred rows goes and opens them.
 */
export function UnitTable({
  units,
  route,
  snapshotDate,
  emptyReason,
}: {
  readonly units: readonly UnitRow[]
  readonly route: string
  readonly snapshotDate: string | null
  readonly emptyReason: string
}) {
  if (units.length === 0) {
    return (
      <Text size="sm" tone="muted">
        {emptyReason}
      </Text>
    )
  }
  return (
    <TableDisclosure title={`every unit at ${snapshotDate ?? 'this date'}`}>
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">
          {`Inventory units at ${snapshotDate ?? 'no date'}`}
        </caption>
        <thead>
          <tr className="border-b border-line-subtle text-left">
            <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
              Unit
            </th>
            <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
              Store
            </th>
            <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
              Vehicle
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
              Days
            </th>
            <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
              Bucket
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
              Asking
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
              Est. (synthetic)
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
              Price to market
            </th>
            <th scope="col" className="py-2 text-right font-medium text-ink-muted">
              Since prior
            </th>
          </tr>
        </thead>
        <tbody>
          {units.map((row) => (
            <tr key={row.vehicleId} className="border-b border-line-subtle/60 last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                <a
                  className="underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  href={`${route}?unit=${row.vehicleId}#unit`}
                >
                  {row.vehicleId}
                </a>
              </th>
              <td className="py-1.5 pr-3 text-ink-muted">{row.dealershipId}</td>
              <td className="py-1.5 pr-3 text-ink-muted">
                {row.modelYear} {row.make} {row.modelName}
              </td>
              <td className="numeric py-1.5 pr-3 text-right text-ink">{row.daysInStock}</td>
              <td className="py-1.5 pr-3 text-ink-muted">{row.ageBucket}</td>
              <td className="numeric py-1.5 pr-3 text-right text-ink">
                {formatCurrencyExact(row.currentAskingPrice)}
              </td>
              <td className="numeric py-1.5 pr-3 text-right text-ink">
                {row.marketPriceEstimate === null ? (
                  <span className="text-ink-faint">No estimate</span>
                ) : (
                  formatCurrencyExact(row.marketPriceEstimate)
                )}
              </td>
              <td className="numeric py-1.5 pr-3 text-right text-ink">
                {row.priceToMarketRatio === null ? (
                  <span className="text-ink-faint">—</span>
                ) : (
                  formatRateExact(row.priceToMarketRatio, 3)
                )}
              </td>
              <td className="numeric py-1.5 text-right text-ink">
                {row.askingPriceChange === null ? (
                  <span className="text-ink-faint">First appearance</span>
                ) : (
                  formatCurrencyDifference(row.askingPriceChange, 2)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableDisclosure>
  )
}

/* -------------------------------------------------------------------------- */
/* The methodology disclosure                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The mechanics, once, behind one summary.
 *
 * The two CAVEATS this route cannot hide — that the aged threshold is a project default and
 * that the market estimate is synthetic — are on the rail, in the plot's axis note and in
 * the legend, where a reader meets them before the figure they qualify. What is here is the
 * paragraph-length version of each, which is mechanics.
 */
export function InventoryMethodology({
  syntheticNote,
  agedNote,
}: {
  readonly syntheticNote: string
  readonly agedNote: string
}) {
  return (
    <Disclosure label="What the market estimate is, and what the aged threshold means">
      <div className="flex flex-col gap-3">
        <Text size="sm" tone="muted">
          {syntheticNote}
        </Text>
        <Text size="sm" tone="muted">
          {agedNote}
        </Text>
        <Text size="sm" tone="muted">
          Price movement is derived from consecutive month-end snapshots of the same unit at
          the same store. It is an observed change in the advertised price and is not
          evidence of a manager decision, a pricing strategy or a repricing action; ARPI
          models none of those.
        </Text>
        <Text size="sm" tone="muted">
          Unit counts and investment are positions at the snapshot date. They add across
          units and stores on that date and never across dates.
        </Text>
      </div>
    </Disclosure>
  )
}
