// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAttentionStarMotion } from './use-attention-star-motion'
import type { ButtonHTMLAttributes, MouseEvent } from 'react'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'

function AttentionStarButton({ onClick, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown }) {
  const motion = useAttentionStarMotion()
  return <button {...props} onClick={(event) => motion(event, () => onClick?.(event))} />
}
const canPop = () => screen.getByRole('button').hasAttribute('data-star-pop')
function deferred() { let resolve!: () => void; let reject!: (reason: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function finish(name = 'animationend') {
  const event = new Event(name, { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: 'v8-star-pop' })
  fireEvent(screen.getByTestId('star'), event)
}
function Control({ initial = false, save = async () => {}, optimistic = true }: { initial?: boolean; save?: () => Promise<void>; optimistic?: boolean }) {
  const [pressed, setPressed] = useState(initial)
  return <AttentionStarButton className="existing-star" aria-pressed={pressed} aria-label={pressed ? '注目を外す' : '注目を付ける'}
    onClick={async (event) => {
      event.stopPropagation()
      const next = !pressed
      if (optimistic) setPressed(next)
      try { await save(); if (!optimistic) setPressed(next) } catch { if (optimistic) setPressed(!next) }
    }}><svg data-testid="star" /></AttentionStarButton>
}
beforeEach(() => setTestReducedMotion(false))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setTestReducedMotion(true) })

it('保存済みONの初期表示と仮想行の再mountは塗りと名前を保ち、popしない', () => {
  const save = vi.fn(async () => {})
  const view = render(<Control key="first" initial save={save} />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  expect(canPop()).toBe(false)
  view.rerender(<Control key="remounted" initial save={save} />)
  expect(screen.getByRole('button', { name: '注目を外す' }).className).toBe('existing-star')
  expect(canPop()).toBe(false)
  expect(save).not.toHaveBeenCalled()
})

it('外部の再読取でONになっても、押したことにはしない', () => {
  const view = render(<AttentionStarButton aria-pressed={false} aria-label="星"><svg data-testid="star" /></AttentionStarButton>)
  view.rerender(<AttentionStarButton aria-pressed aria-label="星"><svg data-testid="star" /></AttentionStarButton>)
  expect(canPop()).toBe(false)
})

it('友だちの楽観ONは保存完了を待たずpopし、完了後も押し口とフォーカスを保つ', async () => {
  const saving = deferred(); const save = vi.fn(() => saving.promise)
  const opened = vi.fn()
  render(<div onClick={opened}><Control save={save} /></div>)
  const button = screen.getByRole('button'); button.focus()
  fireEvent.click(button)
  expect(canPop()).toBe(true)
  expect(save).toHaveBeenCalledOnce()
  expect(opened).not.toHaveBeenCalled()
  await act(async () => saving.resolve())
  expect(canPop()).toBe(true)
  expect(document.activeElement).toBe(button)
  finish()
  expect(canPop()).toBe(false)
  expect(button.getAttribute('aria-pressed')).toBe('true')
})

it('統括の保存成功後ONは、その成功まで状態もpopも変えない', async () => {
  const saving = deferred()
  render(<Control optimistic={false} save={() => saving.promise} />)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(canPop()).toBe(false)
  await act(async () => saving.resolve())
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  expect(canPop()).toBe(true)
  finish('animationcancel')
  expect(canPop()).toBe(false)
})

it('注目を外す保存が失敗してONへ戻ってもpopし直さない', async () => {
  const saving = deferred()
  render(<Control initial save={() => saving.promise} />)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  await act(async () => saving.reject(new Error('409')))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  expect(canPop()).toBe(false)
})

it('楽観ONの失敗はOFFへ戻し、後の再読取のONを誤ってpopさせない', async () => {
  const saving = deferred()
  const view = render(<Control save={() => saving.promise} />)
  fireEvent.click(screen.getByRole('button')); expect(canPop()).toBe(true)
  await act(async () => saving.reject(new Error('failed')))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  expect(canPop()).toBe(false)
  view.rerender(<Control save={() => saving.promise} />)
  expect(canPop()).toBe(false)
})

it('保存前に失敗して状態が変わらない操作は、後の外部ONへ持ち越さない', async () => {
  const save = vi.fn(async () => {})
  const view = render(<AttentionStarButton aria-pressed={false} aria-label="星" onClick={save}><svg data-testid="star" /></AttentionStarButton>)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  view.rerender(<AttentionStarButton aria-pressed aria-label="星" onClick={save}><svg data-testid="star" /></AttentionStarButton>)
  expect(canPop()).toBe(false)
  expect(save).toHaveBeenCalledOnce()
})

it('キーボード由来のネイティブclickも同じ1回のON操作として扱う', async () => {
  const save = vi.fn(async () => {})
  render(<Control save={save} />)
  const button = screen.getByRole('button'); button.focus()
  // A keyboard activation reaches a native button as a click with detail=0.
  await act(async () => fireEvent.click(button, { detail: 0 }))
  expect(save).toHaveBeenCalledOnce()
  expect(canPop()).toBe(true)
  expect(document.activeElement).toBe(button)
})

it('連打の古い保存完了は新しいONの動きや入力を取り消さない', async () => {
  const first = deferred(); const second = deferred(); const third = deferred()
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  render(<Control save={save} />)
  const button = screen.getByRole('button')
  fireEvent.click(button); expect(canPop()).toBe(true)
  fireEvent.click(button); expect(canPop()).toBe(false)
  fireEvent.click(button); expect(canPop()).toBe(true)
  await act(async () => { first.resolve(); second.resolve(); third.resolve() })
  expect(save).toHaveBeenCalledTimes(3)
  expect(canPop()).toBe(true)
})

it('動きを減らす設定・disabledではpopを始めず、保存値と押下制限を守る', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const save = vi.fn(async () => {})
  render(<Control save={save} />)
  await act(async () => fireEvent.click(screen.getByRole('button')))
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  expect(canPop()).toBe(false)
  cleanup()
  render(<AttentionStarButton disabled aria-pressed={false} aria-label="星" onClick={save}><svg data-testid="star" /></AttentionStarButton>)
  fireEvent.click(screen.getByRole('button'))
  expect(save).toHaveBeenCalledOnce()
})

