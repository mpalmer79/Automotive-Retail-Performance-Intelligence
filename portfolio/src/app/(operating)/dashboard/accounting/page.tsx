import type { Metadata } from 'next'

import { FilterBar, type FilterOption } from '@/components/dashboard/filter-bar'
import { ExportProvenance } from '@/components/dashboard/export-provenance'
import {
  ActiveFilterChips,
  OperatingPageHeader,
  operatingContext,
} from '@/components/dashboard/operating-page-header'
import {
  FilterNotice,
  ReconciliationBanner,
  StaleBanner,
} from '@/components/dashboard/notices'
import { Canvas } from '@/components/shell/field'
import { Disclosure } from '@/components/ui/disclosure'
import { Container, Section, SectionHeader } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import {
  accountingExceptionRows,
  glReconciliationRows,
} from '@/lib/dashboard/accounting-data'
import {
  CONTROLLED_SCENARIO_NOTE,
  comparisonDates,
  exceptionDrillThrough,
  resolveComparisonDate,
  selectComparisons,
  selectExceptions,
  summarize,
  toComparisonRows,
  toExceptionRows,
  varianceDirection,
} from '@/lib/dashboard/accounting'
import { dashboardManifest, dashboardStores } from '@/lib/dashboard/data'
import {
  ACCOUNTING_SUPPORT,
  activeFilterChips,
  parseFilters,
  type QueryInput,
} from '@/lib/dashboard/filters'
import {
  formatCurrencyDifference,
  formatCurrencyExact,
  formatIsoDate,
} from '@/lib/dashboard/format'
import { exportTrust, powerBiTrust, reconciliationFailed } from '@/lib/dashboard/trust'
import { engines } from '@/lib/manifest'
import { pageMetadata } from '@/lib/metadata'
import { ROUTES } from '@/lib/site'

export const metadata: Metadata = pageMetadata('dashboardAccounting')

const ROUTE = ROUTES.dashboardAccounting.href

/**
 * Accounting integrity — the controller's surface.
 *
 * WHAT THIS PAGE IS, AND WHAT IT REFUSES TO BE
 * --------------------------------------------
 * It is an INVENTORY CONTROL RECONCILIATION. It answers whether the inventory subledger
 * agrees with what the selected synthetic GL control accounts say, and where it does not.
 *
 * It is NOT a general ledger, and the absence is structural rather than stylistic: no
 * journal entry, journal line, debit/credit pair, posting batch, trial balance, period close
 * or financial statement exists anywhere in the export, so there is nothing here for such a
 * section to read. The page shows exact numbers in tables rather than gauges or scores,
 * because a reconciliation table is the artefact a controller actually checks and a "books
 * health" dial would be a decoration standing in front of the only thing worth reading.
 *
 * THE FOUR THINGS THE COPY ON THIS PAGE HAS TO GET RIGHT
 * ------------------------------------------------------
 * 1. The variance is SIGNED, and the direction is stated in words next to it rather than
 *    left to a minus glyph or a colour.
 * 2. A missing side is MISSING. It renders as "No GL balance" or "No subledger balance",
 *    never as $0.00, and it is excluded from the totals rather than counted as agreement.
 * 3. The balances are positions at ONE date. The page states which date it resolved and
 *    never sums or averages across dates.
 * 4. A variance is something to investigate, not proof of an error — and in this dataset
 *    some of them are planted on purpose. Both facts are on the page, not in a footnote.
 */
