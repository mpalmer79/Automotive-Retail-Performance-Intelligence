import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Canvas } from '@/components/shell/field'
import { DealHeadlineHeader } from '@/components/dashboard/deal-headline'
import {
  ChecksSection,
  BackGrossSectionBlock,
  FinanceSectionBlock,
  ProductSectionBlock,
  FrontGrossSection,
  IdentitySection,
  LineageSection,
  StaffSection,
  TimelineSectionBlock,
  TotalGrossSection,
  TradeSectionBlock,
  VehicleSection,
} from '@/components/dashboard/deal-jacket-sections'
import { GridRow, Module, Workspace } from '@/components/dashboard/workspace-grid'
import { Container, Section } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { dashboardManifest } from '@/lib/dashboard/data'
import { buildDealJacket, dealRow } from '@/lib/dashboard/deal-jacket'
import { formatIsoDate } from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { ROUTES } from '@/lib/site'

/**
 * THE RENDERING DECISION (`DASH.4-01`), MEASURED
 * ----------------------------------------------
 * Two options, and the increment required the choice to be made from measurement
 * rather than preference.
 *
 * FULL STATIC GENERATION would add `generateStaticParams` returning all 650 sale ids
 * and prerender 650 HTML documents at build time. Measured: the route's own HTML is
 * about 46 kB compressed and roughly 190 kB uncompressed, so 650 documents is on the
 * order of **120 MB of prerendered output** carried in `.next` and into the Railway
 * image, to serve a page a visitor opens once or twice. Build time rises with the
 * deal count, and every future increment that grows the deal population pays again.
 *
 * SERVER RENDERING FROM STATICALLY PACKAGED DATA is what this route does. The 18
 * deal-jacket partitions are static imports, so they are resolved by the output
 * tracer as graph edges and are present in `.next/standalone` as data — 443 kB — with
 * **no file read at runtime and no database**. A request builds the map once per
 * process, looks the deal up, and renders. Neither option introduces an API or a
 * runtime database, so both satisfy ADR-0013; the measurement is what decides.
 *
 * 443 kB of data against ~120 MB of prerendered HTML is not a close call. The
 * decision and its figures are recorded in `DATA_CONTRACT.md §9` and
 * `PERFORMANCE.md §9.4`.
 *
 * The page is complete HTML without JavaScript either way, which is the property the
 * choice was not allowed to cost.
 */
export const dynamicParams = true

export async function generateMetadata({
  params,
}: {
  params: Promise<{ saleId: string }>
}): Promise<Metadata> {
  const { saleId } = await params
  const row = dealRow(saleId)
  if (row === undefined) {
    return { title: 'Deal not found', robots: { index: false, follow: false } }
  }
  return {
    title: `Deal ${saleId}`,
    description: `A sanitized record of one finalized synthetic transaction, ${saleId}, from the Granite Auto Group dataset. Not a real sale, customer, or dealership record.`,
    // A deal page is a drill-through over synthetic data, not a destination a search
    // engine should surface: 650 near-identical documents would be index noise, and
    // the sitemap lists the index route only.
    robots: { index: false, follow: true },
  }
}

/**
 * The Deal Jacket: one finalized transaction, explained to the cent.
 *
 * WHAT `UX.2B` CHANGED, MEASURED
 * ------------------------------
 * `docs/reviews/UX-2B-BASELINE.md` §7 measured it at 5,806 px with ten `h2`s of equal weight
 * and 616 words of visible prose about one transaction. Sale price, front gross, back gross,
 * total gross and days in stock — the five figures a reviewer wants at once — were in four
 * different sections, and the first viewport at 1440 × 900 carried an `h1` and two section
 * titles and no money at all.
 *
 * `UX.2B` §19–§24 rebuild it as an identity header carrying those five figures, then the
 * workspace grid's modules in the money's own order, with two economics visuals and the
 * verification behind a disclosure. Six section ledes explaining the METHOD before the figures
 * they qualify are gone; the method itself is not — every calculation block, every
 * recomputation and all eight integrity checks are in the document, and a failed check still
 * renders visibly rather than behind a summary.
 *
 * A RECORD VIEW, NOT A WORKFLOW. Nothing on this page can be edited, assigned,
 * approved, submitted, repriced, funded or contracted, and no control exists that
 * pretends to. That is not a styling choice: the export carries no column such an
 * action would write to, and there is no API to write it through.
 *
 * SECTION ORDER IS STILL THE MONEY'S ORDER. Identity and the headline, then the front-gross
 * arithmetic, then the trade context that is deliberately outside it, then the finance
 * amounts and the aggregate back gross, then the total. Mobile keeps that order exactly.
 */
