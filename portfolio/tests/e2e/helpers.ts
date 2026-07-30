import type { Page } from '@playwright/test'

/**
 * Navigate and wait until the route has actually rendered.
 *
 * `page.goto` resolves on the `load` event, which for an App Router route can
 * happen before the route's content is on screen - three content-integrity tests
 * once failed reading a placeholder rather than the page they were checking.
 *
 * The placeholder in question was `app/loading.tsx`, which has since been removed:
 * a root `loading.tsx` puts every route behind a Suspense boundary, and Next then
 * emits the fallback in the document with the real content in a `<div hidden>` for
 * a script to swap in. With scripting disabled that swap never happens, so every
 * route served a skeleton and nothing else. `tests/e2e/reduced-motion.spec.ts`
 * asserts against a regression.
 *
 * Waiting for the `h1` remains the cheapest reliable signal that a route has
 * rendered: every route has exactly one, and it is asserted elsewhere.
 */
export async function gotoRendered(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.locator('h1').first().waitFor({ state: 'visible' })
}

/**
 * Scroll the whole page so every viewport-triggered reveal has fired, then return
 * to the top. `behavior: 'instant'` is required: the site enables smooth scrolling
 * for visitors who have not asked for reduced motion, and a smooth scroll does not
 * arrive within the loop's step delay, so the walk silently never reaches the
 * bottom of the page.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((resolve) => setTimeout(resolve, 70))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

/** The rendered text of `<main>`, with reveals settled. */
export async function mainText(page: Page): Promise<string> {
  await settle(page)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}

/** The rendered text of the whole document, with reveals settled. */
export async function bodyText(page: Page): Promise<string> {
  await settle(page)
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ')
}
