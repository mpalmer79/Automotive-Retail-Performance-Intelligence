/**
 * Railway deployment configuration, checked against the thing it has to agree
 * with: the manifest generator's own read set.
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * The website displays no authored number. Every count and every project status
 * is generated at build time from evidence files spread across the repository —
 * Power BI validation results, the semantic model's TMDL, the KPI catalogue, the
 * gate readiness documents, the SQL tree. Three separate pieces of configuration
 * therefore have to know that list:
 *
 *   1. `railway.json` watchPatterns   or a change to evidence does not redeploy,
 *                                     and the live site keeps asserting a status
 *                                     the repository has stopped evidencing
 *   2. `portfolio/Dockerfile.railway` or the evidence is not in the build context
 *                                     and the build fails inside a container
 *   3. `.dockerignore`                or a needed path is excluded from the upload
 *
 * A human keeping three lists in step with a fourth is a matter of time. So
 * rather than duplicating the list here, this suite EXTRACTS it from the two
 * build-time generators — from their actual read call sites — and asserts the
 * three configurations cover it. Adding a new evidence source to either
 * generator without updating them fails here.
 *
 * THE SECOND GENERATOR
 * --------------------
 * `generate-inventory-data.ts` reads the sanitized inventory workbooks and the
 * store dimension, and writes the three artefacts the dealership and inventory
 * pages render. It runs in `--check` mode inside the image for the same reason
 * the manifest does, so its inputs have to reach the build context too. It is
 * folded into the same extraction rather than given a parallel suite, because a
 * parallel suite is a second place for the rule to be written down.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORTFOLIO = resolve(HERE, '..', '..')
const REPO = resolve(PORTFOLIO, '..')

const read = (relative: string) => readFileSync(resolve(REPO, relative), 'utf8')

const MANIFEST_GENERATOR_SOURCE = read('portfolio/scripts/generate-project-manifest.ts')
const INVENTORY_GENERATOR_SOURCE = read('portfolio/scripts/generate-inventory-data.ts')
const GENERATOR_SOURCE = `${MANIFEST_GENERATOR_SOURCE}\n${INVENTORY_GENERATOR_SOURCE}`
const DOCKERFILE = read('portfolio/Dockerfile.railway')
const DOCKERIGNORE = read('.dockerignore')
const RAILWAY_CONFIG = JSON.parse(read('railway.json')) as {
  build: { builder: string; dockerfilePath: string; watchPatterns: string[] }
  deploy: Record<string, unknown>
}
const NEXT_CONFIG = read('portfolio/next.config.ts')

/* -------------------------------------------------------------------------- */
/* Extracting the generator's read set                                        */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the generator's simple path constants.
 *
 * Only `const NAME = '<literal>'` and one level of template interpolation are
 * handled, which is all the generator uses. Anything more elaborate would be a
 * reason to simplify the generator rather than to make this cleverer.
 */
function pathConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>()

  // Any casing. The generator uses SCREAMING_SNAKE for its evidence paths and
  // lowerCamel for the two content files it cross-checks (`kpiContentPath`), and
  // a rule that only understood one of those would silently miss the other.
  for (const match of source.matchAll(/^const ([A-Za-z_][A-Za-z0-9_]*) = '([^']+)'/gm)) {
    constants.set(match[1] as string, match[2] as string)
  }
  // Template forms such as `const MODEL_DEF = \`${PBIP}/....\``
  for (const match of source.matchAll(/^const ([A-Za-z_][A-Za-z0-9_]*) = `([^`]+)`/gm)) {
    const name = match[1] as string
    const template = match[2] as string
    const expanded = template.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_whole, reference: string) => constants.get(reference) ?? `\${${reference}}`
    )
    if (!expanded.includes('${')) constants.set(name, expanded)
  }
  return constants
}

/**
 * Every repository-relative path the generator READS.
 *
 * Extracted from the read call sites — `readText`, `readJson`, `listFiles`,
 * `countFilesRecursive`, `existsSync(repoPath(...))` — rather than from every
 * string literal in the file. That distinction is deliberate: the generator also
 * records evidence SOURCE PATHS that it renders as links on the website
 * (`tests/integration/test_privacy.py`, `.github/workflows/ci.yml`) without
 * reading them. Changing one of those does not change the manifest, so watching
 * it would rebuild the site for nothing.
 */
function generatorReadPaths(source: string): string[] {
  const constants = pathConstants(source)
  const found = new Set<string>()

  const resolveArgument = (raw: string): string | undefined => {
    const trimmed = raw.trim()

    // A quoted literal.
    const literal = /^'([^']+)'$/.exec(trimmed)
    if (literal) return literal[1]

    // A constant reference, in any casing.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return constants.get(trimmed)

    // A template literal, possibly interpolating a constant.
    const template = /^`([^`]+)`$/.exec(trimmed)
    if (template) {
      const expanded = (template[1] as string).replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (_whole, reference: string) => constants.get(reference) ?? `\${${reference}}`
      )
      // A path interpolating a runtime value (a filename from a directory
      // listing) collapses to its directory, which is what needs watching.
      if (expanded.includes('${')) {
        const prefix = expanded.slice(0, expanded.indexOf('${'))
        return prefix.replace(/\/[^/]*$/, '') || undefined
      }
      return expanded
    }

    return undefined
  }

  const patterns = [
    /\breadText\(([^)]+)\)/g,
    /\breadJson<[^>]*>\(([^)]+)\)/g,
    /\blistFiles\(([^,)]+)[,)]/g,
    /\bcountFilesRecursive\(([^,)]+)[,)]/g,
    /\bexistsSync\(repoPath\(([^)]+)\)\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const resolved = resolveArgument(match[1] as string)
      if (resolved !== undefined && resolved !== '') found.add(resolved)
    }
  }

  // `requiredCaseStudyContent` / `requiredCaseStudyScreenshots` are read through
  // an array and a variable, so they are picked up from their declarations.
  for (const match of source.matchAll(/requiredCaseStudy\w* = (?:\[)?'([^']+)'/g)) {
    found.add(match[1] as string)
  }

  // Every `const *_PATH = '...'` counts as a read path.
  //
  // The call-site patterns above miss a path that reaches its `readFileSync`
  // through a FUNCTION PARAMETER — the gate readiness documents go through
  // `parseGateVerdict(GATE_1_PATH, 1)`, which reads `existsSync(repoPath(path))`
  // where `path` is the parameter name. Following that statically would mean
  // writing a call-graph analyser; naming the convention instead is both simpler
  // and stricter, because a `_PATH` constant that is declared and never read is a
  // dead constant rather than a missed watch pattern.
  for (const [name, value] of constants) {
    if (name.endsWith('_PATH')) found.add(value)
  }

  return [...found].sort()
}

const READ_PATHS = generatorReadPaths(GENERATOR_SOURCE)

/**
 * Whether a Railway watch pattern matches a path.
 *
 * A watch pattern matches a path if the path is the pattern, is inside a
 * directory the pattern covers, or — importantly — is a DIRECTORY that the
 * pattern reaches into. That last case is what makes `sql/**` cover the
 * generator's read of `sql/03_dimensions`, and `portfolio/**` cover its read of
 * `portfolio/src/content/kpis.json`.
 */
function watchPatternCovers(pattern: string, path: string): boolean {
  if (pattern === path) return true

  const globIndex = pattern.indexOf('**')
  if (globIndex !== -1) {
    const prefix = pattern.slice(0, globIndex).replace(/\/$/, '')
    return path === prefix || path.startsWith(`${prefix}/`)
  }

  // A literal directory pattern covers everything beneath it.
  return path.startsWith(`${pattern.replace(/\/$/, '')}/`)
}

function uncoveredBy(patterns: readonly string[], paths: readonly string[]): string[] {
  return paths.filter(
    (path) => !patterns.some((pattern) => watchPatternCovers(pattern, path))
  )
}

