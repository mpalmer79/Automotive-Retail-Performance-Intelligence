/**
 * Field, ControlLabel, ControlHint, SelectControl and TextControl.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every colour, radius and duration on this site is measured and enforced, and
 * then the two surfaces a visitor actually touches - the inventory explorer and
 * the KPI catalogue - handed their appearance to the browser. A native select
 * draws its own chevron, its own padding and its own text metrics from the
 * operating system, so the explorers rendered in a vocabulary the rest of the
 * site does not use. That is the largest single reason those pages read as an
 * internal admin tool rather than as an instrument.
 *
 * So a select, a number input and a search field are one object here, at one
 * height, with one border, one hover and one active mark. No component may style
 * a form control directly; it composes these.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * A focus ring. `globals.css` gives every focusable element the same `outline`,
 * and a control that adds its own produces two.
 *
 * A custom listbox. The chevron below is `pointer-events-none`, so the whole box
 * stays the native hit area and the native listbox still opens - which on a phone
 * is the operating system picker, and no hand-built menu is as good.
 *
 * Documented in portfolio/docs/DESIGN_SYSTEM.md.
 */
import { ChevronDown } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

import { cx } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* The shared control box                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One definition for every control, so a select, a number input and a search
 * field are the same object at the same height.
 *
 * `radius-md` is deliberate and is one step tighter than the panels these
 * controls sit inside, so a control never reads as a card.
 */
const CONTROL_BOX = cx(
  'min-h-touch w-full min-w-0 appearance-none',
  'rounded-md border border-line bg-canvas',
  'text-ink placeholder:text-ink-faint',
  'transition-[border-color,box-shadow] duration-(--arpi-motion-fast)',
  'ease-(--arpi-ease-standard)',
  'hover:border-line-strong',
  'focus:border-accent-muted',
  'disabled:pointer-events-none disabled:opacity-(--arpi-opacity-disabled)'
)

/**
 * A control that is carrying a value.
 *
 * A filter row of four selects looks identical whether it is filtering nothing or
 * filtering three things, and a reader has to read every value to find out. A
 * marked control says so before it is read.
 *
 * Two marks rather than one - this rule, and the square beside the label - because
 * colour is never the only carrier of state on this site, and a 2px rule survives
 * 200% zoom where a small square is easy to miss.
 */
const CONTROL_ACTIVE = 'border-accent-muted shadow-[inset_2px_0_0_0_var(--color-accent)]'

/**
 * A number input's own presentation.
 *
 * `numeric` (globals.css) sets tabular figures, so a typed bound and the snapshot
 * bound stated below it align digit for digit.
 *
 * The spin buttons are removed. They offer a one-unit step on a control whose
 * range is $7,395 to $109,674, which is not a usable increment, and they take
 * 16px of the box to say so.
 */
const CONTROL_NUMBER = cx(
  'numeric font-mono',
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]'
)

/* -------------------------------------------------------------------------- */
/* ControlLabel                                                                */
/* -------------------------------------------------------------------------- */

export interface ControlLabelProps {
  /** The control this names. Ignored when `as` is `legend`. */
  htmlFor?: string
  /** True where the control it names is carrying a value. */
  active?: boolean
  /** `legend`, because the two range pairs are a fieldset rather than one input. */
  as?: 'label' | 'legend'
  children: ReactNode
  className?: string
}

/**
 * The name of a control, plus the second half of the active mark.
 *
 * TRACKING IS `wide`, NOT `eyebrow`. The site's eyebrow is 0.16em, and at four
 * labels to a row that pushes "Model year" onto a second line at 375px.
 *
 * THE STEP IS `xs`, NOT `2xs`. `2xs` is declared in tokens.css for alignment marks
 * and axis labels; uppercase monospace already costs legibility, and `xs` is the
 * size these labels already were. The change here is the face, not the scale.
 */