it('外れたボタンの非同期完了は、新しく載ったONをpopさせない', async () => {
  const saving = deferred()
  const view = render(<Control key="old" optimistic={false} save={() => saving.promise} />)
  fireEvent.click(screen.getByRole('button'))
  view.rerender(<Control key="new" initial />)
  await act(async () => saving.resolve())
  expect(canPop()).toBe(false)
})

it('初期表示・再mountでは監視せず、実操作中も対象ボタンのpressed属性だけを監視する', () => {
  const observe = vi.spyOn(MutationObserver.prototype, 'observe')
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
  const saving = deferred()
  const view = render(<Control key="first" initial />)
  expect(observe).not.toHaveBeenCalled()
  view.rerender(<Control key="next" save={() => saving.promise} />)
  expect(observe).not.toHaveBeenCalled()
  const button = screen.getByRole('button')
  fireEvent.click(button)
  expect(observe).toHaveBeenCalledOnce()
  expect(observe).toHaveBeenCalledWith(button, { attributes: true, attributeFilter: ['aria-pressed'] })
  expect(button.hasAttribute('data-star-pop')).toBe(true)
  finish('animationcancel')
  expect(disconnect).toHaveBeenCalledOnce()
  expect(button.hasAttribute('data-star-pop')).toBe(false)
  observe.mockRestore(); disconnect.mockRestore()
})

it('StrictModeのeffect再開とunmount後の配送でも、保存や新しい星へ影響しない', async () => {
  const saving = deferred(); const save = vi.fn(() => saving.promise)
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
  const view = render(<StrictMode><Control save={save} /></StrictMode>)
  const button = screen.getByRole('button')
  fireEvent.click(button)
  expect(canPop()).toBe(true)
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(button.hasAttribute('data-star-pop')).toBe(false)
  await act(async () => saving.resolve())
  expect(save).toHaveBeenCalledOnce()
  disconnect.mockRestore()
})
