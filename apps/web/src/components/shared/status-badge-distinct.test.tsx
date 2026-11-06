// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import StatusBadge from './status-badge'
afterEach(cleanup)
test('同じ意味の状態を指定したときだけ重ねて描かない', () => {
  const props = { distinctFrom: '未対応' }
  render(<><StatusBadge>未対応</StatusBadge><StatusBadge {...props}>未対応</StatusBadge></>)
  expect(screen.getAllByText('未対応')).toHaveLength(1)
})
test('異なる対応マークと既定の札は残す', () => {
  const props = { distinctFrom: '未対応' }
  render(<><StatusBadge {...props} title="対応マーク：折り返し">折り返し</StatusBadge><StatusBadge>未対応</StatusBadge><StatusBadge>未対応</StatusBadge></>)
  expect(screen.getByTitle('対応マーク：折り返し')).toBeTruthy()
  expect(screen.getAllByText('未対応')).toHaveLength(2)
})
test('表示の言葉と余分な空白をそろえて比較する', () => {
  const props = { distinctFrom: '停止中' }
  const view = render(<StatusBadge {...props}>一時停止</StatusBadge>)
  expect(view.container.textContent).toBe('')
  view.rerender(<StatusBadge distinctFrom="未対応"> 未対応 </StatusBadge>)
  expect(view.container.textContent).toBe('')
})
