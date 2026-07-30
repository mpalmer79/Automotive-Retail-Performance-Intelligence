'use client'

/**
 * The KPI catalogue.
 *
 * Every governed KPI, searchable and filterable, with its formula, explicit
 * numerator and denominator, unit, date basis, null rule, source reporting view
 * and interpretation caution.
 *
 * NO VALUES
 * ---------
 * There is not one KPI value on this page. Not a figure, not a sparkline, not a
 * sample. The semantic model has never been evaluated by an engine, and the SQL
 * side's figures describe a synthetic dataset for a fictional dealer group. A
 * catalogue of definitions is what this project actually has, and presenting it
 * as such is more useful to a reviewer than a grid of invented numbers.
 *
 * URL PERSISTENCE
 * ---------------
 * The domain filter, the status filter and the search term are written to the
 * query string with `replaceState` semantics via `router.replace(..., {scroll:
 * false})`. A filtered view is therefore linkable and survives a reload, and it
 * does not fill the browser history with one entry per keystroke.
 *
 * KEYBOARD
 * --------
 * Every filter is a real `<button>` with `aria-pressed`. Search is a real
 * `<input type="search">` inside a `<form>` whose submit is prevented, so Enter
 * does not navigate. The result list announces its own count through a
 * `role="status"` region, so a screen-reader user filtering the list is told what
 * happened.
 */
import { ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button, IconButton, buttonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { DefinitionList, SourceLink } from '@/components/ui/data-card'
import { EmptyState } from '@/components/ui/states'
import { CodeLabel, Heading, Text } from '@/components/ui/typography'
import { deferredKpis, kpiContent, kpis } from '@/lib/content'
import { cx } from '@/lib/utils'
import type { KpiEntry } from '@/types/content'

const DOMAIN_FILTERS = [
  { id: 'sales', label: 'Sales' },
  { id: 'gross', label: 'Gross' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'funnel', label: 'Lead funnel' },
  { id: 'marketing', label: 'Marketing' },
] as const

type StatusFilter = 'all' | 'implemented' | 'deferred'

export function KpiCatalogue() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Initial state comes from the URL, so a shared link opens filtered.
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [domain, setDomain] = useState<string | null>(searchParams.get('domain'))
  const [status, setStatus] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter | null) ?? 'all'
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /** Write the current filter state back to the query string. */
  const syncUrl = useCallback(
    (next: { q?: string; domain?: string | null; status?: StatusFilter }) => {
      const params = new URLSearchParams()
      const q = next.q ?? query
      const d = next.domain === undefined ? domain : next.domain
      const s = next.status ?? status
      if (q.trim()) params.set('q', q.trim())
      if (d) params.set('domain', d)
      if (s !== 'all') params.set('status', s)
      const search = params.toString()
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    },
    [query, domain, status, pathname, router]
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return kpis.filter((kpi) => {
      if (domain && kpi.domain !== domain) return false
      // Every KPI in the catalogue is Implemented; the `deferred` filter selects
      // the deferred candidates, which are a separate list.
      if (status === 'deferred') return false
      if (!needle) return true
      return [
        kpi.id,
        kpi.name,
        kpi.measureName,
        kpi.purpose,
        kpi.definition,
        kpi.formula,
        kpi.sourceView,
        kpi.grain,
        kpi.unit,
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [query, domain, status])

  const deferredMatches = useMemo(() => {
    if (status === 'implemented') return []
    const needle = query.trim().toLowerCase()
    if (domain) return []
    if (!needle) return deferredKpis
    return deferredKpis.filter((entry) =>
      [entry.name, entry.grain, entry.unlockStage]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [query, domain, status])

  const filtersActive = query.trim() !== '' || domain !== null || status !== 'all'

  const reset = useCallback(() => {
    setQuery('')
    setDomain(null)
    setStatus('all')
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  const totalShown = matches.length + deferredMatches.length

  return (
    <div className="flex flex-col gap-8">
      {/* Controls */}
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken/50 p-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="kpi-search" className="text-xs font-medium text-ink-muted">
            Search by identifier, name, formula, grain or source view
          </label>
          <div className="relative flex items-center">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 size-4 text-ink-faint"
              strokeWidth={2}
            />
            <input
              id="kpi-search"
              type="search"
              value={query}
              placeholder="front gross, vw_lead_funnel, KPI-INV..."
              onChange={(event) => {
                setQuery(event.target.value)
                syncUrl({ q: event.target.value })
              }}
              className={cx(
                'min-h-touch w-full rounded-lg border border-line bg-canvas pr-11 pl-9',
                'font-mono text-sm text-ink placeholder:text-ink-faint/70',
                'transition-colors duration-(--arpi-motion-fast)',
                'hover:border-line-strong focus:border-accent-muted focus:outline-none',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'
              )}
            />
            {query ? (
              <IconButton
                label="Clear search"
                size="sm"
                onClick={() => {
                  setQuery('')
                  syncUrl({ q: '' })
                }}
                className="absolute right-1"
              >
                <X strokeWidth={2} />
              </IconButton>
            ) : null}
          </div>
        </form>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-ink-muted">Domain</legend>
          <div className="flex flex-wrap gap-2">
            {DOMAIN_FILTERS.map((filter) => {
              const count = kpis.filter((kpi) => kpi.domain === filter.id).length
              const isActive = domain === filter.id
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    const next = isActive ? null : filter.id
                    setDomain(next)
                    syncUrl({ domain: next })
                  }}
                  className={buttonClass(isActive ? 'chipActive' : 'chip', 'sm')}
                >
                  {filter.label}
                  <span className="numeric ml-1.5 text-2xs">{count}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-ink-muted">
            Implementation status
          </legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', 'All', kpis.length + deferredKpis.length],
                ['implemented', 'Implemented', kpis.length],
                ['deferred', 'Deferred', deferredKpis.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value)
                  syncUrl({ status: value })
                }}
                className={buttonClass(status === value ? 'chipActive' : 'chip', 'sm')}
              >
                {label}
                <span className="numeric ml-1.5 text-2xs">{count}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
          <p
            role="status"
            aria-live="polite"
            className="font-mono text-2xs text-ink-muted"
          >
            {filtersActive
              ? `${String(totalShown)} of ${String(kpis.length + deferredKpis.length)} metrics shown`
              : `All ${String(kpis.length)} governed KPIs and ${String(deferredKpis.length)} deferred candidates`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={!filtersActive}
            iconBefore={<RotateCcw />}
          >
            Clear filters
          </Button>
        </div>
      </div>

      {totalShown === 0 ? (
        <EmptyState
          title="No metric matches"
          description={`Nothing in the catalogue matches "${query.trim()}"${domain ? ` in the ${DOMAIN_FILTERS.find((f) => f.id === domain)?.label ?? domain} domain` : ''}. Identifiers follow the pattern KPI-SLS-001; try searching for a reporting view such as vw_gross_summary instead.`}
          action={
            <Button variant="secondary" onClick={reset} iconBefore={<RotateCcw />}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {matches.length > 0 ? (
            <section
              id="implemented-kpis"
              aria-labelledby="implemented-kpis-heading"
              className="flex flex-col gap-4"
            >
              <Heading level={2} size="h4" id="implemented-kpis-heading">
                Implemented
                <span className="ml-2 font-mono text-sm font-normal text-ink-faint">
                  {matches.length}
                </span>
              </Heading>
              <Text size="sm" tone="muted" className="max-w-prose">
                Computable from the reporting schema today, and each verified against an
                independent derivation from the warehouse. The DAX measure exists in the
                semantic model and has never been evaluated, so no value is shown.
              </Text>

              <ul className="flex flex-col gap-3">
                {matches.map((kpi) => (
                  <li key={kpi.id} id={kpi.id} className="scroll-mt-28">
                    <KpiRow
                      kpi={kpi}
                      expanded={expandedId === kpi.id}
                      onToggle={() =>
                        setExpandedId(expandedId === kpi.id ? null : kpi.id)
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {deferredMatches.length > 0 ? (
            <section
              aria-labelledby="deferred-kpis-heading"
              className="flex flex-col gap-4"
            >
              <Heading level={2} size="h4" id="deferred-kpis-heading">
                Deferred
                <span className="ml-2 font-mono text-sm font-normal text-ink-faint">
                  {deferredMatches.length}
                </span>
              </Heading>
              <Text size="sm" tone="muted" className="max-w-prose">
                In the target architecture, outside the current roadmap. Each depends on a
                fact that has not been built, so no formula is specified for it yet and no
                conclusion in this project may rest on one. F&amp;I penetration,
                retention, service-to-sales and target attainment all sit here.
              </Text>

              <ul className="flex flex-col gap-3">
                {deferredMatches.map((entry) => (
                  <li key={entry.name}>
                    <Card tone="sunken" padding="sm" className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="text-base font-semibold text-ink-secondary">
                          {entry.name}
                        </h3>
                        <Badge tone="deferred">Deferred</Badge>
                      </div>
                      <DefinitionList
                        layout="columns"
                        rows={[
                          { term: 'Grain', value: entry.grain, mono: true },
                          {
                            term: 'Depends on',
                            value: entry.dependsOn.join(', '),
                            mono: true,
                          },
                          { term: 'Unlock stage', value: entry.unlockStage },
                        ]}
                      />
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <p className="border-t border-line-subtle pt-6 font-mono text-2xs text-ink-faint">
        Extracted from {kpiContent.source} version {kpiContent.sourceVersion}, last
        reviewed {kpiContent.lastReviewed}. The catalogue is the governing definition;
        this page is a rendering of it.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One KPI                                                                     */
/* -------------------------------------------------------------------------- */

const DOMAIN_TONE: Record<string, string> = {
  sales: 'text-accent',
  gross: 'text-accent',
  inventory: 'text-model',
  funnel: 'text-accent',
  marketing: 'text-pending',
}

function KpiRow({
  kpi,
  expanded,
  onToggle,
}: {
  kpi: KpiEntry
  expanded: boolean
  onToggle: () => void
}) {
  const panelId = `kpi-detail-${kpi.id}`

  return (
    <Card padding="none" className={cx(expanded && 'border-accent-muted')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cx(
          'flex w-full min-h-touch flex-col gap-2 p-4 text-left sm:p-5',
          'transition-colors duration-(--arpi-motion-fast) hover:bg-surface-hover/50',
          'rounded-xl'
        )}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={cx(
              'font-mono text-2xs tracking-wide',
              DOMAIN_TONE[kpi.domain] ?? 'text-accent'
            )}
          >
            {kpi.id}
          </span>
          <span className="text-base font-semibold text-ink">{kpi.name}</span>
          <Badge tone="neutral" className="text-2xs">
            {kpi.unit.split('.')[0]}
          </Badge>
          {kpi.blocksGate1 ? (
            <Badge tone="accent" className="text-2xs">
              MVP page
            </Badge>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2.25}
            className={cx(
              'ml-auto size-4 shrink-0 text-ink-muted',
              'transition-transform duration-(--arpi-motion-base)',
              expanded && 'rotate-180 text-accent'
            )}
          />
        </span>

        <span className="block text-sm leading-relaxed text-ink-muted">
          {kpi.purpose}
        </span>

        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-2xs text-ink-faint">
          <span>{kpi.sourceView}</span>
          <span aria-hidden="true">·</span>
          <span>measure: {kpi.measureName}</span>
        </span>
      </button>

      {/* Kept out of the DOM when collapsed, so a keyboard user never tabs into
          an invisible source link. */}
      {expanded ? (
        <div
          id={panelId}
          className="flex flex-col gap-5 border-t border-accent-muted/30 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-2">
            <h4 className="eyebrow text-2xs">Definition</h4>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {kpi.definition}
            </Text>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="eyebrow text-2xs">Formula</h4>
            <pre className="overflow-x-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-ink-secondary">
              <code>{kpi.formula}</code>
            </pre>
          </div>

          <DefinitionList
            layout="columns"
            rows={[
              { term: 'Numerator', value: kpi.numerator, mono: true },
              { term: 'Denominator', value: kpi.denominator, mono: true },
              { term: 'Unit and format', value: kpi.unit },
              { term: 'Grain', value: kpi.grain, mono: true },
              { term: 'Date basis', value: kpi.dateBasis, mono: true },
              { term: 'Null / zero denominator', value: kpi.nullBehaviour },
              { term: 'Source reporting view', value: kpi.sourceView, mono: true },
              { term: 'DAX measure', value: kpi.measureName, mono: true },
              ...(kpi.reconciliation
                ? [{ term: 'Reconciliation', value: kpi.reconciliation, mono: true }]
                : []),
              {
                term: 'Depends on',
                value: (
                  <span className="flex flex-wrap gap-1.5">
                    {kpi.dependsOn.map((dependency) => (
                      <CodeLabel key={dependency} tone="bare" className="text-2xs">
                        {dependency}
                      </CodeLabel>
                    ))}
                  </span>
                ),
              },
            ]}
          />

          {/* The interpretation caution, given a bordered panel. It is the field
              most likely to be skipped and the one most likely to prevent a
              misreading. */}
          <div className="flex flex-col gap-2 rounded-lg border border-pending/30 bg-pending-wash/30 p-3">
            <h4 className="eyebrow text-2xs text-pending">Interpretation caution</h4>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {kpi.caution}
            </Text>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-line-subtle pt-3">
            <SourceLink path="KPI_CATALOG.md" field={`section ${kpi.docAnchor}`} />
            <SourceLink
              path="tests/integration/test_kpi_verification.py"
              field="independent derivation test"
            />
          </div>
        </div>
      ) : null}
    </Card>
  )
}
