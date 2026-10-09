// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, commonActions: { ...actual.api.commonActions, resources: async () => ({ success: false, error: 'not configured' }) }, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) } } }
})
import { TagEditForm } from './edit-form'
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('タグ編集の未入力は名前欄へ移動し、保存も上の重複通知も出さない', () => {
  const save = vi.fn()
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  render(<TagEditForm tag={{ id: 't1', name: '', status: 'active' } as Tag} groups={[]} dependencies={null} accountId="a1" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  const name = screen.getByLabelText('タグ名')
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(name)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(screen.getAllByText('タグ名を入力してください')).toHaveLength(1)
  expect(save).not.toHaveBeenCalled()
})

test('保存済みの連動OFFは残ったマイルからONと推測しない（WEB089）', () => {
  const save = vi.fn()
  render(<TagEditForm tag={{ id: 't1', name: 'VIP', status: 'active', linkedEnabled: false, mileageReward: 500 } as Tag} groups={[]} dependencies={null} accountId="a1" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={vi.fn()} />)
  expect(screen.getByRole('switch', { name: 'タグ連動' }).getAttribute('aria-checked')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  expect(save.mock.calls[0][0].linked).toBe(false)
})


test('選んだアクションの前へ実際に差し込み、保存順にも残す（WEB276）', () => {
  const save = vi.fn()
  render(<TagEditForm tag={{ id: 't1', name: 'VIP', status: 'active', linkedEnabled: true } as Tag} groups={[]} dependencies={null} accountId="a1" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[
    { id: 'a', type: 'テキスト送信', label: '一通目', timing: 'すぐに' },
    { id: 'b', type: 'テキスト送信', label: '二通目', timing: 'すぐに' },
  ]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={vi.fn()} />)
  fireEvent.click(within(screen.getByRole('region', { name: 'タグ連動' })).getByRole('button', { name: '開く' }))
  fireEvent.focus(screen.getByRole('button', { name: '「二通目」を上へ' }))
  fireEvent.click(screen.getByRole('button', { name: 'アクションを追加する' }))
  fireEvent.click(screen.getByRole('button', { name: '追加する位置' }))
  fireEvent.click(screen.getByRole('button', { name: '選択中のアクションの前' }))
  fireEvent.click(screen.getByRole('button', { name: 'このアクションを追加する' }))
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  expect(save.mock.calls[0][0].actions.map((action: { label: string }) => action.label)).toEqual(['一通目', 'ご登録ありがとうございます。', '二通目'])
})