export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = (await searchParams) as QueryInput
  const parsed = parseFilters(query, {
    knownStores: dashboardStores.map((store) => store.id),
  })

  const comparisons = toComparisonRows(glReconciliationRows())
  const dates = comparisonDates(comparisons)
  const comparisonDate = resolveComparisonDate(comparisons, parsed.filters)
  const selected = selectComparisons(comparisons, comparisonDate, parsed.filters)
  const summary = summarize(selected, comparisonDate)
  const exceptions = selectExceptions(
    toExceptionRows(accountingExceptionRows()),
    parsed.filters
  )

  const chips = activeFilterChips(parsed.filters, ACCOUNTING_SUPPORT)
  const exportState = exportTrust(dashboardManifest)
  const powerBi = powerBiTrust(engines)
  const failedReconciliation = reconciliationFailed(dashboardManifest)

  // The period options are the comparison dates the reconciliation actually carries, not
  // the whole calendar: a month with no comparison is not a month this page may offer and
  // then render empty.
  const storeOptions: readonly FilterOption[] = dashboardStores.map((store) => ({
    value: store.id,
    label: store.shortName,
  }))
  const periodOptions: readonly FilterOption[] = dates.map((date) => ({
    value: date.slice(0, 7),
    label: formatIsoDate(date),
  }))

  return (
    <Canvas>
      <OperatingPageHeader
        title="Accounting"
        context={operatingContext([
          parsed.filters.store.length === 0
            ? 'All three stores'
            : parsed.filters.store.join(', '),
          comparisonDate === null
            ? 'No comparison date in this period'
            : `Position at ${formatIsoDate(comparisonDate)}`,
        ])}
        subtitle="Inventory control reconciliation. Not a general ledger."
        methodology={
          <ExportProvenance
            exportState={exportState}
            powerBi={powerBi}
            {...(comparisonDate === null ? {} : { asOf: comparisonDate })}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <StaleBanner stale={exportState.stale} />
          <ReconciliationBanner failed={failedReconciliation} />
          <FilterNotice resets={parsed.reset} resetHref={ROUTE} />

          <ActiveFilterChips chips={chips} />

          <FilterBar
            action={ROUTE}
            filters={parsed.filters}
            periodOptions={periodOptions}
            stores={storeOptions}
            conditions={[]}
            leadSources={[]}
            conditionHint="Not applied here. A control balance is a store-and-account position; vehicle condition decides which control account a unit belongs to, and that grouping is already the account."
            leadSourceHint="Not applied here. The accounting datasets carry no lead-source attribute."
          />

          <Disclosure label="What this page reconciles, and what it does not">
            <div className="flex flex-col gap-3">
              <Text size="sm">
                Both sides of this comparison are generated from one governed synthetic
                model. It is not agreement between two independent systems, and no figure
                here is an audit, a certification or an external validation.
              </Text>
              <Text size="sm">{CONTROLLED_SCENARIO_NOTE}</Text>
              <Text size="sm">
                The balances are positions at a date. They add across stores and control
                accounts on the comparison date shown and never across dates: a period
                selects the last comparison date inside it rather than a sum of them.
              </Text>
              <Text size="sm">
                Every control account is invented. No real dealer group&rsquo;s chart of
                accounts was consulted, and the catalogue is three selected inventory
                control accounts rather than a chart of accounts.
              </Text>
            </div>
          </Disclosure>
        </div>
      </OperatingPageHeader>

      {/* ------------------------------------------------------------------ */}
      {/* Reconciliation summary                                              */}
      {/* ------------------------------------------------------------------ */}
      <Section id="summary">
        <Container width="full">
          <SectionHeader
            eyebrow="Reconciliation"
            title="The position"
            lede={
              comparisonDate === null
                ? 'No comparison date falls inside the selected period.'
                : `Comparable positions only. Missing-side positions are counted below and excluded from these totals, because a balance that does not exist is not a balance of zero.`
            }
          />
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-card border border-line p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Inventory subledger
              </dt>
              <dd className="font-mono text-lg text-ink">
                {formatCurrencyExact(summary.subledgerTotal)}
              </dd>
              <dd className="text-xs text-ink-faint">
                {summary.comparablePositions} comparable position
                {summary.comparablePositions === 1 ? '' : 's'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-card border border-line p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                GL control balance
              </dt>
              <dd className="font-mono text-lg text-ink">
                {formatCurrencyExact(summary.glTotal)}
              </dd>
              <dd className="text-xs text-ink-faint">Synthetic control accounts</dd>
            </div>
            <div className="flex flex-col gap-1 rounded-card border border-line p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Signed variance
              </dt>
              <dd className="font-mono text-lg text-ink">
                {formatCurrencyDifference(summary.signedVariance, 2)}
              </dd>
              {/* The direction in words. A minus sign is not a description, and colour may
                  not carry meaning on its own. */}
              <dd className="text-xs text-ink-faint">
                {varianceDirection(summary.signedVariance)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-card border border-line p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-muted">
                Positions not comparable
              </dt>
              <dd className="font-mono text-lg text-ink">
                {summary.missingGlPositions + summary.missingSubledgerPositions}
              </dd>
              <dd className="text-xs text-ink-faint">
                {summary.missingGlPositions} missing GL,{' '}
                {summary.missingSubledgerPositions} missing subledger
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-ink-muted">
            Variance is general ledger minus subledger. A positive figure means the
            general ledger carries more than the schedule supports; a negative figure
            means the reverse. Group totals add the signed variances, so opposing
            positions offset rather than accumulate.
          </p>
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* GL against subledger                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section id="positions" tone="evidence">
        <Container width="full">
          <SectionHeader
            eyebrow="Positions"
            title="Each control account, by store"
            lede="One row per store and control account at the comparison date. A missing side is shown as missing."
          />
          {selected.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No comparison rows for this period and store selection.
            </p>
          ) : (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Reconciliation positions"
            >
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <caption className="sr-only">
                  Inventory subledger against GL control balances at{' '}
                  {comparisonDate === null ? 'no date' : formatIsoDate(comparisonDate)}
                </caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Store
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Control account
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Subledger
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      GL
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Variance
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      State
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Units
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((row) => (
                    <tr
                      key={`${row.dealershipId}-${row.glAccountNumber}`}
                      className="border-b border-line-subtle"
                    >
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        {row.dealershipId}
                      </th>
                      <td className="py-2 pr-4">
                        {row.glAccountNumber} · {row.glAccountName}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.subledgerBalance === null ? (
                          <span className="text-ink-faint">No subledger balance</span>
                        ) : (
                          formatCurrencyExact(row.subledgerBalance)
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.glBalance === null ? (
                          <span className="text-ink-faint">No GL balance</span>
                        ) : (
                          formatCurrencyExact(row.glBalance)
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.varianceAmount === null ? (
                          <span className="text-ink-faint">Not comparable</span>
                        ) : (
                          formatCurrencyDifference(row.varianceAmount, 2)
                        )}
                      </td>
                      <td className="py-2 pr-4">{row.comparisonState}</td>
                      <td className="py-2 text-right font-mono">
                        {row.stockUnitCount ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Exceptions                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Section id="exceptions">
        <Container width="full">
          <SectionHeader
            eyebrow="Exceptions"
            title="Accounting exceptions"
            lede="Governed exceptions over the whole export, on their own exception date. These are not one kind of finding and are deliberately not totalled together."
          />
          {exceptions.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No accounting exceptions for this store selection. The controls were
              evaluated and found nothing; that is a result, not an absence of checking.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {exceptions.map((row) => {
                const href = exceptionDrillThrough(row)
                return (
                  <li
                    key={row.exceptionId}
                    className="rounded-card border border-line p-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-sm text-ink">
                        {row.exceptionCode}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {row.dealershipId} · {formatIsoDate(row.exceptionDate)}
                      </span>
                      {row.exceptionAmount === null ? null : (
                        <span className="font-mono text-sm text-ink">
                          {formatCurrencyDifference(row.exceptionAmount, 2)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">{row.exceptionDetail}</p>
                    <p className="mt-2 text-sm">
                      {href === null ? (
                        <span className="text-ink-faint">
                          No drill-through available for this exception type
                        </span>
                      ) : (
                        <a className="underline" href={href}>
                          Open this position
                        </a>
                      )}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Container>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Period ownership                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section id="timing" tone="evidence">
        <Container width="full">
          <SectionHeader
            eyebrow="Period ownership"
            title="Which date owns which row"
            lede="Every section on this page is on a stated date basis. They are not interchangeable."
          />
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5 border-t border-line pt-3">
              <dt className="text-sm font-medium text-ink">Subledger balance</dt>
              <dd className="text-sm text-ink-muted">
                Accounting snapshot date — a month end. The schedule is a position, and a
                unit still in stock at two month ends appears at both.
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 border-t border-line pt-3">
              <dt className="text-sm font-medium text-ink">GL control balance</dt>
              <dd className="text-sm text-ink-muted">
                Balance date. Compared only against a subledger balance on the same date;
                an unmatched date is not compared at all.
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 border-t border-line pt-3">
              <dt className="text-sm font-medium text-ink">Reconciliation</dt>
              <dd className="text-sm text-ink-muted">
                The matched accounting and balance date, shown above. Positions from other
                dates are not pooled into it.
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 border-t border-line pt-3">
              <dt className="text-sm font-medium text-ink">Exceptions</dt>
              <dd className="text-sm text-ink-muted">
                The exception&rsquo;s own date, which is not restated into the period a
                reader happens to be looking at.
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-ink-muted">
            ARPI records no posting timestamp, so no journal-posting delay is computable
            and none is shown. The only timing figure the accounting domain supports is
            the interval from a unit&rsquo;s acquisition to its first month-end appearance
            on the schedule.
          </p>
        </Container>
      </Section>
    </Canvas>
  )
}
