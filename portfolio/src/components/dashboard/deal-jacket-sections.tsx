/**
 * The Deal Jacket's sections.
 *
 * Server components. Every figure arrives resolved and formatted by
 * `lib/dashboard/deal-jacket.ts`; nothing here computes and nothing here decides what
 * a measure means.
 *
 * THE CALCULATION BLOCKS ARE SEMANTIC
 * -----------------------------------
 * `DEAL_JACKET_SPEC.md` §18 requires them to be a `<dl>` or a table rather than
 * positioned `<div>`s, because the relationship between "Acquisition cost" and
 * "$36,202.50" is the content, not the layout. They are `<dl>`s: a term and its
 * amount, in the formula's own order, with the operator as text beside each line.
 *
 * VERIFICATION IS RENDERED, NOT ASSUMED
 * -------------------------------------
 * The verification state comes from the view model, which recomputed the identity
 * from these very components. A failure renders as a failure, in words, with both
 * figures. The corrupted-fixture tests exist to prove this path is reachable.
 */
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type {
  CalculationLine,
  DealJacket,
  IntegrityCheck,
  StaffMember,
  TimelineSection,
  TradeSection,
  Verification,
} from '@/lib/dashboard/deal-jacket'
import { cx } from '@/lib/utils'

import { BridgeChart, GrossComposition } from './visuals'

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

/** A term and its value. The jacket's unit of content. */
function Fact({
  term,
  children,
}: {
  readonly term: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{term}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  )
}

/** The words an absent value renders. Never a blank, never a zero. */
function Absent({ children }: { readonly children: React.ReactNode }) {
  return <span className="text-ink-faint">{children}</span>
}

/**
 * A labelled arithmetic block.
 *
 * A `<dl>`, in the formula's order, with the operator as text. The result line is
 * separated by a rule and carries more weight, because the whole point of the block
 * is that the last line follows from the ones above it.
 */
