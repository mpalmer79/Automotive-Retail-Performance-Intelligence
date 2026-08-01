/**
 * The three candidate compositions for the floating-canvas direction.
 *
 * TEMPORARY. This file and the three routes that render it exist only for the
 * selection pass described in portfolio/docs/EXPERIENCE_REDESIGN_V2.md section
 * 8, and the losing two are deleted before the change is merged. Nothing else
 * in the application imports from here.
 *
 * All three carry EXACTLY the same content and the same truth controls. They
 * differ in composition, hierarchy and how much of the blue field stays
 * visible - which is the only thing the selection is meant to decide.
 */
import { Canvas } from '@/components/shell/field'
import { DomainJudgement } from '@/components/sections/domain-judgement'
import { EngineeringProof } from '@/components/sections/engineering-proof'
import { FinalCta } from '@/components/sections/final-cta'
import {
  Hero,
  HeroEditorial,
  HeroIdentity,
  HeroProduct,
} from '@/components/sections/hero'
import { OperatingView } from '@/components/sections/operating-view'
import { PlatformStory } from '@/components/sections/platform-story'

/* -------------------------------------------------------------------------- */
/* Layout A: Floating Intelligence Canvas                                      */
/* -------------------------------------------------------------------------- */

/**
 * One connected white canvas holding the whole page.
 *
 * The closest structural reading of the direction: the field is visible as a
 * frame around a single panel, and the six chapters separate themselves inside
 * it with spacing and ground shifts rather than by becoming six panels. The
 * closing chapter is the one deliberate break - it takes the field's own blue
 * so the page ends on the background it started against.
 */
export function LayoutA() {
  return (
    <>
      <Canvas>
        <Hero />
        <DomainJudgement />
        <OperatingView />
        <PlatformStory />
        <EngineeringProof />
        <FinalCta />
      </Canvas>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Layout B: Split Operating Gateway                                           */
/* -------------------------------------------------------------------------- */

/**
 * Two panels at the top, one wide panel below.
 *
 * The hero splits: an editorial panel carries the identity, the copy, the two
 * actions and the trust line; a second panel beside it carries the product
 * visual. They are offset vertically on a desktop so the composition reads as
 * two surfaces at different depths rather than as a two-column grid.
 *
 * On a phone they stack, editorial first, with blue field between them.
 */
export function LayoutB() {
  return (
    <>
      <div className="w-full px-canvas-inset">
        <div className="mx-auto grid w-full max-w-canvas grid-cols-1 items-start gap-canvas-inset lg:grid-cols-12">
          <div className="canvas-panel px-canvas-pad py-section-tight lg:col-span-6">
            <HeroIdentity />
            <HeroEditorial className="mt-8" />
          </div>
          {/* The offset. `lg:mt-16` is what makes this a composition rather than
              a grid: the product panel starts lower than the editorial one, so
              the eye reads a front and a back rather than two equals. */}
          <div className="canvas-panel px-canvas-pad py-section-tight lg:col-span-6 lg:mt-16">
            <HeroProduct />
          </div>
        </div>
      </div>

      <Canvas className="mt-canvas-inset">
        <DomainJudgement />
        <OperatingView />
        <PlatformStory />
        <EngineeringProof />
        <FinalCta />
      </Canvas>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Layout C: Layered Data Pavilion                                             */
/* -------------------------------------------------------------------------- */

/**
 * One central hero canvas with two smaller modules floating below it, then a
 * wide editorial body.
 *
 * The two modules are narrower than the canvas above them and sit in the blue
 * field, so the field is visible not only around the page but THROUGH it. On a
 * desktop they are pulled up so they overlap the canvas's lower edge; on a
 * phone the overlap is removed entirely rather than reduced, because a negative
 * margin at 320px is how content ends up on top of other content.
 */
export function LayoutC() {
  return (
    <>
      <Canvas>
        <Hero />
      </Canvas>

      {/* The two floating modules. `lg:-mt-16` is the overlap; it is applied
          only from `lg` up. */}
      <div className="w-full px-canvas-inset lg:-mt-16">
        <div className="mx-auto grid w-full max-w-canvas grid-cols-1 gap-canvas-inset lg:grid-cols-12">
          <div className="canvas-panel lg:col-span-7">
            <EngineeringProof />
          </div>
          <div className="canvas-panel lg:col-span-5">
            <DomainJudgement />
          </div>
        </div>
      </div>

      <Canvas className="mt-canvas-inset">
        <OperatingView />
        <PlatformStory />
        <FinalCta />
      </Canvas>
    </>
  )
}
