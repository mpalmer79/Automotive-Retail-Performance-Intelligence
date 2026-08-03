import type { Metadata } from 'next'

import { DomainJudgement } from '@/components/sections/domain-judgement'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { FinalCta } from '@/components/sections/final-cta'
import {
  GovernedGroupView,
  GroupIntroduction,
  GroupInventory,
  InventoryStrategy,
  OperatingModels,
  StoreCards,
  StoreComparison,
} from '@/components/sections/group-overview'
import { Hero } from '@/components/sections/hero'
import { InventoryOperationsPreview } from '@/components/sections/inventory-operations-preview'
import { OperatingView } from '@/components/sections/operating-view'
import { PlatformStory } from '@/components/sections/platform-story'
import { Canvas } from '@/components/shell/field'
import { pageMetadata } from '@/lib/metadata'

export const metadata: Metadata = pageMetadata('home')

/**
 * The home page: the Granite Auto Group and ARPI product overview.
 *
 * WHAT THIS PAGE USED TO BE, AND WHY IT CHANGED
 * ---------------------------------------------
 * It used to open with "Dealership intelligence built by someone who has run the
 * dealership" and then spend its first screen on twenty-five years of automotive
 * retail career. That sentence is the strongest thing about this project and it
 * was in the wrong place: it made the AUTHOR the subject of the PRODUCT's home
 * page. A visitor arrived at ARPI, read a biography, and could leave without ever
 * learning what ARPI models or why modelling it is hard.
 *
 * Meanwhile `/dealerships` - which introduced the group, its three stores, their
 * different operating models, the inventory evidence and the reporting problem -
 * was the natural beginning of the story and was buried one click in.
 *
 * So the two swapped. `/` is the group and product overview, `/about` is the
 * canonical author page and keeps the career narrative at full length, and
 * `/dealerships` is a permanent redirect here rather than a second page
 * rendering the same content. The author positioning survives on this page as
 * one clause in the hero and as the closing argument of chapter 7, where it
 * reads as a summary of demonstrated judgement rather than as a boast made
 * before any.
 *
 * THE ELEVEN CHAPTERS
 * -------------------
 *    1  Hero                  cinematic  the group, the problem, two ways in
 *    2  Group introduction    editorial  who this group is
 *    3  Operating models      product    the three models, one line each
 *    4  Group inventory       evidence   the derived snapshot
 *    5  Store cards           product    one card per store
 *    6  Inventory strategy    editorial  allocation versus acquisition
 *    7  Store comparison      evidence   the same columns, plus distribution
 *    8  Domain judgement      editorial  why dealership systems disagree
 *    9  Operating view        product    the six governed domains
 *   10  Platform story        editorial  five stages, generate to serve
 *   11  Inventory operations  evidence   where the listings came from
 *   12  Engineering proof     evidence   four counts, each linked to its source
 *   13  Closing               cinematic  two actions, and what is not finished
 *
 * The grounds still alternate, which is what carries the hierarchy now that the
 * section borders are gone: cinematic opens and closes, editorial chapters are
 * the reading, product frames are the peaks, evidence bands are recessed.
 *
 * ONE IMPLEMENTATION OF THE GROUP OVERVIEW
 * ----------------------------------------
 * Chapters 2 to 7 come from `components/sections/group-overview.tsx`, which is
 * where the old `/dealerships` body now lives. There is no second rendering of
 * it anywhere: `/dealerships` redirects rather than re-renders, and
 * `tests/unit/site.test.ts` asserts no route other than `/` composes those
 * sections.
 *
 * ONE CANVAS, NOT THIRTEEN PANELS
 * -------------------------------
 * All of it sits inside a single `<Canvas>`. That is the selected layout
 * direction and the reasoning is in portfolio/docs/EXPERIENCE_REDESIGN_V2.md
 * section 9.
 */
export default function HomePage() {
  return (
    <Canvas>
      <Hero />

      {/* The group overview. One implementation, composed here and nowhere
          else. */}
      <GroupIntroduction />
      <OperatingModels />
      <GroupInventory />
      <StoreCards />
      <InventoryStrategy />
      <StoreComparison />

      {/* The argument the overview sets up: three stores whose systems and
          definitions disagree, and what a governed layer does about it. */}
      <DomainJudgement />
      <OperatingView />
      <PlatformStory />
      <GovernedGroupView />

      {/* Provenance, evidence, and the two actions that close the page. */}
      <InventoryOperationsPreview />
      <EngineeringProof />
      <FinalCta />
    </Canvas>
  )
}
