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
})
