// @vitest-environment happy-dom
/**
 * 管理画面 案件作成の LINE アカウント。
 *
 * 「すべてのアカウント」のまま送ると口が 400 で落とす。画面上部で選んでいる
 * LINE アカウントへ固定し、他アカウントへ誤って作成できないようにする。
 * 選んでいないときは押しても送らず、どこで選ぶかを知らせる。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ account: 'acc-1' as string | null, create: vi.fn() }))

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fx.account, selectedAccount: fx.account ? { id: fx.account, name: '本店' } : null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
      staff: { me: async () => ({ success: true, data: { role: 'owner' } }) },
      affiliateOffers: { ...actual.api.affiliateOffers, create: fx.create, update: async () => ({ success: true, data: { id: 'offer-1' } }) },
    },
  }
})

import NewAffiliateOfferPage from './page'

async function fillAndPublish() {
  render(<NewAffiliateOfferPage />)
  const name = await screen.findByLabelText(/案件名/)
  fireEvent.change(name, { target: { value: '定期便の初回' } })
  fireEvent.change(screen.getByLabelText(/報酬額（円）/), { target: { value: '2000' } })
  fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
}

beforeEach(() => {
  fx.account = 'acc-1'
  fx.create.mockReset().mockResolvedValue({ success: true, data: { id: 'offer-1', isActive: true } })
})
afterEach(() => cleanup())

describe('案件作成のLINEアカウント', () => {
  it('選んでいるLINEアカウントへ固定して作り、アカウントを選ぶ欄は置かない', async () => {
    await fillAndPublish()
    await waitFor(() => expect(fx.create).toHaveBeenCalledTimes(1))
    expect(fx.create.mock.calls[0][0]).toMatchObject({ name: '定期便の初回', rewardAmount: 2000, lineAccountId: 'acc-1', isActive: true })
    expect(screen.queryByRole('combobox', { name: /LINEアカウント/ })).toBeNull()
  })

  it('LINEアカウントを選んでいないときは送らず、画面上部で選ぶよう知らせる', async () => {
    fx.account = null
    await fillAndPublish()
    expect(await screen.findByText('LINEアカウントを選んでください（画面上部で選べます）')).toBeTruthy()
    expect(fx.create).not.toHaveBeenCalled()
  })
})
