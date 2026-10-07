// @vitest-environment happy-dom
/*
 * 候補の多い Select（タグ 2,000 個など）は、開いた一覧の見えている所だけ描く
 * （2026-10-07 速さ）。読み上げには「全 n 件中 m 件目」を渡す。
 * 少ない Select は従来どおり全部描き、位置の属性も付けない。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import Select from './select'

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const many = Array.from({ length: 2000 }, (_, i) => ({ value: `t${i}`, label: `タグ ${i}` }))

describe('候補の多い Select', () => {
  test('2,000 個でも描く候補は一部だけ。位置と全体数を伝える', async () => {
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Select aria-label="タグ" value="t0" onChange={() => {}} options={many} />) })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'タグ' })) })
    const options = document.querySelectorAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options.length).toBeLessThan(100)
    expect(options[0].getAttribute('aria-posinset')).toBe('1')
    expect(options[0].getAttribute('aria-setsize')).toBe('2000')
  })

  test('一覧をスクロールすると、その位置の候補に描き替わる（器が後から描いても）', async () => {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    const tops = new WeakMap<Element, number>()
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return tops.get(this as Element) ?? 0 },
      set(value: number) { tops.set(this as Element, value) },
    })
    try {
      let view!: ReturnType<typeof render>
      await act(async () => { view = render(<Select aria-label="タグ" value="t0" onChange={() => {}} options={many} />) })
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'タグ' })) })
      const panel = document.querySelector<HTMLElement>('[data-menu-portal]')!
      await act(async () => {
        panel.scrollTop = 38 * 1000
        panel.dispatchEvent(new Event('scroll'))
        await new Promise((done) => requestAnimationFrame(() => done(null)))
      })
      const positions = [...document.querySelectorAll('[role="option"]')].map((o) => Number(o.getAttribute('aria-posinset')))
      expect(Math.min(...positions)).toBeLessThanOrEqual(1001)
      expect(Math.max(...positions)).toBeGreaterThanOrEqual(1001)
    } finally {
      if (desc) Object.defineProperty(Element.prototype, 'scrollTop', desc)
    }
  })

  test('少ない Select は全部描く', async () => {
    let view!: ReturnType<typeof render>
    const few = many.slice(0, 20)
    await act(async () => { view = render(<Select aria-label="タグ" value="t0" onChange={() => {}} options={few} />) })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'タグ' })) })
    const options = document.querySelectorAll('[role="option"]')
    expect(options.length).toBe(20)
    expect(options[0].getAttribute('aria-setsize')).toBeNull()
  })
})
