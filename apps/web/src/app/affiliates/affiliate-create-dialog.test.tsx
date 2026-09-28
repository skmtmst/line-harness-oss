// @vitest-environment happy-dom
/*
 * R295: 紹介者作成の窓は共通の窓を使う。開いている間はフォーカスが内側を
 * 循環し、Escapeで閉じて起動ボタンへ戻る。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useState } from 'react'

vi.mock('@/lib/api', () => ({
  api: {
    friends: {
      list: async () => ({ success: true, data: { items: [] } }),
    },
    affiliates: {
      create: async () => ({ success: true, data: {}, link: null }),
    },
  },
}))

const { CreateAffiliateModal } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

function Opener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        ＋ アフィリエイターを作る
      </button>
      {open ? (
        <CreateAffiliateModal accountId="acc-1" onClose={() => setOpen(false)} onCreated={() => {}} />
      ) : null}
    </>
  )
}

describe('R295 作成窓は共通Dialogの動きをする', () => {
  test('Escapeで閉じる', async () => {
    render(<Opener />)
    fireEvent.click(screen.getByRole('button', { name: '＋ アフィリエイターを作る' }))
    await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('Tabは窓の内側を循環し、背景へ抜けない', async () => {
    render(<Opener />)
    const trigger = screen.getByRole('button', { name: '＋ アフィリエイターを作る' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog')

    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: '閉じる' })
    const cancel = screen.getByRole('button', { name: 'キャンセル' })

    // 最後（キャンセル）からTabで最初（×）へ戻る。
    cancel.focus()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Tab' })
    })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(close)

    // 最初（×）からShift+Tabで最後（キャンセル）へ戻る。
    close.focus()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    })
    expect(document.activeElement).toBe(cancel)
  })

  test('閉じたら起動ボタンへフォーカスが戻る', async () => {
    render(<Opener />)
    const trigger = screen.getByRole('button', { name: '＋ アフィリエイターを作る' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
