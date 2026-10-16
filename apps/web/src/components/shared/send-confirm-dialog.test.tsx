// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SendConfirmDialog, { describeExclusion, shortWhen, type SendConfirmDialogProps } from './send-confirm-dialog'

const base: SendConfirmDialogProps = {
  open: true, subtitle: '新しい一斉配信', state: 'ready', recipients: 1272, purpose: 'marketing', whenLabel: '今すぐ送る',
  bodyHead: '本文の頭', bubbleCount: 2, primaryLabel: '1,272 人に送る', onConfirm: vi.fn(), onBack: vi.fn(),
}

afterEach(() => cleanup())

describe('共通の「送る前の確かめ」窓（U1）', () => {
  it('人数・目的・日時・本文・取り消せない旨と「閉じても送りません」を出す', () => {
    render(<SendConfirmDialog {...base} />)
    expect(screen.getByText('1,272 人')).toBeTruthy()
    expect(screen.getByText('宣伝を止めている人には送りません')).toBeTruthy()
    expect(screen.getByText('送ったあとは取り消せません。')).toBeTruthy()
    expect(screen.getByText('閉じても送りません')).toBeTruthy()
    expect(document.body.textContent).not.toContain('元に戻す')
  })
  it('数えられなかったとき・0 人のときは主ボタンを押せない', () => {
    const { rerender } = render(<SendConfirmDialog {...base} state="error" recipients={null} />)
    expect(screen.getByText('人数を数えられませんでした')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: '1,272 人に送る' })[0] as HTMLButtonElement).disabled).toBe(true)
    rerender(<SendConfirmDialog {...base} recipients={0} />)
    expect(screen.getByText('送る相手が 0 人です')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: '1,272 人に送る' })[0] as HTMLButtonElement).disabled).toBe(true)
  })
  it('権限が無い・代理ログイン中は主ボタンを出さず理由を出す', () => {
    const { rerender } = render(<SendConfirmDialog {...base} block="no-permission" />)
    expect(screen.getByText('送るには権限が要ります（頼む先：管理者）。')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: '1,272 人に送る' })).toHaveLength(0)
    rerender(<SendConfirmDialog {...base} block="impersonation" />)
    expect(screen.getByText('代理ログイン中は送れません。')).toBeTruthy()
  })
  it('全員宛は途中で止められない旨を足し、主ボタンは二重に押しても 1 回だけ送る', async () => {
    let resolve!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r }))
    render(<SendConfirmDialog {...base} allRecipients onConfirm={onConfirm} />)
    expect(screen.getByText('全員への配信は、送り始めると途中で止められません。')).toBeTruthy()
    const button = screen.getAllByRole('button', { name: '1,272 人に送る' })[0]
    fireEvent.click(button); fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    resolve()
  })
  it('日時と除外の言い方', () => {
    expect(shortWhen('2026-10-18T01:00:00.000Z')).toBe('10/18 10:00')
    expect(describeExclusion(1272, { blocked: 0, optedOut: 12, duplicate: 0 })).toBe('対象 1,284 人から除く 12 人：宣伝を止めている 12・ブロック 0・重複 0')
  })
})
