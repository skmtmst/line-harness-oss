// @vitest-environment happy-dom
import React, { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ListState from './list-state'
import { ListNavigationAccount } from './list-navigation'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

it('読み込みが7999msまでは案内せず、8000msで案内しても読み込みのまま', async () => {
  render(<ListState kind="loading" />)
  await act(async () => { await vi.advanceTimersByTimeAsync(7999) })
  expect(screen.queryByText('時間がかかっています')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.queryByText('時間がかかっています')).not.toBeNull()
  expect(document.querySelector('[data-list-state="loading"][aria-busy="true"]')).not.toBeNull()
  expect(document.querySelector('[data-list-state="error"]')).toBeNull()
  expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
})

const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const hint = () => screen.queryByText('時間がかかっています')

it('親が描き直されても同じ待機の時計を巻き戻さない', async () => {
  const view = render(<ListState kind="loading" title="一覧を読み込んでいます" />)
  await tick(7000)
  view.rerender(<ListState kind="loading" title="一覧を引き続き読み込んでいます" />)
  await tick(999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
})

it.each(['empty', 'error'] as const)('7999msで%sへ変われば案内せずタイマーも残さない', async kind => {
  const view = render(<ListState kind="loading" />)
  await tick(7999)
  view.rerender(<ListState kind={kind} />)
  await tick(1)
  expect(hint()).toBeNull()
  expect(document.querySelector('[data-list-state="loading"]')).toBeNull()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('案内が出たあと完了すれば読み込みと案内を消す', async () => {
  const view = render(<ListState kind="loading" />)
  await tick(8000)
  expect(hint()).not.toBeNull()
  view.rerender(<ListState kind="empty" />)
  expect(hint()).toBeNull()
  expect(document.querySelector('[data-list-state="empty"]')).not.toBeNull()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('閉じて再表示すると待機は0秒から数える', async () => {
  const view = render(<ListState kind="loading" />)
  await tick(7999)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  render(<ListState kind="loading" />)
  await tick(7999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
})

it('失敗後の再読み込みは新しく8秒を数え、勝手に再試行しない', async () => {
  const retry = vi.fn()
  const view = render(<ListState kind="loading" onRetry={retry} />)
  await tick(8000)
  view.rerender(<ListState kind="error" onRetry={retry} />)
  expect(hint()).toBeNull()
  view.rerender(<ListState kind="loading" onRetry={retry} />)
  await tick(7999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
  expect(retry).not.toHaveBeenCalled()
})

it('AからBさらにAへ切り替えても前の経過を一描画も表示しない', async () => {
  const loading = (account: string | null) => <ListNavigationAccount.Provider value={account}><ListState kind="loading" /></ListNavigationAccount.Provider>
  const view = render(loading('A'))
  await tick(8000)
  expect(hint()).not.toBeNull()
  view.rerender(loading('B'))
  expect(hint()).toBeNull()
  await tick(7999)
  expect(hint()).toBeNull()
  view.rerender(loading('A'))
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).toBeNull()
  await tick(7999)
  expect(hint()).not.toBeNull()
})

it('開発時の二度の付け外しでもタイマーを二重に残さない', async () => {
  const view = render(<StrictMode><ListState kind="loading" /></StrictMode>)
  // 遅延骨格と8秒案内が1つずつ。StrictModeの最初のtimerはcleanupされる。
  expect(vi.getTimerCount()).toBe(2)
  await tick(8000)
  expect(screen.queryAllByText('時間がかかっています')).toHaveLength(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('8秒案内は処理中の範囲の外へ出し、骨格の処理中の印を保つ', async () => {
  render(<ListState kind="loading" />)
  await tick(8000)
  expect(hint()).not.toBeNull()
  expect(hint()?.getAttribute('role')).toBe('status')
  expect(hint()?.closest('[aria-busy="true"]')).toBeNull()
  expect(document.querySelector('[data-list-state="loading"][aria-busy="true"]')).not.toBeNull()
})
