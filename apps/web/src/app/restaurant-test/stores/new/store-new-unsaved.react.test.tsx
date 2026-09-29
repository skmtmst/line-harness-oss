// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  termsAgreement: vi.fn(),
  agreeToTerms: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/restaurant-test-api', () => ({
  restaurantTestApi: {
    termsAgreement: fixture.termsAgreement,
    agreeToTerms: fixture.agreeToTerms,
  },
}))
// 規約の読み進めは部品自身の試験が持つ。ここでは同意ボタンのみ出す。
vi.mock('./terms-consent', () => ({
  default: ({ onAgree }: { onAgree: () => Promise<void> }) => (
    <button type="button" onClick={() => void onAgree()}>規約に同意する</button>
  ),
}))

import NewRestaurantStorePage from './page'

beforeEach(() => {
  fixture.termsAgreement.mockResolvedValue({ data: { agreedVersion: null, agreedAt: null } })
  fixture.agreeToTerms.mockResolvedValue({ data: { agreedAt: '2026-09-27 10:00:00' } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R161: 店舗追加の書きかけがある間の離脱確認', () => {
  it('店舗名を入れて統括へ戻ると確認が出て、入力継続で内容が残る', async () => {
    render(<NewRestaurantStorePage />)
    fireEvent.click(await screen.findByRole('button', { name: '規約に同意する' }))
    await screen.findByText('店舗の基本情報')
    // この画面の Field は label と input が組づけされていないため、先頭の入力欄を店舗名として掴む。
    const nameBox = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameBox, { target: { value: '渋谷店' } })

    fireEvent.click(screen.getByRole('link', { name: '統括へ戻る' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('渋谷店')
  })

  it('破棄を選んだときだけ統括へ進む', async () => {
    render(<NewRestaurantStorePage />)
    fireEvent.click(await screen.findByRole('button', { name: '規約に同意する' }))
    await screen.findByText('店舗の基本情報')
    // この画面の Field は label と input が組づけされていないため、先頭の入力欄を店舗名として掴む。
    const nameBox = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameBox, { target: { value: '渋谷店' } })

    fireEvent.click(screen.getByRole('link', { name: '統括へ戻る' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移動' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/hq'))
  })
})
