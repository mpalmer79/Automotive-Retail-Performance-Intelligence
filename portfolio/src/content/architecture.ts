/**
 * The architecture graph: fourteen nodes, their dependencies, and the metadata
 * the explorer shows when one is selected.
 *
 * Authored here rather than extracted, because it is a narrative structure over
 * the repository rather than a table inside it. Every `sourcePaths` entry is
 * checked to exist by `tests/unit/architecture.test.ts`, and every `status` for a
 * node whose state is evidenced comes from the manifest at render time rather
 * than from this file - so the parts that can drift are the parts that are
 * generated.
 *
 * Node coordinates are hand-placed on a 1000x520 grid. Hand placement rather
 * than a force layout, because the layout IS information: left-to-right is
 * direction of travel, and vertical position groups by concern. A force-directed
 * graph would reshuffle that on every render and teach the reader nothing.
 */
import type { StatusLevel } from '@/types/manifest'

export type NodeLayer =
  'configuration' | 'generation' | 'validation' | 'database' | 'semantic' | 'presentation'

export interface ArchitectureNode {
  readonly id: string
  readonly label: string
  /** The short label drawn inside the node box. Two lines maximum. */
  readonly shortLabel: readonly string[]
  readonly layer: NodeLayer
  /** One sentence. What this component is. */
  readonly summary: string
  /** Two or three sentences. What it does and what it deliberately does not do. */
  readonly detail: string
  /** Who or what owns it - a language, a schema, an external service. */
  readonly ownership: string
  /**
   * The node's implementation state. `null` means "read it from the manifest",
   * which is how the semantic model and the two presentation nodes get their
   * status.
   */
  readonly status: StatusLevel | null
  readonly sourcePaths: readonly string[]
  readonly docPaths: readonly string[]
  /**
   * Whether synthetic data crosses into this node. Every node in this project
   * handles synthetic data only; the field exists so the explorer can state the
   * privacy boundary explicitly on each node rather than once in a footer.
   */
  readonly privacyBoundary: string
  /** Which database role, if any, can reach it. */
  readonly roleAccess: string
  /** Grid position. x 0-1000, y 0-520. */
  readonly x: number
  readonly y: number
}

export interface ArchitectureEdge {
  readonly from: string
  readonly to: string
  /** `built` for an implemented path, `planned` for one that does not run yet. */
  readonly kind: 'built' | 'planned'
}

