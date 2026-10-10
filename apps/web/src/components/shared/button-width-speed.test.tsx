// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

it('Promiseを返す入口はbusyLabelで初回から幅を予約し、待機・成功後も幅を変えない', async () => {
  document.documentElement.dataset.theme = 'v8'
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
  let resolve!: () => void
  const save = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  const { rerender } = render(<Button onClick={save} busyLabel="読み込み中…">読み直す</Button>)
  const button = screen.getByRole('button') as HTMLButtonElement
  const initial = button.style.width
  expect(initial).toBe('121px')
  const reads = width.mock.calls.length
  fireEvent.click(button)
  fireEvent.click(button)
  expect(save).toHaveBeenCalledTimes(1)
  expect(button.style.width).toBe(initial)
  expect(width.mock.calls.length).toBe(reads)
  expect(button.getAttribute('aria-busy')).toBe('true')
  await act(async () => { resolve() })
  expect(button.disabled).toBe(false)
  expect(button.style.width).toBe(initial)
  rerender(<Button onClick={save} busyLabel="読み込み中…">読み直す</Button>)
  expect(width.mock.calls.length).toBe(reads)
})

it('普通の同期ボタンは状態用の幅を確保しない', () => {
  document.documentElement.dataset.theme = 'v8'
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
  render(<Button onClick={() => {}}>閉じる</Button>)
  expect(screen.getByRole('button').style.width).toBe('')
  expect(width).not.toHaveBeenCalled()
})
