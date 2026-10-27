// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ArrowRight } from 'lucide-react'
import Button from '@/components/shared/button'
import { normalizeProgressActionArrows } from './page-action-nodes'

afterEach(cleanup)

it('作成フローの「次へ」は矢印をラベルの後ろにそろえる', () => {
  const actions = normalizeProgressActionArrows(<Button variant="primary"><ArrowRight aria-hidden="true" />次へ</Button>)
  render(actions)
  const button = screen.getByRole('button', { name: '次へ' })
  expect(button.firstChild?.textContent).toBe('次へ')
  expect(button.lastChild).toBe(button.querySelector('svg'))
})

it('矢印がない「次へ」には共有の右矢印を足す', () => {
  render(normalizeProgressActionArrows(<><Button variant="primary">次へ</Button></>))
  const button = screen.getByRole('button', { name: '次へ' })
  expect(button.querySelector('svg')).not.toBeNull()
  expect(button.firstChild?.textContent).toBe('次へ')
})
