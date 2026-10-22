// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { focusFieldById, useFormErrors, type FormErrors } from './use-form-errors'

let frames: FrameRequestCallback[]
let fields: FormErrors
let blocked: WeakSet<HTMLDetailsElement>
let finish: WeakMap<HTMLDetailsElement, () => void>
const originalFocus = HTMLElement.prototype.focus

beforeEach(() => {
  frames = []
  blocked = new WeakSet()
  finish = new WeakMap()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length })
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
    const details = this.closest('details')
    if (details && blocked.has(details)) return
    originalFocus.call(this, options)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function DisclosureForm({ dialog = false }: { dialog?: boolean }) {
  const [revision, setRevision] = useState(0)
  const [valid, setValid] = useState(false)
  fields = useFormErrors()
  fields.define('name', '名前', () => valid ? null : '名前を入れてください')
  fields.define('other', '別の欄', () => null)
  return <div role={dialog ? 'dialog' : undefined}>
    <details key={revision}><summary>入力</summary>
      <input id="disclosed-name" aria-label="名前" {...fields.bind('name')} onChange={() => setValid(true)} />
    </details>
    <input aria-label="別の欄" {...fields.bind('other')} />
    <button onClick={() => setRevision(v => v + 1)}>作り直す</button>
  </div>
}
function animate(details: HTMLDetailsElement) {
  let resolve!: () => void
  const animation = { playState: 'running', finished: new Promise<void>(done => { resolve = done }) }
  blocked.add(details)
  Object.defineProperty(details, 'getAnimations', { configurable: true, value: () => animation.playState === 'running' ? [animation] : [] })
  finish.set(details, () => { animation.playState = 'finished'; blocked.delete(details); resolve() })
}
async function frame() { await act(async () => { frames.splice(0).forEach(fn => fn(0)) }) }
async function complete(details: HTMLDetailsElement) {
  await act(async () => { finish.get(details)!(); details.dispatchEvent(new Event('transitionend', { bubbles: true })) })
}
function name() { return screen.getByRole('textbox', { name: '名前' }) }
function details() { return name().closest('details')! }

it('開いた段のnative focusが失敗した時、実animation終了で入力へ移る', async () => {
  render(<DisclosureForm />)
  const panel = details(); animate(panel)
  act(() => { fields.submit() })
  await frame()
  expect(panel.open).toBe(true)
  expect(document.activeElement).not.toBe(name())
  await complete(panel)
  expect(document.activeElement).toBe(name())
})

it('待機中に欄が作り直されても現在のrefへ移り、古い欄へ戻らない', async () => {
  render(<DisclosureForm />)
  const old = name(); const panel = details(); animate(panel)
  act(() => { fields.submit() }); await frame()
  fireEvent.click(screen.getByRole('button', { name: '作り直す' }))
  const current = name()
  expect(current).not.toBe(old)
  await complete(panel)
  expect(document.activeElement).toBe(current)
  expect(old.isConnected).toBe(false)
})

it.each(['reset', 'manual focus', 'new validation', 'input corrected', 'unmount'] as const)('%s の後は古い待機要求が焦点を奪わない', async mode => {
  const view = render(<DisclosureForm />)
  const input = name(); const panel = details(); animate(panel)
  act(() => { fields.submit() }); await frame()
  const other = screen.getByRole('textbox', { name: '別の欄' })
  if (mode === 'reset') act(() => fields.reset())
  if (mode === 'manual focus') act(() => other.focus())
  if (mode === 'new validation') {
    fireEvent.change(input, { target: { value: '名前' } })
    act(() => fields.setServerErrors({ other: '確認してください' })); await frame()
    expect(document.activeElement).toBe(other)
  }
  if (mode === 'input corrected') fireEvent.change(input, { target: { value: '名前' } })
  if (mode === 'unmount') view.unmount()
  const active = document.activeElement
  await complete(panel)
  expect(document.activeElement).toBe(active)
  expect(document.activeElement).not.toBe(input)
})

