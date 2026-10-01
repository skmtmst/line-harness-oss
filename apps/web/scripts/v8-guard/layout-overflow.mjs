/*
 * 7ページを v7 / v8 × 1152・1440・1920 で開き、崩れを数える。1つでもあれば終了コード 1。
 *
 *   node apps/web/scripts/v8-guard/layout-overflow.mjs <baseUrl> [out.json]
 *
 * 数えるもの（V6 で崩れたのは 1152 付近。絵の幅の数字をそのまま写したため）
 *   page-x     : ページ全体が横に送れる（AGENTS.md：PC は原則横スクロールなし）
 *   overflow   : 中身が枠からはみ出している（… でも横送りでもない）
 *   out-of-main: 白い板（main）の右端より外へ出た部品
 *   no-title   : … で切っているのに title も aria-label も無い（全文を確かめられない）
 * 数えないもの
 *   main より内側の横送りの枠（overflow-x: auto/scroll か [data-scroll-x]）の中。
 *   main 自体は縦スクロールの枠なので含めない（含めると全部が除外されて 0 になる。
 *   わざと壊した部品を差し込む対照試験で発覚した）
 *   読み上げ専用の sr-only（1px）
 * STRESS=1 を付けると、開いたあと main の中の短い文字を長く・数を大きくしてから測る（報告だけ。終了コードは変えない）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'
import { ROUTES, WIDTHS, openPage } from './browser-env.mjs'

const [baseUrl = 'http://127.0.0.1:4310', out] = process.argv.slice(2)
const STRESS = process.env.STRESS === '1'

const scan = () => {
  const main = document.querySelector('main') || document.body
  const mr = main.getBoundingClientRect()
  const label = (e) => {
    const t = (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    const c = typeof e.className === 'string' ? e.className.split(' ')[0].replace(/__[A-Za-z0-9_-]{5}$/, '') : ''
    return `${e.tagName.toLowerCase()}${c ? `.${c}` : ''}「${t}」`
  }
  const inScroll = (e) => {
    for (let p = e.parentElement; p && p !== main && p !== document.body; p = p.parentElement) {
      if (p.hasAttribute('data-scroll-x')) return true
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }
  const res = { pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overflow: [], outOfMain: [], noTitle: [] }
  for (const e of main.querySelectorAll('*')) {
    const r = e.getBoundingClientRect()
    if (r.width <= 1 || r.height <= 1) continue
    const cs = getComputedStyle(e)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (inScroll(e)) continue
    if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) {
      if (!e.title && !e.getAttribute('aria-label') && !e.closest('[title]')) res.noTitle.push(label(e))
      continue
    }
    const ox = cs.overflowX
    if ((ox === 'visible' || ox === 'hidden' || ox === 'clip') && e.scrollWidth > e.clientWidth + 1 && e.children.length === 0) {
      res.overflow.push(`${label(e)} ${e.scrollWidth}/${e.clientWidth}`)
    }
    if (r.right > mr.right + 1 && cs.position !== 'fixed') res.outOfMain.push(`${label(e)} +${Math.round(r.right - mr.right)}`)
  }
  for (const k of ['overflow', 'outOfMain', 'noTitle']) res[k] = [...new Set(res[k])]
  return res
}

const stress = () => {
  const m = document.querySelector('main')
  if (!m) return
  const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT)
  const ns = []
  while (w.nextNode()) ns.push(w.currentNode)
  for (const n of ns) {
    const t = n.textContent ?? ''
    const tr = t.trim()
    if (!tr || tr.length > 40) continue
    const pe = n.parentElement
    if (!pe || pe.closest('script,style,svg,[aria-hidden=true]')) continue
    if (/^[\d,.%+−-]+[人件枠通円%]?$/.test(tr)) n.textContent = t.replace(/\d[\d,]*/, '1,234,567')
    else if (tr.length >= 2) n.textContent = t.replace(tr, `${tr}とても長い名前のサンプルです${tr}`)
  }
}

const browser = await chromium.launch()
const res = {}
let bad = 0
for (const theme of ['v7', 'v8']) {
  for (const width of WIDTHS) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const page = await openPage(browser, { baseUrl, route, width, theme })
      if (STRESS) { await page.evaluate(stress); await page.waitForTimeout(300) }
      const r = await page.evaluate(scan)
      await page.close()
      res[`${theme} ${width} ${name}`] = r
      const n = (r.pageX ? 1 : 0) + r.overflow.length + r.outOfMain.length + r.noTitle.length
      if (n) {
        bad += n
        console.log(`崩れ ${theme} ${width} ${route}`, JSON.stringify({ pageX: r.pageX, overflow: r.overflow.slice(0, 5), outOfMain: r.outOfMain.slice(0, 5), noTitle: r.noTitle.slice(0, 5) }))
      }
    }
  }
}
await browser.close()
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(res, null, 1)) }
console.log(`${STRESS ? '長いデータで ' : ''}崩れの合計 ${bad}`)
if (bad && !STRESS) process.exit(1)
