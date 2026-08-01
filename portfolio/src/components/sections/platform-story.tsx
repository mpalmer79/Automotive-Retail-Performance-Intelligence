/**
 * Chapter four: how the platform is built.
 *
 * Five stages, one sentence each, one state each. The full detail lives on
 * `/architecture`, and this section's job is to make a reader want to go there
 * rather than to substitute for it.
 *
 * WHAT THIS REPLACES
 * ------------------
 * An eight-stage scrollytelling walkthrough that occupied roughly 1,900 pixels
 * of the home page, loaded the animation library to transition eight rectangle
 * widths, and threw a console error eight times per render doing it (finding
 * B-04). The stage list it rendered duplicated the architecture page almost
 * exactly.
 *
 * Five stages rather than eight: `generate` and `validate` were three stages
 * between them, and `raw`, `staging` and `warehouse` are one idea - the data
 * being modelled - at the altitude a home page should operate at.
 *
 * Server component. Its only motion is the shared reveal.
 */
import { ArrowRight } from 'lucide-react'

import { Reveal, RevealGroup, RevealItem } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import { ROUTES } from '@/lib/site'
import type { StatusLevel } from '@/types/manifest'

interface Stage {
  readonly ordinal: string
  readonly label: string
  readonly sentence: string
  /** The one thing that makes the stage checkable. */
  readonly evidence: string
  readonly status: StatusLevel
  readonly statusLabel: string
}

/**
 * The five stages.
 *
 * Statuses are literal, and the fifth is the honest one: the reporting layer is
 * built and the semantic model above it has never been evaluated, so "serve" is
 * complete on the SQL side and pending above it. Splitting the difference and
 * calling the whole stage complete is exactly the elision this project refuses.
 */
const STAGES: readonly Stage[] = [
  {
    ordinal: '01',
    label: 'Generate',
    sentence:
      'Synthetic dealership activity is produced from a seeded configuration profile, so the same inputs always produce the same dataset.',
    evidence: 'Deterministic, seeded, re-runnable',
    status: 'complete',
    statusLabel: 'Built',
  },
  {
    ordinal: '02',
    label: 'Validate',
    sentence: `${String(counts.dataQualityChecks.value)} checks run in memory with declared severities before a single row reaches the database, and every critical rule has been watched failing against a deliberately corrupted fixture.`,
    evidence: `${String(counts.dataQualityChecks.value)} checks, negative test per critical rule`,
    status: 'complete',
    statusLabel: 'Built',
  },
  {
    ordinal: '03',
    label: 'Model',
    sentence: `Raw, staging and warehouse in PostgreSQL: ${String(counts.dimensions.value)} conformed dimensions and ${String(counts.facts.value)} facts, each fact's grain declared in the data dictionary and enforced by a UNIQUE constraint in DDL.`,
    evidence: `${String(counts.sqlScripts.value)} ordered SQL scripts`,
    status: 'complete',
    statusLabel: 'Built',
  },
  {
    ordinal: '04',
    label: 'Govern',
    sentence: `${String(counts.governedKpis.value)} KPIs, each with a formula, both sides of its ratio, a grain, a date basis, a null rule and an interpretation caution. ${String(counts.reconciliations.value)} reconciliations are recorded on every database run.`,
    evidence: 'A metric with no denominator states so explicitly',
    status: 'complete',
    statusLabel: 'Built',
  },
  {
    ordinal: '05',
    label: 'Serve',
    sentence: `${String(counts.reportingViews.value)} reporting views are the only surface anything above may read, and a read-only role is provably confined to them. The Power BI semantic model above them is written and statically checked, and no Microsoft engine has ever loaded it.`,
    evidence: `${String(counts.daxMeasures.value)} DAX measures written, none evaluated`,
    status: 'pending-external',
    statusLabel: 'SQL built, engine pending',
  },
]

export function PlatformStory() {
  return (
    <Section id="platform" tone="canvas">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="How it is built"
          title="Five stages, and one of them is honest about where it stops."
          lede="Each stage is re-runnable end to end against an empty database. The architecture page has the layer-by-layer detail."
          action={
            <LinkButton
              href={ROUTES.architecture.href}
              variant="secondary"
              iconAfter={<ArrowRight />}
              className="shrink-0"
            >
              Explore the full architecture
            </LinkButton>
          }
        />

        {/* A horizontal run on a wide screen, a vertical one below it. The
            stages are connected by a rule rather than boxed, because they are a
            sequence and a row of five cards reads as five options. */}
        <RevealGroup
          as="ol"
          className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5"
        >
          {STAGES.map((stage, index) => (
            <RevealItem
              key={stage.ordinal}
              as="li"
              index={index}
              className="flex flex-col gap-4 bg-canvas p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="numeric font-mono text-2xs tracking-wide text-accent">
                  {stage.ordinal}
                </span>
                <StatusBadge status={stage.status} label={stage.statusLabel} size="sm" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-tight text-ink">
                {stage.label}
              </h3>
              <Text size="sm" tone="muted" className="grow">
                {stage.sentence}
              </Text>
              <p className="border-t border-line-subtle pt-3 font-mono text-2xs leading-normal text-ink-faint">
                {stage.evidence}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-8">
          <Text size="sm" tone="muted" className="max-w-prose">
            Stage five is where the project actually stands. The database side is finished
            and reconciled; the semantic model on top of it is written, source-controlled
            as TMDL, and unproven until an engine has loaded it and returned a number that
            reconciles.
          </Text>
        </Reveal>
      </Container>
    </Section>
  )
}
