// @vitest-environment happy-dom
/*
 * N-198/N-204 (#796): 一覧画面を実マウントし、容量の絞り込みと案内の
 * 配線を確かめる。quota の state が80%以上なら案内と行動案が出て、
 * 行動案を押すと一覧取得に nearLimitOnly が載る。80%未満なら出ない。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MediaQuota } from '@/lib/api'

const fixture = vi.hoisted(() => ({
  quotaState: 'notice' as MediaQuota['state'],
  listCalls: [] as Array<{ accountId: string; params?: unknown }>,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-a', loading: false }),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number | undefined
    constructor(status?: number, message?: string) {
      super(message || 'API error')
      this.name = 'ApiError'
      this.status = status
    }
  }
  const quotaOf = (state: string) => ({
    usageBytes: 8_500_000_000,
    reservedBytes: 0,
    limitBytes: 10_000_000_000,
    remainingBytes: 1_500_000_000,
    usageRate: state === 'normal' ? 0.79 : 0.85,
    state,
  })
  return {
    ApiError,
    api: {
      featureSettings: {
        visibility: () => Promise.resolve({ success: true, data: { features: { media: true } } }),
      },
      media: {
        list: (accountId: string, params?: unknown) => {
          fixture.listCalls.push({ accountId, params })
          return Promise.resolve({
            success: true,
            data: {
              items: [
                {
                  id: 'm-big', lineAccountId: 'acc-a', folderId: null, kind: 'video',
                  filename: 'ookii.mp4', mimeType: 'video/mp4', sizeBytes: 500_000_000,
                  width: null, height: null, durationMs: null, url: 'https://x/m.mp4',
                  uploadedBy: null, createdAt: '2026-09-14T00:00:00+09:00', usageCount: 0,
                },
              ],
              total: 1, limit: 20, offset: 0,
            },
          })
        },
        quota: () => Promise.resolve({ success: true, data: quotaOf(fixture.quotaState) }),
        contentUrl: (id: string) => `https://x/${id}`,
      },
      folders: {
        list: () => Promise.resolve({ success: true, data: [] }),
      },
      staff: {
        me: () => Promise.resolve({ success: true, data: { role: 'owner' } }),
      },
    },
  }
})

import ContentsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
  fixture.listCalls.length = 0
  fixture.quotaState = 'notice'
})

describe('一覧画面の容量の絞り込みと案内（N-198/N-204・実マウント）', () => {
  test('80%以上なら案内が出て、行動案で絞り込みが載る', async () => {
    fixture.quotaState = 'notice'
    render(<ContentsPage />)
    expect(await screen.findByText(/80%以上を使っています/)).toBeTruthy()
    const before = fixture.listCalls.length
    expect(before).toBeGreaterThan(0)
    expect(fixture.listCalls[before - 1]?.params).not.toMatchObject({ nearLimitOnly: true })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '上限に近いものを見る' }))
    })
    await waitFor(() => {
      const last = fixture.listCalls[fixture.listCalls.length - 1]?.params as { nearLimitOnly?: boolean } | undefined
      expect(last?.nearLimitOnly).toBe(true)
    })
  })

  test('80%未満なら案内も行動案も出ない', async () => {
    fixture.quotaState = 'normal'
    render(<ContentsPage />)
    await waitFor(() => {
      expect(fixture.listCalls.length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/80%以上を使っています/)).toBeNull()
    expect(screen.queryByText(/上限に達しました/)).toBeNull()
    expect(screen.queryByRole('button', { name: '上限に近いものを見る' })).toBeNull()
  })
})
