// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import EmailThread from './email-thread'
const net = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), fetchApi: (url: string, init?: { method?: string }) => init?.method === 'PATCH' ? net.save() : url.includes('/operators') || url.includes('/staff') ? Promise.resolve({ success: true, data: [] }) : Promise.resolve({ success: true, data: { thread: { id: 't', subject: '問い合わせ', status: 'unread', customer_email: 'user@example.test', notes: null, revision: 1 }, messages: [] } }) }))
vi.mock('../chats/template-picker', () => ({ default: () => null }))
afterEach(cleanup)
it('WEB251：メモの保存中は入力と閉じる操作を止める', async () => {
 let reject!: (reason: Error) => void
 net.save.mockImplementation(() => new Promise((_, no) => { reject = no }))
 render(<EmailThread threadId="t" onBack={vi.fn()} />)
 fireEvent.click(await screen.findByRole('button', { name: /内部メモ/ }))
 const field = screen.getByLabelText('メモ内容') as HTMLTextAreaElement
 fireEvent.change(field, { target: { value: '保存するメモ' } })
 fireEvent.click(screen.getByRole('button', { name: '保存する' }))
 await waitFor(() => expect(net.save).toHaveBeenCalled())
 expect(field.disabled).toBe(true)
 expect((screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('dialog')); fireEvent.keyDown(document, { key: 'Escape' })
 expect(screen.getByRole('dialog')).toBeTruthy()
 reject(new Error('down'))
 await waitFor(() => expect(field.disabled).toBe(false))
 expect(field.value).toBe('保存するメモ')
})
