import type { Metadata } from 'next'

import { Badge, KpiChip, StatusBadge } from '@/components/ui/badge'
import { Button, IconButton, LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { DefinitionList, MetricCount, SourceLink } from '@/components/ui/data-card'
import { Container, Cluster, Grid, Section, Stack } from '@/components/ui/layout'
import { EmptyState, LockedState } from '@/components/ui/states'
import { CodeLabel, Eyebrow, GrainLabel, Heading, Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ArrowRight } from 'lucide-react'

/**
 * The UI lab.
 *
 * An internal reference for the design system: every token group and every
 * component in one place, so a change to a token can be assessed against all of
 * its consumers at once.
 *
 * IT IS NOT A USER-FACING FEATURE
 * -------------------------------
 *   - It is excluded from primary navigation, from the footer, and from the
 *     sitemap (`indexable: false` on its route definition).
 *   - `robots.ts` disallows it on every environment, production included.
 *   - Its own metadata sets `index: false, follow: false`.
 *   - It is not linked from any page a visitor would reach.
 *
 * Four independent exclusions, because a design-system page that leaks into
 * search results makes a portfolio site look like a template.
 */
export const metadata: Metadata = pageMetadata('uiLab', {
  robots: { index: false, follow: false, nocache: true },
})

export default function UiLabPage() {
  return (
    <>
      <Section rhythm="none" className="pt-8 pb-section-tight">
        <Container width="wide">
          <Stack gap={5}>
            <Eyebrow tone="accent">Internal reference</Eyebrow>
            <Heading level={1}>UI lab</Heading>
            <Text size="body" className="max-w-prose">
              Every design token and every component in the ARPI design system, on one
              page. Not part of the site&apos;s navigation, excluded from the sitemap, and
              disallowed in robots.txt on every environment including production.
            </Text>
            <Cluster>
              <SourceLink
                path="portfolio/docs/DESIGN_SYSTEM.md"
                field="token documentation"
              />
              <SourceLink
                path="portfolio/docs/MOTION_SYSTEM.md"
                field="motion documentation"
              />
            </Cluster>
          </Stack>
        </Container>
      </Section>

      <Lab title="Colour" bordered>
        <Grid columns={4} gap={4}>
          {SWATCHES.map((swatch) => (
            <div key={swatch.variable} className="flex flex-col gap-2">
              {/* The class is written out per swatch rather than interpolated.
                  Tailwind resolves utilities by scanning source text, so
                  `bg-${token}` would compile to nothing and the swatches would
                  all render transparent. */}
              <div
                className={`h-16 rounded-lg border border-line ${swatch.className}`}
                aria-hidden="true"
              />
              <CodeLabel tone="bare" className="text-2xs">
                --color-{swatch.variable}
              </CodeLabel>
              <span className="text-xs text-ink-muted">{swatch.label}</span>
            </div>
          ))}
        </Grid>
      </Lab>

      <Lab title="Typography" bordered>
        <Stack gap={6}>
          <Heading level={2} size="hero">
            Hero — display, 5xl
          </Heading>
          <Heading level={2} size="display">
            Display — display, 4xl
          </Heading>
          <Heading level={2} size="h2">
            Heading 2 — display, 3xl
          </Heading>
          <Heading level={3} size="h3">
            Heading 3 — sans, 2xl
          </Heading>
          <Heading level={4} size="h4">
            Heading 4 — sans, xl
          </Heading>
          <Text size="body">
            Body copy at 17px with relaxed leading, capped at 68 characters by the Prose
            primitive. This is the reading size, used for lede paragraphs and narrative
            sections.
          </Text>
          <Text size="base">
            Base copy at 15px. The interface default, used for card bodies and dense
            contexts.
          </Text>
          <Text size="sm" tone="muted">
            Small copy at 13px, muted. Table cells and card metadata.
          </Text>
          <Text size="xs" tone="faint">
            Extra small at 12px, faint. Captions and provenance.
          </Text>
          <Eyebrow>Eyebrow — mono, uppercase, tracked out</Eyebrow>
          <Cluster>
            <CodeLabel>reporting.vw_vehicle_sales</CodeLabel>
            <CodeLabel tone="accent">KPI-GRS-006</CodeLabel>
            <CodeLabel tone="model">vw_calendar</CodeLabel>
          </Cluster>
          <GrainLabel grain="One row per vehicle sale transaction, per store, per day" />
        </Stack>
      </Lab>

      <Lab title="Buttons" bordered>
        <Stack gap={6}>
          <Cluster>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="chip" size="sm">
              Chip
            </Button>
            <Button variant="chipActive" size="sm">
              Chip active
            </Button>
          </Cluster>
          <Cluster>
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="primary" size="md">
              Medium
            </Button>
            <Button variant="primary" size="lg">
              Large
            </Button>
          </Cluster>
          <Cluster>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button variant="secondary" iconAfter={<ArrowRight />}>
              With icon
            </Button>
            <IconButton label="An icon-only action">
              <ArrowRight />
            </IconButton>
            <LinkButton href="/" variant="secondary">
              Internal link
            </LinkButton>
            <LinkButton href="https://example.com" variant="ghost" external>
              External link
            </LinkButton>
          </Cluster>
        </Stack>
      </Lab>

      <Lab title="Status vocabulary" bordered>
        <Stack gap={4}>
          <Text size="sm" tone="muted" className="max-w-prose">
            Each status renders an icon and a word, and the icon differs per status rather
            than only changing hue. Remove all colour and every badge still reads
            correctly.
          </Text>
          <Cluster>
            <StatusBadge status="complete" />
            <StatusBadge status="in-progress" />
            <StatusBadge status="pending-external" />
            <StatusBadge status="blocked" />
            <StatusBadge status="deferred" />
            <StatusBadge status="not-started" />
          </Cluster>
          <Cluster>
            <Badge tone="neutral">Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="model">Model</Badge>
            <Badge tone="verified">Verified</Badge>
            <Badge tone="pending">Pending</Badge>
            <Badge tone="deferred">Deferred</Badge>
            <Badge tone="failed">Failed</Badge>
            <KpiChip id="KPI-INV-006" name="Aged inventory percentage" />
          </Cluster>
        </Stack>
      </Lab>

      <Lab title="Surfaces and data display" bordered>
        <Grid columns={3} gap={4}>
          <Card>
            <Stack gap={2}>
              <Heading level={3} size="h5">
                Default card
              </Heading>
              <Text size="sm" tone="muted">
                Border, contained shadow, one-pixel inset top highlight.
              </Text>
            </Stack>
          </Card>
          <Card tone="sunken">
            <Stack gap={2}>
              <Heading level={3} size="h5">
                Sunken card
              </Heading>
              <Text size="sm" tone="muted">
                For a panel nested inside another surface.
              </Text>
            </Stack>
          </Card>
          <Card tone="pending">
            <Stack gap={2}>
              <Heading level={3} size="h5">
                Pending card
              </Heading>
              <Text size="sm" tone="muted">
                Reserved for a genuinely pending or cautionary statement.
              </Text>
            </Stack>
          </Card>
        </Grid>

        <Grid columns={2} gap={6} className="mt-6">
          <Card>
            <DefinitionList
              layout="columns"
              rows={[
                { term: 'Primary key', value: 'sale_key', mono: true },
                { term: 'History policy', value: 'Transactional - no history' },
                { term: 'Privacy', value: 'No personal data. Prohibited by the model.' },
              ]}
            />
          </Card>
          <Card>
            {/* Read from the manifest, not written. Even a design-system demo
                that renders "42 Semantic relationships" with a source link is a
                claim about the project, and the content-integrity test correctly
                flagged the literal when this was hardcoded. */}
            <MetricCount
              value={counts.semanticRelationships.value}
              label={counts.semanticRelationships.label}
              detail={counts.semanticRelationships.detail}
              sources={counts.semanticRelationships.sources}
            />
          </Card>
        </Grid>
      </Lab>

      <Lab title="States" bordered>
        <Stack gap={6}>
          <EmptyState
            title="No metric matches"
            description="An empty state names the reason and offers the way out. It is not the same thing as a locked state."
            action={<Button variant="secondary">Clear filters</Button>}
          />
          <LockedState
            title="A locked state"
            reason="Content that deliberately does not exist yet. It names the gate, lists checkable conditions, and always offers somewhere else to go. It never shows a date."
            conditions={[
              { label: 'A condition that is met', met: true },
              { label: 'A condition that is not met', met: false },
            ]}
            alternatives={
              <LinkButton href="/" variant="secondary" iconAfter={<ArrowRight />}>
                Somewhere with content
              </LinkButton>
            }
          />
        </Stack>
      </Lab>

      <Lab title="Layout primitives">
        <Stack gap={6}>
          <div>
            <Eyebrow>Grid, 12 columns</Eyebrow>
            <Grid columns={12} gap={2} className="mt-3">
              {Array.from({ length: 12 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-sm bg-accent-wash py-3 text-center font-mono text-2xs text-accent"
                >
                  {index + 1}
                </div>
              ))}
            </Grid>
          </div>
          <div>
            <Eyebrow>Cluster, wrapping</Eyebrow>
            <Cluster className="mt-3">
              {[
                'Sales',
                'Gross',
                'Inventory',
                'Lead funnel',
                'Marketing',
                'Data quality',
              ].map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
            </Cluster>
          </div>
          <div>
            <Eyebrow>Marked rule</Eyebrow>
            <div className="rule-marked mt-3 pt-3">
              <Text size="sm" tone="muted">
                A hairline with alignment ticks at each end - the blueprint motif.
              </Text>
            </div>
          </div>
        </Stack>
      </Lab>
    </>
  )
}

/**
 * The colour swatches. Each carries its literal utility class, because Tailwind
 * discovers utilities by scanning source text and an interpolated class name is
 * invisible to it.
 */
const SWATCHES: readonly { variable: string; label: string; className: string }[] = [
  { variable: 'canvas', label: 'Page ground', className: 'bg-canvas' },
  { variable: 'canvas-raised', label: 'Raised ground', className: 'bg-canvas-raised' },
  { variable: 'surface', label: 'Card surface', className: 'bg-surface' },
  { variable: 'surface-raised', label: 'Raised surface', className: 'bg-surface-raised' },
  { variable: 'surface-sunken', label: 'Sunken surface', className: 'bg-surface-sunken' },
  { variable: 'line', label: 'Border', className: 'bg-line' },
  { variable: 'line-strong', label: 'Strong border', className: 'bg-line-strong' },
  { variable: 'accent', label: 'Primary signal', className: 'bg-accent' },
  { variable: 'model', label: 'Model accent', className: 'bg-model' },
  { variable: 'verified', label: 'Verified pass', className: 'bg-verified' },
  { variable: 'pending', label: 'Pending / caution', className: 'bg-pending' },
  { variable: 'failed', label: 'Genuine failure', className: 'bg-failed' },
]

function Lab({
  title,
  children,
  bordered = false,
}: {
  title: string
  children: React.ReactNode
  bordered?: boolean
}) {
  return (
    <Section rhythm="tight" divider={bordered}>
      <Container width="wide">
        <Stack gap={6}>
          <Heading level={2} size="h3">
            {title}
          </Heading>
          {children}
        </Stack>
      </Container>
    </Section>
  )
}
