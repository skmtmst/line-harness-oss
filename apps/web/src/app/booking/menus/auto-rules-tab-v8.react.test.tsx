// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))

vi.mock('../lib/booking-auto-rules', () => ({ bookingAutoRulesApi: fixture }))

import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import AutoRulesTabV8 from './auto-rules-tab-v8'

const rules = {
  excludeCalendarBlock: true,
  writeBackToCalendar: true,
  autoAssign: true,
  mergeDuplicates: true,
  conflictNotify: true,
  unconnectedNotify: true,
  dailyLimitNotify: false,
}

beforeEach(() => {
  fixture.get.mockResolvedValue({ success: true, data: rules })
  fixture.save.mockImplementation(async (_account: string, next: unknown) => ({ success: true, data: next }))
})
afterEach(() => { cleanup(); clearToastsForTest(); vi.clearAllMocks() })

/*
 * ★V8-B 予約経路（板 `wJYQb`）の契約。
 * 7つの切り替えが今の口から読まれ、保存が今の口へ届くこと。
 * autoAssign は今の `booking_auto_assign` の鍵を引き継ぐ（動きは変えない）。
 */
describe('wJYQb 予約経路の自動ルール', () => {
  it('7つの切り替えが今の口の値で出る', async () => {
    render(<><AutoRulesTabV8 accountId="account-1" canEdit /><ToastHost /></>)
    await screen.findByText('外から予約が入ったとき')
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(7)
    // 既定で dailyLimitNotify だけオフ（口の実データどおり）。
    expect(screen.getByRole('switch', { name: 'スタッフの1日の予約が上限に近づいたら、ほかの予約サービスで閉じるよう知らせる' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '指名なしの予約は、その時間に空いているスタッフへ自動で割り当てる' }).getAttribute('aria-checked')).toBe('true')
    expect(fixture.get).toHaveBeenCalledWith('account-1')
  })

  it('切り替えて保存すると今の口へ届く', async () => {
    render(<><AutoRulesTabV8 accountId="account-1" canEdit /><ToastHost /></>)
    await screen.findByText('外から予約が入ったとき')
    fireEvent.click(screen.getByRole('switch', { name: '指名なしの予約は、その時間に空いているスタッフへ自動で割り当てる' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ ルールを保存' }))
    await waitFor(() => expect(fixture.save).toHaveBeenCalledWith('account-1', { ...rules, autoAssign: false }))
    await screen.findByText('ルールを保存しました。')
  })

  it('読めないときはもう一度読むが出る', async () => {
    fixture.get.mockRejectedValueOnce(new Error('落ちた'))
    render(<AutoRulesTabV8 accountId="account-1" canEdit />)
    await screen.findByText('ルールを読み込めませんでした')
    fixture.get.mockResolvedValueOnce({ success: true, data: rules })
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読む' }))
    await screen.findByText('外から予約が入ったとき')
  })
})
