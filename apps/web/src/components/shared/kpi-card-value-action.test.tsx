// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import KpiCard from './kpi-card'

afterEach(cleanup)

it('内訳のない数字には操作を作らず、既存の行き先だけをリンクにする', () => {
  render(<KpiCard title="友だち" value={12} unit="人" detail="登録済み" action={{ label: '友だちを見る', href: '/friends' }} />)
  expect(screen.queryByRole('button')).toBeNull()
  const link = screen.getByRole('link', { name: '友だちを見る' })
  expect(link.getAttribute('href')).toBe('/friends')
  expect(link.closest('[data-kpi-detail]')).not.toBeNull()
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

it('行き先を値の行へ移しても、補足と増減を混ぜず同じリンクを一つだけ出す', () => {
  render(<KpiCard title="接続に問題" value={2} unit="件" detail="確認してください" actionPlacement="value-row" action={{ label: '対応が要るものへ', href: '/hq/attention?kind=connections' }} />)
  const link = screen.getByRole('link', { name: '対応が要るものへ' })
  expect(link.getAttribute('href')).toBe('/hq/attention?kind=connections')
  expect(link.closest('[data-kpi-fit]')).not.toBeNull()
  expect(link.closest('[data-kpi-detail], [data-kpi-delta-slot]')).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(1)
})

it('値の行に置く操作も共通のボタンとして実行できる', () => {
  const onClick = vi.fn()
  render(<KpiCard title="接続に問題" value={2} unit="件" detail="" actionPlacement="value-row" action={{ label: '対応が要るものへ', onClick }} />)
  const button = screen.getByRole('button', { name: '対応が要るものへ' })
  expect(button.closest('[data-kpi-fit]')).not.toBeNull()
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
  expect(document.querySelector('[data-kpi-detail-present]')).toBeNull()
})
