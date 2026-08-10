import type { MetadataRoute } from 'next'

import { INDEXABLE_ROUTES, ROUTES, SITE_URL } from '@/lib/site'
import {
  DEFAULT_TECHNICAL_VIEW,
  TECHNICAL_VIEW_DEFINITIONS,
  technicalHref,
} from '@/lib/technical'

/**
 * The sitemap, generated from the route map in `lib/site.ts`.
 *
 * Only routes marked `indexable` appear, which excludes the UI lab. There is no
 * `lastModified`: this site is static content whose pages change together on a
 * deploy, so a per-route timestamp would either be the build time on every entry
 * (which tells a crawler nothing) or a guess.
 *
 * THE TECHNICAL VIEWS ARE LISTED INDIVIDUALLY, AND THE DEFAULT ONE IS NOT
 * ---------------------------------------------------------------------
 * `/technical` is one route with eight server-addressable states, each carrying a
 * canonical link to itself. A sitemap listing only the bare route would hide seven
 * documents a crawler can reach and a reader can share; listing all eight PLUS
 * `?view=overview` would list the same document twice, because the overview
 * canonicalizes to the bare route. So the bare route stands for the overview, and
 * the other seven are listed as their own URLs.
 *
 * THE EIGHT RETIRED URLS ARE ABSENT, DELIBERATELY. `/architecture`,
 * `/data-model`, `/kpis`, `/governance`, `/status`, `/inventory-operations`,
 * `/dashboard` and `/dealerships` are permanent redirects. A redirect in a sitemap
 * is a crawl instruction to fetch a URL that will not answer, and it is the exact
 * duplication the redirects exist to remove. They are not in `ROUTES` either,
 * which is what makes this a property of the route map rather than of this file.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = INDEXABLE_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.href}`,
    changeFrequency: 'monthly' as const,
    priority: route.priority,
  }))

  const technicalViews = TECHNICAL_VIEW_DEFINITIONS.filter(
    (entry) => entry.view !== DEFAULT_TECHNICAL_VIEW
  ).map((entry) => ({
    url: `${SITE_URL}${technicalHref(entry.view)}`,
    changeFrequency: 'monthly' as const,
    // Below the destination's own priority: a view is a state of `/technical`,
    // and telling a crawler that eight of them matter equally would flatten the
    // one entry point into eight.
    priority: Math.max(0.1, ROUTES.technical.priority - 0.1),
  }))

  return [...routes, ...technicalViews]
}
