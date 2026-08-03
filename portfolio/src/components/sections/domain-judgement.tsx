/**
 * Chapter two: the dealership problem, and the person solving it.
 *
 * This is the section the whole portfolio rests on, and in the previous build it
 * was section eight of nine, roughly 7,900 pixels down. That was finding A-02.
 *
 * THE FORM
 * --------
 * Three chapters, each one a horizontal run of three beats:
 *
 *   the question           what a general manager actually asks on a Monday
 *   the fragmented answer  which systems hold pieces of it, and why they disagree
 *   the design decision    what ARPI does about it, and where that lives in the
 *                          repository
 *
 * Not a grid of six identical cards. The previous build had exactly that - six
 * bordered panels of system name, problem, consequence - and a grid says "here
 * are six things" where this needs to say "here is one argument, three times".
 * The beats are separated by rules and arrows rather than by containment, so the
 * eye reads left to right along a line instead of hopping between boxes.
 *
 * WHY THE DECISION COLUMN MATTERS MORE THAN THE PROBLEM COLUMN
 * -----------------------------------------------------------
 * Anyone can describe fragmented dealership data. The third beat is the one that
 * cannot be written by someone who has not done the job: keeping front and back
 * gross apart, refusing to rank a salesperson on volume, leading on median age
 * and keeping the mean as the diagnostic. Each one is a judgement that changed an
 * implementation, and each one names the artefact so a reviewer can check.
 *
 * Server component. No state, no motion beyond the shared reveal.
 */
import { ArrowRight } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { CodeLabel, Text } from '@/components/ui/typography'
import { ROUTES } from '@/lib/site'

interface Judgement {
  readonly ordinal: string
  /** What a manager asks. In their words, not a BI use case. */
  readonly question: string
  /** The systems that each hold a piece of the answer. */
  readonly systems: readonly string[]
  /** Why those systems cannot answer it between them. */
  readonly conflict: string
  /** What ARPI does instead. */
  readonly decision: string
  /** Why that decision needs someone who has worked the floor. */
  readonly judgement: string
  /** Where it lives in the repository. */
  readonly artefact: string
}

/**
 * Three, not six. A fourth would be a fourth variation on the same argument, and
 * the argument is already made by the third.
 */
const JUDGEMENTS: readonly Judgement[] = [
  {
    ordinal: '01',
    question: 'Why is total gross holding while front-end gross is collapsing?',
    systems: ['DMS', 'F&I', 'Inventory', 'Deal timing'],
    conflict:
      'Deal-level gross is booked in accounting on its own schedule, F&I income lands separately, and the two are combined before anyone sees them. By the time the month closes, the only visible number is the total, and the total looks fine.',
    decision:
      'Front-end, back-end and total gross stay separate through the warehouse, the reporting views and the KPI layer. They are never summed early.',
    judgement:
      'A store holding total gross while front gross collapses is in a materially different position from one where both are steady. Combining them destroys the diagnosis, and the diagnosis is the entire reason a general manager opened the report.',
    artefact: 'KPI-GRS-001 / 002 / 003',
  },
  {
    ordinal: '02',
    question: 'Which of my salespeople are actually performing?',
    systems: ['CRM', 'DMS', 'Lead routing', 'Employee records'],
    conflict:
      'The CRM ranks by units. It does not know who received the house leads, who works the busier store, who is four months in, or who is holding gross on every deal they write.',
    decision:
      'Volume alone never ranks a person in this model. The employee measures carry an interpretation caution on the measure itself, not in a document.',
    judgement:
      'A leaderboard built on volume rewards whoever the lead routing favours and punishes whoever is closing hard deals slowly. Publishing one is how a reporting project loses the sales floor in a single week.',
    artefact: 'KPI-SLS-001 interpretation caution',
  },
  {
    ordinal: '03',
    question: 'How much aged inventory am I actually carrying?',
    systems: ['Inventory', 'DMS', 'Markdown history'],
    conflict:
      'Age, market position and markdown history sit in three reports on three cycles, and the headline figure is an average. Capital at risk becomes visible at month end, after the month in which something could have been done about it.',
    decision:
      'Daily snapshots at vehicle, store and day grain. Median age leads and the mean is published beside it, because the gap between them is the finding.',
    judgement:
      'Inventory age is right-skewed. A handful of two-hundred-day units drags the mean up and makes a healthy lot look sick, or hides a bad tail inside a comfortable average. Which one leads is a decision, and getting it wrong sends a manager after the wrong cars.',
    artefact: 'KPI-INV-003 and KPI-INV-004',
  },
]

