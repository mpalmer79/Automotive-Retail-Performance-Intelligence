'use client'

/**
 * The console's filter controls — the one client island on the page.
 *
 * IT IS A REAL FORM, AND THAT IS THE NO-JAVASCRIPT ANSWER
 * ------------------------------------------------------
 * `<form method="get" action="/dashboard">` with native `<select>`s named exactly
 * as `INFORMATION_ARCHITECTURE.md` §6 names them. With scripting disabled it
 * submits and the route renders the filtered view, because the URL grammar the
 * browser produces is the grammar `parseFilters` reads. With scripting enabled the
 * submit handler builds the canonical URL instead and pushes it, so the address bar
 * carries `?period=2025-11&store=GSA-002` rather than the browser's own
 * `?period=2025-11&compare=&store=GSA-002&condition=&source=`.
 *
 * `push`, NOT `replace`. Every applied filter is a history entry, so Back returns
 * to the previous view and Forward returns to the one after it. The KPI catalogue
 * and the inventory explorer use `replace` for the opposite and equally deliberate
 * reason: they filter on every keystroke, and a history entry per keystroke makes
 * the back button useless. Here a change is a discrete act.
 *
 * WHAT THIS COMPONENT CANNOT SEE
 * ------------------------------
 * Any data. It receives option lists — three store codes, six month labels,
 * nineteen lead-source codes — as props, and the generated dashboard tree is not in
 * its module graph. That is not a convention: `outputFileTracingRoot` is pinned to
 * `portfolio/`, so a module-scope JSON import from a `'use client'` module lands in
 * the browser bundle, and `tests/unit/dashboard-boundaries.test.ts` asserts no
 * client module reaches one.
 *
 * WHAT THE CONTROLS DO NOT OFFER
 * ------------------------------
 * A custom date range and a multi-store selection are part of the URL contract and
 * are parsed, validated and rendered — they are simply not on the control surface,
 * because a two-input range composed into one parameter cannot be expressed by a
 * native GET form without scripting, and a control that only works with JavaScript
 * would be the one part of this page that breaks when the rest does not. Both are
 * documented, with copyable examples, in the filter-grammar disclosure beside this
 * bar.
 *
 * WHICH CONTROLS CARRY A HINT, AFTER `UX.2A`
 * ------------------------------------------
 * Only the ones whose effect is NARROWER THAN THEIR LABEL. Condition and lead source are
 * declared `partial` on most console routes — they scope some measure families and not
 * others — and a reader who filters to `New` and watches total gross stay put needs that
 * sentence or they will conclude the control is broken. Period, comparison and store are
 * declared `applied`: they do exactly what their labels say, to every figure, and the
 * three sentences that said so were 21 words of prose in the top 300 px of every operating
 * route. `UX.2A` §4 asks the control band to be compact, and an explanation that explains
 * nothing is the first place to get it — the active-filter chips below the bar still label
 * every parameter's support level on every route.
 */
import { useCallback, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { Field, SelectControl } from '@/components/ui/control'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_FILTERS,
  filtersHref,
  type CompareMode,
  type ConditionValue,
  type DashboardFilters,
  type PeriodSelection,
} from '@/lib/dashboard/filters'

export interface FilterOption {
  readonly value: string
  readonly label: string
}

export interface FilterBarProps {
  /** The route the form posts to. `/dashboard` today. */
  readonly action: string
  readonly filters: DashboardFilters
  /**
   * The period presets, already labelled.
   *
   * Built on the server rather than here, so this island imports no formatter and
   * no calendar: the labels are six strings, and shipping the date-formatting
   * module to a browser to produce them would be paying for a library to render
   * text that was already known at build time.
   */
  readonly periodOptions: readonly FilterOption[]
  readonly stores: readonly FilterOption[]
  readonly conditions: readonly FilterOption[]
  readonly leadSources: readonly FilterOption[]
  /**
   * The campaigns, or omitted on a route where campaign means nothing.
   *
   * OPTIONAL, unlike the four above, and that asymmetry is the point. Only
   * `/dashboard/leads-marketing` carries datasets grained on campaign; every other console
   * route declares `campaign` as `not-applicable`, and rendering a control that cannot
   * change a figure is how a filter bar starts lying about what it reaches. A route that
   * passes nothing gets no control rather than an inert one.
   */
  readonly campaigns?: readonly FilterOption[]
  /**
   * What the condition and lead-source parameters do ON THIS ROUTE.
   *
   * Supplied by the page rather than fixed here, because the honest answer differs:
   * the Executive Overview can only apply condition to its inventory measures, and
   * the Sales and Gross page applies it to units and gross because its dataset
   * publishes the split. A single hard-coded sentence would have been wrong on one
   * of the two, and a hint that misdescribes a control is worse than none.
   */
  readonly conditionHint?: string
  readonly leadSourceHint?: string
  readonly campaignHint?: string
}

const COMPARE_OPTIONS: readonly FilterOption[] = [
  { value: 'prior-period', label: 'Prior period' },
  { value: 'prior-year', label: 'Prior year' },
  { value: 'none', label: 'No comparison' },
]

