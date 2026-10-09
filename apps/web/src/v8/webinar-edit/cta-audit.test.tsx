// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ ctas: vi.fn(), saveCtas: vi.fn(), fetchApi: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), fetchApi: net.fetchApi, webinarApi: net }))
import CtaPane from './cta'
import type { EditContext, WizardChrome } from './types'
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('WEB-165: 読んだCTAの版を渡して保存し、409でも入力を残す', async () => {
 net.ctas.mockResolvedValue({ data: [{ atSeconds: 20, kind: 'url', title: '案内', body: null, buttonLabel: '開く', url: 'https://example.test/', autoOpen: false }], version: 7 })
 net.fetchApi.mockResolvedValue({ success: true, data: [] })
 net.saveCtas.mockRejectedValue(new (await import('@/lib/api')).ApiError(409, '競合', 'version_conflict'))
 const ctx = { webinar: { id: 'w', accountId: 'a', durationSeconds: 3600 }, editor: { version: 3 }, readOnly: false, onCtasReport: vi.fn() } as unknown as EditContext
 const chrome: WizardChrome = { title: 'CTA', identity: null, steps: null, footerActions: null, footerWithDraft: x => x }
 render(<CtaPane ctx={ctx} chrome={chrome} onDirtyChange={() => {}} registerSave={() => {}} />)
 await waitFor(() => expect(screen.getByDisplayValue('案内')).toBeTruthy())
 fireEvent.change(screen.getByDisplayValue('案内'), { target: { value: '直した入力' } })
 fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
 await waitFor(() => expect(net.saveCtas).toHaveBeenCalled())
 expect(net.saveCtas.mock.calls[0][2]).toBe(7)
 expect(screen.getByDisplayValue('直した入力')).toBeTruthy()
})

it('WEB-165: 別のウェビナーへ切り替えた後の保存失敗は新しい画面へ出さない', async () => {
 let fail!: (error: Error) => void
 const card = { atSeconds: 20, kind: 'url', title: '案内', body: null, buttonLabel: '開く', url: 'https://example.test/', autoOpen: false }
 net.ctas.mockImplementation((id: string) => Promise.resolve({ data: [{ ...card, title: id === 'a' ? '古い案内' : '新しい案内' }], version: 7 }))
 net.fetchApi.mockResolvedValue({ success: true, data: [] })
 net.saveCtas.mockImplementation(() => new Promise((_, reject) => { fail = reject }))
 const ctx = { webinar: { id: 'a', accountId: 'account', durationSeconds: 3600 }, editor: { version: 3 }, readOnly: false, onCtasReport: vi.fn() } as unknown as EditContext
 const chrome: WizardChrome = { title: 'CTA', identity: null, steps: null, footerActions: null, footerWithDraft: x => x }
 const props = { ctx, chrome, onDirtyChange: () => {}, registerSave: () => {} }
 const view = render(<CtaPane {...props} />)
 await screen.findByDisplayValue('古い案内')
 fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
 await waitFor(() => expect(net.saveCtas).toHaveBeenCalled())
 view.rerender(<CtaPane {...props} ctx={{ ...ctx, webinar: { ...ctx.webinar, id: 'b' } }} />)
 await screen.findByDisplayValue('新しい案内')
 await act(async () => fail(new (await import('@/lib/api')).ApiError(409, '競合', 'version_conflict')))
 expect(screen.queryByText('ほかの人がこのウェビナーを保存しました')).toBeNull()
 expect(screen.getByDisplayValue('新しい案内')).toBeTruthy()
})
