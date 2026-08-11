/**
 * The Sales and Gross page's sections.
 *
 * Server components without exception. Every figure arrives already resolved and
 * already formatted by `lib/dashboard/sales-gross.ts`; nothing here computes, and
 * nothing here decides what a measure means.
 *
 * THE STATES ARE THE POINT
 * ------------------------
 * A figure has four renderings and they say four different things: a value, "No
 * matching records" (nothing was finalized), "No eligible denominator" (a rate whose
 * denominator is zero, which is undefined and not zero), and "Not applicable" (the
 * measure cannot apply to this scope at all). Collapsing any of them into $0 would be
 * a false statement about a real month.
 */
import type { ReactNode } from 'react'

import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type { Exact } from '@/lib/dashboard/decimal'
import type {
  BridgeState,
  ComparedFigure,
  DiscountDistribution,
  Figure,
  GrossDistribution,
  MixBreakdown,
  PerformanceMetric,
  TrendSeries,
} from '@/lib/dashboard/sales-gross'
import { kpiDefinition, kpiDefinitionHref } from '@/lib/dashboard/sales-gross'
import { formatCountExact, formatCurrencyExact } from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import {
  BridgeChart,
  DistributionStrip,
  GrossComposition,
  TrendChart,
  storeMarkClass,
} from './visuals'
import {
  GroupedMeasureBars,
  MetricSwitch,
  type MeasureBarGroup,
} from './workspace-visuals'

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

/** The words each absent state renders. One vocabulary, used everywhere. */
export function figureText(figure: Figure): string {
  switch (figure.kind) {
    case 'value':
      return figure.display
    case 'no-rows':
      return 'No matching records'
    case 'null-ratio':
      return 'No eligible denominator'
    case 'not-applicable':
      return 'Not applicable'
  }
}

function FigureValue({ figure }: { readonly figure: Figure }) {
  const isValue = figure.kind === 'value'
  return (
    <span
      className={cx(
        isValue ? 'numeric text-2xl font-semibold text-ink' : 'text-sm text-ink-muted'
      )}
    >
      {figureText(figure)}
    </span>
  )
}

function ComparisonLine({
  figure,
  comparisonLabel,
}: {
  readonly figure: ComparedFigure
  readonly comparisonLabel: string | null
}) {
  if (figure.difference === null) {
    return (
      <Text size="xs" tone="faint">
        {figure.current.kind === 'not-applicable'
          ? figure.current.reason
          : comparisonLabel === null
            ? 'No comparison period selected.'
            : 'No comparable figure for the comparison period.'}
      </Text>
    )
  }
  return (
    <Text size="xs" tone="muted">
      {/* Neutral wording. This console declares no favourable direction for a gross
          measure, and colouring a fall red would be a judgement, not a figure. */}
      <span className="numeric">{figure.difference}</span>
      {comparisonLabel === null ? '' : ` against ${comparisonLabel}`}
    </Text>
  )
}

/** One metric tile. */
export function MetricTile({
  metric,
  comparisonLabel,
}: {
  readonly metric: PerformanceMetric
  readonly comparisonLabel: string | null
}) {
  const definition = metric.kpiId === null ? undefined : kpiDefinition(metric.kpiId)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line-subtle bg-surface p-4">
      <Text size="xs" tone="muted" className="uppercase tracking-wide">
        {metric.label}
      </Text>
      <FigureValue figure={metric.figure.current} />
      <ComparisonLine figure={metric.figure} comparisonLabel={comparisonLabel} />
      {metric.kpiId ? (
        <a
          href={kpiDefinitionHref(metric.kpiId)}
          className="mt-1 inline-flex min-h-6 items-center text-xs text-ink-faint underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          {metric.kpiId}
        </a>
      ) : null}
      {definition ? (
        <Disclosure label="How is this calculated?">
          <Text size="xs" tone="muted">
            {definition.definition}
          </Text>
          <Text size="xs" tone="faint" className="numeric pt-1">
            {definition.formula}
          </Text>
        </Disclosure>
      ) : null}
    </div>
  )
}

