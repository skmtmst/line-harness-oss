// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import ConfirmDialog from './confirm-dialog'

/**
 * 解除窓の説明文の桃箱（ Google Sheets の接続を解除）。
 * 板どおり「題は箱の外・説明だけ箱の中」。
 * 渡さなければ帯なし（今までどおり）。 式（箱なし）の既定の
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
    expect(html).toContain('data-description-band="danger"')
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
    expect(html).not.toContain('data-description-band=')
  })

  it('注意帯は閉じるボタンの列から独立し、説明の読み上げを保つ', () => {
    const html = renderToStaticMarkup(<Dialog open modal={false} title="接続を解除しますか？"
      description="シートの中身は残ります。" descriptionBand="danger" onCancel={vi.fn()} />)
    const container = document.createElement('div')
    container.innerHTML = html
    const panel = container.querySelector('[role="dialog"]')!
    const header = [...panel.children].find(el => el.querySelector('h2'))!
    const band = panel.querySelector('[data-qa-dialog-callout]')!
    expect(header.contains(band)).toBe(false)
    expect(header.querySelector('button[aria-label="閉じる"]')).not.toBeNull()
    expect(band.querySelector('p')?.id).toBe(panel.getAttribute('aria-describedby'))
    expect(band.textContent).toBe('シートの中身は残ります。')
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

  it('説明の知らせは共通部品で、タイトルと読み上げの参照を保つ', () => {
    const html = renderToStaticMarkup(<Dialog open modal={false} title="接続を解除しますか？"
      description="書き出しが止まります。" descriptionBand="danger" onCancel={vi.fn()} />)
    const container = document.createElement('div')
    container.innerHTML = html
    const notice = container.querySelector('[data-design-part="notice"]')!
    expect(notice.textContent).toBe('書き出しが止まります。')
    expect(notice.contains(container.querySelector('h2'))).toBe(false)
    expect(notice.querySelector('p')?.id).toBe(container.querySelector('[role="dialog"]')?.getAttribute('aria-describedby'))
  })
})
