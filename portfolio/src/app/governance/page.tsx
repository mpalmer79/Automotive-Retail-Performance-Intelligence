import type { Metadata } from 'next'
import { AlertTriangle, Ban, FileCheck2, Scale, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Grid, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { TrustFramework } from '@/components/sections/trust-framework'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { gate, counts } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { SYNTHETIC_DATA_STATEMENT } from '@/lib/site'

export const metadata: Metadata = pageMetadata('governance')

/**
 * The governance page.
 *
 * Governance is presented as a product strength rather than a legal appendix,
 * which means it leads with the constraints that changed the build: no PII by
 * construction, a reporting role that provably cannot read the pipeline, an
 * attribution limitation stated on the measure, and scope gates that actually
 * block work rather than describing an intention to.
 *
 * The synthetic-data statement gets the top of the page - not a footer, not a
 * modal, not small print. `suppressTrustLine` on the header is set because
 * the body states it more prominently immediately below.
 */
export default function GovernancePage() {
  const gate1 = gate('gate-1')
  const gate2 = gate('gate-2')

  return (
    <>
      <PageHeader
        eyebrow="Governance and privacy"
        title="The constraints are the design, not a disclaimer at the end of it"
        lede="Every commitment on this page changed something in the build: a column that does not exist, a role that cannot read a schema, a measure that carries its own caution, a gate that blocks an increment. A governance section that could be deleted without changing the code would not be governance."
        meta={
          <>
            <SourceLink path="PRIVACY_AND_ETHICS.md" field="privacy design" />
            <SourceLink path="LIMITATIONS.md" field="what this cannot support" />
            <SourceLink path="SECURITY.md" field="secret handling" />
          </>
        }
        platformNav
        suppressTrustLine
      />

      {/* 1. The synthetic-data statement, in full, at the top. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <Card tone="pending" padding="lg" className="flex gap-5">
            <AlertTriangle
              aria-hidden="true"
              className="mt-1 size-6 shrink-0 text-pending"
              strokeWidth={2}
            />
            <div className="flex flex-col gap-3">
              <Heading level={2} size="h4">
                This project contains no real data, and never will
              </Heading>
              <Text size="body" tone="secondary" className="max-w-prose">
                {SYNTHETIC_DATA_STATEMENT}
              </Text>
              <Text size="sm" tone="muted" className="max-w-prose">
                Granite State Auto Group, its three stores, its staff and its customers
                were invented to give the data model a coherent business context. Every
                figure the project can produce comes from documented rules and a fixed
                random seed. Nothing here should be read as, compared against, or cited as
                the performance of any real automotive retailer.
              </Text>
              <div className="flex flex-wrap gap-3 pt-1">
                <SourceLink path="PRIVACY_AND_ETHICS.md" field="section 2" />
                <SourceLink path="DATA_GENERATION.md" field="generation rules" />
              </div>
            </div>
          </Card>
        </Container>
      </Section>

      {/* 2. The interactive trust framework. */}
      <Section tone="evidence">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>The trust framework</Eyebrow>
            <Heading level={2}>Five layers, each with something that enforces it</Heading>
            <Text size="body">
              Select a layer to see the controls it holds and the file that implements
              each one. A control with no enforcement mechanism is a preference, and this
              page distinguishes the two.
            </Text>
          </Reveal>
          <TrustFramework />
        </Container>
      </Section>

      {/* 3. What is prohibited by construction. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>Prohibited by construction</Eyebrow>
            <Heading level={2}>
              These attributes are not redacted. They do not exist in the model.
            </Heading>
            <Text size="body">
              Data minimisation here means the column was never designed, not that it is
              masked. A masked column can be unmasked; a column that does not exist cannot
              leak.
            </Text>
          </Reveal>

          <Grid columns={2} gap={4}>
            <ProhibitionCard
              icon={<Ban />}
              title="Personal identifiers"
              items={[
                'Names - customer, employee or otherwise',
                'Street addresses',
                'Email addresses and phone numbers',
                'Full birth dates - age is stored as a band',
                'Government identifiers',
                'Bank and card information',
              ]}
              enforcement="src/arpi/validation/privacy.py"
            />
            <ProhibitionCard
              icon={<ShieldCheck />}
              title="Real-world linkage"
              items={[
                'No real dealership, real store or real dealer group',
                'No real VIN linked to a synthetic customer',
                'No lender, lending decision or credit data',
                'No data scraped or approximated from a real source',
                'Geography stops at county or market area',
                'No manufacturer or dealership logo or trade dress',
              ]}
              enforcement="docs/architecture-decisions/ADR-0005-synthetic-vin-policy.md"
            />
          </Grid>
        </Container>
      </Section>

      {/* 4. Fairness and interpretation limits. */}
      <Section tone="panel">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
            <Reveal className="flex flex-col gap-5 lg:col-span-5">
              <Eyebrow>Fairness and interpretation</Eyebrow>
              <Heading level={2}>
                The limits are on the measure, not in a footnote somewhere else.
              </Heading>
              <Text size="body" className="max-w-prose">
                A limitation recorded only in a separate document is a limitation nobody
                reads at the moment it matters. In this project the caution travels with
                the KPI: it is a required field in the catalogue, it is rendered on the
                KPI catalogue page, and it is part of the measure&apos;s description in
                the semantic model.
              </Text>
              <SourceLink path="KPI_CATALOG.md" field="interpretation caution per KPI" />
            </Reveal>

            <div className="flex flex-col gap-4 lg:col-span-7">
              <LimitCard
                icon={<Scale />}
                title="Employee scorecards carry context or they do not ship"
                body="Volume alone never ranks a person. A high-volume salesperson may show weak gross retention, poor follow-up, heavy discounting, or simply favourable lead routing. Any view that displays employee results must state how it shows lead quality, store traffic, tenure and vehicle mix alongside the number."
                artefact="ARCHITECTURE.md section 23"
              />
              <LimitCard
                icon={<Scale />}
                title="Attribution is first-touch, and that is a limitation"
                body="A lead is credited to the source that produced it, once. Multi-touch journeys are not modelled, so a campaign that assisted a sale without originating the lead receives no credit. This is a deliberate simplification of a genuinely hard problem, and marketing return figures must be read with it in mind."
                artefact="KPI-MKT-003 interpretation caution"
              />
              <LimitCard
                icon={<Scale />}
                title="Correlation is never presented as causation"
                body="The synthetic generators contain correlations because a plausible dataset needs them. Those correlations were written by the generator, so no finding drawn from this data may claim that one thing causes another - in the data or in the industry. This is why the project draws no conclusion about automotive retail at all."
                artefact="LIMITATIONS.md"
              />
              <LimitCard
                icon={<Scale />}
                title="Deferred domains produce no conclusions"
                body="F&I penetration, customer retention, service-to-sales opportunity and target attainment all depend on facts that have not been built. No result requiring a deferred fact may be published, which rules those four subjects out of any finding until the facts exist."
                artefact="KPI_CATALOG.md section 35"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* 5. The gate system. */}
      <Section tone="canvas">
        <Container width="wide">
          <Reveal className="mb-10 flex max-w-prose flex-col gap-5">
            <Eyebrow>The gate system</Eyebrow>
            <Heading level={2}>Gates that block work, evaluated in writing</Heading>
            <Text size="body">
              A gate is opened by a written review that evaluates each of its conditions
              against a query or a test, not by a decision made on the way to starting the
              next thing. Two of the four gates are relevant now.
            </Text>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[gate1, gate2].map((g) => (
              <Card key={g.id} as="article" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-2xs tracking-wide text-ink-faint">
                      {g.id.toUpperCase().replace('-', ' ')}
                    </span>
                    <h3 className="text-lg font-semibold text-ink">{g.name}</h3>
                  </div>
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
                        g.recordedOn
                          ? `verdict recorded ${g.recordedOn}`
                          : 'written verdict'
                      }
                    />
                  ) : (
                    <p className="font-mono text-2xs text-ink-faint">
                      No readiness review has been written for this gate yet, which is
                      itself why it is closed. Absence of evidence closes a gate and never
                      opens one.
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* 6. Secret handling. */}
      <Section tone="evidence">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
            <Reveal className="flex flex-col gap-5 lg:col-span-5">
              <Eyebrow>Secrets and access</Eyebrow>
              <Heading level={2}>
                Nothing in this repository can be run by finding a password in it.
              </Heading>
              <Text size="body" className="max-w-prose">
                The database password is never read from a configuration file - only from
                an environment variable. Continuous integration runs to completion on a
                fork with zero repository secrets configured, and the only credential
                anywhere in the workflow is the throwaway password of a container that
                lives and dies inside one job.
              </Text>
            </Reveal>

            <div className="flex flex-col gap-4 lg:col-span-7">
              <LimitCard
                icon={<FileCheck2 />}
                title="Three roles, and the reporting role is provably confined"
                body="arpi_admin owns the objects, arpi_loader writes the pipeline layers, and arpi_reporter reads the reporting schema. The reporter's inability to read raw, staging, warehouse or audit is asserted end to end by a test that attempts each read and requires it to fail - not described in a grants script and hoped for."
                artefact="tests/integration/test_reporter_role_end_to_end.py"
              />
              <LimitCard
                icon={<FileCheck2 />}
                title="A secret check runs on every push"
                body="A safety net rather than a full scanner: it fails the build if a tracked file looks like it holds a credential - a committed .env, a live connection string with an embedded password, or a private key. The manifest generator that feeds this website applies the same patterns to its own output and refuses to write a file that matches one."
                artefact="scripts/check_secrets.py"
              />
              <LimitCard
                icon={<FileCheck2 />}
                title={`${String(counts.reconciliations.value)} reconciliations, and every critical one has been seen to fail`}
                body="A check that has never failed is a check nobody has tested. Every critical reconciliation rule in this project has been run against a deliberately corrupted fixture and observed to fail, which is the only way to know it would catch the thing it exists to catch."
                artefact="tests/integration/test_reconciliations.py"
              />
            </div>
          </div>
        </Container>
      </Section>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function ProhibitionCard({
  icon,
  title,
  items,
  enforcement,
}: {
  icon: ReactNode
  title: string
  items: readonly string[]
  enforcement: string
}) {
  return (
    <Reveal child className="flex">
      <Card as="article" className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-sunken text-accent [&>svg]:size-4"
          >
            {icon}
          </span>
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
        </div>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 text-sm text-ink-secondary"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-failed/70"
              />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-1.5 border-t border-line-subtle pt-3">
          <span className="eyebrow text-2xs">Enforced by</span>
          <SourceLink path={enforcement} />
        </div>
      </Card>
    </Reveal>
  )
}

function LimitCard({
  icon,
  title,
  body,
  artefact,
}: {
  icon: ReactNode
  title: string
  body: string
  artefact: string
}) {
  return (
    <Reveal child>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-sunken text-ink-muted [&>svg]:size-3.5"
          >
            {icon}
          </span>
          <h3 className="text-base leading-snug font-semibold text-ink">{title}</h3>
        </div>
        <Text size="sm" tone="muted" className="max-w-prose">
          {body}
        </Text>
        <div className="flex items-center gap-2 border-t border-line-subtle pt-3">
          <span className="eyebrow text-2xs">In the repository</span>
          <CodeLabel tone="bare" className="text-2xs">
            {artefact}
          </CodeLabel>
        </div>
      </Card>
    </Reveal>
  )
}
