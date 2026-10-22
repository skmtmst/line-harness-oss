// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SlidingIndicator } from './sliding-indicator'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/*
 * ★V8 仕上げ3回目（M10）の動きの契約。値は --motion-* だけ、
 * V8（:root／:root）だけ、減らす設定では
 * 出さない（opacity だけ・または無し）。
 */
describe('V8 仕上げ3回目の動き', () => {
  it('切替と下線は共通の200ms・transformだけで移り、初回は動かない', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
    try {
      const view = render(React.createElement('div', null, React.createElement(SlidingIndicator, { left: 0, width: 100, selection: 'a', className: 'indicator' })))
      expect(animate).not.toHaveBeenCalled()
      view.rerender(React.createElement('div', null, React.createElement(SlidingIndicator, { left: 120, width: 80, selection: 'b', className: 'indicator' })))
      expect(animate).toHaveBeenCalledWith([
        { transform: 'translateX(0px) scaleX(1.25)' },
        { transform: 'translateX(120px) scaleX(1)' },
      ], expect.objectContaining({ duration: 200 }))
      const chip = read('./filter-chip.css')
      expect(chip).toMatch(/:root \.v6-filter-chip \{[^}]*background-color var\(--motion-fast\) var\(--motion-ease-out\)/s)
    } finally {
      cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
      if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    }
  })

  it('③ 知らせは200msで入り4秒で消える・ボタンは押した瞬間に保存中（見直し・直し不要の確認）', () => {
    const toast = read('./toast.module.css')
    expect(toast).toMatch(/:root \.toast \{\s*animation:\s*toast-v8-enter var\(--motion-base\)/s)
    expect(toast).toMatch(/--toast-duration:\s*4000ms/)
    // 消える側に 120ms の逆再生を足すと、4秒・5秒・⌘Z の即時除去の
    // 契約が崩れるため入れない（toast.test.tsx が保証）。
    const button = read('./button.tsx')
    expect(button).toMatch(/disabled=\{disabled \|\| busyNow\}/)
    expect(button).toMatch(/aria-busy=\{busyNow \? true : undefined\}/)
    expect(button).toMatch(/busyLabel = '保存しています…'/)
  })

  it("⑤ プルダウンの開いた中身は提案 F で 150ms（StFE7）。候補つき入力は200ms・色・暦ポップは120msのまま。「…」は 120ms", () => {
    // 1つ選ぶプルダウンの開いた中身は共通部品 select-menu。150ms・動きを減らす設定では動かさない。
    const selectMenu = read('./select-menu.module.css')
    expect(selectMenu).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.surface \{\s*animation: select-menu-enter var\(--select-menu-enter\) var\(--motion-ease-out\)/s)
    const globals = read('../../app/globals.css')
    expect(globals).toMatch(/--select-menu-enter:\s*150ms/)
    // 「…」のメニューは動きの決まり（提案 F・採用）で押した角から 120ms・0.96→1。
    // 起点と縮みは v8-motion-root-causes.test.tsx が見る。
    const menu = read('./action-menu.module.css')
    expect(menu).toContain('animation: action-menu-v8-enter var(--motion-fast) var(--motion-ease-out)')
    // 選ぶ箱は名前＋長さの分離指定（combobox-v8-in・motion-base）。
    const combo = read('./combobox.module.css')
    expect(combo).toMatch(/animation-duration:\s*var\(--motion-base\)/s)
    const multi = read('./multi-select.module.css')
    expect(multi).toMatch(/:root \.popup \{[^}]*animation-duration:\s*var\(--motion-base\)/s)
    // 色を選ぶポップ・暦は正本（MOTION.md）どおり 120ms のまま変えない。
    const color = read('./color-well.module.css')
    expect(color).toMatch(/animation:\s*color-well-pop var\(--motion-fast\)/)
    const date = read('./date-field.module.css')
    expect(date).toMatch(/animation:\s*date-field-in var\(--motion-fast\)/)
  })

  it('④ 消える行は150msで薄くなる（leaving 受け口あり・渡さなければ不変）', () => {
    const css = read('./data-table.module.css')
    expect(css).toMatch(/:root \.row\[data-leaving='true'\] \{[^}]*opacity:\s*0/s)
    expect(css).toMatch(/transition:\s*opacity var\(--motion-exit\) var\(--motion-ease-out\)/s)
    const tsx = read('./table.tsx')
    expect(tsx).toMatch(/data-leaving=\{leaving \|\| undefined\}/)
  })

  it('①④ 表の行は上から順に少しずつ（200ms・40msずらし・4行目以降同時）。初回だけ・消える行には当てない', () => {
    const css = read('../../app/globals.css')
    expect(css).toMatch(/:root tbody:not\(\[data-rows-settled\]\) > tr:not\(\[data-leaving="true"\]\) \{\s*animation:\s*v8-content-in var\(--motion-base\)/s)
    expect(css).toMatch(/--motion-stagger:\s*40ms;/)
    expect(css).toMatch(/tbody:not\(\[data-rows-settled\]\) > tr:nth-child\(2\) \{\s*animation-delay:\s*var\(--motion-stagger\)/s)
    expect(css).toMatch(/tbody:not\(\[data-rows-settled\]\) > tr:nth-child\(n \+ 4\) \{\s*animation-delay:\s*calc\(var\(--motion-stagger\) \* 3\)/s)
  })
})