export function ControlLabel({
  htmlFor,
  active = false,
  as = 'label',
  children,
  className,
}: ControlLabelProps) {
  const classes = cx(
    'flex items-center gap-1.5 font-mono text-xs tracking-wide uppercase',
    active ? 'text-ink-secondary' : 'text-ink-muted',
    className
  )

  // Sized in `em` so the mark tracks the label rather than needing a scale step
  // of its own.
  const mark = (
    <span
      aria-hidden="true"
      className={cx(
        'size-[0.4em] shrink-0 rounded-xs',
        active ? 'bg-accent' : 'bg-line-strong/50'
      )}
    />
  )

  if (as === 'legend') {
    return (
      <legend className={classes}>
        {mark}
        {children}
      </legend>
    )
  }

  return (
    <label htmlFor={htmlFor} className={classes}>
      {mark}
      {children}
    </label>
  )
}

/* -------------------------------------------------------------------------- */
/* ControlHint                                                                 */
/* -------------------------------------------------------------------------- */

/** One line under a control: the range it filters inside, or a format note. */
export function ControlHint({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <p className={cx('font-mono text-2xs text-ink-faint', className)}>{children}</p>
}

/* -------------------------------------------------------------------------- */
/* SelectControl                                                               */
/* -------------------------------------------------------------------------- */

export interface SelectControlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** True where the selection is filtering something. Draws both marks. */
  active?: boolean
}

/** A native `<select>`, wearing the site's control box instead of the platform's. */
export function SelectControl({
  active = false,
  className,
  children,
  ...rest
}: SelectControlProps) {
  return (
    <span className="relative flex w-full items-center">
      <select
        className={cx(
          CONTROL_BOX,
          'py-2 pr-9 pl-3 text-sm',
          active && CONTROL_ACTIVE,
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={2}
        className={cx(
          'pointer-events-none absolute right-3 size-4',
          active ? 'text-accent' : 'text-ink-faint'
        )}
      />
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* TextControl                                                                 */
/* -------------------------------------------------------------------------- */

export interface TextControlProps extends InputHTMLAttributes<HTMLInputElement> {
  /** True where the field is carrying a value. Draws both marks. */
  active?: boolean
  /** A decorative icon inside the leading edge of the box. */
  leadingIcon?: ReactNode
  /** Content inside the trailing edge - a clear button, a unit. */
  trailing?: ReactNode
}

/**
 * An `<input>`, wearing the same box as the select.
 *
 * The type is the caller's: a search stays `type="search"` and a bound stays
 * `type="number"`, because the on-screen keyboard, the clear affordance and the
 * value parsing all follow from it.
 */
export function TextControl({
  active = false,
  leadingIcon,
  trailing,
  className,
  ...rest
}: TextControlProps) {
  return (
    <span className="relative flex w-full items-center">
      {leadingIcon ? (
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute left-3 flex shrink-0 [&>svg]:size-4',
            active ? 'text-accent' : 'text-ink-faint'
          )}
        >
          {leadingIcon}
        </span>
      ) : null}
      <input
        className={cx(
          CONTROL_BOX,
          'py-2 text-sm',
          leadingIcon ? 'pl-9' : 'pl-3',
          trailing ? 'pr-11' : 'pr-3',
          rest.type === 'number' && CONTROL_NUMBER,
          active && CONTROL_ACTIVE,
          className
        )}
        {...rest}
      />
      {trailing}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Field                                                                       */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  /** The control's id. The label points at it. */
  id: string
  label: ReactNode
  /** One line under the control. */
  hint?: ReactNode
  active?: boolean
  className?: string
  children: ReactNode
}

/**
 * A label, a control and an optional hint.
 *
 * It exists so that no caller re-decides the spacing between a label and the
 * thing it names.
 */
export function Field({
  id,
  label,
  hint,
  active = false,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <ControlLabel htmlFor={id} active={active}>
        {label}
      </ControlLabel>
      {children}
      {hint === undefined ? null : <ControlHint>{hint}</ControlHint>}
    </div>
  )
}
