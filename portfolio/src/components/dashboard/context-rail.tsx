/**
 * The context rail: what you are looking at, before you look at it.
 *
 * NOT A HERO
 * ----------
 * An operating console opens with the scope of the numbers, not with a claim about
 * the product. Six facts, set as instrument labels: the selected period, the
 * comparison period, the store scope, the data as-of date, the dataset version and
 * the synthetic-data declaration. A reader who screenshots the KPI row and pastes
 * it into a message should be able to tell, from the strip above it, exactly which
 * period and which stores it describes — that is the whole job of this block.
 *
 * THE ACTIVE FILTERS ARE TEXT, AND SO IS THEIR REMOVAL
 * ---------------------------------------------------
 * Each chip is a server-rendered `<a>` to the same view without that parameter.
 * No JavaScript, no state, no client component: removing a filter is navigation,
 * and navigation is what links are. Chips for parameters this route cannot act on
 * are marked "not applied here" in words rather than dropped, because a filter that
 * is in the URL and not in the summary is a filter the reader believes is working.
 *
 * `UX.1` SPLIT IT IN TWO, AND `UX.2D` MOVED THE OTHER HALF OUT
 * ------------------------------------------------------------
 * The rail carried two different kinds of thing under one heading. The active
 * filters, their removal links and the "not applied here" notes are CONTROLS: a
 * reader acts on them, and hiding them behind a disclosure would hide the only way
 * to remove a filter. The period/comparison/scope facts, the dataset version, the
 * contract fingerprint and the URL grammar reference are PROVENANCE: true,
 * checkable, and not what a general manager opens a dashboard for.
 *
 * `UX.1` moved the provenance half into the band's methodology disclosure, which
 * is what this file still holds. `UX.2D` moved the control half to
 * `operating-controls.tsx`, where it became the ONE active-filter summary all nine
 * operating routes render — the Executive surface was the only route that had a
 * removable one, and eight routes had no reset at all.
 *
 * Server component.
 */
import { Badge } from '@/components/ui/badge'
import { Disclosure } from '@/components/ui/disclosure'
import { Text } from '@/components/ui/typography'
import type { ExecutiveOverview } from '@/lib/dashboard/executive'
import { formatIsoDate } from '@/lib/dashboard/format'

/** The provenance: the scope in full, the version it came from, and the grammar. */
export function ContextProvenance({
  overview,
  route,
  datasetVersion,
  contractFingerprint,
}: {
  overview: ExecutiveOverview
  route: string
  datasetVersion: number
  /** The first twelve characters of the contract digest: a compact evidence id. */
  contractFingerprint: string
}) {
  const { periodContext, scope } = overview

  const facts: readonly { readonly term: string; readonly value: string }[] = [
    { term: 'Selected period', value: periodContext.period.label },
    {
      term: 'Comparison',
      value:
        periodContext.comparison === null
          ? periodContext.compareMode === 'none'
            ? 'None selected'
            : `${periodContext.comparisonLabel}: unavailable`
          : `${periodContext.comparisonLabel}: ${periodContext.comparison.label}`,
    },
    { term: 'Store scope', value: scope.label },
    { term: 'Data as of', value: formatIsoDate(overview.asOfDate) },
    {
      term: 'Dataset',
      value: `Version ${datasetVersion} · contract ${contractFingerprint}`,
    },
    {
      term: 'Provenance',
      value: 'Deterministic synthetic data. Granite Auto Group is fictional.',
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.term} className="flex min-w-0 flex-col gap-1">
            <dt className="font-mono text-2xs tracking-wide text-ink-muted uppercase">
              {fact.term}
            </dt>
            <dd className="text-sm font-medium break-words text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <FilterGrammar route={route} />
    </div>
  )
}

/**
 * The URL contract, stated where a reader can use it.
 *
 * The control surface offers presets; the grammar is larger than the controls, and
 * a reader who wants a fortnight or two stores at once can have both by typing.
 * Documenting it here is what makes "the URL is the persistence layer" a usable
 * fact rather than an implementation note.
 */
function FilterGrammar({ route }: { route: string }) {
  const examples: readonly { readonly url: string; readonly meaning: string }[] = [
    {
      url: `${route}?period=2025-11`,
      meaning: 'A single calendar month.',
    },
    {
      url: `${route}?period=2025-11-15..2025-12-15`,
      meaning: 'An arbitrary date range, inclusive at both ends.',
    },
    {
      url: `${route}?store=GSA-001,GSA-002`,
      meaning: 'Two stores at once. Absent means the whole group.',
    },
    {
      url: `${route}?compare=prior-year`,
      meaning:
        'Comparison against the same window a year earlier. Withheld when that window is outside the exported reporting period.',
    },
    {
      url: `${route}?period=2025-12-01..2025-12-01&store=GSA-001&source=LDS-001`,
      meaning:
        'The scope at which an order statistic resolves: one store, one lead source, one day.',
    },
  ]

  return (
    <Disclosure label="What the URL accepts">
      <Text size="sm" tone="muted" className="max-w-prose">
        Filter state lives entirely in the query string. There is no cookie, no stored
        preference and no server session: a copied link reproduces the view, the back
        button is the undo stack, and the parameter names are the ones in the information
        architecture rather than a shorthand invented for this page. Unknown parameters
        are ignored; an invalid value falls back to its default and the page says so.
      </Text>
      <ul className="flex flex-col gap-2">
        {examples.map((example) => (
          <li key={example.url} className="flex min-w-0 flex-col gap-0.5">
            <code className="overflow-x-auto font-mono text-2xs break-all text-ink-secondary">
              {example.url}
            </code>
            <Text size="xs" tone="faint">
              {example.meaning}
            </Text>
          </li>
        ))}
      </ul>
      <Text size="xs" tone="faint" className="max-w-prose">
        The full parameter set also accepts <code className="font-mono">scope</code>,{' '}
        <code className="font-mono">dept</code>,{' '}
        <code className="font-mono">employee</code>,{' '}
        <code className="font-mono">campaign</code>,{' '}
        <code className="font-mono">make</code>, <code className="font-mono">model</code>,{' '}
        <code className="font-mono">structure</code> and{' '}
        <code className="font-mono">product</code>. They are part of the console-wide
        grammar so that every page spells a filter the same way; this page holds no
        dataset carrying those attributes and says so above rather than pretending to
        apply them.
      </Text>
    </Disclosure>
  )
}

/** The dataset identity badge, rendered beside the page title. */
export function DatasetBadge({
  datasetVersion,
  contractFingerprint,
  profile,
}: {
  datasetVersion: number
  contractFingerprint: string
  profile: string
}) {
  return (
    <Badge tone="neutral" mono>
      Dataset v{datasetVersion} · {profile} · contract {contractFingerprint}
    </Badge>
  )
}
