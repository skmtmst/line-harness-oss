// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), decideApproval: vi.fn(), role: 'owner' as string | null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot, decideApproval: fixture.decideApproval } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
import ApprovalsV8 from './approvals'

const data = {
  organization: { id: 'org', name: '試験組織' },
  stores: [{ id: 'store', name: '試験店', code: 'S', status: 'active', line_account_id: 'account-1', capacity: 10 }],
  approvals: [
    { id: 'apr-1', store_id: 'store', kind: 'menu_change', title: '価格改定', status: 'pending', requested_by: '申請者', review_comment: null, created_at: '2026-09-29T09:40:00Z', payload_json: JSON.stringify({ before: '¥3,800', after: '¥4,200' }) },
    { id: 'apr-2', store_id: null, kind: 'line_message', title: 'お礼', status: 'returned', requested_by: '申請者', review_comment: '期限を書いてください', created_at: '2026-09-27T06:02:00Z', payload_json: JSON.stringify({ title: 'ありがとう', body: '本文' }) },
  ],
  memberships: [], reservations: [], tables: [], inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], lineFlows: [],
}

beforeEach(() => {
  fixture.role = 'owner'
  fixture.snapshot.mockResolvedValue({ data })
  fixture.decideApproval.mockResolvedValue({ data: { menuChangeStatus: 'applied' } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('管理者は承認待ちのカードで承認でき、改定の前後と差戻しのコメントが見える', async () => {
  render(<ApprovalsV8 />)
  expect(await screen.findByText('価格改定')).toBeTruthy()
  expect(screen.getByText('¥3,800')).toBeTruthy()
  expect(screen.getByText('期限を書いてください')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '承認する' }))
  await waitFor(() => expect(fixture.decideApproval).toHaveBeenCalledWith('account-1', 'apr-1', 'approve', undefined))
})

it('閲覧のみには帯を出し、差戻し・承認するのボタンを置かない', async () => {
  fixture.role = 'staff'
  render(<ApprovalsV8 />)
  expect(await screen.findByText('価格改定')).toBeTruthy()
  expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '承認する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '差戻し' })).toBeNull()
  expect(fixture.decideApproval).not.toHaveBeenCalled()
})
