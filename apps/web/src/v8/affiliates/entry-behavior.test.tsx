import { PERMISSION_LOCK_SUMMARY } from '@/components/shared/permission-lock'
import { READ_ONLY_MESSAGE } from '@/components/shared/read-only-notice'
import { getPageAction } from '@/test-utils/page-action'
// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
/*
 * 成果とアフィリエイトの動きの試験を、今の入口（app/affiliates/page.tsx・new/page.tsx）から通す。
 *
 * 以前の試験（app/affiliates/affiliate-permissions.test.tsx・new/create-v8-design.test.tsx・
 * new/affiliate-create-behavior.test.ts）は、入口から読まれていない旧い写し
 * （app/affiliates/affiliates-v8.tsx・new-affiliate-v8.tsx）を見ていた。写しが緑でも、
 * 実際に出る src/v8/affiliates の画面は何も守られていなかった。ここへ移す。
 *
 * 守る動き：権限（確かめる前・閲覧のみは変えられない／管理者だけ変えられる）・保存・
 * 失敗（紹介コードの重なり・HTTP の失敗で入力を残す）・発行したリンクだけを出す・
 * 割合 0% を空欄と分けて送る・友だち候補を 20 件ずつ読む。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fixture = vi.hoisted(() => ({ role: null as string | null, searchParams: new URLSearchParams('') }))
const create = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const getAffiliate = vi.hoisted(() => vi.fn())
const friendsList = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
const pageTitle = vi.hoisted(() => vi.fn())
const approvalsList = vi.hoisted(() => vi.fn())

vi.mock('@/lib/staff-role', async (original) => ({
  ...await original<typeof import('@/lib/staff-role')>(),
  useStaffRole: () => fixture.role,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: { ...actual.api.friends, list: friendsList },
      affiliates: {
        ...actual.api.affiliates,
        list: async () => ({ success: true, data: [] }),
        allReport: async () => ({ success: true, data: [] }),
        settlementPreview: async () => ({ success: true, data: { totalAmount: 0, conversionCount: 0, affiliates: [], periodFrom: '', periodTo: '' } }),
        create,
        update,
        get: getAffiliate,
      },
      affiliateOffers: { ...actual.api.affiliateOffers, list: async () => ({ success: true, data: [] }) },
      conversionApprovals: { ...actual.api.conversionApprovals, list: approvalsList },
      accountSettings: { ...actual.api.accountSettings, getLinkBaseUrl: async () => ({ success: true, data: null }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => fixture.searchParams,
  usePathname: () => '/affiliates',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'acc-1',
    selectedAccount: { id: 'acc-1', name: '本店' },
    accounts: [{ id: 'acc-1', name: '本店' }],
    setSelectedAccountId: () => {},
    clearSelectedAccountId: () => {},
    refreshAccounts: async () => {},
    loading: false,
  }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: pageTitle, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {} }),
}))
vi.mock('@/v8/conversions', () => ({
  ConversionListV8: ({ embedded }: { embedded?: boolean }) => React.createElement('div', { 'data-testid': embedded ? 'embedded-conversions' : 'standalone-conversions' }),
}))

// 今の入口そのものを通す（入口が別の画面を出すように変われば、この試験も追いかける）。
import AffiliatesPage from '@/app/affiliates/page'
import NewAffiliatePage from '@/app/affiliates/new/page'
import LegacyConversionsPage from '@/app/conversions/page'
import { AffiliateTabs } from './frame'
import { ApiError } from '@/lib/api'

beforeEach(() => {
  fixture.role = verifiedStaffRole(null)
  fixture.searchParams = new URLSearchParams('')
  push.mockReset()
  replace.mockReset()
  pageTitle.mockClear()
  friendsList.mockReset().mockResolvedValue({ success: true, data: { items: [], total: 0 } })
  create.mockReset().mockResolvedValue({ success: false, error: 'このコードは既に使われています' })
  update.mockReset().mockResolvedValue({ success: true, data: { id: 'a1' } })
  getAffiliate.mockReset()
  approvalsList.mockReset().mockResolvedValue({ success: true, data: [] })
})
afterEach(() => cleanup())

describe('権限（今の入口 /affiliates）', () => {
  it('実入口からトップバーへ画面名を渡す', () => {
    render(<AffiliatesPage />)
    expect(pageTitle).toHaveBeenCalledWith('成果とアフィリエイト')
  })
  it('権限を確かめる前と閲覧担当は変えられず、管理者と分かった後だけ作れる', async () => {
    const { rerender } = render(<AffiliatesPage />)
    // 確かめる前：変更操作を隠し、未確認の本人へ拒否理由を決めつけない。
    expect(document.querySelector('[data-read-only-notice]')).toBeNull()
    expect(screen.queryByRole('link', { name: /アフィリエイターを作る/ })).toBeNull()

    fixture.role = verifiedStaffRole('staff')
    rerender(<AffiliatesPage />)
    expect(document.querySelector('[data-read-only-notice]')?.textContent).toBe(PERMISSION_LOCK_SUMMARY.feature)
    expect(screen.queryByRole('link', { name: /アフィリエイターを作る/ })).toBeNull()

    fixture.role = verifiedStaffRole('owner')
    rerender(<AffiliatesPage />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /アフィリエイターを作る/ }).length).toBeGreaterThan(0))
    expect(document.querySelector('[data-read-only-notice]')).toBeNull()
  })
})

describe('承認待ちの読み込み（WEB003）', () => {
  it('タブの件数とアフィリエイターの一覧が同時に開いても、承認待ちの全件読みは1本にまとまる', async () => {
    fixture.role = verifiedStaffRole('owner')
    render(<AffiliatesPage />)
    await waitFor(() => expect(approvalsList).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    const pendingCalls = approvalsList.mock.calls.filter(([params]) => params?.status === 'pending')
    expect(pendingCalls).toHaveLength(1)
  })
})

describe('成果地点タブの統合', () => {
  it('成果とアフィリエイト内のタブで成果地点一覧を開く', () => {
    fixture.searchParams = new URLSearchParams('tab=points')
    render(<AffiliatesPage />)
    expect(screen.getByTestId('embedded-conversions')).toBeTruthy()
  })

  it('コンバージョンのタブは統合後の一覧URLへつなぐ', () => {
    render(<AffiliateTabs />)
    expect(document.querySelector('a[href="/affiliates?tab=points"]')?.textContent).toContain('コンバージョン')
  })

  it('旧コンバージョン一覧URLを同じタブへ検索条件つきで移す', async () => {
    fixture.searchParams = new URLSearchParams('q=月次&tab=points&folder=unfiled')
    render(<LegacyConversionsPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/affiliates?q=%E6%9C%88%E6%AC%A1&tab=points&folder=unfiled'))
  })
})

describe('アフィリエイターを作る（今の入口 /affiliates/new）', () => {
  beforeEach(() => { fixture.role = verifiedStaffRole('owner') })

  it.each([null, 'staff', 'viewer'])('作る入口でも役割%sには保存と友だちの変更を出さない', role => {
    fixture.role = verifiedStaffRole(role)
    render(<NewAffiliatePage />)
    expect(screen.queryByRole('button', { name: '保存して続けて作る' })).toBeNull()
    expect(screen.queryByRole('button', { name: /登録して紹介リンクを発行する/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'LINE の友だちと結びつける' })).toBeNull()
    if (role === null) expect(document.querySelector('[data-read-only-notice]')).toBeNull()
    else expect(document.querySelector('[data-read-only-notice]')?.textContent).toBe(role === 'viewer' ? READ_ONLY_MESSAGE : PERMISSION_LOCK_SUMMARY.feature)
    expect(screen.queryByRole('textbox', { name: /名前（表示名）/ })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'すぐに計測を始める' })).toBeNull()
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  const fillName = (value: string) => fireEvent.change(screen.getByLabelText(/名前（表示名）/), { target: { value } })
  const fillCode = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: /紹介コード（/ }), { target: { value } })

  const registered = {
    id: 'a1', name: '紹介者', code: 'referral', commissionRate: 0, rewardMode: 'fixed',
    isActive: true, email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false,
  }

  it('登録応答の編集値を最初の追加保存に送り、成功すると一覧へ戻る', async () => {
    create.mockResolvedValue({ success: true, data: registered })
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/affiliates?affiliate=a1&highlight=a1'))
    expect(update.mock.calls[0][1].expected).toEqual({
      name: '紹介者', commissionRate: 0, rewardMode: 'fixed', isActive: true,
      email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false,
    })
    expect(getAffiliate).not.toHaveBeenCalled()
  })

  it('409で入力を残して最新と比較し、明示的な読込後に新しい比較値で再保存する', async () => {
    create.mockResolvedValue({ success: true, data: registered })
    update.mockRejectedValueOnce(new ApiError(409, 'ほかの人が先に変えました', 'VERSION_CONFLICT'))
    const latest = { ...registered, name: '相手の名前', email: 'other@example.com', holdDays: 7, payoutCycle: '月末', notifyOnConversion: true, isActive: false }
    getAffiliate.mockResolvedValue({ success: true, data: latest })
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fireEvent.change(screen.getByLabelText(/メール/), { target: { value: 'mine@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await screen.findByText('ほかの人が先にこのアフィリエイターを保存しました')
    const notice = document.querySelector('[data-save-conflict]')!
    expect(notice.querySelectorAll('[data-design-part="notice"]')).toHaveLength(0)
    expect(notice.textContent).toContain('基本情報は保存済み')
    expect(notice.textContent).toContain('追加情報は未保存')
    expect(notice.querySelector('a')?.textContent).toBe('追加情報を破棄して一覧へ戻る')
    expect((screen.getByLabelText(/メール/) as HTMLInputElement).value).toBe('mine@example.com')
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '追加情報の保存を再開する' }))
    expect(update).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    await screen.findByRole('dialog', { name: '最新の保存と比べる' })
    expect(screen.getByText(/メールアドレス：あなたの下書き「mine@example.com」／最新「other@example.com」/)).toBeTruthy()
    expect((screen.getByLabelText(/名前（表示名）/) as HTMLInputElement).value).toBe('紹介者')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect((screen.getByLabelText(/メール/) as HTMLInputElement).value).toBe('mine@example.com')
    fireEvent.click(await screen.findByRole('button', { name: '最新を読み込んで続ける' }))
    await waitFor(() => expect((screen.getByLabelText(/名前（表示名）/) as HTMLInputElement).value).toBe('相手の名前'))
    expect((screen.getByLabelText(/メール/) as HTMLInputElement).value).toBe('other@example.com')
    fillName('確認後の名前')
    fireEvent.click(screen.getByRole('button', { name: '追加情報の保存を再開する' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][1]).toMatchObject({ name: '確認後の名前', expected: { name: '相手の名前', email: 'other@example.com', isActive: false, holdDays: 7 } })
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('比較と再読込が失敗しても入力と競合を保持する', async () => {
    create.mockResolvedValue({ success: true, data: registered })
    update.mockRejectedValueOnce(new ApiError(409, '競合', 'VERSION_CONFLICT'))
    getAffiliate.mockRejectedValue(new Error('offline'))
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await screen.findByText('ほかの人が先にこのアフィリエイターを保存しました')
    fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
    await screen.findByText('最新の内容を取れませんでした。もう一度お試しください。')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.click(await screen.findByRole('button', { name: '最新を読み込んで続ける' }))
    await screen.findByText('最新の内容を読み込めませんでした。入力は残っています。もう一度お試しください。')
    expect((screen.getByLabelText(/名前（表示名）/) as HTMLInputElement).value).toBe('紹介者')
    expect(screen.getByText('ほかの人が先にこのアフィリエイターを保存しました')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('通信失敗の再試行でも最初の比較値を保ち、登録を増やさない', async () => {
    create.mockResolvedValue({ success: true, data: registered })
    update.mockRejectedValueOnce(new Error('offline'))
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await screen.findByRole('button', { name: '追加情報の保存を再開する' })
    fillName('自分の修正')
    fireEvent.click(screen.getByRole('button', { name: '追加情報の保存を再開する' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][1]).toMatchObject({ name: '自分の修正', expected: { name: '紹介者', email: null } })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('WEB208 報酬なしを保存時に明示する', async () => {
    render(<NewAffiliatePage />)
    fillName('計測だけ')
    fillCode('measure2026')
    fireEvent.click(screen.getByRole('radio', { name: /報酬なし/ }))
    fireEvent.click(getPageAction({ name: '保存して続けて作る' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ rewardMode: 'none' })))
  })

  it('紹介コードの重なりは欄に一度だけ出て、入力を残して欄へ移る', async () => {
    const scroll = vi.fn()
    render(<NewAffiliatePage />)
    fillName('ペットライフ編集部')
    fillCode('petlife2026')
    const code = screen.getByRole('textbox', { name: /紹介コード（/ }) as HTMLInputElement
    code.scrollIntoView = scroll
    fireEvent.click(getPageAction({ name: '保存して続けて作る' }))
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'))
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.getAllByText('この紹介コードは既に使われています。別のコードを入力してください。')).toHaveLength(1)
    expect(screen.queryByText('この紹介コードは、ほかの人が先に登録しました')).toBeNull()
    expect((screen.getByLabelText(/名前（表示名）/) as HTMLInputElement).value).toBe('ペットライフ編集部')
    expect(code.value).toBe('petlife2026')
    expect(push).not.toHaveBeenCalled()
  })

  it('未入力と不正な紹介コードは欄で知らせ、最初の誤りへ移り、登録を呼ばない', async () => {
    render(<NewAffiliatePage />)
    fillCode('bad!')
    fireEvent.click(getPageAction({ name: '保存して続けて作る' }))
    const name = screen.getByLabelText(/名前（表示名）/)
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('textbox', { name: /紹介コード（/ }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('名前・屋号を入力してください')).toHaveLength(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('HTTP の失敗として返る重なりでも入力を残して直し方を示す', async () => {
    create.mockRejectedValue(new Error('このコードは既に使われています'))
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fillCode('usedcode')
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes('別のコードを入力'))).toBe(true))
    expect((screen.getByRole('textbox', { name: /紹介コード（/ }) as HTMLInputElement).value).toBe('usedcode')
    expect(push).not.toHaveBeenCalled()
  })

  it('登録前はコピーを出さず、発行された紹介リンクだけをコピーできる', async () => {
    create.mockResolvedValue({ success: true, data: { id: 'a1', isActive: true }, link: { url: 'https://example.com/r/issued', refCode: 'issued' } })
    render(<NewAffiliatePage />)
    expect(screen.queryByRole('button', { name: /リンクをコピー/ })).toBeNull()
    fillName('紹介者')
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await waitFor(() => expect(screen.getByText('https://example.com/r/issued'.replace(/^https?:\/\//, ''), { exact: false })).toBeTruthy())
    expect(screen.getByRole('button', { name: /リンクをコピー/ })).toBeTruthy()
    // 保存できたら一覧のその人へ戻る
    expect(push).toHaveBeenCalledWith('/affiliates?affiliate=a1&highlight=a1')
  })

  it('割合 0% は空欄と分けて送る（0 を「未入力」にしない）', async () => {
    create.mockResolvedValue({ success: true, data: { id: 'a1' } })
    render(<NewAffiliatePage />)
    fillName('紹介者')
    fireEvent.click(screen.getByRole('radio', { name: /売上に対する割合/ }))
    fireEvent.change(await screen.findByLabelText(/売上に対する割合（%）/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({ commissionRate: 0 })
    expect(update.mock.calls[0][1]).toMatchObject({ commissionRate: 0 })
  })

  it('友だち候補は 20 件ずつ、1 ページ目は 0 件目から読む', async () => {
    render(<NewAffiliatePage />)
    await waitFor(() => expect(friendsList).toHaveBeenCalled())
    expect(friendsList.mock.calls[0][0]).toMatchObject({ limit: 20, offset: '0' })
  })

  it('足元の3つと報酬の決め方の文言（絵 Gqve5）', async () => {
    render(<NewAffiliatePage />)
    expect(screen.getByRole('link', { name: 'キャンセル' })).toBeTruthy()
    expect(getPageAction({ name: '保存して続けて作る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ })).toBeTruthy()
    expect(screen.getByText('報酬の決め方は、案件ごとの額より先にこの人の決まりが使われます')).toBeTruthy()
    expect(screen.getByText('注文金額の ◯% を報酬に')).toBeTruthy()
    expect(screen.getByText('金額は案件の「報酬額」で')).toBeTruthy()
  })
})

afterEach(() => { verifiedStaffRole(null) })
