// @vitest-environment happy-dom
// 自動のLINEの有効化で、競合後の再確認と二重送信の防止を守る。
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  rules: vi.fn(), sends: vi.fn(), save: vi.fn(), enableMock: vi.fn(), test: vi.fn(),
}))
vi.mock('@/lib/api/helpers/gap3', () => ({ ecAutoLineApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/ec-commerce', useSearchParams: () => new URLSearchParams() }))

const { default: EcAutoLine } = await import('./auto-line')

const RULES = [
  { kind: 'cart', enabled: true, waitMinutes: 60, messages: [{ type: 'text', text: '{{name}} さま' }], version: 3, testMode: true },
  { kind: 'browse', enabled: false, waitMinutes: 1440, messages: [], version: 1, testMode: true },
  { kind: 'restock', enabled: true, waitMinutes: 0, messages: [], version: 2, testMode: true },
]

beforeEach(() => {
  api.rules.mockResolvedValue({ success: true, data: RULES })
  api.sends.mockImplementation(async (_a: string, kind: string) => ({ success: true, data: { items: [], total: kind === 'cart' ? 214 : kind === 'restock' ? 96 : 0 } }))
  api.save.mockResolvedValue({ success: true, data: RULES[0] })
  api.enableMock.mockResolvedValue({ success: true, data: RULES[1] })
  api.test.mockResolvedValue({ success: true, data: { preview: RULES[0], sent: false, testMode: true } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('自動のLINEをオンにする409で窓を残し、再確認後の最新の版だけで送る', async () => {
 const { ApiError } = await import('@/lib/api')
 api.rules.mockResolvedValueOnce({ success: true, data: RULES }).mockResolvedValue({ success: true, data: RULES.map(row => row.kind === 'browse' ? { ...row, version: 4 } : row) })
 api.enableMock.mockRejectedValueOnce(new ApiError(409, '変更されています。'))
 render(<EcAutoLine accountId="account" canEdit />)
 const open = async () => { fireEvent.click(await screen.findByRole('switch', { name: '閲覧落ちの自動の LINE' })); return screen.findByRole('dialog', { name: '閲覧落ちの自動の LINE をオンにしますか？' }) }
 const dialog = await open()
 await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'オンにする' })) })
 expect(within(dialog).getByRole('alert').textContent).toContain('最新の運用状態')
 const retry = within(dialog).getByRole('button', { name: 'もう一度' }); expect(retry.hasAttribute('disabled')).toBe(true)
 fireEvent.click(retry); expect(api.enableMock).toHaveBeenCalledTimes(1)
 fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
 await waitFor(() => expect(api.rules).toHaveBeenCalledTimes(2))
 const fresh = await open()
 await act(async () => { const submit = within(fresh).getByRole('button', { name: 'オンにする' }); fireEvent.click(submit); fireEvent.click(submit) })
 expect(api.enableMock.mock.calls.map(call => call.slice(0, 3))).toEqual([['account', 'browse', 1], ['account', 'browse', 4]])
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
