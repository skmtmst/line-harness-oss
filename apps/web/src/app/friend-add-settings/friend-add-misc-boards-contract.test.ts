import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR = readFileSync(join(HERE, '../../v8/friend-add/editor.tsx'), 'utf8')
const CONFLICT = readFileSync(join(HERE, '../../components/shared/save-conflict.tsx'), 'utf8')
const CONFLICT_CSS = readFileSync(join(HERE, '../../components/shared/save-conflict.module.css'), 'utf8')

/*
 * V8 友だち追加時の配信の細かい板（・）。
 * テスト段の確認は同じ画面の状態として板IDを付け、
 * 編集の競合は帯で知らせて書き換えない。互換経路は変えない。
 */
describe('友だち追加時の配信の細かい板', () => {
  it('テスト条件を指定でき、実際の友だちへ送らないと説明する', () => {
    expect(EDITOR).toContain('title="テストの条件"')
    expect(EDITOR).toContain('<FriendPickerField')
    expect(EDITOR).toContain('label="想定日時"')
    expect(EDITOR).toContain('実際の友だちへは送信しません')
  })

  it('編集の競合は帯・比べる・読み直しを出す（h5rm8t）', () => {
    expect(EDITOR).toContain('<SaveConflictBand')
    expect(EDITOR).toContain('onCompare=')
    expect(EDITOR).toContain('onReload=')
    expect(CONFLICT).toContain('違いを比べる')
    expect(CONFLICT).toContain('最新を読み込んで続ける')
  })

  it('競合の帯の見た目は直接の色・丸み・影を書かない', () => {
    expect(CONFLICT_CSS).toContain('var(--color-status-warn-soft)')
    expect(CONFLICT_CSS).toContain('var(--radius-control)')
    expect(CONFLICT_CSS).toContain('var(--save-conflict-ring)')
    expect(CONFLICT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
