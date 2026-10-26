// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

const fetchApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchApi, ApiError: class extends Error { status = 0 } }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<object>()), useStaffIdentity: () => ({ id: 'staff-1' }) }))
vi.mock('@/components/shared/list-url-state', async (importOriginal) => ({ ...(await importOriginal<object>()), useListUrlValue: (_: string, fallback: number) => [fallback, vi.fn()], useListUrlParam: () => [''] }))
vi.mock('@/components/shared/pagination', () => ({ default: () => <nav aria-label="受信一覧のページ送り" /> }))
vi.mock('@/components/shared/list-navigation', async (importOriginal) => ({ ...(await importOriginal<object>()), default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

import { InboxSection, isEmojiOnly } from './inbox'

afterEach(() => { cleanup(); fetchApi.mockReset() })

const item = (id: string, preview: string) => ({ id, channel: 'line' as const, customerName: `友だち${id}`, preview, lastIncomingAt: '2026-10-20T00:00:00Z', friendId: id })

describe('対応が必要な受信の表', () => {
  it('絵文字だけの内容は見分ける（数字・記号だけは絵文字にしない）', () => {
    expect(isEmojiOnly('🚚💥')).toBe(true)
    expect(isEmojiOnly(' 👍🏻 ')).toBe(true)
    expect(isEmojiOnly('ありがとう🙏')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
    expect(isEmojiOnly('')).toBe(false)
  })

  it('件数が少ない時は下に1行、絵文字だけの内容には「（絵文字）」、待ち時間は赤の札', async () => {
    fetchApi.mockResolvedValue({ success: true, data: { items: [item('1', '🚚💥'), item('2', 'この度はご利用いただき')], summary: { total: 2 } } })
    render(<InboxSection onSummaryChange={vi.fn()} />)
    expect(await screen.findByText('ほかに対応が必要な受信はありません')).toBeTruthy()
    expect(screen.getAllByText('（絵文字）')).toHaveLength(1)
    const waits = screen.getAllByText(/日前$/)
    expect(waits).toHaveLength(2)
    expect(waits.every((wait) => wait.closest('[data-tone="danger"], [class*="danger"]') !== null)).toBe(true)
  })

  it('ページ送りがある時は「ほかに無い」と書かない', async () => {
    fetchApi.mockResolvedValue({ success: true, data: { items: [1, 2, 3, 4, 5].map((n) => item(String(n), '本文')), summary: { total: 12 } } })
    render(<InboxSection onSummaryChange={vi.fn()} />)
    await screen.findByText('友だち1')
    expect(screen.queryByText('ほかに対応が必要な受信はありません')).toBeNull()
  })
})