/** Turn the `period` control's string back into the typed selection. */
function readPeriod(value: string): PeriodSelection {
  if (value === '') return { kind: 'default' }
  if (value === 'mtd') return { kind: 'mtd' }
  if (value === 'last-30d') return { kind: 'last-30d' }
  return { kind: 'month', month: value }
}

/** The `period` control's current string. A custom range keeps its own value. */
function writePeriod(period: PeriodSelection): string {
  switch (period.kind) {
    case 'default':
      return ''
    case 'month':
      return period.month
    case 'mtd':
      return 'mtd'
    case 'last-30d':
      return 'last-30d'
    case 'range':
      return 'range'
  }
}

export function FilterBar({
  action,
  filters,
  periodOptions,
  stores,
  conditions,
  leadSources,
  campaigns,
  conditionHint = 'Inventory measures only.',
  leadSourceHint = 'Funnel measures only.',
  campaignHint = 'Selects funnel and marketing measures.',
}: FilterBarProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<DashboardFilters>(filters)

  const apply = useCallback(
    (next: DashboardFilters) => {
      setDraft(next)
      router.push(filtersHref(action, next), { scroll: false })
    },
    [action, router]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      // Scripting is available, so the canonical URL is built here rather than
      // letting the browser serialize five controls including the empty ones.
      event.preventDefault()
      router.push(filtersHref(action, draft), { scroll: false })
    },
    [action, draft, router]
  )

  return (
    <form
      method="get"
      action={action}
      onSubmit={onSubmit}
      aria-label="Dashboard filters"
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-6">
        <Field id="filter-period" label="Period" active={draft.period.kind !== 'default'}>
          <SelectControl
            id="filter-period"
            name="period"
            value={writePeriod(draft.period)}
            active={draft.period.kind !== 'default'}
            onChange={(event) => {
              const value = event.target.value
              // Selecting the deep-linked range option is a no-op: it is already
              // the current period and there is nothing to change it to.
              if (value === 'range') return
              apply({ ...draft, period: readPeriod(value) })
            }}
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        </Field>

        <Field
          id="filter-compare"
          label="Comparison"
          active={draft.compare !== DEFAULT_FILTERS.compare}
        >
          <SelectControl
            id="filter-compare"
            name="compare"
            value={draft.compare}
            active={draft.compare !== DEFAULT_FILTERS.compare}
            onChange={(event) =>
              apply({ ...draft, compare: event.target.value as CompareMode })
            }
          >
            {COMPARE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        </Field>

        <Field id="filter-store" label="Store" active={draft.store.length > 0}>
          <SelectControl
            id="filter-store"
            name="store"
            value={draft.store[0] ?? ''}
            active={draft.store.length > 0}
            onChange={(event) =>
              apply({
                ...draft,
                store: event.target.value === '' ? [] : [event.target.value],
              })
            }
          >
            <option value="">All three stores</option>
            {stores.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        </Field>

        <Field
          id="filter-condition"
          label="Condition"
          active={draft.condition !== null}
          hint={conditionHint}
        >
          <SelectControl
            id="filter-condition"
            name="condition"
            value={draft.condition ?? ''}
            active={draft.condition !== null}
            onChange={(event) =>
              apply({
                ...draft,
                condition:
                  event.target.value === ''
                    ? null
                    : (event.target.value as ConditionValue),
              })
            }
          >
            <option value="">All conditions</option>
            {conditions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        </Field>

        <Field
          id="filter-source"
          label="Lead source"
          active={draft.source !== null}
          hint={leadSourceHint}
        >
          <SelectControl
            id="filter-source"
            name="source"
            value={draft.source ?? ''}
            active={draft.source !== null}
            onChange={(event) =>
              apply({
                ...draft,
                source: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">All lead sources</option>
            {leadSources.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectControl>
        </Field>

        {campaigns === undefined ? null : (
          <Field
            id="filter-campaign"
            label="Campaign"
            active={draft.campaign !== null}
            hint={campaignHint}
          >
            <SelectControl
              id="filter-campaign"
              name="campaign"
              value={draft.campaign ?? ''}
              active={draft.campaign !== null}
              onChange={(event) =>
                apply({
                  ...draft,
                  campaign: event.target.value === '' ? null : event.target.value,
                })
              }
            >
              <option value="">All campaigns</option>
              {campaigns.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectControl>
          </Field>
        )}

        {/*
          The submit control is the no-JavaScript path and stays visible with
          scripting on, where it is simply redundant with the change handlers. A
          control that disappears when a script loads is a control a reader cannot
          rely on, and hiding it would also remove the only way to apply a change
          made with the keyboard on a browser that does not fire `change` until blur.

          IT IS A GRID CELL NOW, not a row of its own. `UX.2A` §4 asks the control band to
          be compact, and a full-width row holding one small button cost 48 vertical pixels
          on every operating route. `self-end` lands it on the baseline of the selects
          beside it rather than under their hints, so the band reads as one row of controls
          with its action at the end.
        */}
        <div className="flex items-end pb-0.5">
          <Button type="submit" variant="secondary" size="sm">
            Apply filters
          </Button>
        </div>
      </div>
    </form>
  )
}
