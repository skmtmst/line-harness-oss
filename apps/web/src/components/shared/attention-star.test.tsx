// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AttentionStar from './attention-star'

afterEach(cleanup)

it('注目の状態を読み上げ、保存は呼び出し元へ渡す', () => {
  const onClick = vi.fn()
  const { rerender } = render(<AttentionStar pressed={false} onClick={onClick} aria-label="注目にする" />)
  const button = screen.getByRole('button', { name: '注目にする' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.getAttribute('type')).toBe('button')
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(button.getAttribute('aria-pressed')).toBe('false')
  rerender(<AttentionStar pressed onClick={onClick} aria-label="注目を外す" disabled />)
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
})
