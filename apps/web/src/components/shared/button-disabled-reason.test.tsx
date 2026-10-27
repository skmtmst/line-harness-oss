// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button from './button'
import Dialog from './dialog'
afterEach(cleanup)
it('入力で直せる理由は常に見え、権限の理由は吹き出しにする', () => {
  const { rerender } = render(<Button variant="primary" disabled disabledReason="値を選ぶと保存できます。" disabledReasonPlacement="inline">保存する</Button>)
  expect(screen.getByRole('status').textContent).toBe('値を選ぶと保存できます。')
  expect(screen.getByRole('button').getAttribute('aria-description')).toBe('値を選ぶと保存できます。')
  const save = vi.fn()
  rerender(<Button variant="secondary" disabled disabledReason="管理者に頼んでください。" onClick={save}>保存する</Button>)
  expect(screen.queryByRole('status')).toBeNull()
  const button = screen.getByRole('button')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(button.getAttribute('aria-describedby')).toBeTruthy()
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip').textContent).toBe('管理者に頼んでください。')
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.click(button)
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('tooltip').textContent).toBe('管理者に頼んでください。')
  fireEvent.blur(button)
  fireEvent.pointerDown(button, { pointerType: 'touch' })
  expect(screen.getByRole('tooltip').textContent).toBe('管理者に頼んでください。')
})

it('Dialogは入力理由を本文に、権限理由を焦点可能な吹き出しに出せる', () => {
  const { rerender } = render(<Dialog open title="確認" confirmLabel="保存する" confirmDisabled confirmDisabledReason="項目を入力してください" onCancel={() => {}} onConfirm={() => {}} />)
  expect(screen.getByRole('status').textContent).toBe('項目を入力してください')
  rerender(<Dialog open title="確認" confirmLabel="保存する" confirmDisabled confirmDisabledReason="権限がありません" confirmDisabledReasonPlacement="tooltip" onCancel={() => {}} onConfirm={() => {}} />)
  expect(screen.queryByRole('status')).toBeNull()
  const button = screen.getByRole('button', { name: '保存する' })
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip').textContent).toBe('権限がありません')
})
