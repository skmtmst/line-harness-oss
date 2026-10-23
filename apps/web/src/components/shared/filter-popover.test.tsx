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
