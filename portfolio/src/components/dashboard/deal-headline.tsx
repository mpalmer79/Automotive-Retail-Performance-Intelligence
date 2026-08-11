/**
 * The Deal Jacket's identity header and its two economics visuals.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2B-BASELINE.md` §7: sale price, front gross, back gross, total gross and
 * days in stock are the five figures a manager reviewing a deal wants at once, and they were
 * in four different sections spread down a 5,806 px document behind ten `h2`s of equal
 * weight. The first viewport carried an `h1` and two section titles and no money at all.
 *
 * `UX.2B` §19 and §20 put them in one header under the deal's identity. The sections below
 * still carry every one of them inside its own exact calculation — the header is a second
 * PRESENTATION of figures the view model already resolved, never a second computation of
 * them, which is why `DealHeadline` is built in `deal-jacket.ts` from the same exported
 * columns the calculation blocks read.
 *
 * WHAT IS DELIBERATELY NOT IN THE HEADER
 * --------------------------------------
 * No customer, no name, no contact detail and no VIN. The synthetic VIN-style identifier is
 * on the vehicle module where a reader who wants it goes looking; putting a seventeen-
 * character identifier belonging to no real vehicle at the top of a deal record would be the
 * page imitating a document ARPI does not hold.
 *
 * Server components. No client JavaScript. `exactToApproxNumber` appears twice, both times to
 * compute a bar width, and never to produce a displayed figure.
 */
import type { ReactNode } from 'react'

import { exactToApproxNumber } from '@/lib/dashboard/decimal'
import type { CalculationLine, DealJacket } from '@/lib/dashboard/deal-jacket'
import { cx } from '@/lib/utils'

import { ChartFrame } from './visuals'

