/**
 * The technical destination's view registry.
 *
 * ONE ROUTE, EIGHT SERVER-ADDRESSABLE VIEWS
 * -----------------------------------------
 * `UX.1` consolidated six separate documentation routes into `/technical`,
 * addressed by a `view` query parameter. The consolidation is an information
 * architecture decision recorded in ADR-0015, and the short form of it is that a
 * dealership manager was being offered Architecture, Data Model, KPIs, Governance
 * and Status as five top-level choices with equal weight to the operating console
 * — a table of contents presented as an application menu.
 *
 * WHY A QUERY PARAMETER AND NOT A PATH SEGMENT
 * --------------------------------------------
 * Both are server-addressable and both are shareable, so the deciding factor is
 * what a URL means. `/technical/architecture` says the architecture explorer is a
 * document in its own right, which is what the site said before and what this
 * increment is undoing. `?view=architecture` says there is one technical
 * destination being read at one of its states, which is what the navigation now
 * shows. The one canonical document is `/technical`; every view carries a
 * canonical link to its own state so a shared link resolves to what was shared.
 *
 * WHY THERE IS NO CLIENT TAB SET
 * ------------------------------
 * The views are plain links and the page is rendered on the server. With
 * JavaScript disabled the technical destination is fully navigable, which the
 * previous six routes also were and which a `role="tablist"` island would have
 * taken away in exchange for nothing.
 *
 * THE `legacyRoute` FIELD IS LOAD-BEARING
 * ---------------------------------------
 * It is the machine-readable record of which retired URL a view answers for.
 * `next.config.ts` declares the redirect, `tests/e2e/navigation.spec.ts` asserts
 * every legacy route still resolves, and `sitemap.ts` uses it to make sure the
 * retired URLs are absent from the sitemap. Three places that would otherwise
 * drift from each other read the same list.
 */

export const TECHNICAL_VIEWS = [
  'overview',
  'architecture',
  'data-model',
  'kpis',
  'governance',
  'data-sources',
  'status',
  'product-vision',
] as const

export type TechnicalView = (typeof TECHNICAL_VIEWS)[number]

/** The view a bare `/technical` renders. */
export const DEFAULT_TECHNICAL_VIEW: TechnicalView = 'overview'

export interface TechnicalViewDefinition {
  readonly view: TechnicalView
  /** The label in the technical navigation. */
  readonly label: string
  /** The `h1` for this state of the destination. */
  readonly title: string
  /** One or two sentences under the heading. */
  readonly lede: string
  /** A second paragraph, where the lede alone would overrun a sensible length. */
  readonly supporting?: string
  /**
   * The retired route this view answers for, if any.
   *
   * `null` for the two views that never had a route of their own: the overview,
   * which is the rehomed product tour and group context from the old marketing
   * home page, and the product vision, which `UX.1` wrote.
   */
  readonly legacyRoute: string | null
}

export const TECHNICAL_VIEW_DEFINITIONS: readonly TechnicalViewDefinition[] = [
  {
    view: 'overview',
    label: 'Overview',
    title: 'How ARPI works',
    lede: 'Seeded synthetic data generated in Python, validated in memory, loaded into a PostgreSQL dimensional warehouse, published through reporting views that own every KPI definition, and exported as content-addressed files.',
    supporting:
      'Nothing here queries a database at request time. The operating application reads committed exports, which is what makes every figure reproducible from the repository alone.',
    legacyRoute: null,
  },
  {
    view: 'architecture',
    label: 'Architecture',
    title: 'A layered batch pipeline, with every layer answerable',
    lede: 'Synthetic source data is generated deterministically from a seeded configuration profile, validated in memory, written to CSV with a content-digest manifest, and loaded into PostgreSQL, where it passes through raw, staging, warehouse and reporting. Every run records its outcome in an audit schema.',
    supporting:
      'Above the database sits a Power BI semantic model stored as TMDL - text, diffable, reviewable without a licence. It reads the reporting schema and nothing else. Two accepted paths exist to validate it on a real engine, and neither has run.',
    legacyRoute: '/architecture',
  },
  {
    view: 'data-model',
    label: 'Data model',
    title: 'Eight conformed dimensions, five facts, declared grains',
    lede: 'Every table in the warehouse layer with its declared grain, its keys, its history policy and its privacy classification. A fact that cannot state its grain in one sentence is a fact nobody can safely aggregate.',
    legacyRoute: '/data-model',
  },
  {
    view: 'kpis',
    label: 'KPI catalogue',
    title: 'Every governed metric, with its numerator and its denominator',
    lede: 'The catalogue is the contract. Each KPI carries its formula, its explicit numerator and denominator, its grain, its date basis, its null rule, the reporting view that owns it and the caution a reader needs before quoting it.',
    legacyRoute: '/kpis',
  },
  {
    view: 'governance',
    label: 'Governance',
    title: 'How ARPI keeps its numbers honest',
    lede: 'Synthetic-only data, no personal data by construction, declared grains, documented lineage, reconciliation that proves rather than asserts, a read-only reporting role, and scope gates that block work rather than describe it.',
    legacyRoute: '/governance',
  },
  {
    view: 'data-sources',
    label: 'Data sources',
    title: 'Where the data comes from, and what each lane may claim',
    lede: 'Two lanes with different provenance and different limits. The warehouse is machine-generated from a seed and no row of it was ever observed anywhere. The reference listing lane is a de-identified snapshot of what a public listing source exposed, and it describes listings rather than sales results.',
    legacyRoute: '/inventory-operations',
  },
  {
    view: 'status',
    label: 'Status',
    title: 'What is finished, what is pending, and what is blocked',
    lede: 'The current state of every lifecycle phase and delivery increment, the two scope gates, and both real-engine semantic-model validation paths, derived from source-controlled evidence rather than from a claim typed into a page.',
    legacyRoute: '/status',
  },
  {
    view: 'product-vision',
    label: 'Product vision',
    title: 'What ARPI would be with authorized dealership system access',
    lede: 'A production vision, clearly labelled as one. Nothing described here is implemented, no integration exists, and no figure anywhere on this site comes from a real dealership system.',
    legacyRoute: null,
  },
]

