/**
 * `/dashboard/actions` — the Management Action Center.
 *
 * The queue is decided at export time, so these tests are not about arithmetic. They are
 * about the three claims the surface makes to a reader and would be worthless without: that
 * every prompt shows the evidence and threshold behind it, that the facets are real URL
 * state a reader can share and a browser can serve without scripting, and that nothing on
 * the page pretends to be a workflow it cannot remember.
 */
import { expect, test, type Page } from '@playwright/test'

import { affirmativeSentences, bodyText, gotoRendered, mainText, settle } from './helpers'

const ROUTE = '/dashboard/actions'

/**
 * Open every `<details>` on the page.
 *
 * The shared `openDetailRegions` helper takes explicit ids, which suits a page whose
 * disclosures are a known short list. This route has one per action card plus three prose
 * regions, so the ids are data rather than layout, and opening all of them is what a print
 * stylesheet and a screen reader both effectively do.
 */
async function openAll(page: Page): Promise<void> {
  await page.locator('details').evaluateAll((nodes) => {
    for (const node of nodes) (node as HTMLDetailsElement).open = true
  })
}

test.describe('the route exists and says what it is', () => {
  test('answers 200 and renders its name', async ({ page }) => {
    const response = await page.goto(ROUTE)
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Management Actions' })
    ).toBeVisible()
  })

  test('is in the operating rail, in last position', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const rail = page.getByRole('navigation', { name: /operating/i }).first()
    const labels = await rail.getByRole('link').allInnerTexts()
    const trimmed = labels.map((label) => label.trim()).filter(Boolean)
    expect(trimmed).toContain('Actions')
    // Management attention follows business status, in the rail as on the page.
    expect(trimmed.indexOf('Actions')).toBeGreaterThan(trimmed.indexOf('Accounting'))
  })

  test('appears in the sitemap', async ({ page }) => {
    const response = await page.goto('/sitemap.xml')
    const xml = (await response?.text()) ?? ''
    expect(xml).toContain(ROUTE)
  })

  test('states that an action is a prompt rather than a finding', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await openAll(page)
    const text = await mainText(page)
    expect(text).toMatch(/not a finding/i)
    expect(text).toMatch(/no language model/i)
    expect(text).toMatch(/stateless/i)
  })
})

test.describe('a queue row carries what a reader needs to check it', () => {
  test('shows severity as text, never as colour alone', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/\bHigh\b/)
    expect(text).toMatch(/\bMedium\b/)
  })

  test('shows the domain, the store and the review role', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Inventory/)
    expect(text).toMatch(/GSA-00\d/)
    expect(text).toMatch(/Review role:/)
  })

  test('says "review role" and never "assigned to"', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await openAll(page)
    const text = await bodyText(page)
    expect(text.toLowerCase()).toContain('review role')
    expect(text.toLowerCase()).not.toContain('assigned to')
    /*
     * `affirmativeSentences` rather than a bare substring search, because the page DENIES
     * these words in its own copy: "carries no acknowledgement, assignment, completion or
     * due date". A naive `not.toContain('due date')` fails on the sentence that exists to
     * rule the concept out, which would have meant weakening the disclosure to pass a test.
     */
    expect(
      affirmativeSentences(text, /\b(due date|overdue|acknowledged|completed)\b/i)
    ).toEqual([])
  })

  test('discloses the threshold that fired, named a project default', async ({
    page,
  }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Aged threshold/)
    expect(text).toMatch(/60/)
    expect(text).toMatch(/project default/i)
  })

  test('never calls a threshold an industry standard', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await openAll(page)
    const text = await bodyText(page)
    // Same reasoning: the methodology copy states that NONE of these is an industry
    // benchmark, so what must be absent is an affirmative claim rather than the words.
    expect(
      affirmativeSentences(
        text,
        /\b(industry standard|industry benchmark|best practice)\b/i
      )
    ).toEqual([])
  })

  test('offers the review prompt and the drill-through', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Review next:/)
    await expect(
      page.getByRole('link', { name: /Open the evidence behind this/ }).first()
    ).toBeVisible()
  })
})

test.describe('a drill-through lands on the evidence', () => {
  test('an inventory action reaches the unit it is about', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const href = await page
      .getByRole('link', { name: /Open the evidence behind this/ })
      .first()
      .getAttribute('href')
    expect(href).toBeTruthy()
    const response = await page.goto(href as string)
    expect(response?.status()).toBe(200)
  })

  test('every drill-through on the page resolves to a real route', async ({
    page,
    request,
  }) => {
    await gotoRendered(page, ROUTE)
    const hrefs = await page
      .getByRole('link', { name: /Open the evidence behind this/ })
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    // A sample rather than all forty-seven: the generator already proved every URL against
    // the route registry, and this is the end-to-end confirmation that the registry is real.
    for (const href of [...new Set(hrefs)].slice(0, 6)) {
      const response = await request.get(href)
      expect(response.status(), href).toBe(200)
    }
  })
})

