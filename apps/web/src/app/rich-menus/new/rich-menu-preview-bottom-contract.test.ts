// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RICH_MENU_DIMENSIONS } from '@line-crm/shared'
import LinePreview from '@/components/shared/line-preview'
import { MenuPreview } from '../../../v8/rich-menus/new/create-preview'

const dims = RICH_MENU_DIMENSIONS.large
const props = {
  size: 'large' as const, imageUrl: null,
  areas: [{ x: 0, y: 0, w: dims.width / 2, h: dims.height }, { x: dims.width / 2, y: 0, w: dims.width / 2, h: dims.height }],
  pages: [{ id: 'page-1', name: 'トップ' }], activePageId: 'page-1',
}
function preview() {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(React.createElement(LinePreview, {
    chatBarText: 'メニュー', richMenu: React.createElement(MenuPreview, props),
  }, React.createElement('p', null, 'トークの本文')))
  return host
}

describe('リッチメニューの「LINEでの見え方」はメニューを下に出す', () => {
  it('トークとメニューを別の置き場に出し、メニューをトークの後へ置く', () => {
    const host = preview()
    const talk = host.querySelector('[data-line-preview-part="talk"]')!
    const menu = host.querySelector('[data-line-preview-part="rich-menu"]')!
    expect(talk.textContent).toContain('トークの本文')
    expect(talk.contains(menu)).toBe(false)
    expect(talk.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('メニューの帯は1本だけ出る', () => {
    const host = preview()
    expect(host.querySelectorAll('[data-line-preview-part="menu-bar"]')).toHaveLength(1)
    expect(host.querySelector('[data-line-preview-part="menu-bar"]')?.textContent).toContain('メニュー')
  })

  it('画像が無くても実寸の比率と面の位置を保ち、画像待ちを案内する', () => {
    const host = preview()
    const empty = host.querySelector<HTMLElement>('[data-rich-menu-size="large"]')!
    expect(empty.textContent).toContain('画像を選ぶと、ここに出ます（2面）')
    expect(empty.style.aspectRatio).toBe(`${dims.width} / ${dims.height}`)
    const boxes = empty.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span')
    expect([...boxes].map(box => [box.style.left, box.style.top, box.style.width, box.style.height])).toEqual([
      ['0%', '0%', '50%', '100%'], ['50%', '0%', '50%', '100%'],
    ])
    expect(empty.querySelector('img')).toBeNull()
  })
})
