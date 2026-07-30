/**
 * Author perspective, for the home page.
 *
 * The differentiator stated once, concretely, with examples rather than
 * adjectives. Three specifics do the work: what a gross number actually means,
 * why an uncontextualised employee ranking misleads, and which service customers
 * are genuinely replacement opportunities. Each is a judgement call that comes
 * from operating a store, and each shows up as a design decision in the
 * repository - which is what makes it evidence rather than a claim.
 *
 * Deliberately absent: "passionate", "results-driven", a skills cloud, a
 * percentage bar, a years-of-experience counter animating up, and any claim to a
 * completed degree. The repository's own author section says "computer science
 * and technical retraining" without asserting a conferred qualification, and this
 * page says exactly the same.
 */
import { ArrowRight } from 'lucide-react'

import { Reveal } from '@/components/motion/reveal'
import { Card } from '@/components/ui/card-static'
import { LinkButton } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { CodeLabel, Eyebrow, Heading, Text } from '@/components/ui/typography'
import { ROUTES } from '@/lib/site'

/**
 * Three domain judgements, each paired with where it shows up in the build. The
 * pairing is the argument: domain experience that changed an implementation
 * decision is worth more than domain experience asserted in a paragraph.
 */
const JUDGEMENTS: readonly {
  readonly claim: string
  readonly detail: string
  readonly artefact: string
}[] = [
  {
    claim: 'Front and back gross must stay separate.',
    detail:
      'A store can hold total gross steady while front gross collapses and F&I compensates. That is a materially different business situation from one where both are stable, and combining them early destroys the diagnosis.',
    artefact: 'KPI-GRS-001 / 002 / 003',
  },
  {
    claim: 'An employee ranking without context is misleading.',
    detail:
      'A high-volume salesperson may show weak gross retention, poor follow-up, heavy discounting, or simply favourable lead routing. Volume alone never ranks a person in this model, and the KPI catalogue says so on the measure itself.',
    artefact: 'KPI-SLS-001 interpretation caution',
  },
  {
    claim: 'Median age is the headline, and the mean is the diagnostic.',
    detail:
      'Inventory age is right-skewed: a handful of 200-day units drags the mean up and makes a healthy lot look sick. The gap between mean and median is itself the evidence of an aged tail, so the catalogue publishes both and names which one leads.',
    artefact: 'KPI-INV-003 and KPI-INV-004',
  },
]

export function AuthorPerspective() {
  return (
    <Section id="author" bordered>
      <Container width="wide">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          <Reveal className="flex flex-col gap-5 lg:col-span-5">
            <Eyebrow>Why this project exists</Eyebrow>
            <Heading level={2}>
              The domain judgement here comes from working the floor, not from reading
              about it.
            </Heading>
            <Text size="body" className="max-w-prose">
              More than 25 years in automotive retail: sales, finance, dealership
              management, CRM and DMS administration, inventory, lead management and
              operational performance. Then computer science and technical retraining, and
              the SQL, PostgreSQL, Python, React and analytics work that this repository
              is made of.
            </Text>
            <Text size="body" tone="muted" className="max-w-prose">
              Most analytics portfolios are built by someone who learned the business from
              a dataset. The difference shows up in the small decisions - which exclusion
              rule is correct, which average lies, which ranking is unfair - and those
              decisions are where a dealership report becomes either useful or ignored.
            </Text>
            <LinkButton
              href={ROUTES.about.href}
              variant="secondary"
              iconAfter={<ArrowRight />}
              className="mt-2 self-start"
            >
              More on the author
            </LinkButton>
          </Reveal>

          <div className="flex flex-col gap-4 lg:col-span-7">
            {JUDGEMENTS.map((judgement) => (
              <Reveal key={judgement.claim} child>
                <Card className="flex flex-col gap-3">
                  <h3 className="text-lg leading-snug font-semibold text-ink">
                    {judgement.claim}
                  </h3>
                  <Text size="sm" tone="muted" className="max-w-prose">
                    {judgement.detail}
                  </Text>
                  <div className="flex items-center gap-2 border-t border-line-subtle pt-3">
                    <span className="eyebrow text-2xs">In the repository</span>
                    <CodeLabel tone="accent">{judgement.artefact}</CodeLabel>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  )
}
