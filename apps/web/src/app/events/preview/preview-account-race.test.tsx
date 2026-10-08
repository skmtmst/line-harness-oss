// @vitest-environment happy-dom
/*
 * 監査 WEB320：お客様表示の確認で、アカウントを切り替えたあとに
 * 前のアカウントの遅い応答が今の表示に混ざらない。
 */
import React from 'react'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ account: 'acc-a', pending: new Map<string, (v: unknown) => void>() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'ev-1' : null) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: net.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    eventsApi: {
      ...actual.eventsApi,
      getEvent: (accountId: string) => new Promise((resolve) => { net.pending.set(accountId, resolve) }),
      listSlots: async () => ({ items: [] }),
    },
  }
})

const { default: EventPreviewPage } = await import('./page')

afterEach(cleanup)

const event = (name: string) => ({ id: 'ev-1', name, description: null, image_url: null, location: null })

describe('お客様表示の確認（WEB320）', () => {
  it('B に切り替えたあとに A の応答が届いても、B のイベントのまま', async () => {
    const view = render(<EventPreviewPage />)
    net.account = 'acc-b'
    view.rerender(<EventPreviewPage />)
    await act(async () => { net.pending.get('acc-b')?.(event('Bのイベント')) })
    await waitFor(() => expect(screen.getByText('Bのイベント')).toBeTruthy())
    await act(async () => { net.pending.get('acc-a')?.(event('Aのイベント')) })
    expect(screen.queryByText('Aのイベント')).toBeNull()
  })
})
