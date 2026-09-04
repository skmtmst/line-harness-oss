import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOG = fs.readFileSync(path.join(__dirname, 'saved-view-dialog.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

describe('受信箱 保存した検索の完了判定', () => {
  it('保存先の成功を確認してからだけ完了表示へ進む', () => {
    expect(DIALOG).toContain('Promise<SavedViewSaveResult>')
    expect(DIALOG).toContain('const result = await onSave(trimmed)')
    expect(DIALOG).toContain('if (!result.success)')
    expect(DIALOG.indexOf('setDone(true)')).toBeGreaterThan(DIALOG.indexOf('if (!result.success)'))
  })

  it('失敗理由をモーダル内へ出し、API内部文言を素通ししない', () => {
    expect(DIALOG).toContain('setError(result.error)')
    expect(PAGE).toContain('保存できませんでした。時間を置いてもう一度お試しください。')
    expect(PAGE).not.toContain('savedViewCreateError.message')
    expect(PAGE).not.toContain("response.error || '保存できませんでした'")
  })

  it('呼び出し元が保存結果をモーダルへ返す', () => {
    expect(PAGE).toContain('Promise<SavedViewSaveResult>')
    expect(PAGE).toContain('return createSavedView(name)')
    expect(PAGE).toContain('return { success: true }')
    expect(PAGE).toContain('return { success: false, error: message }')
  })

  it('検索名が空のあいだは最初から保存ボタンを押せない', () => {
    /*
      押してはじめて断るのではなく、**押せない形にしてから、何をすれば
      進めるかを書く。** 押せる形で置いてあるものは、押せば進むと読む。
    */
    expect(DIALOG).toContain("const nameMissing = name.trim() === ''")
    expect(DIALOG).toContain('disabled={saving || nameMissing}')
    // 文言は設計 `AuSDY`（2-16）そのまま。実装で言い換えない。
    expect(DIALOG).toContain("title={nameMissing ? '検索名を入力してください' : undefined}")
    expect(DIALOG).toContain('検索名を入力してください。')
    // 空を押させてから赤字を出す形へ戻さない。
    expect(DIALOG).not.toContain('disabled={saving}')
  })
})
