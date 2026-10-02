// @vitest-environment happy-dom
/*
 * DEEP-22: 主食のカロリーで、アカウントAを編集したままBへ切り替えたとき、
 * Bの読み込み中にAのフォームと保存が有効のまま残らないことを確かめる。
 * 監査の再現: audit-reports reproductions/audit-deep-feeding.test.tsx
 *
 * 修正後の期待：切替の瞬間に表示データ・下書き・dirtyは初期化され、
 * 読み込み中は保存できない。遅れて届いたAの応答・逆順の応答も画面へ混ざらない。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { feeding: m.get, saveFeeding: m.save } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }))

import FeedingTab from './feeding-tab'

const data = (a: string) => ({
  products: [{ id: `product-${a}`, name: `${a}フード`, kcalPer100g: 350, isDefault: true, kind: 'staple' }],
  petCount: 0,
  treatLimitPercent: 10,
})
const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  m.save.mockResolvedValue({ success: false, error: 'mock-stop' })
})

describe('DEEP-22 主食のカロリー', () => {
  it('Aを編集したままBへ切り替えると、B読込中にAのフォームと保存は残らない', async () => {
    m.get
      .mockResolvedValueOnce({ success: true, data: data('A') })
      .mockImplementationOnce(() => new Promise(() => {}))
    const v = render(<FeedingTab accountId="A" />)
    await flush()
    fireEvent.change(screen.getByLabelText('商品名 1'), { target: { value: 'A編集中' } })

    v.rerender(<FeedingTab accountId="B" />)
    await flush()

    // Bの読み込み中はAのフォームを出さない。保存手段も無い
    expect(screen.queryByLabelText('商品名 1')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
    expect(m.save).not.toHaveBeenCalled()
    // 未保存だったので破棄したことは画面へ出る
    expect(screen.getByText(/保存していない変更は破棄しました/)).toBeTruthy()
  })

  it('切替後はBの取得だけが反映される。遅れて届くAの応答は捨てる（逆順応答）', async () => {
    let resolveA!: (value: unknown) => void
    m.get
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve }))
      .mockResolvedValueOnce({ success: true, data: data('B') })
    const v = render(<FeedingTab accountId="A" />)
    v.rerender(<FeedingTab accountId="B" />)
    await flush()
    // Bの応答で画面が埋まる
    expect((screen.getByLabelText('商品名 1') as HTMLInputElement).value).toBe('Bフード')
    // 遅れて届いたAの応答は破棄される
    await act(async () => resolveA({ success: true, data: data('A') }))
    expect((screen.getByLabelText('商品名 1') as HTMLInputElement).value).toBe('Bフード')
  })

  it('切替後にBを編集して保存すると、BのIDでBへ送られる', async () => {
    m.get
      .mockResolvedValueOnce({ success: true, data: data('A') })
      .mockResolvedValueOnce({ success: true, data: data('B') })
    const v = render(<FeedingTab accountId="A" />)
    await flush()
    fireEvent.change(screen.getByLabelText('商品名 1'), { target: { value: 'A編集中' } })
    v.rerender(<FeedingTab accountId="B" />)
    await flush()
    fireEvent.change(screen.getByLabelText('商品名 1'), { target: { value: 'B編集中' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await flush()
    expect(m.save).toHaveBeenCalledWith('B', expect.arrayContaining([expect.objectContaining({ id: 'product-B', name: 'B編集中' })]), 10)
  })
})
