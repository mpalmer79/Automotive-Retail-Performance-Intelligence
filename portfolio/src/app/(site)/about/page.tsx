import { ArrowRight, FolderGit2 } from 'lucide-react'
import type { Metadata } from 'next'

import { AuthorPortrait } from '@/components/media/author-portrait'
import { Reveal } from '@/components/motion/reveal'
import { AuthorProfileLinks } from '@/components/profile/author-profile-links'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { InlineLink } from '@/components/ui/inline-link'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { counts, manifest } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import {
  AUTHOR_GITHUB_URL,
  AUTHOR_LINKEDIN_URL,
  REPOSITORY_URL,
  SITE_AUTHOR,
} from '@/lib/site'
import { technicalHref } from '@/lib/technical'
import { Canvas } from '@/components/shell/field'

export const metadata: Metadata = pageMetadata('about')

/**
 * The about page.
 *
 * Seven chapters in a deliberate order, each answering something a reader would
 * actually want to know, each grounded in a decision visible in the repository:
 *
 *   1  the automotive retail career, and the facts about the person
 *   2  the technical transition
 *   3  why ARPI exists
 *   4  the analytical positions behind the design decisions
 *   5  the technical capability, mapped to files
 *   6  the fictional dealer group, stated once more
 *   7  where to go next
 *
 * The three decisions that came from the floor arrived in chapter four with the
 * home page's builder chapter. They used to be told there, under a second,
 * shorter version of the career narrative this page tells in full - which is
 * exactly the shape that goes stale, because the short copy is the one nobody
 * remembers to update. There is now one telling, and it is here.
 *
 * WHAT THE REDESIGN CHANGED
 * -------------------------
 * The previous version was five long narrative blocks in a seven-column column
 * against a five-column sticky sidebar, and the sidebar was the more readable
 * half: a wall of prose beside a card of facts (finding C-06). The narrative is
 * now chaptered across alternating grounds, and the sidebar's facts are pulled
 * up into chapter one, where they belong. A reader asking "who is this" gets the
 * answer before the essay rather than beside it.
 *
 * DELIBERATE OMISSIONS
 * --------------------
 *   - No claim to a conferred degree. The repository's own author section says
 *     "computer science and technical retraining"; this page says the same and
 *     goes no further, because the site may not assert a credential the
 *     repository does not.
 *   - No skills cloud, no percentage bars, no proficiency ratings. A bar that
 *     says "SQL 85%" communicates nothing and invites the reader to wonder what
 *     the missing 15% is.
 *   - No "passionate", "results-driven", "detail-oriented", or any adjective a
 *     reader has no way to verify.
 *   - No personal detail unrelated to the project.
 */
