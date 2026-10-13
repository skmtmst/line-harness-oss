// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Pause, Trash2 } from 'lucide-react'
import { StickyBarAction } from './sticky-bar'
afterEach(cleanup)
it('左の操作は印つきの副ボタン。押すと確認の口を1回だけ開く', () => {
  const open = vi.fn()
  render(<StickyBarAction label="保管する" icon={Pause} onClick={open} />)
  const button = screen.getByRole('button', { name: '保管する' })
  expect(button.className).toContain('secondary')
  expect(button.className).not.toContain('danger')
  expect(button.querySelector('svg')).not.toBeNull()
  fireEvent.click(button)
  expect(open).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('note')).toBeNull()
})
it('使われている物は削除せず、理由を見える文字と読み上げへ出す', () => {
  const open = vi.fn(), reason = '使っている所があるため削除できません'
  render(<StickyBarAction label="削除する" icon={Trash2} disabledReason={reason} onClick={open} />)
  const button = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(screen.getByRole('note').textContent).toBe(reason)
  expect(button.getAttribute('aria-description')).toBe(reason)
  fireEvent.click(button)
  expect(open).not.toHaveBeenCalled()
})
