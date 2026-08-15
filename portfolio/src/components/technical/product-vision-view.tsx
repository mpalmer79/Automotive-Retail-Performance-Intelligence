import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { LaneFlow, type Lane } from '@/components/visuals/flow'

/**
 * The product vision, labelled as one on the page and not only in this comment.
 *
 * THE RISK THIS VIEW CARRIES, AND HOW IT IS HELD
 * ----------------------------------------------
 * A page describing what a platform WOULD do with authorized dealership system
 * access is one paragraph away from reading as a page describing what it DOES.
 * Three things hold it:
 *
 *   1. Every integration is in the conditional and is grouped under a heading
 *      that says none of it exists.
 *   2. The status badge is `pending-external`, which is the same badge the site
 *      uses for the semantic-model validation that has genuinely not run.
 *   3. `tests/e2e/content-integrity.spec.ts` asserts the disclaimer sentence is
 *      present on this view, so it cannot be edited away without failing.
 *
 * The full document is `docs/product/PRODUCT_VISION.md`; this is the reader-facing
 * summary of it, and the gap analysis it depends on is
 * `docs/product/PRODUCT_GAPS.md`.
 */
/**
 * The two lanes: what this repository runs, and what it only describes.
 *
 * Every stage of the second lane carries the word "not built" or "would require",
 * because `tone: 'conceptual'` is a dashed border and a dashed border is a
 * treatment. The rule this file has held since it was written is that no
 * integration on this view may be legible as a capability, and a diagram is the
 * easiest place on a page to break it.
 */
const VISION_LANES: readonly Lane[] = [
  {
    title: 'Implemented today',
    state: 'In this repository',
    tone: 'default',
    stages: [
      { label: 'Seeded synthetic generation', detail: 'Deterministic, documented' },
      { label: 'Governed warehouse and KPI layer', detail: 'Grain and denominators' },
      { label: 'Operating console with drill-through', detail: 'What you are reading' },
    ],
    boundary:
      'Every figure anywhere on this site is produced from synthetic data generated inside this repository.',
  },
  {
    title: 'Production vision',
    state: 'Design position',
    tone: 'conceptual',
    stages: [
      {
        label: 'Authorized system access',
        detail: 'DMS, CRM, F&I, accounting, marketing',
        tone: 'conceptual',
        state: 'No connection exists',
      },
      {
        label: 'Conformed ingestion',
        detail: 'Store, date, vehicle, employee, lead keys',
        tone: 'conceptual',
        state: 'Not built',
      },
      {
        label: 'The same governed layer',
        detail: 'Unchanged: that is the argument',
        tone: 'conceptual',
        state: 'Would require authorization',
      },
    ],
    boundary:
      'Nothing in this lane is being built, and no dealer group has authorized any of it. It is what the work would look like, not what it does.',
  },
]

