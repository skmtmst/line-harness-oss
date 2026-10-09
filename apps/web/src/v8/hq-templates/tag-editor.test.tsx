// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TagDefinition } from '@/lib/hq-templates-api'

const store = vi.hoisted(() => ({ list: vi.fn(), retroactivePreview: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { tags: store } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/hq/friend-attributes' }))
import HqTagEditorV8 from './tag-editor'
import { folderDisplayColor } from '@/components/shared/folder-dot'

const definition: TagDefinition = {
  schemaVersion: 1,
  tag: { name: '会員', folderId: 'members', isStarred: true, linkedEnabled: true, reapplyPolicy: 'every_time', mileage: { self: 10, referrer: 5, multiplier: 12000, priority: 2 }, actions: [] },
  folders: [{ id: 'members', name: '会員向け', color: '#087a3e' }],
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('統括の V8 タグ編集と保存先', () => {
  it('店のAPIや遡及処理を呼ばず、名前・フォルダ・マイルを統括の保存へ渡す', async () => {
    const save = vi.fn<(definition: TagDefinition, another?: boolean) => Promise<void>>().mockResolvedValue(undefined)
    render(<HqTagEditorV8 definition={definition} editing saving={false} onCancel={() => {}} onSave={save} />)
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: 'ゴールド会員' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存する' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]).toEqual([{ ...definition, tag: { ...definition.tag, name: 'ゴールド会員', manualAssignmentAllowed: true } }, false])
    expect(store.list).not.toHaveBeenCalled()
    expect(store.retroactivePreview).not.toHaveBeenCalled()
  })

  it('続けて作る場合も同じ保存口へ渡し、連動の窓を取り消しても OFF を変えない', async () => {
    const save = vi.fn<(definition: TagDefinition, another?: boolean) => Promise<void>>().mockResolvedValue(undefined)
    render(<HqTagEditorV8 definition={{ ...definition, tag: { name: '手動用', linkedEnabled: false } }} editing={false} saving={false} onCancel={() => {}} onSave={save} />)
    fireEvent.click(screen.getAllByRole('button', { name: '開く' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'アクションを追加する' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('統括のひな形で使えるのは')
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'キャンセル')!)
    fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].tag.linkedEnabled).toBe(false)
    expect(save.mock.calls[0][1]).toBe(true)
  })

  it('閲覧のみでは保存・連動の変更操作を隠し、空の名前では保存できない', () => {
    const props = { definition, editing: false, saving: false, onCancel: () => {}, onSave: vi.fn(async () => {}) }
    const view = render(<HqTagEditorV8 {...props} readOnly />)
    expect(screen.queryByRole('button', { name: 'タグを作る' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'タグ連動' })).toBeNull()
    expect(screen.getByText('閲覧のみで見ています。変える操作は統括の管理者に頼んでください。').getAttribute('role')).toBe('note')
    view.rerender(<HqTagEditorV8 {...props} key="new" definition={{ ...definition, tag: { name: '' } }} />)
    expect(screen.getByRole('button', { name: 'タグを作る' }).hasAttribute('disabled')).toBe(true)
  })

  it('版が競合したときは失敗を知らせ、最新の内容を読み直せる', () => {
    const reload = vi.fn()
    render(<HqTagEditorV8 definition={definition} editing saving={false} conflict error="別の人が更新しました" onReloadLatest={reload} onCancel={() => {}} onSave={async () => {}} />)
    expect(screen.getByText('別の人が更新しました')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '最新の内容を読み込む' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('所属フォルダは統括のフォルダ（左の列と同じ）から選べ、その場で作れる。選んだフォルダはひな形にも入れる', async () => {
    document.documentElement.dataset.theme = 'v8'
    const save = vi.fn<(definition: TagDefinition, another?: boolean) => Promise<void>>().mockResolvedValue(undefined)
    const create = vi.fn(async (name: string, color: string | null) => ({ value: 'new', label: name, color }))
    render(<HqTagEditorV8 definition={{ ...definition, tag: { name: '定期', folderId: null }, folders: [] }}
      folders={[{ id: 'f-test', name: 'テスト', revision: 1, color: null }, { id: 'f-test1', name: 'テスト1', revision: 1, color: '#ef4444' }]}
      onCreateFolder={create} editing={false} saving={false} onCancel={() => {}} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: /所属フォルダ/ }))
    expect(await screen.findByText('テスト')).toBeTruthy()
    expect(screen.getByText('テスト1')).toBeTruthy()
    expect(screen.getByText('新しいフォルダを作る')).toBeTruthy()
    fireEvent.click(screen.getByText('テスト1'))
    fireEvent.click(screen.getByRole('button', { name: 'タグを作る' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].tag.folderId).toBe('f-test1')
    expect(save.mock.calls[0][0].folders).toEqual([{ id: 'f-test1', name: 'テスト1', color: '#ef4444' }])
  })

  it('閲覧のみでは所属フォルダの欄から作れない', () => {
    document.documentElement.dataset.theme = 'v8'
    render(<HqTagEditorV8 definition={definition} folders={[{ id: 'f-test', name: 'テスト', revision: 1 }]} onCreateFolder={vi.fn()} readOnly editing={false} saving={false} onCancel={() => {}} onSave={vi.fn(async () => {})} />)
    expect(screen.queryByText('新しいフォルダを作る')).toBeNull()
  })
})


it.each([null, '#ef4444'])('統括のタグひな形は所属フォルダの色 %s を選ぶ欄・閉じた欄・タグの札へ出す', (color) => {
  document.documentElement.dataset.theme = 'v8'
  const folder = { id: 'f-test', name: 'テスト', color, revision: 1 }
  const { container } = render(<HqTagEditorV8 definition={{ ...definition, tag: { name: '定期', folderId: null }, folders: [] }} folders={[folder]}
    editing={false} saving={false} onCancel={() => {}} onSave={vi.fn(async () => {})} />)
  const trigger = screen.getByRole('button', { name: '所属フォルダ' })
  fireEvent.click(trigger)
  const option = screen.getAllByRole('option').find((row) => row.textContent === 'テスト')!
  const expected = document.createElement('span')
  expected.style.backgroundColor = folderDisplayColor(folder)
  expect(option.querySelector<HTMLElement>('[data-folder-dot]')!.style.backgroundColor).toBe(expected.style.backgroundColor)
  fireEvent.click(option.querySelector('button')!)
  expect(trigger.querySelector<HTMLElement>('[data-folder-dot]')!.style.backgroundColor).toBe(expected.style.backgroundColor)
  const pill = screen.getByRole('group', { name: 'タグ「定期」' })
  expect(pill.querySelector<HTMLElement>('span')!.style.backgroundColor).toBe(expected.style.backgroundColor)
  expect(container.textContent).toContain('テスト')
  delete document.documentElement.dataset.theme
})
