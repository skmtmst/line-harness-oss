import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 保存がぶつかったときの帯は共通の save-conflict を使う（2026-10-07 動きの点検の残り）。
 * 画面ごとに帯を手組みすると、文言・ボタンの並び・押している間の見た目が画面でずれる。
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCREENS: Array<[string, string]> = [
  ['v8/form-edit/edit.tsx', ''],
  ['app/reminders/new/new-v8.tsx', ''],
  ['app/reminders/edit/edit-v8.tsx', 'k32cn'],
  ['app/tags/edit-tag-page-v8.tsx', 'xn95q'],
  ['v8/tag-edit/edit.tsx', 'xn95q'],
  ['app/templates/edit-v8.tsx', 'NCbYn'],
  ['app/auto-replies/edit/wizard-v8.tsx', 'UGrd2'],
  ['v8/friend-add/editor.tsx', 'h5rm8t'],
  ['app/rich-menus/new/create-v8.tsx', 'r8dGXT'],
  ['app/scenarios/detail/detail-v8.tsx', 'kz2B6'],
  ['v8/common-vars-edit/edit.tsx', 'piWhz'],
  ['v8/conversions/create.tsx', 'cXqlS'],
]

describe('保存がぶつかったときの帯は共通部品', () => {
  it.each(SCREENS)('%s', (file, node) => {
    const source = readFileSync(join(SRC, file), 'utf8')
    expect(source).toContain("from '@/components/shared/save-conflict'")
    expect(source).toContain('<SaveConflictBand')
    if (node) expect(source).toMatch(new RegExp(`<SaveConflictBand[\\s\\S]{0,400}designNode="${node}"`))
    // 帯を手組みしていた頃の印（自前の「違いを比べる」ボタン）が残っていない
    expect(source).not.toMatch(/>\s*\{compareBusy \? '比べています\.\.\.' : '違いを比べる'\}/)
  })
})
