import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const TAB = readFileSync(join(DIR, '../../v8/tags', 'tags-tab.tsx'), 'utf8')

/*
 * UX更新 C①〜C③（タグ・友だち情報の欄のV8画面）の禁止の見張り。
 * 行の詳細パネル（URL・↑↓）・右クリックのメニュー・その場の書き換え・確認の窓は
 * v8/tags/detail-panel-behavior.test.tsx が4つの一覧で画面と口の呼び出しから確かめる。
 */
describe('UXタグ2 の禁止の見張り', () => {
  it('タグのフォルダ入力を自前の全面の窓に戻さない', () => {
    expect(TAB).not.toContain('fixed inset-0 z-50')
  })

  it('タグ名に単独の更新口は無いのでその場書き換えは付けない', () => {
    expect(TAB).not.toContain('InlineEdit')
  })
})
