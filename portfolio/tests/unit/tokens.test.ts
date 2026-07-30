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

describe('the faintest text colour clears the WCAG AA floor', () => {
  /**
   * `--arpi-steel-400` is the faintest colour used for text, so it is pinned to a
   * measurement rather than chosen by eye. Its first value, #64748f, measured
   * 4.26:1 on the canvas and axe-core flagged it on all nine routes.
   *
   * The ratio is computed here rather than asserted as a literal, so that a
   * future change to either the token or the ground is caught by the same test.
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

  /** The lightest ground any text sits on, and the darkest. */
  const grounds = ['--arpi-obsidian-950', '--arpi-graphite-750']

  it.each(['--arpi-steel-400', '--arpi-steel-300', '--arpi-steel-200', '--arpi-clarity'])(
    '%s reaches 4.5:1 on every surface text can sit on',
    (name) => {
      for (const ground of grounds) {
        expect(
          ratio(token(name), token(ground)),
          `${name} on ${ground}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each([
    '--arpi-cyan-300',
    '--arpi-amber-300',
    '--arpi-violet-300',
    '--arpi-emerald-300',
    '--arpi-rose-300',
  ])('%s reaches 4.5:1 as status and accent text', (name) => {
    for (const ground of grounds) {
      expect(
        ratio(token(name), token(ground)),
        `${name} on ${ground}`
      ).toBeGreaterThanOrEqual(4.5)
    }
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
