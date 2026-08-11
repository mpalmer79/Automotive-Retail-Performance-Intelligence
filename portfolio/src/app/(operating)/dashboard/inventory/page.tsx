import type { Metadata } from 'next'

import { GridRow, Module, Workspace } from '@/components/dashboard/exec-grid'
import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  AgeAndCapital,
  InventoryMethodology,
  InventoryRail,
  PositionMapSection,
  PriceMovementSection,
  UnitTable,
} from '@/components/dashboard/inventory-sections'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
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
  formatIsoMonth,
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
 * Inventory operations — the used-vehicle manager's console.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * `UX.1` left this route as four full-width bands: a four-card summary, an age TABLE, an
 * optional unit panel, and a nine-column table of every unit on the lot. Measured on the
 * merge of `UX.2A`, at 1440 × 900, it was the longest document in the console at
 * 11,543 px — thirteen screens — and it contained **zero framed visualizations**. An
 * inventory manager's three questions are how old the stock is, where the money is sitting
 * inside that age, and which units are furthest from the reference: the route held all
 * three answers and drew none of them.
 *
 * `UX.2B` rebuilds it as a workspace on the twelve-column module grid. Four modules of
 * geometry, and the two hundred rows of unit detail that used to be the page are a
 * disclosure underneath it.
 *
 * THE POSITION MAP, AND THE CHECK THAT PRECEDED IT
 * ------------------------------------------------
 * `UX.2B` §6C permits an age × price-to-market map only if the CURRENT unit-grain data
 * supports every dimension without fabrication. It was checked column by column before it
 * was built, and it does: `days_in_stock`, `price_to_market_ratio` and
 * `inventory_investment` are all published on the row being plotted. Nothing is imputed, no
 * fourth measure is derived, and no score is formed.
 *
 * The vocabulary is neutral by construction, which is §6C's other requirement. No axis, no
 * legend, no caption and no mark on that plot says overpriced, underpriced, reprice or
 * opportunity, and `dashboard-inventory.spec.ts` fails the build if any of them appears.
 * The horizontal axis is a ratio against a SYNTHETIC reference and every surface that draws
 * it says so.
 *
 * WHAT WAS REFUSED FOR WANT OF A GRAIN
 * ------------------------------------
 * A price TRACK per unit over the six exported months. The route decodes ONE month's
 * partitions per request, which is a deliberate cost decision recorded below and worth
 * roughly 1,200 rows of decode per page load; a multi-month line per unit would need five
 * more partitions per store to draw one chart. What the current grain publishes is
 * `asking_price_change` — one observation per unit against the prior month end — so §6D is
 * answered with a DISTRIBUTION of those changes, which is the honest form for one
 * observation, and the refusal is recorded in `docs/reviews/UX-2B-REVIEW.md`.
 *
 * WHAT DID NOT CHANGE. No KPI definition, no aged threshold, no bucket boundary, no
 * snapshot rule, no export and no new reporting view. Two figures were added to the summary
 * and both are the same arithmetic the summary already performed for mean age: a summed
 * exported column over a counted population.
 *
 * WHY IT READS TWO DOORS. `inventory-chunks.ts` for the stock, and `accounting-chunks.ts`
 * for one unit's accounting position when the detail module is open. The two share a grain
 * exactly — month end — which is what lets the module show a book value beside an asking
 * price without a fuzzy join. The accounting door is opened only for that module, and a
 * unit with no accounting row says so rather than showing zeros.
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

  // ONE MONTH IS DECODED, NOT ALL SIX.
  //
  // The months this dataset carries come from the manifest's chunk index, which is metadata
  // the page already holds -- no partition is opened to discover them. The period then picks
  // ONE month, and only that month's partitions are decoded, for only the stores in scope.
  //
  // This is a correctness-neutral change and a large cost one: reading all six months for
  // three stores decoded eighteen partitions on every request, roughly 1,500 unit rows, to
  // render a page that shows one date. It also made this the heaviest render in the console,
  // which is how it became the first page to flake under a parallel browser suite. A default
  // request now opens three partitions; a store-filtered one opens one.
  const months = manifestMonths('inventory-units')
  const targetMonth = resolveMonth(months, parsed.filters)
  const units = toUnitRows(
    targetMonth === null
      ? []
      : wantedStores.flatMap((store) =>
          partitionRows('inventory-units', store, targetMonth)
        )
  )

  // The period options come from the chunk index too, so a month with no partition is never
  // offered and no partition is opened to build the list.
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
  const periodOptions: readonly FilterOption[] = months.map((month) => ({
    value: month,
    label: formatIsoMonth(month),
  }))

  return (
    <Canvas>
      <OperatingPageHeader
        title="Inventory"
        context={operatingContext([
          parsed.filters.store.length === 0
            ? 'All stores'
            : parsed.filters.store.join(', '),
          snapshotDate === null
            ? 'No snapshot in this period'
            : `Snapshot ${formatIsoDate(snapshotDate)}`,
          `Aged over ${String(summary.agedThresholdDays ?? 60)} days`,
        ])}
        subtitle="Stock held at one snapshot date. Positions, never summed across dates."
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            {/*
              TWO CAVEATS STAY VISIBLE, AND THE MECHANISM BEHIND THEM DOES NOT.

              `UX.1`'s rule is that a caveat is visible and a mechanism is disclosed. These
              two are caveats: a reader who takes the aged threshold for an industry standard,
              or the price estimate for a valuation, has misread every figure on the page. The
              full notes are in the methodology disclosure beside the filters.
            */}
            <Text size="sm" tone="secondary">
              The aged threshold is an ARPI project default, not an industry benchmark,
              and it is a different number from the top age bucket. The market estimate is
              synthetic and is not a market valuation.
            </Text>
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
            <ActiveFilterChips chips={chips} />
          </div>
        }
        filters={
          <div className="flex flex-col gap-3">
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
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="q" className="text-xs font-medium text-ink-muted">
                  Find a unit
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={search ?? ''}
                  placeholder="VEH-0000013, Chevrolet, Tahoe"
                  className="min-h-touch rounded-md border border-line-subtle bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="sort" className="text-xs font-medium text-ink-muted">
                  Order the unit table by
                </label>
                <select
                  id="sort"
                  name="sort"
                  defaultValue={sort}
                  className="min-h-touch rounded-md border border-line-subtle bg-surface px-3 text-sm text-ink"
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
                className="inline-flex min-h-touch items-center rounded-md border border-line-subtle px-4 text-sm font-medium text-ink transition-colors duration-(--arpi-motion-fast) hover:border-accent hover:text-accent"
              >
                Apply
              </button>
              <span className="text-2xs text-ink-faint">
                Searches {SEARCHABLE_FIELDS}.
              </span>
            </form>
          </div>
        }
        methodology={
          <div className="flex flex-col gap-4">
            <ExportProvenance
              exportState={exportState}
              powerBi={powerBi}
              {...(snapshotDate === null ? {} : { asOf: snapshotDate })}
            />
            <InventoryMethodology
              syntheticNote={SYNTHETIC_ESTIMATE_NOTE}
              agedNote={AGED_THRESHOLD_NOTE}
            />
          </div>
        }
      />

      <Workspace>
        {/* ------------------------------------------------------------------ */}
        {/* ROW 1 — the lot at this date                                        */}
        {/* ------------------------------------------------------------------ */}
        <GridRow>
          <Module
            id="summary"
            title="Position"
            zone="inventory"
            visual="kpi-rail"
            meta={
              snapshotDate === null
                ? 'No snapshot'
                : `Snapshot ${formatIsoDate(snapshotDate)}`
            }
          >
            <InventoryRail summary={summary} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 2 — where the money is sitting, and which units are where       */}
        {/* ------------------------------------------------------------------ */}
        {/*
          THE FIRST-VIEWPORT CONTRACT IS MET HERE. The rail plus two modules of geometry,
          and they are the two an inventory manager opens the console for: the age
          distribution with its capital track, and the position map. Everything below this
          row is a follow-up.
        */}
        <GridRow align="start">
          <Module id="age" title="Age and capital" span={5} zone="inventory" visual="age">
            <AgeAndCapital summary={summary} />
          </Module>
          <Module
            id="position"
            title="Position map"
            span={7}
            zone="inventory"
            visual="position-map"
          >
            <PositionMapSection
              units={ordered}
              summary={summary}
              route={ROUTE}
              selectedUnitId={requestedUnit}
              skipTargetId="price-movement"
            />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 3 — price movement, and the selected unit                       */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module
            id="price-movement"
            title="Price movement"
            span={5}
            zone="inventory"
            visual="price-movement"
          >
            <PriceMovementSection
              movement={summary.priceMovement}
              units={summary.units}
            />
          </Module>

          {/*
            THE UNIT MODULE IS PRESENT ONLY WHEN A UNIT IS SELECTED. An empty detail panel
            waiting to be filled is furniture: it takes a seventh of the grid on every load
            to say nothing. The plot's marks and the unit table's identifiers are both links
            that select one, and the module then appears here with both doors open.
          */}
          {requestedUnit === null ? (
            <Module id="units" title="Every unit on the lot" span={7} zone="inventory">
              <UnitTable
                units={ordered}
                route={ROUTE}
                snapshotDate={snapshotDate}
                emptyReason={
                  snapshotDate === null
                    ? 'No snapshot date falls inside the selected period.'
                    : 'No units match this search and filter selection.'
                }
              />
              <Text size="xs" tone="faint">
                {`${String(ordered.length)} unit${ordered.length === 1 ? '' : 's'} at this date. Select a unit, here or on the plot, to see its accounting position.`}
              </Text>
            </Module>
          ) : (
            <Module
              id="unit"
              title={unit === null ? 'Unit not found' : unit.vehicleId}
              span={7}
              zone="inventory"
              meta={
                unit === null
                  ? undefined
                  : `${String(unit.modelYear)} ${unit.make} ${unit.modelName} ${unit.trimLevel} · ${unit.conditionType} · ${unit.dealershipId}`
              }
            >
              {unitNotFound ? (
                <Text size="sm" tone="muted">
                  No unit with that identifier is in stock at this snapshot date and store
                  selection. Check the identifier, or clear the store and period filters —
                  a unit that sold before this snapshot date is not on the lot and has no
                  row here.{' '}
                  <a
                    className="underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                    href={ROUTE}
                  >
                    Show all units
                  </a>
                  .
                </Text>
              ) : unit === null ? null : (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-ink-secondary">
                      Operational position
                    </h3>
                    <dl className="flex flex-col gap-1.5 text-sm">
                      <Row
                        label="Snapshot date"
                        value={formatIsoDate(unit.snapshotDate)}
                      />
                      <Row label="Days in stock" value={String(unit.daysInStock)} />
                      <Row
                        label="Age bucket"
                        value={`${unit.ageBucket}${unit.isAged ? ` · aged over ${String(unit.agedThresholdDays)} days` : ''}`}
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
                    <h3 className="mb-2 text-sm font-semibold text-ink-secondary">
                      Accounting position
                    </h3>
                    {accounting === null ? (
                      <Text size="sm" tone="muted">
                        No accounting snapshot for this unit at this date. That is a
                        missing row, not a book value of zero.
                      </Text>
                    ) : (
                      <dl className="flex flex-col gap-1.5 text-sm">
                        <Row
                          label="Control account"
                          value={`${accounting.glAccountNumber} · ${accounting.glAccountName}`}
                        />
                        <Row
                          label="Acquisition cost"
                          value={accounting.acquisitionCost}
                        />
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
                    <Text size="xs" tone="faint" className="pt-2">
                      Floorplan principal is a liability carried alongside the unit. It is
                      not part of book value and is never netted against it; ARPI
                      publishes no net inventory position and models no floorplan
                      interest, curtailment or carrying cost.
                    </Text>
                  </div>
                </div>
              )}
              <a
                href={ROUTE}
                className="inline-flex min-h-touch items-center self-start text-sm text-ink-muted underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                Clear the unit selection
              </a>
            </Module>
          )}
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 4 — the whole lot, when a unit is selected above                */}
        {/* ------------------------------------------------------------------ */}
        {requestedUnit === null ? null : (
          <GridRow>
            <Module id="units" title="Every unit on the lot" span={12} zone="inventory">
              <UnitTable
                units={ordered}
                route={ROUTE}
                snapshotDate={snapshotDate}
                emptyReason={
                  snapshotDate === null
                    ? 'No snapshot date falls inside the selected period.'
                    : 'No units match this search and filter selection.'
                }
              />
            </Module>
          </GridRow>
        )}
      </Workspace>
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

/**
 * The single month a request needs, or null when the period covers none.
 *
 * Newest-first, so the first match inside a period is the LAST month within it -- the same
 * semi-additive rule the selectors follow, applied here so the decode is scoped before any
 * row is read rather than after.
 */
function resolveMonth(
  months: readonly string[],
  filters: {
    readonly period: {
      readonly kind: string
      readonly month?: string
      readonly start?: string
      readonly end?: string
    }
  }
): string | null {
  const newestFirst = [...months].sort().reverse()
  const period = filters.period
  if (period.kind === 'month' && period.month !== undefined) {
    return newestFirst.find((month) => month === period.month) ?? null
  }
  if (period.kind === 'range' && period.start !== undefined && period.end !== undefined) {
    const start = period.start.slice(0, 7)
    const end = period.end.slice(0, 7)
    return newestFirst.find((month) => month >= start && month <= end) ?? null
  }
  return newestFirst[0] ?? null
}

/**
 * One decoded partition.
 *
 * THE CACHE KEY IS THE PARTITION, NOT THE DATASET. `decodeDataset` memoizes by key, so a
 * bare `'inventory-units'` returns whichever store was decoded FIRST for every store after
 * it — silently, because the shape is identical and only the contents are wrong. That
 * defect shipped: the route rendered GSA-001's 96 units three times and reported 288.
 * `fi.ts` carries the same warning for the same reason; this is the second time the
 * repository has paid for it, which is why the key now names the store and the month.
 */
function partitionRows(
  dataset: 'inventory-units',
  store: string,
  month: string
): readonly DashboardRow[] {
  const file = inventoryUnitChunkFile(store, month)
  return file === undefined ? [] : decodeDataset(`${dataset}/${store}/${month}`, file)
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
  // Per-partition cache key, for the reason `partitionRows` states.
  const row = decodeDataset(
    `inventory-accounting/${unit.dealershipId}/${month}`,
    file
  ).find(
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-subtle pb-1">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="numeric text-right text-ink">{value}</dd>
    </div>
  )
}
