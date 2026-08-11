/**
 * The Management Actions workspace: the queue's shape, and the queue.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2C-BASELINE.md` §1–§3: `/dashboard/actions` was a **16,741 px** document —
 * eighteen and a half desktop screens, the tallest operating route in the console, taller than
 * the pre-`UX.2B` Inventory page that `UX.2B` treated as its outlier. It carried **zero framed
 * figures**, forty-eight `<h3>`s, fifty-one `<details>` and 1,567 visible words across 207
 * paragraphs. A general manager arriving to ask "what needs review this morning" scrolled past
 * all of it, and the queue's own shape — which domains, which severities, which stores — was
 * available only as counts inside a control bar.
 *
 * THE SUMMARY AND THE FACET BAR WERE THE SAME NUMBERS TWICE
 * ---------------------------------------------------------
 * `QueueSummary` printed the severity counts and `ActionFacetBar` printed them again as
 * controls, one above the other. `QueueShape` below is one object: the counts ARE the controls,
 * drawn as bars, and each row is the link it always was. That is the whole of how the queue's
 * distribution became visual — no new measure, no second tally, and the same hrefs.
 *
 * FACET SEMANTICS ARE UNCHANGED (`UX.2C` §37). The counts are counts of the WHOLE queue, not of
 * the filtered one, exactly as `buildActionQueue` computes them and for the reason its docstring
 * gives: a count that fell to zero the moment its own facet was selected would tell a reader
 * nothing about what selecting a different value would show. Nothing here recounts anything.
 *
 * SEVERITY AND DOMAIN ARE TWO DIFFERENT IDENTITIES (`UX.2C` §36). A severity's tone is ordered
 * — high, medium, low is a scale the rule register declares — and a domain's is categorical:
 * Accounting is not more or less than Inventory. They are drawn from two different token
 * families so a reader cannot read domain violet as a severity, and BOTH always print their
 * word, so no meaning rests on hue.
 *
 * STILL NOT A TASK MANAGER (`UX.2C` §35). No checkbox, no Done, no Complete, no Resolve, no
 * Assign, no assignee, no due date, no snooze, no comment, no workflow state, no note. None of
 * those exists in `DASH.12` and none was added: the queue is rebuilt from the dataset version
 * and holds no history, so a control that appeared to change something would be lying about a
 * system that cannot remember it was clicked. `ownerRole` remains the role best placed to LOOK
 * at the evidence, and is labelled `Review role` and never `Assigned to`.
 *
 * NO CLIENT JAVASCRIPT. Every facet is an anchor, every disclosure is a `<details>`, and the
 * page is complete with scripting off.
 */
import Link from 'next/link'

import { Card } from '@/components/ui/card-static'
import { Disclosure } from '@/components/ui/disclosure'
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
import { formatIsoDate } from '@/lib/dashboard/format'
import type { ActionDomain, ActionSeverity, ManagementAction } from '@/types/dashboard'
import { cx } from '@/lib/utils'

import { evidenceDisplay, evidenceLabel } from './actions-sections'

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Severity marks. An ORDERED scale, because the register declares one.
 *
 * These are the attention tokens at three weights rather than three unrelated hues: high,
 * medium and low are a progression and drawing them as a categorical set would throw that away.
 * The word is printed every time, so the ordering is never carried by hue alone.
 */
const SEVERITY_MARK: Readonly<Record<ActionSeverity, string>> = {
  high: 'bg-data-negative',
  medium: 'bg-data-warning',
  low: 'bg-data-neutral',
}

/**
 * Domain marks. A CATEGORICAL set, because Accounting is not more than Inventory.
 *
 * Written out in full so Tailwind's source scan can see every class, and keyed on the exported
 * domain code so a domain keeps its mark when another leaves the queue — the same rule
 * `storeMarkClass` follows for stores.
 *
 * FIVE DOMAINS AND THREE CHROMATIC TOKENS. This project's categorical palette carries three
 * hues and three greys, and `UX.2C` §41 forbids adding arbitrary values to it, so two domains
 * take greys. That is a real limit and it is why the mark is never the carrier: every domain
 * prints its name beside its mark, on the facet row and on every prompt, and the mark is a
 * memory aid for a reader who has already read the word once.
 */
const DOMAIN_MARK: Readonly<Record<ActionDomain, string>> = {
  inventory: 'bg-data-primary',
  'sales-gross': 'bg-data-secondary',
  fi: 'bg-data-tertiary',
  leads: 'bg-data-muted',
  accounting: 'bg-data-reference',
}

