// @vitest-environment happy-dom
/*
 * U お客様表示確認の描画試験。主な状態（未指定・読み込み失敗・正常）と、
 * オンラインURLの扱いの注記を守る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getEvent = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ value: 'id=e1' }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    eventsApi: { ...actual.eventsApi, getEvent, listSlots },
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParams.value),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EventPreviewPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  searchParams.value = 'id=e1'
  getEvent.mockReset()
  listSlots.mockReset()
  getEvent.mockResolvedValue({
    id: 'e1',
    name: '秋のしつけ教室',
    venue_name: '店内スペース',
    venue_url: 'https://example.test/room',
    description: 'はじめての方向けです。',
    is_published: 1,
  })
  listSlots.mockResolvedValue({
    items: [
      {
        id: 'slot-1',
        event_id: 'e1',
        starts_at: '2099-06-01T01:00:00.000Z',
        ends_at: '2099-06-01T02:00:00.000Z',
        capacity: 10,
        is_active: 1,
        sort_order: 1,
      },
    ],
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function renderPage() {
  await act(async () => { root.render(<EventPreviewPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('U お客様表示の確認', () => {
  it('idが無いときは選び直しだけを出す', async () => {
    searchParams.value = ''
    await renderPage()
    expect(host.textContent).toContain('確認するイベントが指定されていません')
  })

  it('読み込みに失敗したら開き直しを出す', async () => {
    getEvent.mockRejectedValueOnce(new Error('down'))
    await renderPage()
    expect(host.textContent).toContain('開き直す')
  })

  it('お客様に見える内容だけを出し、URLの扱いを注記する', async () => {
    await renderPage()
    expect(host.textContent).toContain('秋のしつけ教室')
    expect(host.textContent).toContain('はじめての方向けです。')
    expect(host.textContent).toContain('会場：店内スペース')
    // URLそのものは出さず、確定後に案内する旨だけ出す。
    expect(host.textContent).not.toContain('https://example.test/room')
    expect(host.textContent).toContain('オンラインのURLは確定後に案内します')
    expect(host.textContent).toContain('時間を選ぶ')
  })
})
