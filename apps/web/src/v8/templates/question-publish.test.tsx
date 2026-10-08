// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), publish: vi.fn(), get: vi.fn(), push: vi.fn(), account: 'a' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: net.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => {} }))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: { templates: net, folders: { list: async () => ({ success: true, data: [] }) }, tags: { list: async () => ({ success: true, data: [] }) }, scenarios: { list: async () => ({ success: true, data: [] }) } } }))
import Editor from './question-new'
afterEach(() => { cleanup(); vi.resetAllMocks(); net.account = 'a' })
it('WEB-105: 公開失敗後は作成済みの同じ質問を公開し直す', async () => {
 net.create.mockResolvedValue({ success: true, data: { id: 'new', draftRevision: 1, publishedVersion: 0 } })
 net.get.mockResolvedValue({ success: true, data: { draftRevision: 1, publishedVersion: 0 } })
 net.publish.mockRejectedValueOnce(new Error('通信失敗')).mockResolvedValue({ success: true, data: {} })
 render(<Editor />)
 fireEvent.change(await screen.findByPlaceholderText('例：継続の意思をうかがう'), { target: { value: '質問' } })
 fireEvent.change(screen.getByPlaceholderText('来月も定期便を続けますか？'), { target: { value: '続けますか？' } })
 fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
 await waitFor(() => expect(net.publish).toHaveBeenCalledTimes(1))
 expect(net.push).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
 await waitFor(() => expect(net.push).toHaveBeenCalledWith('/templates'))
 expect(net.create).toHaveBeenCalledTimes(1)
 expect(net.publish.mock.calls[0]).toEqual(['new', { expectedVersion: 0, expectedDraftRevision: 1 }])
})

it('WEB-105: 保存後の取得待ちにアカウントを変えたら古い質問を公開しない', async () => {
 let finish!: (v: unknown) => void
 net.create.mockResolvedValue({ success: true, data: { id: 'old' } })
 net.get.mockImplementation(() => new Promise(r => { finish = r }))
 const view = render(<Editor />)
 fireEvent.change(await screen.findByPlaceholderText('例：継続の意思をうかがう'), { target: { value: '質問' } })
 fireEvent.change(screen.getByPlaceholderText('来月も定期便を続けますか？'), { target: { value: '続けますか？' } })
 fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
 await waitFor(() => expect(net.get).toHaveBeenCalledWith('old'))
 net.account = 'b'; view.rerender(<Editor />)
 await act(async () => finish({ success: true, data: { draftRevision: 1, publishedVersion: 0 } }))
 expect(net.publish).not.toHaveBeenCalled()
 expect(net.push).not.toHaveBeenCalled()
})
