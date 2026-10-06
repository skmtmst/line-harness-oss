// @vitest-environment happy-dom
/*
 * 使い道の表（板 `S35pO`）。絵の骨組み（`design/v8/html/S35pO.html`）にそろえる。
 * 頭の CSV・フォルダの注意書き・行の「…」（編集・テスト・止める・複製）と、
 * 渡るものの2行目の空け（残り 制限なし・10/31 まで）をここで留める。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountProvider } from '@/contexts/account-context'
import V8RewardsTab from './v8-rewards-tab'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=rewards'),
  usePathname: () => '/mileage',
}))

function versionFixture() {
  return {
    id: 'version-1',
    versionNumber: 1,
    status: 'published' as const,
    revision: 1,
    requiredMiles: 500,
    stockLimit: null,
    perFriendLimit: null,
    startsAt: null,
    endsAt: '2026-10-31T00:00:00.000Z',
    benefitExpiresDays: null,
    commonActionVersionId: null,
    targetConditions: null,
    failurePolicy: 'refund' as const,
    customerMessage: '',
    publishedAt: '2026-09-10T00:00:00.000Z',
  }
}

function rewardFixture(id: string, name: string, status: 'published' | 'draft') {
  return {
    id,
    lineAccountId: 'account-1',
    programId: 'program-1',
    name,
    description: null,
    imageUrl: null,
    rewardKind: 'coupon' as const,
    status,
    sortOrder: 0,
    currentDraftVersionId: null,
    currentPublishedVersionId: status === 'published' ? 'version-1' : null,
    currentVersion: versionFixture(),
    exchangedThisMonth: 21,
    availableCodeCount: null,
    benefitName: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }
}

const createdRewards: Array<unknown> = []
const testedRewards: string[] = []

function stubFetch() {
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/mileage/rewards') && method === 'POST' && !url.includes('/test') && !url.includes('/stop')) {
      createdRewards.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({ success: true, data: rewardFixture('reward-new', '送料無料クーポン のコピー', 'draft') }), { status: 200 })
    }
    if (url.includes('/api/mileage/rewards/') && url.includes('/test')) {
      testedRewards.push(url)
      return new Response(JSON.stringify({
        success: true,
        data: { rewardId: 'reward-1', versionId: 'version-1', requiredMiles: 500, canDeliver: true, warning: null, ledgerChanged: false },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/rewards')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          rewards: [
            rewardFixture('reward-1', '送料無料クーポン', 'published'),
            rewardFixture('reward-2', '冬の限定ギフト', 'draft'),
          ],
        },
      }), { status: 200 })
    }
    if (url.includes('/api/mileage/redemptions')) {
      return new Response(JSON.stringify({
        success: true,
        data: { items: [], pagination: { total: 0, limit: 20, offset: 0 } },
      }), { status: 200 })
    }
    if (url.includes('/api/staff/me')) {
      return new Response(JSON.stringify({ success: true, data: { id: 'owner-1', role: 'owner' } }), { status: 200 })
    }
    if (url.includes('/api/line-accounts')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{ id: 'account-1', channelId: 'channel-1', name: '公式A', isActive: true, country: null, role: null, displayOrder: 0 }],
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }) as typeof globalThis.fetch
}

let container: HTMLDivElement
let root: Root
let headerNode: React.ReactNode
const originalFetch = globalThis.fetch

function installWebStorage(): void {
  const make = () => {
    const data = new Map<string, string>()
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, String(value)) },
      removeItem: (key: string) => { data.delete(key) },
      clear: () => { data.clear() },
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() { return data.size },
    }
  }
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const holder = globalThis as unknown as Record<string, unknown>
    if (!holder[name]) {
      Object.defineProperty(globalThis, name, { value: make(), configurable: true })
    }
  }
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  installWebStorage()
  globalThis.localStorage.setItem('lh_selected_account', 'account-1')
  document.documentElement.dataset.theme = 'v8'
  createdRewards.length = 0
  testedRewards.length = 0
  headerNode = null
  stubFetch()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  document.body.innerHTML = ''
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function renderTab() {
  await act(async () => {
    root.render(
      <AccountProvider>
        <V8RewardsTab
          readonly={false}
          registerHeaderActions={(node) => { headerNode = node }}
          registerTabCount={() => {}}
        />
      </AccountProvider>,
    )
  })
}

async function waitForRows(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await Promise.resolve() })
    if (container.querySelector('tbody tr')) return
  }
  throw new Error('使い道の表が出ませんでした')
}

function openRowMenu(name: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === `${name}のその他操作`,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error('その他操作のボタンがありません')
  button.click()
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

describe('使い道の絵合わせ（板 `S35pO`）', () => {
  it('渡るものの2行目は空けて書く（残り 制限なし・10/31 まで）', async () => {
    await renderTab()
    await waitForRows()
    const body = container.textContent ?? ''
    /* くっつけると読みにくい（残り制限なし・10/31まで は昔の書き方）。 */
    expect(body).toContain('残り 制限なし')
    expect(body).toContain('10/31 まで')
    expect(body).not.toContain('残り制限なし')
  })

  it('フォルダの注意書きと行の脚注が絵どおり', async () => {
    await renderTab()
    await waitForRows()
    const body = container.textContent ?? ''
    expect(body).toContain('フォルダを消しても、中の経路は未分類に残ります')
    expect(body).toContain('行の「…」から 編集・自分で交換をテスト・出すのを止める・複製。')
  })

  it('行の「…」に4つの操作が並ぶ', async () => {
    await renderTab()
    await waitForRows()
    await act(async () => { openRowMenu('送料無料クーポン') })
    const menu = document.body.textContent ?? ''
    expect(menu).toContain('編集')
    expect(menu).toContain('自分で交換をテスト')
    expect(menu).toContain('出すのを止める')
    expect(menu).toContain('複製')
  })

  it('テストは残高・在庫を動かさず結果だけ出す', async () => {
    await renderTab()
    await waitForRows()
    await act(async () => { openRowMenu('送料無料クーポン') })
    const item = [...document.body.querySelectorAll('button')].find(
      (element) => element.textContent === '自分で交換をテスト',
    )
    if (!(item instanceof HTMLButtonElement)) throw new Error('テストの項目がありません')
    await act(async () => { item.click() })
    await settle()
    expect(testedRewards.length).toBeGreaterThan(0)
    expect(container.textContent ?? '').toContain('この内容で交換できます。残高・在庫は動いていません。')
  })

  it('頭に CSV で書き出すが出て、表の中身が入る', async () => {
    await renderTab()
    await waitForRows()
    expect(headerNode).not.toBeNull()
    const blobs: Blob[] = []
    const restoreObjectUrl = globalThis.URL.createObjectURL
    globalThis.URL.createObjectURL = ((blob: Blob) => {
      blobs.push(blob)
      return 'blob:fake'
    }) as typeof globalThis.URL.createObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const headerRoot = createRoot(host)
      await act(async () => { headerRoot.render(<>{headerNode}</>) })
      const button = [...host.querySelectorAll('button')].find(
        (element) => (element.textContent ?? '').includes('CSV で書き出す'),
      )
      if (!(button instanceof HTMLButtonElement)) throw new Error('CSV のボタンがありません')
      expect(button.disabled).toBe(false)
      await act(async () => { button.click() })
      expect(blobs).toHaveLength(1)
      const text = await blobs[0].text()
      expect(text).toContain('"使い道","必要なマイル"')
      expect(text).toContain('送料無料クーポン')
      expect(click).toHaveBeenCalled()
      await act(async () => { headerRoot.unmount() })
      host.remove()
    } finally {
      globalThis.URL.createObjectURL = restoreObjectUrl
      click.mockRestore()
    }
  })

  it('複製は下書きで1つ作る（公開はしない）', async () => {
    await renderTab()
    await waitForRows()
    await act(async () => { openRowMenu('送料無料クーポン') })
    const item = [...document.body.querySelectorAll('button')].find(
      (element) => element.textContent === '複製',
    )
    if (!(item instanceof HTMLButtonElement)) throw new Error('複製の項目がありません')
    await act(async () => { item.click() })
    await settle()
    expect(createdRewards.length).toBe(1)
    const draft = createdRewards[0] as { draft: { name: string } }
    expect(draft.draft.name).toContain('のコピー')
  })
})
