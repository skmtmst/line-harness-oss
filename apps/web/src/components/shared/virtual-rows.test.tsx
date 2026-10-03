// @vitest-environment happy-dom
/*
 * 共有の行の窓（VirtualRows・M10・V8のみ）。
 * - 見える分＋前後の予備だけ描き、上下に詰め物で高さを保つ
 * - v7・行数が少ないときは今までどおり全部描く（聞き口なし）
 * - 指が当たっている行は窓から外さない
 * - 選んだ行の印は描いた分だけ今までどおり（選び自体は外の Set）
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VirtualRows, virtualRange } from './virtual-rows'

afterEach(() => cleanup())

describe('virtualRange（窓の計算）', () => {
  it('見える分＋前後の予備', () => {
    // 行78px・上から200px・高さ800px・予備5行・2,000行
    expect(virtualRange(2000, 78, 200, 800, 5, null)).toEqual({ start: 0, end: 18 })
    expect(virtualRange(2000, 78, 2000, 800, 5, null)).toEqual({ start: 20, end: 41 })
  })

  it('前後は0・行数で止める', () => {
    expect(virtualRange(10, 78, 0, 800, 5, null)).toEqual({ start: 0, end: 10 })
    expect(virtualRange(2000, 78, 200000, 800, 5, null).end).toBe(2000)
  })

  it('指が当たっている行は外さない', () => {
    // 上の方に指があるまま下へ送っても、指の行まで窓を広げる。
    const next = virtualRange(2000, 78, 50000, 800, 5, 3)
    expect(next.start).toBeLessThanOrEqual(3)
    expect(next.end).toBeGreaterThan(3)
  })
})

describe('VirtualRows（描く分）', () => {
  const renderRow = (index: number) => <span>{`行${index}`}</span>

  it('行数が少ないときは全部描き、包みも詰め物も付けない', () => {
    const { container } = render(<VirtualRows count={3} rowHeight={78} renderRow={renderRow} />)
    expect(screen.getByText('行0')).toBeTruthy()
    expect(screen.getByText('行2')).toBeTruthy()
    // v7（試験の既定）では窓にしない。
    expect(container.querySelector('[data-virtual-index]')).toBeNull()
  })

  it('V8でも測る前は最初の分だけ描く', () => {
    document.documentElement.dataset.theme = 'v8'
    try {
      const { container } = render(<VirtualRows count={2000} rowHeight={78} renderRow={renderRow} />)
      expect(screen.getByText('行0')).toBeTruthy()
      expect(screen.queryByText('行1999')).toBeNull()
      // 下の詰め物で高さを保つ。
      const spacer = container.querySelector('[aria-hidden="true"]')
      expect(spacer?.getAttribute('style')).toContain('height')
    } finally {
      delete document.documentElement.dataset.theme
    }
  })
})
