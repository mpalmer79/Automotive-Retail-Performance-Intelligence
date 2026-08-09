/**
 * Token-file invariants.
 *
 * These are the checks that catch the class of Tailwind v4 defect nothing else
 * in the pipeline sees. A token that shadows a reserved Tailwind keyword, or a
 * breakpoint that drifts between its documented value and its `@theme` value,
 * produces valid CSS with the wrong value: it type-checks, it lints, it builds,
 * and it looks plausible in a screenshot.
 *
 * The companion to this file is `tests/e2e/design-system.spec.ts`, which asserts
 * the same bridge from the other end - computed values in a real browser.
 * Together they cover both halves: this file says the source is well-formed, that
 * one says the browser agrees.
 *
 * Documented in portfolio/docs/DESIGN_SYSTEM.md section 2.2.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const STYLES = resolve(HERE, '../../src/styles')

const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
const theme = readFileSync(join(STYLES, 'theme.css'), 'utf8')
const globals = readFileSync(join(STYLES, 'globals.css'), 'utf8')

/** Strip comments so a value mentioned in prose is not read as a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every custom-property declaration in a stylesheet, as name → value. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>()
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(withoutComments(css))) !== null) {
    const [, name, value] = match
    if (name && value) found.set(name, value.trim())
  }
  return found
}

const tokenDeclarations = declarations(tokens)
const themeDeclarations = declarations(theme)

/* -------------------------------------------------------------------------- */

describe('the token file is the only source of visual constants', () => {
  it('declares every --arpi-* token in tokens.css, not in theme.css', () => {
    const strays = [...themeDeclarations.keys()].filter((name) =>
      name.startsWith('--arpi-')
    )
    expect(strays).toEqual([])
  })

  it('gives every theme value a var(--arpi-*) reference or a documented literal', () => {
    // The only literals permitted in theme.css are the breakpoints - a media
    // query cannot read a custom property - and Tailwind's spacing base.
    const literalsAllowed = new Set([
      '--breakpoint-xs',
      '--breakpoint-sm',
      '--breakpoint-md',
      '--breakpoint-lg',
      '--breakpoint-xl',
      '--breakpoint-2xl',
      '--breakpoint-3xl',
      '--spacing',
    ])

    const offenders = [...themeDeclarations.entries()]
      .filter(([name]) => !literalsAllowed.has(name))
      .filter(([name]) => !name.startsWith('--animate-'))
      .filter(([, value]) => !value.includes('var(--arpi-'))
      .filter(([, value]) => value !== 'initial')
      .map(([name, value]) => `${name}: ${value}`)

    expect(offenders).toEqual([])
  })

  it('closes the palette by resetting Tailwind default ramps', () => {
    for (const namespace of [
      '--color-*',
      '--font-*',
      '--text-*',
      '--radius-*',
      '--shadow-*',
      '--breakpoint-*',
    ]) {
      expect(withoutComments(theme)).toContain(`${namespace}: initial`)
    }
  })
})

describe('no layout token shadows a reserved Tailwind keyword', () => {
  /**
   * Tailwind treats a small set of names as static keywords. Defining a theme
   * token with one of those names silently redefines the corresponding utility.
   *
   * `--container-full: 96rem` was the real defect: `full` means 100%, so
   * `max-w-full` began resolving to 96rem and the header rendered 1536px wide on
   * a 1280px viewport. The token is now `--container-bleed`.
   */
  const reserved = [
    'full',
    'auto',
    'none',
    'min',
    'max',
    'fit',
    'screen',
    'px',
    'inherit',
    'initial',
    'current',
    'transparent',
  ]

  const namespaces = ['--container-', '--spacing-', '--color-', '--radius-', '--text-']

  it.each(reserved)('does not define a %s variant of any scale', (keyword) => {
    const offenders = namespaces
      .map((namespace) => `${namespace}${keyword}`)
      .filter((name) => themeDeclarations.has(name))
    expect(offenders).toEqual([])
  })
})

