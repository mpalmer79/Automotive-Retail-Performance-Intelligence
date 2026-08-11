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
import { Disclosure } from '@/components/ui/disclosure'
import { Cluster } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { DOMAIN_LABELS, SEVERITY_LABELS } from '@/lib/dashboard/action-contract'
import {
  actionsHref,
  type ActionFacets,
  type ActionQueueView,
} from '@/lib/dashboard/actions'
import type { ChangeDriverState } from '@/lib/dashboard/change-drivers'
import { cellToExact } from '@/lib/dashboard/decimal'
import { formatCurrencyExact, formatRateExact } from '@/lib/dashboard/format'
import type { ActionSeverity, ManagementAction } from '@/types/dashboard'
import { cx } from '@/lib/utils'

import { BridgeChart, type BridgeBar } from './visuals'

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
/* Region 2 — facets                                                           */
/* -------------------------------------------------------------------------- */
/* Region 3 — the queue                                                        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Region 4 — why did this change?                                             */
/* -------------------------------------------------------------------------- */
/* Region 4b — the executive change-driver bridge                              */
/* -------------------------------------------------------------------------- */
/* Evidence rendering, shared by the queue and the Executive digest             */
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
export function evidenceDisplay(entry: ManagementAction['evidence'][number]): string {
  if (entry.value === null) return 'not recorded'
  if (typeof entry.value === 'boolean') return entry.value ? 'yes' : 'no'
  const text = String(entry.value)
  // Guarded on the COLUMN TYPE, not on whether the string happens to parse. `cellToExact`
  // throws on "Used" rather than returning null, and asking it to parse a condition group
  // is a category error whichever way it answers.
  const numeric =
    entry.type === 'currency' || entry.type === 'exact' || entry.type === 'double'
  if (numeric) {
    const exact = cellToExact(entry.value)
    if (exact !== null) {
      if (entry.unit === 'USD') return formatCurrencyExact(exact, 2)
      if (entry.unit === 'ratio')
        return formatRateExact(exact, entry.displayPrecision ?? 4)
    }
  }
  if (entry.unit !== null && entry.unit !== 'ratio') return `${text} ${entry.unit}`
  return text
}

