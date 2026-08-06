import type { Metadata } from 'next'

import { Builder } from '@/components/sections/builder'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { FinalCta } from '@/components/sections/final-cta'
import { Hero } from '@/components/sections/hero'
import { OperatingView } from '@/components/sections/operating-view'
import { ProductTourSection } from '@/components/sections/product-tour'
import { StoreStory } from '@/components/sections/store-story'
import { Canvas } from '@/components/shell/field'
import { pageMetadata } from '@/lib/metadata'

export const metadata: Metadata = pageMetadata('home')

/**
 * The home page: the ARPI product overview.
 *
 * WHY THIS PAGE IS THE GROUP OVERVIEW
 * -----------------------------------
 * It used to open with "Dealership intelligence built by someone who has run the
 * dealership" and then spend its first screen on twenty-five years of automotive
 * retail career. That sentence is the strongest thing about this project and it
 * was in the wrong place: it made the AUTHOR the subject of the PRODUCT's home
 * page. Meanwhile `/dealerships` - which introduced the group, its three stores
 * and the reporting problem - was the natural beginning of the story and was
 * buried one click in.
 *
 * So the two swapped. `/` is the group and product overview, `/about` is the
 * canonical author page and keeps the career narrative at full length, and
 * `/dealerships` is a permanent redirect here rather than a second page
 * rendering the same content. The author positioning survives as chapter six,
 * where it reads as a summary of demonstrated judgement rather than as a boast
 * made before any.
 *
 * FROM THIRTEEN CHAPTERS TO SEVEN
 * -------------------------------
 * The previous composition was thirteen sections, six of which described the
 * same three rooftops in five different card layouts before a visitor had
 * touched anything, and none of which showed the software running. This is the
 * same material as seven, with the repetition replaced by state and the
 * description replaced by the product:
 *
 *    1  Hero            cinematic  the group, the problem, and a WORKING
 *                                  inventory surface with its lineage
 *    2  Store story     product    three rooftops as one tab set, plus the
 *                                  comparison a table does better than tabs
 *    3  Product tour    product    four real routes, photographed from a real
 *                                  build, one decision stated per route
 *    4  Operating view  product    six governed domains, one definition each
 *    5  Proof           evidence   four counts, each generated from the file
 *                                  that proves it
 *    6  Builder         editorial  the domain experience, and the three
 *                                  decisions that could only come from it
 *    7  Closing         cinematic  two actions, and what is not finished
 *
 * WHERE THE RETIRED SECTIONS WENT
 * -------------------------------
 * Nothing was deleted without a home. `GroupIntroduction`, `OperatingModels`,
 * `GroupInventory`, `StoreCards`, `InventoryStrategy`, `StoreComparison` and
 * `GovernedGroupView` are chapter two. `DomainJudgement` is chapter six, and
 * `/about` still carries the career at length. `PlatformStory` is gone from this
 * page because `/architecture` already renders the pipeline layer by layer, and
 * `InventoryOperationsPreview` is gone because the tour's first step carries the
 * provenance and `/inventory-operations` carries the lane.
 *
 * The grounds still alternate, which is what carries the hierarchy now that the
 * section borders are gone: cinematic opens and closes, product frames are the
 * peaks, evidence bands are recessed.
 *
 * ONE CANVAS, NOT SEVEN PANELS
 * ----------------------------
 * All of it sits inside a single `<Canvas>`. That is the selected layout
 * direction and the reasoning is in portfolio/docs/EXPERIENCE_REDESIGN_V2.md
 * section 9.
 */
export default function HomePage() {
  return (
    <Canvas>
      <Hero />
      <StoreStory />
      <ProductTourSection />
      <OperatingView />
      <EngineeringProof />
      <Builder />
      <FinalCta />
    </Canvas>
  )
}
