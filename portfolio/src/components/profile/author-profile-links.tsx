/**
 * The author's professional profile links. One component, five placements.
 *
 * WHAT THIS OWNS
 * --------------
 * The brand marks, the labels, the destinations, the surface treatment, the focus
 * behaviour and the external-link semantics for Michael Palmer's GitHub profile
 * and LinkedIn profile. The Executive header, the About hero, the site masthead,
 * the mobile drawer and the footer all render THIS, so there is one LinkedIn
 * button on the site rather than five that drifted apart.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 * ---------------------------------
 * The ARPI repository. `Source repository` is a different destination answering a
 * different question - the source code for this project, rather than the person
 * who wrote it - and it keeps its own control in the footer, on the About page's
 * identity card and on the operating rail. This component pointing at the
 * repository is exactly the conflation the increment removed: a badge labelled
 * "GitHub" that landed a reader back on the project they were already reading.
 *
 * THE TWO VARIANTS
 * ----------------
 *   badges    the labelled pair. Executive header, About hero, mobile drawer,
 *             footer. Full width and stacked on a phone, a row from `sm` up.
 *   compact   icon-only squares for the desktop masthead, where a labelled pair
 *             would take more width than the primary navigation it sits beside.
 *             Same marks, same surfaces, same external-link semantics; the label
 *             moves into the accessible name and the tooltip rather than being
 *             dropped, so the control is never a bare glyph to a screen reader.
 *
 * Variants may change layout and density. They may not change identity: both
 * read from one {@link AUTHOR_PROFILE_LINKS} table, so a destination or a label
 * cannot be corrected in one place and left wrong in the other four.
 *
 * NO NEW DEPENDENCY. Both marks are inline SVG paths drawn from each brand's own
 * published geometry, which is what the previous Executive-only implementation
 * already carried; a social-icon package would ship several hundred marks to use
 * two of them. A generic Lucide glyph is not a substitute - `Github` exists in
 * the icon set and `Linkedin` does not, so a pair built from it would be
 * asymmetric on the one axis a brand mark has to be exact.
 */
import { ArrowUpRight } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { AUTHOR_GITHUB_URL, AUTHOR_LINKEDIN_URL, SITE_AUTHOR } from '@/lib/site'
import { cx } from '@/lib/utils'

type BrandIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface AuthorProfileLink {
  readonly key: 'github' | 'linkedin'
  readonly href: string
  /** The visible label on the badge variant. */
  readonly label: string
  /**
   * The accessible name, which names the PERSON as well as the service.
   *
   * "GitHub Portfolio" is unambiguous next to a headline that says Michael
   * Palmer; the same two words alone in a masthead are not, and the compact
   * variant has no headline beside it. Both variants therefore announce
   * "Michael Palmer on GitHub", so a screen-reader user reading a link list gets
   * the same answer the sighted reader gets from the position.
   */
  readonly accessibleName: string
  readonly icon: BrandIcon
  /**
   * The mark's own brand colour, applied to the glyph rather than to the text.
   *
   * Colour is never the only differentiator: each control also carries its own
   * mark, its own label or accessible name, and a border and surface that differ
   * in value as well as in hue, so the pair is still two distinct controls in
   * greyscale.
   */
  readonly iconColor: string
  readonly surfaceClassName: string
}

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 .7C5.7.7.7 5.8.7 12.1c0 5 3.2 9.3 7.7 10.8.6.1.8-.2.8-.5v-2.2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.6 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.3-5.1 5.6.4.3.8 1 .8 2v3.1c0 .3.2.6.8.5a11.4 11.4 0 0 0 7.7-10.8C23.3 5.8 18.3.7 12 .7Z" />
    </svg>
  )
}

function LinkedInMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.41a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.04H3.54V8.98H7.1v11.47ZM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0Z" />
    </svg>
  )
}

/**
 * The pair, in order: the work first, the background behind it second.
 *
 * GitHub leads because this is an engineering portfolio and the code is the
 * claim; LinkedIn follows because it is the context for the claim rather than
 * the evidence for it.
 */
