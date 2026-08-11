/**
 * The Employees workspace: the family rail, the four role presentations, and the context.
 *
 * WHAT THIS REPLACED, MEASURED
 * ----------------------------
 * `docs/reviews/UX-2C-BASELINE.md` §1–§3: `/dashboard/employees` carried **zero framed figures
 * at any viewport** — no chart, no comparison, no shape — down a 5,386 px document of five
 * regions, each opening with an eyebrow, an `h2` and a lede. The role switch changed which
 * people were listed and nothing about how the page looked: `?role=finance` measured 3,255 px
 * against the salesperson view's 5,386, and the whole of that difference was the number of
 * rows.
 *
 * At 303 `proseRepo` words this route was not verbose, and `UX.2C` §26 and §53 are explicit
 * that the answer here is not to shorten it. `DASH.11`'s fairness context is load-bearing and
 * stays. What changes is its FORM: tenure, store, mix, opportunity and the sample were
 * sentences and a twelve-paragraph drawer, and they are now chips and bars on the row they
 * qualify. The reader SEES the context instead of reading a fairness essay — which is what
 * §26 asks for in as many words.
 *
 * THE ROLE MATERIALLY CHANGES THE DASHBOARD (`UX.2C` §19)
 * -------------------------------------------------------
 * Not the labels on the same four cards. `FAMILY_PRESENTATION` below gives each family its own
 * arrangement, because the four answer different questions from different denominators:
 *
 *   Salesperson  volume leads, two gross rates beside it, condition mix, and the opportunity
 *                context — assigned leads, commonest source, desk involvement — that decides
 *                whether two people were doing the same job.
 *   Desk         the same two rates on DESKED units, with the non-retail units that are
 *                excluded from the denominator stated on the row rather than in a drawer.
 *   Finance      the structure mix is promoted to sit BESIDE the two rates rather than under
 *                them, because back and reserve per retail unit divide by every delivery
 *                including cash deals, which cannot generate reserve. A finance figure read
 *                without its cash share is a figure read wrong.
 *   BDC          the four measures are split into two visually separate grain bands — lead
 *                grain and appointment grain — because contact and appointment-set count
 *                LEADS while show and show-to-sale count APPOINTMENTS, and one lead can
 *                produce several.
 *
 * WHAT IS STRUCTURALLY ABSENT, AND STAYS ABSENT (`UX.2C` §18 and §25)
 * -------------------------------------------------------------------
 * No rank. No score. No percentile. No tier. No composite. No sorted-descending bar. No podium,
 * medal, trophy, crown, star, badge, streak or flame. No red/green heat map. Rows arrive in the
 * order `orderEmployees` produced — store, then role, then employee code — and NOTHING in this
 * file reorders them: there is no comparator, no `sort` call and no control that could add one.
 * `tests/unit/ux2c-workspaces.test.tsx` asserts the rendered order against that key on real
 * data, so a later refactor that reached for `.sort((a, b) => b.volume - a.volume)` because it
 * "reads better" fails rather than merges.
 *
 * A prettier leaderboard is still a leaderboard. This is not one.
 *
 * COLOUR NEVER JUDGES A PERSON. The four family hues are IDENTITY — which surface you are on —
 * and are not ordered against each other. Nothing is green because it is high or red because it
 * is low; ARPI holds no employee benchmark, so there is no threshold for a colour to encode.
 * The one non-neutral state is `Insufficient sample`, which takes the attention treatment
 * because it is a PUBLICATION STATE — the project declining to print a ratio — and it is
 * spelled out in words on the same chip, so colour is never the only carrier.
 *
 * NO CLIENT JAVASCRIPT. Server components throughout. The role switch is links, employee
 * selection is a link, the filters are a GET form, and every figure and every sample verdict is
 * already in the served markup.
 */
import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card-static'
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
import {
  formatCurrencyExact,
  formatRateExact,
  formatRatioAsPercent,
} from '@/lib/dashboard/format'
import { cx } from '@/lib/utils'

import { ChartFrame } from './visuals'

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

