'use client'

/**
 * The data-model explorer.
 *
 * Thirteen entities - eight conformed dimensions and five facts - laid out as a
 * star schema. Selecting an entity highlights the relationships that touch it and
 * opens a detail panel with the declared grain, keys, history policy, privacy
 * classification, analytical use and documentation.
 *
 * FILTERS
 * -------
 * Three, all independent, all reflected in the visible entity set and in the
 * result count:
 *   kind            dimensions, facts, or both
 *   domain          which analytical domain the entity serves
 *   historyPolicy   how change over time is handled
 *
 * PRIVACY
 * -------
 * No record-level value appears anywhere in this component. The privacy field on
 * each entity is a POLICY statement - "no PII by construction; age is a band" -
 * never an example. There is no customer name, no address, no VIN and no
 * employee identifier on this page, synthetic or otherwise, because rendering a
 * fictional person's details would teach a reader the wrong lesson about what
 * this project does with data.
 *
 * The row counts shown are table cardinalities from the model's own expectations
 * register. A row count is not a record.
 */
import { motion } from 'motion/react'
import { RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { Badge, StatusBadge } from '@/components/ui/badge'
import { Button, buttonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/card-static'
import { DefinitionList, SourceLink } from '@/components/ui/data-card'
import { EmptyState } from '@/components/ui/states'
import { CodeLabel, GrainLabel, Heading, Text } from '@/components/ui/typography'
import { entities, modelRelationships } from '@/lib/content'
import { usePrefersReducedMotion } from '@/lib/hooks'
import { DURATION, EASE } from '@/lib/motion'
import { cx, formatCount } from '@/lib/utils'
import type { ModelEntity } from '@/types/content'

const VIEW_WIDTH = 900
const VIEW_HEIGHT = 560

type KindFilter = 'all' | 'dimension' | 'fact'

/** Distinct history policies present in the model, for the filter. */
function historyPolicies(): string[] {
  return [...new Set(entities.map((e) => e.historyPolicy))].sort()
}

/** Distinct KPI domains present in the model, for the filter. */
function domains(): string[] {
  return [...new Set(entities.flatMap((e) => e.kpiDomains))].sort()
}

const DOMAIN_LABEL: Record<string, string> = {
  sales: 'Sales',
  gross: 'Gross',
  inventory: 'Inventory',
  funnel: 'Lead funnel',
  marketing: 'Marketing',
  dataQuality: 'Data quality',
}

/**
 * Star-schema positions. Facts on an inner ring, dimensions on an outer one,
 * hand-placed so that the relationships each fact actually uses run short.
 */
const POSITIONS: Record<string, { x: number; y: number }> = {
  // Facts - inner column
  fact_vehicle_sale: { x: 400, y: 130 },
  fact_vehicle_inventory_snapshot: { x: 400, y: 230 },
  fact_lead: { x: 400, y: 330 },
  fact_appointment: { x: 400, y: 420 },
  fact_marketing_spend: { x: 400, y: 500 },
  // Dimensions - outer, left and right
  dim_date: { x: 130, y: 90 },
  dim_dealership: { x: 130, y: 175 },
  dim_employee: { x: 130, y: 260 },
  dim_customer: { x: 130, y: 345 },
  dim_vehicle: { x: 670, y: 120 },
  dim_vehicle_model: { x: 670, y: 205 },
  dim_lead_source: { x: 670, y: 330 },
  dim_marketing_campaign: { x: 670, y: 445 },
}

const BOX_WIDTH = 150
const BOX_HEIGHT = 40

export function DataModelExplorer() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [kind, setKind] = useState<KindFilter>('all')
  const [domain, setDomain] = useState<string | null>(null)
  const [policy, setPolicy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visible = useMemo(
    () =>
      entities.filter((entity) => {
        if (kind !== 'all' && entity.kind !== kind) return false
        if (domain && !entity.kpiDomains.includes(domain)) return false
        if (policy && entity.historyPolicy !== policy) return false
        return true
      }),
    [kind, domain, policy]
  )

  const selected = useMemo(
    () => visible.find((entity) => entity.id === selectedId),
    [visible, selectedId]
  )

  /** Relationships touching the selected entity's reporting view. */
  const relatedViews = useMemo(() => {
    if (!selected) return new Set<string>()
    const view = viewName(selected)
    const found = new Set<string>()
    for (const rel of modelRelationships) {
      if (rel.from === view) found.add(rel.to)
      if (rel.to === view) found.add(rel.from)
    }
    return found
  }, [selected])

  const filtersActive = kind !== 'all' || domain !== null || policy !== null

  const resetFilters = useCallback(() => {
    setKind('all')
    setDomain(null)
    setPolicy(null)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>) => {
      const currentIndex = selectedId
        ? visible.findIndex((entity) => entity.id === selectedId)
        : -1
      let nextIndex: number | null = null
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = Math.min(currentIndex + 1, visible.length - 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = visible.length - 1
          break
        case 'Escape':
          setSelectedId(null)
          event.preventDefault()
          return
        default:
          return
      }
      event.preventDefault()
      const next = visible[nextIndex]
      if (next) setSelectedId(next.id)
    },
    [selectedId, visible]
  )

  return (
    <div className="flex flex-col gap-8">
      {/* Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow text-2xs">Filter the model</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            disabled={!filtersActive}
            iconBefore={<RotateCcw />}
          >
            Clear filters
          </Button>
        </div>

        <FilterRow label="Entity kind">
          {(
            [
              ['all', `All ${String(entities.length)}`],
              [
                'dimension',
                `Dimensions ${String(entities.filter((e) => e.kind === 'dimension').length)}`,
              ],
              [
                'fact',
                `Facts ${String(entities.filter((e) => e.kind === 'fact').length)}`,
              ],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={buttonClass(kind === value ? 'chipActive' : 'chip', 'sm')}
            >
              {label}
            </button>
          ))}
        </FilterRow>

        <FilterRow label="Business domain">
          {domains().map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setDomain(domain === id ? null : id)}
              aria-pressed={domain === id}
              className={buttonClass(domain === id ? 'chipActive' : 'chip', 'sm')}
            >
              {DOMAIN_LABEL[id] ?? id}
            </button>
          ))}
        </FilterRow>

        <FilterRow label="History policy">
          {historyPolicies().map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPolicy(policy === id ? null : id)}
              aria-pressed={policy === id}
              // The visible label is shortened to its leading clause so the chip
              // row survives a 320px viewport; the full policy is the accessible
              // name and the tooltip, so nothing is lost.
              aria-label={`History policy: ${id}`}
              title={id}
              className={cx(buttonClass(policy === id ? 'chipActive' : 'chip', 'sm'))}
            >
              {shortPolicy(id)}
            </button>
          ))}
        </FilterRow>

        {/* The result count, announced. A filter that silently changes a list is
            invisible to a screen-reader user. */}
        <p role="status" aria-live="polite" className="font-mono text-2xs text-ink-muted">
          {visible.length === entities.length
            ? `Showing all ${String(entities.length)} entities`
            : `Showing ${String(visible.length)} of ${String(entities.length)} entities`}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No entity matches these filters"
          description="The model has thirteen entities. Try clearing the history-policy filter, which is the narrowest of the three."
          action={
            <Button variant="secondary" onClick={resetFilters} iconBefore={<RotateCcw />}>
              Clear all filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface-sunken/60 p-4">
              {/* Not aria-hidden: the listbox inside it is operable, so hiding the
                SVG would make a real control invisible to assistive technology.
                The decorative layers carry `aria-hidden` individually and each
                option carries an accessible name. */}
              <svg
                viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
                className="h-auto w-full min-w-[680px]"
              >
                <defs>
                  <pattern
                    id="dm-grid"
                    width="24"
                    height="24"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="1" cy="1" r="0.9" fill="var(--color-line-strong)" />
                  </pattern>
                </defs>
                <rect
                  aria-hidden="true"
                  width={VIEW_WIDTH}
                  height={VIEW_HEIGHT}
                  fill="url(#dm-grid)"
                  opacity="0.28"
                />

                {/* Relationship lines. Only those whose BOTH endpoints are
                    currently visible are drawn, so a filtered view does not show
                    an edge to nothing. Decorative: the detail panel lists every
                    relationship touching the selected entity as text. */}
                <g fill="none" aria-hidden="true">
                  {modelRelationships.map((rel, index) => {
                    const from = visible.find((e) => viewName(e) === rel.from)
                    const to = visible.find((e) => viewName(e) === rel.to)
                    if (!from || !to) return null
                    const a = POSITIONS[from.id]
                    const b = POSITIONS[to.id]
                    if (!a || !b) return null

                    const touchesSelection =
                      selected !== undefined &&
                      (from.id === selected.id || to.id === selected.id)

                    return (
                      <line
                        key={`${rel.from}.${rel.fromColumn}-${rel.to}.${rel.toColumn}-${String(index)}`}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={
                          touchesSelection
                            ? 'var(--color-accent)'
                            : rel.active
                              ? 'var(--color-model)'
                              : 'var(--color-line-strong)'
                        }
                        strokeWidth={touchesSelection ? 1.8 : 1}
                        // Inactive relationships are dashed. They exist for
                        // role-playing dimensions and are activated in DAX with
                        // USERELATIONSHIP, so they are real but not default.
                        strokeDasharray={rel.active ? undefined : '3 3'}
                        opacity={
                          selected && !touchesSelection ? 0.16 : rel.active ? 0.5 : 0.35
                        }
                        className="transition-opacity duration-(--arpi-motion-base)"
                      />
                    )
                  })}
                </g>

                {/* Entities */}
                <g
                  role="listbox"
                  aria-label="Warehouse entities"
                  tabIndex={0}
                  onKeyDown={onKeyDown}
                  className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                >
                  {visible.map((entity) => {
                    const position = POSITIONS[entity.id]
                    if (!position) return null
                    const isSelected = entity.id === selectedId
                    const isRelated = relatedViews.has(viewName(entity))
                    const isDimmed = selected !== undefined && !isSelected && !isRelated
                    const isFact = entity.kind === 'fact'

                    return (
                      <motion.g
                        key={entity.id}
                        role="option"
                        // The name is the entity and its grain, not the table
                        // identifier drawn in the box. Grain is the field a
                        // reviewer most needs, so it belongs in the name.
                        aria-label={`${entity.label}. ${entity.kind}. Grain: ${entity.grain}.`}
                        aria-selected={isSelected}
                        onClick={() => setSelectedId(isSelected ? null : entity.id)}
                        className="cursor-pointer"
                        animate={{ opacity: isDimmed ? 0.28 : 1 }}
                        transition={
                          prefersReducedMotion
                            ? { duration: 0 }
                            : { duration: DURATION.base, ease: EASE.standard }
                        }
                      >
                        <rect
                          x={position.x - BOX_WIDTH / 2}
                          y={position.y - BOX_HEIGHT / 2}
                          width={BOX_WIDTH}
                          height={BOX_HEIGHT}
                          rx={isFact ? 4 : 10}
                          fill={
                            isSelected
                              ? 'var(--color-accent-wash)'
                              : isFact
                                ? 'var(--color-model-wash)'
                                : 'var(--color-surface-raised)'
                          }
                          stroke={
                            isSelected
                              ? 'var(--color-accent)'
                              : isRelated
                                ? 'var(--color-accent-muted)'
                                : isFact
                                  ? 'var(--color-model)'
                                  : 'var(--color-line-strong)'
                          }
                          strokeWidth={isSelected ? 2 : 1.3}
                        />
                        {/* A fact is a square-cornered box with a left rule; a
                            dimension is a rounded box. Shape carries the kind, so
                            the diagram is legible without colour. */}
                        {isFact ? (
                          <rect
                            x={position.x - BOX_WIDTH / 2}
                            y={position.y - BOX_HEIGHT / 2}
                            width="3.5"
                            height={BOX_HEIGHT}
                            fill={
                              isSelected ? 'var(--color-accent)' : 'var(--color-model)'
                            }
                          />
                        ) : null}
                        <text
                          aria-hidden="true"
                          x={position.x}
                          y={position.y - 2}
                          textAnchor="middle"
                          fill={isSelected ? 'var(--color-accent)' : 'var(--color-ink)'}
                          className="font-mono"
                          fontSize="10"
                        >
                          {entity.id}
                        </text>
                        <text
                          aria-hidden="true"
                          x={position.x}
                          y={position.y + 11}
                          textAnchor="middle"
                          fill="var(--color-ink-faint)"
                          className="font-mono"
                          fontSize="8"
                        >
                          {entity.rowCount === null
                            ? entity.kind
                            : `${formatCount(entity.rowCount)} rows`}
                        </text>
                      </motion.g>
                    )
                  })}
                </g>
              </svg>
            </div>

            <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-2xs text-ink-faint">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-4 border-l-2 border-model bg-model-wash"
                />
                Fact - square corners, left rule
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-4 rounded-md border border-line-strong bg-surface-raised"
                />
                Dimension - rounded
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-px w-5 bg-model" />
                Active relationship
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-px w-5 border-t border-dashed border-line-strong"
                />
                Inactive - activated in DAX
              </li>
            </ul>
          </div>

          <div className="xl:col-span-4">
            <div className="xl:sticky xl:top-[calc(var(--arpi-size-header)+2rem)]">
              {selected ? (
                <EntityDetail entity={selected} />
              ) : (
                <Card tone="sunken" className="flex flex-col gap-3">
                  <Heading level={2} size="h5">
                    No entity selected
                  </Heading>
                  <Text size="sm" tone="muted">
                    Choose an entity to see its declared grain, its keys, how it handles
                    change over time, and how it is classified for privacy. The grain is
                    the field worth reading first.
                  </Text>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The noninteractive fallback: every visible entity in full. */}
      <section aria-labelledby="entity-list-heading" className="mt-4">
        <Heading level={2} size="h3" id="entity-list-heading" className="mb-6">
          Every entity, with its declared grain
        </Heading>
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((entity) => (
            <li key={entity.id} className="flex">
              <Card as="article" className="flex w-full flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span
                      className={cx(
                        'font-mono text-2xs tracking-wide',
                        entity.kind === 'fact' ? 'text-model' : 'text-accent'
                      )}
                    >
                      {entity.kind.toUpperCase()}
                      {entity.rowCount !== null
                        ? ` · ${formatCount(entity.rowCount)} ROWS`
                        : ''}
                    </span>
                    <h3 className="text-lg font-semibold text-ink">{entity.label}</h3>
                    <CodeLabel tone="bare" className="text-2xs">
                      {entity.table}
                    </CodeLabel>
                  </div>
                  <StatusBadge status="complete" label="Built and tested" size="sm" />
                </div>

                <GrainLabel grain={entity.grain} />

                <DefinitionList
                  rows={[
                    { term: 'Primary key', value: entity.primaryKey, mono: true },
                    {
                      term: 'Foreign keys',
                      value:
                        entity.foreignKeys.length === 0
                          ? 'None'
                          : entity.foreignKeys
                              .map((fk) => `${fk.column} -> ${fk.references}`)
                              .join('\n'),
                      mono: true,
                    },
                    { term: 'History policy', value: entity.historyPolicy },
                    { term: 'Privacy classification', value: entity.piiClassification },
                    { term: 'Analytical use', value: entity.analyticalUse },
                    { term: 'Reporting view', value: entity.reportingView, mono: true },
                  ]}
                />

                <div className="flex flex-wrap gap-1.5">
                  {entity.kpiDomains.map((id) => (
                    <Badge key={id} tone="neutral">
                      {DOMAIN_LABEL[id] ?? id}
                    </Badge>
                  ))}
                </div>

                <div className="mt-auto border-t border-line-subtle pt-3">
                  <SourceLink path={entity.docPath} field="source-to-target mapping" />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function viewName(entity: ModelEntity): string {
  return entity.reportingView.replace(/^reporting\./, '')
}

/**
 * The chip label for a history policy: everything up to the first comma or dash.
 * "Periodic snapshot, insert-only and immutable" becomes "Periodic snapshot".
 * The full string remains the button's accessible name and its tooltip, and is
 * shown in full in every entity's detail panel.
 */
function shortPolicy(policy: string): string {
  const cut = policy.split(/\s*[,\u2013-]\s/)[0] ?? policy
  return cut.trim()
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-ink-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

function EntityDetail({ entity }: { entity: ModelEntity }) {
  const incoming = modelRelationships.filter((rel) => rel.to === viewName(entity))
  const outgoing = modelRelationships.filter((rel) => rel.from === viewName(entity))

  return (
    <Card tone="accent" as="aside" className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span
            className={cx(
              'font-mono text-2xs tracking-wide',
              entity.kind === 'fact' ? 'text-model' : 'text-accent'
            )}
          >
            {entity.kind.toUpperCase()}
          </span>
          <Heading level={2} size="h4">
            {entity.label}
          </Heading>
          <CodeLabel tone="bare" className="text-2xs">
            {entity.table}
          </CodeLabel>
        </div>

        <GrainLabel grain={entity.grain} />

        <Text size="sm" tone="muted">
          {entity.analyticalUse}
        </Text>
      </div>

      <DefinitionList
        rows={[
          { term: 'Primary key', value: entity.primaryKey, mono: true },
          { term: 'History policy', value: entity.historyPolicy },
          { term: 'Privacy classification', value: entity.piiClassification },
          { term: 'Reporting view', value: entity.reportingView, mono: true },
          {
            term: 'Rows (development profile)',
            value:
              entity.rowCount === null ? 'Not recorded' : formatCount(entity.rowCount),
            mono: true,
          },
        ]}
      />

      <div className="flex flex-col gap-3 border-t border-accent-muted/30 pt-3">
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-2xs">
            Relationships in the semantic model (
            {String(incoming.length + outgoing.length)})
          </span>
          <ul className="flex flex-col gap-1 font-mono text-2xs text-ink-muted">
            {[...outgoing, ...incoming].map((rel, index) => (
              <li
                key={`${rel.from}.${rel.fromColumn}-${rel.to}.${rel.toColumn}-${String(index)}`}
                className="flex items-baseline gap-1.5 break-all"
              >
                {/* A solid rule for an active relationship, a dashed one for an
                    inactive relationship. Drawn as a bordered span rather than
                    set as an em dash and a pair of hyphens: the glyph version
                    was a decorative mark doing semantic work, it read as
                    punctuation to a screen reader, and it was the one em dash
                    left in rendered content on the site. The word "(inactive)"
                    below carries the meaning either way. */}
                <span
                  aria-hidden="true"
                  className={
                    rel.active
                      ? 'mt-1.5 inline-block w-4 shrink-0 border-t border-accent'
                      : 'mt-1.5 inline-block w-4 shrink-0 border-t border-dashed border-ink-faint'
                  }
                />
                <span>
                  {rel.from}.{rel.fromColumn} to {rel.to}.{rel.toColumn}
                </span>
                {!rel.active ? <span className="text-ink-faint">(inactive)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-accent-muted/30 pt-3">
        <SourceLink
          path={entity.docPath}
          field="source-to-target mapping"
          variant="block"
        />
      </div>
    </Card>
  )
}
