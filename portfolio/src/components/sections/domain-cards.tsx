'use client'

/**
 * The six analytical domains, as interactive cards.
 *
 * Each card shows the management question, the fact it resolves against, the
 * governed KPI IDs that belong to it, the reporting views that own the SQL side,
 * and its implementation status.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * A number. Not one KPI value appears on any of these cards, because the
 * semantic model has never been evaluated and the SQL side's figures describe a
 * synthetic dataset. Showing "Front gross per unit: $2,140" here would be the
 * exact failure mode this project is built to avoid - a plausible figure with no
 * standing, on the most-read section of the site.
 *
 * The KPI IDs are read from `kpis.json`, filtered by domain, so a card cannot
 * claim a KPI the catalogue does not define.
 */
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { Reveal, RevealGroup } from '@/components/motion/reveal'
import { KpiChip, StatusBadge } from '@/components/ui/badge'
import { InteractiveCard } from '@/components/ui/card'
import { Container, Section } from '@/components/ui/layout'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { DOMAINS, kpis } from '@/lib/content'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

export function DomainCards() {
  // One card may be expanded at a time. Expanding is a click, never a hover, so
  // the detail is reachable on touch and by keyboard identically.
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Section id="analytical-domains" bordered>
      <Container width="wide">
        <Reveal className="mb-12 flex max-w-prose flex-col gap-5">
          <Eyebrow>Analytical domains</Eyebrow>
          <Heading level={2}>
            Six domains, each answering a question someone asks.
          </Heading>
          <Text size="body">
            Every domain names the fact its KPIs resolve against and the reporting views
            that own their SQL. Select a domain to see its governed KPI identifiers and
            what the domain deliberately does not measure.
          </Text>
        </Reveal>

        <RevealGroup
          as="ul"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {DOMAINS.map((domain) => {
            const domainKpis = kpis.filter((kpi) => kpi.domain === domain.id)
            const isExpanded = expanded === domain.id
            const panelId = `domain-panel-${domain.id}`

            return (
              <Reveal key={domain.id} as="li" child className="flex">
                <div className="flex w-full flex-col">
                  <InteractiveCard
                    selected={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : domain.id)}
                    className={cx('flex-1', isExpanded && 'rounded-b-none')}
                    label={`${domain.label} analytical domain${isExpanded ? ', expanded' : ''}`}
                  >
                    <span className="flex h-full flex-col gap-4">
                      <span className="flex items-start justify-between gap-3">
                        <span className="flex flex-col gap-2">
                          <span
                            className={cx(
                              'font-mono text-2xs tracking-wide',
                              domain.tone === 'model' ? 'text-model' : 'text-accent'
                            )}
                          >
                            {domain.id === 'dataQuality'
                              ? 'SUPPORTING DOMAIN'
                              : `${String(domainKpis.length)} GOVERNED KPI${domainKpis.length === 1 ? '' : 'S'}`}
                          </span>
                          <span className="font-display text-xl font-semibold tracking-tight text-ink">
                            {domain.label}
                          </span>
                        </span>
                        <StatusBadge status="complete" label="SQL complete" size="sm" />
                      </span>

                      <span className="block text-sm leading-relaxed font-medium text-ink-secondary">
                        &ldquo;{domain.managementQuestion}&rdquo;
                      </span>

                      <span className="mt-auto flex flex-col gap-2 border-t border-line-subtle pt-3">
                        <span className="eyebrow text-2xs">Primary fact</span>
                        <CodeLabel tone="bare" className="text-2xs">
                          {domain.primaryFact}
                        </CodeLabel>
                      </span>

                      <span
                        aria-hidden="true"
                        className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"
                      >
                        {isExpanded ? 'Hide detail' : 'Show KPIs and views'}
                        <ArrowRight
                          className={cx(
                            'size-3 transition-transform duration-(--arpi-motion-base)',
                            isExpanded ? 'rotate-90' : 'rotate-0'
                          )}
                          strokeWidth={2.5}
                        />
                      </span>
                    </span>
                  </InteractiveCard>

                  {/* The detail panel. Kept out of the DOM when closed rather than
                      hidden, so a keyboard user never tabs into invisible links. */}
                  {isExpanded ? (
                    <div
                      id={panelId}
                      className="flex flex-col gap-4 rounded-b-xl border border-t-0 border-accent-muted bg-accent-wash/25 p-5"
                    >
                      <div className="flex flex-col gap-2">
                        <h4 className="eyebrow text-2xs">
                          What it measures, and what it omits
                        </h4>
                        <Text size="sm" tone="muted">
                          {domain.summary}
                        </Text>
                      </div>

                      {domainKpis.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <h4 className="eyebrow text-2xs">Governed KPIs</h4>
                          <ul className="flex flex-wrap gap-1.5">
                            {domainKpis.map((kpi) => (
                              <li key={kpi.id}>
                                <KpiChip
                                  id={kpi.id}
                                  name={kpi.name}
                                  href={`${ROUTES.kpis.href}#${kpi.id}`}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="flex flex-col gap-2">
                        <h4 className="eyebrow text-2xs">Reporting views</h4>
                        <ul className="flex flex-col gap-1">
                          {domain.reportingViews.map((view) => (
                            <li key={view}>
                              <CodeLabel tone="bare" className="text-2xs">
                                {view}
                              </CodeLabel>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex flex-col gap-1.5 border-t border-accent-muted/30 pt-3">
                        <h4 className="eyebrow text-2xs">Implementation status</h4>
                        <Text size="sm" tone="muted">
                          The SQL side is built and tested against an independent
                          derivation from the warehouse. The DAX measures exist in the
                          semantic model and have never been evaluated by an engine, so no
                          value from this domain is shown anywhere on this site.
                        </Text>
                      </div>
                    </div>
                  ) : null}
                </div>
              </Reveal>
            )
          })}
        </RevealGroup>
      </Container>
    </Section>
  )
}
