/**
 * The shape of the three generated inventory artefacts.
 *
 * Written by `portfolio/scripts/generate-inventory-data.ts` from the sanitized
 * workbooks under `data/reference/inventory/` and from the dealership registry in
 * `data/sample/dim_dealership.csv`. Nothing in `src/` may author a value that
 * belongs to one of these types: every count, range and median on the dealership
 * and inventory pages is derived, and `tests/unit/inventory.test.ts` asserts it.
 *
 * A field is nullable here exactly where the source data is allowed to be
 * missing. `medianPrice: number | null` is not defensive typing - the
 * independent store's public source exposed a price for fewer than a tenth of its
 * listings, and a median over the rest would be an invented number.
 */

/** The two conditions the sanitized workbooks distinguish. */
export type VehicleCondition = 'new' | 'pre-owned'

/** The visual identity a store carries inside the group's design system. */
export type DealershipAccent = 'chevrolet' | 'subaru' | 'preowned'

/* -------------------------------------------------------------------------- */
/* inventory-records.json                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One vehicle listing, sanitized for the browser.
 *
 * Everything that could identify a real dealership or a real vehicle is dropped
 * by the generator rather than nulled here: there is no VIN field, no source URL
 * field, no source feed field and no store-name field on this type, so there is
 * no place for one to be reintroduced.
 */
export interface InventoryRecord {
  /** The sanitized, synthetic stock identifier carried by the source workbook. */
  readonly stockReference: string
  readonly dealershipId: string
  readonly condition: VehicleCondition
  readonly modelYear: number
  readonly make: string
  readonly model: string
  /** Absent where the source workbook exposed no trim. */
  readonly trim: string | null
  /** Odometer miles. Null where the public source exposed none. */
  readonly mileage: number | null
  /** Advertised price in whole dollars. Null where the source exposed none. */
  readonly price: number | null
  /** The source's own pricing status, verbatim. Never reinterpreted. */
  readonly pricingStatus: string
  readonly snapshotDate: string
}

/* -------------------------------------------------------------------------- */
/* dealerships.json                                                            */
/* -------------------------------------------------------------------------- */

export interface NumericRange {
  readonly min: number
  readonly max: number
}

export interface MakeCount {
  readonly make: string
  readonly count: number
}

export interface ModelCount {
  readonly make: string
  readonly model: string
  readonly count: number
}

/**
 * What a single workbook says about a single store at a single snapshot date.
 *
 * `coverageStatus` is the workbook's own words where it states them and `null`
 * where it does not. The page renders the absence as an absence rather than
 * filling it with a confident-sounding default.
 */
export interface DealershipInventoryProfile {
  readonly snapshotDate: string
  /** Repository path of the workbook this profile was derived from. */
  readonly sourceWorkbook: string
  /** The workbook's `Source type` line, verbatim. */
  readonly sourceType: string
  /** The workbook's `Coverage status` line, where it states one. */
  readonly coverageStatus: string | null
  /** The workbook's coverage limitation paragraph, where it states one. */
  readonly coverageNote: string | null

  readonly totalRecords: number
  readonly newRecords: number
  readonly preOwnedRecords: number
  /** Records for which the source exposed an advertised price. */
  readonly pricedRecords: number
  /** Records for which the source exposed an odometer reading. */
  readonly mileageRecords: number

  readonly priceRange: NumericRange | null
  readonly medianPrice: number | null
  readonly preOwnedMileageRange: NumericRange | null
  readonly medianPreOwnedMileage: number | null
  readonly modelYearRange: NumericRange | null

  readonly makeCount: number
  readonly modelCount: number
  readonly topMakes: readonly MakeCount[]
  readonly topModels: readonly ModelCount[]
}

/** A store's identity, its authored positioning, and its derived inventory. */
export interface Dealership {
  readonly id: string
  readonly slug: string
  readonly href: string
  readonly name: string
  readonly shortName: string
  /** The warehouse's own `store_type` value, unchanged. */
  readonly storeType: string
  /** The public rendering of that value. */
  readonly storeTypeLabel: string
  readonly isFranchise: boolean
  readonly franchiseBrand: string | null
  readonly city: string
  readonly stateCode: string
  readonly marketRegion: string
  readonly openedDate: string

  readonly accent: DealershipAccent
  readonly tagline: string
  readonly positioning: string
  readonly inventoryStrategy: string
  readonly customerSegment: string
  readonly analyticsFocus: string

  readonly inventory: DealershipInventoryProfile
}

export interface DealershipGroup {
  readonly name: string
  readonly introduction: string
  readonly operatingModel: string
  readonly governanceNote: string
  readonly marketRegion: string
  readonly dealershipCount: number
}

export interface DealershipsFile {
  readonly generatedFrom: readonly string[]
  readonly group: DealershipGroup
  readonly dealerships: readonly Dealership[]
}

/* -------------------------------------------------------------------------- */
/* inventory-summary.json                                                      */
/* -------------------------------------------------------------------------- */

export interface DealershipTotals {
  readonly dealershipId: string
  readonly name: string
  readonly shortName: string
  readonly slug: string
  readonly accent: DealershipAccent
  readonly total: number
  readonly newRecords: number
  readonly preOwnedRecords: number
}

export interface ConditionTotals {
  readonly condition: VehicleCondition
  readonly label: string
  readonly count: number
}

export interface ModelYearCount {
  readonly modelYear: number
  readonly count: number
}

export interface PriceBand {
  readonly label: string
  readonly min: number
  /** Exclusive upper bound. `null` on the open-ended top band. */
  readonly max: number | null
  readonly count: number
}

export interface InventoryFacets {
  readonly dealershipIds: readonly string[]
  readonly conditions: readonly VehicleCondition[]
  readonly makes: readonly string[]
  readonly models: readonly ModelCount[]
  readonly modelYears: readonly number[]
  readonly priceBounds: NumericRange | null
  readonly mileageBounds: NumericRange | null
}

export interface InventorySummary {
  readonly generatedFrom: readonly string[]
  readonly latestSnapshotDate: string
  readonly snapshotDates: readonly string[]

  readonly totalRecords: number
  readonly newRecords: number
  readonly preOwnedRecords: number
  readonly pricedRecords: number
  readonly mileageRecords: number
  readonly dealershipCount: number
  readonly makeCount: number
  readonly modelCount: number

  readonly medianPrice: number | null
  readonly medianPreOwnedMileage: number | null
  readonly priceRange: NumericRange | null
  readonly modelYearRange: NumericRange | null

  readonly byDealership: readonly DealershipTotals[]
  readonly byCondition: readonly ConditionTotals[]
  readonly byMake: readonly MakeCount[]
  readonly byModelYear: readonly ModelYearCount[]
  readonly priceBands: readonly PriceBand[]

  readonly facets: InventoryFacets
}
