// @vitest-environment happy-dom
/* 動きの点検（2026-10-07）17 番：消しても 5 秒は「元に戻す」で取り消せる削除。 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import { useDeferredDelete, type DeferredDelete } from './use-deferred-delete'

let api: DeferredDelete
function Rows({ ids }: { ids: string[] }) {
  api = useDeferredDelete()
  return (
    <ul>
      {ids.filter((id) => !api.isHidden(id)).map((id) => <li key={id}>{id}</li>)}
    </ul>
  )
}

beforeEach(() => {
  clearToastsForTest()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  clearToastsForTest()
  vi.useRealTimers()
})

const rows = () => [...document.querySelectorAll('li')].map((el) => el.textContent)

describe('5秒は取り消せる削除（useDeferredDelete）', () => {
  it('押した瞬間に行を隠し、5秒たつまで消さない。消したら読み直してから印を外す', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    const reload = vi.fn().mockResolvedValue(undefined)
    render(<><ToastHost /><Rows ids={['a', 'b']} /></>)
    act(() => api.schedule({ ids: ['a'], message: '「a」を削除しました', commit, onCommitted: reload }))
    expect(rows()).toEqual(['b'])
    expect(screen.getByText('「a」を削除しました')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(api.hiddenCount).toBe(0)
  })

  it('「元に戻す」で送らずに行を戻す', async () => {
    const commit = vi.fn().mockResolvedValue({ success: true })
    render(<><ToastHost /><Rows ids={['a', 'b']} /></>)
    act(() => api.schedule({ ids: ['a'], message: '消しました', commit }))
    expect(rows()).toEqual(['b'])
    act(() => { screen.getByRole('button', { name: '元に戻す' }).click() })
    expect(rows()).toEqual(['a', 'b'])
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(commit).not.toHaveBeenCalled()
  })

  it('消すのに失敗したら行を戻して知らせる', async () => {
    const commit = vi.fn().mockResolvedValue({ success: false, error: 'x' })
    render(<><ToastHost /><Rows ids={['a', 'b']} /></>)
    act(() => api.schedule({ ids: ['a'], message: '消しました', commit, failureMessage: '消せませんでした。' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(rows()).toEqual(['a', 'b'])
    expect(screen.getByText('消せませんでした。')).toBeTruthy()
  })
})
