import type { Metadata } from 'next'

import { FinalCta } from '@/components/sections/final-cta'
import { Hero } from '@/components/sections/hero'
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
 * FROM THIRTEEN CHAPTERS TO SEVEN, THEN TO FOUR
 * ---------------------------------------------
 * The composition before the redesign was thirteen sections, six of which
 * described the same three rooftops in five different card layouts before a
 * visitor had touched anything, and none of which showed the software running.
 * That became seven, with the repetition replaced by state and the description
 * replaced by the product.
 *
 * Seven chapters still carried 1,738 words of prose in 67 paragraphs. A product
 * landing page runs 300 to 500, so this page was reading as an essay with
 * working software buried inside it. It is now four:
 *
 *    1  Hero            cinematic  the group, the problem, and a WORKING
 *                                  inventory surface with its lineage
 *    2  Store story     product    three rooftops as one tab set, plus the
 *                                  comparison a table does better than tabs
 *    3  Product tour    product    four real routes, photographed from a real
 *                                  build, one decision stated per route
 *    4  Closing         cinematic  the four proof numerals, two actions, and
 *                                  what is not finished
 *
 * WHERE THE RETIRED SECTIONS WENT
 * -------------------------------
 * Nothing was deleted without a home. `GroupIntroduction`, `OperatingModels`,
 * `GroupInventory`, `StoreCards`, `InventoryStrategy`, `StoreComparison` and
 * `GovernedGroupView` are chapter two. `PlatformStory` is gone from this page
 * because `/architecture` already renders the pipeline layer by layer, and
 * `InventoryOperationsPreview` is gone because the tour's first step carries the
 * provenance and `/inventory-operations` carries the lane.
 *
 * The cut that took seven to four moved rather than deleted, too. `OperatingView`
 * is the first thing on `/kpis`, above the catalogue it points into.
 * `Builder`'s three floor decisions are chapter four of `/about`, where the
 * career they came from is already told at length, and the rest of that chapter
 * was a second, shorter telling of the same page. `EngineeringProof` kept its
 * four numerals and its evidence drawer and lost its justification: the strip is
 * inside the closing section, so the page ends on evidence and an action.
 *
 * The prose budget for this page is 450 words, and it is a test rather than an
 * intention: `tests/e2e/content-integrity.spec.ts` counts the visible paragraph
 * text in `<main>` on every run and fails with the overage.
 *
 * The grounds still alternate, which is what carries the hierarchy now that the
 * section borders are gone: cinematic opens and closes, product frames are the
 * peaks, evidence bands are recessed.
 *
 * ONE CANVAS, NOT FOUR PANELS
 * ---------------------------
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
      <FinalCta />
    </Canvas>
  )
}
