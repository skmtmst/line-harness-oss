// @vitest-environment happy-dom
/*
 * V8 移行で崩れる原因③④（動き）。
 *
 * ③ 層の外の旧い開く動き（globals の lh-surface-in）が「…」のメニューに当たり、
 *    部品の V8 の動き（押した角から 120ms・0.96→1。提案 F）に必ず勝っていた。
 *    → v7 だけに限る。v7 の動きは残す。
 * ④ 表の行の登場（animation … both）の保持値 opacity:1 が、消える行の
 *    opacity:0 に勝って行が薄くならなかった。また行の順番出しが更新のたびに走った。
 *    → 消える行には当てない・最初の1回だけ（tbody に data-rows-settled）。
 *
 * 実ブラウザの見え方は scripts の Playwright 確認で見る。ここは CSS の当たり方と
 * 「済み」の付け方を見張る。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { settleRowEntrance } from './row-entrance-settle'

const WEB = process.cwd()
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')

/** 「選択子 { 中身 }」の組。注釈は先に外す。 */
function rules(css: string) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // 中身に { を含まない一番内側の規定だけを拾う（@media の中の規定も選択子ごと取れる）。
  return [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
}

afterEach(() => cleanup())

describe('④ 表の行の登場と退場', () => {
  it('登場の動きは消える行に当てない・済みの tbody に当てない・動きを減らす設定では当てない', () => {
    const block = globals.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-theme="v8"\] tbody[\s\S]*?\n\}/)
    expect(block, '行の登場の規定が no-preference の中に無い').not.toBeNull()
    const trRules = rules(globals).filter((r) => /tbody[^,{]*>\s*tr/.test(r.selector) && /animation(-delay)?:/.test(r.body))
    expect(trRules.length).toBeGreaterThan(0)
    for (const rule of trRules) expect(rule.selector).toContain('tbody:not([data-rows-settled])')
    const entering = trRules.filter((r) => /animation:\s*v8-content-in/.test(r.body))
    expect(entering.length).toBe(1)
    expect(entering[0].selector).toContain('tr:not([data-leaving="true"])')
  })

  function table(rows: string[]) {
    const tableEl = document.createElement('table')
    const body = document.createElement('tbody')
    for (const html of rows) {
      const tr = document.createElement('tr')
      tr.innerHTML = html
      // 試験の偽 DOM では動きの API を使わず「最後の行の終わり」で判定させる。
      Object.defineProperty(tr, 'getAnimations', { value: undefined })
      body.appendChild(tr)
    }
    tableEl.appendChild(body)
    document.body.appendChild(tableEl)
    return body
  }

  it('最後の行の登場が終わったら tbody を済みにする（途中の行では付けない）', () => {
    const body = table(['<td>1</td>', '<td>2</td>', '<td>3</td>'])
    const rows = Array.from(body.children)
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: rows[0] })).toBe(false)
    expect(body.hasAttribute('data-rows-settled')).toBe(false)
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: rows[2] })).toBe(true)
    expect(body.hasAttribute('data-rows-settled')).toBe(true)
  })

  it('読み込み中・空の行の登場では済みにしない（続いて載る本当の行を順番出しする）', () => {
    const body = table(['<td><div role="status">読み込み中</div></td>'])
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: body.children[0] })).toBe(false)
    const skeleton = table(['<td><span data-skeleton=""></span></td>'])
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: skeleton.children[0] })).toBe(false)
  })

  it('ほかの動き（骨組みの光など）や行でない要素では何もしない', () => {
    const body = table(['<td>1</td>'])
    expect(settleRowEntrance({ animationName: 'v8-skeleton-shimmer', target: body.children[0] })).toBe(false)
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: body.querySelector('td') })).toBe(false)
    expect(body.hasAttribute('data-rows-settled')).toBe(false)
  })
})