const DOMAIN_MARK_FALLBACK = 'bg-data-neutral'

/* -------------------------------------------------------------------------- */
/* The queue's shape                                                           */
/* -------------------------------------------------------------------------- */

/** One drawn facet group: a legend, and the options as linked bars. */
function FacetBars<T extends string>({
  legend,
  options,
  hrefFor,
  markFor,
  largest,
}: {
  readonly legend: string
  readonly options: readonly FacetOption<T>[]
  readonly hrefFor: (option: FacetOption<T>) => string
  readonly markFor: (option: FacetOption<T>) => string
  /** The reference count for this group's lengths. Each group scales to its own. */
  readonly largest: number
}) {
  if (options.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-2xs font-medium tracking-wide text-ink-faint uppercase">
        {legend}
      </p>
      <ul className="flex flex-col gap-1">
        {options.map((option) => (
          <li key={option.value}>
            <Link
              href={hrefFor(option)}
              /*
                `aria-current`, NOT `aria-pressed`. A facet is a LINK — it navigates to a URL a
                reader can copy — and `aria-pressed` belongs to buttons, so axe reports it as a
                critical violation on an anchor.
              */
              aria-current={option.selected ? 'true' : undefined}
              className={cx(
                'flex min-h-6 flex-col gap-0.5 rounded-xs px-1 py-0.5 transition-colors',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
                option.selected
                  ? 'bg-accent-wash text-accent'
                  : 'hover:bg-surface-sunken text-ink-muted'
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-2xs">{option.label}</span>
                <span className="numeric shrink-0 text-2xs font-semibold text-ink">
                  {option.count}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
              >
                <span
                  className={cx('block h-full rounded-pill', markFor(option))}
                  style={{
                    width:
                      largest <= 0
                        ? '0%'
                        : `${((option.count / largest) * 100).toFixed(4)}%`,
                  }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The widest count in a group, so its bars scale to something that exists. */
function largestOf<T extends string>(options: readonly FacetOption<T>[]): number {
  return options.reduce((max, option) => Math.max(max, option.count), 0)
}

/**
 * How many prompts there are, what they are made of, and the controls — one object.
 *
 * EACH GROUP SCALES TO ITS OWN LARGEST. Severity, domain, store and review role are four
 * different partitions of the same queue and their lengths are only comparable inside a group;
 * scaling all four to the queue total would draw every domain bar as a sliver beside a High
 * severity bar and say nothing.
 *
 * AN EMPTY VALUE IS NOT DRAWN FOR SYMMETRY (`UX.2C` §34). `buildActionQueue` already filters a
 * facet value out unless the queue contains it or the reader has selected it, so a `Low` row
 * with a zero is absent rather than printed as a tidy third option — except when the reader has
 * asked for exactly that and the answer is genuinely none.
 */
export function QueueShape({
  view,
  facets,
  asOfDate,
}: {
  readonly view: ActionQueueView
  readonly facets: ActionFacets
  readonly asOfDate: string
}) {
  const filtered = view.shown !== view.total

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="numeric text-[2rem] leading-none font-semibold text-ink">
          {view.shown}
        </span>
        <span className="text-xs text-ink-muted">
          {filtered
            ? `of ${String(view.total)} open review ${view.total === 1 ? 'prompt' : 'prompts'} shown`
            : `open review ${view.total === 1 ? 'prompt' : 'prompts'}`}
        </span>
        {filtered ? (
          <Link
            href={actionsHref({
              ...facets,
              severity: null,
              domain: null,
              owner: null,
              store: [],
            })}
            className="ml-auto inline-flex min-h-6 items-center text-xs underline underline-offset-4"
          >
            Clear all filters
          </Link>
        ) : null}
      </div>

      {/*
        THE COUNTS ARE THE CONTROLS. One `nav`, named as the e2e contract and the accessibility
        review both expect, holding four partitions of the same queue. Every count is a count of
        the WHOLE queue -- selecting High does not renumber the domains -- which is the
        behaviour `buildActionQueue` implements and `UX.2C` §37 forbids changing silently.
      */}
      {/*
        TWO PARTITIONS ACROSS ON A PHONE, FOUR ON A DESKTOP, and the base case is two rather
        than one because of what it costs on the route below it. Stacked one to a row, the four
        groups measured 872 px at 390 px wide, which put the first review prompt 1,947 px down
        -- 259 px past the two screens `UX.2C` §52 asks this route for. Two across halves the
        column and the first prompt lands at 1,319 px. `High 18` in a 180 px column is not a
        cramped label; four groups a reader has to scroll past to reach the queue is a cramped
        page.
      */}
      <nav
        aria-label="Filter the review queue"
        className="grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-4"
      >
        <FacetBars
          legend="Severity"
          options={view.severities}
          hrefFor={(option) => toggleFacetHref(facets, 'severity', option.value)}
          markFor={(option) => SEVERITY_MARK[option.value]}
          largest={largestOf(view.severities)}
        />
        <FacetBars
          legend="Domain"
          options={view.domains}
          hrefFor={(option) => toggleFacetHref(facets, 'domain', option.value)}
          markFor={(option) => DOMAIN_MARK[option.value] ?? DOMAIN_MARK_FALLBACK}
          largest={largestOf(view.domains)}
        />
        <FacetBars
          legend="Store"
          options={view.stores}
          hrefFor={(option) => toggleStoreHref(facets, option.value)}
          markFor={() => 'bg-data-neutral'}
          largest={largestOf(view.stores)}
        />
        <FacetBars
          legend="Review role"
          options={view.owners}
          hrefFor={(option) => toggleFacetHref(facets, 'owner', option.value)}
          markFor={() => 'bg-data-neutral'}
          largest={largestOf(view.owners)}
        />
      </nav>

      <p className="text-2xs leading-normal text-ink-muted">
        Counts are of the whole queue, so selecting one facet does not renumber the
        others. Open means present in the data this console is serving, as of{' '}
        {formatIsoDate(asOfDate)}: the queue is rebuilt whenever that data is and holds no
        workflow state, so nothing here is assigned, acknowledged, completed or overdue.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One review prompt                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A review prompt, compacted to what a manager reviews.
 *
 * WHAT STAYED VISIBLE, AND IT IS EXACTLY `UX.2C` §39's LIST: why the prompt exists (the title),
 * the observed value, the threshold it crossed, the context that scopes it (severity, domain,
 * store, review role), and the next drill-through.
 *
 * WHAT MOVED BEHIND THE DISCLOSURE: the rule identifier, the entity type and identifier, the
 * date basis, the limitation text and the full evidence set. All of it is still in the served
 * markup, in reading order, in a browser text search and with scripting off — `<details>`
 * hides nothing from anything except the eye. Read once it is thorough; read sixty-two times it
 * was rule-engine documentation, and sixty-two copies of it is most of what made this route
 * 16,741 px tall.
 *
 * THE OBSERVED VALUE AND ITS THRESHOLD ARE ON ONE LINE, because the prompt exists precisely
 * because the first crossed the second, and separating them by two paragraphs made the reader
 * assemble the finding themselves.
 *
 * `<article>`, because the e2e contract counts these and because a review prompt is a
 * self-contained composition. Severity, domain and role are text in every case.
 */
/**
 * The headline evidence value, without printing its unit twice.
 *
 * `evidenceDisplay` appends the exported unit, and the label beside it usually contains the
 * same word: `days_in_stock` renders as "212 days" under the label "days in stock", so the
 * card read "212 days days in stock". The suffix is dropped only when the label already
 * carries it, and only by exact suffix match — the value itself is never re-derived, and a
 * currency or ratio unit is untouched because those are formatted into the figure rather
 * than appended to it.
 */
function leadValue(entry: ManagementAction['evidence'][number]): string {
  const display = evidenceDisplay(entry)
  const unit = entry.unit
  if (unit === null || unit === 'USD' || unit === 'ratio') return display
  const suffix = ` ${unit}`
  if (!display.endsWith(suffix)) return display
  if (!evidenceLabel(entry.name).toLowerCase().includes(unit.toLowerCase()))
    return display
  return display.slice(0, -suffix.length)
}

export function ReviewPrompt({ action }: { readonly action: ManagementAction }) {
  const [lead, ...rest] = action.evidence
  const domainMark = DOMAIN_MARK[action.domain] ?? DOMAIN_MARK_FALLBACK

  return (
    <Card as="article" padding="none" className="flex flex-col gap-2 p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-line-subtle bg-surface px-2 py-0.5 text-2xs text-ink">
          <span
            aria-hidden="true"
            className={cx(
              'inline-block size-2 rounded-pill',
              SEVERITY_MARK[action.severity]
            )}
          />
          {SEVERITY_LABELS[action.severity]}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-line-subtle bg-surface px-2 py-0.5 text-2xs text-ink-muted">
          <span
            aria-hidden="true"
            className={cx('inline-block size-2 rounded-pill', domainMark)}
          />
          {DOMAIN_LABELS[action.domain]}
        </span>
        {action.store === null ? null : (
          <span className="inline-flex items-center rounded-pill border border-line-subtle bg-surface px-2 py-0.5 font-mono text-2xs text-ink-muted">
            {action.store}
          </span>
        )}
        {/*
          "Review role", never "Assigned to". The role best placed to LOOK at the evidence —
          not the person responsible for it, at fault for it, or holding a task about it. No
          such relationship exists in this system.
        */}
        <span className="ml-auto shrink-0 text-2xs text-ink-muted">
          Review role: {action.ownerRole}
        </span>
      </div>

      <Heading level={3} size="h6" className="text-sm text-ink">
        {action.title}
      </Heading>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {lead === undefined ? null : (
          <span className="numeric text-lg font-semibold text-ink">
            {leadValue(lead)}{' '}
            <span className="font-sans text-2xs font-normal text-ink-muted">
              {evidenceLabel(lead.name).toLowerCase()}
            </span>
          </span>
        )}
        {action.thresholdsUsed.map((threshold) => (
          <span key={threshold.name} className="text-2xs text-ink-muted">
            {threshold.label}{' '}
            <span className="numeric text-ink">{threshold.value ?? 'not set'}</span>
            {threshold.units === '' ? null : ` ${threshold.units}`}
          </span>
        ))}
      </div>

      <p className="text-2xs leading-normal text-ink-muted">{action.recommendedReview}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={action.drillThrough}
          className="inline-flex min-h-6 items-center text-xs underline underline-offset-4"
        >
          Open the evidence behind this
        </Link>
      </div>

      {rest.length === 0 ? null : (
        <Disclosure label="Evidence, threshold detail and the rule" className="border-0">
          <dl className="grid gap-x-6 gap-y-1.5 @md:grid-cols-2">
            {action.evidence.map((entry) => (
              <div key={entry.name} className="flex justify-between gap-4 @md:block">
                <dt className="text-2xs text-ink-muted">{evidenceLabel(entry.name)}</dt>
                <dd className="numeric text-2xs text-ink">{evidenceDisplay(entry)}</dd>
              </div>
            ))}
          </dl>
          <Text size="xs" tone="muted" className="mt-2">
            {action.limitations}
          </Text>
          <Text size="xs" tone="muted" className="mt-1.5">
            Rule {action.ruleId} · {action.entityType.split('_').join(' ')}{' '}
            {action.entityId}
            {action.dateBasis === null ? null : ` · ${action.dateBasis} basis`}
          </Text>
        </Disclosure>
      )}
    </Card>
  )
}

/**
 * The queue itself, which is still the page's primary object (`UX.2C` §33 and §35).
 *
 * TWO COLUMNS ABOVE `xl`, ONE BELOW. A review prompt is now short enough that a full-width card
 * on a 1440 px screen is mostly empty ground, and a manager triaging a queue reads down a
 * column. The order is unchanged — severity, then domain, then store, then rule — and it reads
 * down the first column and then the second, which is the order the markup is in.
 */
export function ReviewQueue({ view }: { readonly view: ActionQueueView }) {
  if (view.actions.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Heading level={3} size="h6" className="text-sm text-ink">
          No current conditions meet the configured review rules for this scope
        </Heading>
        {/*
          An empty queue is not a clean bill of health, and the copy may not let a reader take
          it for one. It means the configured rules found nothing — over a register where most
          proposed identifiers are switched off for want of evidence.
        */}
        <Text size="sm" tone="muted">
          That is not a statement that nothing needs attention. It means no rule this
          project can evaluate honestly matched, over a register in which most proposed
          rules remain disabled for want of the evidence they would need.
        </Text>
      </div>
    )
  }
  return (
    <ul className="grid grid-cols-1 gap-2 @4xl:grid-cols-2">
      {view.actions.map((action) => (
        <li key={action.actionId} className="min-w-0">
          <ReviewPrompt action={action} />
        </li>
      ))}
    </ul>
  )
}
