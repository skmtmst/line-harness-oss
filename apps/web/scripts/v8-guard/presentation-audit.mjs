/** 管理画面の全入口を3幅で読み、左右余白・操作配置・フォルダの丸を記録する。 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { openPage } from './browser-env.mjs'
import scanEdges from './edge-inset-browser.mjs'
import scanOwner from './owner-rules-browser.mjs'

const [baseUrl, out] = process.argv.slice(2)
if (!baseUrl || !out) throw new Error('presentation-audit.mjs <baseUrl> <outDir>')
mkdirSync(out, { recursive: true })
const map = JSON.parse(readFileSync(new URL('../../../../scripts/visual-qa/v8-design-map.json', import.meta.url)))
const known = [...new Set(Object.values(map.boards).filter(b => b.app !== 'liff' && !b.state?.manual).map(b => b.url || b.route).filter(r => r?.startsWith('/')))]
const pages = []
function walk(dir, parts = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name), [...parts, entry.name])
    else if (entry.name === 'page.tsx' && !parts.some(p => p.startsWith('['))) pages.push('/' + parts.filter(p => !p.startsWith('(')).join('/'))
  }
}
walk(fileURLToPath(new URL('../../src/app', import.meta.url)))
// 各入口は既存の固定URL（idを含む）で開く。まだ地図にない入口も省かない。
const routes = [...known, ...pages.filter(path => !known.some(r => r.split('?')[0] === path))]
const selected = process.env.PRESENTATION_ROUTES?.split(',') ?? routes
const browser = await chromium.launch()
const rows = []
try {
  for (const width of [1024, 1152, 1440]) for (const route of selected) {
    let page
    try {
      const errors = []
      page = await openPage(browser, { baseUrl, route, width, stable: true, settleMs: 0, requireSuccess: true, onPageError: e => errors.push(e.message) })
      await page.waitForFunction(() => document.querySelector('main h1,main h2') || /画面を表示できませんでした/.test(document.body.innerText), undefined, { timeout: 5000 })
      await page.waitForLoadState('networkidle')
      const inventory = await page.evaluate(() => {
        const main = document.querySelector('main')
        const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert]')
        const text = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ')
        const all = selector => [...(main ?? document).querySelectorAll(selector)].filter(visible)
        const names = all('[data-list-folders="true"] [data-list-name]')
        return {
          title: all('[data-template-region="heading"] h1,[data-template-region="heading"] h2,[data-page-title]')[0]?.textContent ?? null,
          bands: all('[data-kpi-strip]').length, cards: all('[data-design-part="card"]').length, tables: all('table').length,
          notices: all('[role="alert"],[data-design-part="notice"]').length, tools: all('[data-template-region="toolbar"]').length,
          folders: all('[data-list-folders="true"]').length,
          names: names.length, missingDots: names.filter(el => !el.querySelector('[data-folder-dot]')).map(text),
          filedDots: all('[data-folder-dot="filed"]').length, unfiledDots: all('[data-folder-dot="unfiled"]').length,
          headingActions: all('[data-template-region="heading"] [data-page-heading-actions]').map(el => text(el)),
          footerActions: all('[data-sticky-actions]').map(el => [...el.querySelectorAll('button,a')].filter(visible).map(text)),
          empty: /読み込めません|見つかりません|選んでください/.test(main?.textContent ?? ''),
        }
      })
      const findings = [...await page.evaluate(scanEdges), ...await page.evaluate(scanOwner)]
      rows.push({ width, route, finalPath: new URL(page.url()).pathname, ...inventory, errors, findings })
      console.log(`${width} ${route} : ${inventory.title ?? '題なし'} / 指摘${findings.length} / 丸の不足${inventory.missingDots.length}`)
      if (/^\/(tags|accounts|templates|friends|booking|bookings|webhooks|nen-members|hq\/store-comparison)(\/|\?|$)/.test(route)) {
        const slug = route.slice(1).replaceAll('/', '-').replace(/[?=&]/g, '-')
        await page.screenshot({ path: join(out, `${width}-${slug}.png`), fullPage: true })
      }
    } catch (error) { rows.push({ width, route, error: error.message }); console.error(width, route, error.message) }
    finally { await page?.close() }
    writeFileSync(join(out, 'presentation.json'), JSON.stringify(rows, null, 2) + '\n')
  }
} finally { await browser.close() }
writeFileSync(join(out, 'presentation.md'), '| 幅 | 画面 | 帯/カード/表/知らせ/道具 | 端・重なり・操作の指摘 | 名前/丸の不足 |\n|---|---|---|---|---|\n' + rows.map(r => `| ${r.width} | ${r.route} | ${r.error ? '測定失敗' : [r.bands,r.cards,r.tables,r.notices,r.tools].join('/')} | ${r.error ?? r.findings.length} | ${r.names ?? '—'}/${r.missingDots?.length ?? '—'} |`).join('\n') + '\n')
if (rows.some(r => r.error || r.errors.length || r.findings.length || r.missingDots.length)) process.exitCode = 1
