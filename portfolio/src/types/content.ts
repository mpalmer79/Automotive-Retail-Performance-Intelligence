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
