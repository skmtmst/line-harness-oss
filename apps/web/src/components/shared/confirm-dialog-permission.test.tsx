// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ConfirmDialog from './confirm-dialog'

afterEach(cleanup)
const base = { open: true, title: 'フォルダへ移しますか？', description: '移動先を選んでください。', confirmLabel: '移動する', onCancel: () => {} }

it('権限の理由をDialogへ転送し、入力を保ったまま実行を0→1へ切り替える', () => {
  const confirm = vi.fn(), props = { ...base, onConfirm: confirm, children: <input aria-label="移動先" defaultValue="問合せ" /> }
  const view = render(<ConfirmDialog {...props} />)
  const field = screen.getByRole('textbox', { name: '移動先' })
  view.rerender(<ConfirmDialog {...props} confirmDisabled confirmLockedReason="この操作は管理者だけができます。" />)
  const button = screen.getByRole('button', { name: '移動する' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.hasAttribute('data-permission-locked')).toBe(true)
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('この操作は管理者だけができます。')
  fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.keyDown(button, { key: ' ' })
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '移動先' })).toBe(field)
  expect(field).toHaveProperty('value', '問合せ')
  view.rerender(<ConfirmDialog {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '移動する' }))
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('入力や状態で無効な時はnative disabledと理由1行を保ち、権限印を付けない', () => {
  const confirm = vi.fn()
  render(<ConfirmDialog {...base} onConfirm={confirm} confirmDisabled confirmDisabledReason="移動先を選んでください" />)
  const button = screen.getByRole('button', { name: '移動する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
  expect(screen.getAllByText('移動先を選んでください')).toHaveLength(1)
  fireEvent.click(button); expect(confirm).not.toHaveBeenCalled()
})

it('本人確認中の無効は理由を作らず、通常disabledのまま実行しない', () => {
  const confirm = vi.fn()
  render(<ConfirmDialog {...base} onConfirm={confirm} confirmDisabled />)
  const button = screen.getByRole('button', { name: '移動する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(document.querySelector('[data-permission-locked], [data-read-only-notice]')).toBeNull()
  fireEvent.click(button); expect(confirm).not.toHaveBeenCalled()
})
