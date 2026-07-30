/**
 * The standard page header.
 *
 * Every route except the home page opens with this: a breadcrumb, an eyebrow, the
 * single h1, a lede, and - crucially - the synthetic-data notice.
 *
 * The notice is here rather than left to each page because it must appear on
 * every primary route and a shared component is the only way to guarantee that.
 * `tests/e2e/content-integrity.spec.ts` asserts the statement is present on each
 * route, so a page that somehow bypassed this component would fail.
 */
import type { ReactNode } from 'react'

import { Breadcrumbs } from '@/components/ui/states'
import { Container, Section } from '@/components/ui/layout'
import { Eyebrow, Heading, Text } from '@/components/ui/typography'
import { SYNTHETIC_DATA_SHORT } from '@/lib/site'
import { cx } from '@/lib/utils'

export interface PageHeaderProps {
  eyebrow: string
  title: string
  lede: string
  /** A second paragraph, where the lede alone would overrun a sensible length. */
  supporting?: string
  /** Status badges, source links, or a jump list. */
  meta?: ReactNode
  /**
   * Suppress the shared synthetic-data notice, for a page that makes the same
   * statement more prominently in its own body. Only /governance does this.
   */
  suppressSyntheticNotice?: boolean
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  supporting,
  meta,
  suppressSyntheticNotice = false,
  className,
}: PageHeaderProps) {
  return (
    <Section rhythm="none" className={cx('relative pt-8 pb-section-tight', className)}>
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_100%_at_20%_0%,black,transparent)]"
      />
      <Container width="wide">
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            trail={[
              { href: '/', label: 'Overview' },
              { href: '#', label: title },
            ]}
          />

          <div className="flex flex-col gap-5">
            <Eyebrow tone="accent">{eyebrow}</Eyebrow>
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

          {meta ? <div className="flex flex-wrap items-center gap-3">{meta}</div> : null}

          {!suppressSyntheticNotice ? (
            <p className="rule-marked max-w-prose pt-4 text-xs leading-relaxed text-ink-muted">
              <span className="font-semibold text-pending">Synthetic data. </span>
              {SYNTHETIC_DATA_SHORT} No real dealership, customer, employee or lending
              data exists anywhere in this project.
            </p>
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
