/**
 * The closing call to action.
 *
 * Two actions, both concrete, both describing what the reader will find. Neither
 * says "Get started", "Learn more" or "Explore" without an object, because there
 * is nothing to start and a vague verb wastes the one place on the page where a
 * reader has already decided they are interested.
 *
 * Server component.
 */
import { ArrowRight, FolderGit2 } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { manifest } from '@/lib/manifest'
import { REPOSITORY_URL, ROUTES } from '@/lib/site'

export function FinalCta() {
  return (
    <Section id="review" bordered className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_70%_at_50%_100%,black,transparent)]"
      />
      <Container width="content">
        <Reveal className="flex flex-col items-start gap-6 text-left sm:items-center sm:text-center">
          <Eyebrow>Review the work</Eyebrow>
          <Heading level={2} size="display" className="max-w-3xl">
            Every number on this site links to the file that proves it.
          </Heading>
          <Text size="body" className="max-w-prose">
            Start with the architecture if you want to see how a value gets from a seeded
            generator to a governed measure. Start with the repository if you would rather
            read the SQL, the DAX and the tests yourself.
          </Text>

          <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <LinkButton
              href={ROUTES.architecture.href}
              variant="primary"
              size="lg"
              iconAfter={<ArrowRight />}
            >
              Explore the technical architecture
            </LinkButton>
            <LinkButton
              href={REPOSITORY_URL}
              variant="secondary"
              size="lg"
              external
              iconBefore={<FolderGit2 />}
            >
              Review the source repository
            </LinkButton>
          </div>

          <Text size="sm" tone="faint" className="max-w-prose">
            {manifest.project.licence} licensed. {manifest.counts.sqlScripts.value}{' '}
            ordered SQL scripts, {manifest.counts.reconciliations.value} reconciliations
            recorded on every database run, and no dashboard yet.
          </Text>
        </Reveal>
      </Container>
    </Section>
  )
}
