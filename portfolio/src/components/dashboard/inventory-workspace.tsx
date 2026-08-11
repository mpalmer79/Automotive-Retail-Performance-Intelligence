/**
 * The Inventory workspace: the rail, the age-and-capital stack, the age × price-to-market map
 * and the price-movement comparison.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2B-BASELINE.md`: `/dashboard/inventory` was an 11,543 px document
 * containing four stat cells, a four-column age table and a unit table, and **not one framed
 * figure**. The densest domain in the project — unit-grain age, capital, asking price, a
 * synthetic market estimate and the ratio between them, all at one snapshot — was rendered
 * entirely as numbers in cells.
 *
 * WHAT IS DRAWN, AND WHAT IS REFUSED
 * ----------------------------------
 * Everything here resolves at ONE grain and ONE snapshot: a unit row at the resolved snapshot
 * date carries its days in stock, its age bucket, its inventory investment, its original and
 * current asking price, the synthetic estimate and the price-to-market ratio. Nothing is
 * joined across datasets and nothing is summed across dates — unit counts and investment are
 * semi-additive positions, which is why the page resolves one date and says which.
 *
 * The accounting book value was CONSIDERED as the bubble measure, because `UX.2B` §29 names
 * `current_book_value` first, and it was refused. It lives in `inventory-accounting`, a
 * different partition set that this route opens for ONE unit at a time when the detail panel
 * is open; opening all of it to size 250 bubbles would pull 360 kB of per-unit book values
 * into a route that does not otherwise need them, to plot a measure that answers the same
 * question `inventory_investment` answers from a column already in hand at the same grain and
 * the same date. The refusal and its reasoning are recorded in `UX-2B-REVIEW.md`.
 *
 * NO RECOMMENDATION, ANYWHERE. No quadrant is named, no unit is called overpriced,
 * underpriced, good or bad, and no price is suggested. The axes are labelled with their
 * directions and nothing else, and the market estimate is called a synthetic estimate every
 * time it appears.
 *
 * Server components. No client JavaScript. `exactToApproxNumber` is called for bar widths and
 * plot coordinates and never to produce a displayed figure; every printed amount comes from a
 * governed formatter over an exact value.
 */

import type { Exact } from '@/lib/dashboard/decimal'
import { compareExact, exactToApproxNumber } from '@/lib/dashboard/decimal'
import { formatCurrencyExact, formatRateExact } from '@/lib/dashboard/format'
import type { InventorySummary, UnitRow } from '@/lib/dashboard/inventory'
import { AGE_BUCKETS } from '@/lib/dashboard/inventory'
import { cx } from '@/lib/utils'

