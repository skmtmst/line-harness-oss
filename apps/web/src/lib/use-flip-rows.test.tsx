// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RovingTbody } from '@/components/shared/row-roving'

function Table({ ids, scope }: { ids: string[]; scope: string }) {
  return <table><RovingTbody reorderKey={ids.join(',')} reorderScope={scope}>{ids.map(id => <tr key={id} data-reorder-id={id}><td>{id}</td></tr>)}</RovingTbody></table>
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.style.removeProperty('--motion-base') })

it('同じ行の並べ替えだけを動かし、別条件・別ページ・行の増減では動かさない', () => {
  const cancel = vi.fn()
  const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel } as unknown as Animation)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.parentElement ? [...this.parentElement.children].indexOf(this) * 52 : 0 } as DOMRect
  })
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  document.documentElement.style.setProperty('--motion-base', '200ms')
  const view = render(<Table ids={['a', 'b']} scope="account-a:all:1" />)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<Table ids={['b', 'a']} scope="account-a:all:1" />)
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animate.mock.calls[0][1]).toMatchObject({ duration: 200 })
  animate.mockClear()
  view.rerender(<Table ids={['a', 'b']} scope="account-a:filtered:1" />)
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<Table ids={['b', 'a']} scope="account-a:filtered:2" />)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<Table ids={['a']} scope="account-a:filtered:2" />)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<Table ids={['a', 'b']} scope="account-a:filtered:2" />)
  expect(animate).not.toHaveBeenCalled()
})

it('動きを減らす設定では並べ替えでも移動しない', () => {
  const animate = vi.spyOn(HTMLElement.prototype, 'animate')
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  document.documentElement.style.setProperty('--motion-base', '200ms')
  const view = render(<Table ids={['a', 'b']} scope="a" />)
  view.rerender(<Table ids={['b', 'a']} scope="a" />)
  expect(animate).not.toHaveBeenCalled()
})
