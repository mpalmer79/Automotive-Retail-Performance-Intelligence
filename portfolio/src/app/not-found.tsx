import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { PRIMARY_NAV, ROUTES } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

/**
 * The 404 page.
 *
 * Useful rather than cute. It names every route on the site, because a visitor
 * who has landed here from a stale link needs the map, not an apology or a
 * cartoon.
 *
 * `<h1>` is "Page not found", not the status code: a heading of "404" tells a
 * screen-reader user nothing about what happened.
 */
export default function NotFound() {
  return (
    <Section className="relative">
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(50%_60%_at_30%_10%,black,transparent)]"
      />
      <Container width="content">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
            <Eyebrow tone="accent">Error 404</Eyebrow>
            <Heading level={1}>Page not found</Heading>
            <Text size="body" className="max-w-prose">
              There is no page at this address. That is usually a stale link rather than a
              mistake on your part - this site&apos;s routes are listed below, and the
              overview is the fastest way back to the start.
            </Text>
          </div>

          <nav aria-labelledby="not-found-routes" className="flex flex-col gap-4">
            <h2 id="not-found-routes" className="eyebrow text-2xs">
              Every page on this site
            </h2>
            <ul className="flex flex-col divide-y divide-line-subtle">
              {PRIMARY_NAV.map((route) => (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    className="group/route flex min-h-touch items-center justify-between gap-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-base font-semibold text-ink group-hover/route:text-accent">
                        {route.navLabel}
                      </span>
                      <span className="text-xs leading-normal text-ink-muted">
                        {route.description.split('.')[0]}.
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-ink-faint transition-colors group-hover/route:text-accent"
                      strokeWidth={2}
                    />
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={ROUTES.caseStudy.href}
                  className="group/route flex min-h-touch items-center justify-between gap-4 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-base font-semibold text-ink group-hover/route:text-accent">
                      Case study
                      <span className="rounded-pill border border-pending/40 px-1.5 py-0.5 font-mono text-2xs leading-none text-pending">
                        LOCKED
                      </span>
                    </span>
                    <span className="text-xs leading-normal text-ink-muted">
                      Held closed by Gate 2 until findings exist.
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-ink-faint transition-colors group-hover/route:text-accent"
                    strokeWidth={2}
                  />
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <LinkButton href="/" variant="primary" iconAfter={<ArrowRight />}>
              Back to the overview
            </LinkButton>
          </div>
        </div>
      </Container>
    </Section>
  )
}
