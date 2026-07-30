/**
 * The lifecycle phase summary, for the home page.
 *
 * Eight phases, statuses read from the manifest. The full detail - increments,
 * gates, both engine paths, evidence timestamps - lives on /status; this is the
 * overview that makes the state unmissable without requiring a second page.
 *
 * Server component.
 */
import { ArrowRight } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { lifecyclePhases } from '@/lib/manifest'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

export function LifecycleSummary() {
  return (
    <Section id="project-status" bordered>
      <Container width="wide">
        <Reveal className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-prose flex-col gap-5">
            <Eyebrow>Project status</Eyebrow>
            <Heading level={2}>Four phases complete. One waiting on an engine.</Heading>
            <Text size="body">
              Labels here are literal. &ldquo;Pending external validation&rdquo; means
              finished on this side and waiting on a system outside this repository, and
              it is never rendered as a pass.
            </Text>
          </div>
          <LinkButton
            href={ROUTES.status.href}
            variant="secondary"
            iconAfter={<ArrowRight />}
            className="shrink-0"
          >
            Full status and evidence
          </LinkButton>
        </Reveal>

        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {lifecyclePhases.map((phase) => (
            <li
              key={phase.number}
              className={cx(
                'flex flex-col gap-3 rounded-xl border p-5',
                phase.status === 'complete'
                  ? 'border-verified/25 bg-verified-wash/25'
                  : phase.status === 'pending-external'
                    ? 'border-pending/30 bg-pending-wash/25'
                    : phase.status === 'in-progress'
                      ? 'border-accent-muted/35 bg-accent-wash/25'
                      : 'border-line bg-surface-sunken/50'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-2xs tracking-wide text-ink-faint">
                  PHASE {String(phase.number).padStart(2, '0')}
                </span>
                <StatusBadge status={phase.status} size="sm" />
              </div>
              <h3 className="text-base leading-snug font-semibold text-ink">
                {phase.name}
              </h3>
              <p className="text-xs leading-relaxed text-ink-muted">
                {phase.statusReason}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  )
}
