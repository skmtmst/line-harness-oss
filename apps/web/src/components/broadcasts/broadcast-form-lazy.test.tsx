// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BroadcastFormProps } from './broadcast-form-props'

vi.hoisted(() => { process.env.NEXT_PUBLIC_API_URL = 'http://worker.test' })
// Mirror App Router dynamic: cached React.lazy plus its loading fallback.
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense } = await import('react')
  return { default: (loader: () => Promise<{ default: React.ComponentType<BroadcastFormProps> }>, options: { loading: React.ComponentType }) => {
    const Loaded = lazy(loader)
    return (props: BroadcastFormProps) => <Suspense fallback={<options.loading />}><Loaded {...props} /></Suspense>
  } }
})
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
const cancelled = vi.fn(), success = vi.fn(), saved = vi.fn(), mounted = vi.fn()
function Form(props: BroadcastFormProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  React.useEffect(() => { mounted() }, [])
  return <>
    <span>{props.openTemplatePickerInitially ? 'picker-open' : 'form-open'}</span>
    <input aria-label="本文" value={value} onChange={event => setValue(event.target.value)} />
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" onClick={() => setError('保存失敗')}>保存を失敗させる</button>
    <button type="button" onClick={props.onCancel}>フォームを閉じる</button>
    <button type="button" onClick={() => props.onSuccess({ id: 'local-result' } as never)}>保存完了を返す</button>
    <button type="button" onClick={() => props.onDraftSaved?.({ id: 'local-draft' } as never)}>下書き完了を返す</button>
  </>
}
const props = (extra: Partial<BroadcastFormProps> = {}): BroadcastFormProps => ({ tags: [], onCancel: cancelled, onSuccess: success, onDraftSaved: saved, ...extra })
async function render(Component: React.ComponentType<BroadcastFormProps>, values = props()) {
  await act(async () => { root.render(<Component {...values} />) })
}
const button = (name: string) => [...host.querySelectorAll('button')].find(el => el.textContent === name)!
beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('./broadcast-form')
  host = document.createElement('div');document.body.appendChild(host);root = createRoot(host)
})
afterEach(() => { act(() => root.unmount());host.remove() })

it('shows shared pending state/cancel, then passes picker and callbacks without resetting entered input on rerender', async () => {
  let resolve!: (value: { default: typeof Form }) => void
  const pending = new Promise<{ default: typeof Form }>(done => { resolve = done })
  vi.doMock('./broadcast-form', () => pending)
  const { default: Lazy } = await import('./broadcast-form-lazy')
  await render(Lazy, props({ openTemplatePickerInitially: true }))
  expect(host.querySelector('[data-list-state="loading"]')).toBeTruthy()
  expect(button('作成をやめる')).toBeTruthy()
  await act(async () => { resolve({ default: Form }) })
  await waitFor(() => expect(host.textContent).toContain('picker-open'))
  const input = host.querySelector('input')!
  act(() => { fireEvent.input(input, { target: { value: '入力を保持' } }) })
  await render(Lazy, props({ tagsStatus: 'error', openTemplatePickerInitially: true }))
  expect(host.querySelector('input')?.value).toBe('入力を保持')
  expect(mounted).toHaveBeenCalledTimes(1)
  act(() => button('保存を失敗させる').click())
  expect(host.textContent).toContain('保存失敗')
  expect(host.querySelector('input')?.value).toBe('入力を保持')
  act(() => button('下書き完了を返す').click())
  act(() => button('保存完了を返す').click())
  expect(saved).toHaveBeenCalledWith({ id: 'local-draft' })
  expect(success).toHaveBeenCalledWith({ id: 'local-result' })
})

it('renders import failure locally and retries a new chunk request with the same current props', async () => {
  vi.doMock('./broadcast-form', () => { throw new Error('chunk unavailable') })
  const { default: Lazy } = await import('./broadcast-form-lazy')
  await render(Lazy, props({ openTemplatePickerInitially: true }))
  await waitFor(() => expect(host.textContent).toContain('配信作成画面を読み込めませんでした'))
  expect(host.querySelector('[data-list-state="error"]')).toBeTruthy()
  vi.doMock('./broadcast-form', () => { throw new Error('chunk still unavailable') })
  await act(async () => { button('もう一度読み込む').click() })
  await waitFor(() => expect(host.querySelector('[data-list-state="error"]')).toBeTruthy())
  expect(button('作成をやめる')).toBeTruthy()
  vi.doMock('./broadcast-form', () => ({ default: Form }))
  await act(async () => { button('もう一度読み込む').click() })
  await waitFor(() => expect(host.textContent).toContain('picker-open'))
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(success).not.toHaveBeenCalled()
})

it('keeps cancel available during pending code and never mounts late results after cancellation', async () => {
  let resolve!: (value: { default: typeof Form }) => void
  vi.doMock('./broadcast-form', () => new Promise(done => { resolve = done }))
  const { default: Lazy } = await import('./broadcast-form-lazy')
  const cancel = () => { cancelled();root.render(<p>一覧へ戻った</p>) }
  await render(Lazy, props({ onCancel: cancel }))
  act(() => button('作成をやめる').click())
  expect(cancelled).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ default: Form }) })
  expect(host.textContent).toBe('一覧へ戻った')
  expect(mounted).not.toHaveBeenCalled()
  expect(success).not.toHaveBeenCalled()
})

it('does not mount a late retry after unmount and reopens using recovered code only', async () => {
  vi.doMock('./broadcast-form', () => { throw new Error('chunk unavailable') })
  const { default: Lazy } = await import('./broadcast-form-lazy')
  await render(Lazy)
  await waitFor(() => expect(host.querySelector('[data-list-state="error"]')).toBeTruthy())
  let resolve!: (value: { default: typeof Form }) => void
  let releaseImport!: () => void
  const importScheduled = new Promise<void>(done => { releaseImport = done })
  const retryImportStarted = vi.fn()
  vi.doMock('./broadcast-form', async () => {
    await importScheduled
    retryImportStarted()
    return new Promise(done => { resolve = done })
  })
  await act(async () => { button('もう一度読み込む').click() })
  releaseImport()
  // Reactのact完了だけでは、非同期のmock import factory開始は保証されない。
  await waitFor(() => expect(retryImportStarted).toHaveBeenCalledTimes(1))
  act(() => { root.render(<p>一覧へ戻った</p>) })
  await act(async () => { resolve({ default: Form }) })
  expect(host.textContent).toBe('一覧へ戻った')
  expect(mounted).not.toHaveBeenCalled()
  await render(Lazy, props({ openTemplatePickerInitially: true }))
  await waitFor(() => expect(host.textContent).toContain('picker-open'))
  expect(mounted).toHaveBeenCalledTimes(1)
})
