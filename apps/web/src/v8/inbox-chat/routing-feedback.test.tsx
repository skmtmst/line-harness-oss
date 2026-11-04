// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const fx = vi.hoisted(() => ({ save: vi.fn(), notify: vi.fn(), close: vi.fn(), saved: vi.fn() }))
vi.mock('@/components/shared/toast', () => ({ notifySaved: fx.notify }))
vi.mock('@/lib/api/helpers/gap1', () => ({ inboxRoutingApi: { get: async () => ({ data: { strategy:'none', targets:[], unassignedCount:1, enabled: false, firstResponseMinutes: 30, businessHoursOnly: false, escalateTeamId: null, version: 1 } }), save: fx.save } }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { list: async () => ({success:true,data:[{id:'s',name:'担当 A',isActive:true,role:'staff'}]}) }, notifications: { teams: { list: async () => ({ success: true, data: [{id:'team',name:'対応チーム',staffIds:['s'],archivedAt:null}] }) } } } }
})
import Drawer from './routing-drawer'
const view = (accountId = 'A') => <Drawer open accountId={accountId} onClose={fx.close} onSaved={fx.saved} />
beforeEach(() => { vi.clearAllMocks(); fx.save.mockReset().mockResolvedValue({ data: { version: 2 } }) })
afterEach(cleanup)
async function edit() {
  const result = render(view())
  fireEvent.click(await screen.findByRole('switch', { name: '返事の期限を使う' }))
  return result
}
it('保存の対象を知らせ、確定した設定を渡して閉じる', async () => {
  await edit()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true })) })
  expect(fx.notify).toHaveBeenCalledExactlyOnceWith('「割り当てと返事の期限」を保存しました')
  expect(fx.save).toHaveBeenCalledWith('A', expect.objectContaining({ expectedVersion: 1, enabled: true }))
  expect(fx.saved).toHaveBeenCalledWith({ version: 2 })
  expect(fx.close).toHaveBeenCalledOnce()
})
it('競合は入力を残す帯に表示し、成功のトーストを出さない', async () => {
  const { ApiError } = await import('@/lib/api')
  fx.save.mockRejectedValueOnce(new ApiError(409, '競合'))
  await edit()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true })) })
  expect(screen.getByRole('switch', { name: '返事の期限を使う' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText(/ほかの人が/)).toBeTruthy()
  expect(fx.notify).not.toHaveBeenCalled()
  expect(fx.close).not.toHaveBeenCalled()
})
it('保存中にアカウントを替えたら旧設定の結果を新画面へ出さない', async () => {
  let resolve!: (value: { data: { version: number } }) => void
  fx.save.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
  const result = await edit()
  fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
  result.rerender(view('B'))
  await act(async () => resolve({ data: { version: 2 } }))
  expect(fx.notify).not.toHaveBeenCalled()
  expect(fx.saved).not.toHaveBeenCalled()
  expect(fx.close).not.toHaveBeenCalled()
})

it('割り当て方と対象者を保存する', async () => {
  render(view())
  fireEvent.click(await screen.findByRole('button', {name:'均等'}))
  fireEvent.click(screen.getByRole('button', {name:'対象の人'}))
  fireEvent.click(await screen.findByRole('checkbox', {name:'担当 A'}))
  fireEvent.click(screen.getByRole('button', {name:'選ぶ（1件）'}))
  await act(async () => { fireEvent.click(screen.getByRole('button', {name:'保存する',exact:true})) })
  expect(fx.save).toHaveBeenCalledWith('A', expect.objectContaining({strategy:'even',targets:[{staffId:'s',priority:1,cap:10}],expectedVersion:1}))
})

it('チームを選ぶと、その時点のメンバーを重複なく対象に加える', async () => {
  render(view())
  fireEvent.click(await screen.findByRole('button', {name:'均等'}))
  const select=await screen.findByRole('button', {name:'チームから人を追加'})
  await waitFor(()=>expect((select as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(select)
  fireEvent.click(within(await screen.findByRole('option',{name:'対応チーム'})).getByRole('button',{name:'対応チーム'}))
  await act(async () => { fireEvent.click(screen.getByRole('button', {name:'保存する',exact:true})) })
  expect(fx.save).toHaveBeenCalledWith('A',expect.objectContaining({targets:[{staffId:'s',priority:1,cap:10}]}))
})
