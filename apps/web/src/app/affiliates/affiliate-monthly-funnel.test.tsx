// @vitest-environment happy-dom
/*
 * R290: 「今月の成果の流れ」に全期間の数を混ぜない。累計80クリック・
 * 20友だち・8成果と今月0の応答を用意し、日付つき取得の数が出ることを見る。
 * R293: 一覧・集計の取得に失敗しても0件と出さない。「—」と再試行を出し、
 * 再試行の成功で数値を戻す。真の0件は0と出す。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  listImpl: null as null | (() => Promise<unknown>),
  monthlyImpl: null as null | ((params: unknown) => Promise<unknown>),
  allReportCalls: [] as Array<unknown>,
}))

function cumulativeRows() {
  return [
    {
      affiliateId: 'aff-a',
      affiliateName: '候補A',
      code: 'CODE_A',
      commissionRate: 10,
      totalClicks: 80,
      totalConversions: 8,
      totalRevenue: 8000,
      confirmedReward: 800,
      linkCount: 2,
      friendAdds: 20,
    },
  ]
}

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: () => fixture.listImpl!(),
      allReport: (params?: unknown) => {
        fixture.allReportCalls.push(params)
        if (params && typeof params === 'object' && 'startDate' in (params as Record<string, unknown>)) {
          return fixture.monthlyImpl!(params)
        }
        return Promise.resolve({ success: true, data: cumulativeRows() })
      },
    },
    accountSettings: {
      getLinkBaseUrl: async () => ({ success: true, data: null }),
    },
    conversionApprovals: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const { AffiliatorsTab } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function funnelSection() {
  return screen.getByRole('region', { name: '今月の成果の流れ' })
}

function funnelText() {
  return funnelSection().textContent ?? ''
}

/** 流れの段の箱（見出し＋値）の全文。見出しの親の箱を読む。 */
function monthlyCell(label: string) {
  const heads = Array.from(funnelSection().querySelectorAll('p'))
  const head = heads.find((p) => p.textContent === label)
  return head?.parentElement?.textContent ?? ''
}

beforeEach(() => {
  fixture.allReportCalls.length = 0
  fixture.listImpl = async () => ({
    success: true,
    data: [
      { id: 'aff-a', name: '候補A', code: 'CODE_A', commissionRate: 10, isActive: true, createdAt: '2026-09-01T00:00:00+09:00', friendId: null },
    ],
  })
  // 今月は承認0・クリック5・友だち1・成果0（累計80/20/8と変える）。
  fixture.monthlyImpl = async () => ({
    success: true,
    data: [
      {
        affiliateId: 'aff-a',
        affiliateName: '候補A',
        code: 'CODE_A',
        commissionRate: 10,
        totalClicks: 5,
        totalConversions: 0,
        totalRevenue: 0,
        confirmedReward: 0,
        linkCount: 2,
        friendAdds: 1,
      },
    ],
  })
})

afterEach(() => {
  cleanup()
})

describe('R290 今月の流れは今月の範囲で数える', () => {
  test('累計80ではなく今月5クリックを出す。日付つきで取得する', async () => {
    render(<AffiliatorsTab accountId={null} />)
    await waitFor(() => expect(funnelText()).toContain('5件'))

    // 今月の取得は日付つき。
    const monthlyCalls = fixture.allReportCalls.filter(
      (params) => params && typeof params === 'object' && 'startDate' in (params as Record<string, unknown>),
    )
    expect(monthlyCalls.length).toBeGreaterThan(0)
    const params = monthlyCalls[0] as { startDate: string; endDate: string }
    expect(typeof params.startDate).toBe('string')
    expect(typeof params.endDate).toBe('string')
    expect(new Date(params.startDate).getTime()).toBeLessThan(new Date(params.endDate).getTime())

    // 累計80/20/8は流れに出ない。真の0件（今月の成果）は0と出す。
    const text = funnelText()
    expect(text).toContain('5件')
    expect(text).toContain('1件')
    expect(text).not.toContain('80件')
    expect(text).not.toContain('20件')
    expect(text).not.toContain('8件')
  })
})

describe('R293 失敗しても0件と出さない', () => {
  test('一覧も集計も失敗したら—になり、再試行の成功で数値が戻る', async () => {
    fixture.listImpl = async () => ({ success: false, error: '落ちた' })
    fixture.monthlyImpl = async () => ({ success: false, error: '落ちた' })
    render(<AffiliatorsTab accountId={null} />)

    // 流れの段に0件は出ない（流れと一覧の両方に再試行が出る）。
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: 'もう一度読み込む' }).length,
    ).toBeGreaterThanOrEqual(2))
    // 取れていない3段は—。承認は本当に0件（空の応答）なので0のまま。
    expect(monthlyCell('クリック')).toBe('クリック—')
    expect(monthlyCell('友だち追加')).toBe('友だち追加—')
    expect(monthlyCell('成果')).toBe('成果—')
    expect(monthlyCell('認めた・承認')).toContain('0件')

    // 直して読み直すと数値が戻る。
    fixture.listImpl = async () => ({
      success: true,
      data: [
        { id: 'aff-a', name: '候補A', code: 'CODE_A', commissionRate: 10, isActive: true, createdAt: '2026-09-01T00:00:00+09:00', friendId: null },
      ],
    })
    fixture.monthlyImpl = async () => ({
      success: true,
      data: [
        {
          affiliateId: 'aff-a',
          affiliateName: '候補A',
          code: 'CODE_A',
          commissionRate: 10,
          totalClicks: 5,
          totalConversions: 3,
          totalRevenue: 300,
          confirmedReward: 30,
          linkCount: 1,
          friendAdds: 2,
        },
      ],
    })
    // 一覧と集計の再試行は別々。両方押して直す。
    const retries = screen.getAllByRole('button', { name: 'もう一度読み込む' })
    await act(async () => {
      for (const button of retries) fireEvent.click(button)
    })
    await waitFor(() => expect(funnelText()).toContain('5件'))
    expect(funnelText()).toContain('2件')
    expect(funnelText()).toContain('3件')
  })
})
