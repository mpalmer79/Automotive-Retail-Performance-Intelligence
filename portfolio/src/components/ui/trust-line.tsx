/**
 * TrustLine — the site's one concise disclosure.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * The previous build stated its trust position seven separate times on the home
 * page alone: a status badge pair, a bordered caveat panel, a ruled synthetic
 * data paragraph, a footnote on the domain cards, a lede on the evidence ledger,
 * a lede on the lifecycle summary, and a bordered panel in the footer. Every one
 * of them was true. Together they made a finished warehouse, a governed KPI
 * catalogue and a source-controlled semantic model read as an apology. That was
 * finding A-04 in EXPERIENCE_REDESIGN_V2.md.
 *
 * The fix is not to say less that is true. It is to say it ONCE per route, in
 * one recognisable shape, and to put the detail on the two pages whose subject
 * it is.
 *
 * WHAT IT ALWAYS CARRIES
 * ----------------------
 *   1. that the data is synthetic and the dealer group is fictional
 *   2. the current real-engine validation state, read from the manifest
 *   3. a link to the page that explains it
 *
 * Point 2 is derived, never authored. If a real-engine path ever records a
 * current PASSED result, this component stops saying validation is pending on
 * every route at once, and it cannot be made to say so early by editing a
 * string.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a panel, not a card, not an alert, not a bordered box with a warning
 * triangle. It is a line of text on a hairline rule. A disclosure that shouts is
 * a disclosure a reader learns to skip, and this one has to survive being on
 * every page.
 */
import Link from 'next/link'

import { realEngineValidated } from '@/lib/manifest'
import { ROUTES } from '@/lib/site'
import { cx } from '@/lib/utils'

/**
 * The validation clause.
 *
 * Derived from the manifest so the sentence cannot outlive the fact. Both
 * branches name the thing precisely: "real-engine validation" is the phrase the
 * status page, the KPI catalogue and the architecture page all use, and the
 * content-integrity suite greps for it.
 */
function validationClause(): string {
  if (realEngineValidated) return 'Real-engine validation recorded.'
  return 'Real-engine validation pending.'
}

export interface TrustLineProps {
  /**
   * `hero` is the home page's single statement, set at reading size.
   * `route` is the compact form every other route carries below its h1.
   */
  variant?: 'hero' | 'route'
  /**
   * Which provenance the route's data has.
   *
   * `synthetic` is the default and covers every page built on the generated
   * warehouse. `inventory` is for the dealership and inventory routes, which
   * render sanitized public reference data instead - a different provenance with
   * a different limitation, and one that would be misdescribed by the word
   * "synthetic". See `INVENTORY_DATA_STATEMENT` in `lib/site.ts`.
   */
  scope?: 'synthetic' | 'inventory'
  /**
   * Where the reader is sent for the detail. Governance is the default because
   * it is the page whose subject this is; the status page is the right target
   * from routes that are themselves about progress.
   */
  href?: string
  className?: string
}

export function TrustLine({
  variant = 'route',
  scope = 'synthetic',
  href = ROUTES.governance.href,
  className,
}: TrustLineProps) {
  const isHero = variant === 'hero'
  const isInventory = scope === 'inventory'

  return (
    <p
      className={cx(
        'flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3.5',
        isHero ? 'text-sm text-ink-muted' : 'text-xs text-ink-faint',
        className
      )}
    >
      {/* The state marker. Amber while a validation is outstanding, cyan once it
          is not. Paired with the words beside it, never carrying the meaning on
          its own. */}
      <span
        aria-hidden="true"
        className={cx(
          'inline-block size-1.5 shrink-0 rounded-pill',
          realEngineValidated ? 'bg-accent' : 'bg-pending'
        )}
      />
      <span className="font-medium text-ink-secondary">
        {isInventory
          ? 'Sanitized reference data over a synthetic warehouse.'
          : 'Deterministic synthetic data.'}
      </span>
      <Clause>Granite Auto Group is fictional.</Clause>
      {isInventory ? <Clause>Listings, not sales results.</Clause> : null}
      <Clause tone={realEngineValidated ? undefined : 'pending'}>
        {validationClause()}
      </Clause>
      <Clause>
        <Link
          href={href}
          className="underline decoration-dotted underline-offset-4 transition-colors duration-(--arpi-motion-fast) hover:text-accent"
        >
          How this is governed
        </Link>
      </Clause>
    </p>
  )
}

/**
 * One clause, with its leading separator.
 *
 * Three short sentences set with only a word space between them wrap into what
 * looks like a list of fragments rather than a line, which is how the first
 * version rendered at 375px: four ragged rows deep. A middot gives the eye the
 * break.
 *
 * The separator LEADS its clause rather than trailing the previous one, and the
 * pair does not wrap between them. That is what stops a line ending on a lone
 * dot when the line breaks, which is what the trailing form produced in the
 * hero's 460px column.
 *
 * `aria-hidden` on the mark keeps a screen reader reading three sentences rather
 * than "dot, dot, dot".
 */
function Clause({ children, tone }: { children: React.ReactNode; tone?: 'pending' }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className="text-ink-faint/70">
        &middot;
      </span>
      <span className={cx('whitespace-normal', tone === 'pending' && 'text-pending')}>
        {children}
      </span>
    </span>
  )
}
