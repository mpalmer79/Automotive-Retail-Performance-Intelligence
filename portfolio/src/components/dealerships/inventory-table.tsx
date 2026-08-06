/**
 * The inventory listings.
 *
 * One component, two callers: each store page renders its own listings with it,
 * and the inventory explorer renders the filtered set with it. A second component
 * built for the explorer would be a second place for a column to be dropped, and
 * the sanitization rule about which columns exist is the whole point.
 *
 * COLUMNS, AND THE ONES THAT ARE NOT HERE
 * ---------------------------------------
 * Dealership, condition, year, make, model, trim, mileage, advertised price,
 * stock reference and snapshot date. There is no VIN column and no source-URL
 * column, and not because they are hidden with CSS: the generated record type has
 * no such field, so there is nothing for this component to render. See
 * `types/inventory.ts`.
 *
 * A MISSING VALUE IS RENDERED AS A MISSING VALUE
 * ----------------------------------------------
 * `formatPrice(null)` and `formatMiles(null)` both produce "Not exposed", which
 * is what the source workbook says. Not a dash, not an em dash, not zero, and not
 * a blank cell. Two hundred and eighty-seven of the independent store's listings
 * have no price, and a blank column there would read as a rendering fault rather
 * than as a property of the data.
 *
 * TWO PRESENTATIONS, ONE SET OF RULES
 * -----------------------------------
 * Below 1280px the listings are stacked result cards. At and above it they are
 * the semantic table.
 *
 * The table alone used to be the whole answer, and the measurement is why it is
 * not any more. The table's natural width is about 1,030px, it carried
 * `min-w-[52rem]` and scrolled sideways inside its own container, and at 320px
 * the container was 254px wide - so eight of the ten columns, INCLUDING THE
 * ADVERTISED PRICE, were outside it. Nothing told a reader those columns existed.
 * A horizontal scroll region is a reasonable answer when a reader can see that
 * there is more to the right; it is not one when the single most important column
 * on a vehicle listing is 500px past the edge of a viewport with no visible
 * affordance. At 768px three columns were still outside, price among them, and at
 * 1024px two were.
 *
 * So the narrow presentation is cards, and the cards carry EVERY field the table
 * carries - nothing is dropped to make them shorter. What changes is hierarchy:
 * year/make/model and the advertised price lead, because that is the pair a
 * reader is scanning for; condition, trim and mileage follow; store, stock
 * reference and snapshot date close as provenance.
 *
 * Both presentations format through {@link presentRecord}, so there is exactly
 * one place that decides what a null price says or how a mileage reads. The two
 * are `hidden` at each other's widths, which is `display: none` and therefore
 * removes the inactive one from the accessibility tree - assistive technology is
 * never offered both readings of the same row.
 */
import type { ReactNode } from 'react'

import { Text } from '@/components/ui/typography'
import { CONDITION_LABEL, formatMiles, formatPrice } from '@/lib/inventory'
import { cx, formatCount } from '@/lib/utils'
import type { InventoryRecord } from '@/types/inventory'

export interface InventoryTableProps {
  readonly records: readonly InventoryRecord[]
  /** Dealership id to display name. Omitted where every row is one store. */
  readonly dealershipNames?: ReadonlyMap<string, string>
  /** Rendered as the table's accessible caption, and as the card list's name. */
  readonly caption: string
  /** Caps the table's height and scrolls inside it. */
  readonly maxHeightClass?: string
  readonly className?: string
}

/**
 * One listing, formatted once for both presentations.
 *
 * Every string a reader sees is produced here. The card view and the table view
 * differ in layout and in emphasis; they may not differ in what a value SAYS,
 * and the only way to guarantee that is for neither of them to format anything.
 */
interface PresentedRecord {
  readonly key: string
  /** Year, make and model as one line. The card's title and scan target. */
  readonly vehicle: string
  readonly modelYear: string
  readonly make: string
  readonly model: string
  readonly price: string
  /** True where the source exposed no price, so both views recede identically. */
  readonly priceMissing: boolean
  readonly condition: string
  readonly isNew: boolean
  readonly trim: string
  readonly mileage: string
  readonly mileageMissing: boolean
  /** The store's display name, or null where every row is one store. */
  readonly store: string | null
  readonly stockReference: string
  readonly snapshotDate: string
}

