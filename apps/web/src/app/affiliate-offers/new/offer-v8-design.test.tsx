// @vitest-environment happy-dom
/*
 * 板  案件を作るの絵合わせ（API待ちのため見た目だけ）。
 * - 「何を成果として数えるか」の札があり、成果地点はこの画面では選べませんのまま選べない
 * - 頭・右の見え方・気をつけること・足元の3つのボタンが絵どおり
 * - 保存して公開には ✓ が付く
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
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

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/staff-role', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/use-unsaved-guard', () => ({
  useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {} }),
}))

const { default: NewOfferV8 } = await import('@/v8/affiliate-offer-new/create')

afterEach(() => {
  cleanup()
})

describe('Td4TN 作る画面の絵合わせ', () => {
  test('成果地点の未対応を説明し、使える一覧への道を残す', async () => {
    render(<NewOfferV8 />)
    await waitFor(() => {
      expect(screen.getByText('案件を作る')).toBeTruthy()
    })
    expect(screen.getByText('何を成果として数えるか')).toBeTruthy()
    expect(screen.queryByLabelText('成果地点')).toBeNull()
    expect(screen.getByText(/成果地点と案件をつなぐ設定は、まだ保存できません/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '成果地点を見る' }).getAttribute('href')).toBe('/conversions')
  })

  test('頭・見え方・気をつけること・足元が絵どおり', async () => {
    render(<NewOfferV8 />)
    await waitFor(() => {
      expect(screen.getByText('案件を作る')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '案件を作るの説明' }))
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
