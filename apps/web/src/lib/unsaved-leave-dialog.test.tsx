// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UnsavedLeaveDialog } from './unsaved-leave-dialog'

afterEach(cleanup)

describe('UnsavedLeaveDialog（未保存ガードの共通窓）', () => {
  it('文言は固定で、画面ごとの違いは subject の名詞だけ（★V7 sTJsh §5）', () => {
    render(<UnsavedLeaveDialog open subject="入力した共通情報" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '保存していない変更があります' })).toBeTruthy()
    expect(screen.getByText('このまま移ると、入力した共通情報が消えます。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '編集を続ける' })).toBeTruthy()
  })

  it('subject を省いたときは「入力した内容」になる', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('このまま移ると、入力した内容が消えます。')).toBeTruthy()
  })

  it('残る方が主の緑で、離れる方は枠線（印は付けない）', () => {
    render(<UnsavedLeaveDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const stay = screen.getByRole('button', { name: '編集を続ける' })
    const leave = screen.getByRole('button', { name: '保存せずに移る' })
    expect(stay.className).toMatch(/primary/)
    expect(leave.className).not.toMatch(/primary/)
    expect(leave.className).not.toMatch(/danger/)
    expect(document.querySelector('svg.lucide-circle-check')).toBeNull()
  })

  it('「保存せずに移る」「編集を続ける」がそのまま届く', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('onSave があるときは「保存して移る」が出て、残る口は右上の×', () => {
    const onSave = vi.fn(async () => true)
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存して移る' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存せずに移る' })).toBeTruthy()
    // 移る系の2択だけ。「編集を続ける」は出さず、× で残る（UI-25）。
    expect(screen.queryByRole('button', { name: '編集を続ける' })).toBeNull()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy()
  })

  it('「保存して移る」は保存が通ったときだけ移動を続ける', async () => {
    const onSave = vi.fn(async () => true)
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('保存が通らなければ移動せず画面へ戻す', async () => {
    const onSave = vi.fn(async () => false)
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<UnsavedLeaveDialog open onSave={onSave} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存して移る' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('閉じているときは何も描かない', () => {
    render(<UnsavedLeaveDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })
})
