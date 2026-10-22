// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KpiCard from './kpi-card'

afterEach(cleanup)

it('内訳のない数字には操作を作らず、既存の行き先だけをリンクにする', () => {
  render(<KpiCard title="友だち" value={12} unit="人" detail="登録済み" action={{ label: '友だちを見る', href: '/friends' }} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByRole('link', { name: '友だちを見る' }).getAttribute('href')).toBe('/friends')
})

it('数から既存の内訳を開閉でき、読み込み中は操作できない', () => {
  const onClick = vi.fn()
  const props = { title: '今日の予約', value: 3, unit: '件', detail: '次の予定 16:00', valueAction: { label: '今日の予約の内訳を見る', expanded: false, onClick } }
  const { rerender } = render(<KpiCard {...props} />)
  const button = screen.getByRole('button', { name: props.valueAction.label })
  expect(button.textContent).toBe('3件')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
  rerender(<KpiCard {...props} valueAction={{ ...props.valueAction, expanded: true }} />)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  rerender(<KpiCard {...props} loading />)
  expect(screen.queryByRole('button')).toBeNull()
})

it('数字を押して操作を開き、項目の処理と閉じる動きを保つ', () => {
  const onOpenChange = vi.fn(), onSelect = vi.fn()
  const valueMenu = { label: '経路の操作', open: false, onOpenChange, items: [{ id: 'filter', label: 'この経路だけに絞る', onSelect }] }
  const { rerender } = render(<KpiCard title="動きが未設定" value={2} unit="件" valueMenu={valueMenu} />)
  fireEvent.click(screen.getByRole('button', { name: valueMenu.label }))
  expect(onOpenChange).toHaveBeenCalledWith(true)
  rerender(<KpiCard title="動きが未設定" value={2} unit="件" valueMenu={{ ...valueMenu, open: true }} />)
  fireEvent.click(screen.getByRole('menuitem', { name: 'この経路だけに絞る' }))
  expect(onSelect).toHaveBeenCalledOnce()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
