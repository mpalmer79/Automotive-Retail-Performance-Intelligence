/**
 * Tolerant extraction of entities from Railway CLI JSON.
 *
 * WHY THIS IS DEFENSIVE
 * ---------------------
 * The CLI's `--json` payload shapes are not part of a published, versioned
 * contract the way its command surface is: `railway list --json` may return an
 * array of projects, or an object keyed by workspace, or a wrapper with the
 * projects under `projects` or `edges`/`node`. Hard-coding one of those shapes
 * from a single observed run would produce a bootstrap tool that works until the
 * CLI is upgraded and then fails while half-way through configuring a live
 * project.
 *
 * So rather than assert a shape, these helpers walk the document for objects
 * that carry the fields we need. A tool that finds the project regardless of how
 * it is wrapped is more robust than one that knows exactly one wrapper, and the
 * failure mode when nothing matches is an explicit "not found" the caller can
 * report rather than a `TypeError` on `undefined.map`.
 *
 * The cost is that these helpers cannot tell a project from a
 * similarly-shaped-but-unrelated object. That is mitigated by always matching on
 * an exact expected NAME, never by taking "the first thing that looks right".
 */

/** An object with a string `id` and a string `name`. */
export interface NamedEntity {
  readonly id: string
  readonly name: string
  /** The object it was found in, for fields a caller needs beyond id/name. */
  readonly raw: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Collect every object in a JSON document that has a string `name` and a string
 * `id`, at any depth.
 */
export function collectNamedEntities(document: unknown, depth = 0): NamedEntity[] {
  // A guard rather than a limit: Railway payloads are shallow, and unbounded
  // recursion over a cyclic structure would hang rather than fail.
  if (depth > 12) return []

  const found: NamedEntity[] = []

  if (Array.isArray(document)) {
    for (const item of document) found.push(...collectNamedEntities(item, depth + 1))
    return found
  }

  if (!isRecord(document)) return found

  const { id, name } = document
  if (typeof id === 'string' && typeof name === 'string' && id !== '' && name !== '') {
    found.push({ id, name, raw: document })
  }

  for (const value of Object.values(document)) {
    if (Array.isArray(value) || isRecord(value)) {
      found.push(...collectNamedEntities(value, depth + 1))
    }
  }

  return found
}

/**
 * Find an entity by exact name, then by case-insensitive name.
 *
 * Exact first, because Railway service names are case-sensitive and `Postgres`
 * is not `postgres`. Case-insensitive second, because a project a human created
 * by hand as `arpi` should be recognised rather than duplicated — creating a
 * second project called `ARPI` alongside it is the single worst thing a
 * bootstrap tool could do.
 */
export function findByName(
  entities: readonly NamedEntity[],
  name: string
): NamedEntity | undefined {
  const exact = entities.find((entity) => entity.name === name)
  if (exact !== undefined) return exact
  const lower = name.toLowerCase()
  return entities.find((entity) => entity.name.toLowerCase() === lower)
}

/** Collect names only, deduplicated and sorted. For reporting what WAS found
 *  when the thing we wanted was not. */
export function entityNames(entities: readonly NamedEntity[]): string[] {
  return [...new Set(entities.map((entity) => entity.name))].sort()
}

/**
 * Find every string value under a key, at any depth.
 *
 * Used for fields that are not `id`/`name` pairs — a domain string, a TCP proxy
 * host, a deployment status — where the wrapper is again not guaranteed.
 */
export function collectStringsUnderKeys(
  document: unknown,
  keys: readonly string[],
  depth = 0
): string[] {
  if (depth > 12) return []
  const wanted = new Set(keys.map((key) => key.toLowerCase()))
  const found: string[] = []

  if (Array.isArray(document)) {
    for (const item of document) {
      found.push(...collectStringsUnderKeys(item, keys, depth + 1))
    }
    return found
  }
  if (!isRecord(document)) return found

  for (const [key, value] of Object.entries(document)) {
    if (wanted.has(key.toLowerCase())) {
      if (typeof value === 'string' && value !== '') found.push(value)
      if (typeof value === 'number') found.push(String(value))
    }
    if (Array.isArray(value) || isRecord(value)) {
      found.push(...collectStringsUnderKeys(value, keys, depth + 1))
    }
  }

  return [...new Set(found)]
}

/** Find every object under a key that is an array or record, flattened. */
export function collectRecordsUnderKeys(
  document: unknown,
  keys: readonly string[],
  depth = 0
): Record<string, unknown>[] {
  if (depth > 12) return []
  const wanted = new Set(keys.map((key) => key.toLowerCase()))
  const found: Record<string, unknown>[] = []

  if (Array.isArray(document)) {
    for (const item of document) {
      found.push(...collectRecordsUnderKeys(item, keys, depth + 1))
    }
    return found
  }
  if (!isRecord(document)) return found

  for (const [key, value] of Object.entries(document)) {
    if (wanted.has(key.toLowerCase())) {
      if (Array.isArray(value)) {
        for (const item of value) if (isRecord(item)) found.push(item)
      } else if (isRecord(value)) {
        found.push(value)
      }
    }
    if (Array.isArray(value) || isRecord(value)) {
      found.push(...collectRecordsUnderKeys(value, keys, depth + 1))
    }
  }

  return found
}

/**
 * How many entities in a document look like a match for a name.
 *
 * Reported by the bootstrap tool when it finds more than one, because two
 * projects called `ARPI` in the same account is a situation a tool must refuse
 * to guess its way through rather than pick one.
 */
export function countMatches(entities: readonly NamedEntity[], name: string): number {
  const lower = name.toLowerCase()
  return entities.filter((entity) => entity.name.toLowerCase() === lower).length
}
