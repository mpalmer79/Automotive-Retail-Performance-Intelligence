/**
 * The author portrait, and the contract for supplying it.
 *
 * WHY THIS COMPONENT EXISTS RATHER THAN AN `<Image>` IN TWO PLACES
 * ---------------------------------------------------------------
 * There is no approved photograph of Michael Palmer in this repository, and this
 * project will not put a stock image of a stranger on the one page whose subject
 * is a real person. That is a content rule, and content rules that live in a
 * reviewer's head get broken by the next person in a hurry - so it lives here,
 * as the only path by which a portrait can reach this site.
 *
 * The component renders the approved file if it is present and the designed
 * placeholder if it is not. Both occupy the identical box, so dropping the file
 * in changes pixels and moves nothing: no layout shift, no reflow of the chapter
 * around it, and no build failure in the meantime. Two callers - the home page's
 * builder chapter and `/about` - share it, so the two cannot disagree about the
 * crop, the sizes attribute or the alt text.
 *
 * HOW MICHAEL ADDS THE PHOTOGRAPH
 * -------------------------------
 * Commit one file at exactly this path:
 *
 *     portfolio/public/media/michael-palmer-portrait.webp
 *
 *   Aspect ratio   4:5 portrait. Not 1:1 and not 3:4 - the chapter reserves 4:5
 *                  and a different ratio either letterboxes or crops a face.
 *   Dimensions     1000 x 1250 exactly. That is twice the ~500px the widest
 *                  layout displays it at, which is what a high-density display
 *                  needs and the point past which the bytes buy nothing.
 *   Format         WebP, quality around 82. AVIF is accepted at the same path
 *                  with a `.avif` extension if the encoder is available; see
 *                  {@link PORTRAIT_CANDIDATES}.
 *   Maximum size   180 kB. Above that it competes with the product captures for
 *                  the connection on a page it is not the argument of.
 *   Crop           Head and shoulders. Eyes on the upper third, roughly 12% of
 *                  the frame height as headroom, shoulders meeting the bottom
 *                  edge. Vertical centring is the default focal behaviour, so a
 *                  face placed on the upper third stays on the upper third at
 *                  every width - the component does not reposition it.
 *   Background     Plain, or quiet enough that a 300px render is not busy. No
 *                  dealership signage, no vehicle, no logo, and no other person.
 *
 * Nothing else changes. There is no code edit, no import to add and no flag to
 * flip: `next.config.ts` looks for the file at build time and inlines the
 * answer, so committing the file is the whole procedure.
 *
 * ALT TEXT
 * --------
 * The alt text is authored here, once, and it names the person - it does not
 * describe the photograph. "Portrait photograph of a man in a blue shirt" tells a
 * screen-reader user nothing they wanted; the identity is the information. It
 * also does not repeat the visible name printed directly beneath it, because a
 * reader would then hear it twice.
 *
 * WHY IT DOES NOT ASK THE FILE SYSTEM ITSELF
 * ------------------------------------------
 * It used to, and that was a real defect rather than a style point. A server
 * component calling `existsSync` on a path built from `process.cwd()` gives
 * Next's output tracer nothing it can resolve, and the tracer fails safe by
 * copying the whole working directory into `.next/standalone` - which took the
 * standalone output from three entries to the entire `portfolio/` tree and made
 * the Railway image job fail with "/app/tests is present in the runtime image".
 *
 * The check now happens once in `next.config.ts`, which runs outside the traced
 * graph, and arrives here as an inlined string. See `lib/portrait.ts`.
 *
 * A server component. No state, no motion, no file system.
 */
import Image from 'next/image'
import { UserRound } from 'lucide-react'

import { MediaPlaceholder } from '@/components/media/media-placeholder'
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, portraitSourceFrom } from '@/lib/portrait'
import { SITE_AUTHOR } from '@/lib/site'
import { cx } from '@/lib/utils'

export interface AuthorPortraitProps {
  /**
   * `true` on the one instance that is the largest image in its viewport at
   * load. Never on both callers at once: `/about` leads with the portrait, the
   * home page's builder chapter is six sections down and lazy-loads it.
   */
  readonly priority?: boolean
  /**
   * The rendered CSS width at each breakpoint. Defaults to the builder
   * chapter's column, which is the narrower of the two placements.
   */
  readonly sizes?: string
  readonly className?: string
}

export function AuthorPortrait({
  priority = false,
  sizes = '(min-width: 1024px) 20rem, (min-width: 640px) 20rem, 100vw',
  className,
}: AuthorPortraitProps) {
  /*
   * WRITTEN OUT IN FULL, AND IT HAS TO BE.
   *
   * Next's `env` option is a TEXTUAL substitution on `process.env.NAME`. A
   * computed lookup - `process.env[PORTRAIT_ENV_VARIABLE]`, which reads better -
   * is not a form it recognises, so nothing is inlined, the value is `undefined`
   * at render time, and the page silently keeps showing the placeholder after
   * the photograph has been committed. That is the failure this exact line was
   * caught making, and it is silent in both directions: the build succeeds and
   * the only symptom is a portrait that never appears.
   *
   * `tests/unit/components.test.tsx` asserts the constant and this literal
   * agree, so the two cannot drift.
   */
  const source = portraitSourceFrom(process.env.ARPI_PORTRAIT_SOURCE)

  if (source === null) {
    return (
      <MediaPlaceholder
        label="Portrait pending"
        detail="No approved photograph is committed to this repository, and this site does not use a stock image of a person on a page that names one."
        mark={<UserRound strokeWidth={1.75} />}
        className={cx('max-w-xs', className)}
      />
    )
  }

  return (
    <Image
      src={source}
      // The person, not the photograph. See the note above.
      alt={SITE_AUTHOR}
      width={PORTRAIT_WIDTH}
      height={PORTRAIT_HEIGHT}
      sizes={sizes}
      priority={priority}
      // `priority` already implies eager; stating the opposite explicitly keeps
      // the below-the-fold case from depending on a default.
      loading={priority ? undefined : 'lazy'}
      /*
       * UNOPTIMIZED, DELIBERATELY, AND IT IS NOT A SHORTCUT.
       *
       * This site builds with `output: 'standalone'` and declares no image
       * loader - see portfolio/docs/PERFORMANCE.md section 7. Turning the
       * optimizer on for one file would put a runtime `sharp` dependency inside
       * the Railway standalone image, which is a deployment cost, in exchange
       * for resizing an asset that the contract already requires to be supplied
       * at exactly the size it is displayed at and already encoded as WebP or
       * AVIF. There is nothing for the optimizer to do.
       *
       * What `next/image` is still doing here is the part that matters: it
       * requires the intrinsic dimensions, so the box is reserved from the
       * server-rendered markup and the photograph's arrival shifts nothing.
       */
      unoptimized
      className={cx(
        'aspect-4/5 w-full max-w-xs rounded-xl border border-line object-cover object-top',
        className
      )}
    />
  )
}
