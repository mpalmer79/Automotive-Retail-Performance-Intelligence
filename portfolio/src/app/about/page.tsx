import { ArrowRight, FolderGit2 } from 'lucide-react'
import type { Metadata } from 'next'

import { Reveal } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { counts, manifest } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { REPOSITORY_URL, ROUTES } from '@/lib/site'
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
 * The six domain decisions that came from the floor are on the home page, in
 * chapter two, where they do the most work. This page does not repeat them.
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
      <PageHeader
        eyebrow="About the author"
        title="Dealership intelligence built by someone who has run the dealership"
        lede="Twenty-five years in dealerships, then the technical work to model them properly. Most analytics portfolios are built by someone who learned the business from a dataset. This one is the other way round: the domain came first, and the technical decisions in it were made by someone who has had to defend a gross number to a general manager."
        supporting="That sentence was the ARPI home page's headline until the home page became the product overview it should always have been. It is the right claim in the wrong place there and the right claim in the right place here, which is why this page is where it now lives and where it is argued at length."
        meta={
          <>
            <SourceLink path="README.md" field="author" />
            <SourceLink path="docs/research.md" field="research evidence base" />
          </>
        }
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
                <div className="flex flex-col gap-1">
                  <h3 className="font-display text-2xl font-semibold tracking-tight text-ink">
                    {manifest.project.author}
                  </h3>
                  <p className="text-sm text-ink-muted">
                    Automotive retail operations, then analytics engineering.
                  </p>
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
                    href={ROUTES.status.href}
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
                is not. There is no dashboard yet. The semantic model has never been
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
                  href={ROUTES.architecture.href}
                  variant="secondary"
                  iconAfter={<ArrowRight />}
                >
                  The architecture
                </LinkButton>
                <LinkButton
                  href={ROUTES.kpis.href}
                  variant="secondary"
                  iconAfter={<ArrowRight />}
                >
                  Governed KPI definitions
                </LinkButton>
                <LinkButton
                  href={ROUTES.status.href}
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
