// @vitest-environment happy-dom
/*
 * G-1 成果の付け方（#823）の描画試験。
 * 空・読み込み中・失敗・正常の4状態を確かめる。
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  impl: null as null | (() => Promise<unknown>),
  calls: 0,
}))

vi.mock('@/lib/api', () => ({
  api: {
    conversionApprovals: {
      attribution: () => {
        fixture.calls += 1
        return fixture.impl!()
      },
    },
  },
}))

const { default: AttributionSection } = await import('./attribution-view')

const VIEW = {
  conversionEventId: 'ev-1',
  affiliateId: 'aff-1',
  refCode: 'ref-1',
  offerId: 'off-1',
  offerVersionId: 'ver-1',
  reason: 'matched_last_touch',
  windowDays: 30,
  candidates: [
    {
      affiliateId: 'aff-1',
      affiliateName: 'はなこ',
      refCode: 'ref-1',
      touchedAt: '2026-09-20T10:02:00.000+09:00',
      offerId: 'off-1',
      offerName: '定期便',
      chosen: true,
      skipReason: null,
      windowDays: 30,
    },
    {
      affiliateId: 'aff-2',
      affiliateName: 'けんた',
      refCode: 'ref-2',
      touchedAt: '2026-09-18T21:40:00.000+09:00',
      offerId: 'off-1',
      offerName: '定期便',
      chosen: false,
      skipReason: 'out_of_window',
      windowDays: 30,
    },
    {
      affiliateId: 'aff-3',
      affiliateName: '本人',
      refCode: 'ref-3',
      touchedAt: '2026-09-20T09:58:00.000+09:00',
      offerId: 'off-1',
      offerName: '定期便',
      chosen: false,
      skipReason: 'self_referral',
      windowDays: 30,
    },
  ],
  createdAt: '2026-09-27T12:00:00.000+09:00',
}

beforeEach(() => {
  fixture.calls = 0
})

afterEach(() => {
  cleanup()
})

describe('AttributionSection', () => {
  test('読み込み中はその旨を出す', () => {
    fixture.impl = () => new Promise(() => {})
    render(<AttributionSection eventId="ev-1" />)
    expect(screen.getByText('付け方を読み込んでいます')).toBeTruthy()
  })

  test('失敗は1つの帯で出し、再試行できる', async () => {
    fixture.impl = () => Promise.reject(new Error('network'))
    render(<AttributionSection eventId="ev-1" />)
    await waitFor(() => {
      expect(screen.getByText('付け方を読み込めませんでした')).toBeTruthy()
    })
    fixture.impl = () => Promise.resolve({ success: true, data: VIEW })
    fireEvent.click(screen.getByRole('button', { name: /もう一度|再試行|読み直す|やり直す/ }))
    await waitFor(() => {
      expect(screen.getByText('成果の付け方')).toBeTruthy()
    })
    expect(fixture.calls).toBe(2)
  })

  test('候補が無いときは空の旨を出す', async () => {
    fixture.impl = () => Promise.resolve({ success: true, data: { ...VIEW, candidates: [] } })
    render(<AttributionSection eventId="ev-1" />)
    await waitFor(() => {
      expect(screen.getByText('候補の紹介がありません')).toBeTruthy()
    })
  })

  test('正常は紹介・いつ・結果を1件ずつ出す', async () => {
    fixture.impl = () => Promise.resolve({ success: true, data: VIEW })
    render(<AttributionSection eventId="ev-1" />)
    await waitFor(() => {
      expect(screen.getByText('はなこ')).toBeTruthy()
    })
    expect(screen.getByText('付けた：最後に開いたリンク')).toBeTruthy()
    expect(screen.getByText('付けない：30日の期間外')).toBeTruthy()
    expect(screen.getByText('付けない：自分の紹介')).toBeTruthy()
    // 短い文字列は折らず、全文を title で確かめられる。
    expect(screen.getByText('はなこ').getAttribute('title')).toBe('はなこ')
  })
})
