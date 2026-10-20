// @vitest-environment happy-dom
/*
 * ★V8-B コラムを書くの骨格。
 * 下書きの決めごとは 管理画面（column-form）と同じ。節の並びと保存の口を見る。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const tagsList = vi.hoisted(() => vi.fn())
const columnAudience = vi.hoisted(() => vi.fn())
const createColumn = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status?: number; code?: string },
  api: { tags: { list: tagsList }, nenCampaigns: { columnAudience, createColumn } },
}))

import ColumnNewV8 from '@/v8/nen-campaigns/column-new'

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => ({ ...(await importOriginal()), useStaffRole: () => role.value }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

afterEach(() => { cleanup(); role.value = 'owner'; createColumn.mockClear(); delete document.documentElement.dataset.theme })

describe('コラムを書く V8', () => {
  it('yRDwW の印で節と保存を出す', () => {
    document.documentElement.dataset.theme = 'v8'
    tagsList.mockResolvedValue({ success: true, data: [] })
    columnAudience.mockResolvedValue({ success: true, data: { count: 0 } })
    const { container } = render(<ColumnNewV8 />)
    expect(container.querySelector('[data-design-node="yRDwW"]')).toBeTruthy()
    for (const title of ['題名と分類', '記事のリンク', 'いつ・だれに出しますか', '読んだ人にすること']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
    expect(screen.getByText('LINEでの見え方')).toBeTruthy()
    expect(screen.getByText('この画面でできないこと')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下書きを保存' })).toBeTruthy()
  })
})

for (const value of [null, 'staff', 'viewer']) it(`役割${value}ではコラム作成を隠し一覧へ戻れる`, () => {
  role.value = value
  render(<ColumnNewV8 />)
  expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '下書きを保存' })).toBeNull()
  expect(screen.queryByLabelText('題名')).toBeNull()
  expect(createColumn).not.toHaveBeenCalled()
})
