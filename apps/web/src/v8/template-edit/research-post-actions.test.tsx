// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    broadcastMessageAssets: { ...actual.api.broadcastMessageAssets, create },
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
  } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-access', () => ({ useFeatureAccess: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [], notificationRules: [] }),
}))
import TemplateAssetEditor from './asset'

afterEach(() => { cleanup(); create.mockReset() })

it('共通LIFFへ渡す回答後処理の本文・種類・失敗時動作を保存し、未実装と誤案内しない', async () => {
  create.mockResolvedValue({ success: true, data: { id: 'research' } })
  await act(async () => { render(<TemplateAssetEditor kind="research" visual />) })
  const actions = screen.getByRole('heading', { name: '答え終わったときに行うこと' }).closest('section')!
  expect(screen.queryByText(/回答後の処理はまだ動きません/)).toBeNull()
  fireEvent.click(within(actions).getByRole('button', { name: /行うことを足す/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'テキスト送信' }))
  fireEvent.change(screen.getByPlaceholderText('送信する本文'), { target: { value: '回答ありがとうございます' } })
  fireEvent.click(screen.getByRole('button', { name: '1つ目の失敗したときの動き' }))
  fireEvent.click(screen.getByRole('button', { name: 'ここで止める' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
  expect(create).toHaveBeenCalledOnce()
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ lineAccountId: 'account-a', kind: 'research', payload: expect.objectContaining({
    startsAt: '2026-10-01T10:00', endsAt: '2026-10-15T23:59', targetTagId: null,
    questions: expect.arrayContaining([expect.objectContaining({ text: expect.any(String), required: true })]),
    answerActions: [{ actionType: 'send_message', config: { content: '回答ありがとうございます' }, onFailure: 'stop' }],
  }) }))
})
