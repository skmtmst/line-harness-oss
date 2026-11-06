// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'

let opener: HTMLButtonElement
beforeEach(() => {
  opener = document.createElement('button')
  opener.textContent = '編集を開く'
  document.body.appendChild(opener)
  opener.focus()
})
afterEach(() => { cleanup(); opener.remove(); document.body.style.overflow = ''; vi.restoreAllMocks() })
function Owner({ save = async () => {}, onClose = () => {} }: { save?: () => Promise<void>; onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  return <Dialog open={open} title="設定を編集" busy={busy} confirmLabel="保存する" onCancel={() => { onClose(); setOpen(false) }} onConfirm={async () => {
    setBusy(true)
    try { await save(); setOpen(false) } finally { setBusy(false) }
  }}><label>設定<input defaultValue="保存する内容" /></label></Dialog>
}
const key = (value: string, shiftKey = false) => fireEvent.keyDown(document, { key: value, shiftKey })
const focusables = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))

it('開いている間は背景スクロールを止め、閉じると元に戻す', () => {
  const view = render(<Owner />)
  expect(document.body.style.overflow).toBe('hidden')
  view.unmount()
  expect(document.body.style.overflow).toBe('')
})
it('Escapeで窓を閉じて起点へ戻る', async () => {
  const onClose = vi.fn()
  render(<Owner onClose={onClose} />)
  key('Escape')
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(document.activeElement).toBe(opener)
})
it('TabとShift+Tabは窓の中を循環する', () => {
  render(<Owner />)
  const items = focusables(screen.getByRole('dialog', { name: '設定を編集' }))
  expect(items.length).toBeGreaterThan(2)
  items.at(-1)!.focus()
  key('Tab')
  expect(document.activeElement).toBe(items[0])
  items[0].focus()
  key('Tab', true)
  expect(document.activeElement).toBe(items.at(-1))
})
it('保存中はEscapeや背景クリックで閉じない', async () => {
  let finish!: () => void
  const save = () => new Promise<void>(resolve => { finish = resolve })
  const onClose = vi.fn()
  render(<Owner save={save} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  key('Escape')
  fireEvent.mouseDown(screen.getByRole('presentation'))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => finish())
})
it('保存成功で閉じたあとも編集を開いた起点へフォーカスを戻す', async () => {
  const save = vi.fn(async () => {})
  render(<Owner save={save} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存する' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(save).toHaveBeenCalledOnce()
  await waitFor(() => expect(document.activeElement).toBe(opener))
})