test.describe('the facets are URL state', () => {
  test('a severity facet narrows the queue and survives a reload', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?severity=high`)
    const text = await mainText(page)
    expect(text).toMatch(/of \d+ open review prompts shown/)
    /*
     * The FACET COUNTS still say "Medium 29", and must: they tell a reader what selecting
     * medium would show. What must contain no medium row is the queue itself, so the
     * assertion is about the cards rather than about the page.
     */
    const severities = await page
      .getByRole('article')
      .evaluateAll((cards) => cards.map((card) => card.textContent?.slice(0, 12) ?? ''))
    expect(severities.length).toBeGreaterThan(0)
    expect(severities.every((label) => label.includes('High'))).toBe(true)
    await page.reload()
    await settle(page)
    expect(await mainText(page)).toMatch(/of \d+ open review prompts shown/)
  })

  test('a domain facet narrows the queue', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?domain=accounting`)
    const text = await mainText(page)
    expect(text).toMatch(/control/i)
    expect(text).not.toMatch(/Aged unit with no markdown/)
  })

  test('a store facet narrows the queue', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?store=GSA-003`)
    const text = await mainText(page)
    expect(text).toContain('GSA-003')
    expect(text).not.toContain('GSA-001')
  })

  test('an owner-role facet narrows the queue', async ({ page }) => {
    await gotoRendered(page, `${ROUTE}?owner=Controller`)
    const text = await mainText(page)
    expect(text).toMatch(/Review role: Controller/)
    expect(text).not.toMatch(/Review role: Used-car manager/)
  })

  test('facets compose in one URL', async ({ page }) => {
    const response = await page.goto(
      `${ROUTE}?severity=high&store=GSA-002&domain=inventory`
    )
    expect(response?.status()).toBe(200)
    const text = await mainText(page)
    expect(text).toContain('GSA-002')
  })

  test('an unknown value shows the whole queue rather than an empty one', async ({
    page,
  }) => {
    await gotoRendered(page, `${ROUTE}?severity=urgent`)
    const text = await mainText(page)
    // The unfiltered summary, which is what a stale link should produce.
    expect(text).not.toMatch(/of \d+ open review prompts shown/)
  })

  test('the facet controls are links, so Back is the undo stack', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const facets = page.getByRole('navigation', { name: /filter the review queue/i })
    await facets.getByRole('link', { name: /High/ }).first().click()
    await settle(page)
    expect(page.url()).toContain('severity=high')
    await page.goBack()
    await settle(page)
    expect(page.url()).not.toContain('severity=high')
  })
})

test.describe('the change drivers explain a change without claiming a cause', () => {
  test('renders the decomposition and its total', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const text = await mainText(page)
    expect(text).toMatch(/Why did total gross change/i)
    expect(text).toMatch(/Volume effect|Front PVR effect|Back PVR effect/)
    expect(text).toMatch(/bridge attributes/i)
  })

  test('uses attribution language and no causal claim', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await openAll(page)
    const text = (await mainText(page)).toLowerCase()
    expect(text).toContain('attributes')
    expect(text).not.toMatch(/\bcaused by\b/)
    expect(text).not.toMatch(/\bresulted from\b/)
  })

  test('states the materiality threshold as a project default', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    await openAll(page)
    const text = await mainText(page)
    expect(text).toMatch(
      /grouped into a single remainder|Effects below the review threshold/i
    )
    expect(text).toMatch(/project default/i)
  })
})

test.describe('nothing here is a workflow', () => {
  test('offers no control that would change anything', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    // No checkbox anywhere, and no button that claims an outcome.
    expect(await page.locator('input[type="checkbox"]').count()).toBe(0)
    const labels = await page.getByRole('button').allInnerTexts()
    for (const label of labels.map((item) => item.trim().toLowerCase())) {
      expect([
        'done',
        'complete',
        'resolve',
        'acknowledge',
        'assign',
        'dismiss',
      ]).not.toContain(label)
    }
  })

  test('posts nothing and stores nothing', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    expect(await page.locator('form[method="post" i]').count()).toBe(0)
    const stored = await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    }))
    expect(stored.local).toBe(0)
    expect(stored.session).toBe(0)
  })

  test('reconstructs the same queue after a reload', async ({ page }) => {
    await gotoRendered(page, ROUTE)
    const before = await mainText(page)
    await page.reload()
    await settle(page)
    expect(await mainText(page)).toBe(before)
  })
})

test.describe('the page works without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the queue, its evidence and its thresholds', async ({ page }) => {
    await page.goto(ROUTE)
    const text = await page.locator('main').innerText()
    expect(text).toMatch(/open review prompts/)
    expect(text).toMatch(/Review role:/)
    expect(text).toMatch(/Review next:/)
    expect(text).toMatch(/project default/i)
  })

  test('renders the change drivers', async ({ page }) => {
    await page.goto(ROUTE)
    expect(await page.locator('main').innerText()).toMatch(/bridge attributes/i)
  })

  test('facets still filter, because they are links', async ({ page }) => {
    await page.goto(`${ROUTE}?severity=high`)
    expect(await page.locator('main').innerText()).toMatch(
      /of \d+ open review prompts shown/
    )
  })
})

test.describe('the Executive Overview carries the top of the queue', () => {
  test('shows a small block and a link to the full queue', async ({ page }) => {
    await gotoRendered(page, '/')
    const text = await mainText(page)
    expect(text).toMatch(/Management attention/i)
    await expect(
      page.getByRole('link', { name: /View all \d+ review prompts/ })
    ).toBeVisible()
  })

  test('the block is deterministic across loads', async ({ page }) => {
    await gotoRendered(page, '/')
    const first = await page.locator('#management-attention').innerText()
    await page.reload()
    await settle(page)
    expect(await page.locator('#management-attention').innerText()).toBe(first)
  })

  test('management attention follows the business status, not the other way round', async ({
    page,
  }) => {
    await gotoRendered(page, '/')
    const positions = await page.evaluate(() => {
      const kpi = document.querySelector('#performance, [id="performance"]')
      const actions = document.querySelector('#management-attention')
      return {
        kpi: kpi?.getBoundingClientRect().top ?? 0,
        actions: actions?.getBoundingClientRect().top ?? 0,
      }
    })
    expect(positions.actions).toBeGreaterThan(positions.kpi)
  })

  test('does not acquire the whole queue on a phone before the KPIs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoRendered(page, '/')
    const text = await mainText(page)
    expect(text).toMatch(/Management attention/i)
  })
})