export const ARCHITECTURE_NODES: readonly ArchitectureNode[] = [
  {
    id: 'config',
    label: 'Configuration profiles',
    shortLabel: ['config', 'profiles'],
    layer: 'configuration',
    summary:
      'Typed, validated configuration for the development, test and portfolio profiles.',
    detail:
      'pydantic-settings resolves a profile from YAML, then allows any key to be overridden from the environment with an ARPI_ prefix. The database password is never read from a configuration file - only from ARPI_DATABASE__PASSWORD or a PGPASSWORD fallback - so a committed profile cannot carry a credential even by accident.',
    ownership: 'Python, pydantic-settings',
    status: 'complete',
    sourcePaths: ['config/development.yaml', 'src/arpi/config.py'],
    docPaths: ['config/README.md'],
    privacyBoundary:
      'No data. Configuration only, and no secret value is ever stored here.',
    roleAccess: 'Not applicable - not a database object.',
    x: 40,
    y: 240,
  },
  {
    id: 'generators',
    label: 'Python generators',
    shortLabel: ['seeded', 'generators'],
    layer: 'generation',
    summary:
      'Fourteen generators that produce every source record from documented rules and one fixed seed.',
    detail:
      'Deterministic by construction: the same profile and seed reproduce byte-identical output. The generators model plausible dealership behaviour - seasonality, selling days, lead-source mix, inventory ageing - without making any relationship perfectly predictable, because a dataset where every correlation is exact teaches a reader nothing about analysis.',
    ownership: 'Python 3.11',
    status: 'complete',
    sourcePaths: ['src/arpi/generation/', 'src/arpi/utilities/seeding.py'],
    docPaths: ['DATA_GENERATION.md'],
    privacyBoundary:
      'Synthetic only. The generators are prohibited from producing names, street addresses, email addresses, phone numbers, full birth dates, government identifiers or bank information.',
    roleAccess: 'Not applicable - runs before any database connection.',
    x: 175,
    y: 240,
  },
  {
    id: 'validation',
    label: 'Validation framework',
    shortLabel: ['validation', 'framework'],
    layer: 'validation',
    summary:
      'In-memory data-quality checks that run before a single row is offered to the database.',
    detail:
      'Every check declares a severity, and a critical failure exits non-zero so the pipeline composes in a script and in CI. Running validation in memory rather than post-load is deliberate: a bad row that never reaches the warehouse cannot be reported from it.',
    ownership: 'Python',
    status: 'complete',
    sourcePaths: ['src/arpi/validation/checks.py', 'src/arpi/validation/registry.py'],
    docPaths: ['docs/architecture-decisions/ADR-0004-validation-category-taxonomy.md'],
    privacyBoundary:
      'A dedicated privacy check asserts that no prohibited attribute appears in any generated dataset.',
    roleAccess: 'Not applicable.',
    x: 175,
    y: 100,
  },
  {
    id: 'csv',
    label: 'CSV and generation manifest',
    shortLabel: ['CSV +', 'manifest'],
    layer: 'generation',
    summary:
      'Deterministic CSV output plus a manifest carrying a SHA-256 digest of each file.',
    detail:
      'The digest is what makes reproducibility checkable rather than claimed: a reviewer can confirm that the CSV they hold is the CSV the tests ran against. A small extract is committed under data/sample/ so the repository is inspectable without running anything.',
    ownership: 'Python, pandas',
    status: 'complete',
    sourcePaths: [
      'src/arpi/generation/writer.py',
      'data/sample/generation_manifest.json',
    ],
    docPaths: ['data/sample/README.md'],
    privacyBoundary:
      'The committed sample is synthetic and contains no prohibited attribute. Generated output under data/raw/ is gitignored.',
    roleAccess: 'Not applicable - filesystem.',
    x: 310,
    y: 240,
  },
  {
    id: 'raw',
    label: 'raw schema',
    shortLabel: ['raw'],
    layer: 'database',
    summary:
      'Source records exactly as imported, every column as text, with load lineage.',
    detail:
      'Nothing is cast, cleaned or rejected here. Keeping the raw layer literal is what makes a later disagreement about a value answerable by looking rather than arguable.',
    ownership: 'PostgreSQL 16',
    status: 'complete',
    sourcePaths: ['sql/01_raw/', 'src/arpi/ingestion/loader.py'],
    docPaths: ['DATA_DICTIONARY.md'],
    privacyBoundary: 'Synthetic only. Never receives data from a real source system.',
    roleAccess: 'arpi_loader writes. arpi_reporter provably cannot read it.',
    x: 445,
    y: 240,
  },
  {
    id: 'staging',
    label: 'staging schema',
    shortLabel: ['staging'],
    layer: 'database',
    summary: 'Typed, deduplicated views over raw exposing the most recent load batch.',
    detail:
      'A reconciliation proves the arithmetic per entity: raw rows equal accepted plus rejected plus deduplicated, stated as an addition so that a lost row and an extra duplicate cannot cancel each other out.',
    ownership: 'PostgreSQL 16',
    status: 'complete',
    sourcePaths: ['sql/02_staging/', 'src/arpi/ingestion/rejection.py'],
    docPaths: ['docs/source-to-target/'],
    privacyBoundary:
      'Synthetic only. Standardises what the raw schema received and introduces no attribute of its own.',
    roleAccess: 'arpi_loader reads and writes. arpi_reporter provably cannot read it.',
    x: 555,
    y: 240,
  },
  {
    id: 'warehouse',
    label: 'warehouse schema',
    shortLabel: ['warehouse'],
    layer: 'database',
    summary:
      'Conformed dimensions and facts, each fact at one explicitly declared grain.',
    detail:
      'The grain is enforced by a UNIQUE constraint in DDL and asserted by the integration suite, so it is a property of the database rather than a promise in a document. Dimension history policy is fixed by ADR-0006 per dimension rather than applied uniformly.',
    ownership: 'PostgreSQL 16',
    status: 'complete',
    sourcePaths: ['sql/03_dimensions/', 'sql/04_facts/'],
    docPaths: ['DATA_DICTIONARY.md', 'docs/diagrams/03-initial-dimensional-model.md'],
    privacyBoundary:
      'Synthetic only. No customer-level attribute beyond an age band and a market area exists in the model at all.',
    roleAccess: 'arpi_loader writes. arpi_reporter provably cannot read it.',
    x: 665,
    y: 240,
  },
  {
    id: 'reporting',
    label: 'reporting schema',
    shortLabel: ['reporting'],
    layer: 'database',
    summary:
      'Documented, stable views - the only surface a semantic model or a workbook may read.',
    detail:
      'Eight dimension views, five grain-preserving fact views, and the governed analytical views that own the SQL side of every KPI. Every KPI computed here is tested against an independent derivation from the warehouse, and every ratio is asserted to return NULL rather than zero or infinity on an empty denominator.',
    ownership: 'PostgreSQL 16',
    status: 'complete',
    sourcePaths: ['sql/05_reporting/', 'tests/integration/test_kpi_verification.py'],
    docPaths: [
      'KPI_CATALOG.md',
      'powerbi/model_documentation/04-reporting-view-to-kpi-map.md',
    ],
    privacyBoundary:
      'Synthetic only. The reporting layer exposes no column the privacy policy prohibits, and the model checker fails the build if a PII-bearing column appears.',
    roleAccess: 'arpi_reporter reads. This is the only schema it can reach.',
    x: 775,
    y: 240,
  },
  {
    id: 'audit',
    label: 'audit schema',
    shortLabel: ['audit'],
    layer: 'database',
    summary:
      'Pipeline runs, row counts, validation results, reconciliations and rejected records.',
    detail:
      'Data quality is reportable data in this project, not a log file. Every run records its outcome here, which is what makes the data-quality domain answerable from the same governed layer as sales and gross.',
    ownership: 'PostgreSQL 16',
    status: 'complete',
    sourcePaths: ['sql/00_database/03_audit_tables.sql', 'src/arpi/audit/run.py'],
    docPaths: ['DATA_DICTIONARY.md'],
    privacyBoundary:
      'Operational metadata about synthetic runs. No record-level personal data.',
    roleAccess:
      'arpi_loader writes. arpi_reporter reads it only through reporting views.',
    x: 665,
    y: 400,
  },
  {
    id: 'semantic-model',
    label: 'TMDL semantic model',
    shortLabel: ['semantic', 'model'],
    layer: 'semantic',
    summary:
      'A Power BI Project stored as TMDL: text, diffable, reviewable without a licence.',
    detail:
      'Import mode over the reporting schema and no other schema, with vw_calendar marked as the date table. Validated statically on every push - the TMDL is parsed and asserted against the model documentation - which proves shape and cannot prove arithmetic. No Microsoft semantic-model engine has loaded it.',
    ownership: 'Power BI, TMDL and DAX',
    status: null,
    sourcePaths: [
      'powerbi/ARPI_Performance_Intelligence/',
      'scripts/check_powerbi_model.py',
    ],
    docPaths: [
      'powerbi/model_documentation/',
      'docs/architecture-decisions/ADR-0007-power-bi-project-format.md',
    ],
    privacyBoundary:
      'Reads the reporting schema only. The model checker fails the build if the model references any other schema or any PII-bearing column.',
    roleAccess: 'Connects as arpi_reporter, which can reach reporting and nothing else.',
    x: 885,
    y: 240,
  },
  {
    id: 'desktop-validation',
    label: 'Power BI Desktop validation',
    shortLabel: ['Desktop', 'validation'],
    layer: 'semantic',
    summary:
      'ADR-0008 path one: a person on Windows opens the project, refreshes and evaluates the DAX.',
    detail:
      'Requires Windows and Power BI Desktop, neither of which the project owner has. It is an accepted path of equal standing to the Fabric route, not a lesser one, and either path completed in full closes the gate.',
    ownership: 'Power BI Desktop, on Windows',
    status: null,
    sourcePaths: [
      'powerbi/validation/desktop_validation_results.json',
      'scripts/validate_powerbi_model.ps1',
    ],
    docPaths: ['docs/powerbi/POWER_BI_DESKTOP_HANDOFF.md'],
    privacyBoundary: 'Reads a local PostgreSQL reporting schema holding synthetic data.',
    roleAccess: 'arpi_reporter.',
    x: 885,
    y: 70,
  },
  {
    id: 'fabric-validation',
    label: 'Microsoft Fabric validation',
    shortLabel: ['Fabric', 'validation'],
    layer: 'semantic',
    summary:
      'ADR-0008 path two: the committed TMDL is deployed to a Fabric workspace and queried through REST.',
    detail:
      'Needs a Fabric tenant, a workspace and a cloud PostgreSQL database holding the reporting schema. The automation and the contract are written; the workspace and the database are not provisioned. Continuous integration must never attempt either path - it has no engine and could only assert something it cannot observe.',
    ownership: 'Microsoft Fabric, Power BI REST APIs',
    status: null,
    sourcePaths: [
      'powerbi/validation/fabric_validation_results.json',
      'scripts/validate_powerbi_fabric.py',
      'scripts/deploy_powerbi_fabric.py',
    ],
    docPaths: [
      'docs/powerbi/FABRIC_SERVICE_HANDOFF.md',
      'docs/architecture-decisions/ADR-0008-real-engine-validation-paths.md',
    ],
    privacyBoundary:
      'Would read a cloud PostgreSQL reporting schema holding synthetic data. No credential is committed; the deployment tooling reads them from the environment.',
    roleAccess: 'arpi_reporter, against a managed cloud database.',
    x: 885,
    y: 410,
  },
  {
    id: 'report-pages',
    label: 'Report pages',
    shortLabel: ['report', 'pages'],
    layer: 'presentation',
    summary: 'The seven unblocked MVP report pages. None exists.',
    detail:
      'The PBIR project is a shell: a .platform file and a definition.pbir pointing at the semantic model, with no page, no visual and no bookmark. The static model check fails the build if report visual content appears before this increment formally starts.',
    ownership: 'Power BI report layer',
    status: null,
    sourcePaths: [
      'powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.Report/',
    ],
    docPaths: ['docs/requirements/PHASE_2_BACKLOG.md'],
    privacyBoundary: 'Would read the semantic model only, which reads reporting only.',
    roleAccess: 'Inherits the semantic model connection.',
    x: 1015,
    y: 170,
  },
  {
    id: 'case-study',
    label: 'Public case study',
    shortLabel: ['case', 'study'],
    layer: 'presentation',
    summary:
      'The public analytical write-up. Held closed by Gate 2, and this site ships a locked shell for it.',
    detail:
      'Gate 2 requires complete report pages, reconciled SQL and Power BI totals, and drafted executive findings. None of the three is met. ADR-0009 records why the portfolio website foundation was permitted to ship while the analytical case study stayed gated.',
    ownership: 'This website',
    status: null,
    sourcePaths: ['portfolio/src/app/case-study/page.tsx'],
    docPaths: [
      'docs/architecture-decisions/ADR-0009-portfolio-ui-foundation-before-gate-2.md',
      'docs/requirements/PHASE_2_BACKLOG.md',
    ],
    privacyBoundary:
      'Static content. No database connection, no query interface and no embedded live report.',
    roleAccess: 'None. It reads nothing at run time.',
    x: 1015,
    y: 310,
  },
]

