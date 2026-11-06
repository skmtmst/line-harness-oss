// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ account: 'a', list: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { broadcastMessageAssets: { list: fixture.list } } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.account }) }))
vi.mock('./frame', () => ({ TemplateEditFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
import StoredAssetEditor from './stored-asset-editor'
const view = (id: string) => <StoredAssetEditor id={id}>{asset => <p>{asset.name}</p>}</StoredAssetEditor>
beforeEach(() => { fixture.account = 'a'; fixture.list.mockReset() })
afterEach(cleanup)
it('読めない時は新規作成へ置き換えず、再読み込みで同じ券を表示する', async () => {
  fixture.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true, data: [{ id: 'c1', name: '保存済みの券', lineAccountId: 'a' }] })
  render(view('c1'))
  fireEvent.click(await screen.findByRole('button', { name: /再読み込み|もう一度/ }))
  expect(await screen.findByText('保存済みの券')).toBeTruthy()
  expect(fixture.list).toHaveBeenCalledTimes(2)
})
it('別アカウントの同じIDは表示せず、遅い旧応答も戻さない', async () => {
  let done!: (value: unknown) => void
  fixture.list.mockImplementationOnce(() => new Promise(resolve => { done = resolve })).mockResolvedValueOnce({ success: true, data: [{ id: 'c1', name: '違う店の券', lineAccountId: 'a' }] })
  const { rerender } = render(view('c1'))
  fixture.account = 'b'; rerender(view('c1'))
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2))
  await act(async () => done({ success: true, data: [{ id: 'c1', name: '遅い元の券', lineAccountId: 'a' }] }))
  expect(screen.queryByText('違う店の券')).toBeNull(); expect(screen.queryByText('遅い元の券')).toBeNull()
  expect(screen.getByRole('button', { name: /再読み込み|もう一度/ })).toBeTruthy()
})
