import {
  ArrowRight,
  Boxes,
  Database,
  FileCode2,
  FolderGit2,
  LayoutDashboard,
  Ruler,
  ScrollText,
  ShieldCheck,
  Sigma,
} from 'lucide-react'
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
import { CapabilityGrid, type Capability } from '@/components/ui/summary-grid'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { FlowDiagram, type FlowStage } from '@/components/visuals/flow'
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
 * The about page: an executive profile, not an essay.
 *
 * WHAT `UX.3` CHANGED, AND WHAT IT MEASURED FIRST
 * -----------------------------------------------
 * Measured on a production build: 1,039 words of visible prose, six paragraphs
 * over fifty words, and exactly ONE framed visual on the entire route — the
 * portrait, 733 px down at 1440 × 900 and 2,088 px down at 390 × 844. It was the
 * most argued-at-length page on the site and the least looked-at, which is the
 * wrong way round for the page whose job is to establish that a person is
 * credible quickly.
 *
 * The seven chapters are now five, and three of them are structures rather than
 * prose: the portrait and the facts are the header's visual, the reason ARPI
 * exists is a four-stage chain, and the eight capabilities are a grid of
 * repository links. The rule the page had been arguing for in words is now the
 * rule its layout follows — **the repository proves the claim, so the copy does
 * not have to**.
 *
 * WHAT DID NOT CHANGE
 * -------------------
 * The `h1`. It is the site's one author positioning claim and it lives here and
 * nowhere else, which `content-integrity.spec.ts` asserts in both directions. The
 * career length, the systems worked in, the technical transition, the analytical
 * philosophy and the three decisions from the floor are all still here and still
 * carry the exact phrases `navigation.spec.ts` checks for; what left is the
 * commentary around them.
 *
 * DELIBERATE OMISSIONS, unchanged since the page was written
 * ----------------------------------------------------------
 *   - No claim to a conferred degree. The repository's own author section says
 *     "computer science and technical retraining"; this page says the same.
 *   - No skills cloud, no percentage bars, no proficiency ratings. A bar reading
 *     "SQL 85%" communicates nothing and invites the reader to wonder about the
 *     missing fifteen. `CapabilityGrid` has nowhere to put one.
 *   - No adjective a reader has no way to verify.
 */
