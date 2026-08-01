import type { Metadata } from 'next'

import { DomainJudgement } from '@/components/sections/domain-judgement'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { FinalCta } from '@/components/sections/final-cta'
import { Hero } from '@/components/sections/hero'
import { OperatingView } from '@/components/sections/operating-view'
import { PlatformStory } from '@/components/sections/platform-story'
import { pageMetadata } from '@/lib/metadata'

export const metadata: Metadata = pageMetadata('home')

/**
 * The home page: six chapters, each with a different job and a different ground.
 *
 *   1  Hero               cinematic  what it is, who built it, two ways in
 *   2  Domain judgement   editorial  the problem, and why these answers differ
 *   3  Operating view     product    the signature surface: six domains
 *   4  Platform story     editorial  five stages, generate to serve
 *   5  Engineering proof  evidence   four counts, each linked to its source
 *   6  Closing            cinematic  two actions, and what is not finished
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * Nine sections became six. The nine shared one container, one vertical rhythm,
 * one hairline rule and one reveal, so a reader had no signal about which of
 * them mattered - the page was 11.8 desktop screens and 23.4 phone screens of
 * undifferentiated blocks (finding A-03).
 *
 * The six alternate between four grounds, which is what carries the hierarchy
 * now that the borders are gone. Cinematic opens and closes the page; the two
 * editorial chapters are the reading; the product frame is the peak; the
 * evidence band is recessed instrumentation.
 *
 * Removed, and where each went:
 *
 *   credibility strip     seven counts became four, inside chapter 5
 *   pipeline walkthrough  eight scrolling stages became five, in chapter 4
 *   domain cards          six expandable cards became the product frame, ch. 3
 *   evidence ledger       deleted. /status already carried the full ledger, and
 *                         the home page's copy of it was a second rendering of
 *                         the same manifest records
 *   lifecycle summary     deleted, for the same reason. /status has all eight
 *                         phases; chapter 6 states the one fact a home-page
 *                         reader needs, which is that the case study is locked
 *   author perspective    merged into chapter 2, which is where the argument is
 *   business problem      merged into chapter 2, ditto
 *
 * Two of the six are client components: the operating view holds a selection,
 * and the proof section holds a disclosure. The other four, including the hero
 * and its signature visual, are server-rendered with no client JavaScript at
 * all. Bundle accounting is in portfolio/docs/PERFORMANCE.md section 4.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <DomainJudgement />
      <OperatingView />
      <PlatformStory />
      <EngineeringProof />
      <FinalCta />
    </>
  )
}
