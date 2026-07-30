import type { MetadataRoute } from 'next'

import { SITE_TITLE, SITE_NAME } from '@/lib/site'

/**
 * The web app manifest.
 *
 * Present so the site installs sensibly if someone adds it to a home screen, and
 * so the theme colour is honoured by browser chrome. `display: 'browser'` rather
 * than `standalone`: this is a document, and stripping the browser's back button
 * and address bar from a document is a downgrade.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: SITE_NAME,
    description:
      'One governed view of dealership performance. A synthetic, reproducible automotive retail analytics platform built on PostgreSQL and a source-controlled Power BI semantic model.',
    start_url: '/',
    display: 'browser',
    background_color: '#05070b',
    theme_color: '#05070b',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
