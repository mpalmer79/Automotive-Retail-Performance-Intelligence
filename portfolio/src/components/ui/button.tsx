/**
 * Button, LinkButton and IconButton.
 *
 * One visual definition shared by three call sites, because a `<button>` styled
 * like a link and an `<a>` styled like a button are the two most common sources
 * of keyboard and screen-reader defects in a design system. Here the element is
 * chosen by what the control *does* - navigate or act - and the styling is
 * chosen separately.
 *
 * Every variant meets the 44px target-size floor at the `md` size and above.
 * `sm` is 36px and is used only for controls in a dense toolbar where a 44px
 * row would break the layout; those controls always sit inside a container with
 * at least 44px of vertical rhythm around them, which is what WCAG 2.2's
 * "Target Size (Minimum)" spacing exception allows.
 */
import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Shared visual definition                                                    */
/* -------------------------------------------------------------------------- */

const VARIANT = {
  /** The one primary action per view. Cyan on obsidian, high contrast. */
  primary: cx(
    'bg-accent text-ink-inverse font-semibold',
    'hover:bg-accent-strong',
    'active:bg-accent-strong/90'
  ),
  /** The paired secondary action. Bordered, transparent ground. */
  secondary: cx(
    'border border-line-strong bg-surface/60 text-ink font-medium',
    'hover:border-accent-muted hover:bg-surface-hover hover:text-ink',
    'active:bg-surface'
  ),
  /** A tertiary action in a dense context. No border until hover. */
  ghost: cx(
    'border border-transparent text-ink-secondary font-medium',
    'hover:border-line hover:bg-surface/70 hover:text-ink'
  ),
  /** A filter chip or a toggle in its unselected state. */
  chip: cx(
    'arpi-chip border border-line bg-surface-sunken/70 text-ink-muted font-medium',
    'hover:border-line-strong hover:text-ink-secondary'
  ),
  /** A filter chip or a toggle in its selected state. */
  chipActive: cx(
    'arpi-chip border border-accent-muted bg-accent-wash text-accent font-semibold'
  ),
} as const

const SIZE = {
  sm: 'min-h-9 px-3 text-sm gap-1.5 rounded-md',
  md: 'min-h-touch px-4 text-base gap-2 rounded-lg',
  lg: 'min-h-11 px-5 text-base gap-2 rounded-lg sm:px-6',
} as const

const BASE = cx(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap',
  // A chip may carry a long value (a history policy, a schema-qualified view),
  // so the chip variants opt out of nowrap and are allowed to shrink. Without
  // this a 44-character label sets the page's minimum width at 320px.
  '[&.arpi-chip]:max-w-full [&.arpi-chip]:shrink [&.arpi-chip]:whitespace-normal',
  'transition-[background-color,border-color,color,transform] duration-(--arpi-motion-fast)',
  'ease-(--arpi-ease-standard)',
  // A 1px lift on press. Small enough to feel mechanical rather than bouncy,
  // and neutralised by the reduced-motion block in globals.css.
  'active:translate-y-px',
  'disabled:pointer-events-none disabled:opacity-(--arpi-opacity-disabled)',
  'aria-disabled:pointer-events-none aria-disabled:opacity-(--arpi-opacity-disabled)'
)

export type ButtonVariant = keyof typeof VARIANT
export type ButtonSize = keyof typeof SIZE

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string
): string {
  return cx(BASE, VARIANT[variant], SIZE[size], className)
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  /** Renders a spinner and marks the control busy. */
  loading?: boolean
  /** Icon rendered before the label. Hidden from assistive technology. */
  iconBefore?: ReactNode
  /** Icon rendered after the label. Hidden from assistive technology. */
  iconAfter?: ReactNode
}

/** An action. Use this when the control changes state rather than navigating. */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  iconBefore,
  iconAfter,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled ?? loading}
      // `aria-busy` rather than swapping the label, so a screen-reader user is
      // not left listening to a control whose name changed under them.
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : iconBefore ? <Slot>{iconBefore}</Slot> : null}
      {children}
      {iconAfter ? <Slot>{iconAfter}</Slot> : null}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* LinkButton                                                                  */
/* -------------------------------------------------------------------------- */

export interface LinkButtonProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  children: ReactNode
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  iconBefore?: ReactNode
  iconAfter?: ReactNode
  /** Set for a link that leaves the site. Adds rel and an accessible hint. */
  external?: boolean
}

/**
 * A navigation control that looks like a button.
 *
 * An external link is marked as such in the accessible name rather than only
 * with an icon, because an icon-only indication is invisible to a screen-reader
 * user and to anyone who has not learned the convention.
 */
export function LinkButton({
  children,
  href,
  variant = 'secondary',
  size = 'md',
  iconBefore,
  iconAfter,
  external = false,
  className,
  ...rest
}: LinkButtonProps) {
  const classes = buttonClass(variant, size, className)

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        {...rest}
      >
        {iconBefore ? <Slot>{iconBefore}</Slot> : null}
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
        {iconAfter ? <Slot>{iconAfter}</Slot> : null}
      </a>
    )
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {iconBefore ? <Slot>{iconBefore}</Slot> : null}
      {children}
      {iconAfter ? <Slot>{iconAfter}</Slot> : null}
    </Link>
  )
}

/* -------------------------------------------------------------------------- */
/* IconButton                                                                  */
/* -------------------------------------------------------------------------- */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The icon. Always decorative; the name comes from `label`. */
  children: ReactNode
  /**
   * The accessible name. Required, and not optional-with-a-fallback: an
   * icon-only control with no name is unusable, and making the prop mandatory is
   * the only reliable way to prevent it.
   */
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
}

/** An icon-only action. Always 44px, because there is no label to enlarge it. */
export function IconButton({
  children,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        buttonClass(variant, size, className),
        'aspect-square px-0',
        size === 'md' && 'w-touch',
        size === 'sm' && 'w-9',
        size === 'lg' && 'w-11'
      )}
      {...rest}
    >
      <Slot>{children}</Slot>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** Wraps an icon so it is sized consistently and hidden from the a11y tree. */
function Slot({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
      {children}
    </span>
  )
}

/**
 * The loading indicator. A two-second rotation rather than the usual
 * three-quarter-second one: a spinner that whirls reads as anxious, and this is
 * a document, not a checkout. Reduced motion stops it entirely (globals.css),
 * leaving a static ring, and `aria-busy` on the button carries the state either
 * way.
 */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent [animation-duration:2s]"
    />
  )
}
