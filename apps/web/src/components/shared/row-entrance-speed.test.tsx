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


function start(row: Element) {
  const event = new Event('animationstart', { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: 'v8-content-in' })
  row.dispatchEvent(event)
}

function wrap(body: HTMLTableSectionElement) {
  const scroller = document.createElement('main')
  body.parentElement!.replaceWith(scroller)
  const table = document.createElement('table')
  table.appendChild(body)
  scroller.appendChild(table)
  return scroller
}

it('初回の実データをスクロールしたら、仮想行の載せ替えで登場を繰り返さない', () => {
  const body = table(2), scroller = wrap(body)
  render(<RowEntranceSettle />)
  start(body.children[0])
  scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(true)
  body.replaceChildren(document.createElement('tr'))
  expect(body.children[0].matches('tbody:not([data-rows-settled]) > tr')).toBe(false)
})

it('実際に送った領域の表だけを済みにし、別の表やセル内のスクロールは変えない', () => {
  const first = table(1), left = wrap(first)
  const second = table(1); wrap(second)
  const cell = document.createElement('td'), input = document.createElement('textarea')
  cell.appendChild(input); first.children[0].appendChild(cell)
  render(<RowEntranceSettle />)
  start(first.children[0]); start(second.children[0])
  input.dispatchEvent(new Event('scroll'))
  expect(first.hasAttribute('data-rows-settled')).toBe(false)
  left.dispatchEvent(new Event('scroll'))
  expect(first.hasAttribute('data-rows-settled')).toBe(true)
  expect(second.hasAttribute('data-rows-settled')).toBe(false)
})

it('骨組み・仮想余白だけのスクロールでは済みにせず、遅れて載る実データの初回を保つ', () => {
  const body = table(2), scroller = wrap(body)
  body.children[0].innerHTML = '<td><span data-skeleton=""></span></td>'
  body.children[1].setAttribute('aria-hidden', 'true')
  render(<RowEntranceSettle />)
  start(body.children[0]); start(body.children[1])
  scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
  body.replaceChildren(document.createElement('tr'))
  start(body.children[0])
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
  scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(true)
})

it('登場開始後でも実データが無くなっていれば、次の読み込みを済みにしない', () => {
  const body = table(1), scroller = wrap(body)
  render(<RowEntranceSettle />)
  start(body.children[0])
  body.children[0].innerHTML = '<td role="status">読み込み中</td>'
  scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
})

it('スクロールしない初回は、既存の最後の行の完了まで待つ', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const body = table(2)
  const last = body.children[1]
  let running = true
  Object.defineProperty(body, 'getAnimations', { value: () => running ? [{ animationName: 'v8-content-in', playState: 'running', effect: { target: last } }] : [] })
  Object.defineProperty(body.children[0], 'getAnimations', { value: () => [] })
  Object.defineProperty(last, 'getAnimations', { value: () => [] })
  render(<RowEntranceSettle />)
  start(body.children[0]); start(last); end(body.children[0])
  frames.shift()!(0)
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
  running = false; end(last); frames.shift()!(0)
  expect(body.hasAttribute('data-rows-settled')).toBe(true)
})

it('スクロールで済んだ表の予約済み終了確認はもう動きを取得しない', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const body = table(1), scroller = wrap(body), animations = vi.fn(() => [])
  Object.defineProperty(body, 'getAnimations', { value: animations })
  Object.defineProperty(body.children[0], 'getAnimations', { value: () => [] })
  render(<RowEntranceSettle />)
  start(body.children[0]); end(body.children[0])
  scroller.dispatchEvent(new Event('scroll'))
  frames.shift()!(0)
  expect(animations).not.toHaveBeenCalled()
  expect(body.hasAttribute('data-rows-settled')).toBe(true)
})

it('アンマウントした外枠は開始・スクロールを処理しない', () => {
  const body = table(1), scroller = wrap(body)
  const view = render(<RowEntranceSettle />)
  start(body.children[0]); view.unmount()
  scroller.dispatchEvent(new Event('scroll'))
  start(body.children[0]); scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
})

it('動きを減らす場合のように登場が始まらない表や隠れた表は、スクロールだけで変更しない', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const body = table(1), scroller = wrap(body)
  render(<RowEntranceSettle />)
  scroller.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(false)
})

it('ページ全体のスクロールも、開始済みの実データだけを済みにする', () => {
  const body = table(1)
  render(<RowEntranceSettle />)
  start(body.children[0]); document.dispatchEvent(new Event('scroll'))
  expect(body.hasAttribute('data-rows-settled')).toBe(true)
})
