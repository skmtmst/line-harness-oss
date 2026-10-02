// @vitest-environment happy-dom
/*
 * M036：主食のカロリーの保存失敗を、生のまま出さず
 * 共通の状態別案内（`describeApiFailure`）へ渡す。本物の React で確かめる試験。
 *
 * - 403 は権限の案内（`API error: 403` は出さない）
 * - ついでに読み込みの 429 は待ち案内にし、再試行の口は残す
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))

vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { feeding: m.get, saveFeeding: m.save } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))

import FeedingTab from './feeding-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data = () => ({
  products: [{ id: 'product-A', name: 'Aフード', kcalPer100g: 350, isDefault: true, kind: 'staple' }],
  petCount: 0,
  treatLimitPercent: 10,
})

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
})

describe('M036 主食のカロリーの保存・読み込み失敗', () => {
  it('保存の403は権限の案内になり、生文は出ない', async () => {
    m.get.mockResolvedValueOnce({ success: true, data: data() })
    m.save.mockRejectedValueOnce(new ApiError(403, 'API error: 403'))
    render(<FeedingTab accountId="A" />)
    await flush()
    fireEvent.change(screen.getByLabelText('商品名 1'), { target: { value: 'A編集中' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await flush()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('権限')
    expect(alert.textContent).not.toContain('API error: 403')
  })

  it('読み込みの429は待ち案内になり、再試行の口は残る', async () => {
    m.get.mockRejectedValueOnce(new ApiError(429, 'API error: 429'))
    render(<FeedingTab accountId="A" />)
    await flush()

    expect(document.body.textContent).toMatch(/混み合っています|待って/)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
