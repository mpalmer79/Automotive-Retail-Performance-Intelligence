/**
 * The typed shape of the authored content under `src/content/`.
 *
 * Both files are extracted from the repository's governing documents and are
 * validated against the evidence files by
 * `scripts/generate-project-manifest.ts`. A KPI here that KPI_CATALOG.md does
 * not define, or an entity pointed at a reporting view the semantic model does
 * not import, fails the build.
 */

export type KpiDomain = 'sales' | 'gross' | 'inventory' | 'funnel' | 'marketing'

/** One governed KPI, as specified in KPI_CATALOG.md. */
export interface KpiEntry {
  /** Permanent identifier. Never reused, never renumbered. */
  readonly id: string
  readonly name: string
  readonly domain: KpiDomain
  /** The DAX measure's display name in the semantic model. */
  readonly measureName: string
  readonly purpose: string
  readonly definition: string
  readonly formula: string
  readonly numerator: string
  /** `n/a - additive measure` for additive KPIs, so the omission is visible. */
  readonly denominator: string
  readonly unit: string
  readonly grain: string
  readonly dateBasis: string
  readonly nullBehaviour: string
  /** The reporting view that owns the SQL side. */
  readonly sourceView: string
  /** What a reader must not conclude from this number. */
  readonly caution: string
  readonly status: 'implemented'
  readonly blocksGate1: boolean
  readonly dependsOn: readonly string[]
  readonly reconciliation: string
  /** Section number in KPI_CATALOG.md. */
  readonly docAnchor: string
}

/** A KPI in the target architecture but outside the current roadmap. */
export interface DeferredKpiEntry {
  readonly name: string
  readonly grain: string
  readonly dependsOn: readonly string[]
  readonly unlockStage: string
  readonly status: 'deferred'
}

export interface KpiContent {
  readonly source: string
  readonly sourceVersion: string
  readonly lastReviewed: string
  readonly kpis: readonly KpiEntry[]
  readonly deferred: readonly DeferredKpiEntry[]
}

export interface ForeignKeyReference {
  readonly column: string
  readonly references: string
}

/** One warehouse dimension or fact. */
export interface ModelEntity {
  readonly id: string
  readonly table: string
  readonly reportingView: string
  readonly label: string
  readonly kind: 'dimension' | 'fact'
  /** The declared grain. The most important field on this record. */
  readonly grain: string
  readonly primaryKey: string
  readonly foreignKeys: readonly ForeignKeyReference[]
  readonly historyPolicy: string
  /** A policy statement, never an example value. */
  readonly piiClassification: string
  readonly analyticalUse: string
  readonly kpiDomains: readonly string[]
  readonly rowCount: number | null
  readonly docPath: string
  readonly columnCount: number | null
}

/** One relationship in the semantic model, as defined in TMDL. */
export interface ModelRelationship {
  readonly from: string
  readonly fromColumn: string
  readonly to: string
  readonly toColumn: string
  readonly active: boolean
  readonly cardinality: string
}

export interface DataModelContent {
  readonly source: string
  readonly sourceVersion: string
  readonly lastReviewed: string
  readonly entities: readonly ModelEntity[]
  readonly relationships: readonly ModelRelationship[]
}

/* -------------------------------------------------------------------------- */
/* Inventory Operations (ADR-0011)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The authored content for `/inventory-operations`.
 *
 * Held apart from `KpiContent` and `DataModelContent` because its subject is the
 * one part of ARPI that is NOT fully synthetic, and because every count in it is
 * a count of a committed artifact rather than a figure derived from the
 * warehouse. `tests/unit/inventory-operations.test.ts` checks each of those
 * counts against `config/reference/inventory_listing_contract.yaml`.
 */
export interface InventoryArtifact {
  readonly fileName: string
  readonly path: string
  readonly dealershipId: string
  readonly storeName: string
  readonly capturedAt: string
  readonly classification: string
  readonly rows: number
  readonly newUnits: number
  readonly usedUnits: number
  readonly listedPriceUnits: number
  readonly callForPriceUnits: number
  /** Listings whose source published no price field at all. Not call-for-price. */
  readonly priceNotExposedUnits: number
  /** Listings that published no odometer reading. Not listings with zero miles. */
  readonly noOdometerUnits: number
  /**
   * `complete`, or `partial` when the capture is known not to hold every listing the
   * store published. A partial capture's row count is a count of WHAT WAS VISIBLE, and
   * the page has to say so: read as an inventory count it reports a shortfall that
   * exists only in the extraction.
   */
  readonly coverage: 'complete' | 'partial'
  /** Why the capture is partial. Present only when `coverage` is `partial`. */
  readonly coverageNote?: string
}

export interface SanitizationRemoval {
  readonly field: string
  readonly replacement: string
  readonly detail: string
}

export interface PipelineStep {
  readonly step: string
  readonly detail: string
  readonly artifact: string
}

export interface ListingView {
  readonly name: string
  readonly purpose: string
}

export interface InventoryStatusItem {
  readonly label: string
  /** A `StatusLevel` from `lib/status`, kept as a string union here to avoid a cycle. */
  readonly state:
    'complete' | 'in-progress' | 'pending-external' | 'blocked' | 'not-started'
  readonly detail: string
}

export interface InventoryOperationsContent {
  /** The lead artifact, used where the page needs one concrete example. */
  readonly artifact: InventoryArtifact
  /** Every committed artifact, one per store, in dealership order. */
  readonly artifacts: readonly InventoryArtifact[]
  readonly notice: string
  readonly problem: {
    readonly heading: string
    readonly questions: readonly string[]
    readonly why: string
  }
  readonly sanitization: { readonly removed: readonly SanitizationRemoval[] }
  readonly canProve: readonly string[]
  readonly cannotProve: readonly string[]
  readonly pipeline: readonly PipelineStep[]
  readonly grain: {
    readonly statement: string
    readonly naturalKey: string
    readonly enforcement: string
    readonly immutability: string
  }
  readonly views: readonly ListingView[]
  readonly report: {
    readonly command: string
    readonly output: string
    readonly sheets: readonly string[]
  }
  readonly multiStore: {
    readonly heading: string
    readonly points: readonly string[]
  }
  readonly status: readonly InventoryStatusItem[]
  readonly governance: {
    readonly adr: string
    readonly policy: string
    readonly contract: string
    readonly points: readonly string[]
  }
}
