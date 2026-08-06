/**
 * Chapter six: who built it, and why the answers are good.
 *
 * WHAT THIS SECTION IS MADE OF
 * ----------------------------
 * It is `DomainJudgement` compacted, plus the credibility block that used to
 * close it, plus the two-column map of where the domain ends and the engineering
 * begins. The three judgements are the strongest content on this site and they
 * were previously a three-thousand-pixel chapter of nine editorial columns; they
 * are now three rows, because the argument they make is made by their existence
 * as much as by their length, and the length is available on `/about`.
 *
 * WHY IT IS THE SIXTH CHAPTER AND NOT THE FIRST
 * ---------------------------------------------
 * The claim "twenty-five years in dealerships" is the most persuasive sentence
 * in this repository, and placed before any evidence it reads as a boast. Placed
 * after a working product, three governed rooftops, a product tour and four
 * repository-derived counts, the same sentence reads as the explanation for
 * everything above it. That ordering is the whole information architecture of
 * this page.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 *   - No conferred degree. The repository says "computer science and technical
 *     retraining" and so does this, because the site may not assert a credential
 *     the repository does not.
 *   - No employer names, no titles, no dates. None of that is in the repository,
 *     and a portfolio page is not the place to introduce unverifiable specifics.
 *   - No proficiency bars. "SQL 85%" communicates nothing and invites a reader
 *     to wonder about the missing fifteen.
 *   - No photograph of a stranger. The slot is `<AuthorPortrait>`, which renders
 *     the approved file if one is committed and a designed placeholder at the
 *     identical geometry if none is. There is none today. The contract for
 *     supplying it - path, ratio, dimensions, crop, maximum size - is documented
 *     on that component, and nothing here changes when the file arrives.
 *
 * Server component. Its only motion is the shared reveal.
 */
import { ArrowRight, FolderGit2 } from 'lucide-react'

import { AuthorPortrait } from '@/components/media/author-portrait'
import { Disclosure } from '@/components/ui/disclosure'
import { Reveal } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { CodeLabel, Heading, Text } from '@/components/ui/typography'
import { REPOSITORY_URL, ROUTES, SITE_AUTHOR } from '@/lib/site'

interface Judgement {
  readonly ordinal: string
  /** What a manager asks. In their words, not a BI use case. */
  readonly question: string
  /** What ARPI does about it. */
  readonly decision: string
  /** Why that decision needs someone who has worked the floor. */
  readonly judgement: string
  /**
   * The summary label the judgement sits behind.
   *
   * Written per item rather than generated, because "Why this matters" three
   * times running is three labels that say nothing. Each one names the specific
   * thing going wrong if the decision goes the other way.
   */
  readonly disclosure: string
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
    decision:
      'Front-end, back-end and total gross stay separate through the warehouse, the reporting views and the KPI layer. They are never summed early.',
    judgement:
      'A store holding total gross while front gross collapses is in a materially different position from one where both are steady. Combining them destroys the diagnosis, and the diagnosis is the entire reason a general manager opened the report.',
    disclosure: 'Why summing the three gross figures destroys the diagnosis',
    artefact: 'KPI-GRS-001 / 002 / 003',
  },
  {
    ordinal: '02',
    question: 'Which of my salespeople are actually performing?',
    decision:
      'Volume alone never ranks a person in this model. The employee measures carry an interpretation caution on the measure itself, not in a document.',
    judgement:
      'A leaderboard built on volume rewards whoever the lead routing favours and punishes whoever is closing hard deals slowly. Publishing one is how a reporting project loses the sales floor in a single week.',
    disclosure: 'Why a volume leaderboard costs you the sales floor',
    artefact: 'KPI-SLS-001 interpretation caution',
  },
  {
    ordinal: '03',
    question: 'How much aged inventory am I actually carrying?',
    decision:
      'Daily snapshots at vehicle, store and day grain. Median age leads and the mean is published beside it, because the gap between them is the finding.',
    judgement:
      'Inventory age is right-skewed. A handful of two-hundred-day units drags the mean up and makes a healthy lot look sick, or hides a bad tail inside a comfortable average. Which one leads is a decision, and getting it wrong sends a manager after the wrong cars.',
    disclosure: 'Why the median leads and the mean is published beside it',
    artefact: 'KPI-INV-003 and KPI-INV-004',
  },
]

/** Where the domain knowledge came from. Roles worked, not employers named. */
const OPERATIONS: readonly string[] = [
  'Vehicle sales, and the desk behind it',
  'Finance and insurance, writing deals',
  'Dealership and department management',
  'CRM and DMS administration',
  'Inventory and lead operations',
  'Process training for sales floors',
]

