import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Canvas } from '@/components/shell/field'
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
import { Container, Section, SectionHeader } from '@/components/ui/layout'
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
 * A RECORD VIEW, NOT A WORKFLOW. Nothing on this page can be edited, assigned,
 * approved, submitted, repriced, funded or contracted, and no control exists that
 * pretends to. That is not a styling choice: the export carries no column such an
 * action would write to, and there is no API to write it through.
 *
 * SECTION ORDER IS THE MONEY'S ORDER. Identity, vehicle, then the front-gross
 * arithmetic, then the trade context that is deliberately outside it, then the
 * finance amounts and the aggregate back gross, then the total. Mobile keeps that
 * order exactly; the desktop two-column layout puts the money on the right and the
 * identity, people and paper trail on the left, without reordering the calculation.
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
      />

      {/* ------------------------------------------------------------------ */}
      {/* The persistent disclosure. Above the fold, in the body, on paper.  */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="none" tone="evidence" className="py-section-tight" id="disclosure">
        <Container width="full">
          <div className="flex flex-col gap-4">
            <p className="rounded-lg border border-line bg-surface-sunken/60 p-4 text-sm font-medium text-ink">
              Fictional transaction from the synthetic Granite Auto Group dataset. Not a
              real sale, customer, or dealership record.
            </p>
            <div id="identity">
              <IdentitySection jacket={jacket} />
            </div>
          </div>
        </Container>
      </Section>

      {/*
        The operating layout. Money on the right at ≥1024px, identity and paper trail
        on the left; a single column below that, in the money's own order.
      */}
      <Section rhythm="default">
        <Container width="full">
          <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
            {/* ---------------------------------------------------------- */}
            {/* Left: the unit, the people, the paper trail                 */}
            {/* ---------------------------------------------------------- */}
            <div className="order-2 flex flex-col gap-10 lg:order-1">
              <section id="vehicle">
                <SectionHeader
                  eyebrow="Vehicle"
                  title="The unit that was sold"
                  lede="Identity, condition and how long it sat. The odometer is banded and the VIN-style identifier is synthetic."
                />
                <div className="pt-6">
                  <VehicleSection jacket={jacket} />
                </div>
              </section>

              <section id="staff">
                <SectionHeader
                  eyebrow="Attribution"
                  title="Who worked the transaction"
                  lede="Synthetic identifiers and roles. No name exists anywhere in ARPI."
                />
                <div className="pt-6">
                  <StaffSection staff={jacket.staff} />
                </div>
              </section>

              <section id="timeline">
                <SectionHeader
                  eyebrow="Paper trail"
                  title="How the deal arrived"
                  lede="The lead and appointment stages the model actually records, in order."
                />
                <div className="pt-6">
                  <TimelineSectionBlock timeline={jacket.timeline} />
                </div>
              </section>
            </div>

            {/* ---------------------------------------------------------- */}
            {/* Right: the money, in formula order                          */}
            {/* ---------------------------------------------------------- */}
            <div className="order-1 flex flex-col gap-10 lg:order-2">
              <section id="front-gross">
                <SectionHeader
                  eyebrow="Front-end gross"
                  title="What the vehicle made"
                  lede="The ARPI formula, in its own order, from the exported exact decimals. This page recomputes the identity from the components below rather than trusting the stored figure."
                />
                <div className="pt-6">
                  <FrontGrossSection jacket={jacket} />
                </div>
              </section>

              <section id="trade">
                <SectionHeader
                  eyebrow="Trade"
                  title="The trade, and why it is not in the formula above"
                  lede="Trade variance is allowance less actual cash value. It is a real figure and it is deliberately outside the front-gross calculation."
                />
                <div className="pt-6">
                  <TradeSectionBlock trade={jacket.trade} />
                </div>
              </section>

              <section id="finance">
                <SectionHeader
                  eyebrow="Finance"
                  title="How the deal was funded"
                  lede="Amounts and a fictional funding source. No APR, term, payment, buy rate, sell rate or spread exists anywhere in this project, and none ever will: finance reserve is an amount, never a rate."
                />
                <div className="pt-6">
                  <FinanceSectionBlock jacket={jacket} />
                </div>
              </section>

              <section id="products">
                <SectionHeader
                  eyebrow="F&amp;I products"
                  title="What was written, and what remains"
                  lede="One row per product contract, with the price, the cost, the gross it was written for and what survived every adjustment posted since. Original and net are separate columns because they answer different questions."
                />
                <div className="pt-6">
                  <ProductSectionBlock jacket={jacket} />
                </div>
              </section>

              <section id="back-gross">
                <SectionHeader
                  eyebrow="Back-end gross"
                  title="What the finance office made, decomposed"
                  lede="Finance reserve plus original product gross, recomputed here from the components and checked to the cent. Other F&amp;I income is exactly $0.00 and is not a balancing figure."
                />
                <div className="pt-6">
                  <BackGrossSectionBlock jacket={jacket} />
                </div>
              </section>

              <section id="total-gross">
                <SectionHeader
                  eyebrow="Total gross"
                  title="What the deal made"
                  lede="Front plus back, recomputed here from the two figures above."
                />
                <div className="pt-6">
                  <TotalGrossSection jacket={jacket} />
                </div>
              </section>
            </div>
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Checks and lineage                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Section rhythm="default" tone="evidence" id="checks">
        <Container width="content">
          <SectionHeader
            eyebrow="Integrity"
            title="What this page checked before showing you the figures"
            lede="Eight checks, each recomputing something from the figures on this page rather than reading a stored flag. A check that cannot fail is not a check, so the three that needed the F&amp;I model were named as absent until DASH.7 gave them something to verify."
          />
          <div className="flex flex-col gap-6 pt-6">
            <ChecksSection
              checks={jacket.checks}
              needingReview={jacket.checksNeedingReview}
            />
            <LineageSection jacket={jacket} />
            {/*
              THE FULL STATEMENT MOVED INTO THE CONTROL BAND'S DISCLOSURE at `UX.1`,
              where every operating route carries it and `operating-copy.spec.ts`
              asserts it. It was rendered here as well, and a disclosure stated
              twice on one document is not twice as honest — it is the repetition
              that made a finished platform read as an apology. What stays visible
              on this page is the sentence a reader of ONE TRANSACTION needs, at the
              top where they meet the deal: this is a fictional transaction, not a
              real sale, customer or dealership record.
            */}
          </div>
        </Container>
      </Section>

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
