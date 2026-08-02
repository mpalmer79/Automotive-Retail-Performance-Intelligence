import type { Metadata } from 'next'
import { ArrowRight, Check, FileSpreadsheet, ShieldCheck, X } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Grid, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { inventoryOperations } from '@/lib/content'
import type { InventoryArtifact } from '@/types/content'
import { pageMetadata } from '@/lib/metadata'
import { Canvas } from '@/components/shell/field'

export const metadata: Metadata = pageMetadata('inventoryOperations')

/**
 * The Inventory Operations route.
 *
 * This is the one page on the site whose subject is NOT fully synthetic, and the
 * page is built around saying so rather than around getting away with not
 * saying so. The notice is the first thing under the header, the
 * can-prove/cannot-prove pair is given equal visual weight, and every number on
 * the page is a count of what the committed artifact contains — never a finding,
 * never a performance figure, and never attributed to a real dealership.
 *
 * `tests/unit/inventory-operations.test.ts` checks each of those counts against
 * `config/reference/inventory_listing_contract.yaml`, and
 * `tests/e2e/content-integrity.spec.ts` checks the rendered page for the notice
 * and for the claims it must never make.
 */
export default function InventoryOperationsPage() {
  const { artifact, artifacts, notice, problem, sanitization, canProve, cannotProve } =
    inventoryOperations

  // Summed here rather than authored, so the headline cannot disagree with the
  // cards beneath it when a fourth capture lands.
  const totalRows = artifacts.reduce((running, entry) => running + entry.rows, 0)
  const { pipeline, grain, views, report, multiStore, status, governance } =
    inventoryOperations

  return (
    <Canvas>
      <PageHeader
        eyebrow="Inventory operations"
        title="Ingesting something the project did not write"
        lede="Every other row in ARPI came from a generator ARPI also wrote, which exercises no sanitization, no source contract and no rejection path. This capability ingests a de-identified public inventory listing snapshot instead: a workbook with real-world shape, real-world mess, and a governance lane of its own."
        supporting={`The committed reference artifact holds ${String(artifact.rows)} listing rows for one fictional store on one capture date. Those are counts of what the file contains. They are not findings, not performance, and not attributable to any real dealership.`}
        platformNav
        meta={
          <>
            <StatusBadge status="complete" label="Implemented end to end" size="sm" />
            <SourceLink path={governance.adr} field="ADR-0011" />
            <SourceLink path={governance.policy} field="reference policy" />
            <SourceLink path={artifact.path} field="canonical workbook" />
          </>
        }
      />

      {/* 1. The notice, first, at full weight. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <Card tone="pending" padding="lg" className="flex gap-5">
            <ShieldCheck
              aria-hidden="true"
              className="mt-1 size-6 shrink-0 text-pending"
              strokeWidth={2}
            />
            <div className="flex flex-col gap-3">
              <Heading level={2} size="h4">
                This is the one part of ARPI that is not fully synthetic
              </Heading>
              <Text size="body" tone="secondary" className="max-w-prose">
                {notice}
              </Text>
              <Text size="sm" tone="muted" className="max-w-prose">
                Its correct classification is{' '}
                <strong className="text-ink-secondary">{artifact.classification}</strong>.
                The dealer and vehicle identifiers are synthetic; the listing attributes
                are retained from a de-identified public snapshot. The source dealership
                is not named anywhere in this repository, and it never will be.
              </Text>
              <div className="flex flex-wrap gap-3 pt-1">
                <SourceLink path={governance.adr} field="the decision" />
                <SourceLink path={governance.policy} field="the policy" />
              </div>
            </div>
          </Card>
        </Container>
      </Section>

      {/* 2. The operational problem. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>The operational problem</Eyebrow>
            <Heading level={2}>{problem.heading}</Heading>
            <Text size="body">{problem.why}</Text>
          </Reveal>
          <Grid columns={2} gap={4}>
            {problem.questions.map((question) => (
              <Card key={question} className="flex gap-3">
                <ArrowRight
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-accent"
                  strokeWidth={2.25}
                />
                <Text size="sm" tone="secondary">
                  {question}
                </Text>
              </Card>
            ))}
          </Grid>
        </Container>
      </Section>

      {/* 3. The source workbook contract and what sanitization removes. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>The source contract</Eyebrow>
            <Heading level={2}>What the sanitizer removes, and what it costs</Heading>
            <Text size="body">
              The private workbook stays outside the repository, always. What is committed
              is the output of a transformation that is deliberately one-way: the result
              cannot be traced back to a source listing, which is the point, and therefore
              cannot be re-verified against one.
            </Text>
          </Reveal>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left">
              <caption className="sr-only">
                What the sanitizer removes from a private inventory workbook and what
                replaces it
              </caption>
              <thead>
                <tr className="border-b border-hairline">
                  <th
                    scope="col"
                    className="py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    Removed
                  </th>
                  <th
                    scope="col"
                    className="py-3 pr-4 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    Replaced with
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    How
                  </th>
                </tr>
              </thead>
              <tbody>
                {sanitization.removed.map((row) => (
                  <tr key={row.field} className="border-b border-hairline align-top">
                    <th
                      scope="row"
                      className="py-4 pr-4 text-sm font-semibold text-ink-primary"
                    >
                      {row.field}
                    </th>
                    <td className="py-4 pr-4 text-sm text-ink-secondary">
                      {row.replacement}
                    </td>
                    <td className="py-4 text-sm text-ink-muted">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* 4. Can prove / cannot prove, side by side and equally weighted. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>The boundary</Eyebrow>
            <Heading level={2}>
              A listing proves that something was advertised, and nothing else
            </Heading>
            <Text size="body">
              The right-hand column is the more important one. Every item in it is
              enforced somewhere: in a view definition, in a column comment, in a CI check
              that fails the build if a document contradicts it.
            </Text>
          </Reveal>
          <Grid columns={2} gap={4}>
            <Card tone="accent" padding="lg" className="flex flex-col gap-4">
              <Heading level={3} size="h5">
                What this data can establish
              </Heading>
              <ul className="flex flex-col gap-3">
                {canProve.map((item) => (
                  <li key={item} className="flex gap-3">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-verified"
                      strokeWidth={2.5}
                    />
                    <Text size="sm" tone="secondary">
                      {item}
                    </Text>
                  </li>
                ))}
              </ul>
            </Card>
            <Card tone="pending" padding="lg" className="flex flex-col gap-4">
              <Heading level={3} size="h5">
                What it cannot, and must never be read as
              </Heading>
              <ul className="flex flex-col gap-3">
                {cannotProve.map((item) => (
                  <li key={item} className="flex gap-3">
                    <X
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-pending"
                      strokeWidth={2.5}
                    />
                    <Text size="sm" tone="secondary">
                      {item}
                    </Text>
                  </li>
                ))}
              </ul>
            </Card>
          </Grid>
        </Container>
      </Section>

      {/* 5. The ingestion path. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Source to report</Eyebrow>
            <Heading level={2}>
              Seven steps, and the private file never enters any of them twice
            </Heading>
          </Reveal>
          <ol className="flex flex-col gap-3">
            {pipeline.map((step, index) => (
              <li key={step.step}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-5">
                  <span
                    aria-hidden="true"
                    className="font-mono text-2xs font-semibold text-accent"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Heading level={3} size="h6">
                      {step.step}
                    </Heading>
                    <Text size="sm" tone="secondary">
                      {step.detail}
                    </Text>
                    <CodeLabel>{step.artifact}</CodeLabel>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* 6. The grain, stated once and enforced. */}
      <Section tone="evidence">
        <Container width="wide">
          <Grid columns={2} gap={4}>
            <div className="flex flex-col gap-5">
              <Eyebrow>The listing snapshot grain</Eyebrow>
              <Heading level={2}>{grain.statement}</Heading>
              <Text size="body">
                Declared once and enforced by the database, not by the importer&rsquo;s
                good intentions.
              </Text>
            </div>
            <Card padding="lg" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Text size="xs" tone="muted">
                  Natural key
                </Text>
                <CodeLabel>{grain.naturalKey}</CodeLabel>
              </div>
              <div className="flex flex-col gap-1.5">
                <Text size="xs" tone="muted">
                  Enforcement
                </Text>
                <Text size="sm" tone="secondary">
                  {grain.enforcement}
                </Text>
              </div>
              <div className="flex flex-col gap-1.5">
                <Text size="xs" tone="muted">
                  Immutability
                </Text>
                <Text size="sm" tone="secondary">
                  {grain.immutability}
                </Text>
              </div>
            </Card>
          </Grid>
        </Container>
      </Section>

      {/* 7. The reporting views and the governed KPIs. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Governed reporting</Eyebrow>
            <Heading level={2}>
              Six views, and one of them exists to stop a sentence being written
            </Heading>
            <Text size="body">
              Twenty-two governed KPIs sit on these views, each with its grain, formula,
              null rule, additivity and interpretation caution recorded in the catalogue.
              None of them is a DAX measure yet: the current semantic model is awaiting
              real-engine validation, and adding measures before that validation would
              change what is being validated.
            </Text>
          </Reveal>
          <Grid columns={2} gap={4}>
            {views.map((view) => (
              <Card key={view.name} className="flex flex-col gap-2">
                <CodeLabel>reporting.{view.name}</CodeLabel>
                <Text size="sm" tone="secondary">
                  {view.purpose}
                </Text>
              </Card>
            ))}
          </Grid>
          <div className="mt-6">
            <SourceLink path="KPI_CATALOG.md" field="Inventory Listings domain" />
          </div>
        </Container>
      </Section>

      {/* 8. The Excel operating report. */}
      <Section tone="evidence">
        <Container width="wide">
          <Grid columns={2} gap={4}>
            <div className="flex flex-col gap-5">
              <Eyebrow>The deliverable</Eyebrow>
              <Heading level={2}>An Excel report a dealership can actually open</Heading>
              <Text size="body">
                Built from the reporting views over PostgreSQL, never from the input
                workbook. A report assembled from its own source would prove nothing about
                the load. Formula-driven where a user will filter, values where two
                captures are being compared.
              </Text>
              <CodeLabel>{report.command}</CodeLabel>
              <CodeLabel>{report.output}</CodeLabel>
            </div>
            <Card padding="lg" className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet
                  aria-hidden="true"
                  className="size-4 shrink-0 text-accent"
                  strokeWidth={2}
                />
                <Heading level={3} size="h6">
                  What the workbook contains
                </Heading>
              </div>
              <ul className="flex flex-col gap-2.5">
                {report.sheets.map((sheet) => (
                  <li key={sheet}>
                    <Text size="sm" tone="secondary">
                      {sheet}
                    </Text>
                  </li>
                ))}
              </ul>
            </Card>
          </Grid>
        </Container>
      </Section>

      {/* 9. The committed artifacts, with every count stated as a count. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-8 flex max-w-prose flex-col gap-5">
            <Eyebrow>The committed artifacts</Eyebrow>
            <Heading level={2}>
              Three stores, one capture date, {totalRows} listing rows
            </Heading>
            <Text size="body">
              Every figure below is a count of what the files contain. None of them is a
              finding, a performance figure, or a statement about any real dealership.
              Where a capture could be misread, the reason is stated on the card rather
              than left for someone to discover.
            </Text>
          </Reveal>
          <div className="flex flex-col gap-4">
            {artifacts.map((entry) => (
              <ArtifactCard key={entry.dealershipId} artifact={entry} />
            ))}
          </div>
          <Card className="mt-6 flex flex-col gap-3">
            <Text size="sm" tone="secondary">
              Each name, such as{' '}
              <span className="font-mono text-xs text-ink-primary">
                {artifact.fileName}
              </span>
              , intentionally uses underscores between filename words and hyphens only
              inside the ISO date. Each is declared in the workbook contract with its
              SHA-256, each lives under its own store's directory, and no duplicate or
              alias copy of any of them exists anywhere in the repository.
            </Text>
            <div className="flex flex-wrap gap-3">
              <SourceLink path={artifact.path} field="download the workbook" />
              <SourceLink path={governance.contract} field="the contract" />
            </div>
          </Card>
        </Container>
      </Section>

      {/* 10. Multi-store readiness. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Multi-store</Eyebrow>
            <Heading level={2}>{multiStore.heading}</Heading>
          </Reveal>
          <ul className="flex flex-col gap-3">
            {multiStore.points.map((point) => (
              <li key={point}>
                <Card className="flex gap-3">
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-accent"
                    strokeWidth={2.25}
                  />
                  <Text size="sm" tone="secondary">
                    {point}
                  </Text>
                </Card>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 11. Implementation status, including what is deliberately not started. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Implementation status</Eyebrow>
            <Heading level={2}>What is finished, and what is deliberately not</Heading>
          </Reveal>
          <ul className="flex flex-col gap-3">
            {status.map((item) => (
              <li key={item.label}>
                <Card className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-5">
                  <StatusBadge
                    status={item.state}
                    size="sm"
                    className="shrink-0 self-start"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Heading level={3} size="h6">
                      {item.label}
                    </Heading>
                    <Text size="sm" tone="secondary">
                      {item.detail}
                    </Text>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 12. Governance, last, as the thing that made the rest allowable. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Public-reference governance</Eyebrow>
            <Heading level={2}>
              The exception is narrow, explicit, and checked by a machine
            </Heading>
            <Text size="body">
              ARPI&rsquo;s standing policy is that every row is machine generated. This
              lane is the only exception, and it exists on these terms.
            </Text>
          </Reveal>
          <ul className="flex flex-col gap-3">
            {governance.points.map((point) => (
              <li key={point}>
                <Card className="flex gap-3">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-verified"
                    strokeWidth={2}
                  />
                  <Text size="sm" tone="secondary">
                    {point}
                  </Text>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <SourceLink path={governance.adr} field="ADR-0011" />
            <SourceLink path={governance.policy} field="reference policy" />
            <SourceLink path={governance.contract} field="workbook contract" />
            <SourceLink path="PRIVACY_AND_ETHICS.md" field="privacy design" />
            <SourceLink path="LIMITATIONS.md" field="what this cannot support" />
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}

/**
 * One committed workbook, with its counts and the caveats a reader needs beside them.
 *
 * The caveats are not decoration. A partial capture's row count is a count of what was
 * visible, and an unpriced count is what stops a total advertised value being read as
 * the store's whole book. Both are rendered from the content file rather than written
 * into the component, and `tests/unit/inventory-operations.test.ts` checks them against
 * the workbook contract.
 */
function ArtifactCard({ artifact }: { artifact: InventoryArtifact }) {
  const unpriced = artifact.callForPriceUnits + artifact.priceNotExposedUnits
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading level={3} size="h6">
          {artifact.storeName}
        </Heading>
        <span className="font-mono text-xs text-ink-muted">{artifact.dealershipId}</span>
      </div>
      <Grid columns={4} gap={4}>
        <ArtifactCount value={artifact.rows} label="Reference rows" />
        <ArtifactCount
          value={artifact.usedUnits}
          label="Used-condition rows"
          detail={`${String(artifact.newUnits)} new`}
        />
        <ArtifactCount
          value={artifact.listedPriceUnits}
          label="Rows showing a price"
          detail={unpriced > 0 ? `${String(unpriced)} showing none` : undefined}
        />
        <ArtifactCount
          value={artifact.noOdometerUnits}
          label="Rows with no mileage"
          detail={artifact.noOdometerUnits > 0 ? 'Not rows with zero miles' : undefined}
        />
      </Grid>
      {artifact.coverage === 'partial' && artifact.coverageNote ? (
        <Text size="sm" tone="secondary">
          <strong className="text-ink-secondary">Partial capture.</strong>{' '}
          {artifact.coverageNote}
        </Text>
      ) : null}
      {artifact.priceNotExposedUnits > 0 ? (
        <Text size="sm" tone="secondary">
          <strong className="text-ink-secondary">
            {artifact.priceNotExposedUnits} listings published no price field
          </strong>{' '}
          and no mileage. That is a property of the listing surface, not a merchandising
          choice and not a defect, so it is counted separately from call-for-price. No
          price statistic and no average mileage can be computed for those rows, and the
          lane reports them as a count rather than as a zero.
        </Text>
      ) : null}
    </Card>
  )
}

/** One count from a committed artifact, labelled as a count and never as a finding. */
function ArtifactCount({
  value,
  label,
  detail,
}: {
  value: number
  label: string
  detail?: string
}) {
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="font-mono text-3xl font-semibold text-ink-primary tabular-nums">
        {value}
      </span>
      <Text size="sm" tone="secondary">
        {label}
      </Text>
      {detail ? (
        <Text size="xs" tone="muted">
          {detail}
        </Text>
      ) : null}
    </Card>
  )
}
