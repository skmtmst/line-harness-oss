// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import type { GoogleConnectionData } from '@/lib/restaurant-google-api'

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), role: 'owner' as string }))
vi.mock('@/lib/api/helpers/gap3', () => ({ accountAiFeaturesApi: { get: mocks.get, save: mocks.save } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => mocks.role }))
vi.mock('@/components/step-up-prompt', () => ({
  isStepUpRequired: (error: unknown) => error instanceof ApiError && error.code === 'STEP_UP_REQUIRED',
  default: ({ request }: { request: { retry: (token: string) => Promise<void> } }) =>
    <button onClick={() => void request.retry('step-up-grant')}>本人確認を完了</button>,
}))

import SettingsBoard from './settings'

const setting = { feature: 'google_review' as const, enabled: false, version: 0, consentBy: null, consentAt: null, disclosureVersion: null }
const data = {
  store: { id: 'store', name: '対象店', lineAccountId: 'account' },
  connection: { status: 'connected', googleAccountEmail: null, connectedAt: null, locationTitle: '対象店', lastSyncedAt: null },
  permissions: { canManageConnection: true, canPublishReply: true },
  aiAvailable: true,
  reviewDraftAiEnabled: false,
} as GoogleConnectionData

afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.role = 'owner' })

it('口コミAIは同意と本人確認の後だけ有効にする', async () => {
  mocks.get.mockResolvedValue({ success: true, data: { items: [setting], disclosure: '外部AIへの送信に同意します', disclosureVersion: '2026-10-16' } })
  mocks.save.mockRejectedValueOnce(new ApiError(401, '本人確認が必要です', 'STEP_UP_REQUIRED'))
    .mockResolvedValueOnce({ success: true, data: { ...setting, enabled: true, version: 1 } })
  const onChanged = vi.fn()
  render(<SettingsBoard accountId="account" data={data} onChanged={onChanged} />)
  const button = await screen.findByRole('button', { name: 'AI下書きを利用開始する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '外部AIへの送信に同意します' }))
  fireEvent.click(button)
  expect(await screen.findByRole('button', { name: '本人確認を完了' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '本人確認を完了' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(mocks.save).toHaveBeenNthCalledWith(2, 'account', 'google_review', {
    enabled: true, expectedVersion: 0, consent: true, disclosureVersion: '2026-10-16',
  }, 'step-up-grant')
})

it('担当者はAIの利用設定を変更できない', () => {
  mocks.role = 'staff'
  render(<SettingsBoard accountId="account" data={data} onChanged={vi.fn()} />)
  expect(screen.getByText('利用開始はオーナーか管理者に依頼してください。')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'AI下書きを利用開始する' })).toBeNull()
  expect(mocks.get).not.toHaveBeenCalled()
})