export default async function DealJacketPage({
  params,
}: {
  params: Promise<{ saleId: string }>
}) {
  const { saleId } = await params
  const jacket = buildDealJacket(saleId)
  if (jacket === null) notFound()

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const anyFailure =
    !jacket.frontGross.verification.verified || !jacket.totalGross.verification.verified

  return (
    <Canvas>
      <OperatingPageHeader
        title={jacket.identity.saleId}
        subtitle={jacket.vehicle.display}
        context={operatingContext([
          jacket.identity.storeName,
          `Delivered ${jacket.identity.deliveryDate}`,
          anyFailure
            ? `${String(jacket.checksNeedingReview)} check${jacket.checksNeedingReview === 1 ? '' : 's'} need review`
            : 'All checks passed',
        ])}
        backLink={{ href: ROUTES.dashboardDeals.href, label: 'All deals' }}
        methodology={<ExportProvenance exportState={exportState} powerBi={powerBi} />}
      >
        {/*
          THE PERSISTENT DISCLOSURE. Above the fold, in the body, on paper. It is the one
          sentence a reader of ONE TRANSACTION needs before they meet the deal, and it is not
          behind anything.
        */}
        <p className="rounded-lg border border-line bg-surface-sunken/60 p-3 text-sm font-medium text-ink">
          Fictional transaction from the synthetic Granite Auto Group dataset. Not a real
          sale, customer, or dealership record.
        </p>
      </OperatingPageHeader>

      <Workspace>
        {/* ---------------------------------------------------------------- */}
        {/* ROW 1 — what deal this is, and what it made                       */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module
            id="headline"
            title="This deal"
            zone="performance"
            visual="deal-headline"
          >
            <DealHeadlineHeader jacket={jacket} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 2 — the two economics, side by side                           */}
        {/* ---------------------------------------------------------------- */}
        {/*
          `UX.2B` §49 asks the Jacket to show deal identity and core economics without
          scrolling. The header above is the identity and the five figures; these two modules
          are where each of the two grosses comes from, and they are the first thing under it.
        */}
        <GridRow>
          <Module
            id="front-gross"
            title="Vehicle economics"
            span={6}
            visual="front-economics"
          >
            <FrontGrossSection jacket={jacket} />
          </Module>
          <Module
            id="back-gross"
            title="Finance office economics"
            span={6}
            zone="finance"
            visual="back-economics"
          >
            <BackGrossSectionBlock jacket={jacket} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 3 — the trade, the funding, the total                         */}
        {/* ---------------------------------------------------------------- */}
        {/*
          NO MODULE NOTES BELOW THIS POINT, AND THAT IS THE PROSE REDUCTION. Every one of
          these modules already carries the sentence a reader needs INSIDE its own body,
          where the figures it qualifies are: the trade block states that variance is
          deliberately outside the front-gross identity, the finance block lists what the
          model does not hold, the staff block states that no name exists anywhere in ARPI,
          and the checks block states what a check is. A module note repeating any of them
          is the same caveat printed twice on one screen — measured at 616 visible words on
          this route before `UX.2B`, and the largest single source of them was exactly this
          kind of restatement in a section lede.
        */}
        <GridRow>
          <Module id="trade" title="Trade" span={4}>
            <TradeSectionBlock trade={jacket.trade} />
          </Module>
          <Module id="finance" title="How the deal was funded" span={4} zone="finance">
            <FinanceSectionBlock jacket={jacket} />
          </Module>
          <Module id="total-gross" title="Total gross" span={4} zone="performance">
            <TotalGrossSection jacket={jacket} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 4 — the contracts, and the unit                               */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module id="products" title="F&amp;I products written" span={7} zone="finance">
            <ProductSectionBlock jacket={jacket} />
          </Module>
          <Module
            id="vehicle"
            title="The unit that was sold"
            span={5}
            zone="inventory"
            note="The odometer is banded and the VIN-style identifier is synthetic."
          >
            <VehicleSection jacket={jacket} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 5 — the paper trail                                           */}
        {/* ---------------------------------------------------------------- */}
        <GridRow>
          <Module id="structure" title="Deal structure" span={4}>
            <IdentitySection jacket={jacket} />
          </Module>
          <Module id="staff" title="Who worked the transaction" span={4}>
            <StaffSection staff={jacket.staff} />
          </Module>
          <Module id="timeline" title="How the deal arrived" span={4} zone="funnel">
            <TimelineSectionBlock timeline={jacket.timeline} />
          </Module>
        </GridRow>

        {/* ---------------------------------------------------------------- */}
        {/* ROW 6 — integrity and lineage                                     */}
        {/* ---------------------------------------------------------------- */}
        {/*
          `UX.2B` §24 subordinates verification to the transaction and requires it to stay
          easy to inspect. The eight checks are a module rather than a page region, they are
          below every figure they check, and the count of any needing review is in the control
          band's context line at the top — so a reader never has to scroll to discover that
          something disagreed.
        */}
        <GridRow>
          <Module
            id="checks"
            title="What this page checked before showing you the figures"
            span={7}
          >
            <ChecksSection
              checks={jacket.checks}
              needingReview={jacket.checksNeedingReview}
            />
          </Module>
          <Module id="lineage" title="Where these figures came from" span={5}>
            <LineageSection jacket={jacket} />
          </Module>
        </GridRow>
      </Workspace>

      {/*
        Navigation back. Omitted from print: paper has nowhere to go.

        The attribute is on a plain `<div>` rather than on `<Section>` or `<Text>`,
        because those primitives take a declared prop list and do not forward
        arbitrary attributes — passing it to `Section` compiled, rendered nothing,
        and printed the navigation anyway. `dashboard-deal-jacket.spec.ts` asserts
        the rule under `media: 'print'`, which is what caught it, and
        `dashboard-boundaries.test.ts` now fails the build if the attribute is put
        on a component that would swallow it again.
      */}
      <Section rhythm="default">
        <Container width="content">
          <div data-arpi-print="omit">
            <Text size="sm" tone="muted">
              <a
                href={ROUTES.dashboardDeals.href}
                className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                Return to the Deal Explorer
              </a>{' '}
              to find another transaction, or open{' '}
              <a
                href={ROUTES.dashboardSalesGross.href}
                className="inline-flex min-h-6 items-center underline decoration-line underline-offset-2 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
              >
                Sales and gross
              </a>{' '}
              for the aggregate this deal is part of. Data as of{' '}
              {formatIsoDate(exportState.asOfDate)}.
            </Text>
          </div>
        </Container>
      </Section>
    </Canvas>
  )
}