function Calculation({
  caption,
  lines,
}: {
  readonly caption: string
  readonly lines: readonly CalculationLine[]
}) {
  return (
    <dl
      data-arpi-print="calculation"
      className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-4"
      aria-label={caption}
    >
      {lines.map((line) => (
        <div
          key={line.label}
          className={cx(
            'flex items-baseline justify-between gap-4',
            line.isResult && 'mt-1 border-t border-line pt-2'
          )}
        >
          <dt
            className={cx(
              'flex items-baseline gap-2 text-sm',
              line.isResult ? 'font-semibold text-ink' : 'text-ink-secondary'
            )}
          >
            <span aria-hidden="true" className="w-3 text-ink-faint">
              {line.operator}
            </span>
            {line.label}
          </dt>
          <dd
            className={cx(
              'numeric shrink-0 text-sm',
              line.isResult ? 'font-semibold text-ink' : 'text-ink'
            )}
          >
            {line.display}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The verification sentence, with an icon and a word: never colour alone. */
function VerificationLine({ verification }: { readonly verification: Verification }) {
  return (
    <p
      className={cx(
        'flex items-start gap-2 text-xs',
        verification.verified ? 'text-ink-muted' : 'text-ink'
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {verification.verified ? '✓' : '!'}
      </span>
      <span>
        <span className="font-medium">
          {verification.verified ? 'Verified to the cent. ' : 'Verification failed. '}
        </span>
        {verification.statement}
      </span>
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export function IdentitySection({ jacket }: { readonly jacket: DealJacket }) {
  const { identity } = jacket
  return (
    <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
      <Fact term="Deal">
        <span className="numeric">{identity.saleId}</span>
      </Fact>
      <Fact term="Sale date">{identity.saleDate}</Fact>
      <Fact term="Delivery date">{identity.deliveryDate}</Fact>
      <Fact term="Store">
        {identity.storeName}{' '}
        <span className="numeric text-ink-muted">{identity.storeId}</span>
      </Fact>
      <Fact term="Deal status">
        Finalized
        <Disclosure label="Why only finalized deals appear">
          <Text size="xs" tone="muted">
            A canceled or unwound deal is not a sale, and counting one would overstate
            every volume and gross measure downstream. The warehouse&rsquo;s transaction
            fact holds finalized deals only, so there is no canceled deal for this route
            to show: the absence is the data model working, not a filter applied here.
          </Text>
        </Disclosure>
      </Fact>
      <Fact term="Sale type">
        {identity.saleType}
        {identity.isRetail ? null : (
          <span className="ml-1.5 text-xs text-ink-faint">not a retail unit</span>
        )}
      </Fact>
      <Fact term="Finance structure">
        {identity.financeStructure}
        <span className="ml-1.5 text-xs text-ink-faint">
          derived: {identity.financeStructureBasis}
        </span>
      </Fact>
    </dl>
  )
}

export function VehicleSection({ jacket }: { readonly jacket: DealJacket }) {
  const { vehicle } = jacket
  return (
    <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
      <Fact term="Vehicle">{vehicle.display}</Fact>
      <Fact term="Unit identifier">
        <span className="numeric">{vehicle.vehicleCode}</span>
        <span className="ml-1.5 text-xs text-ink-faint">not a stock number</span>
      </Fact>
      <Fact term="Synthetic VIN">
        <span className="numeric">{vehicle.syntheticVin}</span>
        <Disclosure label="What this identifier is">
          <Text size="xs" tone="muted">
            A machine-generated VIN-style identifier belonging to no real vehicle
            (ADR-0005). It is the right length and shape for a VIN so that the data
            behaves like the real thing, and it decodes to nothing.
          </Text>
        </Disclosure>
      </Fact>
      <Fact term="Condition">{vehicle.conditionType}</Fact>
      <Fact term="Body style">{vehicle.bodyStyle}</Fact>
      <Fact term="Odometer">
        {vehicle.odometerBand}
        <span className="ml-1.5 text-xs text-ink-faint">banded, never exact</span>
      </Fact>
      <Fact term="Inventory source">{vehicle.acquisitionSource}</Fact>
      <Fact term="Acquisition date">
        <Absent>Not modelled</Absent>
        <span className="ml-1.5 text-xs text-ink-faint">
          the model records none; days in stock is what exists
        </span>
      </Fact>
      <Fact term="Days in inventory at sale">
        <span className="numeric">{vehicle.daysInInventory ?? 0}</span> days
      </Fact>
      <Fact term="Original asking price">
        <span className="numeric">{vehicle.originalAsking}</span>
      </Fact>
      <Fact term="Final asking price">
        <span className="numeric">{vehicle.finalAsking}</span>
      </Fact>
      <Fact term="MSRP">
        {vehicle.msrp === null ? (
          <Absent>Not applicable</Absent>
        ) : (
          <span className="numeric">{vehicle.msrp}</span>
        )}
      </Fact>
    </dl>
  )
}

export function FrontGrossSection({ jacket }: { readonly jacket: DealJacket }) {
  const { frontGross } = jacket
  return (
    <div className="flex flex-col gap-4">
      <Calculation caption="Front-end gross calculation" lines={frontGross.lines} />
      <VerificationLine verification={frontGross.verification} />

      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        {frontGross.discounts.map((discount) => (
          <Fact key={discount.label} term={discount.label}>
            {discount.display === null ? (
              <Absent>Not applicable</Absent>
            ) : (
              <span className="numeric">{discount.display}</span>
            )}
            {discount.note ? (
              <span className="ml-1.5 block text-xs text-ink-faint">{discount.note}</span>
            ) : null}
          </Fact>
        ))}
      </dl>

      <Disclosure label="What this figure excludes, and why">
        <Text size="xs" tone="muted">
          Front-end gross is the ARPI definition of <code>KPI-GRS-001</code>: selling
          price less what the unit cost to acquire, recondition and pack. Trade variance
          is <strong>not</strong> part of it and is shown separately below, because
          folding it in would change what the KPI means.
        </Text>
        <Text size="xs" tone="muted" className="pt-2">
          Manufacturer holdback, dealer cash, stair-step money, floorplan credits and
          unposted accounting adjustments are all excluded by the model. They arrive on a
          different cadence than the deal and are not attributable to a single vehicle at
          the time of sale, so including them would make this figure disagree with the
          deal jacket a manager reads. ARPI does not model any of them, and nothing here
          implies it does.
        </Text>
      </Disclosure>
    </div>
  )
}

export function TradeSectionBlock({ trade }: { readonly trade: TradeSection }) {
  if (trade.kind === 'absent') {
    return (
      <div className="rounded-lg border border-line-subtle bg-surface-sunken/50 p-4">
        <Text size="sm" tone="muted">
          Not applicable: no trade on this deal.
        </Text>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        <Fact term="Trade allowance">
          <span className="numeric">{trade.allowance}</span>
        </Fact>
        <Fact term="Trade actual cash value">
          <span className="numeric">{trade.acv}</span>
        </Fact>
        <Fact term="Trade variance">
          <span className="numeric">{trade.variance}</span>
          <span className="ml-1.5 text-xs text-ink-faint">
            {trade.varianceIsPositive
              ? 'allowance above ACV'
              : 'allowance at or below ACV'}
          </span>
        </Fact>
      </dl>
      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        <Fact term="Payoff">
          <Absent>Not modelled</Absent>
        </Fact>
        <Fact term="Equity">
          <Absent>Not modelled</Absent>
        </Fact>
        <Fact term="Trade vehicle and disposition">
          <Absent>Not modelled</Absent>
        </Fact>
      </dl>
      <Text size="xs" tone="faint">
        Trade variance is allowance less actual cash value. It is shown here and is
        deliberately <strong>not</strong> part of the front-gross formula above. Payoff,
        equity and the trade vehicle itself need trade detail the model does not carry;
        they are named as not modelled rather than shown as zero.
      </Text>
    </div>
  )
}

export function FinanceSectionBlock({ jacket }: { readonly jacket: DealJacket }) {
  const { finance, backGross } = jacket
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        <Fact term="Structure">
          {finance.structure}
          <span className="ml-1.5 text-xs text-ink-faint">derived: {finance.basis}</span>
        </Fact>
        <Fact term="Cash down">
          <span className="numeric">{finance.cashDown}</span>
        </Fact>
        <Fact term="Amount financed">
          <span className="numeric">{finance.amountFinanced}</span>
        </Fact>
        <Fact term="Finance reserve">
          <span className="numeric">{finance.financeReserve}</span>
          <span className="ml-1.5 text-xs text-ink-faint">an amount, not a rate</span>
        </Fact>
        <Fact term="Lender">
          {finance.lenderName === null ? (
            <Absent>Not applicable</Absent>
          ) : (
            <>
              {finance.lenderName}
              <span className="ml-1.5 font-mono text-xs text-ink-faint">
                {finance.lenderCode}
              </span>
            </>
          )}
        </Fact>
        <Fact term="Lender category">
          {finance.lenderCategory === null ? (
            <Absent>Not applicable</Absent>
          ) : (
            finance.lenderCategory
          )}
        </Fact>
        <Fact term="Lender program tier">
          {finance.lenderProgramTier === null ? (
            <Absent>Not applicable</Absent>
          ) : (
            <>
              {finance.lenderProgramTier}
              <span className="ml-1.5 text-xs text-ink-faint">
                classifies the lender&rsquo;s program, not the customer
              </span>
            </>
          )}
        </Fact>
        <Fact term="Back-end gross">
          <span className="numeric font-semibold">{backGross.backEndGross}</span>
          <span className="ml-1.5 text-xs text-ink-faint">deal date</span>
        </Fact>
      </dl>
      {finance.lenderAbsence === null ? null : (
        <Text size="xs" tone="muted">
          {finance.lenderAbsence} Every lender in ARPI is fictional; no real institution
          is named anywhere in this project.
        </Text>
      )}
      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        {finance.notModelled.map((entry) => (
          <Fact key={entry.label} term={entry.label}>
            <Absent>
              {entry.reason.startsWith('Not applicable')
                ? 'Not applicable'
                : 'Not modelled'}
            </Absent>
            <span className="mt-0.5 block text-xs text-ink-faint">{entry.reason}</span>
          </Fact>
        ))}
      </dl>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* F&I products                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The deal's F&I product contracts, itemized.
 *
 * TWO REPRESENTATIONS, EXACTLY ONE IN THE ACCESSIBILITY TREE AT A TIME. A table from
 * `md` up and stacked cards below it, which is the pattern the Deal Explorer established:
 * eleven money columns cannot survive 320px, and hiding dealer cost or the adjustment to
 * make them fit would remove the two things a reader came for.
 */
export function ProductSectionBlock({ jacket }: { readonly jacket: DealJacket }) {
  const { products } = jacket

  if (products.contractCount === 0) {
    return (
      <div className="rounded border border-line-subtle bg-surface px-4 py-4">
        <Text size="sm" tone="muted">
          No F&amp;I product was written on this deal. That is a real and common outcome —
          a delivery that carried nothing — and not missing data. The deal&rsquo;s
          back-end gross is finance reserve alone.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Table: md and up */}
      {/*
        `tabIndex={0}` and the region role are an ACCESSIBILITY requirement, not a
        styling choice: a container that scrolls horizontally is unreachable by keyboard
        unless it is focusable, so a keyboard-only reader can see the first four columns
        of this table and never the other four. Caught by axe on the Deal Jacket route.
      */}
      <div
        className="hidden overflow-x-auto md:block"
        tabIndex={0}
        role="region"
        aria-label="F&I product contracts, scrollable"
      >
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">
            F&amp;I product contracts written on this deal, with original and retained
            gross
          </caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Product
              </th>
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Category
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
              <th scope="col" className="py-2 font-medium text-ink-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {products.contracts.map((contract) => (
              <tr key={contract.productSaleId} className="border-b border-line-subtle">
                <th scope="row" className="py-2 text-left font-normal">
                  {contract.productName}
                  <span className="block text-xs text-ink-faint">
                    {contract.provider} · {contract.contractTermMonths}-month coverage
                  </span>
                </th>
                <td className="py-2 text-xs">
                  {contract.category}
                  <span className="block font-mono text-[0.6875rem] text-ink-faint">
                    {contract.eligibilityRuleId}
                  </span>
                </td>
                <td className="numeric py-2 text-right">{contract.retailPrice}</td>
                <td className="numeric py-2 text-right">{contract.dealerCost}</td>
                <td className="numeric py-2 text-right">{contract.originalGross}</td>
                <td className="numeric py-2 text-right">
                  {contract.adjustmentEvents === 0 ? (
                    <span className="text-ink-faint">None</span>
                  ) : (
                    contract.adjustmentTotal
                  )}
                </td>
                <td className="numeric py-2 text-right">{contract.netGross}</td>
                <td className="py-2 text-xs">
                  {contract.status}
                  {contract.netVerified ? null : (
                    <span className="block text-xs text-warning">
                      Net does not recompute
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <th scope="row" colSpan={4} className="py-2 text-left">
                {products.contractCount} contract{products.contractCount === 1 ? '' : 's'}
              </th>
              <td className="numeric py-2 text-right">{products.originalGrossTotal}</td>
              <td className="numeric py-2 text-right">{products.adjustmentTotal}</td>
              <td className="numeric py-2 text-right">{products.netGrossTotal}</td>
              <td className="py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cards: below md */}
      <ul className="flex flex-col gap-3 md:hidden">
        {products.contracts.map((contract) => (
          <li
            key={contract.productSaleId}
            className="rounded border border-line-subtle bg-surface p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium text-ink">{contract.productName}</span>
              <span className="text-xs text-ink-faint">
                {contract.category} · {contract.provider} · {contract.eligibilityRuleId}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-xs text-ink-muted">Retail</dt>
              <dd className="numeric text-right">{contract.retailPrice}</dd>
              <dt className="text-xs text-ink-muted">Dealer cost</dt>
              <dd className="numeric text-right">{contract.dealerCost}</dd>
              <dt className="text-xs text-ink-muted">Original gross</dt>
              <dd className="numeric text-right">{contract.originalGross}</dd>
              <dt className="text-xs text-ink-muted">Adjustments</dt>
              <dd className="numeric text-right">
                {contract.adjustmentEvents === 0 ? 'None' : contract.adjustmentTotal}
              </dd>
              <dt className="text-xs text-ink-muted">Net gross</dt>
              <dd className="numeric text-right font-medium">{contract.netGross}</dd>
              <dt className="text-xs text-ink-muted">Status</dt>
              <dd className="text-right text-xs">{contract.status}</dd>
            </dl>
          </li>
        ))}
      </ul>

      <Text size="xs" tone="faint">
        Every product and administrator named here is fictional, and every price is
        synthetic.
      </Text>

      <Disclosure label="What original and net each mean">
        <Text size="xs" tone="muted">
          Original gross is what the contract was written for, on the day of the deal. Net
          gross is what remained as at {products.asOfDate} after every adjustment posted
          on or before that date. Status is derived from each contract&rsquo;s own event
          history and never from today&rsquo;s date.
        </Text>
      </Disclosure>

      {products.reconcilesToDealRow ? null : (
        <Text size="xs" tone="muted">
          <strong className="font-medium text-ink">
            Itemization does not reconcile.
          </strong>{' '}
          The contracts above sum to {products.originalGrossTotal}, which does not equal
          the deal row&rsquo;s own product total. Both figures are shown as exported
          rather than adjusted to agree.
        </Text>
      )}
    </div>
  )
}

/**
 * The back-end gross decomposition, recomputed on this page.
 *
 * The identity uses ORIGINAL product gross. A cancellation is supposed to make retained
 * gross differ from produced gross, so substituting the retained figure would make this
 * check fail on every adjusted deal and report a defect that is correct behaviour.
 */
export function BackGrossSectionBlock({ jacket }: { readonly jacket: DealJacket }) {
  const { backGross } = jacket
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Deal-date back-end gross, decomposed into finance reserve and product gross
        </caption>
        <tbody>
          <tr className="border-b border-line-subtle">
            <th scope="row" className="py-2 text-left font-normal">
              Finance reserve
            </th>
            <td className="numeric py-2 text-right">{backGross.reserve}</td>
          </tr>
          <tr className="border-b border-line-subtle">
            <th scope="row" className="py-2 text-left font-normal">
              <span className="mr-1 text-ink-faint">+</span> Original product gross
            </th>
            <td className="numeric py-2 text-right">{backGross.originalProductGross}</td>
          </tr>
          <tr className="border-b border-line-subtle text-ink-muted">
            <th scope="row" className="py-2 text-left font-normal">
              <span className="mr-1 text-ink-faint">+</span> Other F&amp;I income
            </th>
            <td className="numeric py-2 text-right">{backGross.otherFiIncome}</td>
          </tr>
          <tr className="font-medium">
            <th scope="row" className="py-2 text-left">
              <span className="mr-1 text-ink-faint">=</span> Back-end gross
            </th>
            <td className="numeric py-2 text-right">{backGross.backEndGross}</td>
          </tr>
        </tbody>
      </table>

      <div
        className={cx(
          'rounded border px-3 py-2 text-sm',
          backGross.verified
            ? 'border-line-subtle bg-surface text-ink-muted'
            : 'border-warning bg-warning/10 text-ink'
        )}
      >
        {backGross.verified ? (
          <>
            <strong className="font-medium text-ink">Reconciled to the cent.</strong>{' '}
            Finance reserve plus original product gross equals this deal&rsquo;s back-end
            gross exactly, with other F&amp;I income of $0.00 and no balancing figure.
            Recomputed here from the components above.
          </>
        ) : (
          <>
            <strong className="font-medium">Back-end gross does not reconcile.</strong>{' '}
            The components leave {backGross.residual} unexplained. The exported figures
            are shown unchanged rather than adjusted to agree.
          </>
        )}
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">
          Produced and retained F&amp;I gross on this deal
        </caption>
        <tbody>
          <tr className="border-b border-line-subtle text-ink-muted">
            <th scope="row" className="py-2 text-left font-normal">
              Cumulative product adjustments through {backGross.asOfDate}
            </th>
            <td className="numeric py-2 text-right">{backGross.cumulativeAdjustments}</td>
          </tr>
          <tr>
            <th scope="row" className="py-2 text-left font-normal">
              Retained F&amp;I gross as of {backGross.asOfDate}
            </th>
            <td className="numeric py-2 text-right font-medium">
              {backGross.retainedFiGross}
            </td>
          </tr>
        </tbody>
      </table>

      <Text size="xs" tone="muted">
        Back-end gross is the deal-date figure and is never rewritten when an adjustment
        posts later. Retained F&amp;I gross answers a different question — what the store
        still has — and a difference between the two is expected wherever adjustments
        posted, not an error in either.
      </Text>
    </div>
  )
}

export function TotalGrossSection({ jacket }: { readonly jacket: DealJacket }) {
  return (
    <div className="flex flex-col gap-4">
      <Calculation caption="Total gross calculation" lines={jacket.totalGross.lines} />
      <VerificationLine verification={jacket.totalGross.verification} />
    </div>
  )
}

export function StaffSection({ staff }: { readonly staff: readonly StaffMember[] }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3">
        {staff.map((member) => (
          <Fact key={member.role} term={member.role}>
            {member.code === null ? (
              <Absent>
                {member.absence === 'not-applicable' ? 'Not applicable' : 'Unattributed'}
              </Absent>
            ) : (
              <>
                <span className="numeric">{member.code}</span>
                {member.jobRole ? (
                  <span className="ml-1.5 text-xs text-ink-faint">{member.jobRole}</span>
                ) : null}
              </>
            )}
          </Fact>
        ))}
      </dl>
      <Text size="xs" tone="faint">
        Synthetic employee identifiers only. No name exists anywhere in ARPI, for any
        employee, by design: a fabricated name invites confusion with real staff and adds
        nothing to any measure. &ldquo;Unattributed&rdquo; means the role could have been
        filled and was not; &ldquo;Not applicable&rdquo; means this deal type has no such
        role.
      </Text>
    </div>
  )
}

export function TimelineSectionBlock({
  timeline,
}: {
  readonly timeline: TimelineSection
}) {
  if (timeline.kind === 'unlinked') {
    return (
      <div className="rounded-lg border border-line-subtle bg-surface-sunken/50 p-4">
        <Text size="sm" tone="muted">
          {timeline.statement}
        </Text>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <Text size="sm" tone="muted">
        Source: {timeline.source}
      </Text>
      {/* An ordered list, because the order is the content (spec §18). */}
      <ol className="flex flex-col gap-2">
        {timeline.stages.map((stage, position) => (
          <li
            key={`${stage.label}-${String(position)}`}
            className="flex items-baseline justify-between gap-4 border-b border-line-subtle/60 pb-2 last:border-0"
          >
            <span className="text-sm text-ink-secondary">{stage.label}</span>
            <span className="numeric shrink-0 text-sm text-ink">
              {stage.kind === 'dated' ? (
                stage.date
              ) : stage.kind === 'elapsed' ? (
                stage.display
              ) : stage.happened ? (
                'Yes'
              ) : (
                <Absent>No</Absent>
              )}
            </span>
          </li>
        ))}
      </ol>
      <Text size="xs" tone="faint">
        No message, note, email, phone number or free-form CRM text exists in the model:
        it records that a lead was contacted, not what was said.
      </Text>
    </div>
  )
}

export function ChecksSection({
  checks,
  needingReview,
}: {
  readonly checks: readonly IntegrityCheck[]
  readonly needingReview: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {checks.map((check) => (
          <li
            key={check.id}
            className="flex items-start gap-3 border-b border-line-subtle/60 pb-2 last:border-0"
          >
            {/* Icon AND word. Never colour alone. */}
            <span aria-hidden="true" className="shrink-0 text-sm">
              {check.state === 'passed' ? '✓' : check.state === 'review' ? '!' : '·'}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-ink">
                {check.label}
                <span className="ml-2 text-xs uppercase tracking-wide text-ink-muted">
                  {check.state === 'passed'
                    ? 'passed'
                    : check.state === 'review'
                      ? 'needs review'
                      : 'note'}
                </span>
              </span>
              <span className="text-xs text-ink-faint">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <Text size="xs" tone="faint">
        {needingReview === 0
          ? 'All checks passed.'
          : `${String(needingReview)} check${needingReview === 1 ? '' : 's'} need review.`}{' '}
        Eight checks, each recomputing something from the figures on this page rather than
        reading a stored flag.
      </Text>
      <Disclosure label="Why three of these were once absent">
        <Text size="xs" tone="muted">
          Back-gross reconciliation, product eligibility and product-adjustment validity
          were named as absent through{' '}
          <code className="font-mono text-[0.6875rem]">DASH.4</code> because the F&amp;I
          model had no surface here. A check that cannot fail is not a check. They are
          real now, and each can fail.
        </Text>
      </Disclosure>
    </div>
  )
}

export function LineageSection({ jacket }: { readonly jacket: DealJacket }) {
  const { lineage } = jacket
  return (
    <Disclosure label="Where every figure on this page came from">
      <dl className="grid gap-3 pt-2 @sm:grid-cols-2">
        <Fact term="Source reporting view">
          {lineage.sourceView === null ? (
            <Absent>Not published by this export&rsquo;s manifest</Absent>
          ) : (
            <span className="numeric">{lineage.sourceView}</span>
          )}
        </Fact>
        <Fact term="Source grain">One row per finalized vehicle transaction</Fact>
        <Fact term="Date basis">Sale date</Fact>
        <Fact term="Export dataset">
          <span className="numeric">{lineage.datasetName}</span>
        </Fact>
        <Fact term="Dataset version">
          <span className="numeric">{lineage.datasetVersion}</span>
        </Fact>
        <Fact term="Contract fingerprint">
          <span className="numeric">{lineage.contractFingerprint}</span>
        </Fact>
        <Fact term="Data as of">{lineage.asOfDate}</Fact>
        <Fact term="KPIs this deal feeds">
          <span className="numeric">{lineage.kpiIds.join(', ')}</span>
        </Fact>
      </dl>
      <div className="pt-3">
        <Text size="xs" tone="muted" className="font-medium">
          Known limitations
        </Text>
        <ul className="flex list-disc flex-col gap-1 pl-4 pt-1">
          {lineage.limitations.map((limitation) => (
            <li key={limitation} className="text-xs text-ink-faint">
              {limitation}
            </li>
          ))}
        </ul>
      </div>
    </Disclosure>
  )
}

/* -------------------------------------------------------------------------- */
/* UX.2B — the deal-review record                                              */
/* -------------------------------------------------------------------------- */

/**
 * The five figures a desk reads first.
 *
 * WHAT REPLACED WHAT. `UX.1` opened this route with a header, a synthetic disclosure, an
 * eight-fact identity grid and then a two-column layout whose right column began with the
 * front-gross ARITHMETIC — a `<dl>` of five operator lines and a verification sentence.
 * That is the correct thing to have on the page and the wrong thing to open it with: a
 * manager pulling a deal jacket asks what the deal made before they ask how the figure was
 * derived, and `UX.2B` §5 says so outright — do not visually prioritize formula proof over
 * the transaction.
 *
 * NOTHING WAS RECOMPUTED TO BUILD THIS. Every figure here is a line the view model had
 * already resolved and formatted: the sale price and the front-gross result are the first
 * and last lines of the front-gross calculation, back gross and total gross are the
 * published figures the same calculations verify against, and days in stock is the vehicle
 * row's own column. The arithmetic that produces them is one disclosure away and is
 * unchanged, still recomputed from the components, still verified, still rendered as words
 * when it fails.
 */
export function DealEconomicsRail({
  jacket,
  daysInStock,
}: {
  readonly jacket: DealJacket
  readonly daysInStock: string
}) {
  const salePrice = jacket.frontGross.lines[0]
  const frontResult = jacket.frontGross.lines.find((line) => line.isResult === true)
  const cells: readonly {
    id: string
    label: string
    value: string
    note?: string
  }[] = [
    {
      id: 'sale-price',
      label: 'Sale price',
      value: salePrice?.display ?? 'Not published',
    },
    {
      id: 'front-gross',
      label: 'Front gross',
      value: frontResult?.display ?? 'Not published',
      note: 'Trade variance is deliberately outside it',
    },
    {
      id: 'back-gross',
      label: 'Back gross',
      value: jacket.backGross.backEndGross,
      note: 'Reserve plus original product gross',
    },
    {
      id: 'total-gross',
      label: 'Total gross',
      value:
        jacket.totalGross.lines.find((line) => line.isResult === true)?.display ??
        'Not published',
    },
    { id: 'days-in-stock', label: 'Days in stock', value: daysInStock },
  ]
  return (
    <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
      {cells.map((cell) => (
        <li
          key={cell.id}
          data-kpi-card={cell.id}
          className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line-subtle bg-surface p-3"
        >
          <h3 className="text-xs leading-snug font-medium text-ink-secondary">
            {cell.label}
          </h3>
          <span className="numeric text-xl font-semibold text-ink">{cell.value}</span>
          {cell.note === undefined ? null : (
            <p className="mt-auto pt-0.5 text-2xs text-ink-faint">{cell.note}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Front-end gross as a waterfall: sale price, the three costs taken out, the result.
 *
 * THE SAME LINES, IN THE SAME ORDER, DRAWN INSTEAD OF LISTED. `UX.2B` §5 asks for a
 * front-gross composition bar — sale price minus acquisition, recon and pack — and the view
 * model already publishes exactly that as `frontGross.lines`, an ordered list of operator
 * lines ending in a result. This maps them onto the waterfall primitive the gross-change
 * bridge uses: the opening line and the result are ANCHORS on the baseline, and each `−`
 * line is a falling step between them.
 *
 * NO ARITHMETIC HAPPENS HERE. The amounts are the exact values the view model resolved and
 * the displays are the strings it formatted; this file decides which of them is an anchor
 * and which is a step, and nothing else. The identity is still recomputed and verified in
 * `deal-jacket.ts`, and the verification sentence is still rendered as words.
 *
 * THE SIGN IS THE ARITHMETIC, NOT A JUDGEMENT. A cost that reduces gross is a falling step
 * and takes the negative fill because it subtracts — the same rule the change bridge
 * follows. Nothing here calls a reconditioning cost bad.
 */
export function FrontGrossWaterfall({ jacket }: { readonly jacket: DealJacket }) {
  const lines = jacket.frontGross.lines
  const bars = lines.map((line, index) => ({
    key: `${line.label}-${String(index)}`,
    label: line.label,
    /* The SIGNED amount, published by the view model. A `−` line carries a positive
       `amount` with a minus operator beside it — how a printed calculation reads — and a
       waterfall step is a signed movement, so the two are different values of the same
       figure. The negation happens in `deal-jacket.ts`, which owns the arithmetic; this
       file chooses which of the two published values a bar is measured from. */
    value: line.signedAmount,
    display: line.display,
    kind: (index === 0 || line.isResult === true ? 'anchor' : 'step') as
      'anchor' | 'step',
  }))
  return (
    <div className="flex flex-col gap-3">
      <BridgeChart
        title="Sale price, less what the unit cost"
        bars={bars}
        summary={jacket.frontGross.verification.statement}
        headingLevel={4}
      />
      <VerificationLine verification={jacket.frontGross.verification} />
    </div>
  )
}

/**
 * Back-end gross as its two components, drawn against the published total.
 *
 * `UX.2B` §5 asks for an F&I composition of reserve plus product gross, and that is exactly
 * the identity `deal-jacket.ts` recomputes and verifies: other F&I income is exactly $0.00
 * and is not a balancing figure. The bar is drawn against the PUBLISHED back-end gross
 * rather than against a sum assembled here, so a component that failed to reconcile would
 * show as a bar that does not fill its track rather than as a bar that always fills it.
 *
 * TWO IDENTITY FILLS. Reserve is not the good half of a deal's back end and product gross
 * is not the bad half.
 */
export function BackGrossComposition({ jacket }: { readonly jacket: DealJacket }) {
  const { reserve, originalProductGross, backEndGross } = jacket.backGross.exact
  return (
    <div className="flex flex-col gap-3">
      <GrossComposition
        title="Reserve and product gross"
        segments={[
          {
            key: 'reserve',
            label: 'Finance reserve',
            value: reserve,
            display: jacket.backGross.reserve,
          },
          {
            key: 'product',
            label: 'Original product gross',
            value: originalProductGross,
            display: jacket.backGross.originalProductGross,
          },
        ]}
        total={backEndGross}
        headingLevel={4}
      />
      <Text size="xs" tone={jacket.backGross.verified ? 'muted' : 'secondary'}>
        {jacket.backGross.verified
          ? `Reconciled to the cent: finance reserve plus original product gross equals the published back-end gross exactly, with other F&I income of ${jacket.backGross.otherFiIncome} and no balancing figure.`
          : `The components do not sum to the published back-end gross. Residual ${jacket.backGross.residual}. Both figures are shown as exported; this state is a defect rather than a rounding artefact.`}
      </Text>
      <Text size="xs" tone="faint">
        {`Retained F&I gross as of ${jacket.backGross.asOfDate} is ${jacket.backGross.retainedFiGross}, after ${jacket.backGross.cumulativeAdjustments} of adjustments posted since the deal date. Produced and retained are different questions and are never shown as one number.`}
      </Text>
    </div>
  )
}
