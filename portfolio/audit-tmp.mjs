import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://localhost:3131'
const LABEL = process.env.LABEL ?? 'before'
const OUT = process.env.OUT

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function measure(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((r) => setTimeout(r, 150))
  })

  const stats = await page.evaluate(() => {
    const main = document.querySelector('main')
    // VISIBLE PROSE ONLY: paragraphs and ledes that are rendered, excluding sr-only,
    // excluding anything inside a closed <details>, excluding tables, numbers and labels.
    const isHidden = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return true
      if (el.closest('.sr-only')) return true
      const cls = el.className && typeof el.className === 'string' ? el.className : ''
      if (cls.includes('sr-only')) return true
      const details = el.closest('details')
      if (details && !details.open) return true
      return false
    }
    let proseWords = 0
    let paragraphs = 0
    for (const el of main.querySelectorAll('p, figcaption > p, li > p')) {
      if (isHidden(el)) continue
      const t = (el.innerText || '').trim()
      if (!t) continue
      const words = t.split(/\s+/).filter(Boolean).length
      // A "paragraph" of prose is 8+ words; shorter strings are labels/values.
      if (words >= 8) {
        proseWords += words
        paragraphs += 1
      }
    }
    const visibleText = (main.innerText || '').replace(/\s+/g, ' ').trim()
    return {
      proseWords,
      paragraphs,
      allVisibleWords: visibleText.split(/\s+/).filter(Boolean).length,
      headings: main.querySelectorAll('h2').length,
      h3: main.querySelectorAll('h3').length,
      figures: main.querySelectorAll('figure').length,
      figcaptions: main.querySelectorAll('figcaption').length,
      openDetails: [...main.querySelectorAll('details')].filter((d) => d.open).length,
      details: main.querySelectorAll('details').length,
      tables: main.querySelectorAll('table').length,
      pageHeight: document.documentElement.scrollHeight,
      sections: main.querySelectorAll('section').length,
    }
  })

  if (OUT) {
    await page.screenshot({ path: `${OUT}/${LABEL}-${tag}.png`, fullPage: false })
    if (tag === 'desktop') {
      await page.screenshot({ path: `${OUT}/${LABEL}-desktop-full.png`, fullPage: true })
    }
  }
  await page.close()
  return stats
}

const desktop = await measure(1440, 900, 'desktop')
const mobile = await measure(390, 844, 'mobile')
console.log(JSON.stringify({ label: LABEL, desktop, mobile }, null, 2))
await browser.close()
