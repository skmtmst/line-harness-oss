// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import TruncatedText, { compactUrl } from './truncated-text'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('省略した文字の全文確認', () => {
  it('URLは行き先を残し、乗せるとコピー元と同じ全文を表示する', () => {
    const value = 'https://example.com/campaign/2026/landing?source=line'
    render(<TruncatedText value={value} url />)
    const text = screen.getByText('https://example.com/…/landing')
    fireEvent.mouseEnter(text)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe(value)
    expect(text.getAttribute('aria-describedby')).toBe(tip.id)
    expect(text.getAttribute('aria-label')).toBe(value)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('切れた名前をTabで全文確認でき、短い名前にはTab停止を増やさない', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
    const { rerender } = render(<TruncatedText value="長い項目の名前" />)
    const text = screen.getByText('長い項目の名前')
    expect(text.tabIndex).toBe(0)
    fireEvent.focus(text)
    expect(screen.getByRole('tooltip').textContent).toBe('長い項目の名前')
    fireEvent.blur(text)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.restoreAllMocks()
    rerender(<TruncatedText value="短い名前" />)
    expect(screen.getByText('短い名前').hasAttribute('tabindex')).toBe(false)
  })

  it('リンク中の名前は親リンクのfocusで確認し、Tab停止を重ねない', () => {
    const value = 'https://example.com/first/landing'
    render(<a href={value}><TruncatedText value={value} url /></a>)
    const link = screen.getByRole('link')
    expect(link.querySelector('[data-truncated-text]')?.hasAttribute('tabindex')).toBe(false)
    fireEvent.focus(link)
    expect(screen.getByRole('tooltip').textContent).toBe(value)
    expect(link.getAttribute('href')).toBe(value)
  })

  it('窓の中の全文はEscで吹き出しだけを閉じ、次のEscで窓を閉じる', () => {
    const cancel = vi.fn()
    render(<Dialog open title="確認" onCancel={cancel} onConfirm={() => {}}><TruncatedText value="https://example.com/first/landing" url /></Dialog>)
    fireEvent.mouseEnter(screen.getByText('https://example.com/…/landing'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('短いURLやURL以外の文字を壊さない', () => {
    expect(compactUrl('https://example.com/landing')).toBe('https://example.com/landing')
    expect(compactUrl('通常の名前')).toBe('通常の名前')
  })
})

it('タグ幅専用の不可視コピーは測らず、表示する文字の全文確認を残す', () => {
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
  try {
    render(<><span data-tag-overflow-measure="" aria-hidden="true" inert><TruncatedText value="不可視の名前" /></span><TruncatedText value="表示する長い名前" /></>)
    expect(new Set(observe.mock.calls.map(([node]) => node))).toEqual(new Set([screen.getByText('表示する長い名前')]))
    expect(screen.getByText('不可視の名前').hasAttribute('tabindex')).toBe(false)
    const visible = screen.getByText('表示する長い名前')
    expect(visible.tabIndex).toBe(0)
    fireEvent.focus(visible)
    expect(screen.getByRole('tooltip').textContent).toBe('表示する長い名前')
  } finally { vi.unstubAllGlobals() }
})
