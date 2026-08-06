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
  `${SITE_TITLE}. A dark card carrying the ARPI mark, the project name, and the line "one governed view of dealership performance", ` +
  'beside a wireframe of the inventory application showing its store, condition, year, make and price columns with no values in them, ' +
  'and a diagram of four PostgreSQL layers converging on a governed model with a dashed semantic model and report layer above it. ' +
  `A panel states that the data is synthetic only and that Granite Auto Group is fictional. Built by ${SITE_AUTHOR}.`

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
  manifest: '/site.webmanifest',
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
