// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ApiError, type EventDetail, type EventMakeupRule } from '@/lib/api'
import { EVENT_DEFAULT_DRAFT } from '@/components/events/event-draft-shared'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'

const mock = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), rule: vi.fn(), guard: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const api = await original<typeof import('@/lib/api')>()
  return { ...api, api: { ...api.api, tags: { list: async () => ({ success: true, data: [] }) } },
    eventsApi: { ...api.eventsApi, getEvent: mock.get, updateEvent: mock.update,
      listSlots: async () => ({ items: [] }), listEvents: async () => ({ items: [], total: 0 }) } }
})
vi.mock('@/lib/api/helpers/gap2', () => ({ bookingMakeupApi: { rule: mock.rule } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', selectedAccount: { id: 'a' }, accounts: [{ id: 'a', name: '店', isActive: true, country: null }] }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: (role: string) => role === 'owner' }))
vi.mock('@/components/shared/use-permission-lock-reason', () => ({ usePermissionLockReason: () => undefined }))
vi.mock('@/v8/booking-payments/public/menu-payment/index', () => ({ MenuPaymentCard: () => null, PaymentConflictError: class extends Error {}, useMenuPayment: () => ({ dirty: false, save: async () => {} }) }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: (state: unknown) => { mock.guard(state); return { leaveTarget: null, guarded: (run: () => void) => run(), cancelLeave: vi.fn(), confirmLeave: vi.fn() } } }))
import EventForm from './edit-form'

const rule: EventMakeupRule = { enabled: true, cutoffHours: 3, validDays: 30, monthlyCap: 2, target: 'same_kind', targetIds: [] }
let server: EventDetail
beforeEach(() => {
  mock.get.mockReset(); mock.update.mockReset(); mock.rule.mockReset(); mock.guard.mockReset(); forgetSessionSnapshot()
  server = { ...EVENT_DEFAULT_DRAFT, id: 'class-a', line_account_id: 'a', name: '朝の教室', version: 4, makeup_rule_json: JSON.stringify(rule) }
  mock.get.mockImplementation(async () => ({ ...server }))
  mock.rule.mockImplementation(async (_a, _id, next, version) => {
    if (server.version !== version) throw new ApiError(409, '競合', 'version_conflict')
    server = { ...server, makeup_rule_json: JSON.stringify(next), version: version + 1 }
    return { success: true, data: { rule: next, revision: server.version } }
  })
  mock.update.mockImplementation(async (_a, _id, payload, version) => {
    if (server.version !== version) throw new ApiError(409, '競合', 'version_conflict')
    server = { ...server, ...payload, version: version + 1 }
    return { ...server }
  })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); forgetSessionSnapshot() })

async function editDraftAndRule() {
  render(<EventForm accountId="a" eventId="class-a" />)
  await screen.findByDisplayValue('朝の教室')
  fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '概要の書きかけ' } })
  fireEvent.click(screen.getByRole('button', { name: '振替の決まりを編集する' }))
  const dialog = within(await screen.findByRole('dialog', { name: '振替の決まりを編集' }))
  fireEvent.change(dialog.getByLabelText('振替の期限'), { target: { value: '45' } })
  return dialog
}

it('概要の書きかけを送らずに振替だけ保存し、続けて概要を新しい版で保存できる', async () => {
  const dialog = await editDraftAndRule()
  fireEvent.click(dialog.getByRole('button', { name: '保存する' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '振替の決まりを編集' })).toBeNull())
  expect(server.name).toBe('朝の教室'); expect(mock.update).not.toHaveBeenCalled()
  expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('概要の書きかけ')
  fireEvent.click(screen.getByRole('button', { name: '概要を保存する' }))
  await waitFor(() => expect(server.name).toBe('概要の書きかけ'))
  expect(mock.update).toHaveBeenCalledWith('a', 'class-a', expect.objectContaining({ name: '概要の書きかけ' }), 5)
  expect(mock.update.mock.calls[0][2]).not.toHaveProperty('makeup_rule_json')
  expect(JSON.parse(server.makeup_rule_json!)).toMatchObject({ validDays: 45 })
  expect(server.version).toBe(6)
})

it('保存の競合で振替だけ読み直して保存した後も、古い概要の版を進めて他人の変更を上書きしない', async () => {
  const dialog = await editDraftAndRule()
  server = { ...server, name: 'ほかの人の概要', version: 9 }
  fireEvent.click(dialog.getByRole('button', { name: '保存する' }))
  await dialog.findByText('ほかの人が先にクラスを保存しました')
  fireEvent.click(dialog.getByRole('button', { name: '最新を読み込んで続ける' }))
  await waitFor(() => expect((dialog.getByLabelText('振替の期限') as HTMLInputElement).value).toBe('30'))
  fireEvent.click(dialog.getByRole('button', { name: '保存する' }))
  await waitFor(() => expect(server.version).toBe(10))
  expect(screen.getByText(/振替の決まりは保存しました。クラスの概要はほかの人が更新しています/)).toBeTruthy()
  expect((screen.getByLabelText('イベント名') as HTMLInputElement).value).toBe('概要の書きかけ')
  fireEvent.click(screen.getByRole('button', { name: '概要を保存する' }))
  await waitFor(() => expect(mock.update).toHaveBeenCalledWith('a', 'class-a', expect.objectContaining({ name: '概要の書きかけ' }), 4))
  expect(server.name).toBe('ほかの人の概要')
  expect(server.version).toBe(10)
})

it('概要が未変更でも振替の書きかけを親の離脱の見張りへ渡す', async () => {
  render(<EventForm accountId="a" eventId="class-a" />)
  await screen.findByDisplayValue('朝の教室')
  expect(mock.guard).toHaveBeenLastCalledWith({ dirty: false, busy: false })
  fireEvent.click(screen.getByRole('button', { name: '振替の決まりを編集する' }))
  const dialog = within(await screen.findByRole('dialog', { name: '振替の決まりを編集' }))
  fireEvent.change(dialog.getByLabelText('振替の期限'), { target: { value: '45' } })
  await waitFor(() => expect(mock.guard).toHaveBeenLastCalledWith({ dirty: true, busy: false }))
  fireEvent.click(dialog.getByRole('button', { name: '保存する' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '振替の決まりを編集' })).toBeNull())
  await waitFor(() => expect(mock.guard).toHaveBeenLastCalledWith({ dirty: false, busy: false }))
})
