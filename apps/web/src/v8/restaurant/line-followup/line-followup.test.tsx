// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), updateLineFlow: vi.fn(), role: 'owner' as string | null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot, updateLineFlow: fixture.updateLineFlow } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
import LineFollowupV8, { timingLabel } from './line-followup'

const flow = (id: string, flow_type: string, timing_minutes: number | null) => ({ id, store_id: null, flow_type, title: `${id}の題`, body: `${id}の本文`, timing_minutes, is_enabled: 1, delivery_mode: 'preview_only' as const })
const data = {
  organization: { id: 'org', name: '試験組織' },
  stores: [{ id: 'store', name: '試験店', code: 'S', status: 'active', line_account_id: 'account-1', line_account_name: '試験店 公式' }],
  lineFlows: [flow('f1', 'reservation_24h', -1440), flow('f2', 'post_visit', 180)],
  memberships: [], reservations: [], tables: [], inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], approvals: [],
}

beforeEach(() => {
  fixture.role = 'owner'
  fixture.snapshot.mockResolvedValue({ data })
  fixture.updateLineFlow.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('配信のときの言い方', () => {
  it('前は「時間前」、後は「時間後」、無いときは常設', () => {
    expect(timingLabel(flow('a', 'reservation_24h', -1440))).toBe('配信：24時間前')
    expect(timingLabel(flow('a', 'post_visit', 180))).toBe('配信：3時間後')
    expect(timingLabel(flow('a', 'post_visit', 90))).toBe('配信：90分後')
    expect(timingLabel(flow('a', 'member_card', null))).toBe('配信：常設')
  })
})

it('本物の種類で数え、直した題と本文を下書きとして保存する（送らない）', async () => {
  render(<LineFollowupV8 />)
  expect(await screen.findByText('予約24時間前のご案内')).toBeTruthy()
  expect(screen.getByText('ご来店のお礼')).toBeTruthy()
  expect(screen.getAllByText('確認用')).toHaveLength(2)
  expect(screen.getAllByText('未作成')).toHaveLength(2)
  const title = screen.getAllByRole('textbox', { name: 'タイトル' })[0]
  fireEvent.change(title, { target: { value: '新しい題' } })
  expect(screen.getAllByText('新しい題').length).toBeGreaterThan(0)
  fireEvent.click(screen.getAllByRole('button', { name: '下書きを保存する' })[0])
  await waitFor(() => expect(fixture.updateLineFlow).toHaveBeenCalledWith('account-1', 'f1', { title: '新しい題', body: 'f1の本文' }))
})

it('閲覧のみには「下書きを保存する」を置かない', async () => {
  fixture.role = 'staff'
  render(<LineFollowupV8 />)
  expect(await screen.findByText('予約24時間前のご案内')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '下書きを保存する' })).toBeNull()
})
