// @vitest-environment happy-dom
/*
 * useFormErrors の契約試験（★V7 sTJsh §6）。
 *
 * - 欄から離れた時点で1回だけ理由を出す（開いた直後・未タッチの欄には出さない）
 * - 直すと描画の時点で誤りが消える
 * - 送信時は全欄をもう一度見て、落ちた欄へフォーカスを移す
 */
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useFormErrors } from './use-form-errors'

function Harness() {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const fields = useFormErrors()
  fields.define('name', '名前', () => (name.trim() ? null : '名前を入力してください'))
  fields.define('url', '送り先のURL', () =>
    /^https:\/\//.test(url.trim()) ? null : 'URLは https:// で始めてください')
  return (
    <div>
      <label htmlFor="f-name">名前</label>
      <input {...fields.bind('name')} id="f-name" value={name} onChange={(e) => setName(e.target.value)} />
      {fields.error('name') ? <p role="alert" data-field-error="name">{fields.error('name')}</p> : null}
      <label htmlFor="f-url">URL</label>
      <input {...fields.bind('url')} id="f-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      {fields.error('url') ? <p role="alert" data-field-error="url">{fields.error('url')}</p> : null}
      <button type="button" data-action="submit" onClick={() => fields.submit()}>保存する</button>
      <div data-problems>{fields.listProblems().map((p) => p.label).join(',')}</div>
    </div>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<Harness />) })
}

function input(id: string): HTMLInputElement {
  return host.querySelector(`#${id}`) as HTMLInputElement
}

async function blur(id: string) {
  // React の onBlur は DOM の focusout イベントに繋がっている。
  await act(async () => { input(id).dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

async function type(id: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    const el = input(id)
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('useFormErrors（★V7 sTJsh §6）', () => {
  it('開いた直後・まだ触っていない欄には何も出さない', async () => {
    await render()
    expect(host.querySelector('[data-field-error]')).toBeNull()
    expect(host.querySelector('[data-problems]')?.textContent).toBe('')
  })

  it('欄から離れた時点で、その欄だけ理由を出す', async () => {
    await render()
    await blur('f-name')
    expect(host.querySelector('[data-field-error="name"]')?.textContent).toBe('名前を入力してください')
    // まだ触っていない欄は静かなまま
    expect(host.querySelector('[data-field-error="url"]')).toBeNull()
  })

  it('直したらその場で誤りが消える', async () => {
    await render()
    await blur('f-name')
    expect(host.querySelector('[data-field-error="name"]')).toBeTruthy()
    await type('f-name', '外部CRM連携')
    expect(host.querySelector('[data-field-error="name"]')).toBeNull()
  })

  it('送信時に全欄を検査し、まとめに落ちた欄を出して1つ目へ移る', async () => {
    await render()
    const submit = host.querySelector('[data-action="submit"]')!
    await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 両方の欄に理由が出て、まとめは欄の順に並ぶ
    expect(host.querySelector('[data-field-error="name"]')?.textContent).toBe('名前を入力してください')
    expect(host.querySelector('[data-field-error="url"]')?.textContent).toBe('URLは https:// で始めてください')
    expect(host.querySelector('[data-problems]')?.textContent).toBe('名前,送り先のURL')
    // 1つ目の欄へフォーカスが移る（requestAnimationFrame 経由）
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    expect(document.activeElement).toBe(input('f-name'))
  })

  it('送信後に直すとまとめからも消える', async () => {
    await render()
    const submit = host.querySelector('[data-action="submit"]')!
    await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await type('f-name', '外部CRM連携')
    expect(host.querySelector('[data-field-error="name"]')).toBeNull()
    expect(host.querySelector('[data-problems]')?.textContent).toBe('送り先のURL')
    await type('f-url', 'https://example.com/hook')
    expect(host.querySelector('[data-field-error]')).toBeNull()
    expect(host.querySelector('[data-problems]')?.textContent).toBe('')
  })

  it('全部通る送信は空を返す', async () => {
    let captured: unknown = null
    function OkHarness() {
      const [v] = useState('あ')
      const fields = useFormErrors()
      fields.define('name', '名前', () => (v.trim() ? null : '名前を入力してください'))
      return <button type="button" data-action="submit" onClick={() => { captured = fields.submit() }}>保存する</button>
    }
    await act(async () => { root.render(<OkHarness />) })
    const submit = host.querySelector('[data-action="submit"]')!
    await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(captured).toEqual([])
  })
})
