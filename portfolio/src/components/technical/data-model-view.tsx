import { Ban } from 'lucide-react'

import { TechnicalViewMeta } from '@/components/technical/view-meta'
import { DataModelExplorer } from '@/components/explorers/data-model-explorer'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { SourceLink } from '@/components/ui/data-card'
import { Card } from '@/components/ui/card-static'
import { Container, Section } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { dataModelContent } from '@/lib/content'

/** Attribute classes the model does not contain. Not masked — never designed. */
const PROHIBITED: readonly string[] = [
  'Names',
  'Street addresses',
  'Email addresses',
  'Phone numbers',
  'Full birth dates',
  'Government identifiers',
  'Bank and card information',
]

/** The two attributes that exist in a reduced form, named with that form. */
const REDUCED: readonly string[] = ['Age: band only', 'Geography: county or market area']

export function DataModelView() {
  return (
    <>
      <TechnicalViewMeta>
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
      </TechnicalViewMeta>

      {/* The privacy statement, given its own panel on this page specifically.
          This is the page most likely to be read as "here is the customer data",
          so the answer is stated before the explorer rather than after it.

          `UX.3` KEPT THE STATEMENT AND CHANGED ITS SHAPE. It was a sixty-word
          paragraph listing seven prohibited attribute classes in a sentence, on
          the view whose first visual was 2,049 px down at 390 px. The list is now
          a list: each class is a chip, the two that are stored in a reduced form
          say which form, and the sentence under them is the one thing the chips
          cannot say — that nothing on this page is a record-level value at all.
          Nothing was removed and nothing was collapsed behind a control. */}
      <Section rhythm="none" className="pb-section-tight">
        <Container width="wide">
          <Card tone="pending" className="flex flex-col gap-3">
            <Heading level={2} size="h5">
              There is no personal data in this model, by construction
            </Heading>
            <ul
              aria-label="Attribute classes the data model prohibits"
              className="flex flex-wrap gap-2"
            >
              {PROHIBITED.map((item) => (
                <li key={item}>
                  <Badge tone="pending" icon={<Ban />}>
                    {item}
                  </Badge>
                </li>
              ))}
              {REDUCED.map((item) => (
                <li key={item}>
                  <Badge tone="neutral">{item}</Badge>
                </li>
              ))}
            </ul>
            <Text size="sm" tone="secondary" className="max-w-prose">
              No record-level value appears anywhere on this page. The privacy field on
              each entity states its policy, and every row count is a table cardinality.
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
    </>
  )
}
