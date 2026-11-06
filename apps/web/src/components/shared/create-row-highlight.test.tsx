// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { DataTable, Tr, Td } from './table'
import { flushListUrlState } from './list-url-state'
afterEach(() => { cleanup(); flushListUrlState(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })
const rows = (ready = true) => <DataTable><tbody>{ready ? <><Tr data-row-id="old"><Td>既存</Td></Tr><Tr data-row-id="new"><Td>新規</Td></Tr></> : null}</tbody></DataTable>
test('表示した行の印だけを一度消費し、同条件の再描画や戻りで繰り返さない', () => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/list?highlight=new&q=条件#list')
  const view = render(rows())
  expect(screen.getByText('新規').closest('tr')?.getAttribute('data-created-highlight')).toBe('true')
  expect(screen.getByText('既存').closest('tr')?.getAttribute('data-created-highlight')).toBeNull()
  flushListUrlState()
  expect(window.location.search).toBe('?q=%E6%9D%A1%E4%BB%B6')
  expect(window.location.hash).toBe('#list')
  act(() => vi.advanceTimersByTime(201))
  view.rerender(rows())
  expect(screen.getByText('新規').closest('tr')?.hasAttribute('data-created-highlight')).toBe(false)
  view.unmount()
  render(rows())
  expect(screen.getByText('新規').closest('tr')?.hasAttribute('data-created-highlight')).toBe(false)
})
test('読み込み中・対象行がないときはURLの印を消費しない', () => {
  window.history.replaceState(null, '', '/list?highlight=new')
  const view = render(rows(false))
  flushListUrlState()
  expect(window.location.search).toBe('?highlight=new')
  view.rerender(rows())
  flushListUrlState()
  expect(window.location.search).toBe('')
  expect(screen.getByText('新規').closest('tr')?.getAttribute('data-created-highlight')).toBe('true')
})
