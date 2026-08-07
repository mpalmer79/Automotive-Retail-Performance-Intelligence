/**
 * The ADR-0013 boundary controls, as failing tests, before the first console route ships.
 *
 * `DASH.1` builds the data lane and nothing else. These assertions are the controls that
 * have to exist first, because a route that violates one of them is much harder to
 * withdraw than one that never merged:
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

describe('DASH.1 ships no route and no component', () => {
  it('has no /dashboard route', () => {
    expect(existsSync(join(SRC, 'app/dashboard'))).toBe(false)
  })

  it('has no dashboard component directory', () => {
    expect(existsSync(join(SRC, 'components/dashboard'))).toBe(false)
  })

  it('adds no dashboard entry to the primary navigation', () => {
    const site = readFileSync(join(SRC, 'lib/site.ts'), 'utf8')
    const nav = site.slice(site.indexOf('PRIMARY_NAV'))
    expect(nav).not.toContain('/dashboard')
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

  it('is imported by nothing in src today', () => {
    /*
     * `DASH.1` ships the lane, not its consumers. Asserting zero importers now is what
     * makes the next assertion meaningful when `DASH.2` adds the first one: the reviewer
     * will see this expectation change in the same diff as the route.
     */
    expect(
      importers.map((file) => file.relative),
      'no route consumes the dashboard data in this increment'
    ).toEqual([])
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
  it('does no arithmetic on an exported monetary or ratio value', () => {
    /*
     * A structural check rather than a semantic one: nothing in `src/` imports the dashboard
     * data at all yet, so nothing can divide it. The assertion is written so it starts
     * mattering the moment a component does import it, and it is paired with the importer
     * assertion above.
     */
    const readers = files.filter((file) => IMPORTS_GENERATED_DASHBOARD.test(file.text))
    expect(readers.map((file) => file.relative)).toEqual([])
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
