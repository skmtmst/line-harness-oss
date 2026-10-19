// @vitest-environment happy-dom
/*
 * 板  案件タブの絵合わせ。
 * - 数の帯：案件（公開中・下書き）、平均報酬、マイルあり
 * - 道具：下書きの札、よく使う絞り込み（並び順は置かない）
 * - 行：編集ボタンと公開中／下書きの札
 */
import { AffiliateShell } from '@/v8/affiliates/frame'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const OFFERS = [
  {
    id: 'o1', name: '定期便の初回', description: '初回の定期便が確定したとき',
    rewardAmount: 2000, rewardMiles: 0, mileageProgramId: 'p',
    lineAccountId: null, tagId: 't1', scenarioId: null, folderId: 'offer-folder',
    isActive: true, createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'o2', name: '秋の紹介キャンペーン', description: '商品を買ったとき',
    rewardAmount: 1500, rewardMiles: 0, mileageProgramId: 'p',
    lineAccountId: null, tagId: null, scenarioId: null,
    isActive: false, createdAt: '2026-09-02T00:00:00.000Z',
  },
]

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: {
    folders: { list: async () => ({ success: true, data: [{ id: 'offer-folder', name: '定期便分類', color: '#087a3e', kind: 'affiliate_offer', displayOrder: 0 }] }) },
    affiliateOffers: { list: async () => ({ success: true, data: OFFERS }) },
    lineAccounts: { list: async () => ({ success: true, data: [] }) },
    tags: { list: async () => ({ success: true, data: [] }) },
    scenarios: { list: async () => ({ success: true, data: [] }) },
  },
}))

vi.mock('@/v8/affiliates/display', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/v8/affiliates/display')>(),
  listAllConversionApprovals: async () => ({ items: [], truncated: false }),
  OfferFormModal: () => null,
}))

const { default: OffersTabV8 } = await import('@/v8/affiliates/offers')

afterEach(() => {
  cleanup()
})

describe('h7dmB 案件タブの絵合わせ', () => {
  test('数の帯と道具が絵どおり', async () => {
    render(<AffiliateShell.Provider value={{ tab: 'offers', readonly: false, narrow: false, accountId: 'acc-1', counts: {}, setCount: () => {}, focusAffiliateId: null }}><OffersTabV8 /></AffiliateShell.Provider>)
    await waitFor(() => {
      expect(screen.getByText('平均報酬')).toBeTruthy()
    })
    expect(screen.getByText('マイルあり')).toBeTruthy()
    expect(screen.getByText('公開中 1・下書き 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: /下書き/ })).toBeTruthy()
    expect(screen.getByLabelText('よく使う絞り込み')).toBeTruthy()
    expect(screen.queryByLabelText('並び順')).toBeNull()
  })

  test('行に編集と札が出る', async () => {
    render(<AffiliateShell.Provider value={{ tab: 'offers', readonly: false, narrow: false, accountId: 'acc-1', counts: {}, setCount: () => {}, focusAffiliateId: null }}><OffersTabV8 /></AffiliateShell.Provider>)
    await waitFor(() => {
      expect(screen.getAllByText('公開中').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('公開中').length).toBeGreaterThan(0)
    expect(screen.getAllByText('下書き').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: '編集する' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '定期便の初回の操作' }))
    expect(screen.getByRole('menuitem', { name: '編集する' })).toBeTruthy()
    expect(screen.queryByText('停止・終了')).toBeNull()
  })

  test('フォルダから絞り込み、所属の丸を保つ', async () => {
    render(<AffiliateShell.Provider value={{ tab: 'offers', readonly: false, narrow: false, accountId: 'acc-1', counts: {}, setCount: () => {}, focusAffiliateId: null }}><OffersTabV8 /></AffiliateShell.Provider>)
    const folder = await screen.findByRole('button', { name: '定期便分類 1' })
    await screen.findByText('秋の紹介キャンペーン')
    fireEvent.click(folder)
    await waitFor(() => expect(screen.queryByText('秋の紹介キャンペーン')).toBeNull())
    expect(screen.getByText('定期便の初回')).toBeTruthy()
    expect(screen.getByLabelText('フォルダ：定期便分類')).toBeTruthy()
    expect(screen.getByLabelText('よく使う絞り込み')).toBeTruthy()
  })
})
