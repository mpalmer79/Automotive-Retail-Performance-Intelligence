/**
 * The two portfolio profile links that sit in the Executive header's action area.
 *
 * WHAT THESE ARE, AND WHAT THEY ARE NOT
 * -------------------------------------
 * They are secondary navigation to the source repository and to the author's
 * professional profile: the two things a reviewer who arrives at `/` and likes what
 * they see will look for next. They are not part of the console. Nothing here reads a
 * selector, a filter, a KPI or an export; the component takes no props and renders two
 * anchors.
 *
 * WHY THEY LIVE IN A COMPONENT OF THEIR OWN RATHER THAN IN THE SHARED HEADER
 * -------------------------------------------------------------------------
 * `OperatingPageHeader` is one component across nine operating routes. A pair of links
 * to one person's GitHub and LinkedIn hard-coded inside it would appear on the
 * inventory route, the deal jacket and the accounting reconciliation, which is eight
 * places a reviewer did not ask for them. The header exposes an optional
 * `headerActions` slot instead, and `/` is the only route that fills it — asserted by
 * `tests/unit/executive-profile-links.test.tsx`, in both directions.
 *
 * WHY NOT A BRAND GLYPH
 * ---------------------
 * `lucide-react` is the site's only icon package (see `ui/domain-icon.tsx`) and it
 * carries no GitHub or LinkedIn mark. The alternatives were a second dependency for two
 * glyphs, or hand-copied trademark artwork; both cost more than they are worth on a
 * secondary control. `FolderGit2` is already how this site draws "the repository" in the
 * site header and the operating rail, so the GitHub badge is consistent with the two
 * places that link already exists, and each badge carries a text label that says which
 * destination it is. Nothing here depends on an icon being recognised.
 */
import { ArrowUpRight, FolderGit2, IdCard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AUTHOR_PROFILE_URL, REPOSITORY_URL } from '@/lib/site'
import { cx } from '@/lib/utils'

export interface ProfileLink {
  readonly href: string
  /**
   * The visible label, and the first half of the accessible name.
   *
   * A NOUN PHRASE NAMING THE DESTINATION. "GitHub Repository", not "GitHub" and not an
   * icon on its own: an icon-only control is invisible to a screen-reader user and
   * ambiguous to everyone who has not learned the convention.
   */
  readonly label: string
  readonly icon: LucideIcon
}

/**
 * The links, exported so a test asserts the rendered anchors against this list rather
 * than against a URL typed a second time in the test file.
 */
export const EXECUTIVE_PROFILE_LINKS: readonly ProfileLink[] = [
  { href: REPOSITORY_URL, label: 'GitHub Repository', icon: FolderGit2 },
  { href: AUTHOR_PROFILE_URL, label: 'LinkedIn Profile', icon: IdCard },
]

/**
 * The badge's own class list, rather than `buttonClass('secondary', 'sm')`.
 *
 * The tokens are the `secondary` variant's tokens, deliberately: the same border, the
 * same ground, the same hover and the same transition, so this reads as an ARPI control
 * and not as a pasted-on social button. What it does NOT reuse is the size scale, and
 * the reason is the target-size rule. `sm` is 36 px, which is right in the desktop
 * band beside a 36 px disclosure pill and below the 44 px floor on a phone, where these
 * are full-width stacked controls with nothing beside them to lend the WCAG 2.2 spacing
 * exception. So the height is 44 px up to `sm` and 36 px above it, expressed as one
 * responsive pair here. Composing that out of `buttonClass` would mean two `min-h`
 * utilities in one class attribute with the winner decided by stylesheet order, which
 * is not a thing worth being clever about.
 */
const BADGE = cx(
  'group inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-lg px-3',
  'text-sm font-medium sm:min-h-9 sm:w-auto',
  'border border-line-strong bg-surface/60 text-ink-secondary',
  'transition-[background-color,border-color,color] duration-(--arpi-motion-fast)',
  'ease-(--arpi-ease-standard)',
  'hover:border-accent-muted hover:bg-surface-hover hover:text-ink',
  // The same 1px mechanical press the button primitive uses, neutralised by the
  // reduced-motion block in globals.css.
  'active:translate-y-px'
)

/**
 * A pair of profile links, laid out for the header's upper-right action area.
 *
 * THE THREE GEOMETRIES, AND WHY THEY ARE THREE
 * --------------------------------------------
 *   phone   full-width, stacked, one above the other. Two 44 px rows a thumb can hit,
 *           after the scope line and the synthetic-data disclosure and before the
 *           filter stack — which is the reading order the console needs and also the
 *           order the DOM is in, so nothing is re-ordered visually.
 *   tablet   a row from `sm` up, allowed to wrap under the disclosure when the title,
 *           the scope and the pill have taken the width. Wrapping is the intended
 *           behaviour here, not a fallback.
 *   desktop  a row in the band's upper right, on the same line as the title.
 *
 * `justify-center` inside a `w-auto` row is not redundant: it centres the icon, the
 * label and the indicator against each other so the two badges read as a matched pair
 * even though "GitHub Repository" is the wider of the two labels.
 */
export function ExecutiveProfileLinks() {
  return (
    <div
      data-profile-links
      className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center"
    >
      {EXECUTIVE_PROFILE_LINKS.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          // `noopener` is the one that matters and `noreferrer` is deliberate rather
          // than habitual: neither destination needs to know which page sent the
          // visitor.
          rel="noopener noreferrer"
          className={BADGE}
        >
          <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
          {label}
          {/* The external indicator is decorative. The accessible name carries the
              same fact in words directly below, because an arrow glyph is not a
              statement a screen reader can make. */}
          <ArrowUpRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-ink-faint transition-colors duration-(--arpi-motion-fast) group-hover:text-accent"
            strokeWidth={2}
          />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </div>
  )
}
