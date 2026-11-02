// @vitest-environment happy-dom
/*
 * マイル「会員ランク」（G5-2）：段の表・動かす前の確かめ・閲覧のみの扱い。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ program: vi.fn(), preview: vi.fn(), save: vi.fn(), tiers: vi.fn(), activate: vi.fn(), stop: vi.fn() }))
const shell = vi.hoisted(() => ({ readonly: false }))
const account = vi.hoisted(() => ({ id: 'a' }))
vi.mock('@/lib/api/helpers/gap3', () => ({ memberRanksApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/mileage', useSearchParams: () => new URLSearchParams('tab=ranks') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.id, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./frame')>()
  return { ...actual, useMileageShell: () => ({ tab: 'ranks', readonly: shell.readonly, narrow: false, counts: {}, setCount: () => {} }) }
})

const { default: RanksTab } = await import('./ranks')

const PROGRAM = {
  metric: 'visits', windowMonths: 12, status: 'stopped', version: 4, activatedAt: null, notificationsAvailable: false, notifyUpgrade: true, notifyDowngrade: true,
  tiers: [
    { id: 't1', name: 'ブロンズ', threshold: 0, mileMultiplier: 1 },
    { id: 't2', name: 'シルバー', threshold: 3, mileMultiplier: 1.2 },
    { id: 't3', name: 'ゴールド', threshold: 8, mileMultiplier: 1.5 },
  ],
}
const PREVIEW = { byTier: [{ tierId: 't1', name: 'ブロンズ', count: 780 }, { tierId: 't2', name: 'シルバー', count: 360 }, { tierId: 't3', name: 'ゴールド', count: 144 }], wouldUpgrade: 504, wouldDowngrade: 0 }

beforeEach(() => {
  shell.readonly = false
  account.id = 'a'
  api.program.mockResolvedValue({ success: true, data: PROGRAM })
  api.preview.mockResolvedValue({ success: true, data: PREVIEW })
  api.activate.mockResolvedValue({ success: true, data: { ...PROGRAM, status: 'active', version: 5 } })
  api.tiers.mockResolvedValue({ success: true, data: PROGRAM })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each(['activate', 'stop', 'delete'] as const)('%s の確認にアカウントと環境を示す', async kind => {
 if (kind === 'stop') api.program.mockResolvedValue({ success: true, data: { ...PROGRAM, status: 'active' } })
 render(<RanksTab />); await screen.findByText('シルバー')
 if (kind === 'delete') {
   fireEvent.click(screen.getByRole('button', { name: 'シルバーの操作' }))
   fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
 } else fireEvent.click(screen.getByRole('button', { name: kind === 'activate' ? '動かす' : '止める' }))
 const dialog = screen.getByRole(kind === 'delete' ? 'alertdialog' : 'dialog')
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
})

it('アカウントを切り替えて戻しても古いランク確定を送らない', async () => {
 const view = render(<RanksTab />); await screen.findByText('シルバー')
 fireEvent.click(screen.getByRole('button', { name: '動かす' }))
 const button = within(screen.getByRole('dialog', { name: '会員ランクを動かしますか？' })).getByRole('button', { name: '動かす' })
 const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
 const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
 account.id = 'b'; view.rerender(<RanksTab />)
 account.id = 'a'; view.rerender(<RanksTab />)
 await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
 expect(api.activate).not.toHaveBeenCalled()
})


it('動かす前の409は窓を残して再送せず、閉じて最新の版を確認してから一度だけ送る', async () => {
 const { ApiError } = await import('@/lib/api')
 api.program.mockResolvedValueOnce({ success: true, data: PROGRAM }).mockResolvedValue({ success: true, data: { ...PROGRAM, version: 5 } })
 api.activate.mockRejectedValueOnce(new ApiError(409, '競合しました。'))
 render(<RanksTab />); await screen.findByText('シルバー')
 fireEvent.click(screen.getByRole('button', { name: '動かす' }))
 const dialog = await screen.findByRole('dialog', { name: '会員ランクを動かしますか？' })
 expect(api.activate).not.toHaveBeenCalled()
 await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '動かす' })) })
 expect(within(dialog).getByRole('alert').textContent).toContain('最新の段を確認')
 const retry = within(dialog).getByRole('button', { name: 'もう一度' })
 expect(retry.hasAttribute('disabled')).toBe(true)
 fireEvent.click(retry); expect(api.activate).toHaveBeenCalledTimes(1)
 fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
 await waitFor(() => expect(api.program).toHaveBeenCalledTimes(2))
 fireEvent.click(screen.getByRole('button', { name: '動かす' }))
 const fresh = await screen.findByRole('dialog', { name: '会員ランクを動かしますか？' })
 await act(async () => { const submit = within(fresh).getByRole('button', { name: '動かす' }); fireEvent.click(submit); fireEvent.click(submit) })
 expect(api.activate.mock.calls.map(call => call.slice(0, 2))).toEqual([['a', 4], ['a', 5]])
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
it('段の編集の409で入力を保ち、段が減った後もIDの違う段へ古い入力を送らない', async () => {
 const { ApiError } = await import('@/lib/api')
 api.program.mockResolvedValueOnce({ success: true, data: PROGRAM }).mockResolvedValue({ success: true, data: { ...PROGRAM, version: 5, tiers: [PROGRAM.tiers[0], PROGRAM.tiers[2]] } })
 api.tiers.mockRejectedValueOnce(new ApiError(409, '競合しました。'))
 render(<RanksTab />); await screen.findByText('シルバー')
 fireEvent.click(screen.getByRole('button', { name: 'シルバーの操作' })); fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
 const dialog = await screen.findByRole('dialog', { name: 'ランクを編集する' })
 fireEvent.change(within(dialog).getByRole('textbox', { name: '名前' }), { target: { value: '入力中のシルバー' } })
 await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '保存する' })) })
 expect(within(dialog).getByRole('alert')).toBeTruthy()
 expect((within(dialog).getByRole('textbox', { name: '名前' }) as HTMLInputElement).value).toBe('入力中のシルバー')
 const retry = within(dialog).getByRole('button', { name: 'もう一度' }); expect(retry.hasAttribute('disabled')).toBe(true)
 fireEvent.click(retry); expect(api.tiers).toHaveBeenCalledTimes(1)
 fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
 const discard = await screen.findByRole('dialog', { name: '入力を破棄しますか？' })
 expect(api.tiers).toHaveBeenCalledTimes(1)
 fireEvent.click(within(discard).getByRole('button', { name: '破棄する' }))
 await waitFor(() => expect(screen.queryByRole('button', { name: 'シルバーの操作' })).toBeNull())
 fireEvent.click(screen.getByRole('button', { name: 'ゴールドの操作' })); fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
 const fresh = await screen.findByRole('dialog', { name: 'ランクを編集する' })
 fireEvent.change(within(fresh).getByRole('textbox', { name: '名前' }), { target: { value: '新しいゴールド' } })
 await act(async () => { fireEvent.click(within(fresh).getByRole('button', { name: '保存する' })) })
 expect(api.tiers).toHaveBeenCalledTimes(2)
 expect(api.tiers.mock.calls[1][1].map((tier: { id: string; name: string }) => ({ id: tier.id, name: tier.name }))).toEqual([{ id: 't1', name: 'ブロンズ' }, { id: 't3', name: '新しいゴールド' }])
 expect(api.tiers.mock.calls[1][2]).toBe(5)
})
