'use client'

/**
 * The inventory explorer.
 *
 * Every sanitized listing Granite Auto Group carries, filterable by store,
 * condition, make, model, model year, price and mileage, and sortable six ways.
 *
 * THE DATA IS ALREADY HERE
 * ------------------------
 * There is no request. The whole record set is imported from
 * `src/generated/inventory-records.json`, which the build produced from the
 * workbooks, so filtering is a synchronous array pass over data that shipped with
 * the page. That is a deliberate trade: the set is a few hundred rows, an API
 * route would need a server this site does not have, and a filter that cannot
 * fail is a filter with no loading state, no error state and no empty-because-of-
 * a-network-problem state to design.
 *
 * WHAT THE FILTERS DO NOT DO
 * --------------------------
 * They never change what a row says. Sorting by price puts the unpriced listings
 * LAST in both directions rather than treating a missing price as zero, because a
 * listing the source did not price is not the cheapest car on the lot. The same
 * rule applies to mileage. The count of excluded rows is stated above the table
 * rather than left for the reader to infer from a total that stopped adding up.
 *
 * URL PERSISTENCE
 * ---------------
 * Every filter and the sort order are written to the query string with
 * `router.replace(..., {scroll: false})`, so a filtered view is linkable and
 * survives a reload without filling the history with one entry per keystroke. The
 * store pages link here with `?dealership=GSA-00n` already set.
 *
 * PAGINATION
 * ----------
 * Rendered a page at a time. Five hundred rows of ten cells is a table a phone
 * renders slowly and nobody scrolls; the page size is a constant below, the
 * control announces its own position, and the row range is stated in words.
 *
 * KEYBOARD AND ASSISTIVE TECHNOLOGY
 * ---------------------------------
 * Every filter is a real `<select>` or a real `<button>` with `aria-pressed`; the
 * two ranges are real `<input type="number">` pairs with visible labels; the
 * result count is a `role="status"` region so a screen-reader user filtering the
 * list is told what happened.
 */
import { RotateCcw } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { InventoryTable } from '@/components/dealerships/inventory-table'
import { Button, buttonClass } from '@/components/ui/button'
import {
  ControlHint,
  ControlLabel,
  Field,
  SelectControl,
  TextControl,
} from '@/components/ui/control'
import { Text } from '@/components/ui/typography'
import {
  CONDITION_LABEL,
  dealerships,
  formatMiles,
  formatPrice,
  inventoryRecords,
  inventorySummary,
} from '@/lib/inventory'
import { formatCount } from '@/lib/utils'
import type { InventoryRecord, VehicleCondition } from '@/types/inventory'

/** Rows per page. */
const PAGE_SIZE = 25

const SORTS = [
  { id: 'price-asc', label: 'Price, low to high' },
  { id: 'price-desc', label: 'Price, high to low' },
  { id: 'mileage-asc', label: 'Mileage, low to high' },
  { id: 'mileage-desc', label: 'Mileage, high to low' },
  { id: 'year-desc', label: 'Model year, newest first' },
  { id: 'year-asc', label: 'Model year, oldest first' },
] as const

type SortId = (typeof SORTS)[number]['id']

const DEFAULT_SORT: SortId = 'year-desc'

interface Filters {
  dealership: string | null
  condition: VehicleCondition | null
  make: string | null
  model: string | null
  modelYear: number | null
  priceMin: number | null
  priceMax: number | null
  mileageMin: number | null
  mileageMax: number | null
}

const EMPTY_FILTERS: Filters = {
  dealership: null,
  condition: null,
  make: null,
  model: null,
  modelYear: null,
  priceMin: null,
  priceMax: null,
  mileageMin: null,
  mileageMax: null,
}

/**
 * Compare two values where `null` means "the source did not expose one".
 *
 * A missing value sorts LAST in both directions. Treating it as zero would put
 * every unpriced listing at the top of "price, low to high", which is the exact
 * misreading the pricing-status column exists to prevent.
 */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * direction
}

