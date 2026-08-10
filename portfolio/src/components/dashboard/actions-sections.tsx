/**
 * The Management Actions surface.
 *
 * WHAT THIS IS, AND WHAT IT REFUSES TO LOOK LIKE
 * ----------------------------------------------
 * An analytical review queue. Not a task manager, not a ticket list, not an inbox. There is
 * no checkbox, no "done", no assignee, no due date and no snooze, because none of those
 * states exists: the queue is regenerated from the dataset version and holds no history. A
 * control that appeared to change something would be lying about a system that cannot
 * remember it was clicked.
 *
 * WHAT A ROW HAS TO EARN
 * ----------------------
 * A reader should be able to answer three questions from one card without leaving it: what
 * condition holds, what evidence made it hold, and where to look next. So severity, domain,
 * store and review role sit on one line; the evidence the rule chose is a definition list of
 * exact exported values; the threshold that fired is stated with the words "project
 * default" attached; and the drill-through is a plain link to the surface that holds the
 * detail. The rule identifier is secondary metadata, not the headline — a manager reviews a
 * condition, not an implementation.
 *
 * SEVERITY IS NEVER COLOUR ALONE
 * ------------------------------
 * Every severity carries its word. The badge's tone reinforces the label and never replaces
 * it, and "high" means the rule's own high-severity predicate matched — not that anything
 * is urgent, likely, or certain.
 *
 * NO JAVASCRIPT REQUIRED
 * ----------------------
 * Every facet is an anchor and every disclosure is a `<details>`. The page is complete with
 * scripting off: the queue, its evidence, its thresholds, the change drivers and the
 * methodology all render on the server.
 *
 * Server components.
 */
import Link from 'next/link'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card-static'
import { Disclosure } from '@/components/ui/disclosure'
import { Cluster, Stack } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { DOMAIN_LABELS, SEVERITY_LABELS } from '@/lib/dashboard/action-contract'
import {
  actionsHref,
  toggleFacetHref,
  toggleStoreHref,
  type ActionFacets,
  type ActionQueueView,
  type FacetOption,
} from '@/lib/dashboard/actions'
import type { ChangeDriverState } from '@/lib/dashboard/change-drivers'
import { cellToExact } from '@/lib/dashboard/decimal'
import {
  formatCurrencyExact,
  formatIsoDate,
  formatRateExact,
} from '@/lib/dashboard/format'
import type { ActionSeverity, ManagementAction } from '@/types/dashboard'
import { cx } from '@/lib/utils'

/**
 * Severity to badge tone.
 *
 * `failed`/`pending`/`neutral` are the existing semantic tones. They are borrowed for their
 * VISUAL WEIGHT, not their meaning: a high-severity action is not a failure, and the word
 * beside the colour is what carries the meaning.
 */
const SEVERITY_TONE: Readonly<Record<ActionSeverity, BadgeTone>> = {
  high: 'failed',
  medium: 'pending',
  low: 'neutral',
}

/* -------------------------------------------------------------------------- */
/* Region 1 — the queue summary                                                */
/* -------------------------------------------------------------------------- */

