import { describe, expect, it } from 'vitest'
import { broadcastDetailCsv } from './broadcast-detail-export'

describe('一斉配信の結果CSV', () => {
  const format = (value: string | null | undefined) => value ?? '—'

  it('画面で取得できた実測値だけを書き出す', () => {
    const csv = broadcastDetailCsv({
      title: '新商品,「秋」',
      status: 'sent',
      sentAt: '2026-08-20T03:00:00.000Z',
      scheduledAt: null,
      totalCount: 624,
      successCount: 622,
      delivered: 622,
      uniqueImpression: 444,
      uniqueClick: 218,
    }, format)

    expect(csv).toContain('管理名,状態,送信日時,対象件数,送信成功,送信失敗,LINE到達,開封,クリック')
    expect(csv).toContain('"新商品,「秋」",送信済み,2026-08-20T03:00:00.000Z,624,622,2,622,444,218')
  })

  it('未取得値を0にせず、送信前の失敗数も作らない', () => {
    const csv = broadcastDetailCsv({
      title: '予約', status: 'scheduled', sentAt: null, scheduledAt: null,
      totalCount: 0, successCount: 0, delivered: null, uniqueImpression: null, uniqueClick: null,
    }, format)

    expect(csv).toContain('予約,予約済み,—,0,0,—,—,—,—')
  })
})
