/**
 * Chapter three: the interactive product tour.
 *
 * The step content is assembled here, on the server, and handed to the client
 * island as plain data. Two reasons, and the second is the one that matters:
 *
 *   1. The island holds a selection and nothing else. Keeping the copy out of it
 *      keeps the client bundle to the behaviour.
 *   2. Three of the four steps quote a repository count. Those come from
 *      `lib/manifest`, which is generated from repository evidence on every
 *      build and fails the build when it disagrees with that evidence. Reading
 *      them here keeps the manifest on the server, and it keeps this section
 *      under the same rule as every other number on the site:
 *      `tests/unit/content-integrity.test.ts` fails if one is ever typed as a
 *      literal.
 *
 * The captured dimensions are the files' own. They are stated so the frame
 * reserves its box before the bytes arrive; when a capture is re-taken at a
 * different size these change with it.
 */
import { ProductTour, type TourStep } from '@/components/media/product-tour'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { counts } from '@/lib/manifest'
import { inventorySummary } from '@/lib/inventory'
import { ROUTES } from '@/lib/site'
import { formatCount } from '@/lib/utils'

/**
 * Exported so `tests/unit/media.test.ts` can hold the declared dimensions
 * against the committed files rather than against a second copy of the numbers.
 * A capture re-taken at a different size and not re-declared here reserves the
 * wrong box and shifts the layout when it loads; that is the regression the test
 * exists to catch, and it can only catch it if both sides come from here.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'inventory',
    tab: 'Inventory',
    title: 'Explore the sanitized inventory',
    href: ROUTES.inventory.href,
    surface: 'Inventory explorer',
    provenance: 'capture',
    provenanceNote: 'Sanitized reference data',
    summary: `Every listing the three stores carry, filterable by store, condition, make, model, model year, advertised price and mileage, and sortable six ways. ${formatCount(inventorySummary.totalRecords)} rows, derived at build time from the workbooks in this repository.`,
    insight:
      'There is no request and no loading state. The record set was read from the workbooks at build time and ships as data, so a filter is a synchronous pass over rows that arrived with the page. Sorting by price puts an unpriced listing last in both directions rather than treating a missing price as zero, because a listing the source did not price is not the cheapest car on the lot.',
    cta: 'Open the inventory explorer',
    image: {
      src: '/media/inventory-explorer.webp',
      alt: 'The inventory explorer at a desktop width: a filter and sort panel with controls for condition, dealership, make, model, model year, advertised price and mileage, a status line stating how many listings match and how many carry an advertised price, and a table of listings showing dealership, condition, year, make, model, trim, mileage, advertised price, stock reference and snapshot date.',
      width: 1600,
      height: 1026,
    },
  },
  {
    id: 'architecture',
    tab: 'Architecture',
    title: 'Trace the data architecture',
    href: ROUTES.architecture.href,
    surface: 'Architecture explorer',
    provenance: 'capture',
    provenanceNote: 'Component states read from the manifest',
    summary:
      'Every component of the platform, from a seeded generator through the raw, staging, warehouse, reporting and audit schemas to the semantic model above them. Selecting one shows what owns it, what state it is in, which database role can reach it, and what it depends on.',
    insight:
      'The semantic model and both validation paths are drawn with dashed outlines because they are built and statically checked and no Microsoft engine has ever loaded them. The states are not authored in the component: they come from the generated manifest, so the diagram cannot claim a stage is finished after the evidence stops saying so.',
    cta: 'Open the architecture explorer',
    image: {
      src: '/media/architecture-explorer.webp',
      alt: 'The architecture explorer with the warehouse schema selected: a pipeline diagram running from configuration profiles and seeded generators through raw, staging, warehouse and reporting to a dashed semantic model, and a detail panel titled warehouse schema showing a complete status, its ownership by PostgreSQL 16, its privacy boundary and its role access.',
      width: 1600,
      height: 842,
    },
  },
  {
    id: 'data-model',
    tab: 'Data model',
    title: 'Inspect the dimensional model',
    href: ROUTES.dataModel.href,
    surface: 'Data model explorer',
    provenance: 'capture',
    provenanceNote: 'Synthetic warehouse. Row counts are of generated data',
    summary: `${formatCount(counts.dimensions.value)} conformed dimensions and ${formatCount(counts.facts.value)} facts, each with its declared grain, its keys, how it handles change over time, and how it is classified for privacy. Selecting an entity highlights the relationships it participates in.`,
    insight:
      'The grain is the field worth reading first, and it is enforced by a UNIQUE constraint in DDL rather than promised in a document. Every relationship in the model is single-direction: there is no bidirectional filter and no many-to-many, and a static check fails the build if one appears.',
    cta: 'Open the data model explorer',
    image: {
      src: '/media/data-model-explorer.webp',
      alt: 'The data model explorer with the vehicle sale fact selected: filters for entity kind, business domain and history policy above a relationship diagram of dimensions and facts, and a detail panel showing the declared grain of one row per finalized vehicle transaction, the primary key, the history policy and the privacy classification.',
      width: 1600,
      height: 1079,
    },
  },
  {
    id: 'kpis',
    tab: 'KPIs',
    title: 'Read the governed definitions',
    href: ROUTES.kpis.href,
    surface: 'KPI catalogue',
    provenance: 'capture',
    provenanceNote: 'Definitions only. No engine has evaluated these measures',
    summary: `Every governed KPI with its formula, both sides of its ratio, its grain, its date basis, its null rule, the reporting view that owns the SQL, and what a reader must not conclude from it. ${formatCount(counts.governedKpis.value)} of them, searchable and filterable by domain and implementation status.`,
    insight:
      'No value appears anywhere in the catalogue, and none will until an engine has returned one that reconciles. What is published instead is the part that is genuinely hard and genuinely rare: the exclusion rules, the denominators, and the interpretation caution that travels on the measure rather than in a footnote nobody reads.',
    cta: 'Open the KPI catalogue',
    image: {
      src: '/media/kpi-catalogue.webp',
      alt: 'The KPI catalogue: a search field, domain filters for sales, gross, inventory, lead funnel and marketing, an implementation status filter, and a list of governed KPIs each showing its identifier, name, unit, source reporting view and the DAX measure it maps to.',
      width: 1600,
      height: 1026,
    },
  },
]

export function ProductTourSection() {
  return (
    <Section id="tour" tone="canvas" className="scroll-mt-24">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="The product tour"
          title="Four things you can open right now"
          lede="Each frame is a straight capture of the route named on it, taken from a production build of this application. Nothing here is a mockup, and every one of them is one click away."
        />

        <ProductTour steps={TOUR_STEPS} className="mt-12" />

        <Text size="sm" tone="muted" className="mt-10 max-w-prose">
          The captures are regenerated by a committed script rather than drawn, so a frame
          that stops matching its route is a change somebody made rather than a picture
          that was always aspirational.
        </Text>
      </Container>
    </Section>
  )
}
