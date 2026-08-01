import type { Metadata } from 'next'

import { DataModelExplorer } from '@/components/explorers/data-model-explorer'
import { StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Card } from '@/components/ui/card-static'
import { Container, Section } from '@/components/ui/layout'
import { PageHeader } from '@/components/ui/page-header'
import { Heading, Text } from '@/components/ui/typography'
import { dataModelContent } from '@/lib/content'
import { counts, semanticModel } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { Canvas } from '@/components/shell/field'

export const metadata: Metadata = pageMetadata('dataModel')

export default function DataModelPage() {
  return (
    <Canvas>
      <PageHeader
        eyebrow="Data model"
        title="Every fact declares one grain, and the database enforces it"
        lede={`${String(counts.dimensions.value)} conformed dimensions and ${String(counts.facts.value)} facts. Each fact's grain is declared in the data dictionary, enforced by a UNIQUE constraint in DDL, and asserted by the integration suite - so it is a property of the database rather than a promise in a document.`}
        supporting={`Above the warehouse, the semantic model imports ${String(counts.importedTables.value)} reporting views and joins them with ${String(counts.semanticRelationships.value)} relationships, ${String(semanticModel.activeRelationships)} active and ${String(semanticModel.inactiveRelationships)} inactive. All are single-direction: there is no bidirectional filter and no many-to-many relationship in the model, and the static check fails the build if one appears.`}
        platformNav
        meta={
          <>
            <StatusBadge status="complete" label="Warehouse built and tested" size="sm" />
            <SourceLink
              path="DATA_DICTIONARY.md"
              field={`v${dataModelContent.sourceVersion}`}
            />
            <SourceLink path="docs/source-to-target/" field="lineage per entity" />
            <SourceLink
              path="docs/architecture-decisions/ADR-0006-scd-type-selection-phase-1.md"
              field="history policy"
            />
          </>
        }
      />

      {/* The privacy statement, given its own panel on this page specifically.
          This is the page most likely to be read as "here is the customer data",
          so the answer is stated before the explorer rather than after it. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <Card tone="pending" className="flex flex-col gap-2">
            <Heading level={2} size="h5">
              There is no personal data in this model, by construction
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              The data model prohibits names, street addresses, email addresses, phone
              numbers, full birth dates, government identifiers and bank information. Age
              is stored as a band and geography stops at county or market area. No
              record-level value appears anywhere on this page: the privacy field on each
              entity states the policy, and the row counts are table cardinalities rather
              than records.
            </Text>
            <SourceLink
              path="PRIVACY_AND_ETHICS.md"
              field="prohibited attributes"
              className="mt-1"
            />
          </Card>
        </Container>
      </Section>

      <Section rhythm="none" tone="panel" className="pt-section-tight pb-section">
        <Container width="full">
          <DataModelExplorer />
        </Container>
      </Section>
    </Canvas>
  )
}
