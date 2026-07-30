'use client'

/**
 * The route error boundary.
 *
 * Next.js requires this to be a client component. It has one job: tell the
 * visitor something failed, give them a way to retry, and give them a way out.
 *
 * It deliberately does NOT render `error.message`. This site has no user input
 * and no runtime data source, so an error here is a build or framework fault
 * whose message would be a stack-shaped string that helps nobody reading the
 * page. The digest is shown instead, because that is the value a maintainer would
 * actually correlate against a log.
 */
import { RotateCcw } from 'lucide-react'
import { useEffect } from 'react'

import { Button, LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The one console call the lint rule allows, and the right one: an
    // unrecoverable render fault should be visible to anyone with the console
    // open. There is no telemetry endpoint on this site to report it to.
    console.error('ARPI portfolio route error:', error)
  }, [error])

  return (
    <Section>
      <Container width="content">
        <div className="flex flex-col gap-6">
          <Eyebrow tone="accent">Something went wrong</Eyebrow>
          <Heading level={1}>This page failed to render</Heading>
          <Text size="body" className="max-w-prose">
            The failure is on this site rather than on your side - there is nothing to
            submit here and no account to sign into. Retrying often works, because the
            fault is usually in a single route rather than in the whole application.
          </Text>

          {error.digest ? (
            <p className="font-mono text-2xs text-ink-faint">
              Error digest: <span className="text-ink-muted">{error.digest}</span>
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" onClick={reset} iconBefore={<RotateCcw />}>
              Try this page again
            </Button>
            <LinkButton href="/" variant="secondary">
              Back to the overview
            </LinkButton>
          </div>
        </div>
      </Container>
    </Section>
  )
}
