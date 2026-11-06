// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StyleAnalyticsView } from './analytics'
import type { StyleAnalytics } from './model'

afterEach(cleanup)

it('分析の数を共通の帯で読み、実測0・未取得・比較・用語説明を保つ', () => {
  const data: StyleAnalytics = {
    tabs: [{ id: 'reservations', label: '予約' }], tab: 'reservations', side: [], chart: null, table: null,
    cards: [
      { id: 'count', title: '予約数', valueText: '0', unit: '件', help: '確定した予約を数えます。', delta: { text: '−3', tone: 'down' } },
      { id: 'missing', title: '入金額', valueText: '—', help: '入金は未取得です。', delta: { text: '+7.1%', tone: 'up' } },
      { id: 'rate', title: '来店率', valueText: '95.5', unit: '%', help: '予約のうち来店した割合です。' },
    ],
  }
  const { rerender } = render(<StyleAnalyticsView data={data} error={false} onTab={vi.fn()} onRetry={vi.fn()} onRowOpen={vi.fn()} />)
  const count = screen.getByLabelText('予約数')
  expect(count.closest('[data-kpi-strip]')).toBeTruthy()
  expect(within(count).getByText('0').hasAttribute('data-kpi-number')).toBe(true)
  expect(within(count).getByText('件')).toBeTruthy()
  expect(within(count).getByText('−3')).toBeTruthy()
  expect(within(screen.getByLabelText('入金額')).getByText('—')).toBeTruthy()
  expect(screen.queryByText('+7.1%')).toBeNull()
  fireEvent.click(within(count).getByRole('button', { name: '予約数の説明' }))
  expect(screen.getByText('確定した予約を数えます。')).toBeTruthy()
  rerender(<StyleAnalyticsView data={{ ...data, cards: data.cards.map(card => ({ ...card, delta: null })) }} error={false} onTab={vi.fn()} onRetry={vi.fn()} onRowOpen={vi.fn()} />)
  expect(screen.queryByText('−3')).toBeNull()
})
