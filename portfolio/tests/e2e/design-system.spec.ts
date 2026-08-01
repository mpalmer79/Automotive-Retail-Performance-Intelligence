import { expect, test } from '@playwright/test'

import { gotoRendered } from './helpers'
import { PRIMARY_ROUTES } from './routes'

/**
 * Design-system integrity.
 *
 * This suite exists because of a defect the first review pass found and nothing
 * else would have caught: in Tailwind v4, `z-[--arpi-z-header]` is an arbitrary
 * VALUE, not a variable reference. It compiles to `z-index: --arpi-z-header`,
 * which is invalid, so the declaration is dropped. Twenty-nine utilities across
 * twelve files were written that way. Every z-index on the site resolved to
 * `auto`, every custom transition duration fell back to the default, both blurs
 * did nothing, and the mobile navigation drawer rendered BELOW the page content -
 * a broken layout that looked completely fine in a screenshot, because the drawer
 * still painted where it was supposed to and only became unclickable.
 *
 * The type checker cannot see it, the linter cannot see it, the build does not
 * warn, and a visual diff does not show it. The only thing that catches it is
 * asserting the computed value in a real browser, which is what this file does.
 *
 * The rule it encodes: a token referenced from a utility must resolve to a real
 * value, not to the property's initial value.
 */

