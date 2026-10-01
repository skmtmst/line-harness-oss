/*
 * V8 の見張りのうち「報告だけ」のもの（止めない。結果を PR の Summary に出す）。2026-10-01
 * 今の開発用にまだ直っていないずれがあるため、直るまでは止めずに数だけ見せる。直ったら止める形に変える。
 *
 *   node apps/web/scripts/v8-guard/report-checks.mjs <baseUrl> <out.md> [base の SHA]
 *
 *   高さ      : 並ぶカードの高さ・カードの中のボタンの位置・1行に並ぶ操作の高さがそろっているか（オーナー 2026-10-01）
 *   キーボード: Tab だけで全部の操作に届くか・選んだ所に枠が見えるか（矢印で動くタブ・切り替えは1つ届けばよい）
 *   言葉      : やめた言い方（design/v8/GLOSSARY.md）を、この PR で新しく足していないか
 * 対照：わざと高さ違いのボタン・tabindex=-1・outline:none を入れた画面で、それぞれ数が出ることを手元で確かめた（lh-work/tools の同じ道具）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { ROUTES, openPage } from './browser-env.mjs'

const [baseUrl = 'http://127.0.0.1:4310', out = '/tmp/v8-guard/report.md', baseSha] = process.argv.slice(2)

const rowScan = () => {
  const main = document.querySelector('main') || document.body
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const lab = (e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 16)
  const isCard = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) >= 8 && r.height >= 60 && r.width >= 120 }
  const res = []
  for (const p of main.querySelectorAll('*')) {
    const kids = [...p.children].filter(vis)
    if (kids.length < 2) continue
    const cards = kids.filter(isCard)
    if (cards.length >= 2) {
      const groups = {}
      for (const c of cards) { const t = Math.round(c.getBoundingClientRect().top / 3); (groups[t] ||= []).push(c) }
      for (const g of Object.values(groups)) {
        if (g.length < 2) continue
        const hs = g.map((c) => Math.round(c.getBoundingClientRect().height))
        if (Math.max(...hs) - Math.min(...hs) > 1) res.push(`カードの高さ ${g.map((c, i) => `${lab(c)}:${hs[i]}`).join(' / ')}`)
        const bs = g.map((c) => { const b = [...c.querySelectorAll('button,a[role=button]')].filter(vis).pop(); return b ? Math.round(b.getBoundingClientRect().bottom) : null })
        if (bs.every((x) => x != null) && Math.max(...bs) - Math.min(...bs) > 1) res.push(`ボタンの位置 ${g.map((c, i) => `${lab(c)}:${bs[i]}`).join(' / ')}`)
      }
    }
    const ctrls = kids.filter((e) => { const r = e.getBoundingClientRect(); const tag = e.tagName.toLowerCase(); const role = e.getAttribute('role'); return r.height >= 28 && r.height <= 44 && (['button', 'select', 'input'].includes(tag) || role === 'combobox' || e.querySelector('select,input:not([type=checkbox]):not([type=radio])')) && role !== 'tab' })
    if (ctrls.length >= 2) {
      const rows = {}
      for (const c of ctrls) { const r = c.getBoundingClientRect(); const k = Math.round((r.top + r.height / 2) / 4); (rows[k] ||= []).push(c) }
      for (const g of Object.values(rows)) { if (g.length < 2) continue; const hs = g.map((c) => Math.round(c.getBoundingClientRect().height)); if (Math.max(...hs) - Math.min(...hs) > 1) res.push(`1行の操作の高さ ${g.map((c, i) => `${lab(c)}:${hs[i]}`).join(' / ')}`) }
    }
  }
  return [...new Set(res)]
}

const pick = (s) => [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join('|')
async function keyboard(page) {
  const total = await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    let i = 0
    for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || e.closest('[inert],[aria-hidden=true]')) continue
      if (/^(tab|radio|option|menuitem|treeitem|gridcell)$/.test(e.getAttribute('role') || '') && e.getAttribute('tabindex') === '-1') continue
      if (e.matches('input[type=radio]') && !e.checked && document.querySelector(`input[type=radio][name="${e.name}"]:checked`)) continue
      e.dataset.kbId = String(i++) }
    return i })
  const seen = new Set(); const noRing = []
  await page.mouse.click(1, 1)
  for (let k = 0; k < 250; k++) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate((pickSrc) => { const pick = new Function(`return ${pickSrc}`)(); const e = document.activeElement; if (!e || e === document.body) return null
      const chain = [e, e.parentElement, e.parentElement?.parentElement].filter(Boolean)
      const on = chain.map((x) => pick(getComputedStyle(x))).join('/') + ['::before', '::after'].map((x) => pick(getComputedStyle(e, x))).join('#')
      e.blur(); const off = chain.map((x) => pick(getComputedStyle(x))).join('/') + ['::before', '::after'].map((x) => pick(getComputedStyle(e, x))).join('#')
      return { id: e.dataset.kbId ?? null, name: (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 20), same: on === off } }, pick.toString())
    if (!f) continue
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    const key = f.id ?? f.name
    if (seen.has(key)) break
    seen.add(key); if (f.same) noRing.push(f.name)
  }
  const missing = await page.evaluate((ids) => [...document.querySelectorAll('[data-kb-id]')].filter((e) => !ids.includes(e.dataset.kbId)).map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 20)), [...seen])
  return { total, missing, noRing }
}

const lines = ['## V8 の見張り（報告だけ・止めない）', '']
const browser = await chromium.launch()
// 高さとキーボード（v8・1440）
const rowsOut = [], kbOut = []
for (const [name, route] of Object.entries(ROUTES)) {
  const page = await openPage(browser, { baseUrl, route, width: 1440, theme: 'v8' })
  for (const r of await page.evaluate(rowScan)) rowsOut.push(`- ${name}：${r}`)
  const kb = await keyboard(page)
  if (kb.missing.length) kbOut.push(`- ${name}：Tab で届かない ${kb.missing.length}（${kb.missing.slice(0, 5).join('・')}）`)
  if (kb.noRing.length) kbOut.push(`- ${name}：選んでも枠が見えない ${kb.noRing.length}（${kb.noRing.slice(0, 5).join('・')}）`)
  await page.close()
}
lines.push(`### 高さ（v8・1440）：${rowsOut.length} 件`, ...rowsOut, '', `### キーボード（v8・1440）：${kbOut.length} 件`, ...kbOut, '')
await browser.close()
// 言葉（この PR で足した行だけ）
const RULES = [['直す', '編集'], ['編集する', '編集'], ['変更する', '編集'], ['コピー', '〇〇をコピー／複製する'], ['コピーする', '複製する'], ['複製', '複製する'], ['さらに詳しく', 'すべて見る →'], ['詳細を見る', 'すべて見る →／開く'], ['スタッフを登録する', 'スタッフを追加する'], ['スタッフを作る', 'スタッフを追加する'], ['見るだけ', '閲覧のみ'], ['担当者', 'スタッフ（受け持つ人は「担当」）'], ['運用担当', 'スタッフ'], ['統括', 'オーナー']]
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RE = new RegExp(`(['"\`>])\\s*(${RULES.map(([w]) => esc(w)).sort((a, b) => b.length - a.length).join('|')})\\s*(['"\`<{])`, 'g')
const words = []
if (baseSha) {
  const diff = execSync(`git diff -U0 ${baseSha}...HEAD -- apps/web/src`, { encoding: 'utf8', maxBuffer: 64 << 20 })
  let file = null
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(6); continue }
    if (!l.startsWith('+') || !file || !/\.(tsx?|jsx?)$/.test(file) || /\.test\./.test(file) || /^\+\s*(\/\/|\*)/.test(l)) continue
    let m; RE.lastIndex = 0
    while ((m = RE.exec(l))) { if ((m[1] === '>' && !'<{'.includes(m[3])) || (m[1] !== '>' && m[1] !== m[3])) continue; words.push(`- ${file}：「${m[2]}」→「${new Map(RULES).get(m[2])}」`) }
  }
}
lines.push(`### やめた言葉を新しく足した：${baseSha ? words.length + ' 件' : '比べる相手なし'}`, ...words, '')
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, lines.join('\n') + '\n')
console.log(lines.join('\n'))