export default function AboutPage() {
  return (
    <Canvas>
      {/*
        THE HERO ANSWERS "WHO BUILT THIS", AND NOTHING ELSE.

        Three things changed and each removed something rather than adding to it.

          - The eyebrow was "About the author", which is the name of a page rather
            than the name of a person. It is now the name, which puts MICHAEL PALMER
            immediately above the headline in the hierarchy the header already had.
            The headline is untouched: it is the strongest sentence on the site and
            appending a name to it would have weakened both halves.
          - Two paragraphs replaced two longer ones. The first now says where the
            other work is; the second says where the professional background is.
            The paragraph they displaced explained the site's own editing history to
            a visitor who had not asked - "that sentence was the home page's headline
            until..." is a note about a redesign, not about a person or a product.
            The result is shorter than what it replaced, which is the constraint the
            wider redesign is under.
          - The two repository source links left this row. They are evidence for the
            authorship claim rather than the claim itself, and beside two brand
            badges they read as four controls of equal weight. `README.md · author`
            is now on the identity card, next to the name it evidences, and
            `docs/research.md` is on the section whose subject it is. Nothing was
            deleted.
      */}
      <PageHeader
        eyebrow={SITE_AUTHOR}
        title="Dealership intelligence built by someone who has run the dealership"
        /* The breadcrumb says "About", not the headline. The h1 here is a
           sentence, and `crumbLabel` exists precisely so a trail can read
           "Executive / About" rather than repeating it. */
        crumbLabel="About"
        lede={
          <>
            Twenty-five years in dealerships came first, followed by the technical work to
            model them properly. ARPI combines that operating experience with analytics
            and software engineering. You can explore my{' '}
            <InlineLink href={AUTHOR_GITHUB_URL} external>
              GitHub portfolio
            </InlineLink>{' '}
            to see other projects I&rsquo;ve built across AI, data, and software
            development.
          </>
        }
        supporting={
          <>
            My work sits at the intersection of automotive retail, analytics, AI, and
            software engineering. For my professional background, experience, and current
            work, visit my{' '}
            <InlineLink href={AUTHOR_LINKEDIN_URL} external>
              LinkedIn profile
            </InlineLink>
            .
          </>
        }
        meta={<AuthorProfileLinks />}
      />

      {/* 1. The career, and the facts a reader wants before the essay. */}
      <Section tone="canvas">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
            <Reveal className="flex flex-col gap-5 lg:col-span-7">
              <Eyebrow rule>Automotive retail experience</Eyebrow>
              <Heading level={2} size="h3">
                Sales, finance, management, and the systems underneath all three
              </Heading>
              <Text size="body" className="max-w-prose">
                More than 25 years across dealership operations: selling cars, writing
                deals in finance, managing departments, and administering the systems the
                numbers come out of. Enough of it to know which reports get used and which
                get closed without reading.
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                Sales, F&amp;I, dealership management, CRM and DMS administration,
                inventory and lead operations. Four system families, each with its own
                idea of what a unit is and when it counts.
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                That experience is why the management questions on this site read the way
                they do. They are not generic BI use cases. They are the questions that
                come up in a Monday manager meeting and go unanswered because the four
                systems holding the answer disagree about what a used unit is.
              </Text>
            </Reveal>

            <Reveal className="lg:col-span-5">
              <Card padding="lg" className="flex flex-col gap-5">
                {/* The portrait, or the designed slot reserving its geometry.
                    `priority` here and nowhere else: this is the page the
                    photograph is the subject of, and it is the only placement
                    that is a candidate for the largest contentful paint. The
                    home page's builder chapter is six sections down and
                    lazy-loads the same component. */}
                <AuthorPortrait priority sizes="(min-width: 1024px) 24rem, 100vw" />

                {/* THE NAME APPEARS TWICE ON THIS PAGE, DELIBERATELY. The eyebrow
                    establishes authorship before the headline; this is the personal
                    profile identity beside the portrait, and it is where the
                    repository's own author record is cited. Two placements, two
                    jobs. There is no third. */}
                <div className="flex flex-col gap-1">
                  <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">
                    {manifest.project.author}
                  </h3>
                  <p className="text-sm text-ink-muted">
                    Automotive retail operations, then analytics engineering.
                  </p>
                  <SourceLink path="README.md" field="author" className="mt-1" />
                </div>
                <dl className="flex flex-col gap-3 border-t border-line-subtle pt-4 text-sm">
                  <SidebarRow
                    term="Domain"
                    value="Automotive retail, franchise and independent"
                  />
                  <SidebarRow
                    term="Systems worked in"
                    value="CRM, DMS, inventory management, lead management, desking"
                  />
                  <SidebarRow
                    term="Building with"
                    value="Python, PostgreSQL, SQL, DAX, TMDL, TypeScript, React, Next.js"
                  />
                  <SidebarRow term="This project" value="Synthetic data, MIT licensed" />
                </dl>
                <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-4">
                  <LinkButton
                    href={REPOSITORY_URL}
                    variant="primary"
                    external
                    iconBefore={<FolderGit2 />}
                  >
                    Source repository
                  </LinkButton>
                  <LinkButton
                    href={technicalHref('status')}
                    variant="secondary"
                    iconAfter={<ArrowRight />}
                  >
                    Current project status
                  </LinkButton>
                </div>
              </Card>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* 2 and 3. The transition, and the reason. */}
      <Section tone="evidence">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
            <Reveal className="flex flex-col gap-5">
              <Eyebrow rule>Technical transition</Eyebrow>
              <Heading level={2} size="h3">
                Computer science retraining, applied to a domain already understood
              </Heading>
              <Text size="body" className="max-w-prose">
                Computer science study and technical retraining, then the work in this
                repository: Python for the generators and the validation framework,
                PostgreSQL and SQL for the warehouse and the reporting layer, TMDL and DAX
                for the semantic model, and TypeScript, React and Next.js for this site.
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                The direction matters. Learning the technology to model a business already
                understood produces different decisions from learning a business to
                practise the technology, and the difference shows up in the exclusion
                rules rather than in the architecture diagram.
              </Text>
            </Reveal>

            <Reveal className="flex flex-col gap-5">
              <Eyebrow rule>Why ARPI exists</Eyebrow>
              <Heading level={2} size="h3">
                To demonstrate the work on artefacts rather than on assertions
              </Heading>
              <Text size="body" className="max-w-prose">
                A portfolio can claim analytical judgement or it can show it. This one
                shows it: the KPI catalogue defines every metric with an explicit
                numerator and denominator, the reconciliation suite proves the numbers
                rather than asserting them, and every critical rule has been observed
                failing against a deliberately corrupted fixture.
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                It is deliberately not a production system, and it is honest about what it
                is not. Every figure in it is synthetic. The Power BI report layer is a
                shell with no page and no visual, and the semantic model has never been
                loaded by a Microsoft engine. Saying so on the front page costs something,
                and saying so is the point: a project that reports its own gaps is a
                project whose other claims are worth reading.
              </Text>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* 4. The analytical positions. */}
      <Section tone="canvas">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Analytical philosophy"
            title="A number a manager cannot interrogate is a number they will not act on"
            lede="Four positions, all of them enforced somewhere in this repository rather than merely held."
          />
          <ul className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-10">
            <PhilosophyItem
              claim="Show the arithmetic, not the conclusion."
              detail="Every KPI states its formula, both sides of its ratio, its date basis and its null rule. A manager who can see how the number was built can tell you when it is wrong, which is the only way it gets better."
            />
            <PhilosophyItem
              claim="Publish the limitation next to the measure."
              detail="First-touch attribution, excluded manufacturer incentives, skewed distributions where the mean misleads. Each caution is a required field on the KPI it applies to, so it travels with the number instead of living in a document nobody opens."
            />
            <PhilosophyItem
              claim="Rank people carefully or not at all."
              detail="Volume alone never ranks an employee in this model. Lead quality, store traffic, tenure and vehicle mix change what a number means about a person, and a scorecard without them is a scorecard that punishes the wrong things."
            />
            <PhilosophyItem
              claim="Prove it, then say it."
              detail="This project reports pending as pending. Static validation proves the model's shape and is never presented as proving its arithmetic, because the difference between those two claims is the difference between careful and careless."
            />
          </ul>

          {/* THE THREE DECISIONS, MOVED HERE FROM THE HOME PAGE.
              They were the home page's sixth chapter, where they sat under a
              second telling of the career narrative this page tells at length.
              They belong beside the four positions above rather than in a
              chapter of their own: the positions are what this project holds,
              these are the three places it cost something to hold them, and each
              one names the artefact a reviewer can open.

              They are visible here rather than behind a disclosure. On the home
              page the argument was folded away to keep the page short; this is
              the page where the length is the point. */}
          <div className="mt-16 flex flex-col gap-5 border-t border-line pt-12">
            <Heading level={2} size="h3">
              Three decisions that came from the floor, not from a dataset
            </Heading>
            <Text size="body" tone="muted" className="max-w-prose">
              Anyone can describe fragmented dealership data. These are the calls that
              cannot be made by someone who has not had to defend a gross number to a
              general manager.
            </Text>
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
                      <h3 className="text-base leading-snug font-semibold text-balance text-ink">
                        {item.question}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="eyebrow text-2xs">In the repository</span>
                        <CodeLabel tone="accent">{item.artefact}</CodeLabel>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 lg:col-span-7">
                      <p className="text-sm leading-snug font-semibold text-ink">
                        {item.decision}
                      </p>
                      <Text size="sm" tone="muted" className="max-w-prose">
                        {item.judgement}
                      </Text>
                    </div>
                  </article>
                </Reveal>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      {/* 5. The capability, mapped to files. */}
      <Section tone="evidence">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="What is actually in the repository"
            title="Eight capabilities, each one a file a reviewer can open"
            lede="No proficiency rating, because a self-assessed percentage tells you nothing the code does not tell you better."
            /* The research evidence base, moved out of the hero. This is the
               section that cites repository files line by line, so the document
               behind the citations belongs at the head of it rather than beside
               the author's profile badges two screens up. */
            action={<SourceLink path="docs/research.md" field="research evidence base" />}
          />
          <dl className="mt-12 flex flex-col divide-y divide-line-subtle">
            <SkillRow
              skill="Dimensional modelling"
              evidence={`${String(counts.dimensions.value)} conformed dimensions and ${String(counts.facts.value)} facts, each fact's grain declared, enforced by a UNIQUE constraint, and asserted by a test.`}
              path="sql/04_facts/"
            />
            <SkillRow
              skill="SQL and PostgreSQL"
              evidence={`${String(counts.sqlScripts.value)} ordered, re-runnable build scripts across nine numbered directories, plus three roles with the reporting identity provably confined to one schema.`}
              path="sql/"
            />
            <SkillRow
              skill="Python engineering"
              evidence="A typed, seeded generator suite with a validation framework, a deterministic CSV writer with content digests, an ingestion layer with rejection handling, and a CLI."
              path="src/arpi/"
            />
            <SkillRow
              skill="KPI governance"
              evidence={`${String(counts.governedKpis.value)} metrics, each with a formula, both sides of its ratio, a grain, a date basis, a null rule, a source view and an interpretation caution.`}
              path="KPI_CATALOG.md"
            />
            <SkillRow
              skill="Semantic modelling"
              evidence={`A Power BI Project stored as TMDL: ${String(counts.importedTables.value)} imported tables, ${String(counts.semanticRelationships.value)} single-direction relationships, ${String(counts.daxMeasures.value)} measures, and a marked date table.`}
              path="powerbi/ARPI_Performance_Intelligence/"
            />
            <SkillRow
              skill="Data quality engineering"
              evidence={`${String(counts.dataQualityChecks.value)} in-memory checks with declared severities, ${String(counts.reconciliations.value)} reconciliations recorded per run, and a negative test per critical rule.`}
              path="tests/integration/test_reconciliations.py"
            />
            <SkillRow
              skill="Frontend engineering"
              evidence="This site: Next.js App Router, TypeScript in strict mode, a documented design and motion system, and a build-time manifest that fails if a displayed number has no source."
              path="portfolio/"
            />
            <SkillRow
              skill="Technical writing and governance"
              evidence="A binding architecture document, a data dictionary, nine architecture decision records, source-to-target mappings per entity, and written gate reviews."
              path="docs/"
            />
          </dl>
        </Container>
      </Section>

      {/* 6 and 7. The dealer group, and the onward path. */}
      <Section tone="canvas">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-16">
            <Reveal className="lg:col-span-7">
              <Card tone="sunken" padding="lg" className="flex flex-col gap-3">
                <Heading level={2} size="h5">
                  On the fictional dealer group
                </Heading>
                <Text size="body" tone="muted" className="max-w-prose">
                  Granite Auto Group is invented. It exists to give the data model a
                  coherent business context: three stores with different mixes, so that a
                  group-versus-store comparison has something to compare. It is not a real
                  business, and no figure in this project describes one.
                </Text>
              </Card>
            </Reveal>
            <Reveal className="flex flex-col gap-4 lg:col-span-5">
              <Heading level={2} size="h5">
                Where to go from here
              </Heading>
              <div className="flex flex-col gap-2.5">
                <LinkButton
                  href={technicalHref('architecture')}
                  variant="secondary"
                  iconAfter={<ArrowRight />}
                >
                  The architecture
                </LinkButton>
                <LinkButton
                  href={technicalHref('kpis')}
                  variant="secondary"
                  iconAfter={<ArrowRight />}
                >
                  Governed KPI definitions
                </LinkButton>
                <LinkButton
                  href={technicalHref('status')}
                  variant="ghost"
                  iconAfter={<ArrowRight />}
                >
                  What is finished, and what is not
                </LinkButton>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

