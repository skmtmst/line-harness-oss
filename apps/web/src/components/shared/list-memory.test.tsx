// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadListMemory, saveListMemory, useListMemory } from './list-memory'

function Harness({ listKey, initial }: { listKey: string; initial: Record<string, string> }) {
  const [filters, setFilters] = useListMemory(listKey, initial)
  return (
    <button type="button" onClick={() => setFilters({ ...filters, status: 'open' })}>
      状態:{filters.status}
    </button>
  )
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
})

describe('useListMemory（一覧の記憶・F③）', () => {
  it('保存と読み出しができる', () => {
    saveListMemory('broadcasts', { filters: { status: 'open' }, scrollY: 240 })
    expect(loadListMemory('broadcasts')).toEqual({ filters: { status: 'open' }, scrollY: 240 })
  })

  it('無い鍵では null（壊れた値は捨てる）', () => {
    expect(loadListMemory('nothing')).toBeNull()
    window.sessionStorage.setItem('lh:list-memory:broken', '{oops')
    expect(loadListMemory('broken')).toBeNull()
  })

  it('覚えた絞り込みで開き直す', () => {
    saveListMemory('broadcasts', { filters: { status: 'open' }, scrollY: 0 })
    render(<Harness listKey="broadcasts" initial={{ status: 'all' }} />)
    expect(screen.getByRole('button').textContent).toContain('状態:open')
  })

  it('変えた絞り込みを覚える', () => {
    render(<Harness listKey="broadcasts" initial={{ status: 'all' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(loadListMemory('broadcasts')?.filters).toEqual({ status: 'open' })
  })

  it('戻ったときに位置へ戻す', async () => {
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      saveListMemory('broadcasts', { filters: { status: 'all' }, scrollY: 240 })
      render(<Harness listKey="broadcasts" initial={{ status: 'all' }} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(spy).toHaveBeenCalledWith(0, 240)
    } finally {
      spy.mockRestore()
    }
  })

  it('v7 では覚えない・戻さない', () => {
    document.documentElement.dataset.theme = 'v7'
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      render(<Harness listKey="broadcasts" initial={{ status: 'all' }} />)
      fireEvent.click(screen.getByRole('button'))
      expect(loadListMemory('broadcasts')).toBeNull()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
