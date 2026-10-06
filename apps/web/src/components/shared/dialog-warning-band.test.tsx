import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, 'dialog.module.css'), 'utf8')

/**
 * 確認窓の説明文の琥珀帯（CFAyf 送受信を止める）。
 * 渡さなければ帯なし（今までどおり）。
 */
describe('ダイアログの琥珀帯', () => {
  it('descriptionBand="warning" で説明文が帯に入る', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        modal={false}
        title="送受信を止めますか？"
        description="止めているあいだ、配信も受信もしません。"
        descriptionBand="warning"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(html).toContain('data-qa-dialog-callout')
    expect(html).toContain('止めているあいだ')
  })

  it('渡さなければ帯は出ない', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        modal={false}
        title="保存しますか？"
        description="ただの文です。"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(html).not.toContain('data-qa-dialog-callout')
  })

  it('琥珀帯は v8 だけで琥珀色（v7 は変えない）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning\s*\{[^}]*background:\s*var\(--color-status-warn-soft\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning \.description \{[^}]*color:\s*var\(--color-warning\)/s)
  })

  it('琥珀帯は板どおり角丸 8・内側 10/12・文 11px/17px（CFAyf・YZ57z）', () => {
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning\s*\{[^}]*border-radius:\s*var\(--radius-segment\)/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning\s*\{[^}]*padding:\s*10px 12px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning \.description\s*\{[^}]*font-size:\s*11px/s)
    expect(css).toMatch(/\[data-theme='v8'\] \.calloutWarning \.description\s*\{[^}]*line-height:\s*17px/s)
  })
})
