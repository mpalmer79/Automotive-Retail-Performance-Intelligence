import type { MetadataRoute } from 'next'

import { INDEXABLE_ROUTES, SITE_URL } from '@/lib/site'

/**
 * The sitemap, generated from the route map in `lib/site.ts`.
 *
 * Only routes marked `indexable` appear, which excludes the UI lab. There is no
 * `lastModified`: this site is static content whose pages change together on a
 * deploy, so a per-route timestamp would either be the build time on every entry
 * (which tells a crawler nothing) or a guess.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.href}`,
    changeFrequency: 'monthly' as const,
    priority: route.priority,
  }))
}
