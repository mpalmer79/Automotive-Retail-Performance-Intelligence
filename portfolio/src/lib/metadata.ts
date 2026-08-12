/**
 * Page metadata and structured data.
 *
 * Every route builds its metadata through `pageMetadata()`, so a title format,
 * a canonical URL or an Open Graph image can be changed in one place. The
 * structured data is deliberately limited to types this project can honestly
 * claim: `WebSite`, `SoftwareSourceCode`, `Person` and `CreativeWork`. There is
 * no `Product`, no `AggregateRating`, no `Review` and no `Organization`, because
 * ARPI sells nothing, is rated by nobody, and is not a company.
 */
import type { Metadata } from 'next'

import {
  IS_PREVIEW,
  REPOSITORY_URL,
  ROUTES,
  SITE_AUTHOR,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  type RouteKey,
} from './site'

export const OG_IMAGE_PATH = '/social-preview.png'
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

/**
 * The social card's alternative text.
 *
 * Written from what the card actually shows rather than from what the site is
 * about, because that is what alternative text is for and because a preview
 * card is exactly the context where a reader may get the text and not the
 * image. Kept in one constant so the two places that reference the image cannot
 * describe it differently, and updated whenever
 * `public/brand/social-preview.svg` changes.
 */
export const OG_IMAGE_ALT =
  `${SITE_TITLE}. A dark card carrying the ARPI mark and the line "dealership management intelligence", above the operating domains ` +
  'sales, inventory, F&I, leads and accounting, and a diagram of the raw, staging, warehouse and reporting layers resolving into a ' +
  'governed KPI model. Beside it, the Executive Command Center: four figures for December 2025 across all stores — 92 retail units, ' +
  '$321,935 total gross, $3,499 gross per retail unit and 40.4% aged inventory — a six-month total-gross trend that falls through ' +
  'October and partly recovers, and $5,438,057 of inventory investment with the aged share marked on a bar. ' +
  `A panel states that the data is synthetic and that Granite Auto Group is fictional. Built by ${SITE_AUTHOR}.`

