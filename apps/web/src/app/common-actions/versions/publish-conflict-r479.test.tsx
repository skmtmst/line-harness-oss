// @vitest-environment happy-dom
/*
 * 監査 R479: 版画面で公開が 409 reference_updated で止まったあと、
 * 自動の load() が setError('') で競合理由を消していた。
 * 最新版を読み直しても理由と次の操作が残ることを、本物の React で確かめる。
 *
 * 成功時・別の失敗・再試行時の表示もここで見る。
 * `.test.tsx` は `apps/web/vitest.config.ts` の include に入る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({
  /** 公開の結果。'conflict' は 409 reference_updated、'revision' は 409 の別の競合。 */
  publishResult: 'conflict' as 'ok' | 'conflict' | 'revision',
  getCount: 0,
  publishCount: 0,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const detail = () => ({
    id: 'action-1',
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
    bindings: [],
  })
  const summary = {
    id: 'action-1', name: 'テストアクション', description: null, status: 'draft' as const,
    draftVersion: 2, publishedVersion: 1, actionCount: 1, bindingCount: 0,
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
        list: async () => ({ success: true, data: [summary] }),
        publish: async () => {
          net.publishCount += 1
          if (net.publishResult === 'ok') {
            return { success: true, data: { versionId: 'v-draft', versionNumber: 2 } }
          }
          if (net.publishResult === 'revision') {
            throw new actual.ApiError(
              409,
              '公開前に下書きが更新されました。差分を確認し直してください',
              'draft_revision_conflict',
            )
          }
          throw new actual.ApiError(
            409,
            '参照先「紹介クーポン」に新しい版があります（v3→v4）。編集画面で内容を確認して保存し直してください',
            'reference_updated',
          )
        },
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=action-1'),
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

function findButton(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((node) => (node.textContent ?? '').includes(text)) as HTMLButtonElement | undefined
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null
}

beforeEach(() => {
  net.getCount = 0
  net.publishCount = 0
  net.publishResult = 'conflict'
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

async function renderAndPublish() {
  await act(async () => {
    root.render(<VersionsPage />)
  })
  await flush()
  const publish = findButton('この版を公開する')
  expect(publish, '公開ボタンがある').toBeTruthy()
  await act(async () => {
    publish!.click()
  })
  await flush()
}

describe('公開が 409 で止まったときの知らせ（監査 R479）', () => {
  it('reference_updated でも読み直しのあと理由と次の操作が残る', async () => {
    await renderAndPublish()
    expect(net.publishCount).toBe(1)
    // 最新版を読み直している（初回＋失敗後の再取得）。
    expect(net.getCount).toBeGreaterThanOrEqual(2)
    // 理由（参照先と版の前後）と次の操作（保存し直す）が残る。
    expect(container.textContent).toContain('紹介クーポン')
    expect(container.textContent).toContain('保存し直してください')
    expect(alertText()).toContain('紹介クーポン')
    // 再試行の口も残る（操作中ではないので押せる）。
    const retry = findButton('この版を公開する')
    expect(retry, '再試行のボタンがある').toBeTruthy()
    expect(retry!.disabled).toBe(false)
  })

  it('別の失敗（draft_revision_conflict）でも理由が残る', async () => {
    net.publishResult = 'revision'
    await renderAndPublish()
    expect(net.publishCount).toBe(1)
    expect(net.getCount).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('差分を確認し直してください')
    expect(alertText()).toContain('差分を確認し直してください')
  })

  it('成功時は知らせを出さない', async () => {
    net.publishResult = 'ok'
    await renderAndPublish()
    expect(net.publishCount).toBe(1)
    expect(alertText()).toBeNull()
    expect(container.textContent).not.toContain('保存し直してください')
  })

  it('競合のあと再試行が通れば知らせが消える', async () => {
    await renderAndPublish()
    expect(alertText()).toContain('紹介クーポン')
    net.publishResult = 'ok'
    await act(async () => {
      findButton('この版を公開する')!.click()
    })
    await flush()
    expect(net.publishCount).toBe(2)
    expect(alertText()).toBeNull()
  })
})
