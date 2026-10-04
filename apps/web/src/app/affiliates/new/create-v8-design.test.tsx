// @vitest-environment happy-dom
/*
 * 板 `Gqve5` アフィリエイターを作る（競合）の絵合わせ。
 * - 紹介コードの重なり（409・このコードは既に使われています）で、
 *   見出しの下に競合の帯が出る（入力は残る）
 * - 報酬の決め方の文言が絵どおり（は、／◯／案件の「報酬額」で）
 * - 誰が・いつ保存したかは API が返さないので出さない（司令塔へ報告）
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  api: {
    friends: {
      list: () => Promise.resolve({ success: true, data: { items: [], total: 0 } }),
    },
    affiliates: {
      create: () => Promise.resolve({ success: false, error: 'このコードは既に使われています' }),
      update: () => Promise.resolve({ success: true, data: { id: 'a1' } }),
    },
  },
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {} }),
}))

const { NewAffiliateV8 } = await import('../new-affiliate-v8')

afterEach(() => {
  cleanup()
})

describe('Gqve5 作る画面の競合の絵合わせ', () => {
  test('コードの重なりで競合の帯が出て入力が残る', async () => {
    render(<NewAffiliateV8 />)
    await waitFor(() => {
      expect(screen.getByText('アフィリエイターを作る')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText(/名前（表示名）/), { target: { value: 'ペットライフ編集部' } })
    fireEvent.change(screen.getByRole('textbox', { name: /紹介コード（/ }), { target: { value: 'petlife2026' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
    await waitFor(() => {
      expect(screen.getByText('この紹介コードは既に使われています')).toBeTruthy()
    })
    expect(screen.getByText(/ほかの人が先に登録した可能性/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '一覧で確かめる' })).toBeTruthy()
    // 入力は残る
    expect((screen.getByLabelText(/名前（表示名）/) as HTMLInputElement).value).toBe('ペットライフ編集部')
  })

  test('足元の3つが絵どおり（発行に ✓）', async () => {
    render(<NewAffiliateV8 />)
    await waitFor(() => {
      expect(screen.getByText('アフィリエイターを作る')).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: 'キャンセル' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存して続けて作る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '登録して紹介リンクを発行する' })).toBeTruthy()
  })

  test('報酬の決め方の文言が絵どおり', async () => {
    render(<NewAffiliateV8 />)
    await waitFor(() => {
      expect(screen.getByText('報酬の決め方は、案件ごとの額より先にこの人の決まりが使われます')).toBeTruthy()
    })
    expect(screen.getByText('注文金額の ◯% を報酬に')).toBeTruthy()
    expect(screen.getByText('金額は案件の「報酬額」で')).toBeTruthy()
  })
})
