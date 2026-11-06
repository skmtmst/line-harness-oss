// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ActionMenu from './action-menu'

afterEach(cleanup)

it('未指定の印・明示した印・印なしを区別し、操作と無効を保つ', () => {
  const select = vi.fn()
  const disabledSelect = vi.fn()
  const close = vi.fn()
  render(<ActionMenu open inline onClose={close} items={[
    { id: 'default', label: '履歴を見る', onSelect: select },
    { id: 'custom', label: '内容を見る', icon: <svg data-custom-icon aria-hidden="true" />, onSelect: select },
    { id: 'none', label: '初期値へ戻す', icon: null, onSelect: select },
    { id: 'disabled', label: '初期値へ戻せない', icon: null, disabled: true, onSelect: disabledSelect },
  ]} />)
  expect(screen.getByRole('menuitem', { name: '履歴を見る' }).querySelectorAll('svg')).toHaveLength(1)
  const custom = screen.getByRole('menuitem', { name: '内容を見る' })
  expect(custom.querySelectorAll('svg')).toHaveLength(1)
  expect(custom.querySelector('[data-custom-icon]')).not.toBeNull()
  const noIcon = screen.getByRole('menuitem', { name: '初期値へ戻す' })
  expect(noIcon.querySelector('svg')).toBeNull()
  fireEvent.click(noIcon)
  expect(select).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
  const disabled = screen.getByRole('menuitem', { name: '初期値へ戻せない' }) as HTMLButtonElement
  expect(disabled.querySelector('svg')).toBeNull()
  expect(disabled.disabled).toBe(true)
  fireEvent.click(disabled)
  expect(disabledSelect).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})
