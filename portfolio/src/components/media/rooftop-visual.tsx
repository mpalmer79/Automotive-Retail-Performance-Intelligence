/**
 * The three rooftops, drawn.
 *
 * WHY DRAWN AND NOT PHOTOGRAPHED
 * ------------------------------
 * Granite Auto Group does not exist. Its three stores do not exist. A
 * photograph in this slot would be either a real dealership presented as a
 * fictional one, or a stock image of a building nobody can point at - and both
 * are the same failure in different clothes: a picture asserting a place that is
 * not there.
 *
 * These are compositions instead. Every one is built from the site's own design
 * tokens, at the same geometric register as the field motif and the signature
 * visual, and every one is captioned as a fictional visualisation at the point
 * of use. A reader can tell in a glance that they are looking at a diagram of a
 * business model rather than at a lot.
 *
 * WHAT EACH ONE ACTUALLY DEPICTS
 * ------------------------------
 * The composition is the operating model, not decoration. That is the whole
 * reason there are three of them rather than one recoloured three times:
 *
 *   chevrolet  A wide showroom with a delivery canopy and a deep, regular lot
 *              grid. Uniform rows, because a volume franchise receives much of
 *              what it holds on allocation and the mix arrives sorted.
 *   subaru     A smaller showroom with a service wing, and a shallower lot in
 *              two conditions. The all-weather franchise carries a materially
 *              larger pre-owned share beside a narrow new line.
 *   preowned   No showroom and no canopy. A merchandising row under light
 *              standards, every silhouette a different size, because every unit
 *              on it was bought rather than shipped.
 *
 * ACCESSIBILITY
 * -------------
 * The SVG is `aria-hidden`. It carries no information that is not already in the
 * panel beside it - store type, strategy and the derived figures are all text -
 * so an equivalent description would be a second reading of the same content.
 *
 * A server component with no motion. The composition is static: it sits inside a
 * tab panel that a reader switches deliberately, and an animation that replays
 * on every tab change is a distraction rather than a signal.
 */
import type { DealershipAccent } from '@/types/inventory'
import { cx } from '@/lib/utils'

/** The accent hue each store's composition is drawn in. */
const HUE: Record<DealershipAccent, string> = {
  chevrolet: 'var(--color-accent-mark)',
  subaru: 'var(--color-verified)',
  preowned: 'var(--color-model)',
}

const VIEW = { width: 420, height: 240 } as const
const GROUND_Y = 196

export interface RooftopVisualProps {
  accent: DealershipAccent
  className?: string
}

