// @vitest-environment happy-dom
/*
 * ★V8-B コラムを書く（yRDwW）の骨格。
 * 下書きの決めごとは v7（column-form）と同じ。節の並びと保存の口を見る。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tagsList = vi.hoisted(() => vi.fn())
const columnAudience = vi.hoisted(() => vi.fn())
const createColumn = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
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

import ColumnNewV8 from './column-new-v8'

afterEach(cleanup)

describe('コラムを書く V8', () => {
  it('yRDwW の印で節と保存を出す', () => {
    tagsList.mockResolvedValue({ success: true, data: [] })
    columnAudience.mockResolvedValue({ success: true, data: { count: 0 } })
    const { container } = render(<ColumnNewV8 />)
    expect(container.querySelector('[data-design-node="yRDwW"]')).toBeTruthy()
    for (const title of ['題名と分類', '記事のリンク', 'いつ・だれに出しますか', '読んだ人にすること']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
    expect(screen.getByText('LINE での見え方')).toBeTruthy()
    expect(screen.getByText('この画面でできないこと')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下書きを保存' })).toBeTruthy()
  })
})
