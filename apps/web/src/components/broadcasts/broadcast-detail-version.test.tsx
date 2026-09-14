// @vitest-environment happy-dom
/*
 * 一斉配信詳細の2つの版付き保存を本物の React で押して確かめる(#772)。
 * 見る筋書き:
 *   1. セグメント条件の適用と計測切替が、今の版を付けて送り、成功時は再読込する。
 *   2. 409時は「別の画面で更新されたため読み直しました」と案内して再読込し、
 *      古い入力を送り直さない（更新口は1回だけ）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        get: getApi,
        update: updateApi,
        previewCount: async () => ({ success: true, data: { count: 0 } }),
      },
      // テスト送信欄が載せる宛先読み。今回の対象外のため空で抑える。
      accountSettings: {
        ...actual.api.accountSettings,
        getTestRecipients: async () => ({ success: true, data: [] }),
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/bc-1',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: { id: 'acc-1', name: '本店' }, accounts: [] }),
}))

import { ApiError } from '@/lib/api'
import BroadcastDetail from './broadcast-detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function broadcast() {
  return {
    id: 'bc-1',
    title: '元の題',
    messageType: 'text',
    messageContent: '本文',
    messageBubbles: null,
    targetType: 'all',
    targetTagId: null,
    segmentConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
    status: 'draft',
    scheduledAt: null,
    sentAt: null,
    trackLinks: true,
    folderId: null,
    measureOpens: false,
    stealthSpreadMinutes: 0,
    lineAccountId: 'acc-1',
    version: 5,
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderDetail() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastDetail broadcastId="bc-1" />)
  })
  await flush()
}

function unmount() {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)
}

describe('一斉配信詳細の版付き保存(#772)', () => {
  it('セグメント条件の適用が今の版を付けて送る', async () => {
    getApi.mockResolvedValue({ success: true, data: broadcast() })
    updateApi.mockResolvedValue({ success: true, data: broadcast() })
    await renderDetail()
    try {
      await act(async () => {
        buttonByText('セグメント条件を編集')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()
      await act(async () => {
        buttonByText('適用')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()

      expect(updateApi).toHaveBeenCalledTimes(1)
      expect(updateApi.mock.calls[0][1]).toMatchObject({ expectedVersion: 5 })
      expect(updateApi.mock.calls[0][1]).toHaveProperty('segmentConditions')
      // 成功時は再読込する。
      expect(getApi.mock.calls.length).toBeGreaterThan(1)
    } finally {
      unmount()
    }
  })

  it('計測切替が今の版を付けて送る', async () => {
    getApi.mockResolvedValue({ success: true, data: broadcast() })
    updateApi.mockResolvedValue({ success: true, data: broadcast() })
    await renderDetail()
    try {
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      expect(checkbox).not.toBeNull()
      await act(async () => {
        checkbox!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()

      expect(updateApi).toHaveBeenCalledTimes(1)
      expect(updateApi.mock.calls[0]).toEqual(['bc-1', { trackLinks: false, expectedVersion: 5 }])
    } finally {
      unmount()
    }
  })

  it('409時は案内して再読込し、古い入力を送り直さない', async () => {
    getApi.mockResolvedValue({ success: true, data: broadcast() })
    updateApi.mockRejectedValueOnce(new ApiError(409, '別の画面で下書きが更新されました', 'VERSION_CONFLICT'))
    await renderDetail()
    try {
      const getCallsBefore = getApi.mock.calls.length
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      await act(async () => {
        checkbox!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await flush()

      expect(container.textContent).toContain('別の画面で更新されたため読み直しました')
      expect(getApi.mock.calls.length).toBeGreaterThan(getCallsBefore)
      expect(updateApi).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})