import { ChartFrame } from './visuals'
import { GroupedMeasureBars } from './workspace-visuals'

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1000) / 10)}%`
}

/**
 * The ordered age ramp, one class per step, written out in full.
 *
 * WRITTEN OUT BECAUSE TAILWIND SCANS SOURCE TEXT: a class built from a token name by template
 * literal is never emitted, and the mark renders with no background at all. The ramp is keyed
 * on the exported bucket ORDER, exactly as `InventoryAgeStack` keys it, so the map's marks and
 * the stack's segments cannot disagree about which band is which.
 */
const AGE_RAMP = [
  'bg-data-age-fresh',
  'bg-data-age-early',
  'bg-data-age-threshold',
  'bg-data-age-aged',
  'bg-data-age-critical',
] as const

const AGE_RAMP_LAST = 'bg-data-age-critical'

function ageRampClass(bucket: string): string {
  const index = AGE_BUCKETS.indexOf(bucket as (typeof AGE_BUCKETS)[number])
  if (index < 0) return AGE_RAMP_LAST
  return AGE_RAMP[index] ?? AGE_RAMP_LAST
}

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The lot's position at one date.
 *
 * WHICH FOUR ARE LARGE. `UX.2B` §26 prioritises units, capital, age and aged exposure and
 * warns against forcing every available value into the rail. Those four are the lead row;
 * price-to-market coverage and the repricing count are supporting context underneath, which
 * is exactly the rank §26 assigns them.
 *
 * EVERY FIGURE IS A POSITION, NOT A TOTAL. The scope note says so once, under the rail,
 * rather than on each card — a reader who takes an inventory count for a period sum can
 * misread it by roughly a factor of thirty, which is why the note is not optional and why
 * printing it six times is not more honest than printing it once.
 */
export function InventoryRail({
  summary,
  snapshotLabel,
}: {
  readonly summary: InventorySummary
  readonly snapshotLabel: string
}) {
  const threshold = summary.agedThresholdDays ?? 60
  const lead = [
    {
      id: 'active-units',
      label: 'Active units',
      value: summary.units === 0 ? null : String(summary.units),
      note: 'Held at this date',
    },
    {
      id: 'investment',
      label: 'Inventory investment',
      value: summary.units === 0 ? null : formatCurrencyExact(summary.investment),
      note: 'Acquisition plus reconditioning. Not the accounting book value.',
    },
    {
      id: 'median-age',
      label: 'Median days in stock',
      value: summary.medianAge === null ? null : String(summary.medianAge),
      note:
        summary.meanAge === null
          ? 'Median is the headline: age is right-skewed'
          : `Mean ${summary.meanAge.toFixed(1)} days. The gap is the aged tail.`,
    },
    {
      id: 'aged-units',
      label: `Aged over ${String(threshold)} days`,
      value: summary.units === 0 ? null : String(summary.agedUnits),
      note:
        summary.agedShare === null
          ? 'No units at this date'
          : `${(summary.agedShare * 100).toFixed(1)}% of units · ARPI project default, not a benchmark`,
    },
  ]

  const supporting = [
    {
      id: 'estimate-coverage',
      label: 'Price-to-market coverage',
      value:
        summary.estimateCoverage === null
          ? null
          : `${(summary.estimateCoverage * 100).toFixed(1)}%`,
      note: `${String(summary.unitsWithoutEstimate)} units carry no synthetic estimate and therefore no ratio`,
    },
    {
      id: 'repriced',
      label: 'Repriced since the prior month end',
      value: summary.units === 0 ? null : String(summary.reducedSincePrior),
      note: 'An observed change in the advertised price, not evidence of a decision',
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {lead.map((cell) => (
          <RailCell key={cell.id} {...cell} rank="lead" />
        ))}
      </dl>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {supporting.map((cell) => (
          <RailCell key={cell.id} {...cell} rank="supporting" />
        ))}
      </dl>
      <p className="text-2xs text-ink-faint">
        {`Every figure on this rail is a position at ${snapshotLabel}. Positions add across units and stores on that date and never across dates.`}
      </p>
    </div>
  )
}

function RailCell({
  id,
  label,
  value,
  note,
  rank,
}: {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly note: string
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <div
      data-inventory-figure={id}
      className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-3"
    >
      <dt className="text-xs leading-snug text-ink-secondary">{label}</dt>
      <dd
        className={cx(
          value === null
            ? 'text-sm text-ink-muted'
            : cx(
                'numeric font-semibold text-ink',
                rank === 'lead' ? 'text-2xl' : 'text-base'
              )
        )}
      >
        {value ?? 'No units at this date'}
      </dd>
      <dd className="mt-auto pt-0.5 text-2xs leading-normal text-ink-faint">{note}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Age × price-to-market                                                       */
/* -------------------------------------------------------------------------- */

/** One plotted unit. Every field comes from the same row at the same snapshot. */
interface MapPoint {
  readonly unit: UnitRow
  /** Horizontal position, `0`-`1`, from the price-to-market ratio. Geometry only. */
  readonly x: number
  /** Vertical position, `0`-`1`, from days in stock. Geometry only. */
  readonly y: number
  /** Mark diameter in pixels, from inventory investment. Geometry only. */
  readonly size: number
  readonly ratioDisplay: string
  readonly investmentDisplay: string
}

/**
 * Where age and asking price meet, one mark per unit.
 *
 * WHY THIS IS BUILDABLE HONESTLY, WHICH `UX.2B` §29 MAKES THE PRECONDITION. All four channels
 * come off ONE row of `inventory-units` at the ONE snapshot date the page resolved:
 * `price_to_market_ratio` on the horizontal, `days_in_stock` on the vertical,
 * `inventory_investment` as the mark's area and the exported `age_bucket` as its colour. No
 * join, no second dataset, no second date. A unit whose estimator declined to price it has no
 * ratio, so it has no horizontal position and is EXCLUDED and counted — never plotted at zero,
 * which would place an unpriced unit at the far left of an axis it is not on.
 *
 * AREA, NOT DIAMETER. A mark's perceived size is its area, so investment is mapped to area and
 * the diameter is its square root. Mapping the amount to the diameter would draw a unit worth
 * four times another one sixteen times as large.
 *
 * NO QUADRANT IS NAMED. `UX.2B` §29 forbids labelling regions overpriced, underpriced, good,
 * bad, reprice or opportunity unless such semantics are governed, and none of them is. The
 * axes carry a direction — older, higher price to market — and the 1.0 parity rule is drawn
 * because parity with the estimate is a defined point rather than a judgement. Nothing on this
 * figure recommends a price.
 *
 * ACCESSIBILITY, AND WHY THE MARKS ARE NOT 250 TAB STOPS. `UX.2B` §30 requires keyboard
 * access, an exact textual alternative, drill-through and no hover-only information. The marks
 * are `aria-hidden` decoration inside a focusable, labelled region, and the accessible
 * equivalent is the table below it: every plotted unit, with its exact days, ratio and
 * investment, and its identifier as a link into the unit's detail panel. That is the same
 * chart-plus-table contract every other figure in this console uses, and it is a better
 * keyboard experience than putting two hundred and fifty tab stops between a reader and the
 * next control. Nothing here is available only as a position, and nothing requires a pointer.
 */
export function AgePriceMap({
  units,
  snapshotLabel,
  className,
}: {
  readonly units: readonly UnitRow[]
  readonly snapshotLabel: string
  readonly className?: string
}) {
  /*
   * The plotted set, paired with its ratio so nothing downstream has to re-check for null.
   * A unit the estimator declined to price has no horizontal position and is excluded here,
   * once, rather than defended against at four later points.
   */
  const priced: readonly { readonly unit: UnitRow; readonly ratio: Exact }[] = units
    .map((unit) =>
      unit.priceToMarketRatio === null ? null : { unit, ratio: unit.priceToMarketRatio }
    )
    .filter((entry): entry is { unit: UnitRow; ratio: Exact } => entry !== null)
  const withoutEstimate = units.length - priced.length

  const ratios = priced.map((entry) => exactToApproxNumber(entry.ratio))
  const investments = priced.map((entry) =>
    exactToApproxNumber(entry.unit.inventoryInvestment)
  )

  const ratioMin = ratios.length === 0 ? 0 : Math.min(...ratios)
  const ratioMax = ratios.length === 0 ? 1 : Math.max(...ratios)
  const ratioSpan = ratioMax - ratioMin || 1
  const ageMax =
    priced.length === 0
      ? 1
      : Math.max(...priced.map((entry) => entry.unit.daysInStock), 1)
  const investmentMax = investments.length === 0 ? 1 : Math.max(...investments, 1)

  const points: readonly MapPoint[] = priced.map((entry, index) => {
    const ratio = ratios[index] ?? ratioMin
    const investment = investments[index] ?? 0
    return {
      unit: entry.unit,
      x: (ratio - ratioMin) / ratioSpan,
      y: entry.unit.daysInStock / ageMax,
      // Area proportional to investment, diameter its root, floored so the smallest unit
      // on the lot is still a visible mark rather than a rounding artefact.
      size: 6 + 16 * Math.sqrt(Math.max(investment, 0) / investmentMax),
      ratioDisplay: formatRateExact(entry.ratio, 3),
      investmentDisplay: formatCurrencyExact(entry.unit.inventoryInvestment),
    }
  })

  const parity = ratioMin <= 1 && ratioMax >= 1 ? (1 - ratioMin) / ratioSpan : null

  /*
   * The extremes of the plotted axis, as EXACT values rather than as the floats the geometry
   * uses. The summary sentence prints them, and a printed figure derived from a float is the
   * one thing this console never does.
   */
  const sortedByRatio = [...priced].sort((a, b) => compareExact(a.ratio, b.ratio))
  const ratioSmallest = sortedByRatio[0]?.ratio
  const ratioLargest = sortedByRatio[sortedByRatio.length - 1]?.ratio

  const summary =
    points.length === 0
      ? 'No unit at this snapshot carries a synthetic market estimate, so no ratio is defined and nothing is plotted.'
      : `${String(points.length)} units plotted by days in stock against price to market, sized by inventory investment, at ${snapshotLabel}. Price to market runs from ${ratioSmallest === undefined ? 'no value' : formatRateExact(ratioSmallest, 3)} to ${ratioLargest === undefined ? 'no value' : formatRateExact(ratioLargest, 3)}; days in stock reach ${String(ageMax)}. ${String(withoutEstimate)} of ${String(units.length)} units carry no synthetic estimate, so they have no ratio and are not plotted.`

  return (
    <ChartFrame
      title="Days in stock against price to market"
      caption="One mark per unit at this snapshot. Horizontal is the asking price against the synthetic market estimate; vertical is days in stock; mark area is inventory investment; colour is the exported age band."
      summary={summary}
      summaryMode="sr-only"
      headingLevel={3}
      className={className}
    >
      {points.length === 0 ? (
        <p className="text-sm leading-normal text-ink-muted">
          No unit at this snapshot carries a synthetic market estimate, so no
          price-to-market ratio is defined and there is nothing to plot. A missing
          estimate is a missing value and is never substituted with zero.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {/* The vertical axis name, read bottom to top beside the plot. */}
            <p className="flex w-6 shrink-0 items-center justify-center text-2xs text-ink-muted [writing-mode:vertical-rl] [transform:rotate(180deg)]">
              Older ↑
            </p>
            <div
              tabIndex={0}
              role="img"
              aria-label={summary}
              data-inventory-map="age-price"
              className="relative h-64 w-full rounded-lg border border-line-subtle bg-surface-sunken/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {/* Parity with the synthetic estimate. A DEFINED POINT, not a judgement:
                  1.0 means the asking price equals the estimate. Drawn only when the
                  plotted set actually straddles it. */}
              {parity === null ? null : (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 border-l border-dashed border-line-strong"
                  style={{ left: percent(parity) }}
                />
              )}
              {points.map((point) => (
                <span
                  key={point.unit.vehicleId}
                  aria-hidden="true"
                  className={`absolute rounded-pill opacity-70 ${ageRampClass(point.unit.ageBucket)}`}
                  style={{
                    left: percent(point.x),
                    bottom: percent(point.y),
                    width: `${String(point.size)}px`,
                    height: `${String(point.size)}px`,
                    marginLeft: `${String(-point.size / 2)}px`,
                    marginBottom: `${String(-point.size / 2)}px`,
                  }}
                />
              ))}
            </div>
          </div>

          <p className="flex flex-wrap items-baseline justify-between gap-x-4 pl-8 text-2xs text-ink-muted">
            <span>Lower price to market</span>
            {parity === null ? null : (
              <span className="text-ink-faint">
                dashed rule: asking price equals the synthetic estimate
              </span>
            )}
            <span>Higher price to market →</span>
          </p>

          {/* The colour legend. Every band is named; nothing is encoded by hue alone,
              because the table below carries each unit's band as text. */}
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pl-8">
            {AGE_BUCKETS.map((bucket) => (
              <li
                key={bucket}
                className="flex items-baseline gap-1.5 text-2xs text-ink-muted"
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${ageRampClass(bucket)}`}
                />
                {bucket}
              </li>
            ))}
          </ul>

          {withoutEstimate === 0 ? null : (
            <p className="text-2xs leading-normal text-ink-faint">
              {`${String(withoutEstimate)} of ${String(units.length)} units carry no synthetic market estimate, so they have no ratio and are not plotted. A missing estimate is a missing value and is never substituted with zero.`}
            </p>
          )}
        </div>
      )}

      {/*
        THE ACCESSIBLE EQUIVALENT IS THE UNIT TABLE ON THIS PAGE, NOT A SECOND COPY OF IT.
        `UX.2B` §30 requires a table or list fallback and §62 requires the payload to be
        measured. Both are served by pointing at the table this route already renders: it
        carries every unit's identifier, age band, days in stock, asking price, synthetic
        estimate, price-to-market ratio and inventory investment as exact text, and it
        carries the units this plot cannot show as well as the ones it can. A disclosure
        repeating those rows here measured **+68 kB of HTML on the unfiltered route** — the
        same two hundred and fifty units printed twice — to give a screen-reader user a
        second reading of a table they already meet.
      */}
      {points.length === 0 ? null : (
        <p className="text-2xs leading-normal text-ink-faint">
          Every plotted unit&rsquo;s exact days in stock, price-to-market ratio and
          inventory investment are in{' '}
          <a
            href="#units"
            className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
          >
            the unit table below
          </a>
          , which also lists the units this plot cannot place.
        </p>
      )}
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Price movement                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What the lot was listed at, what it is advertised at now, and the difference — by age band.
 *
 * NOT A TIME SERIES, AND `UX.2B` §31 IS EXPLICIT ABOUT WHY. The export publishes an ORIGINAL
 * and a CURRENT asking price per unit and a change against the prior month end. It does not
 * publish a price history, so two points and a difference is all there is, and drawing a line
 * through them would assert observations the model never made.
 *
 * TWO DIFFERENT MOVEMENTS, KEPT APART. `Markdown since listing` is original less current,
 * summed over the band. The count of units repriced since the prior month end is a different
 * observation over a different interval, and it is a count beside the bars rather than a third
 * bar, so the two can never be read as the same quantity.
 *
 * NO RECOMMENDED PRICE. This figure describes what happened to advertised prices. It implies
 * no decision, no strategy and no repricing action; ARPI models none of those.
 */
