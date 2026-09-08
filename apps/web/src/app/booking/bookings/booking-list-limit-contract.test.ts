import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const DETAIL = readFileSync(new URL('./detail/page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../lib/api.ts', import.meta.url), 'utf8')

describe('予約管理の一覧上限', () => {
  it('一覧を表示ページだけ取得し、総件数でページ数を決める', () => {
    expect(LIST).toContain('offset: (page - 1) * PAGE_SIZE')
    expect(LIST).toContain('setTotal(r.total)')
    expect(LIST).toContain('Math.ceil(total / PAGE_SIZE)')
    expect(API).toContain('requests: BookingRequest[]; total: number')
  })

  it('詳細は一覧全件から探さず単票APIを使う', () => {
    expect(DETAIL).toContain('bookingApi.getBooking(selectedAccountId, id)')
    expect(DETAIL).not.toContain("bookingApi.listRequests(selectedAccountId, 'all')")
  })

  it('LINE未連携の電話予約をnullとして扱いリンクを作らない', () => {
    expect(API).toContain('friend_id: string | null')
    expect(DETAIL).toContain('booking.friend_id ? (')
    expect(LIST).toContain('b.friend_id ? <Button')
  })

  it('集計の失敗は0表示と分け、理由と再試行を出す(点検#516の中2)', () => {
    expect(LIST).toContain('summaryError')
    expect(LIST).toContain('集計を読み込めませんでした。一覧はそのまま使えます。')
    expect(LIST).toContain('もう一度読み込む')
    expect(LIST).toContain('setSummarySeq')
  })

  it('承認文面はWorkerの送信文面と同じ要素を持つ(点検#516の中7)', () => {
    // 実際に送るのは booking-notifier.ts の renderNotificationText('approved')。
    // 6要素(確定文・メニュー・担当・日時・空行・変更案内)がずれると二重管理になる。
    expect(DETAIL).toContain("'予約が確定しました。'")
    expect(DETAIL).toContain('`メニュー: ${b.menu_name}`')
    expect(DETAIL).toContain('`担当: ${b.staff_name}`')
    expect(DETAIL).toContain('`日時: ${jst}`')
    expect(DETAIL).toContain("'変更・キャンセルはお店に直接ご連絡ください。'")
    expect(DETAIL).toContain("renderNotificationText('approved'")
  })

  // 点検#516の中8(メニュー棚のFolderPanel寄せ)は列車側で移行済みのため、
  // このPRでは重複して扱わない。移行の契約は booking-folder-panel-contract.test.ts が持つ。
})
