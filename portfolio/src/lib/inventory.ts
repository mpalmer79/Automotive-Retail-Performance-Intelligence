/**
 * The typed accessor for the generated inventory artefacts.
 *
 * Every dealership fact and every inventory figure on the website comes through
 * this module, for the same reason every engineering count comes through
 * `lib/manifest.ts`: there is exactly one path from a sanitized workbook to a
 * pixel, and `tests/unit/inventory.test.ts` asserts no component authored a
 * number of its own instead.
 *
 * The three JSON files are written by `scripts/generate-inventory-data.ts` at
 * build time. No workbook is parsed in the browser, and no inventory value is
 * fetched at run time: the pages are statically prerendered, and the record set
 * ships as data inside the bundle that needs it.
 */
import dealershipsJson from '@/generated/dealerships.json'
import recordsJson from '@/generated/inventory-records.json'
import summaryJson from '@/generated/inventory-summary.json'
import type {
  Dealership,
  DealershipAccent,
  DealershipsFile,
  InventoryRecord,
  InventorySummary,
  VehicleCondition,
} from '@/types/inventory'

const dealershipsFile = dealershipsJson as unknown as DealershipsFile

export const inventorySummary = summaryJson as unknown as InventorySummary
export const inventoryRecords = recordsJson as unknown as readonly InventoryRecord[]
export const dealerships = dealershipsFile.dealerships
export const dealershipGroup = dealershipsFile.group

/** A store by its dealership id. Throws: an unknown id is a build-time error. */
export function dealershipById(id: string): Dealership {
  const found = dealerships.find((dealership) => dealership.id === id)
  if (!found) throw new Error(`No dealership with id "${id}".`)
  return found
}

/** A store by its route slug, or `undefined` so a route can return a 404. */
export function dealershipBySlug(slug: string): Dealership | undefined {
  return dealerships.find((dealership) => dealership.slug === slug)
}

