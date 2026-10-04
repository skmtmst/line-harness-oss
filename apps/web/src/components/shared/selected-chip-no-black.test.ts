import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 黒をなくす（#4・オーナー「黒がいや」）：選んだ札6か所は白＋緑
 * （地 accent-soft・枠と字 accent-deep）でそろえる。黒（ink地）の
 * 札に戻さないための歯止め。6か所のどれかが外れたら落ちる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..', '..', 'app')

function selectedRule(css: string, pattern: RegExp, file: string): string {
  const hit = css.match(pattern)?.[0]
  expect(hit, `${file} に選んだ札の宣言がありません`).toBeTruthy()
  return hit as string
}

function expectWhiteGreen(rule: string, file: string) {
  expect(rule, file).toMatch(/background:\s*var\(--color-accent-soft\)/)
  expect(rule, file).toMatch(/color:\s*var\(--color-accent-deep\)/)
  expect(rule, file).not.toMatch(/var\(--color-ink\)/)
}

describe('選んだ札6か所は白＋緑（黒をなくす #4）', () => {
  it('一斉配信の札', () => {
    const css = readFileSync(join(APP, 'broadcasts', 'list-v8.module.css'), 'utf8')
    const rule = selectedRule(css, /\.chip\[data-selected='true'\] \{[^}]*\}/s, 'broadcasts')
    expect(rule).toMatch(/border-color:\s*var\(--color-accent-deep\)/)
    expectWhiteGreen(rule, 'broadcasts')
  })

  it('友だち追加の札', () => {
    const css = readFileSync(join(APP, 'friend-add-settings', 'editor-v8.module.css'), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.chipActive \{[^}]*border-color:[^}]*\}/s, 'friend-add'), 'friend-add')
  })

  it('リマインダの札', () => {
    const css = readFileSync(join(APP, 'reminders', 'wizard-v8.module.css'), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.filterChipOn \{[^}]*\}/s, 'reminders'), 'reminders')
  })

  it('リッチメニューの札', () => {
    const css = readFileSync(join(APP, 'rich-menus', 'new', 'create-v8.module.css'), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.pageChipOn \{[^}]*\}/s, 'rich-menus'), 'rich-menus')
  })

  it('予約の札', () => {
    const css = readFileSync(join(APP, 'booking', 'menus', 'settings-v8.module.css'), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.phoneCatNow \{[^}]*\}/s, 'booking'), 'booking')
  })

  it('共通の札', () => {
    const css = readFileSync(join(HERE, 'filter-chip.css'), 'utf8')
    expectWhiteGreen(
      selectedRule(css, /\[data-theme='v8'\] \.v6-filter-chip\[aria-pressed='true'\] \{[^}]*\}/s, 'shared'),
      'shared',
    )
  })
})
