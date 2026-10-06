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
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('next/navigation', () => ({ usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))

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
  render(<TemplateConsole type="template" useCanonicalEditors={false} />)
  await screen.findByRole('button', { name: '＋ひな形を作る' })
  fireEvent.click(screen.getByRole('button', { name: '＋ひな形を作る' }))
  await screen.findByRole('button', { name: 'ひな形を保存' })
}

describe('メッセージのひな形を作るV8（X4JcOf）', () => {
  it('絵の欄と一段保存を出し、段階保存の口は出さない', async () => {
    await startCreate()
    expect(screen.getByText('ひな形の中身')).toBeTruthy()
    expect(screen.getByLabelText('ひな形の名前')).toBeTruthy()
    expect(screen.getByLabelText('テンプレートの分類')).toBeTruthy()
    expect(screen.getByLabelText('配信する本文')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ひな形の形式'), { target: { value: 'flex' } })
    expect(screen.getByLabelText('メッセージ画像を選ぶ')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '下書きを保存する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存して配布先を選ぶ' })).toBeNull()
  })

  it('タイトルとボタンを保存口につなぎ、右のLINEプレビューを残す', async () => {
    await startCreate()
    fireEvent.change(screen.getByLabelText('ひな形の形式'), { target: { value: 'flex' } })
    fireEvent.change(screen.getByLabelText('ひな形のタイトル'), { target: { value: 'お知らせ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ボタンを追加' }))
    expect(screen.getByLabelText('ボタン1の文字')).toBeTruthy()
    expect(document.querySelector('[data-design=Right]')).toBeTruthy()
  })

  it('保存する中身は今の口のまま送る', async () => {
    await startCreate()
    fireEvent.change(screen.getByLabelText('ひな形の名前'), { target: { value: '秋の新商品のお知らせ' } })
    fireEvent.change(screen.getByLabelText('テンプレートの分類'), { target: { value: '季節のお知らせ' } })
    fireEvent.change(screen.getByLabelText('配信する本文'), { target: { value: '秋の新商品、はじまりました' } })
    fireEvent.click(screen.getByRole('button', { name: 'ひな形を保存' }))
    await screen.findByRole('button', { name: '＋ひな形を作る' })
    expect(calls.create).toHaveBeenCalledOnce()
    const [input] = calls.create.mock.calls[0] as [{ type: string; name: string; definition: { template: { category: string; messageContent: string } } }]
    expect(input.type).toBe('template')
    expect(input.name).toBe('秋の新商品のお知らせ')
    expect(input.definition.template.category).toBe('季節のお知らせ')
    expect(input.definition.template.messageContent).toBe('秋の新商品、はじまりました')
  })
})