describe('breakpoints agree between their documentation and the theme', () => {
  /**
   * A custom property cannot be used in a media query, so the scale is written
   * twice: once as prose in tokens.css and once as a real token in theme.css.
   * Two copies of a number is a drift risk, and this is the check that closes it.
   */
  const documented = new Map<string, string>()
  const table = /^\s{2,}(xs|sm|md|lg|xl|2xl|3xl)\s+(\d+)px/gm
  let row: RegExpExecArray | null
  while ((row = table.exec(tokens)) !== null) {
    const [, name, value] = row
    if (name && value) documented.set(name, `${value}px`)
  }

  it('documents all seven', () => {
    expect([...documented.keys()].sort()).toEqual(
      ['2xl', '3xl', 'lg', 'md', 'sm', 'xl', 'xs'].sort()
    )
  })

  it('matches every documented breakpoint to its theme token', () => {
    const mismatches: string[] = []
    for (const [name, value] of documented) {
      const actual = themeDeclarations.get(`--breakpoint-${name}`)
      if (actual !== value)
        mismatches.push(`${name}: documented ${value}, theme ${actual}`)
    }
    expect(mismatches).toEqual([])
  })

  it('defines no breakpoint the documentation does not mention', () => {
    const extra = [...themeDeclarations.keys()]
      .filter((name) => name.startsWith('--breakpoint-'))
      .filter((name) => name !== '--breakpoint-*')
      .map((name) => name.replace('--breakpoint-', ''))
      .filter((name) => !documented.has(name))
    expect(extra).toEqual([])
  })
})

describe('a custom property is never used with arbitrary-value syntax', () => {
  /**
   * The single most expensive defect found in this build.
   *
   * `z-[--arpi-z-header]` is the arbitrary-VALUE form. It compiles to the literal
   * `z-index: --arpi-z-header`, which is invalid, so the browser computes
   * `z-index: auto`. Twenty-nine utilities across twelve files were affected and
   * every one of them had no z-index at all. The correct form for a custom
   * property is parentheses: `z-(--arpi-z-header)`.
   *
   * Scanned across the whole component tree, because the mistake is not confined
   * to any one utility.
   */
  it('uses parentheses, not brackets, for every --arpi-* utility value', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const root = resolve(HERE, '../../src')

    async function walk(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...(await walk(path)))
        else if (/\.tsx?$/.test(entry.name)) files.push(path)
      }
      return files
    }

    const offenders: string[] = []
    for (const file of await walk(root)) {
      const body = await readFile(file, 'utf8')
      body.split('\n').forEach((line, index) => {
        // `[--arpi-…]` anywhere in a class string is the broken form. A legitimate
        // use inside a `style` object is `['--arpi-x' as string]`, which has a
        // quote immediately after the bracket, so it does not match.
        if (/\[--arpi-[a-z0-9-]+\]/i.test(line)) {
          offenders.push(`${file.replace(root, 'src')}:${String(index + 1)}`)
        }
      })
    }

    expect(offenders).toEqual([])
  })
})

describe('sr-only is redefined without a horizontal scroll extent', () => {
  /**
   * Tailwind's `sr-only` sets `white-space: nowrap` on a 1px box, which gives it
   * a very wide scroll extent that Chromium propagates up through every
   * `overflow: visible` ancestor. Every source link on this site announces a full
   * repository path, so several pages measured 523px wide at a 375px viewport
   * while being visually correct - and `document.scrollWidth` therefore lies,
   * which makes any automated overflow check unusable.
   */
  const block = /@utility sr-only\s*\{([\s\S]*?)\n\}/.exec(globals)?.[1] ?? ''

  it('redefines the utility at all', () => {
    expect(block).not.toBe('')
  })

  it('does not set white-space: nowrap', () => {
    expect(withoutComments(block)).not.toMatch(/white-space\s*:\s*nowrap/)
  })

  it('keeps the rest of the visually-hidden recipe intact', () => {
    for (const declaration of [
      'position: absolute',
      'width: 1px',
      'height: 1px',
      'overflow: hidden',
      'clip-path: inset(50%)',
    ]) {
      expect(block).toContain(declaration)
    }
  })

  it('uses clip-path rather than the deprecated clip property', () => {
    expect(withoutComments(block)).not.toMatch(/[^-]clip\s*:/)
  })
})

