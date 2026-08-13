/**
 * Chapter three: the interactive product tour.
 *
 * The step content is assembled here, on the server, and handed to the client
 * island as plain data. Two reasons, and the second is the one that matters:
 *
 *   1. The island holds a selection and nothing else. Keeping the copy out of it
 *      keeps the client bundle to the behaviour.
 *   2. Three of the five steps quote a repository count. Those come from
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
import { counts } from '@/lib/manifest'
import { inventorySummary } from '@/lib/inventory'
import { ROUTES } from '@/lib/site'
import { formatCount } from '@/lib/utils'
import { technicalHref } from '@/lib/technical'

/**
 * Exported so `tests/unit/media.test.ts` can hold the declared dimensions
 * against the committed files rather than against a second copy of the numbers.
 * A capture re-taken at a different size and not re-declared here reserves the
 * wrong box and shifts the layout when it loads; that is the regression the test
 * exists to catch, and it can only catch it if both sides come from here.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    /*
     * THE CONSOLE IS FIRST BECAUSE IT IS THE PRODUCT.
     *
     * The tour opened on the inventory explorer for as long as `/` was a landing
     * page and the explorers were the only things to show. `ADR-0015` made the
     * operating console the front door, and the tour went on showing four
     * explorers and not the application a reader now lands on. It is the first
     * step for the same reason it is the first route: everything else on this
     * site exists to explain how its figures are kept honest.
     */
    id: 'executive',
    tab: 'Executive',
    title: 'Start on the operating console',
    href: ROUTES.home.href,
    /*
     * "Executive console" and not "Executive Command Center", which is the route's
     * title in `ROUTES`. The chrome truncates its title, the frame is seven columns
     * of twelve, and the full name lost its last word to an ellipsis at every
     * desktop width — a product frame whose first line is a clipped product name
     * reads as a rendering defect. The four siblings are named for the surface
     * rather than titled — "Inventory explorer", "KPI catalogue" — and this follows
     * them. The route's own name is one click away, on the route.
     */
    surface: 'Executive console',
    provenance: 'capture',
    provenanceNote: 'Default filter state',
    summary:
      'The group at a glance: retail units, gross, gross per retail unit, lead-to-sale conversion, inventory investment and aged inventory, each against the prior month, above the operating trend, a store comparison and where the month sits against plan. Every figure carries the identifier of the governed KPI that defines it, and drills through to the transactions behind it.',
    insight:
      'The whole surface is rendered on the server from an export packaged at build time, and there is exactly one client island on it — the filter form. The trend’s metric switch is a radio group and CSS, so it ships no JavaScript and cannot recalculate anything. With scripting switched off the rail, the trend, the comparison, the pace bullets and every disclosure are all still there, and filter state stays in the URL, so any view of the console is a link somebody else can open.',
    insightLabel: 'Why the console renders with scripting switched off',
    cta: 'Open the executive console',
    image: {
      src: '/media/executive-command-center.webp',
      alt: 'The executive console at a desktop width: a navigation rail listing the operating sections, a control band with period, comparison, store, condition and lead source filters, a rail of KPI cards showing retail units, total gross, gross per retail unit, front and back gross per retail unit, lead-to-sale conversion, inventory investment and aged inventory percentage, each with its movement against the prior month and its governed KPI identifier, and below them the operating trend, a store comparison and a plan-and-pace panel.',
      width: 1600,
      height: 1111,
    },
  },
  {
    id: 'inventory',
    tab: 'Inventory',
    title: 'Explore the sanitized inventory',
    href: ROUTES.inventory.href,
    surface: 'Inventory explorer',
    provenance: 'capture',
    provenanceNote: 'Sanitized reference data',
    summary: `Every listing the three stores carry, filterable by store, condition, make, model, model year, advertised price and mileage, and sortable six ways. ${formatCount(inventorySummary.totalRecords)} rows, derived at build time from the workbooks in this repository.`,
    /*
     * This step carries no insight disclosure. Its paragraph explained why
     * filtering the table never touches the network, which is an engineering
     * note about how the platform is built rather than a decision about the
     * inventory surface, and it is now on `/architecture` beside the pipeline it
     * describes. It is not repeated here.
     */
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
    href: technicalHref('architecture'),
    surface: 'Architecture explorer',
    provenance: 'capture',
    provenanceNote: 'Component states read from the manifest',
    summary:
      'Every component of the platform, from a seeded generator through the raw, staging, warehouse, reporting and audit schemas to the semantic model above them. Selecting one shows what owns it, what state it is in, which database role can reach it, and what it depends on.',
    insight:
      'The semantic model and both validation paths are drawn with dashed outlines because they are built and statically checked and no Microsoft engine has ever loaded them. The states are not authored in the component: they come from the generated manifest, so the diagram cannot claim a stage is finished after the evidence stops saying so.',
    insightLabel: 'Why three components are drawn with dashed outlines',
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
    href: technicalHref('data-model'),
    surface: 'Data model explorer',
    provenance: 'capture',
    provenanceNote: 'Synthetic warehouse. Row counts are of generated data',
    summary: `${formatCount(counts.dimensions.value)} conformed dimensions and ${formatCount(counts.facts.value)} facts, each with its declared grain, its keys, how it handles change over time, and how it is classified for privacy. Selecting an entity highlights the relationships it participates in.`,
    insight:
      'The grain is the field worth reading first, and it is enforced by a UNIQUE constraint in DDL rather than promised in a document. Every relationship in the model is single-direction: there is no bidirectional filter and no many-to-many, and a static check fails the build if one appears.',
    insightLabel: 'Why the grain is a database constraint, not a promise',
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
    href: technicalHref('kpis'),
    surface: 'KPI catalogue',
    provenance: 'capture',
    provenanceNote: 'Definitions only. No engine has evaluated these measures',
    summary: `Every governed KPI with its formula, both sides of its ratio, its grain, its date basis, its null rule, the reporting view that owns the SQL, and what a reader must not conclude from it. ${formatCount(counts.governedKpis.value)} of them, searchable and filterable by domain and implementation status.`,
    insight:
      'No value appears anywhere in the catalogue, and none will until an engine has returned one that reconciles. What is published instead is the part that is genuinely hard and genuinely rare: the exclusion rules, the denominators, and the interpretation caution that travels on the measure rather than in a footnote nobody reads.',
    insightLabel: 'Why no KPI value appears anywhere in the catalogue',
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
        {/* The lede lost its second sentence and the section lost its closing
            paragraph. Both said the same thing the first sentence says: these
            are captures of the named route, regenerated by a committed script.
            The frames carry a provenance word in their own chrome, which is a
            better place for it than a paragraph under the tour. */}
        <SectionHeader
          layout="wide"
          eyebrow="The product tour"
          title="Five things you can open right now"
          lede="Each frame is a straight capture of the route named on it, taken from a production build. Nothing here is a mockup."
        />

        <ProductTour steps={TOUR_STEPS} className="mt-12" />
      </Container>
    </Section>
  )
}
