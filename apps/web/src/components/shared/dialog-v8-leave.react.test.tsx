// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

/*
 * ★V8 仕上げ（M10）：窓・引き出しは閉じるとき逆再生（150ms）してから外す。
 * v7（v8 でない）は今までどおり即時に消える。
 */
describe('V8 窓・引き出しの閉じ方', () => {
  it('v7は閉じたら即時に消える', () => {
    const dialog = render(<Dialog open modal={false} title="お知らせ" onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    dialog.rerender(<Dialog open={false} modal={false} title="お知らせ" onCancel={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    dialog.unmount()

    const drawer = render(<Drawer open modal={false} title="詳細" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    drawer.rerender(<Drawer open={false} modal={false} title="詳細" onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    drawer.unmount()
  })

  it('v8は閉じの印を残してから消える', () => {
    vi.useFakeTimers()
    try {
      document.documentElement.dataset.theme = 'v8'
      const dialog = render(<Dialog open modal={false} title="お知らせ" onCancel={vi.fn()} />)
      dialog.rerender(<Dialog open={false} modal={false} title="お知らせ" onCancel={vi.fn()} />)
      expect(screen.getByRole('dialog').getAttribute('data-closing')).toBe('true')
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      dialog.unmount()

      const drawer = render(<Drawer open modal={false} title="詳細" onClose={vi.fn()} />)
      drawer.rerender(<Drawer open={false} modal={false} title="詳細" onClose={vi.fn()} />)
      expect(screen.getByRole('dialog').getAttribute('data-closing')).toBe('true')
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      drawer.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * 動きの点検（2026-10-07）1 番：閉じた最初の描画で窓が一度外れ、付け直されて
   * 「消える→ふわっと出る→消える」とちらついていた。閉じても同じ要素のまま
   * 閉じの印へ移ること（外して付け直さないこと）を見る。
   */
  it('v8は閉じても窓を付け直さない（同じ要素のまま閉じの印になる）', () => {
    vi.useFakeTimers()
    try {
      document.documentElement.dataset.theme = 'v8'
      const removed: Node[] = []
      const observer = new MutationObserver((records) => {
        for (const record of records) removed.push(...Array.from(record.removedNodes))
      })
      const dialog = render(<Dialog open modal={false} title="お知らせ" onCancel={vi.fn()} />)
      const before = screen.getByRole('dialog')
      observer.observe(dialog.container, { childList: true, subtree: true })
      dialog.rerender(<Dialog open={false} modal={false} title="お知らせ" onCancel={vi.fn()} />)
      const records = observer.takeRecords()
      for (const record of records) removed.push(...Array.from(record.removedNodes))
      expect(removed).not.toContain(before)
      expect(screen.getByRole('dialog')).toBe(before)
      expect(before.getAttribute('data-closing')).toBe('true')
      observer.disconnect()
      dialog.unmount()

      const drawer = render(<Drawer open modal={false} title="詳細" onClose={vi.fn()} />)
      const drawerBefore = screen.getByRole('dialog')
      drawer.rerender(<Drawer open={false} modal={false} title="詳細" onClose={vi.fn()} />)
      expect(screen.getByRole('dialog')).toBe(drawerBefore)
      expect(drawerBefore.getAttribute('data-closing')).toBe('true')
      drawer.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('動きを減らす設定では閉じの印を立てず即時に外す', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      document.documentElement.dataset.theme = 'v8'
      const dialog = render(<Dialog open modal={false} title="お知らせ" onCancel={vi.fn()} />)
      dialog.rerender(<Dialog open={false} modal={false} title="お知らせ" onCancel={vi.fn()} />)
      expect(screen.queryByRole('dialog')).toBeNull()
      dialog.unmount()
    } finally {
      window.matchMedia = original
    }
  })

  it('全体の CSS の開く動き（lh-surface-in）は V8 の窓に当てない（部品の閉じる動きに勝ってしまう）', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const rules = [...css.matchAll(/([^{}]*\[data-design-part="dialog"\][^{}]*)\{[^}]*animation:\s*lh-surface-in/g)].map((m) => m[1].trim())
    expect(rules.length).toBeGreaterThan(0)
    for (const selector of rules) expect(selector).toMatch(/:root:not\(\[data-theme="v8"\]\)/)
  })
})
