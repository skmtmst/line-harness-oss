import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ListState from './list-state'

describe('ListState の再読み込み', () => {
  it('失敗状態にだけ再読み込みを出す', () => {
    const onRetry = vi.fn()

    expect(renderToStaticMarkup(<ListState kind="error" onRetry={onRetry} />)).toContain('再読み込み')

    for (const kind of ['loading', 'empty', 'forbidden'] as const) {
      expect(renderToStaticMarkup(<ListState kind={kind} onRetry={onRetry} />)).not.toContain('再読み込み')
    }
  })

  it('読み直す関数が無い失敗状態にはボタンを出さない', () => {
    expect(renderToStaticMarkup(<ListState kind="error" />)).not.toContain('<button')
  })

  it('読み直している間は二度押しを止める', () => {
    const html = renderToStaticMarkup(<ListState kind="error" onRetry={vi.fn()} retrying />)

    expect(html).toContain('disabled')
    expect(html).toContain('読み込んでいます')
    expect(html).not.toContain('>再読み込み<')
  })

  it('既存の任意操作はそのまま表示する', () => {
    const html = renderToStaticMarkup(
      <ListState kind="empty" action={<button type="button">新しく作る</button>} />,
    )

    expect(html).toContain('新しく作る')
  })
})
