/**
 * The visual sections of `/dashboard/employees`.
 *
 * SERVER COMPONENTS. Every mark here is HTML and CSS in the server response — no chart
 * library, no client island, no canvas. The route adds no route-owned JavaScript, so the
 * no-JavaScript reading of this page is identical to the scripted one rather than a degraded
 * fallback: the role navigation is links, the filters are a GET form, and every figure and
 * every sample state is already in the markup.
 *
 * THE EXACT/GEOMETRY BOUNDARY, HELD IN ONE DIRECTION
 * --------------------------------------------------
 * Displayed numbers are formatted from `Exact`. `exactToApproxNumber` appears only inside
 * `widthOf`, which returns a CSS percentage — a pixel cannot carry twenty significant digits
 * and does not need to. No displayed figure passes through `Number()` or `parseFloat()`.
 *
 * GEOMETRY IS DATA. Every bar width is a governed count over a governed total or over the
 * widest value on the page. Nothing is scaled to fill its track and no bar exists that does
 * not move when the data moves.
 *
 * COLOUR NEVER JUDGES A PERSON
 * ----------------------------
 * The role families carry stable categorical colours so a reader can tell which surface they
 * are on. That is identity, not evaluation. Nothing on this page is green because it is high
 * or red because it is low: ARPI has no employee benchmark, so there is no threshold for a
 * colour to encode. The one non-neutral state is `insufficient sample`, which uses the
 * attention treatment because it is a PUBLICATION STATE — the project declining to print a
 * ratio — and it is spelled out in words on the same line, so the colour is never the only
 * carrier of the meaning.
 *
 * NO TROPHY, MEDAL, CROWN, STAR, PODIUM, BADGE, STREAK OR FLAME APPEARS ANYWHERE. This is an
 * operating console, not a sales contest board.
 */
import type { ReactNode } from 'react'

import { exactToApproxNumber, type Exact } from '@/lib/dashboard/decimal'
import {
  type EmployeeRow,
  type Measured,
  type MixSlice,
  type RoleFamily,
  type RoleSummary,
  type StoreInventoryContext,
  type UnassignedSummary,
} from '@/lib/dashboard/employees'
import { isFigure, type Figure } from '@/lib/dashboard/figures'
import { formatCurrencyExact, formatRatioAsPercent } from '@/lib/dashboard/format'

/* -------------------------------------------------------------------------- */
/* Shared rendering                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A figure as the reader sees it: the number, or the words for why there is none.
 *
 * FOUR ABSENCES, FOUR DIFFERENT STRINGS, and never one dash for all of them.
 *
 *   Not applicable       the measure does not belong to this role at all.
 *   Insufficient sample  it does, and its own governed denominator is below the floor. The
 *                        denominator and the floor are printed beside it, because the count
 *                        is what explains the suppression.
 *   No data              it does, and nothing was observed. There is no sample, which is not
 *                        the same as a sample that is too small.
 *   0                    a real observed zero, which is a VALUE and is never routed here.
 */
export function figureText(value: Figure, format: (exact: Exact) => string): string {
  if (isFigure(value)) return format(value.value)
  switch (value.kind) {
    case 'not-applicable':
      return 'Not applicable'
    case 'insufficient-sample':
      return 'Insufficient sample'
    case 'not-at-this-grain':
      return 'Not published at this grain'
    default:
      return 'No data'
  }
}

/** A bar width as a CSS percentage. The one place approximate numbers are permitted. */
function widthOf(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  const clamped = Math.max(0, Math.min(1, part / whole))
  return `${(clamped * 100).toFixed(4)}%`
}

