// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FilterPopover } from './filter-popover'
import MenuPortal from './menu-portal'

function Example() {
  const [open, setOpen] = useState(false)
  const [nested, setNested] = useState(false)
  return <FilterPopover open={open} onClose={() => setOpen(false)} label="期間で絞る"
    trigger={<button onClick={() => setOpen(value => !value)}>絞る</button>}
    actions={<button onClick={() => setOpen(false)}>閉じる</button>}>
    <button onClick={() => setNested(true)}>開始日</button>
    <MenuPortal open={nested} getAnchor={() => screen.getByRole('button', { name: '開始日' })} onClose={() => setNested(false)}>
      <button>日付候補</button>
    </MenuPortal>
  </FilterPopover>
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('reduce=%sでも連続した開閉を受け、Escで焦点を戻す', reduced => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  render(<Example />)
  const trigger = screen.getByRole('button', { name: '絞る' })
  for (let i = 0; i < 3; i++) {
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '開始日' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  }
})

it('内側の日付候補のEscで外の絞り込みを閉じず、外への押下で閉じる', () => {
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: '絞る' }))
  fireEvent.click(screen.getByRole('button', { name: '開始日' }))
  expect(screen.getByRole('button', { name: '日付候補' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: '日付候補' })).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('画面の右下では上へ開き、余白内へ収めた側を起点にする', () => {
  vi.stubGlobal('innerWidth', 300); vi.stubGlobal('innerHeight', 200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 160, bottom: 190, left: 240, right: 290, width: 50 } as DOMRect)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: '絞る' }))
  const portal = document.querySelector<HTMLElement>('[data-menu-portal]')!
  expect(portal.dataset.placement).toBe('up')
  expect(portal.dataset.origin).toBe('right')
  expect(portal.style.left).toBe('90px')
  expect(portal.style.top).toBe('56px')
  act(() => fireEvent(window, new Event('resize')))
  expect(portal.style.maxWidth).toBe('calc(100vw - 16px)')
})

it('PortalのEscを元の道具の段へ伝えず、内側だけを閉じる', () => {
  const outer = vi.fn()
  render(<div onKeyDown={outer}><Example /></div>)
  fireEvent.click(screen.getByRole('button', { name: '絞る' }))
  fireEvent.click(screen.getByRole('button', { name: '開始日' }))
  fireEvent.keyDown(screen.getByRole('button', { name: '日付候補' }), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: '日付候補' })).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(outer).not.toHaveBeenCalled()
})

function mockVisibilityTransition({ property = 'visibility', state = 'running', end = 1 }: { property?: string; state?: string; end?: number } = {}) {
  vi.spyOn(HTMLElement.prototype, 'getAnimations').mockImplementation(function (this: HTMLElement) {
    const target = this.querySelector<HTMLElement>('button[style]')
    if (!target || target.style.visibility !== 'hidden') return []
    return [{ transitionProperty: property, playState: state, effect: { target: target.parentElement, getComputedTiming: () => ({ endTime: end }) } } as unknown as Animation]
  })
}

function visibilityEnd(target: HTMLElement, propertyName = 'visibility') {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  fireEvent(target, event)
}

it('子が可視になってから一度だけ準備を通知し、再測定では焦点を奪わない', () => {
  mockVisibilityTransition()
  const ready = vi.fn()
  render(<>
    <button>基準</button>
    <MenuPortal open getAnchor={() => screen.getByRole('button', { name: '基準' })} onClose={vi.fn()} onReady={ready} focusPanel>
      <section><button style={{ visibility: 'hidden' }}>面の操作</button></section>
    </MenuPortal>
  </>)
  const target = screen.getByText('面の操作')
  const focus = vi.spyOn(target, 'focus')
  expect(target.closest<HTMLElement>('[data-menu-portal]')?.dataset.ready).toBe('true')
  expect(ready).not.toHaveBeenCalled()
  expect(focus).not.toHaveBeenCalled()
  visibilityEnd(target, 'opacity')
  expect(ready).not.toHaveBeenCalled()
  target.style.visibility = 'visible'
  visibilityEnd(target)
  expect(ready).toHaveBeenCalledOnce()
  expect(focus).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(target)
  screen.getByRole('button', { name: '基準' }).focus()
  fireEvent(window, new Event('resize'))
  visibilityEnd(target)
  expect(ready).toHaveBeenCalledOnce()
  expect(focus).toHaveBeenCalledOnce()
})

