import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3111'
const route = process.argv[2]
const out = process.argv[3]
const width = Number(process.env.W ?? 1440)
const height = Number(process.env.H ?? 900)
const full = process.env.FULL === '1'

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width, height } })
await page.goto(BASE + route, { waitUntil: 'networkidle' })
await page.screenshot({ path: out, fullPage: full })
await browser.close()
console.log('wrote', out)
