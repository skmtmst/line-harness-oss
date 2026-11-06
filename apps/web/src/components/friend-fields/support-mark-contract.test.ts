import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname)
const LIST = fs.readFileSync(path.join(ROOT, '../../v8/tags/marks-tab.tsx'), 'utf8') + fs.readFileSync(path.join(ROOT, 'mark-list.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(ROOT, '../../v8/tags/mark-editor.tsx'), 'utf8')

/*
 * 禁止の見張りと、窓の CSS の値だけを文字で持つ。動きは描いて押す試験が見る：
 * 一覧と保管＝`v8/tags/marks-tab-react.test.tsx`・`mark-archive-r180.test.tsx`、
 * 編集＝`v8/tags/mark-editor-retry.test.tsx`・`support-mark-editor-*-react.test.tsx`、
 * タブ行の作る入口＝`v8/tags/list.test.tsx`。
 */
describe('V8 対応マークの禁止の見張り', () => {
  it('編集画面は本文に古い見出しの部品を置かない', () => {
    expect(EDITOR).not.toContain('<Header')
  })

  it('保存と保管の失敗で内部のAPI文言をそのまま表示しない', () => {
    expect(EDITOR).not.toContain('reason instanceof ApiError ? reason.message')
    expect(LIST).not.toContain("reason instanceof ApiError ? reason.message : '削除できませんでした'")
  })

  it('人数があるマークを強制で保管しない', () => {
    expect(LIST).not.toContain('force: mark.friendCount > 0')
  })

  it('保管確認の窓は画面の中に収め、中身だけを内側でスクロールする', () => {
    const css = fs.readFileSync(path.join(ROOT, '../shared/dialog.module.css'), 'utf8')
    expect(css).toContain('max-height: calc(100dvh - 32px)')
    expect(css).toContain('overflow-y: auto')
    expect(LIST).not.toContain('margin-top: 310px')
  })
})
