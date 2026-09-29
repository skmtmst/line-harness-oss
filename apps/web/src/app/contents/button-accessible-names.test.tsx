// @vitest-environment happy-dom
/*
 * Issue #637（監査 D-3「無名ボタン」15番 /contents）の回帰固定。
 *
 * 監査で2件の無名ボタンが記録された。アイコンのみの操作
 * （プレビューを見る／プレビューを閉じる等）に aria-label を付け、
 * このテストで無名ボタンが戻らないことを固定する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'

import { buttonsWithoutAccessibleName } from '@/test-utils/accessible-name'

const MEDIA: MediaItem = {
  id: 'media-1',
  lineAccountId: 'account-a',
  folderId: null,
  kind: 'image',
  filename: '店舗の画像.png',
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 100,
  durationMs: null,
  url: 'https://example.test/a.png',
  uploadedBy: '管理者',
  createdAt: '2026-09-16T09:00:00+09:00',
  usageCount: 2,
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(readonly status?: number, message = 'API error') {
      super(message)
    }
  }
  return {
    ApiError,
    api: {
      featureSettings: {
        visibility: () => Promise.resolve({ success: true, data: { features: { media: true } } }),
      },
      staff: {
        me: () => Promise.resolve({ success: true, data: { role: 'owner' } }),
      },
      folders: {
        list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }),
      },
      media: {
        list: () =>
          Promise.resolve({
            success: true,
            data: { items: [MEDIA], total: 1, limit: 20, offset: 0 },
          }),
        quota: () =>
          Promise.resolve({
            success: true,
            data: { usageBytes: 1200, reservedBytes: 0, limitBytes: 10000, remainingBytes: 8800, usageRate: 0.12, state: 'normal' },
          }),
        detail: () => Promise.reject(new ApiError(404, 'Not found')),
        contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
      },
    },
  }
})

const { default: ContentsPage } = await import('./page')

let host: HTMLDivElement
let root: Root

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

beforeEach(() => {
  window.history.replaceState({}, '', '/contents')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  window.history.replaceState({}, '', '/contents')
  vi.unstubAllGlobals()
})

describe('Issue #637 /contents 全ボタンにアクセシブルな名前', () => {
  it('アイコンのみの操作を含め無名ボタンがない', async () => {
    await act(async () => {
      root.render(<ContentsPage />)
      await settle()
    })
    for (let index = 0; index < 20 && !host.textContent?.includes(MEDIA.filename); index += 1) {
      await act(async () => { await settle() })
    }
    expect(host.textContent).toContain(MEDIA.filename)

    const unnamed = buttonsWithoutAccessibleName(host)
    expect(
      unnamed.map((b) => b.outerHTML.slice(0, 160)),
      '無名ボタンが残っている',
    ).toEqual([])
  })
})
