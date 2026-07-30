import type { Metadata } from 'next'

import { AuthorPerspective } from '@/components/sections/author-perspective'
import { BusinessProblem } from '@/components/sections/business-problem'
import { CredibilityStrip } from '@/components/sections/credibility-strip'
import { DomainCards } from '@/components/sections/domain-cards'
import { EvidenceLedger } from '@/components/sections/evidence-ledger'
import { FinalCta } from '@/components/sections/final-cta'
import { Hero } from '@/components/sections/hero'
import { LifecycleSummary } from '@/components/sections/lifecycle-summary'
import { PipelineScrollytelling } from '@/components/sections/pipeline-scrollytelling'
import { pageMetadata } from '@/lib/metadata'

export const metadata: Metadata = pageMetadata('home')

/**
 * The home page: nine sections, in a deliberate reading order.
 *
 *   1  Hero                    what this is, its status, and the two next steps
 *   2  Credibility strip       the source-backed engineering counts
 *   3  Business problem        why a governed model is the answer
 *   4  Pipeline walkthrough    how it is built, stage by stage
 *   5  Analytical domains      what it measures
 *   6  Evidence ledger         what is proven, and what is not
 *   7  Lifecycle summary       where the project actually stands
 *   8  Author perspective      why this author, specifically
 *   9  Final call to action    where to go next
 *
 * Sections 2 to 9 all sit inside `<Section bordered>`, so the page carries a
 * visible boundary rule between each one. The rhythm is uniform on purpose: an
 * editorial page where every section has its own spacing reads as a series of
 * unrelated pages.
 *
 * Four of the nine are client components (credibility strip, pipeline
 * walkthrough, domain cards, and the hero's inline diagram). The other five are
 * server-rendered with no client JavaScript at all. The bundle accounting is in
 * portfolio/docs/PERFORMANCE.md section 4.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <CredibilityStrip />
      <BusinessProblem />
      <PipelineScrollytelling />
      <DomainCards />
      <EvidenceLedger />
      <LifecycleSummary />
      <AuthorPerspective />
      <FinalCta />
    </>
  )
}
