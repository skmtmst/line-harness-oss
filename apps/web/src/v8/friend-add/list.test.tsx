// @vitest-environment happy-dom
/*
 * V8 友だち追加時の配信の一覧（src/v8）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 管理者には作る・行の操作が出る・閲覧のみには変える操作を置かない（帯は出す）・
 * 受け皿の「…」は止める（案内の窓）だけで削除を出さない・送るものの2行目は1行にまとめる。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/friend-add-settings',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

const roleState = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => roleState.role }
})

import FriendAddListV8, { actionLine } from './list'
import type { FriendAddRule } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function rule(overrides: Partial<FriendAddRule> = {}): FriendAddRule {
  return {
    id: 'rule-shop', accountId: 'account-a', friendKind: 'first_time', name: '店頭QRの初回案内', folderName: '店頭',
    priority: 1, isFallback: false, status: 'published', versionId: 'v1', versionNumber: 1, versionStatus: 'published',
    lastTestStatus: null, lastTestedAt: null, lastTestedByStaffId: null, lastTestedByStaffName: null, publishedAt: null,
    matchedLast7Days: 41, version: 1, routeNames: ['店頭QRコード'], scenarioName: '7日間フォロー',
    definition: {
      routeIds: ['route-shop'], scenarioId: 'scenario-1', messageType: 'text', messageText: 'ようこそ', timing: 'immediate',
      actions: [
        { type: 'start_scenario', label: 'シナリオ「7日間フォロー」を開始する', targetId: 'scenario-1' },
        { type: 'add_tag', label: 'タグ「新規」を付ける', targetId: 'tag-1' },
      ],
      friendCondition: '', activeFrom: null, activeUntil: null,
    },
    ...overrides,
  }
}

const items = [
  rule(),
  rule({ id: 'rule-fallback', name: '経路が分からなかった人', isFallback: true, priority: 999, folderName: null, routeNames: [] }),
]

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  roleState.role = 'owner'
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/staff/me') return json({ success: true, data: { role: roleState.role } })
    if (url.pathname === '/api/friend-add-rules') {
      return json({
        success: true,
        data: {
          items, total: items.length, nextCursor: null,
          folderCounts: [{ name: '店頭', count: 1 }, { name: null, count: 1 }],
          summary: { rules: 1, active: 1, recentAdds: 10, captured: 8, unknownRoute: 2, delivered: 9, failed: 1 },
          options: { routes: [], scenarios: [], tags: [], folders: [{ id: 'f1', name: '店頭' }] },
        },
      })
    }
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root.render(<FriendAddListV8 />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

const buttons = () => Array.from(host.querySelectorAll('button, a')).map((el) => el.textContent?.trim() ?? '')
const openMenu = async (name: string) => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="設定「${name}」の操作"]`)
  expect(button).not.toBeNull()
  await act(async () => { button!.click() })
  return Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent?.trim() ?? '')
}

describe('友だち追加時の配信の一覧（V8）', () => {
  it('送るものの2行目はシナリオ・タグを1行にまとめる（シナリオの重ねは出さない）', () => {
    expect(actionLine(rule())).toBe('＋シナリオ「7日間フォロー」 ＋タグ「新規」')
  })

  it('管理者には作るボタンと行の変える操作が出る。受け皿の「…」に削除は出ない', async () => {
    await render()
    expect(buttons().some((text) => text.includes('初回案内を作る'))).toBe(true)
    expect(buttons().some((text) => text.includes('フォルダを追加'))).toBe(true)
    const regular = await openMenu('店頭QRの初回案内')
    expect(regular).toEqual(expect.arrayContaining(['編集する', '実行結果を見る', '止める', '削除する']))
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    const sink = await openMenu('経路が分からなかった人')
    expect(sink).toContain('止める')
    expect(sink).not.toContain('削除する')
  })

  it('閲覧のみには変える操作を置かない（押せない形でも出さない）。閲覧のみの帯は出す', async () => {
    roleState.role = 'viewer'
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(buttons().some((text) => text.includes('初回案内を作る'))).toBe(false)
    expect(buttons().some((text) => text.includes('フォルダを追加'))).toBe(false)
    const menu = await openMenu('店頭QRの初回案内')
    expect(menu).toEqual(['実行結果を見る'])
  })
})
