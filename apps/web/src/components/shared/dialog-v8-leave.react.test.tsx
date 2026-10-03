// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
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
})
