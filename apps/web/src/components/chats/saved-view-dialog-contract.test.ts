import fs from 'node:fs'
import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DIALOG = fs.readFileSync(path.join(__dirname, 'saved-view-dialog.tsx'), 'utf8')
const PAGE = readUiSource(path.join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

/*
 * 受信箱「保存した検索」で**戻してはいけない形**だけを文字で見張る。
 * 窓の動き（押せない理由・中立と赤の出し分け・条件の受け渡し・成功を待つ）は saved-view-dialog-react.test.tsx、
 * 画面からの保存・失敗の文言・削除・条件の復元は app/chats/inbox-saved-view-*-react.test.tsx が見る。
 */
describe('受信箱 保存した検索で戻さない形', () => {
  it('API内部の失敗文言を素通ししない', () => {
    expect(PAGE).not.toContain('savedViewCreateError.message')
    expect(PAGE).not.toContain("response.error || '保存できませんでした'")
  })

  it('空のまま押させてから赤字を出す形へ戻さない', () => {
    expect(DIALOG).not.toContain('disabled={saving}')
  })

  it('開いた直後の未入力を赤枠・aria-invalid にしない', () => {
    expect(DIALOG).not.toContain('aria-invalid={Boolean(error) || nameMissing}')
  })

  it('自前の小さな赤字へ戻さない（共通部品を通す）', () => {
    expect(DIALOG).not.toContain('className="text-danger mt-1.5 text-xs" role="alert"')
  })
})
