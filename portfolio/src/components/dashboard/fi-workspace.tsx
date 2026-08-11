/**
 * The F&I workspace: the rail, the structure mix, the penetration bars and the adjustment
 * activity.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2B-BASELINE.md`: `/dashboard/fi` carried **177 words of prose before the
 * first number** — the highest first-viewport prose count in the console — then eight
 * production figures at one weight, six visible tables at one weight and four methodology
 * disclosures, down a 6,614 px document with no framed figure anywhere in it.
 *
 * Reserve against product, the structure mix and per-category penetration are three
 * COMPARISONS, and each was a table of numbers. They are lengths now. Nothing else about them
 * changed: the same governed ratios, the same eligible denominators, the same three date bases
 * and the same minimum-sample floor.
 *
 * THE THREE DATE BASES ARE ON THE FIGURES, NOT IN A PARAGRAPH
 * ----------------------------------------------------------
 * `UX.2B` §42 asks for the deal-date, as-of retained and adjustment-period bases to be
 * visually understandable rather than buried in prose. Every figure this file renders carries
 * a compact basis label in the same slot, in the same type, with the as-of date printed on the
 * ones that have one. The long explanation of why they are not interchangeable stays where it
 * was, in the page's methodology disclosure — a reader who wants the argument opens one thing,
 * and a reader who just needs to know which basis a number is on reads the label under it.
 *
 * NOTHING IS RANKED, SCORED OR RECOMMENDED. No structure is better than another, no category
 * is a target, no penetration is good or weak, and no manager is placed above another. ARPI
 * publishes no F&I benchmark, so a figure is stated rather than judged.
 *
 * Server components. No client JavaScript. Every value arrives resolved and formatted from
 * `lib/dashboard/fi.ts`; nothing here divides, sums or decides what a measure means.
 */
import type { ReactNode } from 'react'

import { exactToApproxNumber } from '@/lib/dashboard/decimal'
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
  FiRatio,
  FiStructureShare,
  FiView,
} from '@/lib/dashboard/fi'
import { cx } from '@/lib/utils'

import { ChartFrame, TableDisclosure } from './visuals'

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function widthOf(fraction: number): string {
  return `${String(Math.round(Math.min(Math.max(fraction, 0), 1) * 1000) / 10)}%`
}

/**
 * A governed ratio as a share for a bar's width.
 *
 * THE VALUE IS ALREADY DIVIDED. `fi.ts` formed every ratio exactly, from its own numerator and
 * its own eligible denominator, and published `value` as an exact decimal. Turning that into a
 * float here is the geometry conversion `visuals.tsx` documents at length — it produces a
 * width and never a printed figure, and every percentage on screen comes from
 * `formatRatioAsPercent` over the exact value.
 */
function shareOf(ratio: FiRatio): number | null {
  if (ratio.value === null) return null
  return exactToApproxNumber(ratio.value)
}

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The three a finance director reads first, and the three that qualify them.
 *
 * WHY THESE THREE. `UX.2B` §35 names back PVR, reserve PVR and product PVR as the priority and
 * warns against overcrowding. Back PVR is the number the director is asked about; reserve and
 * product PVR are the only two things it is made of, so a movement in the first is always a
 * movement in one of the other two. The gross amounts underneath are the same three measures
 * without the denominator, which is what makes them supporting rather than primary.
 *
 * THE BASIS IS ON EVERY CARD. Five of the six are deal-date figures; the retained one is as of
 * the export's own as-of date, and its card says so with the date in it. `UX.2B` §42 forbids
 * collapsing the bases into one generic date, and a card that named no basis would be doing
 * exactly that by omission.
 */
