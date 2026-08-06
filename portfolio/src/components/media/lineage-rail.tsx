/**
 * The lineage rail: where the rows above it came from.
 *
 * WHY A HERO NEEDS ONE
 * --------------------
 * The surface above this rail shows real vehicles with real advertised prices.
 * That is exactly the moment a careful reader asks where the data is from, and
 * exactly the moment a less careful one assumes it is a live dealer feed. The
 * rail answers before either happens, in four words-per-node, on the same screen
 * as the claim.
 *
 * IT DESCRIBES THE PATH THAT ACTUALLY PRODUCED THESE ROWS
 * ------------------------------------------------------
 * Not the warehouse lane. The listings on this page were derived at build time
 * by `scripts/generate-inventory-data.ts` reading the sanitized workbooks
 * directly, and they ship as static JSON inside the page. The same workbooks
 * also feed a separate lane that validates them against a declared contract,
 * loads them into warehouse objects and reconciles them, and that lane is the
 * subject of `/inventory-operations`. Drawing the warehouse path here would
 * claim this table came out of PostgreSQL, which it did not.
 *
 * MOTION
 * ------
 * The four nodes wake in order, once, using the shared `wake` animation. That is
 * the lineage activating, which is a real relationship rather than decoration:
 * the eye is being walked left to right along the path the data took. Nothing
 * loops, nothing pulses, and the site-wide reduced-motion rule collapses the
 * whole sequence to 1ms with every node already in its final position.
 *
 * A server component. No JavaScript.
 */
import { ChevronRight } from 'lucide-react'

import { cx } from '@/lib/utils'

interface LineageNode {
  readonly label: string
  /** The register the node is drawn in. `terminal` is the surface itself. */
  readonly tone: 'source' | 'process' | 'terminal'
}

const NODES: readonly LineageNode[] = [
  { label: 'Sanitized workbook', tone: 'source' },
  { label: 'Build-time derivation', tone: 'process' },
  { label: 'Static page data', tone: 'process' },
  { label: 'This surface', tone: 'terminal' },
]

const TONE = {
  source: 'border-line-strong bg-surface text-ink-muted',
  process: 'border-line bg-surface-sunken/80 text-ink-muted',
  terminal: 'border-accent-muted/50 bg-accent-wash text-accent',
} as const

/** One step of the wake sequence, in milliseconds. */
const STEP_MS = 90

export function LineageRail({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-line bg-surface-sunken/50 px-4 py-3 sm:px-5',
        className
      )}
    >
      <span className="mr-1 font-mono text-2xs tracking-wide text-ink-faint uppercase">
        Lineage
      </span>
      {NODES.map((node, index) => (
        <span key={node.label} className="flex items-center gap-1.5">
          {index > 0 ? (
            <ChevronRight
              aria-hidden="true"
              className="size-3 shrink-0 text-ink-faint"
              strokeWidth={2.5}
            />
          ) : null}
          <span
            className={cx(
              'animate-wake inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-2xs',
              TONE[node.tone]
            )}
            style={{ animationDelay: `${String(index * STEP_MS)}ms` }}
          >
            {node.label}
          </span>
        </span>
      ))}
    </div>
  )
}
