// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { flushListUrlState } from '@/components/shared/list-url-state'

const fixture = vi.hoisted(() => ({ accountId: 'account-a', role: 'owner', get: vi.fn(), publish: vi.fn(), list: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string) => role === 'owner' || role === 'admin' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId, accounts: [], loading: false }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error { status = 0 },
  api: {
    templates: { list: fixture.list, get: fixture.get, publish: fixture.publish },
    folders: { list: async () => ({ success: true, data: [] }) },
    broadcastMessageAssets: { counts: async () => ({ success: true, data: {} }) },
  },
}))
import TemplatesList from './list'

const template = {
  id: 'template-1', accountId: 'account-a', name: '予約のお礼', category: 'general', messageType: 'text',
  messageContent: 'ご予約ありがとうございます。', question: null, questionStatus: 'published', folderId: null,
  hasDraft: true, publishedVersion: 2, draftRevision: 7, publishedAt: '2026-10-01T00:00:00Z',
  usageCount: 1, monthlySendCount: 10, totalSendCount: 10, tapCount: 0,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  usedBy: { autoReplies: [{ id: 'reply-1', keyword: '予約', lineAccountId: 'account-a', templateVersion: null }], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [] },
}
beforeEach(() => {
  flushListUrlState()
  window.history.replaceState(null, '', '/templates')
  document.documentElement.dataset.theme = 'v8'
  fixture.accountId = 'account-a'
  fixture.role = 'owner'
  fixture.get.mockReset().mockResolvedValue({ success: true, data: template })
  fixture.publish.mockReset().mockResolvedValue({ success: true, data: {} })
  fixture.list.mockReset().mockResolvedValue({ success: true, data: [template] })
})
afterEach(() => { cleanup(); flushListUrlState() })

async function openPanel() {
  const view = render(<TemplatesList />)
  const row = (await within(await screen.findByRole('table')).findByText('予約のお礼')).closest('tr')!
  fireEvent.keyDown(row, { key: 'Enter' })
  return { view, panel: await screen.findByRole('dialog') }
}

it('表示した版と下書きの番号で公開し、二度押しは1回の送信になる', async () => {
  let finish!: (value: unknown) => void
  fixture.publish.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { panel } = await openPanel()
  const button = await within(panel).findByRole('button', { name: '公開する' })
  await act(async () => { fireEvent.click(button); fireEvent.click(button) })
  expect(fixture.publish).toHaveBeenCalledTimes(1)
  expect(fixture.publish).toHaveBeenCalledWith('template-1', { expectedVersion: 2, expectedDraftRevision: 7 })
  fixture.get.mockResolvedValue({ success: true, data: { ...template, hasDraft: false, publishedVersion: 3 } })
  await act(async () => { finish({ success: true, data: {} }) })
  expect(within(panel).queryByRole('button', { name: '公開する' })).toBeNull()
  expect(fixture.list).toHaveBeenCalledTimes(2)
})

it('409では最新の状態を読み直し、失敗を示して勝手に再公開しない', async () => {
  const { ApiError } = await import('@/lib/api')
  fixture.publish.mockRejectedValue(Object.assign(new ApiError('conflict'), { status: 409 }))
  const { panel } = await openPanel()
  fireEvent.click(await within(panel).findByRole('button', { name: '公開する' }))
  expect(await within(panel).findByText(/他の人が先に更新したため/)).toBeTruthy()
  await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledTimes(2))
  expect(fixture.publish).toHaveBeenCalledTimes(1)
  expect(fixture.list).toHaveBeenCalledTimes(1)
})

it('閲覧だけの人も使用先を開けるが、公開するボタンは出ない', async () => {
  fixture.role = 'staff'
  const { panel } = await openPanel()
  const usage = await within(panel).findByText('予約')
  expect(usage.closest('li')?.querySelector('a')?.getAttribute('href')).toBe('/auto-replies/edit?id=reply-1')
  expect(within(panel).queryByRole('button', { name: '公開する' })).toBeNull()
  expect(fixture.publish).not.toHaveBeenCalled()
})

it('別アカウントの詳細を受け取っても公開の操作を出さない', async () => {
  fixture.get.mockResolvedValue({ success: true, data: { ...template, accountId: 'account-b' } })
  const { panel } = await openPanel()
  expect(await within(panel).findByText(/使用先と公開前の状態を確認できません/)).toBeTruthy()
  expect(within(panel).queryByRole('button', { name: '公開する' })).toBeNull()
  expect(fixture.publish).not.toHaveBeenCalled()
})

it('アカウントを替えたあとに届いた詳細は次のアカウントへ残さない', async () => {
  let finish!: (value: unknown) => void
  fixture.get.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { view } = await openPanel()
  fixture.accountId = 'account-b'
  fixture.list.mockResolvedValue({ success: true, data: [{ ...template, accountId: 'account-b' }] })
  await act(async () => { view.rerender(<TemplatesList />) })
  await act(async () => { finish({ success: true, data: template }) })
  expect(screen.queryByRole('button', { name: '公開する' })).toBeNull()
  expect(screen.queryByText('予約後フォロー')).toBeNull()
  expect(fixture.publish).not.toHaveBeenCalled()
})
