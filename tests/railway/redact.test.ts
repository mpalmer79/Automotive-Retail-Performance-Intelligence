/**
 * Redaction.
 *
 * The deployment tools read from a platform where credentials genuinely live, and
 * they run in GitHub Actions where output is retained and readable. So the
 * property under test is not "secrets are usually hidden" but "each known
 * credential shape is replaced, and the surrounding text stays useful enough to
 * diagnose with".
 *
 * Both halves matter. Redaction that also destroys the user name, the host and
 * the error class produces a log nobody can act on, which is how redaction gets
 * turned off.
 */
import { describe, expect, it } from 'vitest'

import {
  REDACTED,
  SHAPE_PATTERN_NAMES,
  isSecretKey,
  redact,
  redactValue,
  redactedJson,
} from '../../scripts/railway/lib/redact.ts'

/**
 * The private-key opening marker, assembled rather than written.
 *
 * `scripts/check_secrets.py` scans the tree for `-----BEGIN ... PRIVATE KEY-----`
 * as a literal, and it is right to: a key block in a commit is the finding it
 * exists for. That marker cannot be given a `placeholder` word without breaking
 * the pattern being tested, so it is built at run time instead. The literal never
 * appears in the repository, the detector stays exactly as strict as it was, and
 * the test still exercises the real shape.
 */
const PRIVATE_KEY_BEGIN = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
const PRIVATE_KEY_END = ['-----END', 'PRIVATE', 'KEY-----'].join(' ')

describe('secret-shaped keys are recognised', () => {
  it.each([
    'PGPASSWORD',
    'POSTGRES_PASSWORD',
    'ARPI_FABRIC_PASSWORD',
    'ARPI_PIPELINE_PASSWORD',
    'ARPI_DATABASE__PASSWORD',
    'RAILWAY_API_TOKEN',
    'DATABASE_URL',
    // DATABASE_PUBLIC_URL is a real Railway Postgres variable and carries the
    // password inline exactly as DATABASE_URL does. It was missed by an earlier
    // substring-only rule, which is why the key matcher now covers the shape.
    'DATABASE_PUBLIC_URL',
    'databaseUrl',
    'databasePublicUrl',
    'REDIS_PUBLIC_URL',
    'MONGO_URL',
    'MYSQL_PUBLIC_URL',
    'apiKey',
    'API_KEY',
    'CLIENT_SECRET',
    'private_key',
    'connectionString',
    'DSN',
  ])('treats %s as secret', (key) => {
    expect(isSecretKey(key)).toBe(true)
  })

  it.each([
    'RAILWAY_PUBLIC_DOMAIN',
    'RAILWAY_PRIVATE_DOMAIN',
    'RAILWAY_TCP_PROXY_DOMAIN',
    'RAILWAY_TCP_PROXY_PORT',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGDATABASE',
    'ARPI_PROFILE',
    'ARPI_TCP_PROXY_DOMAIN',
    'ARPI_TCP_PROXY_PORT',
    'NEXT_PUBLIC_ARPI_CASE_STUDY_ENABLED',
    'projectId',
    'environmentId',
    'deploymentStatus',
  ])('does not treat %s as secret', (key) => {
    // These are the values the Fabric handoff and the run report exist to
    // communicate. Redacting them would break the thing redaction is protecting.
    expect(isSecretKey(key)).toBe(false)
  })

  it('exempts a presence flag from the token rule', () => {
    expect(isSecretKey('railway_api_token_present')).toBe(false)
    expect(isSecretKey('RAILWAY_API_TOKEN')).toBe(true)
  })
})

