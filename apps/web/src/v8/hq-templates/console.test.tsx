// @vitest-environment happy-dom
/*
 * 統括のテンプレート（B-29・B-36）：作るは店のテンプレートの作る画面（メッセージ HfK0O・クーポン C3qMCz）を使い、
 * 下の帯の主ボタンは［保存して配る］。保存は統括の口（ひな形）へ、配るは「アカウントへ配る」へ進む。
 * 詳細（pQ4fH）は「配った先」（API-14 の配った先のアカウント名）と［アカウントへ配る］。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => Object.fromEntries(['context', 'list', 'listByKind', 'kindCounts', 'accounts', 'get', 'create', 'update', 'remove', 'duplicate', 'preflight', 'distribute', 'result', 'messageReferences', 'folderList', 'deleteImage'].map((key) => [key, vi.fn()])))
const push = vi.hoisted(() => vi.fn())
const selectAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form', 'scenario'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: selectAccount, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], scenarios: [], templates: [], forms: [], reminders: [], richMenus: [] }) }))

import HqTemplatesV8 from './console'

const message = {
  schemaVersion: 1,
  template: { id: 'hq-authored-message', name: '予約前日のご案内', category: 'general', messageType: 'text', messageContent: '{{name}}さん、明日のご予約です', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
  media: [],
}
const detail = (definition: unknown = message) => ({ template: { id: 't-1', name: '予約前日のご案内', description: '', template_type: 'template', folder_id: null, revision: 3, updated_at: '2026-08-21T09:02:00Z' }, definition })
const listRow = { ...detail().template, kind: 'message', content_summary: '本文', distributed_account_count: 4, distributed_account_names: ['然 -NEN- 本店', '然 -NEN- 渋谷店', '2025年イベント'], distributed_account_more: 1 }

beforeEach(() => {
  window.sessionStorage.clear()
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([listRow])
  calls.listByKind.mockResolvedValue([listRow])
  calls.kindCounts.mockResolvedValue({ message: 1, carousel: 0, rich_message: 0, question: 0, coupon: 0, research: 0 })
  calls.accounts.mockResolvedValue([{ id: 'a-1', name: '然 -NEN- 本店' }, { id: 'a-2', name: '然 -NEN- 渋谷店' }])
  calls.folderList.mockResolvedValue([{ id: 'f-1', name: '予約', revision: 1 }])
  calls.messageReferences.mockResolvedValue([])
  calls.get.mockResolvedValue(detail())
  calls.create.mockImplementation(async (input: { name: string; definition: unknown }) => ({ template: { ...detail().template, id: 't-new', name: input.name }, definition: input.definition }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('統括のテンプレートを作る（店の作る画面＋保存して配る）', () => {
  it('メッセージは店の作る画面で作り、［保存して配る］で統括のひな形を作ってアカウントへ配るへ進む', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← テンプレートへ' }).getAttribute('href')).toBe('/hq/templates')
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '予約前日' } })
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '{{name}}さん、明日です' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して配る' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    const [input, requestId] = calls.create.mock.calls[0]
    expect(requestId).toBeTruthy()
    expect(input).toMatchObject({ type: 'template', name: '予約前日', folderId: null })
    expect(input.definition.template).toMatchObject({ name: '予約前日', messageType: 'text', messageContent: '{{name}}さん、明日です' })
    /* 保存のあとは「アカウントへ配る」（meBRB）。 */
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 本店/ })).toBeTruthy()
  })

  it('クーポンは店のクーポンを作る画面で作り、店と同じ形の payload を統括のひな形の素材にする（店のアカウントに結びつく欄は出さない）', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /クーポン/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByRole('heading', { name: 'クーポンを作る' })).toBeTruthy()
    expect(screen.queryByText('使われたときに行うこと')).toBeNull()
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '冬の10%オフ' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    /* 期間が無いと口を呼ばない。 */
    expect((await screen.findByRole('alert')).textContent).toContain('使える期間')
    expect(calls.create).not.toHaveBeenCalled()
  })
})

describe('統括のテンプレートの詳細（pQ4fH）', () => {
  it('名前を押すと詳細。配った先のアカウント名と［このアカウントへ入る］・［アカウントへ配る］を出す', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('button', { name: '予約前日のご案内' }))
    expect(await screen.findByRole('heading', { name: '配った先' })).toBeTruthy()
    expect(screen.getByText('4 アカウントに配りました。新しい版を配ると、4 アカウントのテンプレートが新しい版になります。')).toBeTruthy()
    expect(screen.getByText('ほか 1 アカウント')).toBeTruthy()
    const enter = screen.getAllByRole('button', { name: /このアカウントへ入る/ })
    expect(enter).toHaveLength(2)
    fireEvent.click(enter[0])
    expect(selectAccount).toHaveBeenCalledWith('a-1')
    expect(push).toHaveBeenCalledWith('/templates')
    fireEvent.click(screen.getAllByRole('button', { name: /アカウントへ配る/ })[0])
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 渋谷店/ })).toBeTruthy()
  })
})
