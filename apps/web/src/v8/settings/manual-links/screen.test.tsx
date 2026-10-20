// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import ManualLinksScreen from './screen'

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), check: vi.fn(), readOnly: false, roleBundle: undefined as string | undefined }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => '/settings/manual-links' }))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => <nav>設定の目次</nav> }))
vi.mock('@/lib/api', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api')>()
  return { ...original, api: { ...original.api, staff: { ...original.api.staff, me: async () => ({ success: true, data: { id: 'owner', role: 'owner', readOnly: mocks.readOnly, roleBundle: mocks.roleBundle } }) }, manualLinks: { ...original.api.manualLinks, list: mocks.list, update: mocks.update, check: mocks.check } } }
})
const link = { key: '2-1', keyKind: 'screen', name: '受信箱', url: 'https://example.test/inbox', status: 'ok', lastCheckedAt: '2026-10-01T00:00:00Z', version: 2 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.readOnly = false
  mocks.roleBundle = undefined
  mocks.list.mockResolvedValue({ success: true, data: { items: [link], total: 1 } })
  mocks.update.mockResolvedValue({ success: true, data: { ...link, version: 3 } })
})
afterEach(cleanup)
async function edit() {
  render(<ManualLinksScreen />)
  fireEvent.click(await screen.findByRole('button', { name: '受信箱のその他操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '行き先を編集する' }))
  return screen.getByRole('textbox', { name: '受信箱のマニュアルのURL' }) as HTMLInputElement
}
it('行内のURLを編集し、下部の保存から対象の版付きで1回送る', async () => {
  const input = await edit()
  fireEvent.change(input, { target: { value: 'https://example.test/new' } })
  const save = screen.getByRole('button', { name: '決める' })
  expect(save.closest('[data-template-region="footer"]')).toBeTruthy()
  expect(save.closest('[role="row"]')).toBeNull()
  fireEvent.click(save)
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('2-1', { url: 'https://example.test/new', expectedVersion: 2 }))
  expect(mocks.update).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '受信箱のマニュアルのURL' })).toBeNull())
})
it('競合で読み直しても編集中のURLと下部の操作を残す', async () => {
  mocks.update.mockRejectedValue(new ApiError(409, 'version_conflict'))
  const input = await edit()
  fireEvent.change(input, { target: { value: 'https://example.test/draft' } })
  fireEvent.click(screen.getByRole('button', { name: '決める' }))
  await screen.findByText(/ほかの人が先に変更しました/)
  expect(input.value).toBe('https://example.test/draft')
  expect(screen.getByRole('button', { name: '決める' }).closest('[data-template-region="footer"]')).toBeTruthy()
  expect(mocks.list).toHaveBeenCalledTimes(2)
})
it('未保存の取消は確認し、続けるなら値を保ち、破棄しても保存を送らない', async () => {
  const input = await edit()
  fireEvent.change(input, { target: { value: 'https://example.test/draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect(input.value).toBe('https://example.test/draft')
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '受信箱のマニュアルのURL' })).toBeNull())
  expect(mocks.update).not.toHaveBeenCalled()
})

it('初回取得失敗は0件と混ぜず、同じ表を読み直せる', async () => {
  mocks.list.mockRejectedValueOnce(new Error('offline'))
  render(<ManualLinksScreen />)
  await screen.findByText('正本表を読み込めませんでした')
  expect(screen.queryByText('受信箱')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await screen.findByText('受信箱')
  expect(mocks.list).toHaveBeenCalledTimes(2)
})
it('保存を拒否されたら依頼先と編集中URLを残す', async () => {
  mocks.update.mockRejectedValue(new ApiError(403))
  const input = await edit()
  fireEvent.change(input, { target: { value: 'https://example.test/draft' } })
  fireEvent.click(screen.getByRole('button', { name: '決める' }))
  await screen.findByText(/運営に依頼してください/)
  expect(input.value).toBe('https://example.test/draft')
})
it('リンク確認の通信失敗は理由を出し、操作を再試行できる状態に戻す', async () => {
  mocks.check.mockRejectedValue(new Error('offline'))
  render(<ManualLinksScreen />)
  await screen.findByText('受信箱')
  const button = screen.getByRole('button', { name: /確かめる/ })
  fireEvent.click(button)
  await screen.findByText(/確かめられませんでした/)
  expect((button as HTMLButtonElement).disabled).toBe(false)
})

it.each(['readOnly', 'view_only'])('閲覧のみの運営担当は表を読めるが変更ボタンがない: %s', async mode => {
  mocks.readOnly = mode === 'readOnly'
  mocks.roleBundle = mode === 'view_only' ? 'view_only' : undefined
  render(<ManualLinksScreen />)
  await screen.findByText('受信箱')
  expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '受信箱のその他操作' })).toBeNull()
  expect(screen.queryByRole('button', { name: /確かめる/ })).toBeNull()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.check).not.toHaveBeenCalled()
})
