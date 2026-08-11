/**
 * The F&I performance page's sections.
 *
 * Server components without exception. Every figure arrives already summed and already
 * divided by `lib/dashboard/fi.ts`; nothing here computes and nothing here decides what a
 * measure means.
 *
 * THE STATES ARE THE POINT, AND THERE ARE MORE OF THEM HERE THAN ANYWHERE ELSE
 * ----------------------------------------------------------------------------
 *   a value                    something happened and this is it
 *   No eligible deals          the category could not have been sold to anyone here.
 *                              NOT 0% — a rate with no denominator is undefined, and
 *                              rendering it as zero would claim a store failed to sell
 *                              something it was never able to sell.
 *   0.0%                       eligible deals existed and none carried the product.
 *                              A finding, and a different one.
 *   No adjustments posted      no cancellation or chargeback in this window
 *   Insufficient sample        below the governed minimum-deal floor: the components are
 *                              shown, the ratio is not
 *
 * Collapsing any of those into another is a false statement about a real month.
 *
 * NOTHING HERE IS A VERDICT
 * -------------------------
 * No figure is captioned good, bad, healthy, weak, strong, on-target or industry-standard;
 * no row is ranked; no arrow is coloured to imply a favourable direction. ARPI publishes no
 * F&I benchmark, so a comparison is stated as a comparison and left there.
 */
import type { ReactNode } from 'react'

import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import {
  formatCountExact,
  formatCurrencyExact,
  formatPerUnitExact,
  formatPointsDifference,
  formatRatioAsPercent,
} from '@/lib/dashboard/format'
import type {
  FiAdjustmentTypeRow,
  FiCategoryRow,
  FiManagerRow,
  FiRatio,
  FiStructureShare,
  FiView,
} from '@/lib/dashboard/fi'
import { exactToString, isZero, type Exact } from '@/lib/dashboard/decimal'
import { GrossComposition, TableDisclosure, TrendChart } from './visuals'
import { GroupedMeasureBars } from './workspace-visuals'
import { kpiDefinition, kpiDefinitionHref } from '@/lib/dashboard/sales-gross'
import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

/** The one place a KPI identifier becomes a link, so the catalogue stays the authority. */
function KpiLink({ id }: { readonly id: string }) {
  const definition = kpiDefinition(id)
  return (
    <a
      href={kpiDefinitionHref(id)}
      className="font-mono text-[0.6875rem] text-ink-muted underline decoration-dotted underline-offset-4 hover:text-accent"
    >
      {id}
      {definition === undefined ? '' : ` · ${definition.name}`}
    </a>
  )
}

/**
 * One headline figure.
 *
 * `basis` is not decoration. Every F&I number on this page is on one of three date bases
 * and the label travels with the number, because "back gross" and "retained F&I gross"
 * are different questions and a reader who cannot tell which they are looking at has been
 * given the wrong answer to one of them.
 */
function Figure({
  label,
  value,
  basis,
  kpiId,
  note,
}: {
  readonly label: string
  readonly value: string
  readonly basis: string
  readonly kpiId?: string
  readonly note?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-rule bg-surface p-4">
      <Text size="xs" tone="muted">
        {label}
      </Text>
      <span className="numeric text-2xl font-semibold text-ink">{value}</span>
      <Text size="xs" tone="faint">
        {basis}
      </Text>
      {note === undefined ? null : (
        <Text size="xs" tone="faint">
          {note}
        </Text>
      )}
      {kpiId === undefined ? null : <KpiLink id={kpiId} />}
    </div>
  )
}

/** A ratio rendered as a percentage, or the reason it has none. */
function percentOrReason(ratio: FiRatio, reason: string): string {
  return ratio.value === null ? reason : formatRatioAsPercent(ratio.value, 1)
}

/* -------------------------------------------------------------------------- */
/* 1. Production summary                                                       */
/* -------------------------------------------------------------------------- */

