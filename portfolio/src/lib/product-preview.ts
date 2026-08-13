/**
 * Compact, serialisable previews of the inventory lane, for the store chapter.
 *
 * WHY THIS MODULE EXISTS AT ALL
 * -----------------------------
 * The store chapter on `/technical?view=overview` is a working tab set over real
 * sanitized listings. It is a client island, because it holds selection state.
 *
 * It had a second consumer: the retired home page's hero, a store switcher over
 * the same data, whose `inventoryPreviews` export included a fourth "all three
 * stores" state that no surviving surface asks for. `ADR-0015` retired the hero
 * and the tour's console frame replaced it; the export outlived both, and is gone
 * with them. What is left is what the store chapter reads.
 *
 * A client island that imported `lib/inventory` directly would pull the entire
 * 541-record set into that route's JavaScript bundle. That set already ships on
 * `/inventory`, where a visitor is filtering all of it and the weight buys
 * something; here it would buy four visible rows per panel. So the derivation
 * happens HERE, on the server, and the island receives a payload of roughly two
 * dozen rows as props.
 *
 * EVERY VALUE IS DERIVED, AND EVERY STRING IS FORMATTED ONCE
 * ---------------------------------------------------------
 * Nothing in this module authors a number. Counts, ranges, medians and shares
 * all come from `src/generated/`, which the build writes from the sanitized
 * workbooks, and `tests/unit/inventory.test.ts` asserts no component in `src/`
 * writes one of its own. Values are formatted here rather than in the island so
 * that the currency and number formatters stay on the server too.
 *
 * A NULL IS RENDERED AS AN ABSENCE
 * --------------------------------
 * `formatPrice(null)` is "Not exposed", not "$0" and not a dash. The independent
 * store's public source priced fewer than a tenth of its listings, and a preview
 * that quietly dropped the unpriced ones would describe a different population
 * from the one the page claims to be showing.
 */
import {
  CONDITION_LABEL,
  dealerships,
  formatMiles,
  formatPrice,
  formatShare,
  inventoryRecords,
} from './inventory'
import { ROUTES } from './site'
import { formatCount } from './utils'
import type { DealershipAccent, InventoryRecord } from '@/types/inventory'

/** How many listings a preview panel shows. Four fills the frame at every width. */
const PREVIEW_ROWS = 4

/** One listing, with every field already a string the panel can print. */
export interface PreviewRow {
  readonly key: string
  readonly vehicle: string
  readonly store: string
  readonly condition: string
  readonly price: string
  readonly mileage: string
}

/** One labelled figure in a preview's figure strip. */
export interface PreviewFigure {
  readonly label: string
  readonly value: string
}

/** One selectable state of an inventory preview: the group, or one store. */
export interface InventoryPreview {
  /** `group`, or the store's dealership id. */
  readonly id: string
  /** The control's label. Short enough for a segmented control at 375px. */
  readonly tab: string
  /** The panel's own heading. */
  readonly title: string
  /** Where the explorer opens with this selection already applied. */
  readonly href: string
  readonly accent: DealershipAccent | null
  readonly figures: readonly PreviewFigure[]
  readonly rows: readonly PreviewRow[]
  /**
   * One sentence about the structure of this selection, assembled from derived
   * figures. Never an assessment of performance: a listing snapshot cannot
   * support one.
   */
  readonly observation: string
}

/** The store's own positioning copy, plus everything the preview needs. */
export interface StoreStoryPanel extends InventoryPreview {
  readonly dealershipId: string
  readonly name: string
  readonly shortName: string
  readonly location: string
  readonly storeTypeLabel: string
  readonly isFranchise: boolean
  readonly franchiseBrand: string | null
  readonly tagline: string
  readonly positioning: string
  readonly analyticsFocus: string
  readonly accent: DealershipAccent
  /** The store's own page. */
  readonly storeHref: string
}

/* -------------------------------------------------------------------------- */
/* Row selection                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Order a record set for display, deterministically.
 *
 * Newest model year first, then the higher advertised price, then the stock
 * reference. The third key is what makes it deterministic rather than merely
 * stable: two 2026 listings at the same price would otherwise depend on the
 * generator's output order, and the preview would change on a re-run that
 * changed nothing.
 *
 * An unpriced listing sorts after a priced one at the same model year, for the
 * same reason `/inventory` sorts it last: the source did not expose a price, and
 * treating that as zero would rank it as the cheapest vehicle on the lot.
 */
