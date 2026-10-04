// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TemplateConsole from './template-console'
import type { Preflight, TemplateDefinition, TemplateType } from '@/lib/hq-templates-api'

/**
 * 配布の V8（板 meBRB）。
 * - 配る2段階（アカウント・重複確認）の外枠に meBRB を付ける
 * - 配っている間は「配布の進み具合」の箱を出す（数はまだ分からないので帯だけ）
 * 選び方・送り方・失敗の扱いは変えない。
 */

const calls = vi.hoisted(() => Object.fromEntries(['uploadImage','deleteImage','context','list','accounts','get','create','update','remove','preflight','distribute','result'].map(key => [key, vi.fn()])))
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag','template','rich_menu','form'], hqTemplatesApi: calls }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('./template-definition-editor', () => {
  const freshDefinition = (type: TemplateType): TemplateDefinition => type === 'tag'
    ? { schemaVersion: 1, tag: { name: '', folderId: null }, folders: [] }
    : { schemaVersion: 1, tag: { name: '', folderId: null }, folders: [] } as TemplateDefinition
  const definitionName = (type: TemplateType, value: TemplateDefinition) => type === 'tag' && 'tag' in value ? value.tag.name : ''
  const definitionForName = (type: TemplateType, value: TemplateDefinition, name: string, description: string): TemplateDefinition => value
  const definitionError = () => null
  function Editor() { return null }
  return { default: Editor, freshDefinition, definitionName, definitionForName, definitionError, referenceCount: () => 0 }
})
vi.mock('next/navigation', () => ({ usePathname: () => '/hq/templates', useRouter: () => ({ push: vi.fn() }) }))

const template = { id: 't1', name: '来店済み', description: '説明', template_type: 'tag', revision: 3, updated_at: '2026-09-12T00:00:00Z' }
const detail = { template, definition: { schemaVersion: 1, tag: { name: '来店済み', folderId: 'f1' }, folders: [{ id: 'f1', name: '来店管理' }] } }
const accounts = [{ id: 'a', name: '銀座本店' }]
const checked = (): Preflight => ({ preflightId: 'p1', expiresAt: new Date(Date.now() + 60_000).toISOString(), stores: accounts.map(a => ({ accountId: a.id, accountName: a.name, items: [{ sourceId: 'tag1', itemKind: 'tag', name: '来店済み', expectedRevision: 'v3', duplicate: true, allowedModes: ['overwrite','alias'] }] })) })

beforeEach(() => {
  vi.resetAllMocks(); window.sessionStorage.clear(); window.history.replaceState(null, '', '/hq/templates?type=tag')
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([template]); calls.accounts.mockResolvedValue(accounts); calls.get.mockResolvedValue(structuredClone(detail))
  calls.preflight.mockImplementation(async () => checked())
  calls.distribute.mockReturnValue(new Promise(() => {}))
})
afterEach(cleanup)

describe('配布の V8（meBRB）', () => {
  it('配る2段階に meBRB を付け、配っている間は進み具合の箱を出す', async () => {
    render(<TemplateConsole type="tag" useCanonicalEditors={false} />)
    await screen.findByLabelText('来店済みの操作')
    fireEvent.click(screen.getByLabelText('来店済みの操作'))
    fireEvent.click(screen.getByRole('button', { name: '来店済みをアカウントへ配る' }))
    await screen.findByRole('checkbox', { name: '銀座本店' })
    expect(document.querySelector('[data-design-node="meBRB"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '銀座本店' }))
    fireEvent.click(screen.getByRole('button', { name: '1アカウントの重複を確認' }))
    await screen.findByText('重複する項目が1件あります')
    expect(document.querySelector('[data-design-node="meBRB"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'すべて別名で作る' }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容で1アカウントへ配布' }))
    const progress = await screen.findByLabelText('配布の進み具合')
    expect(progress.textContent).toMatch(/配布番号：p1/)
    expect(calls.distribute).toHaveBeenCalledOnce()
  })

  it('行の「…」は矢印キーで項目を移動できる', async () => {
    render(<TemplateConsole type="tag" useCanonicalEditors={false} />)
    fireEvent.click(await screen.findByLabelText('来店済みの操作'))
    const edit = await screen.findByRole('button', { name: '来店済みを編集' })
    const distribute = screen.getByRole('button', { name: '来店済みをアカウントへ配る' })
    edit.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(distribute)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(edit)
  })
})