export function RooftopVisual({ accent, className }: RooftopVisualProps) {
  const hue = HUE[accent]
  return (
    <svg
      viewBox={`0 0 ${String(VIEW.width)} ${String(VIEW.height)}`}
      aria-hidden="true"
      focusable="false"
      className={cx('block h-auto w-full', className)}
    >
      <Ground accent={accent} />

      {accent === 'chevrolet' ? <VolumeFranchise hue={hue} /> : null}
      {accent === 'subaru' ? <AllWeatherFranchise hue={hue} /> : null}
      {accent === 'preowned' ? <IndependentLot hue={hue} /> : null}

      {/* The horizon. Drawn last so nothing sits on top of it. */}
      <path
        d={`M0 ${String(GROUND_Y)} H${String(VIEW.width)}`}
        stroke="var(--color-line-strong)"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* The three compositions                                                      */
/* -------------------------------------------------------------------------- */

function VolumeFranchise({ hue }: { hue: string }) {
  return (
    <>
      {/* The showroom: a glass curtain wall under a flat roof. */}
      <rect
        x="26"
        y="74"
        width="168"
        height="122"
        rx="4"
        fill="var(--color-surface-raised)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.4"
      />
      <path
        d="M20 74 H200"
        stroke={hue}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <Mullions x={26} y={82} width={168} height={114} count={7} />

      {/* The delivery canopy: the thing a volume store actually builds. */}
      <path
        d="M200 106 H286 V114 H200 Z"
        fill="var(--color-surface)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.2"
      />
      <path
        d={`M282 114 V${String(GROUND_Y)}`}
        stroke="var(--color-line-strong)"
        strokeWidth="1.4"
      />

      {/* The pylon. No wordmark, no manufacturer mark: a fictional store may not
          wear a real trademark, and this site carries none anywhere. */}
      <Pylon x={370} hue={hue} />

      {/* The lot: four regular rows. Regularity is the point. */}
      <LotGrid
        hue={hue}
        rows={[
          { y: 128, x: 300, count: 3, width: 30, gap: 7 },
          { y: 148, x: 300, count: 3, width: 30, gap: 7 },
          { y: 168, x: 214, count: 5, width: 30, gap: 7 },
          { y: 184, x: 214, count: 5, width: 30, gap: 7 },
        ]}
      />
    </>
  )
}

function AllWeatherFranchise({ hue }: { hue: string }) {
  return (
    <>
      {/* A smaller showroom, and a service wing behind it. */}
      <rect
        x="40"
        y="96"
        width="118"
        height="100"
        rx="4"
        fill="var(--color-surface-raised)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.4"
      />
      <path
        d="M34 96 H164"
        stroke={hue}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <Mullions x={40} y={104} width={118} height={92} count={5} />

      {/* The service wing: four bay doors, drawn as what they are. */}
      <rect
        x="158"
        y="118"
        width="104"
        height="78"
        rx="3"
        fill="var(--color-surface)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.2"
      />
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x={168 + index * 24}
          y="142"
          width="16"
          height="54"
          rx="2"
          fill="var(--color-surface-sunken)"
          stroke="var(--color-line-strong)"
          strokeWidth="1"
        />
      ))}

      <Pylon x={392} hue={hue} />

      {/* A shallower lot in two conditions: a short new line, a longer
          pre-owned one. */}
      <LotGrid
        hue={hue}
        rows={[
          { y: 150, x: 274, count: 2, width: 34, gap: 8 },
          { y: 172, x: 274, count: 3, width: 34, gap: 8, muted: true },
          { y: 190, x: 274, count: 3, width: 34, gap: 8, muted: true },
        ]}
      />
    </>
  )
}

