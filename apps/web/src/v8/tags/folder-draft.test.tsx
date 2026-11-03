// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'
const fx = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fx.push, replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/tags/new' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<object>(), useStaffRole: () => 'admin', canManageRole: () => true }))
vi.mock('@/lib/api', async original => { const actual = await original<typeof import('@/lib/api')>(); return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }), retroactivePreview: async () => ({ success: true, data: {} }), createDefinition: fx.create }, tagGroups: { ...actual.api.tagGroups, list: async () => ({ success: true, data: [] }) } } } })
import TagCreate from './create'
import { TagEditForm } from '@/v8/tag-edit/edit-form'
afterEach(() => { cleanup(); vi.clearAllMocks() })
function startFolder() {
  fireEvent.click(screen.getByRole('button', { name: '所属フォルダ' }))
  fireEvent.click(screen.getByRole('button', { name: '新しいフォルダを作る' }))
  fireEvent.change(screen.getByRole('textbox', { name: '新しいフォルダの名前' }), { target: { value: '編集中フォルダ' } })
  fireEvent.pointerDown(document.body)
}
function edit() {
  render(<TagEditForm tag={{ id: 't1', name: '架空タグ', status: 'active' } as Tag} groups={[]} onCreateGroup={vi.fn()} dependencies={null} accountId="acc" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={fx.push} onSave={fx.save} onDelete={vi.fn()} />)
}
it.each(['タグを作る', '保存して続けて作る'])('新規 %s の前に作成途中のフォルダを確認する', async label => {
  render(<TagCreate />)
  fireEvent.change(await screen.findByLabelText('タグ名'), { target: { value: '架空タグ' } })
  startFolder()
  if (label === '保存して続けて作る') {
    fireEvent.click(screen.getByRole('button', { name: '作成・編集のその他の操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  } else fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
  expect(await screen.findByRole('button', { name: 'フォルダを破棄して保存' })).toBeTruthy()
  expect(fx.create).not.toHaveBeenCalled()
})
it('タグ編集の保存前に作成途中のフォルダを確認する', async () => {
  edit(); startFolder()
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  expect(await screen.findByRole('button', { name: 'フォルダを破棄して保存' })).toBeTruthy()
  expect(fx.save).not.toHaveBeenCalled()
})
it('タグ編集のキャンセルは作成途中のフォルダを確認する', async () => {
  edit(); startFolder()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
  expect(fx.push).not.toHaveBeenCalled()
})
it('新規のキャンセルはタグとフォルダの両方の変更を確認する', async () => {
  render(<TagCreate />)
  fireEvent.change(await screen.findByLabelText('タグ名'), { target: { value: '架空タグ' } })
  startFolder()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(await screen.findAllByRole('dialog', { name: '保存していない変更があります' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByLabelText('タグ名') as HTMLInputElement).value).toBe('架空タグ')
  fireEvent.click(screen.getByRole('button', { name: '所属フォルダ' }))
  fireEvent.click(screen.getByRole('button', { name: '新しいフォルダを作る' }))
  expect((screen.getByRole('textbox', { name: '新しいフォルダの名前' }) as HTMLInputElement).value).toBe('編集中フォルダ')
  expect(fx.push).not.toHaveBeenCalled()
})
