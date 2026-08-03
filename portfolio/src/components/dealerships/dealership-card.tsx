/**
 * The dealership card.
 *
 * One per store, rendered on the home page and again on `/dealerships`. It is the
 * component that has to do the most work in the least space: a reader who sees
 * only these three cards should come away knowing that this group runs three
 * different businesses, not three copies of one.
 *
 * So the card leads with what SEPARATES the stores - franchise or independent,
 * which brand, which town - and only then shows the size of the lot. Every figure
 * on it is read from the generated inventory data; there is no prop by which a
 * caller could pass a count in.
 *
 * The identity rule is in `lib/inventory.ts`: a hue from the project's own token
 * palette, never a manufacturer colour, logo or wordmark.
 */
import { ArrowRight, MapPin } from 'lucide-react'
import Link from 'next/link'

import { Card } from '@/components/ui/card-static'
import { Text } from '@/components/ui/typography'
import { accentPresentation, formatShare } from '@/lib/inventory'
import { cx, formatCount } from '@/lib/utils'
import type { Dealership } from '@/types/inventory'

export function DealershipCard({
  dealership,
  className,
}: {
  dealership: Dealership
  className?: string
}) {
  const accent = accentPresentation(dealership.accent)
  const inventory = dealership.inventory
  const newShare = formatShare(inventory.newRecords, inventory.totalRecords)
  const preOwnedShare = formatShare(inventory.preOwnedRecords, inventory.totalRecords)
  const primaryBrands = inventory.topMakes.slice(0, 3).map((entry) => entry.make)

  return (
    <Card
      as="article"
      padding="none"
      className={cx('flex flex-col overflow-hidden', className)}
    >
      {/* The identity rule. Decorative, and the only place the store's hue is
          used at full strength. */}
      <span aria-hidden="true" className={cx('block h-1 w-full', accent.mark)} />

      <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                'inline-flex items-center rounded-pill border px-2.5 py-0.5',
                'text-2xs font-semibold tracking-wide uppercase',
                accent.chip
              )}
            >
              {dealership.isFranchise ? 'Franchise' : 'Independent'}
            </span>
            <span className="font-mono text-2xs text-ink-faint">{dealership.id}</span>
          </div>

          <h3 className="text-lg leading-snug font-semibold text-ink">
            <Link
              href={dealership.href}
              className="transition-colors duration-(--arpi-motion-fast) hover:text-accent"
            >
              {dealership.name}
            </Link>
          </h3>

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
            {`${dealership.city}, ${dealership.stateCode}`}
            <span aria-hidden="true" className="text-ink-faint">
              &middot;
            </span>
            {dealership.storeTypeLabel}
          </p>
        </div>

        <Text size="sm" tone="secondary" className="max-w-prose">
          {dealership.tagline}
          {'. '}
          {dealership.franchiseBrand === null
            ? 'No franchise, so every unit on the lot was bought rather than allocated.'
            : `${dealership.franchiseBrand} franchise, with pre-owned inventory beside the new line.`}
        </Text>

        {/* The derived block. Everything below this line comes from the
            workbook. */}
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line-subtle pt-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-ink-muted">Listings in snapshot</dt>
            <dd className="numeric text-2xl font-semibold text-ink">
              {formatCount(inventory.totalRecords)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-ink-muted">New and pre-owned</dt>
            <dd className="numeric text-sm leading-snug font-semibold text-ink">
              {`${formatCount(inventory.newRecords)} new`}
              {newShare ? (
                <span className="font-normal text-ink-faint">{` (${newShare})`}</span>
              ) : null}
            </dd>
            <dd className="numeric text-sm leading-snug font-semibold text-ink">
              {`${formatCount(inventory.preOwnedRecords)} pre-owned`}
              {preOwnedShare ? (
                <span className="font-normal text-ink-faint">{` (${preOwnedShare})`}</span>
              ) : null}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <dt className="text-xs font-medium text-ink-muted">
              {primaryBrands.length === 1 ? 'Primary brand' : 'Primary brands'}
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {primaryBrands.map((brand) => (
                <span
                  key={brand}
                  className="inline-flex items-center rounded-md border border-line bg-surface-sunken/70 px-2 py-0.5 text-xs text-ink-secondary"
                >
                  {brand}
                </span>
              ))}
              {inventory.makeCount > primaryBrands.length ? (
                <span className="inline-flex items-center px-1 py-0.5 text-xs text-ink-faint">
                  {`and ${formatCount(inventory.makeCount - primaryBrands.length)} more`}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        <Link
          href={dealership.href}
          className="mt-auto inline-flex min-h-touch items-center gap-1.5 self-start text-sm font-medium text-accent transition-colors duration-(--arpi-motion-fast) hover:text-accent-strong"
        >
          {`Store detail and inventory profile`}
          <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
          <span className="sr-only">{` for ${dealership.name}`}</span>
        </Link>
      </div>
    </Card>
  )
}
