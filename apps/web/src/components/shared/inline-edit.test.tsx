// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InlineEdit from './inline-edit'

afterEach(() => {
  cleanup()
})

describe('InlineEdit（その場の書き換え・C②）', () => {
  it('押すと入力欄になり、Enter で保存する', async () => {
    const onSave = vi.fn(async () => {})
    render(<InlineEdit value="秋の案内" label="配信名" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '配信名を変更する' }))
    const input = screen.getByRole('textbox', { name: '配信名' })
    fireEvent.change(input, { target: { value: '冬の案内' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(onSave).toHaveBeenCalledWith('冬の案内')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Esc でやめる（保存しない）', () => {
    const onSave = vi.fn(async () => {})
    render(<InlineEdit value="秋の案内" label="配信名" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '配信名を変更する' }))
    const input = screen.getByRole('textbox', { name: '配信名' })
    fireEvent.change(input, { target: { value: '冬の案内' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('失敗したら元の値に戻して理由を出す', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('no')
    })
    render(<InlineEdit value="秋の案内" label="配信名" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '配信名を変更する' }))
    fireEvent.change(screen.getByRole('textbox', { name: '配信名' }), { target: { value: '冬の案内' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: '配信名' }), { key: 'Enter' })
    })
    expect(screen.getByRole('alert').textContent).toContain('保存できませんでした')
    expect(screen.getByRole('textbox', { name: '配信名' }).getAttribute('value')).toBe('秋の案内')
  })

  it('変わっていなければ保存を呼ばない', async () => {
    const onSave = vi.fn(async () => {})
    render(<InlineEdit value="秋の案内" label="配信名" onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '配信名を変更する' }))
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: '配信名' }), { key: 'Enter' })
    })
    expect(onSave).not.toHaveBeenCalled()
  })
})
