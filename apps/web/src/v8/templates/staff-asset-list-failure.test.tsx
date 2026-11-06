// @vitest-environment happy-dom
/*
 * 監査 PKG110：閲覧のみの資産一覧で、読めなかったことを「まだありません」と言わない。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { broadcastMessageAssets: { list: fixture.list } } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))

import StaffAssetList from './staff-asset-list'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('閲覧のみの資産一覧（PKG110）', () => {
  it('読めなかったときは失敗と読み直しを出し、「まだありません」は出さない', async () => {
    fixture.list.mockRejectedValueOnce(new Error('down'))
    render(<StaffAssetList kind="coupon" />)
    await waitFor(() => expect(screen.getByText('クーポンを読み込めませんでした')).toBeTruthy())
    expect(screen.queryByText(/テンプレートがありません/)).toBeNull()
  })

  it('本当に0件なら「まだありません」（対照）', async () => {
    fixture.list.mockResolvedValueOnce({ success: true, data: [] })
    render(<StaffAssetList kind="coupon" />)
    await waitFor(() => expect(screen.getByText('まだクーポンテンプレートがありません。')).toBeTruthy())
  })
})
