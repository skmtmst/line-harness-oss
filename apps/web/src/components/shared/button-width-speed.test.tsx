// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from './button'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
})

describe('保存中・完了のボタン幅', () => {
  it('同じ文字でもアイコン・寸法・非表示が変わったら測り直す', () => {
    document.documentElement.dataset.theme = 'v8'
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    const { rerender } = render(<Button busy={false}>保存する</Button>)
    let reads = width.mock.calls.length
    rerender(<Button busy={false}><svg aria-hidden="true" />保存する</Button>)
    expect(width.mock.calls.length).toBeGreaterThan(reads)
    reads = width.mock.calls.length
    rerender(<Button busy={false} style={{ paddingInline: 20 }}><svg aria-hidden="true" />保存する</Button>)
    expect(width.mock.calls.length).toBeGreaterThan(reads)
    reads = width.mock.calls.length
    rerender(<Button busy={false} hidden style={{ paddingInline: 20 }}><svg aria-hidden="true" />保存する</Button>)
    rerender(<Button busy={false} style={{ paddingInline: 20 }}><svg aria-hidden="true" />保存する</Button>)
    expect(width.mock.calls.length).toBeGreaterThan(reads)
  })

  it('同じラベルの親の再描画では測り直さず、ラベルが変わったら幅を確保する', () => {
    document.documentElement.dataset.theme = 'v8'
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    const { rerender } = render(<Button busy={false} done={false}>保存する</Button>)
    const button = screen.getByRole('button')
    expect(button.style.width).toBe('121px')
    const reads = width.mock.calls.length
    for (let i = 0; i < 5; i += 1) rerender(<Button busy={false} done={false}>保存する</Button>)
    expect(width.mock.calls.length).toBe(reads)
    rerender(<Button busy={false} done={false}>機能設定を保存</Button>)
    expect(width.mock.calls.length).toBeGreaterThan(reads)
    expect(button.style.width).toBe('121px')
    rerender(<Button busy done={false}>機能設定を保存</Button>)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('保存中…')
    expect(button.style.minWidth).toBe('100px')
  })
})
