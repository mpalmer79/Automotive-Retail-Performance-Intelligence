/**
 * The evidence ledger.
 *
 * Ten records, drawn from the manifest, laid out as a timeline against a
 * vertical rule. The last one is the pending real-engine validation, and it sits
 * visibly at the end of the sequence rather than being buried among the nine
 * that passed.
 *
 * That ordering is the point of the section. A list of ten green ticks would be
 * a marketing panel; nine proven things followed by one that is not proven is an
 * argument that the project knows the difference.
 *
 * Server component - `EvidenceItem` is static markup.
 */
import { Reveal } from '@/components/motion/reveal'
import { EvidenceItem } from '@/components/ui/data-card'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { evidence } from '@/lib/manifest'

/** Human wording for the ledger's kind column. */
const KIND_LABEL: Record<string, string> = {
  static: 'Static check',
  'real-engine': 'Real-engine',
  reconciliation: 'Reconciliation',
  test: 'Automated test',
  privacy: 'Privacy control',
}

export function EvidenceLedger() {
  return (
    <Section id="evidence" bordered>
      <Container width="wide">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
          <Reveal className="lg:col-span-4">
            <div className="flex flex-col gap-5 lg:sticky lg:top-[calc(var(--arpi-size-header)+2.5rem)]">
              <Eyebrow>Evidence, not claims</Eyebrow>
              <Heading level={2}>
                Nine things this project can prove, and one it cannot.
              </Heading>
              <Text size="body">
                Each row names what was checked, what the check found, and the file that
                holds the result. The last row is the one that matters most: a semantic
                model is proved by an engine or it is not proved, and no engine has looked
                at this one.
              </Text>
              <Text size="sm" tone="muted">
                Static parsing proves shape. It cannot prove arithmetic, and this site
                never presents it as though it does.
              </Text>
            </div>
          </Reveal>

          <div className="lg:col-span-8">
            <ol className="flex flex-col">
              {evidence.map((record) => (
                <EvidenceItem
                  key={record.id}
                  label={record.label}
                  detail={record.detail}
                  kind={KIND_LABEL[record.kind] ?? record.kind}
                  status={{ status: record.status }}
                  sources={record.sources}
                />
              ))}
            </ol>
          </div>
        </div>
      </Container>
    </Section>
  )
}