function forDisplay(records: readonly InventoryRecord[]): InventoryRecord[] {
  return [...records].sort((a, b) => {
    if (a.modelYear !== b.modelYear) return b.modelYear - a.modelYear
    if (a.price !== b.price) {
      if (a.price === null) return 1
      if (b.price === null) return -1
      return b.price - a.price
    }
    return a.stockReference.localeCompare(b.stockReference)
  })
}

function toRow(record: InventoryRecord, store: string): PreviewRow {
  const trim = record.trim === null ? '' : ` ${record.trim}`
  return {
    key: record.stockReference,
    vehicle: `${String(record.modelYear)} ${record.make} ${record.model}${trim}`,
    store,
    condition: CONDITION_LABEL[record.condition],
    price: formatPrice(record.price),
    mileage: formatMiles(record.mileage),
  }
}

/* -------------------------------------------------------------------------- */
/* Observations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The structural sentence under a preview.
 *
 * Assembled from derived figures and nothing else. It describes the SHAPE of a
 * listing snapshot - how much of it is new, how many makes it spans, how wide
 * its model years run - which is a property of the reference data. It never says
 * a store is performing well, turning inventory, or holding gross, because a
 * listing snapshot cannot support any of those and inventing one is the failure
 * this whole project is an argument against.
 */
function observationFor(
  total: number,
  newRecords: number,
  makeCount: number,
  years: { readonly min: number; readonly max: number } | null
): string {
  const share = formatShare(newRecords, total)
  const condition =
    newRecords === 0
      ? 'Every listing in this snapshot is pre-owned'
      : newRecords === total
        ? 'Every listing in this snapshot is new'
        : `${share ?? '0%'} of this snapshot is new inventory`

  const spread =
    years === null
      ? 'the source exposed no model year'
      : years.min === years.max
        ? `a single model year, ${String(years.min)}`
        : `model years ${String(years.min)} to ${String(years.max)}`

  const makes = `${formatCount(makeCount)} ${makeCount === 1 ? 'make' : 'makes'}`

  return `${condition}, across ${makes} and ${spread}.`
}

/* -------------------------------------------------------------------------- */
/* The previews                                                                */
/* -------------------------------------------------------------------------- */

function figuresForStore(dealershipId: string): readonly PreviewFigure[] {
  const store = dealerships.find((entry) => entry.id === dealershipId)
  if (!store) return []
  const inventory = store.inventory
  return [
    { label: 'Listings', value: formatCount(inventory.totalRecords) },
    { label: 'New', value: formatCount(inventory.newRecords) },
    { label: 'Pre-owned', value: formatCount(inventory.preOwnedRecords) },
    { label: 'Makes', value: formatCount(inventory.makeCount) },
    { label: 'Median advertised', value: formatPrice(inventory.medianPrice) },
  ]
}

function storePreview(dealershipId: string): InventoryPreview | null {
  const store = dealerships.find((entry) => entry.id === dealershipId)
  if (!store) return null
  const inventory = store.inventory
  const rows = forDisplay(
    inventoryRecords.filter((record) => record.dealershipId === dealershipId)
  )
    .slice(0, PREVIEW_ROWS)
    .map((record) => toRow(record, store.shortName))

  return {
    id: store.id,
    tab: store.shortName,
    title: store.name,
    href: `${ROUTES.inventory.href}?dealership=${store.id}`,
    accent: store.accent,
    figures: figuresForStore(store.id),
    rows,
    observation: observationFor(
      inventory.totalRecords,
      inventory.newRecords,
      inventory.makeCount,
      inventory.modelYearRange
    ),
  }
}

/** The store chapter's panels: the same previews, plus each store's copy. */
export const storeStoryPanels: readonly StoreStoryPanel[] = dealerships
  .map((store): StoreStoryPanel | null => {
    const preview = storePreview(store.id)
    if (preview === null) return null
    return {
      ...preview,
      accent: store.accent,
      dealershipId: store.id,
      name: store.name,
      shortName: store.shortName,
      location: `${store.city}, ${store.stateCode}`,
      storeTypeLabel: store.storeTypeLabel,
      isFranchise: store.isFranchise,
      franchiseBrand: store.franchiseBrand,
      tagline: store.tagline,
      positioning: store.positioning,
      analyticsFocus: store.analyticsFocus,
      storeHref: store.href,
    }
  })
  .filter((panel): panel is StoreStoryPanel => panel !== null)
