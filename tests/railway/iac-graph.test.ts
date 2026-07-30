/**
 * The IaC declaration, compiled and inspected.
 *
 * These are the strongest assertions in this repository about the Railway
 * deployment, and they run offline with no credential. `railway-iac-ts evaluate`
 * is the SDK's own compiler: it produces the resource graph Railway would
 * converge onto, and it TAGS each variable as a literal, a reference, or a
 * server-side generator.
 *
 * That tagging is what turns the two claims this deployment rests on into
 * mechanical checks rather than assertions in a document:
 *
 *   "no database credential is copied into the website"
 *   "cross-service values are references, not copies"
 *
 * Both are properties of the compiled graph, so they are checked here — before
 * anything is deployed, on a fork, with no secrets configured.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateIac,
  findResource,
  generatedKeys,
  literalKeys,
  literalSecretViolations,
  referenceKeys,
  variablesOf,
  type RailwayGraph,
} from '../../scripts/railway/lib/iac.ts'
import { loadSpecification } from '../../scripts/railway/lib/spec.ts'

const spec = loadSpecification()
const PORTFOLIO = spec.project.services.portfolio.name
const POSTGRES = spec.project.services.postgres.name
const JOB = spec.project.services.databaseSetup.name

const evaluation = await evaluateIac({
  environmentName: spec.project.project.environment,
})

describe('the declaration compiles', () => {
  it('evaluates without an error diagnostic', () => {
    expect(evaluation.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(evaluation.ok).toBe(true)
    expect(evaluation.graph).toBeDefined()
  })

  it('reports the SDK version, so a runner mismatch is attributable', () => {
    expect(evaluation.sdkVersion).toBe(spec.tooling.railwaySdk.version)
  })

  it('emits the graph version the tooling specification records', () => {
    expect(evaluation.graph?.version).toBe(spec.tooling.railwaySdk.graphVersion)
  })
})

const graph = evaluation.graph as RailwayGraph

describe('project and environment', () => {
  it('declares the specified project', () => {
    expect(graph.project.name).toBe(spec.project.project.name)
  })

  it('declares exactly one environment, and it is not production', () => {
    // Declaring production would CREATE it. Not declaring it is the control.
    expect(graph.environments.map((e) => e.name)).toEqual([
      spec.project.project.environment,
    ])
  })
})

describe('the production guard actually fires', () => {
  it('refuses to evaluate against the production environment', async () => {
    // A guard nobody has watched fail is a guard nobody should trust. This proves
    // `railway config apply` against production cannot even produce a graph.
    const production = await evaluateIac({
      environmentName: spec.project.project.productionEnvironment,
    })
    expect(production.ok).toBe(false)
    expect(production.graph).toBeUndefined()
    expect(JSON.stringify(production.diagnostics)).toMatch(/production/i)
  })
})

describe('the website', () => {
  const portfolio = findResource(graph, PORTFOLIO)

  it('exists as a GitHub-sourced service', () => {
    expect(portfolio).toBeDefined()
    expect(portfolio?.kind).toBe('github')
    expect(portfolio?.source?.repo).toBe(spec.project.repository.slug)
    expect(portfolio?.source?.branch).toBe(spec.project.repository.deploymentBranch)
  })

  it('waits for GitHub CI before deploying', () => {
    // Railway's `checkSuites`. The two existing workflows are the gate that proves
    // the manifest is current; deploying before they finish publishes first and
    // checks afterwards.
    expect(portfolio?.source?.checkSuites).toBe(true)
  })

  it('keeps the repository root as the build context', () => {
    // Not `/portfolio`. The build regenerates the project manifest from evidence
    // outside portfolio/ and fails if it disagrees with the committed one, so an
    // isolated context cannot build at all.
    expect(portfolio?.source?.rootDirectory ?? null).toBeNull()
  })

  it('builds the Railway Dockerfile', () => {
    expect(portfolio?.build?.builder).toBe('DOCKERFILE')
    expect(portfolio?.build?.dockerfilePath).toBe(spec.railwayConfig.build.dockerfilePath)
  })

  it('carries the watch patterns from railway.json, not a second copy of them', () => {
    // The declaration IMPORTS railway.json. Equality here is what proves there is
    // one source of truth for the build rather than two that agree today.
    expect(portfolio?.build?.watchPatterns).toEqual(spec.railwayConfig.build.watchPatterns)
  })

  it('carries the deploy configuration from railway.json', () => {
    expect(portfolio?.deploy?.healthcheckPath).toBe(spec.railwayConfig.deploy.healthcheckPath)
    expect(portfolio?.deploy?.healthcheckTimeout).toBe(
      spec.railwayConfig.deploy.healthcheckTimeout
    )
    expect(portfolio?.deploy?.restartPolicyType).toBe(
      spec.railwayConfig.deploy.restartPolicyType
    )
    expect(portfolio?.deploy?.numReplicas).toBe(spec.railwayConfig.deploy.numReplicas)
  })

  it('sets no configFile, so Railway keeps managing it declaratively', () => {
    // Railway's IaC refuses to converge a service whose configFile names a
    // railway.json or railway.toml. Setting it would converge the service once
    // and then never again — which destroys the idempotency this design rests on.
    expect(portfolio?.configFile).toBeUndefined()
  })

  /* --- The claims that matter -------------------------------------------- */

  it('requires NO user-typed variable: only two automatic non-secret literals', () => {
    expect(literalKeys(portfolio)).toEqual([
      'NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED',
      'RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
    ])
  })

  it('does not set a site URL variable at all', () => {
    // The origin comes from the platform's RAILWAY_PUBLIC_DOMAIN, consumed as a
    // Docker build argument. Neither ARPI_SITE_URL nor NEXT_PUBLIC_SITE_URL is
    // needed, which is the whole point of the resolver.
    const keys = Object.keys(variablesOf(portfolio))
    expect(keys).not.toContain('ARPI_SITE_URL')
    expect(keys).not.toContain('NEXT_PUBLIC_SITE_URL')
  })

  it('states the case-study flag as false rather than leaving it to absence', () => {
    const flag = variablesOf(portfolio)['NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED']
    expect(flag?.type).toBe('literal')
    expect(flag && 'value' in flag ? flag.value : undefined).toBe('false')
  })

  it('references NOTHING — it has no runtime data source', () => {
    expect(referenceKeys(portfolio)).toEqual([])
    expect(graph.edges.filter((edge) => edge.from === `service.${PORTFOLIO}`)).toEqual([])
  })

  it('carries no forbidden variable', () => {
    const forbidden = spec.variables.services[PORTFOLIO]?.forbiddenVariables ?? []
    const present = Object.keys(variablesOf(portfolio)).filter((key) =>
      forbidden.includes(key)
    )
    expect(present).toEqual([])
  })

  it('declares no literal that looks like a credential', () => {
    expect(literalSecretViolations(portfolio)).toEqual([])
  })
})