function IndependentLot({ hue }: { hue: string }) {
  return (
    <>
      {/* A sales office, and nothing that could be called a showroom. */}
      <rect
        x="30"
        y="132"
        width="86"
        height="64"
        rx="4"
        fill="var(--color-surface-raised)"
        stroke="var(--color-line-strong)"
        strokeWidth="1.4"
      />
      <path
        d="M24 132 H122"
        stroke={hue}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.9"
      />
      <Mullions x={30} y={140} width={86} height={56} count={4} />

      {/* Light standards over the merchandising row. */}
      {[152, 244, 336].map((x) => (
        <g key={x}>
          <path
            d={`M${String(x)} 66 V${String(GROUND_Y)}`}
            stroke="var(--color-line-strong)"
            strokeWidth="1.4"
          />
          <path
            d={`M${String(x - 14)} 66 H${String(x + 14)}`}
            stroke={hue}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* The merchandising row. Every silhouette a different width, because
          every unit here was bought individually. */}
      <VariedRow hue={hue} y={150} widths={[28, 40, 33, 46, 30]} x={128} />
      <VariedRow hue={hue} y={172} widths={[44, 29, 38, 26, 42]} x={128} muted />
      <VariedRow hue={hue} y={190} widths={[31, 45, 27, 39, 35]} x={128} muted />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared marks                                                                */
/* -------------------------------------------------------------------------- */

/** The dimensional ground the composition sits on. */
function Ground({ accent }: { accent: DealershipAccent }) {
  const id = `rooftop-${accent}`
  return (
    <>
      <defs>
        <pattern id={`${id}-dots`} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="var(--color-line-strong)" />
        </pattern>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width={VIEW.width} height={VIEW.height} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} opacity="0.6">
        <rect width={VIEW.width} height={VIEW.height} fill={`url(#${id}-dots)`} />
      </g>
    </>
  )
}

/** A glass curtain wall: a fill plus evenly spaced mullions. */
function Mullions({
  x,
  y,
  width,
  height,
  count,
}: {
  x: number
  y: number
  width: number
  height: number
  count: number
}) {
  const step = width / count
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="var(--color-surface-sunken)"
        opacity="0.8"
      />
      <g stroke="var(--color-line-strong)" strokeWidth="1">
        {Array.from({ length: count - 1 }, (_, index) => (
          <path
            key={index}
            d={`M${String(x + step * (index + 1))} ${String(y)} V${String(y + height)}`}
          />
        ))}
      </g>
    </>
  )
}

/** The pylon sign. Deliberately blank: no brand may appear on it. */
function Pylon({ x, hue }: { x: number; hue: string }) {
  return (
    <g>
      <path
        d={`M${String(x)} 96 V${String(GROUND_Y)}`}
        stroke="var(--color-line-strong)"
        strokeWidth="2"
      />
      <rect
        x={x - 18}
        y="60"
        width="36"
        height="38"
        rx="4"
        fill="var(--color-surface-raised)"
        stroke={hue}
        strokeWidth="1.6"
      />
      <path
        d={`M${String(x - 10)} 79 H${String(x + 10)}`}
        stroke={hue}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  )
}

interface LotRow {
  readonly y: number
  readonly x: number
  readonly count: number
  readonly width: number
  readonly gap: number
  /** Drawn in the neutral line colour rather than the store hue. */
  readonly muted?: boolean
}

/** Regular rows of identical silhouettes. */
function LotGrid({ hue, rows }: { hue: string; rows: readonly LotRow[] }) {
  return (
    <g>
      {rows.map((row) => (
        <g key={`${String(row.y)}-${String(row.x)}`}>
          {Array.from({ length: row.count }, (_, index) => (
            <Silhouette
              key={index}
              x={row.x + index * (row.width + row.gap)}
              y={row.y}
              width={row.width}
              hue={row.muted === true ? 'var(--color-line-strong)' : hue}
            />
          ))}
        </g>
      ))}
    </g>
  )
}

/** A row whose silhouettes all differ. */
function VariedRow({
  hue,
  y,
  x,
  widths,
  muted = false,
}: {
  hue: string
  y: number
  x: number
  widths: readonly number[]
  muted?: boolean
}) {
  // The left edge of each silhouette is the sum of everything before it plus one
  // gap each. Computed as a prefix sum rather than by advancing a cursor inside
  // the map: a variable mutated during render is a render-phase side effect, and
  // `react-hooks/immutability` is right to reject it even where the output would
  // have been identical.
  const GAP = 8
  const offsets = widths.map((_, index) =>
    widths.slice(0, index).reduce((total, each) => total + each + GAP, x)
  )

  return (
    <g>
      {widths.map((width, index) => (
        <Silhouette
          key={index}
          x={offsets[index] ?? x}
          y={y}
          width={width}
          hue={muted ? 'var(--color-line-strong)' : hue}
        />
      ))}
    </g>
  )
}

/**
 * One vehicle, at the altitude a site plan draws one: a roof line and a body.
 * No wheels, no glass, no badge. It is a unit of inventory, not a car.
 */
function Silhouette({
  x,
  y,
  width,
  hue,
}: {
  x: number
  y: number
  width: number
  hue: string
}) {
  const height = Math.max(8, width * 0.32)
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={height / 2.6}
        fill="var(--color-surface)"
        stroke={hue}
        strokeWidth="1.3"
      />
      <path
        d={`M${String(x + width * 0.3)} ${String(y)} H${String(x + width * 0.72)}`}
        stroke={hue}
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.85"
      />
    </g>
  )
}
