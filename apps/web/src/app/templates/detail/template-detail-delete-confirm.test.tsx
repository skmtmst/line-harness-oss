// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TemplateDetail from '@/v8/template-detail/detail'

const m = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn(), push: vi.fn() }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { templates: { get: m.get, delete: m.remove, versions: async () => ({ success: true, data: [] }), list: async () => ({ success: true, data: [] }) },
    folders: { list: async () => ({ success: true, data: [] }) } },
}))
vi.mock('@/lib/use-feature-access', () => ({ useFeatureAccess: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useSearchParams: () => new URLSearchParams('id=tpl-1'), useRouter: () => ({ push: m.push, replace: vi.fn(), prefetch: vi.fn() }),
}))
const template = {
  id: 'tpl-1', name: '秋の案内', category: 'general', messageType: 'text', messageContent: '本文', folderId: null,
  question: null, questionStatus: 'draft', usedBy: { autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [], broadcasts: [] },
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z', hasDraft: false,
  publishedVersion: 3, publishedAt: '2026-09-10T00:00:00Z', draftRevision: 0,
}
beforeEach(() => {
  vi.clearAllMocks()
  m.get.mockResolvedValue({ success: true, data: template })
  m.remove.mockResolvedValue({ success: true, data: null })
})
afterEach(cleanup)
async function openDelete() {
  render(<TemplateDetail />)
  await screen.findByRole('heading', { name: '使っている所' })
  fireEvent.click(screen.getByRole('button', { name: 'そのほかの操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
}
it('対象と注意を確認してから削除し、キャンセルでは送らない', async () => {
  await openDelete()
  expect(screen.getByRole('alertdialog').textContent).toContain('秋の案内')
  expect(screen.getByRole('alert').textContent).toContain('元に戻せません')
  expect(m.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(m.remove).not.toHaveBeenCalled()
})
it('削除中は連打とEscを止め、成功したときだけ一覧へ戻る', async () => {
  let finish!: (value: unknown) => void
  m.remove.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await openDelete()
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  fireEvent.click(screen.getByRole('button', { name: '処理中…' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(m.remove).toHaveBeenCalledExactlyOnceWith('tpl-1')
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  expect(m.push).not.toHaveBeenCalled()
  await act(async () => finish({ success: true }))
  await waitFor(() => expect(m.push).toHaveBeenCalledWith('/templates'))
})
it('失敗は窓に残し、同じ対象で再試行できる', async () => {
  m.remove.mockResolvedValueOnce({ success: false, error: 'internal detail' })
  await openDelete()
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  await screen.findByText('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
  expect(screen.queryByText('internal detail')).toBeNull()
  expect(m.push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  await waitFor(() => expect(m.push).toHaveBeenCalledWith('/templates'))
  expect(m.remove).toHaveBeenCalledTimes(2)
})