it('可視化を待つ間に閉じるか外すと通知を取り消し、開き直すと一度だけ行う', () => {
  mockVisibilityTransition()
  const ready = vi.fn()
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const tree = (open: boolean) => <MenuPortal open={open} getAnchor={() => anchor} onClose={vi.fn()} onReady={ready} focusPanel><button style={{ visibility: 'hidden' }}>面の操作</button></MenuPortal>
  const view = render(tree(true))
  const first = screen.getByText('面の操作')
  view.rerender(tree(false))
  first.style.visibility = 'visible'
  visibilityEnd(first)
  expect(ready).not.toHaveBeenCalled()
  view.rerender(tree(true))
  const second = screen.getByText('面の操作')
  second.style.visibility = 'visible'
  visibilityEnd(second)
  expect(ready).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(second)
  view.rerender(tree(false))
  view.rerender(tree(true))
  const last = screen.getByText('面の操作')
  view.unmount()
  last.style.visibility = 'visible'
  visibilityEnd(last)
  expect(ready).toHaveBeenCalledOnce()
  anchor.remove()
})

it('自動焦点を持たない面も可視化後にonReadyの焦点指定を受ける', () => {
  mockVisibilityTransition()
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const ready = vi.fn(() => document.querySelector<HTMLElement>('[data-probe-target]')?.focus())
  const view = render(<MenuPortal open getAnchor={() => anchor} onClose={vi.fn()} onReady={ready}>
    <button data-probe-target style={{ visibility: 'hidden' }}>指定の操作</button>
  </MenuPortal>)
  const target = screen.getByText('指定の操作')
  expect(ready).not.toHaveBeenCalled()
  target.style.visibility = 'visible'
  visibilityEnd(target)
  expect(ready).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(target)
  view.unmount()
  anchor.remove()
})

it.each([{ isComposing: true }, { keyCode: 229 }])('変換中のEsc %j は閉じず、その後のEscは閉じて戻る', composing => {
  render(<Example />)
  const trigger = screen.getByRole('button', { name: '絞る' })
  fireEvent.click(trigger)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '開始日' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape', ...composing })
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it.each(['focus', 'pointer', 'key'])('可視化待ちに%sで別の操作へ進むと古い焦点を取り消す', operation => {
  mockVisibilityTransition()
  const ready = vi.fn()
  const view = render(<>
    <button>基準</button><button>別の操作</button>
    <MenuPortal open getAnchor={() => screen.getByRole('button', { name: '基準' })} onClose={vi.fn()} onReady={ready} focusPanel>
      <section><button style={{ visibility: 'hidden' }}>面の操作</button></section>
    </MenuPortal>
  </>)
  const target = screen.getByText('面の操作')
  const focus = vi.spyOn(target, 'focus')
  const other = screen.getByRole('button', { name: '別の操作' })
  if (operation === 'focus') other.focus()
  if (operation === 'pointer') fireEvent.pointerDown(other)
  if (operation === 'key') fireEvent.keyDown(document, { key: 'Tab' })
  target.style.visibility = 'visible'
  visibilityEnd(target)
  fireEvent(window, new Event('resize'))
  expect(ready).not.toHaveBeenCalled()
  expect(focus).not.toHaveBeenCalled()
  view.unmount()
})

it.each([
  { property: 'visibility', state: 'paused', end: 1 },
  { property: 'visibility', state: 'running', end: Infinity },
  { property: 'opacity', state: 'running', end: 1 },
])('別の演出や停止中の遷移%jはonReadyを妨げない', animation => {
  mockVisibilityTransition(animation)
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const ready = vi.fn(() => screen.getByRole('button', { name: '実際の操作' }).focus())
  const view = render(<MenuPortal open getAnchor={() => anchor} onClose={vi.fn()} onReady={ready}>
    <section><button style={{ visibility: 'hidden' }}>元から隠れた操作</button><button>実際の操作</button></section>
  </MenuPortal>)
  expect(ready).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '実際の操作' }))
  view.unmount()
  anchor.remove()
})

it('元から隠れ続ける最初の操作でもonReadyの別の焦点指定を妨げない', () => {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const ready = vi.fn(() => screen.getByRole('button', { name: '実際の操作' }).focus())
  const view = render(<MenuPortal open getAnchor={() => anchor} onClose={vi.fn()} onReady={ready}>
    <section><button style={{ visibility: 'hidden' }}>元から隠れた操作</button><button>実際の操作</button></section>
  </MenuPortal>)
  expect(ready).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '実際の操作' }))
  view.unmount()
  anchor.remove()
})
