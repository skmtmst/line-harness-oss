// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ archive: vi.fn(), get: vi.fn(async () => ({ success: true, data: { lineAccountId: null as string | null } })) }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: async () => ({ success: true, data: [{ id: 'other', name: '店B' }] }) }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 return { ...actual, api: { ...actual.api, affiliates: { ...actual.api.affiliates,
  archiveImpact: async () => ({ success: true, data: { activeLinks: 1, unsettledReward: 0, pendingConversions: 0 } }), get: calls.get, archive: calls.archive,
 } } }
})
import { AffiliateArchiveDialog } from './dialogs'
afterEach(() => { cleanup(); calls.archive.mockReset(); calls.get.mockReset().mockResolvedValue({ success: true, data: { lineAccountId: null } }) })
it('紹介停止の確認に不明なアカウントと環境を示し、閉じた古い窓から実行しない', async () => {
 const props = { target: { id: 'p1', name: '紹介者' }, onClose: vi.fn(), onChanged: vi.fn() }
 const view = render(<AffiliateArchiveDialog {...props} />)
 const button = await screen.findByRole('button', { name: '紹介を止める' })
 await screen.findByText('LINEアカウント')
 expect(screen.getByText('不明')).toBeTruthy()
 expect(screen.getByText('環境')).toBeTruthy()
 await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
 const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
 const old = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
 view.rerender(<AffiliateArchiveDialog {...props} target={null} />)
 view.rerender(<AffiliateArchiveDialog {...props} />)
 old()
 expect(calls.archive).not.toHaveBeenCalled()
})

it('選択中とは別の所属アカウントを表示し、その紹介者に操作を送る', async () => {
 calls.get.mockResolvedValue({ success: true, data: { lineAccountId: 'other' } })
 calls.archive.mockResolvedValue({ success: false, error: 'test' })
 render(<AffiliateArchiveDialog target={{ id: 'p1', name: '紹介者' }} accountId="a" onClose={vi.fn()} onChanged={vi.fn()} />)
 expect(await screen.findByText('店B')).toBeTruthy()
 const button = await screen.findByRole('button', { name: '紹介を止める' }) as HTMLButtonElement
 await waitFor(() => expect(button.disabled).toBe(false))
 fireEvent.click(button)
 expect(calls.archive).toHaveBeenCalledWith('p1', { mode: 'pause', confirmationName: undefined })
})

it('アカウントを切り替えて戻しても古い確認で操作しない', async () => {
 const props = { target: { id: 'p1', name: '紹介者' }, onClose: vi.fn(), onChanged: vi.fn() }
 const view = render(<AffiliateArchiveDialog {...props} accountId="a" />)
 const button = await screen.findByRole('button', { name: '紹介を止める' }) as HTMLButtonElement
 await waitFor(() => expect(button.disabled).toBe(false))
 view.rerender(<AffiliateArchiveDialog {...props} accountId="b" />)
 view.rerender(<AffiliateArchiveDialog {...props} accountId="a" />)
 expect(button.disabled).toBe(true)
 fireEvent.click(button)
 expect(calls.archive).not.toHaveBeenCalled()
})
