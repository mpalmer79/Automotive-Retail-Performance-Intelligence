/**
 * The Executive interface preview: the one image the operating front door opens with.
 *
 * WHAT IT IS, AND WHAT IT IS NOT
 * ------------------------------
 * It is a polished INTERFACE CONCEPT of the Executive console, rendered at the top of `/`
 * as the page's primary visual. It is not a capture of the running application, and the
 * figures drawn inside it are not the output of any governed selector. The live console is
 * directly beneath it and is the authority for every number on this route.
 *
 * That distinction is the only reason this file carries a caption at all. An unlabelled
 * interface rendering above a real dashboard invites a reader to treat the drawn figures as
 * results, and this project exists to argue against exactly that. One subdued line under
 * the image says what it is — `Executive interface preview. Live governed dashboard below.`
 * — and then stops. A paragraph of disclaimer would be a second mistake in the other
 * direction: it would make the honesty note compete with the thing it annotates.
 *
 * THE OTHER CAPTURE IS A DIFFERENT ASSET AND STAYS WHERE IT IS
 * ------------------------------------------------------------
 * `public/media/executive-command-center.webp` is the product tour's honest capture of the
 * running console, taken by `scripts/capture-product-media.ts`, and it is unaffected by
 * this component. The two files answer different questions: the tour shows a reader what
 * the application actually looks like, and this shows the front door its hero. Swapping
 * either for the other loses the distinction both depend on.
 *
 * WHY `next/image` WITH `unoptimized`, WHICH IS NOT A SHORTCUT
 * ------------------------------------------------------------
 * The site builds with `output: 'standalone'` and `next.config.ts` declares no image
 * loader. `sharp` is a DEV dependency, so it is not in the traced `node_modules` the
 * Railway runtime image ships — see `portfolio/docs/PERFORMANCE.md` section 7 and the same
 * decision recorded on `AuthorPortrait`. Routing this file through the optimizer would make
 * `/_next/image?url=...` the only source of the banner and would put a runtime `sharp`
 * dependency inside an image that does not have one, which on the deployed site is not a
 * slower banner but an ABSENT one. The asset is already WebP, already 1654 px wide against
 * a layout that displays it at roughly 1,250 px at its widest, and already ~200 kB. There
 * is nothing for an optimizer to do and a deployment to lose.
 *
 * What `next/image` is still doing, and it is the part that matters here: it requires the
 * intrinsic dimensions, so the box is reserved from the server-rendered markup and a
 * 200 kB image arriving at the top of the page shifts nothing beneath it. `priority` marks
 * it as the largest contentful paint candidate it genuinely is, which emits the preload
 * link and `fetchpriority="high"` rather than leaving the hero behind the rest of the
 * document.
 *
 * `sizes` IS DECLARED AND IS CURRENTLY INERT, WHICH IS WORTH SAYING OUT LOUD. Next only
 * builds a `srcset` when the optimizer is on, so under `unoptimized` the attribute selects
 * nothing. It is kept because it is a true statement of the rendered width at each
 * breakpoint, and it is the one line that would have to be correct on the day this repo
 * ever configures a loader. It is not doing work today and this comment exists so no
 * reader concludes otherwise.
 *
 * WHY A `<figure>` INSIDE A PLAIN `<Section>` AND NOT A `<Module>`
 * ----------------------------------------------------------------
 * A `Module` is the console's unit of ANSWERED QUESTION — a titled panel holding one
 * governed figure. Putting a decorative preview into one would give it a module's header,
 * a module's authority and a module's place in the grid, which is three claims this image
 * cannot support. It is a figure with a caption, which is what it is, and it uses the same
 * `figure` / `figcaption` pairing `ApplicationFrame` already uses for every other image on
 * the site.
 *
 * The `<section>` carries no accessible name on purpose. A named `<section>` becomes a
 * REGION LANDMARK, and adding one for a preview banner puts a decorative image into the
 * landmark list a screen-reader user navigates the console by. The name lives on the
 * `<figure>` instead — same words, no landmark — which is the pattern `ApplicationFrame`
 * settled on.
 *
 * THE RESPONSIVE CONTRACT, IN THREE CLASSES
 * -----------------------------------------
 * `block h-auto w-full` and nothing else. The image fills the content column at every
 * width, its height follows from its own 1654 x 951 ratio, and there is no `object-cover`,
 * no fixed pixel width and no transform anywhere in this file — so it cannot crop, cannot
 * distort, and cannot overflow a 320 px viewport. On a phone the interface detail inside
 * the picture simply gets smaller, which is the correct trade for a preview whose working
 * equivalent is rendered directly below it.
 *
 * A server component. No state, no client JavaScript, no new island.
 */
