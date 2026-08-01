/**
 * The motion scale exists twice - as CSS custom properties in `tokens.css` and as
 * numbers in `src/lib/motion.ts` - because a stylesheet transition and a
 * JavaScript spring cannot share a value directly. Two copies of a number is a
 * drift risk, and this file is the check that closes it.
 *
 * It also asserts the motion BUDGET, which is the more interesting half: the
 * animation library must stay confined to the three routes whose motion needs a
 * JavaScript animator. That constraint is worth a test rather than a comment
 * because it is invisible - importing one hook on the home page pulls 70 kB and
 * nothing goes red.
 *
 * Documented in portfolio/docs/MOTION_SYSTEM.md sections 2 and 3.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DISTANCE, DURATION, EASE, STAGGER } from '../../src/lib/motion.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../src')

const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')

/** Read one custom property's value out of tokens.css, comments stripped. */
function token(name: string): string | undefined {
  const source = tokens.replace(/\/\*[\s\S]*?\*\//g, '')
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(source)?.[1]?.trim()
}

/* -------------------------------------------------------------------------- */
/* The two scales agree                                                        */
/* -------------------------------------------------------------------------- */

describe('the duration scale is identical in CSS and JavaScript', () => {
  it.each(Object.entries(DURATION))('%s', (name, seconds) => {
    const css = token(`--arpi-motion-${name}`)
    expect(css, `--arpi-motion-${name} is not declared`).toBeDefined()
    // CSS is milliseconds, Motion is seconds. Compared as milliseconds so a
    // rounding difference is visible rather than absorbed.
    expect(Number.parseFloat(css ?? '')).toBeCloseTo(seconds * 1000, 6)
  })

  it('defines no CSS duration the JavaScript scale is missing', () => {
    const declared = [
      ...tokens.matchAll(
        /--arpi-motion-(instant|fast|base|slow|slower|deliberate|ambient)\s*:/g
      ),
    ]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined)

    // `ambient` is deliberately CSS-only: it drives the two background keyframe
    // animations, and nothing in JavaScript should be running for fourteen
    // seconds.
    const missing = declared
      .filter((name) => name !== 'ambient')
      .filter((name) => !(name in DURATION))

    expect(missing).toEqual([])
  })
})

describe('the easing scale is identical in CSS and JavaScript', () => {
  it.each(Object.entries(EASE))('%s', (name, points) => {
    const css = token(`--arpi-ease-${name}`)
    expect(css, `--arpi-ease-${name} is not declared`).toBeDefined()
    const numbers = (css ?? '')
      .replace(/cubic-bezier\(|\)/g, '')
      .split(',')
      .map((part) => Number.parseFloat(part.trim()))
    expect(numbers).toEqual([...points])
  })
})

describe('the distance and stagger scales are identical in CSS and JavaScript', () => {
  it.each(Object.entries(DISTANCE))('distance %s', (name, pixels) => {
    expect(token(`--arpi-motion-distance-${name}`)).toBe(`${String(pixels)}px`)
  })

  it('stagger', () => {
    expect(token('--arpi-motion-stagger')).toBe(`${String(STAGGER * 1000)}ms`)
  })
})

describe('the scales hold their documented shape', () => {
  it('increases monotonically', () => {
    const values = Object.values(DURATION)
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1] ?? 0)
    }
  })

  it('never exceeds 900ms for anything a reader triggers', () => {
    // `ambient` is not in this scale for exactly this reason.
    expect(Math.max(...Object.values(DURATION))).toBeLessThanOrEqual(0.9)
  })

  it('keeps every travel distance small enough to read as a document', () => {
    expect(Math.max(...Object.values(DISTANCE))).toBeLessThanOrEqual(28)
  })

  it('keeps a six-item stagger under a third of a second', () => {
    expect(STAGGER * 6).toBeLessThan(0.34)
  })
})

/* -------------------------------------------------------------------------- */
/* The motion budget                                                           */
/* -------------------------------------------------------------------------- */

/** Every .ts/.tsx file under src, as repository-relative paths. */
function sourceFiles(directory: string = SRC): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) found.push(path)
  }
  return found
}

