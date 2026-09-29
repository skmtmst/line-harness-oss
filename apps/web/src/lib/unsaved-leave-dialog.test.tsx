// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UnsavedLeaveDialog } from './unsaved-leave-dialog'

afterEach(cleanup)

describe('UnsavedLeaveDialog（未保存ガードの共通窓）', () => {
  it('文言は固定で、画面ごとの違いは subject の名詞だけ', () => {
    render(<UnsavedLeaveDialog open subject="入力した共通情報" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '保存していない変更があります' })).toBeTruthy()
    expect(screen.getByText('このまま移動すると、入力した共通情報は失われます。保存せずに移動しますか？')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存せずに移動' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '編集を続ける' })).toBeTruthy()
  })

  it('subject を省いたときは「入力した内容」になる', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('このまま移動すると、入力した内容は失われます。保存せずに移動しますか？')).toBeTruthy()
  })

  it('残る方が主の緑で、離れる方は枠線（印は付けない）', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const stay = screen.getByRole('button', { name: '編集を続ける' })
    const leave = screen.getByRole('button', { name: '保存せずに移動' })
    expect(stay.className).toMatch(/primary/)
    expect(leave.className).not.toMatch(/primary/)
    expect(leave.className).not.toMatch(/danger/)
    expect(document.querySelector('svg.lucide-circle-check')).toBeNull()
  })

  it('「保存せずに移動」「編集を続ける」がそのまま届く', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存せずに移動' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('閉じているときは何も描かない', () => {
    render(<UnsavedLeaveDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })
})
