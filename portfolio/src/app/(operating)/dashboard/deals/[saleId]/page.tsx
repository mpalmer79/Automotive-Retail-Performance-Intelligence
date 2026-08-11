import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Canvas } from '@/components/shell/field'
import { GridRow, Module, Workspace } from '@/components/dashboard/exec-grid'
import {
  BackGrossComposition,
  ChecksSection,
  DealEconomicsRail,
  FinanceSectionBlock,
  FrontGrossSection,
  FrontGrossWaterfall,
  IdentitySection,
  LineageSection,
  ProductSectionBlock,
  StaffSection,
  TimelineSectionBlock,
  TotalGrossSection,
  TradeSectionBlock,
  VehicleSection,
} from '@/components/dashboard/deal-jacket-sections'
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
 * The Deal Jacket: one finalized transaction, as a deal-review record.
 *
 * A RECORD VIEW, NOT A WORKFLOW. Nothing on this page can be edited, assigned, approved,
 * submitted, repriced, funded or contracted, and no control exists that pretends to. That
 * is not a styling choice: the export carries no column such an action would write to, and
 * there is no API to write it through.
 *
 * WHAT REPLACED WHAT
 * ------------------
 * `UX.1` left this route as a disclosure band, an eight-fact identity grid, and a
 * two-column layout of nine sections each opening with an eyebrow, an `h2` and a
 * two-to-four-line lede. Measured on the merge of `UX.2A`, at 1440 × 900: 5,806 px,
 * **zero framed visualizations**, 616 words of visible prose — and the first thing in the
 * money column was the front-gross ARITHMETIC, a five-line `<dl>` of operators.
 *
 * The order is now the one a desk actually reads. `UX.2B` §5: identity, then the five
 * headline figures, then the modular operating areas — deal structure, vehicle economics,
 * trade, F&I, staff attribution, lead journey, integrity. The formula proof is not gone and
 * is not diminished: it is one disclosure below the picture that shows the same numbers,
 * still recomputed from its components, still verified, still rendered as words when it
 * fails.
 *
 * TWO VISUALS, AND BOTH ARE THE EXISTING ARITHMETIC DRAWN
 * ------------------------------------------------------
 * The front-gross waterfall maps `frontGross.lines` — the ordered operator lines the view
 * model already published — onto the same primitive the gross-change bridge uses: the sale
 * price and the result are anchors, and acquisition, reconditioning and pack are the
 * falling steps between them. The F&I composition draws reserve against original product
 * gross over the PUBLISHED back-end gross, so a component that failed to reconcile shows as
 * a bar that does not fill its track.
 *
 * NO FIGURE ON THIS PAGE IS COMPUTED BY THIS INCREMENT. The one view-model change is
 * additive: `backGross.exact` publishes three values the module already had, so a bar can
 * be measured from an exact decimal rather than from a formatted string.
 *
 * NO CUSTOMER DATA, unchanged and structural. There is no name, no contact detail, no note
 * field and no free text of any kind anywhere in ARPI to expose.
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
        notices={
          <p className="rounded-lg border border-line bg-surface-sunken/60 p-3 text-sm font-medium text-ink">
            Fictional transaction from the synthetic Granite Auto Group dataset. Not a real
            sale, customer, or dealership record.
          </p>
        }
        methodology={<ExportProvenance exportState={exportState} powerBi={powerBi} />}
      />

      <Workspace>
        {/* ------------------------------------------------------------------ */}
        {/* ROW 1 — what the deal made                                          */}
        {/* ------------------------------------------------------------------ */}
        {/*
          THE FIVE FIGURES FIRST, AND THE ARITHMETIC BELOW THEM. `UX.2B` §5 is explicit
          that formula proof must not be visually prioritized over the transaction, and
          this row is that instruction: sale price, front gross, back gross, total gross,
          days in stock. Every one is a figure the view model had already resolved.
        */}
        <GridRow>
          <Module
            id="economics"
            title="What the deal made"
            zone="deal"
            visual="kpi-rail"
            meta={jacket.identity.saleType}
          >
            <DealEconomicsRail
              jacket={jacket}
              daysInStock={
                jacket.vehicle.daysInInventory === null
                  ? 'Not published'
                  : String(jacket.vehicle.daysInInventory)
              }
            />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 2 — the two compositions, and the deal's own structure          */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module
            id="front-gross"
            title="Vehicle economics"
            span={5}
            zone="deal"
            visual="front-gross"
          >
            <FrontGrossWaterfall jacket={jacket} />
            <details className="rounded-lg border border-line-subtle bg-surface-sunken/40">
              <summary className="flex min-h-touch cursor-pointer items-center px-3 text-xs font-medium text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent">
                The calculation, line by line, and what it excludes
              </summary>
              <div className="px-3 pb-3">
                <FrontGrossSection jacket={jacket} />
              </div>
            </details>
          </Module>

          <Module id="back-gross" title="F&I" span={4} zone="deal" visual="back-gross">
            <BackGrossComposition jacket={jacket} />
          </Module>

          <Module id="identity" title="Deal structure" span={3} zone="deal">
            <IdentitySection jacket={jacket} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 3 — the unit, the trade, the funding                            */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module id="vehicle" title="The unit that was sold" span={5} zone="deal">
            <VehicleSection jacket={jacket} />
          </Module>
          <Module id="trade" title="Trade" span={3} zone="deal">
            <TradeSectionBlock trade={jacket.trade} />
          </Module>
          <Module id="finance" title="How the deal was funded" span={4} zone="deal">
            <FinanceSectionBlock jacket={jacket} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 4 — the contracts, and the people                               */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module
            id="products"
            title="What was written, and what remains"
            span={7}
            zone="deal"
          >
            <ProductSectionBlock jacket={jacket} />
          </Module>
          <Module id="staff" title="Who worked the transaction" span={5} zone="deal">
            <StaffSection staff={jacket.staff} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 5 — how it arrived, and the total                               */}
        {/* ------------------------------------------------------------------ */}
        <GridRow align="start">
          <Module id="timeline" title="How the deal arrived" span={7} zone="deal">
            <TimelineSectionBlock timeline={jacket.timeline} />
          </Module>
          <Module id="total-gross" title="Total gross" span={5} zone="deal">
            <TotalGrossSection jacket={jacket} />
          </Module>
        </GridRow>

        {/* ------------------------------------------------------------------ */}
        {/* ROW 6 — integrity and lineage                                       */}
        {/* ------------------------------------------------------------------ */}
        {/*
          EIGHT CHECKS, EACH RECOMPUTING SOMETHING FROM THE FIGURES ON THIS PAGE rather
          than reading a stored flag. A check that cannot fail is not a check, so the three
          that needed the F&I model were named as absent until `DASH.7` gave them something
          to verify. The module stays visible rather than becoming a disclosure: whether the
          record reconciles is the first thing a reviewer wants to know about it.
        */}
        <GridRow align="start">
          <Module
            id="checks"
            title="What this page checked before showing you the figures"
            span={7}
            zone="deal"
          >
            <ChecksSection
              checks={jacket.checks}
              needingReview={jacket.checksNeedingReview}
            />
          </Module>
          <Module id="lineage" title="Where these figures came from" span={5} zone="deal">
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
