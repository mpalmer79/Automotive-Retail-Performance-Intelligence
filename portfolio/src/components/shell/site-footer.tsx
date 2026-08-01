/**
 * The site footer.
 *
 * Server component. Four groups, one trust line, one build stamp.
 *
 * WHAT THE REDESIGN CHANGED
 * -------------------------
 * The previous footer opened with a bordered amber panel carrying a warning
 * triangle, a heading and two paragraphs restating the synthetic-data
 * disclosure - on every page, below the same disclosure the page had already
 * made in its body. It was the seventh place the point was made on the home
 * page. The footer now carries `<TrustLine>`, the same one-line component every
 * route uses, and the detail lives on the governance page whose subject it is.
 *
 * The footer is also where the case study lives now that it is out of the
 * header. It is one link in the site group, it says "locked" in words, and it is
 * where a reader who has finished the page would look for it.
 */
import { ExternalLink, FolderGit2, Lock } from 'lucide-react'
import Link from 'next/link'

import { Wordmark } from '@/components/brand/logo'
import { Container } from '@/components/ui/layout'
import { TrustLine } from '@/components/ui/trust-line'
import { Text } from '@/components/ui/typography'
import { caseStudyUnlocked, manifest } from '@/lib/manifest'
import {
  PLATFORM_NAV,
  PRIMARY_NAV,
  REPOSITORY_URL,
  ROUTES,
  repoFileUrl,
} from '@/lib/site'

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
    <footer className="mt-auto border-t border-line-subtle bg-canvas-deep">
      <Container width="wide" className="py-14 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8">
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Wordmark variant="full" />
            <Text size="sm" tone="muted" className="max-w-xs">
              A governed, reproducible analytics platform for a fictional three-store
              dealer group, built by {manifest.project.author}.
            </Text>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-touch items-center gap-2 self-start rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink-secondary transition-colors duration-(--arpi-motion-fast) hover:border-accent-muted hover:text-ink"
            >
              <FolderGit2 aria-hidden="true" className="size-4" strokeWidth={2} />
              Source repository
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>

          <nav
            aria-labelledby="footer-site-heading"
            className="flex flex-col gap-3 lg:col-span-3"
          >
            <h2 id="footer-site-heading" className="eyebrow text-2xs">
              This site
            </h2>
            <ul className="flex flex-col gap-1">
              {PRIMARY_NAV.map((item) => (
                <li key={item.href}>
                  <FooterLink href={item.href}>{item.label}</FooterLink>
                </li>
              ))}
              {/* The two platform pages that "Platform" does not itself point
                  at, listed under their own names. "Platform" is a navigation
                  grouping; a footer is an index, and an index that hides two
                  pages behind a group name is a worse index. */}
              {PLATFORM_NAV.filter((item) => item.href !== ROUTES.architecture.href).map(
                (item) => (
                  <li key={item.href}>
                    <FooterLink href={item.href}>{item.label}</FooterLink>
                  </li>
                )
              )}
              <li>
                <Link
                  href={ROUTES.caseStudy.href}
                  className="inline-flex min-h-9 items-center gap-2 text-sm text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                >
                  Case study
                  {!caseStudyUnlocked ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center gap-1 rounded-pill border border-pending/40 px-1.5 py-0.5 font-mono text-2xs leading-none text-pending"
                      >
                        <Lock className="size-2.5" strokeWidth={2.5} />
                        LOCKED
                      </span>
                      <span className="sr-only"> - locked, Gate 2 is closed</span>
                    </>
                  ) : null}
                </Link>
              </li>
            </ul>
          </nav>

          <nav
            aria-labelledby="footer-docs-heading"
            className="flex flex-col gap-3 lg:col-span-3"
          >
            <h2 id="footer-docs-heading" className="eyebrow text-2xs">
              Governing documents
            </h2>
            <ul className="flex flex-col gap-1">
              {DOCUMENTS.map((doc) => (
                <li key={doc.path}>
                  <a
                    href={repoFileUrl(doc.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/doc inline-flex min-h-9 items-center gap-1.5 text-sm text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent"
                  >
                    {doc.label}
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3 shrink-0 opacity-0 transition-opacity group-hover/doc:opacity-70"
                      strokeWidth={2.25}
                    />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="eyebrow text-2xs">Current state</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col">
                <dt className="text-xs text-ink-faint">Semantic model</dt>
                <dd className="text-ink-secondary">Built, real-engine pending</dd>
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
              <div className="flex flex-col">
                <dt className="text-xs text-ink-faint">Deployment</dt>
                <dd className="text-ink-secondary">Railway, health check on /status</dd>
              </div>
            </dl>
          </div>
        </div>

        <TrustLine href={ROUTES.governance.href} className="mt-12" />

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Text size="xs" tone="faint">
            {manifest.project.licence} licensed. Copyright &copy; 2026{' '}
            {manifest.project.author}. The synthetic data it produces is likewise free to
            use, with the obvious caveat that it describes nothing real.
          </Text>
          <p className="font-mono text-2xs text-ink-faint">
            Built from commit{' '}
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

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center text-sm text-ink-muted transition-colors duration-(--arpi-motion-fast) hover:text-accent"
    >
      {children}
    </Link>
  )
}