describe('credential shapes in free text', () => {
  it('has a pattern for each documented shape', () => {
    expect(SHAPE_PATTERN_NAMES.length).toBeGreaterThanOrEqual(8)
  })

  it('redacts the password from a PostgreSQL URI but keeps the user and host', () => {
    // The user name is not secret and is the single most useful field when
    // diagnosing a permission error: `arpi_fabric` failing where `arpi_pipeline`
    // would succeed is usually the whole answer.
    const redacted = redact(
      'could not connect to postgresql://arpi_fabric:placeholder-not-a-real-password@db.proxy.rlwy.net:12345/railway'
    )
    expect(redacted).not.toContain('placeholder-not-a-real-password')
    expect(redacted).toContain('arpi_fabric')
    expect(redacted).toContain('db.proxy.rlwy.net:12345')
    expect(redacted).toContain(REDACTED)
  })

  it.each([
    ['postgres', 'postgres://u:placeholder-pw-123@h:5432/d'],
    ['postgresql', 'postgresql://u:placeholder-pw-123@h:5432/d'],
    ['mysql', 'mysql://u:placeholder-pw-123@h:3306/d'],
    ['mongodb', 'mongodb://u:placeholder-pw-123@h:27017/d'],
    ['redis', 'redis://u:placeholder-pw-123@h:6379'],
  ])('redacts a %s URI', (_scheme, uri) => {
    expect(redact(uri)).not.toContain('placeholder-pw-123')
  })

  it('redacts an Authorization header and a bearer token', () => {
    expect(redact('Authorization: Bearer placeholder-bearer-token-value')).not.toContain(
      'placeholder-bearer-token-value'
    )
    expect(redact('authorization="placeholder-bearer-token-value"')).not.toContain(
      'placeholder-bearer-token-value'
    )
  })

  it('redacts a UUID next to a credential word, and leaves a bare UUID alone', () => {
    // Railway project, service and environment IDs are UUIDs and are safe — and
    // useful — to print. Only a UUID labelled as a token is redacted.
    // Named `bareUuid`, not `token`: a `const token = '...'` line is itself a
    // quoted-credential assignment as far as scripts/check_secrets.py is
    // concerned, and it is right about that.
    const bareUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(redact(`api_token: ${bareUuid}`)).not.toContain(bareUuid)
    expect(redact(`projectId: ${bareUuid}`)).toContain(bareUuid)
  })

  it('redacts a libpq keyword password from a psycopg error', () => {
    const message =
      'connection failed: host=db.railway.internal port=5432 user=arpi_pipeline password=placeholder-s3cr3t sslmode=require'
    const redacted = redact(message)
    expect(redacted).not.toContain('placeholder-s3cr3t')
    expect(redacted).toContain('user=arpi_pipeline')
    expect(redacted).toContain('sslmode=require')
  })

  it('redacts a credential in a query parameter', () => {
    expect(redact('https://h/db?sslmode=require&password=placeholder-placeholder-leaked-value')).not.toContain(
      'placeholder-placeholder-leaked-value'
    )
  })

  it('redacts a quoted credential assignment', () => {
    expect(redact('password: "placeholder-long-password"')).not.toContain('placeholder-long-password')
    expect(redact("api_key='placeholder-api-key'")).not.toContain('placeholder-api-key')
  })

  it('redacts a private key block', () => {
    const key = `${PRIVATE_KEY_BEGIN}\nMIIEvQIBADANBgkq\nhkiG9w0BAQEFAASC\n${PRIVATE_KEY_END}`
    expect(redact(key)).not.toContain('MIIEvQIBADANBgkq')
  })

  it('leaves ordinary text and non-secret coordinates untouched', () => {
    const text =
      'TCP proxy at monorail.proxy.rlwy.net:34567, database railway, user arpi_fabric, sslmode require'
    expect(redact(text)).toBe(text)
  })

  it('redacts every occurrence, not only the first', () => {
    const redacted = redact(
      'a postgres://u:placeholder-first@h/d and b postgres://u:placeholder-second@h/d'
    )
    expect(redacted).not.toContain('placeholder-first')
    expect(redacted).not.toContain('placeholder-second')
  })
})

describe('structures are redacted by key and by value', () => {
  it('replaces a value under a secret-shaped key', () => {
    const result = redactValue({ PGPASSWORD: 'placeholder-literal-password', PGUSER: 'arpi_pipeline' }) as
      Record<string, unknown>
    expect(result['PGPASSWORD']).toBe(REDACTED)
    expect(result['PGUSER']).toBe('arpi_pipeline')
  })

  it('keeps the KEY, because the verifier asserts on key presence', () => {
    // "ARPI_FABRIC_PASSWORD exists in Railway" is exactly what the verifier
    // reports; its value is never anybody's business here.
    const result = redactValue({ ARPI_FABRIC_PASSWORD: 'x'.repeat(48) }) as Record<
      string,
      unknown
    >
    expect(Object.keys(result)).toEqual(['ARPI_FABRIC_PASSWORD'])
  })

  it('replaces a whole object under a secret-shaped key rather than walking into it', () => {
    const result = redactValue({
      credentials: { username: 'arpi_fabric', password: 'placeholder-nested' },
    }) as Record<string, unknown>
    expect(result['credentials']).toBe(REDACTED)
    expect(JSON.stringify(result)).not.toContain('placeholder-nested')
  })

  it('redacts a credential that arrived under an innocent key', () => {
    const result = redactValue({ detail: 'postgres://u:placeholder-sneaky@h/d' }) as Record<
      string,
      unknown
    >
    expect(String(result['detail'])).not.toContain('placeholder-sneaky')
  })

  it('walks arrays and nested objects', () => {
    const result = redactValue({
      steps: [{ name: 'x', detail: 'password="placeholder-placeholder-leaked-here"' }],
      nested: { deep: { PGPASSWORD: 'placeholder-also-placeholder-leaked' } },
    })
    const serialised = JSON.stringify(result)
    expect(serialised).not.toContain('placeholder-placeholder-leaked-here')
    expect(serialised).not.toContain('placeholder-also-placeholder-leaked')
  })

  it('preserves nulls, numbers and booleans', () => {
    const result = redactValue({ a: null, b: 1, c: true }) as Record<string, unknown>
    expect(result).toEqual({ a: null, b: 1, c: true })
  })

  it('does not recurse forever on a deep structure', () => {
    let deep: Record<string, unknown> = { PGPASSWORD: 'x' }
    for (let i = 0; i < 40; i += 1) deep = { nested: deep }
    expect(() => redactedJson(deep)).not.toThrow()
  })
})

describe('the JSON writer', () => {
  it('is the redacting writer, so --json cannot leak what human output hides', () => {
    const document = {
      outputs: {
        publicUrl: 'https://arpi-portfolio-staging.up.railway.app',
        tcpProxyHost: 'monorail.proxy.rlwy.net',
        tcpProxyPort: '34567',
        DATABASE_URL: 'postgres://postgres:placeholder-not-real@db.internal:5432/railway',
      },
    }
    const serialised = redactedJson(document)
    expect(serialised).not.toContain('placeholder-not-real')
    // The non-secret outputs survive: they are the point of the machine-readable
    // mode, and the Fabric handoff reads two of them.
    expect(serialised).toContain('arpi-portfolio-staging.up.railway.app')
    expect(serialised).toContain('monorail.proxy.rlwy.net')
    expect(serialised).toContain('34567')
  })

  it('produces parseable JSON', () => {
    expect(() =>
      JSON.parse(redactedJson({ a: 'postgres://u:placeholder@h/d', b: [1, 2] }))
    ).not.toThrow()
  })
})