function shareWidth(value: Figure): string {
  if (!isFigure(value)) return '0%'
  const ratio = exactToApproxNumber(value.value)
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(4)}%`
}

/**
 * The categorical colour of a role family. IDENTITY, NOT EVALUATION.
 *
 * Four stable hues from the design system's data-visualisation palette so a reader can tell
 * at a glance which surface they are on. None of them means good or bad, none is ordered
 * against another, and every figure they sit beside is also present as text.
 */
export function roleMarkClass(family: RoleFamily): string {
  // Written out in full so Tailwind's source scan can see every class.
  switch (family) {
    case 'Salesperson':
      return 'bg-data-primary'
    case 'Desk Management':
      return 'bg-data-secondary'
    case 'Finance':
      return 'bg-data-tertiary'
    default:
      return 'bg-data-neutral'
  }
}

/**
 * One comparative figure with the sample that governs it.
 *
 * THE SAMPLE IS ALWAYS VISIBLE, above and below the floor alike. Above it, it says what the
 * figure was computed over; below it, it is the explanation for the suppression. Hiding the
 * denominator that caused a suppression would leave the reader with a bare refusal.
 */
function MeasureCell({ measure }: { readonly measure: Measured }) {
  const value = measure.figure
  const suppressed = !isFigure(value) && value.kind === 'insufficient-sample'
  const formatter =
    measure.label.toLowerCase().includes('rate') ||
    measure.label.toLowerCase().includes('show-to-sale')
      ? (exact: Exact) => formatRatioAsPercent(exact)
      : (exact: Exact) => formatCurrencyExact(exact)

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-ink-muted">
        {measure.label}
      </span>
      <span
        className={
          suppressed
            ? 'text-sm font-medium text-data-warning'
            : 'text-sm font-medium tabular-nums text-ink'
        }
      >
        {figureText(value, formatter)}
      </span>
      {measure.sample === null ? null : (
        <span className="text-xs text-ink-muted">
          {suppressed
            ? `${String(measure.sample.denominator)} ${measure.sampleLabel ?? 'observations'}, minimum ${String(measure.sample.floor)}`
            : `n = ${String(measure.sample.denominator)} ${measure.sampleLabel ?? ''}`.trim()}
        </span>
      )}
    </div>
  )
}

/** A mix as adjacent shares of one whole. Ordered by name, never by size. */
function MixBar({
  slices,
  label,
}: {
  readonly slices: readonly MixSlice[]
  readonly label: string
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
        aria-hidden="true"
        data-testid="mix-bar"
      >
        {slices.map((slice, index) => (
          <div
            key={slice.label}
            className={index % 2 === 0 ? 'h-full bg-accent/70' : 'h-full bg-accent/35'}
            style={{ width: shareWidth(slice.share) }}
            data-slice={slice.label}
            data-width={shareWidth(slice.share)}
          />
        ))}
      </div>
      <span className="text-xs text-ink-muted">
        {total === 0
          ? 'No qualifying units in this period'
          : slices
              .map(
                (slice) =>
                  `${slice.label} ${String(slice.count)} (${figureText(slice.share, (exact) => formatRatioAsPercent(exact))})`
              )
              .join(' · ')}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Role summary                                                                */
/* -------------------------------------------------------------------------- */

export function RoleSummarySection({
  summary,
  family,
  description,
}: {
  readonly summary: RoleSummary
  readonly family: RoleFamily
  readonly description: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-ink-muted">{description}</p>
      <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            People credited
          </dt>
          <dd className="text-sm tabular-nums text-ink">
            {String(summary.people)}
            <span
              className={`ml-2 inline-block h-2 w-2 rounded-pill align-middle ${roleMarkClass(family)}`}
              aria-hidden="true"
            />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            {summary.volumeLabel}
          </dt>
          <dd className="text-sm tabular-nums text-ink">{String(summary.volume)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Comparison-eligible
          </dt>
          <dd className="text-sm tabular-nums text-ink">
            {String(summary.eligible)} of {String(summary.people)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Minimum sample
          </dt>
          <dd className="text-sm tabular-nums text-ink">
            {String(summary.floor)}
            {summary.belowFloor > 0 ? (
              <span className="ml-2 text-xs text-ink-muted">
                {String(summary.belowFloor)} below it
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="max-w-prose text-xs text-ink-muted">
        The floor is a publication discipline, not a performance threshold: below it this
        page declines to print a comparative ratio, and says nothing whatever about the
        person. It is read from the governed export and applies to each measure&rsquo;s
        own denominator, so someone can be eligible on one figure and not on another in
        the same period.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The comparison matrix                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The employee comparison list, in stable business-key order.
 *
 * STORE, THEN ROLE, THEN CODE — never by units, gross, conversion or any other measure, and
 * there is no control anywhere on this page to change that. A list sorted descending by a
 * performance figure is a leaderboard whether or not the word "rank" appears near it.
 *
 * The volume bar is scaled to the widest volume on the page so the marks are comparable
 * within one view. It carries no colour meaning and every value beside it is text.
 */
export function EmployeeMatrix({
  rows,
  scale,
  family,
  hrefFor,
  selectedCode,
}: {
  readonly rows: readonly EmployeeRow[]
  readonly scale: number
  readonly family: RoleFamily
  readonly hrefFor: (code: string) => string
  readonly selectedCode: string | null
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No activity was credited to anyone in this role family for the selected period and
        stores. That is an empty selection, not a zero: nothing was observed to measure.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {rows.map((row) => (
        <li
          key={row.code}
          className={
            row.code === selectedCode
              ? 'flex flex-col gap-3 bg-surface-sunken px-3 py-4'
              : 'flex flex-col gap-3 py-4'
          }
          data-employee={row.code}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-pill ${roleMarkClass(family)}`}
                aria-hidden="true"
              />
              <a
                href={hrefFor(row.code)}
                className="font-mono text-sm text-ink underline-offset-4 hover:underline"
              >
                {row.code}
              </a>
              <span className="text-xs text-ink-muted">{row.jobRole}</span>
              <span className="text-xs text-ink-muted">{row.storeId}</span>
              <span className="text-xs text-ink-muted">Tenure {row.tenureBand}</span>
              {row.activeInCurrentRoster ? null : (
                <span className="text-xs text-ink-muted">Inactive in current roster</span>
              )}
            </div>
            <span className="text-sm tabular-nums text-ink">
              {String(row.volume)}{' '}
              <span className="text-xs text-ink-muted">
                {row.volumeLabel.toLowerCase()}
              </span>
            </span>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
            aria-hidden="true"
            data-testid="volume-bar"
            data-width={widthOf(row.volume, scale)}
          >
            <div
              className={`h-full rounded-pill ${roleMarkClass(family)} opacity-70`}
              style={{ width: widthOf(row.volume, scale) }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {row.measures.map((measure) => (
              <MeasureCell key={measure.label} measure={measure} />
            ))}
          </div>

          {row.mixLabel === null || row.mix.length === 0 ? null : (
            <MixBar slices={row.mix} label={row.mixLabel} />
          )}

          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {row.context.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  {item.label}
                </dt>
                <dd className="text-xs tabular-nums text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Store context                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Store inventory availability, beside the selling comparison and never on an employee row.
 *
 * A PROPERTY OF THE STORE. Nobody can sell inventory the store does not have, so it belongs
 * here — but it is not an employee measure, it is not summed across people, and it cannot be:
 * no employee row carries it. It is labelled availability and never difficulty; there is no
 * good, bad, easy or hard inventory in this project.
 */
export function StoreContextSection({
  inventory,
}: {
  readonly inventory: readonly StoreInventoryContext[]
}) {
  if (inventory.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No inventory snapshot falls inside the selected period, so no store availability
        context is published for it.
      </p>
    )
  }
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {inventory.map((store) => (
          <div
            key={store.storeId}
            className="flex flex-col gap-0.5 border-t border-line pt-3"
          >
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              {store.storeId} average active units
            </dt>
            <dd className="text-sm tabular-nums text-ink">
              {figureText(store.averageActiveUnits, (exact) =>
                (Number(exact.units) / 10 ** exact.scale).toFixed(1)
              )}
              <span className="ml-2 text-xs text-ink-muted">
                over {String(store.observedDays)} observed snapshot day
                {store.observedDays === 1 ? '' : 's'}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-prose text-xs text-ink-muted">
        Store inventory context, not an employee measure. It is an average over the
        snapshot days observed in the period, because a stock count summed across days
        overstates by roughly the number of days. It is availability and not difficulty:
        this project publishes no judgement about which inventory is easy to sell.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Unassigned activity                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Activity credited to nobody, shown rather than dropped.
 *
 * Three role keys are nullable, and the tempting defect is an inner join that makes the
 * employee totals look clean by losing these rows. They are real transactions and real
 * opportunity: inside the store total, outside the comparison, and never given an invented
 * employee code.
 */
export function UnassignedSection({
  entries,
}: {
  readonly entries: readonly UnassignedSummary[]
}) {
  if (entries.length === 0) return null
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <div key={entry.label} className="flex flex-col gap-1 border-t border-line pt-3">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            {entry.label}
          </dt>
          <dd className="flex flex-col gap-1">
            <span className="text-sm tabular-nums text-ink">{String(entry.count)}</span>
            <span className="text-xs text-ink-muted">{entry.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------------------- */
/* Selected employee                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The selected employee's investigation view.
 *
 * AN INVESTIGATION SURFACE, NOT A PERSONNEL PROFILE. It shows what was credited, the sample
 * behind each figure, the mix and opportunity that surrounded it, and where to look next. It
 * shows no name, no photo, no contact detail, no hire date, no pay and no assessment, because
 * none of those exists in the export it reads.
 */
export function SelectedEmployeeSection({
  row,
  links,
}: {
  readonly row: EmployeeRow
  readonly links: readonly {
    readonly label: string
    readonly href: string
    readonly note: string
  }[]
}) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Employee</dt>
          <dd className="font-mono text-sm text-ink">{row.code}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Credited role
          </dt>
          <dd className="text-sm text-ink">
            {row.jobRole}
            <span className="ml-2 text-xs text-ink-muted">{row.family}</span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Store</dt>
          <dd className="text-sm text-ink">{row.storeId}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Tenure band</dt>
          <dd className="text-sm text-ink">
            {row.tenureBand}
            {row.activeInCurrentRoster ? null : (
              <span className="ml-2 text-xs text-ink-muted">
                Inactive in current roster
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {row.measures.map((measure) => (
          <MeasureCell key={measure.label} measure={measure} />
        ))}
      </div>

      {row.mixLabel === null || row.mix.length === 0 ? null : (
        <MixBar slices={row.mix} label={row.mixLabel} />
      )}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {row.context.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
              {item.label}
            </dt>
            <dd className="text-xs tabular-nums text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>

      {links.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="text-xs uppercase tracking-wide text-ink-muted">
            Investigate next
          </span>
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href} className="text-sm">
                <a href={link.href} className="text-ink underline underline-offset-4">
                  {link.label}
                </a>
                <span className="ml-2 text-xs text-ink-muted">{link.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Role navigation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The role switch, as links.
 *
 * PLAIN LINKS AND A REAL `nav`, not an ARIA tab set. This is navigation between four server-
 * rendered documents, not a scripted tab interface, and claiming `role="tablist"` would
 * promise keyboard behaviour — arrow-key roving focus, `aria-selected` following focus — that
 * nothing here implements. Links already survive reload, copy-paste, Back, Forward and
 * JavaScript being off, which is the whole requirement.
 */
export function RoleNav({
  items,
  current,
}: {
  readonly items: readonly {
    readonly slug: string
    readonly label: string
    readonly href: string
  }[]
  readonly current: string
}) {
  return (
    <nav aria-label="Employee role family" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a
          key={item.slug}
          href={item.href}
          aria-current={item.slug === current ? 'page' : undefined}
          className={
            item.slug === current
              ? 'inline-flex min-h-9 items-center rounded-pill border border-accent bg-accent/10 px-3 py-1.5 text-sm text-ink'
              : 'inline-flex min-h-9 items-center rounded-pill border border-line-subtle px-3 py-1.5 text-sm text-ink-muted hover:text-ink'
          }
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                     */
/* -------------------------------------------------------------------------- */

/** Says so when `employee=` named a code the export does not contain. */
export function UnknownEmployeeNotice({
  code,
}: {
  readonly code: string | null
}): ReactNode {
  if (code === null) return null
  return (
    <p
      role="status"
      className="rounded-lg border border-data-warning/40 bg-data-warning-wash px-4 py-3 text-sm text-ink"
    >
      No employee <span className="font-mono">{code}</span> exists in the exported roster.
      The comparison below is unfiltered rather than empty — an empty page would have
      implied a person with no activity, which is a different statement.
    </p>
  )
}
