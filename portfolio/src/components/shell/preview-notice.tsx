import { FlaskConical } from 'lucide-react'

import { Container } from '@/components/ui/layout'
import { IS_PREVIEW, ROUTES } from '@/lib/site'

/**
 * The preview marker.
 *
 * An unpublished deployment of this site - a branch preview, or the Railway
 * `staging` environment - is permitted before any production deployment, but only
 * on the condition that it cannot be mistaken for the published site. That
 * condition is satisfied in three places: `robots.ts` disallows all crawling on a
 * preview, `metadata.ts` sets `noindex` and points canonical tags at the
 * deployment's own origin, and this component makes the state visible to a person.
 *
 * The third matters because the first two are invisible. A screenshot of a preview
 * looks exactly like a screenshot of production, and a screenshot is how a site
 * gets shared. The marker is therefore rendered ABOVE the header, in the document
 * flow rather than fixed, so it appears in a full-page capture and scrolls away
 * afterwards rather than occupying the viewport forever.
 *
 * It renders nothing at all on production, and nothing during local development, so
 * it costs a visitor of the published site nothing.
 *
 * Documented in portfolio/docs/DEPLOYMENT.md section 5.
 */
export function PreviewNotice() {
  if (!IS_PREVIEW) return null

  return (
    <div
      // `role="note"` rather than `alert` or `status`: nothing here changes, and an
      // alert region would interrupt a screen reader on every navigation to say the
      // same sentence.
      role="note"
      aria-label="Deployment notice"
      className="border-b border-pending/40 bg-pending-wash"
    >
      <Container width="full">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs text-pending">
          <span className="flex items-center gap-2 font-mono tracking-wide uppercase">
            <FlaskConical aria-hidden="true" className="size-3.5 shrink-0" />
            Unpublished deployment
          </span>
          <span className="text-ink-secondary">
            This is an unpublished deployment, not a launched site. Every dataset behind
            it is synthetic, semantic-model validation on both accepted engine paths is
            pending, and the{' '}
            <a
              href={ROUTES.caseStudy.href}
              className="underline decoration-dotted underline-offset-2 hover:text-accent"
            >
              analytical case study is closed by Gate 2
            </a>
            .
          </span>
        </p>
      </Container>
    </div>
  )
}
