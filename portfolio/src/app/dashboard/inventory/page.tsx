import type { Metadata } from 'next'

import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import { Badge } from '@/components/ui/badge'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Text } from '@/components/ui/typography'
import { accountingChunkFile } from '@/lib/dashboard/accounting-chunks'
import { dashboardManifest, dashboardStores, decodeDataset } from '@/lib/dashboard/data'
import {
  AGED_THRESHOLD_NOTE,
  SEARCHABLE_FIELDS,
  SYNTHETIC_ESTIMATE_NOTE,
  findUnit,
  parseUnitSort,
  resolveSnapshotDate,
  selectUnits,
  snapshotDates,
  sortUnits,
  summarizeInventory,
  toUnitRows,
  type UnitRow,
} from '@/lib/dashboard/inventory'
import { inventoryUnitChunkFile } from '@/lib/dashboard/inventory-chunks'
import {
  INVENTORY_SUPPORT,
  activeFilterChips,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import {
  formatCurrencyDifference,
  formatCurrencyExact,
  formatIsoDate,
  formatRateExact,
} from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'
import type { DashboardRow } from '@/types/dashboard'

export const metadata: Metadata = pageMetadata('dashboardInventory')

const ROUTE = ROUTES.dashboardInventory.href

/**
 * Inventory operations — the used-vehicle manager's surface.
 *
 * WHAT THE PAGE IS CAREFUL ABOUT
 * ------------------------------
 * THE AGED THRESHOLD IS READ, NOT ASSUMED. Every unit row carries `aged_threshold_days`, so
 * the page states the threshold it applied instead of hardcoding one. It is 60 and it is an
 * ARPI project default. It is NOT the same number as the top age bucket: a unit at 75 days is
 * aged and sits in `61-90`, and reading "Over 120" as the threshold would report a fraction
 * of the aged stock the group holds.
 *
 * THE MARKET ESTIMATE IS SYNTHETIC AND SAYS SO EVERY TIME IT APPEARS. It is generated. No
 * auction result, guidebook or licensed benchmark exists in this project, and the ratio built
 * on it is descriptive: above 1.0 means advertised above the estimate, and nothing more. This
 * page makes no repricing recommendation and contains no "suggested price" of any kind.
 *
 * A MISSING VALUE IS MISSING. A unit with no estimate has no ratio and renders as
 * "No estimate", not as 0.00. A unit on its first reportable snapshot has no prior price and
 * renders as "First appearance", not as a zero change.
 *
 * THE POSITION IS AT ONE DATE. Unit counts and investment are semi-additive, so the page
 * resolves one snapshot date and says which, rather than pooling a period.
 *
 * WHY IT READS TWO DOORS
 * ----------------------
 * `inventory-chunks.ts` for the stock, and `accounting-chunks.ts` for one unit's accounting
 * position when the detail panel is open. The two share a grain exactly — month end — which
 * is what lets the panel show a book value beside an asking price without a fuzzy join. The
 * accounting door is opened only for the detail panel, and a unit with no accounting row says
 * so rather than showing zeros.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const parsed = parseFilters(params as QueryInput, {
    knownStores: dashboardStores.map((store) => store.id),
  })

  // Page-specific parameters, read from the raw record. They are deliberately NOT part of
  // the global filter grammar: `unit`, `q` and `sort` mean something only here.
  const requestedUnit = firstValue(params.unit)
  const search = firstValue(params.q)
  const sort = parseUnitSort(firstValue(params.sort))

  // The stores whose partitions this request needs. An unfiltered request opens all three;
  // a store-filtered one opens exactly the stores it asked for, which is the point of
  // partitioning by store in the first place.
  const wantedStores =
    parsed.filters.store.length === 0
      ? dashboardStores.map((store) => store.id)
      : parsed.filters.store

  const months = manifestMonths('inventory-units')
  const units = toUnitRows(
    wantedStores.flatMap((store) =>
      months.flatMap((month) => partitionRows('inventory-units', store, month))
    )
  )

  const dates = snapshotDates(units)
  const snapshotDate = resolveSnapshotDate(units, parsed.filters)
  const selected = selectUnits(units, snapshotDate, parsed.filters, search)
  const ordered = sortUnits(selected, sort)
  const summary = summarizeInventory(selected, snapshotDate)

  const unit = findUnit(selected, requestedUnit)
  const unitNotFound = requestedUnit !== null && unit === null
  const accounting = unit === null ? null : accountingFor(unit)

  const chips = activeFilterChips(parsed.filters, INVENTORY_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)

  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))
  const periodOptions: readonly FilterOption[] = dates.map((date) => ({
    value: date.slice(0, 7),
    label: formatIsoDate(date),
  }))

  return (
    <Canvas>
      <PageHeader
        eyebrow="Dealer Operations Command Center"
        title="What is on the lot, how long it has been there, and what it is priced against"
        crumbLabel="Inventory"
        lede={`Unit-level stock at one snapshot date. Age is measured against a ${summary.agedThresholdDays ?? 60}-day project default, which is not an industry benchmark and is a different number from the top age bucket. Price to market compares the asking price against a synthetic estimate that is generated for this fictional dataset and is not a market valuation.`}
        dashboardNav
        trustScope="dashboard"
        meta={
          <>
            <Badge tone="neutral" mono>
              Dataset v{exportState.datasetVersion} · {exportState.profile}
            </Badge>
            <Badge tone="neutral" mono>
              {snapshotDate === null
                ? 'No snapshot date'
                : `Snapshot ${formatIsoDate(snapshotDate)}`}
            </Badge>
            <Badge tone={powerBi.validated ? 'verified' : 'pending'}>
              {powerBi.validated
                ? 'Real-engine validation recorded'
                : 'Real-engine validation pending'}
            </Badge>
          </>
        }
      />

      <Section rhythm="none" tone="evidence" className="py-section-tight" id="context">
        <Container width="full">
          <div className="flex flex-col gap-6">
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />

            <dl className="grid gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Snapshot date
                </dt>
                <dd className="text-sm text-ink">
                  {snapshotDate === null
                    ? 'None in this period'
                    : formatIsoDate(snapshotDate)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Date basis
                </dt>
                <dd className="text-sm text-ink">Snapshot date</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">
                  Aged threshold
                </dt>
                <dd className="text-sm text-ink">
                  {summary.agedThresholdDays ?? 60} days · project default
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs uppercase tracking-wide text-ink-muted">Scope</dt>
                <dd className="text-sm text-ink">
                  {parsed.filters.store.length === 0
                    ? 'All stores'
                    : parsed.filters.store.join(', ')}
                </dd>
              </div>
            </dl>

            {chips.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <li
                    key={chip.key}
                    className="inline-flex min-h-6 items-center gap-1.5 rounded-pill border border-line-subtle bg-surface px-2.5 py-1 text-xs"
                  >
                    <span className="text-ink-muted">{chip.label}</span>{' '}
                    <span className="text-ink">{chip.value}</span>
                    {chip.support === 'applied' ? null : (
                      <span className="text-ink-faint">
                        {chip.support === 'partial'
                          ? '· partly applied'
                          : '· not applied here'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            <FilterBar
              action={ROUTE}
              filters={parsed.filters}
              periodOptions={periodOptions}
              stores={storeOptions}
              conditions={CONDITION_OPTIONS}
              leadSources={[]}
              leadSourceHint="Not applied here. The inventory datasets carry no lead-source attribute."
            />

            {/* Unit search and ordering, as a native GET form so the page works without
                JavaScript. Both land in the URL, so a filtered view is copyable and the
                browser's own history works. */}
            <form action={ROUTE} method="get" className="flex flex-wrap items-end gap-3">
              {preservedFilterInputs(params)}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="q"
                  className="text-xs uppercase tracking-wide text-ink-muted"
                >
                  Find a unit
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={search ?? ''}
                  placeholder="VEH-0000013, Chevrolet, Tahoe"
                  className="min-h-9 rounded border border-line bg-surface px-3 py-1.5 text-sm"
                />
                <span className="text-xs text-ink-faint">
                  Searches {SEARCHABLE_FIELDS}.
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="sort"
                  className="text-xs uppercase tracking-wide text-ink-muted"
                >
                  Order by
                </label>
                <select
                  id="sort"
                  name="sort"
                  defaultValue={sort}
                  className="min-h-9 rounded border border-line bg-surface px-3 py-1.5 text-sm"
                >
                  <option value="store">Store, then unit</option>
                  <option value="age-desc">Days in stock, longest first</option>
                  <option value="age-asc">Days in stock, shortest first</option>
                  <option value="price-desc">Asking price, highest first</option>
                  <option value="price-asc">Asking price, lowest first</option>
                  <option value="ratio-desc">Price to market, highest first</option>
                  <option value="ratio-asc">Price to market, lowest first</option>
                </select>
              </div>
              <button
                type="submit"
                className="min-h-9 rounded border border-line bg-surface px-4 py-1.5 text-sm"
              >
                Apply
              </button>
            </form>

            <Disclosure label="What the market estimate is, and what the aged threshold means">
              <div className="flex flex-col gap-3">
                <Text size="sm">{SYNTHETIC_ESTIMATE_NOTE}</Text>
                <Text size="sm">{AGED_THRESHOLD_NOTE}</Text>
                <Text size="sm">
                  Price movement is derived from consecutive month-end snapshots of the
                  same unit at the same store. It is an observed change in the advertised
                  price and is not evidence of a manager decision, a pricing strategy or a
                  repricing action; ARPI models none of those.
                </Text>
                <Text size="sm">
                  Unit counts and investment are positions at the snapshot date. They add
                  across units and stores on that date and never across dates.
                </Text>
              </div>
            </Disclosure>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Summary                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Section id="summary">
        <Container width="full">
          <SectionHeader
            eyebrow="Position"
            title="The lot at this date"
            lede="Median age is the headline figure and the mean is beside it: inventory age is right-skewed, and the gap between them is the aged tail."
          />
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active units" value={String(summary.units)} />
            <Stat
              label="Inventory investment"
              value={formatCurrencyExact(summary.investment)}
              note="Acquisition plus reconditioning. Not the accounting book value."
            />
            <Stat
              label="Median days in stock"
              value={summary.medianAge === null ? '—' : String(summary.medianAge)}
              note={
                summary.meanAge === null
                  ? undefined
                  : `Mean ${summary.meanAge.toFixed(1)} days`
              }
            />
            <Stat
              label={`Aged over ${summary.agedThresholdDays ?? 60} days`}
              value={String(summary.agedUnits)}
              note={
                summary.agedShare === null
                  ? undefined
                  : `${(summary.agedShare * 100).toFixed(1)}% of units · project default`
              }
            />
          </dl>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Age distribution                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section id="age" tone="evidence">
        <Container width="full">
          <SectionHeader
            eyebrow="Age"
            title="Where the money is sitting"
            lede="The five governed age buckets. Bucket boundaries and the aged threshold are different rules and a unit can be aged inside any bucket above the threshold."
          />
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Age distribution"
          >
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Units and investment by age bucket</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Age bucket
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Units
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Share
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Investment
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.buckets.map((bucket) => (
                  <tr key={bucket.bucket} className="border-b border-line-subtle">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {bucket.bucket}
                    </th>
                    <td className="py-2 pr-4 text-right font-mono">{bucket.units}</td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {bucket.share === null
                        ? '—'
                        : `${(bucket.share * 100).toFixed(1)}%`}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {formatCurrencyExact(bucket.investment)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Unit detail                                                         */}
      {/* ------------------------------------------------------------------ */}
      {requestedUnit === null ? null : (
        <Section id="unit">
          <Container width="full">
            <SectionHeader
              eyebrow="Unit"
              title={unit === null ? 'Unit not found' : `${unit.vehicleId}`}
              lede={
                unit === null
                  ? 'No unit with that identifier is in stock at this snapshot date and store selection.'
                  : `${unit.modelYear} ${unit.make} ${unit.modelName} ${unit.trimLevel} · ${unit.conditionType} · ${unit.dealershipId}`
              }
            />
            {unitNotFound ? (
              <p className="text-sm text-ink-muted">
                Check the identifier, or clear the store and period filters — a unit that
                sold before this snapshot date is not on the lot and has no row here.{' '}
                <a className="underline" href={ROUTE}>
                  Show all units
                </a>
                .
              </p>
            ) : unit === null ? null : (
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-medium text-ink">
                    Operational position
                  </h3>
                  <dl className="flex flex-col gap-2 text-sm">
                    <Row label="Snapshot date" value={formatIsoDate(unit.snapshotDate)} />
                    <Row label="Days in stock" value={String(unit.daysInStock)} />
                    <Row
                      label="Age bucket"
                      value={`${unit.ageBucket}${unit.isAged ? ` · aged over ${unit.agedThresholdDays} days` : ''}`}
                    />
                    <Row
                      label="Odometer"
                      value={`${unit.odometerReading.toLocaleString()} mi`}
                    />
                    <Row
                      label="Asking price"
                      value={formatCurrencyExact(unit.currentAskingPrice)}
                    />
                    <Row
                      label="Original asking price"
                      value={formatCurrencyExact(unit.originalAskingPrice)}
                    />
                    <Row
                      label="Synthetic market estimate"
                      value={
                        unit.marketPriceEstimate === null
                          ? 'No estimate for this unit'
                          : `${formatCurrencyExact(unit.marketPriceEstimate)} · synthetic estimate`
                      }
                    />
                    <Row
                      label="Price to market"
                      value={
                        unit.priceToMarketRatio === null
                          ? 'No ratio without an estimate'
                          : ratioLabel(unit)
                      }
                    />
                    <Row
                      label="Since prior snapshot"
                      value={
                        unit.askingPriceChange === null
                          ? 'First appearance — no prior observation'
                          : `${formatCurrencyDifference(unit.askingPriceChange, 2)} since the prior month end`
                      }
                    />
                    <Row
                      label="Inventory investment"
                      value={formatCurrencyExact(unit.inventoryInvestment)}
                    />
                  </dl>
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-ink">
                    Accounting position
                  </h3>
                  {accounting === null ? (
                    <p className="text-sm text-ink-muted">
                      No accounting snapshot for this unit at this date. That is a missing
                      row, not a book value of zero.
                    </p>
                  ) : (
                    <dl className="flex flex-col gap-2 text-sm">
                      <Row
                        label="Control account"
                        value={`${accounting.glAccountNumber} · ${accounting.glAccountName}`}
                      />
                      <Row label="Acquisition cost" value={accounting.acquisitionCost} />
                      <Row label="Transportation" value={accounting.transportation} />
                      <Row label="Reconditioning" value={accounting.reconditioning} />
                      <Row label="Accessories" value={accounting.accessories} />
                      <Row
                        label="Other capitalized"
                        value={accounting.otherCapitalized}
                      />
                      <Row label="Write-down" value={accounting.writeDown} />
                      <Row label="Current book value" value={accounting.bookValue} />
                      <Row
                        label="Floorplan principal"
                        value={`${accounting.floorplan} · liability context`}
                      />
                    </dl>
                  )}
                  <p className="mt-3 text-xs text-ink-faint">
                    Floorplan principal is a liability carried alongside the unit. It is
                    not part of book value and is never netted against it; ARPI publishes
                    no net inventory position and models no floorplan interest,
                    curtailment or carrying cost.
                  </p>
                </div>
              </div>
            )}
          </Container>
        </Section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Unit table                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Section id="units" tone="evidence">
        <Container width="full">
          <SectionHeader
            eyebrow="Units"
            title="Every unit on the lot"
            lede={`${ordered.length} unit${ordered.length === 1 ? '' : 's'} at this date. Select a unit to see its accounting position.`}
          />
          {ordered.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {snapshotDate === null
                ? 'No snapshot date falls inside the selected period.'
                : 'No units match this search and filter selection.'}
            </p>
          ) : (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Unit population"
            >
              <table className="w-full min-w-[60rem] border-collapse text-sm">
                <caption className="sr-only">
                  Inventory units at{' '}
                  {snapshotDate === null ? 'no date' : formatIsoDate(snapshotDate)}
                </caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Unit
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Store
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Vehicle
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Days
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Bucket
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Asking
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Est. (synthetic)
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Price to market
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Since prior
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((row) => (
                    <tr key={row.vehicleId} className="border-b border-line-subtle">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        <a className="underline" href={`${ROUTE}?unit=${row.vehicleId}`}>
                          {row.vehicleId}
                        </a>
                      </th>
                      <td className="py-2 pr-4">{row.dealershipId}</td>
                      <td className="py-2 pr-4">
                        {row.modelYear} {row.make} {row.modelName}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.daysInStock}
                      </td>
                      <td className="py-2 pr-4">{row.ageBucket}</td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatCurrencyExact(row.currentAskingPrice)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.marketPriceEstimate === null ? (
                          <span className="text-ink-faint">No estimate</span>
                        ) : (
                          formatCurrencyExact(row.marketPriceEstimate)
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.priceToMarketRatio === null ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          ratioLabel(row)
                        )}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {row.askingPriceChange === null ? (
                          <span className="text-ink-faint">First appearance</span>
                        ) : (
                          formatCurrencyDifference(row.askingPriceChange, 2)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Container>
      </Section>
    </Canvas>
  )
}

/* -------------------------------------------------------------------------- */
/* Server helpers                                                              */
/* -------------------------------------------------------------------------- */

const CONDITION_OPTIONS: readonly FilterOption[] = [
  { value: 'New', label: 'New' },
  { value: 'Used', label: 'Used' },
  { value: 'Certified', label: 'Certified' },
]

function firstValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null
  const first = Array.isArray(value) ? value[0] : value
  return first === undefined || first.length === 0 ? null : first
}

/** The months the manifest declares for a chunked dataset. */
function manifestMonths(dataset: string): readonly string[] {
  const entry = dashboardManifest.datasets.find((item) => item.name === dataset)
  if (entry?.chunks == null) return []
  return [...new Set(entry.chunks.map((chunk) => chunk.month))].sort()
}

function partitionRows(
  dataset: 'inventory-units',
  store: string,
  month: string
): readonly DashboardRow[] {
  const file = inventoryUnitChunkFile(store, month)
  return file === undefined ? [] : decodeDataset(dataset, file)
}

/**
 * The accounting position for one unit, rendered.
 *
 * Opens ONE partition — the unit's own store and month — rather than the whole accounting
 * set, so a detail panel costs one file. Formatting happens here because the page may not
 * touch exact decimals itself.
 */
function accountingFor(unit: UnitRow): {
  readonly glAccountNumber: string
  readonly glAccountName: string
  readonly acquisitionCost: string
  readonly transportation: string
  readonly reconditioning: string
  readonly accessories: string
  readonly otherCapitalized: string
  readonly writeDown: string
  readonly bookValue: string
  readonly floorplan: string
} | null {
  const month = unit.snapshotDate.slice(0, 7)
  const file = accountingChunkFile(unit.dealershipId, month)
  if (file === undefined) return null
  const row = decodeDataset('inventory-accounting', file).find(
    (candidate) =>
      candidate.vehicle_id === unit.vehicleId &&
      candidate.accounting_date === unit.snapshotDate
  )
  if (row === undefined) return null
  const money = (value: unknown): string =>
    typeof value === 'string' ? `$${value}` : '—'
  return {
    glAccountNumber: String(row.gl_account_number ?? ''),
    glAccountName: String(row.gl_account_name ?? ''),
    acquisitionCost: money(row.acquisition_cost),
    transportation: money(row.capitalized_transportation),
    reconditioning: money(row.capitalized_reconditioning),
    accessories: money(row.capitalized_accessories),
    otherCapitalized: money(row.other_capitalized_costs),
    writeDown: money(row.write_down_amount),
    bookValue: money(row.current_book_value),
    floorplan: money(row.floorplan_principal),
  }
}

/**
 * The ratio, rendered.
 *
 * Formatting happens in this server module rather than inline because a `.tsx` may not touch
 * an exact decimal at all. The value is descriptive: 1.0 is parity with the synthetic
 * estimate, and no wording here calls a unit overpriced or underpriced.
 */
function ratioLabel(unit: UnitRow): string {
  if (unit.priceToMarketRatio === null) return '—'
  return formatRateExact(unit.priceToMarketRatio, 3)
}

/** Hidden inputs so the search form does not drop the filters already in the URL. */
function preservedFilterInputs(params: Record<string, string | string[] | undefined>) {
  const keys = ['period', 'store', 'condition', 'make', 'model'] as const
  return keys.map((key) => {
    const value = firstValue(params[key])
    return value === null ? null : (
      <input key={key} type="hidden" name={key} value={value} />
    )
  })
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line p-4">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="font-mono text-lg text-ink">{value}</dd>
      {note === undefined ? null : <dd className="text-xs text-ink-faint">{note}</dd>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-subtle pb-1">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-mono text-ink">{value}</dd>
    </div>
  )
}
