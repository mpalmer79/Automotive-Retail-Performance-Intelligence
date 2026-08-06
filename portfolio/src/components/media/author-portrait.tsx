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
 * flip: {@link resolvePortraitSource} reads the file system at build time, so
 * committing the file is the whole procedure.
 *
 * ALT TEXT
 * --------
 * The alt text is authored here, once, and it names the person - it does not
 * describe the photograph. "Portrait photograph of a man in a blue shirt" tells a
 * screen-reader user nothing they wanted; the identity is the information. It
 * also does not repeat the visible name printed directly beneath it, because a
 * reader would then hear it twice.
 *
 * A server component. It reads the file system at module scope, which is
 * evaluated once at build time for these statically generated routes.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import Image from 'next/image'
import { UserRound } from 'lucide-react'

import { MediaPlaceholder } from '@/components/media/media-placeholder'
import { SITE_AUTHOR } from '@/lib/site'
import { cx } from '@/lib/utils'

/** The reserved geometry. Both the real asset and the placeholder occupy it. */
export const PORTRAIT_WIDTH = 1000
export const PORTRAIT_HEIGHT = 1250

/** The maximum the contract allows, in bytes. Asserted by the unit suite. */
export const PORTRAIT_MAX_BYTES = 180 * 1024

/**
 * The public paths that count as an approved portrait, in preference order.
 *
 * Two, not one, so a better format can be supplied without a code change. There
 * is deliberately no `.jpg` and no `.png`: this site serves modern formats for
 * every other image it has, and a portrait is not the place to make an
 * exception.
 */
export const PORTRAIT_CANDIDATES = [
  '/media/michael-palmer-portrait.avif',
  '/media/michael-palmer-portrait.webp',
] as const

/** The path documented for the person supplying the file. */
export const PORTRAIT_DOCUMENTED_PATH =
  'portfolio/public/media/michael-palmer-portrait.webp'

/**
 * Resolve the approved portrait, or `null`.
 *
 * Exported so `tests/unit/components.test.tsx` can exercise both branches
 * without a committed photograph, and so the check is one function rather than
 * an `existsSync` call repeated per caller.
 */
export function resolvePortraitSource(
  publicDir: string = join(process.cwd(), 'public')
): string | null {
  for (const candidate of PORTRAIT_CANDIDATES) {
    if (existsSync(join(publicDir, candidate))) return candidate
  }
  return null
}

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
  const source = resolvePortraitSource()

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
      className={cx(
        'aspect-4/5 w-full max-w-xs rounded-xl border border-line object-cover object-top',
        className
      )}
    />
  )
}
