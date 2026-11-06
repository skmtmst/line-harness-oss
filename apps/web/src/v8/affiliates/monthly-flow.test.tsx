// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ report: vi.fn(), approvals: vi.fn(), settlement: vi.fn(), payments: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { affiliates: { allReport: mocks.report, settlementPreview: mocks.settlement, paymentSummaries: mocks.payments } } }))
vi.mock('./display', () => ({
  currentSettlementPeriod: () => ({ periodFrom: '2026-10-01', periodTo: '2026-10-31T23:59:59+09:00' }),
  listAllConversionApprovals: mocks.approvals,
}))
import MonthlyFlow from './monthly-flow'

beforeEach(() => {
  mocks.report.mockReset().mockResolvedValue({ success: true, data: [{ totalClicks: 100, friendAdds: 21, totalConversions: 7 }] })
  mocks.approvals.mockReset().mockResolvedValue({ truncated: false, items: [
    { createdAt: '2026-10-15' }, { createdAt: '2026-10-16' }, { createdAt: '2026-09-30' },
  ] })
  mocks.settlement.mockReset().mockResolvedValue({ success: true, data: { totalAmount: 12340 } })
  mocks.payments.mockReset().mockResolvedValue({ success: true, data: [{ heldReward: 2000 }, { heldReward: 500 }] })
})
afterEach(cleanup)
const show = () => render(<MonthlyFlow open accountId="account-1" onClose={vi.fn()} />)
const number = (label: string) => screen.getByLabelText(label).querySelector('[data-kpi-number]')?.textContent
const ready = () => waitFor(() => expect(screen.getByRole('group', { name: '報酬' }).getAttribute('aria-busy')).toBe('false'))

describe('今月の成果の流れ', () => {
  it('各項目に正しい数と単位を対応させ、前段からの割合を順に示す', async () => {
    show(); await ready()
    for (const [label, value] of [['クリック', '100'], ['友だち追加', '21'], ['成果', '7'], ['認めた・承認', '2'], ['確定した報酬', '12,340'], ['保留している報酬', '2,500']]) {
      expect(number(label)).toBe(value)
      expect(screen.getByLabelText(label).querySelector('[data-kpi-unit]')?.textContent).toBe(label.includes('報酬') ? '円' : '件')
    }
    expect([...document.querySelectorAll('[data-kpi-connection]')].map(node => node.getAttribute('aria-label'))).toEqual([
      'クリックから友だち追加：21.0%', '友だち追加から成果：33.3%', '成果から認めた・承認：28.6%',
    ])
    expect(mocks.report).toHaveBeenCalledTimes(1)
    expect(mocks.approvals).toHaveBeenCalledWith('approved', 0, { accountId: 'account-1', fresh: true })
  })

  it('100%超えと4桁の割合を丸めずに表示し、長い割合は下の行へ移す', async () => {
    mocks.report.mockResolvedValue({ success: true, data: [{ totalClicks: 100, friendAdds: 125, totalConversions: 1563 }] })
    show(); await ready()
    expect([...document.querySelectorAll('[data-kpi-connection]')].map(node => node.textContent)).toEqual(['125.0%', '1250.4%', '0.1%'])
    expect(screen.getByRole('group', { name: '成果までの流れ' }).getAttribute('data-kpi-flow-rates')).toBe('below')
  })

  it('前段が0なら割らず、分子だけ0なら0%とする', async () => {
    mocks.report.mockResolvedValue({ success: true, data: [{ totalClicks: 100, friendAdds: 0, totalConversions: 0 }] })
    show(); await ready()
    expect(number('友だち追加')).toBe('0')
    expect([...document.querySelectorAll('[data-kpi-connection]')].map(node => node.textContent)).toEqual(['0.0%', '', ''])
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('失敗した数を—に保ち、その前後の割合を出さず、再読込で回復する', async () => {
    mocks.report.mockRejectedValueOnce(new Error('offline'))
    mocks.settlement.mockRejectedValueOnce(new Error('offline'))
    show(); await ready()
    expect(number('クリック')).toBe('—')
    expect(number('友だち追加')).toBe('—')
    expect(number('成果')).toBe('—')
    expect(number('確定した報酬')).toBe('—')
    expect(number('認めた・承認')).toBe('2')
    expect(number('保留している報酬')).toBe('2,500')
    expect([...document.querySelectorAll('[data-kpi-connection]')].every(node => !node.textContent)).toBe(true)
    expect(screen.getByText('一部の集計を読み込めませんでした。取得できない数は「—」で表示しています。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await ready()
    expect(number('クリック')).toBe('100')
    expect(number('確定した報酬')).toBe('12,340')
    expect(screen.queryByText(/一部の集計を読み込めませんでした/)).toBeNull()
    expect(mocks.report).toHaveBeenCalledTimes(2)
  })

  it('承認が読み切れないときは件数も割合も言い切らない', async () => {
    mocks.approvals.mockResolvedValue({ truncated: true, items: [{ createdAt: '2026-10-15' }] })
    show(); await ready()
    expect(number('認めた・承認')).toBe('—')
    expect(document.querySelectorAll('[data-kpi-connection]')[2].textContent).toBe('')
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
