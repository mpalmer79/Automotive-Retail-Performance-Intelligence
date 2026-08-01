/**
 * The deployment specification, and the guards on it.
 *
 * The specification is the only place a service name, an environment name, a
 * health-check path or a required variable key is written down. Everything else
 * reads it, so a mistake in it propagates to the IaC declaration, the bootstrap
 * tool, the verifier and the workflow at once.
 *
 * Two kinds of test here. The first asserts the committed specification is valid
 * and says what this project actually requires. The second — the more useful half
 * — corrupts a copy in each way that matters and asserts the validator catches it,
 * because a validator nobody has seen fail is a validator nobody should trust.
 */
import { describe, expect, it } from 'vitest'

import {
  loadSpecification,
  validateSpecification,
  type LoadedSpecification,
} from '../../scripts/railway/lib/spec.ts'

const spec = loadSpecification()

/** A deep copy, so a mutation in one test cannot reach another. */
function mutate(change: (draft: LoadedSpecification) => void): LoadedSpecification {
  const draft = structuredClone(spec)
  change(draft)
  return draft
}

function errorsOf(draft: LoadedSpecification): string {
  return validateSpecification(draft).errors.join('\n')
}

describe('the committed specification is valid', () => {
  it('passes validation with no errors', () => {
    const result = validateSpecification(spec)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('passes with no warnings either', () => {
    // A warning is not a failure, but an accumulation of accepted warnings is how
    // a validator stops being read.
    expect(validateSpecification(spec).warnings).toEqual([])
  })
})

describe('it describes the deployment this project actually wants', () => {
  it('targets a staging environment that is not production', () => {
    expect(spec.project.project.environment).toBe('staging')
    expect(spec.project.project.productionEnvironment).toBe('production')
    expect(spec.project.project.createProductionEnvironment).toBe(false)
  })

  it('declares three services and no general-purpose backend', () => {
    const names = Object.values(spec.project.services).map((service) => service.name)
    expect(names).toEqual(['arpi-portfolio', 'Postgres', 'arpi-database-setup'])
    expect(spec.project.deliberatelyAbsent['backendWebService']).toMatch(/no general-purpose/i)
  })

  it('keeps the repository root as the website build context', () => {
    // The assertion that protects the content-integrity gate: the website's build
    // reads evidence from outside portfolio/ and cannot complete without it.
    expect(spec.project.services.portfolio.rootDirectory).toBeNull()
    expect(spec.project.services.portfolio.buildContext).toBe('repository-root')
  })

  it('waits for GitHub CI before deploying', () => {
    expect(spec.project.repository.waitForCiChecks).toBe(true)
  })

  it('requires exactly one GitHub Actions secret', () => {
    const required = Object.entries(spec.variables.githubActionsSecrets)
      .filter(([, value]) => value.required)
      .map(([key]) => key)
    expect(required).toEqual(['RAILWAY_API_TOKEN'])
  })

  it('deliberately keeps database coordinates OUT of GitHub secrets', () => {
    // Duplicating them would create a second copy of a credential with its own
    // rotation problem and a second place to leak it from.
    for (const key of [
      'DATABASE_URL',
      'PGHOST',
      'PGPORT',
      'PGUSER',
      'PGPASSWORD',
      'PGDATABASE',
      'RAILWAY_PUBLIC_DOMAIN',
      'RAILWAY_TCP_PROXY_DOMAIN',
      'RAILWAY_TCP_PROXY_PORT',
    ]) {
      expect(spec.variables.githubActionsSecretsDeliberatelyAbsent).toContain(key)
      expect(spec.variables.githubActionsSecrets[key]).toBeUndefined()
    }
  })

  it('requires no user-defined variable on the website', () => {
    const portfolio = spec.variables.services['arpi-portfolio']
    expect(Object.keys(portfolio?.userDefinedVariables ?? {})).toEqual([])
  })

  it('forbids every database credential on the website', () => {
    const forbidden = spec.variables.services['arpi-portfolio']?.forbiddenVariables ?? []
    for (const key of [
      'DATABASE_URL',
      'DATABASE_PUBLIC_URL',
      'PGPASSWORD',
      'POSTGRES_PASSWORD',
      'ARPI_FABRIC_PASSWORD',
      'RAILWAY_API_TOKEN',
    ]) {
      expect(forbidden, `${key} is not forbidden on the website`).toContain(key)
    }
  })

  it('expresses every cross-service value as a reference, never a copy', () => {
    const references = spec.variables.services['arpi-database-setup']?.referenceVariables ?? {}
    expect(Object.keys(references).length).toBeGreaterThanOrEqual(8)
    for (const [key, reference] of Object.entries(references)) {
      expect(reference.expression, key).toMatch(/^\$\{\{[A-Za-z0-9_.-]+\.[A-Za-z0-9_]+\}\}$/)
      expect(reference.copied, key).toBe(false)
    }
  })

  it('generates both role passwords server-side and never rotates them per deploy', () => {
    const generated = spec.variables.services['arpi-database-setup']?.generatedVariables ?? {}
    expect(Object.keys(generated).sort()).toEqual([
      'ARPI_FABRIC_PASSWORD',
      'ARPI_PIPELINE_PASSWORD',
    ])
    for (const [key, value] of Object.entries(generated)) {
      expect(value.generator, key).toMatch(/^secret\(\d+,\s*".+"\)$/)
      expect(value.rotateOnEveryDeploy, key).not.toBe(true)
    }
  })

  it('requires a volume, TLS and a TCP proxy on the database', () => {
    const postgres = spec.project.services.postgres
    expect(postgres.volume?.required).toBe(true)
    expect(postgres.ssl?.required).toBe(true)
    expect(postgres.tcpProxy?.required).toBe(true)
    expect(postgres.tcpProxy?.applicationPort).toBe(5432)
    // A database needs a TCP proxy, not an HTTP domain.
    expect(postgres.publicNetworking.required).toBe(false)
  })

  it('keeps the provisioning job from becoming a backend', () => {
    const job = spec.project.services.databaseSetup
    expect(job.role).toBe('one-time-job')
    expect(job.restartPolicyType).toBe('NEVER')
    expect(job.healthcheckPath).toBeNull()
    expect(job.publicNetworking.required).toBe(false)
    expect(job.publicNetworking.generateRailwayDomain).toBe(false)
  })

  it('agrees with railway.json about the build', () => {
    expect(spec.project.services.portfolio.dockerfilePath).toBe(
      spec.railwayConfig.build.dockerfilePath
    )
    expect(spec.project.services.portfolio.healthcheckPath).toBe(
      spec.railwayConfig.deploy.healthcheckPath
    )
  })
})

describe('the validator catches each mistake that matters', () => {
  it('rejects targeting production', () => {
    expect(errorsOf(mutate((d) => (d.project.project.environment = 'production')))).toMatch(
      /production environment/i
    )
  })

  it('rejects being asked to create production', () => {
    expect(
      errorsOf(mutate((d) => (d.project.project.createProductionEnvironment = true)))
    ).toMatch(/createProductionEnvironment is true/)
  })

  it('rejects an isolated website build context', () => {
    // The single most damaging misconfiguration available: the build would fail,
    // or worse, succeed against evidence it could not see.
    expect(
      errorsOf(mutate((d) => (d.project.services.portfolio.rootDirectory = '/portfolio')))
    ).toMatch(/rootDirectory must be null/)
    expect(
      errorsOf(mutate((d) => (d.project.services.portfolio.buildContext = 'portfolio')))
    ).toMatch(/buildContext must be "repository-root"/)
  })

  it('rejects a website that claims to need a database', () => {
    expect(
      errorsOf(mutate((d) => (d.project.services.portfolio.requiresDatabase = true)))
    ).toMatch(/requiresDatabase must be false/)
  })

  it('rejects a required user-defined variable on the website', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const service = d.variables.services['arpi-portfolio']
          if (service) service.userDefinedVariables = { NEXT_PUBLIC_SITE_URL: {} }
        })
      )
    ).toMatch(/must require none/)
  })

  it('rejects dropping DATABASE_URL from the website\'s forbidden list', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const service = d.variables.services['arpi-portfolio']
          if (service) {
            service.forbiddenVariables = (service.forbiddenVariables ?? []).filter(
              (key) => key !== 'DATABASE_URL'
            )
          }
        })
      )
    ).toMatch(/must forbid DATABASE_URL/)
  })

  it('rejects a variable that is both forbidden and declared', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const service = d.variables.services['arpi-portfolio']
          if (service) {
            service.optionalVariables = {
              ...(service.optionalVariables ?? {}),
              DATABASE_URL: { required: false },
            }
          }
        })
      )
    ).toMatch(/both forbids and declares/)
  })

  it('rejects a copied cross-service value', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const references = d.variables.services['arpi-database-setup']?.referenceVariables
          if (references?.['DATABASE_URL']) references['DATABASE_URL'].copied = true
        })
      )
    ).toMatch(/must be references/)
  })

  it('rejects a reference expression that is not one', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const references = d.variables.services['arpi-database-setup']?.referenceVariables
          if (references?.['DATABASE_URL']) {
            references['DATABASE_URL'].expression =
              'postgres://postgres:placeholder-copied@db.internal:5432/railway'
          }
        })
      )
    ).toMatch(/not a Railway reference/)
  })

  it('rejects a weak password generator', () => {
    expect(
      errorsOf(
        mutate((d) => {
          const generated = d.variables.services['arpi-database-setup']?.generatedVariables
          if (generated?.['ARPI_FABRIC_PASSWORD']) {
            generated['ARPI_FABRIC_PASSWORD'].generator = 'secret(8, "abc")'
          }
        })
      )
    ).toMatch(/only 8 characters/)
  })

  it('rejects a password that rotates on every deploy', () => {
    // Rotating the Fabric credential on an unrelated commit breaks a configured
    // connection, and a credential that breaks downstream on every deploy gets
    // replaced with a permanent one by whoever is on call.
    expect(
      errorsOf(
        mutate((d) => {
          const generated = d.variables.services['arpi-database-setup']?.generatedVariables
          if (generated?.['ARPI_FABRIC_PASSWORD']) {
            generated['ARPI_FABRIC_PASSWORD'].rotateOnEveryDeploy = true
          }
        })
      )
    ).toMatch(/rotate on every deploy/)
  })

  it('rejects a job that restarts', () => {
    expect(
      errorsOf(mutate((d) => (d.project.services.databaseSetup.restartPolicyType = 'ALWAYS')))
    ).toMatch(/must be NEVER/)
  })

  it('rejects giving the job a public domain', () => {
    expect(
      errorsOf(
        mutate((d) => {
          d.project.services.databaseSetup.publicNetworking.required = true
        })
      )
    ).toMatch(/must not have public networking/)
  })

  it('rejects a database with no volume', () => {
    expect(
      errorsOf(
        mutate((d) => {
          if (d.project.services.postgres.volume) {
            d.project.services.postgres.volume.required = false
          }
        })
      )
    ).toMatch(/volume\.required must be true/)
  })

  it('rejects a database with no TCP proxy', () => {
    expect(
      errorsOf(
        mutate((d) => {
          if (d.project.services.postgres.tcpProxy) {
            d.project.services.postgres.tcpProxy.required = false
          }
        })
      )
    ).toMatch(/tcpProxy\.required must be true/)
  })

  it('rejects a disagreement with railway.json', () => {
    expect(
      errorsOf(mutate((d) => (d.railwayConfig.build.dockerfilePath = 'Dockerfile')))
    ).toMatch(/disagrees with railway\.json/)
    expect(
      errorsOf(mutate((d) => (d.railwayConfig.deploy.healthcheckPath = '/healthz')))
    ).toMatch(/disagrees with railway\.json/)
  })

  it('rejects abandoning the Dockerfile builder', () => {
    expect(errorsOf(mutate((d) => (d.railwayConfig.build.builder = 'NIXPACKS')))).toMatch(
      /must be DOCKERFILE/
    )
  })

  it('rejects duplicate service names', () => {
    expect(
      errorsOf(mutate((d) => (d.project.services.databaseSetup.name = 'arpi-portfolio')))
    ).toMatch(/not unique/)
  })

  it('rejects a malformed repository slug', () => {
    expect(errorsOf(mutate((d) => (d.project.repository.slug = 'not-a-slug')))).toMatch(
      /owner\/repo form/
    )
  })

  it('rejects a second required GitHub secret', () => {
    expect(
      errorsOf(
        mutate((d) => {
          d.variables.githubActionsSecrets['PGPASSWORD'] = { required: true }
        })
      )
    ).toMatch(/Exactly one GitHub Actions secret/)
  })

  it('rejects an unsupported spec version', () => {
    expect(errorsOf(mutate((d) => (d.project.specVersion = 2)))).toMatch(
      /unsupported specVersion/
    )
  })
})

