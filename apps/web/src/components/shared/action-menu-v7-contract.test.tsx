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
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
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
    const menu = host.querySelector('[role="menu"]')
    expect(menu?.getAttribute('aria-label')).toBe('この友だちへの個別操作')
    expect(menu?.getAttribute('data-design-node')).toBe('xifuV')
    expect(host.textContent).toContain('テンプレートを送る')
    expect(host.textContent).toContain('受信箱で選んで送ります')
    expect(host.textContent).toContain('整理')
    // 別画面へ行く項目は ↗（読み上げに含めない飾り）。
    const external = host.querySelector('svg[aria-hidden="true"]')
    expect(external).toBeTruthy()
    // 危ない操作は danger。
    const danger = menuButtons().find((b) => b.textContent?.includes('アーカイブする'))
    expect(danger?.className).toMatch(/danger/)
    // 区切り線がある。
    expect(host.querySelector('hr')).toBeTruthy()
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
