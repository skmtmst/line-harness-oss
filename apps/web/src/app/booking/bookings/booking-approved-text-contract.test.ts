import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DETAIL = readFileSync(new URL('./detail/page.tsx', import.meta.url), 'utf8')
// 実際に送っている文面。片方を変えたらもう片方も直す(点検#516の中7)。
const NOTIFIER = readFileSync(
  new URL('../../../../../worker/src/services/booking-notifier.ts', import.meta.url),
  'utf8',
)

describe('承認文面の二重管理', () => {
  it('画面の見本と実際に送る文面が同じ決め文句を使う', () => {
    for (const phrase of [
      '予約が確定しました。',
      '変更・キャンセルはお店に直接ご連絡ください。',
    ]) {
      expect(DETAIL).toContain(phrase)
      expect(NOTIFIER).toContain(phrase)
    }
    for (const line of ['メニュー: ', '担当: ', '日時: ']) {
      expect(DETAIL).toContain(line)
      expect(NOTIFIER).toContain(line)
    }
  })

  it('画面側に同期の約束が書いてある', () => {
    expect(DETAIL).toContain("renderNotificationText('approved'")
  })
})
