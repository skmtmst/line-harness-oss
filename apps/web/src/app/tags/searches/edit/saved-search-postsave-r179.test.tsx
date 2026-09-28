// @vitest-environment happy-dom
/*
 * R179: 説明だけ変えて保存しても、人数プレビューは新しい版で数え直す。
 * 以前は保存前のクロージャの古い版で再計算して409になり、
 * 「人数を計算できませんでした」になっていた。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  revision: 5,
  previewRevisions: [] as Array<number | undefined>,
}))

const baseDetail = () => ({
  id: 's1',
  name: 'テスト検索',
  scope: 'friends' as const,
  conditions: { all: [{ kind: 'name', op: 'contains', value: 'QA' }], any: [] },
  createdBy: 'staff-1',
  lineAccountId: 'a1',
  isShared: false,
  displayOrder: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  revision: mockState.revision,
  matchCount: 0,
  usedIn: [],
  canDelete: true,
  accountScope: { type: 'line_account' as const, id: 'a1' },
  owner: { id: 'staff-1', isCurrentUser: true },
  match: {
    total: 0,
    byChannel: { line: 0, mail: 0 },
    calculatedAt: '2026-09-27T00:00:00.000Z',
  },
})

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    savedSearches: {
      detail: () => Promise.resolve({ success: true, data: baseDetail() }),
      list: () => Promise.resolve({
        success: true,
        items: [],
        summary: { total: 1, usedInBroadcasts: 0, zeroMatches: 1, callsThisMonth: 0 },
      }),
      update: () => {
        mockState.revision = 6
        return Promise.resolve({ success: true, data: baseDetail() })
      },
      preview: (_account: string, data: { revision?: number }) => {
        mockState.previewRevisions.push(data.revision)
        // 版が古ければサーバーは409相当の失敗を返す。
        if (data.revision !== 6) {
          return Promise.resolve({ success: false, error: 'ほかの担当者が先に変更しました' })
        }
        return Promise.resolve({
          success: true,
          data: { match: { total: 0, byChannel: { line: 0, mail: 0 }, calculatedAt: '2026-09-27T01:00:00.000Z' } },
        })
      },
      create: () => Promise.resolve({ success: false, error: '使わない' }),
      delete: () => Promise.resolve({ success: true, data: null }),
    },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    supportMarks: { list: () => Promise.resolve({ success: true, data: [] }) },
    scenarios: { list: () => Promise.resolve({ success: true, data: [] }) },
    friendFields: { list: () => Promise.resolve({ success: true, data: [] }) },
    forms: { list: () => Promise.resolve({ success: true, data: [] }) },
    operators: { list: () => Promise.resolve({ success: true, data: [] }) },
    featureSettings: {
      visibility: () => Promise.resolve({ success: true, data: { features: {} } }),
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('id=s1'),
  usePathname: () => '/tags/searches/edit',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready', features: { saved_searches: true }, enabled: () => true }),
}))

beforeEach(() => {
  mockState.revision = 5
  mockState.previewRevisions = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('R179 保存直後の人数プレビュー', () => {
  test('説明だけの保存後に新しい版で数え直し、人数と時刻を正常表示する', async () => {
    const { default: SavedSearchEditPage } = await import('./page')
    render(<SavedSearchEditPage />)
    const saveButton = await screen.findByRole('button', { name: '変更を保存' })

    // 説明だけ変える（条件は触らない）。
    const description = screen.getByLabelText('説明')
    await act(async () => {
      fireEvent.change(description, { target: { value: '用途メモ' } })
    })
    await act(async () => {
      fireEvent.click(saveButton)
    })

    // 再計算は保存応答の新しい版で呼ばれ、失敗にならない。
    expect(mockState.previewRevisions).toContain(6)
    expect(mockState.previewRevisions).not.toContain(5)
    expect(screen.queryByText('人数を計算できませんでした。条件を確かめて再計算してください。')).toBeNull()
  })
})