/* -------------------------------------------------------------------------- */
/* Per-family presentation                                                     */
/* -------------------------------------------------------------------------- */

/** How one role family's row is arranged. */
interface FamilyPresentation {
  /** The heading over the second measure band, where the family has two. */
  readonly bands: readonly {
    readonly id: string
    readonly label: string
    /** Which of the row's measures belong to this band, by index. */
    readonly measures: readonly number[]
  }[]
  /** `beside` promotes the mix to the measure row; `under` leaves it below. */
  readonly mixPlacement: 'beside' | 'under'
  /** The one sentence the family cannot be read correctly without. */
  readonly caveat: string
}

/**
 * The four arrangements.
 *
 * BDC IS THE ONLY FAMILY WITH TWO BANDS, and it has them because it is the only family whose
 * measures span two grains. Giving the others a decorative second band would be layout
 * pretending to be a semantic boundary.
 *
 * FINANCE IS THE ONLY FAMILY WITH THE MIX PROMOTED, and it has it because its structure mix is
 * the denominator's composition rather than a description of the work: `UX.2C` §22 requires the
 * cash/finance/lease split to remain adjacent to back and reserve PVR, and "adjacent" below a
 * fold is not adjacent.
 */
const FAMILY_PRESENTATION: Readonly<Record<RoleFamily, FamilyPresentation>> = {
  Salesperson: {
    bands: [{ id: 'gross', label: 'Gross per retail unit', measures: [0, 1] }],
    mixPlacement: 'under',
    caveat:
      'Nobody can sell inventory the store does not have or work a lead they were not assigned, so opportunity is on every row.',
  },
  'Desk Management': {
    bands: [{ id: 'gross', label: 'Gross per retail unit desked', measures: [0, 1] }],
    mixPlacement: 'under',
    caveat:
      'Transactions credited to this desk, not caused by it. Non-retail units are outside the denominator and are stated on the row.',
  },
  Finance: {
    bands: [{ id: 'income', label: 'Income per retail unit', measures: [0, 1] }],
    mixPlacement: 'beside',
    caveat:
      'Both figures divide by every retail delivery, including cash deals, which cannot generate reserve. The structure mix is beside them for that reason.',
  },
  BDC: {
    bands: [
      { id: 'lead', label: 'Lead grain', measures: [0, 1] },
      { id: 'appointment', label: 'Appointment grain', measures: [2, 3] },
    ],
    mixPlacement: 'under',
    caveat:
      'Lead-grain and appointment-grain measures do not share a denominator: one lead can produce several appointments.',
  },
}

/* -------------------------------------------------------------------------- */
/* Shared marks                                                                */
/* -------------------------------------------------------------------------- */

/** A count against the widest count on the page, as a CSS percentage. Layout only. */
function widthOf(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return `${(Math.max(0, Math.min(1, part / whole)) * 100).toFixed(4)}%`
}