export function DomainJudgement() {
  return (
    <Section id="domain-judgement" tone="canvas">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The problem, and the difference"
          title="Dealership data is not missing. It disagrees with itself."
          lede="Most analytics portfolios are built by someone who learned the business from a dataset. This one is the other way round, and the difference shows up in the small decisions rather than in the architecture diagram."
        />

        <ol className="mt-14 flex flex-col gap-14 lg:gap-20">
          {JUDGEMENTS.map((item) => (
            <Reveal key={item.ordinal} as="li">
              <article className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
                {/* Beat one: the question. */}
                <div className="flex flex-col gap-4 lg:col-span-4">
                  <div className="flex items-baseline gap-3">
                    <span className="numeric font-mono text-2xs tracking-wide text-accent">
                      {item.ordinal}
                    </span>
                    <span className="eyebrow text-2xs">A manager asks</span>
                  </div>
                  <h3 className="font-display text-xl leading-snug font-semibold text-balance text-ink">
                    {item.question}
                  </h3>
                </div>

                {/* Beat two: the fragmented answer. Sunken, because it is the
                    state of things rather than the work. */}
                <div className="flex flex-col gap-4 border-l border-line pl-6 lg:col-span-4 lg:pl-8">
                  <span className="eyebrow text-2xs">Four systems, no answer</span>
                  <ul className="flex flex-wrap gap-1.5">
                    {item.systems.map((system) => (
                      <li
                        key={system}
                        className="rounded-sm border border-line bg-surface-sunken/80 px-2 py-1 font-mono text-2xs text-ink-faint"
                      >
                        {system}
                      </li>
                    ))}
                  </ul>
                  <Text size="sm" tone="muted">
                    {item.conflict}
                  </Text>
                </div>

                {/* Beat three: the decision. The only beat with a surface, so
                    the eye lands on it. */}
                <div className="flex flex-col gap-4 rounded-xl border border-accent-muted/35 bg-accent-wash/25 p-6 lg:col-span-4">
                  <span className="eyebrow text-2xs text-accent">
                    The design decision
                  </span>
                  <p className="text-base leading-snug font-semibold text-ink">
                    {item.decision}
                  </p>
                  <Text size="sm" tone="muted">
                    {item.judgement}
                  </Text>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-accent-muted/25 pt-4">
                    <span className="eyebrow text-2xs">In the repository</span>
                    <CodeLabel tone="accent">{item.artefact}</CodeLabel>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </ol>

        {/* The positioning, stated once, after three demonstrations of it. A
            claim that follows its own evidence reads as a summary; the same
            claim placed first reads as a boast.

            ONE SENTENCE, NOT A BIOGRAPHY. This block used to carry a second
            paragraph listing sales, F&I, dealership management, CRM and DMS
            administration, then the computer-science retraining and the
            engineering. That is the career narrative, and it is now the subject
            of `/about` at full length rather than a condensed copy here. Two
            pages telling the same story at different lengths is how the shorter
            one goes stale. */}
        <Reveal className="mt-16 flex flex-col gap-6 border-t border-line pt-10 lg:mt-20 lg:flex-row lg:items-start lg:gap-16">
          <div className="flex flex-col gap-4 lg:max-w-2xl">
            <span className="eyebrow text-2xs">Why these answers</span>
            <p className="font-display text-2xl leading-snug font-semibold tracking-tight text-balance text-ink">
              More than 25 years selling cars, writing deals in finance, managing
              departments and administering the systems the numbers come out of.
            </p>
            <Text size="body" tone="muted" className="max-w-prose">
              The domain came first, which is why the exclusion rules above are the
              interesting part of these definitions rather than a footnote to them.
            </Text>
          </div>
          <LinkButton
            href={ROUTES.about.href}
            variant="secondary"
            iconAfter={<ArrowRight />}
            className="shrink-0"
          >
            About Michael Palmer
          </LinkButton>
        </Reveal>
      </Container>
    </Section>
  )
}
