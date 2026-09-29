// @vitest-environment happy-dom
/*
 * 監査 R586: 月次集計用の一覧 GET だけが 503 でも、版の詳細
 * （版・利用先・版履歴）は読めること。月次件数だけ未取得と明示し、
 * そこだけ再試行できること。本物の React で確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  listMode: 'ok' as 'ok' | 'failing' | 'recovered',
  listCount: 0,
  getCount: 0,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const detail = () => ({
    id: 'ca-1',
    name: 'テストアクション',
    description: null,
    status: 'draft' as const,
    currentDraftVersionId: 'v-draft',
    currentPublishedVersionId: 'v1',
    versions: [
      {
        id: 'v-draft', versionNumber: 2, status: 'draft' as const,
        actions: [{ id: 'a1', type: 'send_message' as const, params: {}, onFailure: 'stop' as const }],
        draftRevision: 3, createdBy: '担当', createdAt: '2026-09-29T00:00:00.000Z', publishedAt: null,
      },
      {
        id: 'v1', versionNumber: 1, status: 'published' as const, actions: [],
        draftRevision: 1, createdBy: '担当', createdAt: '2026-09-28T00:00:00.000Z',
        publishedAt: '2026-09-28T00:00:00.000Z',
      },
    ],
    bindings: [
      {
        id: 'b1', consumerType: 'form', consumerId: 'form-1', consumerPath: '申込フォーム',
        versionId: 'v1', versionNumber: 1, hasNewerVersion: false,
        runningCount: 2, waitingCount: 1, olderRunningCount: 0, olderWaitingCount: 0,
      },
    ],
  })
  const summary = {
    id: 'ca-1', name: 'テストアクション', description: null, status: 'draft' as const,
    draftVersion: 2, publishedVersion: 1, actionCount: 1, bindingCount: 1,
    oldVersionBindingCount: 0, executionCountThisMonth: 10, failureCountThisMonth: 1,
    lastRunAt: null, updatedAt: '2026-09-29T00:00:00.000Z',
  }
  return {
    ...actual,
    api: {
      ...actual.api,
      commonActions: {
        ...actual.api.commonActions,
        get: async () => {
          net.getCount += 1
          return { success: true, data: detail() }
        },
        list: async () => {
          net.listCount += 1
          if (net.listMode === 'failing') {
            throw new actual.ApiError(503, 'API error: 503')
          }
          return { success: true, data: [summary] }
        },
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=ca-1'),
  usePathname: () => '/common-actions/versions',
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/components/automations/use-common-action-permission', () => ({
  useCanManageCommonActions: () => true,
}))
vi.mock('@/lib/use-manual-href', () => ({ useManualHref: () => null }))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageChrome: () => ({ title: null }),
}))

const { default: VersionsPage } = await import('./page')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function retryMonthlyButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((node) => (node.textContent ?? '').includes('月次件数をもう一度読み込む')) as HTMLButtonElement | undefined
}

beforeEach(() => {
  net.listMode = 'failing'
  net.listCount = 0
  net.getCount = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('月次集計だけ失敗しても版詳細は読める（監査 R586）', () => {
  it('詳細200・一覧503でも版・利用先・版履歴が読める', async () => {
    await act(async () => {
      root.render(<VersionsPage />)
    })
    await flush()

    // 詳細そのものの失敗画面（全体の読み込み失敗）にはしない。
    expect(container.textContent).not.toContain('版と利用先を読み込めませんでした')
    // 版・利用先・版履歴が読める。
    expect(container.textContent).toContain('テストアクション')
    expect(container.textContent).toContain('どこから呼ばれているか')
    expect(container.textContent).toContain('版の履歴')
    expect(container.textContent).toContain('申込フォーム')
  })

  it('月次件数だけ未取得と明示し、そこだけ再試行できる', async () => {
    await act(async () => {
      root.render(<VersionsPage />)
    })
    await flush()

    // 月次件数だけ未取得と分かる。
    expect(container.textContent).toContain('月次件数を取得できませんでした')
    const retry = retryMonthlyButton()
    expect(retry, '月次件数だけの再試行ボタンがある').toBeTruthy()

    // 再試行前は詳細の取得を増やさない（そこだけ再試行）。
    const getBeforeRetry = net.getCount
    const listBeforeRetry = net.listCount
    net.listMode = 'recovered'
    await act(async () => {
      retry!.click()
    })
    await flush()

    expect(net.listCount).toBeGreaterThan(listBeforeRetry)
    expect(net.getCount).toBe(getBeforeRetry)
    // 復旧すれば集計値が更新される。
    expect(container.textContent).toContain('10')
    expect(container.textContent).not.toContain('月次件数を取得できませんでした')
  })

  it('詳細そのものの失敗とは別の表示になる', async () => {
    await act(async () => {
      root.render(<VersionsPage />)
    })
    await flush()

    // 一覧だけの失敗では、詳細失敗の全体画面を出さない。
    // （詳細失敗時は「版と利用先を読み込めませんでした」になる。
    // この試験では一覧だけが失敗なので出てはいけない。）
    expect(container.textContent).not.toContain('版と利用先を読み込めませんでした')
    // 代わりに月次件数の未取得が出る。
    expect(container.textContent).toContain('月次件数を取得できませんでした')
  })
})
