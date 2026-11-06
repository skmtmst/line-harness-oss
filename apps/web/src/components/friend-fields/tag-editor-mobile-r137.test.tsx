// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Tag, TagGroup } from '@line-crm/shared'
import type { TagDependencies } from '@/lib/api'
import type { TagDefinition } from '@/lib/hq-templates-api'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    commonActions: { ...actual.api.commonActions, resources: async () => ({ success: false, error: 'fixture unavailable' }) },
    tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
  } }
})
import { TagEditForm } from '@/v8/tag-edit/edit-form'
import HqTagEditorV8 from '@/v8/hq-templates/tag-editor'

const tag = { id: 't1', name: '会員', status: 'active' } as Tag
const props = () => ({ tag, groups: [] as TagGroup[], dependencies: null as TagDependencies | null, accountId: 'a1', readOnly: false, conflict: false, compareBusy: false,
  onCompare: vi.fn(), onReloadLatest: vi.fn(), retroactiveReference: false, initialActions: [], saving: false, error: '', onCancel: vi.fn(), onSave: vi.fn(async (_values: unknown, _retroactive: boolean) => {}), onDelete: vi.fn() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('R137 タグ編集の入力と使用先（幅はCIの実寸検査へ）', () => {
  it('タグ名と所属フォルダの選択を保存へ渡す', async () => {
    const state = props()
    render(<TagEditForm {...state} groups={[{ id: 'g1', name: '店頭', color: null, accountId: 'a1', sortOrder: 0, createdAt: '', updatedAt: '' }]} />)
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: '会員の新しい名前' } })
    fireEvent.click(screen.getByRole('button', { name: '所属フォルダ', exact: true }))
    fireEvent.click(within(await screen.findByRole('option', { name: '店頭', exact: true })).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'タグを保存する', exact: true }))
    await waitFor(() => expect(state.onSave).toHaveBeenCalledTimes(1))
    expect(state.onSave.mock.calls[0][0]).toMatchObject({ name: '会員の新しい名前', groupId: 'g1' })
  })

  it('統括の見本へ長い名前を渡し、名前を変えると全文も更新する', () => {
    const name = 'とても長いタグの名前を最後まで確かめる会員向けの目印'
    const definition: TagDefinition = { schemaVersion: 1, tag: { name, linkedEnabled: false }, folders: [] }
    render(<HqTagEditorV8 definition={definition} editing={false} saving={false} onCancel={() => {}} onSave={async () => {}} />)
    const preview = screen.getByRole('heading', { name: 'できあがるタグ' }).closest('aside')!
    expect(within(preview).getByRole('group', { name: `タグ「${name}」` }).textContent).toContain(name)
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: '変えた名前' } })
    expect(within(preview).getByRole('group', { name: 'タグ「変えた名前」' }).textContent).toContain('変えた名前')
    expect(within(preview).queryByRole('group', { name: `タグ「${name}」` })).toBeNull()
  })

  it('右の使用先には取得した件数と正しい行き先を出す', () => {
    const state = props()
    const dependencies = { referenceCounts: { scenarios: 2 }, references: [{ kind: 'scenario', href: '/scenarios?tag=t1' }] } as TagDependencies
    render(<TagEditForm {...state} dependencies={dependencies} />)
    const preview = screen.getByRole('heading', { name: '使っている所' }).closest('aside')!
    const link = within(preview).getByRole('link', { name: '2 件 →' })
    const destination = new URL(link.getAttribute('href')!, 'https://fixture.invalid')
    expect(destination.pathname).toBe('/scenarios')
    expect(destination.searchParams.get('tag')).toBe('t1')
  })
})
