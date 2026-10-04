// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MenuPortal, { hasMoreBelow, MENU_PORTAL_MARGIN } from './menu-portal'

/**
 * m17j: 共通の器（MenuPortal）は開く方向に使える高さ
 * （画面 − ボタン − 余白8px）まで使い、入るなら全部出す。
 * 入りきらない時だけ中でスクロールし、下端に影（続きの目印）を付ける。
 *
 * 回答フォームの「＋ ブロックを追加（15種）」は器の中で
 * 20rem（約7項目）で切れていた。直しを戻す（器に上限なし・
 * メニューの portal 側に 20rem の上限あり）と赤くなる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

let host: HTMLDivElement
let root: Root
let anchor: HTMLButtonElement

const innerHeightBefore = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const innerWidthBefore = Object.getOwnPropertyDescriptor(window, 'innerWidth')

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  anchor = document.createElement('button')
  anchor.textContent = '＋ ブロックを追加（15種）'
  host.appendChild(anchor)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  document.querySelectorAll('[data-menu-portal]').forEach((node) => node.remove())
  vi.restoreAllMocks()
  if (innerHeightBefore) Object.defineProperty(window, 'innerHeight', innerHeightBefore)
  if (innerWidthBefore) Object.defineProperty(window, 'innerWidth', innerWidthBefore)
})

function mockViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

function mockAnchorRect(rect: { top: number; bottom: number; left: number; right: number }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    toJSON: () => ({}),
  } as DOMRect)
}

/** 中身の全部の高さ・見えている高さを代表値で置く（happy-dom は箱の高さを持たない）。 */
function mockPanelLayout(contentHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(contentHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
}

function portal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-menu-portal]')
}

async function openTallMenu() {
  await act(async () => {
    root.render(
      <MenuPortal open getAnchor={() => anchor} onClose={vi.fn()}>
        <div role="menu" aria-label="追加するブロック">
          {Array.from({ length: 12 }, (_, index) => (
            <button key={index} type="button" role="menuitem">
              項目{index + 1}
            </button>
          ))}
        </div>
      </MenuPortal>,
    )
  })
  // 影の有無は別エフェクトで決まるので、1拍おいてから読む。
  await act(async () => {})
}

describe('器は使える高さまで使う（1440×900 の撮影条件）', () => {
  it('入る時は上限が使える高さいっぱいで、影もスクロールもない', async () => {
    // 12項目 ≒ 500px が下の空き 656px に入る置き方。
    mockViewport(1440, 900)
    mockAnchorRect({ top: 200, bottom: 232, left: 100, right: 300 })
    mockPanelLayout(500, 500)
    await openTallMenu()
    const panel = portal()
    expect(panel?.getAttribute('data-placement')).toBe('down')
    // 使える高さ = 900 − 232 − すき間4 − 余白8 = 656。
    expect(panel?.style.maxHeight).toBe('656px')
    expect(panel?.style.overflowY).toBe('auto')
    expect(panel?.getAttribute('data-has-more')).toBe('false')
    expect(panel?.style.boxShadow).toBe('')
    // 12項目は全部文書にある（高さで切らない）。
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(12)
  })

  it('足りない時だけ中でスクロールし、下端に続きの影が出る', async () => {
    // 12項目 ≒ 1200px が下の空き 656px に入らない置き方。
    mockViewport(1440, 900)
    mockAnchorRect({ top: 200, bottom: 232, left: 100, right: 300 })
    mockPanelLayout(1200, 656)
    await openTallMenu()
    const panel = portal()
    expect(panel?.getAttribute('data-placement')).toBe('down')
    expect(panel?.style.maxHeight).toBe('656px')
    expect(panel?.getAttribute('data-has-more')).toBe('true')
    expect(panel?.style.boxShadow).toContain('inset')
  })

  it('下に場所が無ければ上へ開き、上の使える高さまで使う', async () => {
    mockViewport(1440, 900)
    mockAnchorRect({ top: 700, bottom: 732, left: 100, right: 300 })
    mockPanelLayout(1200, 688)
    await openTallMenu()
    const panel = portal()
    expect(panel?.getAttribute('data-placement')).toBe('up')
    // 使える高さ = 700 − すき間4 − 余白8 = 688。
    expect(panel?.style.maxHeight).toBe('688px')
    expect(panel?.getAttribute('data-has-more')).toBe('true')
  })
})

describe('続きの目印の決め方', () => {
  it('1px の誤差では影を出さない', () => {
    expect(hasMoreBelow({ scrollHeight: 500, scrollTop: 0, clientHeight: 500 })).toBe(false)
    expect(hasMoreBelow({ scrollHeight: 501, scrollTop: 0, clientHeight: 500 })).toBe(false)
    expect(hasMoreBelow({ scrollHeight: 502, scrollTop: 0, clientHeight: 500 })).toBe(true)
    expect(hasMoreBelow({ scrollHeight: 1200, scrollTop: 0, clientHeight: 656 })).toBe(true)
    // 一番下まで行ったら影は消える。
    expect(hasMoreBelow({ scrollHeight: 1200, scrollTop: 544, clientHeight: 656 })).toBe(false)
  })

  it('余白は 8px', () => {
    expect(MENU_PORTAL_MARGIN).toBe(8)
  })
})

describe('メニューは器の中で高さを切らない（器を使わない置き方だけ上限）', () => {
  it('portal の中では上限なし・スクロールなし（器が広げる）', () => {
    const css = read('action-menu.module.css')
    const portalBlock = css.match(/\.menuPortal\s*{[^}]*}/s)?.[0] ?? ''
    expect(portalBlock).toMatch(/max-height:\s*none/)
    expect(portalBlock).toMatch(/overflow:\s*visible/)
  })

  it('器を使わない置き方（inline）の上限は残す', () => {
    const css = read('action-menu.module.css')
    expect(css).toMatch(/\.menu\s*{[^}]*max-height:/s)
    expect(css).toMatch(/\.menu\s*{[^}]*overflow-y:\s*auto/s)
  })
})