export function PriceMovement({
  summary,
  className,
}: {
  readonly summary: InventorySummary
  readonly className?: string
}) {
  const bands = summary.buckets.filter((bucket) => bucket.units > 0)
  const reduced = bands.reduce((total, bucket) => total + bucket.reducedSincePrior, 0)

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <GroupedMeasureBars
        title="Advertised price, then and now"
        caption="Original and current asking price summed over the units in each age band, with the reduction taken since listing. Each measure is scaled to its own largest band."
        identityHeading="Age band"
        groups={[
          {
            id: 'original',
            label: 'Original asking',
            kpiId: null,
            rows: bands.map((bucket) => ({
              key: `original-${bucket.bucket}`,
              label: bucket.bucket,
              value: bucket.originalAsking,
              display: formatCurrencyExact(bucket.originalAsking),
              markClass: ageRampClass(bucket.bucket),
            })),
          },
          {
            id: 'current',
            label: 'Current asking',
            kpiId: null,
            rows: bands.map((bucket) => ({
              key: `current-${bucket.bucket}`,
              label: bucket.bucket,
              value: bucket.currentAsking,
              display: formatCurrencyExact(bucket.currentAsking),
              markClass: ageRampClass(bucket.bucket),
            })),
          },
          {
            id: 'markdown',
            label: 'Markdown since listing',
            kpiId: null,
            rows: bands.map((bucket) => ({
              key: `markdown-${bucket.bucket}`,
              label: bucket.bucket,
              value: bucket.markdown,
              display: formatCurrencyExact(bucket.markdown),
              markClass: ageRampClass(bucket.bucket),
            })),
          },
        ]}
        notice={`${String(reduced)} units were advertised lower at this snapshot than at the prior month end. That is a different interval from the markdown above, which is measured since the unit was listed, and it is an observed change in the advertised price rather than evidence of a decision.`}
      />
    </div>
  )
}
