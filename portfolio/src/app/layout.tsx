import type { Viewport } from 'next'
import type { ReactNode } from 'react'

import { PreviewNotice } from '@/components/shell/preview-notice'
import { SiteFooter } from '@/components/shell/site-footer'
import { SiteHeader } from '@/components/shell/site-header'
import { SkipLink } from '@/components/ui/states'
import { fontVariables } from '@/lib/fonts'
import { rootMetadata, structuredData } from '@/lib/metadata'
import '@/styles/globals.css'

export const metadata = rootMetadata

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately NOT capping maximum-scale or setting user-scalable=no. Both
  // break pinch zoom, which is a WCAG 1.4.4 failure and one of the most common
  // accessibility defects shipped by an otherwise careful site.
  themeColor: '#05070b',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        {/* Motion serialises its `initial` variant into the server-rendered
            markup, so every revealed section ships with `opacity: 0` in the HTML.
            If the bundle fails to load - a CDN hiccup, a blocked script, a
            browser with JavaScript off - those sections would stay blank and the
            site would be an empty shell. This rule forces them visible in that
            case. It costs 90 bytes and it is the difference between a degraded
            document and no document. */}
        <noscript>
          <style>
            {'[data-arpi-reveal]{opacity:1!important;transform:none!important}'}
          </style>
        </noscript>

        {/* The first focusable element in the document. */}
        <SkipLink />

        {/* One JSON-LD graph for the whole site, in the body rather than the
            head so it is served with the streamed document. Types are limited to
            what this project can honestly claim; see lib/metadata.ts. */}
        <script
          type="application/ld+json"
          // The payload is generated from constants in lib/metadata.ts. No user
          // input, no fetched content, and no interpolation of anything a
          // visitor can influence reaches it.
          dangerouslySetInnerHTML={{ __html: structuredData() }}
        />

        <PreviewNotice />
        <SiteHeader />
        {/* The skip link's target. `tabIndex={-1}` so that programmatic focus
            lands here without adding <main> to the tab order. */}
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  )
}
