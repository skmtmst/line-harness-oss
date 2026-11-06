// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InboxFloatingPanel } from './inbox-content'
import { InboxListRow } from './inbox-list'
import { InboxThreadLoading } from './inbox-thread'

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('選択中の会話だけを現在位置として伝える', () => {
  const view = render(<><InboxListRow selected>開いている相手</InboxListRow><InboxListRow selected={false}>ほかの相手</InboxListRow></>)
  expect(view.getByText('開いている相手').getAttribute('aria-current')).toBe('true')
  expect(view.getByText('ほかの相手').hasAttribute('aria-current')).toBe(false)
})

it('300ms以内に読み終わる会話には骨組みを見せない', async () => {
  const view = render(<InboxThreadLoading />)
  await act(async () => { await vi.advanceTimersByTimeAsync(299) })
  expect(view.container.querySelector('[data-skeleton-reserve]')).not.toBeNull()
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(view.container.querySelector('[data-skeleton]')).toBeNull()
})

it('浮き板は閉じ始めに操作を止め、途中で開き直せる', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const view = render(<InboxFloatingPanel open placement="above"><button>保存</button></InboxFloatingPanel>)
  view.rerender(<InboxFloatingPanel open={false} placement="above"><button>保存</button></InboxFloatingPanel>)
  expect(view.container.querySelector('[data-leaving]')?.hasAttribute('inert')).toBe(true)
  view.rerender(<InboxFloatingPanel open placement="above"><button>保存</button></InboxFloatingPanel>)
  expect(view.container.querySelector('[data-leaving]')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(80) })
  expect(view.getByText('保存')).not.toBeNull()
  view.rerender(<InboxFloatingPanel open={false} placement="above"><button>保存</button></InboxFloatingPanel>)
  await act(async () => { await vi.advanceTimersByTimeAsync(80) })
  expect(view.container.textContent).toBe('')
})

it('動きを減らす設定では浮き板を即時に閉じる', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<InboxFloatingPanel open placement="below">検索</InboxFloatingPanel>)
  view.rerender(<InboxFloatingPanel open={false} placement="below">検索</InboxFloatingPanel>)
  expect(view.container.textContent).toBe('')
})

it('一度出た骨組みは最低400ms残してから読み込んだ本文へ替える', async () => {
  const view = render(<InboxThreadLoading loading />)
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  view.rerender(<InboxThreadLoading loading={false}>読み込んだ会話</InboxThreadLoading>)
  expect(view.container.querySelector('[data-skeleton]')).not.toBeNull()
  expect(view.container.textContent).not.toContain('読み込んだ会話')
  await act(async () => { await vi.advanceTimersByTimeAsync(399) })
  expect(view.container.querySelector('[data-skeleton]')).not.toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(view.container.textContent).toBe('読み込んだ会話')
})
