// @vitest-environment happy-dom
/*
 * LAY-05(#982): Flex メッセージのプレビュー。
 *
 * 実際に DOM へ描画して「何が見えるか」を確かめる。
 *   - 直接の bubble / carousel はカードになる
 *   - {type:'flex', contents:{...}} のLINEメッセージ形も同じカードになる
 *   - 破損JSON・未対応type は生JSONだけの表示にせず、前景色つきの
 *     「プレビューできません」カードへ回す
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import FlexPreview from './flex-preview'

const BUBBLE = {
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '予約のご案内' }] },
}

afterEach(cleanup)

describe('FlexPreview の描画結果', () => {
  it('直接の bubble はカードとして描画する', () => {
    const { container } = render(<FlexPreview content={JSON.stringify(BUBBLE)} />)
    expect(container.textContent).toContain('予約のご案内')
    expect(container.querySelector('[data-flex-preview="unavailable"]')).toBeNull()
  })

  it('carousel は中の bubble をすべて描画する', () => {
    const carousel = {
      type: 'carousel',
      contents: [
        BUBBLE,
        { type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: '2枚目のカード' }] } },
      ],
    }
    const { container } = render(<FlexPreview content={JSON.stringify(carousel)} />)
    expect(container.textContent).toContain('予約のご案内')
    expect(container.textContent).toContain('2枚目のカード')
  })

  it('flex メッセージ形（{type:flex, contents:{...}}）も同じカードになる', () => {
    const wrapped = { type: 'flex', altText: '予約のご案内です', contents: BUBBLE }
    const { container } = render(<FlexPreview content={JSON.stringify(wrapped)} />)
    expect(container.textContent).toContain('予約のご案内')
    expect(container.querySelector('[data-flex-preview="unavailable"]')).toBeNull()
  })

  it('flex で包まれた carousel も描画する', () => {
    const wrapped = {
      type: 'flex',
      altText: 'カード2枚',
      contents: { type: 'carousel', contents: [BUBBLE, BUBBLE] },
    }
    const { container } = render(<FlexPreview content={JSON.stringify(wrapped)} />)
    expect(container.textContent).toContain('予約のご案内')
  })

  it('未対応の形は「プレビューできません」と代替文を出す', () => {
    const unknown = { type: 'imagemap', baseUrl: 'https://example.com/x' }
    const { container } = render(<FlexPreview content={JSON.stringify(unknown)} />)
    const card = container.querySelector('[data-flex-preview="unavailable"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('このメッセージはプレビューできません')
    // 白文字の継承で見えなくならないよう、前景色を自分で指定する。
    expect(card!.className).toContain('text-ink')
    // 生JSONは畳んだ詳細の中だけ。既定で生データだけの表示にしない。
    const pre = card!.querySelector('details pre')
    expect(pre).not.toBeNull()
    expect(card!.textContent).toContain('元のデータを表示')
  })

  it('LINEメッセージ形の altText を意味の手がかりとして出す', () => {
    const wrapped = { type: 'flex', altText: '新商品のお知らせ', contents: { type: 'unknown-container' } }
    const { container } = render(<FlexPreview content={JSON.stringify(wrapped)} />)
    const card = container.querySelector('[data-flex-preview="unavailable"]')
    expect(card!.textContent).toContain('新商品のお知らせ')
  })

  it('壊れたJSONでも空白・白文字にならず代替文を出す', () => {
    const { container } = render(<FlexPreview content='{"type":"bubble", 壊れている' />)
    const card = container.querySelector('[data-flex-preview="unavailable"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('このメッセージはプレビューできません')
    expect(card!.className).toContain('text-ink')
  })
})
