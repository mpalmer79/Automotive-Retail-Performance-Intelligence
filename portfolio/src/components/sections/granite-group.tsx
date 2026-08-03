/**
 * Chapter two: the business this project models.
 *
 * WHY IT IS THIS HIGH ON THE PAGE
 * -------------------------------
 * Before this section existed, a visitor could read the whole home page and
 * learn a great deal about the pipeline while never learning what the pipeline
 * was for. The engineering chapters all describe a warehouse serving a
 * "fictional three-store dealer group", and that phrase was the entire
 * description of the subject.
 *
 * It sits immediately after the hero, ahead of the argument about why dealership
 * analytics is hard, because the argument reads differently once you know that
 * one of these three stores gets its inventory from a manufacturer allocation and
 * another buys every car it sells. That difference is the whole reason a
 * group-level number needs a store-level one beside it.
 *
 * EVERY FIGURE HERE IS DERIVED
 * ----------------------------
 * The counts on the cards and in the snapshot come from
 * `src/generated/inventory-summary.json` and `src/generated/dealerships.json`,
 * which are written at build time from the sanitized workbooks under
 * `data/reference/inventory/`. There is no authored number anywhere in this
 * component, and `tests/unit/inventory.test.ts` asserts that no component in
 * `src/` writes one.
 *
 * Server component. Its only motion is the shared reveal.
 */
import { ArrowRight } from 'lucide-react'

import { DealershipCard } from '@/components/dealerships/dealership-card'
import { GroupSnapshot } from '@/components/dealerships/group-snapshot'
import { Reveal, RevealGroup, RevealItem } from '@/components/motion/reveal'
import { LinkButton } from '@/components/ui/button'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { dealershipGroup, dealerships } from '@/lib/inventory'
import { ROUTES } from '@/lib/site'
import { formatCount } from '@/lib/utils'

export function GraniteGroup() {
  return (
    <Section id="granite-auto-group" tone="canvas">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The business being modelled"
          title="Meet Granite Auto Group"
          lede={dealershipGroup.introduction}
        />

        <RevealGroup className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {dealerships.map((dealership, index) => (
            <RevealItem key={dealership.id} index={index} className="flex">
              <DealershipCard dealership={dealership} className="w-full" />
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-12 flex flex-col gap-8 border-t border-line pt-10">
          <div className="flex flex-col gap-3">
            <p className="eyebrow flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="inline-block h-px w-6 shrink-0 bg-accent"
              />
              Group inventory snapshot
            </p>
            <Text size="body" tone="secondary" className="max-w-prose">
              {`One reporting layer over ${formatCount(dealerships.length)} stores that do not ` +
                'run the same business. ' +
                dealershipGroup.operatingModel}
            </Text>
          </div>

          <GroupSnapshot showSources={false} />

          <div className="flex flex-wrap items-center gap-3">
            <LinkButton
              href={ROUTES.dealerships.href}
              variant="primary"
              iconAfter={<ArrowRight strokeWidth={2} />}
            >
              How the three stores compare
            </LinkButton>
            <LinkButton href={ROUTES.inventory.href} variant="secondary">
              Open the inventory explorer
            </LinkButton>
          </div>
        </Reveal>
      </Container>
    </Section>
  )
}
