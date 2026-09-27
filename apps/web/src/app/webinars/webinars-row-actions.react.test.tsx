// @vitest-environment happy-dom
/*
 * #641 → ★V7 `Xn1Mz`：ウェビナー一覧の行操作は「枠つき編集ボタン＋「…」」。
 * アーカイブはメニューの中へ。箱のアイコンだけのボタンは行に直に置かない。
 * 撮影口（LKuAQ）は「…」ボタンへ移し、メニューを開いて確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const list = vi.hoisted(() => vi.fn())
const overview = vi.hoisted(() => vi.fn())
const folders = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    webinarApi: { ...actual.webinarApi, list, overview, folders },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import WebinarsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const webinar = {
  id: 'webinar-5',
  title: '旧機能説明会',
  slug: 'old-feature-briefing',
  status: 'archived',
  publicationState: 'ended',
  publicationStartsAt: null,
  publicationEndsAt: null,
  registrationCount: 12,
  viewerCount: 8,
  folderName: null,
  folderId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  list.mockImplementation(async () => ({ success: true, data: { items: [webinar], total: 1 } }))
  overview.mockImplementation(async () => ({ success: true, data: { webinars: 1, registrants: 0, viewers: 0, completionRate: null } }))
  folders.mockImplementation(async () => ({ success: true, data: [] }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('#641 ウェビナー一覧の行操作', () => {
  it('「編集」が枠つきボタンで、アーカイブは撮影口つき「…」の中', async () => {
    await act(async () => { root.render(<WebinarsPage />) })
    await flush()

    const edit = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/webinars/edit?id=webinar-5' && el.textContent?.includes('編集'))
    expect(edit, '枠つき「編集」ボタンが見つかりません').toBeTruthy()

    // 行に箱アイコンだけのボタンは置かない。
    expect(host.querySelector('button[aria-label="旧機能説明会をアーカイブ"]'), '箱アイコンの直置きが残っています').toBeNull()

    const more = host.querySelector('button[data-qa-open="LKuAQ"]') as HTMLButtonElement
    expect(more, '「…」の撮影口が消えています').toBeTruthy()
    expect(more.getAttribute('aria-label')).toBe('旧機能説明会のその他操作')
    act(() => { more.click() })
    const menu = host.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('アーカイブする')
  })
})
