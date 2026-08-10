import type { ReactNode } from 'react'

import { SiteFooter } from '@/components/shell/site-footer'
import { SiteHeader } from '@/components/shell/site-header'

/**
 * The reference domain's shell: masthead, content, footer.
 *
 * This is the chrome the whole site wore before `UX.1`. It now covers the routes
 * it was actually designed for — the technical destination, the author page, the
 * demo group's store pages, the reference listing explorer and the closed case
 * study — while the operating application wears a rail instead.
 *
 * The header's primary navigation is three items now rather than seven, and the
 * first of them returns to the operating application. Every one of these pages is
 * somewhere a reader arrived at FROM the application, so the way back out is the
 * first thing in the masthead rather than a wordmark click nobody is sure about.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      {/* `pb-*` is the gap between the last canvas and the footer: the blue field
          has to be visible there, or the canvas and the footer meet as one
          continuous white column and the page loses the floating quality the whole
          design rests on. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 pt-canvas-inset pb-section-tight focus:outline-none"
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
