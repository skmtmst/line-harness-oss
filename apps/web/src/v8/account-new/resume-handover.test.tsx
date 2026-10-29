// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import ResumeFollowerHandover from './resume-handover'

const mocks = vi.hoisted(() => ({
  state: vi.fn(), step: vi.fn(), select: vi.fn(), push: vi.fn(), replace: vi.fn(),
}))
vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useSearchParams: () => new URLSearchParams('accountId=the-shed'),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({
  accounts: [{ id: 'the-shed', name: 'THE SHED', displayName: 'THE SHED', basicId: '@test', pictureUrl: null }],
  setSelectedAccountId: mocks.select,
}) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/api', () => ({ api: { lineAccounts: { followerImportState: mocks.state, stepFollowerImport: mocks.step } } }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { get: vi.fn(async () => ({ success: true, data: { style: 'restaurant' } })) } }))

const importState = (over: Record<string, unknown> = {}) => ({
  capability: 'available', phase: 'importing_ids', received: 0, imported: 0,
  alreadyPresent: 0, reactivated: 0, claimedUnassigned: 0, conflicts: 0, invalid: 0,
  profilesProcessed: 0, profilesUpdated: 0, profileErrors: 0,
  updatedAt: new Date().toISOString(), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.mockResolvedValue({ success: true, data: importState() })
  mocks.step.mockImplementation(() => new Promise(() => {}))
})
afterEach(() => cleanup())

describe('統括から友だち引き継ぎへ戻る画面', () => {
  it('Penの探索中カードを表示して実際のジョブを進める', async () => {
    render(<ResumeFollowerHandover />)
    await screen.findByText('友だちを確認しています', { selector: 'h2' })
    expect(screen.getByText('飲食店')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: '友だちの引き継ぎ進捗' })
    expect(bar.childElementCount).toBe(0)
    expect(screen.queryByRole('button', { name: 'アカウントに入る' })).toBeNull()
    await waitFor(() => expect(mocks.step).toHaveBeenCalledWith('the-shed'))
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('完了を確認するまで店舗へ入れず、完了後だけ入れる', async () => {
    mocks.state.mockResolvedValue({ success: true, data: importState({ phase: 'completed', received: 4, claimedUnassigned: 3, alreadyPresent: 1 }) })
    render(<ResumeFollowerHandover />)
    const enter = await screen.findByRole('button', { name: 'アカウントに入る' })
    expect(screen.getByRole('progressbar', { name: '友だちの引き継ぎ進捗' }).getAttribute('aria-valuenow')).toBe('4')
    enter.click()
    expect(mocks.select).toHaveBeenCalledWith('the-shed')
    expect(mocks.push).toHaveBeenCalledWith('/')
  })
})
