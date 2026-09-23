// @vitest-environment happy-dom
/*
 * #641: ウェビナー一覧の行操作を「枠つき編集ボタン＋アーカイブアイコン」へ統一。
 * 文字リンク＋裸ボタンをやめ、撮影口（LKuAQ）は保ったままの形を実マウントで確かめる。
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
  it('「編集」が枠つきボタンで、アーカイブは撮影口つきのアイコンボタン', async () => {
    await act(async () => { root.render(<WebinarsPage />) })
    await flush()

    const edit = [...host.querySelectorAll('a')]
      .find((el) => el.getAttribute('href') === '/webinars/edit?id=webinar-5' && el.textContent?.includes('編集'))
    expect(edit, '枠つき「編集」ボタンが見つかりません').toBeTruthy()

    const archive = host.querySelector('button[data-qa-open="LKuAQ"]')
    expect(archive, 'アーカイブの撮影口が消えています').toBeTruthy()
    expect(archive!.getAttribute('aria-label')).toBe('旧機能説明会をアーカイブ')
  })
})
