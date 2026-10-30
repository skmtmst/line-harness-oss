// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AssetTemplatesList from './asset-list'
const fixture = vi.hoisted(() => ({ folders: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { broadcastMessageAssets: { folders: { list: fixture.folders } } } }))
vi.mock('@/components/broadcasts/broadcast-asset-manager', () => ({ default: ({ renderLayout }: { renderLayout: (state: unknown) => React.ReactNode }) => renderLayout({
  items: [{ id: 'published', name: '公開のクーポン', payload: {}, status: 'published', updatedAt: '2026-10-30', folderId: null },
    { id: 'draft', name: '下書きのクーポン', payload: {}, status: 'draft', updatedAt: '2026-10-30', folderId: null }],
  loadState: 'ready', reload: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), editor: null, deleteDialog: null,
}) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('公開状態の切り替えで行と件数を絞り、矢印で下書きへ移り、解除すると両方へ戻る', async () => {
  fixture.folders.mockResolvedValue({ success: true, data: [] })
  render(<AssetTemplatesList kind="coupon" accountId="a" tabs={null} canMutate={false} lockedReason="閲覧のみです" onChanged={vi.fn()} />)
  await waitFor(() => expect(fixture.folders).toHaveBeenCalled())
  const group = screen.getByRole('group', { name: '公開の状態' })
  const published = within(group).getByRole('button', { name: '公開中' })
  fireEvent.click(published)
  expect(screen.getByText('公開のクーポン')).toBeTruthy()
  expect(screen.queryByText('下書きのクーポン')).toBeNull()
  fireEvent.keyDown(published, { key: 'ArrowRight' })
  expect(screen.queryByText('公開のクーポン')).toBeNull()
  expect(screen.getByText('下書きのクーポン')).toBeTruthy()
  expect(within(group).getByRole('button', { name: '下書き' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(within(group).getByRole('button', { name: 'すべて' }))
  expect(screen.getByText('公開のクーポン')).toBeTruthy()
  expect(screen.getByText('下書きのクーポン')).toBeTruthy()
})
