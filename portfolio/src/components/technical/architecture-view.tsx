import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { ArchitectureExplorer } from '@/components/explorers/architecture-explorer'
import { StatusBadge } from '@/components/ui/badge'
import { Container, Section } from '@/components/ui/layout'
import { Disclosure } from '@/components/ui/disclosure'
import { SourceLink } from '@/components/ui/data-card'
import { Text } from '@/components/ui/typography'
import { FlowDiagram, type FlowStage } from '@/components/visuals/flow'
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

      {/* THE LAYER STACK, BEFORE THE EXPLORER.
          The explorer is the page and stays the page. What it could not be is the
          FIRST thing: it is a client island whose diagram begins nearly a
          thousand pixels down at 1440 × 900 and 1,438 px down on a phone, so a
          reader met the layer names in a paragraph before meeting them as a
          shape. This chain is the same six layers the explorer details, drawn
          once, on the server, above it. */}
      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <FlowDiagram
            label="The layers a row passes through, in order"
            stages={LAYERS}
            caption="Each layer is answerable on its own: the audit schema records every run's outcome, and the reporting schema is the only one the semantic model may read."
          />
        </Container>
      </Section>

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
              detail="Numbered so lexical order is execution order. Re-runnable end to end against an empty database."
              path="sql/"
            />
            <ScaleFigure
              value={counts.reportingViews.value}
              label="Reporting views"
              detail="Eight dimension views, five grain-preserving fact views, and the governed analytical views behind every KPI."
              path="sql/05_reporting/"
            />
            <ScaleFigure
              value={counts.reconciliations.value}
              label="Reconciliations per run"
              detail="Each proves a number rather than asserting it, and every critical rule has been observed failing."
              path="sql/08_validation/"
            />
          </div>

          {/* HOW THE PIPELINE REACHES THE BROWSER.
              A disclosure rather than a section, and the label names the claim.
              This is supplemental engineering reasoning about a delivery
              mechanism, not a qualification on how a figure should be read, so it
              is on the permitted side of the line `disclosure.tsx` draws. */}
          <Disclosure
            label="Why no page on this site has a loading state"
            className="mt-10"
          >
            <Text size="sm" tone="muted" className="max-w-prose">
              The last layer is a build step, not a server. Records are read from the
              workbooks and the export at build time and ship as data, so a filter is a
              synchronous pass over rows that arrived with the page. Sorting by price puts
              an unpriced listing last in both directions rather than treating a missing
              price as zero.
            </Text>
          </Disclosure>
        </Container>
      </Section>
    </>
  )
}

/**
 * The six layers, named exactly as the schemas are named.
 *
 * `Semantic model` carries its pending state as a word. It is the one stage of
 * this pipeline that has never been executed by the engine it is written for, and
 * a diagram that drew it like the other five would be the diagram making the
 * claim the rest of this site refuses to make.
 */
const LAYERS: readonly FlowStage[] = [
  { label: 'Generated CSV', detail: 'With a content-digest manifest' },
  { label: 'raw', detail: 'Landed as untyped text, digest retained' },
  { label: 'staging', detail: 'Typed, deduplicated, rejections kept' },
  { label: 'warehouse', detail: 'Conformed dimensions and declared grain' },
  { label: 'reporting', detail: 'The published surface', tone: 'accent' },
  {
    label: 'Semantic model',
    detail: 'TMDL, import mode, reporting schema only',
    tone: 'pending',
    state: 'Never loaded by an engine',
  },
]

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
