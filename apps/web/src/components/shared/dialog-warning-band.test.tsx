// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'

/**
 * 確認窓の説明文の琥珀帯（ 送受信を止める）。
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
    expect(html).toContain('data-description-band="warning"')
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

  it('注意の説明も共通の知らせで、題と説明の読み上げを保つ', () => {
    const html = renderToStaticMarkup(<Dialog open modal={false} title="送受信を止めますか？"
      description="配信も受信もしません。" descriptionBand="warning" onCancel={vi.fn()} />)
    const host = document.createElement('div')
    host.innerHTML = html
    const notice = host.querySelector('[data-qa-dialog-callout]')!
    const dialog = host.querySelector('[role="dialog"]')!
    expect(notice.getAttribute('data-design-part')).toBe('notice')
    expect(notice.textContent).toContain('送受信を止めますか？')
    expect(notice.querySelector('p')?.id).toBe(dialog.getAttribute('aria-describedby'))
  })
})