export function ProductVisionView() {
  return (
    <>
      <TechnicalViewMeta>
        <StatusBadge
          status="pending-external"
          label="Vision, not implemented"
          size="sm"
        />
        <SourceLink path="docs/product/PRODUCT_VISION.md" field="product vision" />
        <SourceLink path="docs/product/PRODUCT_GAPS.md" field="gap analysis" />
      </TechnicalViewMeta>

      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <div className="flex max-w-prose flex-col gap-3 rounded-xl border border-pending/40 bg-surface-sunken/50 p-5">
            <p className="text-sm font-semibold text-ink">
              Nothing on this page is implemented.
            </p>
            <Text size="sm" tone="muted">
              ARPI has no connection to any dealer management system, CRM, F&amp;I
              contracting platform, accounting system, inventory tool or marketing
              platform. Everything below is a design position rather than a capability.
            </Text>
          </div>

          {/* THE TWO STATES, DRAWN APART.
              `UX.3` §S asks a reader to know within seconds what exists and what
              is conceptual. The paragraph above says it and the lanes show it:
              the conceptual lane is dashed, its stages carry the word rather than
              only the treatment, and no stage of it is drawn like a stage of the
              lane that runs today. */}
          <LaneFlow
            className="pt-8"
            label="What runs today against what a production deployment would add"
            lanes={VISION_LANES}
          />
        </Container>
      </Section>

      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <SectionHeader
            eyebrow="Position"
            title="What ARPI would sit above, and what it would never replace"
            layout="wide"
            lede="The value of a management intelligence layer is that it is not any of the systems beneath it. It has no transaction to protect, no contract to produce and no book to close, which is exactly why it can hold one consistent view across all of them."
          />
          <div className="grid gap-8 pt-8 lg:grid-cols-2">
            <Panel
              heading="Stays the system of record"
              rows={[
                [
                  'Dealer management system',
                  'The transaction, the deal file, the stock record and the journal. ARPI reads; it never writes a deal.',
                ],
                [
                  'Customer relationship management',
                  'Customer ownership, task assignment and the working queue. ARPI reports on outcomes; it does not manage a follow-up.',
                ],
                [
                  'F&I contracting platforms',
                  'The product contract, the lender decision and the funding package. ARPI reports the economics of what was contracted.',
                ],
                [
                  'Accounting',
                  'The general ledger is the book of record. ARPI reconciles against it and does not restate it.',
                ],
                [
                  'Marketing platforms',
                  'Campaign delivery, spend and channel operations. ARPI reads spend and attributed outcomes.',
                ],
              ]}
            />
            <Panel
              heading="Would become ARPI's job"
              rows={[
                [
                  'One conformed operating view',
                  'Store, date, vehicle, employee and lead keys conformed once, so a store means the same store in every domain.',
                ],
                [
                  'One governed metric layer',
                  'Every ratio with its numerator, denominator, grain, date basis and eligibility rule published as a contract rather than rebuilt per report.',
                ],
                [
                  'Reconciliation as a control',
                  'Subledger against ledger, funnel against deliveries, product production against contract counts — proved on every run.',
                ],
                [
                  'Management drill-through',
                  'A figure to the transactions behind it, in one motion, without leaving the operating view.',
                ],
                [
                  'A defensible denominator',
                  'Penetration on eligible deals, response on contactable leads, per-unit gross on retail units, and a minimum sample below which a comparative figure is withheld.',
                ],
              ]}
            />
          </div>
        </Container>
      </Section>

      <Section rhythm="tight" tone="evidence">
        <Container width="wide">
          <SectionHeader
            eyebrow="If a dealer group authorized it"
            title="The sources a production deployment would read"
            layout="wide"
            lede="Listed so the shape of the work is legible. None of these connections exists, and none is being built."
          />
          <ul className="grid gap-x-8 gap-y-4 pt-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [
                'Dealer management system',
                'Deals, deliveries, stock, costs, and the accounting the store actually posts.',
              ],
              [
                'Customer relationship management',
                'Leads, assignment, activity, appointments and their outcomes.',
              ],
              [
                'Inventory management',
                'Acquisition, reconditioning, pricing history and market position.',
              ],
              [
                'Digital retail',
                'Online deal progression and the handoff into the store.',
              ],
              [
                'F&I contracting',
                'Product contracts, lender terms, reserve, cancellations and chargebacks.',
              ],
              [
                'Accounting',
                'Control accounts, schedules and the department statement structure.',
              ],
              ['Lead providers', 'Third-party lead delivery, cost and validity.'],
              ['Marketing platforms', 'Spend, channel and campaign delivery.'],
              [
                'Manufacturer systems',
                'Allocation, incentives, receivables and program attainment.',
              ],
            ].map(([name, detail]) => (
              <li key={name} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-ink">{name}</span>
                <Text size="xs" tone="faint">
                  {detail}
                </Text>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <SectionHeader
            eyebrow="Honest limits"
            title="What ARPI is not, today"
            layout="wide"
            lede="Stated here rather than discovered by a reader who expected it. The full analysis, question by question and persona by persona, is the gap document."
          />
          <div className="grid gap-6 pt-8 md:grid-cols-2">
            <Claim
              heading="Not a general ledger"
              body="The accounting surface reconciles an inventory subledger against selected control accounts. There is no trial balance, no journal activity, no department statement and no month-end close."
            />
            <Claim
              heading="Not a financial statement system"
              body="Operating profit, controllable expense, cash, receivables, contracts in transit, floorplan interest and factory receivables are not modelled. No figure on this site can be read as dealership profitability."
            />
            <Claim
              heading="Not a service or parts platform"
              body="Service visits, repair orders, technician productivity and parts are declared and deferred. A domain of zeroes would read as poor performance rather than as absent data."
            />
            <Claim
              heading="Not a recommendation engine"
              body="ARPI organizes evidence. It publishes no recommended action, no coaching output and no repricing instruction. A deterministic action queue is a planned increment, not a shipped capability."
            />
          </div>
        </Container>
      </Section>
    </>
  )
}

function Panel({
  heading,
  rows,
}: {
  readonly heading: string
  readonly rows: readonly (readonly string[])[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <dl className="flex flex-col gap-3">
        {rows.map(([term, detail]) => (
          <div key={term} className="flex flex-col gap-0.5 border-t border-line pt-3">
            <dt className="text-sm font-medium text-ink-secondary">{term}</dt>
            <dd className="text-sm leading-normal text-ink-muted">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Claim({ heading, body }: { readonly heading: string; readonly body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <Text size="sm" tone="muted">
        {body}
      </Text>
    </div>
  )
}
