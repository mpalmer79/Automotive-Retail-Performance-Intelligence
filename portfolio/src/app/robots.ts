import type { MetadataRoute } from 'next'

import { IS_PREVIEW, ROUTES, SITE_URL } from '@/lib/site'

/**
 * robots.txt.
 *
 * An unstable preview deployment disallows everything. That is a deployment
 * requirement rather than a preference: a preview of this site states that Gate 2
 * is closed and that validation is pending, and an indexed preview would put a
 * point-in-time snapshot of those statements into search results where it would
 * outlive the state it describes.
 *
 * The UI lab is disallowed on every environment, including production. It is an
 * internal design reference, not a user-facing feature, and it has no business in
 * a search index.
 */
export default function robots(): MetadataRoute.Robots {
  if (IS_PREVIEW) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [ROUTES.uiLab.href],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
