/**
 * The inventory table.
 *
 * One component, two callers: each store page renders its own listings with it,
 * and the inventory explorer renders the filtered set with it. A second table
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
 * RESPONSIVENESS
 * --------------
 * The table scrolls horizontally inside its own container rather than shrinking
 * its columns, and the container is the only thing on the page that scrolls
 * sideways. `<caption>` carries the row count so a screen-reader user is told the
 * size of the thing they are about to move through.
 */
import { Text } from '@/components/ui/typography'
import { CONDITION_LABEL, formatMiles, formatPrice } from '@/lib/inventory'
import { cx, formatCount } from '@/lib/utils'
import type { InventoryRecord } from '@/types/inventory'

export interface InventoryTableProps {
  readonly records: readonly InventoryRecord[]
  /** Dealership id to display name. Omitted where every row is one store. */
  readonly dealershipNames?: ReadonlyMap<string, string>
  /** Rendered as the table's accessible caption. */
  readonly caption: string
  /** Caps the table's height and scrolls inside it. */
  readonly maxHeightClass?: string
  readonly className?: string
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
        'overflow-auto overscroll-x-contain rounded-xl border border-line bg-canvas',
        maxHeightClass,
        className
      )}
    >
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          {`${caption} ${formatCount(records.length)} listings.`}
        </caption>
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
          {records.map((record) => (
            <tr
              key={record.stockReference}
              className="border-b border-line-subtle last:border-0 even:bg-surface/50"
            >
              {showDealership ? (
                <td className={cx(CELL, 'pl-4 text-ink-secondary')}>
                  {dealershipNames.get(record.dealershipId) ?? record.dealershipId}
                </td>
              ) : null}
              <td className={cx(CELL, showDealership ? '' : 'pl-4')}>
                <span
                  className={cx(
                    'inline-flex items-center rounded-pill border px-2 py-0.5 text-2xs font-medium',
                    record.condition === 'new'
                      ? 'border-accent-muted/40 bg-accent-wash text-accent'
                      : 'border-model/25 bg-model-wash text-model'
                  )}
                >
                  {CONDITION_LABEL[record.condition]}
                </span>
              </td>
              <td className={cx(CELL, 'numeric text-right text-ink-secondary')}>
                {String(record.modelYear)}
              </td>
              <td className={cx(CELL, 'font-medium text-ink')}>{record.make}</td>
              <td className={cx(CELL, 'text-ink-secondary')}>{record.model}</td>
              <td className={cx(CELL, 'text-ink-muted')}>
                {record.trim ?? 'Not stated'}
              </td>
              <td
                className={cx(
                  CELL,
                  'numeric text-right',
                  record.mileage === null ? 'text-ink-faint' : 'text-ink-secondary'
                )}
              >
                {formatMiles(record.mileage)}
              </td>
              <td
                className={cx(
                  CELL,
                  'numeric text-right',
                  record.price === null ? 'text-ink-faint' : 'font-semibold text-ink'
                )}
              >
                {formatPrice(record.price)}
              </td>
              <td className={cx(CELL, 'font-mono text-2xs text-ink-faint')}>
                {record.stockReference}
              </td>
              <td className={cx(CELL, 'pr-4 font-mono text-2xs text-ink-faint')}>
                {record.snapshotDate}
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