describe('no credential may appear in the specification', () => {
  it.each([
    ['a connection URI', 'postgres://postgres:placeholder-not-real@db.internal:5432/railway'],
    ['a GitHub token', 'ghp_placeholderplaceholderplaceholder123'],
    // Assembled, not written: see the note beside PRIVATE_KEY_BEGIN in
    // redact.test.ts for why the literal must not appear in the tree.
    ['a private key', `${['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')}MIIEvQ`],
  ])('rejects %s appearing anywhere', (_label, value) => {
    // The specification is committed to a public repository. A value that LOOKS
    // like a credential is a defect regardless of whether it is real.
    expect(
      errorsOf(
        mutate((d) => {
          d.project.deliberatelyAbsent['smuggled'] = value
        })
      )
    ).toMatch(/committed to\s+a public repository|looks like/i)
  })

  it('rejects a bare UUID that could be a project token', () => {
    expect(
      errorsOf(
        mutate((d) => {
          d.project.deliberatelyAbsent['smuggled'] = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        })
      )
    ).toMatch(/looks like/i)
  })

  it('tolerates the reference and generator syntax, which contain no secret', () => {
    // `${{Postgres.DATABASE_URL}}` names a credential without being one, and
    // `secret(48, "...")` is an instruction rather than a value. A rule that
    // flagged either would make the correct design unexpressible.
    const result = validateSpecification(spec)
    expect(result.errors).toEqual([])
    const serialised = JSON.stringify(spec.variables)
    expect(serialised).toContain('${{Postgres.DATABASE_URL}}')
    expect(serialised).toContain('secret(')
  })
})
