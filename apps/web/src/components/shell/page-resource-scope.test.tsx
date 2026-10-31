// @vitest-environment happy-dom
import { StrictMode, useLayoutEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PageResourceScope, { usePageResourceTask } from './page-resource-scope'

const route = vi.hoisted(() => ({ account: 'a', query: 'id=one&store=s1' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: route.account }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(route.query) }))

let tasks: Array<() => boolean>
function Editor() {
  const capture = usePageResourceTask()
  useLayoutEffect(() => { tasks.push(capture()) }, [capture])
  return <input aria-label="名前" defaultValue="入力" />
}
function Screen() { return <PageResourceScope queryKeys={['id', 'store']}><Editor /></PageResourceScope> }
beforeEach(() => { route.account = 'a'; route.query = 'id=one&store=s1'; tasks = [] })
afterEach(cleanup)

it.each(['account', 'id', 'store'])('対象の%sを替えたら旧処理を無効にし、元へ戻っても再有効にしない', key => {
  const view = render(<Screen />)
  const old = tasks[0]
  expect(old()).toBe(true)
  if (key === 'account') route.account = 'b'
  else route.query = key === 'id' ? 'id=two&store=s1' : 'id=one&store=s2'
  view.rerender(<Screen />)
  expect(old()).toBe(false)
  expect(tasks.at(-1)!()).toBe(true)
  route.account = 'a'; route.query = 'id=one&store=s1'
  view.rerender(<Screen />)
  expect(old()).toBe(false)
  expect(tasks.at(-1)!()).toBe(true)
  view.unmount()
  expect(tasks.at(-1)!()).toBe(false)
})

it('同じ対象のタブだけを替えても処理と入力を保つ', () => {
  const view = render(<Screen />)
  const input = view.getByRole('textbox') as HTMLInputElement
  input.value = '途中の入力'
  route.query += '&tab=settings'
  view.rerender(<Screen />)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]()).toBe(true)
  expect(view.getByRole('textbox')).toBe(input)
  expect(input.value).toBe('途中の入力')
})

it('StrictModeの再開始で、後片付け前に始めた処理を再有効にしない', () => {
  render(<StrictMode><Screen /></StrictMode>)
  expect(tasks).toHaveLength(2)
  expect(tasks[0]()).toBe(false)
  expect(tasks[1]()).toBe(true)
})