import Image from 'next/image'

import { Container, Section } from '@/components/ui/layout'
import { Text } from '@/components/ui/typography'

/**
 * The asset's public path.
 *
 * Exported rather than inlined so `tests/unit/executive-banner.test.tsx` can assert the
 * file is committed at exactly this path and carries exactly the dimensions declared
 * below. The regression that produced this component was the file existing in
 * `public/media` and being rendered by nothing.
 */
export const EXECUTIVE_BANNER_SRC = '/media/arpi-executive-dashboard-hero-desktop.webp'

/** The asset's intrinsic pixel size. Declared so the box is reserved before it loads. */
export const EXECUTIVE_BANNER_WIDTH = 1654
export const EXECUTIVE_BANNER_HEIGHT = 951

/**
 * What is on screen, for a reader who cannot see it.
 *
 * It names the regions of the interface rather than saying "screenshot of the dashboard",
 * for the same reason the tour's alt text does: the word "screenshot" describes the file
 * and tells a screen-reader user nothing about what it contains.
 */
export const EXECUTIVE_BANNER_ALT =
  'ARPI executive dashboard interface preview showing dealership KPIs, performance ' +
  'trends, sales funnel, and inventory health'

/** The credibility line. One sentence pair, and deliberately not a paragraph. */
export const EXECUTIVE_BANNER_CAPTION =
  'Executive interface preview. Live governed dashboard below.'

/**
 * The banner, on the console's own recessed ground.
 *
 * `tone="evidence"` is the same ground `Workspace` sits on, so the banner and the live
 * console beneath it read as one continuous surface rather than as a marketing panel
 * bolted above an application. The asymmetric padding is the whole of the spacing
 * decision: generous above, so the banner is clearly separated from the control band, and
 * tight below, so the caption stays attached to its image and the KPI rail follows without
 * a gap that would read as the end of the page.
 */
export function ExecutivePreviewBanner() {
  return (
    <Section rhythm="none" tone="evidence" className="pt-6 pb-1 sm:pt-8 sm:pb-2">
      <Container width="full">
        <figure
          /* The accessible name. See the file comment on why it is here and not on the
             `<section>`. */
          aria-label="ARPI Executive Dashboard preview"
          /* A test hook and nothing else. It carries no styling, and it is what lets the
             first-viewport measurements in `executive-workspace.spec.ts` locate the banner
             without matching on a filename. */
          data-executive-banner=""
          className="m-0 flex flex-col gap-2.5"
        >
          <Image
            src={EXECUTIVE_BANNER_SRC}
            alt={EXECUTIVE_BANNER_ALT}
            width={EXECUTIVE_BANNER_WIDTH}
            height={EXECUTIVE_BANNER_HEIGHT}
            /* The largest contentful paint candidate on this route, and it is at the top
               of it. */
            priority
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1200px"
            /* Deliberate. The file comment records why, and it is a deployment
               constraint rather than a preference. */
            unoptimized
            /*
             * The surface vocabulary of the redesigned console, one step lifted.
             *
             * A module is `rounded-2xl border border-line ... shadow-sm`. The banner takes
             * the same radius and the same hairline so it belongs to the same system, and
             * `shadow-md` rather than `shadow-sm` because it is the one element on the
             * route that is meant to sit above the grid rather than in it. That is the
             * whole of the "premium" treatment: no glow, no accent ring, no gradient.
             */
            className="block h-auto w-full rounded-2xl border border-line bg-surface-sunken shadow-md"
          />
          <figcaption>
            {/* Subdued on purpose. It has to be readable and it must not compete with the
                image it qualifies. */}
            <Text size="xs" tone="faint" className="max-w-prose">
              {EXECUTIVE_BANNER_CAPTION}
            </Text>
          </figcaption>
        </figure>
      </Container>
    </Section>
  )
}
