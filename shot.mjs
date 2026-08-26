import { chromium } from '@playwright/test'
const [,, url, out, w] = process.argv
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: Number(w ?? 1440), height: 900 } })
await p.addInitScript(() => { try { sessionStorage.setItem('lh_auth_selection_cleared','1'); localStorage.setItem('lh_selected_account','visual-qa-account') } catch {} })
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const of = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
await p.screenshot({ path: out })
console.log(`${out}  横あふれ=${of}px`)
await b.close()
