// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RowEntranceSettle, { settleRowEntrance } from './row-entrance-settle'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function table(count: number) {
  const table = document.createElement('table')
  const body = document.createElement('tbody')
  for (let i = 0; i < count; i += 1) body.appendChild(document.createElement('tr'))
  table.appendChild(body)
  document.body.appendChild(table)
  return body
}

function end(row: Element) {
  const event = new Event('animationend', { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: 'v8-content-in' })
  row.dispatchEvent(event)
}

describe('大量の行の登場が終わるときの処理', () => {
  it('2,000行の終了通知を1回の確認にまとめ、行ごとの動き取得を繰り返さない', () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const body = table(2000)
    const animations = vi.fn(() => [])
    const rowAnimations = vi.fn(() => [{ animationName: 'v8-content-in', playState: 'running' }])
    Object.defineProperty(body, 'getAnimations', { value: animations })
    for (const row of Array.from(body.children)) Object.defineProperty(row, 'getAnimations', {
      value: rowAnimations,
    })
    render(<RowEntranceSettle />)
    for (const row of Array.from(body.children)) end(row)
    expect(raf).toHaveBeenCalledTimes(1)
    expect(animations).not.toHaveBeenCalled()
    frames[0](0)
    expect(animations).toHaveBeenCalledTimes(1)
    expect(rowAnimations).not.toHaveBeenCalled()
    expect(animations).toHaveBeenCalledWith({ subtree: true })
    expect(body.hasAttribute('data-rows-settled')).toBe(true)
  })

  it('途中で加わった行は完了を待ち、セル内の別の動きは完了判定へ混ぜない', () => {
    const body = table(2)
    const [first, last] = Array.from(body.children)
    const active = { animationName: 'v8-content-in', playState: 'running', effect: { target: last } }
    const animations = vi.fn(() => [active])
    Object.defineProperty(body, 'getAnimations', { value: animations })
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: first })).toBe(false)
    expect(body.hasAttribute('data-rows-settled')).toBe(false)
    const cell = document.createElement('td')
    last.appendChild(cell)
    active.effect.target = cell
    expect(settleRowEntrance({ animationName: 'v8-content-in', target: first })).toBe(true)
  })

  it('外枠を外すと予定した確認も取り消す', () => {
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 12))
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const body = table(1)
    const view = render(<RowEntranceSettle />)
    end(body.children[0])
    view.unmount()
    expect(cancel).toHaveBeenCalledWith(12)
    expect(body.hasAttribute('data-rows-settled')).toBe(false)
  })

  it('確認までに行が増えたら動きを待ち、終わった行が外れても済みにできる', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const body = table(1)
    const first = body.children[0]
    const extra = document.createElement('tr')
    let running = true
    Object.defineProperty(body, 'getAnimations', { value: () => running ? [{ animationName: 'v8-content-in', playState: 'running', effect: { target: extra } }] : [] })
    render(<RowEntranceSettle />)
    end(first)
    body.appendChild(extra)
    frames[0](0)
    expect(body.hasAttribute('data-rows-settled')).toBe(false)
    running = false
    end(extra)
    extra.remove()
    frames[1](0)
    expect(body.hasAttribute('data-rows-settled')).toBe(true)
  })
})
