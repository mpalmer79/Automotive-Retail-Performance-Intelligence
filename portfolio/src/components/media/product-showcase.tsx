'use client'

/**
 * The hero's product surface: a working store switcher over real listings.
 *
 * WHAT IT IS, AND WHY IT REPLACED A DIAGRAM
 * -----------------------------------------
 * The hero used to be a headline beside an abstract architecture diagram. The
 * diagram is good and it is still on the page, one chapter down, where it
 * explains the governed stack. What it could not do is answer the first question
 * a recruiter, an engineering leader or a hiring manager has in the first ten
 * seconds: does any of this actually run?
 *
 * This does. Selecting a store filters a real set of sanitized listings and
 * changes five derived figures, four listing rows and the link into the
 * explorer, all of it from data the build produced from the workbooks in this
 * repository. It is not a mockup of a product, it is the smallest honest slice
 * of the product that fits in a hero.
 *
 * WHY IT DOES NOT IMPORT THE RECORD SET
 * -------------------------------------
 * Everything it renders arrives as props from `lib/product-preview`, which runs
 * on the server. Importing `lib/inventory` here would put all 541 records into
 * the home page's JavaScript bundle to display four rows. The payload is instead
 * about two dozen preformatted rows, and the currency and number formatters stay
 * on the server with the data.
 *
 * WHAT IT WILL NEVER SHOW
 * -----------------------
 * A sales figure, a gross figure, a turn rate, a days-supply number or a trend.
 * The inventory lane is a sanitized snapshot of public listings: it describes
 * what was advertised at a capture date and nothing about how any store
 * performs. Every figure here is a count, a range or a median of advertised
 * price, and the observation line under them is a statement about the shape of
 * the snapshot rather than a finding.
 *
 * MOTION
 * ------
 * One thing moves: the panel wakes when the selection changes, using the shared
 * `wake` animation, which runs once and stops. `key` on the panel is what makes
 * it replay per selection, and it is also what makes assistive technology
 * announce the new panel rather than stay silent on a reconciled one. The
 * site-wide reduced-motion rule collapses it to 1ms, so a reader who asked for
 * no animation gets an instant swap with identical content.
 */
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'

import { SegmentedTabs } from '@/components/media/segmented-tabs'
import type { InventoryPreview } from '@/lib/product-preview'
import { cx } from '@/lib/utils'

export interface ProductShowcaseProps {
  previews: readonly InventoryPreview[]
  className?: string
}

export function ProductShowcase({ previews, className }: ProductShowcaseProps) {
  const baseId = useId()
  const [selected, setSelected] = useState(previews[0]?.id ?? 'group')
  const preview = previews.find((entry) => entry.id === selected) ?? previews[0]

  if (!preview) return null

  return (
    <div className={cx('flex flex-col', className)}>
      <div className="border-b border-line p-3 sm:p-4">
        <SegmentedTabs
          items={previews.map((entry) => ({ id: entry.id, label: entry.tab }))}
          selected={preview.id}
          onSelect={setSelected}
          label="Inventory scope"
          baseId={baseId}
        />
      </div>

      <div
        key={preview.id}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${preview.id}`}
        tabIndex={-1}
        className="animate-wake flex flex-col gap-5 p-4 focus:outline-none sm:p-5"
      >
        {/* The derived figures. A definition list, because that is what they
            are: five labelled values about one selection. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          {preview.figures.map((figure) => (
            <div key={figure.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="truncate font-mono text-2xs tracking-wide text-ink-faint uppercase">
                {figure.label}
              </dt>
              <dd className="numeric text-lg leading-none font-semibold tracking-tight text-ink">
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Four listings. A list rather than a table: at 375px a five-column
            table either overflows the frame or needs a scroll container inside
            a hero, and neither is worth the columns. The full table, with every
            column and every row, is one click away and is what `/inventory`
            is for. */}
        <ul className="flex flex-col divide-y divide-line-subtle border-y border-line-subtle">
          {preview.rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <span className="min-w-0 truncate text-sm font-medium text-ink">
                {row.vehicle}
              </span>
              <span className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-2xs text-ink-muted">
                {preview.accent === null ? <span>{row.store}</span> : null}
                <span>{row.condition}</span>
                <span className="numeric">{row.mileage}</span>
                <span className="numeric text-ink-secondary">{row.price}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="max-w-prose text-xs leading-normal text-ink-muted">
            {preview.observation}
          </p>
          <Link
            href={preview.href}
            className="inline-flex min-h-touch shrink-0 items-center gap-1.5 self-start text-sm font-medium text-accent transition-colors duration-(--arpi-motion-fast) hover:text-accent-strong sm:self-center"
          >
            Open in the explorer
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            <span className="sr-only">{` for ${preview.title}`}</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
