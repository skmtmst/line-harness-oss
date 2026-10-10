// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { IncomingWebhookDetail } from '@/lib/api'
const mocks = vi.hoisted(() => ({ resources: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, commonActions: { ...actual.api.commonActions, resources: mocks.resources }, webhooks: { ...actual.api.webhooks, incoming: { ...actual.api.webhooks.incoming, saveConfig: mocks.save } } } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
import IncomingActions from './incoming-actions'
const identity = { methods: [{ kind: 'harness_friend_id' as const, path: 'customer.id' }], onNotFound: 'unmatched_box' as const }
const detail = { id: 'hook-1', version: 7, identityMatching: identity, actions: [{ refKind: 'tag', refId: 'tag-old', refVersionId: null, displayName: '前のタグ' }] } as IncomingWebhookDetail
const resources = { tags: [{ id: 'tag-new', name: '新しいタグ' }], templates: [], scenarios: [], webhooks: [], richMenus: [], commonActions: [], supportMarks: [] }
const saved = vi.fn()
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function addTag() {
  await waitFor(() => expect(mocks.resources).toHaveBeenCalledWith('owner-account'))
  fireEvent.click(screen.getByRole('button', { name: '行うことを足す' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /タグを付ける/ }))
  const dialog = screen.getByRole('dialog', { name: 'タグを付ける対象を選ぶ' })
  fireEvent.click(within(dialog).getByRole('radio', { name: '新しいタグ' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '選ぶ' }))
}
it('版と照合設定を保ち、確定した対象を順番どおり保存する', async () => {
  mocks.resources.mockResolvedValue({ success: true, data: resources }); mocks.save.mockResolvedValue({ success: true })
  render(<IncomingActions detail={detail} accountId="owner-account" readOnly={false} onSaved={saved} onGuardReady={() => {}} />)
  await addTag()
  fireEvent.click(screen.getByRole('button', { name: '行うことを保存する' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(mocks.save).toHaveBeenCalledWith('hook-1', 'owner-account', { expectedVersion: 7, identityMatching: identity, actions: [
    { refKind: 'tag', refId: 'tag-old', refVersionId: null }, { refKind: 'tag', refId: 'tag-new', refVersionId: null },
  ] })
})
it('保存失敗でも追加した行を残し、再試行できる', async () => {
  mocks.resources.mockResolvedValue({ success: true, data: resources }); mocks.save.mockRejectedValueOnce(new Error('通信に失敗しました')).mockResolvedValue({ success: true })
  render(<IncomingActions detail={detail} accountId="owner-account" readOnly={false} onSaved={saved} onGuardReady={() => {}} />)
  await addTag(); fireEvent.click(screen.getByRole('button', { name: '行うことを保存する' }))
  await screen.findByText('通信に失敗しました')
  expect(screen.getByRole('button', { name: '新しいタグ' })).toBeTruthy(); expect(saved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '行うことを保存する' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(mocks.save).toHaveBeenCalledTimes(2)
})
it('閲覧だけの人には変更・保存を出さない', () => {
  render(<IncomingActions detail={detail} accountId="owner-account" readOnly onSaved={saved} onGuardReady={() => {}} />)
  expect(screen.getByText('前のタグ')).toBeTruthy(); expect(screen.queryByRole('button', { name: '行うことを足す' })).toBeNull()
  expect(screen.queryByRole('button', { name: '行うことを保存する' })).toBeNull(); expect(mocks.resources).not.toHaveBeenCalled()
})
