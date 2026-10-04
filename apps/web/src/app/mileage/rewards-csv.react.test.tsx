// @vitest-environment happy-dom
import React, { useState, type ReactNode } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MileageRewardSummary } from '@/lib/api'

const mocks = vi.hoisted(() => ({ account: 'A', rewards: vi.fn(), redemptions: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.account, loading: false }),
}))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  api: { mileage: { rewards: mocks.rewards } }, fetchApi: mocks.redemptions,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import V8RewardsTab from './v8-rewards-tab'

function Screen() {
  const [actions, setActions] = useState<ReactNode>(null)
  return <>{actions}<V8RewardsTab readonly registerHeaderActions={setActions} /></>
}
const reward = (name: string, status: 'published' | 'draft' = 'published'): MileageRewardSummary => ({
  id: name, lineAccountId: 'A', programId: 'p', name, description: null, imageUrl: null,
  rewardKind: 'coupon', status, sortOrder: 0, currentDraftVersionId: 'd', currentPublishedVersionId: 'v',
  currentVersion: {
    id: 'v', versionNumber: 1, status: 'published', revision: 1, requiredMiles: 500,
    stockLimit: null, perFriendLimit: 1, startsAt: null, endsAt: null, benefitExpiresDays: null,
    commonActionVersionId: null, targetConditions: null, failurePolicy: 'refund', customerMessage: '', publishedAt: null,
  },
  exchangedThisMonth: 2, availableCodeCount: null, benefitName: '送料,無料', createdAt: '', updatedAt: '',
})
const result = (items: MileageRewardSummary[]) => ({ success: true, data: { rewards: items, reachMetrics: [], summary: {} } })
let blob: NodeBlob | undefined
let download: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mocks.account = 'A'
  mocks.rewards.mockReset()
  mocks.redemptions.mockResolvedValue({ success: true, data: { items: [], pagination: { total: 0 } } })
  blob = undefined
  vi.stubGlobal('Blob', NodeBlob)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value as NodeBlob; return 'blob:csv' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('閲覧担当も、読み込んだ全使い道を実際のマイル・状態でCSVに書き出せる', async () => {
  mocks.rewards.mockResolvedValue(result([reward('=特典,"A"'), reward('次の特典', 'draft')]))
  render(<Screen />)
  const button = screen.getByRole('button', { name: 'CSV で書き出す' })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  fireEvent.click(button)
  expect(download).toHaveBeenCalledOnce()
  const csv = await blob!.text()
  expect(csv).toContain('"\'=特典,""A"""')
  expect(csv).toContain('送料,無料')
  expect(csv).toContain('"500"')
  expect(csv).toContain('"出している"')
  expect(csv).toContain('"下書き"')
  expect(csv).toContain('"次の特典"')
  expect(mocks.rewards).toHaveBeenCalledWith('A')
})

test('別のお店を読み込み中・取得失敗のときは、前のお店のCSVを保存しない', async () => {
  mocks.rewards.mockResolvedValueOnce(result([reward('Aの特典')]))
  const rendered = render(<Screen />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'CSV で書き出す' }).hasAttribute('disabled')).toBe(false))
  let reject!: (error: Error) => void
  mocks.rewards.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  mocks.account = 'B'
  rendered.rerender(<Screen />)
  expect(screen.getByRole('button', { name: 'CSV で書き出す' }).hasAttribute('disabled')).toBe(true)
  reject(new Error('network'))
  await waitFor(() => expect(screen.getByText('使い道を読み込めませんでした')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(download).not.toHaveBeenCalled()
})

test('CSVの保存に失敗しても一覧を残し、もう一度書き出せる', async () => {
  mocks.rewards.mockResolvedValue(result([reward('テスト特典')]))
  render(<Screen />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'CSV で書き出す' }).hasAttribute('disabled')).toBe(false))
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('download') })
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(screen.getByText('CSVを書き出せませんでした。もう一度お試しください。')).toBeTruthy()
  expect(screen.getByText('テスト特典')).toBeTruthy()
  expect(download).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'CSV で書き出す' }))
  expect(download).toHaveBeenCalledOnce()
})

test('使い道が無いときはCSVを書き出さない', async () => {
  mocks.rewards.mockResolvedValue(result([]))
  render(<Screen />)
  await waitFor(() => expect(mocks.rewards).toHaveBeenCalledOnce())
  const button = screen.getByRole('button', { name: 'CSV で書き出す' })
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(button)
  expect(download).not.toHaveBeenCalled()
})
