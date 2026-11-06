// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/v8/analytics/analytics', () => ({ default: ({ slots }: { slots: { renderSave: (props: unknown) => React.ReactNode } }) => slots.renderSave({ accountId: 'a', sourceKind: 'cross', sourceResultId: 'r', defaultName: '元の分析' }) }))
vi.mock('@/v8/analytics/funnel-form', () => ({ default: () => null }))
vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: { analytics: { saved: { create: f.save } } } }))
import AnalyticsPage from './page'
import { requestUnsavedAction } from '@/lib/unsaved-action'
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/analytics?tab=cross') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('保存前の分析名をリンク移動から守り、続行で保持する', () => {
  render(<AnalyticsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '入力途中の分析名' } })
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  fireEvent.click(within(screen.getByRole('dialog', { name: '保存していない変更があります' })).getByRole('button', { name: '編集を続ける' }))
  expect(screen.getByLabelText('保存する分析名')).toHaveProperty('value', '入力途中の分析名')
  expect(f.push).not.toHaveBeenCalled(); a.remove()
})

it('いったん閉じて保持している分析名も戻るから守る', () => {
  render(<AnalyticsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '入力途中の分析名' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  fireEvent.popState(window)
  expect(go).toHaveBeenCalledExactlyOnceWith(1)
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})

it('保存名が未保存の間は画面内の置き換え操作も確かめる', () => {
  render(<AnalyticsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '入力途中の分析名' } })
  const replace = vi.fn()
  act(() => requestUnsavedAction(replace))
  expect(replace).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog', { name: '保存していない変更があります' })).getByRole('button', { name: '保存せずに移る' }))
  expect(replace).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'この分析を保存' })).toBeTruthy()
})

it('保存成功後は離脱確認を残さない', async () => {
  f.save.mockResolvedValue({ success: true, data: {} })
  render(<AnalyticsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '保存する名前' } })
  fireEvent.click(screen.getByRole('button', { name: 'この名前で保存する' }))
  await waitFor(() => expect(screen.getByText('定義とこの時点の結果を保存しました')).toBeTruthy())
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false)
  expect(f.save).toHaveBeenCalledOnce()
})

it('保存中は画面内の置き換え操作を止める', () => {
  f.save.mockReturnValue(new Promise(() => {}))
  render(<AnalyticsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '保存する名前' } })
  fireEvent.click(screen.getByRole('button', { name: 'この名前で保存する' }))
  const replace = vi.fn(); act(() => requestUnsavedAction(replace))
  expect(replace).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
})
