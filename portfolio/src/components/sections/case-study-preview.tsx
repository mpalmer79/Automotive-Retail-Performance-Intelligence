/**
 * The case-study preview.
 *
 * A tasteful visual for the locked case-study route, built ONLY from
 * architecture and model elements that already exist and are already rendered
 * honestly elsewhere on this site.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a mock-up of the case study. Not a blurred dashboard. Not a chart with
 * plausible-looking bars. Not a "preview" that implies content exists behind it.
 * There is no value of any kind in this component, real or placeholder, because a
 * placeholder figure on a locked page is exactly the thing the lock is for.
 *
 * WHAT IT IS
 * ----------
 * A schematic of the platform the eventual argument will rest on: the layer
 * stack, the domain surface, and the governed measure count - each of which the
 * site can evidence today. It is drawn as a blueprint rather than as a report,
 * which is the honest register for something that has not been built.
 *
 * Server component. No animation, because there is no process to show.
 */
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Heading, Text } from '@/components/ui/typography'
import { DOMAINS } from '@/lib/content'
import { counts, semanticModel } from '@/lib/manifest'

export function CaseStudyPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* The layer schematic */}
      <Card tone="sunken" padding="lg" className="flex flex-col gap-5 lg:col-span-7">
        <div className="flex flex-col gap-1.5">
          <Heading level={3} size="h6">
            The layer stack
          </Heading>
          <Text size="sm" tone="muted">
            Six built layers, and the two above them that are not.
          </Text>
        </div>

        <svg
          viewBox="0 0 460 260"
          role="img"
          aria-label="A blueprint schematic of eight stacked layers. From the bottom: raw, staging, warehouse, reporting - all drawn with solid outlines to indicate they are built. Above them, the semantic model is drawn with a dashed violet outline to indicate it is built but not validated by an engine. Above that, report pages and the case study are drawn with dashed grey outlines to indicate they do not exist."
          className="w-full"
        >
          <defs>
            <pattern id="cs-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="var(--color-line-strong)" />
            </pattern>
          </defs>
          <rect width="460" height="260" fill="url(#cs-grid)" opacity="0.3" />

          {LAYERS.map((layer, index) => {
            const y = 232 - index * 30
            return (
              <g key={layer.label}>
                <rect
                  x={30 + index * 6}
                  y={y}
                  width={300 - index * 12}
                  height="22"
                  rx="4"
                  fill={
                    layer.state === 'built'
                      ? 'var(--color-surface-raised)'
                      : layer.state === 'pending'
                        ? 'var(--color-model-wash)'
                        : 'none'
                  }
                  stroke={
                    layer.state === 'built'
                      ? 'var(--color-accent-muted)'
                      : layer.state === 'pending'
                        ? 'var(--color-model)'
                        : 'var(--color-line-strong)'
                  }
                  strokeWidth="1.3"
                  strokeDasharray={layer.state === 'built' ? undefined : '4 3'}
                />
                <text
                  x={42 + index * 6}
                  y={y + 15}
                  fill={
                    layer.state === 'built'
                      ? 'var(--color-ink-secondary)'
                      : layer.state === 'pending'
                        ? 'var(--color-model)'
                        : 'var(--color-ink-faint)'
                  }
                  className="font-mono"
                  fontSize="9.5"
                  letterSpacing="0.4"
                >
                  {layer.label}
                </text>
                <text
                  x="352"
                  y={y + 15}
                  fill="var(--color-ink-faint)"
                  className="font-mono"
                  fontSize="8"
                  letterSpacing="0.4"
                >
                  {layer.note}
                </text>
              </g>
            )
          })}

          {/* Blueprint alignment marks down the left edge. */}
          <g stroke="var(--color-line)" strokeWidth="1">
            <path d="M18 14 V254" strokeDasharray="2 5" />
            <path d="M14 14 H22 M14 254 H22" />
          </g>
        </svg>

        <SourceLink path="ARCHITECTURE.md" field="layer responsibilities" />
      </Card>

      {/* The domain surface and the measure count */}
      <div className="flex flex-col gap-4 lg:col-span-5">
        <Card tone="sunken" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Heading level={3} size="h6">
              The domain surface
            </Heading>
            <Text size="sm" tone="muted">
              Six domains a case study could reason over. Four of the deferred subjects -
              F&amp;I penetration, retention, service-to-sales and target attainment - are
              not here, because their facts do not exist.
            </Text>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {DOMAINS.map((domain) => (
              <li
                key={domain.id}
                className="rounded-pill border border-line bg-canvas/60 px-2.5 py-1 font-mono text-2xs text-ink-muted"
              >
                {domain.label}
              </li>
            ))}
          </ul>
        </Card>

        <Card tone="sunken" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Heading level={3} size="h6">
              What the argument would cite
            </Heading>
            <Text size="sm" tone="muted">
              Definitions, not values. Every one of these exists today; none has produced
              a number from an engine.
            </Text>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <PreviewFigure value={counts.governedKpis.value} label="Governed KPIs" />
            <PreviewFigure
              value={counts.daxMeasures.value}
              label="DAX measures written"
            />
            <PreviewFigure value={counts.reportingViews.value} label="Reporting views" />
            <PreviewFigure
              value={semanticModel.dashboardPageCount}
              label="Report pages built"
            />
          </dl>
          <p className="border-t border-line-subtle pt-3 font-mono text-2xs text-ink-faint">
            The last figure is the one that keeps this page locked.
          </p>
        </Card>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

const LAYERS = [
  { label: 'raw', note: 'as imported', state: 'built' },
  { label: 'staging', note: 'typed, deduplicated', state: 'built' },
  { label: 'warehouse', note: 'declared grain', state: 'built' },
  { label: 'reporting', note: 'the only read surface', state: 'built' },
  { label: 'semantic model', note: 'never evaluated', state: 'pending' },
  { label: 'report pages', note: 'not built', state: 'planned' },
  { label: 'findings', note: 'not drawn', state: 'planned' },
  { label: 'case study', note: 'gated', state: 'planned' },
] as const

function PreviewFigure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="sr-only">{label}</dt>
      <dd className="numeric font-display text-2xl font-semibold tracking-tighter text-ink">
        {value}
      </dd>
      <span aria-hidden="true" className="text-xs leading-snug text-ink-muted">
        {label}
      </span>
    </div>
  )
}
