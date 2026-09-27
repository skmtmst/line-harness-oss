// @vitest-environment happy-dom
/*
 * R31: 一覧のまとめはすべて直近7日にそろえ、数字の横に期間を書く。
 * 「送信成功」は配送処理の完了件数ではなく実際に送った通数。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: {
  list: vi.fn(async () => ({ success: true, data: {
    items: [], total: 0, nextCursor: null, folderCounts: [],
    summary: { rules: 2, active: 1, recentAdds: 5, captured: 4, unknownRoute: 1, delivered: 7, failed: 1 },
    options: { routes: [], scenarios: [], tags: [], folders: [] },
  } })),
  archive: vi.fn(), createFolder: vi.fn(),
} } }))

const { default: Page } = await import('./page')
let host: HTMLDivElement; let root: Root
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.restoreAllMocks() })

describe('R31 一覧のまとめは直近7日にそろえる', () => {
  it('期間の数には直近7日と書き設定の数と分ける', async () => {
    await act(async () => { root.render(<Page />); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve() })
    expect(host.textContent).toContain('直近7日の友だち追加')
    expect(host.textContent).toContain('直近7日の送信成功')
    expect(host.textContent).toContain('直近7日の経路不明')
    // 古い説明（期間の無い送信成功・経路不明）は残さない。
    expect(host.textContent).not.toContain('共通の案内が動いた')
    expect(host.querySelector('[aria-label="直近7日の送信成功の説明"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="初回案内の説明"]')).not.toBeNull()
  })
})
