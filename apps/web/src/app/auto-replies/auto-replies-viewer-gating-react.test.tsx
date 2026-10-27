// @vitest-environment happy-dom
/*
 * R527: 作成できない運用担当（staff）には自動応答の作成入口を出さない。
 * owner/admin には出す。役割×操作の表を実マウントで固定する。
 * 口側の作成・更新・停止・削除の staff 拒否は Worker の試験で見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { join as sourceJoin } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listReplies = vi.hoisted(() => vi.fn())
const listTemplates = vi.hoisted(() => vi.fn())
const summary = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const staffMe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      autoReplies: { ...actual.api.autoReplies, list: listReplies, summary },
      templates: { ...actual.api.templates, list: listTemplates },
      folders: { ...actual.api.folders, list: listFolders },
      staff: { ...actual.api.staff, me: staffMe },
    },
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

vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {},
  usePageTitle: () => {},
}))

import AutoRepliesPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const rule = {
  id: 'ar-1',
  name: '旧キーワードルール',
  keyword: '予約',
  matchType: 'contains',
  keywords: null,
  respondToAll: false,
  isActive: true,
  lifecycleStatus: 'published',
  hits: { period: 3, total: 10 },
  responseContent: 'ご予約を承ります',
  keywordMatchMode: 'any',
  activeFrom: null,
  activeUntil: null,
  responseWeekdays: null,
  responseHolidayRule: null,
  cooldownMinutes: null,
  skipWhenOperatorActive: false,
  oncePerFriend: false,
  messageKinds: null,
  friendConditions: null,
  folderId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  listReplies.mockImplementation(async () => ({ success: true, data: [rule] }))
  listTemplates.mockImplementation(async () => ({ success: true, data: [] }))
  summary.mockImplementation(async () => ({ success: true, data: { conflictCount: 0 } }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function buttons(): string[] {
  return [...host.querySelectorAll('button')].map((el) => el.textContent?.trim().replace(/^＋\s*/, '') ?? '')
}

describe('R527 自動応答一覧の出し分け（役割×操作）', () => {
  it('staff には作成・編集・停止・削除の入口が出ず、理由が出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'staff' } }))
    await act(async () => {
      root.render(<AutoRepliesPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).not.toContain('ルールを作る')
    expect(labels).not.toContain('編集')
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="自動応答「旧キーワードルール」の操作"]')!
    await act(async () => { more.click() })
    const menu = document.querySelector('[role="menu"]')!
    for (const label of ['編集する', '止める', '削除', '複製する', 'フォルダへ移す']) expect(menu.textContent).not.toContain(label)
    // 順番の入れ替え（更新口）も出さない。
    expect(host.querySelector('button[aria-label="自動応答「旧キーワードルール」を1つ上へ"]')).toBeNull()
    expect(host.textContent).toContain(
      '閲覧のみで見ています',
    )
  })

  it('owner には作成・編集・停止・削除の入口が出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
    await act(async () => {
      root.render(<AutoRepliesPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).toContain('ルールを作る')
    expect(host.querySelector('a[href="/auto-replies/edit?id=ar-1"]')).not.toBeNull()
    expect(
      host.querySelector('button[aria-label="自動応答「旧キーワードルール」の操作"]'),
    ).not.toBeNull()
  })
})

describe('R527 フォルダの列の出し分け', () => {
  function stubWideViewport() {
    const real = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }),
      configurable: true,
    })
    return () => { Object.defineProperty(window, 'matchMedia', { value: real, configurable: true }) }
  }

  it.each([
    ['staff', false],
    ['owner', true],
  ] as const)('%s のフォルダの列の「…」（名前の変更・削除）', async (role, shown) => {
    const restore = stubWideViewport()
    try {
      listFolders.mockImplementation(async () => ({ success: true, data: [{ id: 'folder-1', name: '営業時間', color: 'blue', count: 1 }], unfiledCount: 0 }))
      staffMe.mockImplementation(async () => ({ success: true, data: { role } }))
      await act(async () => { root.render(<AutoRepliesPage />) })
      await flush()
      expect(host.textContent).toContain('営業時間')
      expect(Boolean(host.querySelector('button[aria-label="フォルダ「営業時間」の操作"]'))).toBe(shown)
    } finally { restore() }
  })
})

/*
 * 権限の出し分けは上の実マウントが本命（フォルダの列・作るボタン・行の操作・順番）。
 * ここには手元の保存値で決める形へ戻さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(sourceJoin(__dirname, '../../v8/auto-replies/list.tsx'), 'utf8')

describe('R527 一覧の出し分け契約', () => {
  it('変更の可否を手元の保存値で決めない', () => {
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })
})
