/**
 * The inventory-operations chapter of the home page.
 *
 * WHY IT IS ON THE HOME PAGE AT ALL
 * ---------------------------------
 * Everything above it on this page is derived from three sanitized workbooks,
 * and a reader who has just been shown 541 listings and a set of medians is
 * entitled to ask where the data came from and what was done to it before it got
 * here. This chapter answers that in four sentences and hands off to the two
 * pages that answer it properly.
 *
 * It is a signpost, not a summary. The full lane - what the sanitizer removes,
 * what the contract refuses, the warehouse objects it loads and the Excel report
 * it exports - is `/inventory-operations`, and the vehicles themselves are
 * `/inventory`. Restating either here would be a third copy of content that
 * already has one home each.
 *
 * Server component. The two counts come from the generated summary.
 */
import { ArrowRight, FileSpreadsheet, Table2 } from 'lucide-react'
import Link from 'next/link'

import { Reveal } from '@/components/motion/reveal'
import { Card } from '@/components/ui/card-static'
import { SourceLink } from '@/components/ui/data-card'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Heading, Text } from '@/components/ui/typography'
import { inventorySummary } from '@/lib/inventory'
import { ROUTES } from '@/lib/site'
import { formatCount } from '@/lib/utils'

export function InventoryOperationsPreview() {
  const summary = inventorySummary

  return (
    <Section id="inventory-operations" tone="evidence" rhythm="tight">
      <Container width="wide">
        <SectionHeader
          layout="wide"
          eyebrow="Inventory operations"
          title="Where those listings came from, and what was removed"
          lede={`Every figure above is derived from ${formatCount(summary.totalRecords)} rows in ${formatCount(summary.generatedFrom.length)} sanitized workbooks committed to this repository. They are the one part of ARPI that is not machine-generated, and the project says so rather than absorbing it.`}
        />

        <Reveal className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card as="article" className="flex flex-col gap-3">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface-sunken text-accent"
            >
              <FileSpreadsheet className="size-4" strokeWidth={2} />
            </span>
            <Heading level={3} size="h6">
              The lane
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              A de-identified public listing snapshot, with original VINs, source URLs,
              listing keys, street addresses and real dealership identity removed one way
              before the workbook entered the repository. It is validated against a
              declared contract, loaded into its own warehouse objects, and reconciled.
            </Text>
            <Link
              href={ROUTES.inventoryOperations.href}
              className="mt-auto inline-flex min-h-touch items-center gap-1.5 self-start text-sm font-medium text-accent transition-colors duration-(--arpi-motion-fast) hover:text-accent-strong"
            >
              How the lane is sanitized and loaded
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Link>
          </Card>

          <Card as="article" className="flex flex-col gap-3">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface-sunken text-accent"
            >
              <Table2 className="size-4" strokeWidth={2} />
            </span>
            <Heading level={3} size="h6">
              The vehicles
            </Heading>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {`The same ${formatCount(summary.totalRecords)} listings as a table, filterable by store, ` +
                'condition, make, model, model year, advertised price and mileage. No Excel ' +
                'file is parsed in your browser: the records were read at build time and ' +
                'ship as data.'}
            </Text>
            <Link
              href={ROUTES.inventory.href}
              className="mt-auto inline-flex min-h-touch items-center gap-1.5 self-start text-sm font-medium text-accent transition-colors duration-(--arpi-motion-fast) hover:text-accent-strong"
            >
              Open the inventory explorer
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Link>
          </Card>
        </Reveal>

        <Reveal className="mt-6">
          <ul className="flex flex-col gap-0.5">
            {summary.generatedFrom.map((path) => (
              <li key={path}>
                <SourceLink path={path} field="sanitized inventory snapshot" />
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </Section>
  )
}
