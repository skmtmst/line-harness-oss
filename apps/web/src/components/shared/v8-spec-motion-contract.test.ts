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

  it('①④ 表の行は上から順に少しずつ（200ms・40msずらし・4行目以降同時）', () => {
    const css = read('../../app/globals.css')
    expect(css).toMatch(/\[data-theme="v8"\] tbody > tr \{\s*animation:\s*v8-content-in var\(--motion-base\)/s)
    expect(css).toMatch(/tbody > tr:nth-child\(2\) \{\s*animation-delay:\s*40ms/s)
    expect(css).toMatch(/tbody > tr:nth-child\(n \+ 4\) \{\s*animation-delay:\s*120ms/s)
  })
})
