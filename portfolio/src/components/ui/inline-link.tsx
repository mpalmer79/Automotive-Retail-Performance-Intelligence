/**
 * A link inside a sentence.
 *
 * The site had exactly one shape for this and no component for it: a dotted
 * underline at a four-pixel offset that turns accent on hover, typed into the
 * trust line, the store story, the preview notice and a dozen dashboard captions.
 * It is written down here so a paragraph that needs a link does not have to
 * choose between copying a class string and inventing a second treatment.
 *
 * IT IS NOT A BUTTON, AND THAT IS THE WHOLE POINT. A destination named in the
 * middle of a sentence is part of the sentence: it inherits the paragraph's size,
 * colour and line height, and takes an underline rather than a surface. Where a
 * link is the reader's next action rather than an aside, the site has
 * `<LinkButton>` and, for the author's profiles, the profile badges.
 *
 * `external` adds the two attributes an outbound link must carry and the
 * screen-reader note that says what the target attribute does. No visible arrow:
 * at body size a trailing glyph inside running text breaks the line rhythm, and
 * the paragraphs that use this already sit above the badges that carry one.
 */
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

export interface InlineLinkProps {
  href: string
  children: ReactNode
  /** Opens in a new tab, with `noopener noreferrer` and an announced note. */
  external?: boolean
  className?: string
}

export function InlineLink({
  href,
  children,
  external = false,
  className,
}: InlineLinkProps) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={cx(
        'font-medium text-ink underline decoration-dotted underline-offset-4',
        'transition-colors duration-(--arpi-motion-fast) hover:text-accent',
        className
      )}
    >
      {children}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  )
}
