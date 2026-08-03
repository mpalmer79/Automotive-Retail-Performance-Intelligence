import type { Metadata } from 'next'

import { DomainJudgement } from '@/components/sections/domain-judgement'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { FinalCta } from '@/components/sections/final-cta'
import { GraniteGroup } from '@/components/sections/granite-group'
import { Hero } from '@/components/sections/hero'
import { OperatingView } from '@/components/sections/operating-view'
import { PlatformStory } from '@/components/sections/platform-story'
import { Canvas } from '@/components/shell/field'
import { pageMetadata } from '@/lib/metadata'

export const metadata: Metadata = pageMetadata('home')

/**
 * The home page: seven chapters, each with a different job and a different ground.
 *
 *   1  Hero               cinematic  what it is, who built it, two ways in
 *   2  Granite Auto Group product    the business: three stores, three models
 *   3  Domain judgement   editorial  the problem, and why these answers differ
 *   4  Operating view     product    the signature surface: six domains
 *   5  Platform story     editorial  five stages, generate to serve
 *   6  Engineering proof  evidence   four counts, each linked to its source
 *   7  Closing            cinematic  two actions, and what is not finished
 *
 * CHAPTER 2 WAS ADDED AFTER THE SIX-CHAPTER REDESIGN
 * --------------------------------------------------
 * The six chapters described a platform without ever describing what it was a
 * platform for. "A fictional three-store dealer group" appeared as a
 * subordinate clause in four of them and was never expanded, so a visitor could
 * finish the page without learning that one of those stores is an independent
 * that buys every car it sells. That fact is what makes a group-level number
 * misleading on its own, which is the argument chapter 3 then goes on to make.
 *
 * It sits second rather than later for that reason: it is the setup for the
 * chapter after it, not an appendix to the page.
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
 *
 * ONE CANVAS, NOT SIX PANELS
 * --------------------------
 * All six chapters sit inside a single `<Canvas>`. That is the selected layout
 * direction - "Floating Intelligence Canvas" - and it was chosen over two
 * alternatives that split the page into multiple floating panels. The scoring
 * is in portfolio/docs/EXPERIENCE_REDESIGN_V2.md section 9.
 *
 * The short version: splitting the hero into two panels (direction B) took the
 * headline's measure from 1,150px to 520px and set a ten-word sentence in five
 * lines, and floating the proof and judgement chapters as separate modules
 * (direction C) made the page 3,000px longer on a desktop and 7,600px longer at
 * 1024px, because a chapter written for a full-width canvas reflows badly into
 * a five-column module. The one-canvas reading is also the one the direction
 * actually asks for: subtle internal divisions instead of many separate cards.
 */
export default function HomePage() {
  return (
    <Canvas>
      <Hero />
      <GraniteGroup />
      <DomainJudgement />
      <OperatingView />
      <PlatformStory />
      <EngineeringProof />
      <FinalCta />
    </Canvas>
  )
}
