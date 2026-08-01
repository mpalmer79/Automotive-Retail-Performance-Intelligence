import type { Metadata } from 'next'

import { ArchitectureExplorer } from '@/components/explorers/architecture-explorer'
import { StatusBadge } from '@/components/ui/badge'
import { Container, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { SourceLink } from '@/components/ui/data-card'
import { pageMetadata } from '@/lib/metadata'
import { counts } from '@/lib/manifest'

export const metadata: Metadata = pageMetadata('architecture')

/**
 * The architecture page.
 *
 * The explorer is the page. The header states the shape of the pipeline in three
 * sentences so that a reader who never touches the diagram still leaves knowing
 * what it is, and the explorer's own noninteractive component list carries the
 * full detail.
 */
export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        eyebrow="Architecture"
        title="A layered batch pipeline, with every layer answerable"
        lede="Synthetic source data is generated deterministically from a seeded configuration profile, validated in memory, written to CSV with a content-digest manifest, and loaded into PostgreSQL, where it passes through raw, staging, warehouse and reporting. Every run records its outcome in an audit schema."
        supporting="Above the database sits a Power BI semantic model stored as TMDL - text, diffable, reviewable without a licence. It reads the reporting schema and nothing else. Two accepted paths exist to validate it on a real engine, and neither has run."
        platformNav
        meta={
          <>
            <StatusBadge
              status="complete"
              label="Pipeline complete through reporting"
              size="sm"
            />
            <StatusBadge
              status="pending-external"
              label="Semantic model: real-engine validation pending"
              size="sm"
            />
            <SourceLink path="ARCHITECTURE.md" field="binding architecture" />
            <SourceLink path="docs/diagrams/" field="source-controlled diagrams" />
          </>
        }
      />

      <Section rhythm="tight" tone="panel">
        <Container width="full">
          <ArchitectureExplorer />
        </Container>
      </Section>

      <Section rhythm="tight" tone="evidence">
        <Container width="wide">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <ScaleFigure
              value={counts.sqlScripts.value}
              label="Ordered SQL scripts"
              detail="Numbered so that lexical order is execution order. Re-runnable end to end against an empty database."
              path="sql/"
            />
            <ScaleFigure
              value={counts.reportingViews.value}
              label="Reporting views"
              detail="Eight dimension views, five grain-preserving fact views, and the governed analytical views that own the SQL side of every KPI."
              path="sql/05_reporting/"
            />
            <ScaleFigure
              value={counts.reconciliations.value}
              label="Reconciliations per run"
              detail="Each proves a number rather than asserting it. Every critical rule has been observed failing against a deliberately corrupted fixture."
              path="sql/08_validation/"
            />
          </div>
        </Container>
      </Section>
    </>
  )
}

function ScaleFigure({
  value,
  label,
  detail,
  path,
}: {
  value: number
  label: string
  detail: string
  path: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="numeric font-display text-4xl font-semibold tracking-tighter text-ink">
        {value}
      </span>
      <span className="text-base font-semibold text-ink-secondary">{label}</span>
      <span className="text-sm leading-relaxed text-ink-muted">{detail}</span>
      <SourceLink path={path} className="mt-1" />
    </div>
  )
}
