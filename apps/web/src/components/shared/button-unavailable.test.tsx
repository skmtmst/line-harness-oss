// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Button from './button'

afterEach(cleanup)

it('押せない条件の理由を結び付け、条件が解消したら外す', () => {
  const save = vi.fn()
  const { rerender } = render(<Button disabled disabledReason="名前を入れてください" onClick={save}>保存する</Button>)
  const button = screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toBe('名前を入れてください')
  expect(button.getAttribute('aria-description')).toBe(button.title)
  fireEvent.click(button); expect(save).not.toHaveBeenCalled()
  rerender(<Button disabled={false} disabledReason="名前を入れてください" onClick={save}>保存する</Button>)
  expect(button.disabled).toBe(false)
  expect(button.hasAttribute('title')).toBe(false)
  expect(button.hasAttribute('aria-description')).toBe(false)
  fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1)
})

it('理由だけでは操作を止めず、既存の説明と保存中の状態を保つ', () => {
  const { rerender } = render(<Button disabledReason="未変更です" title="下書きを保存します">保存する</Button>)
  const button = screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  expect(button.title).toBe('下書きを保存します')
  rerender(<Button busy busyLabel="保存中…" disabledReason="未変更です">保存する</Button>)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.textContent).toBe('保存中…')
})