interface Judgement {
  readonly ordinal: string
  /** What a manager asks. In their words, not a BI use case. */
  readonly question: string
  /** What ARPI does about it. */
  readonly decision: string
  /** Why that decision needs someone who has worked the floor. */
  readonly judgement: string
  /** Where it lives in the repository. */
  readonly artefact: string
}

/**
 * Three, not six. A fourth would be a fourth variation on the same argument, and
 * the argument is already made by the third.
 *
 * Moved here with the home page's builder chapter. The `disclosure` label each
 * one used to carry came with it and was dropped: it named the summary a reader
 * had to open on a page that was trying to be short, and this page is not.
 */
const JUDGEMENTS: readonly Judgement[] = [
  {
    ordinal: '01',
    question: 'Why is total gross holding while front-end gross is collapsing?',
    decision:
      'Front-end, back-end and total gross stay separate through the warehouse, the reporting views and the KPI layer. They are never summed early.',
    judgement:
      'A store holding total gross while front gross collapses is in a materially different position from one where both are steady. Combining them destroys the diagnosis, and the diagnosis is the entire reason a general manager opened the report.',
    artefact: 'KPI-GRS-001 / 002 / 003',
  },
  {
    ordinal: '02',
    question: 'Which of my salespeople are actually performing?',
    decision:
      'Volume alone never ranks a person in this model. The employee measures carry an interpretation caution on the measure itself, not in a document.',
    judgement:
      'A leaderboard built on volume rewards whoever the lead routing favours and punishes whoever is closing hard deals slowly. Publishing one is how a reporting project loses the sales floor in a single week.',
    artefact: 'KPI-SLS-001 interpretation caution',
  },
  {
    ordinal: '03',
    question: 'How much aged inventory am I actually carrying?',
    decision:
      'Daily snapshots at vehicle, store and day grain. Median age leads and the mean is published beside it, because the gap between them is the finding.',
    judgement:
      'Inventory age is right-skewed. A handful of two-hundred-day units drags the mean up and makes a healthy lot look sick, or hides a bad tail inside a comfortable average. Which one leads is a decision, and getting it wrong sends a manager after the wrong cars.',
    artefact: 'KPI-INV-003 and KPI-INV-004',
  },
]

function PhilosophyItem({ claim, detail }: { claim: string; detail: string }) {
  return (
    <li className="flex flex-col gap-2 border-l-2 border-accent-muted/50 pl-5">
      <p className="text-lg leading-snug font-semibold text-ink">{claim}</p>
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{detail}</p>
    </li>
  )
}

function SkillRow({
  skill,
  evidence,
  path,
}: {
  skill: string
  evidence: string
  path: string
}) {
  return (
    <div className="flex flex-col gap-1.5 py-4 first:pt-0 sm:grid sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-x-8">
      <dt className="text-base font-semibold text-ink">{skill}</dt>
      <dd className="flex flex-col gap-1.5">
        <span className="text-sm leading-relaxed text-ink-muted">{evidence}</span>
        <SourceLink path={path} />
      </dd>
    </div>
  )
}

function SidebarRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow text-2xs">{term}</dt>
      <dd className="text-sm text-ink-secondary">{value}</dd>
    </div>
  )
}
