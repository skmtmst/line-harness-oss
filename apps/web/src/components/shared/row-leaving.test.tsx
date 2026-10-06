// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRowLeaving } from './row-leaving'

function Probe({ reload }: { reload: () => Promise<void> }) {
  const { isLeaving, fadeOut } = useRowLeaving()
  return (
    <button type="button" data-leaving={isLeaving('a') || undefined} onClick={() => void fadeOut(['a'], reload)}>
      消す
    </button>
  )
}

describe('useRowLeaving（消える行の合図）', () => {
  afterEach(() => {
    cleanup()
  })
  it('fadeOut で行が薄くなってから読み直し、終わったら戻す', async () => {
    vi.useRealTimers()
    const reload = vi.fn(async () => {})
    render(<Probe reload={reload} />)
    const button = screen.getByRole('button', { name: '消す' })
    expect(button.getAttribute('data-leaving')).toBeNull()
    fireEvent.click(button)
    // 待っている間は消える側。
    expect(button.getAttribute('data-leaving')).toBe('true')
    expect(reload).not.toHaveBeenCalled()
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 200)
      })
    })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('data-leaving')).toBeNull()
  })

  it('動きを減らす設定では待たない', async () => {
    vi.useRealTimers()
    const matchMedia = window.matchMedia
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia
    try {
      const reload = vi.fn(async () => {})
      render(<Probe reload={reload} />)
      const start = Date.now()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '消す' }))
      })
      expect(Date.now() - start).toBeLessThan(150)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      window.matchMedia = matchMedia
    }
  })
})
