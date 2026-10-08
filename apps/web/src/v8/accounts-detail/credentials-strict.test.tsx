// @vitest-environment happy-dom
/*
 * 資格情報の差し替え（Msb1j）を StrictMode の下で確かめる（WEB132 の追加確認）。
 *
 * Next.js App Router は開発時に StrictMode が既定で有効で、Effect を「付ける→外す→付ける」と
 * 1回多く回す。外すときだけ「生きている」印を false にすると、付いているのに false が残り、
 * 保存の成功・失敗・本人確認の要求の表示と「保存中」の解除を全部捨てる。
 * StrictMode を切って避けず、印を付くたびに true へ戻して直す。
 */
import React, { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LineAccount } from '@line-crm/shared'

const update = vi.hoisted(() => vi.fn())
const stepUp = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: { ...actual.api, lineAccounts: { ...actual.api.lineAccounts, update }, auth: { ...actual.api.auth, stepUp } },
  }
})
vi.mock('@/lib/session-snapshot', () => ({ readSessionSnapshot: () => ({ impersonation: null, unfamiliarAt: null, stepUpMethod: 'password' }) }))

import { ApiError } from '@/lib/api'
import { CredentialsDialog } from './dialogs'

const A = { id: 'acc-a', name: 'A店' } as LineAccount
const B = { id: 'acc-b', name: 'B店' } as LineAccount

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const saveButton = () => screen.getByRole('button', { name: /本人確認して保存|保存中/ }) as HTMLButtonElement
const fillSecret = () => {
  const input = document.querySelector('[role="dialog"] input[type="password"]') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'new-secret' } })
}
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => {
  update.mockReset()
  stepUp.mockReset()
  document.documentElement.dataset.theme = 'v8'
})
afterEach(cleanup)

describe('資格情報の差し替えは StrictMode の下でも結果を出して「保存中」を解く（WEB132）', () => {
  it('成功したら保存済みにして窓を閉じる', async () => {
    update.mockResolvedValue({ success: true, data: A })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<StrictMode><CredentialsDialog account={A} kind="messaging" onClose={onClose} onSaved={onSaved} /></StrictMode>)
    fillSecret()
    await act(async () => { saveButton().click() })
    await flush()
    expect(update).toHaveBeenCalledWith('acc-a', { channelSecret: 'new-secret' }, undefined)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('失敗したら失敗の文を出し、「保存中」を解いてもう一度押せる', async () => {
    update.mockRejectedValue(new Error('boom'))
    const onClose = vi.fn()
    render(<StrictMode><CredentialsDialog account={A} kind="messaging" onClose={onClose} onSaved={() => {}} /></StrictMode>)
    fillSecret()
    await act(async () => { saveButton().click() })
    await flush()
    expect(document.body.textContent).toContain('保存に失敗しました')
    expect(saveButton().disabled).toBe(false)
    expect(saveButton().textContent).toContain('本人確認して保存')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('本人確認を求められたら確認の窓を出し、確認後のやり直しで保存して閉じる', async () => {
    update
      .mockRejectedValueOnce(new ApiError(401, '本人確認が必要です', 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ success: true, data: A })
    stepUp.mockResolvedValue({ success: true, data: { token: 'grant-1', purpose: 'line_account.credentials', expiresAt: '2026-10-08T00:00:00.000Z' } })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<StrictMode><CredentialsDialog account={A} kind="messaging" onClose={onClose} onSaved={onSaved} /></StrictMode>)
    fillSecret()
    await act(async () => { saveButton().click() })
    await flush()
    // 本人確認の窓が立ち、元の窓の「保存中」は解けている。
    expect(screen.getByText('パスワードで本人確認')).toBeTruthy()
    expect(saveButton().disabled).toBe(false)
    const password = screen.getByLabelText('パスワード') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'pw' } })
    await act(async () => { screen.getByRole('button', { name: '本人確認して実行' }).click() })
    await flush()
    expect(update).toHaveBeenLastCalledWith('acc-a', { channelSecret: 'new-secret' }, 'grant-1')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('A の窓を閉じて B を開いたあと、A の遅い応答で B を閉じない', async () => {
    const slowA = deferred()
    update.mockReturnValueOnce(slowA.promise)
    const onSavedA = vi.fn()
    const onCloseA = vi.fn()
    const view = render(<StrictMode><CredentialsDialog account={A} kind="messaging" onClose={onCloseA} onSaved={onSavedA} /></StrictMode>)
    fillSecret()
    await act(async () => { saveButton().click() })
    expect(saveButton().disabled).toBe(true)

    const onSavedB = vi.fn()
    const onCloseB = vi.fn()
    view.rerender(<StrictMode><CredentialsDialog account={B} kind="messaging" onClose={onCloseB} onSaved={onSavedB} /></StrictMode>)
    await flush()
    // B は空の欄・押せる状態から始まる。
    expect(saveButton().disabled).toBe(false)
    expect((document.querySelector('[role="dialog"] input[type="password"]') as HTMLInputElement).value).toBe('')

    await act(async () => { slowA.resolve({ success: true, data: A }) })
    await flush()
    expect(onSavedA).not.toHaveBeenCalled()
    expect(onCloseA).not.toHaveBeenCalled()
    expect(onSavedB).not.toHaveBeenCalled()
    expect(onCloseB).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(saveButton().disabled).toBe(false)
  })
})
