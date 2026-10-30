// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import { PERMISSION_LOCK_REASON, PERMISSION_LOCK_SUMMARY } from '@/components/shared/permission-lock'
import { READ_ONLY_MESSAGE } from '@/components/shared/read-only-notice'
import { rememberSessionSnapshot, forgetSessionSnapshot } from '@/lib/session-snapshot'
import type { EcNotificationSetting, OperatorNotificationRule, OpsImpersonation } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({ tab: 'customer', role: 'viewer', settings: vi.fn(), operators: vi.fn(), write: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/line-notifications', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('@/components/layout/merged-tabs', () => ({ default: () => null, useMergedTab: () => fixture.tab }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: vi.fn(async () => ({ success: true, data: {} })), api: { ...actual.api,
    staff: { ...actual.api.staff, me: async () => fixture.role ? { success: true, data: { role: fixture.role === 'viewer' ? 'staff' : fixture.role, readOnly: fixture.role === 'viewer', roleBundle: fixture.role === 'viewer' ? 'view_only' : undefined } } : { success: false, error: 'unavailable' } },
    ecCommerce: { ...actual.api.ecCommerce, settings: fixture.settings, overview: async () => ({ success: true, data: { last24h: 0, failed: 0, byType: [] } }), testSend: fixture.write },
    lineNotifications: { ...actual.api.lineNotifications, definitions: async () => ({ success: true, data: [] }), sendCounts: async () => ({ success: true, data: { sentToday: 0, sentLast30d: 0, byEventType: [] } }),
      createDefinition: fixture.write, updateDraft: fixture.write, publishDefinition: fixture.write, stopDefinition: fixture.write,
      operatorRules: { ...actual.api.lineNotifications.operatorRules, list: fixture.operators, test: fixture.write, publish: fixture.write, stop: fixture.write, exportCsv: fixture.write },
    },
  } }
})
import LineNotificationsPage from './page'
import OperatorTab from '@/v8/settings/line-notifications/operator-tab'

const setting: EcNotificationSetting = { eventType: 'ec.order.confirmed', title: '注文を受け付けました', label: '注文のお知らせ', isEnabled: true,
  category: 'order', introText: '', outroText: '', buttonLabel: '', buttonUrl: '', imageUrl: '', displayOrder: 0, fixedFields: [], fixedPreview: '', updatedAt: '' }
const rule = (status: 'draft' | 'published'): OperatorNotificationRule => ({ id: status, lineAccountId: 'account-a', name: `予約-${status}`, eventType: 'reservation.created', conditions: {}, channels: ['line'], status, recipientCount: 1, occurredToday: 0, version: 1, updatedAt: '' })
beforeEach(() => {
  vi.clearAllMocks(); fixture.tab = 'customer'; fixture.role = 'viewer'
  fixture.settings.mockResolvedValue({ success: true, data: [setting] })
  fixture.operators.mockResolvedValue({ success: true, data: { items: [rule('draft'), rule('published')], summary: { total: 2, published: 1, stopped: 1, missingRecipients: 0, recipients: 1, acceptedToday: 0, excludedToday: 0 } } })
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'content-type': 'application/json' } })))
  window.history.replaceState(null, '', '/line-notifications')
  forgetSessionSnapshot(); forgetStaffIdentity()
})
afterEach(() => { cleanup(); forgetSessionSnapshot(); forgetStaffIdentity(); vi.unstubAllGlobals() })
function assertLocked(control: HTMLElement, reason: string) {
  expect(control.getAttribute('aria-disabled')).toBe('true')
  expect((control as HTMLButtonElement).disabled).toBe(false)
  expect(control.hasAttribute('data-permission-locked')).toBe(true)
  expect(control.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')).toContain(reason)
  fireEvent.click(control)
  expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(false)
  expect(fireEvent.keyDown(control, { key: ' ' })).toBe(false)
}

it.each(['viewer', 'staff'])('%sも出す・止めると編集を同じ場所に残し、書込を始めない', async role => {
  fixture.role = role
  render(<LineNotificationsPage />)
  const toggle = await screen.findByRole('switch', { name: '注文のお知らせのお知らせを出す・止める' })
  await waitFor(() => expect(toggle.getAttribute('aria-disabled')).toBe('true'))
  const reason = role === 'viewer' ? PERMISSION_LOCK_REASON.viewer : PERMISSION_LOCK_REASON.manager
  assertLocked(toggle, reason)
  expect(screen.getByRole('region', { name: '操作権限の案内' }).textContent).toBe(role === 'viewer' ? READ_ONLY_MESSAGE : PERMISSION_LOCK_SUMMARY.manager)
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  act(() => toggle.focus())
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', reason)
  fireEvent.blur(toggle)
  fireEvent.click(screen.getByRole('button', { name: 'そのほかの操作' }))
  assertLocked(await screen.findByRole('menuitem', { name: '編集する' }), reason)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('下書きを保存')).toBeNull()
  expect(fixture.write).not.toHaveBeenCalled()
})

