import type { Metadata } from 'next'

import { ArchitectureView } from '@/components/technical/architecture-view'
import { DataModelView } from '@/components/technical/data-model-view'
import { DataSourcesView } from '@/components/technical/data-sources-view'
import { GovernanceView } from '@/components/technical/governance-view'
import { KpisView } from '@/components/technical/kpis-view'
import { OverviewView } from '@/components/technical/overview-view'
import { ProductVisionView } from '@/components/technical/product-vision-view'
import { StatusView } from '@/components/technical/status-view'
import { TechnicalNav } from '@/components/technical/technical-nav'
import { Canvas } from '@/components/shell/field'
import { Container, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Text } from '@/components/ui/typography'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES, SITE_NAME, SITE_URL } from '@/lib/site'
import {
  parseTechnicalView,
  technicalHref,
  technicalView,
  type TechnicalView,
} from '@/lib/technical'

/**
 * The one technical destination: "How ARPI works", read at one of eight states.
 *
 * WHY THE ENGINEERING IS ALL IN ONE PLACE NOW
 * -------------------------------------------
 * Before `UX.1` the site offered Architecture, Data Model, KPIs, Governance,
 * Status and Inventory Operations as six top-level destinations, four of them
 * competing with the operating console for the same click. A dealership manager
 * was being asked to choose between "Inventory" and "Governance" as though they
 * were the same kind of thing. They are not: one is a job and the other is how the
 * job's numbers are kept honest.
 *
 * The six are one destination now, and every one of them is intact. The
 * architecture explorer, the data-model explorer, the KPI catalogue, the
 * governance content, the generated status evidence and the reference-data lane
 * are the same components rendering the same content; what changed is that a
 * reader reaches them by deciding to read about the engineering rather than by
 * being unable to avoid it.
 *
 * WHY IT IS SERVER-RENDERED PER VIEW
 * ----------------------------------
 * The `view` parameter is read on the server and exactly one view is rendered, so
 * a reader on `?view=kpis` is not paying for the architecture explorer's markup.
 * The three heavy explorers are client islands and Next splits them per module, so
 * only the chunk for the rendered one is referenced by the payload. Measured
 * numbers are in `portfolio/docs/PERFORMANCE.md`.
 *
 * With scripting disabled the destination is fully navigable: the view navigation
 * is a `<nav>` of plain links, not a `role="tablist"`, because these are eight
 * server-addressable states of one document rather than panels switched in place.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const { view } = parseTechnicalView((await searchParams).view)
  const definition = technicalView(view)
  const canonical = `${SITE_URL}${technicalHref(view)}`

  /*
   * THE CANONICAL URL IS THE VIEW'S OWN, NOT THE BARE ROUTE.
   *
   * Both are defensible and they answer different questions. Pointing every view
   * at `/technical` would tell a search engine there is one document, which is
   * true of the destination and false of what a reader shared: somebody who sends
   * `?view=kpis` means the catalogue, and resolving that to the overview loses
   * what they sent. Each state is therefore self-canonical, and the default view
   * canonicalizes to the bare route so `/technical` and `/technical?view=overview`
   * do not become two URLs for one document.
   */
  /*
   * THE OPEN GRAPH BLOCK IS SPREAD, NOT REPLACED.
   *
   * `Metadata` overrides are shallow: an `openGraph` object here replaces the one
   * `pageMetadata` built, and the first version of this carried only a url and a
   * title — which silently dropped the social image from all eight technical
   * states. `navigation.spec.ts` asserts an `og:image` on every route, and that is
   * the assertion that caught it.
   */
  const base = pageMetadata('technical')

  return {
    ...base,
    title: `${definition.title} - ${SITE_NAME}`,
    description: definition.lede,
    alternates: { canonical },
    openGraph: {
      ...base.openGraph,
      url: canonical,
      title: `${definition.title} - ${SITE_NAME}`,
      description: definition.lede,
    },
    twitter: {
      ...base.twitter,
      title: `${definition.title} - ${SITE_NAME}`,
      description: definition.lede,
    },
  }
}

export default async function TechnicalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { view, unrecognized } = parseTechnicalView((await searchParams).view)
  const definition = technicalView(view)

  return (
    <Canvas>
      <PageHeader
        eyebrow="Technical"
        title={definition.title}
        lede={definition.lede}
        {...(definition.supporting === undefined
          ? {}
          : { supporting: definition.supporting })}
        crumbLabel={definition.label}
        parentCrumb={{ href: ROUTES.technical.href, label: 'How ARPI works' }}
        trustScope={view === 'data-sources' ? 'inventory' : 'synthetic'}
        trustHref={technicalHref('governance')}
        /* The governance view IS the disclosure and states it at full length in
           its own body, so the compact line above it would be the same claim
           twice. That exemption travelled with the content. */
        suppressTrustLine={view === 'governance'}
      />

      <Section rhythm="none" tone="canvas" className="pt-6">
        <Container width="wide">
          <TechnicalNav current={view} />
          {unrecognized === null ? null : (
            <Text size="xs" tone="faint" className="pt-3">
              {`There is no “${unrecognized}” view. Showing the overview.`}
            </Text>
          )}
        </Container>
      </Section>

      <TechnicalViewBody view={view} />
    </Canvas>
  )
}

/**
 * The switch, written as an exhaustive statement over the union.
 *
 * A `Record<TechnicalView, () => ReactNode>` would be shorter and would defer the
 * error to runtime when a member is added. A `switch` over a closed union is
 * checked by the compiler: adding a ninth view without a branch here fails the
 * type check, which is where a missing branch should be found.
 */
function TechnicalViewBody({ view }: { readonly view: TechnicalView }) {
  switch (view) {
    case 'overview':
      return <OverviewView />
    case 'architecture':
      return <ArchitectureView />
    case 'data-model':
      return <DataModelView />
    case 'kpis':
      return <KpisView />
    case 'governance':
      return <GovernanceView />
    case 'data-sources':
      return <DataSourcesView />
    case 'status':
      return <StatusView />
    case 'product-vision':
      return <ProductVisionView />
  }
}
