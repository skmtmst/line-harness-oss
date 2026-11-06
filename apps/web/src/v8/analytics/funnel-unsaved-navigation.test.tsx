// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ push: vi.fn(), close: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: {
  conversions: { definitions: async () => ({ success: true, data: { items: [] } }) },
  tags: { list: async () => ({ success: true, data: [] }) },
  forms: { list: async () => ({ success: true, data: [] }) },
  analytics: { v6Funnels: { create: vi.fn(), createVersion: vi.fn(), get: vi.fn() } },
} }))
import FunnelFormV8 from './funnel-form'
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/analytics') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('ファネルの未保存入力をリンク移動から守り、続行で保持する', () => {
  render(<FunnelFormV8 accountId="a" onCancel={f.close} onCreated={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('名前', { exact: true }), { target: { value: '下書きの名前' } })
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  const leave = screen.getByRole('dialog', { name: '保存していない変更があります' })
  fireEvent.click(within(leave).getByRole('button', { name: '編集を続ける' }))
  expect(screen.getByLabelText('名前', { exact: true })).toHaveProperty('value', '下書きの名前')
  expect(f.close).not.toHaveBeenCalled(); expect(f.push).not.toHaveBeenCalled(); a.remove()
})

it('ファネルの未保存入力がある戻るを一度だけ復元し、破棄して進む', () => {
  render(<FunnelFormV8 accountId="a" onCancel={f.close} onCreated={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('名前', { exact: true }), { target: { value: '下書きの名前' } })
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  fireEvent.popState(window)
  expect(go).toHaveBeenCalledExactlyOnceWith(1)
  fireEvent.popState(window)
  fireEvent.click(within(screen.getByRole('dialog', { name: '保存していない変更があります' })).getByRole('button', { name: '保存せずに移る' }))
  expect(f.close).toHaveBeenCalledTimes(1); expect(back).toHaveBeenCalledTimes(1)
})

it('ファネルの窓を閉じるときは内容を確認し、続けると保持する', () => {
  render(<FunnelFormV8 accountId="a" onCancel={f.close} onCreated={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('名前', { exact: true }), { target: { value: '下書きの名前' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル', exact: true }))
  const local = screen.getByRole('dialog', { name: '入力を破棄しますか？' })
  fireEvent.click(within(local).getByRole('button', { name: '編集を続ける' }))
  expect(screen.getByLabelText('名前', { exact: true })).toHaveProperty('value', '下書きの名前')
  expect(f.close).not.toHaveBeenCalled()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
})

it('変更がなければ移動を止めず、段の追加だけでも未保存として守る', () => {
  render(<FunnelFormV8 accountId="a" onCancel={f.close} onCreated={vi.fn()} />)
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const clean = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '＋ 段を足す' }))
  const dirty = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(dirty) }); expect(dirty.defaultPrevented).toBe(true)
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
  a.remove()
})
