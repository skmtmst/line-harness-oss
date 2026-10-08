// @vitest-environment happy-dom
/*
 * 監査 WEB318/319：イベントの公開の状態。
 * - 318：状態の取得に失敗したら「読み込んでいます」のまま残さず、読み直しを出す
 * - 319：状態を変えたら、上の「申込の状況」の札も読み直す
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ getEvent: vi.fn(), setEventLifecycle: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'ev-1' : null) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
vi.mock('@/components/events/event-form', () => ({ default: () => <div>フォーム</div> }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    eventsApi: {
      ...actual.eventsApi,
      getEvent: (...args: unknown[]) => net.getEvent(...args),
      getBookingSummary: async () => ({ confirmed: 1, totalCapacity: 10, requested: 0, waitlist: 0, cancelled: 0 }),
      listSlots: async () => ({ items: [] }),
      setEventLifecycle: (...args: unknown[]) => net.setEventLifecycle(...args),
    },
  }
})

const { default: EditEventPage } = await import('./page')

beforeEach(() => {
  net.getEvent.mockReset()
  net.setEventLifecycle.mockReset()
})
afterEach(cleanup)

describe('公開の状態（WEB318/319）', () => {
  it('状態が読めなかったら、読み直しを出す', async () => {
    net.getEvent.mockRejectedValue(new Error('down'))
    render(<EditEventPage />)
    await waitFor(() => expect(screen.getByText('公開の状態を読み込めませんでした。')).toBeTruthy())
    expect(screen.queryByText('状態を読み込んでいます…')).toBeNull()
  })

  it('一時停止したら、申込の状況の札も一時停止になる', async () => {
    net.getEvent.mockResolvedValue({ id: 'ev-1', lifecycle_status: 'published', is_published: 1 })
    net.setEventLifecycle.mockResolvedValue({ lifecycle_status: 'paused' })
    render(<EditEventPage />)
    const pause = await screen.findByRole('button', { name: '一時停止する' })
    net.getEvent.mockResolvedValue({ id: 'ev-1', lifecycle_status: 'paused', is_published: 1 })
    await act(async () => { pause.click() })
    const reason = document.body.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '台風')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirm = screen.getAllByRole('button', { name: '一時停止する' }).at(-1)!
    await act(async () => { confirm.click() })
    await waitFor(() => expect(screen.getByText('一時停止')).toBeTruthy())
  })
})
