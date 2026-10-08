// @vitest-environment happy-dom
/*
 * 板 X4JcOf：メッセージのひな形を作る（V8だけ）。
 * 絵の「ひな形の中身＋右に LINE の見え方＋一段のひな形を保存」。
 * APIのタイトル・ボタンを含めても一段保存と右の見え方を保つ。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TemplateConsole from './template-console'

const calls = vi.hoisted(() => Object.fromEntries(['uploadImage', 'deleteImage', 'context', 'list', 'accounts', 'get', 'create', 'update', 'remove', 'preflight', 'distribute', 'result', 'folderList', 'messageReferences'].map((key) => [key, vi.fn()])))
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form'], hqTemplatesApi: { listStats: async () => ({ thisMonthSentCount: 0, outdatedTemplateCount: 0 }), listByKind: () => calls.list('template'), kindCounts: async () => ({}), versions: async () => [], receivedVersions: async () => [], messageReferences: async () => [], ...calls, folders: { list: calls.folderList } } }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search),  usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))

const savedDetail = () => ({
  template: { id: 't1', name: '秋の新商品のお知らせ', description: '', template_type: 'template', revision: 1, updated_at: '2026-10-04T00:00:00Z' },
  definition: {
    schemaVersion: 1,
    template: { id: 'hq-authored-message', name: '秋の新商品のお知らせ', category: '季節のお知らせ', messageType: 'text', messageContent: '秋の新商品、はじまりました', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
    media: [],
  },
})

beforeEach(() => {
  vi.resetAllMocks(); window.sessionStorage.clear(); window.history.replaceState(null, '', '/hq/templates?type=template')
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([])
  calls.accounts.mockResolvedValue([])
  calls.folderList.mockResolvedValue([])
  calls.messageReferences.mockResolvedValue([])
  calls.create.mockImplementation(async (input: unknown) => ({ template: { ...(savedDetail().template), name: (input as { name: string }).name }, definition: (input as { definition: unknown }).definition }))
})
afterEach(cleanup)

async function startCreate() {
  render(<TemplateConsole type="template" />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'テンプレートを作る' }))[0])
  await screen.findByLabelText('テンプレート名')
}

describe('統括メッセージを店と共通のV8編集部品で作る', () => {
  it('名前・本文・下書き保存・配る保存を出す', async () => {
    await startCreate()
    expect(screen.getByLabelText('テンプレート名')).toBeTruthy()
    expect(screen.getByLabelText('本文')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下書きを保存' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存する' })).toBeTruthy()
  })
  it('本文の変更をLINEプレビューへ反映する', async () => {
    await startCreate()
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: 'プレビューに出す本文' } })
    expect(screen.getAllByText('プレビューに出す本文').length).toBeGreaterThan(0)
    expect(calls.create).not.toHaveBeenCalled()
  })
  it('統括の保存口へ名前と本文を送り、保存後に配布先を選べる', async () => {
    await startCreate()
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '秋の新商品のお知らせ' } })
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '秋の新商品、はじまりました' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('button', { name: 'あとで' })
    expect(calls.create).toHaveBeenCalledOnce()
    const [input, requestId] = calls.create.mock.calls[0]
    expect(requestId).toBeTruthy()
    expect(input).toMatchObject({ type: 'template', name: '秋の新商品のお知らせ', definition: { template: { messageType: 'text', messageContent: '秋の新商品、はじまりました' } } })
  })
})

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: vi.fn(), loading: false }) }))

vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
