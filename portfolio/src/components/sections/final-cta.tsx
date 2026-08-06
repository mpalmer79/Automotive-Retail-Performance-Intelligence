/**
 * Chapter four: the evidence, then where to go next.
 *
 * Two actions, both concrete, and the honest state of the project stated once
 * more at the point where a reader has decided whether they care. Neither action
 * says "Get started" or "Learn more", because there is nothing to start and a
 * vague verb wastes the one place on the page where a visitor has already
 * committed their attention.
 *
 * THE PROOF NUMERALS OPEN IT
 * --------------------------
 * They were their own chapter, one section above this one, wrapped in 214 words
 * explaining why each figure was worth reading. The figures are the argument;
 * the paragraphs were justification. `EngineeringProof` now renders as a strip
 * rather than as a section and it renders here, so the page ends on four counts
 * generated from repository evidence and two ways in, rather than on a
 * paragraph.
 *
 * THE CASE STUDY LIVES HERE NOW
 * -----------------------------
 * It came out of the header, where it was the only bordered, filled control and
 * therefore made the emptiest page on the site its loudest destination (finding
 * B-01). This is where it belongs: at the end of the argument, as the thing that
 * is not finished, stated in words rather than implied by an amber pill. A
 * reader who has just been told what is built is exactly the reader who should
 * be told what is not.
 *
 * Server component.
 */
import { ArrowRight, FolderGit2, Lock } from 'lucide-react'
import Link from 'next/link'

import { Reveal } from '@/components/motion/reveal'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { caseStudyUnlocked, gate, manifest } from '@/lib/manifest'
import { REPOSITORY_URL, ROUTES } from '@/lib/site'

export function FinalCta() {
  const gate2 = gate('gate-2')

  return (
    <Section id="review" tone="cinematic" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_70%_at_50%_100%,black,transparent)]"
      />
      <Container width="content">
        {/* The evidence strip, before the heading that claims it. */}
        <EngineeringProof className="mb-16 sm:mb-20" />

        <Reveal className="flex flex-col items-start gap-6 text-left sm:items-center sm:text-center">
          <Eyebrow tone="accent" rule>
            Review the work
          </Eyebrow>
          <Heading level={2} size="display" className="max-w-3xl">
            Every number on this site links to the file that proves it.
          </Heading>
          <Text size="body" className="max-w-prose">
            The architecture shows how a value gets from a seeded generator to a governed
            measure. The repository has the SQL, the DAX and the tests.
          </Text>

          <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
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
              Read the source repository
            </LinkButton>
          </div>
        </Reveal>

        {/* What is not finished. Deliberately the last thing on the page rather
            than the first thing in the hero, and stated as a boundary rather
            than as an apology. */}
        <Reveal className="mt-16 flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken/60 p-6 sm:mt-20 sm:flex-row sm:items-center sm:gap-8">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-pending/40 bg-pending-wash"
          >
            <Lock className="size-4 text-pending" strokeWidth={2.25} />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-base font-semibold text-ink">
              The analytical case study is locked, and Gate{' '}
              {gate2.verdict === 'OPEN' ? '2 is open' : '2 is closed'}.
            </h3>
            <Text size="sm" tone="muted" className="max-w-prose">
              {manifest.semanticModel.dashboardPageCount === 0
                ? 'No report page has been authored, no Microsoft engine has evaluated the measures a case study would cite, and no finding has been drawn. It stays locked until all three change.'
                : 'The gate conditions are recorded on the status page.'}
            </Text>
          </div>
          <Link
            href={ROUTES.caseStudy.href}
            className="mt-1 inline-flex min-h-touch shrink-0 items-center gap-2 self-start text-sm font-medium text-ink-secondary underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent sm:mt-0 sm:self-center"
          >
            {caseStudyUnlocked ? 'Read the case study' : 'What would unlock it'}
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2.25} />
          </Link>
        </Reveal>

        <Reveal className="mt-8">
          <Text size="xs" tone="faint" className="max-w-prose sm:mx-auto sm:text-center">
            {manifest.project.licence} licensed. {manifest.counts.sqlScripts.value}{' '}
            ordered SQL scripts, {manifest.counts.reconciliations.value} reconciliations
            recorded on every database run, and no dashboard yet.
          </Text>
        </Reveal>
      </Container>
    </Section>
  )
}
