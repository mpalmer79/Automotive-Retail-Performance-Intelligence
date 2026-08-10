import { EngineeringProof } from '@/components/sections/engineering-proof'
import { ProductTourSection } from '@/components/sections/product-tour'
import { StoreStory } from '@/components/sections/store-story'
import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'

/**
 * The technical destination's opening state, and where the retired home page went.
 *
 * `/` was a marketing landing page in front of a working application: a hero, the
 * three-store story, a four-route product tour and a closing call to action. It
 * was the right page when the application behind it was two screens; it stopped
 * being right when the application became nine operating surfaces, and ADR-0015
 * made the console the front door.
 *
 * NOTHING WAS DELETED. It was rehomed, and this is where three of the four
 * sections landed:
 *
 *   Store story      here, as the demo group's context — three rooftops, three
 *                    operating models, one reporting layer
 *   Product tour     here, as what the application actually contains, four routes
 *                    photographed from a real build
 *   Engineering proof
 *                    here, as the four evidence numerals it always was
 *   Hero + closing   retired. The hero's job was to introduce a product a reader
 *                    could not yet see; the reader now lands ON the product, and
 *                    an introduction to something already on screen is a delay.
 *                    Its one load-bearing claim — the group is fictional and the
 *                    data is synthetic — is in the operating shell, permanently.
 *                    The author positioning it carried is `/about`, at length.
 */
export function OverviewView() {
  return (
    <>
      <TechnicalViewMeta>
        <StatusBadge
          status="complete"
          label={`${String(counts.reportingViews.value)} reporting views, ${String(counts.governedKpis.value)} governed KPIs`}
          size="sm"
        />
        <StatusBadge
          status="pending-external"
          label="Semantic model: real-engine validation pending"
          size="sm"
        />
        <SourceLink path="ARCHITECTURE.md" field="binding architecture" />
        <SourceLink path="README.md" field="repository overview" />
      </TechnicalViewMeta>

      <Section rhythm="tight" tone="canvas">
        <Container width="wide">
          <SectionHeader
            eyebrow="What it is"
            title="A governed analytical layer, not a dealer management system"
            layout="wide"
            lede="ARPI publishes one consistent operating view over what dealership systems produce. It is the system of record for nothing."
          />
          <div className="grid gap-6 pt-8 md:grid-cols-3">
            <Claim
              heading="One model, seven domains"
              body="Seven domains share conformed store, date, vehicle and employee keys, so a figure means the same thing whichever surface reads it."
            />
            <Claim
              heading="Every metric has both sides"
              body="A ratio is published with its numerator, denominator, grain, date basis and the caution a reader needs before quoting it."
            />
            <Claim
              heading="Reconciled, not asserted"
              body="Each run proves its totals against independently computed ones. A rule never observed failing is not treated as a control."
            />
          </div>
        </Container>
      </Section>

      <StoreStory />
      <ProductTourSection />

      <Section rhythm="tight" tone="evidence">
        <Container width="wide">
          <EngineeringProof />
        </Container>
      </Section>
    </>
  )
}

function Claim({ heading, body }: { readonly heading: string; readonly body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <Text size="sm" tone="muted">
        {body}
      </Text>
    </div>
  )
}
