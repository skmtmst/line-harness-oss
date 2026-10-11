// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichMenuDetailV8 from '@/v8/rich-menu-edit/detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } }) },
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        get: async () => ({ success: true, data: {
          id: 'g1', accountId: 'account-a', name: '通常メニュー（会員向け）',
          status: 'published', isDefaultForAll: true, targetingEnabled: false,
        } }),
        publishProgress: async () => ({ success: true, data: { steps: [], message: null, run: { status: 'done' } } }),
        publishRuns: async () => ({ success: true, data: { runs: [] } }),
        previewTargets: async () => ({ success: true, data: null }),
        tapStats: async () => ({ success: true, data: { byArea: [] } }),
        reconcile: async () => ({ success: true, data: { diffs: [] } }),
      },
    },
  }
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme })

async function renderDetail() {
  await act(async () => { root.render(<RichMenuDetailV8 groupId="g1" />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('現役の公開済み詳細と旧設定の見張り', () => {
  it('現在の詳細に公開中の状態と出す相手を出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    await renderDetail()
    expect(host.querySelector('[data-design-node="hKr8f"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="いまの状態"]')?.textContent).toContain('公開中')
    expect(host.querySelector('[aria-label="いまの状態"]')?.textContent).toContain('すべての友だち')
  })
  it('旧設定が残っていても現在の詳細だけを出す', async () => {
    document.documentElement.dataset.theme = 'v7'
    await renderDetail()
    expect(host.querySelector('[data-design-node="hKr8f"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="UMiJ9"]')).toBeNull()
    expect(host.querySelector('[aria-label="いまの状態"]')).not.toBeNull()
  })
})
