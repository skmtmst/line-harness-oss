// @vitest-environment happy-dom
/*
 * 友だち数の推移の表（直近7日）。
 * 「推定」の「？」は見出しの日付の横に1つだけ。行には小さく「推定」の
 * 文字だけ残し、全行が推定のときは行から消す。流入元の列は置かない
 * （「さらに詳しく →」の先で見る）。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FriendTrendTable from '../components/dashboard/friend-trend-table'
import type { DashboardOverview } from '@/lib/api'

afterEach(() => cleanup())

type Trend = DashboardOverview['trend']

function point(date: string, estimated: boolean, active = 100): Trend[number] {
  return { date, added: 2, blocked: 1, active, estimated }
}

function trendOf(points: Array<[string, boolean]>): Trend {
  let active = 100
  return points.map(([date, estimated]) => {
    active += 1
    return point(date, estimated, active)
  })
}

describe('友だち数の推移の表', () => {
  // 重い環境では最初の1件が変換待ちで 5 秒を超えることがあるため余裕を持たせる。
  it('流入元の列を出さない', { timeout: 30000 }, () => {
    const { container } = render(<FriendTrendTable trend={trendOf([['2026-09-20', false]])} />)
    expect(container.textContent).not.toContain('流入元の内訳')
    expect(container.textContent).not.toContain('すべて表示')
    expect(container.querySelectorAll('th').length).toBe(5)
  })

  it('「？」は見出しに1つだけで、行には出さない', () => {
    render(<FriendTrendTable trend={trendOf([['2026-09-20', true], ['2026-09-21', false]])} />)
    expect(screen.getAllByRole('button').length).toBe(1)
    expect(screen.getByRole('button', { name: '日付の推定値の説明' })).toBeTruthy()
  })

  it('推定の日とそうでない日が混ざるとき、行に小さく「推定」と出す', () => {
    const { container } = render(
      <FriendTrendTable trend={trendOf([['2026-09-20', true], ['2026-09-21', false]])} />,
    )
    expect(container.textContent).toContain('推定')
  })

  it('全行が推定のときは行から「推定」を消し、見出しの「？」の中で言う', () => {
    const { container } = render(
      <FriendTrendTable trend={trendOf([['2026-09-20', true], ['2026-09-21', true]])} />,
    )
    expect(container.textContent).not.toContain('推定')
    fireEvent.click(screen.getByRole('button', { name: '日付の推定値の説明' }))
    expect(screen.getByText(/この表の日はすべて推定です/).textContent).toContain('推定')
  })

  it('見出しの「？」を押すと推定の意味が出て、Esc で閉じる', () => {
    render(<FriendTrendTable trend={trendOf([['2026-09-20', true], ['2026-09-21', false]])} />)
    fireEvent.click(screen.getByRole('button', { name: '日付の推定値の説明' }))
    expect(screen.getByText(/日次の記録が始まる前/).textContent).toContain('逆算')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/日次の記録が始まる前/)).toBeNull()
  })

  it('空のときは空の文だけ出す', () => {
    const { container } = render(<FriendTrendTable trend={[]} />)
    expect(container.textContent).toContain('この期間の推移はまだありません')
    expect(container.querySelector('table')).toBeNull()
  })
})
