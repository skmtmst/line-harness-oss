// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { flushListUrlState } from '@/components/shared/list-url-state'
import { AffiliateShell, type AffiliateTabKey } from './frame'
import AffiliatesV8 from './affiliates'
import ReportTab from './report'
import ApprovalsTab from './approvals'

const fixture = vi.hoisted(() => ({ account: 'account-a' as string | null, list: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/affiliates', useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('./drawer', () => ({ default: ({ onChanged }: { onChanged: () => void }) => <div>
  <input aria-label="詳細の入力" defaultValue="初期値" />
  <button onClick={onChanged}>詳細を保存したあとの再読み込み</button>
</div> }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    affiliates: { ...actual.api.affiliates, list: fixture.list,
      allReport: async () => ({ success: true, data: [] }),
      settlementPreview: async () => ({ success: true, data: { totalAmount: 0, conversionCount: 0, affiliates: [], periodFrom: '', periodTo: '' } }),
    },
    affiliateOffers: { ...actual.api.affiliateOffers, list: async () => ({ success: true, data: [] }) },
    conversionApprovals: { ...actual.api.conversionApprovals, list: async () => ({ success: true, data: [] }) },
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    accountSettings: { ...actual.api.accountSettings, getLinkBaseUrl: async () => ({ success: true, data: null }) },
  } }
})

function people(accountId: string) {
  return { success: true, data: Array.from({ length: accountId === 'account-a' ? 2 : 1 }, (_, index) => ({
    id: `person-${accountId}-${index}`, name: `紹介者-${accountId}${index ? '-2' : ''}`, code: 'fixture',
    holdDays: accountId === 'account-b' ? 14 : 7,
    commissionRate: 0, isActive: true, createdAt: '2026-10-01T00:00:00Z', friendId: null })) }
}
function draw(tab: AffiliateTabKey) {
  window.history.replaceState(null, '', `/affiliates?tab=${tab}`)
  return render(<AffiliatesV8 />)
}
beforeEach(() => {
  flushListUrlState(); localStorage.clear(); fixture.account = 'account-a'; verifiedStaffRole('owner')
  fixture.list.mockReset().mockImplementation(async (accountId?: string) => {
    if (!accountId) throw new Error('LINE公式アカウントを1つ選んでください')
    return people(accountId)
  })
})
afterEach(() => cleanup())

it.each(['report', 'approvals'] as const)('%sの紹介者読み込みに選択アカウントを明示する', async tab => {
  render(<AffiliateShell.Provider value={{ tab, readonly: false, narrow: false, accountId: 'account-a', counts: {}, setCount: vi.fn(), focusAffiliateId: null }}>
    {tab === 'report' ? <ReportTab /> : <ApprovalsTab />}
  </AffiliateShell.Provider>)
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(1))
  expect(fixture.list).toHaveBeenCalledWith('account-a')
  if (tab === 'report') expect(await screen.findByRole('link', { name: '紹介者-account-a' })).toBeTruthy()
  else expect(await screen.findByText('過ぎた成果が次の締めに入る')).toBeTruthy()
})

it('外枠の件数取得にも選択アカウントを渡す', async () => {
  draw('offers')
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(1))
  expect(fixture.list).toHaveBeenCalledWith('account-a')
  expect(await screen.findByRole('tab', { name: 'アフィリエイター 2' })).toBeTruthy()
})

it('紹介者一覧と外枠の両方が同じアカウントを指定する', async () => {
  draw('affiliates')
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2))
  expect(fixture.list.mock.calls).toEqual([['account-a'], ['account-a']])
  expect(await screen.findByRole('link', { name: '紹介者-account-a' })).toBeTruthy()
})

it('未選択なら紹介者一覧を問い合わせない', async () => {
  fixture.account = null; draw('report')
  await act(async () => {})
  expect(fixture.list).not.toHaveBeenCalled()
  expect(screen.getByText('LINE公式アカウントを選んでください')).toBeTruthy()
})

it('同じアカウントで詳細を保存したあとも、開いている欄と入力を保つ', async () => {
  window.history.replaceState(null, '', '/affiliates?tab=affiliates&affiliate=person-account-a-0')
  render(<AffiliatesV8 />)
  const field = await screen.findByRole('textbox', { name: '詳細の入力' })
  fireEvent.change(field, { target: { value: '保存後も残す内容' } })
  let release!: (value: ReturnType<typeof people>) => void
  const pending = new Promise<ReturnType<typeof people>>(resolve => { release = resolve })
  fixture.list.mockImplementation(() => pending)
  fireEvent.click(screen.getByRole('button', { name: '詳細を保存したあとの再読み込み' }))
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(3))
  expect(screen.getByRole('textbox', { name: '詳細の入力' })).toBe(field)
  await act(async () => { release(people('account-a')); await pending })
  expect(screen.getByRole('textbox', { name: '詳細の入力' })).toBe(field)
  expect((field as HTMLInputElement).value).toBe('保存後も残す内容')
})

it.each(['report', 'affiliates', 'approvals'] as const)('%sで切り替え前の遅い返事を新しいアカウントへ混ぜない', async tab => {
  let release!: (value: ReturnType<typeof people>) => void
  const pending = new Promise<ReturnType<typeof people>>(resolve => { release = resolve })
  fixture.list.mockImplementation((accountId?: string) => accountId === 'account-a' ? pending : Promise.resolve(people(accountId ?? '未指定')))
  const view = draw(tab)
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2))
  fixture.account = 'account-b'; view.rerender(<AffiliatesV8 />)
  if (tab === 'approvals') await waitFor(() => expect(screen.getByText('保留期間').closest('[data-kpi-presentation]')?.textContent).toContain('14日'))
  else expect(await screen.findByRole('link', { name: '紹介者-account-b' })).toBeTruthy()
  await act(async () => { release(people('account-a')); await pending })
  expect(screen.getByRole('tab', { name: 'アフィリエイター 1' })).toBeTruthy()
  expect(screen.queryByRole('tab', { name: 'アフィリエイター 2' })).toBeNull()
  expect(screen.queryByRole('link', { name: '紹介者-account-a' })).toBeNull()
  if (tab === 'approvals') expect(screen.getByText('保留期間').closest('[data-kpi-presentation]')?.textContent).toContain('14日')
  else expect(screen.getByRole('link', { name: '紹介者-account-b' })).toBeTruthy()
})