/** The site-wide metadata, applied in the root layout. */
export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    // Every child page renders as "Page name - ARPI".
    template: `%s - ${SITE_NAME}`,
  },
  description: ROUTES.home.description,
  applicationName: SITE_TITLE,
  authors: [{ name: SITE_AUTHOR }],
  creator: SITE_AUTHOR,
  generator: 'Next.js',
  keywords: [
    'automotive retail analytics',
    'dealership performance',
    'dimensional modelling',
    'PostgreSQL data warehouse',
    'Power BI semantic model',
    'KPI governance',
    'synthetic data',
    'data quality',
    'TMDL',
    'DAX',
  ],
  category: 'technology',
  formatDetection: { telephone: false, address: false, email: false },
  // An unstable preview deployment must not be indexed. A production build with
  // no preview flag set is indexable.
  robots: IS_PREVIEW
    ? { index: false, follow: false, nocache: true }
    : { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: SITE_TITLE,
    locale: 'en_US',
    url: SITE_URL,
    title: SITE_TITLE,
    description: ROUTES.home.description,
    images: [
      {
        url: OG_IMAGE_PATH,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: OG_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: ROUTES.home.description,
    images: [{ url: OG_IMAGE_PATH, alt: OG_IMAGE_ALT }],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  /*
   * NO `manifest` KEY. `app/manifest.ts` IS THE MANIFEST.
   *
   * This field used to read `/site.webmanifest`, which was inert and wrong at the
   * same time: Next's file-based `app/manifest.ts` convention wins over a
   * `metadata.manifest` value, so the rendered link has always been
   * `/manifest.webmanifest`, and `/site.webmanifest` answers 404. Removing the
   * line rather than repointing it keeps one authority for the manifest instead
   * of two that have to agree.
   */
  alternates: { canonical: SITE_URL },
}

/**
 * Metadata for one route, derived from its entry in `ROUTES` so the navigation
 * label, the page title, the meta description and the sitemap can never
 * describe different things.
 */
export function pageMetadata(key: RouteKey, overrides: Partial<Metadata> = {}): Metadata {
  const route = ROUTES[key]
  const url = `${SITE_URL}${route.href}`
  const isHome = route.href === '/'

  return {
    // The root layout's template already appends " - ARPI"; the home page
    // supplies an absolute title so it does not read "ARPI - ARPI".
    title: isHome ? { absolute: SITE_TITLE } : route.title,
    description: route.description,
    alternates: { canonical: url },
    robots: route.indexable
      ? IS_PREVIEW
        ? { index: false, follow: false }
        : { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      type: 'website',
      /*
       * `siteName` AND `locale` ARE REPEATED HERE, NOT INHERITED.
       *
       * `Metadata` overrides are shallow, and every route on this site builds its
       * metadata through this function — so this `openGraph` object REPLACES the
       * one in `rootMetadata` rather than merging into it. The root's `siteName`
       * and `locale` were therefore dropped from every page on the site, and
       * `DASH.13`'s metadata audit found `og:site_name` absent from all of them.
       *
       * It matters more than a missing tag usually would: `og:site_name` is the
       * line a social crawler renders as the card's attribution, so a card built
       * from a page without it is a headline and an image with nothing naming the
       * site it came from. The same shallow-override rule is already documented at
       * the one other place that spreads this object, `technical/page.tsx`.
       */
      siteName: SITE_TITLE,
      locale: 'en_US',
      url,
      title: isHome ? SITE_TITLE : `${route.title} - ${SITE_NAME}`,
      description: route.description,
      images: [
        {
          url: OG_IMAGE_PATH,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          alt: OG_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: isHome ? SITE_TITLE : `${route.title} - ${SITE_NAME}`,
      description: route.description,
      images: [{ url: OG_IMAGE_PATH, alt: OG_IMAGE_ALT }],
    },
    ...overrides,
  }
}

/* -------------------------------------------------------------------------- */
/* Structured data                                                             */
/* -------------------------------------------------------------------------- */

const PERSON_ID = `${SITE_URL}/about#michael-palmer`
const WEBSITE_ID = `${SITE_URL}/#website`
const SOFTWARE_ID = `${REPOSITORY_URL}#source`

/**
 * The site's JSON-LD graph. Four nodes, all of them true:
 *
 *   WebSite             this site
 *   Person              the author
 *   SoftwareSourceCode  the repository
 *   CreativeWork        the project as a documented body of work
 *
 * Deliberately absent: any rating, review, award, testimonial, price, or
 * `Organization` node. Granite Auto Group is fictional and must never
 * appear in structured data as though it were a real business.
 */
export function structuredData(): string {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: SITE_URL,
      name: SITE_TITLE,
      alternateName: SITE_NAME,
      description: ROUTES.home.description,
      inLanguage: 'en-US',
      author: { '@id': PERSON_ID },
      publisher: { '@id': PERSON_ID },
    },
    {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: SITE_AUTHOR,
      url: `${SITE_URL}/about`,
      description:
        'More than 25 years in automotive retail - sales, finance, dealership management, CRM, DMS, inventory and lead operations - combined with computer science retraining and analytics engineering work.',
      knowsAbout: [
        'Automotive retail operations',
        'Dealership performance management',
        'Dimensional modelling',
        'PostgreSQL',
        'SQL',
        'Python',
        'Power BI semantic modelling',
        'DAX',
        'Data governance',
        'Data quality engineering',
      ],
      sameAs: [REPOSITORY_URL],
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': SOFTWARE_ID,
      name: SITE_TITLE,
      alternateName: SITE_NAME,
      description:
        'A governed, reproducible analytics platform for a fictional three-store automotive dealer group: seeded synthetic data generation in Python, a PostgreSQL dimensional warehouse, a documented KPI catalogue, and a source-controlled Power BI semantic model stored as TMDL.',
      codeRepository: REPOSITORY_URL,
      programmingLanguage: ['Python', 'SQL', 'DAX', 'TypeScript'],
      runtimePlatform: ['PostgreSQL 16', 'Python 3.11'],
      license: 'https://opensource.org/licenses/MIT',
      author: { '@id': PERSON_ID },
      isAccessibleForFree: true,
    },
    {
      '@type': 'CreativeWork',
      '@id': `${SITE_URL}/#project`,
      name: SITE_TITLE,
      url: SITE_URL,
      author: { '@id': PERSON_ID },
      license: 'https://opensource.org/licenses/MIT',
      inLanguage: 'en-US',
      isBasedOn: { '@id': SOFTWARE_ID },
      // The single most important claim on the site, stated in machine-readable
      // form as well as in prose.
      abstract:
        'A portfolio data platform built entirely on synthetic data. Granite Auto Group is a fictional dealer group; no real dealership, customer, employee or lending data is used anywhere in the project, and no figure it produces describes any real automotive retailer.',
      creativeWorkStatus: 'In progress',
    },
  ]

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
}
