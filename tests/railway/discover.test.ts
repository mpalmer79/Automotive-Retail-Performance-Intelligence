/**
 * Tolerant extraction from Railway CLI JSON.
 *
 * The CLI's `--json` payload SHAPES are not a published, versioned contract the
 * way its command surface is. `railway list --json` might return a bare array, an
 * object with a `projects` key, or a GraphQL-style `edges`/`node` wrapper — and a
 * bootstrap tool that knows exactly one of those fails when the CLI is upgraded,
 * possibly half-way through configuring a live project.
 *
 * So the helpers walk for the fields they need instead of asserting a shape, and
 * these tests pin the two properties that makes safe:
 *
 *   - it finds the entity regardless of the wrapper
 *   - it matches on an exact expected NAME, never "the first thing that looks
 *     right", so a tolerant reader cannot silently configure the wrong project
 */
import { describe, expect, it } from 'vitest'

import {
  collectNamedEntities,
  collectRecordsUnderKeys,
  collectStringsUnderKeys,
  countMatches,
  entityNames,
  findByName,
} from '../../scripts/railway/lib/discover.ts'

const ARPI = { id: 'proj-1', name: 'ARPI' }
const OTHER = { id: 'proj-2', name: 'something-else' }

describe('entities are found regardless of the wrapper', () => {
  it.each([
    ['a bare array', [ARPI, OTHER]],
    ['an object with a projects key', { projects: [ARPI, OTHER] }],
    ['a GraphQL edges/node wrapper', { projects: { edges: [{ node: ARPI }, { node: OTHER }] } }],
    ['a workspace-keyed object', { workspaces: [{ name: 'w', projects: [ARPI, OTHER] }] }],
    ['a deeply nested wrapper', { data: { me: { projects: { edges: [{ node: ARPI }] } } } }],
  ])('finds the project in %s', (_label, document) => {
    const found = findByName(collectNamedEntities(document), 'ARPI')
    expect(found?.id).toBe('proj-1')
  })

  it('returns the raw object, for fields beyond id and name', () => {
    const document = { projects: [{ ...ARPI, isPublic: false }] }
    const found = findByName(collectNamedEntities(document), 'ARPI')
    expect(found?.raw['isPublic']).toBe(false)
  })

  it('ignores objects that lack an id or a name', () => {
    const document = { projects: [{ name: 'no-id' }, { id: 'no-name' }, ARPI] }
    expect(collectNamedEntities(document).map((entity) => entity.name)).toEqual(['ARPI'])
  })

  it('ignores an empty id or name', () => {
    expect(collectNamedEntities([{ id: '', name: 'x' }, { id: 'y', name: '' }])).toEqual([])
  })

  it('does not recurse forever on a deeply nested document', () => {
    let deep: Record<string, unknown> = { projects: [ARPI] }
    for (let i = 0; i < 60; i += 1) deep = { wrapper: deep }
    expect(() => collectNamedEntities(deep)).not.toThrow()
  })
})

describe('matching is by exact name, never by position', () => {
  it('prefers an exact match', () => {
    const entities = collectNamedEntities([{ id: 'a', name: 'arpi' }, ARPI])
    expect(findByName(entities, 'ARPI')?.id).toBe('proj-1')
  })

  it('falls back to a case-insensitive match, so a hand-made project is reused', () => {
    // Creating a SECOND project called `ARPI` alongside a hand-made `arpi` is the
    // worst thing a bootstrap tool could do, so recognising it is deliberate.
    const entities = collectNamedEntities([{ id: 'a', name: 'arpi' }])
    expect(findByName(entities, 'ARPI')?.id).toBe('a')
  })

  it('does not match on a substring or a prefix', () => {
    const entities = collectNamedEntities([
      { id: 'a', name: 'ARPI-old' },
      { id: 'b', name: 'my-ARPI' },
    ])
    expect(findByName(entities, 'ARPI')).toBeUndefined()
  })

  it('returns undefined rather than the first entity when nothing matches', () => {
    expect(findByName(collectNamedEntities([OTHER]), 'ARPI')).toBeUndefined()
  })

  it('counts duplicates, so the caller can refuse to guess', () => {
    const entities = collectNamedEntities([ARPI, { id: 'dup', name: 'arpi' }, OTHER])
    expect(countMatches(entities, 'ARPI')).toBe(2)
  })

  it('lists what WAS found, for a useful not-found message', () => {
    expect(entityNames(collectNamedEntities([ARPI, OTHER, ARPI]))).toEqual([
      'ARPI',
      'something-else',
    ])
  })
})

describe('scalar extraction by key', () => {
  it('finds a domain under any of the plausible key names', () => {
    for (const document of [
      { domains: [{ domain: 'a.up.railway.app' }] },
      { serviceDomains: [{ host: 'a.up.railway.app' }] },
      { data: { domains: { serviceDomains: [{ domain: 'a.up.railway.app' }] } } },
    ]) {
      expect(collectStringsUnderKeys(document, ['domain', 'host'])).toContain(
        'a.up.railway.app'
      )
    }
  })

  it('coerces a numeric port to a string, because a TCP proxy port is a number', () => {
    expect(collectStringsUnderKeys({ proxies: [{ proxyPort: 34567 }] }, ['proxyPort'])).toEqual(
      ['34567']
    )
  })

  it('deduplicates', () => {
    expect(
      collectStringsUnderKeys({ a: { status: 'SUCCESS' }, b: { status: 'SUCCESS' } }, ['status'])
    ).toEqual(['SUCCESS'])
  })

  it('is case-insensitive on the key', () => {
    expect(collectStringsUnderKeys({ MountPath: '/data' }, ['mountpath'])).toEqual(['/data'])
  })

  it('ignores an empty string', () => {
    expect(collectStringsUnderKeys({ domain: '' }, ['domain'])).toEqual([])
  })

  it('returns nothing rather than throwing on an unexpected document', () => {
    for (const document of [null, undefined, 42, 'text', [], {}]) {
      expect(() => collectStringsUnderKeys(document, ['domain'])).not.toThrow()
      expect(collectStringsUnderKeys(document, ['domain'])).toEqual([])
    }
  })
})

describe('record extraction by key', () => {
  it('flattens an array of records under a key', () => {
    const records = collectRecordsUnderKeys(
      { volumes: [{ id: 'v1', mountPath: '/data' }, { id: 'v2', mountPath: '/other' }] },
      ['volumes']
    )
    expect(records.map((record) => record['id'])).toEqual(['v1', 'v2'])
  })

  it('accepts a single record as well as an array', () => {
    const records = collectRecordsUnderKeys({ volume: { id: 'v1' } }, ['volume'])
    expect(records).toHaveLength(1)
  })
})
