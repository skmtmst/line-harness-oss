// @vitest-environment happy-dom
/*
 * 2026-10-03 点検：管理者確認（担当未割り当て）を開くと
 * `e is not iterable` で落ちていた。再発防止。
 *
 * 未割り当て口は配列で返す契約だが、配列でない応答が来ても
 * 一覧を空にして描く（`[...forms]` で落とさない）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FormSubmissionsListV8 from './list-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FORM_PAGE = {
  items: [
    {
      id: 'form-1', lineAccountId: 'visual-qa-account', name: '来店アンケート',
      description: '説明', folderId: null, fields: [], layout: { blocks: [] },
      onSubmitTagId: null, onSubmitScenarioId: null, onSubmitMessageType: null,
      onSubmitMessageContent: null, onSubmitWebhookUrl: null, onSubmitWebhookHeaders: null,
      onSubmitWebhookFailMessage: null, saveToMetadata: true, isActive: true,
      status: 'active', archivedAt: null, revision: 1, submitCount: 10,
      monthlySubmitCount: 5, monthlyOpenCount: 8, monthlyCompletionRate: 60,
      createdAt: '2026-08-21T03:00:00.000Z', updatedAt: '2026-08-21T03:00:00.000Z',
      lastSubmittedAt: '2026-08-21T03:00:00.000Z', usedByAccounts: [],
      accountScopeReviewRequired: false, destinationCount: 5,
      destinationSummary: { friendFieldCount: 3, tagCount: 2 },
    },
  ],
  total: 18, page: 1, limit: 20,
}

/* 試験ごとに差し替える未割り当て口の応答 */
let unassignedData: unknown = []
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: async (path: string) => {
      if (path.startsWith('/api/forms/unassigned')) return { success: true, data: unassignedData }
      if (path.startsWith('/api/forms?')) return { success: true, data: FORM_PAGE }
      throw new Error(`unexpected GET ${path}`)
    },
    api: {
      ...actual.api,
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
      listStats: { get: async () => ({ success: true, data: null }) },
    },
  }
})
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'visual-qa-account', loading: false }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/form-submissions',
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

let host: HTMLDivElement
let root: Root
const errors: unknown[] = []
let spy: ReturnType<typeof vi.spyOn> | null = null
const flush = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 25)) })
}
beforeEach(() => {
  unassignedData = []
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme
  spy?.mockRestore(); errors.length = 0
})

describe('管理者確認の切り替え', () => {
  it('配列でない応答でも落ちずに空の一覧を出す', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    expect(host.textContent).toContain('来店アンケート')
    /* 偽 API の修正前は既定のページ形が返り、ここで落ちていた */
    unassignedData = { items: [], total: 0, page: 1, limit: 20 }
    const toggle = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('管理者確認'))
    expect(toggle).toBeTruthy()
    await act(async () => { fireEvent.click(toggle!) })
    await flush()
    expect(errors.map(String).join('\n')).toBe('')
    expect(host.textContent).toContain('通常の一覧に戻る')
  })

  it('配列の応答では未割り当ての行を出す', async () => {
    unassignedData = FORM_PAGE.items
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    const toggle = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('管理者確認'))
    await act(async () => { fireEvent.click(toggle!) })
    await flush()
    expect(errors.map(String).join('\n')).toBe('')
    expect(host.textContent).toContain('来店アンケート')
  })
})