export default function AboutPage() {
  return (
    <Canvas>
      {/*
        THE HEADER ANSWERS "WHO BUILT THIS", AND THE VISUAL ANSWERS "WHAT IS IT FOR".

        `UX.3` gave this header its structure — the purpose chain beside the copy —
        and that is unchanged. What changed is the identity half:

          - The eyebrow was "About the author", which is the name of a page rather
            than the name of a person. It is now the name, which puts MICHAEL PALMER
            immediately above the headline in the hierarchy the header already had.
            The headline is untouched: it is the site's one author-positioning claim,
            asserted in both directions by `content-integrity.spec.ts`, and appending
            a name to it would weaken both halves.
          - The lede names the GitHub portfolio and a second paragraph names the
            LinkedIn profile, each as an inline link inside the sentence rather than
            as a third and fourth control. The reader arriving from either one is the
            reader this page is for.
          - The two repository source links left this row. They are evidence for the
            authorship claim rather than the claim itself, and beside two brand badges
            they read as four controls of equal weight. `README.md · author` is on the
            identity card, next to the name it evidences; `docs/research.md` is on the
            section that cites the repository file by file. Nothing was deleted.
      */}
      <PageHeader
        eyebrow={SITE_AUTHOR}
        title="Dealership intelligence built by someone who has run the dealership"
        /* The breadcrumb says "About", not the headline. The h1 here is a sentence,
           and `crumbLabel` exists precisely so a trail can read "Executive / About"
           rather than repeating it. */
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
        /*
          THE CHAIN IS THE HEADER'S VISUAL, AND THE PORTRAIT IS THE FIRST SECTION.

          The obvious arrangement was the other way round, and it was measured and
          rejected. **No approved photograph is committed to this repository**, so
          `AuthorPortrait` renders `MediaPlaceholder` — a designed slot that
          reserves the real file's geometry and states in words what belongs
          there. That is the right answer for a page naming a real person, and it
          means the header's visual anchor would be a dashed frame on every build
          until a file lands. A first-viewport contract that only holds when
          someone supplies an asset is not a contract.

          So the header carries the one figure this page can always draw from the
          repository: what ARPI turns dealership system output into. The portrait
          follows immediately, in the first section, beside the career paragraph —
          which is where the brief for this page wanted it and is 1,500 px earlier
          on a phone than where `UX.2` left it.
        */
        visual={
          <FlowDiagram
            label="What ARPI turns dealership system output into"
            stages={PURPOSE_CHAIN}
            direction="column"
            density="compact"
            caption="The middle two stages are the work. Dealerships already have the first, and every manager already wants the last."
          />
        }
      />

      {/* 1. The career, and the person, together. */}
      <Section tone="canvas">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
            <Reveal className="flex flex-col gap-4 lg:col-span-7">
              <Eyebrow rule>Automotive retail experience</Eyebrow>
              <Heading level={2} size="h3">
                Sales, finance, management, and the systems underneath all three
              </Heading>
              <Text size="body" tone="secondary" className="max-w-prose">
                More than 25 years selling cars, writing deals in finance, managing
                departments and administering the systems the numbers come out of. Enough
                to know which reports get used and which get closed without reading.
              </Text>
              <ul
                aria-label="Where that experience sits"
                className="flex flex-wrap gap-2"
              >
                {DOMAIN_CHIPS.map((chip) => (
                  <li
                    key={chip}
                    className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2.5 py-1 text-xs text-ink-secondary"
                  >
                    {chip}
                  </li>
                ))}
              </ul>
              <Text size="sm" tone="muted" className="max-w-prose">
                Four system families, each with its own idea of what a unit is and when it
                counts. That disagreement is why the management questions on this site
                read the way they do.
              </Text>

              <div className="mt-2 flex flex-col gap-4 border-t border-line pt-6">
                <Eyebrow rule>Technical transition</Eyebrow>
                <Heading level={2} size="h3">
                  Computer science retraining, applied to a domain already understood
                </Heading>
                <Text size="body" tone="secondary" className="max-w-prose">
                  Computer science study and technical retraining, then the work in this
                  repository: Python for the generators and validation, PostgreSQL and SQL
                  for the warehouse and reporting layer, TMDL and DAX for the semantic
                  model, TypeScript and Next.js for this site.
                </Text>
                <Text size="sm" tone="muted" className="max-w-prose">
                  The direction matters. Learning the technology to model a business
                  already understood produces different decisions from learning a business
                  to practise the technology, and the difference shows up in the exclusion
                  rules rather than in the architecture diagram.
                </Text>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-5">
              {/* `priority` here and nowhere else: this is the page the photograph
                  is the subject of, and the only placement that is a candidate for
                  the largest contentful paint. */}
              <Card padding="md" className="flex flex-col gap-4">
                <AuthorPortrait priority sizes="(min-width: 1024px) 24rem, 100vw" />
                {/* THE NAME APPEARS TWICE ON THIS PAGE, DELIBERATELY. The eyebrow
                    establishes authorship before the headline; this is the personal
                    profile identity beside the portrait, and it is where the
                    repository's own author record is cited. Two placements, two
                    jobs. There is no third. */}
                <div className="flex flex-col gap-1">
                  <h3 className="font-display text-xl font-semibold tracking-tight text-ink">
                    {manifest.project.author}
                  </h3>
                  <p className="text-sm text-ink-muted">
                    Automotive retail operations, then analytics engineering.
                  </p>
                  <SourceLink path="README.md" field="author" className="mt-0.5" />
                </div>
                <dl className="flex flex-col gap-2 border-t border-line-subtle pt-3">
                  {FACTS.map((fact) => (
                    <div key={fact.term} className="flex flex-col gap-0.5">
                      <dt className="eyebrow text-2xs">{fact.term}</dt>
                      <dd className="text-sm text-ink-secondary">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-3">
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

      {/* 3. The analytical positions, and the three decisions behind them. */}
      <Section tone="canvas">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Analytical philosophy"
            title="A number a manager cannot interrogate is a number they will not act on"
            lede="Four positions, each enforced somewhere in this repository rather than merely held."
          />
          <ul className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
            <PhilosophyItem
              claim="Show the arithmetic, not the conclusion."
              detail="Every KPI states its formula, both sides of its ratio, its date basis and its null rule."
            />
            <PhilosophyItem
              claim="Publish the limitation next to the measure."
              detail="Each caution is a required field on the KPI it applies to, so it travels with the number."
            />
            <PhilosophyItem
              claim="Rank people carefully or not at all."
              detail="Volume alone never ranks an employee. Lead quality, traffic, tenure and mix change what a number means about a person."
            />
            <PhilosophyItem
              claim="Prove it, then say it."
              detail="Pending is reported as pending. Static validation proves the model's shape and is never presented as proving its arithmetic."
            />
          </ul>

          {/* THE THREE DECISIONS. Visible rather than behind a disclosure: they
              are the differentiating content of this page, and each one names the
              artefact a reviewer can open. */}
          <div className="mt-14 flex flex-col gap-4 border-t border-line pt-10">
            <Heading level={2} size="h3">
              Three decisions that came from the floor, not from a dataset
            </Heading>
            <Text size="body" tone="muted" className="max-w-prose">
              Calls that cannot be made by someone who has not had to defend a gross
              number to a general manager.
            </Text>
            <ol className="flex flex-col divide-y divide-line border-y border-line">
              {JUDGEMENTS.map((item) => (
                <Reveal key={item.ordinal} as="li" className="py-6 first:pt-5">
                  <article className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-8">
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

      {/* 4. Why ARPI exists, answered by the eight artefacts rather than argued.

           The "why ARPI exists" claim and the capability list were two sections
           making one point, one paragraph apart: this project shows the work
           rather than claiming it, and here are the eight files that are the
           work. Merging them removes a section header and puts the claim directly
           above its own evidence. */}
      <Section tone="evidence">
        <Container width="wide">
          <SectionHeader
            layout="wide"
            eyebrow="Why ARPI exists"
            title="To demonstrate the work on artefacts rather than on assertions"
            lede="Eight capabilities, each one a file a reviewer can open. No proficiency rating, because a self-assessed percentage tells you nothing the code does not tell you better."
            /* The research evidence base, moved out of the header. This is the
               section that cites repository files one by one, so the document behind
               the citations belongs at the head of it rather than beside the author's
               profile badges two screens up. */
            action={<SourceLink path="docs/research.md" field="research evidence base" />}
          />
          <CapabilityGrid
            className="mt-10"
            label="Technical capabilities and the artefact that evidences each"
            capabilities={CAPABILITIES}
          />
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
                  Granite Auto Group is invented. Three stores with different mixes, so a
                  group-versus-store comparison has something to compare. No figure in
                  this project describes a real business.
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

/** The facts a reader wants before the essay, beside the portrait rather than after it. */
const FACTS: readonly { readonly term: string; readonly value: string }[] = [
  { term: 'Domain', value: 'Automotive retail, franchise and independent' },
  {
    term: 'Systems worked in',
    value: 'CRM and DMS administration, inventory, lead management, desking',
  },
  {
    term: 'Building with',
    value: 'Python, PostgreSQL, SQL, DAX, TMDL, TypeScript, React, Next.js',
  },
  { term: 'This project', value: 'Synthetic data, MIT licensed' },
]

/** The four departments the experience covers. Chips, not a sentence. */
const DOMAIN_CHIPS: readonly string[] = [
  'Sales',
  'F&I',
  'Dealership management',
  'CRM and DMS administration',
  'Inventory and lead operations',
]

/**
 * What ARPI does to what a dealership already produces.
 *
 * Four stages, not seven. This is the argument for the project rather than a
 * drawing of its pipeline — `/technical` owns that — and a reader on this page is
 * deciding whether the author understood the problem, not how the CSV is written.
 */
const PURPOSE_CHAIN: readonly FlowStage[] = [
  { label: 'Dealer systems', detail: 'DMS, CRM, inventory, marketing' },
  { label: 'Governed model', detail: 'Conformed keys, declared grain', tone: 'accent' },
  { label: 'KPI layer', detail: 'Both sides of every ratio', tone: 'accent' },
  { label: 'Management action', detail: 'A figure you can interrogate' },
]

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
 */
const JUDGEMENTS: readonly Judgement[] = [
  {
    ordinal: '01',
    question: 'Why is total gross holding while front-end gross is collapsing?',
    decision:
      'Front-end, back-end and total gross stay separate through the warehouse, the reporting views and the KPI layer. They are never summed early.',
    judgement:
      'A store holding total gross while front gross collapses is in a materially different position from one where both are steady. Combining them destroys the diagnosis, and the diagnosis is why the report was opened.',
    artefact: 'KPI-GRS-001 / 002 / 003',
  },
  {
    ordinal: '02',
    question: 'Which of my salespeople are actually performing?',
    decision:
      'Volume alone never ranks a person in this model. The employee measures carry an interpretation caution on the measure itself, not in a document.',
    judgement:
      'A leaderboard built on volume rewards whoever the lead routing favours and punishes whoever is closing hard deals slowly. Publishing one loses the sales floor in a week.',
    artefact: 'KPI-SLS-001 interpretation caution',
  },
  {
    ordinal: '03',
    question: 'How much aged inventory am I actually carrying?',
    decision:
      'Daily snapshots at vehicle, store and day grain. Median age leads and the mean is published beside it, because the gap between them is the finding.',
    judgement:
      'Inventory age is right-skewed. A handful of two-hundred-day units drags the mean up and makes a healthy lot look sick, or hides a bad tail inside a comfortable average.',
    artefact: 'KPI-INV-003 and KPI-INV-004',
  },
]

/**
 * The eight capabilities.
 *
 * Each evidence clause is one sentence with a count in it, and every count comes
 * from the generated manifest rather than from this file — the site may not
 * hardcode a number that describes the project, and `content-integrity.test.ts`
 * scans for exactly that.
 */
const CAPABILITIES: readonly Capability[] = [
  {
    name: 'Dimensional modelling',
    evidence: `${String(counts.dimensions.value)} conformed dimensions and ${String(counts.facts.value)} facts, each grain declared and enforced by a UNIQUE constraint.`,
    path: 'sql/04_facts/',
    icon: <Ruler />,
  },
  {
    name: 'SQL and PostgreSQL',
    evidence: `${String(counts.sqlScripts.value)} ordered, re-runnable build scripts, and a reporting role provably confined to one schema.`,
    path: 'sql/',
    icon: <Database />,
  },
  {
    name: 'Python engineering',
    evidence:
      'A typed, seeded generator suite with a validation framework, a deterministic CSV writer with content digests, and a CLI.',
    path: 'src/arpi/',
    icon: <FileCode2 />,
  },
  {
    name: 'KPI governance',
    evidence: `${String(counts.governedKpis.value)} metrics, each with a formula, both sides of its ratio, a grain, a date basis and an interpretation caution.`,
    path: 'KPI_CATALOG.md',
    icon: <Sigma />,
  },
  {
    name: 'Semantic modelling',
    evidence: `A Power BI Project stored as TMDL: ${String(counts.importedTables.value)} imported tables, ${String(counts.semanticRelationships.value)} single-direction relationships, ${String(counts.daxMeasures.value)} measures.`,
    path: 'powerbi/ARPI_Performance_Intelligence/',
    icon: <Boxes />,
  },
  {
    name: 'Data quality engineering',
    evidence: `${String(counts.dataQualityChecks.value)} in-memory checks and ${String(counts.reconciliations.value)} reconciliations per run, with a negative test per critical rule.`,
    path: 'tests/integration/test_reconciliations.py',
    icon: <ShieldCheck />,
  },
  {
    name: 'Frontend engineering',
    evidence:
      'This site: Next.js App Router, strict TypeScript, a documented design system, and a build-time manifest that fails if a displayed number has no source.',
    path: 'portfolio/',
    icon: <LayoutDashboard />,
  },
  {
    name: 'Technical writing and governance',
    evidence:
      'A binding architecture document, a data dictionary, architecture decision records, source-to-target mappings, and written gate reviews.',
    path: 'docs/',
    icon: <ScrollText />,
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
