// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ push: vi.fn(), close: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, replace: vi.fn(), back: vi.fn() }) }))
vi.mock('./api', async importOriginal => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, aiReplyApi: { ...actual.aiReplyApi, createQa: f.create, updateQa: f.update } }
})
import QaEditDialog from './qa-edit-dialog'

beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/auto-replies?tab=qa') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('Q&A の未保存入力を画面内リンクから守り、続行で保持する', () => {
  render(<QaEditDialog open accountId="a" seed={{}} canPublish onSaved={vi.fn()} onClose={f.close} />)
  fireEvent.change(screen.getByRole('textbox', { name: /質問/ }), { target: { value: '質問の下書き' } })
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  const confirmation = screen.getByRole('dialog', { name: '保存していない変更があります' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '編集を続ける' }))
  expect(screen.getByRole('textbox', { name: /質問/ })).toHaveProperty('value', '質問の下書き')
  expect(f.push).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled()
  a.remove()
})

it('Q&A の未保存入力がある戻るは一度だけ復元し、明示破棄で移動する', () => {
  render(<QaEditDialog open accountId="a" seed={{}} canPublish onSaved={vi.fn()} onClose={f.close} />)
  fireEvent.change(screen.getByRole('textbox', { name: /答え/ }), { target: { value: '答えの下書き' } })
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  fireEvent.popState(window)
  expect(go).toHaveBeenCalledExactlyOnceWith(1)
  fireEvent.popState(window)
  const confirmation = screen.getByRole('dialog', { name: '保存していない変更があります' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '保存せずに移る' }))
  expect(back).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1)
})

it('閉じて開き直すと保留の行き先を持ち越さず、再読込も未保存時だけ止める', () => {
  const seed = {}
  const view = render(<QaEditDialog open accountId="a" seed={seed} canPublish onSaved={vi.fn()} onClose={f.close} />)
  const cleanEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanEvent); expect(cleanEvent.defaultPrevented).toBe(false)
  fireEvent.change(screen.getByRole('textbox', { name: /質問/ }), { target: { value: '下書き' } })
  const dirtyEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirtyEvent); expect(dirtyEvent.defaultPrevented).toBe(true)
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  fireEvent.click(a)
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
  view.rerender(<QaEditDialog open={false} accountId="a" seed={seed} canPublish onSaved={vi.fn()} onClose={f.close} />)
  view.rerender(<QaEditDialog open accountId="a" seed={seed} canPublish onSaved={vi.fn()} onClose={f.close} />)
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
  expect(screen.getByRole('textbox', { name: /質問/ })).toHaveProperty('value', '')
  expect(f.push).not.toHaveBeenCalled()
  a.remove()
})

it('アカウントが変わると古い行き先の確認を持ち越さない', () => {
  const seed = {}
  const view = render(<QaEditDialog open accountId="a" seed={seed} canPublish onSaved={vi.fn()} onClose={f.close} />)
  fireEvent.change(screen.getByRole('textbox', { name: /質問/ }), { target: { value: '下書き' } })
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  fireEvent.click(a)
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
  view.rerender(<QaEditDialog open accountId="b" seed={seed} canPublish onSaved={vi.fn()} onClose={f.close} />)
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
  expect(f.push).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled()
  a.remove()
})

it('保存中の移動は止め、離脱の確定を出さない', () => {
  f.create.mockReturnValue(new Promise(() => {}))
  render(<QaEditDialog open accountId="a" seed={{}} canPublish onSaved={vi.fn()} onClose={f.close} />)
  fireEvent.change(screen.getByRole('textbox', { name: /質問/ }), { target: { value: '質問' } })
  fireEvent.change(screen.getByRole('textbox', { name: /答え/ }), { target: { value: '答え' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きで保存する' }))
  expect(f.create).toHaveBeenCalledTimes(1)
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
  expect(f.push).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled()
  a.remove()
})

it('変更のない既存項目でも保存中は移動を止める', () => {
  f.update.mockReturnValue(new Promise(() => {}))
  const entry = { id: '1', questions: ['質問'], answerText: '答え', status: 'draft' as const, source: 'manual' as const, useCount: 0, version: 1, updatedAt: '2026-01-01' }
  render(<QaEditDialog open accountId="a" seed={{ entry }} canPublish onSaved={vi.fn()} onClose={f.close} />)
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  expect(f.update).toHaveBeenCalledTimes(1)
  const a = document.createElement('a'); a.href = '/templates'; document.body.appendChild(a)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
  a.remove()
})
