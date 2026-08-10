import type { Viewport } from 'next'
import type { ReactNode } from 'react'

import { FieldMotif } from '@/components/shell/field'
import { PreviewNotice } from '@/components/shell/preview-notice'
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
  // The white header is what a browser chrome tint should match, not the field
  // behind it: the header is the top of the page at every scroll position.
  themeColor: '#ffffff',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh">
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

        {/* The blue field's geometry. Rendered once for the whole site, fixed
            to the viewport, decorative, and out of the accessibility tree. It
            is first in the body so that nothing after it can be painted
            beneath it. */}
        <FieldMotif />

        <PreviewNotice />

        {/* THE CHROME MOVED DOWN A LEVEL AT `UX.1`.
            This layout used to render the masthead, `<main>` and the footer for
            every route on the site. It renders none of them now: the operating
            application and the reference domain wear different shells, and each
            group layout owns its own — including its own `<main>`, because the
            operating shell puts the rail beside the content rather than above it.
            What stays here is what is genuinely site-wide: the document, the
            fonts, the skip link, the structured-data graph and the blue field. */}
        {children}
      </body>
    </html>
  )
}
