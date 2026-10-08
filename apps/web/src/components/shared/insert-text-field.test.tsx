// @vitest-environment happy-dom
/*
 * 差し込みを札で見せる本文の欄（絵 OVCot ①）の動き。
 * 保存の値は今までどおり {{name}} などの文字・札は Backspace 1回で消える・
 * 変換中の Enter は改行にしない・貼り付けた {{name}} は札になる・上限で切る・v7 は今の textarea。
 */
import React, { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import InsertTextField, { InsertButton, InsertText, type InsertTextFieldHandle } from './insert-text-field'
import { splitInsertTokens } from './insert-tokens'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let saved: string[] = []

function Harness({ initial = '', maxLength }: { initial?: string; maxLength?: number }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<InsertTextFieldHandle | HTMLTextAreaElement | null>(null)
  /* 差し込むボタン：今の画面と同じく、カーソルの位置へ文字を入れる。 */
  const insert = (token: string) => {
    const element = ref.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? start
    const next = value.slice(0, start) + token + value.slice(end)
    setValue(next)
    saved.push(next)
  }
  return (
    <>
      <InsertTextField
        ref={ref}
        aria-label="本文"
        value={value}
        maxLength={maxLength}
        onValueChange={(next) => { setValue(next); saved.push(next) }}
      />
      <InsertButton label="名前" onClick={() => insert('{{name}}')} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const box = () => host.querySelector('[aria-label="本文"]') as HTMLElement
const current = () => (host.querySelector('[data-testid="value"]') as HTMLElement).textContent
const chips = () => Array.from(box().querySelectorAll('[data-token]')).map((chip) => chip.getAttribute('data-token'))

/** カーソルを、本文の箱の子の位置へ置く。 */
function caretAt(node: Node, offset: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

async function mount(element: React.ReactElement) {
  await act(async () => { root.render(element) })
}

beforeEach(() => {
  saved = []
  document.documentElement.setAttribute('data-theme', 'v8')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

describe('札に分ける（保存の文字は1文字も変えない）', () => {
  it('分かる差し込みだけ札にし、分からない {{…}} は文字のまま残す', () => {
    const pieces = splitInsertTokens('{{name}}さん、{{date:ymd}} {{unknown}} {{field.pet_name}}')
    expect(pieces.map((piece) => (piece.kind === 'chip' ? `[${piece.spec.label}]` : piece.text)).join('')).toBe('[名前]さん、[配信日] {{unknown}} [pet_name]')
    expect(pieces.map((piece) => (piece.kind === 'chip' ? piece.spec.token : piece.text)).join('')).toBe('{{name}}さん、{{date:ymd}} {{unknown}} {{field.pet_name}}')
  })

  it('画面ごとの差し込み（統括の {店名}）は渡したものが札になる', () => {
    const pieces = splitInsertTokens('{店名}より', [{ token: '{店名}', label: '店名', hint: '送る店の名前', icon: 'store' }])
    expect(pieces[0]).toMatchObject({ kind: 'chip', spec: { label: '店名' } })
  })
})

describe('本文の欄（v8）', () => {
  it('{{name}} は緑の札（名前）で見せ、乗せると説明が出る。保存の値は {{name}} のまま', async () => {
    await mount(<Harness initial="{{name}}さん、こんにちは。{{nope}}" />)
    expect(box().getAttribute('role')).toBe('textbox')
    expect(chips()).toEqual(['{{name}}'])
    const chip = box().querySelector('[data-token]') as HTMLElement
    expect(chip.textContent).toBe('名前')
    expect(chip.getAttribute('title')).toBe('受け取る人の名前に置き換わります')
    expect(chip.getAttribute('contenteditable')).toBe('false')
    expect(box().textContent).toContain('{{nope}}')
    expect((box() as unknown as { value: string }).value).toBe('{{name}}さん、こんにちは。{{nope}}')
  })

  it('差し込むボタンで札を入れると、保存の値は {{name}}（カーソルの位置に入る）', async () => {
    await mount(<Harness initial="さん" />)
    act(() => { box().focus() })
    caretAt(box().firstChild!, 0)
    await act(async () => { fireEvent.click(host.querySelector('button')!) })
    expect(current()).toBe('{{name}}さん')
    expect(saved.at(-1)).toBe('{{name}}さん')
    expect(chips()).toEqual(['{{name}}'])
  })

  it('札のすぐ後ろで Backspace を1回押すと札ごと消える', async () => {
    await mount(<Harness initial="{{name}}さん" />)
    act(() => { box().focus() })
    const chip = box().querySelector('[data-token]')!
    caretAt(box(), Array.prototype.indexOf.call(box().childNodes, chip) + 1)
    await act(async () => { fireEvent.keyDown(box(), { key: 'Backspace' }) })
    expect(current()).toBe('さん')
    expect(chips()).toEqual([])
  })

  it('札のすぐ前で Delete を1回押すと札ごと消える', async () => {
    await mount(<Harness initial="こんにちは{{name}}" />)
    act(() => { box().focus() })
    caretAt(box().firstChild!, 5)
    await act(async () => { fireEvent.keyDown(box(), { key: 'Delete' }) })
    expect(current()).toBe('こんにちは')
  })

  it('変換中（IME）の Enter は改行にしない。変換していない Enter は改行', async () => {
    await mount(<Harness initial="あいう" />)
    act(() => { box().focus() })
    caretAt(box().firstChild!, 3)
    await act(async () => { fireEvent.compositionStart(box()) })
    const composing = fireEvent.keyDown(box(), { key: 'Enter', isComposing: true, keyCode: 229 })
    expect(composing).toBe(true)
    await act(async () => { fireEvent.compositionEnd(box()) })
    expect(current()).toBe('あいう')
    await act(async () => { fireEvent.keyDown(box(), { key: 'Enter' }) })
    expect(current()).toBe('あいう\n')
  })

  it('貼り付けた {{name}} は札になり、保存の値は貼った文字のまま', async () => {
    await mount(<Harness initial="" />)
    act(() => { box().focus() })
    caretAt(box(), 0)
    const clipboardData = { getData: (type: string) => (type === 'text/plain' ? '{{name}}様\r\nありがとう' : '') }
    await act(async () => { fireEvent.paste(box(), { clipboardData }) })
    expect(current()).toBe('{{name}}様\nありがとう')
    expect(chips()).toEqual(['{{name}}'])
  })

  it('文字数の上限を超える貼り付けは、上限で切る（数え方は保存の文字のまま）', async () => {
    await mount(<Harness initial="12345" maxLength={8} />)
    act(() => { box().focus() })
    caretAt(box().firstChild!, 5)
    const clipboardData = { getData: () => 'abcdef' }
    await act(async () => { fireEvent.paste(box(), { clipboardData }) })
    expect(current()).toBe('12345abc')
  })

  it('試験・自動操作が textarea と同じ書き方（value を入れて change）で書ける', async () => {
    await mount(<Harness initial="" />)
    await act(async () => { fireEvent.change(box(), { target: { value: '{{name}}さん' } }) })
    expect(current()).toBe('{{name}}さん')
    expect(chips()).toEqual(['{{name}}'])
  })
})

describe('題（label）とのつながり', () => {
  it('<label for> の題で探せて、題を押すと箱に焦点が来る', async () => {
    function Labelled() {
      const [value, setValue] = useState('')
      return <><label htmlFor="body-x">本文の題</label><InsertTextField id="body-x" value={value} onValueChange={setValue} /></>
    }
    await mount(<Labelled />)
    const field = host.querySelector('#body-x') as HTMLElement
    expect(field.getAttribute('aria-labelledby')).toBe('body-x-label')
    fireEvent.click(host.querySelector('label')!)
    expect(document.activeElement).toBe(field)
  })
})

describe('v7 の見た目は変えない', () => {
  it('data-theme が v8 でないときは今までどおりの textarea', async () => {
    document.documentElement.removeAttribute('data-theme')
    await mount(<Harness initial="{{name}}さん" />)
    const element = box()
    expect(element.tagName).toBe('TEXTAREA')
    expect((element as HTMLTextAreaElement).value).toBe('{{name}}さん')
    await act(async () => { fireEvent.change(element, { target: { value: '{{name}}' } }) })
    expect(current()).toBe('{{name}}')
  })
})


describe('閲覧用の差し込み', () => {
  it('名前と分かる差し込みは札、未知の差し込みとHTMLに見える文は文字として読む', () => {
    const value = '<script>alert(1)</script>{{name}}さん {{field.plan}} {{unknown}}'
    act(() => root.render(<InsertText value={value} tokenNames={{ fields: { plan: 'プラン' } }} />))
    expect(host.querySelectorAll('[data-token]')).toHaveLength(2)
    expect(host.textContent).toBe('<script>alert(1)</script>名前さん プラン {{unknown}}')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('[contenteditable]')).toBeNull()
  })
})
