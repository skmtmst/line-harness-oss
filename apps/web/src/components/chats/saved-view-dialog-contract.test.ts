import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOG = fs.readFileSync(path.join(__dirname, 'saved-view-dialog.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

describe('受信箱 保存した検索の完了判定', () => {
  it('保存先の成功を確認してからだけ完了表示へ進む', () => {
    expect(DIALOG).toContain('Promise<SavedViewSaveResult>')
    expect(DIALOG).toContain('const result = await onSave({ name: trimmed, status, due, channel, assignee, favorite })')
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
    expect(PAGE).toContain('return createSavedView(draft)')
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

  it('未入力の断りを共通の赤い帯で出し、欄の枠も赤くする', () => {
    /*
      設計 `AuSDY`（2-16）は ⚠ の付いた**赤い帯**で「検索名を入力してください。」と言い、
      入力欄の枠も赤い。**小さな灰色の字だと、赤い枠だけ見えて理由が読まれない。**

      空のときと押して断られたときで**同じ見た目**にする。片方だけ帯にすると、
      同じ「入力してください」が2通りの見え方をして、別のことを言われたように読める。
    */
    expect(DIALOG).toContain("import Notice from '@/components/shared/notice'")
    expect(DIALOG).toContain('tone="error"')
    expect(DIALOG).toContain("message={error || '検索名を入力してください。'}")
    // 空のあいだも枠を赤くする。押すまで直しどころが分からない形へ戻さない。
    expect(DIALOG).toContain('aria-invalid={Boolean(error) || nameMissing}')
    expect(DIALOG).toContain("${error || nameMissing ? 'border-danger' : 'border-hairline'}")
    // 自前の小さな赤字へ戻さない（共通部品を通す）。
    expect(DIALOG).not.toContain('className="text-danger mt-1.5 text-xs" role="alert"')
  })

  it('設計と同じ入力案内と保存ボタン名を使う', () => {
    expect(DIALOG).toContain('placeholder="検索名を入力してください"')
    expect(DIALOG).toContain("{saving ? '保存中' : '検索条件を保存'}")
    expect(PAGE).toContain('現在の条件を保存')
  })

  it('保存する4条件をモーダル内で変更でき、よく使う状態も保存する', () => {
    expect(DIALOG).toContain('aria-label="保存する対応状況"')
    expect(DIALOG).toContain('aria-label="保存する期限"')
    expect(DIALOG).toContain('aria-label="保存する受信経路"')
    expect(DIALOG).toContain('aria-label="保存する担当者"')
    expect(DIALOG).toContain('aria-label="よく使うに追加"')
    expect(PAGE).toContain('conditions: currentSavedViewConditions(draft)')
    expect(PAGE).toContain('isFavorite: draft?.favorite ?? false')
    expect(PAGE).toContain("setQuickFilter(conditions.due === 'overdue' ? 'overdue' : 'all')")
  })

  it('保存内容の注意を入力済みでも残し、設計と同じ濃さで背景を暗くする', () => {
    expect(DIALOG).toContain('bg-ink/35')
    expect(DIALOG).toContain('保存されるのは検索条件です。受信件数は最新の状態に自動更新されます。')
    expect(DIALOG).toContain('tone="validation"')
  })

  it('顧客情報を開いても会話一覧の幅を保つ', () => {
    expect(PAGE).toContain("showFriendInfo ? 'lg:w-72 2xl:w-[420px]'")
  })

  it('保存条件ごとの件数が未接続なら0件にせず理由を出す', () => {
    expect(PAGE).toContain("typeof view.matchCount === 'number' ? `${view.matchCount}件` : '—件'")
    expect(PAGE).toContain('「—件」は0件ではありません。')
  })

  it('削除は名前の隣へ常設せず、その他操作へ畳む', () => {
    expect(PAGE).toContain("import { MoreAction } from '@/components/shared/row-actions'")
    expect(PAGE).toContain('label={`${view.name}の操作`}')
    expect(PAGE).toContain('保存した検索を削除')
  })
})
