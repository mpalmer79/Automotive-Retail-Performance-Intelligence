import type { Metadata } from 'next'

import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import {
  AgePriceMap,
  InventoryRail,
  PriceMovement,
} from '@/components/dashboard/inventory-workspace'
import { InventoryAgeStack, TableDisclosure } from '@/components/dashboard/visuals'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import { Disclosure } from '@/components/ui/disclosure'
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
  serializeFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import { filtersForRoute } from '@/lib/dashboard/navigation'
import {
  formatCountExact,
  formatCurrencyDifference,
  formatCurrencyExact,
  formatIsoDate,
  formatIsoMonth,
  formatRateExact,
} from '@/lib/dashboard/format'
import { exactFromInteger } from '@/lib/dashboard/decimal'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { storeScopeLabel } from '@/lib/dashboard/scope'
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

  /*
   * The snapshot date in the reader's words, resolved once. Every figure on this route is a
   * POSITION at it, and each visual states which date it is a position at rather than
   * assuming the reader carried the control band's context down the page.
   */
  const snapshotLabel =
    snapshotDate === null ? 'no snapshot in this period' : formatIsoDate(snapshotDate)

  const chips = activeFilterChips(parsed.filters, INVENTORY_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)

  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))
  /*
   * A UNIT LINK THAT KEEPS THE VIEW IT WAS CLICKED FROM.
   *
   * `UX.2D` §10. On `main` every one of the 250 unit links in the table below was
   * `/dashboard/inventory?unit=VEH-…` and nothing else, so a used-vehicle manager who
   * had filtered to Granite Subaru and pre-owned stock, found an aged unit and opened
   * it landed back on the unfiltered lot — and the Back button was the only way to
   * recover a selection the URL had been carrying all along.
   *
   * `filtersForRoute` first drops anything this route cannot act on, so the link is
   * the canonical serialization of the current view plus one unit, and never a
   * parameter the destination would display as active and ignore.
   */
  const unitFilterQuery = serializeFilters(filtersForRoute(parsed.filters, ROUTE))

  const unitHref = (vehicleId: string): string =>
    unitFilterQuery === ''
      ? `${ROUTE}?unit=${vehicleId}`
      : `${ROUTE}?${unitFilterQuery}&unit=${vehicleId}`

  const periodOptions: readonly FilterOption[] = months.map((month) => ({
    value: month,
    label: formatIsoMonth(month),
  }))

  return (
    <Canvas>
      <OperatingPageHeader
        title="Inventory"
        context={operatingContext([
          storeScopeLabel(parsed.filters.store),
          snapshotDate === null
            ? 'No snapshot in this period'
            : `Snapshot ${formatIsoDate(snapshotDate)}`,
          `Aged over ${String(summary.agedThresholdDays ?? 60)} days`,
        ])}
        subtitle="Stock held at one snapshot date. Positions, never summed across dates."
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            {...(snapshotDate === null ? {} : { asOf: snapshotDate })}
          />
        }
        chips={chips}
        filterState={parsed.filters}
        route={ROUTE}
        notices={
          <div className="flex flex-col gap-4 empty:hidden">
            {/*
              TWO CAVEATS STAY VISIBLE, AND THE MECHANISM BEHIND THEM DOES NOT.

              `UX.1`'s rule is that a caveat is visible and a mechanism is disclosed.
              These two are caveats: a reader who takes the aged threshold for an
              industry standard, or the price estimate for a valuation, has misread
              every figure on the page. The full notes are in the disclosure below.

              They stay OUTSIDE the `UX.2D` control disclosure for the same reason: a
              caveat a reader has to open a panel to find is a caveat they will not read.
            */}
            <p className="text-sm text-ink-secondary">
              The aged threshold is an ARPI project default, not an industry benchmark,
              and it is a different number from the top age bucket. The market estimate is
              synthetic and is not a market valuation.
            </p>
            <StaleBanner stale={exportState.stale} />
            <ReconciliationBanner failed={failedReconciliation} />
            <FilterNotice resets={parsed.reset} resetHref={ROUTE} />
          </div>
        }
        filters={
          <div className="flex flex-col gap-4">
            <FilterBar
              action={ROUTE}
              support={INVENTORY_SUPPORT}
              filters={parsed.filters}
              periodOptions={periodOptions}
              stores={storeOptions}
              conditions={CONDITION_OPTIONS}
            />

            {/* Unit search and ordering, as a native GET form so the page works without
                JavaScript. Both land in the URL, so a filtered view is copyable and the
                browser's own history works. */}
            {/* Two controls across at every width rather than stacked below `sm`. Measured on
              a 390 px phone: the stacked form put the control band's bottom edge at 985 px,
              which is past the fold, and the first visual with it. */}
            <form
              action={ROUTE}
              method="get"
              className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3"
            >
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
                <span className="text-2xs text-ink-faint">{SEARCHABLE_FIELDS}</span>
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
                className="col-span-2 min-h-touch rounded border border-line bg-surface px-4 py-1.5 text-sm sm:col-span-1 sm:min-h-9"
              >
                Apply
              </button>
            </form>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Disclosure label="What the market estimate is, and what the aged threshold means">
            <div className="flex flex-col gap-3">
              <Text size="sm">{SYNTHETIC_ESTIMATE_NOTE}</Text>
              <Text size="sm">{AGED_THRESHOLD_NOTE}</Text>
              <Text size="sm">
                Price movement is derived from consecutive month-end snapshots of the same
                unit at the same store. It is an observed change in the advertised price
                and is not evidence of a manager decision, a pricing strategy or a
                repricing action; ARPI models none of those.
              </Text>
              <Text size="sm">
                Unit counts and investment are positions at the snapshot date. They add
                across units and stores on that date and never across dates.
              </Text>
            </div>
          </Disclosure>
        </div>
      </OperatingPageHeader>

      <Workspace>
        {/* ---------------------------------------------------------------- */}
        {/* ROW 1 — the position at this date                                 */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="summary"
            title="The lot at this date"
            zone="inventory"
            visual="kpi-rail"
            meta={
              snapshotDate === null
                ? 'No snapshot in this period'
                : formatIsoDate(snapshotDate)
            }
          >
            <InventoryRail summary={summary} snapshotLabel={snapshotLabel} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 2 — where the units are, and where the money is               */}
        {/* ---------------------------------------------------------------- */}
        {/*
          `UX.2B` §27 asks for the five governed age bands as a strong visual and §28 asks
          for capital beside them WHERE THE DATA SUPPORTS IT. It does: `summarizeInventory`
          publishes units and investment over the same five bands from the same rows at the
          same date, so the stack draws two tracks over one set of bands rather than
          deriving a capital split from an unrelated total. Eleven per cent of the units and
          twenty-six per cent of the money is the finding, and it is invisible unless the
          two distributions are read against each other.
        */}
        <GridRow>
          <Module
            id="age"
            title="Age, and the capital in it"
            span={5}
            zone="inventory"
            visual="age-stack"
          >
            <InventoryAgeStack
              title="Units and investment by age band"
              segments={summary.buckets.map((bucket) => ({
                key: bucket.bucket,
                label: bucket.bucket,
                display: formatCountExact(exactFromInteger(bucket.units)),
                share: bucket.share ?? 0,
                capitalDisplay: formatCurrencyExact(bucket.investment),
                capitalShare: bucket.investmentShare ?? 0,
              }))}
              snapshotNote={`A position at ${snapshotLabel}, never a total across dates.`}
              thresholdDays={summary.agedThresholdDays}
              headingLevel={4}
            />
          </Module>
          <Module
            id="map"
            title="Age against asking price"
            span={7}
            zone="inventory"
            visual="age-price-map"
          >
            <AgePriceMap units={selected} snapshotLabel={snapshotLabel} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 3 — what happened to the advertised prices                    */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="price-movement"
            title="Price movement"
            span={12}
            zone="inventory"
            visual="price-movement"
          >
            <PriceMovement summary={summary} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 4 — one unit, when one was asked for                          */}
        {/* ---------------------------------------------------------------- */}
        {requestedUnit === null ? null : (
          <GridRow>
            <Module
              id="unit"
              title={unit === null ? 'Unit not found' : unit.vehicleId}
              zone="inventory"
              meta={
                unit === null
                  ? undefined
                  : `${String(unit.modelYear)} ${unit.make} ${unit.modelName} ${unit.trimLevel} · ${unit.conditionType} · ${unit.dealershipId}`
              }
            >
              {unitNotFound ? (
                <p className="text-sm text-ink-muted">
                  Check the identifier, or clear the store and period filters — a unit
                  that sold before this snapshot date is not on the lot and has no row
                  here.{' '}
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
                      <Row
                        label="Snapshot date"
                        value={formatIsoDate(unit.snapshotDate)}
                      />
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
                        No accounting snapshot for this unit at this date. That is a
                        missing row, not a book value of zero.
                      </p>
                    ) : (
                      <dl className="flex flex-col gap-2 text-sm">
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
                    <p className="mt-3 text-xs text-ink-faint">
                      Floorplan principal is a liability carried alongside the unit. It is
                      not part of book value and is never netted against it; ARPI
                      publishes no net inventory position and models no floorplan
                      interest, curtailment or carrying cost.
                    </p>
                  </div>
                </div>
              )}
            </Module>
          </GridRow>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* ROW 5 — every unit, exactly                                       */}
        {/* ---------------------------------------------------------------- */}
        {/*
          THE TABLE STAYS A TABLE. `UX.2B` §32 and §60 both say so: charts answer summary,
          comparison, distribution and composition questions, and a table answers "which
          exact units". The row identity is a link into the detail module above, the money
          columns are right-aligned exact decimals, and no surrogate key is exposed.
        */}
        <GridRow>
          <Module
            id="units"
            title="Every unit on the lot"
            zone="inventory"
            meta={`${String(ordered.length)} unit${ordered.length === 1 ? '' : 's'} at this date`}
          >
            {ordered.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {snapshotDate === null
                  ? 'No snapshot date falls inside the selected period.'
                  : 'No units match this search and filter selection.'}
              </p>
            ) : (
              /*
               * IT IS A DISCLOSURE AND IT IS STILL IN THE DOCUMENT.
               *
               * Laid out inline this table was 9,550 px of the route's 11,828 px — the
               * densest domain in the project rendered as thirteen screens of cells, with
               * the shape of the lot above it and no way to see both. `<details>` collapses
               * it and changes nothing else: the rows stay in the markup, the print rule in
               * `globals.css` opens every disclosure on paper, and the summary states the
               * count so a reader knows what is behind it before opening it.
               *
               * This is the pattern every chart's data alternative on this console already
               * uses. The position map's exact values are these rows, and the map's summary
               * still points here; a reader following it now opens one disclosure.
               *
               * `TableDisclosure` supplies the horizontal scroll region, and as of this
               * increment supplies it focusable and named — which this table needs, because
               * `min-w` rose with the investment column `UX.2B` added. At 60rem the ten
               * columns squeezed the vehicle name until every row wrapped to two lines.
               *
               * THE TITLE IS LOWER-CASED INTO THE SUMMARY LINE, as every other caller's is,
               * so it has to read correctly that way — "31 December 2025" came out as "31
               * december 2025". The date is on the page header, in the rail and in this
               * table's own caption, so the summary states the count and leaves the date to
               * them.
               */
              <TableDisclosure
                title={`all ${String(ordered.length)} units at this snapshot date`}
              >
                <table className="w-full min-w-[72rem] border-collapse text-sm">
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
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Since prior
                      </th>
                      {/* `UX.2B`. The capital in the unit, so the table carries every
                        channel the age-and-price map draws — which is what lets that
                        figure point here for its exact values rather than printing the
                        same two hundred and fifty units a second time. */}
                      <th scope="col" className="py-2 text-right font-medium">
                        Investment
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((row) => (
                      <tr key={row.vehicleId} className="border-b border-line-subtle">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          <a className="underline" href={unitHref(row.vehicleId)}>
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
                        <td className="py-2 pr-4 text-right font-mono">
                          {row.askingPriceChange === null ? (
                            <span className="text-ink-faint">First appearance</span>
                          ) : (
                            formatCurrencyDifference(row.askingPriceChange, 2)
                          )}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatCurrencyExact(row.inventoryInvestment)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableDisclosure>
            )}
          </Module>
        </GridRow>
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
      <dd className="text-right font-mono text-ink">{value}</dd>
    </div>
  )
}
