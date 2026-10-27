import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { expect, it } from 'vitest'

/*
 * 「乗せた時だけ出す」物の決まり（見直し R6）。
 * マウスを乗せた時に出す物は、キーボードの焦点でも出し、タッチの端末（乗せられない）では常に出す。
 * 押せる場所と広さは消さない（見えなくするのは不透明度だけ）。
 *
 * 見る所：`:hover` で opacity を 0.5 より上・visibility を visible にするルール。
 * - 同じルールに `:focus-within`・`:focus-visible`・`:focus` のどれかが要る
 * - 同じファイルに `@media (hover: none)` が要る
 * 下の「直す途中」は持ち主へ頼んだファイル。直し終えたら外す（足さない）。
 */
const migrating = new Set([
  'components/shared/folder-panel.module.css',
  'components/shared/reservation-board.module.css',
  'components/shared/table-presentation.module.css',
])

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES: Array<{ p: string; s: string }> = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.css')) FILES.push({ p: relative(SRC, p), s: readFileSync(p, 'utf8') })
  }
}
walk(SRC)

/** 乗せた時だけ出すのに、焦点かタッチの端末で出ない所があるか。 */
export function hoverOnly(css: string): boolean {
  const root = postcss.parse(css)
  let reveals = false
  let missingFocus = false
  root.walkRules((rule) => {
    if (!/:hover/.test(rule.selector)) return
    let shows = false
    rule.walkDecls((d) => { if ((d.prop === 'opacity' && Number(d.value) > 0.5) || (d.prop === 'visibility' && d.value === 'visible')) shows = true })
    if (!shows) return
    reveals = true
    if (!/:focus-within|:focus-visible|:focus\b/.test(rule.selector)) missingFocus = true
  })
  let touch = false
  root.walkAtRules('media', (at) => { if (/hover:\s*none/.test(at.params)) touch = true })
  return reveals && (missingFocus || !touch)
}

it('乗せた時だけ出す物は、焦点でもタッチの端末でも出す', () => {
  const hits = FILES.filter((f) => !migrating.has(f.p) && hoverOnly(f.s)).map((f) => f.p)
  expect(hits, '同じルールに :focus-visible か :focus-within を足し、@media (hover: none) で常に出す').toEqual([])
})

it('見分け方：焦点とタッチの両方がそろった時だけ通す', () => {
  const ok = '.a{opacity:0}.row:hover .a,.a:focus-visible{opacity:1}@media (hover: none){.a{opacity:1}}'
  expect(hoverOnly(ok)).toBe(false)
  expect(hoverOnly('.a{opacity:0}.row:hover .a{opacity:1}@media (hover: none){.a{opacity:1}}')).toBe(true)
  expect(hoverOnly('.a{opacity:0}.row:hover .a,.a:focus-visible{opacity:1}')).toBe(true)
  expect(hoverOnly('.row:hover{background:red}')).toBe(false)
})