describe('the database', () => {
  const postgres = findResource(graph, POSTGRES)

  it('is Railway\'s official PostgreSQL, on the SSL-terminating image', () => {
    expect(postgres?.type).toBe('database')
    expect(postgres?.engine).toBe('postgres')
    expect(postgres?.image).toMatch(
      new RegExp(`^${spec.project.services.postgres.expectedImagePrefix ?? ''}`)
    )
  })

  it('declares the persistent volume mount path the specification requires', () => {
    // Railway's apply path creates a volume for a database that has a default
    // mount path and does not already have one, so this is what makes the volume
    // appear — and makes re-applying not create a second.
    expect(postgres?.defaultMountPath).toBe(spec.project.services.postgres.volume?.mountPath)
  })

  it('authors no variable of its own', () => {
    // Every variable on this service is published by Railway's template. Authoring
    // one here would mean this repository owns a value the platform also owns.
    const authored = spec.variables.services[POSTGRES]
    expect(Object.keys(authored?.userDefinedVariables ?? {})).toEqual([])
  })
})

describe('the provisioning job', () => {
  const job = findResource(graph, JOB)

  it('exists and is not a web service', () => {
    expect(job).toBeDefined()
    expect(job?.deploy?.healthcheckPath).toBeUndefined()
    expect(job?.deploy?.restartPolicyType).toBe('NEVER')
  })

  it('gets every database value as a REFERENCE, not a copy', () => {
    const expected = Object.keys(
      spec.variables.services[JOB]?.referenceVariables ?? {}
    ).sort()
    expect(referenceKeys(job)).toEqual(expected)
  })

  it('points every reference at the database service by address', () => {
    for (const [key, value] of Object.entries(variablesOf(job))) {
      if (value.type !== 'reference') continue
      expect(value.resource, key).toBe(`database.${POSTGRES}`)
    }
  })

  it('references DATABASE_URL and PGPASSWORD rather than holding them', () => {
    // The two values that are genuinely secret. A reference means the platform
    // resolves them at deploy time and this repository never contains them.
    const variables = variablesOf(job)
    for (const key of ['DATABASE_URL', 'PGPASSWORD']) {
      expect(variables[key]?.type, key).toBe('reference')
    }
  })

  it('takes the TCP proxy coordinates by reference, so nothing is hardcoded', () => {
    const variables = variablesOf(job)
    const domain = variables['ARPI_TCP_PROXY_DOMAIN']
    const port = variables['ARPI_TCP_PROXY_PORT']
    expect(domain?.type).toBe('reference')
    expect(port?.type).toBe('reference')
    expect(domain && 'output' in domain ? domain.output : '').toBe('RAILWAY_TCP_PROXY_DOMAIN')
    expect(port && 'output' in port ? port.output : '').toBe('RAILWAY_TCP_PROXY_PORT')
  })

  it('has both role passwords GENERATED by Railway, not by this repository', () => {
    expect(generatedKeys(job)).toEqual(['ARPI_FABRIC_PASSWORD', 'ARPI_PIPELINE_PASSWORD'])
  })

  it('uses a generator strong enough for a credential that leaves Railway', () => {
    for (const key of ['ARPI_FABRIC_PASSWORD', 'ARPI_PIPELINE_PASSWORD']) {
      const variable = variablesOf(job)[key]
      const generator =
        variable?.type === 'raw' ? (variable.value.generator ?? '') : ''
      expect(generator, key).toMatch(/^secret\((\d+),/)
      const length = Number(/^secret\((\d+),/.exec(generator)?.[1] ?? '0')
      expect(length, key).toBeGreaterThanOrEqual(32)
    }
  })

  it('declares no literal that looks like a credential', () => {
    expect(literalSecretViolations(job)).toEqual([])
  })

  it('holds no Railway token', () => {
    // It needs none: every value it reads is a reference the platform resolves,
    // and its passwords are generated by the platform.
    expect(Object.keys(variablesOf(job))).not.toContain('RAILWAY_API_TOKEN')
  })

  it('requires TLS and pins the deterministic profile', () => {
    const variables = variablesOf(job)
    const sslmode = variables['ARPI_DATABASE__SSLMODE']
    const profile = variables['ARPI_PROFILE']
    expect(sslmode && 'value' in sslmode ? sslmode.value : '').toMatch(
      /^(?:require|verify-ca|verify-full)$/
    )
    expect(profile && 'value' in profile ? profile.value : '').toBe('development')
  })
})

describe('the whole graph', () => {
  it('contains exactly the three declared resources', () => {
    const names = graph.resources
      .filter((resource) => resource.type === 'service' || resource.type === 'database')
      .map((resource) => resource.name)
      .sort()
    expect(names).toEqual([JOB, PORTFOLIO, POSTGRES].sort())
  })

  it('contains no literal credential anywhere', () => {
    // A sweep over every resource, so a service added later without its own test
    // is still covered.
    for (const resource of graph.resources) {
      expect(literalSecretViolations(resource), resource.name).toEqual([])
    }
  })

  it('serialises without any value that looks like a resolved credential', () => {
    const serialised = JSON.stringify(graph)
    expect(serialised).not.toMatch(
      /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:@/"]+:[^\s:@/"]+@/i
    )
    expect(serialised).not.toMatch(/\bghp_[A-Za-z0-9]{36}\b/)
  })

  it('has every dependency edge pointing at the database, from the job only', () => {
    const variableEdges = graph.edges.filter((edge) => edge.type === 'variable')
    expect(variableEdges.length).toBeGreaterThanOrEqual(8)
    for (const edge of variableEdges) {
      expect(edge.from).toBe(`service.${JOB}`)
      expect(edge.to).toBe(`database.${POSTGRES}`)
    }
  })
})

describe('evaluation is deterministic', () => {
  it('produces an identical graph on a second run', () => {
    // Idempotency starts here: a declaration that compiled differently each time
    // would make `railway config plan` report phantom changes forever, and a plan
    // that is never empty is a plan nobody reads.
    return evaluateIac({ environmentName: spec.project.project.environment }).then(
      (second) => {
        expect(JSON.stringify(second.graph)).toBe(JSON.stringify(graph))
      }
    )
  })
})
