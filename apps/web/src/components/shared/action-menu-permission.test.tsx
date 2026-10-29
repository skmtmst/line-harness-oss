// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ActionMenu from './action-menu'

afterEach(cleanup)

const reason = 'この機能を変える権限がありません。オーナーか管理者に頼んでください。'

it('権限の項目は焦点と理由を保ち、リンク・押下・Enter・Spaceを起動しない', () => {
  const select = vi.fn(), close = vi.fn()
  render(<ActionMenu open inline onClose={close} items={[
    { id: 'locked', label: '設定を開く', href: '/settings/features', external: true, lockedReason: reason, onSelect: select },
  ]} />)
  const item = screen.getByRole('menuitem', { name: /^設定を開く/ }) as HTMLButtonElement
  expect(item.tagName).toBe('BUTTON')
  expect(item.disabled).toBe(false)
  expect(item.tabIndex).toBe(0)
  expect(item.getAttribute('aria-disabled')).toBe('true')
  for (const attr of ['href', 'target', 'rel']) expect(item.hasAttribute(attr)).toBe(false)
  expect(document.getElementById(item.getAttribute('aria-describedby')!)?.textContent).toBe(reason)
  expect(document.getElementById(item.getAttribute('aria-describedby')!)?.hidden).toBe(true)
  act(() => item.focus())
  expect(document.activeElement).toBe(item)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  expect(fireEvent.keyDown(item, { key: 'Enter' })).toBe(false)
  expect(fireEvent.keyDown(item, { key: ' ' })).toBe(false)
  fireEvent.click(item)
  expect(select).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('乗せる・焦点・タップで理由を確認し、離れたら吹き出しを閉じる', () => {
  render(<ActionMenu open inline onClose={vi.fn()} items={[{ id: 'locked', label: '設定を変える', lockedReason: reason }]} />)
  const item = screen.getByRole('menuitem')
  fireEvent.pointerEnter(item, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  fireEvent.pointerLeave(item, { pointerType: 'mouse' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.pointerDown(item, { pointerType: 'touch' })
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  act(() => item.focus())
  fireEvent.pointerLeave(item, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  act(() => item.blur())
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('初期焦点と矢印は権限の項目へ届き、入力不足のnative disabledは飛ばす', async () => {
  const select = vi.fn()
  render(<ActionMenu open onClose={vi.fn()} items={[
    { id: 'locked', label: 'Aを見る', lockedReason: reason, onSelect: select },
    { id: 'input', label: 'Bを見る', disabled: true, disabledReason: '入力してください', onSelect: select },
    { id: 'normal', label: 'Cを見る', onSelect: select },
  ]} />)
  const locked = screen.getByRole('menuitem', { name: /^Aを見る/ })
  const normal = screen.getByRole('menuitem', { name: 'Cを見る' })
  await waitFor(() => expect(document.activeElement).toBe(locked))
  fireEvent.keyDown(locked, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(normal)
  fireEvent.keyDown(normal, { key: 'Home' })
  expect(document.activeElement).toBe(locked)
  fireEvent.keyDown(locked, { key: 'End' })
  expect(document.activeElement).toBe(normal)
  fireEvent.keyDown(normal, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(locked)
  const input = screen.getByRole('menuitem', { name: /^Bを見る/ }) as HTMLButtonElement
  expect(input.disabled).toBe(true)
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.hidden).toBe(false)
  expect(input.hasAttribute('data-permission-locked')).toBe(false)
  fireEvent.click(input)
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(normal)
  expect(select).toHaveBeenCalledTimes(1)
})

it('権限と無効はcontent内の別操作を起動させず、許可されたcontentを維持する', () => {
  const nested = vi.fn(), select = vi.fn()
  const content = <button onClick={nested}>内部の操作</button>
  const { rerender } = render(<ActionMenu open inline onClose={vi.fn()} items={[
    { id: 'content', label: '実行する', content, lockedReason: reason, onSelect: select },
  ]} />)
  expect(screen.queryByRole('button', { name: '内部の操作' })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: /^実行する/ }))
  expect(nested).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
  rerender(<ActionMenu open inline onClose={vi.fn()} items={[{ id: 'content', label: '実行する', content, disabled: true, onSelect: select }]} />)
  fireEvent.click(screen.getByRole('menuitem', { name: '実行する' }))
  expect(nested).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
  rerender(<ActionMenu open inline onClose={vi.fn()} items={[{ id: 'content', label: '実行する', content, onSelect: select }]} />)
  fireEvent.click(screen.getByRole('button', { name: '内部の操作' }))
  expect(nested).toHaveBeenCalledTimes(1)
})
