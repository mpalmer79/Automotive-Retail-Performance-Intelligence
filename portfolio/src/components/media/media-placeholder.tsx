/**
 * A designed placeholder for media that does not exist yet.
 *
 * WHY THIS IS A COMPONENT RATHER THAN A GREY BOX
 * ----------------------------------------------
 * One slot on this site is genuinely waiting on a file: the author portrait in
 * the builder chapter. There is no approved headshot in the repository, and this
 * project does not put a stock photograph of a stranger on a page that names a
 * real person.
 *
 * The two usual answers are both wrong. Leaving the slot empty makes the chapter
 * lopsided and reads as unfinished; filling it with a stock image is a small lie
 * on the one section whose subject is a real human being. So the slot renders a
 * composition drawn from the site's own tokens, states in words what belongs
 * there, and occupies the exact geometry the real file will - which is the
 * property that matters: dropping the file in later changes the pixels and moves
 * nothing.
 *
 * A server component. No state, no motion.
 */
import type { ReactNode } from 'react'

import { cx } from '@/lib/utils'

export interface MediaPlaceholderProps {
  /** What belongs here, in words. Rendered, not only in a comment. */
  label: string
  /** One line on how it arrives. Rendered under the label. */
  detail?: string
  /**
   * The aspect ratio the real asset will have, as a Tailwind aspect utility.
   * Defaults to 4/5, the portrait ratio the builder chapter reserves.
   */
  ratio?: string
  /** An icon or mark, centred above the label. Decorative. */
  mark?: ReactNode
  className?: string
}

export function MediaPlaceholder({
  label,
  detail,
  ratio = 'aspect-4/5',
  mark,
  className,
}: MediaPlaceholderProps) {
  return (
    <div
      className={cx(
        'relative flex flex-col items-center justify-center gap-3 overflow-hidden',
        'rounded-xl border border-dashed border-line-strong bg-surface-sunken/70 p-6 text-center',
        ratio,
        className
      )}
    >
      {/* The dimensional grid, at the weight the rest of the site uses it. */}
      <div
        aria-hidden="true"
        className="grid-motif pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_70%_at_50%_35%,black,transparent)]"
      />
      {mark ? (
        <span
          aria-hidden="true"
          className="relative inline-flex size-10 items-center justify-center rounded-lg border border-line bg-canvas text-ink-faint [&>svg]:size-5"
        >
          {mark}
        </span>
      ) : null}
      <p className="relative font-mono text-2xs tracking-wide text-ink-muted uppercase">
        {label}
      </p>
      {detail ? (
        <p className="relative max-w-[24ch] text-xs leading-normal text-ink-faint">
          {detail}
        </p>
      ) : null}
    </div>
  )
}