export function ProductionSummary({ view }: { readonly view: FiView }) {
  const p = view.production
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        label="Back-end gross"
        value={formatCurrencyExact(p.backEndGrossDealDate)}
        basis="Deal date — what the office produced"
        kpiId="KPI-GRS-002"
      />
      <Figure
        label="Back gross per retail unit"
        value={
          p.backGrossPvr.value === null
            ? 'No retail units'
            : formatPerUnitExact(p.backGrossPvr.value)
        }
        basis="Deal date"
        kpiId="KPI-GRS-005"
      />
      <Figure
        label="Finance reserve"
        value={formatCurrencyExact(p.financeReserveGross)}
        basis="Deal date"
        kpiId="KPI-FNI-001"
        note="An amount, never a rate. Zero on cash and lease deliveries."
      />
      <Figure
        label="Reserve per retail unit"
        value={
          p.reservePvr.value === null
            ? 'No retail units'
            : formatPerUnitExact(p.reservePvr.value)
        }
        basis="Deal date"
        kpiId="KPI-FNI-002"
        note="Cash deliveries are inside this denominator and cannot earn reserve."
      />
      <Figure
        label="Original product gross"
        value={formatCurrencyExact(p.originalProductGross)}
        basis="Deal date — before any later adjustment"
        kpiId="KPI-FNI-003"
      />
      <Figure
        label="Net product gross"
        value={formatCurrencyExact(p.netProductGrossAsOf)}
        basis={`As of ${view.asOfDate} — what the store retained`}
        kpiId="KPI-FNI-004"
      />
      <Figure
        label="Products per retail unit"
        value={
          p.productsPerRetailUnit.value === null
            ? 'No retail units'
            : exactToString(p.productsPerRetailUnit.value).slice(0, 4)
        }
        basis="Deal date"
        kpiId="KPI-FNI-006"
        note={`${formatCountExact(p.contractCount)} contracts over ${formatCountExact(p.retailUnits)} retail units.`}
      />
      <Figure
        label="Gross per contract"
        value={
          p.grossPerContract.value === null
            ? 'No contracts'
            : formatPerUnitExact(p.grossPerContract.value)
        }
        basis="Deal date"
        kpiId="KPI-FNI-011"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 2. Reserve against product, and produced against retained                   */
/* -------------------------------------------------------------------------- */

/**
 * The composition bar, server-rendered.
 *
 * No chart library and no client JavaScript: two `<div>`s whose widths are a percentage,
 * with every encoded value also present as text in the table beneath. A reader with
 * scripting disabled, a screen reader user and a reader who prints the page all get the
 * same figures.
 */
function CompositionBar({
  segments,
}: {
  readonly segments: readonly { label: string; value: Exact; percent: number }[]
}) {
  return (
    <div
      className="flex h-6 w-full overflow-hidden rounded border border-rule"
      role="presentation"
    >
      {segments.map((segment, index) => (
        <div
          key={segment.label}
          className={cx('h-full', index === 0 ? 'bg-accent/70' : 'bg-accent/30')}
          style={{ width: `${segment.percent}%` }}
        />
      ))}
    </div>
  )
}

export function BackGrossComposition({
  view,
  identityHolds,
  residual,
}: {
  readonly view: FiView
  readonly identityHolds: boolean
  readonly residual: Exact
}) {
  const p = view.production
  const total = Number(exactToString(p.backEndGrossDealDate))
  const reserve = Number(exactToString(p.financeReserveGross))
  const product = Number(exactToString(p.originalProductGross))
  const percent = (part: number) => (total === 0 ? 0 : (part / total) * 100)

  return (
    <div className="flex flex-col gap-4">
      <CompositionBar
        segments={[
          {
            label: 'Finance reserve',
            value: p.financeReserveGross,
            percent: percent(reserve),
          },
          {
            label: 'Product gross',
            value: p.originalProductGross,
            percent: percent(product),
          },
        ]}
      />
      <table className="w-full text-sm">
        <caption className="sr-only">
          Deal-date back-end gross, decomposed into finance reserve and original product
          gross
        </caption>
        <thead>
          <tr className="border-b border-rule text-left">
            <th scope="col" className="py-2 font-medium text-ink-muted">
              Component
            </th>
            <th scope="col" className="py-2 text-right font-medium text-ink-muted">
              Deal-date gross
            </th>
            <th scope="col" className="py-2 text-right font-medium text-ink-muted">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-rule/60">
            <th scope="row" className="py-2 text-left font-normal">
              Finance reserve
            </th>
            <td className="numeric py-2 text-right">
              {formatCurrencyExact(p.financeReserveGross)}
            </td>
            <td className="numeric py-2 text-right">{percent(reserve).toFixed(1)}%</td>
          </tr>
          <tr className="border-b border-rule/60">
            <th scope="row" className="py-2 text-left font-normal">
              Original product gross
            </th>
            <td className="numeric py-2 text-right">
              {formatCurrencyExact(p.originalProductGross)}
            </td>
            <td className="numeric py-2 text-right">{percent(product).toFixed(1)}%</td>
          </tr>
          <tr className="border-b border-rule/60 text-ink-muted">
            <th scope="row" className="py-2 text-left font-normal">
              Other F&amp;I income
            </th>
            <td className="numeric py-2 text-right">
              {formatCurrencyExact(residualZero())}
            </td>
            <td className="numeric py-2 text-right">0.0%</td>
          </tr>
          <tr className="font-medium">
            <th scope="row" className="py-2 text-left">
              Back-end gross
            </th>
            <td className="numeric py-2 text-right">
              {formatCurrencyExact(p.backEndGrossDealDate)}
            </td>
            <td className="numeric py-2 text-right">100.0%</td>
          </tr>
        </tbody>
      </table>

      <div
        className={cx(
          'rounded border px-3 py-2 text-sm',
          identityHolds
            ? 'border-rule bg-surface text-ink-muted'
            : 'border-warning bg-warning/10 text-ink'
        )}
      >
        {identityHolds ? (
          <>
            <strong className="font-medium text-ink">Reconciled to the cent.</strong>{' '}
            Finance reserve plus original product gross equals back-end gross exactly,
            with other F&amp;I income of $0.00 and no balancing figure. Recomputed on this
            page from the components above, and proved per deal by RECON-FI-001.
          </>
        ) : (
          <>
            <strong className="font-medium">Back-end gross does not reconcile.</strong>{' '}
            The components above leave {formatCurrencyExact(residual, 2)} unexplained. The
            figures are shown as exported rather than adjusted to agree.
          </>
        )}
      </div>

      <Disclosure label="Produced against retained — why these are two different numbers">
        <div className="flex flex-col gap-3">
          <Text size="sm" tone="muted">
            Original product gross is what the finance office produced, attributed to the
            day each deal was struck. It is never rewritten when a cancellation or
            chargeback posts later. Net product gross is what the store retained as at{' '}
            {view.asOfDate}, after every adjustment posted on or before that date.
          </Text>
          <table className="w-full text-sm">
            <caption className="sr-only">
              Produced and retained F&amp;I gross compared
            </caption>
            <tbody>
              <tr className="border-b border-rule/60">
                <th scope="row" className="py-2 text-left font-normal">
                  Original F&amp;I gross (deal date)
                </th>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(p.originalFiGross)}
                </td>
              </tr>
              <tr className="border-b border-rule/60">
                <th scope="row" className="py-2 text-left font-normal">
                  Cumulative product adjustments through {view.asOfDate}
                </th>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(p.cumulativeAdjustmentAmount)}
                </td>
              </tr>
              <tr className="font-medium">
                <th scope="row" className="py-2 text-left">
                  Retained F&amp;I gross (as of {view.asOfDate})
                </th>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(p.netFiGrossAsOf)}
                </td>
              </tr>
            </tbody>
          </table>
          <Text size="xs" tone="faint">
            A difference between the two is expected wherever adjustments posted. It is
            not an error in either figure, and neither is a correction of the other.
          </Text>
        </div>
      </Disclosure>
    </div>
  )
}

