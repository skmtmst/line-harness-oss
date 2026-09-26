// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ActionMenu from './action-menu'

/**
 * ★V7 メニュー（Pencil「★V7 メニュー」`xifuV`）の共通部品の試験。
 *
 * - 項目は高さ36（補足つき52）・アイコン16＋文字14・折り返さない
 * - 区切り線・小さな見出し、危ない操作は danger、別画面へ行く項目は ↗
 * - キーボード（矢印・Enter・Esc・開いたら最初の項目）、role=menu/menuitem
 * - 画面の端で切れない（横・縦にはみ出さない）
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
})

function menuButtons(): HTMLButtonElement[] {
  // メニューは最上層（`document.body` 直下の portal）に出る。
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
}

function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]')
}

describe('ActionMenu ★V7 の項目', () => {
  it('補足・別画面・見出し・区切り・危ない操作を出せる', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <ActionMenu
          open
          onClose={onClose}
          ariaLabel="この友だちへの個別操作"
          items={[
            { id: 'support', label: '対応状況を編集', onSelect },
            {
              id: 'send-template',
              label: 'テンプレートを送る',
              description: '受信箱で選んで送ります',
              external: true,
              onSelect,
            },
            {
              id: 'archive',
              label: 'アーカイブする',
              tone: 'danger',
              dividerBefore: true,
              sectionBefore: '整理',
              onSelect,
            },
          ]}
        />,
      )
    })
    const menu = openMenu()
    expect(menu?.getAttribute('aria-label')).toBe('この友だちへの個別操作')
    expect(menu?.getAttribute('data-design-node')).toBe('xifuV')
    // 中身は最上層（portal）に出るので、置き場所ではなく文書全体で見る。
    expect(document.body.textContent).toContain('テンプレートを送る')
    expect(document.body.textContent).toContain('受信箱で選んで送ります')
    expect(document.body.textContent).toContain('整理')
    // 別画面へ行く項目は ↗（読み上げに含めない飾り）。
    const external = document.querySelector('svg[aria-hidden="true"]')
    expect(external).toBeTruthy()
    // 危ない操作は danger。
    const danger = menuButtons().find((b) => b.textContent?.includes('アーカイブする'))
    expect(danger?.className).toMatch(/danger/)
    // 区切り線がある。
    expect(document.querySelector('[role="menu"] hr')).toBeTruthy()
  })

  it('選ぶと実行して閉じる', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(<ActionMenu open onClose={onClose} items={[{ id: 'a', label: '対応状況を編集', onSelect }]} />)
    })
    await act(async () => {
      menuButtons()[0].click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('長い名前は折り返さず、全文は title で確かめられる', async () => {
    const css = read('action-menu.module.css')
    expect(css).toMatch(/\.label\s*{[^}]*white-space:\s*nowrap/s)
    expect(css).toMatch(/\.label\s*{[^}]*text-overflow:\s*ellipsis/s)
    expect(css).toMatch(/\.description\s*{[^}]*white-space:\s*nowrap/s)
    await act(async () => {
      root.render(
        <ActionMenu
          open
          inline
          onClose={vi.fn()}
          items={[{ id: 'a', label: 'テンプレートを送る', description: '受信箱で選んで送ります', onSelect: vi.fn() }]}
        />,
      )
    })
    const button = menuButtons()[0]
    expect(button.getAttribute('title')).toBe('テンプレートを送る')
  })
})

describe('ActionMenu ★V7 のキーボード', () => {
  it('開いたら最初の項目にいて、矢印で動ける', async () => {
    await act(async () => {
      root.render(
        <ActionMenu
          open
          onClose={vi.fn()}
          items={[
            { id: 'a', label: '対応状況を編集', onSelect: vi.fn() },
            { id: 'b', label: 'テンプレートを送る', onSelect: vi.fn() },
          ]}
        />,
      )
    })
    expect(document.activeElement?.textContent).toContain('対応状況を編集')
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement?.textContent).toContain('テンプレートを送る')
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(document.activeElement?.textContent).toContain('対応状況を編集')
  })

  it('実行は button 既定の Enter で押せる形（button 要素）', async () => {
    await act(async () => {
      root.render(
        <ActionMenu open inline onClose={vi.fn()} items={[{ id: 'a', label: '対応状況を編集', onSelect: vi.fn() }]} />,
      )
    })
    const button = menuButtons()[0]
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('Esc で閉じる', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(<ActionMenu open onClose={onClose} items={[{ id: 'a', label: '対応状況を編集', onSelect: vi.fn() }]} />)
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ActionMenu ★V7 の見た目', () => {
  it('白地・角丸12・枠・影、項目36（補足つき52）・文字14・触った時の地は shell', () => {
    const css = read('action-menu.module.css')
    expect(css).toMatch(/\.menu\s*{[^}]*min-width:\s*224px/s)
    expect(css).toMatch(/\.menu\s*{[^}]*max-width:\s*min\(320px,\s*calc\(100vw - 16px\)\)/s)
    expect(css).toMatch(/\.menu\s*{[^}]*background:\s*var\(--color-canvas\)/s)
    expect(css).toMatch(/\.menu\s*{[^}]*border-radius:\s*12px/s)
    expect(css).toMatch(/\.menu\s*{[^}]*border:\s*1px solid var\(--color-hairline\)/s)
    expect(css).toMatch(/\.menu\s*{[^}]*box-shadow:\s*var\(--shadow-float\)/s)
    expect(css).toMatch(/\.item\s*{[^}]*height:\s*36px/s)
    expect(css).toMatch(/\.itemTall\s*{[^}]*height:\s*52px/s)
    expect(css).toMatch(/\.item\s*{[^}]*font-size:\s*var\(--text-body\)/s)
    expect(css).toMatch(/\.icon\s*{[^}]*width:\s*16px/s)
    expect(css).toMatch(/\.item:hover:not\(:disabled\),\s*\.item:focus-visible\s*{[^}]*background:\s*var\(--color-shell\)/s)
  })

  it('画面の端で切れない（横・縦にはみ出さない）', () => {
    const css = read('action-menu.module.css')
    expect(css).toMatch(/\.menu\s*{[^}]*max-width:\s*min\(320px,\s*calc\(100vw - 16px\)\)/s)
    expect(css).toMatch(/\.menu\s*{[^}]*max-height:/s)
    expect(css).toMatch(/\.menu\s*{[^}]*overflow-y:\s*auto/s)
  })
})

describe('ActionMenu の最上層（portal）', () => {
  it('カード・表・ダイアログの中でも切られない（body 直下に出る）', async () => {
    await act(async () => {
      root.render(
        <div style={{ overflow: 'hidden', height: 40 }}>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button">…</button>
            <ActionMenu open onClose={vi.fn()} items={[{ id: 'a', label: '編集', onSelect: vi.fn() }]} />
          </span>
        </div>,
      )
    })
    const menu = openMenu()
    expect(menu).toBeTruthy()
    // 開く場所（`overflow: hidden` の箱）の中には残らない。
    expect(host.querySelector('[role="menu"]')).toBeNull()
    // 最上層の器に入っている。
    expect(menu?.closest('[data-menu-portal]')).toBeTruthy()
    expect(menu?.parentElement?.closest('[data-menu-portal]')).toBeTruthy()
  })

  it('下に場所が無ければ上に開く', async () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    rectSpy.mockReturnValue({
      x: 100, y: 700, width: 32, height: 32,
      top: 700, right: 132, bottom: 732, left: 100,
      toJSON: () => ({}),
    } as DOMRect)
    // happy-dom は箱の高さを持たないので、メニューの高さだけ代表値で置く。
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    heightSpy.mockReturnValue(300)
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    try {
      await act(async () => {
        root.render(
          <ActionMenu open onClose={vi.fn()} items={[{ id: 'a', label: '編集', onSelect: vi.fn() }]} />,
        )
      })
      const portal = document.querySelector('[data-menu-portal]')
      expect(portal?.getAttribute('data-placement')).toBe('up')
    } finally {
      rectSpy.mockRestore()
      heightSpy.mockRestore()
    }
  })

  it('下に場所があれば下に開く', async () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    rectSpy.mockReturnValue({
      x: 100, y: 100, width: 32, height: 32,
      top: 100, right: 132, bottom: 132, left: 100,
      toJSON: () => ({}),
    } as DOMRect)
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    heightSpy.mockReturnValue(300)
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    try {
      await act(async () => {
        root.render(
          <ActionMenu open onClose={vi.fn()} items={[{ id: 'a', label: '編集', onSelect: vi.fn() }]} />,
        )
      })
      const portal = document.querySelector('[data-menu-portal]')
      expect(portal?.getAttribute('data-placement')).toBe('down')
    } finally {
      rectSpy.mockRestore()
      heightSpy.mockRestore()
    }
  })

  it('開くボタンの押し直しで閉じられる', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <span>
          <button type="button">…</button>
          <ActionMenu open onClose={onClose} items={[{ id: 'a', label: '編集', onSelect: vi.fn() }]} />
        </span>,
      )
    })
    const trigger = host.querySelector('button:not([role="menuitem"])')
    await act(async () => {
      // MenuPortal は開くボタンの押下を「外側」と見なさない。
      // ボタンの click は呼び出し側のトグルに任せる。
      trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
