import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Grid, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { LockedState } from '@/components/ui/states'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { CaseStudyPreview } from '@/components/sections/case-study-preview'
import { caseStudy, counts, gate, increments, semanticModel } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { technicalHref } from '@/lib/technical'
import { Canvas } from '@/components/shell/field'

export const metadata: Metadata = pageMetadata('caseStudy')

/**
 * The case-study route.
 *
 * THE GATE
 * --------
 * `caseStudy.unlocked` is computed at BUILD time by
 * `portfolio/scripts/generate-project-manifest.ts` and requires all five of:
 *
 *   1. NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED === 'true'
 *   2. docs/requirements/GATE_2_READINESS.md exists
 *   3. its recorded Gate 2 verdict is OPEN
 *   4. the required case-study content file exists
 *   5. at least one required report screenshot exists
 *
 * The environment flag is NECESSARY AND NEVER SUFFICIENT. Flipping it in a
 * deployment dashboard cannot conjure a Gate 2 review, a findings document or a
 * screenshot of a report page that has not been built, so a misconfigured
 * environment variable cannot publish an empty case study. That asymmetry is the
 * whole design: the flag can only ever withhold, never grant.
 *
 * WHAT THE LOCKED STATE SHOWS
 * ---------------------------
 * The blocking conditions, what is complete, what remains, why the gate exists,
 * links to the three pages that DO have content, and a preview built only from
 * architecture and model elements this site already renders honestly.
 *
 * WHAT IT MUST NEVER SHOW
 * -----------------------
 * A finding. A recommendation. A dashboard screenshot. A placeholder KPI value. A
 * fake chart. A launch date. "Coming soon" with no context. Or any statement that
 * a validation which is pending has passed.
 */