export function FiRail({ view }: { readonly view: FiView }) {
  const p = view.production
  const lead = [
    {
      id: 'back-pvr',
      label: 'Back PVR',
      value:
        p.backGrossPvr.value === null ? null : formatPerUnitExact(p.backGrossPvr.value),
      kpiId: 'KPI-GRS-005',
      basis: 'Deal date',
    },
    {
      id: 'reserve-pvr',
      label: 'Reserve PVR',
      value: p.reservePvr.value === null ? null : formatPerUnitExact(p.reservePvr.value),
      kpiId: 'KPI-FNI-002',
      basis: 'Deal date',
    },
    {
      id: 'product-pvr',
      label: 'Product PVR',
      value:
        p.productGrossPvr.value === null
          ? null
          : formatPerUnitExact(p.productGrossPvr.value),
      kpiId: 'KPI-FNI-005',
      basis: 'Deal date',
    },
  ]

  const supporting = [
    {
      id: 'back-gross',
      label: 'Back-end gross',
      value: formatCurrencyExact(p.backEndGrossDealDate),
      kpiId: 'KPI-GRS-002',
      basis: 'Deal date',
    },
    {
      id: 'reserve-gross',
      label: 'Finance reserve',
      value: formatCurrencyExact(p.financeReserveGross),
      kpiId: 'KPI-FNI-001',
      basis: 'Deal date',
    },
    {
      id: 'retained-pvr',
      label: 'Retained F&I PVR',
      value:
        p.netFiGrossPvr.value === null ? null : formatPerUnitExact(p.netFiGrossPvr.value),
      kpiId: 'KPI-FNI-022',
      basis: `As of ${view.asOfDate}`,
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {lead.map((cell) => (
          <RailCell key={cell.id} {...cell} rank="lead" />
        ))}
      </dl>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {supporting.map((cell) => (
          <RailCell key={cell.id} {...cell} rank="supporting" />
        ))}
      </dl>
      <p className="text-2xs text-ink-faint">
        {`Every per-unit figure divides by ${formatCountExact(p.retailUnits)} retail deliveries, including cash deliveries that cannot earn reserve. A rate with no denominator is stated as such rather than shown as zero.`}
      </p>
    </div>
  )
}

function RailCell({
  id,
  label,
  value,
  kpiId,
  basis,
  rank,
}: {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly kpiId: string
  readonly basis: string
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <div
      data-fi-figure={id}
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
        {value ?? 'No retail units'}
      </dd>
      <dd className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 pt-0.5 text-2xs text-ink-faint">
        <span>{basis}</span>
        <a
          href={`/kpis#${kpiId}`}
          className="inline-flex min-h-6 items-center font-mono tracking-wide underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          {kpiId}
        </a>
      </dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Structure mix                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The structure marks. IDENTITY, in the governed order, and never a ranking.
 *
 * Written out because Tailwind scans source text. Cash, retail finance and lease are three
 * ways a delivery is funded; `UX.2B` §37 forbids labelling one better than another, and the
 * palette is the categorical set for exactly that reason — no ramp, no good end.
 */
const STRUCTURE_MARKS: Readonly<Record<string, string>> = {
  Cash: 'bg-data-tertiary',
  'Retail Finance': 'bg-data-primary',
  Lease: 'bg-data-secondary',
}

const STRUCTURE_MARK_FALLBACK = 'bg-data-muted'

function structureMark(structure: string): string {
  return STRUCTURE_MARKS[structure] ?? STRUCTURE_MARK_FALLBACK
}

/**
 * How the retail deliveries were funded, as one part-to-whole bar.
 *
 * WHY THIS IS A COMPOSITION AND NOT A COMPARISON. The three shares sum to every retail
 * delivery, so the question is what proportion of the month each structure was — which is what
 * a stacked bar answers directly and a three-row table makes the reader compute. It is also the
 * context every penetration figure below sits in: GAP needs financing, lease wear protection
 * needs a lease, and a cash delivery can earn no finance reserve at all.
 *
 * WHOLESALE AND DEALER TRADES ARE NOT IN IT. A disposal has no consumer, carries no finance
 * product and no consumer lender, and is not a retail structure. That is stated once, under
 * the bar, because a reader who adds them in gets a different denominator from the one every
 * share here was computed over.
 */
export function StructureComposition({
  structures,
  totalDisplay,
  periodLabel,
}: {
  readonly structures: readonly FiStructureShare[]
  /** The retail-delivery count every share was computed over, already formatted. */
  readonly totalDisplay: string
  readonly periodLabel: string
}) {
  const drawable = structures.filter((entry) => {
    const share = shareOf(entry.share)
    return share !== null && share > 0
  })
  const summary =
    structures.length === 0
      ? 'No retail delivery in scope carries a finance structure.'
      : structures
          .map(
            (entry) =>
              `${entry.structure} ${formatCountExact(entry.deals)} deliveries, ${
                entry.share.value === null
                  ? 'no retail deliveries'
                  : formatRatioAsPercent(entry.share.value, 1)
              }`
          )
          .join('; ') + '.'

  return (
    <ChartFrame
      title="How the deliveries were funded"
      caption={`Retail deliveries by finance structure over ${periodLabel}. Shares are computed from summed counts, never averaged from store percentages.`}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={4}
    >
      {drawable.length === 0 ? (
        <p className="text-xs leading-normal text-ink-muted">
          No retail delivery in scope carries a finance structure, so no share is defined.
        </p>
      ) : (
        <div
          aria-hidden="true"
          className="flex h-4 w-full overflow-hidden rounded-pill bg-surface-sunken"
        >
          {drawable.map((entry, index) => (
            <div
              key={entry.structure}
              className={`h-full ${structureMark(entry.structure)}`}
              style={{
                width: widthOf(shareOf(entry.share) ?? 0),
                marginRight: index < drawable.length - 1 ? '2px' : undefined,
              }}
            />
          ))}
        </div>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-3">
        {structures.map((entry) => (
          <div key={entry.structure} className="flex min-w-0 flex-col gap-0.5">
            <dt className="flex items-baseline gap-1.5 text-2xs uppercase tracking-wide text-ink-muted">
              <span
                aria-hidden="true"
                className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${structureMark(entry.structure)}`}
              />
              {entry.structure}
            </dt>
            <dd className="numeric text-sm font-semibold text-ink">
              {entry.share.value === null
                ? 'No retail deliveries'
                : formatRatioAsPercent(entry.share.value, 1)}
              <span className="ml-1.5 text-xs font-normal text-ink-muted">
                {formatCountExact(entry.deals)}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <TableDisclosure title="finance structure mix">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`Retail deliveries by finance structure over ${periodLabel}. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Structure
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Deliveries
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Share of retail deliveries
              </th>
            </tr>
          </thead>
          <tbody>
            {structures.map((entry) => (
              <tr
                key={entry.structure}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {entry.structure}
                </th>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {formatCountExact(entry.deals)}
                </td>
                <td className="numeric py-1.5 text-right text-ink">
                  {entry.share.value === null
                    ? 'No retail deliveries'
                    : formatRatioAsPercent(entry.share.value, 1)}
                </td>
              </tr>
            ))}
            {/* The denominator, stated. Every share above was computed over this count,
                and a reader who cannot see it has to take the percentages on trust. */}
            <tr className="font-medium">
              <th scope="row" className="py-1.5 pr-3 text-left text-ink">
                All retail deliveries
              </th>
              <td className="numeric py-1.5 pr-3 text-right text-ink">{totalDisplay}</td>
              <td className="numeric py-1.5 text-right text-ink">
                {structures.length === 0 ? 'No retail deliveries' : '100.0%'}
              </td>
            </tr>
          </tbody>
        </table>
      </TableDisclosure>

      <p className="text-2xs leading-normal text-ink-faint">
        Wholesale and dealer-trade disposals are not retail structures and are not part of
        this mix: a disposal has no consumer, so it carries no finance product and no
        consumer lender. Shares are computed from summed counts, never averaged from store
        percentages. <span className="font-mono">KPI-FNI-019</span>
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Penetration                                                                 */
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

/**
 * Penetration by category, as a bar per category with both sides of every ratio printed.
 *
 * ATTACHED DISTINCT DEALS OVER ELIGIBLE DEALS. Never contracts over deliveries, and never an
 * average of per-store rates. `fi.ts` formed each ratio from its own numerator and its own
 * governed denominator, and this component reads `penetration.value` and draws a length from
 * it — it cannot form a rate, because it has no arithmetic in it.
 *
 * WHY EVERY BAR IS DRAWN AGAINST 100%, NOT AGAINST THE LARGEST CATEGORY. A penetration is a
 * proportion of its own eligible population and its ceiling is one. Scaling the set to its
 * own maximum would make the best-attached category a full bar whatever it actually reached,
 * which is the single most misleading thing a proportion chart can do.
 *
 * EVERY DENOMINATOR IS DIFFERENT AND IS NAMED. GAP is over financed deliveries, lease wear
 * protection over leases, prepaid maintenance over new and certified units. Both sides of the
 * ratio and the `ELIG-*` rule that produced the denominator are printed beside each bar, so
 * the denominator is never something a reader has to take on trust. A category with no
 * eligible deal shows "No eligible deals" and no bar at all — a rate with no denominator is
 * undefined and not zero.
 *
 * NOTHING IS RANKED OR SCORED. Rows are in the governed category order. `UX.2B` §39 forbids
 * turning penetration into a performance score, and there is no total, no average, no target
 * and no colour that means good.
 */
export function PenetrationBars({
  categories,
  comparisonLabel,
}: {
  readonly categories: readonly FiCategoryRow[]
  readonly comparisonLabel: string | null
}) {
  const summary =
    categories.length === 0
      ? 'No product category resolves for this scope.'
      : categories
          .map(
            (row) =>
              `${row.category} ${
                row.penetration.value === null
                  ? 'no eligible deals'
                  : `${formatRatioAsPercent(row.penetration.value, 1)}, ${formatCountExact(row.attachedDeals)} of ${formatCountExact(row.eligibleDeals)} eligible deals`
              }`
          )
          .join('; ') + '.'

  return (
    <ChartFrame
      title="What was sold, against what could have been"
      caption="Distinct deals carrying at least one contract in the category, over the deals eligible for that category. Each bar runs from zero to full eligibility, so lengths compare directly."
      summary={summary}
      summaryMode="sr-only"
      headingLevel={4}
    >
      <ul className="flex flex-col gap-2.5">
        {categories.map((row) => {
          const share = shareOf(row.penetration)
          return (
            <li key={row.category} className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 truncate text-xs text-ink-secondary">
                  {row.category}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span
                    className={cx(
                      'text-sm',
                      share === null
                        ? 'font-medium text-ink-muted'
                        : 'numeric font-semibold text-ink'
                    )}
                  >
                    {row.penetration.value === null
                      ? 'No eligible deals'
                      : formatRatioAsPercent(row.penetration.value, 1)}
                  </span>
                  <span className="numeric text-2xs text-ink-muted">
                    {`${formatCountExact(row.attachedDeals)} of ${formatCountExact(row.eligibleDeals)}`}
                  </span>
                </span>
              </p>
              {share === null ? null : (
                <span
                  aria-hidden="true"
                  className="block h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
                >
                  <span
                    className="block h-full rounded-pill bg-data-primary"
                    style={{ width: widthOf(share) }}
                  />
                </span>
              )}
              <p className="text-2xs text-ink-faint">
                <span className="font-mono tracking-wide">{row.eligibilityRuleId}</span>{' '}
                {RULE_DESCRIPTION[row.eligibilityRuleId] ?? ''}
              </p>
            </li>
          )
        })}
      </ul>

      <TableDisclosure title="penetration by category">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`Product penetration by category, each over its own eligible denominator. ${summary}`}</caption>
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-ink-muted">
                Category
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Contracts
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Deals with product
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Eligible deals
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                Penetration
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium text-ink-muted">
                {comparisonLabel ?? 'Prior period'}
              </th>
              <th scope="col" className="py-2 text-right font-medium text-ink-muted">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((row) => (
              <tr
                key={row.category}
                className="border-b border-line-subtle/60 last:border-0"
              >
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink-secondary">
                  {row.category}
                </th>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {formatCountExact(row.contracts)}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {formatCountExact(row.attachedDeals)}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {row.emptyReason === 'no-eligible-deals'
                    ? 'None eligible'
                    : formatCountExact(row.eligibleDeals)}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink">
                  {row.penetration.value === null
                    ? 'No eligible deals'
                    : formatRatioAsPercent(row.penetration.value, 1)}
                </td>
                <td className="numeric py-1.5 pr-3 text-right text-ink-muted">
                  {row.priorPenetration === null || row.priorPenetration.value === null
                    ? 'Not available'
                    : formatRatioAsPercent(row.priorPenetration.value, 1)}
                </td>
                <td className="numeric py-1.5 text-right text-ink-muted">
                  {row.penetrationChange === null
                    ? 'Not comparable'
                    : formatPointsDifference(row.penetrationChange, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDisclosure>

      <p className="text-2xs leading-normal text-ink-faint">
        Distinct deals, never contracts: one deal may carry two products in one category.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Adjustment activity                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What came back, and what went back on, as signed bars around a zero rule.
 *
 * THE SIGN IS THE MEANING, WHICH IS THE ONE CASE THIS CONSOLE COLOURS. A cancellation or a
 * chargeback REDUCES retained gross and a reinstatement RESTORES it; that is a fact about the
 * accounting rather than a judgement about the business, and it is the same rule under which
 * the gross-change bridge colours its steps. `UX.2B` §40 permits exactly this and forbids
 * calling a chargeback bad or a reinstatement good — the labels here are the governed event
 * types and nothing else.
 *
 * THE BASIS IS THE ADJUSTMENT PERIOD AND SAYS SO. Events are grouped by the day they posted. A
 * chargeback in this period against a contract written earlier belongs to this period, and the
 * earlier contract keeps the gross it was written with. Presenting these amounts as deal-date
 * production would be `UX.2B` §58's tenth seeded defect.
 */
export function AdjustmentBars({
  rows,
  periodLabel,
}: {
  readonly rows: readonly FiAdjustmentTypeRow[]
  readonly periodLabel: string
}) {
  const magnitudes = rows.map((row) => Math.abs(shareOfAmount(row)))
  const largest = magnitudes.length === 0 ? 1 : Math.max(...magnitudes, 1)

  const summary =
    rows.length === 0
      ? `No adjustment posted in ${periodLabel}.`
      : rows
          .map(
            (row) =>
              `${row.adjustmentType} ${formatCurrencyExact(row.amount)} over ${formatCountExact(row.events)} events`
          )
          .join('; ') + '.'

  return (
    <ChartFrame
      title="What came back, and when it posted"
      caption={`Adjustment events grouped by the day they posted, over ${periodLabel}. A positive amount reduced retained gross; a negative amount restored it.`}
      summary={summary}
      summaryMode="sr-only"
      headingLevel={4}
    >
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const amount = shareOfAmount(row)
          const reduces = amount > 0
          return (
            <li key={row.adjustmentType} className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 truncate text-xs text-ink-secondary">
                  {row.adjustmentType}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="numeric text-sm font-semibold text-ink">
                    {/* The exact signed amount, and a neutral word for the direction the
                        accounting went. Colour is never the only channel, and an arrow
                        alone was not enough: a reinstatement carries a NEGATIVE amount and
                        an upward arrow, and "↑ -$297" reads as a contradiction until the
                        word is there. `UX.2B` §40 forbids calling a chargeback bad or a
                        reinstatement good; "reduces" and "restores" are what the ledger
                        did. */}
                    {formatCurrencyExact(row.amount)}
                  </span>
                  <span className="text-2xs text-ink-muted">
                    {reduces ? 'reduces retained gross' : 'restores retained gross'}
                  </span>
                  <span className="numeric text-2xs text-ink-muted">
                    {`${formatCountExact(row.events)} events`}
                  </span>
                </span>
              </p>
              <span
                aria-hidden="true"
                className="block h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
              >
                <span
                  className={cx(
                    'block h-full rounded-pill',
                    reduces ? 'bg-data-negative' : 'bg-data-positive'
                  )}
                  style={{ width: widthOf(Math.abs(amount) / largest) }}
                />
              </span>
            </li>
          )
        })}
      </ul>

      <p className="text-2xs leading-normal text-ink-faint">
        Adjustment-period basis. These amounts are not deal-date production and are never
        netted into it: the contracts charged back in a month are mostly not the ones
        written in it.
      </p>
    </ChartFrame>
  )
}

/**
 * One adjustment row's amount, as a float, for a bar length.
 *
 * Geometry only. Every amount printed beside a bar comes from `formatCurrencyExact` over the
 * exact value, and no displayed figure is derived from this.
 */
function shareOfAmount(row: FiAdjustmentTypeRow): number {
  return exactToApproxNumber(row.amount)
}

/* -------------------------------------------------------------------------- */
/* The basis legend                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The three date bases, as three labelled chips rather than as a paragraph.
 *
 * `UX.2B` §42 asks for the distinction to be visually understandable and forbids burying it in
 * prose or collapsing the three into one generic date. This is the key: it names each basis,
 * says in six words what it answers, and prints the as-of date on the one that has one. The
 * full argument for why they are not interchangeable is in the page's methodology disclosure,
 * which is where a reader who wants it goes — and every figure on the route carries its own
 * basis label, so nobody has to come back here to read a number correctly.
 */
export function DateBasisKey({
  asOfDate,
  periodLabel,
}: {
  readonly asOfDate: string
  readonly periodLabel: string
}) {
  const bases: readonly {
    readonly id: string
    readonly term: string
    readonly detail: string
  }[] = [
    {
      id: 'deal-date',
      term: 'Deal date',
      detail: 'What the office produced. Never rewritten by a later event.',
    },
    {
      id: 'as-of',
      term: `As of ${asOfDate}`,
      detail: 'What the store retained, after every adjustment posted by that date.',
    },
    {
      id: 'adjustment-period',
      term: `Adjustment period, ${periodLabel}`,
      detail: 'Events grouped by the day they posted.',
    },
  ]

  /*
   * ONE COLUMN, ALWAYS. The key sits in a three-of-twelve module, so three columns of it
   * gave each basis about 90 px and truncated `Adjustment period, December 2025` to
   * `Adjust`. A date basis a reader cannot read is not a key.
   */
  return (
    <dl className="flex flex-col gap-2">
      {bases.map((basis) => (
        <div
          key={basis.id}
          data-fi-basis={basis.id}
          className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-2.5"
        >
          <dt className="text-xs font-semibold text-ink">{basis.term}</dt>
          <dd className="text-2xs leading-normal text-ink-muted">{basis.detail}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A body of detail, collapsed but not removed. */
export function FiDisclosure({
  id,
  summary,
  children,
}: {
  readonly id: string
  readonly summary: string
  readonly children: ReactNode
}) {
  return (
    <details
      id={id}
      className="rounded-xl border border-line-subtle bg-surface-sunken/40"
    >
      <summary className="flex min-h-touch cursor-pointer items-center px-3 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:text-accent">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-4">{children}</div>
    </details>
  )
}
