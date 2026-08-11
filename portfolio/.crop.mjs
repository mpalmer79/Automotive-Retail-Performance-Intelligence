import { chromium } from 'playwright'
const BASE='http://127.0.0.1:3111'
const [route, out, y, h] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(h) } })
await page.goto(BASE + route, { waitUntil: 'networkidle' })
await page.evaluate((top) => window.scrollTo(0, top), Number(y))
await page.waitForTimeout(300)
await page.screenshot({ path: out })
await browser.close()
console.log('wrote', out)
