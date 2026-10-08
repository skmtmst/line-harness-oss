/**
 * 全 page.tsx の管理画面の題を1440pxで測る。モックAPI向けの build/out を使う。
 * node scripts/visual-qa/title-audit.mjs <baseUrl> <output.tsv> [--record-only]
 * --route /tags は対照試験用。--inject-20 はその題だけ20pxに壊す（ソースは変えない）。
 * 題の無い画面・別ルートへの予期しない転送も失敗。公開の認証画面と部品見本は対象外。
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = join(ROOT, 'apps/web/src/app')
const SAMPLES = JSON.parse(readFileSync(new URL('./title-audit-routes.json', import.meta.url), 'utf8'))
const PUBLIC = /^\/(?:login|password|register)(?:\/|$)|^\/ops\/(?:login|invite|two-factor)$|^\/staff\/(?:invite|email-change)$|^\/visual-qa\//

export function pageRoutes(dir = APP) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pageRoutes(path)
    if (entry.name !== 'page.tsx') return []
    return ['/' + relative(APP, dir).split('/').filter((part) => !part.startsWith('(')).join('/')]
  }).sort()
}

// 型の題を優先。カード・窓・引き出し・外側の帯の見出しは題に数えない。
export function readTitle(inject20 = false) {
  const visible = (el) => el.getBoundingClientRect().height > 1 && getComputedStyle(el).visibility !== 'hidden'
  const root = document.querySelector('main') || document.body
  const title = [...root.querySelectorAll('[data-template-region="heading"] h1, [data-template-region="heading"] h2')].find(visible)
    || [...root.querySelectorAll('h1, h2')].find((el) => visible(el) && !el.closest('[role="dialog"], aside, [data-template-region="folders"]'))
  if (!title) return null
  if (inject20) {
    // reduced-motion の0.01msの transition が変更前の値を返すのを避ける。
    title.style.setProperty('transition', 'none', 'important')
    title.style.setProperty('font-size', '20px', 'important')
  }
  const css = getComputedStyle(title)
  return {
    text: title.textContent.trim().replace(/\s+/g, ' '), size: css.fontSize, weight: css.fontWeight, lh: css.lineHeight,
    tag: title.tagName, className: title.className, title: title.getAttribute('title'),
    whiteSpace: css.whiteSpace, textOverflow: css.textOverflow,
  }
}

export function titlePasses(title) {
  return !!title && title.size === '22px' && title.weight === '700' && title.lh === '32px'
}

async function openAuditPage(browser, baseUrl, route, errors) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.setFixedTime(new Date('2026-10-01T05:00:00Z'))
  await page.addInitScript(() => {
    const session = { lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K', lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1', 'lh-admin-theme': 'v8' }
    for (const [key, value] of Object.entries(session)) localStorage.setItem(key, value)
  })
  await page.goto(new URL(route, baseUrl).toString())
  await page.waitForTimeout(2500)
  await page.evaluate(() => document.fonts.ready.then(() => true))
  return page
}

async function main() {
  const [baseUrl = 'http://127.0.0.1:4310', output = '/tmp/title-audit.tsv', ...flags] = process.argv.slice(2)
  const only = flags.includes('--route') ? flags[flags.indexOf('--route') + 1] : null
  const routes = pageRoutes().filter((path) => !PUBLIC.test(path) && (!only || path === only))
  if (only && routes.length !== 1) throw new Error(`管理画面のルートが見つかりません: ${only}`)
  const browser = await chromium.launch()
  const rows = []
  try {
    // ローカルもCIも同じ順序・同じ1440px・同じ固定時計。
    let cursor = 0
    const worker = async () => {
      while (cursor < routes.length) {
        const path = routes[cursor++]
        const route = SAMPLES[path] || path
        const errors = []
        let page
        try {
          page = await openAuditPage(browser, baseUrl, route, errors)
          await page.waitForFunction(() => {
            const root = document.querySelector('main') || document.body
            return [...root.querySelectorAll('h1,h2')].some((e) => e.getBoundingClientRect().height > 1)
          }, null, { timeout: 5000 }).catch(() => {})
          const title = await page.evaluate(readTitle, flags.includes('--inject-20'))
          const actual = new URL(page.url()).pathname.replace(/\/$/, '') || '/'
          // 入口だけの転送は宛先を固定して記録する。その他の転送を成功にしない。
          const expected = SAMPLES.aliases?.[path] || path
          const longNameSafe = !/(?:detail|reserved)$/.test(path) || (title?.title === title?.text && title?.whiteSpace === 'nowrap' && title?.textOverflow === 'ellipsis')
          const problem = actual !== expected ? `redirect:${actual}` : errors.length ? errors.join('; ') : !title ? '題なし' : title.text === '画面を表示できませんでした' ? '画面が落ちた' : !longNameSafe ? '詳細の題の省略表示・全文表示が不足' : ''
          const body = problem ? await page.locator('body').innerText() : undefined
          if (flags.includes('--screenshots')) {
            const shotDir = join(dirname(output), 'title-audit-shots')
            mkdirSync(shotDir, { recursive: true })
            await page.screenshot({ path: join(shotDir, (path.replace(/\//g, '-') || 'dashboard') + '.png') })
          }
          rows.push({ route, path, actual, title, problem, body })
          console.log(`${rows.length}/${routes.length} ${route} ${title ? `${title.size}/${title.weight}/${title.lh} ${title.text}` : '題なし'} ${problem}`)
        } catch (error) {
          rows.push({ route, path, title: null, problem: error.message })
          console.log(`${rows.length}/${routes.length} ${route} ERROR ${error.message}`)
        } finally { await page?.close() }
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker))
    rows.sort((a, b) => a.path.localeCompare(b.path))
  } finally { await browser.close() }
  mkdirSync(dirname(output), { recursive: true })
  const cell = (value) => String(value ?? '').replace(/[\t\r\n]/g, ' ')
  writeFileSync(output, 'route\ttitle\tsize\tweight\tlh\n' + rows.map((r) => [r.route, r.title?.text || r.problem, r.title?.size, r.title?.weight, r.title?.lh].map(cell).join('\t')).join('\n') + '\n')
  writeFileSync(output.replace(/\.tsv$/, '') + '.json', JSON.stringify({ viewport: 1440, excluded: pageRoutes().filter((p) => PUBLIC.test(p)), rows }, null, 2) + '\n')
  const bad = rows.filter((r) => r.problem || !titlePasses(r.title))
  console.log(`題の測定: ${rows.length}画面、不一致・測定失敗 ${bad.length}`)
  if (bad.length && !flags.includes('--record-only')) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
