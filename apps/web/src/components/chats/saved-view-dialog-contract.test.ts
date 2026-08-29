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

  it('検索名が空だと分かったあとは保存ボタンを押せない', () => {
    expect(DIALOG).toContain("const nameMissing = error === '検索名を入力してください'")
    expect(DIALOG).toContain('disabled={saving || nameMissing}')
  })

  it('未入力エラーは共通の赤い案内帯で表示する', () => {
    expect(DIALOG).toContain("import Notice from '@/components/shared/notice'")
    expect(DIALOG).toContain('<Notice id="saved-view-error" tone="error" message={error} data-saved-view-error />')
    expect(DIALOG).toContain('aria-invalid={nameMissing}')
    expect(DIALOG).toContain("aria-describedby={error ? 'saved-view-error' : undefined}")
  })
})
