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

test('ひな形の空名は押せない理由を出し、入力したら外す', () => {
  const save = vi.fn()
  render(<TagEditForm tag={{ id: 't1', name: '', status: 'active' } as Tag} groups={[]} dependencies={null} accountId="" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={vi.fn()}
    host={{ title: 'タグのひな形を作る', saveLabel: '保存する', description: '', preview: () => null, allowedActionTypes: [], onSaveAnother: vi.fn(), onSaveDraft: vi.fn(), initialValues: { name: '', groupId: '', isStarred: false, linked: false, rewardMiles: 0, referralRewardMiles: 0, multiplierBps: null, multiplierPriority: 0, applyToExisting: false, reapplyPolicy: 'first_only', actions: [] } }} />)
  for (const name of ['下書きを保存', '保存する']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-description')).toBe('タグの名前を入れてください')
  }
  fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: '会員' } })
  for (const name of ['下書きを保存', '保存する']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.hasAttribute('aria-description')).toBe(false)
  }
})

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
  expect((screen.getByRole('checkbox', { name: 'タグ連動' }) as HTMLInputElement).checked).toBe(false)
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
  fireEvent.click(screen.getByRole('button', { name: '行うことを足す' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'テキストを送る' }))
  fireEvent.change(screen.getByRole('textbox', { name: '送る本文' }), { target: { value: 'ご登録ありがとうございます。' } })
  fireEvent.keyDown(screen.getByRole('button', { name: '3つ目の行うことを並べ替える' }), { key: 'ArrowUp' })
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  expect(save.mock.calls[0][0].actions.map((action: { label: string }) => action.label)).toEqual(['一通目', 'ご登録ありがとうございます。', '二通目'])
})

test('閲覧のみでも連動とマイルの明細を開閉でき、変更の操作は出さない', () => {
  const save = vi.fn(), remove = vi.fn()
  render(<TagEditForm tag={{ id: 't1', name: 'VIP', status: 'active', linkedEnabled: true, mileageReward: 500 } as Tag} groups={[]} dependencies={null} accountId="a1" readOnly conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={remove} />)
  const linked = within(screen.getByRole('region', { name: 'タグ連動' }))
  const open = linked.getByRole('button', { name: '開く' })
  expect((open as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(open)
  expect(linked.getByRole('button', { name: '閉じる' })).toBeTruthy()
  const mileage = within(screen.getByRole('region', { name: 'マイル' }))
  fireEvent.click(mileage.getByRole('button', { name: '開く' }))
  expect(mileage.getByText('本人へのマイル付与')).toBeTruthy()
  expect(mileage.getByText('500')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'タグを保存する' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'タグを削除する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '複製して作る' })).toBeNull()
  expect(screen.queryByRole('button', { name: '行うことを足す' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
})
