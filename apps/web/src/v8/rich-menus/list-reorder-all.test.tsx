// @vitest-environment happy-dom
/*
 * 監査 WEB222：200件を超えるとき、並べ替えは全部の ID を読んでから送る（1ページ目だけで送らない）。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const fx = vi.hoisted(() => ({ listPage: vi.fn(), reorder: vi.fn() }))
const group = vi.hoisted(() => (i: number) => ({
  id: `g${i}`, accountId: 'account-a', name: `メニュー${i}`, chatBarText: 'メニュー', size: 'large', defaultPageId: null,
  isDefaultForAll: false, status: 'published', publishingAt: null, targetingCondition: { operator: 'AND', rules: [] }, targetingPriority: i,
  targetingEnabled: true, folderId: null, displayOrder: i, defaultOpen: false, thumbnailR2Key: null, updatedAt: '2026-09-20T00:00:00.000Z',
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: { id: 'account-a', name: 'A社' } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error { status = 500 },
  api: {
    richMenuGroups: {
      listPage: (...args: unknown[]) => fx.listPage(...args),
      reorderPriorities: (...args: unknown[]) => fx.reorder(...args),
      external: () => Promise.resolve({ success: true, data: { currentDefault: null, lineMenus: [] } }),
      tapStats: () => Promise.resolve({ success: true, data: { from: '', to: '', total: 0, byGroup: [], byArea: [] } }),
      deleteImpact: () => Promise.resolve({ success: false }),
      imageUrl: (key: string) => `/img/${key}`,
    },
    folders: { list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    staff: { me: () => Promise.resolve({ success: true, data: { id: 's', name: 'S', role: 'owner', email: null } }) },
  },
}))

import RichMenusListV8 from './list'
afterEach(cleanup)

test('250件のときは、2ページ目まで読んでから全部の順番を送る', async () => {
  const TOTAL = 250
  fx.listPage.mockImplementation(async (_account: string, params: { page: number; limit: number }) => {
    const start = (params.page - 1) * params.limit
    const items = Array.from({ length: Math.max(0, Math.min(params.limit, TOTAL - start)) }, (_, i) => group(start + i))
    return { success: true, data: { items, total: TOTAL, limit: params.limit, sort: [], facets: { total: TOTAL, published: TOTAL, targeting: TOTAL, folderCounts: {} } } }
  })
  fx.reorder.mockResolvedValue({ success: true })
  const view = render(<RichMenusListV8 />)
  await view.findByText('メニュー0')
  const handle = view.getByRole('button', { name: 'メニュー0を並び替え。上下キーで移動' })
  await act(async () => { fireEvent.keyDown(handle, { key: 'ArrowDown' }) })
  await waitFor(() => expect(fx.reorder).toHaveBeenCalled())
  const ids = fx.reorder.mock.calls[0][1] as string[]
  expect(ids).toHaveLength(TOTAL)
})