export function PerformanceGrid({
  metrics,
  comparisonLabel,
}: {
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} comparisonLabel={comparisonLabel} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The KPI rail                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One rail cell: a governed figure, its comparison, and its catalogue identifier.
 *
 * NO PER-CARD METHODOLOGY DISCLOSURE, AND THAT IS THE COMPACTION. Before `UX.2B` this
 * route rendered `MetricTile` twelve times, and nine of those carried their own
 * `How is this calculated?` summary — nine identical lines in the eye path of a manager
 * looking for a number. The methodology is not gone: every catalogue entry the rail owns
 * is behind ONE disclosure at the foot of the rail, rendered from the same `KpiEntry`
 * through the same fields. It is the technique `kpi-strip.tsx` established for the
 * Executive and the reason it recorded there holds identically here.
 */
function RailCell({
  metric,
  comparisonLabel,
  rank,
}: {
  readonly metric: PerformanceMetric
  readonly comparisonLabel: string | null
  readonly rank: 'lead' | 'supporting'
}) {
  const isValue = metric.figure.current.kind === 'value'
  return (
    <li
      data-kpi-card={metric.id}
      data-kpi-rank={rank}
      className={cx(
        'flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface',
        rank === 'lead' ? 'p-3' : 'p-2.5'
      )}
    >
      <h3 className="text-xs leading-snug font-medium text-ink-secondary">
        {metric.label}
      </h3>
      <span
        className={cx(
          isValue
            ? cx(
                'numeric font-semibold text-ink',
                rank === 'lead' ? 'text-2xl' : 'text-lg'
              )
            : 'text-xs text-ink-muted'
        )}
      >
        {figureText(metric.figure.current)}
      </span>
      <ComparisonLine figure={metric.figure} comparisonLabel={comparisonLabel} />
      {metric.kpiId === null ? null : (
        <p className="mt-auto pt-0.5 font-mono text-2xs tracking-wide text-ink-faint">
          {metric.kpiId}
        </p>
      )}
    </li>
  )
}

/**
 * The nine governed figures a general sales manager opens the page with.
 *
 * THREE RANKS, NOT NINE EQUAL CARDS. Units, total gross and total GPRU are the three
 * questions asked first and are set at display size; the six that decompose them — front
 * and back gross, front and back PVR, new and used units — qualify them and are set
 * smaller underneath. Nine equal cards say all nine matter equally, which is not what a
 * Monday morning is like.
 *
 * NOTHING WAS DROPPED TO ACHIEVE THE COMPACTION. The brief permits omitting a redundant
 * figure and none was omitted, because none is redundant in the way that matters: total
 * gross is front plus back and total GPRU is front plus back PVR, so a reader could in
 * principle derive two of the nine — but those two are the ones the whole page is about,
 * and making a general manager add two numbers to get the headline would be a strange
 * economy. What changed is the RANK they are shown at, not whether they are shown.
 */
export function SalesKpiRail({
  metrics,
  comparisonLabel,
}: {
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
}) {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]))
  const pick = (ids: readonly string[]): readonly PerformanceMetric[] =>
    ids
      .map((id) => byId.get(id))
      .filter((metric): metric is PerformanceMetric => metric !== undefined)

  const lead = pick(['retail-units', 'total-gross', 'total-pvr'])
  const supporting = pick([
    'front-gross',
    'back-gross',
    'front-pvr',
    'back-pvr',
    'new-units',
    'used-units',
  ])
  const withDefinition = [...lead, ...supporting].filter(
    (metric) => metric.kpiId !== null
  )

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {lead.map((metric) => (
          <RailCell
            key={metric.id}
            metric={metric}
            comparisonLabel={comparisonLabel}
            rank="lead"
          />
        ))}
      </ul>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {supporting.map((metric) => (
          <RailCell
            key={metric.id}
            metric={metric}
            comparisonLabel={comparisonLabel}
            rank="supporting"
          />
        ))}
      </ul>
      <Disclosure label="How every figure on this rail is calculated" className="border-0">
        <div className="flex flex-col gap-5">
          {withDefinition.map((metric) => {
            const definition =
              metric.kpiId === null ? undefined : kpiDefinition(metric.kpiId)
            return (
              <div key={metric.id} className="flex flex-col gap-1">
                <h4 className="text-sm font-semibold text-ink-secondary">
                  {metric.label}
                </h4>
                {definition === undefined ? (
                  <Text size="xs" tone="muted">
                    {`No catalogue entry is published for ${metric.label.toLowerCase()}.`}
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
                {metric.kpiId === null ? null : (
                  <a
                    href={kpiDefinitionHref(metric.kpiId)}
                    className="inline-flex min-h-6 items-center self-start font-mono text-2xs tracking-wide text-ink-faint underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  >
                    {metric.kpiId}
                  </a>
                )}
              </div>
            )
          })}
        </div>
      </Disclosure>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

const GRANULARITY_COPY: Readonly<Record<string, string>> = {
  daily: 'one column per sale date',
  weekly: 'one column per ISO week, starting Monday',
  monthly: 'one column per calendar month',
}

/**
 * One trend, switchable between the three measures a general sales manager reads.
 *
 * WHAT REPLACED WHAT. `UX.1` drew four charts in a two-by-two grid: units, total gross,
 * front gross and total PVR, each with its own heading, its own caption and its own table
 * disclosure. Four charts side by side answer "what is the shape of each of these"; a
 * manager's actual question is "what is the shape", asked once, of whichever measure they
 * are currently holding. One large chart with a switch answers that, and the chart it
 * draws is four times the size of any of the four it replaced.
 *
 * FRONT GROSS LEFT THE SWITCH AND DID NOT LEAVE THE PAGE. `UX.2B` §2B names three
 * measures — units, gross and GPRU — and `MetricSwitch` carries three. Front gross is on
 * the KPI rail with its comparison, is a segment of the gross composition beside this
 * chart, and is one of the three effects the bridge below decomposes. What is gone is its
 * fourth appearance as a separate trend of its own.
 *
 * ALL THREE SERIES ARE IN THE SERVED HTML. The switch chooses which is displayed; it
 * recomputes nothing, and the panels a reader has not selected are `display: none` and
 * therefore out of the accessibility tree. With scripting off it still works.
 *
 * The per-unit series is recomputed inside each bucket from that bucket's own summed gross
 * and units. It is never the average of the daily rates the dataset publishes, which would
 * weight a one-unit Tuesday the same as a nine-unit Saturday.
 */
export function TrendSection({
  series,
  comparisonLabel,
}: {
  readonly series: TrendSeries
  readonly comparisonLabel: string | null
}) {
  const caption = `Aggregated to ${GRANULARITY_COPY[series.granularity] ?? series.granularity}.`
  return (
    <div className="flex flex-col gap-2">
      {series.notice ? (
        <Text size="sm" tone="muted">
          {series.notice}
        </Text>
      ) : null}
      <MetricSwitch
        name="sales-trend"
        legend="Trend measure"
        options={[
          {
            id: 'units',
            label: 'Units',
            panel: (
              <TrendChart
                title="Retail units"
                caption={caption}
                measure="Retail units"
                points={series.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  value: point.retailUnits,
                  display: formatCountExact(point.retailUnits),
                }))}
                periodHeading="Period"
                valueHeading="Units"
                headingLevel={4}
                summaryMode="sr-only"
                className="pt-3"
              />
            ),
          },
          {
            id: 'gross',
            label: 'Gross',
            panel: (
              <TrendChart
                title="Total gross"
                caption={caption}
                measure="Total gross"
                points={series.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  value: point.totalGross,
                  display: formatCurrencyExact(point.totalGross),
                }))}
                valueHeading="Total gross"
                headingLevel={4}
                summaryMode="sr-only"
                className="pt-3"
              />
            ),
          },
          {
            id: 'gpru',
            label: 'GPRU',
            panel: (
              <TrendChart
                title="Total gross per retail unit"
                caption={`${caption} A period with no retail unit has no per-unit gross and is drawn as a gap, never as zero.`}
                measure="Total gross per retail unit"
                points={series.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  value: point.totalPvr,
                  display:
                    point.totalPvr === null
                      ? 'No eligible denominator'
                      : formatCurrencyExact(point.totalPvr),
                }))}
                valueHeading="Total GPRU"
                headingLevel={4}
                summaryMode="sr-only"
                className="pt-3"
              />
            ),
          },
        ]}
      />
      {comparisonLabel ? (
        <Text size="xs" tone="faint">
          {`${comparisonLabel} is shown as a difference on the rail above rather than as a second series here.`}
        </Text>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Condition and store composition                                             */
/* -------------------------------------------------------------------------- */

/**
 * New against used, on both measures the export splits.
 *
 * TWO PART-TO-WHOLE BARS OVER THE SAME TWO SEGMENTS, and that pairing is the finding. A
 * store selling 40% new units and earning 25% of its gross from them is in a materially
 * different position from one where the two shares match, and neither bar alone says so.
 * The same technique the age-and-capital stack uses on the Executive, for the same reason.
 *
 * EACH BAR IS DRAWN AGAINST ITS OWN GOVERNED TOTAL, never against a sum assembled here: a
 * component may not perform exact arithmetic, and a denominator built in this file could
 * disagree with the total the rail above already shows.
 */
export function ConditionSplit({
  mix,
  totalUnits,
  totalGross,
}: {
  readonly mix: MixBreakdown
  readonly totalUnits: Figure
  readonly totalGross: Figure
}) {
  const segments = (measure: 'units' | 'gross') =>
    mix.rows.map((row) => ({
      key: row.key,
      label: row.label,
      value: measure === 'units' ? row.unitsExact : row.gross,
      display: measure === 'units' ? formatCountExact(row.unitsExact) : row.grossDisplay,
    }))

  return (
    <div className="flex flex-col gap-4">
      <GrossComposition
        title="Units"
        segments={segments('units')}
        total={totalUnits.kind === 'value' ? totalUnits.value : null}
        headingLevel={4}
      />
      <GrossComposition
        title="Gross"
        segments={segments('gross')}
        total={totalGross.kind === 'value' ? totalGross.value : null}
        headingLevel={4}
      />
      {mix.note ? (
        <Text size="xs" tone="faint">
          {mix.note}
        </Text>
      ) : null}
    </div>
  )
}

/**
 * Each store's contribution, on units and on gross.
 *
 * NOT A LEAGUE TABLE, AND THE COMPONENT CANNOT BECOME ONE. Rows are in business-code
 * order, the mark is derived from the business code rather than from the row's position —
 * so a store filtered out of scope cannot shift the colour of the store after it — and no
 * composite is formed across the two measures. The three stores run different operating
 * models and this console publishes no ranking over them.
 *
 * THE TWO MEASURES ARE SCALED SEPARATELY because units and dollars share no axis. The
 * primitive states that in its own caption; nothing invites a length comparison between
 * the groups.
 */
export function StoreContribution({ mix }: { readonly mix: MixBreakdown }) {
  const groups: readonly MeasureBarGroup[] = [
    {
      id: 'units',
      label: 'Retail units',
      kpiId: 'KPI-SLS-001',
      rows: mix.rows.map((row) => ({
        key: row.key,
        label: row.label,
        value: row.unitsExact,
        display: formatCountExact(row.unitsExact),
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
        ...(row.share === null ? {} : { note: row.share }),
      })),
    },
  ]
  return (
    <GroupedMeasureBars
      title="Store contribution"
      groups={groups}
      categoryHeading="Store"
      mark={(key) => storeMarkClass(key)}
      footnote="Each measure is scaled to its own largest store; units and dollars share no axis. Order is the business code and is not a ranking."
      headingLevel={4}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Mix                                                                         */
/* -------------------------------------------------------------------------- */

export function MixSection({ mixes }: { readonly mixes: readonly MixBreakdown[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {mixes.map((mix) => (
        <div
          key={mix.id}
          className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4"
        >
          <h3 className="text-base font-semibold text-ink">{mix.title}</h3>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{mix.title}</caption>
            <thead>
              <tr className="border-b border-line-subtle text-left">
                <th scope="col" className="py-1.5 pr-2 font-medium text-ink-muted">
                  Segment
                </th>
                <th
                  scope="col"
                  className="py-1.5 pr-2 text-right font-medium text-ink-muted"
                >
                  Units
                </th>
                <th scope="col" className="py-1.5 text-right font-medium text-ink-muted">
                  Gross
                </th>
              </tr>
            </thead>
            <tbody>
              {mix.rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-line-subtle/60 last:border-0"
                >
                  <th scope="row" className="py-1.5 pr-2 font-normal text-ink-secondary">
                    {row.label}
                    {row.share ? (
                      <span className="ml-1.5 text-xs text-ink-faint">{row.share}</span>
                    ) : null}
                  </th>
                  <td className="numeric py-1.5 pr-2 text-right text-ink">{row.units}</td>
                  <td className="numeric py-1.5 text-right text-ink">
                    {row.grossDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mix.note ? (
            <Text size="xs" tone="faint">
              {mix.note}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Contribution                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Front against back, as one part-to-whole bar drawn against the governed total.
 *
 * The two fills are the CATEGORICAL pair — two identities — and never the
 * positive/negative pair, which would say the finance office is the good half of the deal.
 * Neither component is ranked against the other, for the reason the disclosure states.
 */
export function ContributionSection({
  front,
  back,
  frontShare,
  backShare,
  total,
}: {
  readonly front: Figure
  readonly back: Figure
  readonly frontShare: string | null
  readonly backShare: string | null
  readonly total: Figure
}) {
  const segments = [
    { key: 'front', figure: front, label: 'Front-end gross', share: frontShare },
    { key: 'back', figure: back, label: 'Back-end gross', share: backShare },
  ]
    .filter((entry) => entry.figure.kind === 'value')
    .map((entry) => ({
      key: entry.key,
      label:
        entry.share === null ? entry.label : `${entry.label} · ${entry.share} of total`,
      value: (entry.figure as { kind: 'value'; value: Exact }).value,
      display: figureText(entry.figure),
    }))

  return (
    <GrossComposition
      title="Front and back"
      segments={segments}
      total={total.kind === 'value' ? total.value : null}
      shareDisclosure="Front and back are published separately and are not ranked against each other. A store can hold total gross steady while front collapses and the finance office compensates, and that is a materially different situation from one where both are stable: which is preferable depends on the store, not on the figure."
      headingLevel={4}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Distribution                                                                */
/* -------------------------------------------------------------------------- */

export function DistributionSection({
  distribution,
}: {
  readonly distribution: GrossDistribution
}) {
  return (
    <div className="flex flex-col gap-3">
      <DistributionStrip
        title="Total gross per deal"
        buckets={distribution.bands}
        unit="deals"
        median={
          distribution.medianDisplay === null
            ? null
            : { label: 'Median', display: distribution.medianDisplay }
        }
        mean={
          distribution.meanDisplay === null
            ? null
            : { label: 'Mean', display: distribution.meanDisplay }
        }
        headingLevel={4}
      />
      {/*
        THE LOSS COUNT STAYS VISIBLE AND THE ARITHMETIC NOTE MOVED. A reader who does not
        know that some of these deals closed below zero has misread the left-hand band, so
        that sentence is a caveat and stays. How a median differs from a mean is mechanics,
        and `UX.2B` §11 puts mechanics behind a disclosure.
      */}
      <Text size="xs" tone="muted">
        {`${String(distribution.negativeFrontCount)} of ${String(distribution.dealCount)} deals closed at a front-end loss. A negative front is a real outcome: counted, signed, never suppressed.`}
      </Text>
      <Disclosure label="Why both centres are shown" className="border-0">
        <Text size="xs" tone="muted">
          Deal gross has a long tail, so the mean sits above the typical deal and either
          centre alone invites the wrong conclusion. The median is computed from the
          deal-level values themselves, never from store medians: an order statistic cannot
          be recomputed from an aggregate. The mean over a retail population is total gross
          divided by retail units, which is KPI-GRS-006 by definition, so it is the same
          figure the rail shows.
        </Text>
      </Disclosure>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Discount distribution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What was given away, as a shape rather than as three averages.
 *
 * WHAT REPLACED WHAT. This module previously rendered three `MetricTile`s: the mean
 * discount from original asking, from final asking and from MSRP. Three averages are three
 * numbers, and a desk asking "what are we giving away" is asking about the tail — a month
 * whose mean discount is $1,400 looks identical whether every deal took $1,400 or half
 * took nothing and half took $2,800. The three per-unit rates are still here, under the
 * distribution, at the size a supporting figure deserves.
 *
 * THE IDENTITY IS PRINTED, NOT ASSUMED. The per-deal discounts are summed and compared
 * against `discount_from_original_total`, the governed period total, and the result is
 * stated in words. A page that drew a distribution over one population beside an average
 * over another would be wrong in the way that is hardest to catch.
 */
export function DiscountSection({
  distribution,
  metrics,
  comparisonLabel,
}: {
  readonly distribution: DiscountDistribution
  readonly metrics: readonly PerformanceMetric[]
  readonly comparisonLabel: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <DistributionStrip
        title="Discount from original asking, per deal"
        buckets={distribution.bands}
        unit="deals"
        median={
          distribution.medianDisplay === null
            ? null
            : { label: 'Median discount', display: distribution.medianDisplay }
        }
        headingLevel={4}
      />

      <dl className="grid gap-2 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-2.5"
          >
            <dt className="text-2xs leading-snug text-ink-muted">{metric.label}</dt>
            <dd
              className={cx(
                metric.figure.current.kind === 'value'
                  ? 'numeric text-base font-semibold text-ink'
                  : 'text-2xs text-ink-muted'
              )}
            >
              {figureText(metric.figure.current)}
            </dd>
            <dd>
              <ComparisonLine figure={metric.figure} comparisonLabel={comparisonLabel} />
            </dd>
          </div>
        ))}
      </dl>

      <Text size="xs" tone="muted">
        {distribution.governedTotal === null
          ? 'A condition filter narrows these deals and does not narrow the governed period total, which carries no condition split, so the two are not comparable here and no reconciliation is claimed.'
          : distribution.reconciled
            ? `Reconciled: the ${String(distribution.dealCount)} per-deal discounts sum exactly to the governed period total.`
            : `The per-deal discounts do not sum to the governed period total. Both figures are shown as exported and the difference is ${distribution.residual === null ? 'undefined' : formatCurrencyExact(distribution.residual)}; this state is a defect rather than a rounding artefact.`}
        {distribution.atOrAboveAsking > 0
          ? ` ${String(distribution.atOrAboveAsking)} deal${distribution.atOrAboveAsking === 1 ? '' : 's'} closed at or above the original asking price.`
          : ''}
      </Text>

      <Disclosure label="What each discount is measured against" className="border-0">
        <div className="flex flex-col gap-2">
          <Text size="xs" tone="muted">
            The distribution is one value per retail deal: the original asking price less
            the sale price, both exported at deal grain. It is an observed difference and
            not evidence of a negotiation, a policy or a manager decision; ARPI models none
            of those.
          </Text>
          <Text size="xs" tone="muted">
            The MSRP discount divides by the units that actually carry an MSRP, which is
            fewer than the retail count — a used unit has none. Dividing by the retail count
            would understate it by counting units the measure cannot apply to, and where no
            unit in scope carries an MSRP the measure is not applicable rather than zero.
          </Text>
        </div>
      </Disclosure>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sale type                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The unit-only sale-type mix, as a compact list.
 *
 * NO GROSS COLUMN AND NO BAR. The export publishes per-sale-type unit counts and no
 * per-sale-type gross; apportioning the retail total across sale types would invent a
 * measure the reporting layer does not own. A three-column table whose third column reads
 * "Not published by sale type" four times was stating that absence four times, so it is
 * stated once underneath.
 */
export function SaleTypeMix({ mix }: { readonly mix: MixBreakdown }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2">
        {mix.rows.map((row) => (
          <li
            key={row.key}
            className="flex min-w-0 flex-col rounded-lg border border-line-subtle bg-surface p-2.5"
          >
            <span className="text-2xs leading-snug text-ink-muted">{row.label}</span>
            <span className="numeric text-base font-semibold text-ink">{row.units}</span>
          </li>
        ))}
      </ul>
      {mix.note ? (
        <Text size="xs" tone="faint">
          {mix.note}
        </Text>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The gross change bridge.
 *
 * NON-CAUSAL BY CONSTRUCTION. The sentence comes from the view model, which builds it
 * from the exported components using attribution verbs only. Nothing in this component
 * can turn it into a causal claim, because nothing here writes a sentence.
 */
export function BridgeSection({ bridge }: { readonly bridge: BridgeState }) {
  if (bridge.kind === 'unavailable') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-surface-sunken/50 p-5">
        <h3 className="text-base font-semibold text-ink">
          Bridge not comparable for this period
        </h3>
        <Text size="sm" tone="muted">
          {bridge.reason}
        </Text>
        {bridge.changeDisplay ? (
          <Text size="sm" tone="secondary">
            {`The period change itself is still defined: total gross moved ${bridge.changeDisplay}. Only its decomposition is unavailable.`}
          </Text>
        ) : null}
      </div>
    )
  }

  const bars = [
    {
      key: 'comparison',
      label: 'Comparison total',
      value: bridge.comparisonTotal,
      display: formatCurrencyExact(bridge.comparisonTotal),
      kind: 'anchor' as const,
    },
    ...bridge.components.map((component) => ({
      key: component.code,
      label: component.label,
      value: component.amount,
      display: component.display,
      kind: 'step' as const,
    })),
    ...(bridge.rounding === null
      ? []
      : [
          {
            key: 'rounding',
            label: 'Rounding',
            value: bridge.rounding,
            display: formatCurrencyExact(bridge.rounding, 2),
            kind: 'step' as const,
            note: 'display only',
          },
        ]),
    {
      key: 'current',
      label: 'Current total',
      value: bridge.currentTotal,
      display: formatCurrencyExact(bridge.currentTotal),
      kind: 'anchor' as const,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <BridgeChart
        title="What changed against the month before"
        bars={bars}
        summary={bridge.statement}
      />
      {/*
        THE VERIFICATION RESULT STAYS VISIBLE AND THE MECHANICS MOVED. Whether the exported
        components reconcile is a fact about THESE figures and a reader who does not have it
        cannot judge the picture; the arithmetic order under which they were produced is
        mechanics, and `UX.2B` §11 puts mechanics behind a disclosure. The non-causal
        sentence stays visible too: a waterfall labelled "front PVR effect" is read as a
        cause unless something on the screen says it is not one.
      */}
      <Text size="xs" tone={bridge.verified ? 'muted' : 'secondary'}>
        {bridge.verified
          ? 'Verified against the exported numerators. An attribution, never a cause: nothing here identifies why volume or rate moved.'
          : 'The exported components did not reconcile to the period change. The figures above are shown as exported, and this state is a defect rather than a rounding artefact.'}
      </Text>
      <Disclosure label="How the decomposition is ordered" className="border-0">
        <div className="flex flex-col gap-2">
          <Text size="xs" tone="muted">
            The bridge attributes change under a documented arithmetic order: volume priced
            at the comparison period rate, then each rate change valued at the current
            period volume. `vw_gross_change_bridge` owns that order and computes it once;
            this page reads the exported numerators and verifies the identity SQL
            guarantees, and never decides how much of a change belongs to volume.
          </Text>
          <Text size="xs" tone="muted">
            It is an attribution and not a cause. No person, department, inventory position
            or marketing spend is implicated by any step.
          </Text>
          {bridge.rounding === null ? null : (
            <Text size="xs" tone="muted">
              The rounding line is the residual left when each component is divided by the
              comparison unit count and rounded to the cent. It is shown rather than folded
              into a component, because adjusting one component to make a column add up
              would misstate that component.
            </Text>
          )}
        </div>
      </Disclosure>
    </div>
  )
}

/** A labelled block with a heading, used by the page for each section body. */
export function SectionBody({ children }: { readonly children: ReactNode }) {
  return <div className="pt-6">{children}</div>
}
