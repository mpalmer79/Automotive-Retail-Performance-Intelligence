import type { Metadata } from 'next'

import {
  ActionFacetBar,
  ActionQueue,
  ChangeDriverPanel,
  QueueSummary,
} from '@/components/dashboard/actions-sections'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import {
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { DOMAIN_LABELS, SEVERITY_LABELS } from '@/lib/dashboard/action-contract'
import { buildActionQueue, parseActionFacets } from '@/lib/dashboard/actions'
import { managementActions } from '@/lib/dashboard/actions-data'
import { buildBridge, buildChangeDrivers } from '@/lib/dashboard/change-drivers'
import { grossChangeBridgeRows } from '@/lib/dashboard/change-drivers-data'
import { dashboardManifest, dashboardStores } from '@/lib/dashboard/data'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import type { ActionDomain, ActionSeverity } from '@/types/dashboard'

export const metadata: Metadata = pageMetadata('dashboardActions')

/**
 * Management Actions — the deterministic review queue.
 *
 * WHAT THIS PAGE IS FOR
 * ---------------------
 * The other eight operating surfaces answer "what happened" and "where should I look". This
 * one answers a narrower question: which conditions in the group meet a rule someone wrote
 * down in advance, what evidence made each one meet it, and where the detail is.
 *
 * It is not a decision system. It takes no action, assigns no work, writes back to nothing,
 * remembers nothing between dataset versions, and states no cause. Every one of those is a
 * deliberate absence rather than an unbuilt feature, and the methodology disclosure says so
 * in the reader's own terms rather than in the architecture's.
 *
 * WHY THERE IS NO FILTER BAR
 * --------------------------
 * Every other operating route carries the shared period/store/condition control. This one
 * does not, and the reason is in `ACTIONS_SUPPORT`: each rule declares its OWN as-of scope,
 * and they differ by domain — the inventory rules read the as-of snapshot, the deal rules
 * the as-of month, the accounting rules the published exception register. A period control
 * over rows selected on three different bases would offer a selection that means something
 * different in each domain. Store is the one global parameter that survives, and it appears
 * as a facet beside the three the route owns.
 *
 * NOTHING HERE COMPUTES ANYTHING
 * ------------------------------
 * The queue arrives decided. This page selects from it and arranges it; it evaluates no
 * rule, reads no threshold and re-derives no figure. The change-driver panel is the same
 * `DASH.3` bridge the Sales and Gross page renders, read through one shared module.
 *
 * Server component.
 */
export default async function DashboardActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const storeIds = dashboardStores.map((store) => store.id)
  const facets = parseActionFacets(query, storeIds)

  const actions = managementActions()
  const storeLabels: Record<string, string> = {}
  for (const store of dashboardStores) storeLabels[store.id] = store.shortName

  const view = buildActionQueue(
    actions,
    facets,
    storeLabels,
    DOMAIN_LABELS as Readonly<Record<ActionDomain, string>>,
    SEVERITY_LABELS as Readonly<Record<ActionSeverity, string>>
  )

  const policy = dashboardManifest.actions.changeDrivers
  const asOfMonth = dashboardManifest.asOfDate.slice(0, 7)
  const bridgeStores = facets.store.length > 0 ? facets.store : storeIds
  const drivers = buildChangeDrivers(
    buildBridge(grossChangeBridgeRows(), bridgeStores, asOfMonth),
    { value: policy.materiality.value, label: policy.materiality.label }
  )

  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)
  const ruleset = dashboardManifest.actions.ruleset

  return (
    <Canvas>
      <OperatingPageHeader
        title="Management Actions"
        context={operatingContext([
          facets.store.length === 0 ? 'All three stores' : facets.store.join(', '),
          `${String(view.total)} open review ${view.total === 1 ? 'prompt' : 'prompts'}`,
        ])}
        subtitle="Deterministic review prompts backed by the same governed data as the operating console."
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            asOf={dashboardManifest.asOfDate}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <StaleBanner stale={exportState.stale} />
          <ReconciliationBanner failed={failedReconciliation} />
          <FilterNotice resets={[]} resetHref="/dashboard/actions" />

          <Disclosure label="What an action is, and what it is not">
            <div className="flex flex-col gap-3">
              <Text size="sm">
                Each prompt below exists because a condition written down in advance holds
                in this dataset version. It is a reason to look, not a finding, a
                recommendation of business action, or evidence of a real-world condition.
              </Text>
              <Text size="sm">
                Nothing here claims a cause. A rule states that a condition holds and
                shows the exported values that made it hold; why it holds is what the
                drill-through is for.
              </Text>
              <Text size="sm">
                The queue is stateless. It is rebuilt from the data every time the export
                is regenerated, so it holds no history and carries no acknowledgement,
                assignment, completion or due date. Reloading this page reconstructs the
                same queue; nothing remembers what was clicked.
              </Text>
              <Text size="sm">
                No language model, learned model or scoring heuristic takes any part in
                producing it. Every word of every prompt comes from a rule template and
                every number from an exported column, so any action can be recomputed by
                hand from files in the repository.
              </Text>
              <Text size="sm">
                {ruleset.enabledRuleIds.length} of {ruleset.ruleCount} permanent rules are
                enabled. The other {ruleset.disabledRuleIds.length} are retained and
                switched off, each with the audited reason the project cannot evaluate it
                honestly — the evidence is absent, it exists only at a different grain, or
                the condition is one an earlier data-quality gate already prevents.
              </Text>
              <Text size="sm">
                Every threshold this register owns is a project default for a fictional
                dealer group. None is an industry benchmark, an OEM standard, a best
                practice or a compliance requirement.
              </Text>
            </div>
          </Disclosure>
        </div>
      </OperatingPageHeader>

      {/* ------------------------------------------------------------------ */}
      {/* Region 1 and 2 — the summary and the facets                         */}
      {/* ------------------------------------------------------------------ */}
      <Section id="queue">
        <Container width="full">
          <SectionHeader
            eyebrow="Review queue"
            title="What meets a review rule right now"
            lede="Ordered by severity, then domain, then store, then rule. The order is a property of the data rather than of the reader: everyone looking at the same figures sees the same sequence."
          />
          <div className="flex flex-col gap-5">
            <QueueSummary
              view={view}
              asOfDate={dashboardManifest.asOfDate}
              facets={facets}
            />
            <ActionFacetBar view={view} facets={facets} />
            <ActionQueue view={view} />
          </div>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Region 4 — why did this change?                                     */}
      {/* ------------------------------------------------------------------ */}
      <Section id="change-drivers">
        <Container width="full">
          <SectionHeader
            eyebrow="Change drivers"
            title="Why did total gross change?"
            lede="A decomposition of an observed period-over-period difference. Distinct from the queue above: an action is a condition that holds now, and a driver is arithmetic about a change that already happened."
          />
          <ChangeDriverPanel drivers={drivers} authority={policy.authority} />
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Region 5 — methodology on demand                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section id="methodology">
        <Container width="full">
          <Disclosure label="How this queue is produced">
            <div className="flex flex-col gap-3">
              <Text size="sm">
                Rules live in <code>{ruleset.file}</code> as data, not code, and are
                evaluated once at export time against the datasets this console already
                publishes. The queue is then a governed artifact with its own hash,
                exactly like a dataset.
              </Text>
              <Text size="sm">
                The rule file is an input to the published data. Changing a threshold
                changes the queue even though no business fact moved, so the export check
                re-derives the queue from the current rule file and fails if the committed
                one differs. Ruleset {ruleset.fileSha256.slice(0, 12)} produced what is
                shown here.
              </Text>
              <Text size="sm">
                Facet counts are counts of the queue on this page. They are presentation
                figures derived from the rows, not new measures, and the generator refuses
                a count that disagrees with the rows it counts.
              </Text>
              <Text size="sm">
                Every drill-through is checked against the console&rsquo;s own route
                registry before the queue is written, so a link here cannot point at a
                retired route or carry a parameter its destination does not read.
              </Text>
            </div>
          </Disclosure>
        </Container>
      </Section>
    </Canvas>
  )
}