/** Turn an exported column name into a readable label. Presentation only. */
export function evidenceLabel(name: string): string {
  const words = name.split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/* -------------------------------------------------------------------------- */

/**
 * The gross change-driver decomposition, drawn as the waterfall it is.
 *
 * WHY THIS IS A CHART NOW AND WAS A DEFINITION LIST BEFORE. The bridge is the strongest
 * analytical object this project has: it takes one number a general manager already
 * believes — total gross moved by this much — and attributes the movement, exactly, to
 * three components that sum back to it. A definition list states that; a waterfall SHOWS
 * it, and the thing being shown is precisely that the parts close the gap between the
 * anchors. `UX.2A` §14 asks for the prominence, and the geometry is what the prominence
 * is for.
 *
 * ONE AUTHORITY, AND THIS IS NOT IT. `vw_gross_change_bridge` owns the decomposition;
 * `buildBridge` verifies the exported identity and divides for display; `buildChangeDrivers`
 * applies the materiality policy. This component receives the finished `ChangeDriverState`
 * and places it. There is no second formula, and this file performs no arithmetic on an
 * exact value — the totals it draws are the ones the module already computed.
 *
 * COLOUR BY SIGN IS PERMITTED HERE AND ALMOST NOWHERE ELSE ON THIS CONSOLE. A waterfall
 * step IS a signed contribution to a total: it added or it subtracted, which is a fact
 * about the arithmetic rather than a judgement about the business. The closing anchor takes
 * the neutral reference fill, because a level is not a direction. Every amount is printed
 * with its sign beside its label, so nothing is encoded in hue alone.
 *
 * ATTRIBUTION, NEVER CAUSE. "The bridge attributes", "this decomposition explains". Never
 * "caused" or "drove" — a sequential decomposition apportions an observed change between
 * components in a documented order, and a different order would apportion it differently.
 * The vocabulary is asserted by test.
 */
export function ChangeDriverBridge({
  drivers,
  authority,
}: {
  readonly drivers: ChangeDriverState
  readonly authority: string
}) {
  if (drivers.kind === 'unavailable') {
    return (
      <div className="flex flex-col gap-2">
        <Text size="sm" tone="muted">
          {drivers.reason}
        </Text>
        {/*
          The CHANGE is shown even when its decomposition is not, because the two are
          different facts. Rendering $0 for an unavailable decomposition would state that
          nothing moved, which is a different and false claim.
        */}
        {drivers.changeDisplay === null ? null : (
          <Text size="sm">The period change itself is {drivers.changeDisplay}.</Text>
        )}
      </div>
    )
  }

  const bars: readonly BridgeBar[] = [
    ...drivers.effects.map((effect): BridgeBar => ({
      key: effect.code,
      label:
        effect.grouped && effect.absorbed.length > 0
          ? `${effect.label} (${String(effect.absorbed.length)})`
          : effect.label,
      value: effect.amount,
      display: effect.display,
      kind: 'step',
    })),
    {
      key: 'total-change',
      label: 'Total change',
      value: drivers.change,
      display: drivers.changeDisplay,
      kind: 'anchor',
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <BridgeChart
        title={`Total gross change, ${drivers.monthLabel}`}
        bars={bars}
        summary={drivers.statement}
        headingLevel={3}
      />
      <Disclosure label="How this decomposition works">
        <Text size="sm" tone="muted">
          The bridge is computed in SQL by {authority} and carried through the export. It
          is a SEQUENTIAL decomposition: each effect is measured with the earlier ones
          already applied, so the order is part of the method and a different order would
          apportion the same change differently. The bridge attributes; it does not
          establish cause.
        </Text>
        <Text size="sm" tone="muted">
          Effects smaller than {drivers.materiality.display} are grouped into a single
          remainder rather than listed — {drivers.materiality.label.toLowerCase()}.
          Grouped, never dropped: the listed effects and the remainder sum to the period
          change exactly
          {drivers.reconciles ? '' : ', and this comparison currently does not reconcile'}
          .
        </Text>
        {drivers.verified ? null : (
          <Text size="sm" tone="muted">
            The exported numerators did not satisfy the view&rsquo;s own identity for this
            scope, so the decomposition above is reported as unverified.
          </Text>
        )}
      </Disclosure>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The Executive Overview's compact block                                      */
/* -------------------------------------------------------------------------- */

/**
 * The queue's shape, before any of its rows.
 *
 * `UX.2A` §13 asks the Executive to carry a compact count by severity and by domain. Both
 * come from `buildActionQueue`, the same function `/dashboard/actions` calls, over the same
 * rows — so the counts here and the counts there cannot disagree. Each is a LINK to the
 * facet it names, which makes the summary a way into the queue rather than a decoration
 * beside it, and keeps the whole control surface working with scripting off.
 *
 * IT IS STILL NOT A TASK MANAGER. No `Done`, no `Assign`, no `Snooze`, no due date and no
 * owner person. A count of open review prompts is a property of the dataset version being
 * served, and `owner_role` remains the role best placed to LOOK at the evidence.
 */
export function AttentionSummary({
  view,
  facets,
}: {
  readonly view: ActionQueueView
  /**
   * The facet state the counts were computed under.
   *
   * The Executive passes the reader's STORE filter and nothing else, so the summary counts
   * what the rest of the screen is scoped to, and every chip below carries that scope
   * through to the queue rather than silently widening it.
   */
  readonly facets: ActionFacets
}) {
  const chip = cx(
    'inline-flex min-h-6 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-2xs',
    'border-line-subtle bg-surface text-ink-muted',
    'transition-colors duration-(--arpi-motion-fast) hover:border-line-strong hover:text-accent'
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2">
        <span className="numeric text-2xl font-semibold text-ink">{view.total}</span>
        <span className="text-xs text-ink-muted">
          open review {view.total === 1 ? 'prompt' : 'prompts'} in scope
        </span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {view.severities.map((option) => (
          <li key={`severity-${option.value}`}>
            <Link
              href={actionsHref({ ...facets, severity: option.value })}
              className={chip}
            >
              <span>{option.label}</span>
              <span className="numeric font-semibold text-ink">{option.count}</span>
            </Link>
          </li>
        ))}
        {view.domains.map((option) => (
          <li key={`domain-${option.value}`}>
            <Link
              href={actionsHref({ ...facets, domain: option.value })}
              className={chip}
            >
              <span>{option.label}</span>
              <span className="numeric font-semibold text-ink">{option.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
            <li key={action.actionId} className="py-2 first:pt-0">
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
              <p className="mt-0.5 text-xs text-ink-muted">
                {DOMAIN_LABELS[action.domain]}
                {action.store === null ? '' : ` · ${action.store}`}
                {lead === undefined
                  ? ''
                  : ` · ${evidenceDisplay(lead)} ${evidenceLabel(lead.name).toLowerCase()}`}
              </p>
            </li>
          )
        })}
      </ul>
      <Text size="xs" className="mt-2">
        <Link href={href} className="underline underline-offset-4">
          View all {total} review {total === 1 ? 'prompt' : 'prompts'}
        </Link>
      </Text>
    </>
  )
}