/** What the engineering side of the same person builds. */
const ENGINEERING: readonly string[] = [
  'Dimensional modelling and declared grain',
  'PostgreSQL schemas, DDL and reporting views',
  'Seeded synthetic data generation in Python',
  'Data quality rules with declared severities',
  'Power BI semantic modelling as source-controlled TMDL',
  'This site: Next.js, TypeScript and a tested design system',
]

/** The technologies the repository actually contains work in. */
const TECHNOLOGY: readonly string[] = [
  'PostgreSQL',
  'SQL',
  'Python',
  'DAX',
  'TMDL',
  'TypeScript',
  'React',
  'Next.js',
  'Tailwind CSS',
  'Playwright',
]

export function Builder() {
  return (
    <Section id="builder" tone="canvas" className="scroll-mt-24">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="Who built it"
          title="Dealership intelligence built by someone who has run the dealership"
          lede="Most analytics portfolios are built by someone who learned the business from a dataset. This one is the other way round, and the difference shows up in the small decisions rather than in the architecture diagram."
        />

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          {/* The identity column. */}
          <Reveal className="flex flex-col gap-6 lg:col-span-4">
            {/* Not `priority`: this is the sixth chapter. `/about` carries the
                same component above the fold and prioritises it there. */}
            <AuthorPortrait />

            <div className="flex flex-col gap-2">
              <Heading level={3} size="h4">
                {SITE_AUTHOR}
              </Heading>
              <Text size="sm" tone="muted" className="max-w-prose">
                More than 25 years in automotive retail, then computer science and
                technical retraining, then the engineering in this repository. No
                conferred degree is claimed anywhere on this site, because the repository
                does not claim one.
              </Text>
            </div>

            <div className="flex flex-col gap-2.5 border-t border-line pt-5">
              <span className="eyebrow text-2xs">Worked in this project</span>
              <ul className="flex flex-wrap gap-1.5">
                {TECHNOLOGY.map((item) => (
                  <li key={item}>
                    <CodeLabel tone="default" className="text-2xs">
                      {item}
                    </CodeLabel>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-3">
              <LinkButton
                href={ROUTES.about.href}
                variant="secondary"
                iconAfter={<ArrowRight />}
              >
                The full background
              </LinkButton>
              <LinkButton
                href={REPOSITORY_URL}
                variant="ghost"
                external
                iconBefore={<FolderGit2 />}
              >
                GitHub
              </LinkButton>
            </div>
          </Reveal>

          {/* The argument column. */}
          <div className="flex flex-col gap-12 lg:col-span-8">
            <Reveal className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <span className="eyebrow text-2xs">Dealership operations</span>
                <ul className="flex flex-col gap-2">
                  {OPERATIONS.map((item) => (
                    <li key={item} className="text-sm leading-normal text-ink-secondary">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <span className="eyebrow text-2xs">Engineering systems</span>
                <ul className="flex flex-col gap-2">
                  {ENGINEERING.map((item) => (
                    <li key={item} className="text-sm leading-normal text-ink-secondary">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* The three decisions. Anyone can describe fragmented dealership
                data. These are the calls that cannot be made by someone who has
                not had to defend a gross number to a general manager, and each
                one names the artefact so a reviewer can check it. */}
            <div className="flex flex-col gap-5">
              <Heading level={3} size="h4">
                Three decisions that came from the floor, not from a dataset
              </Heading>
              <ol className="flex flex-col divide-y divide-line border-y border-line">
                {JUDGEMENTS.map((item) => (
                  <Reveal key={item.ordinal} as="li" className="py-7 first:pt-6">
                    <article className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-8">
                      <div className="flex flex-col gap-2 lg:col-span-5">
                        <div className="flex items-baseline gap-3">
                          <span className="numeric font-mono text-2xs tracking-wide text-accent">
                            {item.ordinal}
                          </span>
                          <span className="eyebrow text-2xs">A manager asks</span>
                        </div>
                        <h4 className="text-base leading-snug font-semibold text-balance text-ink">
                          {item.question}
                        </h4>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="eyebrow text-2xs">In the repository</span>
                          <CodeLabel tone="accent">{item.artefact}</CodeLabel>
                        </div>
                      </div>
                      {/* The question and the decision are visible: together
                          they ARE the judgement, and the artefact beside them is
                          checkable. What is behind the disclosure is the
                          argument for why the decision needs someone who has
                          worked a sales floor - which is worth reading and is
                          not worth making every visitor read three times before
                          reaching the closing section. */}
                      <div className="flex flex-col gap-2 lg:col-span-7">
                        <p className="text-sm leading-snug font-semibold text-ink">
                          {item.decision}
                        </p>
                        <Disclosure label={item.disclosure}>
                          <Text size="sm" tone="muted" className="max-w-prose">
                            {item.judgement}
                          </Text>
                        </Disclosure>
                      </div>
                    </article>
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  )
}
