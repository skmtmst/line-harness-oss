// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ params: new URLSearchParams('id=g-1'), account: 'acc-1', remove: vi.fn(async () => ({ success: true })), held: null as null | (() => unknown) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => fx.params }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('./list', () => ({ default: () => <div>友だち属性の一覧</div> }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tagGroups: { ...actual.api.tagGroups, delete: fx.remove, list: vi.fn(async () => ({ success: true, data: [{ id: 'g-1', name: '確認用', color: '#123456', accountId: 'acc-1' }] })) } } }
})
vi.mock('@/components/shared/confirm-dialog', async original => {
  const actual = await original<typeof import('@/components/shared/confirm-dialog')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) => {
    if (props.open && props.description.includes('中') && props.onConfirm) fx.held = props.onConfirm
    return <actual.default {...props} />
  } }
})
import { api } from '@/lib/api'
import FolderPage from './folder-page'
import TagsTab from './tags-tab'

afterEach(() => { cleanup(); fx.account = 'acc-1'; fx.remove.mockClear(); fx.held = null })

it('フォルダ詳細の削除窓は所有アカウントと環境を出す', async () => {
  render(<FolderPage />)
  await screen.findByDisplayValue('確認用')
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('フォルダ一覧の削除窓は所有アカウントと環境を出す', async () => {
  const group = { id: 'g-1', name: '確認用', color: '#123456', accountId: 'acc-1', sortOrder: 0 }
  render(<TagsTab accountId="acc-1" fixture={{ items: [], groups: [group] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ「確認用」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '消す' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('選択中と所有先が違うときも削除窓は所有先を示す', async () => {
  const group = { id: 'g-1', name: '確認用', color: '#123456', accountId: 'owner-other', sortOrder: 0 }
  render(<TagsTab accountId="acc-1" fixture={{ items: [], groups: [group] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ「確認用」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '消す' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.querySelector('[title="owner-other"]')).toBeTruthy()
  expect(dialog.querySelector('[title="acc-1"]')).toBeNull()
})

it('一覧はキャンセルとアカウント切替の後、古い確認で削除しない', async () => {
  const group = { id: 'g-1', name: '確認用', color: '#123456', accountId: 'acc-1', sortOrder: 0 }
  const view = render(<TagsTab accountId="acc-1" fixture={{ items: [], groups: [group] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ「確認用」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '消す' }))
  const previous = fx.held!
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル' }))
  view.rerender(<TagsTab accountId="other" fixture={{ items: [], groups: [group] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  await act(async () => { await previous() })
  expect(fx.remove).not.toHaveBeenCalled()
})

it('詳細はキャンセルとアカウント切替の後、古い確認で削除しない', async () => {
  const view = render(<FolderPage />)
  await screen.findByDisplayValue('確認用')
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  await screen.findByRole('alertdialog')
  const previous = fx.held!
  fx.account = 'other'
  view.rerender(<FolderPage />)
  await act(async () => { await previous() })
  expect(fx.remove).not.toHaveBeenCalled()
})

it('所有先の読み込み中はフォルダを削除できない', () => {
  vi.mocked(api.tagGroups.list).mockImplementationOnce(() => new Promise(() => {}))
  render(<FolderPage />)
  const button = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toContain('読み込んでいます')
  fireEvent.click(button)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})
