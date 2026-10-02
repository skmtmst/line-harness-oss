// @vitest-environment happy-dom
/*
 * R527: 作成できない運用担当（staff）には自動応答の作成入口を出さない。
 * owner/admin には出す。役割×操作の表を実マウントで固定する。
 * 口側の作成・更新・停止・削除の staff 拒否は Worker の試験で見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

vi.mock('@/components/shell/page-chrome', () => ({
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
  return [...host.querySelectorAll('button')].map((el) => el.textContent?.trim() ?? '')
}

describe('R527 自動応答一覧の出し分け（役割×操作）', () => {
  it('staff には作成・編集・停止・削除の入口が出ず、理由が出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'staff' } }))
    await act(async () => {
      root.render(<AutoRepliesPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).not.toContain('＋ ルールを作る')
    expect(labels).not.toContain('編集')
    expect(
      host.querySelector('button[aria-label="自動応答「旧キーワードルール」のその他操作"]'),
    ).toBeNull()
    // 順番の入れ替え（更新口）も出さない。
    expect(host.querySelector('button[aria-label="自動応答「旧キーワードルール」を1つ上へ"]')).toBeNull()
    expect(host.textContent).toContain(
      '自動応答の作成・変更・停止・削除はオーナーと管理者だけができます',
    )
  })

  it('owner には作成・編集・停止・削除の入口が出る', async () => {
    staffMe.mockImplementation(async () => ({ success: true, data: { role: 'owner' } }))
    await act(async () => {
      root.render(<AutoRepliesPage />)
    })
    await flush()

    const labels = buttons()
    expect(labels).toContain('＋ ルールを作る')
    expect(labels).toContain('編集')
    expect(
      host.querySelector('button[aria-label="自動応答「旧キーワードルール」のその他操作"]'),
    ).not.toBeNull()
  })
})

/*
 * 直しを戻すと赤くなる文字契約。実マウントの試験が本命で、
 * こちらは分岐の削除・無条件表示への戻しを見張る。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R527 一覧の出し分け契約', () => {
  it('変更の可否は共通の出し分けで決め、手元の保存値で決めない', () => {
    expect(PAGE).toContain("from '@/lib/staff-role'")
    expect(PAGE).toContain('useStaffRole')
    expect(PAGE).toContain('canManageRole')
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })

  it('作成・行操作・フォルダ追加・編集窓が canManage で守られている', () => {
    const gated = (entry: string, label: string) => {
      const at = PAGE.indexOf(entry)
      expect(at, `${label} が画面にありません`).toBeGreaterThan(-1)
      expect(
        PAGE.slice(Math.max(0, at - 2000), at),
        `${label} が canManage で守られていません`,
      ).toContain('canManage')
    }
    gated('＋ ルールを作る', '作成ボタン')
    gated('onAddFolder={canManage ?', 'フォルダ追加')
    // 行の操作（順番・編集・停止・再開・削除）は1つの分岐の中にあり、
    // 見るだけには「—」が出る。形そのもので見る。
    expect(PAGE).toContain('{canManage ? (\n                      <div className="relative inline-flex items-center justify-end gap-1.5">')
    expect(PAGE).toContain(') : (\n                        <span className="text-ink-faint text-xs">—</span>')
    expect(PAGE).toContain('title={canManage')
    expect(PAGE).toContain('{editing && canManage && (')
    expect(PAGE).toContain('{folderDialogOpen && canManage && (')
    expect(PAGE).toContain('自動応答の作成・変更・停止・削除はオーナーと管理者だけができます')
  })
})