/** A percentage, as CSS wants it, from a fraction. Layout only. */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1000) / 10)}%`
}

/* -------------------------------------------------------------------------- */
/* The identity header                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What deal this is, and what it made.
 *
 * TOTAL GROSS IS THE LARGEST FIGURE and sale price is beside it, because those are the two a
 * reviewer names the deal by. Front and back sit under them at a smaller size: they are the
 * decomposition, and the modules below take each of them apart. Days in stock is a count
 * rather than money and is set apart from the four money figures for that reason alone —
 * it is not ranked below them, it is a different kind of thing.
 *
 * NOTHING IS COLOURED BY SIGN. A negative front-end gross is a real dealership outcome and is
 * rendered with its sign, in the same ink as a positive one. This console publishes no
 * favourable direction for a single deal's gross, and a red figure here would be a verdict
 * on a transaction the page knows nothing else about.
 */
export function DealHeadlineHeader({ jacket }: { readonly jacket: DealJacket }) {
  const { headline, identity, vehicle } = jacket
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <HeadlineFigure
          id="sale-price"
          label="Sale price"
          value={headline.salePrice}
          rank="lead"
        />
        <HeadlineFigure
          id="total-gross"
          label="Total gross"
          value={headline.totalGross}
          note="Front plus back"
          rank="lead"
        />
        <HeadlineFigure
          id="front-gross"
          label="Front gross"
          value={headline.frontGross}
          note="Vehicle"
          rank="supporting"
        />
        <HeadlineFigure
          id="back-gross"
          label="Back gross"
          value={headline.backGross}
          note="Finance office, deal date"
          rank="supporting"
        />
        <HeadlineFigure
          id="days-in-stock"
          label="Days in stock at sale"
          value={
            headline.daysInInventory === null
              ? null
              : `${String(headline.daysInInventory)} days`
          }
          absence="The export carries no age for this unit"
          rank="supporting"
        />
      </dl>

      {/* The identity line: what kind of transaction this was, in six words rather than
          six facts. The full identity list is the deal-structure module below. */}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{identity.storeName}</span>
        <span>{vehicle.conditionType}</span>
        <span>
          {identity.saleType}
          {identity.isRetail ? null : (
            <span className="ml-1.5 text-ink-faint">not a retail unit</span>
          )}
        </span>
        <span>{identity.financeStructure}</span>
        <span>Delivered {identity.deliveryDate}</span>
      </p>
    </div>
  )
}

function HeadlineFigure({
  id,
  label,
  value,
  note,
  absence,
  rank,
}: {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly note?: string
  readonly absence?: string
  readonly rank: 'lead' | 'supporting'
}) {
  return (
    <div
      data-deal-figure={id}
      className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-3"
    >
      <dt className="text-xs leading-snug text-ink-secondary">{label}</dt>
      <dd
        className={cx(
          value === null
            ? 'text-sm text-ink-muted'
            : cx(
                'numeric font-semibold text-ink',
                rank === 'lead' ? 'text-2xl' : 'text-lg'
              )
        )}
      >
        {value ?? absence ?? 'No value'}
      </dd>
      {note === undefined ? null : (
        <dd className="mt-auto pt-0.5 text-2xs leading-normal text-ink-faint">{note}</dd>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The front-end economics ladder                                              */
/* -------------------------------------------------------------------------- */

/**
 * The front-gross identity, as a ladder of deductions.
 *
 * WHY A LADDER AND NOT A WATERFALL. A waterfall's steps float between two anchors and are
 * read as CONTRIBUTIONS to a change — which is what the gross-change bridge on
 * `/dashboard/sales-gross` is, and it is the right form there. This is not a change: it is one
 * price with three costs taken out of it, and every deduction is a slice of the same starting
 * amount. A ladder shows that directly: the sale price is the full track, each cost is drawn
 * against it at its own share, and what is left is the front gross.
 *
 * THE FORMULA IS THE VIEW MODEL'S, UNCHANGED. `UX.2B` §21 forbids a new formula, and there is
 * none here: the lines are `jacket.frontGross.lines` in the order `deal-jacket.ts` built them,
 * which is the ARPI definition of `KPI-GRS-001` — sale price less acquisition, reconditioning
 * and pack. This component reads an array and divides for a width.
 *
 * TRADE VARIANCE IS NOT IN IT, AND CANNOT BE. It is not one of the lines, and this component
 * draws only the lines it is given. The trade module renders separately, below, with its own
 * heading, for the reason the front-gross disclosure states: folding it in would change what
 * the KPI means.
 *
 * A NEGATIVE FRONT GROSS BREAKS THE PICTURE AND SAYS SO. Where the deductions exceed the sale
 * price the result is a signed amount and not a remaining slice, so the bar for the result is
 * withheld and the figure is rendered with its sign. A stack drawn over a negative remainder
 * would be a picture of something that did not happen.
 */
export function FrontEconomicsLadder({
  lines,
  className,
}: {
  readonly lines: readonly CalculationLine[]
  readonly className?: string
}) {
  const start = lines[0]
  const result = lines.find((line) => line.isResult === true)
  const deductions = lines.filter((line) => line.operator === '−')
  if (start === undefined || result === undefined) return null

  const scale = exactToApproxNumber(start.amount)
  const resultValue = exactToApproxNumber(result.amount)
  const drawable = scale > 0 && resultValue >= 0

  const summary =
    `${start.label} ${start.display}, less ` +
    deductions.map((line) => `${line.label.toLowerCase()} ${line.display}`).join(', ') +
    `, giving ${result.label.toLowerCase()} ${result.display}.`

  const rows: readonly {
    readonly line: CalculationLine
    readonly mark: string
    readonly share: number
  }[] = [
    { line: start, mark: 'bg-data-reference', share: 1 },
    ...deductions.map((line) => ({
      line,
      mark: 'bg-data-muted',
      share: drawable ? exactToApproxNumber(line.amount) / scale : 0,
    })),
    {
      line: result,
      mark: 'bg-data-primary',
      share: drawable ? resultValue / scale : 0,
    },
  ]

  return (
    <ChartFrame
      title="Where the front gross came from"
      caption="Sale price, the three costs taken out of it, and what is left. Each length is that amount's share of the sale price."
      summary={summary}
      summaryMode="sr-only"
      headingLevel={4}
      className={className}
    >
      <ul className="flex flex-col gap-1.5">
        {rows.map(({ line, mark, share }) => (
          <li key={line.label} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span aria-hidden="true" className="w-3 shrink-0 text-ink-faint">
                  {line.operator}
                </span>
                <span
                  className={cx(
                    'truncate text-xs',
                    line.isResult === true ? 'font-medium text-ink' : 'text-ink-secondary'
                  )}
                >
                  {line.label}
                </span>
              </span>
              <span
                className={cx(
                  'numeric shrink-0 text-sm',
                  line.isResult === true ? 'font-semibold text-ink' : 'text-ink'
                )}
              >
                {line.display}
              </span>
            </p>
            {drawable ? (
              <span
                aria-hidden="true"
                className="block h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
              >
                <span
                  className={`block h-full rounded-pill ${mark}`}
                  style={{ width: percent(Math.max(share, 0)) }}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {drawable ? null : (
        <p className="text-xs leading-normal text-ink-muted">
          The costs on this deal exceed its sale price, so the front gross is a signed
          amount rather than a remaining share and no lengths are drawn. A negative front
          is a real dealership outcome: it is shown with its sign and never suppressed.
        </p>
      )}

      {/*
        NO TABLE DISCLOSURE ON THIS FIGURE, AND THAT IS NOT AN OMISSION. Every other chart in
        the console carries one because its values live only in a bar's length. Here they do
        not: each row prints its operator, its label and its exact amount as text beside the
        bar, and the section that renders this ladder carries the same five lines again as the
        `<dl>` the deal-jacket spec requires, inside its verification disclosure. A third copy
        would put the same amount on the page three times.
      */}
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* The back-end composition                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Finance reserve against original product gross, as one part-to-whole bar.
 *
 * THE IDENTITY IS `DASH.7`'s AND IS NOT RESTATED HERE. Reserve plus ORIGINAL product gross is
 * back-end gross, on the deal-date basis. `UX.2B` §22 forbids substituting net product gross,
 * and this component cannot: it is handed `reserveExact`, `originalProductGrossExact` and
 * `backEndGrossExact`, and `deal-jacket.ts` records above those fields why the retained figure
 * may not be drawn into this bar.
 *
 * ADJUSTMENTS ARE SEPARATE, BELOW, WITH THEIR OWN DATE. Retained gross as of the export date
 * is a different question on a different basis, and the section that answers it says so.
 *
 * THE TWO FILLS ARE THE CATEGORICAL PAIR, never the positive/negative pair: reserve is not the
 * good half of a finance office's month.
 */
export function BackEndComposition({
  jacket,
  children,
  className,
}: {
  readonly jacket: DealJacket
  /** The retained-basis context, rendered under the bar by the section that owns it. */
  readonly children?: ReactNode
  readonly className?: string
}) {
  const { backGross } = jacket
  const total = exactToApproxNumber(backGross.backEndGrossExact)
  const segments = [
    {
      key: 'reserve',
      label: 'Finance reserve',
      value: exactToApproxNumber(backGross.reserveExact),
      display: backGross.reserve,
      mark: 'bg-data-primary',
    },
    {
      key: 'product',
      label: 'Original product gross',
      value: exactToApproxNumber(backGross.originalProductGrossExact),
      display: backGross.originalProductGross,
      mark: 'bg-data-secondary',
    },
  ]
  const drawable = total > 0 && segments.every((segment) => segment.value >= 0)

  const summary = `${segments.map((segment) => `${segment.label} ${segment.display}`).join(', ')}, giving back-end gross ${backGross.backEndGross} on the deal-date basis.`

  return (
    <ChartFrame
      title="What the finance office made"
      caption="Finance reserve and original product gross, as shares of this deal's back-end gross. Deal-date basis."
      summary={summary}
      summaryMode="sr-only"
      headingLevel={4}
      className={className}
    >
      {drawable ? (
        <div
          aria-hidden="true"
          className="flex h-4 w-full overflow-hidden rounded-pill bg-surface-sunken"
        >
          {segments.map((segment, index) => (
            <div
              key={segment.key}
              className={`h-full ${segment.mark}`}
              style={{
                width: percent(segment.value / total),
                marginRight: index < segments.length - 1 ? '2px' : undefined,
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs leading-normal text-ink-muted">
          This deal&rsquo;s back-end gross is zero or a component is negative, so no share
          is defined. The amounts below carry their signs.
        </p>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {segments.map((segment) => (
          <div key={segment.key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="flex items-baseline gap-1.5 font-mono text-2xs uppercase tracking-wide text-ink-muted">
              <span
                aria-hidden="true"
                className={`inline-block size-2.5 shrink-0 translate-y-px rounded-xs ${segment.mark}`}
              />
              {segment.label}
            </dt>
            <dd className="numeric text-sm font-semibold text-ink">{segment.display}</dd>
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="font-mono text-2xs uppercase tracking-wide text-ink-muted">
            Back-end gross
          </dt>
          <dd className="numeric text-sm font-semibold text-ink">
            {backGross.backEndGross}
          </dd>
        </div>
      </dl>

      {children}
    </ChartFrame>
  )
}
