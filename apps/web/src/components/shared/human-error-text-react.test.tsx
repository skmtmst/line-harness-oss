// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { humanizeErrorText } from './human-error-text'
import Notice from './notice'
import ToastHost, { clearToastsForTest, notifyToast } from './toast'
import { act } from 'react'

/*
 * 動きの点検（2026-10-07）7 番：「API error: 500」のような機械の文を知らせ・帯に出さない。
 * 何が起きた・どうすればよいかの文に置き換える。画面が書いた日本語はそのまま。
 */
afterEach(() => {
  cleanup()
  act(() => clearToastsForTest())
})

describe('humanizeErrorText', () => {
  it.each([
    ['API error: 500', /サーバーで問題が起きて.*もう一度お試しください/],
    ['API error: 503', /サーバーで問題が起きて/],
    ['API error: 403', /権限がありません/],
    ['API error: 404', /見つかりませんでした.*開き直して/],
    ['API error: 409', /ほかの人が先に変更しました.*最新を読み込んで/],
    ['API error: 429', /混み合っています/],
    ['Failed to fetch', /通信できませんでした.*接続を確かめて/],
    ['TypeError: Failed to fetch', /通信できませんでした/],
    ['Internal error', /サーバーで問題が起きて/],
  ])('%s → 人の文', (raw, expected) => {
    const text = humanizeErrorText(raw)
    expect(text).toMatch(expected)
    expect(text).not.toMatch(/API error|fetch|Internal/i)
  })

  it('画面が書いた日本語の案内はそのまま', () => {
    expect(humanizeErrorText('名前を入れてください。')).toBe('名前を入れてください。')
  })
})

describe('帯と知らせは表示の前に置き換える', () => {
  it('Notice の message・文字の子', () => {
    render(<div><Notice tone="danger" message="API error: 500" /><Notice tone="danger">Failed to fetch</Notice></div>)
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('API error')
    expect(text).not.toContain('Failed to fetch')
    expect(text).toContain('サーバーで問題が起きて')
    expect(text).toContain('通信できませんでした')
  })

  it('失敗の知らせ（toast）', () => {
    render(<ToastHost />)
    act(() => { notifyToast('API error: 500', { tone: 'error' }) })
    expect(screen.getByText(/サーバーで問題が起きて/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('API error')
  })
})