/** Other F&I income is exactly zero and is not a column anywhere. */
function residualZero(): Exact {
  return { units: 0n, scale: 2 }
}

/* -------------------------------------------------------------------------- */
/* 3. Finance structure mix                                                    */
/* -------------------------------------------------------------------------- */

export function StructureMix({
  structures,
  view,
}: {
  readonly structures: readonly FiStructureShare[]
  readonly view: FiView
}) {
  const total = structures.reduce(
    (sum, entry) => sum + Number(exactToString(entry.deals)),
    0
  )
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Retail deliveries by finance structure, over {view.periodContext.period.label}
        </caption>
        <thead>
          <tr className="border-b border-rule text-left">
            <th scope="col" className="py-2 font-medium text-ink-muted">
              Structure
            </th>
            <th scope="col" className="py-2 text-right font-medium text-ink-muted">
              Deliveries
            </th>
            <th scope="col" className="py-2 text-right font-medium text-ink-muted">
              Share of retail deliveries
            </th>
          </tr>
        </thead>
        <tbody>
          {structures.map((entry) => (
            <tr key={entry.structure} className="border-b border-rule/60">
              <th scope="row" className="py-2 text-left font-normal">
                {entry.structure}
              </th>
              <td className="numeric py-2 text-right">{formatCountExact(entry.deals)}</td>
              <td className="numeric py-2 text-right">
                {percentOrReason(entry.share, 'No retail deliveries')}
              </td>
            </tr>
          ))}
          <tr className="font-medium">
            <th scope="row" className="py-2 text-left">
              All retail deliveries
            </th>
            <td className="numeric py-2 text-right">{total.toLocaleString('en-US')}</td>
            <td className="numeric py-2 text-right">100.0%</td>
          </tr>
        </tbody>
      </table>
      <Text size="xs" tone="faint">
        Wholesale and dealer-trade disposals are not retail structures and are not part of
        this mix: a disposal has no consumer, so it carries no finance product and no
        consumer lender. Shares are computed from summed counts, never averaged from store
        percentages. <KpiLink id="KPI-FNI-019" />
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 4. Penetration                                                              */
/* -------------------------------------------------------------------------- */

/** The plain-English denominator for a governed rule, from the rule id on the row. */
const RULE_DESCRIPTION: Readonly<Record<string, string>> = {
  'ELIG-VSC': 'All retail deliveries',
  'ELIG-GAP': 'Financed retail deliveries only',
  'ELIG-TW': 'All retail deliveries',
  'ELIG-PPM': 'New and certified retail deliveries only',
  'ELIG-LWP': 'Lease deliveries only',
  'ELIG-OTH': 'All retail deliveries',
}

export function PenetrationTable({
  view,
  comparisonLabel,
}: {
  readonly view: FiView
  readonly comparisonLabel: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Focusable: a horizontally scrolling region is unreachable by keyboard
           otherwise, so a keyboard-only reader would see the first columns and
           never the rest. */}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Back-end gross composition, scrollable"
      >
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">
            Product penetration by category, each over its own eligible denominator
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Product category
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Contracts
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Deals with product
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Eligible deals
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Penetration
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                {comparisonLabel === null ? 'Prior period' : comparisonLabel}
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Change
              </th>
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Eligible population
              </th>
            </tr>
          </thead>
          <tbody>
            {view.categories.map((row) => (
              <PenetrationRow key={row.category} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <Text size="xs" tone="faint">
        Penetration counts <strong className="font-medium">distinct deals</strong>{' '}
        carrying at least one contract in the category, over the deals{' '}
        <strong className="font-medium">eligible for that category</strong> — not over all
        retail deliveries. One deal may carry two different products in one category,
        which is why contracts and deals with product differ. Every denominator names the
        governed rule that produced it.
      </Text>
    </div>
  )
}

function PenetrationRow({ row }: { readonly row: FiCategoryRow }) {
  const noEligible = row.emptyReason === 'no-eligible-deals'
  return (
    <tr className="border-b border-rule/60">
      <th scope="row" className="py-2 text-left font-normal">
        {row.category}
      </th>
      <td className="numeric py-2 text-right">{formatCountExact(row.contracts)}</td>
      <td className="numeric py-2 text-right">{formatCountExact(row.attachedDeals)}</td>
      <td className="numeric py-2 text-right">
        {noEligible ? (
          <span className="text-ink-muted">None eligible</span>
        ) : (
          formatCountExact(row.eligibleDeals)
        )}
      </td>
      <td className="numeric py-2 text-right">
        {row.penetration.value === null ? (
          <span className="text-ink-muted">No eligible deals</span>
        ) : (
          formatRatioAsPercent(row.penetration.value, 1)
        )}
      </td>
      <td className="numeric py-2 text-right">
        {row.priorPenetration === null || row.priorPenetration.value === null ? (
          <span className="text-ink-muted">Not available</span>
        ) : (
          formatRatioAsPercent(row.priorPenetration.value, 1)
        )}
      </td>
      <td className="numeric py-2 text-right">
        {row.penetrationChange === null ? (
          <span className="text-ink-muted">—</span>
        ) : (
          formatPointsDifference(row.penetrationChange, 1)
        )}
      </td>
      <td className="py-2">
        <span className="font-mono text-[0.6875rem] text-ink-muted">
          {row.eligibilityRuleId}
        </span>{' '}
        <span className="text-xs text-ink-muted">
          {RULE_DESCRIPTION[row.eligibilityRuleId] ?? ''}
        </span>
      </td>
    </tr>
  )
}

/* -------------------------------------------------------------------------- */
/* 5. Category economics                                                       */
/* -------------------------------------------------------------------------- */

export function CategoryEconomics({ view }: { readonly view: FiView }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Focusable: a horizontally scrolling region is unreachable by keyboard
           otherwise, so a keyboard-only reader would see the first columns and
           never the rest. */}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Retail deliveries by finance structure, scrollable"
      >
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">
            Product economics by category, on the deal-date and as-of bases
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Product category
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Contracts
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Retail
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Dealer cost
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Original gross
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Adjustments
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Net gross
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Gross per contract
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Share of gross
              </th>
            </tr>
          </thead>
          <tbody>
            {view.categories.map((row) => (
              <tr key={row.category} className="border-b border-rule/60">
                <th scope="row" className="py-2 text-left font-normal">
                  {row.category}
                </th>
                <td className="numeric py-2 text-right">
                  {formatCountExact(row.contracts)}
                </td>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(row.productRetailPrice)}
                </td>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(row.productDealerCost)}
                </td>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(row.originalProductGross)}
                </td>
                <td className="numeric py-2 text-right">
                  {isZero(row.cumulativeAdjustmentAmount) ? (
                    <span className="text-ink-muted">None</span>
                  ) : (
                    formatCurrencyExact(row.cumulativeAdjustmentAmount)
                  )}
                </td>
                <td className="numeric py-2 text-right">
                  {formatCurrencyExact(row.netProductGrossAsOf)}
                </td>
                <td className="numeric py-2 text-right">
                  {row.grossPerContract.value === null ? (
                    <span className="text-ink-muted">No contracts</span>
                  ) : (
                    formatPerUnitExact(row.grossPerContract.value)
                  )}
                </td>
                <td className="numeric py-2 text-right">
                  {percentOrReason(row.grossMixShare, '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Text size="xs" tone="faint">
        Original gross is the deal-date figure; net gross is what remained as at{' '}
        {view.asOfDate}. Share of gross is each category&rsquo;s original gross over every
        category&rsquo;s, at the same grain and the same basis. Finance reserve and retail
        units are deliberately absent from this table: both are properties of a deal, and
        repeating them on ten category rows would multiply them for anything that summed
        the result. <KpiLink id="KPI-FNI-020" />
      </Text>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 6. Adjustments                                                              */
/* -------------------------------------------------------------------------- */

export function AdjustmentSection({ view }: { readonly view: FiView }) {
  if (view.adjustmentTypes.length === 0) {
    return (
      <div className="rounded border border-rule bg-surface px-4 py-6">
        <Text size="sm" tone="muted">
          No adjustments posted in {view.periodContext.period.label}. That is a genuine
          absence of events rather than a zero: cancellations and chargebacks are grouped
          by the date they posted, and the reporting window truncates the tail of the lag
          distribution, so the most recent sale months carry structurally fewer of them.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Focusable: a horizontally scrolling region is unreachable by keyboard
           otherwise, so a keyboard-only reader would see the first columns and
           never the rest. */}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Product penetration by category, scrollable"
      >
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">
            Adjustment events posted in the selected period, by event type
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Event type
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Events
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Contracts affected
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Amount
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Period proxy rate
              </th>
            </tr>
          </thead>
          <tbody>
            {view.adjustmentTypes.map((row) => (
              <AdjustmentRow key={row.adjustmentType} row={row} />
            ))}
            <tr className="font-medium">
              <th scope="row" className="py-2 text-left">
                Net effect on retained gross
              </th>
              <td className="numeric py-2 text-right">
                {formatCountExact(view.adjustmentEventTotal)}
              </td>
              <td className="py-2" />
              <td className="numeric py-2 text-right">
                {formatCurrencyExact(view.adjustmentAmountTotal)}
              </td>
              <td className="py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      <Text size="xs" tone="faint">
        A positive amount reduces retained gross; a negative one restores it, which is why
        reinstatements are negative and the four types sum to a net effect. Events are
        grouped by <strong className="font-medium">the date they posted</strong>: a
        chargeback in August against a contract written in June is an August event here,
        and the June contract keeps June&rsquo;s gross.
      </Text>

      <div className="rounded border border-rule bg-surface px-3 py-2">
        <Text size="xs" tone="muted">
          <strong className="font-medium text-ink">
            The period proxy rate is not a loss rate.
          </strong>{' '}
          {view.adjustmentTypes[0]?.disclosure ??
            'Its numerator is grouped by posting date and its denominator by selling date, so the contracts in the numerator are mostly not the ones in the denominator.'}
        </Text>
      </div>

      {view.adjustmentCategories.length === 0 ? null : (
        <Disclosure label="Adjustments by product category">
          <table className="w-full text-sm">
            <caption className="sr-only">Adjustment events by product category</caption>
            <thead>
              <tr className="border-b border-rule text-left">
                <th scope="col" className="py-2 font-medium text-ink-muted">
                  Product category
                </th>
                <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                  Events
                </th>
                <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {view.adjustmentCategories.map((row) => (
                <tr key={row.category} className="border-b border-rule/60">
                  <th scope="row" className="py-2 text-left font-normal">
                    {row.category}
                  </th>
                  <td className="numeric py-2 text-right">
                    {formatCountExact(row.events)}
                  </td>
                  <td className="numeric py-2 text-right">
                    {formatCurrencyExact(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Disclosure>
      )}
    </div>
  )
}

function AdjustmentRow({ row }: { readonly row: FiAdjustmentTypeRow }) {
  return (
    <tr className="border-b border-rule/60">
      <th scope="row" className="py-2 text-left font-normal">
        {row.adjustmentType}
      </th>
      <td className="numeric py-2 text-right">{formatCountExact(row.events)}</td>
      <td className="numeric py-2 text-right">{formatCountExact(row.contracts)}</td>
      <td className="numeric py-2 text-right">{formatCurrencyExact(row.amount)}</td>
      <td className="numeric py-2 text-right">
        {row.periodProxyRate.value === null ? (
          <span className="text-ink-muted">No contracts sold</span>
        ) : (
          formatRatioAsPercent(row.periodProxyRate.value, 2)
        )}
      </td>
    </tr>
  )
}

/* -------------------------------------------------------------------------- */
/* 7. Finance managers                                                         */
/* -------------------------------------------------------------------------- */

export function ManagerComparison({ view }: { readonly view: FiView }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Focusable: a horizontally scrolling region is unreachable by keyboard
           otherwise, so a keyboard-only reader would see the first columns and
           never the rest. */}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Product economics by category, scrollable"
      >
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">
            Finance managers compared, in store and identifier order
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Finance manager
              </th>
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Store
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Retail units
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Contracts
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Reserve PVR
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Product gross PVR
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Products per unit
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Retained F&amp;I PVR
              </th>
            </tr>
          </thead>
          <tbody>
            {view.managers.map((row) => (
              <ManagerRow key={row.code ?? 'unstaffed'} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <Text size="xs" tone="faint">
        Ordered by store and synthetic identifier — never by a metric. These figures
        inherit each store&rsquo;s vehicle mix, finance-structure mix and
        product-eligibility mix, so a difference between two rows is not a difference in
        skill. Every ratio uses that manager&rsquo;s own denominator, never the
        store&rsquo;s. Below {formatCountExact(view.minimumSampleFloor)} retail units a
        ratio is withheld and the counts are shown instead. <KpiLink id="KPI-FNI-021" />{' '}
        <KpiLink id="KPI-FNI-022" />
      </Text>
    </div>
  )
}

function ManagerRow({ row }: { readonly row: FiManagerRow }) {
  const withheld = !row.meetsMinimumSample
  const ratioCell = (ratio: FiRatio, render: (value: Exact) => string): ReactNode => {
    if (withheld) return <span className="text-ink-muted">—</span>
    if (ratio.value === null)
      return <span className="text-ink-muted">No retail units</span>
    return render(ratio.value)
  }
  return (
    <tr className="border-b border-rule/60">
      <th scope="row" className="py-2 text-left font-normal">
        <span className="font-mono text-xs">{row.label}</span>
        {withheld ? (
          <span className="ml-2 whitespace-nowrap text-xs text-ink-muted">
            Insufficient sample (n = {formatCountExact(row.retailUnits)})
          </span>
        ) : null}
      </th>
      <td className="py-2 text-xs text-ink-muted">{row.stores.join(', ')}</td>
      <td className="numeric py-2 text-right">{formatCountExact(row.retailUnits)}</td>
      <td className="numeric py-2 text-right">{formatCountExact(row.contractCount)}</td>
      <td className="numeric py-2 text-right">
        {ratioCell(row.reservePvr, (value) => formatPerUnitExact(value))}
      </td>
      <td className="numeric py-2 text-right">
        {ratioCell(row.productGrossPvr, (value) => formatPerUnitExact(value))}
      </td>
      <td className="numeric py-2 text-right">
        {ratioCell(row.productsPerRetailUnit, (value) =>
          exactToString(value).slice(0, 4)
        )}
      </td>
      <td className="numeric py-2 text-right">
        {ratioCell(row.netFiGrossPvr, (value) => formatPerUnitExact(value))}
      </td>
    </tr>
  )
}

/* -------------------------------------------------------------------------- */
/* UX.2B — the Finance Director's workspace                                    */
/* -------------------------------------------------------------------------- */

/**
 * The date basis, as a chip rather than as a sentence.
 *
 * `UX.2B` §9 requires the three bases to be VISUALLY OBVIOUS and forbids explaining them in
 * long paragraphs repeatedly. Before this increment the route stated the basis as a full
 * line under each of eight figures — "Deal date — what the office produced", "As of
 * 2025-12-31 — what the store retained" — which is eight sentences saying one of three
 * things. A chip is the same information at a glance, and it is the same three values
 * everywhere, so a reader learns the vocabulary once.
 *
 * COLOUR IS NOT THE CARRIER. Each chip prints its basis in words; the tint only helps the
 * eye group figures that share one. The methodology disclosure at the foot of the page still
 * owns the full definition of each basis, which is where §9 says the detail belongs.
 */
const BASIS_TINT: Readonly<Record<FiBasis, string>> = {
  deal: 'border-line-subtle bg-surface-sunken text-ink-muted',
  asOf: 'border-accent-muted bg-accent-wash text-accent',
  adjustment: 'border-line bg-zone-inventory text-ink-secondary',
}

export type FiBasis = 'deal' | 'asOf' | 'adjustment'

export function BasisTag({
  basis,
  asOfDate,
}: {
  readonly basis: FiBasis
  readonly asOfDate?: string
}) {
  const label =
    basis === 'deal'
      ? 'Deal date'
      : basis === 'asOf'
        ? `As of ${asOfDate ?? ''}`
        : 'Adjustment period'
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border px-1.5 font-mono text-2xs tracking-wide ${BASIS_TINT[basis]}`}
    >
      {label}
    </span>
  )
}

function RailCell({
  id,
  label,
  value,
  basis,
  asOfDate,
  kpiId,
  note,
  rank,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly basis: FiBasis
  readonly asOfDate: string
  readonly kpiId?: string
  readonly note?: string
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <li
      data-kpi-card={id}
      data-kpi-rank={rank}
      className={cx(
        'flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface',
        rank === 'lead' ? 'p-3' : 'p-2.5'
      )}
    >
      <h3 className="text-xs leading-snug font-medium text-ink-secondary">{label}</h3>
      <span
        className={cx(
          'numeric font-semibold text-ink',
          rank === 'lead' ? 'text-2xl' : 'text-lg'
        )}
      >
        {value}
      </span>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <BasisTag basis={basis} asOfDate={asOfDate} />
        {kpiId === undefined ? null : (
          <span className="font-mono text-2xs tracking-wide text-ink-faint">{kpiId}</span>
        )}
      </p>
      {note === undefined ? null : (
        <p className="mt-auto pt-0.5 text-2xs text-ink-faint">{note}</p>
      )}
    </li>
  )
}

/**
 * The six figures a finance director opens the page holding.
 *
 * THE BRIEF'S SIX, AND ONE OF THEM IS NEW TO THE RAIL. Back PVR, reserve PVR, product PVR,
 * finance reserve, product gross and adjustment impact. The last is the only figure here
 * that was not already a headline: it is the cumulative adjustment amount, which the page
 * previously showed only inside the adjustments section, and a finance director reading
 * "original product gross $412,000" without it is reading a produced figure with no idea
 * how much of it came back.
 *
 * THREE BASES ON ONE RAIL, EACH CHIPPED. Four of the six are deal-date; the adjustment
 * impact is adjustment-period; net gross is as-of. `UX.2B` §9 forbids mixing them silently
 * and this is the surface where mixing them is easiest, so every card carries its chip.
 *
 * THE EIGHT-FIGURE PRODUCTION GRID DID NOT DISAPPEAR. `ProductionSummary` still renders,
 * one module down, with products per retail unit and gross per contract and every basis
 * line it always had. What changed is that six figures are at rail rank and eight are not.
 */
export function FiRail({ view }: { readonly view: FiView }) {
  const p = view.production
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <RailCell
          id="back-pvr"
          rank="lead"
          label="Back gross per retail unit"
          value={
            p.backGrossPvr.value === null
              ? 'No retail units'
              : formatPerUnitExact(p.backGrossPvr.value)
          }
          basis="deal"
          asOfDate={view.asOfDate}
          kpiId="KPI-GRS-005"
        />
        <RailCell
          id="reserve-pvr"
          rank="lead"
          label="Reserve per retail unit"
          value={
            p.reservePvr.value === null
              ? 'No retail units'
              : formatPerUnitExact(p.reservePvr.value)
          }
          basis="deal"
          asOfDate={view.asOfDate}
          kpiId="KPI-FNI-002"
          note="Cash deliveries are inside this denominator and cannot earn reserve."
        />
        <RailCell
          id="product-pvr"
          rank="lead"
          label="Product gross per retail unit"
          value={
            p.productGrossPvr.value === null
              ? 'No retail units'
              : formatPerUnitExact(p.productGrossPvr.value)
          }
          basis="deal"
          asOfDate={view.asOfDate}
          kpiId="KPI-FNI-005"
        />
      </ul>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <RailCell
          id="finance-reserve"
          rank="supporting"
          label="Finance reserve"
          value={formatCurrencyExact(p.financeReserveGross)}
          basis="deal"
          asOfDate={view.asOfDate}
          kpiId="KPI-FNI-001"
          note="An amount, never a rate."
        />
        <RailCell
          id="product-gross"
          rank="supporting"
          label="Original product gross"
          value={formatCurrencyExact(p.originalProductGross)}
          basis="deal"
          asOfDate={view.asOfDate}
          kpiId="KPI-FNI-003"
          note="Before any later adjustment posted."
        />
        <RailCell
          id="adjustment-impact"
          rank="supporting"
          label="Adjustment impact"
          value={formatCurrencyExact(view.adjustmentAmountTotal)}
          basis="adjustment"
          asOfDate={view.asOfDate}
          note={`${formatCountExact(view.adjustmentEventTotal)} events posted in the selected period, against contracts written in any period.`}
        />
      </ul>
    </div>
  )
}

/**
 * Back-end gross as its two components, drawn against the governed total.
 *
 * THE TOTAL IS THE EXPORTED ONE, never a sum assembled here. `back_end_gross` is what the
 * denominator is, and the identity that reserve plus original product gross accounts for
 * all of it is VERIFIED elsewhere on this page and rendered as words. A bar drawn against a
 * total this component added up itself could not fail that check, which is the point of
 * having it.
 *
 * TWO IDENTITY FILLS, NOT THE SIGNED PAIR. Reserve is not the good half of the finance
 * office's month and product gross is not the bad half; a store can hold back-end gross
 * steady while reserve collapses and product compensates, and which of those is preferable
 * depends on the store rather than on the figure.
 */
export function FiGrossComposition({ view }: { readonly view: FiView }) {
  const p = view.production
  return (
    <GrossComposition
      title="Reserve and product"
      segments={[
        {
          key: 'reserve',
          label: 'Finance reserve',
          value: p.financeReserveGross,
          display: formatCurrencyExact(p.financeReserveGross),
        },
        {
          key: 'product',
          label: 'Original product gross',
          value: p.originalProductGross,
          display: formatCurrencyExact(p.originalProductGross),
        },
      ]}
      total={p.backEndGrossDealDate}
      shareDisclosure="Reserve and product gross are published separately and neither is the better half of a month. Other F&I income is exactly $0.00 and is not a balancing figure: the two components account for all of back-end gross, and the identity is recomputed and stated in words below."
      headingLevel={4}
    />
  )
}

/**
 * How the deliveries were funded, as a part-to-whole bar over deal counts.
 *
 * STRUCTURE IS CONTEXT, NOT PERFORMANCE. It decides what could be sold before anything
 * about a customer does: GAP needs financing, Lease Wear Protection needs a lease, and a
 * cash delivery can earn no finance reserve at all. The bar is here so a reader meets that
 * shape before they meet a penetration rate, which is the order the rates only make sense
 * in.
 *
 * THE DENOMINATOR IS RETAIL UNITS, which is the governed one: the three structure counts
 * partition the retail deliveries and nothing else.
 */
export function StructureMixChart({ view }: { readonly view: FiView }) {
  return (
    <GrossComposition
      title="Cash, finance and lease"
      segments={view.structures.map((structure) => ({
        key: structure.structure,
        label: structure.structure,
        value: structure.deals,
        display: `${formatCountExact(structure.deals)} deals${structure.share.value === null ? '' : ` · ${formatRatioAsPercent(structure.share.value, 1)}`}`,
      }))}
      total={view.production.retailUnits}
      headingLevel={4}
    />
  )
}

/**
 * Penetration by category, each against ITS OWN eligible population.
 *
 * BOTH SIDES OF EVERY RATIO ARE ON THE ROW, which is what makes this drawable at all. A GAP
 * rate over all retail deliveries would count cash buyers who have no loan for GAP to cover,
 * and would make every store with a heavier cash mix look worse for a reason that has
 * nothing to do with its finance office. Each bar's note prints `attached / eligible` so the
 * denominator is never something a reader has to take on trust.
 *
 * A CATEGORY WITH NO ELIGIBLE DEALS DRAWS NO BAR and says so. A rate with no denominator is
 * undefined and not zero, and a zero-length bar would present the second as the first.
 *
 * NOTHING IS RANKED AND NOTHING IS COLOURED "GOOD". The order is `FI_CATEGORY_ORDER`, the
 * governed vocabulary, and ARPI publishes no F&I benchmark for any of these rates.
 */
export function PenetrationChart({ view }: { readonly view: FiView }) {
  return (
    <GroupedMeasureBars
      title="Penetration by category"
      groups={[
        {
          id: 'penetration',
          label: 'Attached deals as a share of eligible deals',
          rows: view.categories.map((category) => ({
            key: category.slug,
            label: category.category,
            value: category.penetration.value,
            display:
              category.penetration.value === null
                ? 'No eligible deals'
                : formatRatioAsPercent(category.penetration.value, 1),
            note: `${formatCountExact(category.attachedDeals)}/${formatCountExact(category.eligibleDeals)}`,
          })),
        },
      ]}
      legend={false}
      categoryHeading="Product category"
      footnote="Each category is measured against the deals it was ELIGIBLE for under one governed rule, not against all retail deliveries. Both sides of every ratio are printed. No industry benchmark exists for any of these rates."
      headingLevel={4}
    />
  )
}

/**
 * What each category earned, on two measures.
 *
 * ATTACHMENT AND ECONOMICS ARE DIFFERENT QUESTIONS and this module is the second one. A
 * category can be attached often and earn little, or rarely and earn a great deal, and the
 * penetration module directly above answers only the first. Original gross and gross per
 * contract are drawn together for that reason.
 *
 * EACH MEASURE IS SCALED TO ITS OWN LARGEST CATEGORY, because dollars and dollars per
 * contract share no axis. The primitive's footnote says so; no cross-group length
 * comparison is available and none is implied.
 *
 * THE FULL TABLE — retail, cost, gross, adjustments and net, per category — is still
 * rendered by `CategoryEconomics` in the module below. This draws two of its columns.
 */
export function CategoryEconomicsChart({ view }: { readonly view: FiView }) {
  return (
    <GroupedMeasureBars
      title="Category economics"
      groups={[
        {
          id: 'gross',
          label: 'Original product gross',
          kpiId: 'KPI-FNI-003',
          rows: view.categories.map((category) => ({
            key: category.slug,
            label: category.category,
            value: category.originalProductGross,
            display: formatCurrencyExact(category.originalProductGross, 0),
          })),
        },
        {
          id: 'per-contract',
          label: 'Gross per contract',
          kpiId: 'KPI-FNI-011',
          rows: view.categories.map((category) => ({
            key: category.slug,
            label: category.category,
            value: category.grossPerContract.value,
            display:
              category.grossPerContract.value === null
                ? 'No contracts'
                : formatPerUnitExact(category.grossPerContract.value),
          })),
        },
      ]}
      categoryHeading="Product category"
      footnote="Deal-date basis. Each measure is scaled to its own largest category; dollars and dollars per contract share no axis."
      headingLevel={4}
    />
  )
}

/**
 * What came back, by the month it posted.
 *
 * THE ADJUSTMENT-PERIOD BASIS AND NOTHING ELSE. Every column groups events by the day they
 * POSTED, from the exported `adjustment_date`. A chargeback in this period against a
 * contract written earlier belongs to this period; the earlier contract keeps the gross it
 * was written with, and this chart never touches it. The module's own basis chip says so on
 * its face rather than in a paragraph, which is what `UX.2B` §9 asks for.
 *
 * COLUMNS AND NOT A LINE, for the reason `TrendChart` gives at length: a line implies the
 * quantity existed between the points, and there is no adjustment amount "between" two
 * posting months.
 *
 * THE PER-TYPE SPLIT IS THE TABLE, not four overlaid series. Four series of four amounts
 * over a handful of months is a picture nobody can read; the shape a finance director wants
 * from the columns is whether the total is moving, and which type moved is one row of a
 * table away. The full per-type economics, with the period-proxy rates and their
 * disclosures, are in the adjustments module below.
 */
export function AdjustmentTrend({ view }: { readonly view: FiView }) {
  const months = view.adjustmentMonths
  if (months.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No adjustment posted inside the selected period. That is an absence of events, not
        an amount of zero.
      </Text>
    )
  }
  const types = months[0]?.byType.map((entry) => entry.type) ?? []

  /*
   * ONE POSTING MONTH IS NOT A TREND, AND A ONE-COLUMN COLUMN CHART SAYS OTHERWISE.
   *
   * The default period is a single calendar month, so most requests to this page resolve to
   * exactly one posting month — and a column chart with one column renders as a solid block
   * filling the panel, which reads as a chart that failed rather than as a period with one
   * observation in it. The figure and its event count say the same thing truthfully, and the
   * per-type table below is unchanged either way. Widen the period and the columns appear.
   */
  const single = months.length === 1 ? months[0] : undefined

  return (
    <div className="flex flex-col gap-3">
      {single === undefined ? null : (
        <div className="flex flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-3">
          <Text size="xs" tone="muted">
            {`Posted in ${single.label}`}
          </Text>
          <span className="numeric text-2xl font-semibold text-ink">
            {formatCurrencyExact(single.total)}
          </span>
          <Text size="xs" tone="faint">
            {`${formatCountExact(single.events)} events. The selected period covers one posting month, so there is no shape to draw; widen the period to compare months.`}
          </Text>
        </div>
      )}
      {single !== undefined ? null : (
        <TrendChart
          title="Adjustment amount by posting month"
          measure="Adjustment amount"
          points={months.map((month) => ({
            key: month.key,
            label: month.label,
            value: month.total,
            display: formatCurrencyExact(month.total),
          }))}
          periodHeading="Posting month"
          valueHeading="Amount"
          summaryMode="sr-only"
          headingLevel={4}
        />
      )}
      <TableDisclosure title="adjustment amount by posting month and type">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Adjustment amount by posting month and adjustment type
          </caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Posting month
              </th>
              {types.map((type) => (
                <th
                  key={type}
                  scope="col"
                  className="py-2 pl-3 text-right font-medium text-ink-muted"
                >
                  {type}
                </th>
              ))}
              <th scope="col" className="py-2 pl-3 text-right font-medium text-ink-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr
                key={month.key}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {month.label}
                </th>
                {month.byType.map((entry) => (
                  <td
                    key={entry.type}
                    className="numeric py-1.5 pl-3 text-right text-ink"
                  >
                    {formatCurrencyExact(entry.amount)}
                  </td>
                ))}
                <td className="numeric py-1.5 pl-3 text-right font-semibold text-ink">
                  {formatCurrencyExact(month.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>
    </div>
  )
}
