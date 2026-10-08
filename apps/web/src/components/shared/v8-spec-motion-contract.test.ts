import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/*
 * ★V8 仕上げ3回目（M10）の動きの契約。値は --motion-* だけ、
 * V8（[data-theme='v8']／[data-theme="v8"]）だけ、減らす設定では
 * 出さない（opacity だけ・または無し）。
 */
describe('V8 仕上げ3回目の動き', () => {
  it('② 切替は120ms・--motion-*（タブの下線・切り替え・絞り込みの札）', () => {
    const tabs = read('./tabs.module.css')
    expect(tabs).toMatch(/transform var\(--motion-fast\) var\(--motion-ease-out\)/s)
    const segmented = read('./segmented.module.css')
    expect(segmented).toMatch(/\[data-theme='v8'\] \.thumb \{[^}]*transform var\(--motion-fast\) var\(--motion-ease-out\)/s)
    const chip = readFileSync(new URL('./filter-chip.css', import.meta.url), 'utf8')
    expect(chip).toMatch(/\[data-theme='v8'\] \.v6-filter-chip \{[^}]*background-color var\(--motion-fast\) var\(--motion-ease-out\)/s)
  })

  it('③ 知らせは200msで入り4秒で消える・ボタンは押した瞬間に保存中（見直し・直し不要の確認）', () => {
    const toast = read('./toast.module.css')
    expect(toast).toMatch(/\[data-theme='v8'\] \.toast \{\s*animation:\s*toast-v8-enter var\(--motion-base\)/s)
    expect(toast).toMatch(/--toast-duration:\s*4000ms/)
    // 消える側に 120ms の逆再生を足すと、4秒・5秒・⌘Z の即時除去の
    // 契約が崩れるため入れない（toast.test.tsx が保証）。
    const button = readFileSync(new URL('./button.tsx', import.meta.url), 'utf8')
    expect(button).toMatch(/disabled=\{disabled \|\| busyNow\}/)
    expect(button).toMatch(/aria-busy=\{busyNow \? true : undefined\}/)
    expect(button).toMatch(/busyLabel = '保存中…'/)
  })

  it('⑤ プルダウンの開いた中身は提案 F で 150ms（StFE7・B-45）。候補つき入力は200ms・色・暦ポップは120msのまま。「…」は 120ms', () => {
    // 1つ選ぶプルダウンの開いた中身は共通部品 select-menu。150ms・動きを減らす設定では動かさない。
    const selectMenu = readFileSync(new URL('./select-menu.module.css', import.meta.url), 'utf8')
    expect(selectMenu).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.surface \{\s*animation: select-menu-enter var\(--select-menu-enter\) var\(--motion-ease-out\)/s)
    const globals = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
    expect(globals).toMatch(/--select-menu-enter:\s*150ms/)
    // 「…」のメニューは動きの決まり（提案 F・採用）で押した角から 120ms・0.96→1。
    // 起点と縮みは v8-motion-root-causes.test.tsx が見る。
    const menu = readFileSync(new URL('./action-menu.module.css', import.meta.url), 'utf8')
    expect(menu).toContain('animation: action-menu-v8-enter var(--motion-fast) var(--motion-ease-out)')
    // 選ぶ箱は名前＋長さの分離指定（combobox-v8-in・motion-base）。
    const combo = readFileSync(new URL('./combobox.module.css', import.meta.url), 'utf8')
    expect(combo).toMatch(/animation-duration:\s*var\(--motion-base\)/s)
    const multi = readFileSync(new URL('./multi-select.module.css', import.meta.url), 'utf8')
    expect(multi).toMatch(/\[data-theme='v8'\] \.popup \{[^}]*animation-duration:\s*var\(--motion-base\)/s)
    // 色を選ぶポップ・暦は正本（MOTION.md）どおり 120ms のまま変えない。
    const color = readFileSync(new URL('./color-well.module.css', import.meta.url), 'utf8')
    expect(color).toMatch(/animation:\s*color-well-pop var\(--motion-fast\)/)
    const date = readFileSync(new URL('./date-field.module.css', import.meta.url), 'utf8')
    expect(date).toMatch(/animation:\s*date-field-in var\(--motion-fast\)/)
  })

  it('④ 消える行は150msで薄くなる（leaving 受け口あり・渡さなければ不変）', () => {
    const css = read('./data-table.module.css')
    expect(css).toMatch(/\[data-theme='v8'\] \.row\[data-leaving='true'\] \{[^}]*opacity:\s*0/s)
    expect(css).toMatch(/transition:\s*opacity var\(--motion-exit\) var\(--motion-ease-out\)/s)
    const tsx = readFileSync(new URL('./table.tsx', import.meta.url), 'utf8')
    expect(tsx).toMatch(/data-leaving=\{leaving \|\| undefined\}/)
  })

  it('①④ 表の行は上から順に少しずつ（200ms・40msずらし・4行目以降同時）。初回だけ・消える行には当てない', () => {
    const css = read('../../app/globals.css')
    expect(css).toMatch(/\[data-theme="v8"\] tbody:not\(\[data-rows-settled\]\) > tr:not\(\[data-leaving="true"\]\) \{\s*animation:\s*v8-content-in var\(--motion-base\)/s)
    expect(css).toMatch(/--motion-stagger:\s*40ms;/)
    expect(css).toMatch(/tbody:not\(\[data-rows-settled\]\) > tr:nth-child\(2\) \{\s*animation-delay:\s*var\(--motion-stagger\)/s)
    expect(css).toMatch(/tbody:not\(\[data-rows-settled\]\) > tr:nth-child\(n \+ 4\) \{\s*animation-delay:\s*calc\(var\(--motion-stagger\) \* 3\)/s)
  })
})
