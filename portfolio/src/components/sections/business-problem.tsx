/**
 * The business problem, presented as a fragmentation diagram.
 *
 * Server component - the diagram is static SVG and the copy is static text, so
 * there is nothing here for a client bundle to do.
 *
 * The copy is executive-readable on purpose: a general manager reading this
 * section should recognise their own week in it, and a technical reviewer should
 * see that the project starts from an operating problem rather than from a
 * technology choice. Six problems, each one a sentence, each one something that
 * actually happens.
 */
import { Container, Section } from '@/components/ui/layout'
import { Card } from '@/components/ui/card-static'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { Reveal, RevealGroup } from '@/components/motion/reveal'
import { cx } from '@/lib/utils'

interface Fragment {
  readonly system: string
  readonly problem: string
  readonly consequence: string
}

/**
 * Condensed from README.md "The business problem" and ARCHITECTURE.md section 4.
 * Each row names a real system and a real failure, not a generic "silos" claim.
 */
const FRAGMENTS: readonly Fragment[] = [
  {
    system: 'DMS',
    problem: 'Deal-level gross lives in the accounting system on its own schedule.',
    consequence:
      'Volume, mix and discounting effects cannot be separated, so "gross is down" has no cause attached to it.',
  },
  {
    system: 'CRM',
    problem: 'Funnel stages are defined by whoever configured the CRM.',
    consequence:
      'Stage counts do not reconcile to closed deals, so nobody can say where a lead was actually lost.',
  },
  {
    system: 'Inventory',
    problem: 'Age, market position and markdown history sit in separate reports.',
    consequence:
      'Capital at risk is discovered at month end rather than while there is still time to act.',
  },
  {
    system: 'Marketing',
    problem: 'Spend and attributed gross are never in the same report.',
    consequence:
      'A source can look productive on lead volume while losing money on every deal it sends.',
  },
  {
    system: 'Definitions',
    problem: 'Three systems each hold their own version of "a used unit".',
    consequence:
      'Two managers quote different numbers for the same month and both are correct in their own tool.',
  },
  {
    system: 'Timing',
    problem: 'Each system reports on its own cycle.',
    consequence:
      'A decision waits on a reconciliation that happens after the month it would have changed.',
  },
]

export function BusinessProblem() {
  return (
    <Section id="business-problem" bordered>
      <Container width="wide">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal className="flex flex-col gap-5 lg:col-span-5">
            <Eyebrow>The problem</Eyebrow>
            <Heading level={2}>
              A general manager asks a straightforward question and cannot get a
              straightforward answer.
            </Heading>
            <Text size="body" className="max-w-prose">
              Dealership data is fragmented across DMS, CRM, inventory, marketing, F&amp;I
              and service systems. Each one reports its own version of the truth, on its
              own schedule, using its own definitions.
            </Text>
            <Text size="body" tone="muted" className="max-w-prose">
              The questions that go unanswered are the expensive ones. Not because the
              data does not exist, but because no single place defines what the numbers
              mean.
            </Text>

            <FragmentationDiagram className="mt-2" />
          </Reveal>

          <RevealGroup as="ul" className="flex flex-col gap-3 lg:col-span-7">
            {FRAGMENTS.map((fragment) => (
              <Reveal key={fragment.system} as="li" child>
                <Card
                  padding="sm"
                  className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-5"
                >
                  <span className="shrink-0 font-mono text-2xs tracking-wide text-accent sm:w-24 sm:pt-1">
                    {fragment.system.toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="text-base font-semibold text-ink">{fragment.problem}</p>
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {fragment.consequence}
                    </p>
                  </div>
                </Card>
              </Reveal>
            ))}
          </RevealGroup>
        </div>
      </Container>
    </Section>
  )
}

/**
 * Six unconnected sources on the left, one governed model on the right.
 *
 * The left half is deliberately drawn as crossing, unaligned strokes and the
 * right half as a single ordered lane. The visual asymmetry IS the argument, and
 * it makes it faster than the paragraph beside it does.
 *
 * Static: no animation, because the diagram's subject is a structural
 * difference rather than a process, and there is nothing to watch happen.
 */
function FragmentationDiagram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 150"
      role="img"
      aria-label="On the left, six source systems with crossing, unaligned connections and no shared definition. On the right, the same six sources resolved through one governed analytical model into a single consistent answer."
      className={cx('w-full max-w-md', className)}
    >
      {/* Left: fragmentation. Strokes cross and terminate at different depths. */}
      <g stroke="var(--color-line-strong)" strokeWidth="1" fill="none" opacity="0.85">
        <path d="M24 22 C74 22 60 96 118 62" />
        <path d="M24 48 C80 48 70 20 118 40" />
        <path d="M24 74 C60 74 96 118 118 84" />
        <path d="M24 100 C86 100 62 44 118 52" />
        <path d="M24 126 C70 126 100 74 118 98" />
        <path d="M24 22 C56 22 44 128 118 118" />
      </g>
      <g fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.2">
        {[22, 48, 74, 100, 126].map((y) => (
          <rect key={y} x="12" y={y - 6} width="12" height="12" rx="2.5" />
        ))}
      </g>
      <text
        x="18"
        y="146"
        fill="var(--color-ink-faint)"
        className="font-mono"
        fontSize="7.5"
        letterSpacing="0.5"
      >
        SOURCE SYSTEMS
      </text>

      {/* The governed model: a single gate the sources must pass through. */}
      <rect
        x="150"
        y="52"
        width="16"
        height="46"
        rx="4"
        fill="var(--color-accent-wash)"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
      />
      <text
        x="158"
        y="112"
        textAnchor="middle"
        fill="var(--color-accent)"
        className="font-mono"
        fontSize="7.5"
        letterSpacing="0.5"
      >
        GOVERNED
      </text>
      <text
        x="158"
        y="122"
        textAnchor="middle"
        fill="var(--color-accent)"
        className="font-mono"
        fontSize="7.5"
        letterSpacing="0.5"
      >
        MODEL
      </text>

      {/* Right: one ordered lane, evenly spaced, arriving at one answer. */}
      <g stroke="var(--color-accent)" strokeWidth="1.2" fill="none" opacity="0.75">
        <path d="M166 75 H236" />
        <path d="M236 75 H256 M236 62 H256 M236 88 H256" />
        <path d="M236 62 V88" />
      </g>
      <g fill="var(--color-accent-wash)" stroke="var(--color-accent)" strokeWidth="1.2">
        <rect x="256" y="56" width="60" height="12" rx="3" />
        <rect x="256" y="69" width="60" height="12" rx="3" />
        <rect x="256" y="82" width="60" height="12" rx="3" />
      </g>
      <circle
        cx="352"
        cy="75"
        r="11"
        fill="var(--color-accent-wash)"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
      />
      <circle cx="352" cy="75" r="3.4" fill="var(--color-accent)" />
      <path
        d="M316 62 C336 62 336 74 341 75 M316 75 H341 M316 88 C336 88 336 76 341 75"
        stroke="var(--color-accent)"
        strokeWidth="1.2"
        fill="none"
        opacity="0.75"
      />
      <text
        x="352"
        y="104"
        textAnchor="middle"
        fill="var(--color-accent)"
        className="font-mono"
        fontSize="7.5"
        letterSpacing="0.5"
      >
        ONE ANSWER
      </text>
    </svg>
  )
}
