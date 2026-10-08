// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), loginMembers: vi.fn(), linkMembershipLogin: vi.fn(), updateMembership: vi.fn(), listIntakeAddresses: vi.fn(),
  gate: vi.fn(), cancel: vi.fn(), role: 'owner' as string | null,
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: fixture }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
vi.mock('@/components/step-up-prompt', () => ({
  useStepUpGate: () => ({ gate: fixture.gate, cancel: fixture.cancel, prompt: null }),
  isStepUpRequired: (e: unknown) => !!e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'STEP_UP_REQUIRED',
}))
import OrganizationV8 from './organization'

const member = { id: 'member', organization_id: 'org', store_id: 'store', staff_name: '試験担当', email: null, role: 'staff', status: 'active', staff_id: 'login', loginName: '試験ログイン', loginRole: 'staff', loginPolicyVersion: 3, loginAccountScope: 'accounts', line_uid: null, google_email: null }
const data = { organization: { id: 'org', name: '試験組織', tenant_name: '試験統括' }, stores: [{ id: 'store', name: '試験店', code: 'S', area: '渋谷', capacity: 20, status: 'active', line_account_id: 'account-1', line_account_name: '試験店' }], memberships: [member], tables: [], menuItems: [], reservations: [], inventory: [], approvals: [], connectors: [], reviews: [], posts: [], lineFlows: [] }

beforeEach(() => {
  fixture.role = 'owner'
  fixture.snapshot.mockResolvedValue({ data })
  fixture.loginMembers.mockResolvedValue({ data: [{ id: 'login', name: '試験ログイン' }, { id: 'next', name: '別のログイン' }] })
  fixture.updateMembership.mockResolvedValue({ success: true })
  fixture.linkMembershipLogin.mockResolvedValue({ success: true })
  fixture.listIntakeAddresses.mockResolvedValue({ data: [] })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('ログインとの連携は「変更」の窓の中で保存する', async () => {
  render(<OrganizationV8 />)
  const row = (await screen.findByText('試験担当')).closest('[role="row"]') as HTMLElement
  expect(row.querySelector('[title]')?.getAttribute('title')).toContain('試験ログイン・スタッフ')
  fireEvent.click(within(row).getByRole('button', { name: '変更' }))
  fireEvent.click(await screen.findByRole('button', { name: '試験担当のログインメンバー' }))
  fireEvent.click(within(await screen.findByRole('option', { name: '別のログイン' })).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'ログインと連携' }))
  await waitFor(() => expect(fixture.linkMembershipLogin).toHaveBeenCalledWith('account-1', 'member', 'next'))
})

it('連携メンバーの停止は本人確認が必要なら確認後に同じ鍵で再送する', async () => {
  fixture.updateMembership.mockRejectedValueOnce({ code: 'STEP_UP_REQUIRED' }).mockResolvedValueOnce({ success: true })
  fixture.gate.mockResolvedValue('verified-token')
  render(<OrganizationV8 />)
  const row = (await screen.findByText('試験担当')).closest('[role="row"]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '停止' }))
  fireEvent.click(screen.getByRole('button', { name: '停止する' }))
  await waitFor(() => expect(fixture.updateMembership).toHaveBeenCalledTimes(2))
  expect(fixture.updateMembership).toHaveBeenLastCalledWith('account-1', 'member', expect.objectContaining({ status: 'suspended', expectedPolicyVersion: 3 }), 'verified-token')
  expect(fixture.updateMembership.mock.calls[0][2].idempotencyKey).toBe(fixture.updateMembership.mock.calls[1][2].idempotencyKey)
})

it('閲覧のみには作る・編集・変更・停止・発行のボタンを置かない', async () => {
  fixture.role = 'staff'
  render(<OrganizationV8 />)
  expect(await screen.findByText('試験担当')).toBeTruthy()
  expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
  for (const name of ['店舗を追加する', '編集', 'ユーザーを追加する', '変更', '停止', 'アドレスを発行']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
})

it('ユーザーの保存中は窓の×・キャンセル・Escで閉じられない', async () => {
  let resolve!: (value: unknown) => void
  fixture.linkMembershipLogin.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<OrganizationV8 />)
  const row = (await screen.findByText('試験担当')).closest('[role="row"]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '変更' }))
  fireEvent.click(await screen.findByRole('button', { name: '試験担当のログインメンバー' }))
  fireEvent.click(within(await screen.findByRole('option', { name: '別のログイン' })).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'ログインと連携' }))
  expect(screen.getByRole('button', { name: '閉じる' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'キャンセル' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => resolve({ success: true }))
})
