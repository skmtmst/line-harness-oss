// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DashboardBoard } from './stores'

afterEach(cleanup)

const data = {
  reservations: [{ id: 'r1', store_id: 's1', starts_at: '2099-01-01T12:00:00+09:00', status: 'confirmed', guest_count: 2, course_id: null }],
  stores: [{ id: 's1', name: '本店', code: 'HON', area: '渋谷', capacity: 10, line_status: 'ok', google_status: 'ok' }],
  reviews: [{ id: 'v1', reply_status: 'unreplied' }],
  menuItems: [],
  connectors: [],
} as never

it('R11: 帯は4枚まで、5つ目の未返信口コミは帯の下の1行', () => {
  render(<DashboardBoard data={data} />)
  const strip = document.querySelector('[data-kpi-strip]')!
  expect(Array.from(strip.querySelectorAll('[data-kpi-label]')).map((n) => n.getAttribute('title'))).toEqual(['予約数', 'ご来店予定', '空席率', '売上予測'])
  // 5つ目は帯の外の1行に項目名・値・行き先を残す。
  const go = screen.getByRole('link', { name: '口コミへ →' })
  expect(go.closest('[data-kpi-strip]')).toBeNull()
  expect(go.getAttribute('href')).toBe('/restaurant-test/google?tab=reviews')
  expect(go.closest('p')!.textContent!).toContain('未返信口コミ')
  expect(go.closest('p')!.textContent!).toContain('1 件')
})