/** Look up a view definition. */
export function technicalView(view: TechnicalView): TechnicalViewDefinition {
  const found = TECHNICAL_VIEW_DEFINITIONS.find((entry) => entry.view === view)
  // Every member of the union has a definition; the assertion documents that the
  // registry and the union are the same list rather than two lists that agree.
  if (found === undefined) throw new Error(`No technical view definition for ${view}`)
  return found
}

/**
 * Parse the `view` parameter.
 *
 * An unknown or absent value resolves to the overview rather than 404ing. A
 * mistyped query parameter is not a broken page, and the same reasoning governs
 * the console's filter grammar.
 */
export function parseTechnicalView(raw: string | readonly string[] | undefined): {
  readonly view: TechnicalView
  /** True when a value arrived that is not in the vocabulary. */
  readonly unrecognized: string | null
} {
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined)
  if (value === undefined || value === '') {
    return { view: DEFAULT_TECHNICAL_VIEW, unrecognized: null }
  }
  if ((TECHNICAL_VIEWS as readonly string[]).includes(value)) {
    return { view: value as TechnicalView, unrecognized: null }
  }
  return {
    view: DEFAULT_TECHNICAL_VIEW,
    unrecognized: value.length <= 40 ? value : `${value.slice(0, 40)}…`,
  }
}

/** The href for one technical view. The default view is the bare route. */
export function technicalHref(view: TechnicalView): string {
  return view === DEFAULT_TECHNICAL_VIEW ? '/technical' : `/technical?view=${view}`
}

/**
 * The catalogue entry for one KPI, as a link.
 *
 * `UX.2D` §35 SWEPT THE DRILL-THROUGHS AND FOUND THIS ONE POINTING AT A REDIRECT.
 * Three modules built the same href by hand as `/kpis#KPI-FIN-002` — the catalogue's
 * address before `UX.1` consolidated the six documentation routes into `/technical`.
 * It still resolves, because `/kpis` is one of the eight permanent redirects the
 * route map keeps for exactly this reason, but every KPI identifier on the operating
 * console was a 308 away from its definition, and a fragment that survives a redirect
 * survives it by browser convention rather than by contract.
 *
 * One helper, composed from `technicalHref`, so the catalogue can move again without
 * three modules needing to hear about it.
 */
export function kpiCatalogueHref(kpiId: string): string {
  return `${technicalHref('kpis')}#${kpiId}`
}

/** Every retired route and the view state it now resolves to. */
export const LEGACY_TECHNICAL_ROUTES: readonly {
  readonly from: string
  readonly to: string
}[] = TECHNICAL_VIEW_DEFINITIONS.filter(
  (entry): entry is TechnicalViewDefinition & { legacyRoute: string } =>
    entry.legacyRoute !== null
).map((entry) => ({ from: entry.legacyRoute, to: technicalHref(entry.view) }))

/** Every view state as an href. Read by the sitemap. */
export const TECHNICAL_VIEW_HREFS: readonly string[] = TECHNICAL_VIEW_DEFINITIONS.map(
  (entry) => technicalHref(entry.view)
)
