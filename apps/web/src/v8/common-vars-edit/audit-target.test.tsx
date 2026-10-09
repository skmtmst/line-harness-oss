// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ detail: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteImpact: vi.fn(), query: '', push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }), useSearchParams: () => new URLSearchParams(net.query) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 return { ...actual, api: { ...actual.api, folders: { list: async () => ({ success: true, data: [] }) }, commonVars: { ...actual.api.commonVars, detail: net.detail, create: net.create, update: net.update, impactPreview: async () => ({ success: true, data: { canSave: true, impactProof: 'proof' } }), schedules: async () => ({ success: true, data: [] }), deleteImpact: net.deleteImpact, delete: net.delete } } }
})
import New from './new'
import Edit from './edit'
const detail = (id: string, name: string) => ({ success: true, data: { id, name, varKey: id, type: 'text', value: '10時', memo: '', status: 'active', version: 1, usages: [], history: [], usagePage: { shown: 0, total: 0 } } })
afterEach(() => { cleanup(); vi.resetAllMocks(); net.query = '' })
it('WEB-126: 注意を確認しても、下書きとして登録する意図を保つ', async () => {
 net.create.mockResolvedValue({ success: true, data: {} })
 render(<New />)
 fireEvent.change(document.getElementById('cv-name')!, { target: { value: '営業時間' } })
 fireEvent.change(document.getElementById('cv-key')!, { target: { value: 'hours' } })
 fireEvent.change(document.getElementById('cv-value')!, { target: { value: '10時' } })
 fireEvent.change(document.getElementById('cv-memo')!, { target: { value: 'password: 仮の説明' } })
 fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
 fireEvent.click(await screen.findByRole('button', { name: '内容を確認して登録する' }))
 await waitFor(() => expect(net.create).toHaveBeenCalled())
 expect(net.create.mock.calls[0][0].status).toBe('draft')
})
it('WEB-127: 同じアカウントで別の共通情報を開いても古い応答を捨てる', async () => {
 let finish!: (v: unknown) => void
 net.detail.mockImplementation((id: string) => id === 'old' ? new Promise(r => { finish = r }) : Promise.resolve(detail(id, '新しい名前')))
 net.query = 'id=old'
 const view = render(<Edit />)
 net.query = 'id=new'; view.rerender(<Edit />)
 await screen.findByDisplayValue('新しい名前')
 await act(async () => finish(detail('old', '古い名前')))
 expect(screen.queryByDisplayValue('古い名前')).toBeNull()
 expect(screen.getByDisplayValue('新しい名前')).toBeTruthy()
})

it('WEB-127: 保存の待ち時間に入れた変更を、保存後の読み直しで消さない', async () => {
 let finish!: (v: unknown) => void
 net.query = 'id=new'
 net.detail.mockResolvedValue(detail('new', '保存前の名前'))
 net.update.mockImplementation(() => new Promise(r => { finish = r }))
 render(<Edit />)
 await screen.findByDisplayValue('保存前の名前')
 fireEvent.change(document.getElementById('cv-name')!, { target: { value: '送った名前' } })
 fireEvent.change(document.getElementById('cv-change-reason')!, { target: { value: '名前を変える' } })
 fireEvent.click(screen.getByRole('button', { name: '保存する' }))
 await waitFor(() => expect(net.update).toHaveBeenCalled())
 fireEvent.change(document.getElementById('cv-name')!, { target: { value: '保存中の追加入力' } })
 net.detail.mockResolvedValue(detail('new', '送った名前'))
 await act(async () => finish({ success: true, data: { id: 'new', version: 2 } }))
 expect(screen.getByDisplayValue('保存中の追加入力')).toBeTruthy()
})

it('WEB-127: 古い対象の削除完了で新しく開いた編集画面から移動しない', async () => {
 let finish!: (v: unknown) => void
 net.detail.mockImplementation((id: string) => Promise.resolve(detail(id, id === 'old' ? '消す名前' : '新しい名前')))
 net.deleteImpact.mockResolvedValue({ success: true, data: { canDelete: true, blockingTotal: 0 } })
 net.delete.mockImplementation(() => new Promise(r => { finish = r }))
 net.query = 'id=old'
 const view = render(<Edit />)
 await screen.findByDisplayValue('消す名前')
 fireEvent.click(screen.getByRole('button', { name: '削除' }))
 fireEvent.change(await screen.findByPlaceholderText('例：店舗情報の変更のため'), { target: { value: '不要になった' } })
 fireEvent.click(screen.getByRole('button', { name: '削除する' }))
 await waitFor(() => expect(net.delete).toHaveBeenCalled())
 net.query = 'id=new'; view.rerender(<Edit />)
 await screen.findByDisplayValue('新しい名前')
 await act(async () => finish({ success: true }))
 expect(net.push).not.toHaveBeenCalled()
 expect(screen.getByDisplayValue('新しい名前')).toBeTruthy()
})