/** A governed share as a CSS percentage. A share is already a fraction of one. */
function shareWidth(slice: MixSlice): string {
  if (!isFigure(slice.share)) return '0%'
  const ratio = exactToApproxNumber(slice.share.value)
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(4)}%`
}

/** A small neutral fact, as a chip. Context the eye reads rather than a sentence. */
function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string
  readonly value: string
  readonly tone?: 'neutral' | 'attention'
}) {
  return (
    <span
      className={cx(
        'inline-flex min-w-0 items-baseline gap-1.5 rounded-pill border px-2 py-0.5 text-2xs',
        tone === 'attention'
          ? 'border-data-warning/40 bg-data-warning-wash text-ink'
          : 'border-line-subtle bg-surface text-ink-muted'
      )}
    >
      <span className="shrink-0">{label}</span>
      <span className="numeric min-w-0 truncate font-medium text-ink">{value}</span>
    </span>
  )
}

/**
 * One measure, with its own sample verdict drawn as a chip rather than written as a clause.
 *
 * THE SAMPLE IS VISIBLE ABOVE AND BELOW THE FLOOR ALIKE. Above it, the chip says what the
 * figure was computed over; below it, the chip IS the explanation for the suppression and
 * carries both the denominator and the floor. Hiding the denominator that caused a suppression
 * leaves the reader with a bare refusal.
 *
 * A SUPPRESSED FIGURE NEVER RENDERS AS `0%`, `$0.00` OR A DASH (`UX.2C` §24). It renders as the
 * words `Insufficient sample`, and the chip beside it says `n = 3 of 10`. The attention tone is
 * a publication state, not a verdict on the person, and the words carry it without the colour.
 */
function MeasureFigure({ measure }: { readonly measure: Measured }) {
  const value = measure.figure
  const suppressed = !isFigure(value) && value.kind === 'insufficient-sample'
  const label = measure.label.toLowerCase()
  const format = (exact: Exact) =>
    label.includes('rate') || label.includes('show-to-sale')
      ? formatRatioAsPercent(exact)
      : formatCurrencyExact(exact)

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-2xs text-ink-muted">{measure.label}</span>
      <span
        className={cx(
          'text-sm font-semibold',
          suppressed ? 'text-data-warning' : 'numeric text-ink'
        )}
      >
        {figureText(value, format)}
      </span>
      {measure.sample === null ? null : (
        <Chip
          label={suppressed ? 'Sample' : 'n'}
          value={
            suppressed
              ? `${String(measure.sample.denominator)} of ${String(measure.sample.floor)} ${measure.sampleLabel ?? ''}`.trim()
              : `${String(measure.sample.denominator)} ${measure.sampleLabel ?? ''}`.trim()
          }
          tone={suppressed ? 'attention' : 'neutral'}
        />
      )}
    </div>
  )
}

/**
 * A mix as adjacent shares of one whole, ordered by name and never by size.
 *
 * ORDERED BY NAME because ordering a mix by size makes the biggest slice read as the best one.
 * The slice hues are one categorical family at descending opacity — a composition, not a scale
 * from good to bad — and every share is printed as text beside the bar.
 */
function MixStrip({
  slices,
  label,
  compact = false,
}: {
  readonly slices: readonly MixSlice[]
  readonly label: string
  readonly compact?: boolean
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  const TONES = ['bg-accent/70', 'bg-accent/45', 'bg-accent/25'] as const
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs text-ink-muted">{label}</span>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
        aria-hidden="true"
        data-testid="mix-bar"
      >
        {slices.map((slice, index) => (
          <div
            key={slice.label}
            className={cx('h-full', TONES[index % TONES.length])}
            style={{ width: shareWidth(slice) }}
            data-slice={slice.label}
            data-width={shareWidth(slice)}
          />
        ))}
      </div>
      <span className={cx('text-2xs text-ink-muted', compact ? 'leading-tight' : '')}>
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
/* The family rail                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What this family is, how much of it there is, and how much of it clears the floor.
 *
 * THE FLOOR IS DRAWN. `Comparison-eligible` used to be the string "6 of 9"; it is now that
 * string above a two-part bar whose second segment is the people whose leading ratio is
 * withheld. A manager can see at a glance whether they are reading a family where most figures
 * are publishable or one where most are not, which is the single most important thing to know
 * before reading any of them — and it is a property of the DATA, not of the people.
 */
export function FamilyRail({
  summary,
  family,
  description,
}: {
  readonly summary: RoleSummary
  readonly family: RoleFamily
  readonly description: string
}) {
  const eligibleWidth = widthOf(summary.eligible, summary.people)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Card padding="none" className="flex min-w-0 flex-col gap-1 p-3.5">
          <h3 className="text-xs leading-snug font-semibold text-ink-secondary">
            People credited
          </h3>
          <span className="numeric flex items-baseline gap-2 text-2xl font-semibold text-ink">
            {String(summary.people)}
            <span
              className={cx('inline-block size-2.5 rounded-pill', roleMarkClass(family))}
              aria-hidden="true"
            />
          </span>
          <p className="text-2xs leading-normal text-ink-muted">{family}</p>
        </Card>

        <Card padding="none" className="flex min-w-0 flex-col gap-1 p-3.5">
          <h3 className="text-xs leading-snug font-semibold text-ink-secondary">
            {summary.volumeLabel}
          </h3>
          <span className="numeric text-2xl font-semibold text-ink">
            {String(summary.volume)}
          </span>
          <p className="text-2xs leading-normal text-ink-muted">
            Credited to these people in this period
          </p>
        </Card>

        <Card padding="none" className="flex min-w-0 flex-col gap-1 p-3.5 @lg:col-span-2">
          <h3 className="text-xs leading-snug font-semibold text-ink-secondary">
            Comparison-eligible on the leading figure
          </h3>
          <span className="numeric text-2xl font-semibold text-ink">
            {String(summary.eligible)}{' '}
            <span className="text-base font-normal text-ink-muted">
              of {String(summary.people)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
          >
            <span
              className="block h-full bg-data-primary"
              style={{ width: eligibleWidth }}
            />
            {summary.belowFloor > 0 ? (
              <span
                className="block h-full bg-data-warning/60"
                style={{ width: widthOf(summary.belowFloor, summary.people) }}
              />
            ) : null}
          </span>
          <p className="text-2xs leading-normal text-ink-muted">
            Minimum sample {String(summary.floor)}
            {summary.belowFloor > 0
              ? ` · ${String(summary.belowFloor)} below it, and the ratio is withheld rather than printed`
              : ' · everyone in this family clears it'}
          </p>
        </Card>
      </div>

      <p className="max-w-prose text-xs leading-normal text-ink-muted">
        {description} The floor is a publication discipline, not a performance threshold:
        below it this page declines to print a comparative ratio and says nothing whatever
        about the person. It applies to each measure&rsquo;s own denominator, so someone
        can be eligible on one figure and not on another in the same period.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The people                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The comparison, in stable business-key order, arranged by role family.
 *
 * NOTHING HERE SORTS. `rows` arrives from `orderEmployees`, which takes no comparator by
 * design, and this component maps over it in the order it was given. The volume bar is scaled
 * to the widest volume on the page so the marks are comparable within one view; it is not a
 * ranking, it carries no colour meaning, and the value beside it is text.
 *
 * WHY A LIST AND NOT A TABLE. A row here is not five cells — it is a person's volume, two to
 * four measures each with its own denominator and its own floor verdict, a composition, and
 * four to six context facts. A table of that would need eighteen columns and would still put
 * the sample verdict three columns away from the figure it governs.
 */
export function EmployeeComparison({
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
  const presentation = FAMILY_PRESENTATION[family]

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No activity was credited to anyone in this role family for the selected period and
        stores. That is an empty selection, not a zero: nothing was observed to measure.
      </p>
    )
  }

  return (
    <ChartFrame
      title="Credited activity, by person"
      caption={`Store, then role, then employee code. That order is fixed and there is no control to change it: a list sorted by a measure is a leaderboard whether or not it is labelled one. ${presentation.caveat}`}
      summary={`${String(rows.length)} people in the ${family} family, each with their credited volume, the measures their role is governed by, the sample behind each one, and the mix and opportunity around it.`}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col divide-y divide-line-subtle" data-employee-list>
        {rows.map((row) => (
          <li
            key={row.code}
            data-employee={row.code}
            className={cx(
              'flex flex-col gap-2 py-3 first:pt-0 last:pb-0',
              row.code === selectedCode ? 'bg-surface-sunken/70 px-2' : null
            )}
          >
            {/* Identity, and the context that decides whether two rows are the same job. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cx(
                  'inline-block size-2.5 shrink-0 rounded-pill',
                  roleMarkClass(family)
                )}
                aria-hidden="true"
              />
              <a
                href={hrefFor(row.code)}
                className="font-mono text-sm text-ink underline-offset-4 hover:underline"
              >
                {row.code}
              </a>
              <span className="text-2xs text-ink-muted">{row.jobRole}</span>
              <Chip label="Store" value={row.storeId} />
              <Chip label="Tenure" value={row.tenureBand} />
              {row.activeInCurrentRoster ? null : (
                <Chip label="Roster" value="Inactive" />
              )}
              <span className="numeric ml-auto shrink-0 text-sm font-semibold text-ink">
                {String(row.volume)}{' '}
                <span className="text-2xs font-normal text-ink-muted">
                  {row.volumeLabel.toLowerCase()}
                </span>
              </span>
            </div>

            <span
              aria-hidden="true"
              className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
              data-testid="volume-bar"
              data-width={widthOf(row.volume, scale)}
            >
              <span
                className={cx(
                  'block h-full rounded-pill opacity-70',
                  roleMarkClass(family)
                )}
                style={{ width: widthOf(row.volume, scale) }}
              />
            </span>

            {/*
              THE MEASURE BANDS. One for three of the families and two for BDC, where the
              boundary is a real grain change rather than a visual rhythm.
            */}
            <div
              className={cx(
                'grid gap-3',
                presentation.mixPlacement === 'beside'
                  ? '@md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
                  : null
              )}
            >
              <div className="flex flex-col gap-2">
                {presentation.bands.map((band) => {
                  const measures = band.measures
                    .map((index) => row.measures[index])
                    .filter((measure): measure is Measured => measure !== undefined)
                  if (measures.length === 0) return null
                  return (
                    <div key={band.id} className="flex flex-col gap-1">
                      {presentation.bands.length > 1 ? (
                        <span className="text-2xs font-medium tracking-wide text-ink-faint uppercase">
                          {band.label}
                        </span>
                      ) : null}
                      <div className="grid grid-cols-2 gap-3">
                        {measures.map((measure) => (
                          <MeasureFigure key={measure.label} measure={measure} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {presentation.mixPlacement === 'beside' &&
              row.mixLabel !== null &&
              row.mix.length > 0 ? (
                <MixStrip slices={row.mix} label={row.mixLabel} compact />
              ) : null}
            </div>

            {presentation.mixPlacement === 'under' &&
            row.mixLabel !== null &&
            row.mix.length > 0 ? (
              <MixStrip slices={row.mix} label={row.mixLabel} compact />
            ) : null}

            {/* Opportunity and operating context, as chips rather than a definition list. */}
            {row.context.length === 0 ? null : (
              <div className="flex flex-wrap gap-1.5">
                {row.context.map((item) => (
                  <Chip key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Store opportunity                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Store inventory availability, beside the comparison and never on an employee row.
 *
 * A PROPERTY OF THE STORE. Nobody can sell inventory the store does not have, so it belongs
 * here — but it is not an employee measure and cannot be summed across people, because no
 * employee row carries it. It is labelled availability and never difficulty: this project
 * publishes no judgement about which inventory is easy to sell.
 */
export function StoreOpportunity({
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

  const values = inventory.map((store) =>
    isFigure(store.averageActiveUnits)
      ? exactToApproxNumber(store.averageActiveUnits.value)
      : null
  )
  const largest = values.reduce<number>((max, value) => Math.max(max, value ?? 0), 0)

  return (
    <ChartFrame
      title="Average active units, by store"
      caption="An average over the snapshot days observed in the period: a stock count summed across days overstates by roughly the number of days. Availability, not difficulty."
      summary={inventory
        .map(
          (store) =>
            `${store.storeId} ${figureText(store.averageActiveUnits, (exact) => formatRateExact(exact, 1))} average active units over ${String(store.observedDays)} observed snapshot days`
        )
        .join('. ')}
      summaryMode="sr-only"
      headingLevel={3}
    >
      <ul className="flex flex-col gap-2">
        {inventory.map((store, index) => {
          const value = values[index] ?? null
          return (
            <li key={store.storeId} className="flex flex-col gap-1">
              <p className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-ink-secondary">
                  {store.storeId}
                </span>
                <span className="numeric shrink-0 text-sm font-semibold text-ink">
                  {figureText(store.averageActiveUnits, (exact) =>
                    formatRateExact(exact, 1)
                  )}
                </span>
              </p>
              {value === null ? null : (
                <span
                  aria-hidden="true"
                  className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
                >
                  <span
                    className="block h-full rounded-pill bg-data-neutral"
                    style={{ width: widthOf(value, largest) }}
                  />
                </span>
              )}
              <span className="text-2xs text-ink-muted">
                {String(store.observedDays)} observed snapshot day
                {store.observedDays === 1 ? '' : 's'}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-2xs leading-normal text-ink-muted">
        Store context, not an employee measure. It is not on any employee row and cannot
        be summed across people.
      </p>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Unassigned                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Activity credited to nobody, shown rather than dropped.
 *
 * Three role keys are nullable, and the tempting defect is an inner join that makes the
 * employee totals look clean by losing these rows. They are real transactions and real
 * opportunity: inside the store total, outside the comparison, and never given an invented
 * employee code.
 */
export function UnassignedActivity({
  entries,
}: {
  readonly entries: readonly UnassignedSummary[]
}): ReactNode {
  if (entries.length === 0) return null
  return (
    <dl className="grid gap-3 @md:grid-cols-2">
      {entries.map((entry) => (
        <div key={entry.label} className="flex flex-col gap-1">
          <dt className="text-2xs text-ink-muted">{entry.label}</dt>
          <dd className="flex flex-col gap-0.5">
            <span className="numeric text-lg font-semibold text-ink">
              {String(entry.count)}
            </span>
            <span className="text-2xs leading-normal text-ink-muted">{entry.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------------------- */
/* The selected person                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The selected employee's investigation view.
 *
 * AN INVESTIGATION SURFACE, NOT A PERSONNEL PROFILE. It shows what was credited, the sample
 * behind each figure, the mix and opportunity that surrounded it, and where to look next. It
 * shows no name, no photo, no contact detail, no hire date, no exact tenure, no pay and no
 * assessment, because none of those exists in the export it reads.
 */
export function SelectedEmployee({
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
  const presentation = FAMILY_PRESENTATION[row.family]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cx(
            'inline-block size-2.5 shrink-0 rounded-pill',
            roleMarkClass(row.family)
          )}
          aria-hidden="true"
        />
        <span className="font-mono text-sm text-ink">{row.code}</span>
        <span className="text-2xs text-ink-muted">{row.jobRole}</span>
        <Chip label="Family" value={row.family} />
        <Chip label="Store" value={row.storeId} />
        <Chip label="Tenure" value={row.tenureBand} />
        {row.activeInCurrentRoster ? null : <Chip label="Roster" value="Inactive" />}
        <span className="numeric ml-auto shrink-0 text-sm font-semibold text-ink">
          {String(row.volume)}{' '}
          <span className="text-2xs font-normal text-ink-muted">
            {row.volumeLabel.toLowerCase()}
          </span>
        </span>
      </div>

      <div className="grid gap-3 @lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {presentation.bands.map((band) => {
            const measures = band.measures
              .map((index) => row.measures[index])
              .filter((measure): measure is Measured => measure !== undefined)
            if (measures.length === 0) return null
            return (
              <div key={band.id} className="flex flex-col gap-1">
                <span className="text-2xs font-medium tracking-wide text-ink-faint uppercase">
                  {band.label}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  {measures.map((measure) => (
                    <MeasureFigure key={measure.label} measure={measure} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {row.mixLabel === null || row.mix.length === 0 ? null : (
          <MixStrip slices={row.mix} label={row.mixLabel} />
        )}
      </div>

      {row.context.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {row.context.map((item) => (
            <Chip key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}

      {links.length === 0 ? null : (
        <div className="flex flex-col gap-1.5 border-t border-line-subtle pt-2">
          <span className="text-2xs tracking-wide text-ink-muted uppercase">
            Investigate next
          </span>
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href} className="text-sm">
                <a href={link.href} className="text-ink underline underline-offset-4">
                  {link.label}
                </a>
                <span className="ml-2 text-2xs text-ink-muted">{link.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
