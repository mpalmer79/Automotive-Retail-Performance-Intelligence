/**
 * Scratch measurement harness for UX.2C. Not committed.
 *
 * Reproduces the definitions UX-2-BASELINE.md §1 and UX-2B-BASELINE.md establish:
 *   proseRepo — rendered <p> of >= 8 words, outside .sr-only and outside a closed <details>
 *   proseEye  — every rendered <p> outside .sr-only and outside a closed <details>
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3111'
const OUT = process.argv[2] ?? 'measure.json'

const ROUTES = (process.env.ROUTES ?? [
  '/dashboard/leads-marketing',
  '/dashboard/employees',
  '/dashboard/accounting',
  '/dashboard/actions',
].join(',')).split(',')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

const collect = () => {
  const visible = (el) => {
    if (el.closest('.sr-only') !== null) return false
    let details = el.closest('details')
    while (details !== null) {
      if (!details.open) return false
      details = details.parentElement?.closest('details') ?? null
    }
    const rect = el.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0
  }

  const paragraphs = [...document.querySelectorAll('p')].filter(visible)
  const words = (el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length

  const proseEyeWords = paragraphs.reduce((n, p) => n + words(p), 0)
  const repo = paragraphs.filter((p) => words(p) >= 8)
  const proseRepoWords = repo.reduce((n, p) => n + words(p), 0)

  const figures = [...document.querySelectorAll('figure')].filter(visible)
  const regions = [...document.querySelectorAll('[data-visual-region]')].filter(visible)
  const firstFigure = figures.length === 0 ? null
    : Math.round(figures[0].getBoundingClientRect().top + window.scrollY)
  const inFirstViewport = figures.filter(
    (f) => f.getBoundingClientRect().top + window.scrollY < window.innerHeight
  ).length

  const tables = [...document.querySelectorAll('table')].filter(visible)
  const firstViewportProse = paragraphs
    .filter((p) => p.getBoundingClientRect().top + window.scrollY < window.innerHeight)
    .reduce((n, p) => n + words(p), 0)

  return {
    height: Math.round(document.documentElement.scrollHeight),
    scrollWidth: Math.round(document.documentElement.scrollWidth),
    clientWidth: document.documentElement.clientWidth,
    proseEyeWords,
    proseEyeParagraphs: paragraphs.length,
    proseRepoWords,
    proseRepoParagraphs: repo.length,
    firstViewportProse,
    figures: figures.length,
    figuresInFirstViewport: inFirstViewport,
    firstFigureY: firstFigure,
    visualRegions: regions.length,
    tables: tables.length,
    visibleTables: tables.length,
    details: document.querySelectorAll('details').length,
    h2: document.querySelectorAll('h2').length,
    h3: document.querySelectorAll('h3').length,
    kpiCards: document.querySelectorAll('[data-kpi-card]').length,
  }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const results = {}

for (const route of ROUTES) {
  results[route] = {}
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    })
    const page = await context.newPage()

    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    const measured = await page.evaluate(collect)

    // Compressed transfer, from Resource Timing, which is the convention
    // UX-2B-BASELINE.md §4 recorded. `document` is the navigation entry.
    const bytes = await page.evaluate(() => {
      const acc = { html: 0, js: 0, css: 0, font: 0, other: 0 }
      const add = (kind, n) => {
        acc[kind] += n
      }
      const nav = performance.getEntriesByType('navigation')[0]
      if (nav !== undefined) add('html', nav.transferSize)
      for (const entry of performance.getEntriesByType('resource')) {
        const size = entry.transferSize
        if (size === 0) continue
        const name = entry.name
        if (entry.initiatorType === 'script' || /\.js(\?|$)/.test(name)) add('js', size)
        else if (entry.initiatorType === 'css' || /\.css(\?|$)/.test(name)) add('css', size)
        else if (/\.(woff2?|ttf|otf)(\?|$)/.test(name)) add('font', size)
        else add('other', size)
      }
      return acc
    })
    results[route][vp.name] = {
      ...measured,
      overflow: measured.scrollWidth > measured.clientWidth,
      bytes: { ...bytes, total: bytes.html + bytes.js + bytes.css + bytes.font + bytes.other },
    }
    await context.close()
  }
}

await browser.close()
writeFileSync(OUT, JSON.stringify(results, null, 2))

for (const [route, byViewport] of Object.entries(results)) {
  for (const [vp, m] of Object.entries(byViewport)) {
    console.log(
      [
        route.padEnd(30),
        vp.padEnd(8),
        `h=${String(m.height).padStart(6)}`,
        `figs=${String(m.figures).padStart(3)}`,
        `1stVP=${String(m.figuresInFirstViewport).padStart(2)}`,
        `firstY=${String(m.firstFigureY ?? '-').padStart(6)}`,
        `repo=${String(m.proseRepoWords).padStart(4)}w/${String(m.proseRepoParagraphs).padStart(2)}p`,
        `eye=${String(m.proseEyeWords).padStart(4)}w/${String(m.proseEyeParagraphs).padStart(3)}p`,
        `tbl=${m.tables}`,
        `det=${m.details}`,
        `vr=${m.visualRegions}`,
        `ovf=${m.overflow ? 'YES' : 'no'}`,
        `kB=${(m.bytes.total / 1000).toFixed(1)}`,
      ].join('  ')
    )
  }
}
