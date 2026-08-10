import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { ArchitectureExplorer } from '@/components/explorers/architecture-explorer'
import { StatusBadge } from '@/components/ui/badge'
import { Container, Section } from '@/components/ui/layout'
import { SourceLink } from '@/components/ui/data-card'
import { Heading, Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'

/**
 * The architecture page.
 *
 * The explorer is the page. The header states the shape of the pipeline in three
 * sentences so that a reader who never touches the diagram still leaves knowing
 * what it is, and the explorer's own noninteractive component list carries the
 * full detail.
 */
export function ArchitectureView() {
  return (
    <>
      <TechnicalViewMeta>
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
      </TechnicalViewMeta>

      <Section rhythm="tight" tone="panel">
        <Container width="full">
          <ArchitectureExplorer />
        </Container>
      </Section>

      {/* HOW THE PIPELINE REACHES THE BROWSER.
          Moved here from the home page's product tour, where it was a disclosure
          under the inventory step. It is an engineering note about the platform
          rather than a decision about the inventory surface, and this is the page
          that carries the platform. */}
      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <div className="flex max-w-prose flex-col gap-3">
            <Heading level={2} size="h4">
              The last layer is a build step, not a server
            </Heading>
            <Text size="body" tone="muted">
              There is no request and no loading state anywhere on this site. The record
              set was read from the workbooks at build time and ships as data, so a filter
              in the inventory explorer is a synchronous pass over rows that arrived with
              the page. Sorting by price puts an unpriced listing last in both directions
              rather than treating a missing price as zero, because a listing the source
              did not price is not the cheapest car on the lot.
            </Text>
          </div>
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
