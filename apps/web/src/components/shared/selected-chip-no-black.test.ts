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
 * ので見張りを外した。共通の札は10-11固定版との薄い緑・緑の枠と文字を守る。
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
    const css = readFileSync(new URL('../../app/reminders/wizard-v8.module.css', import.meta.url), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.filterChipOn \{[^}]*\}/s, 'reminders'), 'reminders')
  })

  it('リッチメニューの札', () => {
    const css = readFileSync(new URL('../../app/rich-menus/new/create-v8.module.css', import.meta.url), 'utf8')
    expectWhiteGreen(selectedRule(css, /\.pageChipOn \{[^}]*\}/s, 'rich-menus'), 'rich-menus')
  })

  it('現役V8の予約見本の札は採用済みの墨地・白文字を保つ', () => {
    const css = readFileSync(join(APP, '../v8/booking-menus/settings.module.css'), 'utf8')
    const rule = selectedRule(css, /\.phoneCatNow \{[^}]*\}/s, 'booking')
    expect(rule).toMatch(/background:\s*var\(--color-ink\)/)
    expect(rule).toMatch(/color:\s*var\(--color-canvas\)/)
  })

  it("共通のV8札は10-11固定版との薄い緑・緑の枠と文字に合わせる", () => {
    const css = readFileSync(join(HERE, 'filter-chip.css'), 'utf8')
    const rule = selectedRule(css, /:root \.v6-filter-chip\[aria-pressed='true'\] \{[^}]*\}/s, 'shared')
    expect(rule).toMatch(/background:\s*var\(--color-selection-bg\)/)
    expect(rule).toMatch(/color:\s*var\(--color-selection-border\)/)
    expect(rule).toMatch(/outline-color:\s*var\(--color-selection-border\)/)
    expect(rule).not.toMatch(/var\(--color-ink\)/)
  })
})
