import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { describeSendFailure } from './send-failure'

const NOW = new Date('2026-09-17T00:00:00.000Z')

describe('describeSendFailure: N-028/N-029 失敗理由の言い換え', () => {
  it('同時送信の409は「確認中」と伝え、読み直しを促さない', () => {
    const error = new ApiError(409, '送信中', 'OUTBOUND_SEND_IN_PROGRESS')
    expect(describeSendFailure(error, NOW)).toContain('確認中')
  })

  it('送達不明の409は二重送信を防ぐ止まり方を伝える', () => {
    for (const code of ['LINE_DELIVERY_UNKNOWN', 'OUTBOUND_CONFIRMATION_FAILED']) {
      const text = describeSendFailure(new ApiError(409, '', code, { retryable: false }), NOW)
      expect(text).toContain('二重送信')
      expect(text).not.toContain('もう一度送信')
    }
  })

  it('再試行不能の409は内容の見直しを伝える', () => {
    const error = new ApiError(409, '', 'LINE_REQUEST_REJECTED', { retryable: false, nextRetryAt: null })
    expect(describeSendFailure(error, NOW)).toContain('受け付けられませんでした')
  })

  it('再送待ちの409は待機時間を添える', () => {
    const error = new ApiError(409, '', 'LINE_RATE_LIMITED', {
      retryable: true,
      nextRetryAt: '2026-09-17T00:05:00.000Z',
    })
    expect(describeSendFailure(error, NOW)).toContain('約5分後')
  })

  it('dataの無い409は従来の読み直し案内を維持する', () => {
    const error = new ApiError(409, 'revision conflict')
    expect(describeSendFailure(error, NOW)).toContain('読み直してください')
  })

  it('429は待機時間つきの送信制限として伝える', () => {
    const error = new ApiError(429, '', 'LINE_RATE_LIMITED', {
      retryable: true,
      nextRetryAt: '2026-09-17T00:10:00.000Z',
    })
    const text = describeSendFailure(error, NOW)
    expect(text).toContain('送信制限')
    expect(text).toContain('約10分後')
  })

  it('待機時間の無い429は安全な「少し待って」へ落とす', () => {
    const error = new ApiError(429, '', 'LINE_RATE_LIMITED')
    expect(describeSendFailure(error, NOW)).toContain('少し待って')
  })

  it('400はLINEに受け付けられなかった旨を伝える', () => {
    const error = new ApiError(400, '', 'LINE_REQUEST_REJECTED')
    expect(describeSendFailure(error, NOW)).toContain('受け付けませんでした')
  })

  it('502は一時障害として待機時間つきで伝える', () => {
    const error = new ApiError(502, '', 'LINE_TEMPORARILY_UNAVAILABLE', {
      retryable: true,
      nextRetryAt: '2026-09-17T00:03:00.000Z',
    })
    const text = describeSendFailure(error, NOW)
    expect(text).toContain('一時的な障害')
    expect(text).toContain('約3分後')
  })

  it('503は送達不明として自動再送を止める', () => {
    const error = new ApiError(503, '', 'OUTBOUND_CONFIRMATION_FAILED')
    expect(describeSendFailure(error, NOW)).toContain('自動再送を止めました')
  })

  it('準備失敗の500はLINEの障害と混ぜずに伝える', () => {
    const error = new ApiError(500, '', 'OUTBOUND_PREPARATION_FAILED')
    const text = describeSendFailure(error, NOW)
    expect(text).toContain('準備に失敗')
    expect(text).not.toContain('LINE側で一時的')
  })

  it('API以外の失敗は通信状況の確認を促す', () => {
    expect(describeSendFailure(new TypeError('fetch failed'), NOW)).toContain('通信状況')
  })
})
