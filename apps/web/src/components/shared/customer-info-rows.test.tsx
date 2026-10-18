// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CustomerInfoRows } from './customer-info-rows'
import StatusBadge from './status-badge'
afterEach(cleanup)

it('長い項目名と長い値の対応と、省略時に読める全文を保持する', () => {
  const value = '@very_long_business_account（撮影用のお店）'
  const view = render(<CustomerInfoRows rows={[
    { label: '接続しているアカウント', value },
    { label: '最後に確かめた時刻', value: '10月2日（金）14:00' },
    { label: 'つないだお店', value: '撮影用 渋谷店' },
  ]} />)
  for (const term of view.container.querySelectorAll('dt')) expect(term.nextElementSibling?.tagName).toBe('DD')
  expect(screen.getByTitle(value).textContent).toBe(value)
  expect(view.container.querySelectorAll('dt')).toHaveLength(3)
})

it('状態の札と数字0を値として残し、再読込後の値へ更新する', () => {
  const view = render(<CustomerInfoRows rows={[{ label: 'いまの状態', value: <StatusBadge>接続済み</StatusBadge> }, { label: '件数', value: 0 }]} />)
  expect(screen.getByText('接続済み')).toBeTruthy()
  expect(screen.getByTitle('0').textContent).toBe('0')
  view.rerender(<CustomerInfoRows rows={[{ label: '最後に確かめた時刻', value: '未確認' }]} />)
  expect(screen.queryByText('接続済み')).toBeNull()
  expect(screen.getByTitle('未確認')).toBeTruthy()
})
