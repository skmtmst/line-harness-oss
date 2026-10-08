// @vitest-environment happy-dom
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

const fixture = vi.hoisted(() => ({ role: null as string | null }))
const create = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const friendsList = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
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
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
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
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {} }),
}))

// 今の入口そのものを通す（入口が別の画面を出すように変われば、この試験も追いかける）。
import AffiliatesPage from '@/app/affiliates/page'
import NewAffiliatePage from '@/app/affiliates/new/page'

beforeEach(() => {
  fixture.role = null
  push.mockReset()
  friendsList.mockReset().mockResolvedValue({ success: true, data: { items: [], total: 0 } })
  create.mockReset().mockResolvedValue({ success: false, error: 'このコードは既に使われています' })
  update.mockReset().mockResolvedValue({ success: true, data: { id: 'a1' } })
  approvalsList.mockReset().mockResolvedValue({ success: true, data: [] })
})
afterEach(() => cleanup())

describe('権限（今の入口 /affiliates）', () => {
  it('権限を確かめる前と閲覧担当は変えられず、管理者と分かった後だけ作れる', async () => {
    const { rerender } = render(<AffiliatesPage />)
    // 確かめる前：作るボタンを出さない（閲覧のみの帯で断る）
    await waitFor(() => expect(document.body.textContent).toContain('閲覧のみで見ています'))
    expect(screen.queryByRole('link', { name: /アフィリエイターを作る/ })).toBeNull()

    fixture.role = 'staff'
    rerender(<AffiliatesPage />)
    expect(document.body.textContent).toContain('閲覧のみで見ています')
    expect(screen.queryByRole('link', { name: /アフィリエイターを作る/ })).toBeNull()

    fixture.role = 'owner'
    rerender(<AffiliatesPage />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /アフィリエイターを作る/ }).length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toContain('閲覧のみで見ています')
  })
})

describe('承認待ちの読み込み（WEB003）', () => {
  it('タブの件数とアフィリエイターの一覧が同時に開いても、承認待ちの全件読みは1本にまとまる', async () => {
    fixture.role = 'owner'
    render(<AffiliatesPage />)
    await waitFor(() => expect(approvalsList).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    const pendingCalls = approvalsList.mock.calls.filter(([params]) => params?.status === 'pending')
    expect(pendingCalls).toHaveLength(1)
  })
})

describe('アフィリエイターを作る（今の入口 /affiliates/new）', () => {
  const fillName = (value: string) => fireEvent.change(screen.getByLabelText(/名前（表示名）/), { target: { value } })
  const fillCode = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: /紹介コード（/ }), { target: { value } })

  it('紹介コードの重なりは欄に一度だけ出て、入力を残して欄へ移る', async () => {
    const scroll = vi.fn()
    render(<NewAffiliatePage />)
    fillName('ペットライフ編集部')
    fillCode('petlife2026')
    const code = screen.getByRole('textbox', { name: /紹介コード（/ }) as HTMLInputElement
    code.scrollIntoView = scroll
    fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
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
    fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
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
    expect(screen.getByRole('button', { name: '保存して続けて作る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /登録して紹介リンクを発行する/ })).toBeTruthy()
    expect(screen.getByText('報酬の決め方は、案件ごとの額より先にこの人の決まりが使われます')).toBeTruthy()
    expect(screen.getByText('注文金額の ◯% を報酬に')).toBeTruthy()
    expect(screen.getByText('金額は案件の「報酬額」で')).toBeTruthy()
  })
})
