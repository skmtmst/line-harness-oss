// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TargetMissing from './target-missing'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

/*
 * ：見える文言は v8 の絵どおり「もう一度読み込む」。
 * 管理画面（x5cgUH）は「もう一度読み込む」のまま変えない。
 * 読み上げ名は見えている文字と同じ（別の名前だと、声で操作する人が呼べない）。
 * 失敗の題も v8 は絵どおり「読み込めませんでした」（「〇〇を表示できませんでした」も言い換える）。
 */
describe('開き先がない 再試しの文言', () => {
  it('指定がなくても「もう一度読み込む」', () => {
    render(<TargetMissing kind="error" title="t" description="d" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).not.toBeNull()
  })

  it('v8は見える文言も読み上げ名も「もう一度読み込む」', () => {
    document.documentElement.dataset.theme = 'v8'
    render(<TargetMissing kind="error" title="t" description="d" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).not.toBeNull()
  })

  it('旧テーマの指定が残っていても失敗の題は「読み込めませんでした」', () => {
    document.documentElement.dataset.theme = 'v8'
    const view = render(<TargetMissing kind="error" title="表示できませんでした" description="d" />)
    expect(screen.getByText('読み込めませんでした')).not.toBeNull()
    view.rerender(<TargetMissing kind="error" title="投稿を表示できませんでした" description="d" />)
    expect(screen.getByText('投稿を読み込めませんでした')).not.toBeNull()
    cleanup()
    document.documentElement.dataset.theme = 'v7'
    render(<TargetMissing kind="error" title="表示できませんでした" description="d" />)
    expect(screen.getByText('読み込めませんでした')).not.toBeNull()
  })
})
