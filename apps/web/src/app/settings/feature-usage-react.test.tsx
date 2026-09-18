// @vitest-environment happy-dom
/*
 * N-448: 全任意機能の利用状況バッジを実際に描画したページで確認する。
 * - 切り替えられる全行へ、共有カタログIDで照合した利用状況バッジを出す
 * - 計測できない機能は 0 や無表示にせず「未計測＋理由」を出す
 * - 集計失敗の機能は「取得失敗＋読み直す」を出す
 * - 利用状況の応答が遅れても、設定の切替は先に触れる（遅延応答）
 * - 利用状況の取得自体が失敗しても、無表示にせず理由とやり直しを出す
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' }))
const network = vi.hoisted(() => ({
  usageResponse: null as unknown,
  usageFails: false,
  usageRequests: [] as string[],
  deferredUsage: false,
  resolveUsage: null as null | (() => void),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

const { default: SettingsPage } = await import('./page')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root
let mounted = false

const metric = (value: number | string | null, state = 'available', reason: string | null = null) =>
  ({ value, state, reason })

function featureUsage(featureId: string, patch: Record<string, unknown> = {}) {
  return {
    featureId,
    activityUnit: '配信',
    activityBasis: 'last90days',
    activity: metric(0),
    lastUsedAt: metric(null),
    ...patch,
  }
}

/** 共有カタログの全機能ぶんの利用状況。種類ごとの見え方を混ぜる。 */
function usageBody() {
  return {
    success: true,
    data: {
      data: {
        categories: [],
        features: [
          featureUsage('broadcasts', {
            activity: metric(7),
            lastUsedAt: metric('2026-08-20T00:00:00.000Z'),
          }),
          featureUsage('analytics', {
            activityUnit: null,
            activityBasis: null,
            activity: metric(null, 'unavailable', '画面の閲覧は計測していません'),
            lastUsedAt: metric(null, 'unavailable', '画面の閲覧は計測していません'),
          }),
          featureUsage('forms', {
            activity: metric(null, 'failed', '利用状況の集計に失敗しました'),
            lastUsedAt: metric(null, 'failed', '利用状況の集計に失敗しました'),
          }),
          featureUsage('inflow_tracking', {
            activityUnit: 'クリック',
            activity: metric(0),
            lastUsedAt: metric('2026-03-05T00:00:00.000Z'),
          }),
          featureUsage('support_marks', {
            activityUnit: 'マーク中の友だち',
            activityBasis: 'current',
            activity: metric(3),
            lastUsedAt: metric(null, 'unavailable', 'マークの付け替え時刻は記録していません'),
          }),
        ],
      },
    },
  }
}

function featureResponse() {
  return {
    success: true,
    data: {
      features: { scenarios: true, broadcasts: true, templates: true, forms: true },
      sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3,
    },
  }
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  network.usageResponse = usageBody()
  network.usageFails = false
  network.usageRequests = []
  network.deferredUsage = false
  network.resolveUsage = null
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/api/settings/features')) return response(featureResponse())
    if (path.includes('/api/analytics/usage')) {
      network.usageRequests.push(path)
      if (network.deferredUsage) {
        await new Promise<void>((resolve) => { network.resolveUsage = resolve })
      }
      return network.usageFails
        ? response({ success: false, error: 'unavailable' }, 500)
        : response(network.usageResponse)
    }
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<SettingsPage />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

/** 切り替えられる機能の行（必須行・スイッチを持たない行は除く）。 */
function toggleableRows(): HTMLLIElement[] {
  return [...host.querySelectorAll<HTMLLIElement>('li')].filter((row) => {
    const toggle = row.querySelector<HTMLButtonElement>('[role="switch"]')
    return Boolean(toggle) && !toggle.disabled
  })
}

function rowText(row: Element): string {
  return row.textContent ?? ''
}

describe('N-448 全任意機能の利用状況バッジ', () => {
  it('切り替えられる全行へ、回数・最終利用・未計測理由のどれかを出す', async () => {
    await render()
    await act(settle)
    const rows = toggleableRows()
    expect(rows.length).toBeGreaterThan(0)
    // 応答に無い機能はバッジが付かない。行が出るのは応答に含まれる
    // 4機能ぶんだけ（support_marks はメニューに行を持たず画面に出ない）。
    const withBadge = rows.filter((row) =>
      /90日で|最終利用|未計測|取得失敗/.test(rowText(row)))
    expect(withBadge).toHaveLength(4)

    // 直近90日の回数。
    const broadcasts = rows.find((row) => rowText(row).includes('一斉配信'))
    expect(broadcasts && rowText(broadcasts)).toContain('90日で 7配信')
    // 90日の利用は無いが過去の最終利用はある。
    const inflow = rows.find((row) => rowText(row).includes('流入と計測'))
    expect(inflow && rowText(inflow)).toContain('最終利用 2026/03/05')
    // 計測できない機能は 0 にせず未計測＋理由。
    const analytics = rows.find((row) => rowText(row).includes('分析'))
    expect(analytics && rowText(analytics)).toContain('未計測')
    expect(analytics && rowText(analytics)).toContain('画面の閲覧は計測していません')
    expect(analytics && rowText(analytics)).not.toContain('90日で 0')
    // 集計に失敗した機能は取得失敗＋読み直し。
    const forms = rows.find((row) => rowText(row).includes('フォーム'))
    expect(forms && rowText(forms)).toContain('取得失敗')
    expect(forms && rowText(forms)).toContain('読み直す')
  })

  it('利用状況の応答が遅れても、設定の切替は先に触れる', async () => {
    network.deferredUsage = true
    await render()
    await act(settle)
    // 利用状況はまだ届いていないが、設定は出て切替が触れる。
    const rows = toggleableRows()
    expect(rows.length).toBeGreaterThan(0)
    const toggle = rows[0].querySelector<HTMLButtonElement>('[role="switch"]')!
    const before = toggle.getAttribute('aria-checked')
    await act(async () => { toggle.click(); await Promise.resolve() })
    expect(toggle.getAttribute('aria-checked')).not.toBe(before)

    // 後から届いたらバッジが足される。
    await act(async () => {
      network.resolveUsage?.()
      await settle()
    })
    expect(host.textContent).toContain('90日で 7配信')
  })

  it('利用状況の取得自体が失敗しても無表示にせず、読み直しで取り直せる', async () => {
    network.usageFails = true
    await render()
    await act(settle)
    expect(host.textContent).toContain('機能の利用状況を読めませんでした')

    network.usageFails = false
    const retry = [...host.querySelectorAll('button')]
      .find((item) => item.textContent?.trim() === '利用状況を読み直す')
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click(); await settle() })
    expect(network.usageRequests.length).toBeGreaterThanOrEqual(2)
    expect(host.textContent).toContain('90日で 7配信')
    expect(host.textContent).not.toContain('機能の利用状況を読めませんでした')
  })
})