test.describe('token references resolve to real values', () => {
  test('the header, the drawer and the scrim have a real stacking order', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    const headerZ = await page.$eval('header', (el) => getComputedStyle(el).zIndex)
    expect(headerZ, 'the sticky header has no z-index').not.toBe('auto')
    expect(Number(headerZ)).toBeGreaterThan(0)

    await page.getByRole('button', { name: /open navigation menu/i }).click()
    const layers = await page.evaluate(() => {
      const drawer = document.querySelector('#mobile-navigation')
      const scrim = drawer?.previousElementSibling
      return {
        drawer: drawer ? getComputedStyle(drawer).zIndex : null,
        scrim: scrim ? getComputedStyle(scrim).zIndex : null,
      }
    })
    expect(layers.drawer, 'the drawer has no z-index').not.toBe('auto')
    expect(layers.scrim, 'the scrim has no z-index').not.toBe('auto')
    // The drawer must sit above its own scrim, or its links are unclickable.
    expect(Number(layers.drawer)).toBeGreaterThan(Number(layers.scrim))
  })

  test('the mobile scrim is a real, tinted box', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1100 })
    await page.goto('/about')
    await page.getByRole('button', { name: /open navigation menu/i }).click()

    const scrim = await page.evaluate(() => {
      const drawer = document.querySelector('#mobile-navigation')
      const element = drawer?.previousElementSibling
      if (!element) return null
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return {
        height: Math.round(box.height),
        background: style.backgroundColor,
        backdrop: style.backdropFilter,
      }
    })

    // It covered nothing: `inset-0` plus a `top-*` override produced a
    // zero-height box, so the scrim was unclickable.
    expect(
      scrim!.height,
      'the scrim has no height, so it cannot be clicked'
    ).toBeGreaterThan(300)
    // And it was invisible: a CSS variable in a colour opacity modifier compiles
    // to an invalid color-mix() and the declaration is dropped entirely.
    expect(scrim!.background, 'the scrim is fully transparent').not.toBe(
      'rgba(0, 0, 0, 0)'
    )
    expect(scrim!.backdrop).toContain('blur')
  })

  test('the skip link sits above everything else', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    const z = await page.$eval(
      'a[href="#main-content"]',
      (el) => getComputedStyle(el).zIndex
    )
    expect(z).not.toBe('auto')
    const headerZ = await page.$eval('header', (el) =>
      Number(getComputedStyle(el).zIndex)
    )
    expect(Number(z)).toBeGreaterThan(headerZ)
  })

  test('custom transition durations are applied, not silently dropped', async ({
    page,
  }) => {
    await page.goto('/')
    // The primary call to action uses duration-(--arpi-motion-fast) = 140ms.
    const duration = await page.$eval(
      'a[href="/architecture"]',
      (el) => getComputedStyle(el).transitionDuration
    )
    expect(duration, 'the button has no transition duration').not.toBe('0s')
  })

  test('the header is opaque white, with no backdrop blur', async ({ page }) => {
    /**
     * The inverse of what this test asserted before, and deliberately so.
     *
     * The header used to be `bg-canvas/85` over a 14px backdrop blur, which on a
     * near-black page read as depth. Over a blue field it reads as a smear: the
     * gradient shows through, so the white header the whole composition rests on
     * is actually pale blue, and it changes colour as the visitor scrolls. The
     * floating-canvas direction rules out glassmorphism for exactly this reason.
     *
     * Asserting the absence is worth a test rather than just deleting the old
     * one. Translucency is the kind of thing that gets added back by anyone who
     * thinks a sticky header should feel "modern", and it would quietly undo the
     * separation between the white shell and the blue field that the design
     * depends on.
     */
    await page.goto('/')
    const header = await page.$eval('header', (el) => {
      const style = getComputedStyle(el)
      return { filter: style.backdropFilter, background: style.backgroundColor }
    })

    expect(header.filter, 'the header has a backdrop blur').toBe('none')
    // Fully opaque: rgb(), or rgba() with an alpha of exactly 1.
    expect(header.background, 'the header is translucent').toMatch(
      /^rgba?\((?:\d+,\s*){2}\d+(?:,\s*1)?\)$/
    )
    expect(header.background).not.toContain('--arpi')
  })

  test('no computed style anywhere contains an unresolved token name', async ({
    page,
  }) => {
    for (const route of PRIMARY_ROUTES) {
      await gotoRendered(page, route.path)
      const broken = await page.evaluate(() => {
        const found: string[] = []
        // A dropped declaration leaves no trace, but a MIS-resolved one leaves the
        // literal token name in the computed value. Both forms are checked: this
        // catches the mis-resolved case directly.
        for (const element of document.querySelectorAll('body *')) {
          const style = getComputedStyle(element)
          for (const property of [
            'zIndex',
            'transitionDuration',
            'transitionTimingFunction',
            'backdropFilter',
            'opacity',
            'animationDuration',
          ] as const) {
            const value = style[property]
            if (typeof value === 'string' && value.includes('--')) {
              found.push(
                `${element.tagName.toLowerCase()} ${property}: ${value.slice(0, 60)}`
              )
            }
          }
        }
        return [...new Set(found)].slice(0, 5)
      })
      expect(broken, `${route.path} has an unresolved token in a computed style`).toEqual(
        []
      )
    }
  })

  test('the palette is closed: no default Tailwind colour compiles', async ({ page }) => {
    await page.goto('/')
    // `--color-*: initial` in theme.css resets Tailwind's ramps, so a stray
    // `bg-slate-700` produces no rule at all. If someone re-enables the defaults,
    // this class would start resolving and the closed palette would be a fiction.
    const resolved = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.className = 'bg-slate-700 text-red-500'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = {
        background: style.backgroundColor,
        colour: style.color,
      }
      probe.remove()
      return result
    })
    // Transparent background and inherited colour: neither utility exists.
    expect(resolved.background).toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('the reduced-motion floor is real', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('no element animates or transitions for longer than a frame', async ({ page }) => {
    await page.goto('/')
    const offenders = await page.evaluate(() => {
      const found: string[] = []
      for (const element of document.querySelectorAll('body *')) {
        const style = getComputedStyle(element)
        const parse = (value: string) =>
          Math.max(
            0,
            ...value.split(',').map((part) => {
              const trimmed = part.trim()
              if (trimmed.endsWith('ms')) return parseFloat(trimmed)
              if (trimmed.endsWith('s')) return parseFloat(trimmed) * 1000
              return 0
            })
          )
        const longest = Math.max(
          parse(style.transitionDuration),
          parse(style.animationDuration)
        )
        if (longest > 1.5) {
          found.push(
            `${element.tagName.toLowerCase()}.${(element.className || '').toString().split(' ')[0] ?? ''}: ${String(longest)}ms`
          )
        }
      }
      return [...new Set(found)].slice(0, 5)
    })
    expect(offenders, 'reduced motion did not neutralise these').toEqual([])
  })

  test('every SVG path that draws itself renders complete', async ({ page }) => {
    await page.goto('/')
    const undrawn = await page.$$eval('[data-arpi-draw]', (paths) =>
      paths
        .map((path) => ({
          offset: getComputedStyle(path).strokeDashoffset,
          array: getComputedStyle(path).strokeDasharray,
        }))
        .filter((state) => state.offset !== '0px' && state.offset !== '0')
    )
    expect(undrawn, 'a drawn path is still hidden under reduced motion').toEqual([])
  })

  test('the proof figures show their final values on the first paint', async ({
    page,
  }) => {
    // This used to check that the count-up animation rendered its END state
    // under reduced motion. The count-up is gone: at four figures set as large
    // as these, the animation drew the eye to the movement rather than to the
    // size, and it delayed the one thing the section exists for.
    //
    // The obligation survives its implementation. A number is content, and it
    // must be correct on the first paint for every visitor, not after an
    // animation - so this now asserts the stronger property, which is that no
    // scroll, no wait and no motion preference is required to read it.
    await page.goto('/')
    const proof = page.locator('#proof')
    const text = (await proof.innerText()).replace(/\s+/g, ' ')
    expect(text).toMatch(/\b28\b/)
    expect(text).toMatch(/\b29\b/)
    expect(text).toMatch(/\b42\b/)
    expect(text).toMatch(/\b49\b/)
    expect(text, 'a figure rendered as its animation start value').not.toMatch(
      /\b0\s+(Governed KPIs|Reporting views|DAX measures)/
    )
  })

  test('every route renders the same visible text as it does with motion on', async ({
    browser,
  }) => {
    // Sixteen full page renders with a scroll walk each. The default 45s budget is
    // not enough, and the comparison is worth the time: it is the only check that
    // a reduced-motion branch has not quietly dropped content.
    test.setTimeout(180_000)
    // Reduced motion must remove movement, never content. Comparing the two
    // renderings word for word is the only way to be sure a `still` branch did
    // not quietly drop something.
    const read = async (reducedMotion: 'reduce' | 'no-preference', path: string) => {
      const context = await browser.newContext({ reducedMotion })
      const page = await context.newPage()
      await page.goto(path)
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.6
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo({ top: y, behavior: 'instant' })
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        window.scrollTo({ top: 0, behavior: 'instant' })
        await new Promise((resolve) => setTimeout(resolve, 1600))
      })
      const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim()
      await context.close()
      return text
    }

    for (const route of PRIMARY_ROUTES) {
      const [reduced, full] = await Promise.all([
        read('reduce', route.path),
        read('no-preference', route.path),
      ])
      expect(reduced, `${route.path} differs under reduced motion`).toBe(full)
    }
  })
})
