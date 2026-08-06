'use client'

/**
 * The segmented tab rail, shared by the hero's store switcher and the store
 * chapter.
 *
 * WHY IT IS EXTRACTED
 * -------------------
 * `OperatingView` already carried a hand-built tab rail: roving `tabIndex`,
 * arrow keys, `Home` and `End`, `aria-selected`, `aria-controls`, and a panel
 * that takes focus after a selection. That is roughly forty lines of behaviour
 * that has to be right, and this release adds two more tab sets to the home
 * page. Three copies of a keyboard contract is three chances to get one of them
 * wrong, and the one that is wrong is the one nobody clicks with a mouse.
 *
 * `OperatingView` keeps its own rail: it is a vertical rail with a per-domain
 * count and a selected rule, laid out inside a product frame's sidebar, and
 * generalising this component to cover it would make it a configuration surface
 * rather than a control. Two horizontal segmented rails share this; the vertical
 * one stays where it is.
 *
 * THE PATTERN IS AUTOMATIC ACTIVATION
 * -----------------------------------
 * Moving the selection with an arrow key moves focus AND selects, which is the
 * correct form of the tabs pattern when every panel is already rendered from
 * local data and there is nothing to fetch. Manual activation exists for tab
 * sets whose panels are expensive; ours are an array filter over data that
 * shipped with the page.
 *
 * STATE IS NEVER COLOUR ALONE
 * ---------------------------
 * A selected segment carries a filled surface, a weight change, an underline
 * rule and `aria-selected`. Remove all colour and it still reads.
 */
import { useCallback, useRef, type KeyboardEvent } from 'react'

import { cx } from '@/lib/utils'

export interface TabItem {
  readonly id: string
  readonly label: string
  /** Optional trailing figure, such as a listing count. */
  readonly badge?: string
}

export interface SegmentedTabsProps {
  items: readonly TabItem[]
  selected: string
  onSelect: (id: string) => void
  /** The accessible name of the rail. */
  label: string
  /** `id` of the panel the rail controls, and the prefix for each tab's id. */
  baseId: string
  className?: string
}

export function SegmentedTabs({
  items,
  selected,
  onSelect,
  label,
  baseId,
  className,
}: SegmentedTabsProps) {
  const railRef = useRef<HTMLDivElement | null>(null)

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
      if (!keys.includes(event.key)) return
      event.preventDefault()

      const current = items.findIndex((item) => item.id === selected)
      const last = items.length - 1
      let next = current

      if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
        next = current === last ? 0 : current + 1
      else next = current === 0 ? last : current - 1

      const target = items[next]
      if (!target) return
      onSelect(target.id)
      railRef.current
        ?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)
        ?.focus()
    },
    [items, onSelect, selected]
  )

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        'flex flex-wrap gap-1 rounded-lg border border-line bg-surface-sunken/70 p-1',
        className
      )}
    >
      {items.map((item) => {
        const isSelected = item.id === selected
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab={item.id}
            id={`${baseId}-tab-${item.id}`}
            aria-selected={isSelected}
            aria-controls={`${baseId}-panel`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => {
              onSelect(item.id)
            }}
            className={cx(
              'relative inline-flex min-h-9 grow items-center justify-center gap-2 rounded-md px-3 text-sm',
              'transition-colors duration-(--arpi-motion-fast) ease-(--arpi-ease-standard)',
              'sm:grow-0',
              isSelected
                ? 'bg-canvas font-semibold text-ink shadow-sm'
                : 'font-medium text-ink-muted hover:bg-canvas/60 hover:text-ink-secondary'
            )}
          >
            {/* The second, non-colour carrier of the selected state. */}
            <span
              aria-hidden="true"
              className={cx(
                'absolute inset-x-3 bottom-1 h-0.5 rounded-pill',
                isSelected ? 'bg-accent' : 'bg-transparent'
              )}
            />
            {item.label}
            {item.badge !== undefined ? (
              <span
                className={cx(
                  'numeric font-mono text-2xs',
                  isSelected ? 'text-accent' : 'text-ink-faint'
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
