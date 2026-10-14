// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ChannelsSummaryBand, { type ChannelsSummary } from './channels-summary'

afterEach(cleanup)
const summary: ChannelsSummary = {
  accountId: 'a', status: 'ready', conflicts: 2,
  data: {
    timeZone: 'Asia/Tokyo', autoAssign: true,
    staff: [{ staffId: 's', displayName: '担当', status: 'connected', externalEventsThisWeek: null, lastReadAt: null, readError: null }],
    channels: [{ key: 'line', status: 'active', todayCount: 4 }, { key: 'manual', status: 'active', todayCount: 3 }, { key: 'epark', status: 'preparing', todayCount: null }],
  },
}
function numbers() {
  return [...screen.getByLabelText('予約経路の数の帯').querySelectorAll('[data-kpi-number]')].map(node => node.textContent)
}
it('未接続の経路を予約数へ足さず、受付中の経路とその当日数を出す', () => {
  render(<ChannelsSummaryBand summary={summary} />)
  expect(numbers()).toEqual(['1', '1', '2', '7'])
  expect(screen.getByText('重なり 2 件')).toBeTruthy()
})
it('受付中の経路が未取得なら、部分的な合計を当日数として出さない', () => {
  render(<ChannelsSummaryBand summary={{ ...summary, data: { ...summary.data!, channels: [{ key: 'line', status: 'active', todayCount: 4 }, { key: 'manual', status: 'active', todayCount: null }] } }} />)
  expect(numbers()).toEqual(['1', '1', '2', '—'])
  expect(screen.getByText('未取得')).toBeTruthy()
})
it('失敗時に以前のアカウントの数を出さず、不明と0件を分ける', () => {
  const view = render(<ChannelsSummaryBand summary={{ ...summary, status: 'error' }} />)
  expect(numbers()).toEqual(['—', '—', '—', '—'])
  view.rerender(<ChannelsSummaryBand summary={{ ...summary, data: { ...summary.data!, staff: [], channels: [{ key: 'line', status: 'active', todayCount: 0 }] } }} />)
  expect(numbers()).toEqual(['0', '0', '1', '0'])
})
