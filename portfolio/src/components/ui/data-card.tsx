/**
 * DataCard, EvidenceItem, SourceLink, DefinitionList and MetricCount.
 *
 * These are the components that carry the site's central claim: every number and
 * every status traces to a file. SourceLink is the mechanism - it renders a
 * repository path as a link to the file on the default branch - and DataCard and
 * EvidenceItem are the two layouts that use it.
 */
import { ArrowUpRight, FileCode2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { repoFileUrl } from '@/lib/site'
import { cx, formatCount } from '@/lib/utils'
import type { EvidenceSource } from '@/types/manifest'

import { StatusBadge } from './badge'
import { Card } from './card-static'
import { Text } from './typography'

/* -------------------------------------------------------------------------- */
/* SourceLink                                                                  */
/* -------------------------------------------------------------------------- */

export interface SourceLinkProps {
  /** Repository-relative path. A trailing slash denotes a directory. */
  path: string
  /** What in the file the claim came from. Rendered after the path. */
  field?: string
  className?: string
  /** `inline` for a path inside a sentence, `block` for a list row. */
  variant?: 'inline' | 'block'
}

/**
 * A link to the file that proves a claim.
 *
 * The accessible name is the full path plus the field, so a screen-reader user
 * hears what they are being pointed at rather than "link, file icon". The
 * external-tab hint is text, not an icon.
 */
/**
 * Shorten a path for display, keeping both ends.
 *
 * The semantic model's TMDL lives at
 * `powerbi/ARPI_Performance_Intelligence/ARPI_Performance_Intelligence.SemanticModel/definition/relationships.tmdl`
 * - 106 characters that wrap to five lines in a credibility-strip column and end
 * up visually louder than the number they support. Keeping the first segment and
 * the last two preserves the two parts a reader actually uses (which area of the
 * repository, and which file), and the full path remains the accessible name,
 * the tooltip and the link target, so nothing is lost.
 *
 * Only paths over 44 characters are abbreviated; shorter ones read better whole.
 */
function displayPath(path: string): string {
  if (path.length <= 44) return path
  const segments = path.replace(/\/+$/, '').split('/')
  if (segments.length < 4) return path
  const first = segments[0]!
  const tail = segments.slice(-2).join('/')
  const abbreviated = `${first}/.../${tail}`
  return abbreviated.length < path.length ? abbreviated : path
}

export function SourceLink({
  path,
  field,
  className,
  variant = 'inline',
}: SourceLinkProps) {
  const label = field ? `${path} (${field})` : path
  const shown = displayPath(path)
  return (
    <a
      href={repoFileUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      // The full path, for anyone who wants it without following the link.
      title={label}
      className={cx(
        // `inline-flex` sizes to max-content, which means a 60-character
        // repository path sets the element's width and `break-all` never
        // engages - the single cause of horizontal overflow found in the first
        // visual review pass. `flex-wrap` plus `min-w-0` lets the path break and
        // the row wrap instead.
        'group/source inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-1.5',
        'font-mono text-2xs',
        // WCAG 2.2 Target Size (Minimum) is 24x24 CSS pixels, or 24px of offset
        // from the next target. An 11px monospace line is 17.8px tall, and two
        // stacked source links measured 23.6px apart - just under. A 24px minimum
        // height satisfies the rule on the target itself, which holds at every
        // call site rather than depending on each one's gap.
        'min-h-6 py-0.5',
        'text-ink-faint transition-colors duration-(--arpi-motion-fast)',
        'hover:text-accent focus-visible:text-accent',
        variant === 'block' && 'w-full',
        className
      )}
    >
      <FileCode2
        aria-hidden="true"
        className="size-3 shrink-0 translate-y-0.5 opacity-70"
        strokeWidth={2}
      />
      <span className="min-w-0 break-all underline decoration-line-strong decoration-dotted underline-offset-2 group-hover/source:decoration-accent-muted">
        {shown}
      </span>
      {/* No `opacity` on text anywhere in this component. Opacity multiplies
          against a token whose contrast ratio was measured at full strength, and
          axe-core measured this span at 3.13:1 when it carried `opacity-70`.
          Where text needs to recede, it uses a checked colour token instead. The
          two icons keep their opacity because they are decorative and
          `aria-hidden`. */}
      {field ? (
        <span className="min-w-0 break-words">
          <span aria-hidden="true">· </span>
          {field}
        </span>
      ) : null}
      <ArrowUpRight
        aria-hidden="true"
        className="size-2.5 shrink-0 translate-y-0.5 opacity-0 transition-opacity group-hover/source:opacity-70"
        strokeWidth={2.5}
      />
      <span className="sr-only">{`View ${label} on GitHub (opens in a new tab)`}</span>
    </a>
  )
}

/** A list of sources under a claim. */
export function SourceList({
  sources,
  className,
}: {
  sources: readonly EvidenceSource[]
  className?: string
}) {
  if (sources.length === 0) return null
  return (
    <ul className={cx('flex flex-col gap-1', className)}>
      {sources.map((source) => (
        <li key={`${source.path}#${source.field}`} className="min-w-0">
          <SourceLink path={source.path} field={source.field} variant="block" />
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* DefinitionList                                                              */
/* -------------------------------------------------------------------------- */

export interface DefinitionRow {
  readonly term: string
  readonly value: ReactNode
  /** Renders the value in the monospace face. For identifiers and grains. */
  readonly mono?: boolean
}

/**
 * A term-and-value table, rendered as a real `<dl>`.
 *
 * Used for KPI detail and entity detail. A `<dl>` rather than a two-column grid
 * of `<div>`s because the relationship between the term and its value is the
 * content, and assistive technology can only convey it if the markup says so.
 */
export function DefinitionList({
  rows,
  className,
  layout = 'stacked',
}: {
  rows: readonly DefinitionRow[]
  className?: string
  /** `stacked` on all widths, or `columns` to sit term and value side by side. */
  layout?: 'stacked' | 'columns'
}) {
  return (
    <dl
      className={cx(
        layout === 'columns'
          ? 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(9rem,14rem)_1fr]'
          : 'flex flex-col gap-3',
        className
      )}
    >
      {rows.map((row) => (
        <div
          key={row.term}
          className={cx(
            layout === 'columns' ? 'contents' : 'flex flex-col gap-1',
            'min-w-0'
          )}
        >
          <dt className="eyebrow text-2xs">{row.term}</dt>
          <dd
            className={cx(
              'min-w-0 text-ink-secondary',
              row.mono ? 'font-mono text-xs leading-normal break-words' : 'text-sm'
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------------------- */
/* DataCard                                                                    */
/* -------------------------------------------------------------------------- */

export interface DataCardProps {
  /** A technical identifier, rendered in the monospace face. */
  identifier?: string
  title: string
  /** Heading level, so the card fits the page's outline rather than fixing one. */
  headingLevel?: 2 | 3 | 4
  status?: React.ComponentProps<typeof StatusBadge>
  children: ReactNode
  sources?: readonly EvidenceSource[]
  className?: string
  footer?: ReactNode
}

/**
 * A card whose subject is a repository artefact.
 *
 * Fixed slots for the identifier, the status and the sources, so that every
 * artefact on the site is presented the same way and a reader learns the layout
 * once.
 */
export function DataCard({
  identifier,
  title,
  headingLevel = 3,
  status,
  children,
  sources,
  className,
  footer,
}: DataCardProps) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'
  return (
    <Card as="article" className={cx('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            {identifier ? (
              <span className="font-mono text-2xs tracking-wide text-accent">
                {identifier}
              </span>
            ) : null}
            <Heading className="text-lg font-semibold leading-snug text-ink">
              {title}
            </Heading>
          </div>
          {status ? <StatusBadge {...status} size="sm" /> : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">{children}</div>

      {sources && sources.length > 0 ? (
        <div className="mt-auto border-t border-line-subtle pt-3">
          <SourceList sources={sources} />
        </div>
      ) : null}

      {footer ? <div className="mt-auto">{footer}</div> : null}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* EvidenceItem                                                                */
/* -------------------------------------------------------------------------- */

export interface EvidenceItemProps {
  label: string
  detail: string
  status: React.ComponentProps<typeof StatusBadge>
  sources: readonly EvidenceSource[]
  /** The rail marker's tone, matched to the status. */
  kind: string
  className?: string
}

/**
 * One row of the evidence ledger.
 *
 * Laid out as a timeline against a vertical rule, so the ledger reads as a
 * sequence of things that were proven rather than as a grid of equal claims -
 * and so the final row, the one that has NOT been proven, sits visibly at the
 * end of the sequence instead of being lost among the others.
 */
export function EvidenceItem({
  label,
  detail,
  status,
  sources,
  kind,
  className,
}: EvidenceItemProps) {
  const isPending = status.status === 'pending-external' || status.status === 'blocked'
  return (
    <li
      className={cx(
        'relative flex flex-col gap-3 pb-8 pl-8 last:pb-0 sm:pl-10',
        // The rail. A hairline that stops at the last item rather than trailing
        // off into whitespace.
        'before:absolute before:top-6 before:bottom-0 before:left-[7px] before:w-px',
        'before:bg-line last:before:hidden',
        className
      )}
    >
      {/* The rail marker. Filled for proven, hollow for pending, so the ledger
          is legible in greyscale. */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-1.5 left-0 size-[15px] rounded-full border-2',
          isPending
            ? 'border-pending bg-canvas'
            : 'border-verified bg-verified/25 shadow-[0_0_0_3px_var(--color-verified-wash)]'
        )}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-base font-semibold text-ink">{label}</h3>
        <StatusBadge {...status} size="sm" />
        <span className="eyebrow text-2xs">{kind}</span>
      </div>
      <Text size="sm" tone={isPending ? 'secondary' : 'default'} className="max-w-prose">
        {detail}
      </Text>
      <SourceList sources={sources} />
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* MetricCount (static half)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A count rendered without animation.
 *
 * This is the server-rendered form, used wherever a number appears outside the
 * credibility strip. The animated form is `<AnimatedCount>` in
 * components/motion, which wraps this one so the markup is identical whether or
 * not the number counts up.
 */
export function MetricCount({
  value,
  label,
  detail,
  sources,
  className,
}: {
  value: number
  label: string
  detail?: string
  sources?: readonly EvidenceSource[]
  className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span className="numeric font-display text-3xl font-semibold tracking-tighter text-ink">
        {formatCount(value)}
      </span>
      <span className="text-sm font-medium text-ink-secondary">{label}</span>
      {detail ? (
        <span className="text-xs leading-normal text-ink-faint">{detail}</span>
      ) : null}
      {sources ? <SourceList sources={sources} className="pt-1" /> : null}
    </div>
  )
}