it('本人確認が済むまで操作を残して押せない状態にする', async () => {
  fixture.role = ''
  render(<LineNotificationsPage />)
  const toggle = await screen.findByRole('switch') as HTMLButtonElement
  expect(toggle.disabled).toBe(true)
  expect(screen.queryByRole('region', { name: '操作権限の案内' })).toBeNull()
  expect(screen.queryByText(READ_ONLY_MESSAGE)).toBeNull()
  fireEvent.click(toggle)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fixture.write).not.toHaveBeenCalled()
})

it.each(['owner', 'admin'])('%sの切替は元の確認窓を開き、確認前に書き込まない', async role => {
  fixture.role = role
  render(<LineNotificationsPage />)
  const toggle = await screen.findByRole('switch')
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  expect(toggle.getAttribute('aria-disabled')).not.toBe('true')
  expect(screen.queryByRole('region', { name: '操作権限の案内' })).toBeNull()
  fireEvent.click(toggle)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(fixture.write).not.toHaveBeenCalled()
})

it('開いた変更確認は権限喪失で閉じ、以後の変更を止める', async () => {
  fixture.role = 'owner'
  render(<LineNotificationsPage />)
  const toggle = await screen.findByRole('switch')
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(toggle)
  await screen.findByRole('dialog')
  act(() => rememberStaffIdentity({ role: 'staff', readOnly: true, roleBundle: 'view_only' } as StaffMember))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  assertLocked(screen.getByRole('switch'), PERMISSION_LOCK_REASON.viewer)
  expect(fixture.write).not.toHaveBeenCalled()
})

it('運用者の作成・CSVは隠さず理由付きで残し、遷移も始めない', async () => {
  fixture.tab = 'operator'
  render(<LineNotificationsPage />)
  const create = await screen.findByRole('button', { name: '運用者へのお知らせを作る' })
  await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('true'))
  assertLocked(create, PERMISSION_LOCK_REASON.viewer)
  assertLocked(screen.getByRole('button', { name: 'CSVで書き出す' }), PERMISSION_LOCK_REASON.viewer)
  expect(create.hasAttribute('href')).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fixture.write).not.toHaveBeenCalled()
})

it('運用者のテスト・公開・停止を残し、共有理由で書込を止める', async () => {
  rememberStaffIdentity({ role: 'staff', readOnly: true, roleBundle: 'view_only' } as StaffMember)
  render(<OperatorTab lineAccountId="account-a" canManage={false} exportOpen={false} onExportClose={() => {}} />)
  const tests = await screen.findAllByRole('button', { name: '自分にテスト' })
  for (const button of tests) assertLocked(button, PERMISSION_LOCK_REASON.viewer)
  fireEvent.click(screen.getByRole('button', { name: '予約-draftの操作' }))
  assertLocked(await screen.findByRole('menuitem', { name: '公開' }), PERMISSION_LOCK_REASON.viewer)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '予約-publishedの操作' }))
  assertLocked(await screen.findByRole('menuitem', { name: '止める' }), PERMISSION_LOCK_REASON.viewer)
  expect(fixture.write).not.toHaveBeenCalled()
})

it('閲覧の代理ログインでは帯と操作に代理閲覧の理由を出す', async () => {
  fixture.role = 'owner'
  render(<LineNotificationsPage />)
  const toggle = await screen.findByRole('switch')
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  act(() => rememberSessionSnapshot({ impersonation: { mode: 'read' } as OpsImpersonation, unfamiliarAt: null, stepUpMethod: 'none' }))
  await waitFor(() => expect(screen.getByRole('region', { name: '操作権限の案内' }).textContent).toBe(PERMISSION_LOCK_SUMMARY.impersonation))
  expect(screen.queryByText(READ_ONLY_MESSAGE)).toBeNull()
  expect(screen.queryByText(PERMISSION_LOCK_SUMMARY.manager)).toBeNull()
  assertLocked(toggle, PERMISSION_LOCK_REASON.impersonation)
  expect(fixture.write).not.toHaveBeenCalled()
})
