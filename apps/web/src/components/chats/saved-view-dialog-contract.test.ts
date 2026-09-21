import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOG = fs.readFileSync(path.join(__dirname, 'saved-view-dialog.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

describe('受信箱 保存した検索の完了判定', () => {
  it('保存先の成功を確認してからだけ完了表示へ進む', () => {
    expect(DIALOG).toContain('Promise<SavedViewSaveResult>')
    expect(DIALOG).toContain('const result = await onSave({ name: trimmed, status, quickFilter, channel, assignee, unreadOnly, favorite })')
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

  it('開いた直後の未入力は中立、入力→削除・失敗だけを赤くする（INBOX-22）', () => {
    /*
      何も入力していない初期状態から赤枠・aria-invalid・赤い帯で
      始めると、通常の未入力と誤入力・保存失敗が同じ見た目になる。
      初期は必須の印と中立色の案内にし、赤い断りは
      「入力してから消した」「保存に失敗した」ときだけにする。
    */
    expect(DIALOG).toContain("import Notice from '@/components/shared/notice'")
    expect(DIALOG).toContain('const showMissingError = nameMissing && nameTouched')
    expect(DIALOG).toContain('const nameInvalid = Boolean(error) || showMissingError')
    expect(DIALOG).toContain('aria-invalid={nameInvalid}')
    expect(DIALOG).toContain("${nameInvalid ? 'border-danger' : 'border-hairline'}")
    expect(DIALOG).toContain('（必須）')
    expect(DIALOG).toContain('検索名は必須です。入力すると保存できるようになります。')
    // 失敗・削除後の断りは従来どおり共通の赤い帯で出す。
    expect(DIALOG).toContain('tone="error"')
    expect(DIALOG).toContain("message={error || '検索名を入力してください。'}")
    // 初期未入力を赤枠・aria-invalid にする形へ戻さない。
    expect(DIALOG).not.toContain('aria-invalid={Boolean(error) || nameMissing}')
    // 自前の小さな赤字へ戻さない（共通部品を通す）。
    expect(DIALOG).not.toContain('className="text-danger mt-1.5 text-xs" role="alert"')
  })

  it('設計と同じ入力案内と保存ボタン名を使う', () => {
    expect(DIALOG).toContain('placeholder="検索名を入力してください"')
    expect(DIALOG).toContain("{saving ? '保存中' : '検索条件を保存'}")
    expect(PAGE).toContain('現在の条件を保存')
  })

  it('保存する条件をモーダル内で変更でき、よく使う状態も保存する', () => {
    expect(DIALOG).toContain('aria-label="保存する対応状況"')
    expect(DIALOG).toContain('aria-label="保存する絞り込み"')
    expect(DIALOG).toContain('aria-label="保存する未読条件"')
    expect(DIALOG).toContain('aria-label="保存する受信経路"')
    expect(DIALOG).toContain('aria-label="保存する担当者"')
    expect(DIALOG).toContain('aria-label="よく使うに追加"')
    expect(PAGE).toContain('conditions: currentSavedViewConditions(draft)')
    expect(PAGE).toContain('isFavorite: draft?.favorite ?? false')
    // N-020: 「要返信」を「すべて」へ潰さず、保存された絞り込みをそのまま戻す。
    expect(PAGE).toContain('setQuickFilter(conditions.quickFilter)')
    expect(PAGE).toContain("setUnreadOnly(conditions.unread === 'mine')")
  })

  it('保存内容の注意を入力済みでも残し、設計と同じ濃さで背景を暗くする', () => {
    expect(DIALOG).toContain('bg-ink/35')
    expect(DIALOG).toContain('保存されるのは検索条件です。受信件数は最新の状態に自動更新されます。')
    expect(DIALOG).toContain('tone="validation"')
  })

  it('顧客情報を開いても会話一覧の幅を保つ', () => {
    // LAY-01(#982): 開いている間は 288px 固定。2xl で 420px へ急拡大すると
    // 3列が 1536px に収まらなくなる（一覧+トーク+顧客情報）。
    expect(PAGE).toContain("showFriendInfo ? 'lg:w-72'")
    expect(PAGE).not.toContain("showFriendInfo ? 'lg:w-72 2xl:w-[420px]'")
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
