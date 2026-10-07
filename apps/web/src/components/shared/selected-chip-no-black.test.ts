import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 黒をなくす（#4・オーナー「黒がいや」）：選んだ札6か所は白＋緑
 * （地 accent-soft・枠と字 accent-deep）でそろえる。黒（ink地）の
 * 札に戻さないための歯止め。6か所のどれかが外れたら落ちる。
 *
 * 2026-10-07：一斉配信の一覧（broadcasts/list-v8.module.css）と友だち追加の編集
 * （friend-add-settings/editor-v8.module.css）の2か所は、入口が src/v8 に替わり描かれなくなった
 * ので見張りを外した。src/v8 の新しい画面は選んだ札を共通の札（下の XGJDa の墨地）と同じ形で描く
 * （絵が正本）ので、白＋緑には付け替えられない。
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

  it('共通のV8札は書き出し正本 XGJDa の墨地・白文字に合わせる', () => {
    const css = readFileSync(join(HERE, 'filter-chip.css'), 'utf8')
    // 2026-10-05 controls：共通部品は最新の正本HTML優先。画面固有の札はこのレーンでは変更しない。
    const rule = selectedRule(css, /\[data-theme='v8'\] \.v6-filter-chip\[aria-pressed='true'\] \{[^}]*\}/s, 'shared')
    expect(rule).toMatch(/background:\s*var\(--color-ink\)/)
    expect(rule).toMatch(/color:\s*var\(--color-on-accent\)/)
  })
})
