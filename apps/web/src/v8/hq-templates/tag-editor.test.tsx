// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TagDefinition } from '@/lib/hq-templates-api'

const store = vi.hoisted(() => ({ list: vi.fn(), retroactivePreview: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { tags: store } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/hq/friend-attributes' }))
import HqTagEditorV8 from './tag-editor'

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
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。').getAttribute('role')).toBe('note')
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
})
