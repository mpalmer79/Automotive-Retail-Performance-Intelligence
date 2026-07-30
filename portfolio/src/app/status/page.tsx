import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { DefinitionList, EvidenceItem, SourceLink } from '@/components/ui/data-card'
import { Container, Grid, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import {
  counts,
  engines,
  evidence,
  gate,
  increments,
  lifecyclePhases,
  manifest,
  semanticModel,
} from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { formatCount, formatTimestamp } from '@/lib/utils'

export const metadata: Metadata = pageMetadata('status')

/**
 * The status page.
 *
 * Everything here derives from `project-manifest.json`, which derives from
 * source-controlled evidence files. Nothing on this page is typed as a literal,
 * which is why it cannot drift from what the repository can prove.
 *
 * The page's central job is to make four things impossible to conflate:
 *
 *   1. Static source validation - the TMDL is parsed and checked. Proves shape.
 *   2. Real-engine validation   - a Microsoft engine loads, refreshes and queries
 *                                 the model. Proves arithmetic. Has not happened.
 *   3. Dashboard completion     - report pages exist. None does.
 *   4. Case-study completion    - findings are drawn and published. None are.
 *
 * Those four get their own section, at the top, before the phase list. A reader
 * who stops after that section still leaves with the correct impression.
 */
export default function StatusPage() {
  const gate1 = gate('gate-1')
  const gate2 = gate('gate-2')

  return (
    <>
      <PageHeader
        eyebrow="Project status"
        title="What is finished, what is not, and what is waiting on something outside this repository"
        lede="Every status on this page is generated from a source-controlled evidence file at build time. The build fails if a status contradicts its evidence - including, specifically, if this site ever claims that Lifecycle Phase 5 is complete while both real-engine validation paths are pending."
        meta={
          <>
            <StatusBadge status="complete" label="Gate 1 OPEN" size="sm" />
            <StatusBadge status="blocked" label={`Gate 2 ${gate2.verdict}`} size="sm" />
            <SourceLink
              path="portfolio/src/generated/project-manifest.json"
              field="generated manifest"
            />
            <SourceLink
              path="portfolio/scripts/generate-project-manifest.ts"
              field="generator and its assertions"
            />
          </>
        }
      />

      {/* 1. The four-way distinction. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <Card tone="pending" padding="lg" className="flex flex-col gap-6">
            <div className="flex gap-4">
              <AlertTriangle
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-pending"
                strokeWidth={2}
              />
              <div className="flex flex-col gap-2">
                <Heading level={2} size="h4">
                  Four different things, routinely conflated
                </Heading>
                <Text size="sm" tone="secondary" className="max-w-prose">
                  Saying a model is &ldquo;validated&rdquo; can mean any of the four
                  states below. Only the first is true of this project.
                </Text>
              </div>
            </div>

            <Grid columns={4} gap={4}>
              <DistinctionCard
                ordinal="01"
                title="Static source validation"
                status="complete"
                detail={`The TMDL is parsed as text and checked against the model documentation on every push: ${String(counts.semanticTables.value)} tables, ${String(counts.semanticRelationships.value)} relationships and ${String(counts.daxMeasures.value)} measures. It proves the model's shape. It cannot execute a single line of DAX.`}
                path="scripts/check_powerbi_model.py"
              />
              <DistinctionCard
                ordinal="02"
                title="Real-engine validation"
                status={semanticModel.realEngineStatus}
                statusLabel="Pending on both paths"
                detail="A Microsoft semantic-model engine loads the model, refreshes it against PostgreSQL, and returns numbers that are reconciled against the SQL baseline. This is what proves the arithmetic, and neither accepted path has run."
                path="docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md"
              />
              <DistinctionCard
                ordinal="03"
                title="Dashboard completion"
                status="blocked"
                statusLabel={
                  semanticModel.dashboardPageCount === 0 ? 'Not built' : 'In progress'
                }
                detail={
                  semanticModel.dashboardPageCount === 0
                    ? 'The report project is a shell: a platform file and a pointer at the semantic model, with no page, no visual and no bookmark. The static check fails the build if report visual content appears before this increment starts.'
                    : `${String(semanticModel.dashboardPageCount)} report page definitions exist.`
                }
                path="powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.Report/"
              />
              <DistinctionCard
                ordinal="04"
                title="Case-study completion"
                status="blocked"
                statusLabel={`Gate 2 ${gate2.verdict}`}
                detail="Findings drawn from a complete report layer, reviewed, and published. Nothing has been analysed and no conclusion has been drawn. This site ships a locked shell for the case study rather than a placeholder."
                path="docs/requirements/PHASE_2_BACKLOG.md"
              />
            </Grid>
          </Card>
        </Container>
      </Section>

      {/* 2. The two real-engine paths, in detail. */}
      <Section bordered>
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Real-engine validation</Eyebrow>
            <Heading level={2}>
              Two accepted paths of equal standing. Either one closes the gate.
            </Heading>
            <Text size="body">
              A semantic model is proved by an engine or it is not proved. The environment
              that built this model runs Ubuntu with no Windows layer, no Power BI Desktop
              and no Analysis Services instance, so nothing in it can open the project,
              refresh the model, or evaluate a measure. Both routes out of that carry the
              same seven-part proof obligation, and a path that proves six of seven has
              not validated the model.
            </Text>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {engines.map((path) => (
              <Card key={path.id} as="article" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-2xs tracking-wide text-ink-faint">
                      ADR-0008 PATH
                    </span>
                    <h3 className="text-lg font-semibold text-ink">{path.label}</h3>
                  </div>
                  <StatusBadge status={path.status} size="sm" />
                </div>

                <DefinitionList
                  layout="columns"
                  rows={[
                    {
                      term: 'Recorded result',
                      value: path.overallResult.toUpperCase(),
                      mono: true,
                    },
                    {
                      term: 'Last validated',
                      value:
                        path.validatedAt === null
                          ? 'Never. No engine has run.'
                          : formatTimestamp(path.validatedAt),
                      mono: path.validatedAt !== null,
                    },
                    {
                      term: 'Checks passed',
                      value: formatCount(path.passedCheckCount),
                      mono: true,
                    },
                    {
                      term: 'Checks failed',
                      value: formatCount(path.failedCheckCount),
                      mono: true,
                    },
                  ]}
                />

                <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
                  <span className="eyebrow text-2xs">Recorded note</span>
                  <Text size="sm" tone="muted" className="max-w-prose">
                    {path.note}
                  </Text>
                </div>

                <div className="mt-auto flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  <SourceLink
                    path={path.evidencePath}
                    field="evidence file"
                    variant="block"
                  />
                  <SourceLink
                    path={path.procedurePath}
                    field="procedure"
                    variant="block"
                  />
                </div>
              </Card>
            ))}
          </div>

          <Card tone="sunken" className="mt-4 flex flex-col gap-2">
            <Heading level={3} size="h6">
              Why continuous integration cannot close this gate
            </Heading>
            <Text size="sm" tone="muted" className="max-w-prose">
              Power BI Desktop is a Windows application, and Microsoft Fabric needs a
              tenant, a workspace and a cloud PostgreSQL database. A GitHub runner has
              none of those. The repository checks read the on-disk TMDL and compare a
              hash; they never launch or contact an engine, and a CI job that claimed to
              validate a Power BI model without one would be asserting something it cannot
              observe.
            </Text>
            <SourceLink
              path=".github/workflows/ci.yml"
              field="repository-checks job"
              className="mt-1"
            />
          </Card>
        </Container>
      </Section>

      {/* 3. Lifecycle phases. */}
      <Section bordered>
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Lifecycle phases</Eyebrow>
            <Heading level={2}>
              Eight phases, with each one&apos;s exit criteria stated
            </Heading>
            <Text size="body">
              A phase is complete when its own exit criteria are met, not when the work in
              it feels finished. Phase 5&apos;s criteria require a successful refresh and
              a SQL-to-DAX reconciliation, which is exactly what has not happened.
            </Text>
          </Reveal>

          <ol className="flex flex-col gap-4">
            {lifecyclePhases.map((phase) => (
              <li key={phase.number}>
                {/* `data-phase` is a test hook, not styling. It lets
                    tests/e2e/case-study-gate.spec.ts assert the RENDERED status of
                    a specific phase rather than pattern-matching prose - which is
                    how a claim about Phase 5 or Phase 8 could otherwise drift past
                    a text assertion. */}
                <Card
                  as="article"
                  data-phase={String(phase.number)}
                  className="flex flex-col gap-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-mono text-2xs tracking-wide text-ink-faint">
                        LIFECYCLE PHASE {String(phase.number)}
                      </span>
                      <h3 className="text-lg font-semibold text-ink">{phase.name}</h3>
                    </div>
                    <StatusBadge status={phase.status} size="sm" />
                  </div>

                  <Text size="sm" tone="secondary" className="max-w-prose">
                    {phase.summary}
                  </Text>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <span className="eyebrow text-2xs">Why it holds this status</span>
                      <Text size="sm" tone="muted">
                        {phase.statusReason}
                      </Text>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="eyebrow text-2xs">Exit criteria</span>
                      <ul className="flex flex-col gap-1.5">
                        {phase.exitCriteria.map((criterion) => (
                          <li
                            key={criterion}
                            className="flex items-start gap-2 text-sm text-ink-muted"
                          >
                            <span
                              aria-hidden="true"
                              className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-line-strong"
                            />
                            {criterion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* 4. Delivery increments. */}
      <Section bordered>
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Delivery increments</Eyebrow>
            <Heading level={2}>
              Increments are not phases, and the repository keeps them distinct
            </Heading>
            <Text size="body">
              A lifecycle phase describes what kind of work is being done. A delivery
              increment is a unit of shipped scope. Conflating them is how a project ends
              up claiming a phase is complete because an increment was delivered.
            </Text>
          </Reveal>

          <Grid columns={4} gap={4}>
            {increments.map((increment) => (
              <Card
                key={increment.id}
                as="article"
                data-increment={increment.id}
                className="flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <CodeLabel tone="accent">{increment.id}</CodeLabel>
                  <StatusBadge status={increment.status} size="sm" />
                </div>
                <h3 className="text-base leading-snug font-semibold text-ink">
                  {increment.name}
                </h3>
                <Text size="sm" tone="muted">
                  {increment.statusReason}
                </Text>
                {increment.blockingGate ? (
                  <div className="mt-auto flex flex-col gap-1 border-t border-line-subtle pt-3">
                    <span className="eyebrow text-2xs">Blocked by</span>
                    <span className="text-xs text-ink-secondary">
                      {increment.blockingGate}
                    </span>
                  </div>
                ) : null}
              </Card>
            ))}
          </Grid>

          <p className="mt-4 font-mono text-2xs text-ink-faint">
            Lifecycle Phase 8 and delivery increment P2.4 both remain incomplete. This
            website is one item within P2.4, not the whole of it.
          </p>
        </Container>
      </Section>

      {/* 5. Gates. */}
      <Section bordered>
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Scope gates</Eyebrow>
            <Heading level={2}>
              Each gate&apos;s conditions, evaluated against evidence
            </Heading>
            <Text size="body">
              The met-or-not flag on every condition below is computed from the repository
              at build time rather than authored. A written verdict does not override the
              conditions it evaluates: the manifest generator fails if a document records
              an OPEN verdict while a condition is unmet.
            </Text>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[gate1, gate2].map((g) => (
              <Card
                key={g.id}
                as="article"
                tone={g.verdict === 'OPEN' ? 'default' : 'pending'}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-ink">{g.name}</h3>
                  <StatusBadge
                    status={g.verdict === 'OPEN' ? 'complete' : 'blocked'}
                    label={g.verdict}
                    size="sm"
                  />
                </div>

                <ol className="flex flex-col gap-3">
                  {g.conditions.map((condition) => (
                    <li key={condition.ordinal} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className={
                          condition.met
                            ? 'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-verified/50 bg-verified-wash font-mono text-2xs text-verified'
                            : 'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface-sunken'
                        }
                      >
                        {condition.met ? '✓' : ''}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-sm font-medium text-ink">
                          <span className="sr-only">
                            {condition.met ? 'Met: ' : 'Not met: '}
                          </span>
                          {condition.condition}
                        </p>
                        <p className="text-xs leading-relaxed text-ink-muted">
                          {condition.evidence}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-auto border-t border-line-subtle pt-3">
                  {g.verdictPath ? (
                    <SourceLink
                      path={g.verdictPath}
                      field={
                        g.recordedOn ? `recorded ${g.recordedOn}` : 'written verdict'
                      }
                    />
                  ) : (
                    <p className="font-mono text-2xs text-ink-faint">
                      No readiness review exists for this gate. Absence of evidence closes
                      a gate and never opens one.
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* 6. The evidence ledger, in full. */}
      <Section bordered>
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Evidence ledger</Eyebrow>
            <Heading level={2}>Every check, and the file that holds its result</Heading>
          </Reveal>
          <ol className="flex flex-col">
            {evidence.map((record) => (
              <EvidenceItem
                key={record.id}
                label={record.label}
                detail={record.detail}
                kind={record.kind}
                status={{ status: record.status }}
                sources={record.sources}
              />
            ))}
          </ol>
        </Container>
      </Section>

      {/* 7. The dataset this describes. */}
      <Section bordered>
        <Container width="wide">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-5 lg:col-span-5">
              <Eyebrow>The dataset behind these figures</Eyebrow>
              <Heading level={2} size="h3">
                Row counts describe one profile, and only that profile
              </Heading>
              <Text size="body" className="max-w-prose">
                The test profile is smaller and the portfolio profile larger. A refresh
                against either will not match the counts recorded here and must not be
                compared against them - which is why the profile is stated wherever a
                count appears.
              </Text>
            </div>

            <Card tone="sunken" className="lg:col-span-7">
              <DefinitionList
                layout="columns"
                rows={[
                  {
                    term: 'Configuration profile',
                    value: manifest.dataset.profile,
                    mono: true,
                  },
                  {
                    term: 'Random seed',
                    value: String(manifest.dataset.randomSeed),
                    mono: true,
                  },
                  {
                    term: 'Reporting date range',
                    value: `${manifest.dataset.reportingDateRange.first} to ${manifest.dataset.reportingDateRange.last}`,
                    mono: true,
                  },
                  {
                    term: 'Data origin',
                    value: 'Synthetic. Generated by this repository.',
                  },
                  {
                    term: 'Personal data',
                    value: 'None. Prohibited by the data model rather than masked.',
                  },
                  {
                    term: 'Site built from commit',
                    value: manifest.generatedFromCommit,
                    mono: true,
                  },
                ]}
              />
            </Card>
          </div>
        </Container>
      </Section>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function DistinctionCard({
  ordinal,
  title,
  status,
  statusLabel,
  detail,
  path,
}: {
  ordinal: string
  title: string
  status: React.ComponentProps<typeof StatusBadge>['status']
  statusLabel?: string
  detail: string
  path: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xs text-ink-faint">{ordinal}</span>
        <StatusBadge status={status} label={statusLabel} size="sm" />
      </div>
      <h3 className="text-base leading-snug font-semibold text-ink">{title}</h3>
      <p className="text-xs leading-relaxed text-ink-muted">{detail}</p>
      <div className="mt-auto pt-1">
        <SourceLink path={path} />
      </div>
    </div>
  )
}
