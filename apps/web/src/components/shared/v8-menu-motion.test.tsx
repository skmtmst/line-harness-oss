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
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MenuPortal from './menu-portal'

const WEB = process.cwd()
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const menuCss = readFileSync(join(WEB, 'src/components/shared/action-menu.module.css'), 'utf8')

/** 「選択子 { 中身 }」の組。注釈は先に外す。 */
function rules(css: string) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // 中身に { を含まない一番内側の規定だけを拾う（@media の中の規定も選択子ごと取れる）。
  return [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
}

afterEach(() => cleanup())

describe('③ 「…」のメニューの開き方', () => {
  it('層の外の旧い開く動き（lh-surface-in）は v7 の「…」だけに当たる（V8 には当てない）', () => {
    const hits = rules(globals).filter((r) => /animation:\s*lh-surface-in/.test(r.body))
    const menuSelectors = hits
      .flatMap((r) => r.selector.split(','))
      .map((s) => s.trim())
      .filter((s) => s.includes('[data-design-part="action-menu"]'))
    expect(menuSelectors.length).toBeGreaterThan(0) // v7 の動きは残す
    for (const selector of menuSelectors) expect(selector).toMatch(/^:root:not\(\[data-theme="v8"\]\) /)
  })

  it('V8 は押した角から 120ms・0.96→1 で開く（提案 F）', () => {
    expect(menuCss).toMatch(/\[data-theme='v8'\] \.menu \{\s*animation:\s*action-menu-v8-enter var\(--motion-fast\) var\(--motion-ease-out\);\s*transform-origin:\s*top right;/)
    expect(menuCss).toMatch(/@keyframes action-menu-v8-enter \{\s*from \{\s*opacity:\s*0;\s*transform:\s*scale\(0\.96\);/)
    expect(menuCss).toMatch(/\[data-placement='up'\] > \.menu \{\s*transform-origin:\s*bottom right;/)
    expect(menuCss).toMatch(/\[data-align='start'\] > \.menu \{\s*transform-origin:\s*top left;/)
    expect(menuCss).toMatch(/\[data-placement='up'\]\[data-align='start'\] > \.menu \{\s*transform-origin:\s*bottom left;/)
  })

  it('器は開いた向きと寄せを印で渡す（起点を決めるため）', () => {
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    render(
      <MenuPortal open getAnchor={() => anchor} onClose={() => {}} align="start">
        <div>中身</div>
      </MenuPortal>,
    )
    const portal = document.querySelector('[data-menu-portal]')
    expect(portal?.getAttribute('data-align')).toBe('start')
    expect(portal?.getAttribute('data-placement')).toMatch(/^(down|up)$/)
    anchor.remove()
  })
})
