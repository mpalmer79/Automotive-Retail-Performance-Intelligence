import type { ReactNode } from 'react'

import { OperatingRail } from '@/components/shell/operating-rail'

/**
 * The operating application's shell.
 *
 * WHY A ROUTE GROUP
 * -----------------
 * `UX.1` splits the site into two information domains that need different chrome:
 * the operating application, which wears a navigation rail and no masthead, and
 * the reference half — technical, about, the demo group, the reference listings —
 * which wears the site header and footer. Before this increment one root layout
 * put the same seven-item masthead on both, so a general manager reading gross was
 * offered "Governance" and "Status" as peers of "Dashboard".
 *
 * `(operating)` and `(site)` change no URL. `/` and the seven `/dashboard/*`
 * routes are exactly where they were; what the group buys is that the shell is
 * declared once, in the layout that owns it, instead of being assembled by nine
 * pages.
 *
 * WHAT THIS LAYOUT OWNS, AND WHAT IT DOES NOT
 * -------------------------------------------
 *   owns      the rail, the compact app bar, the mobile drawer, the persistent
 *             demo statement, the utility links, and `<main>`
 *   does not  the global filter controls
 *
 * The filters are the interesting omission. A Next layout cannot read
 * `searchParams` — it is a route-level input — so a layout physically cannot
 * render a control whose state is the query string. They are rendered by
 * `<OperatingPageHeader>`, which is ONE component used by all nine routes rather
 * than nine copies of a control bar, and which each page can hand its own
 * applicability declaration to. The rail solves the same problem the other way and
 * reads the query string in the browser, because a link is a value it can compute
 * and a form is state it would have to own.
 */
/**
 * Every route in this group is rendered per request, declared rather than inferred.
 *
 * It was already true of all nine — each reads `searchParams`, because filter state
 * lives in the URL and nowhere else — and Next inferred it per page. The rail made
 * it a property of the GROUP: it reads the query string too, and a layout's
 * dynamism is not inferred from its children. Without this the build tries to
 * prerender the layout, finds a client component reading search params, and asks
 * for a Suspense boundary — whose streaming is what breaks the no-JavaScript
 * rendering. Declaring the truth is cheaper than working around it.
 *
 * Nothing is deopted: there is no database behind the request. The data was
 * packaged at build time and the "query" is an array pass over it.
 */
export const dynamic = 'force-dynamic'

export default function OperatingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/*
        NO SUSPENSE BOUNDARY, AND THE ABSENCE IS THE NO-JAVASCRIPT ANSWER.
      
        The rail calls `useSearchParams`, and the reflex is to wrap it — Next asks
        for a boundary whenever a client component reads the query string. It was
        wrapped, and the consequence was measured rather than reasoned about: a
        Suspense boundary makes Next STREAM the resolved content and land it with an
        inline script. With scripting disabled that script never runs, the content
        stays in its `<template>`, and the operating application renders with no
        navigation at all. `reduced-motion.spec.ts` caught it.
      
        The boundary is only required where a route is PRERENDERED, because there is
        no request to read a query string from. Every route in this group is
        server-rendered per request — filter state lives in the URL, so it must be —
        which means the rail's own render already has the search params and there is
        nothing to suspend on. The rail is therefore in the initial HTML, its links
        carry the reader's filter context on the server, and both facts are asserted
        with JavaScript switched off.
      */}
      <OperatingRail />

      {/* The skip link's target. `tabIndex={-1}` so programmatic focus lands here
          without adding <main> to the tab order.

          `min-w-0` is load-bearing: a flex child's default minimum size is its
          content, so a wide data table would push the rail off screen instead of
          scrolling inside its own container. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="min-w-0 flex-1 pb-section-tight focus:outline-none"
      >
        {children}
      </main>
    </div>
  )
}
