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
 * RqO7O：失敗の再試しの文言は、v8 の絵どおり「もう一度試す」。
 * v7（x5cgUH）は「もう一度読み込む」のまま変えない。
 */
describe('開き先がない 再試しの文言', () => {
  it('v7は「もう一度読み込む」', () => {
    render(<TargetMissing kind="error" title="t" description="d" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).not.toBeNull()
  })

  it('v8は「もう一度試す」', () => {
    document.documentElement.dataset.theme = 'v8'
    render(<TargetMissing kind="error" title="t" description="d" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'もう一度試す' })).not.toBeNull()
  })
})
