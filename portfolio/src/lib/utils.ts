/** Small shared helpers. Nothing here reaches the network or touches the DOM. */

/**
 * Join class names, dropping falsy entries. Deliberately not `clsx`: the site's
 * needs are this one function, and a dependency for it would be noise.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Format an integer with thousands separators, in a stable locale. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/**
 * Format an ISO timestamp for display, in UTC so that the rendered string is the
 * same on the server and in the browser. A locale-dependent format would
 * hydrate differently for a visitor in another timezone.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(date)
  return `${parts} UTC`
}

/** Format an ISO date (no time) for display. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** A stable, URL-safe id from a human label. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Split an array into groups keyed by a derived string. Insertion-ordered. */
export function groupBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K
): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const existing = groups.get(k)
    if (existing) existing.push(item)
    else groups.set(k, [item])
  }
  return groups
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