export const ARCHITECTURE_EDGES: readonly ArchitectureEdge[] = [
  { from: 'config', to: 'generators', kind: 'built' },
  { from: 'generators', to: 'validation', kind: 'built' },
  { from: 'validation', to: 'csv', kind: 'built' },
  { from: 'generators', to: 'csv', kind: 'built' },
  { from: 'csv', to: 'raw', kind: 'built' },
  { from: 'raw', to: 'staging', kind: 'built' },
  { from: 'staging', to: 'warehouse', kind: 'built' },
  { from: 'warehouse', to: 'reporting', kind: 'built' },
  { from: 'warehouse', to: 'audit', kind: 'built' },
  { from: 'validation', to: 'audit', kind: 'built' },
  { from: 'audit', to: 'reporting', kind: 'built' },
  { from: 'reporting', to: 'semantic-model', kind: 'built' },
  { from: 'semantic-model', to: 'desktop-validation', kind: 'planned' },
  { from: 'semantic-model', to: 'fabric-validation', kind: 'planned' },
  { from: 'semantic-model', to: 'report-pages', kind: 'planned' },
  { from: 'report-pages', to: 'case-study', kind: 'planned' },
]

/**
 * How many hops each node is from `id`, in each direction.
 *
 * `upstreamOf` and `downstreamOf` answer "is this node on the path", which is
 * what the highlighting needs. The explorer's motion needs the stronger answer -
 * HOW FAR along the path - because that is what turns sixteen edges lighting up
 * at once into a flow with a direction: the upstream edges resolve inward from
 * the farthest one, and the downstream edges leave outward from the nearest.
 *
 * Breadth-first rather than the depth-first walk the two set helpers use,
 * because a depth-first walk records the distance of the route it happened to
 * take rather than the shortest one, and the diagram has more than one route
 * between some pairs of nodes: `validation` reaches `reporting` both through
 * `csv` and through `audit`.
 *
 * `id` itself is at distance 0 in both maps.
 */
