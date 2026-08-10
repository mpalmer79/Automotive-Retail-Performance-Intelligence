/**
 * The standard page header.
 *
 * Every route except the home page opens with this: a breadcrumb, an eyebrow,
 * the single h1, a lede, optional meta, and one `<TrustLine>`.
 *
 * WHAT THE REDESIGN CHANGED
 * -------------------------
 *   - The synthetic-data notice was a ruled paragraph restating the same two
 *     sentences on every route. It is now `<TrustLine>`: one line, one shape,
 *     the validation state read from the manifest rather than typed, and a link
 *     to the page whose subject it is. The disclosure is still in the body of
 *     every primary route, which `tests/e2e/content-integrity.spec.ts` still
 *     asserts route by route.
 *   - The header sits on the `cinematic` ground, so every route opens on the
 *     same deeper band the home page's hero uses and the content below it reads
 *     as a step up rather than as more of the same.
 *   - `UX.1` narrowed its audience. It opens the REFERENCE half of the site now:
 *     the technical destination, the author page, the store pages, the reference
 *     listing explorer and the case study. The operating application opens with
 *     `<OperatingPageHeader>` instead, which carries a name rather than a
 *     sentence and puts the filter controls where the lede used to be.
 */
import type { ReactNode } from 'react'

import { GroupNav } from '@/components/shell/group-nav'
import { Container, Section } from '@/components/ui/layout'
import { Breadcrumbs } from '@/components/ui/states'
import { TrustLine } from '@/components/ui/trust-line'
import { Heading, Text } from '@/components/ui/typography'
import { cx } from '@/lib/utils'
import { technicalHref } from '@/lib/technical'

export interface PageHeaderProps {
  eyebrow: string
  title: string
  lede: string
  /** A second paragraph, where the lede alone would overrun a sensible length. */
  supporting?: string
  /**
   * The breadcrumb's own label for this page.
   *
   * Defaults to `title`, which is right for every route whose h1 is a name. The
   * console's h1 is a sentence - "How the group is performing, and which store
   * needs attention" - and a trail reading "Overview / How the group is
   * performing..." is a trail nobody reads. `INFORMATION_ARCHITECTURE.md` §5 asks
   * for the destination name, so a page whose heading is a sentence supplies one.
   */
  crumbLabel?: string
  /** Status badges, source links, or a jump list. */
  meta?: ReactNode
  /**
   * Render the Granite Auto Group sub-navigation. Set by the three store routes
   * and by the reference listing explorer.
   *
   * IT IS THE ONLY SUB-NAVIGATION FLAG LEFT. There were three. `platformNav`
   * linked Architecture, Data Model, Inventory Operations and Governance to each
   * other, and `dashboardNav` linked the console's eight sections; `UX.1` replaced
   * the first with the technical destination's own view navigation and the second
   * with the operating rail, and both flags went with them. A header prop that
   * renders a navigation is right when a handful of sibling documents need to
   * reach each other and wrong once one of them becomes an application.
   */
  groupNav?: boolean
  /**
   * A crumb between "Overview" and this page.
   *
   * The three store routes use it. Their parent used to be `/dealerships`, which
   * is now a permanent redirect to `/`, so the trail would have had two entries
   * resolving to the same document - "Overview / Granite Auto Group / Granite
   * Subaru of Manchester", where the first two are one page. Passing the parent
   * explicitly lets a store page name its group without inventing a level that
   * no longer exists.
   */
  parentCrumb?: { readonly href: string; readonly label: string }
  /**
   * Which provenance the route's data has, passed through to `<TrustLine>`.
   * `inventory` on every route that renders a figure from the sanitized
   * reference workbooks rather than from the synthetic warehouse.
   */
  trustScope?: 'synthetic' | 'inventory' | 'dashboard'
  /**
   * Where the trust line sends a reader for detail. Governance by default;
   * `/status` from routes that are themselves about progress.
   */
  trustHref?: string
  /**
   * Suppress the trust line, for the one page that IS the disclosure and states
   * it at full length in its own body. Only `/governance` sets this.
   */
  suppressTrustLine?: boolean
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  supporting,
  crumbLabel,
  meta,
  groupNav = false,
  parentCrumb,
  trustScope = 'synthetic',
  trustHref = technicalHref('governance'),
  suppressTrustLine = false,
  className,
}: PageHeaderProps) {
  return (
    <Section
      rhythm="none"
      tone="cinematic"
      className={cx('relative overflow-hidden pt-8 pb-section-tight', className)}
    >
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_100%_at_20%_0%,black,transparent)]"
      />
      <Container width="wide">
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            trail={[
              /* THE ROOT CRUMB IS THE APPLICATION.
                 It read "Overview" and pointed at a marketing landing page. `/`
                 is the operating console now, so the trail says so: a reader on
                 the governance view is one click from the screen they left. */
              { href: '/', label: 'Executive' },
              ...(parentCrumb ? [parentCrumb] : []),
              { href: '#', label: crumbLabel ?? title },
            ]}
          />

          <div className="flex flex-col gap-5">
            <p className="eyebrow flex items-center gap-2.5 text-accent">
              <span
                aria-hidden="true"
                className="inline-block h-px w-6 shrink-0 bg-accent"
              />
              {eyebrow}
            </p>
            <Heading level={1} className="max-w-4xl">
              {title}
            </Heading>
            <Text size="body" tone="secondary" className="max-w-prose">
              {lede}
            </Text>
            {supporting ? (
              <Text size="body" tone="muted" className="max-w-prose">
                {supporting}
              </Text>
            ) : null}
          </div>

          {groupNav ? <GroupNav className="pt-1" /> : null}

          {meta ? <div className="flex flex-wrap items-center gap-3">{meta}</div> : null}

          {!suppressTrustLine ? (
            <TrustLine href={trustHref} scope={trustScope} className="max-w-3xl" />
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