export const AUTHOR_PROFILE_LINKS: readonly AuthorProfileLink[] = [
  {
    key: 'github',
    href: AUTHOR_GITHUB_URL,
    label: 'GitHub Portfolio',
    accessibleName: `${SITE_AUTHOR} on GitHub`,
    icon: GitHubMark,
    iconColor: '#24292f',
    surfaceClassName: cx(
      'border-[#d0d7de] bg-[#ffffff]',
      'shadow-[0_1px_3px_rgba(15,23,42,0.10)]',
      'hover:border-[#afb8c1] hover:bg-[#f6f8fa]',
      'hover:shadow-[0_3px_8px_rgba(15,23,42,0.14)]'
    ),
  },
  {
    key: 'linkedin',
    href: AUTHOR_LINKEDIN_URL,
    label: 'LinkedIn Profile',
    accessibleName: `${SITE_AUTHOR} on LinkedIn`,
    icon: LinkedInMark,
    iconColor: '#0A66C2',
    surfaceClassName: cx(
      'border-[#b7d5f2] bg-[#f5faff]',
      'shadow-[0_1px_3px_rgba(10,102,194,0.10)]',
      'hover:border-[#79b5e8] hover:bg-[#edf6ff]',
      'hover:shadow-[0_3px_8px_rgba(10,102,194,0.14)]'
    ),
  },
]

export type AuthorProfileVariant = 'badges' | 'compact'

const BADGE_BASE = cx(
  'group inline-flex min-h-touch w-full items-center justify-start gap-2 rounded-lg px-4',
  'border text-sm font-medium text-ink',
  'sm:min-h-9 sm:w-auto sm:justify-center sm:px-3',
  'transition-[background-color,border-color,box-shadow,transform]',
  'duration-(--arpi-motion-fast) ease-(--arpi-ease-standard)',
  'hover:-translate-y-px active:translate-y-px'
)

/*
 * The compact control is a 44px square, not a 32px one.
 *
 * It sits in a 64px masthead beside a hamburger of the same size, and it is the
 * narrowest width in the responsive sweep - 320px - that decides the question:
 * the wordmark, two of these and the menu button have to fit inside a 280px
 * content column, and they do, with room. Shrinking below the WCAG 2.2 target
 * floor to buy space that is not needed would be a trade against nothing.
 */
const COMPACT_BASE = cx(
  'group inline-flex size-touch shrink-0 items-center justify-center rounded-lg',
  'border',
  'transition-[background-color,border-color,box-shadow,transform]',
  'duration-(--arpi-motion-fast) ease-(--arpi-ease-standard)',
  'hover:-translate-y-px active:translate-y-px'
)

export interface AuthorProfileLinksProps {
  variant?: AuthorProfileVariant
  className?: string
}

export function AuthorProfileLinks({
  variant = 'badges',
  className,
}: AuthorProfileLinksProps) {
  const compact = variant === 'compact'

  return (
    <div
      data-profile-links
      data-profile-variant={variant}
      className={cx(
        compact
          ? 'flex items-center gap-1.5'
          : 'flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center',
        className
      )}
    >
      {AUTHOR_PROFILE_LINKS.map(
        ({
          key,
          href,
          label,
          accessibleName,
          icon: Icon,
          iconColor,
          surfaceClassName,
        }) => (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            /* A tooltip only where the label is not on screen. On the badge the
               visible text already says it, and a title duplicating it produces a
               hover card restating what the reader is looking at. */
            title={compact ? accessibleName : undefined}
            className={cx(compact ? COMPACT_BASE : BADGE_BASE, surfaceClassName)}
          >
            <Icon
              aria-hidden="true"
              className="size-[18px] shrink-0"
              style={{ color: iconColor }}
            />

            {compact ? null : <span>{label}</span>}

            {compact ? null : (
              <ArrowUpRight
                aria-hidden="true"
                className={cx(
                  'ml-auto size-3.5 shrink-0 text-ink-faint',
                  'transition-colors duration-(--arpi-motion-fast)',
                  'group-hover:text-ink-secondary sm:ml-0'
                )}
                strokeWidth={2}
              />
            )}

            {/* The compact control has no visible label, so the accessible name is
                the whole of its meaning and names the person as well as the
                service. The badge already reads its label from the visible text
                and only adds the destination behaviour. */}
            <span className="sr-only">
              {compact
                ? `${accessibleName} (opens in a new tab)`
                : '(opens in a new tab)'}
            </span>
          </a>
        )
      )}
    </div>
  )
}