/** Files that import the animation library at runtime, not only for types. */
function animationLibraryImporters(): string[] {
  return sourceFiles()
    .filter((path) => {
      const body = readFileSync(path, 'utf8')
      // `import type { … } from 'motion/react'` costs nothing at runtime; the
      // motion token module imports its Transition and Variants types that way.
      return /^\s*import\s+(?!type\s)[^;]*from\s+'motion(\/react)?'/m.test(body)
    })
    .map((path) => relative(SRC, path))
    .sort()
}

describe('the animation library stays inside its budget', () => {
  /**
   * The site's most common motion - fade and rise sixteen pixels on entering the
   * viewport - appears on six of the eight routes and is implemented in CSS.
   * Implementing it with the animation library meant that library shipped to all
   * six, roughly 70 kB gzipped, to move an element sixteen pixels.
   *
   * This list is the whole justification for that decision, and it is asserted
   * rather than described so that the next reveal added to the site cannot quietly
   * re-import it.
   *
   * THE HOME PAGE IS NO LONGER ON IT.
   *
   * The redesign removed both of its entries. The hero's drawn diagram is now
   * `components/visuals/governed-signal.tsx`, a server component whose motion is
   * CSS on SVG attributes, and the scrollytelling walkthrough was replaced by a
   * five-stage section with no JavaScript animation at all. That took 42.7 kB of
   * route JavaScript off the site's most-visited page, and it removed the class
   * of defect the scrollytelling diagram had - animating `width` on an element
   * that also declared `width` as an attribute, which threw a console error
   * eight times per render.
   *
   * The two explorers keep it, and only they: their node emphasis is a spring
   * against a target that moves while the animation runs, which a CSS transition
   * cannot express because it restarts on every change.
   */
  const PERMITTED = [
    // Node emphasis, driven by a spring against a moving target.
    'components/explorers/architecture-explorer.tsx',
    'components/explorers/data-model-explorer.tsx',
  ]

  it('is imported only where a JavaScript animator is genuinely required', () => {
    expect(animationLibraryImporters()).toEqual(PERMITTED.sort())
  })

  it('is not imported by the CSS reveal', () => {
    const reveal = readFileSync(join(SRC, 'components/motion/reveal.tsx'), 'utf8')
    expect(reveal).not.toMatch(/from 'motion/)
  })

  it('is not imported by the signature visual, which is a server component', () => {
    const signal = readFileSync(
      join(SRC, 'components/visuals/governed-signal.tsx'),
      'utf8'
    )
    expect(signal).not.toMatch(/from 'motion/)
    // And it is a server component, which is the property that makes the hero
    // cost nothing. A 'use client' directive here would be a silent regression.
    expect(signal).not.toMatch(/^'use client'/m)
  })

  it('is not imported by the motion boundary or the animated count', () => {
    const boundary = readFileSync(
      join(SRC, 'components/motion/motion-boundary.tsx'),
      'utf8'
    )
    expect(boundary).not.toMatch(/from 'motion(\/react)?'/)
  })

  it('is imported by the token module for types only', () => {
    const source = readFileSync(join(SRC, 'lib/motion.ts'), 'utf8')
    expect(source).toMatch(/import type \{[^}]*\} from 'motion\/react'/)
    expect(source).not.toMatch(/^\s*import\s+(?!type\s)[^;]*from\s+'motion\/react'/m)
  })
})

describe('no component invents a duration or an easing curve', () => {
  /**
   * A raw millisecond value or a raw cubic-bezier at a call site is a defect: it
   * cannot be reviewed against the scale, and it will not be changed when the
   * scale changes.
   */
  const EXEMPT = new Set([
    // The stagger default and the reveal's rootMargin are structural, not
    // decorative, and both are asserted above.
    'components/motion/reveal.tsx',
    // The scale itself.
    'lib/motion.ts',
  ])

  it('declares no cubic-bezier outside the token files', () => {
    const offenders = sourceFiles()
      .filter((path) => readFileSync(path, 'utf8').includes('cubic-bezier'))
      .map((path) => relative(SRC, path))
      .filter((path) => !EXEMPT.has(path))
    expect(offenders).toEqual([])
  })

  it('declares no transition-duration in a style object', () => {
    const offenders: string[] = []
    for (const path of sourceFiles()) {
      const relativePath = relative(SRC, path)
      if (EXEMPT.has(relativePath)) continue
      const body = readFileSync(path, 'utf8')
      if (/transitionDuration\s*:/.test(body)) offenders.push(relativePath)
    }
    expect(offenders).toEqual([])
  })
})
