/**
 * The ADR-0013 boundary controls, now enforced over a console that exists.
 *
 * `DASH.1` wrote these assertions before there was a route to break them, because a
 * route that violates one of them is much harder to withdraw than one that never
 * merged. `DASH.2` ships the first route, and each control that was phrased as
 * "nothing does this yet" has been re-aimed at the boundary the route actually
 * creates - one console route, one data door, one arithmetic registry, one client
 * island. The conditions themselves are unchanged:
 *
 *   condition 2   the frontend does not redefine a KPI formula
 *   condition 8   the frontend never references raw, staging, warehouse or audit
 *   condition 9   no database credential appears anywhere in the frontend
 *   condition 10  no runtime database connection exists, and no library could make one
 *   condition 15  every public figure comes from the reproducible export
 *
 * Plus the packaging boundary the audit established: `next.config.ts` pins
 * `outputFileTracingRoot` to `portfolio/`, so a module-scope JSON import from a
 * `'use client'` module lands in a browser bundle. The chunked dashboard files are
 * server-only, and that is asserted rather than intended.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MAX_PRIMARY_NAV_ITEMS, PRIMARY_NAV, ROUTES } from '../../src/lib/site.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '../..')
const REPO = resolve(PORTFOLIO, '..')

const SRC = join(PORTFOLIO, 'src')
const GENERATED_DASHBOARD = join(SRC, 'generated/dashboard')

/** Every source file under `portfolio/src`, excluding the generated data itself. */
function sourceFiles(): { path: string; relative: string; text: string }[] {
  const found: { path: string; relative: string; text: string }[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        // The generated dashboard data is data, not source: it is validated by
        // `dashboard-data.test.ts` and by the generator, and scanning 100 data files for
        // source-level rules would only produce noise.
        if (path === GENERATED_DASHBOARD) continue
        walk(path)
        continue
      }
      if (!/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(entry.name)) continue
      found.push({
        path,
        relative: relative(SRC, path),
        text: readFileSync(path, 'utf8'),
      })
    }
  }
  walk(SRC)
  return found
}

const files = sourceFiles()

/**
 * Source with comments removed.
 *
 * Several of these modules name, in prose, the thing they refuse to do — a storage
 * API, an arithmetic helper, a schema. A guard that fires on its own documentation
 * is a guard somebody deletes, which is the reasoning already recorded above for
 * the schema-name scan.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * An import of the generated dashboard data, as opposed to a mention of it.
 *
 * Doc comments name these paths deliberately, so matching prose would make the boundary
 * tests fire on their own documentation.
 */
