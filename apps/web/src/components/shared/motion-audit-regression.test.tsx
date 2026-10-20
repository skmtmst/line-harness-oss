// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import Button from './button'
import { RefreshCover } from './refresh-cover'
import { readFileSync } from 'node:fs'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme') })
it('F-2: 保存と完了の長い文字を含めて、最初から幅を固定する', () => {
  document.documentElement.dataset.theme = 'v8'
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) { return (this.textContent?.length ?? 0) * 10 + 30 })
  const view = render(<Button busy={false} done={false}>保存する</Button>)
  const idleWidth = screen.getByRole('button').style.width
  expect(Number.parseFloat(idleWidth)).toBeGreaterThan(70)
  view.rerender(<Button busy done={false}>保存する</Button>)
  expect(screen.getByRole('button').style.width).toBe(idleWidth)
  view.rerender(<Button busy={false} done>保存する</Button>)
  expect(screen.getByRole('button').style.width).toBe(idleWidth)
})
it('F-4: V8の読み直しは行を薄めず、小さい更新中だけ出す', () => {
  vi.useFakeTimers(); document.documentElement.dataset.theme = 'v8'
  const view = render(<RefreshCover refreshing><button>今の行</button></RefreshCover>)
  act(() => vi.advanceTimersByTime(301))
  expect(screen.getByRole('status').textContent).toBe('更新中')
  expect(view.container.querySelector('.v7-refresh-dim')).toBeNull()
  expect(screen.getByRole('button').disabled).toBe(false)
})
it('WEB-240: 保存開始で窓の焦点を最初の欄へ戻さない', async () => {
  vi.useFakeTimers(); const view = render(<Dialog open title="編集" busy={false} onCancel={() => {}}><input aria-label="本文" /></Dialog>)
  await act(async () => vi.advanceTimersByTime(32))
  const input = screen.getByRole('textbox'); input.focus()
  view.rerender(<Dialog open title="編集" busy onCancel={() => {}}><input aria-label="本文" /></Dialog>)
  await act(async () => vi.advanceTimersByTime(32))
  expect(document.activeElement).toBe(input)
})
it('WEB-239/240: 日本語変換中のEscapeで窓を閉じない', () => {
  const close = vi.fn(); render(<Dialog open title="編集" onCancel={close}><input aria-label="本文" /></Dialog>)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', isComposing: true })
  expect(close).not.toHaveBeenCalled()
})
it('F-5: メニューは80msで消える口を持つ', () => {
  expect(readFileSync('src/components/shared/menu-portal.tsx','utf8')).toContain('exitDuration')
})
it('F-6: 手順の窓は本文の高さを観測し、手順切替に動きを付ける', () => {
  const source = readFileSync('src/components/shared/dialog.tsx', 'utf8')
  expect(source).toContain('useStepMotion')
})

it('WEB-240: 開いた直後に誤りの欄へ移した焦点を、初期フォーカスの予約で奪わない', async () => {
  vi.useFakeTimers()
  render(<Dialog open title="入力" onCancel={() => {}}><input aria-label="名前" /><textarea aria-label="ドメイン" /></Dialog>)
  const domain = screen.getByRole('textbox', { name: 'ドメイン' })
  domain.focus()
  await act(async () => vi.advanceTimersByTime(32))
  expect(document.activeElement).toBe(domain)
})
