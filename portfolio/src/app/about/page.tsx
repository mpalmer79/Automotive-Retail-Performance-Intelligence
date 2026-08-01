import type { Metadata } from 'next'
import { ArrowRight, FolderGit2 } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { Wordmark } from '@/components/brand/logo'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { counts, manifest } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { REPOSITORY_URL, ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('about')

/**
 * The about page.
 *
 * A narrative, not a biography wall. Five short sections, each answering
 * something a reader would actually want to know, and each grounded in a decision
 * visible in the repository.
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
 *   - No "passionate", "results-driven", "detail-oriented", or any adjective
 *     that a reader has no way to verify.
 *   - No personal detail unrelated to the project.
 */
export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="Twenty-five years in dealerships, then the technical work to model them properly"
        lede="Most analytics portfolios are built by someone who learned the business from a dataset. This one is the other way round: the domain came first, and the technical decisions in it were made by someone who has had to defend a gross number to a general manager."
        meta={
          <>
            <SourceLink path="README.md" field="author" />
            <SourceLink path="docs/research.md" field="research evidence base" />
          </>
        }
      />

      <Section rhythm="none" className="pt-section-tight">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            {/* The narrative */}
            <div className="flex flex-col gap-12 lg:col-span-7">
              <Reveal className="flex flex-col gap-4">
                <Eyebrow>Automotive retail experience</Eyebrow>
                <Heading level={2} size="h3">
                  Sales, finance, management, and the systems underneath all three
                </Heading>
                <Text size="body" className="max-w-prose">
                  More than 25 years across dealership operations: selling cars, writing
                  deals in finance, managing departments, and administering the systems
                  that the numbers come out of - CRM, DMS, inventory management and lead
                  handling. Enough of it to know which reports get used and which get
                  closed without reading.
                </Text>
                <Text size="body" tone="muted" className="max-w-prose">
                  That experience is why the six management questions on this site&apos;s
                  home page read the way they do. They are not generic BI use cases. They
                  are the questions that come up in a Monday manager meeting and go
                  unanswered because the four systems that hold the answer disagree about
                  what a used unit is.
                </Text>
              </Reveal>

              <Reveal className="flex flex-col gap-4">
                <Eyebrow>Why this project exists</Eyebrow>
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
                  It is deliberately not a production system, and it is honest about what
                  it is not. There is no dashboard yet. The semantic model has never been
                  loaded by a Microsoft engine. Saying so on the front page costs
                  something, and saying so is the point: a project that reports its own
                  gaps is a project whose other claims are worth reading.
                </Text>
              </Reveal>

              <Reveal className="flex flex-col gap-4">
                <Eyebrow>Technical transition</Eyebrow>
                <Heading level={2} size="h3">
                  Computer science retraining, applied to a domain already understood
                </Heading>
                <Text size="body" className="max-w-prose">
                  Computer science study and technical retraining, then the work in this
                  repository: Python for the generators and the validation framework,
                  PostgreSQL and SQL for the warehouse and the reporting layer, TMDL and
                  DAX for the semantic model, and TypeScript, React and Next.js for this
                  site.
                </Text>
                <Text size="body" tone="muted" className="max-w-prose">
                  The transition direction matters. Learning the technology to model a
                  business already understood produces different decisions from learning a
                  business to practise the technology - and the difference shows up in the
                  exclusion rules, not in the architecture diagram.
                </Text>
              </Reveal>

              <Reveal className="flex flex-col gap-4">
                <Eyebrow>Analytical philosophy</Eyebrow>
                <Heading level={2} size="h3">
                  A number a manager cannot interrogate is a number they will not act on
                </Heading>
                <Text size="body" className="max-w-prose">
                  Four positions, all of them enforced somewhere in this repository rather
                  than merely held:
                </Text>
                <ul className="flex flex-col gap-4">
                  <PhilosophyItem
                    claim="Show the arithmetic, not the conclusion."
                    detail="Every KPI states its formula, both sides of its ratio, its date basis and its null rule. A manager who can see how the number was built can tell you when it is wrong, which is the only way it gets better."
                  />
                  <PhilosophyItem
                    claim="Publish the limitation next to the measure."
                    detail="First-touch attribution, excluded manufacturer incentives, skewed distributions where the mean misleads - each caution is a required field on the KPI it applies to, so it travels with the number instead of living in a document nobody opens."
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
              </Reveal>

              <Reveal className="flex flex-col gap-4">
                <Eyebrow>Skills demonstrated</Eyebrow>
                <Heading level={2} size="h3">
                  What is actually in the repository
                </Heading>
                <Text size="body" className="max-w-prose">
                  Each item below maps to something a reviewer can open and read. No
                  proficiency rating, because a self-assessed percentage tells you nothing
                  that the code does not tell you better.
                </Text>
                <dl className="flex flex-col divide-y divide-line-subtle">
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
              </Reveal>
            </div>

            {/* The sidebar */}
            <aside className="flex flex-col gap-6 lg:col-span-5">
              <div className="lg:sticky lg:top-[calc(var(--arpi-size-header)+2rem)] flex flex-col gap-6">
                <Card padding="lg" className="flex flex-col gap-5">
                  <Wordmark variant="full" />
                  <div className="flex flex-col gap-1">
                    <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
                      {manifest.project.author}
                    </h2>
                    <p className="text-sm text-ink-muted">
                      Automotive retail operations, then analytics engineering.
                    </p>
                  </div>

                  <dl className="flex flex-col gap-3 border-t border-line-subtle pt-4 text-sm">
                    <SidebarRow
                      term="Domain"
                      value="Automotive retail - franchise and independent"
                    />
                    <SidebarRow
                      term="Systems worked in"
                      value="CRM, DMS, inventory management, lead management, desking"
                    />
                    <SidebarRow
                      term="Building with"
                      value="Python, PostgreSQL, SQL, DAX, TMDL, TypeScript, React, Next.js"
                    />
                    <SidebarRow
                      term="This project"
                      value="Synthetic data, MIT licensed"
                    />
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
                      href={ROUTES.architecture.href}
                      variant="secondary"
                      iconAfter={<ArrowRight />}
                    >
                      The architecture
                    </LinkButton>
                    <LinkButton
                      href={ROUTES.status.href}
                      variant="ghost"
                      iconAfter={<ArrowRight />}
                    >
                      Current project status
                    </LinkButton>
                  </div>
                </Card>

                <Card tone="sunken" className="flex flex-col gap-2">
                  <Heading level={2} size="h6">
                    On the fictional dealer group
                  </Heading>
                  <Text size="sm" tone="muted">
                    Granite State Auto Group is invented. It exists to give the data model
                    a coherent business context - three stores with different mixes, so
                    that a group-versus-store comparison has something to compare. It is
                    not a real business, and no figure in this project describes one.
                  </Text>
                </Card>
              </div>
            </aside>
          </div>
        </Container>
      </Section>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function PhilosophyItem({ claim, detail }: { claim: string; detail: string }) {
  return (
    <li className="flex flex-col gap-1.5 border-l-2 border-accent-muted/50 pl-4">
      <p className="text-base font-semibold text-ink">{claim}</p>
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
    <div className="flex flex-col gap-1.5 py-4 first:pt-0 sm:grid sm:grid-cols-[minmax(9rem,12rem)_1fr] sm:gap-x-6">
      <dt className="text-sm font-semibold text-ink">{skill}</dt>
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
