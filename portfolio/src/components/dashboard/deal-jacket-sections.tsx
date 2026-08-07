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
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          the warehouse records none; days in stock is what exists
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

      <dl className="grid gap-3 sm:grid-cols-3">
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
      <dl className="grid gap-4 sm:grid-cols-3">
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
      <dl className="grid gap-4 sm:grid-cols-3">
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
        equity and the trade vehicle itself need a trade fact the warehouse does not have;
        they are named as not modelled rather than shown as zero.
      </Text>
    </div>
  )
}

export function FinanceSectionBlock({ jacket }: { readonly jacket: DealJacket }) {
  const { finance, backGross } = jacket
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Fact term="Back-end gross">
          <span className="numeric font-semibold">{backGross.display}</span>
          <span className="ml-1.5 text-xs text-ink-faint">aggregate</span>
        </Fact>
      </dl>
      <Text size="xs" tone="muted">
        {backGross.note}
      </Text>
      <dl className="grid gap-3 sm:grid-cols-3">
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
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        Stages come from the lead and appointment facts. No message, note, email, phone
        number or free-form CRM text appears here, because none exists in the model: the
        warehouse records that a lead was contacted, not what was said.
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
        Back-gross reconciliation, product eligibility and product-adjustment validity are
        absent rather than shown as passing: they need the F&amp;I model, and a check that
        cannot fail is not a check.
      </Text>
    </div>
  )
}

export function LineageSection({ jacket }: { readonly jacket: DealJacket }) {
  const { lineage } = jacket
  return (
    <Disclosure label="Where every figure on this page came from">
      <dl className="grid gap-4 pt-2 sm:grid-cols-2">
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