export function QueueSummary({
  view,
  asOfDate,
  facets,
}: {
  readonly view: ActionQueueView
  readonly asOfDate: string
  readonly facets: ActionFacets
}) {
  const filtered = view.shown !== view.total
  return (
    <Card className="p-5">
      <Cluster className="items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[2rem] leading-none font-semibold text-ink">
            {view.shown}
          </p>
          <Text size="sm" tone="muted" className="mt-1">
            {filtered ? (
              <>
                of {view.total} open review {view.total === 1 ? 'prompt' : 'prompts'} shown
              </>
            ) : (
              <>open review {view.total === 1 ? 'prompt' : 'prompts'}</>
            )}
          </Text>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {view.severities.map((option) => (
            <div key={option.value}>
              <dt className="text-xs tracking-wide text-ink-muted uppercase">
                {option.label}
              </dt>
              <dd className="font-mono text-lg font-semibold text-ink">{option.count}</dd>
            </div>
          ))}
        </dl>
      </Cluster>
      <Text size="sm" tone="muted" className="mt-4">
        {/*
          "Open" is the only word available and it needs its boundary said out loud, because
          every other product a reader has used means something different by it. Here it
          means "present in the dataset version being served" and nothing else: no workflow
          state exists, nothing was assigned, and nothing is overdue.
        */}
        Open means present in this dataset version as of {formatIsoDate(asOfDate)}. The queue
        is regenerated with the data and holds no workflow state: nothing here is assigned,
        acknowledged, completed or overdue.
      </Text>
      {filtered ? (
        <Text size="sm" className="mt-3">
          <Link href={actionsHref({ ...facets, severity: null, domain: null, owner: null, store: [] })} className="underline underline-offset-4">
            Clear all filters
          </Link>
        </Text>
      ) : null}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Region 2 — facets                                                           */
/* -------------------------------------------------------------------------- */

function FacetGroup<T extends string>({
  legend,
  options,
  hrefFor,
}: {
  readonly legend: string
  readonly options: readonly FacetOption<T>[]
  readonly hrefFor: (option: FacetOption<T>) => string
}) {
  if (options.length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{legend}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.value}>
            <Link
              href={hrefFor(option)}
              aria-pressed={option.selected}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
                option.selected
                  ? 'border-accent-muted/60 bg-accent-wash text-accent'
                  : 'border-line bg-surface hover:border-line-strong text-ink-muted'
              )}
            >
              <span>{option.label}</span>
              <span className="font-mono text-xs tabular-nums opacity-70">{option.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ActionFacetBar({
  view,
  facets,
}: {
  readonly view: ActionQueueView
  readonly facets: ActionFacets
}) {
  return (
    <nav aria-label="Filter the review queue" className="grid gap-4 sm:grid-cols-2">
      <FacetGroup
        legend="Severity"
        options={view.severities}
        hrefFor={(option) => toggleFacetHref(facets, 'severity', option.value)}
      />
      <FacetGroup
        legend="Domain"
        options={view.domains}
        hrefFor={(option) => toggleFacetHref(facets, 'domain', option.value)}
      />
      <FacetGroup
        legend="Store"
        options={view.stores}
        hrefFor={(option) => toggleStoreHref(facets, option.value)}
      />
      <FacetGroup
        legend="Review role"
        options={view.owners}
        hrefFor={(option) => toggleFacetHref(facets, 'owner', option.value)}
      />
    </nav>
  )
}

/* -------------------------------------------------------------------------- */
/* Region 3 — the queue                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Format one evidence value for display, without changing what it means.
 *
 * FORMATTING, NEVER CONVERSION. The exact value crosses the export boundary as a string so
 * that no float touches it, and it is parsed into the same exact representation the rest of
 * the console uses before being rendered at a sane number of places. A bridge effect is
 * published as -14067.506129032258 because that is the exact quotient; showing a manager
 * twelve decimal places of a dollar figure is not honesty, it is noise, and the underlying
 * value is unchanged.
 *
 * A null stays visibly absent. Rendering it as 0 would destroy the distinction the warehouse
 * maintains everywhere else between "not observed" and "zero".
 */
function evidenceDisplay(entry: ManagementAction['evidence'][number]): string {
  if (entry.value === null) return 'not recorded'
  if (typeof entry.value === 'boolean') return entry.value ? 'yes' : 'no'
  const text = String(entry.value)
  // Guarded on the COLUMN TYPE, not on whether the string happens to parse. `cellToExact`
  // throws on "Used" rather than returning null, and asking it to parse a condition group
  // is a category error whichever way it answers.
  const numeric = entry.type === 'currency' || entry.type === 'exact' || entry.type === 'double'
  if (numeric) {
    const exact = cellToExact(entry.value)
    if (exact !== null) {
      if (entry.unit === 'USD') return formatCurrencyExact(exact, 2)
      if (entry.unit === 'ratio') return formatRateExact(exact, entry.displayPrecision ?? 4)
    }
  }
  if (entry.unit !== null && entry.unit !== 'ratio') return `${text} ${entry.unit}`
  return text
}

/** Turn an exported column name into a readable label. Presentation only. */
function evidenceLabel(name: string): string {
  const words = name.split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function ActionCard({ action }: { readonly action: ManagementAction }) {
  const [lead, ...rest] = action.evidence
  return (
    <Card as="article" className="p-5">
      <Cluster className="items-center gap-2">
        <Badge tone={SEVERITY_TONE[action.severity]}>
          {SEVERITY_LABELS[action.severity]}
        </Badge>
        <Badge>{DOMAIN_LABELS[action.domain]}</Badge>
        {action.store === null ? null : <Badge mono>{action.store}</Badge>}
        <Text size="sm" tone="muted">
          {/*
            "Review role", never "Assigned to". The role best placed to LOOK at the
            evidence — not the person responsible for it, at fault for it, or holding a task
            about it. No such relationship exists in this system.
          */}
          Review role: {action.ownerRole}
        </Text>
      </Cluster>

      <Heading level={3} size="h5" className="mt-3">
        {action.title}
      </Heading>

      {lead === undefined ? null : (
        <p className="mt-2 font-mono text-lg font-semibold text-ink">
          {evidenceDisplay(lead)}{' '}
          <span className="font-sans text-sm font-normal text-ink-muted">
            {evidenceLabel(lead.name).toLowerCase()}
          </span>
        </p>
      )}

      {action.thresholdsUsed.length === 0 ? null : (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {action.thresholdsUsed.map((threshold) => (
            <li key={threshold.name} className="text-sm text-ink-muted">
              <span className="text-ink">{threshold.label}:</span>{' '}
              <span className="font-mono tabular-nums">{threshold.value ?? 'not set'}</span>
              {threshold.units === '' ? null : ` ${threshold.units}`}
            </li>
          ))}
        </ul>
      )}

      <Text size="sm" className="mt-3">
        <span className="text-ink-muted">Review next:</span> {action.recommendedReview}
      </Text>

      {rest.length === 0 ? null : (
        <Disclosure label="Evidence this action carries" className="mt-4">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {action.evidence.map((entry) => (
              <div key={entry.name} className="flex justify-between gap-4 sm:block">
                <dt className="text-sm text-ink-muted">{evidenceLabel(entry.name)}</dt>
                <dd className="font-mono text-sm tabular-nums text-ink">
                  {evidenceDisplay(entry)}
                </dd>
              </div>
            ))}
          </dl>
          <Text size="sm" tone="muted" className="mt-3">
            {action.limitations}
          </Text>
          <Text size="sm" tone="muted" className="mt-2">
            Rule {action.ruleId} · {action.entityType.split('_').join(' ')} {action.entityId}
            {action.dateBasis === null ? null : ` · ${action.dateBasis} basis`}
          </Text>
        </Disclosure>
      )}

      <Text size="sm" className="mt-4">
        <Link href={action.drillThrough} className="underline underline-offset-4">
          Open the evidence behind this
        </Link>
      </Text>
    </Card>
  )
}

export function ActionQueue({ view }: { readonly view: ActionQueueView }) {
  if (view.actions.length === 0) {
    return (
      <Card className="p-6">
        <Heading level={3} size="h5">
          No current conditions meet the configured review rules for this scope
        </Heading>
        {/*
          An empty queue is not a clean bill of health, and the copy may not let a reader
          take it for one. It means the configured rules found nothing — over a register
          where eighteen of thirty identifiers are switched off for want of evidence.
        */}
        <Text size="sm" tone="muted" className="mt-2">
          That is not a statement that nothing needs attention. It means no rule this project
          can evaluate honestly matched, over a register in which most proposed rules remain
          disabled for want of the evidence they would need.
        </Text>
      </Card>
    )
  }
  return (
    <Stack gap={3} as="ul">
      {view.actions.map((action) => (
        <li key={action.actionId}>
          <ActionCard action={action} />
        </li>
      ))}
    </Stack>
  )
}

/* -------------------------------------------------------------------------- */
/* Region 4 — why did this change?                                             */
/* -------------------------------------------------------------------------- */

export function ChangeDriverPanel({
  drivers,
  authority,
}: {
  readonly drivers: ChangeDriverState
  readonly authority: string
}) {
  if (drivers.kind === 'unavailable') {
    return (
      <Card className="p-5">
        <Heading level={3} size="h5">
          Change explanation unavailable for this comparison
        </Heading>
        <Text size="sm" tone="muted" className="mt-2">
          {drivers.reason}
        </Text>
        {/*
          The CHANGE is shown even when its decomposition is not, because the two are
          different facts. Rendering $0 for an unavailable decomposition would state that
          nothing moved, which is a different and false claim.
        */}
        {drivers.changeDisplay === null ? null : (
          <Text size="sm" className="mt-2">
            The period change itself is {drivers.changeDisplay}.
          </Text>
        )}
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <Cluster className="items-baseline justify-between gap-4">
        <Heading level={3} size="h5">
          Total gross change, {drivers.monthLabel}
        </Heading>
        <p className="font-mono text-lg font-semibold tabular-nums text-ink">
          {drivers.changeDisplay}
        </p>
      </Cluster>

      <dl className="mt-4 space-y-2">
        {drivers.effects.map((effect) => (
          <div
            key={effect.code}
            className="flex items-baseline justify-between gap-4 border-t border-line-subtle pt-2"
          >
            <dt className="text-sm text-ink-muted">
              {effect.label}
              {effect.grouped && effect.absorbed.length > 0 ? (
                <span className="ml-1 text-xs">
                  ({effect.absorbed.length} effect{effect.absorbed.length === 1 ? '' : 's'} and
                  rounding)
                </span>
              ) : null}
            </dt>
            <dd
              className={cx(
                'font-mono text-sm tabular-nums',
                // The SIGN is in the text as well as the colour: these are signed
                // contributions, so a reader who cannot distinguish the two hues still
                // reads the direction off the number.
                effect.display.startsWith('-') ? 'text-failed' : 'text-verified'
              )}
            >
              {effect.display}
            </dd>
          </div>
        ))}
      </dl>

      <Text size="sm" className="mt-4">
        {drivers.statement}
      </Text>

      <Disclosure label="How this decomposition works" className="mt-4">
        <Text size="sm" tone="muted">
          The bridge is computed in SQL by {authority} and carried through the export. It is a
          SEQUENTIAL decomposition: each effect is measured with the earlier ones already
          applied, so the order is part of the method and a different order would apportion
          the same change differently. The bridge attributes; it does not establish cause.
        </Text>
        <Text size="sm" tone="muted" className="mt-2">
          Effects smaller than {drivers.materiality.display} are grouped into a single
          remainder rather than listed — {drivers.materiality.label.toLowerCase()}. Grouped,
          never dropped: the listed effects and the remainder sum to the period change
          exactly
          {drivers.reconciles ? '' : ', and this comparison currently does not reconcile'}.
        </Text>
        {drivers.verified ? null : (
          <Text size="sm" tone="muted" className="mt-2">
            The exported numerators did not satisfy the view&rsquo;s own identity for this
            scope, so the decomposition above is reported as unverified.
          </Text>
        )}
      </Disclosure>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* The Executive Overview's compact block                                      */
/* -------------------------------------------------------------------------- */

export function TopActions({
  actions,
  total,
  href,
}: {
  readonly actions: readonly ManagementAction[]
  readonly total: number
  readonly href: string
}) {
  if (actions.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No current conditions meet the configured review rules.
      </Text>
    )
  }
  return (
    <>
      <ul className="divide-y divide-line-subtle">
        {actions.map((action) => {
          const [lead] = action.evidence
          return (
            <li key={action.actionId} className="py-2.5 first:pt-0">
              <Cluster className="items-baseline gap-2">
                <Badge tone={SEVERITY_TONE[action.severity]}>
                  {SEVERITY_LABELS[action.severity]}
                </Badge>
                <Link
                  href={action.drillThrough}
                  className="text-sm text-ink underline-offset-4 hover:underline"
                >
                  {action.title}
                </Link>
              </Cluster>
              <Text size="sm" tone="muted" className="mt-1">
                {DOMAIN_LABELS[action.domain]}
                {action.store === null ? '' : ` · ${action.store}`}
                {lead === undefined ? '' : ` · ${evidenceDisplay(lead)} ${evidenceLabel(lead.name).toLowerCase()}`}
              </Text>
            </li>
          )
        })}
      </ul>
      <Text size="sm" className="mt-3">
        <Link href={href} className="underline underline-offset-4">
          View all {total} review {total === 1 ? 'prompt' : 'prompts'}
        </Link>
      </Text>
    </>
  )
}