const IMPORTS_GENERATED_DASHBOARD =
  /(?:import[^;\n]*from\s*|require\(\s*|import\(\s*)['"][^'"]*generated\/dashboard[^'"]*['"]/

describe('the suite is looking at something', () => {
  it('found the portfolio source tree', () => {
    expect(files.length).toBeGreaterThan(20)
  })
})

/* -------------------------------------------------------------------------- */
/* ADR-0013 condition 8: no reference to a schema the console may not see       */
/* -------------------------------------------------------------------------- */

/**
 * Files whose job is to DESCRIBE the warehouse in prose, not to query it.
 *
 * `DASH.1-03` asks for a test that fails if any file under `portfolio/src` references
 * `raw.`, `staging.`, `warehouse.` or `audit.`. Taken literally that criterion cannot be
 * satisfied by this repository and never could have been: the documentation routes exist
 * to explain the data model, and `/data-model` names `warehouse.fact_vehicle_sale` because
 * that is the table it is describing. A guard that fired on those files would be removed
 * within a week, which is worse than a guard drawn where the risk actually is.
 *
 * So the rule is enforced everywhere except these three, and each of them is separately
 * asserted to contain no query construction and no connection. The divergence is recorded
 * in `docs/dashboard/TEST_STRATEGY.md`.
 */
const PROSE_DOCUMENTATION_FILES: readonly string[] = [
  // The authored copy behind /kpis and /data-model: lineage statements naming the tables
  // and views each KPI is computed from.
  'lib/content.ts',
  // The architecture graph's node descriptions, including how configuration reaches the
  // pipeline.
  'content/architecture.ts',
  // The design-system lab, which shows a lineage chip as a worked example.
  'app/ui-lab/page.tsx',
]

describe('the frontend never references a non-reporting schema', () => {
  /*
   * An ARPI object name is lower_snake_case and carries at least one underscore:
   * `warehouse.fact_vehicle_sale`, `audit.validation_result`. Requiring the underscore is
   * what separates a schema reference from ordinary JavaScript member access on a variable
   * that happens to be called `raw` or `staging` -- `raw.trim()` is not a query, and a
   * guard that says it is teaches people to ignore it.
   */
  const patterns: readonly { readonly schema: string; readonly pattern: RegExp }[] = [
    { schema: 'raw', pattern: /\braw\.[a-z]+_[a-z0-9_]+/ },
    { schema: 'staging', pattern: /\bstaging\.[a-z]+_[a-z0-9_]+/ },
    { schema: 'warehouse', pattern: /\bwarehouse\.[a-z]+_[a-z0-9_]+/ },
    { schema: 'audit', pattern: /\baudit\.[a-z]+_[a-z0-9_]+/ },
  ]

  const enforced = files.filter(
    (file) => !PROSE_DOCUMENTATION_FILES.includes(file.relative.replaceAll('\\', '/'))
  )

  it('enforces the rule over most of the tree', () => {
    expect(enforced.length).toBeGreaterThan(files.length - 5)
  })

  it.each(patterns)('names no $schema object', ({ schema, pattern }) => {
    const offenders: string[] = []
    for (const file of enforced) {
      const matches = file.text.match(new RegExp(pattern.source, 'g'))
      if (matches) offenders.push(`${file.relative}: ${[...new Set(matches)].join(', ')}`)
    }
    expect(
      offenders,
      `ADR-0013 condition 8 prohibits the console from reaching the ${schema} schema, ` +
        'directly or transitively. Every figure it displays comes from an approved ' +
        'reporting view through the governed export.'
    ).toEqual([])
  })

  it('names no reporting view outside the documentation copy either', () => {
    /*
     * Stricter than condition 8, and deliberately so. The console consumes exported
     * artefacts; it does not name a view, even an approved one. A view name appearing in
     * dashboard code would mean somebody was building a query string.
     */
    const offenders: string[] = []
    for (const file of enforced) {
      const matches = file.text.match(/\breporting\.vw_[a-z0-9_]+/g)
      if (matches) offenders.push(`${file.relative}: ${[...new Set(matches)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('proves the exempted prose files construct no query and open no connection', () => {
    for (const relative of PROSE_DOCUMENTATION_FILES) {
      const file = files.find((candidate) => candidate.relative === relative)
      expect(file, `${relative} is exempted but does not exist`).toBeDefined()
      const text = file?.text ?? ''
      // A schema name in a sentence is documentation. A SELECT, a client import or a
      // connection string would be something else entirely.
      expect(/\bSELECT\s+[\w*]/.test(text), `${relative} constructs a query`).toBe(false)
      expect(/\bFROM\s+(?:raw|staging|warehouse|audit)\./.test(text), relative).toBe(
        false
      )
      expect(/postgres(?:ql)?:\/\//i.test(text), relative).toBe(false)
      expect(/from\s+['"]pg['"]/.test(text), relative).toBe(false)
    }
  })

  it('keeps the dashboard lane itself completely clean', () => {
    /*
     * The surface this increment adds gets the strict rule with no exemption: the literal
     * substring, not the underscore-qualified form.
     */
    const dashboardFiles = files.filter((file) => /dashboard/i.test(file.relative))
    expect(dashboardFiles.length).toBeGreaterThan(0)
    for (const file of dashboardFiles) {
      for (const schema of ['raw.', 'staging.', 'warehouse.', 'audit.']) {
        expect(file.text.includes(schema), `${file.relative} carries ${schema}`).toBe(
          false
        )
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* ADR-0013 conditions 9 and 10: no credential, no connection                   */
/* -------------------------------------------------------------------------- */

describe('the frontend holds no credential and can open no connection', () => {
  const enforcedForCredentials = files.filter(
    (file) => file.relative.replaceAll('\\', '/') !== 'content/architecture.ts'
  )

  it('carries no connection string, credential name or database environment variable', () => {
    const forbidden: readonly { readonly pattern: RegExp; readonly what: string }[] = [
      { pattern: /postgres(?:ql)?:\/\//i, what: 'a PostgreSQL connection string' },
      { pattern: /\bPGPASSWORD\b/, what: 'the libpq password variable' },
      { pattern: /\bPGHOST\b/, what: 'the libpq host variable' },
      { pattern: /ARPI_DATABASE__/, what: 'a database configuration variable' },
      { pattern: /\bsslmode\s*[:=]/i, what: 'a connection parameter' },
    ]
    /*
     * `content/architecture.ts` names ARPI_DATABASE__ and PGPASSWORD in the sentence that
     * explains where the pipeline's configuration comes from. Naming a variable is not
     * holding a credential, and the assertion that matters -- that no VALUE is present -- is
     * the one below it.
     */
    const offenders: string[] = []
    for (const file of enforcedForCredentials) {
      for (const { pattern, what } of forbidden) {
        if (pattern.test(file.text)) offenders.push(`${file.relative}: ${what}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('assigns no value to a credential variable anywhere, including the prose files', () => {
    for (const file of files) {
      expect(
        /(?:PGPASSWORD|ARPI_DATABASE__[A-Z_]*)\s*[:=]\s*['"`]/.test(file.text),
        `${file.relative} assigns a value to a database configuration variable`
      ).toBe(false)
      expect(
        /process\.env\.(?:PGPASSWORD|PGHOST|ARPI_DATABASE__[A-Z_]*)/.test(file.text),
        `${file.relative} reads a database configuration variable at runtime`
      ).toBe(false)
    }
  })

  it('imports no database client', () => {
    const clients = [
      'pg',
      'postgres',
      'mysql2',
      'knex',
      'prisma',
      '@prisma/client',
      'drizzle-orm',
    ]
    const offenders: string[] = []
    for (const file of files) {
      for (const client of clients) {
        const pattern = new RegExp(
          `(?:from|require\\()\\s*['"]${client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`
        )
        if (pattern.test(file.text)) offenders.push(`${file.relative}: ${client}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares no database dependency at all, so a connection is not merely unused', () => {
    const packageJson = JSON.parse(
      readFileSync(join(PORTFOLIO, 'package.json'), 'utf8')
    ) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const installed = new Set([
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.devDependencies),
    ])
    for (const client of ['pg', 'postgres', 'mysql2', 'knex', 'prisma', 'drizzle-orm']) {
      expect(installed.has(client), `${client} must not be a portfolio dependency`).toBe(
        false
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* No dashboard route or feature UI exists yet                                  */
/* -------------------------------------------------------------------------- */

describe('the console ships exactly the routes its increments have delivered', () => {
  /*
   * THIS BLOCK CHANGES WITH EACH ROUTE INCREMENT, AND THAT IS THE MECHANISM WORKING.
   *
   * At `DASH.1` these assertions read "no route", "no component directory", "no
   * navigation entry" - written that way deliberately, so that the first route would
   * arrive in the same diff as the expectation change and a reviewer would see both.
   * `DASH.2` re-aimed them at one route; `DASH.3` re-aimed them at three; `DASH.7`
   * adds `fi`.
   *
   * What is guarded is unchanged: the console has EXACTLY the routes its increments
   * have delivered, and the others in `INFORMATION_ARCHITECTURE.md` §1 do not
   * exist. A route that appeared without an increment fails here.
   */
  it('has exactly the delivered console routes and no others', () => {
    const root = join(SRC, 'app/dashboard')
    expect(existsSync(root)).toBe(true)
    expect(existsSync(join(root, 'page.tsx'))).toBe(true)
    const nested = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(nested, 'DASH.10 onward own the other console routes').toEqual([
      'accounting',
      'deals',
      'fi',
      'inventory',
      'sales-gross',
    ])
    for (const section of nested) {
      expect(
        existsSync(join(root, section, 'page.tsx')),
        `${section} is a route directory without a page`
      ).toBe(true)
    }
  })

  it('has a dashboard component directory whose components are server-first', () => {
    const directory = join(SRC, 'components/dashboard')
    expect(existsSync(directory)).toBe(true)
    const clientComponents = readdirSync(directory)
      .filter((name) => /\.tsx$/.test(name))
      .filter((name) =>
        /^\s*['"]use client['"]/m.test(readFileSync(join(directory, name), 'utf8'))
      )
    // One island, and it is the filter bar. A second one arriving without a
    // decision is what this assertion exists to catch.
    expect(clientComponents).toEqual(['filter-bar.tsx'])
  })

  it('adds exactly one dashboard entry to the primary navigation', () => {
    /*
     * Asserted against the exported value rather than against the source text. The
     * first version of this check sliced `site.ts` between `PRIMARY_NAV` and
     * `MAX_PRIMARY_NAV_ITEMS`, and the new entry's own comment mentions the cap by
     * name — so the slice ended inside the comment and the guard failed on prose it
     * should have been reading past. The data cannot be misread that way.
     */
    const dashboardItems = PRIMARY_NAV.filter((item) =>
      item.href.startsWith(ROUTES.dashboard.href)
    )
    expect(dashboardItems).toHaveLength(1)
    expect(dashboardItems[0]?.href).toBe(ROUTES.dashboard.href)
    expect(PRIMARY_NAV.length).toBeLessThanOrEqual(MAX_PRIMARY_NAV_ITEMS)

    // No console sub-route reaches the public header; `DashboardNav` carries them.
    for (const item of PRIMARY_NAV) {
      for (const match of item.matches) {
        expect(/^\/dashboard\/./.test(match), match).toBe(false)
      }
    }
  })

  it('adds no API route', () => {
    const apiDirectories: string[] = []
    const walk = (directory: string): void => {
      if (!existsSync(directory)) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (entry.name === 'api') apiDirectories.push(join(directory, entry.name))
        else walk(join(directory, entry.name))
      }
    }
    walk(join(SRC, 'app'))
    expect(apiDirectories).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The generated dashboard data does not enter a route bundle                    */
/* -------------------------------------------------------------------------- */

describe('the generated dashboard data stays out of the existing route bundles', () => {
  /*
   * An IMPORT, not a mention. `types/dashboard.ts` documents the generated paths in a
   * doc comment, which is the opposite of a problem: it is where a future author will look
   * to find out what the files are. Matching prose would make this test fire on its own
   * documentation.
   */
  const importers = files.filter((file) => IMPORTS_GENERATED_DASHBOARD.test(file.text))

  it('is imported only by the declared server data modules', () => {
    /*
     * `DASH.1` asserted zero importers so that the first one would arrive in a diff a
     * reviewer could see. `DASH.2` made it two: one door for whole datasets, one for
     * the partition table.
     *
     * `DASH.3` made it four, `DASH.4` five, `DASH.5` six and `DASH.7` eight, and every
     * addition after the first two is deliberate route SCOPING rather than a
     * relaxation. An import is a
     * graph edge, and a module that imports a dataset puts it into the server graph of
     * every route that reads that module. So:
     *
     *   lib/dashboard/data.ts          shared helpers + the six Executive Overview sets
     *   lib/dashboard/chunks.ts        the five date-grained partition tables
     *   lib/dashboard/sales-gross-data.ts   the 95 kB trend set and the bridge, which
     *                                       only /dashboard/sales-gross reads
     *   lib/dashboard/deal-chunks.ts   the 18 deal INDEX partitions, which the deal
     *                                  routes and the gross distribution read
     *   lib/dashboard/jacket-chunks.ts the 18 deal RECORD partitions -- 443 kB against
     *                                  the index's 221 kB for the same 650 deals --
     *                                  which only /dashboard/deals/[saleId] reads
     *   lib/dashboard/targets-data.ts  the 17 kB operating-plan set (`DASH.5`), read by
     *                                  /dashboard and /dashboard/sales-gross and by
     *                                  neither deal route
     *   lib/dashboard/fi-data.ts       the two UNCHUNKED F&I sets (`DASH.7`) -- the 79 kB
     *                                  production summary and the 15 kB adjustment
     *                                  summary -- which only /dashboard/fi reads
     *   lib/dashboard/fi-chunks.ts     the 18 penetration partitions and the 18 deal
     *                                  PRODUCT partitions (`DASH.7`); the product
     *                                  partitions are also the Deal Jacket's product
     *                                  itemisation, so this door is shared by two routes
     *   lib/dashboard/inventory-chunks.ts   the 18 unit-grain stock partitions (`DASH.9`)
     *                                       -- 356 kB of per-vehicle rows -- which only
     *                                       /dashboard/inventory reads
     *   lib/dashboard/accounting-chunks.ts  the 18 accounting-schedule partitions
     *                                       (`DASH.9`) -- 360 kB of per-unit book values
     *                                       and their capitalised components
     *   lib/dashboard/accounting-data.ts    the two UNCHUNKED accounting sets (`DASH.9`):
     *                                       the 18 kB GL-versus-subledger comparison and
     *                                       the 2 kB exception set. The comparison set is
     *                                       the ONLY accounting door `/dashboard` opens --
     *                                       43 rows is the whole comparison surface, so the
     *                                       narrow set IS the Executive summary and no
     *                                       second aggregate had to be invented for it
     *
     * The last two are kept apart from each other deliberately. They share a grain but
     * not an audience: a route that wants operational stock should not acquire every
     * capitalised cost component as a side effect, and `/dashboard` renders one
     * reconciliation figure and must acquire neither.
     *
     * Folding any of the last nine into `data.ts` would have put deal-level records
     * and a 95 kB trend into `/dashboard`'s graph, which has no use for either. Eleven
     * narrow doors is a stronger boundary than two wide ones, and the list is
     * exhaustive: a twelfth importer fails here.
     */
    expect(
      importers.map((file) => file.relative).sort(),
      'the generated dashboard data has exactly eleven declared doors'
    ).toEqual([
      'lib/dashboard/accounting-chunks.ts',
      'lib/dashboard/accounting-data.ts',
      'lib/dashboard/chunks.ts',
      'lib/dashboard/data.ts',
      'lib/dashboard/deal-chunks.ts',
      'lib/dashboard/fi-chunks.ts',
      'lib/dashboard/fi-data.ts',
      'lib/dashboard/inventory-chunks.ts',
      'lib/dashboard/jacket-chunks.ts',
      'lib/dashboard/sales-gross-data.ts',
      'lib/dashboard/targets-data.ts',
    ])
  })

  it('keeps the deal RECORD partitions out of every route but the Deal Jacket', () => {
    /*
     * `jacket-chunks.ts` is the largest partition table in the console: the cost
     * components, trade amounts and finance amounts that the index deliberately omits.
     * The only thing that keeps 443 kB out of `/dashboard` and `/dashboard/deals` is
     * that nothing on those routes imports it, so that is asserted rather than assumed.
     */
    const jacketImporters = files
      .filter((file) => /from '[^']*jacket-chunks'/.test(file.text))
      .map((file) => file.relative)
      .sort()
    expect(jacketImporters).toEqual(['lib/dashboard/deal-jacket.ts'])

    for (const route of ['app/dashboard/page.tsx', 'app/dashboard/deals/page.tsx']) {
      expect(readFileSync(join(SRC, route), 'utf8')).not.toMatch(/jacket-chunks/)
    }
    for (const viewModel of ['lib/dashboard/executive.ts', 'lib/dashboard/deals.ts']) {
      expect(readFileSync(join(SRC, viewModel), 'utf8')).not.toMatch(/jacket-chunks/)
    }
  })

  it('keeps the DASH.9 unit-detail partitions out of the Executive Overview', () => {
    /*
     * `/dashboard` renders ONE reconciliation figure. The two unit-grain doors carry
     * 356 kB of per-vehicle stock and 360 kB of per-unit book values, and the Executive
     * page has no use for a single row of either.
     *
     * It reads `accounting-data.ts` instead, whose comparison set is 43 rows and 18 kB.
     * That set IS the whole comparison surface, which is why no second aggregate had to be
     * invented for the card -- a second aggregate would have been a second definition of
     * the same figure, computed somewhere else and free to disagree with the accounting
     * page.
     *
     * Asserted on the route AND on its view model, because an import in either one puts
     * the partitions in the same server graph.
     */
    const inventoryImporters = files
      .filter((file) => /from '[^']*inventory-chunks'/.test(file.text))
      .map((file) => file.relative)
      .sort()
    expect(inventoryImporters).toEqual(['app/dashboard/inventory/page.tsx'])

    const accountingImporters = files
      .filter((file) => /from '[^']*accounting-chunks'/.test(file.text))
      .map((file) => file.relative)
      .sort()
    expect(accountingImporters).toEqual(['app/dashboard/inventory/page.tsx'])

    // Matched as an IMPORT rather than as a mention: `executive.ts` explains in prose why
    // it must not open these doors, and a guard that fired on its own explanation would be
    // a guard somebody deletes.
    for (const executive of ['app/dashboard/page.tsx', 'lib/dashboard/executive.ts']) {
      const text = readFileSync(join(SRC, executive), 'utf8')
      expect(text, `${executive} opens the stock partitions`).not.toMatch(
        /from '[^']*inventory-chunks'/
      )
      expect(text, `${executive} opens the accounting partitions`).not.toMatch(
        /from '[^']*accounting-chunks'/
      )
    }

    // The narrow door IS opened, and by the view model rather than the component.
    expect(readFileSync(join(SRC, 'lib/dashboard/executive.ts'), 'utf8')).toMatch(
      /from '[^']*accounting-data'/
    )
  })

  it('keeps the deal partitions out of the Executive Overview route graph', () => {
    /*
     * The reason `deal-chunks.ts` is its own module, asserted rather than intended.
     * `/dashboard` must not carry 221 kB of transaction records to render an overview
     * that shows none, and the only thing that actually prevents it is that the
     * overview's modules do not import the deal table.
     */
    const dealChunkImporters = files
      .filter((file) => /from '[^']*deal-chunks'/.test(file.text))
      .map((file) => file.relative)
      .sort()
    /*
     * Two importers, both view models. The routes do not reach the partition table
     * directly: they call a view model, which is what keeps the read path and its
     * filtering in one testable place.
     *
     * `sales-gross.ts` is on this list because the deal-level gross distribution is
     * genuinely deal-grain data -- a distribution of transactions cannot be computed
     * from a store-day aggregate.
     */
    expect(dealChunkImporters).toEqual([
      'lib/dashboard/deals.ts',
      'lib/dashboard/sales-gross.ts',
    ])
    const overview = readFileSync(join(SRC, 'app/dashboard/page.tsx'), 'utf8')
    expect(overview).not.toMatch(/deal-chunks/)
    expect(readFileSync(join(SRC, 'lib/dashboard/executive.ts'), 'utf8')).not.toMatch(
      /deal-chunks/
    )
  })

  it('is never imported from a client component, if it is ever imported at all', () => {
    /*
     * The audit's finding: `outputFileTracingRoot` is pinned to `portfolio/`, and a
     * module-scope JSON import from a `'use client'` module enters the browser bundle. The
     * inventory explorer does that deliberately for 541 records; the dashboard chunks are
     * an order of magnitude larger and must not.
     */
    const offenders = importers
      .filter((file) => /^\s*['"]use client['"]/m.test(file.text))
      .map((file) => file.relative)
    expect(offenders).toEqual([])
  })

  it('is never imported by a chunk path from anywhere but a server module', () => {
    const offenders = files
      .filter((file) =>
        /(?:import[^;\n]*from\s*|require\(\s*|import\(\s*)['"][^'"]*generated\/dashboard\/datasets\//.test(
          file.text
        )
      )
      .filter((file) => /^\s*['"]use client['"]/m.test(file.text))
      .map((file) => file.relative)
    expect(offenders).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* No KPI arithmetic on the frontend                                            */
/* -------------------------------------------------------------------------- */

describe('ADR-0013 condition 2: no frontend redefines a KPI', () => {
  it('does every aggregation in one declared registry and nowhere else', () => {
    /*
     * The `DASH.1` form of this check was structural and easy: nothing imported the
     * data, so nothing could divide it. `DASH.2` renders values, so the check has to
     * become the real one - WHERE the arithmetic is allowed to live.
     *
     * `decimal.ts` owns the operations. `selectors.ts` owns the decisions about which
     * governed columns may be combined and how, as data, each entry carrying the
     * reconciliation key that proves it reproduces the export. Everything else -
     * every component, every route, the view model - may only call a selector.
     */
    const ALLOWED = new Set(['lib/dashboard/decimal.ts', 'lib/dashboard/selectors.ts'])
    const offenders = files
      .filter((file) => !ALLOWED.has(file.relative))
      .filter(
        (file) =>
          file.relative.startsWith('lib/dashboard/') ||
          file.relative.startsWith('components/dashboard/') ||
          file.relative.startsWith('app/dashboard/')
      )
      .filter((file) =>
        /\b(addExact|subtractExact|divideExact|sumExact|multiplyByInteger)\s*\(/.test(
          stripComments(file.text)
        )
      )
      .map((file) => file.relative)
      .sort()
    /*
     * Six view models, and the list is exhaustive. Each is a VIEW MODEL: it sums
     * additive exported columns and divides one summed column by another, which is
     * the operation the reporting layer already publishes numerator and denominator
     * for. None of them defines what a measure means.
     *
     * `deal-jacket.ts` is on this list for a different and stronger reason than the
     * other three: it does not aggregate at all. It RE-DERIVES two identities that the
     * export already publishes — sale price less the three cost components, and front
     * plus back — and reports whether the recomputation matched. That is the whole
     * point of the Deal Jacket, and it is arithmetic the module has to perform itself,
     * because a verification that reads a stored flag verifies nothing. It defines no
     * measure: both identities are `KPI-GRS-001` and `KPI-GRS-003` as the catalogue
     * already states them.
     *
     * That claim is not left to this test. `dashboard-executive.test.tsx` and
     * `dashboard-sales-gross.test.tsx` each reconcile the rendered figures against the
     * export manifest's own published totals, character for character, and
     * `dashboard-deal-jacket.test.tsx` drives the jacket with a CORRUPTED partition and
     * requires the failure to surface. A module that had quietly invented a formula
     * would fail there with a wrong number rather than pass here on a filename.
     *
     * `targets.ts` (`DASH.5`) is a view model of the same kind as `executive.ts`: it
     * sums the numerator and denominator columns the target reporting view publishes
     * SEPARATELY for exactly this reason, and divides once. It defines no measure --
     * `KPI-TGT-001` through `KPI-TGT-010` are stated in the catalogue and computed in
     * SQL -- and `dashboard-targets.test.ts` reconciles what it produces against the
     * export manifest's own published target totals, so a module that had invented a
     * formula would fail there with a wrong number rather than pass here on a filename.
     *
     * `fi.ts` (`DASH.7`) is the sixth, and it is the one most at risk of becoming a
     * calculation engine, so its limits are the narrowest in the console. It sums
     * additive exported columns -- reserve, product gross, attached deals, eligible
     * deals -- and divides one summed column by another. It does NOT define an F&I
     * measure: `KPI-FNI-001` through `KPI-FNI-018` are stated in the catalogue and
     * computed in SQL, penetration arrives with its numerator and its OWN eligible
     * denominator already published per category, and the three date bases arrive as
     * three separate datasets that this module never joins. `dashboard-fi.test.tsx`
     * reconciles what it produces against the export manifest's own published F&I
     * totals, so a module that had invented a formula would fail there with a wrong
     * number rather than pass here on a filename.
     *
     * `accounting.ts` and `inventory.ts` (`DASH.9`) are the seventh and eighth, and both
     * are narrower than `fi.ts`. Neither divides anything.
     *
     * `accounting.ts` sums exported balance columns and sums ALREADY-SIGNED variances. It
     * does not compute a variance: `variance_amount = gl_balance - subledger_balance` is
     * evaluated in SQL and published per row, and this module only adds the published
     * values up. The one thing it must get right is WHICH rows it adds -- comparable
     * positions on ONE date -- and that is selection, not arithmetic.
     *
     * `inventory.ts` sums `inventory_investment` and counts units. It does not compute
     * `price_to_market_ratio`, `days_in_stock`, `age_bucket` or the aged flag; all four
     * arrive resolved, and the aged THRESHOLD arrives as a column so the module reads it
     * instead of declaring 60. Its median is an order statistic over the population rather
     * than an aggregate of aggregates, which is why it cannot be pushed into SQL for a
     * filtered selection.
     *
     * As with the other six, that claim is not left to this test:
     * `dashboard-accounting.test.ts` and `dashboard-inventory.test.ts` reconcile what they
     * produce against the export manifest's own published rows, and seed corrupted fixtures
     * for the specific mistakes each model could make -- absolute variance in place of
     * signed, a missing side read as zero, balances summed across dates, a 120-day aged
     * threshold, subgroup medians averaged. A module that had invented a formula fails
     * there with a wrong number rather than passing here on a filename.
     *
     * `visuals.tsx` and `pace-bar.tsx` are NOT on this list and must not be: a chart or
     * bar primitive receives resolved values and turns them into geometry.
     */
    expect(
      offenders,
      'exact arithmetic outside decimal.ts, the selector registry and the declared view models'
    ).toEqual([
      'lib/dashboard/accounting.ts',
      'lib/dashboard/deal-jacket.ts',
      'lib/dashboard/deals.ts',
      'lib/dashboard/executive.ts',
      'lib/dashboard/fi.ts',
      'lib/dashboard/inventory.ts',
      'lib/dashboard/sales-gross.ts',
      'lib/dashboard/targets.ts',
    ])
  })

  it('keeps arithmetic out of the chart primitives and the section components', () => {
    /*
     * A chart may compute a bar width. It may not compute a figure. The primitives take
     * already-resolved values and an already-formatted display string, and the only
     * numeric function they are allowed to reach for is the one that exists to make
     * geometry out of an exact decimal.
     */
    const componentFiles = files.filter(
      (file) =>
        file.relative.startsWith('components/dashboard/') ||
        file.relative.startsWith('app/dashboard/')
    )
    const offenders = componentFiles
      .filter((file) =>
        /\b(addExact|subtractExact|divideExact|sumExact|multiplyByInteger|roundExact)\s*\(/.test(
          stripComments(file.text)
        )
      )
      .map((file) => file.relative)
    expect(offenders, 'a component performed exact arithmetic').toEqual([])
  })

  it('confines the view model to summing one exported count column', () => {
    /*
     * `executive.ts` is the single exception above, and it is a narrow one: it adds
     * `units_in_bucket` across the exported age buckets so the aging profile can be
     * drawn. That is a sum of one additive exported column - the same operation
     * `SELECTORS.activeInventory` performs - and the executive suite asserts the
     * bucket total equals the active-inventory KPI. It performs no division, so it
     * cannot form a ratio, which is where a redefined KPI would actually live.
     */
    const text = stripComments(
      readFileSync(join(SRC, 'lib/dashboard/executive.ts'), 'utf8')
    )
    expect(/\bdivideExact\s*\(/.test(text), 'the view model divides').toBe(false)
    expect(/\bmultiplyByInteger\s*\(/.test(text), 'the view model scales').toBe(false)
    expect(/\bsubtractExact\s*\(/.test(text), 'the view model differences').toBe(false)
  })

  it('lets no React component call an arithmetic helper at all', () => {
    const offenders = files
      .filter((file) => /\.tsx$/.test(file.relative))
      .filter((file) =>
        /\b(addExact|subtractExact|divideExact|sumExact|multiplyByInteger|parseExact)\s*\(/.test(
          stripComments(file.text)
        )
      )
      .map((file) => file.relative)
    expect(offenders, 'a component doing exact arithmetic').toEqual([])
  })

  it('keeps the exact-decimal contract documented where a future component will look', () => {
    const types = readFileSync(join(SRC, 'types/dashboard.ts'), 'utf8')
    const collapsed = types.replace(/\s+/g, ' ')
    expect(types).toContain('ExactDecimalString')
    expect(collapsed).toContain('Never parsed with `Number`')
    expect(collapsed).toContain('no JavaScript number ever touches a gross figure')
  })

  it('declares no `any` type in the dashboard type contract', () => {
    /*
     * Matched in the positions TypeScript actually uses `any`, rather than as a bare word:
     * the file's own prose contains "any one of which", and a guard that fires on English
     * is a guard somebody deletes.
     */
    const types = readFileSync(join(SRC, 'types/dashboard.ts'), 'utf8')
    for (const pattern of [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /Record<[^>]*\bany\b/,
    ]) {
      expect(
        pattern.test(types),
        `${String(pattern)} appears in the dashboard types`
      ).toBe(false)
    }
  })

  it('asserts no type onto external JSON in the generator', () => {
    const generator = readFileSync(
      join(PORTFOLIO, 'scripts/generate-dashboard-data.ts'),
      'utf8'
    )
    expect(/\bas\s+any\b/.test(generator)).toBe(false)
    // `as unknown` is the safe direction: it widens rather than narrows, and every value is
    // then checked by a predicate that can fail with the field named.
    expect(generator).toContain('as unknown')
    expect(generator).toContain('function isRecord')
  })
})

/* -------------------------------------------------------------------------- */
/* No internal connection metadata in a generated file                          */
/* -------------------------------------------------------------------------- */

describe('the generated dashboard files carry no internal metadata', () => {
  const generatedFiles: { relative: string; text: string }[] = []
  const walk = (directory: string, prefix: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, name)
      else generatedFiles.push({ relative: name, text: readFileSync(path, 'utf8') })
    }
  }
  walk(GENERATED_DASHBOARD, '')

  it('found the generated tree', () => {
    expect(generatedFiles.length).toBeGreaterThan(0)
  })

  it('names no host, port, database, user or credential', () => {
    /*
     * A bare `5432` is NOT in this list, and a bare dotted quad is not either. `5432.00` is
     * a perfectly ordinary inventory investment figure, and asserting its absence would fail
     * on correct data - the exact kind of false positive that gets a privacy guard deleted.
     * A port only means a port next to a host, so that is what is matched.
     */
    const forbidden = [
      'password',
      'sslmode',
      'postgresql://',
      'postgres://',
      'PGPASSWORD',
      'PGHOST',
      'ARPI_DATABASE__',
      'localhost',
    ]
    for (const file of generatedFiles) {
      for (const needle of forbidden) {
        expect(file.text.includes(needle), `${file.relative} carries ${needle}`).toBe(
          false
        )
      }
      expect(
        /(?:\/\/|@|host[=:]\s*)[\w.-]+:\d{2,5}\b/i.test(file.text),
        `${file.relative} carries a host:port pair`
      ).toBe(false)
    }
  })

  it('names no object in a schema the console may not see', () => {
    for (const file of generatedFiles) {
      for (const schema of ['raw.', 'staging.', 'warehouse.', 'audit.']) {
        expect(file.text.includes(schema), `${file.relative} carries ${schema}`).toBe(
          false
        )
      }
    }
  })

  it('carries no absolute local path', () => {
    for (const file of generatedFiles) {
      expect(/"\/(?:home|Users|var|tmp)\//.test(file.text), file.relative).toBe(false)
      expect(/[A-Z]:\\\\/.test(file.text), file.relative).toBe(false)
    }
  })

  it('carries no email address, URL or VIN-shaped identifier', () => {
    for (const file of generatedFiles) {
      expect(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(file.text),
        file.relative
      ).toBe(false)
      expect(/https?:\/\//.test(file.text), file.relative).toBe(false)
      expect(
        /\b(?=[A-HJ-NPR-Z0-9]{17}\b)[A-HJ-NPR-Z]*\d[A-HJ-NPR-Z0-9]*\b/.test(file.text),
        file.relative
      ).toBe(false)
    }
  })

  it('carries no prohibited personal-data field name', () => {
    const prohibited = [
      'customer_name',
      'first_name',
      'last_name',
      'street_address',
      'email',
      'phone',
      'date_of_birth',
      'birth_date',
      'ssn',
      'social_security',
      'drivers_license',
      'bank_account',
      'credit_card',
      'credit_score',
      'notes',
    ]
    for (const file of generatedFiles) {
      for (const needle of prohibited) {
        expect(file.text.includes(needle), `${file.relative} carries ${needle}`).toBe(
          false
        )
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Packaging: nothing new reaches the runtime image                              */
/* -------------------------------------------------------------------------- */

describe('the runtime image is unchanged in shape', () => {
  const dockerfile = readFileSync(join(PORTFOLIO, 'Dockerfile.railway'), 'utf8')

  it('excludes tests, scripts and docs from file tracing', () => {
    const config = readFileSync(join(PORTFOLIO, 'next.config.ts'), 'utf8')
    for (const excluded of ['./tests/**', './docs/**', './scripts/**']) {
      expect(config).toContain(excluded)
    }
  })

  it('copies the export only into the build stage', () => {
    const stages = dockerfile.split(/^FROM /m)
    const runtime = stages[stages.length - 1] ?? ''
    expect(runtime).not.toContain('data/dashboard')
    expect(runtime).not.toContain('src/generated')
  })

  it('keeps the source export out of the deployed application', () => {
    // `data/dashboard/` is read at build time and never served. What ships is the
    // generated tree inside `.next`, which is what `output: 'standalone'` traces.
    expect(existsSync(join(REPO, 'data/dashboard/manifest.json'))).toBe(true)
    const dockerignore = readFileSync(join(REPO, '.dockerignore'), 'utf8')
    expect(dockerignore).toContain('data/dashboard')
  })

  it('keeps every generated dashboard file inside the chunk ceiling', () => {
    const walk = (directory: string, prefix: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          walk(path, name)
          continue
        }
        if (!name.includes('/')) continue // top-level manifest and whole-dataset files
        expect(statSync(path).size, name).toBeLessThanOrEqual(256 * 1024)
      }
    }
    walk(GENERATED_DASHBOARD, '')
  })
})

describe('the print rules land on elements that actually carry them', () => {
  /*
   * `Section`, `Container` and `Text` take a DECLARED prop list. They do not spread
   * the rest, which is deliberate -- a layout primitive that forwards anything is a
   * primitive with no contract -- but it means an attribute passed to one of them
   * compiles, type-checks against `React.ComponentProps`-free interfaces, renders
   * nothing, and silently does not apply.
   *
   * That is not hypothetical. `DASH.4` shipped `data-arpi-print="omit"` on a
   * `<Section>`, and the paper recap printed its navigation until the Playwright
   * print assertion caught it. This test catches the next one at build time: the
   * print attributes may only be placed on an intrinsic element, whose tag name is
   * lowercase.
   */
  const PRINT_ATTRIBUTE = /data-arpi-print=/g

  it('places every print attribute on a lowercase intrinsic element', () => {
    const offenders: string[] = []
    for (const file of files) {
      // Comments are stripped first: several of these files EXPLAIN the rule, naming
      // the attribute in prose, and a guard that fires on its own documentation is a
      // guard somebody deletes. That is the same reasoning as the schema-name scan
      // above, and this test caught itself on it.
      const source = stripComments(file.text)
      for (const match of source.matchAll(PRINT_ATTRIBUTE)) {
        // Walk backwards to the `<` that opens this element.
        const opening = source.lastIndexOf('<', match.index)
        if (opening < 0) continue
        const tag = /^<\s*([A-Za-z][\w.]*)/.exec(source.slice(opening, match.index))?.[1]
        if (tag === undefined) continue
        if (/^[a-z]/.test(tag)) continue
        offenders.push(`${file.relative}: <${tag}> would swallow data-arpi-print`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is used at all, so the assertion above is not vacuous', () => {
    const users = files.filter((file) =>
      /data-arpi-print=/.test(stripComments(file.text))
    )
    expect(users.map((file) => file.relative).sort()).toEqual([
      'app/dashboard/deals/[saleId]/page.tsx',
      'components/dashboard/deal-jacket-sections.tsx',
      'components/shell/dashboard-nav.tsx',
      'components/shell/site-footer.tsx',
      'components/shell/site-header.tsx',
    ])
  })
})
