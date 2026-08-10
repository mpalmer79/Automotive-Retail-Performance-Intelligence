import type { ReactNode } from 'react'

import { Container, Section } from '@/components/ui/layout'

/**
 * The evidence band at the top of a technical view.
 *
 * Each of the six consolidated views used to carry its status badges and its
 * source links in a `<PageHeader meta>` slot, and that content is the reason the
 * technical half of this site is worth reading: a status derived from a manifest
 * rather than typed, beside a link to the file it was derived from. Losing it in
 * the consolidation would have thrown away the evidence and kept the prose.
 *
 * It is a band inside the view rather than a slot on the destination's header,
 * because the header belongs to `/technical` as a whole and the badges belong to
 * one of its eight states. A header slot would have made every view's evidence a
 * property of the route.
 */
export function TechnicalViewMeta({ children }: { readonly children: ReactNode }) {
  return (
    <Section rhythm="none" tone="canvas" className="pt-6">
      <Container width="wide">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      </Container>
    </Section>
  )
}