it('即時focus可能ならanimationを待たず、後続終了で再focusしない', async () => {
  render(<DisclosureForm />)
  const panel = details(); animate(panel); blocked.delete(panel)
  act(() => { fields.submit() }); await frame()
  expect(document.activeElement).toBe(name())
  const spy = vi.spyOn(name(), 'focus'); spy.mockClear()
  await complete(panel)
  expect(spy).not.toHaveBeenCalled()
})

it('動きを減らす/animation無しの段と段無しの欄は従来通り即時focusする', async () => {
  render(<DisclosureForm />)
  act(() => { fields.submit() }); await frame()
  expect(document.activeElement).toBe(name())
  fireEvent.change(name(), { target: { value: '名前' } })
  act(() => { fields.setServerErrors({ other: '確認してください' }) }); await frame()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '別の欄' }))
})

it('編集窓のserver errorは同名の背景欄でなく窓内へ移る', async () => {
  render(<><input aria-label="背景" /><DisclosureForm dialog /></>)
  const panel = details(); animate(panel)
  act(() => { fields.setServerErrors({ name: '使えない名前です' }) }); await frame()
  await complete(panel)
  expect(document.activeElement).toBe(name())
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
})

it('公開id経路も実終了後に現在のidへfocusする', async () => {
  render(<DisclosureForm />)
  const panel = details(); animate(panel)
  focusFieldById('disclosed-name'); await frame()
  expect(document.activeElement).not.toBe(name())
  await complete(panel)
  expect(document.activeElement).toBe(name())
})

it('公開id経路の新しい要求が以前の段の待機を取消す', async () => {
  render(<DisclosureForm />)
  const panel = details(); animate(panel)
  const other = screen.getByRole('textbox', { name: '別の欄' }); other.id = 'other'
  focusFieldById('disclosed-name'); await frame()
  focusFieldById('other'); await frame()
  expect(document.activeElement).toBe(other)
  await complete(panel)
  expect(document.activeElement).toBe(other)
})

it('Animation APIが無くても実toggle/transition終了で再試行し、時間pollをしない', async () => {
  render(<DisclosureForm />)
  const panel = details(); blocked.add(panel)
  Object.defineProperty(panel, 'getAnimations', { configurable: true, value: undefined })
  act(() => { fields.submit() }); await frame()
  blocked.delete(panel)
  act(() => { panel.dispatchEvent(new Event('transitionend', { bubbles: true })) })
  expect(document.activeElement).toBe(name())
  expect(frames).toHaveLength(0)
})

it('待っている段を閉じた後にanimationが終わっても開き直さない', async () => {
  render(<DisclosureForm />)
  const panel = details(); animate(panel)
  act(() => { fields.submit() }); await frame()
  act(() => { panel.open = false; panel.dispatchEvent(new Event('toggle')) })
  await complete(panel)
  expect(panel.open).toBe(false)
  expect(document.activeElement).not.toBe(name())
})

it('待機中の編集窓が閉じたら背景の同じidへ移らない', async () => {
  const view = render(<DisclosureForm dialog />)
  const panel = details(); animate(panel)
  focusFieldById('disclosed-name'); await frame()
  view.unmount()
  const background = document.createElement('input'); background.id = 'disclosed-name'
  document.body.append(background)
  await complete(panel)
  expect(document.activeElement).not.toBe(background)
  background.remove()
})


it('保存後の描画frame前に別欄を選んだら自動focusを取消す', async () => {
  render(<DisclosureForm />)
  act(() => { fields.submit() })
  const other = screen.getByRole('textbox', { name: '別の欄' })
  act(() => other.focus())
  await frame()
  expect(document.activeElement).toBe(other)
})


it('reveal後の非同期step commitが2frameより遅くても現在の欄へ移る', async () => {
  let show!: () => void
  function DeferredStep() {
    const [visible, setVisible] = useState(false)
    fields = useFormErrors()
    fields.define('body', '本文', () => '本文を直してください', { reveal: () => { show = () => setVisible(true) } })
    return visible ? <details><summary>本文</summary><textarea aria-label="本文" {...fields.bind('body')} /></details> : <p>送信設定</p>
  }
  render(<DeferredStep />)
  act(() => { fields.submit() })
  await frame(); await frame(); await frame()
  expect(screen.queryByRole('textbox')).toBeNull()
  act(() => show())
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '本文' }))
})