function sortRecords(records: InventoryRecord[], sort: SortId): InventoryRecord[] {
  const sorted = [...records]
  switch (sort) {
    case 'price-asc':
      sorted.sort((a, b) => compareNullable(a.price, b.price, 1))
      break
    case 'price-desc':
      sorted.sort((a, b) => compareNullable(a.price, b.price, -1))
      break
    case 'mileage-asc':
      sorted.sort((a, b) => compareNullable(a.mileage, b.mileage, 1))
      break
    case 'mileage-desc':
      sorted.sort((a, b) => compareNullable(a.mileage, b.mileage, -1))
      break
    case 'year-asc':
      sorted.sort((a, b) => a.modelYear - b.modelYear)
      break
    case 'year-desc':
      sorted.sort((a, b) => b.modelYear - a.modelYear)
      break
  }
  return sorted
}

/** Parse an integer query parameter, rejecting anything that is not one. */
function readNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function InventoryExplorer() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFilters] = useState<Filters>(() => ({
    dealership: searchParams.get('dealership'),
    condition: (searchParams.get('condition') as VehicleCondition | null) ?? null,
    make: searchParams.get('make'),
    model: searchParams.get('model'),
    modelYear: readNumber(searchParams.get('year')),
    priceMin: readNumber(searchParams.get('priceMin')),
    priceMax: readNumber(searchParams.get('priceMax')),
    mileageMin: readNumber(searchParams.get('mileageMin')),
    mileageMax: readNumber(searchParams.get('mileageMax')),
  }))
  const [sort, setSort] = useState<SortId>(() => {
    const raw = searchParams.get('sort')
    return SORTS.some((entry) => entry.id === raw) ? (raw as SortId) : DEFAULT_SORT
  })
  const [page, setPage] = useState(1)

  const dealershipNames = useMemo(
    () => new Map(dealerships.map((store) => [store.id, store.shortName])),
    []
  )

  /** Write the current selection back to the query string. */
  const syncUrl = useCallback(
    (next: Filters, nextSort: SortId) => {
      const params = new URLSearchParams()
      if (next.dealership) params.set('dealership', next.dealership)
      if (next.condition) params.set('condition', next.condition)
      if (next.make) params.set('make', next.make)
      if (next.model) params.set('model', next.model)
      if (next.modelYear !== null) params.set('year', String(next.modelYear))
      if (next.priceMin !== null) params.set('priceMin', String(next.priceMin))
      if (next.priceMax !== null) params.set('priceMax', String(next.priceMax))
      if (next.mileageMin !== null) params.set('mileageMin', String(next.mileageMin))
      if (next.mileageMax !== null) params.set('mileageMax', String(next.mileageMax))
      if (nextSort !== DEFAULT_SORT) params.set('sort', nextSort)
      const search = params.toString()
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    },
    [pathname, router]
  )

  /*
   * The next filter state is computed OUTSIDE the state updater.
   *
   * The obvious shape - building `next` inside `setFilters(current => ...)` and
   * calling `router.replace` from in there - works, and is wrong: a state updater
   * must be pure, React is free to invoke it twice, and in development it does.
   * The visible symptom would be two history writes per keystroke.
   *
   * Reading `filters` from the closure is safe here because every caller is an
   * event handler on a control whose value came from that same render.
   */
  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch }
      // Changing the make invalidates a model that belonged to the old one.
      if (patch.make !== undefined && patch.make !== filters.make) next.model = null
      setFilters(next)
      setPage(1)
      syncUrl(next, sort)
    },
    [filters, sort, syncUrl]
  )

  const changeSort = useCallback(
    (next: SortId) => {
      setSort(next)
      setPage(1)
      syncUrl(filters, next)
    },
    [filters, syncUrl]
  )

  const reset = useCallback(() => {
    setFilters(EMPTY_FILTERS)
    setSort(DEFAULT_SORT)
    setPage(1)
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  /* ---------------------------------------------------------------------- */
  /* Filtering                                                              */
  /* ---------------------------------------------------------------------- */

  const matches = useMemo(() => {
    const filtered = inventoryRecords.filter((record) => {
      if (filters.dealership && record.dealershipId !== filters.dealership) return false
      if (filters.condition && record.condition !== filters.condition) return false
      if (filters.make && record.make !== filters.make) return false
      if (filters.model && record.model !== filters.model) return false
      if (filters.modelYear !== null && record.modelYear !== filters.modelYear) {
        return false
      }
      // A price or mileage bound EXCLUDES a listing the source did not expose
      // one for, rather than treating the absence as inside the range. The
      // number of listings that drops out is reported below the controls.
      if (filters.priceMin !== null || filters.priceMax !== null) {
        if (record.price === null) return false
        if (filters.priceMin !== null && record.price < filters.priceMin) return false
        if (filters.priceMax !== null && record.price > filters.priceMax) return false
      }
      if (filters.mileageMin !== null || filters.mileageMax !== null) {
        if (record.mileage === null) return false
        if (filters.mileageMin !== null && record.mileage < filters.mileageMin) {
          return false
        }
        if (filters.mileageMax !== null && record.mileage > filters.mileageMax) {
          return false
        }
      }
      return true
    })
    return sortRecords(filtered, sort)
  }, [filters, sort])

  /** Models available for the selected make, or all of them. */
  const modelOptions = useMemo(() => {
    const source = filters.make
      ? inventorySummary.facets.models.filter((entry) => entry.make === filters.make)
      : inventorySummary.facets.models
    return [...new Set(source.map((entry) => entry.model))].sort((a, b) =>
      a.localeCompare(b)
    )
  }, [filters.make])

  const rangeFilterActive =
    filters.priceMin !== null ||
    filters.priceMax !== null ||
    filters.mileageMin !== null ||
    filters.mileageMax !== null

  const filtersActive =
    rangeFilterActive ||
    filters.dealership !== null ||
    filters.condition !== null ||
    filters.make !== null ||
    filters.model !== null ||
    filters.modelYear !== null

  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * PAGE_SIZE
  const visible = matches.slice(start, start + PAGE_SIZE)

  const newCount = matches.filter((record) => record.condition === 'new').length
  const pricedCount = matches.filter((record) => record.price !== null).length

  return (
    // See the note on the architecture explorer's root: the id is the capture
    // script's locator and a deep-link target, not styling.
    <div id="inventory-explorer" className="flex flex-col gap-8">
      {/* -------------------------------------------------------------- */}
      {/* Controls                                                        */}
      {/* -------------------------------------------------------------- */}
      {/* The filters and the results were two bordered boxes of the same value
          stacked on each other, so the page had no peak and the eye had nowhere
          to land. The rail is now a well: a subtler border, a solid recessed
          ground, and one radius step below the table it feeds. */}
      <section
        aria-labelledby="inventory-filters-heading"
        className="flex flex-col gap-5 rounded-lg border border-line-subtle bg-surface-sunken p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="inventory-filters-heading" className="text-sm font-semibold text-ink">
            Filter and sort
          </h2>
          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              iconBefore={<RotateCcw strokeWidth={2} />}
            >
              Clear all filters
            </Button>
          ) : null}
        </div>

        {/* Condition, as chips: two values, and a chip row is faster to reach
            than a select for a binary. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-ink-muted">Condition</legend>
          <div className="flex flex-wrap gap-2">
            {(['new', 'pre-owned'] as const).map((condition) => {
              const active = filters.condition === condition
              return (
                <button
                  key={condition}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    update({ condition: active ? null : condition })
                  }}
                  className={buttonClass(active ? 'chipActive' : 'chip', 'sm')}
                >
                  {CONDITION_LABEL[condition]}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            id="filter-dealership"
            label="Dealership"
            value={filters.dealership ?? ''}
            onChange={(value) => {
              update({ dealership: value === '' ? null : value })
            }}
            options={dealerships.map((store) => ({
              value: store.id,
              label: store.shortName,
            }))}
            allLabel="All three stores"
          />
          <SelectField
            id="filter-make"
            label="Make"
            value={filters.make ?? ''}
            onChange={(value) => {
              update({ make: value === '' ? null : value })
            }}
            options={inventorySummary.facets.makes.map((make) => ({
              value: make,
              label: make,
            }))}
            allLabel="All makes"
          />
          <SelectField
            id="filter-model"
            label="Model"
            value={filters.model ?? ''}
            onChange={(value) => {
              update({ model: value === '' ? null : value })
            }}
            options={modelOptions.map((model) => ({ value: model, label: model }))}
            allLabel="All models"
          />
          <SelectField
            id="filter-year"
            label="Model year"
            value={filters.modelYear === null ? '' : String(filters.modelYear)}
            onChange={(value) => {
              update({ modelYear: value === '' ? null : Number(value) })
            }}
            options={inventorySummary.facets.modelYears.map((year) => ({
              value: String(year),
              label: String(year),
            }))}
            allLabel="All model years"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RangeField
            legend="Advertised price"
            unit="dollars"
            idPrefix="price"
            bounds={inventorySummary.facets.priceBounds}
            format={formatPrice}
            min={filters.priceMin}
            max={filters.priceMax}
            onChange={(min, max) => {
              update({ priceMin: min, priceMax: max })
            }}
          />
          <RangeField
            legend="Mileage"
            unit="miles"
            idPrefix="mileage"
            bounds={inventorySummary.facets.mileageBounds}
            format={formatMiles}
            min={filters.mileageMin}
            max={filters.mileageMax}
            onChange={(min, max) => {
              update({ mileageMin: min, mileageMax: max })
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4 border-t border-line-subtle pt-4">
          <SelectField
            id="inventory-sort"
            label="Sort by"
            value={sort}
            onChange={(value) => {
              changeSort(value as SortId)
            }}
            options={SORTS.map((entry) => ({ value: entry.id, label: entry.label }))}
            className="sm:max-w-xs"
          />
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Result summary                                                  */}
      {/* -------------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        {/*
         * The count is the only figure on this page that changes as a reader
         * works, which makes it the one thing on screen that proves the
         * filtering is real. It was a 13px sentence between two boxes.
         *
         * The sentence is not replaced, it is split. The live region keeps the
         * exact words it always announced; the visual band beside it is
         * `aria-hidden`, so the same figures are not read out twice.
         */}
        {matches.length === 0 ? (
          <p role="status" className="text-sm text-ink-secondary">
            No listing in the snapshot matches this selection.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-line pb-3">
            <p role="status" className="sr-only">
              {`${formatCount(matches.length)} of ${formatCount(inventoryRecords.length)} listings match. ` +
                `${formatCount(newCount)} new, ${formatCount(matches.length - newCount)} pre-owned, ` +
                `${formatCount(pricedCount)} with an advertised price.`}
            </p>
            <p aria-hidden="true" className="flex flex-wrap items-baseline gap-x-2">
              <span className="numeric font-display text-3xl font-semibold tracking-tighter text-ink">
                {formatCount(matches.length)}
              </span>
              <span className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
                {`of ${formatCount(inventoryRecords.length)} listings`}
              </span>
            </p>
            {/* The breakdown stays at label size. A second display numeral would
                be a second peak, and there is one figure here that matters. */}
            <p
              aria-hidden="true"
              className="numeric font-mono text-2xs tracking-wide text-ink-faint uppercase sm:ml-auto"
            >
              {`${formatCount(newCount)} new · ${formatCount(matches.length - newCount)} pre-owned · ${formatCount(pricedCount)} priced`}
            </p>
          </div>
        )}
        {rangeFilterActive ? (
          <Text size="xs" tone="faint" className="max-w-prose">
            A price or mileage range excludes listings the source did not expose that
            value for. Those listings still exist in the snapshot; they are outside this
            selection rather than absent from the data.
          </Text>
        ) : null}
      </div>

      <InventoryTable
        records={visible}
        dealershipNames={dealershipNames}
        caption="Filtered Granite Auto Group inventory."
        maxHeightClass="max-h-none"
      />

      {/* -------------------------------------------------------------- */}
      {/* Pagination                                                      */}
      {/* -------------------------------------------------------------- */}
      {matches.length > 0 ? (
        <nav
          aria-label="Inventory pages"
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <p className="text-sm text-ink-muted">
            {`Showing ${formatCount(start + 1)} to ${formatCount(start + visible.length)} of ${formatCount(matches.length)}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => {
                setPage(currentPage - 1)
              }}
            >
              Previous
            </Button>
            <span className="numeric px-1 text-sm text-ink-secondary">
              {`Page ${formatCount(currentPage)} of ${formatCount(pageCount)}`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={currentPage >= pageCount}
              onClick={() => {
                setPage(currentPage + 1)
              }}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  allLabel?: string
  className?: string
}) {
  /*
   * A select sitting on its "all" value is filtering nothing, so it is not
   * marked. The sort select has no "all" value at all - it is always set to one
   * of six orders - so it is never marked, because a mark that is always lit
   * reports nothing.
   */
  const active = allLabel !== undefined && value !== ''

  return (
    <Field id={id} label={label} active={active} className={className}>
      <SelectControl
        id={id}
        value={value}
        active={active}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {allLabel ? <option value="">{allLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </Field>
  )
}

/**
 * A minimum and maximum pair.
 *
 * Two number inputs rather than a two-thumb slider. A slider needs a pointer, a
 * keyboard model and an accessible name per thumb to be usable, and it makes an
 * exact bound almost impossible to hit; a reader who wants everything under
 * thirty thousand dollars can type it.
 *
 * The bounds from the data are shown as the placeholder and stated in the hint,
 * so the control tells the reader the range it is filtering inside.
 */
function RangeField({
  legend,
  unit,
  idPrefix,
  bounds,
  format,
  min,
  max,
  onChange,
}: {
  legend: string
  unit: string
  idPrefix: string
  bounds: { readonly min: number; readonly max: number } | null
  format: (value: number) => string
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}) {
  const parse = (raw: string): number | null => {
    if (raw.trim() === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      {/* The pair is marked as a whole when either bound is set: one bound is
          enough for the fieldset to be filtering. Each input then carries its
          own mark, so the reader can see which of the two is doing it. */}
      <ControlLabel as="legend" active={min !== null || max !== null}>
        {legend}
      </ControlLabel>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${idPrefix}-min`} className="sr-only">
            {`Minimum ${legend.toLowerCase()} in ${unit}`}
          </label>
          <TextControl
            id={`${idPrefix}-min`}
            type="number"
            inputMode="numeric"
            active={min !== null}
            min={bounds?.min}
            max={bounds?.max}
            value={min === null ? '' : String(min)}
            placeholder={bounds === null ? 'Min' : String(bounds.min)}
            onChange={(event) => {
              onChange(parse(event.target.value), max)
            }}
          />
        </div>
        <span aria-hidden="true" className="text-xs text-ink-faint">
          to
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${idPrefix}-max`} className="sr-only">
            {`Maximum ${legend.toLowerCase()} in ${unit}`}
          </label>
          <TextControl
            id={`${idPrefix}-max`}
            type="number"
            inputMode="numeric"
            active={max !== null}
            min={bounds?.min}
            max={bounds?.max}
            value={max === null ? '' : String(max)}
            placeholder={bounds === null ? 'Max' : String(bounds.max)}
            onChange={(event) => {
              onChange(min, parse(event.target.value))
            }}
          />
        </div>
      </div>
      {bounds ? (
        <ControlHint>
          {`Snapshot range ${format(bounds.min)} to ${format(bounds.max)}`}
        </ControlHint>
      ) : null}
    </fieldset>
  )
}
