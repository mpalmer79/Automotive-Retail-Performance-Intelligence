import type { Metadata } from 'next'

import { LayoutB } from '../layouts'

/**
 * Prototype route. TEMPORARY - deleted before merge.
 *
 * `noindex, nofollow` because a candidate layout must never be reachable from
 * a search result. `/proto` is also excluded from sitemap.ts and disallowed in
 * robots.ts, so this is the third of three independent guards rather than the
 * only one.
 */
export const metadata: Metadata = {
  title: 'Prototype B',
  robots: { index: false, follow: false },
}

export default function PrototypePageB() {
  return <LayoutB />
}
