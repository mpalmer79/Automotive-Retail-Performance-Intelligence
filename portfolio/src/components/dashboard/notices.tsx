/**
 * The console's honest states.
 *
 * Four banners and one empty state, each for a condition that must never be
 * rendered as a zero:
 *
 *   FilterNotice          a parameter was rejected and replaced by its default
 *   PeriodNotice          the requested period was clamped or substituted
 *   StaleBanner           the export's contract digest no longer matches
 *   ReconciliationBanner  the export's own totals did not re-derive
 *   NoMatchingRecords     the filters selected nothing
 *
 * All five are `role="status"` regions with `aria-live="polite"`, so a reader
 * changing a filter with a screen reader is told what happened rather than being
 * left with a page that quietly became different. None of them is dismissible: a
 * caveat a reader can close is a caveat the page is hoping they will close.
 *
 * Server components.
 */
import Link from 'next/link'

import { EmptyState } from '@/components/ui/states'
import { Text } from '@/components/ui/typography'
import type { FilterReset } from '@/lib/dashboard/filters'
import { cx } from '@/lib/utils'

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'pending' | 'failed'
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'flex flex-col gap-1.5 rounded-xl border px-4 py-3',
        tone === 'failed'
          ? 'border-failed/40 bg-failed-wash/40'
          : 'border-pending/40 bg-pending-wash/40'
      )}
    >
      <p
        className={cx(
          'text-sm font-semibold',
          tone === 'failed' ? 'text-failed' : 'text-pending'
        )}
      >
        {title}
      </p>
      <div className="text-sm leading-normal text-ink-secondary">{children}</div>
    </div>
  )
}

/** Some filters were reset. IA §6 requires this to be visible, not silent. */
export function FilterNotice({
  resets,
  resetHref,
}: {
  resets: readonly FilterReset[]
  resetHref: string
}) {
  if (resets.length === 0) return null
  return (
    <Banner
      tone="pending"
      title={
        resets.length === 1
          ? 'One filter was reset'
          : `${resets.length} filters were reset`
      }
    >
      <ul className="flex flex-col gap-1">
        {resets.map((reset) => (
          <li key={reset.key}>
            <span className="font-mono text-xs">{reset.key}</span>
            <span className="text-ink-muted"> = </span>
            <span className="font-mono text-xs break-all">{reset.received}</span>
            <span className="block text-xs text-ink-muted">{reset.reason}</span>
          </li>
        ))}
      </ul>
      <p className="pt-1 text-xs">
        The rest of the view is unchanged.{' '}
        <Link
          href={resetHref}
          className="underline decoration-dotted underline-offset-4 hover:text-accent"
        >
          Reset every filter
        </Link>
        .
      </p>
    </Banner>
  )
}

/** The requested period was clamped to, or replaced by, one the export covers. */
export function PeriodNotice({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null
  return (
    <Banner tone="pending" title="The period was adjusted">
      <ul className="flex flex-col gap-1">
        {notices.map((notice) => (
          <li key={notice.slice(0, 40)}>{notice}</li>
        ))}
      </ul>
    </Banner>
  )
}

/**
 * The export is stale.
 *
 * Stale is a contract comparison, not an age: the declared contract digest no
 * longer matches what this export was built against. CI does not let one merge, so
 * in normal operation this never renders — which is exactly why the e2e suite
 * forces it with a corrupted fixture rather than trusting that it would.
 */
export function StaleBanner({ stale }: { stale: boolean }) {
  if (!stale) return null
  return (
    <Banner tone="failed" title="This export is stale">
      The contract digest recorded in this export no longer matches the declared contract.
      The figures below describe a dataset shape that has since changed, and they should
      not be read as current.
    </Banner>
  )
}

/** The export's own reconciliation failed. Every dashboard route carries this. */
export function ReconciliationBanner({ failed }: { failed: boolean }) {
  if (!failed) return null
  return (
    <Banner tone="failed" title="These figures failed reconciliation">
      The export reports that at least one published total did not re-derive from the
      committed rows. Nothing on this page should be relied on until the export
      reconciles; the trust panel below names the failing checks.
    </Banner>
  )
}

/** The filters matched nothing. Not a zero, and not an error. */
export function NoMatchingRecords({
  filterSummary,
  resetHref,
}: {
  filterSummary: string
  resetHref: string
}) {
  return (
    <EmptyState
      title="No exported records match these filters"
      description={`${filterSummary} No dataset in scope produced a row, so there is nothing to total. This is an empty selection, not a zero result and not a data failure.`}
      action={
        <Link
          href={resetHref}
          className="text-sm font-medium text-accent underline decoration-dotted underline-offset-4"
        >
          Reset filters
        </Link>
      }
    />
  )
}

/**
 * The sections that do not exist yet.
 *
 * Named, with the increment that delivers each, and deliberately not links. The
 * Management Action Center is `DASH.12`'s and there is no honest way to show an
 * action queue before the rules that generate it exist — a placeholder card with
 * three invented alerts would be the single most damaging thing this page could
 * contain, because an action is a recommendation and Gate 2 does not permit one.
 */
export function PlannedSections({
  sections,
}: {
  sections: readonly {
    readonly label: string
    readonly increment: string
    readonly purpose: string
  }[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <Text size="sm" tone="muted" className="max-w-prose">
        The console is delivered in increments, and the sections below are not built. They
        are listed here as text rather than as navigation, because a link to a page that
        does not exist is a promise this project does not make. Each names the delivery
        increment that owns it, so the claim can be checked against the dashboard backlog
        rather than taken on trust.
      </Text>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <li key={section.label} className="flex min-w-0 flex-col gap-0.5">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-ink-secondary">
                {section.label}
              </span>
              <span className="font-mono text-2xs text-ink-faint">
                {section.increment}
              </span>
            </p>
            <Text size="xs" tone="faint">
              {section.purpose}
            </Text>
          </li>
        ))}
      </ul>
      <Text size="sm" tone="muted" className="max-w-prose">
        Management actions in particular stay absent until the rules that produce them
        exist and can show their evidence. An action is a recommendation, and this console
        publishes figures and deterministic rule outputs rather than recommendations.
      </Text>
    </div>
  )
}
