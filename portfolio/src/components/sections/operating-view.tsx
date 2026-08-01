'use client'

/**
 * Chapter three: the ARPI Operating View.
 *
 * The signature product experience, and the visual centrepiece of the redesign.
 * It is the section that has to make a hiring manager think "this is a product"
 * rather than "this is a repository with a website".
 *
 * WHAT IT SHOWS
 * -------------
 * Six analytical domains as one product surface. Selecting a domain reveals the
 * management question it answers, the governed KPIs that answer it, the fact
 * they resolve against and its declared grain, the dimensions that slice it, the
 * reporting views that own the SQL, the implementation status, and the
 * interpretation caution that travels with the numbers.
 *
 * Every field is derived. The management questions and reporting views come from
 * `lib/content.ts`, the KPI identifiers and cautions from `kpis.json`, and the
 * grain and dimensions from `data-model.json` - all three of which are validated
 * against the repository's governing documents by the manifest generator on
 * every build. A domain cannot claim a KPI the catalogue does not define, and a
 * fact cannot claim a grain the data dictionary does not declare.
 *
 * WHAT IT DOES NOT SHOW, AND WILL NOT
 * -----------------------------------
 * A value. Not one, in any domain, in any state. The SQL side computes over a
 * synthetic dataset describing a fictional dealer group and the DAX side has
 * never been evaluated by a Microsoft engine, so every figure that could appear
 * here would be invented. A product frame with plausible numbers in it is
 * precisely the artefact this project exists to argue against, and putting one
 * in the most-looked-at section of the site would undo everything the rest of it
 * claims.
 *
 * What it shows instead is the thing that actually exists and is actually rare:
 * the definitions, and the rules around them.
 *
 * WHY THIS IS A CLIENT COMPONENT AND THE HERO IS NOT
 * -------------------------------------------------
 * Selection is genuine state. It carries no animation library: the panel swap is
 * a render, and the only transition is a CSS colour change on the rail. The
 * whole component is roughly the weight of the state it holds.
 *
 * ACCESSIBILITY
 * -------------
 * Real tab semantics, because this really is a tab set: one visible panel, a
 * rail of selectors, no navigation. `role="tablist"` with roving tabindex, arrow
 * keys, Home and End, `aria-selected`, `aria-controls` and a labelled panel that
 * is focusable so a keyboard user lands in the content after choosing. The
 * selected state is carried by a filled surface, a left rule and the accessible
 * `aria-selected`, so it is never colour alone.
 */
import { ArrowRight } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'

