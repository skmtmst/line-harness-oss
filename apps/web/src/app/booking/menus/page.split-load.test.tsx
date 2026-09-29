// @vitest-environment happy-dom
/*
 * DEEP-26 (#995): 予約メニュー一覧と店舗設定の読み込みを分ける。
 *
 * 監査の再現試験 (audit-deep-menu-performance.test.tsx) が示した
 * 「一覧が取れているのに、関係ない設定の応答が返るまで隠れる」を
 * 実物の React で描いて直っていることを確かめる。
 *
 *   - 設定APIが返る前でも、一覧APIが終われば一覧を表示する
 *   - 設定APIが失敗しても一覧は読める（設定依存の欄だけ未取得にする）
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ settings: vi.fn(), menus: vi.fn() }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'A', selectedAccount: null }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => false }))
vi.mock('@/components/layout/merged-tabs', () => ({
  useMergedTab: () => 'menus',
  default: () => null,
}))
vi.mock('@/app/booking/staff/page', () => ({ default: () => null }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: { tags: { list: async () => ({ success: true, data: [] }) } },
  bookingApi: { getSettings: m.settings, listMenus: m.menus },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

const menuRow = {
  id: 'menu',
  name: '即時取得メニュー',
  sort_order: 0,
  is_active: 1,
  duration_minutes: 60,
  buffer_after_minutes: 0,
  base_price: 1000,
  price_mode: 'fixed',
  assigned_staff: [{ id: 'staff-a', display_name: '担当A' }],
  assigned_resources: [],
  booking_count_30_days: 3,
  version: 1,
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
})

describe('DEEP-26: 一覧は設定の応答を待たない', () => {
  it('設定APIが保留でも、一覧APIの完了で一覧を表示する', async () => {
    let resolveSettings: ((v: unknown) => void) | undefined
    m.settings.mockImplementation(() => new Promise((r) => { resolveSettings = r }))
    m.menus.mockResolvedValue({ menus: [menuRow] })

    render(<Page />)
    await flush()

    expect(m.menus).toHaveBeenCalledTimes(1)
    // 設定がまだ返っていなくても、取れた一覧は出る。
    expect(screen.getAllByText('即時取得メニュー').length).toBeGreaterThan(0)
    expect(screen.getAllByText('担当A').length).toBeGreaterThan(0)
    expect(screen.getByText('3 件')).toBeTruthy()
    // 設定に依存する欄は、確定するまで実値を推測して出さない。
    expect(screen.getAllByText('読み込み中').length).toBeGreaterThan(0)

    await act(async () => {
      resolveSettings?.({ success: true, data: { businessHours: [], exceptions: [], menuCount: 1 } })
    })
    expect(screen.getAllByText('即時取得メニュー').length).toBeGreaterThan(0)
  })

  it('設定APIが失敗しても一覧は読め、設定依存の欄だけ未取得にする', async () => {
    m.settings.mockRejectedValue(new Error('settings 500'))
    m.menus.mockResolvedValue({ menus: [menuRow] })

    render(<Page />)
    await flush()

    expect(screen.getAllByText('即時取得メニュー').length).toBeGreaterThan(0)
    expect(screen.getAllByText('担当A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('取得できませんでした').length).toBeGreaterThan(0)
  })
})