describe('every text colour clears the WCAG AA floor on every ground', () => {
  /**
   * The palette is measured, not chosen by eye.
   *
   * This is the check that caught four separate failures in the floating-canvas
   * direction's own starting values, every one of which looked correct in a
   * screenshot:
   *
   *   ink-muted  #6E7A83  4.40:1 on white          below the 4.5:1 floor
   *   ink-faint  #87939B  3.15:1 on white          not usable for text at all
   *   accent     #087FA4  4.58:1 on PURE white but 4.37:1 on the soft canvas,
   *                                                so it passed on one surface
   *                                                and failed on the next
   *   field-top  #4FA9D3  2.64:1 against the white panel edge, making the core
   *                                                visual idea of the design the
   *                                                weakest boundary on the page
   *
   * The third is the one worth naming: a colour is not "accessible" on its own,
   * only on a ground. Checking the accent against `#FFFFFF` and stopping would
   * have shipped it. Every text token below is therefore checked against EVERY
   * surface it can sit on, not against the lightest one.
   *
   * The ratios are computed here rather than asserted as literals, so a future
   * change to either a colour or a ground is caught by the same test.
   */
  function channel(value: number): number {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  function luminance(hex: string): number {
    const clean = hex.replace('#', '')
    const parts = [0, 2, 4].map((offset) =>
      Number.parseInt(clean.slice(offset, offset + 2), 16)
    )
    const [r, g, b] = parts as [number, number, number]
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  function ratio(foreground: string, background: string): number {
    const a = luminance(foreground)
    const b = luminance(background)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  function token(name: string): string {
    const value = tokenDeclarations.get(name)
    expect(value, `${name} is not declared`).toBeDefined()
    return value ?? ''
  }

  /** Every white surface that can carry text. */
  const whiteGrounds = [
    '--arpi-canvas-pure',
    '--arpi-canvas-soft',
    '--arpi-canvas-cool',
    '--arpi-canvas-wash',
  ]

  it.each(['--arpi-ink-900', '--arpi-ink-800', '--arpi-ink-600', '--arpi-ink-400'])(
    '%s reaches 4.5:1 on every white surface',
    (name) => {
      for (const ground of whiteGrounds) {
        expect(
          ratio(token(name), token(ground)),
          `${name} on ${ground}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each([
    '--arpi-teal-700',
    '--arpi-teal-600',
    '--arpi-teal-500',
    '--arpi-link-600',
    '--arpi-emerald-600',
    '--arpi-amber-700',
    '--arpi-rose-600',
    '--arpi-violet-600',
  ])('%s reaches 4.5:1 as status, accent and link text', (name) => {
    for (const ground of whiteGrounds) {
      expect(
        ratio(token(name), token(ground)),
        `${name} on ${ground}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * The data-visualisation marks, measured as MARKS rather than as text.
   *
   * WCAG 1.4.11 asks 3:1 of a graphical object against what is adjacent to it. A
   * chart mark on this page sits on a white surface, so that is the ground each
   * one is measured against — all four of them, for the reason the accent failure
   * above records: a colour is not accessible on its own, only on a ground.
   *
   * Several of these are also used as small text (a legend label, a signed
   * figure), and those clear the 4.5:1 text floor in the block above because they
   * resolve to the same ramps. What is new here is the mark-only steps, which are
   * deliberately lighter than any text colour and would fail a text check.
   */
  it.each([
    '--arpi-emerald-500',
    '--arpi-teal-450',
    '--arpi-orange-600',
    '--arpi-rose-700',
  ])('%s reaches 3:1 as a chart mark on every white surface', (name) => {
    for (const ground of whiteGrounds) {
      expect(ratio(token(name), token(ground)), `${name} on ${ground}`).toBeGreaterThanOrEqual(
        3
      )
    }
  })

  /**
   * The age ramp is ORDERED, and the order is the point.
   *
   * Its five steps run fresh to critical, and a reader has to be able to tell
   * which end they are looking at. Hue carries that order; luminance cannot,
   * because holding five hues apart in lightness would force the fresh end so
   * light it fails against the white it sits on — which this asserts by proving
   * every step clears the ground floor while NOT requiring the steps to separate
   * from each other. The stack separates them structurally instead, with a
   * hairline of page background and a printed age range and count on every
   * segment. That is recorded in tokens.css §2b and asserted in the visuals suite.
   */
  it('keeps every age-ramp step legible against the surface it is drawn on', () => {
    const ramp = [
      '--arpi-colour-data-age-fresh',
      '--arpi-colour-data-age-early',
      '--arpi-colour-data-age-threshold',
      '--arpi-colour-data-age-aged',
      '--arpi-colour-data-age-critical',
    ]
    for (const name of ramp) {
      const resolved = token(name).replace(/var\(|\)/g, '').trim()
      const value = token(resolved)
      for (const ground of whiteGrounds) {
        expect(ratio(value, token(ground)), `${name} on ${ground}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  /**
   * The one rule that keeps the two colour concepts apart.
   *
   * The brand accent is teal and stays teal. `data-positive` and `data-negative`
   * are a different vocabulary, and if either ever resolved to the accent the
   * page would be claiming a semantic it had not actually encoded.
   */
  it('keeps the sign semantics distinct from the brand accent', () => {
    const accent = token('--arpi-colour-accent')
    for (const name of ['--arpi-colour-data-positive', '--arpi-colour-data-negative']) {
      expect(token(name), `${name} must not be the brand accent`).not.toBe(accent)
    }
  })

  /**
   * The blue field is a gradient, and white text is legible on only part of it.
   * `field-deep` is the one blue surface the design permits text on, so it is
   * the one that has to be measured.
   */
  it.each(['--arpi-inverse-100', '--arpi-inverse-200', '--arpi-inverse-300'])(
    '%s reaches 4.5:1 on the deep field, the only blue that carries text',
    (name) => {
      for (const ground of ['--arpi-field-700', '--arpi-field-800']) {
        expect(
          ratio(token(name), token(ground)),
          `${name} on ${ground}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  /**
   * The white canvas floating on the blue field is the design. If its edge does
   * not separate from the field behind it, there is no design.
   *
   * 3:1 is the non-text threshold. The top gradient stop is the binding one -
   * it is the lightest blue on the page and the panel's top corners sit against
   * it - and it is why the direction's suggested #4FA9D3 is not the value
   * shipped.
   */
  it('separates the white canvas from every stop of the blue field at 3:1', () => {
    for (const stop of [
      '--arpi-field-400',
      '--arpi-field-500',
      '--arpi-field-600',
      '--arpi-field-800',
    ]) {
      expect(
        ratio(token('--arpi-canvas-pure'), token(stop)),
        `canvas edge on ${stop}`
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('the decorative slate ramp is never used as a text colour', () => {
  /**
   * `--arpi-slate-400` and `--arpi-slate-200` sit below 3:1 on white BY DESIGN.
   * They draw hairlines, dividers and the background motif - none of which is
   * text, and none of which identifies a control or its state, so WCAG 1.4.11
   * does not apply to them.
   *
   * That distinction is only safe if it is enforced. A `text-*` utility built on
   * either would be a real contrast failure that no unit test of the palette
   * would catch, because the palette is correct: the misuse is at the call site.
   *
   * The ink ramp is what text uses. This asserts nothing binds the slate ramp to
   * a text utility in the theme bridge.
   */
  it('binds no --color-ink-* token to the slate ramp', () => {
    const offenders = [...themeDeclarations.entries()]
      .filter(([name]) => name.startsWith('--color-ink'))
      .filter(([, value]) => /slate/.test(value))
      .map(([name, value]) => `${name}: ${value}`)

    expect(offenders).toEqual([])
  })

  it('resolves --arpi-colour-text-faint to the ink ramp, not the slate ramp', () => {
    expect(tokenDeclarations.get('--arpi-colour-text-faint')).toContain('--arpi-ink-')
  })
})

describe('overflow-wrap on the body is anywhere, not break-word', () => {
  /**
   * `break-word` lets a long word break only after layout has already reserved
   * room for it, so it does NOT reduce the element's min-content width and the
   * container still forces the page wider than the viewport. `anywhere` reduces
   * min-content too, which is the property that actually stops the overflow.
   *
   * The symptom: the Gate 2 evidence text set a 503px floor on a 320px viewport.
   */
  const body = /\n  body \{([\s\S]*?)\n  \}/.exec(globals)?.[1] ?? ''

  it('sets overflow-wrap: anywhere', () => {
    expect(withoutComments(body)).toMatch(/overflow-wrap\s*:\s*anywhere/)
  })

  it('does not set break-word', () => {
    expect(withoutComments(body)).not.toMatch(/overflow-wrap\s*:\s*break-word/)
  })
})
