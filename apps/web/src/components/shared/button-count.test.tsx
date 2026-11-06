// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button, { AccountActionButton } from './button'

afterEach(cleanup)

it('条件数を読み上げられる丸で示し、0と未取得では出さない', () => {
  const { rerender } = render(<Button count={4}>絞り込み</Button>)
  expect(screen.getByLabelText('4件の条件').textContent).toBe('4')
  expect(screen.getByRole('button').hasAttribute('count')).toBe(false)
  rerender(<Button count={4} aria-label="絞り込み">絞り込み</Button>)
  expect(screen.getByRole('button', { name: '絞り込み 4件の条件' })).toBeTruthy()
  for (const count of [0, undefined, NaN, -1]) {
    rerender(<Button count={count}>絞り込み</Button>)
    expect(screen.queryByLabelText(/件の条件/)).toBeNull()
  }
})

it('条件数付きでも操作を実行でき、リンクにも同じ形を出す', () => {
  const apply = vi.fn()
  const { rerender } = render(<Button count={2} onClick={apply}>絞り込み</Button>)
  fireEvent.click(screen.getByRole('button'))
  expect(apply).toHaveBeenCalledOnce()
  rerender(<Button href="/friends" count={2}>友だち</Button>)
  expect(screen.getByRole('link').getAttribute('href')).toBe('/friends')
  expect(screen.getByLabelText('2件の条件')).toBeTruthy()
})

it('アカウントの詳細だけ印を置かず、他の操作は対応する印と動作を保つ', () => {
  const act = vi.fn()
  const { container, rerender } = render(<AccountActionButton action="detail" onClick={act} />)
  expect(container.querySelector('svg')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '詳細' }))
  expect(act).toHaveBeenCalledOnce()
  for (const action of ['enter', 'settings', 'restore'] as const) {
    rerender(<AccountActionButton action={action} />)
    expect(container.querySelector('svg')).not.toBeNull()
  }
})
