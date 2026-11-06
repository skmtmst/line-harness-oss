// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'

const fixture = vi.hoisted(() => ({ role: 'owner' as string | null, snapshot: vi.fn(), connection: vi.fn(), review: vi.fn(), saveDraft: vi.fn(), publishReply: vi.fn(), generateDraft: vi.fn() }))
vi.mock('@/lib/staff-role', async original => ({ ...(await original<typeof import('@/lib/staff-role')>()), useStaffRole: () => fixture.role }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', setSelectedAccountId: vi.fn(), loading: false, accounts: [{ id: 'account-1', name: '合成店 LINE' }] }) }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), useSearchParams: () => new URLSearchParams(window.location.search), usePathname: () => window.location.pathname }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot } }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: fixture }))
import GoogleV8 from './google'

const path = '/restaurant-test/google?tab=reviews&view=draft&id=r1'
const draft = 'ご意見ありがとうございます。', edited = 'ご意見ありがとうございます。確認してご案内します。'
const store = { id: 'store-1', name: '合成店', timezone: 'Asia/Tokyo', status: 'active', line_account_id: 'account-1' }
beforeEach(() => {
  vi.clearAllMocks(); document.documentElement.dataset.theme = 'v8'; fixture.role = verifiedStaffRole('owner')
  window.history.replaceState(null, '', path)
  fixture.snapshot.mockResolvedValue({ data: { organization: { id: 'org-1', name: '合成組織' }, stores: [store] } })
  fixture.connection.mockResolvedValue({ success: true, store: { id: store.id, name: store.name, lineAccountId: 'account-1' }, connection: { status: 'connected', locationTitle: store.name }, candidates: [], summary: { unrepliedCount: 1, draftCount: 1, attentionCount: 0, newCount: 0, storedCount: 1, postsAttentionCount: 0, syncStale: false }, writeEnabled: false, oauthConfigured: true, aiAvailable: false, permissions: { canManageConnection: true, canPublishReply: true } })
  fixture.review.mockResolvedValue({ success: true, review: { id: 'r1', reviewName: 'r1', reviewerDisplayName: '合成の投稿者', starRating: 5, comment: 'ご案内ありがとうございました。', createTime: '2026-10-30T10:00:00+09:00', firstSeenAt: '2026-10-30T10:00:00+09:00', updateTime: null, replyStatus: 'draft', replyDraft: draft, replyDraftAiGenerated: false, replyDraftGeneratedAt: null, replyComment: null, replyUpdateTime: null, needsAttention: false } })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); window.history.replaceState(null, '', '/') })
async function openLeave() {
  render(<GoogleV8 />)
  const input = await screen.findByRole('textbox', { name: '返信文' }) as HTMLTextAreaElement
  await waitFor(() => expect(input.value).toBe(draft))
  fireEvent.change(input, { target: { value: edited } })
  fireEvent.click(screen.getByRole('tab', { name: 'パフォーマンス' }))
  const dialog = await screen.findByRole('dialog', { name: '保存していない変更があります' })
  expect(window.location.search).toContain('view=draft')
  return { input, dialog }
}
function noWrites() { expect(fixture.saveDraft).not.toHaveBeenCalled(); expect(fixture.publishReply).not.toHaveBeenCalled(); expect(fixture.generateDraft).not.toHaveBeenCalled() }

describe('口コミ返信の編集中の離脱確認', () => {
  it('説明と実在する2択がそろい、保存や送信を自動で始めない', async () => {
    const { dialog } = await openLeave()
    expect(dialog.textContent).toContain('このまま移ると、返信文の変更が消えます。')
    expect(dialog.textContent).not.toContain('下書き保存をしてから移るか')
    expect(within(dialog).getByRole('button', { name: '編集を続ける' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '保存して移る' })).toBeNull()
    await act(async () => {}); noWrites()
  })
  it.each(['編集を続ける', '閉じる'])('%sで窓を閉じると返信文と編集先を保持する', async label => {
    const { input, dialog } = await openLeave()
    fireEvent.click(within(dialog).getByRole('button', { name: label, exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(input.value).toBe(edited); expect(window.location.search).toContain('view=draft'); noWrites()
  })
  it('保存せずに移るを選んだ時だけ指定のタブへ移り、保存や送信を呼ばない', async () => {
    const { dialog } = await openLeave()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(window.location.search).toBe('?tab=performance'))
    expect(screen.queryByRole('dialog')).toBeNull(); noWrites()
  })
})
