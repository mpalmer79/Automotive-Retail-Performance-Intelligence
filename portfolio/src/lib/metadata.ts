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
  AUTHOR_GITHUB_URL,
  AUTHOR_LINKEDIN_URL,
  IS_PREVIEW,
  REPOSITORY_URL,
  ROUTES,
  SITE_AUTHOR,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  type RouteKey,
} from './site'

/**
 * The social card, and the one path it is served from.
 *
 * `/brand/social-preview.png` RATHER THAN `/social-preview.png`, since ADR-0016. The card
 * used to be a rendered artefact: `public/brand/social-preview.svg` was the master,
 * `npm run assets` rasterised it to `public/social-preview.png`, and the source of truth
 * lived beside the other brand masters while the output lived at the public root. That
 * arrangement is retired. The card is now a supplied raster committed at the path it is
 * served from — one file, one location, no generation step, nothing to regenerate and
 * nothing that can drift from a master.
 */
export const OG_IMAGE_PATH = '/brand/social-preview.png'
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
 * `public/brand/social-preview.png` changes.
 *
 * IT NAMES THE REGIONS AND NOT THE FIGURES, AND THAT IS ADR-0016 SHOWING THROUGH. The
 * previous card was governed output — every value on it was reconciled against
 * `buildExecutiveOverview()` by `media.test.ts`, so the alt text could safely read those
 * values out. This card is an illustrative interface rendering whose figures are NOT
 * governed output and do not reconcile with it. Repeating them here would put unreconciled
 * numbers into the accessibility tree, where they would be indistinguishable from the
 * product's real ones — the failure mode being described to the one reader who cannot see
 * that they sit inside a stylised marketing composition. So the description says what kind
 * of thing is on the card and stops short of quoting any value.
 */
export const OG_IMAGE_ALT =
  `${SITE_TITLE}. A light card carrying the ARPI wordmark, the words "Automotive Retail Performance Intelligence" and the line ` +
  '"Governed. Traceable. Actionable.", above four marks labelled governed data, executive insights, operating workflows and ' +
  'actionable intelligence. Beside it, an illustrative rendering of an executive dealership analytics dashboard: a row of ' +
  'summary metric tiles with sparklines, a performance trend chart, a sales funnel and an inventory health ring, with an ' +
  'executive summary and an attention list beneath them. The figures shown in the rendering are illustrative and are not ' +
  'governed output. The data is synthetic and Granite Auto Group is fictional. ' +
  `Built by ${SITE_AUTHOR}.`

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
      /*
       * `sameAs` on a Person means "other profiles OF THIS PERSON", and it carried
       * one entry that was not one: the ARPI repository, which is a project the
       * person wrote rather than an identity they hold. The two profiles are the
       * correct answer to that property and are now the first two entries; the
       * repository stays because it is also a place this person is identifiable,
       * and it remains the `codeRepository` of the SoftwareSourceCode node below,
       * which is where the project's own identity is asserted.
       */
      sameAs: [AUTHOR_GITHUB_URL, AUTHOR_LINKEDIN_URL, REPOSITORY_URL],
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
