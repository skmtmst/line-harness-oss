// @vitest-environment happy-dom
/*
 * V8 ウェビナー一覧（src/v8）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 行の「…」からアーカイブの確かめ（VXZ6T）が開く・札に件数が出る・
 * フォルダの「…」は選んだ行だけ・終わった公開は「非公開」・公開ページの道。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/webinars',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import WebinarListV8 from './list'
import type { WebinarListItem } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function webinar(overrides: Partial<WebinarListItem> = {}): WebinarListItem {
  return {
    id: 'webinar-1', accountId: 'account-a', title: 'NEN活用スタートセミナー', slug: 'nen-start', status: 'active',
    videoPrefix: 'videos/nen-start', durationSeconds: 872, schedule: [], cta: null, tagOnAttend: null, tagOnCtaClick: null,
    folderId: null, folderName: null, registrationCount: 124, viewerCount: 98,
    publicationState: 'always', publicationStartsAt: null, publicationEndsAt: null,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

const items = [
  webinar(),
  webinar({ id: 'webinar-5', title: '旧機能説明会', slug: 'old', status: 'draft', publicationState: 'ended' }),
]
const folders = [
  { id: 'folder-seminar', kind: 'webinar', accountId: 'account-a', name: 'セミナー', parentId: null, displayOrder: 0, count: 1, color: null, createdAt: '', updatedAt: '' },
]

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/overview')) return json({ data: { state: 'partial', registrationMode: 'people', metrics: {} } })
    if (url.pathname.includes('/folders')) return json({ success: true, data: folders })
    if (url.pathname.endsWith('/api/webinars')) {
      const status = url.searchParams.get('status')
      const rows = status ? items.filter((item) => item.status === status) : items
      return json({ data: { items: rows, total: rows.length, limit: 20, sort: [] } })
    }
    return json({ data: null })
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

async function render() {
  await act(async () => { root.render(<WebinarListV8 />) })
  await act(async () => {})
  await act(async () => {})
}

const buttonByLabel = (label: string) =>
  [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === label) as HTMLButtonElement | undefined

describe('V8 ウェビナー一覧', () => {
  it('行の「…」から「アーカイブする」を選ぶと、対象を言う確かめの窓（VXZ6T）が開く', async () => {
    await render()
    const more = buttonByLabel('ウェビナー「旧機能説明会」の操作')
    expect(more).toBeTruthy()
    await act(async () => { more!.click() })
    const archive = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('アーカイブする')) as HTMLElement
    expect(archive).toBeTruthy()
    await act(async () => { archive.click() })
    const dialog = document.querySelector('[data-design-node="VXZ6T"]') ?? document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('ウェビナーをアーカイブしますか？')
    expect(dialog?.textContent).toContain('アーカイブする対象')
    expect(dialog?.textContent).toContain('旧機能説明会')
  })

  it('終わった公開は「非公開」、公開ページの道は /webinar/〇〇', async () => {
    await render()
    const row = host.querySelector('[data-row-id="webinar-5"]')
    expect(row?.textContent).toContain('非公開')
    expect(row?.textContent).toContain('/webinar/old')
  })

  it('状態の札に、同じ条件で数えた件数が出る', async () => {
    await render()
    const group = host.querySelector('[role="group"][aria-label="状態で絞り込む"]')
    expect(group?.textContent).toContain('公開中 1')
    expect(group?.textContent).toContain('下書き 1')
  })

  it('フォルダの「…」は選んだフォルダの行だけに出る', async () => {
    await render()
    expect(buttonByLabel('フォルダ「セミナー」の操作')).toBeUndefined()
    const folderButton = [...host.querySelectorAll('button')].find((button) => button.getAttribute('title') === 'セミナー') as HTMLButtonElement
    await act(async () => { folderButton.click() })
    await act(async () => {})
    expect(buttonByLabel('フォルダ「セミナー」の操作')).toBeTruthy()
  })
})
