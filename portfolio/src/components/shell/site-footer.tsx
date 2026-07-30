/**
 * The site footer.
 *
 * Server component. Carries the synthetic-data statement, the repository links,
 * the documentation links and the licence - and crucially, it is NOT the only
 * place the synthetic-data statement appears. Every primary route states it in
 * the page body as well, which
 * `tests/e2e/content-integrity.spec.ts` asserts route by route.
 *
 * The statement is here too because a footer is where a sceptical reader looks
 * for the qualification, and finding it there confirms rather than reveals.
 */
import { AlertTriangle, ExternalLink, FolderGit2 } from 'lucide-react'
import Link from 'next/link'

import { Wordmark } from '@/components/brand/logo'
import { Container } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'
import { manifest } from '@/lib/manifest'
import {
  PRIMARY_NAV,
  REPOSITORY_URL,
  ROUTES,
  SYNTHETIC_DATA_STATEMENT,
  repoFileUrl,
} from '@/lib/site'
import { cx } from '@/lib/utils'

/** The governing documents a technical reviewer will want within one click. */
const DOCUMENTS: readonly { readonly path: string; readonly label: string }[] = [
  { path: 'ARCHITECTURE.md', label: 'Architecture' },
  { path: 'DATA_DICTIONARY.md', label: 'Data dictionary' },
  { path: 'KPI_CATALOG.md', label: 'KPI catalogue' },
  { path: 'PRIVACY_AND_ETHICS.md', label: 'Privacy and ethics' },
  { path: 'LIMITATIONS.md', label: 'Limitations' },
  { path: 'docs/architecture-decisions/', label: 'Architecture decisions' },
]

export function SiteFooter() {
  const gate2 = manifest.gates.find((g) => g.id === 'gate-2')

  return (
    <footer className="mt-auto border-t border-line-subtle bg-canvas-raised">
      <Container width="wide" className="py-12 sm:py-16">
        {/* The synthetic-data statement, given a bordered panel rather than being
            set as small print. */}
        <div
          className={cx(
            'mb-12 flex gap-4 rounded-xl border border-pending/30 bg-pending-wash/40 p-5'
          )}
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-pending"
            strokeWidth={2}
          />
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-pending">
              This project contains no real data
            </h2>
            <Text size="sm" tone="secondary" className="max-w-prose">
              {SYNTHETIC_DATA_STATEMENT}
            </Text>
            <Text size="sm" tone="muted" className="max-w-prose">
              Every figure is generated from documented rules and a fixed random seed.
              Nothing here should be read as, compared against, or cited as the
              performance of any real automotive retailer.
            </Text>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-4 lg:col-span-1">
            <Wordmark variant="full" />
            <Text size="sm" tone="muted" className="max-w-xs">
              A governed, reproducible analytics platform for a fictional three-store
              dealer group. Built by {manifest.project.author}.
            </Text>
          </div>

          <nav aria-labelledby="footer-site-heading" className="flex flex-col gap-3">
            <h2 id="footer-site-heading" className="eyebrow text-2xs">
              This site
            </h2>
            <ul className="flex flex-col gap-2">
              {PRIMARY_NAV.map((route) => (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    className="text-sm text-ink-muted transition-colors hover:text-accent"
                  >
                    {route.navLabel}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={ROUTES.caseStudy.href}
                  className="inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-accent"
                >
                  Case study
                  <span className="rounded-pill border border-pending/40 px-1.5 py-0.5 font-mono text-2xs leading-none text-pending">
                    LOCKED
                  </span>
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-docs-heading" className="flex flex-col gap-3">
            <h2 id="footer-docs-heading" className="eyebrow text-2xs">
              Governing documents
            </h2>
            <ul className="flex flex-col gap-2">
              {DOCUMENTS.map((doc) => (
                <li key={doc.path}>
                  <a
                    href={repoFileUrl(doc.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/doc inline-flex items-baseline gap-1.5 text-sm text-ink-muted transition-colors hover:text-accent"
                  >
                    {doc.label}
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3 shrink-0 translate-y-0.5 opacity-0 transition-opacity group-hover/doc:opacity-70"
                      strokeWidth={2.25}
                    />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-3">
            <h2 className="eyebrow text-2xs">Current state</h2>
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex flex-col">
                <dt className="text-xs text-ink-faint">Semantic model</dt>
                <dd className="text-ink-secondary">
                  Built, statically validated, real-engine validation pending
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-ink-faint">Report pages</dt>
                <dd className="text-ink-secondary">
                  {manifest.semanticModel.dashboardPageCount === 0
                    ? 'None exist'
                    : `${String(manifest.semanticModel.dashboardPageCount)} defined`}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-ink-faint">Gate 2</dt>
                <dd className="text-ink-secondary">{gate2?.verdict ?? 'CLOSED'}</dd>
              </div>
            </dl>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-9 items-center gap-2 self-start rounded-lg border border-line-strong px-3 text-sm font-medium text-ink-secondary transition-colors hover:border-accent-muted hover:text-ink"
            >
              <FolderGit2 aria-hidden="true" className="size-4" strokeWidth={2} />
              Source repository
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Text size="xs" tone="faint">
            {manifest.project.licence} licensed. Copyright &copy; 2026{' '}
            {manifest.project.author}. The synthetic data it produces is likewise free to
            use, with the obvious caveat that it describes nothing real.
          </Text>
          <p className="font-mono text-2xs text-ink-faint">
            Site built from commit{' '}
            <a
              href={`${REPOSITORY_URL}/commit/${manifest.generatedFromCommit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
            >
              {manifest.generatedFromCommit.slice(0, 8)}
            </a>
          </p>
        </div>
      </Container>
    </footer>
  )
}
