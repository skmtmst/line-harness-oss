// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))

vi.mock('../lib/store-auto-rules', () => ({ storeAutoRulesApi: fixture }))
vi.mock('./shell', () => ({
  Panel: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <section><h2>{title}</h2>{description ? <p>{description}</p> : null}<div>{children}</div></section>
  ),
}))

import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import StoreAutoRulesTab from './store-auto-rules-tab'

const rules = {
  autoTableAssign: true,
  recountSeats: true,
  mergeDuplicates: true,
  lowSeatThreshold: 4,
  lineAction: 'stop',
  walkinAction: 'reduce',
  closeBanner: true,
  lineNotifyManager: true,
  conflictNotify: true,
}

beforeEach(() => {
  fixture.get.mockResolvedValue({ success: true, data: rules })
  fixture.save.mockImplementation(async (_s: string, _a: string, next: unknown) => ({ success: true, data: next }))
})
afterEach(() => { cleanup(); clearToastsForTest(); vi.clearAllMocks() })

/*
 * ★V8-B 自動で合わせるルール（板 `nGcY1`・店ごと）の契約。
 * 店ごとの口から読まれ、切り替え・数・受付の決め方が保存で今の口へ届くこと。
 */
describe('nGcY1 店の自動ルール', () => {
  it('3つの箱と切り替え・数・受付の決め方が出る', async () => {
    render(<><StoreAutoRulesTab storeId="store-1" accountId="account-1" /><ToastHost /></>)
    await screen.findByText('予約が入ったとき')
    expect(screen.getByText('残りが少なくなったとき（自社の受付は自動で変える）')).toBeTruthy()
    expect(screen.getByText('媒体の受付を閉じる知らせ（媒体へは自動で書き戻さない）')).toBeTruthy()
    expect(screen.getAllByRole('switch')).toHaveLength(6)
    expect((screen.getByLabelText('残り席がこの数以下で') as HTMLInputElement).value).toBe('4')
    expect(fixture.get).toHaveBeenCalledWith('store-1', 'account-1')
  })

  it('変えて保存すると店の口へ届く', async () => {
    render(<><StoreAutoRulesTab storeId="store-1" accountId="account-1" /><ToastHost /></>)
    await screen.findByText('予約が入ったとき')
    fireEvent.click(screen.getByRole('switch', { name: '卓を自動で割り当てる（座席・卓管理の自動配置ルール）' }))
    fireEvent.change(screen.getByLabelText('残り席がこの数以下で'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '✓ ルールを保存' }))
    await waitFor(() => expect(fixture.save).toHaveBeenCalledWith(
      'store-1', 'account-1', { ...rules, autoTableAssign: false, lowSeatThreshold: 2 },
    ))
    await screen.findByText('ルールを保存しました。')
  })

  it('店が選ばれていないときは選ぶよう出る', () => {
    render(<StoreAutoRulesTab storeId={null} accountId="account-1" />)
    expect(screen.getByText('店舗を選んでください')).toBeTruthy()
    expect(fixture.get).not.toHaveBeenCalled()
  })
})
