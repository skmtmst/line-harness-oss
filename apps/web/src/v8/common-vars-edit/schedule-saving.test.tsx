// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const add = vi.hoisted(() => vi.fn())
const scheduleState = vi.hoisted(() => ({ account: 'a', rows: [] as Array<Record<string, unknown>>, remove: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('id=var-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: scheduleState.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    commonVars: { ...actual.api.commonVars,
      detail: async () => ({ success: true, data: { id: 'var-1', name: '営業時間', key: 'hours', type: 'text', value: '10時', memo: '', status: 'active', validFrom: null, validUntil: null, version: 1, usages: [], history: [], usageCount: 0, usagePage: { total: 0, shown: 0 } } }),
      schedules: async () => ({ success: true, data: scheduleState.rows }), addSchedule: add, deleteSchedule: scheduleState.remove,
    },
  } }
})
import Editor from './edit'
afterEach(() => { cleanup(); scheduleState.rows = []; scheduleState.account = 'a'; scheduleState.remove.mockReset() })

it('予定消去の確認には対象アカウントと環境を示す', async () => {
  scheduleState.rows = [{ id: 's1', effectiveFrom: '2026-11-10T09:00:00+09:00', value: '11時', appliedAt: null }]
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を消す' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('対象を確認して予定を消す時は、窓を開いた時の予定だけを一度消す', async () => {
  scheduleState.rows = [{ id: 's1', effectiveFrom: '2026-11-10T09:00:00+09:00', value: '11時', appliedAt: null }]
  scheduleState.remove.mockResolvedValue({ success: true })
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を消す' }))
  const dialog = await screen.findByRole('alertdialog')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true })) })
  expect(scheduleState.remove).toHaveBeenCalledWith('var-1', 's1', 'a')
  expect(scheduleState.remove).toHaveBeenCalledTimes(1)
})

it('アカウントを切り替えて戻しても古い予定消去は送らない', async () => {
  scheduleState.rows = [{ id: 's1', effectiveFrom: '2026-11-10T09:00:00+09:00', value: '11時', appliedAt: null }]
  const view = render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を消す' }))
  const target = within(await screen.findByRole('alertdialog')).getByRole('button', { name: '削除する', exact: true })
  const key = Object.keys(target).find(item => item.startsWith('__reactProps$'))!
  const handler = (target as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
  scheduleState.account = 'b'; view.rerender(<Editor />)
  scheduleState.account = 'a'; view.rerender(<Editor />)
  await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: target, target }) })
  expect(scheduleState.remove).not.toHaveBeenCalled()
})

it('予定の削除が拒否されたら成功扱いにせず窓に理由を残す', async () => {
  scheduleState.rows = [{ id: 's1', effectiveFrom: '2026-11-10T09:00:00+09:00', value: '11時', appliedAt: null }]
  scheduleState.remove.mockResolvedValue({ success: false, error: 'offline' })
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を消す' }))
  const dialog = await screen.findByRole('alertdialog')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true })) })
  expect(within(dialog).getByText('消せなかった予定があります。通信を確かめて、もう一度お試しください。')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '削除する', exact: true }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true }))
  expect(scheduleState.remove).toHaveBeenCalledTimes(1)
})

it('一部の予定が消えてから失敗しても、その窓では重ねて送らない', async () => {
  scheduleState.rows = [
    { id: 's1', effectiveFrom: '2026-11-10T09:00:00+09:00', value: '11時', appliedAt: null },
    { id: 's2', effectiveFrom: '2026-11-11T09:00:00+09:00', value: '12時', appliedAt: null },
  ]
  scheduleState.remove.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'offline' })
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定をすべて消す' }))
  const dialog = await screen.findByRole('alertdialog')
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true })) })
  const confirm = within(dialog).getByRole('button', { name: '削除する', exact: true })
  expect(confirm.hasAttribute('disabled')).toBe(true)
  fireEvent.click(confirm)
  expect(scheduleState.remove.mock.calls).toEqual([['var-1', 's1', 'a'], ['var-1', 's2', 'a']])
})
it('共通情報の予定登録中は×・キャンセル・Escを止める', async () => {
  let resolve!: (value: unknown) => void
  add.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を足す' }))
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))
  expect(add).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '閉じる' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => resolve({ success: true, data: {} }))
})

it('名前を消して保存すると、口を呼ばず名前の欄が赤くなり、真下に理由が出て、そこへ移る', async () => {
  const { api } = await import('@/lib/api')
  const update = vi.spyOn(api.commonVars, 'update')
  render(<Editor />)
  const name = await screen.findByLabelText('名前') as HTMLInputElement
  fireEvent.change(name, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(update).not.toHaveBeenCalled()
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('cv-name-error')?.textContent).toBe('共通情報名を入力してください')
  expect(document.activeElement).toBe(name)
})

it('予定の開始日が空なら登録せず、開始日の欄に理由を出す', async () => {
  add.mockReset()
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を足す' }))
  // 開始日を空にする（×で消す）
  fireEvent.click(screen.getByRole('button', { name: '日付を消す' }))
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(add).not.toHaveBeenCalled()
  expect(screen.getByText('開始日を入れてください')).toBeTruthy()
  expect(document.activeElement).toBe(document.getElementById('sc-date'))
})
