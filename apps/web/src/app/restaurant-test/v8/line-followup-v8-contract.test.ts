// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RestaurantContext } from '@/v8/restaurant/common-a/frame'

const fixture = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { updateLineFlow: fixture.update } }))
vi.mock('@/v8/restaurant/common-a/frame', () => ({ default: ({ children }: { children: (ctx: RestaurantContext) => React.ReactNode }) => children({
  data: { lineFlows: [{ id: 'flow-1', flow_type: 'post_visit', title: '来店のお礼', body: 'ありがとうございました', timing_minutes: 180, delivery_mode: 'preview_only' }] },
  store: null, busy: false, mutate: (operation: () => Promise<unknown>) => operation(),
} as unknown as RestaurantContext) }))
import LineFollowupV8 from '@/v8/restaurant/line-followup/line-followup'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('LINE来店フォロー V8', () => {
  it('現行の通知一覧と選択した通知の入力欄を描く', () => {
    render(React.createElement(LineFollowupV8))
    expect(screen.getByRole('table').textContent).toContain('配信：3時間後')
    expect(screen.getByRole('button', { name: 'ご来店のお礼' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'タイトル' }) as HTMLInputElement).value).toBe('来店のお礼')
  })

  it('データの口は今のまま（lineFlows の読み・updateLineFlow の保存）', async () => {
    fixture.update.mockResolvedValue({ success: true })
    render(React.createElement(LineFollowupV8))
    fireEvent.change(screen.getByRole('textbox', { name: '本文' }), { target: { value: 'またお待ちしています' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(fixture.update).toHaveBeenCalledWith('account-1', 'flow-1', { title: '来店のお礼', body: 'またお待ちしています' }))
  })

  it('本送信は押せないまま置く（プレビューのみ）', () => {
    render(React.createElement(LineFollowupV8))
    const sending = screen.getByText('本送信').closest('[data-kpi-presentation]')!
    expect(sending.textContent).toContain('停止中')
    expect(sending.textContent).toContain('プレビューのみ')
    expect(screen.queryByRole('button', { name: /本送信|送信する/ })).toBeNull()
  })
})