/* -------------------------------------------------------------------------- */
/* The extraction itself has to be trustworthy                                */
/* -------------------------------------------------------------------------- */

describe('the generator read set is extracted correctly', () => {
  it('finds a plausible number of read paths', () => {
    // A regex that silently stopped matching would make every assertion below
    // vacuously pass, which is the worst failure mode a test like this can have.
    expect(READ_PATHS.length).toBeGreaterThanOrEqual(10)
  })

  it('includes the evidence sources named in the generator documentation', () => {
    // Spot-checked against the file's own header comment. If the generator stops
    // reading one of these, this fails and the header is out of date too.
    for (const expected of [
      'powerbi/validation/model_expectations.json',
      'powerbi/validation/sql_baseline_metadata.json',
      'powerbi/validation/desktop_validation_results.json',
      'powerbi/validation/fabric_validation_results.json',
      'KPI_CATALOG.md',
      'docs/requirements/PHASE_2_BACKLOG.md',
      'docs/requirements/GATE_1_READINESS.md',
      'docs/requirements/GATE_2_READINESS.md',
      'portfolio/src/content/kpis.json',
      'portfolio/src/content/data-model.json',
    ]) {
      expect(READ_PATHS, `generator no longer reads ${expected}`).toContain(expected)
    }
  })

  it('includes the SQL build directories the script counts', () => {
    const sqlPaths = READ_PATHS.filter((path) => path.startsWith('sql/'))
    expect(sqlPaths.length).toBeGreaterThanOrEqual(9)
  })

  it('includes the Power BI project tree', () => {
    expect(
      READ_PATHS.some((path) => path.startsWith('powerbi/ARPI_Performance_Intelligence'))
    ).toBe(true)
  })

  it("includes the inventory generator's own sources", () => {
    // The dealership and inventory pages display no authored number either, and
    // their evidence lives outside `portfolio/` exactly as the manifest's does.
    for (const expected of [
      'data/sample/dim_dealership.csv',
      'data/reference/inventory',
      'portfolio/src/content/dealership-profiles.json',
    ]) {
      expect(READ_PATHS, `the inventory generator no longer reads ${expected}`).toContain(
        expected
      )
    }
  })

  it('excludes paths the generator only records as evidence links', () => {
    // These appear as strings in the generator because the website links to them,
    // but the generator never reads them, so watching them would rebuild the site
    // for a change that cannot alter the manifest.
    for (const notRead of [
      'tests/integration/test_privacy.py',
      '.github/workflows/ci.yml',
      'src/arpi/validation/privacy.py',
    ]) {
      expect(READ_PATHS, `${notRead} is recorded, not read`).not.toContain(notRead)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 1. Watch patterns                                                          */
/* -------------------------------------------------------------------------- */

describe('railway.json watch patterns cover every evidence source', () => {
  it('covers every path the manifest generator reads', () => {
    const uncovered = uncoveredBy(RAILWAY_CONFIG.build.watchPatterns, READ_PATHS)
    expect(
      uncovered,
      'These evidence sources are read by the manifest generator but are not matched by any ' +
        'railway.json watch pattern. A change to one of them would alter what the website is ' +
        'required to say, and Railway would not rebuild:\n  ' +
        uncovered.join('\n  ')
    ).toEqual([])
  })

  it('watches the build configuration itself', () => {
    // A change to the Dockerfile, the config, or the ignore file changes the
    // artefact without changing any source the site renders.
    const patterns = RAILWAY_CONFIG.build.watchPatterns
    for (const path of [
      'railway.json',
      '.dockerignore',
      '.railway/railway.ts',
      'portfolio/Dockerfile.railway',
    ]) {
      expect(
        patterns.some((pattern) => watchPatternCovers(pattern, path)),
        `${path} is not watched`
      ).toBe(true)
    }
  })

  it('does not watch the whole repository', () => {
    // `**` alone would rebuild the site for a change to the Python test suite, the
    // notebooks or the Excel workbook. Correct-but-wasteful, and it would hide a
    // genuinely missing pattern.
    expect(RAILWAY_CONFIG.build.watchPatterns).not.toContain('**')
    expect(RAILWAY_CONFIG.build.watchPatterns).not.toContain('**/*')
    expect(RAILWAY_CONFIG.build.watchPatterns).not.toContain('.')
  })

  it('declares no duplicate or empty pattern', () => {
    const patterns = RAILWAY_CONFIG.build.watchPatterns
    expect(new Set(patterns).size).toBe(patterns.length)
    for (const pattern of patterns) expect(pattern.trim()).not.toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* 2. The Dockerfile's build context                                          */
/* -------------------------------------------------------------------------- */

describe('the Railway Dockerfile copies every evidence source into the build', () => {
  /** Destination-agnostic list of source paths the Dockerfile COPYs. */
  const copiedPaths = [...DOCKERFILE.matchAll(/^COPY(?:\s+--[^\s]+)*\s+(.+)$/gm)]
    .flatMap((match) => (match[1] as string).trim().split(/\s+/).slice(0, -1))
    // `--from=` stage copies reference paths inside an earlier stage, not the
    // build context, so they are not evidence sources.
    .filter((path) => !path.startsWith('/'))
  /** Directories the Dockerfile creates, which count as satisfied for a path the
   *  generator only ever LISTS (an empty `docs/findings/` is itself evidence). */
  const createdDirectories = [...DOCKERFILE.matchAll(/^RUN mkdir -p ([^\s]+)/gm)].map(
    (match) => (match[1] as string).replace(/^\.\//, '')
  )

  it('copies something', () => {
    expect(copiedPaths.length).toBeGreaterThan(3)
  })

  it('makes every read path available in the build context', () => {
    const available = [...copiedPaths, ...createdDirectories]
    const missing = READ_PATHS.filter(
      (path) =>
        !available.some(
          (copied) => path === copied || path.startsWith(`${copied.replace(/\/$/, '')}/`)
        )
    )
    expect(
      missing,
      'The manifest generator reads these, but portfolio/Dockerfile.railway does not copy ' +
        'them into the build context. `npm run manifest:check` runs inside the image, so this ' +
        'fails the Railway build — and only the Railway build:\n  ' +
        missing.join('\n  ')
    ).toEqual([])
  })

  it('does not copy the whole repository', () => {
    // Copying `.` would bring the Python package, the data sample and the whole
    // documentation tree into an image that serves fourteen static pages.
    for (const path of copiedPaths) {
      expect(path, 'the Dockerfile copies the entire context').not.toBe('.')
    }
  })
})

describe('.dockerignore does not exclude anything the build needs', () => {
  const ignorePatterns = DOCKERIGNORE.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))

  it('excludes the things that make the upload large or unsafe', () => {
    for (const expected of ['.git', 'node_modules', '.next']) {
      expect(ignorePatterns, `${expected} is not excluded`).toContain(expected)
    }
  })

  it('excludes credential material', () => {
    // Defence in depth: `.gitignore` keeps these out of the repository, and this
    // keeps a stray one in a working tree out of an image layer.
    for (const expected of ['.env', '.railway/state.json']) {
      expect(
        ignorePatterns,
        `${expected} is not excluded from the build context`
      ).toContain(expected)
    }
  })

  it('does not exclude an evidence source the generator reads', () => {
    const wronglyExcluded = READ_PATHS.filter((path) =>
      ignorePatterns.some((pattern) => {
        const bare = pattern.replace(/^\/+|\/+$/g, '')
        if (bare === '' || bare.includes('*')) return false
        return path === bare || path.startsWith(`${bare}/`)
      })
    )
    expect(
      wronglyExcluded,
      '.dockerignore excludes evidence the manifest generator reads:\n  ' +
        wronglyExcluded.join('\n  ')
    ).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Runtime and build invariants                                            */
/* -------------------------------------------------------------------------- */

describe('the Railway image honours the platform runtime contract', () => {
  it('runs as a non-root user', () => {
    expect(DOCKERFILE).toMatch(/^USER\s+(?!root)\S+/m)
  })

  it('creates that user rather than relying on a base-image detail', () => {
    expect(DOCKERFILE).toMatch(/adduser/)
  })

  it('sets NODE_ENV=production', () => {
    expect(DOCKERFILE).toMatch(/ENV NODE_ENV=production/)
  })

  it('binds to 0.0.0.0, not loopback', () => {
    // A server on 127.0.0.1 is unreachable from Railway's router, and the health
    // check fails with a connection refusal that reads as a crash.
    expect(DOCKERFILE).toMatch(/ENV HOSTNAME=0\.0\.0\.0/)
    expect(DOCKERFILE).not.toMatch(/ENV HOSTNAME=127\.0\.0\.1/)
    expect(DOCKERFILE).not.toMatch(/ENV HOSTNAME=localhost/)
  })

  it('respects the injected PORT rather than hard-coding one', () => {
    // The standalone server reads PORT from the environment. What must not happen
    // is a literal port in the start command.
    expect(DOCKERFILE).toMatch(/ENV PORT=/)
    expect(DOCKERFILE).not.toMatch(/CMD .*-p\s+\d{2,5}/)
    expect(DOCKERFILE).not.toMatch(/CMD .*--port\s+\d{2,5}/)
  })

  it('execs the server so node is PID 1 and receives SIGTERM', () => {
    // Without `exec`, the shell holds PID 1, ignores SIGTERM, and every
    // deployment ends in a kill after the grace period instead of a clean
    // shutdown.
    expect(DOCKERFILE).toMatch(/CMD \["sh", "-c", "exec node server\.js"\]/)
  })

  it('uses a multi-stage build with a separate runtime stage', () => {
    const stages = [...DOCKERFILE.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].map(
      (match) => match[1]
    )
    expect(stages).toEqual(['deps', 'builder', 'runtime'])
  })

  it('pins the base image to at least a minor version', () => {
    expect(DOCKERFILE).toMatch(/ARG NODE_VERSION=\d+\.\d+/)
  })

  it('declares an ARG for every build argument the specification lists', () => {
    // A Railway service variable is invisible to a Dockerfile build unless an ARG
    // of the same name is declared in the stage that consumes it.
    const project = JSON.parse(read('deployment/railway/project.config.json')) as {
      services: { portfolio: { buildArguments: string[] } }
    }
    for (const argument of project.services.portfolio.buildArguments) {
      expect(DOCKERFILE, `no ARG ${argument}`).toMatch(
        new RegExp(`^ARG ${argument}(=|\\s*$)`, 'm')
      )
    }
  })

  it('declares no ARG that could carry a secret', () => {
    // A build argument is recorded in the image's history, so a credential passed
    // as one is readable by anyone who can pull the image.
    const args = [...DOCKERFILE.matchAll(/^ARG ([A-Z_][A-Z0-9_]*)/gm)].map(
      (match) => match[1] as string
    )
    const suspicious = args.filter((name) =>
      /PASSWORD|SECRET|TOKEN|APIKEY|API_KEY|CREDENTIAL|DATABASE_URL/i.test(name)
    )
    expect(
      suspicious,
      `secret-shaped build argument(s): ${suspicious.join(', ')}`
    ).toEqual([])
  })

  it('runs the content-integrity gate inside the image', () => {
    // CI proves the committed manifest matches the repository. This proves it
    // matches the evidence that was actually copied into the build.
    expect(DOCKERFILE).toMatch(/RUN npm run manifest:check/)
  })

  it('runs the inventory freshness gate inside the image', () => {
    // Same argument, second generator: a stale `inventory-records.json` would
    // deploy a dealership experience whose counts no longer match the workbooks.
    expect(DOCKERFILE).toMatch(/RUN npm run inventory:check/)
  })

  it('copies the two directories standalone output does not populate', () => {
    // Omitting either produces a site that boots with no styling and no favicon.
    expect(DOCKERFILE).toMatch(/\.next\/static/)
    expect(DOCKERFILE).toMatch(/\/public/)
  })

  it('asserts the standalone layout before the runtime stage copies it', () => {
    expect(DOCKERFILE).toMatch(/test -f \.next\/standalone\/server\.js/)
  })

  it('keeps tests, SQL, the Power BI project and the workbooks out of the runtime stage', () => {
    // The workbooks in particular: the generated JSON is what the site serves,
    // and shipping the source spreadsheets into a public image would put the
    // pre-sanitization column set one `docker pull` away.
    const runtimeStage = DOCKERFILE.slice(DOCKERFILE.indexOf('AS runtime'))
    for (const forbidden of [
      '/tests',
      '/sql',
      '/powerbi',
      'playwright',
      'data/reference',
    ]) {
      expect(
        runtimeStage.includes(forbidden),
        `the runtime stage references ${forbidden}`
      ).toBe(false)
    }
  })
})

describe('next.config.ts is configured for the Railway runtime', () => {
  it('emits standalone output', () => {
    expect(NEXT_CONFIG).toMatch(/output:\s*'standalone'/)
  })

  it('pins the file-tracing root, so the standalone layout is not inferred', () => {
    // The layout of `.next/standalone` depends on where Next thinks the root is,
    // and the repository root now carries a package.json for the Railway tooling.
    // An inferred root would nest the output and the container would not find
    // server.js.
    expect(NEXT_CONFIG).toMatch(/outputFileTracingRoot/)
  })

  it('sets the security headers in the application, not only in a host config', () => {
    // `vercel.json` is not read by `next start`, so a header declared only there
    // disappears the moment the host changes.
    for (const header of [
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Robots-Tag',
    ]) {
      expect(NEXT_CONFIG, `${header} is not set in next.config.ts`).toContain(header)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 4. Deploy configuration                                                    */
/* -------------------------------------------------------------------------- */

describe('railway.json deploy configuration', () => {
  it('builds from the Dockerfile rather than auto-detecting', () => {
    // Auto-detection against the repository root would find a Python project and
    // a root package.json for the deployment tooling, and build neither correctly.
    expect(RAILWAY_CONFIG.build.builder).toBe('DOCKERFILE')
    expect(RAILWAY_CONFIG.build.dockerfilePath).toBe('portfolio/Dockerfile.railway')
  })

  it('health-checks a route that actually exists', () => {
    const path = RAILWAY_CONFIG.deploy['healthcheckPath']
    expect(path).toBe('/status')
    // Asserted against the route map rather than assumed, so deleting the route
    // fails here rather than at the next deployment.
    const site = read('portfolio/src/lib/site.ts')
    expect(site).toContain(`href: '${String(path)}'`)
  })

  it('does not restart forever on failure', () => {
    expect(RAILWAY_CONFIG.deploy['restartPolicyType']).toBe('ON_FAILURE')
    expect(RAILWAY_CONFIG.deploy['restartPolicyMaxRetries']).toBe(3)
  })

  it('contains no secret and no variable declaration', () => {
    // Config as Code is committed to a public repository, and it cannot set a
    // service variable anyway — a `variables` block here would read as though it
    // could.
    //
    // Matched on credential SHAPES rather than on the words "secret" or "token".
    // A substring rule fails on `scripts/check_secrets.py`, which is a legitimate
    // watch pattern, and a test that cries wolf on a correct file gets deleted.
    const serialised = JSON.stringify(RAILWAY_CONFIG)
    for (const shape of [
      /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:@/]+:[^\s:@/]+@/i,
      /\bpassword\s*[:=]/i,
      /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]/i,
      /\bghp_[A-Za-z0-9]{36}\b/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ]) {
      expect(
        serialised,
        `railway.json matches the credential shape ${String(shape)}`
      ).not.toMatch(shape)
    }
    expect(RAILWAY_CONFIG).not.toHaveProperty('variables')
    expect(RAILWAY_CONFIG.deploy).not.toHaveProperty('variables')
  })
})
