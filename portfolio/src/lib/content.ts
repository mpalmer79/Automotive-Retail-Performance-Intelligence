/**
 * Typed accessors for the authored content files under `src/content/`.
 *
 * These files are extracted from the repository's governing documents
 * (KPI_CATALOG.md, DATA_DICTIONARY.md, the TMDL model source) and are
 * cross-checked against the evidence files by
 * `scripts/generate-project-manifest.ts` on every build. If a KPI here does not
 * exist in KPI_CATALOG.md, or maps to a measure the model does not define, the
 * build fails.
 *
 * Markdown is never parsed in the browser. These are JSON, resolved at build
 * time, tree-shaken per route.
 */
import dataModelJson from '@/content/data-model.json'
import inventoryOperationsJson from '@/content/inventory-operations.json'
import kpisJson from '@/content/kpis.json'
import type {
  DataModelContent,
  InventoryOperationsContent,
  KpiContent,
} from '@/types/content'

export const kpiContent = kpisJson as unknown as KpiContent
export const dataModelContent = dataModelJson as unknown as DataModelContent

/**
 * The Inventory Operations page's authored content (ADR-0011).
 *
 * The `$comment` key in the JSON is documentation for a reader of the file and is not
 * part of the typed shape, so the cast drops it.
 */
export const inventoryOperations =
  inventoryOperationsJson as unknown as InventoryOperationsContent

export const kpis = kpiContent.kpis
export const deferredKpis = kpiContent.deferred
export const entities = dataModelContent.entities
export const modelRelationships = dataModelContent.relationships

export const dimensions = entities.filter((entity) => entity.kind === 'dimension')
export const facts = entities.filter((entity) => entity.kind === 'fact')

/* -------------------------------------------------------------------------- */
/* Analytical domains                                                          */
/* -------------------------------------------------------------------------- */

export type DomainId =
  'sales' | 'gross' | 'inventory' | 'funnel' | 'marketing' | 'dataQuality'

export interface DomainDefinition {
  readonly id: DomainId
  readonly label: string
  /** The question a manager actually asks. Not a feature description. */
  readonly managementQuestion: string
  /** One sentence on what the domain measures and what it deliberately omits. */
  readonly summary: string
  /** The fact the domain's KPIs resolve against. */
  readonly primaryFact: string
  /** Reporting views that own the SQL side. */
  readonly reportingViews: readonly string[]
  /** Tailwind token suffix used for the domain's accent. */
  readonly tone: 'accent' | 'model' | 'pending' | 'verified'
}

/**
 * The six domains the site presents. Every KPI ID shown against a domain is
 * derived from `kpis.json` rather than listed here, so a domain cannot claim a
 * KPI the catalogue does not define.
 */
export const DOMAINS: readonly DomainDefinition[] = [
  {
    id: 'sales',
    label: 'Sales',
    managementQuestion:
      'How many cars did we deliver, and how did the new and used split move?',
    summary:
      'Retail volume, additive across store, day, employee, vehicle and lead source. Wholesale disposals and dealer trades are never counted as retail units.',
    primaryFact: 'warehouse.fact_vehicle_sale',
    reportingViews: ['reporting.vw_vehicle_sales', 'reporting.vw_sales_summary'],
    tone: 'accent',
  },
  {
    id: 'gross',
    label: 'Gross',
    managementQuestion:
      'Did total gross hold because both halves held, or because F&I covered a front-end collapse?',
    summary:
      'Front-end, back-end and total gross kept separate on purpose: combining them early destroys the diagnosis. Manufacturer incentives are excluded from the initial model, so new-vehicle profitability is incomplete by design.',
    primaryFact: 'warehouse.fact_vehicle_sale',
    reportingViews: ['reporting.vw_gross_summary'],
    tone: 'accent',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    managementQuestion:
      'Which units are becoming financially risky, and how fast is the lot turning?',
    summary:
      'Daily snapshots at vehicle-store-day grain, so age, investment and days supply are all answerable as of any date. Median age is the headline; the mean is retained because the gap between them is the diagnostic.',
    primaryFact: 'warehouse.fact_vehicle_inventory_snapshot',
    reportingViews: [
      'reporting.vw_inventory_health',
      'reporting.vw_inventory_aging',
      'reporting.vw_inventory_turn',
      'reporting.vw_days_supply',
      'reporting.vw_days_to_sale',
    ],
    tone: 'model',
  },
  {
    id: 'funnel',
    label: 'Lead funnel',
    managementQuestion:
      'Where are leads being lost, and how long do customers wait for a reply?',
    summary:
      'Four nested conversion rates plus response time, with duplicate leads excluded once and provably. Attribution is first-touch, which is a stated limitation rather than a modelling accident.',
    primaryFact: 'warehouse.fact_lead',
    reportingViews: [
      'reporting.vw_lead_funnel',
      'reporting.vw_appointment_funnel',
      'reporting.vw_lead_response',
    ],
    tone: 'accent',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    managementQuestion: 'Does this source generate business that pays for itself?',
    summary:
      'Cost per lead, cost per sale and gross return on advertising spend at store, campaign and month grain. Organic and internal sources carry no cost measure, and a reconciliation proves it.',
    primaryFact: 'warehouse.fact_marketing_spend',
    reportingViews: [
      'reporting.vw_marketing_performance',
      'reporting.vw_marketing_spend',
    ],
    tone: 'pending',
  },
  {
    id: 'dataQuality',
    label: 'Data quality',
    managementQuestion: 'Can I trust this number, and what would tell me if I could not?',
    summary:
      'Validation outcomes, reconciliation status and pipeline run history are first-class reportable data, not a log file. Every critical rule has been observed failing against a deliberately corrupted fixture.',
    primaryFact: 'audit.validation_result',
    reportingViews: [
      'reporting.vw_data_quality_summary',
      'reporting.vw_data_quality_trend',
      'reporting.vw_reconciliation_status',
      'reporting.vw_pipeline_run_summary',
    ],
    tone: 'verified',
  },
]

export function domain(id: DomainId): DomainDefinition {
  const found = DOMAINS.find((d) => d.id === id)
  if (!found) throw new Error(`Unknown analytical domain "${id}".`)
  return found
}

/** KPI identifiers belonging to a domain, in catalogue order. */
export function kpiIdsForDomain(id: DomainId): string[] {
  return kpis.filter((kpi) => kpi.domain === id).map((kpi) => kpi.id)
}

/** The KPI-bearing domains. Data quality is a supporting domain with no KPI IDs. */
export const KPI_DOMAINS = DOMAINS.filter((d) => kpiIdsForDomain(d.id).length > 0)
