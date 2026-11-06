// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import Button from '@/components/shared/button'
import { headingActionNodes, normalizeProgressActionArrows } from './page-action-nodes'

afterEach(cleanup)

it('作成フローの「次へ」は矢印をラベルの後ろにそろえる', () => {
  const actions = normalizeProgressActionArrows(<Button variant="primary"><ArrowRight aria-hidden="true" />次へ</Button>)
  render(actions)
  const button = screen.getByRole('button', { name: '次へ' })
  expect(button.firstChild?.textContent).toBe('次へ')
  expect(button.lastChild).toBe(button.querySelector('svg'))
})

it('別の包みの操作が消えても、残った操作の失敗状態を保つ', async () => {
  const actions = (first: boolean) => headingActionNodes([
    <Fragment key="first">{first ? <Button>先頭</Button> : null}</Fragment>,
    <Fragment key="second"><Button onClick={() => Promise.reject(new Error('失敗'))}>次の操作</Button></Fragment>,
  ])
  const { rerender } = render(<>{actions(true)}</>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '次の操作' })) })
  expect(screen.getByRole('alert')).toBeTruthy()
  rerender(<>{actions(false)}</>)
  expect(screen.queryByRole('button', { name: '先頭' })).toBeNull()
  expect(screen.getByRole('alert')).toBeTruthy()
})

it('矢印がない「次へ」には共有の右矢印を足す', () => {
  render(normalizeProgressActionArrows(<><Button variant="primary">次へ</Button></>))
  const button = screen.getByRole('button', { name: '次へ' })
  expect(button.querySelector('svg')).not.toBeNull()
  expect(button.firstChild?.textContent).toBe('次へ')
})
