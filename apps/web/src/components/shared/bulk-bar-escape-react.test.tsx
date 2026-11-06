// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BulkBar from './bulk-bar'

/* 動きの点検（2026-10-07）12 番：選んでいる間は Esc で選択を外す。件数は読み上げる。 */
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('一括バーの Esc と読み上げ', () => {
  it('選んでいる間は Esc で onClear を呼ぶ', () => {
    const onClear = vi.fn()
    render(<BulkBar count={2} onClear={onClear} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('窓が開いている間・入力欄の中の Esc は奪わない', () => {
    const onClear = vi.fn()
    render(<div><input aria-label="検索" /><BulkBar count={2} onClear={onClear} /></div>)
    fireEvent.keyDown(screen.getByLabelText('検索'), { key: 'Escape' })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('件数は aria-live で読み上げる', () => {
    render(<BulkBar count={3} />)
    expect(screen.getByText('3件を選択中').getAttribute('aria-live')).toBe('polite')
  })
})