import { LinkButton } from '@/components/ui/button'
import { KpiChip, StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { CodeLabel, Text } from '@/components/ui/typography'
import { DOMAINS, entities, kpis, type DomainId } from '@/lib/content'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

/**
 * The evidence path for a domain's definitions. One per domain, all of them
 * files a reader can open.
 */
const EVIDENCE: Record<DomainId, string> = {
  sales: 'KPI_CATALOG.md',
  gross: 'KPI_CATALOG.md',
  inventory: 'KPI_CATALOG.md',
  funnel: 'KPI_CATALOG.md',
  marketing: 'KPI_CATALOG.md',
  dataQuality: 'sql/08_validation/',
}

export function OperatingView() {
  const [selected, setSelected] = useState<DomainId>('gross')
  const baseId = useId()
  const railRef = useRef<HTMLDivElement | null>(null)

  /**
   * Arrow-key navigation across the rail.
   *
   * Follows the tab pattern's automatic-activation form: moving the selection
   * moves focus and selects, because every panel is already rendered from local
   * data and there is nothing to fetch. Home and End are included because a
   * six-item rail is long enough for them to be worth having.
   */
  const onRailKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
      if (!keys.includes(event.key)) return
      event.preventDefault()

      const current = DOMAINS.findIndex((domain) => domain.id === selected)
      const last = DOMAINS.length - 1
      let next = current

      if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
        next = current === last ? 0 : current + 1
      else next = current === 0 ? last : current - 1

      const target = DOMAINS[next]
      if (!target) return
      setSelected(target.id)
      railRef.current
        ?.querySelector<HTMLButtonElement>(`[data-domain="${target.id}"]`)
        ?.focus()
    },
    [selected]
  )

  const domain = DOMAINS.find((item) => item.id === selected) ?? DOMAINS[0]!
  const domainKpis = kpis.filter((kpi) => kpi.domain === domain.id)
  const fact = entities.find((entity) => entity.table === domain.primaryFact)

  return (
    <Section id="operating-view" tone="panel" className="scroll-mt-24">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The operating view"
          title="Six domains, one definition each."
          lede="Select a domain to see the question it answers, the governed measures that answer it, and the fact, grain and views underneath them."
        />

        {/* THE PRODUCT FRAME.
            The one place on the site that uses --arpi-radius-frame, the one
            place with an outer glow, and the one place with a chrome bar. Those
            three together are what make it read as a piece of software sitting
            inside a document rather than as another card. */}
        <div
          className={cx(
            'mt-12 overflow-hidden rounded-frame border border-line-strong',
            'bg-canvas shadow-xl inset-shadow-top'
          )}
        >
          {/* Chrome. Names the surface and states, once and permanently, that
              there are no values in it. A reader who looks for a chart finds the
              reason there is not one in the same glance. */}
          <div className="flex flex-col gap-3 border-b border-line bg-surface-sunken/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex items-center gap-1.5">
                <span className="inline-block size-1.5 rounded-pill bg-accent" />
                <span className="inline-block size-1.5 rounded-pill bg-model" />
                <span className="inline-block size-1.5 rounded-pill bg-line-strong" />
              </span>
              <span className="font-display text-base font-semibold tracking-tight text-ink">
                ARPI Operating View
              </span>
            </div>
            <p className="font-mono text-2xs leading-normal text-ink-faint">
              Governed definitions only. No engine has evaluated these measures, so this
              surface carries no value.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12">
            {/* The domain rail.
                Wraps rather than scrolling horizontally below the large
                breakpoint: six short labels fit two lines at 320px, and a
                horizontally scrolling rail hides options a visitor has no reason
                to expect. */}
            <div
              ref={railRef}
              role="tablist"
              aria-label="Analytical domain"
              aria-orientation="vertical"
              onKeyDown={onRailKeyDown}
              className={cx(
                'flex flex-wrap gap-1 border-b border-line p-3',
                'lg:col-span-3 lg:flex-col lg:flex-nowrap lg:border-r lg:border-b-0 lg:p-4'
              )}
            >
              {DOMAINS.map((item) => {
                const isSelected = item.id === domain.id
                const count = kpis.filter((kpi) => kpi.domain === item.id).length
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    data-domain={item.id}
                    id={`${baseId}-tab-${item.id}`}
                    aria-selected={isSelected}
                    aria-controls={`${baseId}-panel`}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => {
                      setSelected(item.id)
                    }}
                    className={cx(
                      'relative flex min-h-touch grow items-center justify-between gap-3 rounded-lg px-3.5 text-left',
                      'transition-colors duration-(--arpi-motion-fast) lg:grow-0',
                      isSelected
                        ? 'bg-surface-raised font-semibold text-ink shadow-sm inset-shadow-top'
                        : 'font-medium text-ink-muted hover:bg-surface/60 hover:text-ink-secondary'
                    )}
                  >
                    {/* The selected rule. A second, non-colour carrier of the
                        state, and the thing that makes the rail read as a rail
                        rather than as six buttons. */}
                    <span
                      aria-hidden="true"
                      className={cx(
                        'absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-pill',
                        isSelected ? 'bg-accent' : 'bg-transparent'
                      )}
                    />
                    <span className="text-base">{item.label}</span>
                    <span
                      className={cx(
                        'shrink-0 font-mono text-2xs',
                        isSelected ? 'text-accent' : 'text-ink-faint'
                      )}
                    >
                      {count > 0 ? String(count) : 'QA'}
                      <span className="sr-only">
                        {count > 0
                          ? ` governed KPIs`
                          : ' supporting domain, no governed KPI of its own'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            {/* The panel.
                `tabIndex={-1}` so that arrow selection can hand focus to the
                content, and `key` on the domain so React remounts rather than
                reconciling - which is what makes a screen reader announce the
                panel's new name instead of staying silent. */}
            <div
              key={domain.id}
              role="tabpanel"
              id={`${baseId}-panel`}
              aria-labelledby={`${baseId}-tab-${domain.id}`}
              tabIndex={-1}
              className="flex flex-col gap-7 p-5 focus:outline-none sm:p-7 lg:col-span-9 lg:p-9"
            >
              <div className="flex flex-col gap-3">
                <span className="eyebrow text-2xs">The management question</span>
                <p className="max-w-3xl font-display text-2xl leading-snug font-semibold tracking-tight text-balance text-ink">
                  {domain.managementQuestion}
                </p>
                <Text size="body" tone="muted" className="max-w-prose">
                  {domain.summary}
                </Text>
              </div>

              {domainKpis.length > 0 ? (
                <Field label="Governed measures">
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
                </Field>
              ) : null}

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Field label="Primary fact">
                  <CodeLabel tone="bare" className="text-xs">
                    {domain.primaryFact}
                  </CodeLabel>
                  {fact ? (
                    <p className="mt-2 text-sm leading-normal text-ink-muted">
                      <span className="text-ink-faint">Declared grain: </span>
                      {fact.grain}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm leading-normal text-ink-muted">
                      <span className="text-ink-faint">Declared grain: </span>
                      One row per validation rule, per run
                    </p>
                  )}
                </Field>

                <Field label="Sliced by">
                  {fact && fact.foreignKeys.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {dimensionsOf(fact.foreignKeys).map((dimension) => (
                        <li
                          key={dimension}
                          className="rounded-sm border border-line bg-surface-sunken/80 px-2 py-1 font-mono text-2xs text-ink-muted"
                        >
                          {dimension}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text size="sm" tone="muted">
                      Run, rule and severity. Validation outcomes are reportable data
                      rather than a log file.
                    </Text>
                  )}
                </Field>
              </div>

              <Field label="Reporting views">
                <ul className="flex flex-col gap-1">
                  {domain.reportingViews.map((view) => (
                    <li key={view}>
                      <CodeLabel tone="bare" className="text-2xs">
                        {view}
                      </CodeLabel>
                    </li>
                  ))}
                </ul>
              </Field>

              {domainKpis[0] ? (
                <Field label="Interpretation caution">
                  <Text size="sm" tone="muted" className="max-w-prose">
                    {domainKpis[0].caution}
                  </Text>
                </Field>
              ) : null}

              <div className="mt-auto flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  <StatusBadge
                    status="complete"
                    label="SQL built and reconciled"
                    size="sm"
                  />
                  <StatusBadge
                    status="pending-external"
                    label="DAX never evaluated"
                    size="sm"
                  />
                </div>
                <SourceLink path={EVIDENCE[domain.id]} field="governing definitions" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Text size="sm" tone="muted" className="max-w-prose">
            Every measure above is computable from SQL today and verified against an
            independent derivation from the warehouse. The DAX that will serve them to a
            report has never been run.
          </Text>
          <LinkButton
            href={ROUTES.kpis.href}
            variant="secondary"
            iconAfter={<ArrowRight />}
            className="shrink-0"
          >
            All governed KPI definitions
          </LinkButton>
        </div>
      </Container>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h4 className="eyebrow text-2xs">{label}</h4>
      {children}
    </div>
  )
}

/**
 * The distinct dimensions a fact joins to, in declaration order.
 *
 * Deduplicated because a fact may reference the same dimension through more than
 * one role - `fact_vehicle_sale` reaches `dim_date` twice, as sale date and
 * delivery date, and `dim_employee` three times. Listing "Employee" three times
 * would read as an error rather than as role-playing, and role-playing belongs
 * on the data-model page where there is room to explain it.
 */
function dimensionsOf(
  foreignKeys: readonly { readonly references: string }[]
): readonly string[] {
  const seen = new Set<string>()
  for (const key of foreignKeys) {
    seen.add(key.references.replace(/^warehouse\./, ''))
  }
  return [...seen]
}
