// @vitest-environment happy-dom
/*
 * 統括のテンプレート（・）：作るは店のテンプレートの作る画面（メッセージ ・クーポン ）を使い、
 * 下の帯の主ボタンは［保存する］。保存は統括の口（ひな形）へ、配るは「アカウントへ配る」へ進む。
 * 詳細は「配った先」（API-14 の配った先のアカウント名）と［配る］（読み上げは「〇〇を配る」）。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => Object.fromEntries(['context', 'list', 'listByKind', 'kindCounts', 'accounts', 'get', 'create', 'update', 'remove', 'duplicate', 'preflight', 'distribute', 'result', 'messageReferences', 'folderList', 'deleteImage', 'uploadRichMessageImage', 'uploadImage', 'listStats', 'versions', 'receivedVersions', 'compareVersions', 'restoreVersion'].map((key) => [key, vi.fn()])))
const push = vi.hoisted(() => vi.fn())
const selectAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    lineAccounts: { ...actual.api.lineAccounts, list: vi.fn(async () => ({ success: true, data: [
      { id: 'a-1', name: '然 -NEN- 本店', folderId: 'direct' }, { id: 'a-2', name: '然 -NEN- 渋谷店', folderId: 'direct' },
    ] })) },
    lineAccountFolders: { ...actual.api.lineAccountFolders, list: vi.fn(async () => ({ success: true, data: { folders: [{ id: 'direct', name: '直営店', color: '#2563eb', displayOrder: 0 }] } })) },
  } }
})
vi.mock('@/lib/hq-templates-api', async (original) => ({ ...await original<typeof import('@/lib/hq-templates-api')>(), TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form', 'scenario'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))
vi.mock('@/lib/staff-role', () => ({ useTenantWideAccess: () => true, useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: selectAccount, loading: false }) }))
const chrome = vi.hoisted(() => ({ crumbs: null as Array<{ label: string; href?: string; onSelect?: () => void }> | null }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: (crumbs: typeof chrome.crumbs) => { chrome.crumbs = crumbs } }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], scenarios: [], templates: [], forms: [], reminders: [], richMenus: [] }) }))

import React from 'react'
import type { FormEditHost } from '@/v8/form-edit/public/host/index'
import type { FormDefinition } from '@/lib/hq-templates-api'
import { deferred } from '@/test-utils/race'
const editor = vi.hoisted(() => ({ host: null as FormEditHost | null }))
vi.mock('@/v8/form-edit/public/edit/index', () => ({ FormEditV8: function FormEditorProbe({ host }: { host: FormEditHost }) {
  editor.host = host
  const [name, setName] = React.useState(host.initial.name)
  return <section><label>フォーム名<input value={name} onChange={event => setName(event.target.value)} /></label>{host.notice}</section>
} }))
import HqTemplatesV8 from './console'

const message = {
  schemaVersion: 1,
  template: { id: 'hq-authored-message', name: '予約前日のご案内', category: 'general', messageType: 'text', messageContent: '{{name}}さん、明日のご予約です', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
  media: [],
}
const detail = (definition: unknown = message) => ({ template: { id: 't-1', name: '予約前日のご案内', description: '', template_type: 'template', folder_id: null, revision: 3, updated_at: '2026-08-21T09:02:00Z' }, definition })
const listRow = { ...detail().template, kind: 'message', content_summary: '本文', distributed_account_count: 4, distributed_account_names: ['然 -NEN- 本店', '然 -NEN- 渋谷店', '2025年イベント'], distributed_account_more: 1 }

beforeEach(() => {
  Object.values(calls).forEach((mock) => mock.mockReset())
  window.history.replaceState(null, '', '/hq/templates')
  window.sessionStorage.clear()
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([listRow])
  calls.listByKind.mockResolvedValue([listRow])
  calls.kindCounts.mockResolvedValue({ message: 1, carousel: 0, rich_message: 0, question: 0, coupon: 0, research: 0 })
  calls.accounts.mockResolvedValue([{ id: 'a-1', name: '然 -NEN- 本店' }, { id: 'a-2', name: '然 -NEN- 渋谷店' }])
  calls.folderList.mockResolvedValue([{ id: 'f-1', name: '予約', revision: 1 }])
  calls.messageReferences.mockResolvedValue([])
  calls.listStats.mockResolvedValue({ thisMonthSentCount: 0, outdatedTemplateCount: 0 })
  calls.versions.mockResolvedValue([])
  calls.receivedVersions.mockResolvedValue([])
  calls.get.mockResolvedValue(detail())
  calls.create.mockImplementation(async (input: { name: string; definition: unknown }) => ({ template: { ...detail().template, id: 't-new', name: input.name }, definition: input.definition }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })


const formDefinition: FormDefinition = { schemaVersion: 1, form: {
  name: '来店アンケート', description: null,
  fields: [{ name: 'purpose', label: 'ご来店の目的', type: 'text', required: false }],
  layout: { version: 2, header: [], sections: [{ id: 's1', name: 'ご来店について', blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'purpose', label: 'ご来店の目的', required: false }] }], options: {} },
  on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true,
} }
const formRow = { id: 'form-1', name: '来店アンケート', description: '', template_type: 'form', folder_id: null, revision: 3, updated_at: '2026-10-31T00:00:00Z', content_summary: '質問1', distributed_account_count: 0, distributed_account_names: [], distributed_account_more: 0 }
const savedDetail = () => ({ template: { ...formRow, name: '保存していない名前', revision: 4 }, definition: { ...formDefinition, form: { ...formDefinition.form, name: '保存していない名前' } } })
beforeEach(() => {
  editor.host = null
  calls.list.mockResolvedValue([formRow])
  calls.get.mockResolvedValue({ template: formRow, definition: formDefinition })
  calls.update.mockResolvedValue(savedDetail())
})
async function openForm() {
  render(<HqTemplatesV8 type="form" />)
  fireEvent.click((await screen.findByRole('link', { name: '来店アンケート' })).closest('tr')!)
  const input = await screen.findByLabelText('フォーム名')
  fireEvent.change(input, { target: { value: '保存していない名前' } })
  return { ...editor.host!.initial, name: '保存していない名前' }
}

it('保存が確定するまでPromiseが終わらず、統括の更新が成功したときだけtrueを返す', async () => {
  const reply = deferred<ReturnType<typeof savedDetail>>()
  calls.update.mockReturnValueOnce(reply.promise)
  const content = await openForm()
  let result!: Promise<boolean>
  act(() => { result = editor.host!.onSave(content, false) })
  expect(result).toBeInstanceOf(Promise)
  let settled = false
  void result.then(() => { settled = true })
  await waitFor(() => expect(calls.update).toHaveBeenCalledOnce())
  expect(settled).toBe(false)
  expect(screen.getByDisplayValue('保存していない名前')).toBeTruthy()
  await act(async () => { reply.resolve(savedDetail()); expect(await result).toBe(true) })
  expect(calls.update).toHaveBeenCalledWith('form-1', expect.objectContaining({ expectedRevision: 3, name: '保存していない名前' }))
  expect(calls.distribute).not.toHaveBeenCalled()
})

it('保存の失敗はfalseを返し、入力と編集画面を残して配る操作へ進めない', async () => {
  calls.update.mockRejectedValueOnce(new Error('保存を拒否しました'))
  const content = await openForm()
  const locationBefore = window.location.href
  await act(async () => { expect(await editor.host!.onSave(content, true)).toBe(false) })
  expect(screen.getByDisplayValue('保存していない名前')).toBeTruthy()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '失敗：保存を拒否しました')
  expect(window.location.href).toBe(locationBefore)
  expect(calls.preflight).not.toHaveBeenCalled()
  expect(calls.distribute).not.toHaveBeenCalled()
})

it('保存中の重複操作はfalseで返し、1回目の成功を待たずに成功扱いしない', async () => {
  const reply = deferred<ReturnType<typeof savedDetail>>()
  calls.update.mockReturnValueOnce(reply.promise)
  const content = await openForm()
  let first!: Promise<boolean>
  act(() => { first = editor.host!.onSave(content, false) })
  await waitFor(() => expect(calls.update).toHaveBeenCalledOnce())
  await act(async () => { expect(await editor.host!.onSave(content, false)).toBe(false) })
  expect(calls.update).toHaveBeenCalledOnce()
  await act(async () => { reply.resolve(savedDetail()); expect(await first).toBe(true) })
})

it('保存用の定義へ変換できなければfalseを返し、更新を送らず入力を残す', async () => {
  const content = await openForm()
  await act(async () => { expect(await editor.host!.onSave({ ...content, layout: null as unknown as typeof content.layout }, false)).toBe(false) })
  expect(calls.update).not.toHaveBeenCalled()
  expect(screen.getByDisplayValue('保存していない名前')).toBeTruthy()
})

it('画面を閉じた後に更新の応答が届いても、次の画面へ進む成功を返さない', async () => {
  const reply = deferred<ReturnType<typeof savedDetail>>()
  calls.update.mockReturnValueOnce(reply.promise)
  const content = await openForm()
  let result!: Promise<boolean>
  act(() => { result = editor.host!.onSave(content, false) })
  await waitFor(() => expect(calls.update).toHaveBeenCalledOnce())
  cleanup()
  await act(async () => { reply.resolve(savedDetail()); expect(await result).toBe(false) })
  expect(push).not.toHaveBeenCalled()
})