export default function CaseStudyPage() {
  const gate2 = gate('gate-2')
  const p23 = increments.find((increment) => increment.id === 'P2.3')

  // The unlocked branch exists so that the gate is a real conditional rather
  // than a page that has not been written yet. It renders nothing today, and it
  // must not be filled in until the five conditions above hold - at which point
  // the content it renders will be authored content, not a template.
  if (caseStudy.unlocked) {
    return (
      <>
        <PageHeader
          eyebrow="Case study"
          title="Case study"
          lede="Gate 2 is open and the case study is published."
        />
        <Section>
          <Container width="content">
            <Text size="body">
              The analytical case study content is rendered from
              portfolio/content/case-study.md. This branch is reached only when Gate 2
              records an OPEN verdict and every required artefact exists.
            </Text>
          </Container>
        </Section>
      </>
    )
  }

  return (
    <Canvas>
      <PageHeader
        eyebrow="Case study"
        title="Case study in progress"
        lede="The public analytical case study is held closed by a scope gate, and will stay closed until the conditions below are met. This is not a page that has not been written yet - it is a page that is not permitted to exist yet, and the difference is the point."
        supporting="Gate 2 in the project architecture states that no web case study begins until core report pages are complete, SQL and Power BI totals reconcile, and executive findings are drafted. None of the three is met."
        meta={
          <>
            <StatusBadge status="blocked" label={`Gate 2 ${gate2.verdict}`} size="sm" />
            <StatusBadge status="blocked" label="No findings drawn" size="sm" />
            <SourceLink
              path="docs/requirements/PHASE_2_BACKLOG.md"
              field="Gate 2 conditions"
            />
            <SourceLink
              path="docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md"
              field="ADR-0009"
            />
          </>
        }
      />

      {/* The locked state. Conditions computed from evidence, never authored. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="content">
          <LockedState
            title="Why this page is locked"
            reason="A case study is an argument from evidence. The evidence does not exist yet: no report page has been authored, no Microsoft semantic-model engine has evaluated the measures the case study would cite, and no finding has been drawn. Publishing a case study now would mean writing conclusions before doing the analysis, which is the failure this project is built to demonstrate the opposite of."
            conditions={[
              ...gate2.conditions.map((condition) => ({
                label: `${condition.condition}. ${condition.evidence}`,
                met: condition.met,
              })),
              {
                label:
                  'A written Gate 2 readiness review records an OPEN verdict, in the same form the Gate 1 review used.',
                met: caseStudy.readinessDocumentExists && caseStudy.gate2Open,
              },
              {
                label:
                  'The case-study content and its report screenshots exist in the repository. A build flag alone cannot unlock this page - the generator checks for the files.',
                met:
                  caseStudy.requiredContentPresent &&
                  caseStudy.requiredScreenshotsPresent,
              },
            ]}
            alternatives={
              <div className="flex flex-col gap-4">
                <Heading level={3} size="h6">
                  What you can read instead
                </Heading>
                <Text size="sm" tone="muted" className="max-w-prose">
                  Three pages carry real content today. They are the parts of the case
                  study that do not depend on findings: the architecture, the governed
                  definitions, and an honest account of what state everything is in.
                </Text>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                  <LinkButton
                    href={technicalHref('architecture')}
                    variant="primary"
                    iconAfter={<ArrowRight />}
                  >
                    The architecture
                  </LinkButton>
                  <LinkButton
                    href={technicalHref('kpis')}
                    variant="secondary"
                    iconAfter={<ArrowRight />}
                  >
                    KPI catalogue
                  </LinkButton>
                  <LinkButton
                    href={technicalHref('status')}
                    variant="secondary"
                    iconAfter={<ArrowRight />}
                  >
                    Project status
                  </LinkButton>
                </div>
              </div>
            }
          />
        </Container>
      </Section>

      {/* What is complete, and what remains. Two columns, both concrete. */}
      <Section tone="panel">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Where the work actually is</Eyebrow>
            <Heading level={2}>
              The analytical system is most of the way built. The argument on top of it is
              not started.
            </Heading>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <Heading level={3} size="h5">
                  Complete
                </Heading>
                <StatusBadge status="complete" size="sm" />
              </div>
              <ul className="flex flex-col gap-2.5">
                {[
                  `A seeded, deterministic generator suite and ${String(counts.dataQualityChecks.value)} in-memory data-quality checks.`,
                  `A PostgreSQL warehouse: ${String(counts.dimensions.value)} conformed dimensions, ${String(counts.facts.value)} facts at declared grain, ${String(counts.sqlScripts.value)} ordered build scripts.`,
                  `${String(counts.reportingViews.value)} documented reporting views, and a read-only role provably confined to them.`,
                  `${String(counts.governedKpis.value)} governed KPIs, each computable from SQL and verified against an independent derivation.`,
                  `${String(counts.reconciliations.value)} reconciliations recorded per run, every critical rule observed failing against a corrupted fixture.`,
                  `A semantic model as TMDL: ${String(counts.semanticRelationships.value)} relationships, ${String(counts.daxMeasures.value)} measures, statically validated on every push.`,
                  'This website: a design system, seven informational routes, and a build-time manifest that fails if a displayed number has no source.',
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-ink-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-verified/50 bg-verified-wash font-mono text-2xs leading-none text-verified"
                    >
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>

            <Card tone="pending" className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <Heading level={3} size="h5">
                  Remaining
                </Heading>
                <StatusBadge status="blocked" label="Sequenced" size="sm" />
              </div>
              <ol className="flex flex-col gap-3">
                {[
                  {
                    step: '01',
                    label: 'Real-engine validation of the semantic model',
                    detail:
                      'A Microsoft engine loads, refreshes and queries the model, and its results are reconciled against the committed SQL baseline. Either accepted path closes this.',
                  },
                  {
                    step: '02',
                    label: 'The MVP report pages',
                    detail:
                      'Seven pages over a model that an engine has actually loaded, so that a refresh failure is unambiguous about which layer caused it.',
                  },
                  {
                    step: '03',
                    label: 'Findings, then the Gate 2 review',
                    detail: `${p23?.statusReason ?? 'Not started.'} The review records a written verdict against the three conditions above.`,
                  },
                  {
                    step: '04',
                    label: 'This page, populated',
                    detail:
                      'The case study is authored only after the verdict opens, and the gate in this build then unlocks it.',
                  },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3">
                    <span className="mt-0.5 shrink-0 font-mono text-2xs text-pending">
                      {item.step}
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-ink">{item.label}</p>
                      <p className="text-xs leading-relaxed text-ink-muted">
                        {item.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-auto border-t border-pending/20 pt-3 font-mono text-2xs text-ink-faint">
                No date is given for any of these. Step one depends on provisioning
                outside this repository, and a predicted date would be a guess presented
                as a commitment.
              </p>
            </Card>
          </div>
        </Container>
      </Section>

      {/* Why the gate exists at all. */}
      <Section tone="canvas">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
            <Reveal className="flex flex-col gap-5 lg:col-span-5">
              <Eyebrow>Why the gate exists</Eyebrow>
              <Heading level={2}>
                A control that never blocks anything was never a control
              </Heading>
              <Text size="body" className="max-w-prose">
                It would have been trivial to write a case study now. The architecture is
                interesting, the model is real, and a reader would probably not check.
                That is precisely why the gate is worth keeping: its value is entirely in
                the case where honouring it is inconvenient.
              </Text>
              <Text size="body" tone="muted" className="max-w-prose">
                ADR-0009 records the decision that let this website ship while the case
                study stayed closed, and it draws the line explicitly: a design system,
                informational routes and architecture storytelling are permitted before
                Gate 2; published findings, management recommendations, dashboard
                screenshots presented as complete, and any claim that a pending validation
                has passed are not.
              </Text>
              <SourceLink
                path="docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md"
                field="the decision and its boundaries"
              />
            </Reveal>

            <Grid columns={2} gap={4} className="lg:col-span-7">
              <Card tone="sunken" className="flex flex-col gap-2">
                <Heading level={3} size="h6">
                  Permitted before Gate 2
                </Heading>
                <ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
                  {[
                    'This design system and application shell',
                    'Informational routes and architecture storytelling',
                    'Data-model and KPI-catalogue exploration',
                    'Governance and privacy content',
                    'An honest project-status display',
                    'A locked case-study shell',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-verified/70"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card tone="pending" className="flex flex-col gap-2">
                <Heading level={3} size="h6">
                  Still prohibited
                </Heading>
                <ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
                  {[
                    'Published analytical findings',
                    'Management recommendations',
                    'Report screenshots presented as complete',
                    'A functioning duplicate dashboard',
                    'Any KPI value, real or placeholder',
                    'Any claim that a pending validation has passed',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-failed/70"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            </Grid>
          </div>
        </Container>
      </Section>

      {/* The tasteful preview: architecture and model elements only. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>What the case study will be built on</Eyebrow>
            <Heading level={2}>
              The system the argument will rest on, drawn from what already exists
            </Heading>
            <Text size="body">
              Below is the shape of the platform, rendered from the same source-controlled
              evidence as the rest of this site. It is not a mock-up of the case study, it
              contains no chart, and it shows no value - it is the structure that a case
              study would eventually reason over.
            </Text>
          </Reveal>
          <CaseStudyPreview />
          <p className="mt-6 font-mono text-2xs text-ink-faint">
            {semanticModel.dashboardPageCount === 0
              ? 'No report page exists to screenshot, so there is no screenshot here. A composite or a mock-up would be decoration presented as evidence.'
              : `${String(semanticModel.dashboardPageCount)} report page definitions exist.`}
          </p>
        </Container>
      </Section>
    </Canvas>
  )
}
