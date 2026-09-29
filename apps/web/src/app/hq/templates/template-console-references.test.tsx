// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TemplateConsole from './template-console'
import type { TemplateDefinition, TemplateType } from '@/lib/hq-templates-api'

/*
 * R119: 共通リッチメニュー・フォームで、存在するタグやテンプレートを選べない。
 * 一覧の `templates` は編集中の種類だけしか持たない。そこから別種類で絞ると
 * 常に空になる。種類を指定しない目録を別に取り、参照候補はそこから作る。
 */
const calls = vi.hoisted(() => ({
  list: vi.fn(),
  accounts: vi.fn(),
  context: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  preflight: vi.fn(),
  distribute: vi.fn(),
  result: vi.fn(),
  uploadImage: vi.fn(),
}))
vi.mock('@/lib/hq-templates-api', () => ({
  TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form'],
  hqTemplatesApi: calls,
}))
vi.mock('./template-definition-editor', () => {
  const freshDefinition = (type: TemplateType): TemplateDefinition => type === 'rich_menu'
    ? { schemaVersion: 1, richMenu: { id: 'rich-menu-main', name: '', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: '', areas: [] }] } }
    : { schemaVersion: 1, form: { name: '', description: null, fields: [], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } }
  // 受け取った参照候補をそのまま文字で出す探り。候補が空のままなら出ない。
  function Probe({ richMenuReferences, formReferences }: {
    richMenuReferences?: { tags?: { id: string; name: string }[]; templates?: { id: string; name: string }[]; forms?: { id: string; name: string }[] }
    formReferences?: { tags?: { id: string; name: string }[] }
  }) {
    return (
      <div data-testid="reference-probe">
        {(richMenuReferences?.tags ?? []).map((t) => <span key={`tag-${t.id}`} data-testid={`richmenu-tag-${t.id}`}>{t.name}</span>)}
        {(richMenuReferences?.templates ?? []).map((t) => <span key={`tpl-${t.id}`} data-testid={`richmenu-template-${t.id}`}>{t.name}</span>)}
        {(richMenuReferences?.forms ?? []).map((t) => <span key={`form-${t.id}`} data-testid={`richmenu-form-${t.id}`}>{t.name}</span>)}
        {(formReferences?.tags ?? []).map((t) => <span key={`ftag-${t.id}`} data-testid={`form-tag-${t.id}`}>{t.name}</span>)}
      </div>
    )
  }
  return {
    default: Probe,
    freshDefinition,
    definitionName: () => '編集中',
    definitionForName: (_type: TemplateType, value: TemplateDefinition) => value,
    definitionError: () => null,
    referenceCount: () => 0,
  }
})
vi.mock('next/navigation', () => ({ usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

const tagRow = { id: 'tag-1', name: '来店タグ', description: null, template_type: 'tag', revision: 1, updated_at: '2026-09-12T00:00:00Z' }
const templateRow = { id: 'tpl-1', name: 'お礼テンプレート', description: null, template_type: 'template', revision: 1, updated_at: '2026-09-12T00:00:00Z' }
const formRow = { id: 'form-1', name: 'アンケートフォーム', description: null, template_type: 'form', revision: 1, updated_at: '2026-09-12T00:00:00Z' }
const menuRow = { id: 'menu-1', name: 'アカウントメニュー', description: null, template_type: 'rich_menu', revision: 1, updated_at: '2026-09-12T00:00:00Z' }
const menuDetail = {
  template: menuRow,
  definition: { schemaVersion: 1, richMenu: { id: 'rich-menu-main', name: 'アカウントメニュー', chatBarText: 'メニュー', size: 'large', defaultPageId: 'page-1', pages: [{ id: 'page-1', name: 'メイン', imageR2Key: 'hq-templates/tenant-a/menu.png', areas: [] }] } },
}
const formDetail = {
  template: formRow,
  definition: { schemaVersion: 1, form: { name: 'アンケートフォーム', description: null, fields: [], layout: null, on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true } },
}

beforeEach(() => {
  vi.resetAllMocks()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/hq/templates?type=rich_menu')
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.accounts.mockResolvedValue([{ id: 'a', name: '銀座本店' }])
  calls.list.mockImplementation(async (type?: string) => (type ? [menuRow] : [tagRow, templateRow, formRow, menuRow]))
  calls.get.mockResolvedValue(structuredClone(menuDetail))
})
afterEach(cleanup)

async function openMenuEdit() {
  render(<TemplateConsole type="rich_menu" />)
  fireEvent.click(await screen.findByLabelText('アカウントメニューの操作'))
  fireEvent.click(screen.getByRole('button', { name: 'アカウントメニューを編集' }))
  await screen.findByTestId('reference-probe')
}

describe('R119 参照候補の目録', () => {
  it('リッチメニュー編集中に別種類のタグ・テンプレート・フォームを選べる', async () => {
    await openMenuEdit()
    // 目録は種類を指定せずに取りに行く。一覧の `list(type)` とは別の口。
    expect(calls.list).toHaveBeenCalledWith()
    expect(calls.list).toHaveBeenCalledWith('rich_menu')
    expect(screen.getByTestId('richmenu-tag-tag-1').textContent).toBe('来店タグ')
    expect(screen.getByTestId('richmenu-template-tpl-1').textContent).toBe('お礼テンプレート')
    expect(screen.getByTestId('richmenu-form-form-1').textContent).toBe('アンケートフォーム')
  })

  it('フォーム編集中にタグを選べる', async () => {
    calls.list.mockImplementation(async (type?: string) => (type ? [formRow] : [tagRow, templateRow, formRow, menuRow]))
    calls.get.mockResolvedValue(structuredClone(formDetail))
    render(<TemplateConsole type="form" />)
    fireEvent.click(await screen.findByLabelText('アンケートフォームの操作'))
    fireEvent.click(screen.getByRole('button', { name: 'アンケートフォームを編集' }))
    await screen.findByTestId('reference-probe')
    expect(screen.getByTestId('form-tag-tag-1').textContent).toBe('来店タグ')
  })

  it('目録の取得失敗は0件と区別し、読み直せる', async () => {
    calls.list.mockImplementation(async (type?: string) => {
      if (!type) throw new Error('network')
      return [menuRow]
    })
    await openMenuEdit()
    expect(screen.getByText('参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。')).toBeTruthy()
    expect(screen.queryByTestId('richmenu-tag-tag-1')).toBeNull()
    calls.list.mockImplementation(async (type?: string) => (type ? [menuRow] : [tagRow, templateRow, formRow, menuRow]))
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await screen.findByTestId('richmenu-tag-tag-1')
    expect(screen.queryByText('参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。')).toBeNull()
  })
})
