// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { adPlatforms: { create, connect: async () => ({ success: true }) } } }))
import AdConnection from './ad-connection-dialog'
afterEach(cleanup)
it('不足する接続欄を赤くして最初の欄へ移り、保存を呼ばない', () => {
  create.mockClear()
  render(<AdConnection provider={{ key: 'meta', label: 'Meta' }} accountId="a" onClose={vi.fn()} onSaved={async () => {}} />)
  const first = screen.getByLabelText('広告アカウントID')
  const scroll = vi.fn()
  first.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('button', { name: '接続を確認してつなぐ' }))
  expect(first.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(first)
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  expect(screen.getAllByRole('alert')).toHaveLength(3)
  expect(screen.queryByText('接続に必要な項目を入力してください')).toBeNull()
  expect(create).not.toHaveBeenCalled()
})
it('広告の接続保存中は×・背景・Esc・閉じるで消えない', async () => {
  let resolve!: (value: unknown) => void
  create.mockImplementation(() => new Promise(r => { resolve = r }))
  const close = vi.fn()
  render(<AdConnection provider={{ key: 'meta', label: 'Meta' }} accountId="a" onClose={close} onSaved={async () => {}} />)
  for (const [label, value] of [['広告アカウントID', 'account'], ['ピクセルID', 'pixel'], ['アクセストークン', 'secret']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: '接続を確認してつなぐ' }))
  expect(screen.getAllByRole('button', { name: '閉じる', exact: true }).every(button => button.hasAttribute('disabled'))).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.mouseDown(screen.getByRole('presentation'))
  expect(close).not.toHaveBeenCalled()
  await act(async () => resolve({ success: true, data: { id: 'p1' } }))
  expect(close).toHaveBeenCalledTimes(1)
})

/*
 * 開発時の StrictMode は Effect を「付ける→外す→付ける」と1回多く回す。
 * 「生きている」印を外すときだけ false にすると、付いているのに false が残り、
 * 接続の結果と「確認しています…」の解除を捨てる（WEB132 と同じ形）。
 */
it('StrictMode の下でも、つないだら閉じ、失敗したら文を出して押せる状態へ戻す', async () => {
  create.mockResolvedValueOnce({ success: true, data: { id: 'p1' } })
  const close = vi.fn()
  const fill = () => {
    for (const [label, value] of [['広告アカウントID', 'account'], ['ピクセルID', 'pixel'], ['アクセストークン', 'secret']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
  }
  const view = render(<React.StrictMode><AdConnection provider={{ key: 'meta', label: 'Meta' }} accountId="a" onClose={close} onSaved={async () => {}} /></React.StrictMode>)
  fill()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '接続を確認してつなぐ' })) })
  expect(close).toHaveBeenCalledTimes(1)
  view.unmount()

  create.mockRejectedValueOnce(new Error('down'))
  render(<React.StrictMode><AdConnection provider={{ key: 'meta', label: 'Meta' }} accountId="a" onClose={close} onSaved={async () => {}} /></React.StrictMode>)
  fill()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '接続を確認してつなぐ' })) })
  expect(screen.getByRole('alert').textContent).toContain('接続できませんでした')
  expect(screen.getByRole('button', { name: '接続を確認してつなぐ' }).hasAttribute('disabled')).toBe(false)
  expect(close).toHaveBeenCalledTimes(1)
})