function presentRecord(
  record: InventoryRecord,
  dealershipNames: ReadonlyMap<string, string> | undefined
): PresentedRecord {
  const year = String(record.modelYear)
  return {
    key: record.stockReference,
    vehicle: `${year} ${record.make} ${record.model}`,
    modelYear: year,
    make: record.make,
    model: record.model,
    price: formatPrice(record.price),
    priceMissing: record.price === null,
    condition: CONDITION_LABEL[record.condition],
    isNew: record.condition === 'new',
    trim: record.trim ?? 'Not stated',
    mileage: formatMiles(record.mileage),
    mileageMissing: record.mileage === null,
    store: dealershipNames
      ? (dealershipNames.get(record.dealershipId) ?? record.dealershipId)
      : null,
    stockReference: record.stockReference,
    snapshotDate: record.snapshotDate,
  }
}

/** The condition pill, identical in both presentations. */
function ConditionPill({ label, isNew }: { label: string; isNew: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-pill border px-2 py-0.5 text-2xs font-medium',
        isNew
          ? 'border-accent-muted/40 bg-accent-wash text-accent'
          : 'border-model/25 bg-model-wash text-model'
      )}
    >
      {label}
    </span>
  )
}

export function InventoryTable({
  records,
  dealershipNames,
  caption,
  maxHeightClass = 'max-h-[40rem]',
  className,
}: InventoryTableProps) {
  if (records.length === 0) {
    return (
      <div
        className={cx(
          'rounded-xl border border-dashed border-line-strong bg-surface-sunken/40 p-8 text-center',
          className
        )}
      >
        <Text size="sm" tone="muted">
          No listing in this snapshot matches the current selection.
        </Text>
      </div>
    )
  }

  const showDealership = dealershipNames !== undefined
  const presented = records.map((record) => presentRecord(record, dealershipNames))
  const countSentence = `${caption} ${formatCount(records.length)} listings.`

  return (
    <div className={className}>
      <InventoryCards
        presented={presented}
        caption={caption}
        countSentence={countSentence}
      />
      <InventoryDataTable
        presented={presented}
        showDealership={showDealership}
        caption={caption}
        countSentence={countSentence}
        maxHeightClass={maxHeightClass}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Narrow: stacked result cards                                                */
/* -------------------------------------------------------------------------- */

/**
 * The narrow presentation. Below 1280px.
 *
 * SEMANTICS
 * ---------
 * A list of `<article>` elements, each named by its own vehicle line through
 * `aria-labelledby`, each carrying a `<dl>` of the remaining fields. Not a grid
 * of `<div>`s: every value here is a labelled property of one listing, which is
 * a description list, and a screen-reader user moving through them is told the
 * term before the value rather than hearing nine unlabelled strings.
 *
 * The name comes from an `aria-labelledby` reference to the vehicle line rather
 * than from a heading element, because this component is rendered at three
 * different depths - inside the explorer, inside a store page's section, and
 * inside a filtered panel - and a fixed heading level would skip a level on at
 * least one of them. `<article>` with an accessible name is a landmark a reader
 * can navigate by without asserting a rank the surrounding document does not
 * have.
 *
 * The count is stated in a `<p>` above the list rather than only in the table's
 * `<caption>`, because the caption belongs to the element that is `display: none`
 * at these widths.
 */
function InventoryCards({
  presented,
  caption,
  countSentence,
}: {
  presented: readonly PresentedRecord[]
  caption: string
  countSentence: string
}) {
  return (
    <section aria-label={caption} className="xl:hidden">
      <p className="sr-only">{countSentence}</p>
      <ul className="flex flex-col gap-3">
        {presented.map((row) => (
          <li key={row.key}>
            <article aria-labelledby={`listing-${row.key}`} className="listing-card">
              {/* 1 and 2: the vehicle, then the price. The two things a reader
                  is looking for, on the first line they read. The price is the
                  largest thing in the card at every width. */}
              <div className="listing-head">
                <p id={`listing-${row.key}`} className="listing-title">
                  {row.vehicle}
                </p>
                <p
                  className={cx(
                    'listing-price',
                    row.priceMissing && 'listing-price-missing'
                  )}
                >
                  {/* The term, for a reader who cannot see that the largest
                      number in the card is the price. The table says it in a
                      column header; here it has to be said per card. */}
                  <span className="sr-only">Advertised price </span>
                  {row.price}
                </p>
              </div>

              {/* 3 to 7: condition, trim, mileage, store, then the provenance
                  pair. Nothing is dropped to shorten the card - the order is
                  the hierarchy, and the last two are quieter rather than
                  absent. */}
              <dl className="listing-fields">
                <Field term="Condition">
                  <ConditionPill label={row.condition} isNew={row.isNew} />
                </Field>
                <Field term="Trim">{row.trim}</Field>
                <Field term="Mileage">
                  <span className={cx('numeric', row.mileageMissing && 'text-ink-faint')}>
                    {row.mileage}
                  </span>
                </Field>
                {row.store === null ? null : <Field term="Dealership">{row.store}</Field>}
                <Field term="Stock reference">
                  <span className="listing-value-mono">{row.stockReference}</span>
                </Field>
                <Field term="Snapshot">
                  <span className="listing-value-mono">{row.snapshotDate}</span>
                </Field>
              </dl>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One labelled property inside a listing card. */
function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="listing-field">
      <dt className="listing-term">{term}</dt>
      <dd className="listing-value">{children}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Wide: the semantic table                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The wide presentation. 1280px and above, which is where the table's natural
 * ~1,030px fits inside the page container without a column falling off the edge.
 *
 * The scroll container is kept even though the table now fits at every width it
 * renders at: the content width is data-dependent - a longer trim or a longer
 * store name widens a column - and a container that cannot scroll clips instead.
 * It stays focusable and named for the same reason it always was.
 */
function InventoryDataTable({
  presented,
  showDealership,
  caption,
  countSentence,
  maxHeightClass,
}: {
  presented: readonly PresentedRecord[]
  showDealership: boolean
  caption: string
  countSentence: string
  maxHeightClass: string
}) {
  return (
    /*
     * A SCROLLABLE REGION HAS TO BE REACHABLE FROM A KEYBOARD.
     *
     * `tabIndex={0}` plus `role="region"` and a name is not decoration: a
     * container that scrolls but cannot receive focus is unreachable to anyone
     * navigating by keyboard, because there is nothing inside it to tab to - the
     * cells are text, not controls. axe-core reports it as a serious violation of
     * WCAG 2.1.1, and it did, on all three store pages.
     *
     * The name comes from the caption rather than from a generic "table", so a
     * screen-reader user landing on it is told which store's inventory they are
     * about to move through.
     */
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cx(
        'hidden overflow-auto overscroll-x-contain rounded-xl border border-line bg-canvas xl:block',
        maxHeightClass
      )}
    >
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <caption className="sr-only">{countSentence}</caption>
        <thead>
          {/* Sticky, so the column names stay visible while a 300-row table
              scrolls inside its container. */}
          <tr className="sticky top-0 z-10 bg-surface-sunken shadow-[0_1px_0_0_var(--color-line)]">
            {showDealership ? (
              <th scope="col" className={cx(HEAD, 'pl-4')}>
                Dealership
              </th>
            ) : null}
            <th scope="col" className={cx(HEAD, showDealership ? '' : 'pl-4')}>
              Condition
            </th>
            <th scope="col" className={cx(HEAD, 'text-right')}>
              Year
            </th>
            <th scope="col" className={HEAD}>
              Make
            </th>
            <th scope="col" className={HEAD}>
              Model
            </th>
            <th scope="col" className={HEAD}>
              Trim
            </th>
            <th scope="col" className={cx(HEAD, 'text-right')}>
              Mileage
            </th>
            <th scope="col" className={cx(HEAD, 'text-right')}>
              Advertised price
            </th>
            <th scope="col" className={HEAD}>
              Stock reference
            </th>
            <th scope="col" className={cx(HEAD, 'pr-4')}>
              Snapshot
            </th>
          </tr>
        </thead>
        <tbody>
          {presented.map((row) => (
            <tr
              key={row.key}
              className="border-b border-line-subtle last:border-0 even:bg-surface/50"
            >
              {showDealership ? (
                <td className={cx(CELL, 'pl-4 text-ink-secondary')}>{row.store}</td>
              ) : null}
              <td className={cx(CELL, showDealership ? '' : 'pl-4')}>
                <ConditionPill label={row.condition} isNew={row.isNew} />
              </td>
              <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                {row.modelYear}
              </td>
              <td className={cx(CELL, 'font-medium text-ink')}>{row.make}</td>
              <td className={cx(CELL, 'text-ink-secondary')}>{row.model}</td>
              <td className={cx(CELL, 'text-ink-muted')}>{row.trim}</td>
              <td
                className={cx(
                  CELL,
                  'numeric text-right',
                  row.mileageMissing ? 'text-ink-faint' : 'text-ink-secondary'
                )}
              >
                {row.mileage}
              </td>
              <td
                className={cx(
                  CELL,
                  'numeric text-right',
                  row.priceMissing ? 'text-ink-faint' : 'font-semibold text-ink'
                )}
              >
                {row.price}
              </td>
              <td className={cx(CELL, 'font-mono text-2xs text-ink-faint')}>
                {row.stockReference}
              </td>
              <td className={cx(CELL, 'pr-4 font-mono text-2xs text-ink-faint')}>
                {row.snapshotDate}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const HEAD = 'px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-ink-muted'
const CELL = 'px-3 py-2 whitespace-nowrap'
