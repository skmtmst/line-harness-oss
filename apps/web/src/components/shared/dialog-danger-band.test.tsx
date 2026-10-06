import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import ConfirmDialog from './confirm-dialog'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'dialog.module.css'), 'utf8')

/**
 * 解除窓の説明文の桃箱（YZ57z Google Sheets の接続を解除）。
 * 板どおり「題は箱の外・説明だけ箱の中」。
 * 渡さなければ帯なし（今までどおり）。VsSyu 式（箱なし）の既定の
 * 破壊的トーンは変えない。
 */
describe('ダイアログの桃箱', () => {
  it('descriptionBand="danger" で題は箱の外・説明だけ箱の中', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        modal={false}
        title="接続を解除しますか？"
        description="書き出しが止まります。"
        descriptionBand="danger"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(html).toContain('data-qa-dialog-callout')
    const titleAt = html.indexOf('接続を解除しますか？')
    const boxAt = html.indexOf('data-qa-dialog-callout')
    const descAt = html.indexOf('書き出しが止まります。')
    expect(titleAt).toBeGreaterThanOrEqual(0)
    // 題は箱の外（箱より前）、説明は箱の中（箱より後）。
    expect(titleAt).toBeLessThan(boxAt)
    expect(descAt).toBeGreaterThan(boxAt)
  })

  it('渡さなければ帯は出ない', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        modal={false}
        title="接続を解除しますか？"
        description="書き出しが止まります。"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(html).not.toContain('data-qa-dialog-callout')
  })

  it('ConfirmDialog の dangerBand が桃箱へ素通しされる', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="接続を解除しますか？"
        description="書き出しが止まります。"
        destructive
        dangerBand
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(html).toContain('data-qa-dialog-callout')
    expect(html.indexOf('接続を解除しますか？')).toBeLessThan(html.indexOf('data-qa-dialog-callout'))
    expect(html.indexOf('書き出しが止まります。')).toBeGreaterThan(html.indexOf('data-qa-dialog-callout'))
  })

  it('桃箱は v8 だけで桃色（v7 は変えない）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger\s*\{[^}]*background:\s*var\(--color-danger-bg\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger \.description\s*\{[^}]*color:\s*var\(--color-danger\)/s)
  })

  it('桃箱は板どおり角丸 8・内側 10/12・文 11px/17px（YZ57z）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger\s*\{[^}]*border-radius:\s*var\(--radius-segment\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger\s*\{[^}]*padding:\s*10px 12px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger \.description\s*\{[^}]*font-size:\s*11px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutDanger \.description\s*\{[^}]*line-height:\s*17px/s)
  })
})
