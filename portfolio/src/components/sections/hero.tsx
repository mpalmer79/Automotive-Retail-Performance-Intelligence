import { ArrowRight, FolderGit2 } from 'lucide-react'

import { PipelineHero } from '@/components/motion/pipeline-hero'
import { StatusBadge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/button'
import { Container, Section, Stack } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { manifest } from '@/lib/manifest'
import { REPOSITORY_URL, ROUTES, SYNTHETIC_DATA_STATEMENT } from '@/lib/site'

/**
 * The hero.
 *
 * Composition decisions, since a hero is where a portfolio site most often goes
 * wrong:
 *
 *   - The value proposition is one sentence and it names the thing, not a
 *     feeling. "One governed view of dealership performance." A reader knows
 *     within five seconds what this is.
 *   - The synthetic-data statement is in the hero, above the fold, in the page
 *     body. It is not a footnote and not a footer-only disclosure.
 *   - The current status is stated in the hero too, with the pending real-engine
 *     validation named rather than glossed. A hero that omitted it would be the
 *     single most dishonest thing this site could do.
 *   - Two calls to action, both concrete. Neither says "Get started", because
 *     there is nothing to start.
 */
export function Hero() {
  const model = manifest.semanticModel

  return (
    <Section rhythm="none" className="overflow-hidden pt-12 pb-section sm:pt-16">
      {/* The dimensional-grid ground. Decorative, pointer-transparent, and
          removed from the accessibility tree. */}
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(70%_60%_at_30%_20%,black,transparent)]"
      />

      <Container width="wide">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-7 lg:col-span-6">
            <Eyebrow tone="accent">Portfolio data platform</Eyebrow>

            <Stack gap={5}>
              <Heading level={1} size="hero">
                One governed view of dealership performance.
              </Heading>

              <Text size="body" tone="secondary" className="max-w-prose">
                A synthetic, reproducible automotive retail analytics platform connecting
                sales, gross, inventory, lead conversion, marketing and data quality
                through a documented PostgreSQL and Power BI architecture.
              </Text>
            </Stack>

            {/* Status, stated plainly and immediately. */}
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status="complete"
                  label="Warehouse and KPIs complete"
                  size="sm"
                />
                <StatusBadge
                  status={model.realEngineStatus}
                  label="Semantic model: real-engine validation pending"
                  size="sm"
                />
              </div>
              <Text size="sm" tone="muted">
                The semantic model is built and statically validated. No Microsoft
                semantic-model engine has yet loaded it, refreshed it, or returned a
                number from it, so its DAX is unproven.{' '}
                {model.dashboardPageCount === 0
                  ? 'No report page or visual exists, and no analytical finding has been drawn.'
                  : null}
              </Text>
            </div>

            {/* The synthetic-data statement. Above the fold, in the body. */}
            <div className="rule-marked pt-4">
              <Text size="sm" tone="muted" className="max-w-prose">
                <span className="font-semibold text-pending">Synthetic data only. </span>
                {SYNTHETIC_DATA_STATEMENT}
              </Text>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton
                href={ROUTES.architecture.href}
                variant="primary"
                size="lg"
                iconAfter={<ArrowRight />}
              >
                Explore the architecture
              </LinkButton>
              <LinkButton
                href={REPOSITORY_URL}
                variant="secondary"
                size="lg"
                external
                iconBefore={<FolderGit2 />}
              >
                View the repository
              </LinkButton>
            </div>
          </div>

          <div className="lg:col-span-6 lg:pt-6">
            <figure className="flex flex-col gap-4">
              <PipelineHero />
              <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line-subtle pt-4 font-mono text-2xs text-ink-faint">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-px w-5 bg-accent" />
                  Implemented and tested
                </span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-px w-5 border-t border-dashed border-model"
                  />
                  Built, real-engine validation pending
                </span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-px w-5 border-t border-dashed border-line-strong"
                  />
                  Not built
                </span>
              </figcaption>
            </figure>
          </div>
        </div>
      </Container>
    </Section>
  )
}
