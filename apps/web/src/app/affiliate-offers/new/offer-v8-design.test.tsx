// @vitest-environment happy-dom
/*
 * 板 `Td4TN` 案件を作るの絵合わせ（API待ちのため見た目だけ）。
 * - 「何を成果として数えるか」の札があり、成果地点は準備中のまま選べない
 * - 頭・右の見え方・気をつけること・足元の3つのボタンが絵どおり
 * - 保存して公開には ✓ が付く
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  api: {
    tags: {
      list: () => Promise.resolve({ success: true, data: [] }),
    },
    scenarios: {
      list: () => Promise.resolve({ success: true, data: [] }),
    },
    affiliateOffers: {
      create: () => Promise.resolve({ success: true, data: { id: 'o1', isActive: true } }),
      update: () => Promise.resolve({ success: true, data: { id: 'o1' } }),
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

const { NewOfferV8 } = await import('../new-offer-v8')

afterEach(() => {
  cleanup()
})

describe('Td4TN 作る画面の絵合わせ', () => {
  test('成果地点の札は見た目だけで選べない', async () => {
    render(<NewOfferV8 />)
    await waitFor(() => {
      expect(screen.getByText('案件を作る')).toBeTruthy()
    })
    expect(screen.getByText('コンバージョンで作った成果地点から選びます')).toBeTruthy()
    const point = screen.getByLabelText('成果地点')
    expect((point as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/成果地点の選び方は準備中です/)).toBeTruthy()
  })

  test('頭・見え方・気をつけること・足元が絵どおり', async () => {
    render(<NewOfferV8 />)
    await waitFor(() => {
      expect(screen.getByText('案件を作る')).toBeTruthy()
    })
    expect(screen.getByText(/何を紹介すると/)).toBeTruthy()
    expect(screen.getAllByText(/アフィリエイターの画面に出ます/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('アフィリエイターの画面での見え方')).toBeTruthy()
    expect(screen.getByText('公開するとこう見えます')).toBeTruthy()
    expect(screen.getByText(/変えたあとの成果から新しい額になります/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'キャンセル' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存して続けて作る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存して公開' })).toBeTruthy()
  })
})