/** Every listing belonging to one store, in generated order. */
export function recordsForDealership(id: string): readonly InventoryRecord[] {
  return inventoryRecords.filter((record) => record.dealershipId === id)
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The public label for a condition.
 *
 * The workbooks say "Used" because that is the word the source feed uses. The
 * site says "Pre-owned" throughout, including in the store's own name, so the
 * translation happens once, here, rather than in each component.
 */
export const CONDITION_LABEL: Record<VehicleCondition, string> = {
  new: 'New',
  'pre-owned': 'Pre-owned',
}

/**
 * The per-store visual identity.
 *
 * Three stores under one system, distinguished by hue rather than by branding.
 * NO MANUFACTURER LOGO, WORDMARK OR CORPORATE COLOUR APPEARS ANYWHERE ON THIS
 * SITE. Chevrolet and Subaru are real trademarks; a fictional dealer group is
 * not entitled to wear them, and a portfolio that dressed itself in them would
 * be making a claim about a relationship it does not have.
 *
 * The three hues are existing design tokens, and the trio is not a matter of
 * taste. It was checked with the palette validator against the white chart
 * surface and passes all five checks - lightness band, chroma floor, colour
 * vision deficiency separation (worst adjacent pair 16.8 deutan), normal-vision
 * separation and 3:1 contrast. The first trio tried, built from the link blue,
 * failed the chroma floor: at that saturation the blue reads as grey next to the
 * emerald.
 *
 *   chevrolet  accent-mark  teal    the group's own signal hue, for the volume store
 *   subaru     verified     emerald reads as the all-weather, outdoor positioning
 *   preowned   model        violet  the neutral, multi-brand marketplace
 *
 * `mark` and `series` are the DECORATIVE steps and are never used for text.
 * `chip` uses the text-safe step of the same family, which is why the chip's
 * foreground token is not the same as its mark.
 */
export interface AccentPresentation {
  /** Tailwind classes for the card's top rule and its identity mark. */
  readonly mark: string
  /** Tailwind classes for the identity chip. Text-safe foreground. */
  readonly chip: string
  /** The CSS colour used by the store's series in a chart. */
  readonly series: string
  /** A short, non-branded description of the identity. */
  readonly label: string
}

export const ACCENT_PRESENTATION: Record<DealershipAccent, AccentPresentation> = {
  chevrolet: {
    mark: 'bg-accent-mark',
    chip: 'border-accent-muted/45 bg-accent-wash text-accent',
    series: 'var(--color-accent-mark)',
    label: 'Franchise volume',
  },
  subaru: {
    mark: 'bg-verified',
    chip: 'border-verified/35 bg-verified-wash text-verified',
    series: 'var(--color-verified)',
    label: 'Franchise all-weather',
  },
  preowned: {
    mark: 'bg-model',
    chip: 'border-model/30 bg-model-wash text-model',
    series: 'var(--color-model)',
    label: 'Independent marketplace',
  },
}

/**
 * The two condition series, for the new-versus-pre-owned charts.
 *
 * Validated as a pair on the white surface: deutan separation 15.7, normal
 * separation 20.4, both hues above the chroma floor and above 3:1.
 */
export const CONDITION_SERIES: Record<VehicleCondition, string> = {
  new: 'var(--color-accent-mark)',
  'pre-owned': 'var(--color-model)',
}

/** The single hue every one-series chart uses. */
export const SINGLE_SERIES = 'var(--color-accent-mark)'

export function accentPresentation(accent: DealershipAccent): AccentPresentation {
  return ACCENT_PRESENTATION[accent]
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const NUMBER = new Intl.NumberFormat('en-US')

/**
 * Format an advertised price.
 *
 * `null` renders as the source's own words rather than as `$0` or as a dash. An
 * unpriced listing is a fact about what the public source exposed, and rounding
 * it to zero would put it in the cheapest price band on the histogram.
 */
export function formatPrice(value: number | null): string {
  return value === null ? 'Not exposed' : CURRENCY.format(value)
}

/** Format an odometer reading. `null` renders as the absence it is. */
export function formatMiles(value: number | null): string {
  return value === null ? 'Not exposed' : `${NUMBER.format(value)} mi`
}

/** Format an inclusive numeric range as a single string. */
export function formatRange(
  range: { readonly min: number; readonly max: number } | null,
  format: (value: number) => string
): string | null {
  if (range === null) return null
  if (range.min === range.max) return format(range.min)
  return `${format(range.min)} to ${format(range.max)}`
}

/** Format a model year. Plain digits, never grouped: 2,026 is not a year. */
export function formatModelYear(value: number): string {
  return String(value)
}

/**
 * The share of a whole, as a rounded percentage string.
 *
 * Used for inventory mix only. It describes what is in a sanitized listing
 * snapshot, which is a descriptive property of the reference data rather than a
 * measured business result, and every place it appears says so.
 */
export function formatShare(part: number, whole: number): string | null {
  if (whole === 0) return null
  return `${String(Math.round((part / whole) * 100))}%`
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a store's workbook says about its own completeness, in the site's words.
 *
 * Assembled from what the workbook states and nothing else. A workbook that
 * makes no coverage claim produces a sentence that says the claim is absent,
 * which is the honest rendering: the alternative is a confident default that the
 * source never asserted.
 */
export function coverageSentences(dealership: Dealership): string[] {
  const inventory = dealership.inventory
  const sentences: string[] = []

  sentences.push(
    `Source: ${inventory.sourceType.replace(/\.$/, '')}, captured ${inventory.snapshotDate}.`
  )

  if (inventory.coverageStatus !== null) {
    sentences.push(`Coverage as stated by the workbook: ${inventory.coverageStatus}.`)
  } else {
    sentences.push(
      'The workbook states no coverage classification, so this snapshot should be read ' +
        'as what the source exposed at capture time rather than as a complete lot list.'
    )
  }

  const unpriced = inventory.totalRecords - inventory.pricedRecords
  if (unpriced > 0) {
    sentences.push(
      `The source exposed an advertised price for ${String(inventory.pricedRecords)} of ` +
        `${String(inventory.totalRecords)} listings. The other ${String(unpriced)} carry a ` +
        'pricing status instead of a figure, and are excluded from every price statistic ' +
        'on this page.'
    )
  }

  return sentences
}