export function flowDistances(id: string): {
  readonly upstream: ReadonlyMap<string, number>
  readonly downstream: ReadonlyMap<string, number>
} {
  const walk = (direction: 'up' | 'down'): Map<string, number> => {
    const distance = new Map<string, number>([[id, 0]])
    let frontier = [id]
    let depth = 0
    while (frontier.length > 0) {
      depth += 1
      const next: string[] = []
      for (const current of frontier) {
        for (const edge of ARCHITECTURE_EDGES) {
          const neighbour =
            direction === 'up'
              ? edge.to === current
                ? edge.from
                : null
              : edge.from === current
                ? edge.to
                : null
          if (neighbour === null || distance.has(neighbour)) continue
          distance.set(neighbour, depth)
          next.push(neighbour)
        }
      }
      frontier = next
    }
    return distance
  }

  return { upstream: walk('up'), downstream: walk('down') }
}

export const LAYER_LABEL: Record<NodeLayer, string> = {
  configuration: 'Configuration',
  generation: 'Generation',
  validation: 'Validation',
  database: 'PostgreSQL',
  semantic: 'Semantic model',
  presentation: 'Presentation',
}

/** Every node reachable upstream of `id`, transitively. */
export function upstreamOf(id: string): Set<string> {
  const found = new Set<string>()
  const walk = (current: string) => {
    for (const edge of ARCHITECTURE_EDGES) {
      if (edge.to !== current || found.has(edge.from)) continue
      found.add(edge.from)
      walk(edge.from)
    }
  }
  walk(id)
  return found
}

/** Every node reachable downstream of `id`, transitively. */
export function downstreamOf(id: string): Set<string> {
  const found = new Set<string>()
  const walk = (current: string) => {
    for (const edge of ARCHITECTURE_EDGES) {
      if (edge.from !== current || found.has(edge.to)) continue
      found.add(edge.to)
      walk(edge.to)
    }
  }
  walk(id)
  return found
}

export function architectureNode(id: string): ArchitectureNode {
  const node = ARCHITECTURE_NODES.find((n) => n.id === id)
  if (!node) throw new Error(`Unknown architecture node "${id}".`)
  return node
}
